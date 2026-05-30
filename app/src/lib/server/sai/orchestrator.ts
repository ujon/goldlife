import { env } from '$env/dynamic/private';
import type { CandidateBundle } from '$lib/sai/candidates';
import { composeRecommendations } from '$lib/sai/recommendations';
import type {
	RecommendationCard,
	RecommendationHistoryItem,
	RecommendationItem,
	RecommendationSession,
	UserProfile
} from '$lib/sai/types';
import { collectCandidates } from './candidates';
import { loggedFetch } from './integration-logger';

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

export async function composeWithOrchestrator(
	profile: UserProfile,
	session: RecommendationSession,
	histories: RecommendationHistoryItem[] = []
): Promise<ComposeResult> {
	const candidates = await collectCandidates({ profile, session });
	const fallbackCards = scopeCardsToSession(
		applyHistoryHints(
			applyCandidateBundle(composeRecommendations(profile, session), candidates),
			histories
		),
		session.id
	);

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

	return cards.map((card, index) =>
		normalizeCard(card, input.fallbackCards[index], input.sessionId)
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
					availabilityText: activity.availabilityText ?? item.availabilityText
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
					availabilityText: restaurant.availabilityText ?? item.availabilityText
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
			availabilityText: item.availabilityText ?? fallback.availabilityText
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
