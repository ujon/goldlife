import { env } from '$env/dynamic/private';
import type { CandidateBundle, CandidateQueryPlan } from '$lib/sai/candidates';
import { situationLabel, timeMeta } from '$lib/sai/recommendations';
import type { RecommendationHistoryItem, RecommendationSession, UserProfile } from '$lib/sai/types';
import { loggedFetch } from './integration-logger';

type ChatPayload = {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
};

const LONG_ACTIVITY_EXCLUDED_KEYWORDS = [
	'글램핑',
	'캠핑장',
	'캠핑',
	'야영',
	'카라반',
	'숙박',
	'리조트',
	'당일치기',
	'등산',
	'트레킹'
];

export async function planCandidateQueries(
	profile: UserProfile,
	session: RecommendationSession,
	histories: RecommendationHistoryItem[],
	candidates: CandidateBundle
): Promise<CandidateQueryPlan> {
	const fallback = fallbackCandidateQueryPlan(profile, session);
	const exaone = await tryExaoneCandidatePlan(profile, session, histories, candidates, fallback);
	return exaone ?? fallback;
}

export function fallbackCandidateQueryPlan(
	profile: UserProfile,
	session: RecommendationSession
): CandidateQueryPlan {
	const location = session.location?.label ?? profile.recentLocation?.label ?? '서울';
	const singleActivityWindow = isSingleActivityWindow(session);
	const longActivityBlocked = blocksLongActivity(session);
	const preferenceText = onboardingPreferenceText(profile);
	const campingPreference = /캠핑|글램핑|야영|camp/i.test(preferenceText);
	const culturePreference = profile.activityPreferences.includes('culture');
	const baby = session.companionConstraints.hasBaby;
	const activityQueries = longActivityBlocked
		? compactActivityQueries(location, baby, culturePreference, campingPreference)
		: longerSessionActivityQueries(location, baby, culturePreference, campingPreference);
	const restaurantQueries = baby
		? [`${location} 키즈 프렌들리 카페`, `${location} 가족 식당`]
		: longActivityBlocked
			? [`${location} 카페`, `${location} 디저트`, `${location} 가벼운 식사`]
			: [`${location} 맛집`, `${location} 카페`, `${location} 캐주얼 다이닝`];
	const myrealtripKeywords = longActivityBlocked
		? [location.includes('서울') ? '서울 티켓' : '티켓', '전시']
		: campingPreference
			? [location.includes('서울') ? '서울 캠핑' : '캠핑', '체험']
			: [culturePreference ? '티켓' : '체험', '전시'];

	return {
		source: 'fallback',
		preferenceSummary: longActivityBlocked
			? '사용 가능 시간이 짧아 글램핑/캠핑장/숙박형 후보는 제외하고 근거리 카페, 전시, 짧은 체험만 조회한다.'
			: '온보딩 취향과 최근 히스토리를 반영해 활동, 맛집, 이동 후보를 조회한다.',
		activityQueries,
		restaurantQueries,
		myrealtripKeywords,
		excludedKeywords: longActivityBlocked ? LONG_ACTIVITY_EXCLUDED_KEYWORDS : [],
		operations: [
			...activityQueries.map((query) => ({
				provider: 'api_fuse' as const,
				operation: 'kakaomap.search/navermap.search',
				values: { query, radius: singleActivityWindow ? 2500 : longActivityBlocked ? 3500 : 5000 },
				purpose: '현재 위치 주변 활동 후보 검색'
			})),
			...restaurantQueries.slice(0, 2).map((keyword) => ({
				provider: 'api_fuse' as const,
				operation: 'catchtable.search',
				values: { keyword, sort: 'recommended' },
				purpose: '예약 또는 상세 확인 가능한 식당 후보 검색'
			})),
			...myrealtripKeywords.slice(0, 2).map((keyword) => ({
				provider: 'myrealtrip' as const,
				operation: 'tna.search',
				values: { keyword },
				purpose: '예약 링크가 있는 액티비티 후보 검색'
			}))
		]
	};
}

async function tryExaoneCandidatePlan(
	profile: UserProfile,
	session: RecommendationSession,
	histories: RecommendationHistoryItem[],
	candidates: CandidateBundle,
	fallback: CandidateQueryPlan
): Promise<CandidateQueryPlan | null> {
	if (!env.EXAONE_API_KEY || !env.EXAONE_BASE_URL) return null;
	const model = env.EXAONE_MODEL || 'LGAI-EXAONE/K-EXAONE-236B-A23B';

	try {
		const response = await loggedFetch({
			provider: 'exaone',
			kind: 'ai',
			operation: 'candidate_queries.plan',
			url: `${env.EXAONE_BASE_URL.replace(/\/$/, '')}/chat/completions`,
			init: {
				method: 'POST',
				headers: {
					authorization: `Bearer ${env.EXAONE_API_KEY}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					model,
					messages: [
						{
							role: 'system',
							content: [
								'JSON만 출력한다. 설명, 마크다운, 사고 과정은 절대 출력하지 않는다.',
								'너는 사이(SAI)의 API 조회 계획 담당자다.',
								'현재 세션의 시간, 예산, 위치, 동행, 방금 수집한 API 후보, DB 추천 히스토리를 함께 보고 어떤 API에 어떤 값을 조회할지 JSON으로만 답한다.',
								'시간 제약은 hard constraint다. 1-3시간 또는 240분 이하 세션이면 글램핑, 캠핑장, 캠핑, 야영, 카라반, 숙박, 당일치기, 등산, 트레킹 같은 긴 활동은 조회값과 표시 후보에서 제외한다.',
								'취향 신호는 조회어에 반영하되 시간 제약을 어기지 않는다. 예를 들어 캠핑 취향 + 2시간이면 글램핑이 아니라 근거리 바비큐 카페, 전시, 짧은 체험 쪽으로 바꾼다.',
								'activityQueries는 카카오맵/네이버맵 장소 검색어, restaurantQueries는 캐치테이블/요기요 검색어, myrealtripKeywords는 마이리얼트립 검색어다.',
								'operations에는 실제 호출할 provider, operation, values, purpose를 적는다.',
								'반드시 JSON object만 출력한다.'
							].join('\n')
						},
						{
							role: 'user',
							content: JSON.stringify({
								profile: summarizeProfile(profile),
								session: summarizeSession(session),
								histories: summarizeHistories(histories),
								freshCandidates: summarizeCandidates(candidates),
								fallback
							})
						}
					],
					response_format: { type: 'json_object' },
					chat_template_kwargs: { enable_thinking: false },
					parse_reasoning: true,
					include_reasoning: false,
					temperature: 0,
					max_tokens: 1000
				}),
				signal: AbortSignal.timeout(12000)
			}
		});
		if (!response.ok) throw new Error(`EXAONE ${response.status}`);

		const payload = (await response.json()) as ChatPayload;
		const text = payload.choices?.[0]?.message?.content ?? '';
		return normalizeCandidatePlan(text ? parseJsonObject(text) : null, fallback, session);
	} catch {
		return null;
	}
}

function parseJsonObject(text: string) {
	try {
		return JSON.parse(text);
	} catch {
		const match = text.match(/\{[\s\S]*\}/);
		if (!match) throw new Error('EXAONE candidate plan did not include JSON object');
		return JSON.parse(match[0]);
	}
}

function normalizeCandidatePlan(
	value: unknown,
	fallback: CandidateQueryPlan,
	session: RecommendationSession
): CandidateQueryPlan {
	if (!value || typeof value !== 'object') return fallback;
	const source = value as Partial<CandidateQueryPlan>;
	const longActivityBlocked = blocksLongActivity(session);
	const excludedKeywords = uniqueStrings([
		...(source.excludedKeywords ?? []),
		...(longActivityBlocked ? LONG_ACTIVITY_EXCLUDED_KEYWORDS : [])
	]);
	const activityQueries = sanitizeQueries(source.activityQueries, fallback.activityQueries, {
		excludedKeywords,
		max: 4
	});
	const restaurantQueries = sanitizeQueries(source.restaurantQueries, fallback.restaurantQueries, {
		excludedKeywords,
		max: 3
	});
	const myrealtripKeywords = sanitizeQueries(
		source.myrealtripKeywords,
		fallback.myrealtripKeywords,
		{
			excludedKeywords,
			max: 3
		}
	);
	const operations = Array.isArray(source.operations)
		? source.operations
				.filter((operation) => {
					if (!operation || typeof operation !== 'object') return false;
					const candidate = operation as CandidateQueryPlan['operations'][number];
					return (
						typeof candidate.provider === 'string' &&
						typeof candidate.operation === 'string' &&
						typeof candidate.values === 'object' &&
						typeof candidate.purpose === 'string' &&
						!containsExcludedKeyword(JSON.stringify(candidate.values), excludedKeywords)
					);
				})
				.slice(0, 8)
		: fallback.operations;

	return {
		source: 'exaone',
		preferenceSummary:
			typeof source.preferenceSummary === 'string' && source.preferenceSummary.trim()
				? source.preferenceSummary.trim()
				: fallback.preferenceSummary,
		activityQueries: activityQueries.length ? activityQueries : fallback.activityQueries,
		restaurantQueries: restaurantQueries.length ? restaurantQueries : fallback.restaurantQueries,
		myrealtripKeywords: myrealtripKeywords.length
			? myrealtripKeywords
			: fallback.myrealtripKeywords,
		excludedKeywords,
		operations: operations.length ? operations : fallback.operations
	};
}

function sanitizeQueries(
	value: unknown,
	fallback: string[],
	options: { excludedKeywords: string[]; max: number }
) {
	const source = Array.isArray(value) ? value : fallback;
	return uniqueStrings(source)
		.filter((query) => !containsExcludedKeyword(query, options.excludedKeywords))
		.slice(0, options.max);
}

function uniqueStrings(values: unknown[]) {
	return [
		...new Set(
			values
				.filter((value): value is string => typeof value === 'string')
				.map((value) => value.trim())
				.filter(Boolean)
		)
	];
}

function containsExcludedKeyword(value: string, excludedKeywords: string[]) {
	const normalized = value.replace(/\s/g, '').toLowerCase();
	return excludedKeywords.some((keyword) =>
		normalized.includes(keyword.replace(/\s/g, '').toLowerCase())
	);
}

function compactActivityQueries(
	location: string,
	baby: boolean,
	culturePreference: boolean,
	campingPreference: boolean
) {
	if (baby) return [`${location} 키즈카페`, `${location} 실내놀이터`, `${location} 유모차 카페`];
	if (campingPreference)
		return [`${location} 바비큐 카페`, `${location} 루프탑 카페`, `${location} 전시`];
	if (culturePreference) return [`${location} 전시`, `${location} 팝업`, `${location} 북카페`];
	return [`${location} 카페`, `${location} 전시`, `${location} 원데이클래스`];
}

function longerSessionActivityQueries(
	location: string,
	baby: boolean,
	culturePreference: boolean,
	campingPreference: boolean
) {
	if (baby) return [`${location} 키즈카페`, `${location} 실내놀이터`, `${location} 유모차 실내`];
	if (campingPreference)
		return [`${location} 캠핑`, `${location} 글램핑`, `${location} 야외 바비큐`];
	if (culturePreference) return [`${location} 전시`, `${location} 팝업`, `${location} 공연`];
	return [`${location} 원데이클래스`, `${location} 체험`, `${location} 산책`];
}

function onboardingPreferenceText(profile: UserProfile) {
	return (profile.onboardingFreeformAnswers ?? []).map((answer) => answer.answer).join(' ');
}

function isSingleActivityWindow(session: RecommendationSession) {
	if (session.availableTime === 'one_hour') return true;
	const start = parseDate(session.startDateTime);
	const end = parseDate(session.endDateTime);
	if (!start || !end || end.getTime() <= start.getTime()) return false;
	return end.getTime() - start.getTime() <= 90 * 60 * 1000;
}

function blocksLongActivity(session: RecommendationSession) {
	if (session.availableTime && !['day', 'weekend'].includes(session.availableTime)) return true;
	const start = parseDate(session.startDateTime);
	const end = parseDate(session.endDateTime);
	if (!start || !end || end.getTime() <= start.getTime()) return false;
	return end.getTime() - start.getTime() <= 300 * 60 * 1000;
}

function parseDate(value?: string) {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function summarizeProfile(profile: UserProfile) {
	return {
		activityPreferences: profile.activityPreferences,
		noveltyPreference: profile.noveltyPreference,
		spendingStyle: profile.spendingStyle,
		riskTolerance: profile.riskTolerance,
		mobilityPreference: profile.mobilityPreference,
		mbtiType: profile.mbtiType,
		onboardingFreeformAnswers: profile.onboardingFreeformAnswers
	};
}

function summarizeSession(session: RecommendationSession) {
	return {
		situation: session.situation,
		situationLabel: situationLabel(session.situation),
		availableTime: session.availableTime,
		timeLabel: timeMeta(session.availableTime).label,
		startDateTime: session.startDateTime,
		endDateTime: session.endDateTime,
		budgetTotal: session.budgetTotal,
		location: session.location,
		weatherSnapshot: session.weatherSnapshot,
		dynamicAnswers: session.dynamicAnswers,
		companionConstraints: session.companionConstraints
	};
}

function summarizeHistories(histories: RecommendationHistoryItem[]) {
	return histories.slice(0, 8).map((history) => ({
		session: {
			situation: history.session.situation,
			availableTime: history.session.availableTime,
			budgetTotal: history.session.budgetTotal,
			location: history.session.location?.label
		},
		cards: history.cards.map((card) => ({
			title: card.title,
			reason: card.reason,
			resultType: card.resultType,
			badges: card.badges,
			items: card.items.map((item) => item.title)
		})),
		clickedCardIds: history.clickedCardIds,
		feedback: history.feedback
	}));
}

function summarizeCandidates(candidates: CandidateBundle) {
	return {
		weather: candidates.weather,
		trendKeywords: candidates.trendKeywords,
		statuses: candidates.statuses,
		activities: candidates.activities.slice(0, 8).map((candidate) => ({
			title: candidate.title,
			price: candidate.price,
			source: candidate.source,
			address: candidate.address,
			tags: candidate.tags,
			availabilityText: candidate.availabilityText
		})),
		restaurants: candidates.restaurants.slice(0, 8).map((candidate) => ({
			title: candidate.title,
			price: candidate.price,
			source: candidate.source,
			address: candidate.address,
			tags: candidate.tags,
			availabilityText: candidate.availabilityText
		})),
		mobility: candidates.mobility
	};
}
