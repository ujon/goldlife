import type {
	CompanionConstraints,
	FollowupQuestion,
	LocationValue,
	RecommendationCard,
	RecommendationSession,
	Situation,
	UserProfile,
	WeatherSnapshot
} from './types';

export const situationOptions: Array<{
	id: Situation;
	icon: string;
	label: string;
	people: number;
	accent: string;
}> = [
	{ id: 'solo', icon: '나', label: '혼자', people: 1, accent: 'solo' },
	{ id: 'friend', icon: '둘', label: '친구', people: 2, accent: 'friend' },
	{ id: 'couple', icon: '커', label: '커플', people: 2, accent: 'couple' },
	{ id: 'family', icon: '집', label: '가족', people: 3, accent: 'family' },
	{ id: 'group', icon: '팀', label: '동료/모임', people: 4, accent: 'group' }
];

export const timeOptions = [
	{ id: 'one_hour', label: '1시간', duration: '1시간', type: 'single_activity' },
	{ id: 'two_three', label: '2-3시간', duration: '2시간 30분', type: 'mini_course' },
	{ id: 'half_day', label: '반나절', duration: '4시간', type: 'course' },
	{ id: 'day', label: '하루', duration: '7시간', type: 'timetable' },
	{ id: 'weekend', label: '이번 주말', duration: '주말 반나절', type: 'timetable' },
	{ id: 'custom', label: '직접 입력', duration: '맞춤 시간', type: 'course' }
] as const;

export const budgetOptions = [
	{ id: '10000', label: '1만원', value: 10000 },
	{ id: '30000', label: '3만원', value: 30000 },
	{ id: '50000', label: '5만원', value: 50000 },
	{ id: '100000', label: '10만원', value: 100000 },
	{ id: '150000', label: '15만원+', value: 150000 },
	{ id: 'custom', label: '직접 입력', value: 0 }
] as const;

export const babyFacilityOptions = [
	{ id: 'strollerRequired', label: '유모차 이동' },
	{ id: 'needsNursingRoom', label: '수유실' },
	{ id: 'needsDiaperChangingRoom', label: '기저귀 교체' },
	{ id: 'preferParking', label: '주차' }
] as const;

export const likeReasons = [
	'딱 내 취향',
	'예산이 좋아',
	'가까워',
	'새로워 보여',
	'아기랑 가기 편해 보여'
];
export const dislikeReasons = [
	'비싸요',
	'멀어요',
	'시간이 안 맞아요',
	'취향이 아니에요',
	'예약이 어려워요',
	'아기 편의시설이 부족해요'
];

export function createEmptyCompanionConstraints(): CompanionConstraints {
	return {
		hasBaby: false,
		strollerRequired: false,
		babyCarrierOk: false,
		needsNursingRoom: false,
		needsDiaperChangingRoom: false,
		preferParking: false
	};
}

export function createWeatherSnapshot(): WeatherSnapshot {
	const hour = new Date().getHours();
	const condition = hour >= 18 || hour <= 5 ? 'rain' : 'cloudy';

	if (condition === 'rain') {
		return {
			condition,
			label: '소나기 가능',
			temperature: 21,
			preferIndoor: true,
			avoidLongWalk: true
		};
	}

	return {
		condition,
		label: '구름 많음',
		temperature: 24,
		preferIndoor: false,
		avoidLongWalk: false
	};
}

export function createRecommendationSession(location?: LocationValue): RecommendationSession {
	return {
		id: `session_${Date.now()}`,
		location,
		weatherSnapshot: createWeatherSnapshot(),
		dynamicQuestions: [],
		dynamicAnswers: {},
		companionConstraints: createEmptyCompanionConstraints(),
		createdAt: new Date().toISOString()
	};
}

export function partyCount(situation?: Situation) {
	return situationOptions.find((option) => option.id === situation)?.people ?? 1;
}

export function situationLabel(situation?: Situation) {
	return situationOptions.find((option) => option.id === situation)?.label ?? '혼자';
}

export function formatKrw(value: number) {
	return `${new Intl.NumberFormat('ko-KR').format(value)}원`;
}

export function timeMeta(availableTime?: string) {
	return timeOptions.find((option) => option.id === availableTime) ?? timeOptions[2];
}

export function buildFollowupQuestions(
	session: RecommendationSession,
	profile: UserProfile
): FollowupQuestion[] {
	const questions: FollowupQuestion[] = [];
	const weather = session.weatherSnapshot;

	if (session.companionConstraints.hasBaby) {
		questions.push({
			id: 'baby_mobility',
			prompt: '아기랑이면 이동 부담을 먼저 줄일게. 어느 쪽이 편해?',
			options: [
				{ id: 'short', label: '20분 안쪽', value: 'short_mobility' },
				{ id: 'relaxed', label: '30-40분도 괜찮아', value: 'relaxed_mobility' }
			]
		});

		if (!session.companionConstraints.babyCarrierOk) {
			questions.push({
				id: 'baby_style',
				prompt: '등산 느낌은 살리되 낮은 코스로 볼까, 완전 실내 자연 코스로 볼까?',
				options: [
					{ id: 'nature_walk', label: '완만한 자연 산책', value: 'baby_friendly_nature_walk' },
					{ id: 'indoor_nature', label: '실내 자연 감성', value: 'indoor_nature' }
				]
			});
		}
	} else if (weather.preferIndoor) {
		questions.push({
			id: 'weather_mode',
			prompt: '오늘 날씨가 애매해. 실내 중심으로 볼까, 짧은 야외도 괜찮아?',
			options: [
				{ id: 'indoor', label: '실내 중심', value: 'prefer_indoor' },
				{ id: 'mixed', label: '짧은 야외도 OK', value: 'mixed_weather' }
			]
		});
	}

	const situation = session.situation ?? 'solo';
	const situationQuestion: Record<Situation, FollowupQuestion> = {
		solo: {
			id: 'solo_mood',
			prompt: '혼자라면 조용히 쉬는 쪽이 좋아, 기분 전환으로 뭔가 보는 게 좋아?',
			options: [
				{ id: 'quiet', label: '조용히 쉬기', value: 'quiet_reset' },
				{ id: 'see', label: '뭔가 보기', value: 'light_culture' }
			]
		},
		friend: {
			id: 'friend_style',
			prompt: '친구랑이면 수다 위주가 좋아, 같이 뭔가 하는 게 좋아?',
			options: [
				{ id: 'talk', label: '수다 위주', value: 'talk_focused' },
				{ id: 'activity', label: '같이 활동', value: 'shared_activity' }
			]
		},
		couple: {
			id: 'couple_vibe',
			prompt: '커플 코스는 분위기 쪽이 좋아, 새 경험 쪽이 좋아?',
			options: [
				{ id: 'vibe', label: '분위기 좋게', value: 'romantic_vibe' },
				{ id: 'novel', label: '새 경험', value: 'novel_activity' }
			]
		},
		family: {
			id: 'family_pace',
			prompt: '가족끼리는 편안한 동선이 좋아, 가벼운 체험도 괜찮아?',
			options: [
				{ id: 'easy', label: '편안한 동선', value: 'easy_route' },
				{ id: 'experience', label: '가벼운 체험', value: 'family_experience' }
			]
		},
		group: {
			id: 'group_mode',
			prompt: '모임이면 모두 무난한 쪽이 좋아, 확실히 재밌는 쪽이 좋아?',
			options: [
				{ id: 'safe', label: '모두 무난', value: 'safe_for_group' },
				{ id: 'fun', label: '확실한 재미', value: 'high_energy' }
			]
		}
	};

	questions.push(situationQuestion[situation]);

	if (profile.spendingStyle === 'value' && questions.length < 2) {
		questions.push({
			id: 'spending_guard',
			prompt: '예산은 아끼는 게 중요해, 아니면 한 곳에 몰아서 써도 돼?',
			options: [
				{ id: 'save', label: '아끼기', value: 'save_budget' },
				{ id: 'focus', label: '한 곳 집중', value: 'spend_on_main' }
			]
		});
	}

	return questions.slice(0, 2);
}

export function composeRecommendations(
	profile: UserProfile,
	session: RecommendationSession
): RecommendationCard[] {
	const budget = Math.max(session.budgetTotal ?? 50000, 10000);
	const people = partyCount(session.situation);
	const baby = session.companionConstraints.hasBaby;
	const meta = timeMeta(session.availableTime);
	const resultType = meta.type;
	const location = session.location?.label ?? profile.recentLocation?.label ?? '현재 위치';
	const answerValues = Object.values(session.dynamicAnswers);
	const wantsIndoor =
		session.weatherSnapshot.preferIndoor ||
		answerValues.includes('prefer_indoor') ||
		answerValues.includes('indoor_nature');
	const wantsActivity =
		answerValues.includes('shared_activity') || answerValues.includes('high_energy');
	const wantsQuiet = answerValues.includes('quiet_reset') || answerValues.includes('talk_focused');

	if (baby) {
		return babyRecommendations(session, budget, people, location, resultType, wantsIndoor);
	}

	switch (session.situation) {
		case 'friend':
			return friendRecommendations(
				session,
				budget,
				people,
				location,
				resultType,
				wantsActivity,
				wantsQuiet
			);
		case 'couple':
			return coupleRecommendations(session, budget, people, location, resultType, wantsIndoor);
		case 'family':
			return familyRecommendations(session, budget, people, location, resultType, wantsIndoor);
		case 'group':
			return groupRecommendations(session, budget, people, location, resultType, wantsActivity);
		case 'solo':
		default:
			return soloRecommendations(session, budget, people, location, resultType, wantsIndoor);
	}
}

function costWithinBudget(budget: number, ratio: number, floor = 9000) {
	return Math.min(budget, Math.max(floor, Math.round((budget * ratio) / 1000) * 1000));
}

function budgetText(budget: number, cost: number) {
	const diff = budget - cost;
	if (diff > 0) return `예산보다 ${formatKrw(diff)} 여유 있어`;
	if (diff === 0) return '예산에 딱 맞아';
	return `예산보다 ${formatKrw(Math.abs(diff))} 높아`;
}

function perPersonText(cost: number, people: number) {
	return `1인당 약 ${formatKrw(Math.ceil(cost / people / 1000) * 1000)}`;
}

function companionFitForBaby(session: RecommendationSession) {
	const constraints = session.companionConstraints;
	const fit = ['아기 동반 우선 필터 적용'];
	if (constraints.strollerRequired) fit.push('유모차 이동 OK');
	if (constraints.needsNursingRoom) fit.push('수유실 확인');
	if (constraints.needsDiaperChangingRoom) fit.push('기저귀 교체 공간 확인');
	if (constraints.preferParking) fit.push('주차 우선');
	if (constraints.babyCarrierOk) fit.push('아기띠 보조 가능');
	return fit;
}

function card(params: {
	id: string;
	label: string;
	title: string;
	reason: string;
	resultType: RecommendationCard['resultType'];
	duration: string;
	cost: number;
	budget: number;
	people: number;
	weatherFit: RecommendationCard['weatherFit'];
	routeSummary: string;
	companionFit?: string[];
	badges: string[];
	items: RecommendationCard['items'];
	outboundUrl?: string;
}): RecommendationCard {
	return {
		id: params.id,
		label: params.label,
		title: params.title,
		reason: params.reason,
		resultType: params.resultType,
		estimatedDuration: params.duration,
		estimatedCost: params.cost,
		budgetText: budgetText(params.budget, params.cost),
		perPersonText: perPersonText(params.cost, params.people),
		weatherFit: params.weatherFit,
		routeSummary: params.routeSummary,
		companionFit: params.companionFit ?? [],
		badges: params.badges,
		items: params.items,
		outboundUrl: params.outboundUrl ?? params.items[0]?.outboundUrl ?? 'https://map.kakao.com'
	};
}

function babyRecommendations(
	session: RecommendationSession,
	budget: number,
	people: number,
	location: string,
	resultType: RecommendationCard['resultType'],
	wantsIndoor: boolean
): RecommendationCard[] {
	const firstCost = costWithinBudget(budget, wantsIndoor ? 0.72 : 0.62, 22000);
	const secondCost = costWithinBudget(budget, 0.54, 18000);
	const thirdCost = costWithinBudget(budget, 0.38, 12000);
	const companionFit = companionFitForBaby(session);
	const duration = timeMeta(session.availableTime).duration;

	return [
		card({
			id: 'baby-indoor',
			label: wantsIndoor ? '비 와도 OK 실내픽' : '아기랑 편한 실내픽',
			title: '유모차 가능한 실내 체험 + 넓은 카페',
			reason:
				'아기 동반이라 취향보다 이동 부담과 편의시설을 먼저 봤어. 수유실, 기저귀 교체, 주차를 확인하기 쉬운 실내 코스로 묶었어.',
			resultType,
			duration,
			cost: firstCost,
			budget,
			people,
			weatherFit: 'indoor',
			routeSummary: `${location} 기준 차로 15분 안쪽 + 실내 이동 중심`,
			companionFit,
			badges: ['유모차 OK', '수유실', '기저귀 교체', '주차'],
			items: [
				{
					slot: 'activity',
					title: '영유아 동반 실내 체험관',
					price: Math.round(firstCost * 0.55),
					source: 'api_fuse',
					outboundUrl: 'https://map.kakao.com'
				},
				{
					slot: 'food',
					title: '넓은 좌석 키즈 프렌들리 카페',
					price: Math.round(firstCost * 0.45),
					source: 'api_fuse',
					outboundUrl: 'https://app.catchtable.co.kr'
				}
			]
		}),
		card({
			id: 'baby-nature',
			label: wantsIndoor ? '자연 감성 실내픽' : '아기랑 숲냄새 픽',
			title: wantsIndoor ? '실내 식물원 + 짧은 브런치' : '완만한 숲길 산책 + 브런치 카페',
			reason:
				'등산이나 자연 취향은 살리되 급경사와 긴 동선은 뺐어. 아기 인프라가 불확실한 코스는 낮게 보고, 쉬었다 갈 수 있는 지점을 먼저 골랐어.',
			resultType,
			duration,
			cost: secondCost,
			budget,
			people,
			weatherFit: wantsIndoor ? 'indoor' : 'mostly_indoor',
			routeSummary: `${location} 기준 이동 20-30분, 도보 구간 짧게`,
			companionFit,
			badges: ['완만한 동선', '화장실 근접', '짧은 체류', '자연 감성'],
			items: [
				{
					slot: 'activity',
					title: wantsIndoor ? '실내 식물원 산책' : '유모차 가능한 완만한 산책로',
					price: Math.round(secondCost * 0.42),
					source: 'api_fuse',
					outboundUrl: 'https://map.kakao.com'
				},
				{
					slot: 'food',
					title: '주차 쉬운 브런치 카페',
					price: Math.round(secondCost * 0.58),
					source: 'api_fuse',
					outboundUrl: 'https://app.catchtable.co.kr'
				}
			]
		}),
		card({
			id: 'baby-short',
			label: '짧고 편한 가성비픽',
			title: '몰 안에서 식사 + 휴식 코스',
			reason:
				'시간이 짧거나 날씨가 불안할 때 실패 확률이 낮아. 한 건물 안에서 먹고 쉬면서 아기 편의시설을 바로 확인할 수 있어.',
			resultType: 'mini_course',
			duration: session.availableTime === 'one_hour' ? '1시간' : '2시간',
			cost: thirdCost,
			budget,
			people,
			weatherFit: 'indoor',
			routeSummary: `${location} 기준 한 장소 안에서 이동 최소화`,
			companionFit,
			badges: ['동선 짧음', '예산 여유', '실내', '정보 확인 쉬움'],
			items: [
				{
					slot: 'food',
					title: '수유실 가까운 몰 식당가',
					price: thirdCost,
					source: 'api_fuse',
					outboundUrl: 'https://map.kakao.com'
				}
			]
		})
	];
}

function friendRecommendations(
	session: RecommendationSession,
	budget: number,
	people: number,
	location: string,
	resultType: RecommendationCard['resultType'],
	wantsActivity: boolean,
	wantsQuiet: boolean
): RecommendationCard[] {
	const duration = timeMeta(session.availableTime).duration;
	const firstCost = costWithinBudget(budget, wantsActivity ? 0.92 : 0.72, 24000);
	const secondCost = costWithinBudget(budget, wantsQuiet ? 0.56 : 0.68, 18000);
	const thirdCost = costWithinBudget(budget, 0.82, 26000);

	return [
		card({
			id: 'friend-activity',
			label: wantsActivity ? '같이 하는 활동픽' : '실내 원데이픽',
			title: '원데이 클래스 + 캐주얼 다이닝',
			reason:
				'친구랑 같이 할 말이 생기는 코스야. 비가 와도 실내 중심이고, 식사까지 합쳐도 총 예산 안에서 비교하기 쉬워.',
			resultType,
			duration,
			cost: firstCost,
			budget,
			people,
			weatherFit: 'indoor',
			routeSummary: `${location} 기준 대중교통 1-2정거장 + 도보 8분`,
			badges: ['실내', '예약 가능 후보', '같이 하는 활동'],
			items: [
				{
					slot: 'activity',
					title: '도자기 또는 향수 원데이 클래스',
					price: Math.round(firstCost * 0.62),
					source: 'myrealtrip',
					outboundUrl: 'https://www.myrealtrip.com/offers/example'
				},
				{
					slot: 'food',
					title: '캐주얼 파스타 다이닝',
					price: Math.round(firstCost * 0.38),
					source: 'api_fuse',
					outboundUrl: 'https://app.catchtable.co.kr'
				}
			]
		}),
		card({
			id: 'friend-talk',
			label: wantsQuiet ? '수다 몰빵픽' : '가볍게 오래픽',
			title: '디저트 카페 + 짧은 전시',
			reason:
				'오래 이야기하기 좋고 이동이 짧아. 비용도 낮게 잡아서 다음 선택지를 열어둘 수 있는 조합이야.',
			resultType: 'mini_course',
			duration: '3시간',
			cost: secondCost,
			budget,
			people,
			weatherFit: 'mostly_indoor',
			routeSummary: `${location} 기준 도보 12분 안쪽`,
			badges: ['예산 여유', '수다', '짧은 이동'],
			items: [
				{
					slot: 'food',
					title: '조용한 디저트 카페',
					price: Math.round(secondCost * 0.42),
					source: 'api_fuse',
					outboundUrl: 'https://map.kakao.com'
				},
				{
					slot: 'activity',
					title: '소규모 팝업 전시',
					price: Math.round(secondCost * 0.58),
					source: 'genrank',
					outboundUrl: 'https://www.genrank.com'
				}
			]
		}),
		card({
			id: 'friend-novel',
			label: '새 경험 살짝 도전픽',
			title: '방탈출 + 간단한 저녁',
			reason:
				'조금 더 활동적인 선택이지만 반나절 안에 끝나고, 친구끼리 만족도가 높은 편이야. 날씨 영향을 거의 받지 않아.',
			resultType,
			duration,
			cost: thirdCost,
			budget,
			people,
			weatherFit: 'indoor',
			routeSummary: `${location} 기준 도보 9분 + 식당 이동 6분`,
			badges: ['실내', '팀플레이', '날씨 무관'],
			items: [
				{
					slot: 'activity',
					title: '난이도 중간 방탈출',
					price: Math.round(thirdCost * 0.58),
					source: 'api_fuse',
					outboundUrl: 'https://map.kakao.com'
				},
				{
					slot: 'food',
					title: '가볍게 먹는 분식/덮밥',
					price: Math.round(thirdCost * 0.42),
					source: 'api_fuse',
					outboundUrl: 'https://app.catchtable.co.kr'
				}
			]
		})
	];
}

function soloRecommendations(
	session: RecommendationSession,
	budget: number,
	people: number,
	location: string,
	resultType: RecommendationCard['resultType'],
	wantsIndoor: boolean
): RecommendationCard[] {
	const firstCost = costWithinBudget(budget, 0.52, 8000);
	const secondCost = costWithinBudget(budget, 0.72, 12000);
	const thirdCost = costWithinBudget(budget, 0.38, 7000);

	return [
		card({
			id: 'solo-reset',
			label: '2시간 기분전환픽',
			title: '조용한 카페 + 독립서점',
			reason:
				'혼자 시간을 크게 쓰지 않고도 리듬을 바꾸기 좋아. 이동을 짧게 잡고, 예산도 낮게 남겨뒀어.',
			resultType: session.availableTime === 'one_hour' ? 'single_activity' : resultType,
			duration: session.availableTime === 'one_hour' ? '1시간' : '2시간',
			cost: firstCost,
			budget,
			people,
			weatherFit: 'mostly_indoor',
			routeSummary: `${location} 기준 도보 10분 안쪽`,
			badges: ['혼자 OK', '조용함', '가성비'],
			items: [
				{
					slot: 'activity',
					title: '독립서점 둘러보기',
					price: Math.round(firstCost * 0.3),
					source: 'genrank',
					outboundUrl: 'https://www.genrank.com'
				},
				{
					slot: 'food',
					title: '작은 카페 한 잔',
					price: Math.round(firstCost * 0.7),
					source: 'api_fuse',
					outboundUrl: 'https://map.kakao.com'
				}
			]
		}),
		card({
			id: 'solo-culture',
			label: wantsIndoor ? '비 피해 문화픽' : '가벼운 문화픽',
			title: '짧은 전시 + 산책 가능한 거리',
			reason:
				'혼자 보기 좋은 밀도 있는 활동이야. 날씨가 나쁘면 전시 위주로, 괜찮으면 주변 산책까지 이어갈 수 있어.',
			resultType,
			duration: '2시간 30분',
			cost: secondCost,
			budget,
			people,
			weatherFit: wantsIndoor ? 'indoor' : 'any',
			routeSummary: `${location} 기준 대중교통 15분 안쪽`,
			badges: ['혼놀', '전시', '짧은 코스'],
			items: [
				{
					slot: 'activity',
					title: '소규모 전시 또는 팝업',
					price: secondCost,
					source: 'myrealtrip',
					outboundUrl: 'https://www.myrealtrip.com/offers/example'
				}
			]
		}),
		card({
			id: 'solo-home',
			label: '이동 싫을 때 fallback',
			title: '집 근처 포장 + 온라인 클래스',
			reason:
				'시간이 짧거나 이동이 귀찮을 때 안전한 대안이야. 오프라인 후보가 부족해도 바로 실행할 수 있어.',
			resultType: 'single_activity',
			duration: '1시간 30분',
			cost: thirdCost,
			budget,
			people,
			weatherFit: 'indoor',
			routeSummary: `${location} 기준 집 근처 또는 온라인`,
			badges: ['집/온라인', '저예산', '즉시 가능'],
			items: [
				{
					slot: 'fallback',
					title: '온라인 클래스 맛보기',
					price: thirdCost,
					source: 'sai',
					outboundUrl: 'https://www.myrealtrip.com'
				}
			]
		})
	];
}

function coupleRecommendations(
	session: RecommendationSession,
	budget: number,
	people: number,
	location: string,
	resultType: RecommendationCard['resultType'],
	wantsIndoor: boolean
): RecommendationCard[] {
	const duration = timeMeta(session.availableTime).duration;
	const firstCost = costWithinBudget(budget, 0.86, 30000);
	const secondCost = costWithinBudget(budget, 0.66, 24000);
	const thirdCost = costWithinBudget(budget, 0.95, 36000);

	return [
		card({
			id: 'couple-vibe',
			label: '분위기 안정픽',
			title: '전시 + 예약 가능한 다이닝',
			reason:
				'대화가 이어지기 좋고 실패 확률이 낮아. 예약 링크가 있는 식사 후보를 붙여 바로 움직일 수 있게 했어.',
			resultType,
			duration,
			cost: firstCost,
			budget,
			people,
			weatherFit: wantsIndoor ? 'indoor' : 'mostly_indoor',
			routeSummary: `${location} 기준 전시-식당 이동 10분`,
			badges: ['예약 후보', '분위기', '실내 중심'],
			items: [
				{
					slot: 'activity',
					title: '기획 전시 또는 미디어아트',
					price: Math.round(firstCost * 0.42),
					source: 'myrealtrip',
					outboundUrl: 'https://www.myrealtrip.com/offers/example'
				},
				{
					slot: 'food',
					title: '분위기 좋은 캐주얼 다이닝',
					price: Math.round(firstCost * 0.58),
					source: 'api_fuse',
					outboundUrl: 'https://app.catchtable.co.kr'
				}
			]
		}),
		card({
			id: 'couple-light',
			label: '가볍게 설렘픽',
			title: '포토부스 거리 + 디저트 바',
			reason:
				'큰 결심 없이도 데이트 감성이 살아. 예산을 덜 쓰고, 짧은 시간에도 완성도 있는 흐름이야.',
			resultType: 'mini_course',
			duration: '2시간 30분',
			cost: secondCost,
			budget,
			people,
			weatherFit: 'mostly_indoor',
			routeSummary: `${location} 기준 도보 12분`,
			badges: ['사진', '디저트', '짧은 이동'],
			items: [
				{
					slot: 'activity',
					title: '포토부스와 작은 소품샵',
					price: Math.round(secondCost * 0.3),
					source: 'genrank',
					outboundUrl: 'https://www.genrank.com'
				},
				{
					slot: 'food',
					title: '디저트 바',
					price: Math.round(secondCost * 0.7),
					source: 'api_fuse',
					outboundUrl: 'https://map.kakao.com'
				}
			]
		}),
		card({
			id: 'couple-novel',
			label: '새 경험 데이트픽',
			title: '향수 공방 + 늦은 저녁',
			reason:
				'새로운 걸 해보고 싶은 커플에게 맞아. 만들기 활동으로 기억이 남고, 식사는 가까운 곳으로 붙였어.',
			resultType,
			duration,
			cost: thirdCost,
			budget,
			people,
			weatherFit: 'indoor',
			routeSummary: `${location} 기준 대중교통 1정거장`,
			badges: ['원데이클래스', '예약', '실내'],
			items: [
				{
					slot: 'activity',
					title: '향수 또는 반지 공방',
					price: Math.round(thirdCost * 0.65),
					source: 'myrealtrip',
					outboundUrl: 'https://www.myrealtrip.com/offers/example'
				},
				{
					slot: 'food',
					title: '늦게까지 여는 다이닝',
					price: Math.round(thirdCost * 0.35),
					source: 'api_fuse',
					outboundUrl: 'https://app.catchtable.co.kr'
				}
			]
		})
	];
}

function familyRecommendations(
	session: RecommendationSession,
	budget: number,
	people: number,
	location: string,
	resultType: RecommendationCard['resultType'],
	wantsIndoor: boolean
): RecommendationCard[] {
	const firstCost = costWithinBudget(budget, 0.7, 24000);
	const secondCost = costWithinBudget(budget, 0.84, 28000);
	const thirdCost = costWithinBudget(budget, 0.48, 16000);

	return [
		card({
			id: 'family-museum',
			label: wantsIndoor ? '날씨 방어 가족픽' : '가족 실내픽',
			title: '과학관/박물관 + 편한 식사',
			reason:
				'연령대가 섞여도 무난하고, 날씨 영향을 적게 받아. 동선이 단순해서 가족끼리 피로도가 낮아.',
			resultType,
			duration: timeMeta(session.availableTime).duration,
			cost: firstCost,
			budget,
			people,
			weatherFit: 'indoor',
			routeSummary: `${location} 기준 차 또는 대중교통 20분 안쪽`,
			badges: ['실내', '가족 무난', '이동 쉬움'],
			items: [
				{
					slot: 'activity',
					title: '과학관 또는 박물관',
					price: Math.round(firstCost * 0.45),
					source: 'api_fuse',
					outboundUrl: 'https://map.kakao.com'
				},
				{
					slot: 'food',
					title: '주차 쉬운 가족 식당',
					price: Math.round(firstCost * 0.55),
					source: 'api_fuse',
					outboundUrl: 'https://app.catchtable.co.kr'
				}
			]
		}),
		card({
			id: 'family-activity',
			label: '가벼운 체험픽',
			title: '실내 만들기 체험 + 간식',
			reason:
				'가족이 같이 참여할 수 있지만 부담은 낮아. 예약 가능한 체험을 먼저 두고 주변 간식 후보를 붙였어.',
			resultType,
			duration: '3시간',
			cost: secondCost,
			budget,
			people,
			weatherFit: 'indoor',
			routeSummary: `${location} 기준 이동 25분 이내`,
			badges: ['체험', '예약 가능', '실내'],
			items: [
				{
					slot: 'activity',
					title: '가족 원데이 클래스',
					price: Math.round(secondCost * 0.7),
					source: 'myrealtrip',
					outboundUrl: 'https://www.myrealtrip.com/offers/example'
				},
				{
					slot: 'food',
					title: '근처 베이커리 카페',
					price: Math.round(secondCost * 0.3),
					source: 'api_fuse',
					outboundUrl: 'https://map.kakao.com'
				}
			]
		}),
		card({
			id: 'family-mall',
			label: '짧고 편한 몰픽',
			title: '몰 안 식사 + 쇼핑 산책',
			reason: '예산과 날씨 리스크를 줄이는 대안이야. 한 곳에서 밥, 산책, 쇼핑을 해결할 수 있어.',
			resultType: 'mini_course',
			duration: '2시간',
			cost: thirdCost,
			budget,
			people,
			weatherFit: 'indoor',
			routeSummary: `${location} 기준 한 건물 안에서 완료`,
			badges: ['동선 짧음', '실내', '가성비'],
			items: [
				{
					slot: 'food',
					title: '몰 안 캐주얼 식당',
					price: thirdCost,
					source: 'api_fuse',
					outboundUrl: 'https://map.kakao.com'
				}
			]
		})
	];
}

function groupRecommendations(
	session: RecommendationSession,
	budget: number,
	people: number,
	location: string,
	resultType: RecommendationCard['resultType'],
	wantsActivity: boolean
): RecommendationCard[] {
	const duration = timeMeta(session.availableTime).duration;
	const firstCost = costWithinBudget(budget, wantsActivity ? 0.9 : 0.72, 32000);
	const secondCost = costWithinBudget(budget, 0.58, 22000);
	const thirdCost = costWithinBudget(budget, 0.8, 28000);

	return [
		card({
			id: 'group-game',
			label: wantsActivity ? '확실한 재미픽' : '모두 무난 활동픽',
			title: '보드게임/다트 라운지 + 단체 식사',
			reason:
				'참여 난이도가 낮아 모임에서 의견이 갈려도 수습하기 쉬워. 예약과 좌석 규모를 먼저 볼 수 있는 후보로 묶었어.',
			resultType,
			duration,
			cost: firstCost,
			budget,
			people,
			weatherFit: 'indoor',
			routeSummary: `${location} 기준 대중교통 접근 좋은 곳`,
			badges: ['단체 좌석', '실내', '게임'],
			items: [
				{
					slot: 'activity',
					title: '보드게임 또는 다트 라운지',
					price: Math.round(firstCost * 0.45),
					source: 'api_fuse',
					outboundUrl: 'https://map.kakao.com'
				},
				{
					slot: 'food',
					title: '단체 예약 가능한 식당',
					price: Math.round(firstCost * 0.55),
					source: 'api_fuse',
					outboundUrl: 'https://app.catchtable.co.kr'
				}
			]
		}),
		card({
			id: 'group-safe',
			label: '의견 갈릴 때 안전픽',
			title: '푸드홀 + 짧은 팝업 구경',
			reason: '음식 취향이 달라도 각자 고르기 쉬워. 비용도 낮고, 모임 인원이 많아도 동선이 단순해.',
			resultType: 'mini_course',
			duration: '2시간 30분',
			cost: secondCost,
			budget,
			people,
			weatherFit: 'mostly_indoor',
			routeSummary: `${location} 기준 실내 동선 중심`,
			badges: ['무난함', '예산 여유', '취향 분산'],
			items: [
				{
					slot: 'food',
					title: '선택지 많은 푸드홀',
					price: Math.round(secondCost * 0.8),
					source: 'api_fuse',
					outboundUrl: 'https://map.kakao.com'
				},
				{
					slot: 'activity',
					title: '근처 팝업 구경',
					price: Math.round(secondCost * 0.2),
					source: 'genrank',
					outboundUrl: 'https://www.genrank.com'
				}
			]
		}),
		card({
			id: 'group-class',
			label: '팀 빌딩 살짝픽',
			title: '단체 원데이 클래스 + 카페',
			reason:
				'모임의 공통 경험이 남는 코스야. 시간 여유가 있을 때 좋고, 예약 가능한 액티비티 중심으로 봤어.',
			resultType,
			duration,
			cost: thirdCost,
			budget,
			people,
			weatherFit: 'indoor',
			routeSummary: `${location} 기준 이동 20분 이내`,
			badges: ['예약', '팀 경험', '실내'],
			items: [
				{
					slot: 'activity',
					title: '단체 공방/쿠킹 클래스',
					price: Math.round(thirdCost * 0.75),
					source: 'myrealtrip',
					outboundUrl: 'https://www.myrealtrip.com/offers/example'
				},
				{
					slot: 'food',
					title: '인원 수용 가능한 카페',
					price: Math.round(thirdCost * 0.25),
					source: 'api_fuse',
					outboundUrl: 'https://map.kakao.com'
				}
			]
		})
	];
}
