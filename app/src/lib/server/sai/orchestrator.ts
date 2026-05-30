import { env } from '$env/dynamic/private';
import type {
	ActivityCandidate,
	CandidateBundle,
	CandidateQueryPlan,
	RestaurantCandidate
} from '$lib/sai/candidates';
import { composeRecommendations, formatKrw, partyCount } from '$lib/sai/recommendations';
import type {
	RecommendationCard,
	RecommendationHistoryItem,
	RecommendationItem,
	RecommendationSession,
	UserProfile
} from '$lib/sai/types';
import { collectCandidates } from './candidates';
import { planCandidateQueries } from './candidate-plan';
import { loggedFetch, logIntegrationEvent } from './integration-logger';

export type ComposeResult = {
	cards: RecommendationCard[];
	candidates: CandidateBundle;
	source: 'openai' | 'fallback';
	model?: string;
	fallbackReason?: string;
};

type OpenAIResponse = {
	output_text?: string;
	output?: Array<{
		type?: string;
		content?: Array<{
			type?: string;
			text?: string;
		}>;
	}>;
};

const DEFAULT_MODEL = 'gpt-5.4-mini';
const LONG_ACTIVITY_PATTERN =
	/글램핑|캠핑장|캠핑|야영|카라반|숙박|리조트|당일치기|등산|트레킹|하이킹/i;

export async function composeWithOrchestrator(
	profile: UserProfile,
	session: RecommendationSession,
	histories: RecommendationHistoryItem[] = []
): Promise<ComposeResult> {
	const initialCandidates = await collectCandidates({ profile, session });
	const queryPlan = await planCandidateQueries(profile, session, histories, initialCandidates);
	const refinedCandidates = await collectCandidates({ profile, session, queryPlan });
	const candidates = mergeCandidateBundles(
		initialCandidates,
		refinedCandidates,
		session,
		queryPlan
	);
	const fallbackCards = scopeCardsToSession(
		applySessionGuards(
			applyHistoryHints(
				applyCandidateBundle(composeRecommendations(profile, session), candidates),
				histories
			),
			session
		),
		session.id
	);
	await logRecommendationGuard(session, queryPlan, fallbackCards);

	if (!env.OPENAI_API_KEY) {
		return {
			cards: fallbackCards,
			candidates,
			source: 'fallback',
			fallbackReason: 'OPENAI_API_KEY is not configured'
		};
	}

	const model = env.OPENAI_MODEL || DEFAULT_MODEL;

	try {
		const cards = await requestOpenAICards({
			model,
			profile,
			session,
			candidates,
			histories,
			sessionId: session.id,
			fallbackCards
		});

		return {
			cards,
			candidates,
			source: 'openai',
			model
		};
	} catch (error) {
		return {
			cards: fallbackCards,
			candidates,
			source: 'fallback',
			model,
			fallbackReason: error instanceof Error ? error.message : 'OpenAI orchestration failed'
		};
	}
}

function mergeCandidateBundles(
	initial: CandidateBundle,
	refined: CandidateBundle,
	session: RecommendationSession,
	queryPlan: CandidateQueryPlan
): CandidateBundle {
	return {
		weather: refined.weather ?? initial.weather,
		trendKeywords: uniqueStrings([...refined.trendKeywords, ...initial.trendKeywords]).slice(0, 10),
		activities: uniqueActivities([...refined.activities, ...initial.activities], session).slice(
			0,
			8
		),
		restaurants: uniqueRestaurants([...refined.restaurants, ...initial.restaurants]).slice(0, 8),
		mobility: [...refined.mobility, ...initial.mobility].slice(0, 6),
		statuses: [...refined.statuses, ...initial.statuses],
		queryPlan
	};
}

function uniqueActivities(candidates: ActivityCandidate[], session: RecommendationSession) {
	const seen = new Set<string>();
	return candidates.filter((candidate) => {
		if (
			isBlockedByLongActivityWindow(
				session,
				[candidate.title, candidate.address, ...candidate.tags].join(' ')
			)
		) {
			return false;
		}
		const key = `${candidate.title}-${candidate.address ?? ''}`.replace(/\s/g, '').toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function uniqueRestaurants(candidates: RestaurantCandidate[]) {
	const seen = new Set<string>();
	return candidates.filter((candidate) => {
		const key = `${candidate.title}-${candidate.address ?? ''}`.replace(/\s/g, '').toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function uniqueStrings(values: string[]) {
	return [...new Set(values.filter(Boolean))];
}

function isBlockedByLongActivityWindow(session: RecommendationSession, text: string) {
	if (!blocksLongActivity(session)) return false;
	return LONG_ACTIVITY_PATTERN.test(text);
}

function isSingleActivityWindow(session: RecommendationSession) {
	if (session.availableTime === 'one_hour') return true;
	const start = session.startDateTime ? new Date(session.startDateTime) : null;
	const end = session.endDateTime ? new Date(session.endDateTime) : null;
	if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
	return end.getTime() > start.getTime() && end.getTime() - start.getTime() <= 90 * 60 * 1000;
}

function blocksLongActivity(session: RecommendationSession) {
	if (session.availableTime && !['day', 'weekend'].includes(session.availableTime)) return true;
	const start = session.startDateTime ? new Date(session.startDateTime) : null;
	const end = session.endDateTime ? new Date(session.endDateTime) : null;
	if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
	return end.getTime() > start.getTime() && end.getTime() - start.getTime() <= 300 * 60 * 1000;
}

async function requestOpenAICards(input: {
	model: string;
	profile: UserProfile;
	session: RecommendationSession;
	candidates: CandidateBundle;
	histories: RecommendationHistoryItem[];
	sessionId: string;
	fallbackCards: RecommendationCard[];
}) {
	const response = await loggedFetch({
		provider: 'openai',
		kind: 'ai',
		operation: 'recommendations.compose',
		url: 'https://api.openai.com/v1/responses',
		init: {
			method: 'POST',
			headers: {
				authorization: `Bearer ${env.OPENAI_API_KEY}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				model: input.model,
				input: [
					{
						role: 'system',
						content: [
							{
								type: 'input_text',
								text: [
									'너는 사이(SAI)의 추천 오케스트레이터다.',
									'사용자의 시간, 총 예산, 위치, 날씨, 동행 상황, 온보딩 프로필, 후보 API 결과를 종합해 실행 가능한 추천 카드 3개를 만든다.',
									'시간과 예산은 다시 묻지 않는다.',
									'MBTI는 추천 톤과 활동 성향 보정에만 사용하고 시간, 예산, 안전 조건보다 우선하지 않는다.',
									'profile.onboardingFreeformAnswers는 사용자가 온보딩에서 말이나 문장으로 답한 원문 Q/A다. 선택지보다 구체적인 취향 신호로 보고 추천 후보, 이유, 배지에 반영한다.',
									'아기 동반이면 부모 취향보다 아기 안전, 유모차/수유실/기저귀 교체/주차, 짧은 동선을 먼저 본다.',
									'후보 API 결과는 실행 링크와 검증 신호로 우선 사용한다. MyRealTrip 상품/옵션, API Fuse의 KakaoMap/NaverMap 장소와 경로, CatchTable 검색/예약가능성, Yogiyo 음식 후보, AirKorea 대기질, Modu Parking 주차 후보, Swing 이동 후보를 가능한 한 반영한다.',
									'예약 URL은 후보에 있는 outboundUrl 또는 reservationUrl만 사용하고 새 URL을 지어내지 않는다.',
									'routeSummary에는 후보 mobility가 있으면 이동수단과 예상 시간을 포함한다.',
									'availabilityText, mapUrl, 좌표가 있는 후보를 더 실행 가능하다고 본다.',
									'카드의 첫 문장은 왜 이 추천이 맞는지여야 한다.',
									'모든 가격은 원화 숫자이며 총 예산 기준으로 맞춘다.',
									'outboundUrl은 후보에 있는 URL만 사용하고 없으면 https://map.kakao.com 을 사용한다.'
								].join('\n')
							}
						]
					},
					{
						role: 'user',
						content: [
							{
								type: 'input_text',
								text: JSON.stringify({
									profile: input.profile,
									session: input.session,
									candidates: input.candidates,
									histories: summarizeHistories(input.histories),
									referenceCards: input.fallbackCards
								})
							}
						]
					}
				],
				text: {
					format: {
						type: 'json_schema',
						name: 'sai_recommendations',
						strict: true,
						schema: recommendationSchema()
					}
				}
			}),
			signal: AbortSignal.timeout(12000)
		}
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => '');
		throw new Error(`OpenAI ${response.status}: ${errorText.slice(0, 160)}`);
	}

	const payload = (await response.json()) as OpenAIResponse;
	const text = extractOutputText(payload);
	if (!text) throw new Error('OpenAI response did not include output text');

	const parsed = JSON.parse(text) as { recommendations?: RecommendationCard[] };
	const cards = parsed.recommendations;
	if (!Array.isArray(cards) || cards.length !== 3) {
		throw new Error('OpenAI response did not include exactly 3 recommendations');
	}

	return applySessionGuards(
		cards.map((card, index) => normalizeCard(card, input.fallbackCards[index], input.sessionId)),
		input.session
	);
}

function scopeCardsToSession(cards: RecommendationCard[], sessionId: string) {
	return cards.map((card) => ({
		...card,
		id: card.id.startsWith(`${sessionId}:`) ? card.id : `${sessionId}:${card.id}`
	}));
}

function applyCandidateBundle(cards: RecommendationCard[], bundle: CandidateBundle) {
	return cards.map((card, index) => {
		const activity = bundle.activities[index % Math.max(bundle.activities.length, 1)];
		const restaurant = bundle.restaurants[index % Math.max(bundle.restaurants.length, 1)];
		const mobility = bundle.mobility[index % Math.max(bundle.mobility.length, 1)];
		const items = card.items.map((item) => {
			if (item.slot === 'activity' && activity) {
				return {
					...item,
					title: activity.title,
					price: activity.price ?? item.price,
					source: activity.source,
					outboundUrl: activity.outboundUrl ?? item.outboundUrl,
					reservationUrl: activity.reservationUrl ?? activity.outboundUrl ?? item.reservationUrl,
					mapUrl: activity.mapUrl ?? item.mapUrl,
					address: activity.address ?? item.address,
					lat: activity.lat ?? item.lat,
					lng: activity.lng ?? item.lng,
					availabilityText: activity.availabilityText ?? item.availabilityText,
					thumbnailUrl: activity.thumbnailUrl ?? item.thumbnailUrl
				};
			}

			if (item.slot === 'food' && restaurant) {
				return {
					...item,
					title: restaurant.title,
					price: restaurant.price ?? item.price,
					source: restaurant.source,
					outboundUrl: restaurant.outboundUrl ?? item.outboundUrl,
					reservationUrl:
						restaurant.reservationUrl ?? restaurant.outboundUrl ?? item.reservationUrl,
					mapUrl: restaurant.mapUrl ?? item.mapUrl,
					address: restaurant.address ?? item.address,
					lat: restaurant.lat ?? item.lat,
					lng: restaurant.lng ?? item.lng,
					availabilityText: restaurant.availabilityText ?? item.availabilityText,
					thumbnailUrl: restaurant.thumbnailUrl ?? item.thumbnailUrl
				};
			}

			return item;
		});
		const externalTags = [...(activity?.tags ?? []), ...(restaurant?.tags ?? [])].slice(0, 2);
		const trendTag = bundle.trendKeywords[index];
		const badges = [
			...new Set([...card.badges, ...externalTags, ...(trendTag ? [trendTag] : [])])
		].slice(0, 8);
		const reservationUrl =
			items.find((item) => item.reservationUrl)?.reservationUrl ?? card.reservationUrl;
		const routeMapUrl =
			mobility?.routeMapUrl ?? items.find((item) => item.mapUrl)?.mapUrl ?? card.routeMapUrl;

		return {
			...card,
			items,
			badges,
			weatherFit: bundle.weather.preferIndoor ? 'indoor' : card.weatherFit,
			routeSummary: mobility?.label ?? card.routeSummary,
			routeTransport: mobility?.mode ?? card.routeTransport,
			routeMapUrl,
			routeDetail: mobility?.detail ?? card.routeDetail,
			reservationUrl,
			outboundUrl: reservationUrl ?? routeMapUrl ?? card.outboundUrl
		};
	});
}

function applySessionGuards(cards: RecommendationCard[], session: RecommendationSession) {
	const singleActivityWindow = isSingleActivityWindow(session);
	const longActivityBlocked = blocksLongActivity(session);
	if (!singleActivityWindow && !longActivityBlocked) return cards;
	const budget = Math.max(session.budgetTotal ?? 50000, 10000);
	const people = partyCount(session.situation);

	return cards.map((card) => {
		const safeItems = longActivityBlocked
			? card.items.filter((item) => {
					return !isBlockedByLongActivityWindow(
						session,
						[item.title, item.address, item.availabilityText].filter(Boolean).join(' ')
					);
				})
			: card.items;
		const fallbackItem = card.items.find((item) => item.slot === 'activity') ?? card.items[0];
		const usableItems = safeItems.length
			? safeItems.map((item) => ({
					...item,
					title: longActivityBlocked ? sanitizeLongActivityText(item.title) : item.title,
					availabilityText: item.availabilityText
						? sanitizeLongActivityText(item.availabilityText)
						: item.availabilityText
				}))
			: fallbackItem
				? [
						{
							...fallbackItem,
							title: '근처 전시/카페 후보',
							source: fallbackItem.source,
							outboundUrl: fallbackItem.outboundUrl || 'https://map.kakao.com'
						}
					]
				: [];
		const primaryItem =
			usableItems.find((item) => item.slot === 'activity') ?? usableItems[0] ?? fallbackItem;
		if (!primaryItem) return card;
		const items = singleActivityWindow ? [primaryItem] : usableItems;
		const estimatedCost = Math.min(
			budget,
			Math.max(0, items.reduce((sum, item) => sum + (item.price || 0), 0) || card.estimatedCost)
		);
		const estimatedDuration = singleActivityWindow
			? '1시간'
			: capDurationToSession(card.estimatedDuration, session);
		const guardedBadges = [
			...new Set([
				...(singleActivityWindow ? ['1시간 맞춤', '단일 활동'] : []),
				...(longActivityBlocked ? ['긴 코스 제외'] : []),
				...card.badges.map((badge) => sanitizeLongActivityText(badge))
			])
		].slice(0, 8);
		const guardedReason = sanitizeLongActivityText(card.reason);

		return {
			...card,
			title: singleActivityWindow
				? `${primaryItem.title} 한 곳만 가기`
				: sanitizeLongActivityText(card.title),
			reason: `${guardedReason} ${
				singleActivityWindow
					? '1시간 안에 끝나야 해서 이동과 식사를 늘리지 않고 한 곳만 추천했어.'
					: longActivityBlocked
						? '사용 가능한 시간 안에 어렵거나 긴 코스는 제외했어.'
						: ''
			}`.trim(),
			resultType: singleActivityWindow ? 'single_activity' : card.resultType,
			estimatedDuration,
			estimatedCost,
			budgetText: oneHourBudgetText(budget, estimatedCost),
			perPersonText: `1인당 약 ${formatKrw(Math.ceil(estimatedCost / people / 1000) * 1000)}`,
			routeSummary:
				singleActivityWindow && card.routeSummary.includes('+')
					? '근거리 단일 활동'
					: sanitizeLongActivityText(card.routeSummary),
			badges: guardedBadges,
			items
		} satisfies RecommendationCard;
	});
}

function capDurationToSession(duration: string, session: RecommendationSession) {
	const maxMinutes = availableMinutes(session);
	const durationMinutes = parseDurationMinutes(duration);
	if (maxMinutes && !durationMinutes && duration.includes('맞춤'))
		return formatDuration(maxMinutes);
	if (!maxMinutes || !durationMinutes || durationMinutes <= maxMinutes) return duration;
	return formatDuration(maxMinutes);
}

function availableMinutes(session: RecommendationSession) {
	const start = session.startDateTime ? new Date(session.startDateTime) : null;
	const end = session.endDateTime ? new Date(session.endDateTime) : null;
	if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
		const diffMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
		if (diffMinutes > 0) return diffMinutes;
	}
	if (session.availableTime === 'one_hour') return 60;
	if (session.availableTime === 'two_three') return 180;
	if (session.availableTime === 'half_day') return 300;
	return undefined;
}

function parseDurationMinutes(duration: string) {
	const hourMatch = duration.match(/(\d+)\s*시간/);
	const minuteMatch = duration.match(/(\d+)\s*분/);
	const hours = hourMatch?.[1] ? Number(hourMatch[1]) : 0;
	const minutes = minuteMatch?.[1] ? Number(minuteMatch[1]) : 0;
	const total = hours * 60 + minutes;
	return total > 0 ? total : undefined;
}

function formatDuration(minutes: number) {
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (!hours) return `${rest}분`;
	if (!rest) return `${hours}시간`;
	return `${hours}시간 ${rest}분`;
}

function sanitizeLongActivityText(text: string) {
	return text
		.replace(/캠핑 감성 바비큐\/글램핑 카페/g, '바비큐 카페')
		.replace(/가벼운 캠핑\/글램핑 체험/g, '짧은 야외 감성 체험')
		.replace(/글램핑 또는 당일 캠핑 체험/g, '짧은 체험')
		.replace(/캠핑 글램핑 야외 체험/g, '짧은 야외 감성 체험')
		.replace(
			/글램핑|캠핑장|캠핑|야영|카라반|숙박|리조트|당일치기|등산|트레킹|하이킹/g,
			'짧은 활동'
		);
}

function oneHourBudgetText(budget: number, cost: number) {
	const diff = budget - cost;
	if (diff > 0) return `예산보다 ${formatKrw(diff)} 여유 있어`;
	if (diff === 0) return '예산에 딱 맞아';
	return `예산보다 ${formatKrw(Math.abs(diff))} 높아`;
}

async function logRecommendationGuard(
	session: RecommendationSession,
	queryPlan: CandidateQueryPlan,
	cards: RecommendationCard[]
) {
	if (!blocksLongActivity(session) && !isSingleActivityWindow(session)) return;
	await logIntegrationEvent({
		provider: 'internal',
		kind: 'api',
		operation: 'recommendation.time_guard',
		method: 'INTERNAL',
		url: 'sai://recommendation/time-guard',
		ok: true,
		durationMs: 0,
		requestPayload: {
			sessionId: session.id,
			availableTime: session.availableTime,
			startDateTime: session.startDateTime,
			endDateTime: session.endDateTime,
			queryPlanSource: queryPlan.source,
			excludedKeywords: queryPlan.excludedKeywords
		},
		responsePayload: {
			blocksLongActivity: blocksLongActivity(session),
			singleActivityWindow: isSingleActivityWindow(session),
			cards: cards.map((card) => ({
				title: card.title,
				resultType: card.resultType,
				estimatedDuration: card.estimatedDuration,
				items: card.items.map((item) => item.title),
				badges: card.badges
			}))
		}
	});
}

function applyHistoryHints(cards: RecommendationCard[], histories: RecommendationHistoryItem[]) {
	const signals = summarizeHistories(histories);
	if (!signals.length) return cards;

	const signalBadges = signals
		.flatMap((item) => [
			...item.likeReasons,
			...item.dislikeReasons.map((reason) => `${reason} 피하기`)
		])
		.slice(0, 3);

	return cards.map((card) => ({
		...card,
		reason: `${card.reason} 최근 피드백도 같이 봤어.`,
		badges: [...new Set([...card.badges, ...signalBadges, '히스토리 반영'])].slice(0, 8)
	}));
}

function summarizeHistories(histories: RecommendationHistoryItem[]) {
	return histories.slice(0, 6).map((history) => ({
		situation: history.session.situation,
		availableTime: history.session.availableTime,
		budgetTotal: history.session.budgetTotal,
		clickedCardIds: history.clickedCardIds,
		likedLabels: history.feedback
			.filter((feedback) => feedback.sentiment === 'like')
			.map((feedback) => history.cards.find((card) => card.id === feedback.cardId)?.label)
			.filter((label): label is string => Boolean(label)),
		dislikedLabels: history.feedback
			.filter((feedback) => feedback.sentiment === 'dislike')
			.map((feedback) => history.cards.find((card) => card.id === feedback.cardId)?.label)
			.filter((label): label is string => Boolean(label)),
		likeReasons: history.feedback
			.filter((feedback) => feedback.sentiment === 'like')
			.flatMap((feedback) => feedback.reasons),
		dislikeReasons: history.feedback
			.filter((feedback) => feedback.sentiment === 'dislike')
			.flatMap((feedback) => feedback.reasons)
	}));
}

function normalizeCard(
	card: RecommendationCard,
	fallback: RecommendationCard,
	sessionId: string
): RecommendationCard {
	const id = card.id || fallback.id;
	const items = mergeItemExecutionData(
		card.items?.length ? card.items : fallback.items,
		fallback.items
	);
	const reservationUrl =
		card.reservationUrl ??
		fallback.reservationUrl ??
		items.find((item) => item.reservationUrl)?.reservationUrl;
	const routeMapUrl =
		card.routeMapUrl ?? fallback.routeMapUrl ?? items.find((item) => item.mapUrl)?.mapUrl;
	return {
		...fallback,
		...card,
		id: id.startsWith(`${sessionId}:`) ? id : `${sessionId}:${id}`,
		items,
		badges: card.badges?.length ? card.badges : fallback.badges,
		companionFit: card.companionFit ?? fallback.companionFit,
		outboundUrl: card.outboundUrl || reservationUrl || routeMapUrl || fallback.outboundUrl,
		routeTransport: card.routeTransport ?? fallback.routeTransport,
		routeMapUrl,
		routeDetail: card.routeDetail ?? fallback.routeDetail,
		reservationUrl,
		calendarUrl: card.calendarUrl ?? fallback.calendarUrl
	};
}

function mergeItemExecutionData(items: RecommendationItem[], fallbackItems: RecommendationItem[]) {
	return items.map((item, index) => {
		const fallback =
			fallbackItems.find((candidate, fallbackIndex) => {
				return fallbackIndex === index || candidate.slot === item.slot;
			}) ?? fallbackItems[index];
		if (!fallback) return item;

		return {
			...fallback,
			...item,
			outboundUrl: item.outboundUrl || fallback.outboundUrl,
			reservationUrl: item.reservationUrl ?? fallback.reservationUrl,
			mapUrl: item.mapUrl ?? fallback.mapUrl,
			address: item.address ?? fallback.address,
			lat: item.lat ?? fallback.lat,
			lng: item.lng ?? fallback.lng,
			availabilityText: item.availabilityText ?? fallback.availabilityText,
			thumbnailUrl: item.thumbnailUrl ?? fallback.thumbnailUrl
		};
	});
}

function extractOutputText(payload: OpenAIResponse) {
	if (payload.output_text) return payload.output_text;

	for (const item of payload.output ?? []) {
		for (const content of item.content ?? []) {
			if (content.type === 'output_text' && content.text) return content.text;
		}
	}

	return '';
}

function recommendationSchema() {
	const itemSchema = {
		type: 'object',
		additionalProperties: false,
		required: ['slot', 'title', 'price', 'source', 'outboundUrl'],
		properties: {
			slot: { type: 'string', enum: ['activity', 'food', 'move', 'fallback'] },
			title: { type: 'string' },
			price: { type: 'integer', minimum: 0 },
			source: { type: 'string', enum: ['myrealtrip', 'api_fuse', 'genrank', 'sai'] },
			outboundUrl: { type: 'string' }
		}
	};

	const cardSchema = {
		type: 'object',
		additionalProperties: false,
		required: [
			'id',
			'label',
			'title',
			'reason',
			'resultType',
			'estimatedDuration',
			'estimatedCost',
			'budgetText',
			'perPersonText',
			'weatherFit',
			'routeSummary',
			'companionFit',
			'badges',
			'items',
			'outboundUrl'
		],
		properties: {
			id: { type: 'string' },
			label: { type: 'string' },
			title: { type: 'string' },
			reason: { type: 'string' },
			resultType: {
				type: 'string',
				enum: ['single_activity', 'mini_course', 'course', 'timetable']
			},
			estimatedDuration: { type: 'string' },
			estimatedCost: { type: 'integer', minimum: 0 },
			budgetText: { type: 'string' },
			perPersonText: { type: 'string' },
			weatherFit: { type: 'string', enum: ['indoor', 'mostly_indoor', 'outdoor', 'any'] },
			routeSummary: { type: 'string' },
			companionFit: {
				type: 'array',
				items: { type: 'string' }
			},
			badges: {
				type: 'array',
				items: { type: 'string' }
			},
			items: {
				type: 'array',
				items: itemSchema
			},
			outboundUrl: { type: 'string' }
		}
	};

	return {
		type: 'object',
		additionalProperties: false,
		required: ['recommendations'],
		properties: {
			recommendations: {
				type: 'array',
				minItems: 3,
				maxItems: 3,
				items: cardSchema
			}
		}
	};
}
