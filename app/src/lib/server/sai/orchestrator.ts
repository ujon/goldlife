import { env } from '$env/dynamic/private';
import type {
	ActivityCandidate,
	CandidateBundle,
	CandidateQueryPlan,
	FlightCandidate,
	RestaurantCandidate
} from '$lib/sai/candidates';
import {
	applyTimeUtilization,
	availableSessionMinutes,
	companionContextText,
	companionRelationPromptGuide,
	companionRelationSummary,
	companionRelationStrategy,
	composeRecommendations,
	formatKrw,
	hasFlightIntent,
	partyCountForSession,
	sessionRequestText
} from '$lib/sai/recommendations';
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
		applyTimeUtilization(
			applySessionGuards(
				applyOperatingStatusGuards(
					applyTravelTimeGuards(
						applyHistoryHints(
							applyCandidateBundle(composeRecommendations(profile, session), candidates, session),
							histories
						),
						session
					)
				),
				session
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
		flights: uniqueFlights([...refined.flights, ...initial.flights]).slice(0, 4),
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

function uniqueFlights(candidates: FlightCandidate[]) {
	const seen = new Set<string>();
	return candidates.filter((candidate) => {
		const key = [
			candidate.departureAirport,
			candidate.arrivalAirport,
			candidate.departureDate,
			candidate.returnDate,
			candidate.departureTimeText,
			candidate.airlineText,
			candidate.price
		]
			.filter(Boolean)
			.join('-')
			.replace(/\s/g, '')
			.toLowerCase();
		if (!key || seen.has(key)) return false;
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
									'현재 세션의 customTime, dynamicAnswers, location은 온보딩보다 나중에 말한 조건이다. 온보딩 취향과 충돌하면 현재 세션 조건을 우선한다.',
									'현재 세션의 companionRelations는 함께 움직이는 실제 관계 목록이다. 여러 관계가 있으면 3개 카드가 모두 같은 방향이면 안 되고, 엄마/친구/아내/아이처럼 각 관계가 좋아할 포인트를 카드별로 다르게 배분한다.',
									'여러 관계가 선택되면 카드마다 우선 관계를 다르게 잡고 label, reason, companionFit, badges에 어떤 관계를 배려했는지 드러낸다.',
									'같은 장소명이나 같은 활동 유형 3개를 반복하지 말고, 부모님 편의/친구와 대화/배우자 분위기/아이 안전처럼 카드별 선택 이유가 갈라지게 만든다.',
									'MBTI는 추천 톤과 활동 성향 보정에만 사용하고 시간, 예산, 안전 조건보다 우선하지 않는다.',
									'profile.onboardingFreeformAnswers는 사용자가 온보딩에서 말이나 문장으로 답한 원문 Q/A다. 선택지보다 구체적인 취향 신호로 보고 추천 후보, 이유, 배지에 반영한다.',
									'아기 동반이면 부모 취향보다 아기 안전, 유모차/수유실/기저귀 교체/주차, 짧은 동선을 먼저 본다.',
									'후보 API 결과는 실행 링크와 검증 신호로 우선 사용한다. MyRealTrip 상품/옵션, API Fuse의 KakaoMap/NaverMap 장소와 경로, CatchTable 검색/예약가능성, Yogiyo 음식 후보, AirKorea 대기질, Modu Parking 주차 후보, Swing 이동 후보를 가능한 한 반영한다.',
									'사용자에게 보이는 데이터 출처는 API Fuse나 SAI 같은 중간 계층명이 아니라 마이리얼트립, 캐치테이블, 카카오맵, 네이버지도, 요기요, 네이버항공처럼 실제 원천 서비스명으로 쓴다.',
									'현재 요청에 해외, 아주 멀리, 장거리, 비행기, 항공, 공항 또는 해외 도시가 있으면 candidates.flights를 반드시 검토하고, 후보가 있으면 최소 한 카드에는 flight 아이템을 포함한다.',
									'예약 URL은 후보에 있는 outboundUrl 또는 reservationUrl만 사용하고 새 URL을 지어내지 않는다.',
									'routeSummary에는 후보 mobility가 있으면 이동수단과 예상 시간을 포함한다.',
									'각 후보의 travelMinutes, travelTimeText를 보고 사용 가능 시간 안에서 이동 부담이 낮은 후보를 우선한다.',
									'사용 가능 시간이 짧으면 이동시간이 긴 후보를 쓰지 말고, 총 코스 시간에 이동시간을 반드시 포함한다.',
									'사용 가능한 시간은 비워두지 말고 이동시간과 장소 체류시간을 포함해 약 80-95%를 쓰는 계획을 만든다.',
									'각 아이템에는 가능한 경우 dwellMinutes와 dwellTimeText로 그 장소에서 머무는 시간을 예측한다. 항공편은 비행시간을 dwellMinutes로 본다.',
									'각 후보의 operatingStatus, arrivalTimeText, availabilityText를 보고 도착 예정 시간에 운영 중일 가능성을 우선한다.',
									'operatingStatus가 closed_at_arrival인 후보는 다른 대안이 없을 때만 쓰고, 가능하면 open_at_arrival 후보를 먼저 선택한다.',
									'operatingStatus가 unknown이면 운영 확인 필요를 배지나 이유에 표시한다.',
									'availabilityText, mapUrl, 좌표, 도착 시간 운영 확인이 있는 후보를 더 실행 가능하다고 본다.',
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
									requestContext: {
										currentRequestText: sessionRequestText(input.session),
										companionSummary: companionRelationSummary(input.session),
										companionContext: companionContextText(input.session),
										companionGuide: companionRelationPromptGuide(input.session),
										companionStrategy: companionRelationStrategy(input.session),
										availableMinutes: availableSessionMinutes(input.session),
										flightIntent: hasFlightIntent(input.session)
									},
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

	return applyTimeUtilization(
		applySessionGuards(
			applyOperatingStatusGuards(
				applyTravelTimeGuards(
					cards.map((card, index) =>
						normalizeCard(card, input.fallbackCards[index], input.sessionId)
					),
					input.session
				)
			),
			input.session
		),
		input.session
	);
}

function scopeCardsToSession(cards: RecommendationCard[], sessionId: string) {
	return cards.map((card) => ({
		...card,
		id: card.id.startsWith(`${sessionId}:`) ? card.id : `${sessionId}:${card.id}`
	}));
}

function applyCandidateBundle(
	cards: RecommendationCard[],
	bundle: CandidateBundle,
	session: RecommendationSession
) {
	return cards.map((card, index) => {
		const activity = bundle.activities[index % Math.max(bundle.activities.length, 1)];
		const restaurant = bundle.restaurants[index % Math.max(bundle.restaurants.length, 1)];
		const mobility = bundle.mobility[index % Math.max(bundle.mobility.length, 1)];
		const flight = bundle.flights[index % Math.max(bundle.flights.length, 1)];
		const mappedItems = card.items.map((item) => {
			if (item.slot === 'activity' && activity) {
				return {
					...item,
					title: activity.title,
					price: activity.price ?? item.price,
					source: activity.source,
					sourceName: activity.sourceName ?? item.sourceName,
					outboundUrl: activity.outboundUrl ?? item.outboundUrl,
					reservationUrl: activity.reservationUrl ?? activity.outboundUrl ?? item.reservationUrl,
					mapUrl: activity.mapUrl ?? item.mapUrl,
					address: activity.address ?? item.address,
					lat: activity.lat ?? item.lat,
					lng: activity.lng ?? item.lng,
					availabilityText: activity.availabilityText ?? item.availabilityText,
					travelMinutes: activity.travelMinutes ?? item.travelMinutes,
					travelTimeText: activity.travelTimeText ?? item.travelTimeText,
					travelDistanceMeters: activity.travelDistanceMeters ?? item.travelDistanceMeters,
					routeMapUrl: activity.routeMapUrl ?? item.routeMapUrl,
					operatingStatus: activity.operatingStatus ?? item.operatingStatus,
					arrivalTimeText: activity.arrivalTimeText ?? item.arrivalTimeText,
					openingHoursText: activity.openingHoursText ?? item.openingHoursText,
					thumbnailUrl: activity.thumbnailUrl ?? item.thumbnailUrl
				};
			}

			if (item.slot === 'food' && restaurant) {
				return {
					...item,
					title: restaurant.title,
					price: restaurant.price ?? item.price,
					source: restaurant.source,
					sourceName: restaurant.sourceName ?? item.sourceName,
					outboundUrl: restaurant.outboundUrl ?? item.outboundUrl,
					reservationUrl:
						restaurant.reservationUrl ?? restaurant.outboundUrl ?? item.reservationUrl,
					mapUrl: restaurant.mapUrl ?? item.mapUrl,
					address: restaurant.address ?? item.address,
					lat: restaurant.lat ?? item.lat,
					lng: restaurant.lng ?? item.lng,
					availabilityText: restaurant.availabilityText ?? item.availabilityText,
					travelMinutes: restaurant.travelMinutes ?? item.travelMinutes,
					travelTimeText: restaurant.travelTimeText ?? item.travelTimeText,
					travelDistanceMeters: restaurant.travelDistanceMeters ?? item.travelDistanceMeters,
					routeMapUrl: restaurant.routeMapUrl ?? item.routeMapUrl,
					operatingStatus: restaurant.operatingStatus ?? item.operatingStatus,
					arrivalTimeText: restaurant.arrivalTimeText ?? item.arrivalTimeText,
					openingHoursText: restaurant.openingHoursText ?? item.openingHoursText,
					thumbnailUrl: restaurant.thumbnailUrl ?? item.thumbnailUrl
				};
			}

			return item;
		});
		const items = flight ? mergeFlightItem(mappedItems, flight) : mappedItems;
		const externalTags = [
			...(flight?.tags ?? []),
			...(activity?.tags ?? []),
			...(restaurant?.tags ?? [])
		].slice(0, 4);
		const trendTag = bundle.trendKeywords[index];
		const badges = [
			...new Set([
				...(flight ? ['항공편 포함', '이번 요청 우선'] : []),
				...card.badges,
				...externalTags,
				...(trendTag ? [trendTag] : [])
			])
		].slice(0, 8);
		const reservationUrl =
			flight?.reservationUrl ??
			flight?.outboundUrl ??
			items.find((item) => item.reservationUrl)?.reservationUrl ??
			card.reservationUrl;
		const routeMapUrl =
			flight?.outboundUrl ??
			(flight ? undefined : mobility?.routeMapUrl) ??
			items.find((item) => item.routeMapUrl)?.routeMapUrl ??
			items.find((item) => item.mapUrl)?.mapUrl ??
			card.routeMapUrl;
		const estimatedCost = flight?.price
			? Math.max(card.estimatedCost, flight.price)
			: card.estimatedCost;
		const people = partyCountForSession(session);

		return {
			...card,
			label: flight ? '항공 포함' : card.label,
			title: flight ? `${flightDestinationLabel(flight)} 항공편까지 보는 코스` : card.title,
			reason: flight
				? `${card.reason} 이번에 말한 장거리/해외 이동 의도를 온보딩 취향보다 우선해서 항공편을 포함했어.`
				: card.reason,
			estimatedCost,
			budgetText: flight?.price
				? `${flightDestinationLabel(flight)} 항공권 기준 ${formatKrw(flight.price)}부터 확인`
				: card.budgetText,
			perPersonText: `1인당 약 ${formatKrw(Math.ceil(estimatedCost / people / 1000) * 1000)}`,
			items,
			badges,
			weatherFit: bundle.weather.preferIndoor ? 'indoor' : card.weatherFit,
			routeSummary: flight ? flightRouteSummary(flight) : (mobility?.label ?? card.routeSummary),
			routeTransport: flight ? ('flight' as const) : (mobility?.mode ?? card.routeTransport),
			routeMapUrl,
			routeDetail: flight ? flightRouteDetail(flight) : (mobility?.detail ?? card.routeDetail),
			reservationUrl,
			outboundUrl: reservationUrl ?? routeMapUrl ?? card.outboundUrl
		};
	});
}

function mergeFlightItem(items: RecommendationItem[], flight: FlightCandidate) {
	const index = items.findIndex((item) => item.slot === 'flight');
	const flightItem = flightCandidateToItem(flight, index >= 0 ? items[index] : undefined);
	if (index >= 0) {
		return items.map((item, itemIndex) => (itemIndex === index ? flightItem : item));
	}
	return [flightItem, ...items];
}

function flightCandidateToItem(
	flight: FlightCandidate,
	fallback?: RecommendationItem
): RecommendationItem {
	return {
		slot: 'flight',
		title: flight.title,
		price: flight.price ?? fallback?.price ?? 0,
		source: flight.source,
		sourceName: flight.sourceName ?? '네이버항공',
		outboundUrl: flight.outboundUrl ?? fallback?.outboundUrl ?? 'https://flight.naver.com',
		reservationUrl: flight.reservationUrl ?? flight.outboundUrl ?? fallback?.reservationUrl,
		availabilityText: [
			flight.airlineText,
			flight.departureTimeText,
			flight.returnDate ? `${flight.returnDate} 복귀` : undefined,
			flight.tags.slice(0, 2).join(' · ')
		]
			.filter(Boolean)
			.join(' · '),
		arrivalTimeText: flight.arrivalTimeText,
		travelTimeText: flight.durationText,
		dwellMinutes: flight.durationMinutes,
		dwellTimeText: flight.durationText ?? fallback?.dwellTimeText,
		thumbnailUrl: fallback?.thumbnailUrl
	};
}

function flightDestinationLabel(flight: FlightCandidate) {
	const airports: Record<string, string> = {
		KIX: '오사카',
		FUK: '후쿠오카',
		NRT: '도쿄',
		HND: '도쿄',
		TPE: '타이베이',
		BKK: '방콕',
		SIN: '싱가포르',
		DAD: '다낭',
		HKG: '홍콩'
	};
	return airports[flight.arrivalAirport] ?? flight.arrivalAirport;
}

function flightRouteSummary(flight: FlightCandidate) {
	return [`${flight.departureAirport} → ${flight.arrivalAirport} 항공`, flight.durationText]
		.filter(Boolean)
		.join(' · ');
}

function flightRouteDetail(flight: FlightCandidate) {
	return [
		flight.departureTimeText,
		flight.arrivalTimeText,
		flight.durationText,
		flight.airlineText,
		flight.returnDate ? `${flight.returnDate} 복귀` : undefined
	]
		.filter(Boolean)
		.join(' · ');
}

function applyTravelTimeGuards(cards: RecommendationCard[], session: RecommendationSession) {
	const maxItemTravelMinutes = maxTravelMinutes(session);
	const sessionMinutes = availableMinutes(session);
	return cards.map((card) => {
		if (!card.items.length) return card;
		const itemsWithTravel = card.items.filter((item) => item.travelMinutes != null);
		if (!itemsWithTravel.length) return card;

		const nearbyItems = card.items.filter(
			(item) => item.travelMinutes == null || item.travelMinutes <= maxItemTravelMinutes
		);
		const removedFarCount = card.items.length - nearbyItems.length;
		const items = nearbyItems.length ? nearbyItems : [shortestTravelItem(card.items)];
		const totalTravelMinutes = Math.round(
			items.reduce((sum, item) => sum + (item.travelMinutes ?? 0), 0)
		);
		const travelTooHeavy =
			sessionMinutes != null &&
			totalTravelMinutes > Math.max(20, Math.floor(sessionMinutes * 0.45));
		const travelBadges = [
			totalTravelMinutes > 0 ? `이동 약 ${formatDuration(totalTravelMinutes)}` : '',
			removedFarCount > 0 ? '먼 이동 제외' : '',
			travelTooHeavy ? '이동시간 주의' : '근거리 우선'
		].filter(Boolean);
		const routeSummary = totalTravelMinutes
			? appendSummary(card.routeSummary, `이동 약 ${formatDuration(totalTravelMinutes)}`)
			: card.routeSummary;
		const routeDetail = totalTravelMinutes
			? appendSummary(
					card.routeDetail ?? card.routeSummary,
					travelDetailText(items, totalTravelMinutes)
				)
			: card.routeDetail;
		const reasonSuffix = removedFarCount
			? '사용 가능한 시간에 비해 이동이 긴 후보는 제외했어.'
			: totalTravelMinutes
				? '이동시간까지 같이 계산해서 가까운 후보를 우선했어.'
				: '';

		return {
			...card,
			items,
			reason: reasonSuffix ? `${card.reason} ${reasonSuffix}` : card.reason,
			routeSummary,
			routeDetail,
			badges: [...new Set([...travelBadges, ...card.badges])].slice(0, 8)
		};
	});
}

function shortestTravelItem(items: RecommendationItem[]) {
	return (
		[...items].sort(
			(a, b) =>
				(a.travelMinutes ?? Number.MAX_SAFE_INTEGER) - (b.travelMinutes ?? Number.MAX_SAFE_INTEGER)
		)[0] ?? items[0]
	);
}

function travelDetailText(items: RecommendationItem[], totalTravelMinutes: number) {
	const itemDetails = items
		.filter((item) => item.travelTimeText)
		.map((item) => `${item.title} ${item.travelTimeText}`)
		.slice(0, 2)
		.join(', ');
	return itemDetails || `이동시간 합계 약 ${formatDuration(totalTravelMinutes)}`;
}

function appendSummary(summary: string, addition: string) {
	if (summary.includes(addition)) return summary;
	return `${summary} · ${addition}`;
}

function applyOperatingStatusGuards(cards: RecommendationCard[]) {
	return cards.map((card) => {
		const openItems = card.items.filter((item) => item.operatingStatus === 'open_at_arrival');
		const nonClosedItems = card.items.filter(
			(item) => item.operatingStatus !== 'closed_at_arrival'
		);
		const removedClosedCount = card.items.length - nonClosedItems.length;
		const items = nonClosedItems.length ? nonClosedItems : card.items;
		const statusBadges = operatingStatusBadges(items, removedClosedCount);
		const hasOpenSignal = openItems.length > 0;
		const hasUnknownSignal = items.some((item) => item.operatingStatus === 'unknown');
		const reasonSuffix = hasOpenSignal
			? '도착 예정 시간에 운영 가능한 후보를 우선으로 봤어.'
			: hasUnknownSignal
				? '운영 시간이 확실하지 않은 곳은 확인 필요로 표시했어.'
				: removedClosedCount
					? '도착 예정 시간에 닫힐 가능성이 있는 후보는 제외했어.'
					: '';

		return {
			...card,
			items,
			reason: reasonSuffix ? `${card.reason} ${reasonSuffix}` : card.reason,
			badges: [...new Set([...statusBadges, ...card.badges])].slice(0, 8)
		};
	});
}

function operatingStatusBadges(items: RecommendationItem[], removedClosedCount: number) {
	const badges: string[] = [];
	if (items.some((item) => item.operatingStatus === 'open_at_arrival')) {
		badges.push('도착시간 운영 확인');
	}
	if (items.some((item) => item.operatingStatus === 'unknown')) {
		badges.push('운영시간 확인 필요');
	}
	if (removedClosedCount > 0) {
		badges.push('영업 종료 후보 제외');
	}
	return badges;
}

function applySessionGuards(cards: RecommendationCard[], session: RecommendationSession) {
	if (hasFlightIntent(session)) return cards;
	const singleActivityWindow = isSingleActivityWindow(session);
	const longActivityBlocked = blocksLongActivity(session);
	if (!singleActivityWindow && !longActivityBlocked) return cards;
	const budget = Math.max(session.budgetTotal ?? 50000, 10000);
	const people = partyCountForSession(session);

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

function maxTravelMinutes(session: RecommendationSession) {
	const explicitWindow = availableMinutes(session);
	if (explicitWindow) return Math.max(15, Math.min(75, Math.floor(explicitWindow * 0.35)));
	if (session.availableTime === 'one_hour') return 25;
	if (session.availableTime === 'two_three') return 45;
	if (session.availableTime === 'half_day') return 60;
	return 90;
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
		companionSummary: companionRelationSummary(history.session),
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
			sourceName: item.sourceName ?? fallback.sourceName,
			mapUrl: item.mapUrl ?? fallback.mapUrl,
			address: item.address ?? fallback.address,
			lat: item.lat ?? fallback.lat,
			lng: item.lng ?? fallback.lng,
			availabilityText: item.availabilityText ?? fallback.availabilityText,
			travelMinutes: item.travelMinutes ?? fallback.travelMinutes,
			travelTimeText: item.travelTimeText ?? fallback.travelTimeText,
			travelDistanceMeters: item.travelDistanceMeters ?? fallback.travelDistanceMeters,
			routeMapUrl: item.routeMapUrl ?? fallback.routeMapUrl,
			operatingStatus: item.operatingStatus ?? fallback.operatingStatus,
			arrivalTimeText: item.arrivalTimeText ?? fallback.arrivalTimeText,
			openingHoursText: item.openingHoursText ?? fallback.openingHoursText,
			thumbnailUrl: item.thumbnailUrl ?? fallback.thumbnailUrl,
			dwellMinutes: item.dwellMinutes ?? fallback.dwellMinutes,
			dwellTimeText: item.dwellTimeText ?? fallback.dwellTimeText
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
			slot: { type: 'string', enum: ['activity', 'food', 'move', 'flight', 'fallback'] },
			title: { type: 'string' },
			price: { type: 'integer', minimum: 0 },
			source: { type: 'string', enum: ['myrealtrip', 'api_fuse', 'genrank', 'sai'] },
			sourceName: { type: 'string' },
			outboundUrl: { type: 'string' },
			reservationUrl: { type: 'string' },
			mapUrl: { type: 'string' },
			address: { type: 'string' },
			lat: { type: 'number' },
			lng: { type: 'number' },
			availabilityText: { type: 'string' },
			travelMinutes: { type: 'integer', minimum: 0 },
			travelTimeText: { type: 'string' },
			travelDistanceMeters: { type: 'integer', minimum: 0 },
			routeMapUrl: { type: 'string' },
			operatingStatus: {
				type: 'string',
				enum: ['open_at_arrival', 'closed_at_arrival', 'unknown']
			},
			arrivalTimeText: { type: 'string' },
			openingHoursText: { type: 'string' },
			thumbnailUrl: { type: 'string' },
			dwellMinutes: { type: 'integer', minimum: 0 },
			dwellTimeText: { type: 'string' }
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
			outboundUrl: { type: 'string' },
			routeTransport: {
				type: 'string',
				enum: ['walk', 'transit', 'car', 'taxi', 'shared', 'flight']
			},
			routeMapUrl: { type: 'string' },
			routeDetail: { type: 'string' },
			reservationUrl: { type: 'string' },
			calendarUrl: { type: 'string' },
			timeUsageText: { type: 'string' }
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
