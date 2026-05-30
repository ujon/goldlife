import { env } from '$env/dynamic/private';
import type {
	ActivityCandidate,
	CandidateBundle,
	MobilityCandidate,
	ProviderStatus,
	RestaurantCandidate,
	WeatherCandidate
} from '$lib/sai/candidates';
import type { RecommendationSession, UserProfile } from '$lib/sai/types';
import { loggedFetch } from './integration-logger';

type CandidateInput = {
	profile: UserProfile;
	session: RecommendationSession;
};

const MYREALTRIP_BASE = 'https://partner-ext-api.myrealtrip.com';
const APIFUSE_BASE = 'https://api.apifuse.com';
const freeformKeywordRules = [
	{ pattern: /캠핑|글램핑|야영|camp/i, activity: '캠핑 글램핑 야외 체험' },
	{ pattern: /등산|하이킹|트레킹|산에|산책/i, activity: '가벼운 트레킹 산책' },
	{ pattern: /공연|전시|미술관|박물관/i, activity: '전시 공연' },
	{ pattern: /공방|클래스|만들/i, activity: '원데이클래스' },
	{ pattern: /맛집|식당|먹|카페/i, activity: '맛집 카페 투어' }
];

export async function collectCandidates(input: CandidateInput): Promise<CandidateBundle> {
	const statuses: ProviderStatus[] = [];
	const [trendResult, activityResult, restaurantResult, weatherResult, mobilityResult] =
		await Promise.all([
			getTrendKeywords(statuses),
			getActivities(input, statuses),
			getRestaurants(input, statuses),
			getWeather(input),
			getMobility(input, statuses)
		]);

	return {
		weather: weatherResult,
		trendKeywords: trendResult,
		activities: activityResult,
		restaurants: restaurantResult,
		mobility: mobilityResult,
		statuses
	};
}

async function getTrendKeywords(statuses: ProviderStatus[]) {
	const fallback = ['실내 체험', '원데이클래스', '디저트 카페', '가벼운 산책', '키즈 프렌들리'];
	const base = env.GENRANK_BASE_URL || 'https://www.genrank.com';

	try {
		const url = new URL('/api/rankings', base);
		url.searchParams.set('language', 'ko');
		url.searchParams.set('limit', '8');

		const response = await loggedFetch({
			provider: 'genrank',
			kind: 'api',
			operation: 'rankings',
			url,
			init: { signal: AbortSignal.timeout(2500) }
		});
		if (!response.ok) throw new Error(`GenRank ${response.status}`);

		const payload = (await response.json()) as {
			rankings?: Array<{ entity?: { name?: string }; name?: string; label?: string }>;
			entities?: Array<{ entity?: { name?: string }; name?: string; label?: string }>;
		};
		const rows: Array<{ entity?: { name?: string }; name?: string; label?: string }> =
			payload.rankings ?? payload.entities ?? [];
		const keywords = rows
			.map((row) => row.entity?.name ?? row.name ?? row.label)
			.filter((value): value is string => Boolean(value))
			.slice(0, 8);

		statuses.push({ provider: 'genrank', configured: true, ok: keywords.length > 0 });
		return keywords.length ? keywords : fallback;
	} catch (error) {
		statuses.push({
			provider: 'genrank',
			configured: true,
			ok: false,
			fallbackReason: error instanceof Error ? error.message : 'GenRank request failed'
		});
		return fallback;
	}
}

async function getActivities(input: CandidateInput, statuses: ProviderStatus[]) {
	const fallback = fallbackActivities(input);
	const apiKey = env.MYREALTRIP_API_KEY;
	if (!apiKey) {
		statuses.push({
			provider: 'myrealtrip',
			configured: false,
			ok: false,
			fallbackReason: 'MYREALTRIP_API_KEY is not configured'
		});
		return fallback;
	}

	try {
		const keyword =
			freeformActivityKeyword(input.profile) ??
			(input.session.companionConstraints.hasBaby
				? '키즈 실내 체험'
				: input.profile.activityPreferences.includes('culture')
					? '전시'
					: '원데이클래스');
		const response = await loggedFetch({
			provider: 'myrealtrip',
			kind: 'api',
			operation: 'tna.search',
			url: `${MYREALTRIP_BASE}/v1/products/tna/search`,
			init: {
				method: 'POST',
				headers: {
					authorization: `Bearer ${apiKey}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					keyword,
					minPrice: 0,
					maxPrice: input.session.budgetTotal ?? 100000,
					sort: 'review',
					page: 1,
					size: 8
				}),
				signal: AbortSignal.timeout(3500)
			}
		});
		if (!response.ok) throw new Error(`Myrealtrip ${response.status}`);

		const payload = (await response.json()) as {
			data?: { items?: Array<Record<string, unknown>> };
		};
		const items = payload.data?.items ?? [];
		const candidates = items.map((item, index): ActivityCandidate => {
			const gid = stringValue(item.gid) || `myrealtrip-${index}`;
			const title =
				stringValue(item.itemName) || stringValue(item.title) || '마이리얼트립 액티비티';
			const price = numberValue(item.salePrice);
			const outboundUrl =
				stringValue(item.deepLink) ||
				stringValue(item.productUrl) ||
				`https://www.myrealtrip.com/offers/${gid}`;

			return {
				id: gid,
				title,
				price,
				source: 'myrealtrip',
				outboundUrl,
				tags: ['예약 후보', '액티비티'],
				score: numberValue(item.reviewScore)
			};
		});

		statuses.push({ provider: 'myrealtrip', configured: true, ok: candidates.length > 0 });
		return candidates.length ? candidates : fallback;
	} catch (error) {
		statuses.push({
			provider: 'myrealtrip',
			configured: true,
			ok: false,
			fallbackReason: error instanceof Error ? error.message : 'Myrealtrip request failed'
		});
		return fallback;
	}
}

async function getRestaurants(input: CandidateInput, statuses: ProviderStatus[]) {
	const fallback = fallbackRestaurants(input);
	const apiKey = env.API_FUSE_API_KEY;
	if (!apiKey) {
		statuses.push({
			provider: 'api_fuse',
			configured: false,
			ok: false,
			fallbackReason: 'API_FUSE_API_KEY is not configured'
		});
		return fallback;
	}

	try {
		const response = await loggedFetch({
			provider: 'api_fuse',
			kind: 'api',
			operation: 'catchtable.search',
			url: `${APIFUSE_BASE}/v1/catchtable/search`,
			init: {
				method: 'POST',
				headers: {
					authorization: `Bearer ${apiKey}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					keyword: input.session.companionConstraints.hasBaby
						? '키즈 프렌들리 카페'
						: '캐주얼 다이닝',
					lat: input.session.location?.lat,
					lon: input.session.location?.lng,
					limit: 8,
					offset: 0,
					sort: 'review'
				}),
				signal: AbortSignal.timeout(3500)
			}
		});
		if (!response.ok) throw new Error(`API Fuse CatchTable ${response.status}`);

		const payload = (await response.json()) as { data?: unknown; items?: unknown[] };
		const rows = arrayFromPayload(payload);
		const restaurants = rows.map((row, index): RestaurantCandidate => {
			const item = row as Record<string, unknown>;
			return {
				id: stringValue(item.shopRef) || stringValue(item.id) || `catchtable-${index}`,
				title: stringValue(item.name) || stringValue(item.shopName) || '캐치테이블 맛집',
				price: numberValue(item.averagePrice),
				source: 'api_fuse',
				outboundUrl: stringValue(item.url) || 'https://app.catchtable.co.kr',
				tags: ['예약 후보', '맛집'],
				reservationHint: '예약 가능 시간 확인 필요'
			};
		});

		statuses.push({ provider: 'api_fuse', configured: true, ok: restaurants.length > 0 });
		return restaurants.length ? restaurants : fallback;
	} catch (error) {
		statuses.push({
			provider: 'api_fuse',
			configured: true,
			ok: false,
			fallbackReason: error instanceof Error ? error.message : 'API Fuse request failed'
		});
		return fallback;
	}
}

async function getWeather(input: CandidateInput): Promise<WeatherCandidate> {
	const fallback: WeatherCandidate = {
		label: input.session.weatherSnapshot.label,
		condition: input.session.weatherSnapshot.condition,
		preferIndoor: input.session.weatherSnapshot.preferIndoor,
		temperature: input.session.weatherSnapshot.temperature,
		source: 'sai'
	};
	const apiKey = env.API_FUSE_API_KEY;
	if (!apiKey) return fallback;

	try {
		const response = await loggedFetch({
			provider: 'api_fuse',
			kind: 'api',
			operation: 'kma.weather_by_address',
			url: `${APIFUSE_BASE}/v1/kma-forecast/weather-by-address`,
			init: {
				method: 'POST',
				headers: {
					authorization: `Bearer ${apiKey}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					address: input.session.location?.label ?? input.profile.recentLocation?.label ?? '서울'
				}),
				signal: AbortSignal.timeout(3500)
			}
		});
		if (!response.ok) throw new Error(`API Fuse KMA ${response.status}`);

		const payload = (await response.json()) as Record<string, unknown>;
		const text = JSON.stringify(payload);
		const isRain = /비|rain|shower/i.test(text);
		const isDust = /미세|dust|pm10|pm2/i.test(text);
		const condition: WeatherCandidate['condition'] = isRain ? 'rain' : isDust ? 'dust' : 'cloudy';
		return {
			label: isRain ? '비 예보' : isDust ? '미세먼지 확인' : '날씨 확인됨',
			condition,
			preferIndoor: isRain || isDust,
			source: 'api_fuse'
		};
	} catch {
		return fallback;
	}
}

async function getMobility(
	input: CandidateInput,
	statuses: ProviderStatus[]
): Promise<MobilityCandidate[]> {
	const fallback: MobilityCandidate[] = [
		{
			label: input.session.companionConstraints.hasBaby ? '차량/주차 우선' : '도보와 대중교통 우선',
			source: 'sai'
		}
	];
	const apiKey = env.SWING_API_KEY;
	const base = env.SWING_BASE_URL || 'https://stage.playground.endpoint.swingmobility.dev';
	if (!apiKey || !input.session.location?.lat || !input.session.location.lng) {
		statuses.push({
			provider: 'swing',
			configured: Boolean(apiKey),
			ok: false,
			fallbackReason: !apiKey ? 'SWING_API_KEY is not configured' : 'location coordinates missing'
		});
		return fallback;
	}

	try {
		const url = new URL('/v1/vehicles/search', base);
		url.searchParams.set('lat', String(input.session.location.lat));
		url.searchParams.set('lng', String(input.session.location.lng));
		url.searchParams.set('radius', '1200');
		url.searchParams.set('count', '5');
		const response = await loggedFetch({
			provider: 'swing',
			kind: 'api',
			operation: 'vehicles.search',
			url,
			init: {
				headers: { 'x-api-key': apiKey },
				signal: AbortSignal.timeout(2500)
			}
		});
		if (!response.ok) throw new Error(`Swing ${response.status}`);

		statuses.push({ provider: 'swing', configured: true, ok: true });
		return [
			{
				label: '근처 공유 모빌리티 확인됨',
				source: 'swing'
			}
		];
	} catch (error) {
		statuses.push({
			provider: 'swing',
			configured: true,
			ok: false,
			fallbackReason: error instanceof Error ? error.message : 'Swing request failed'
		});
		return fallback;
	}
}

function fallbackActivities(input: CandidateInput): ActivityCandidate[] {
	const baby = input.session.companionConstraints.hasBaby;
	const freeformKeyword = freeformActivityKeyword(input.profile);
	return [
		{
			id: 'fallback-activity-1',
			title: baby
				? '영유아 동반 실내 체험관'
				: freeformKeyword
					? `${freeformKeyword} 후보`
					: '실내 원데이 클래스',
			price: baby ? 18000 : 36000,
			source: 'sai',
			outboundUrl: 'https://map.kakao.com',
			tags: baby ? ['유모차', '실내'] : ['온보딩 답변 반영', '예약 후보']
		},
		{
			id: 'fallback-activity-2',
			title: baby ? '실내 식물원 산책' : '짧은 전시 또는 팝업',
			price: baby ? 16000 : 22000,
			source: 'sai',
			outboundUrl: 'https://map.kakao.com',
			tags: ['날씨 fallback', '짧은 동선']
		}
	];
}

function fallbackRestaurants(input: CandidateInput): RestaurantCandidate[] {
	const baby = input.session.companionConstraints.hasBaby;
	return [
		{
			id: 'fallback-restaurant-1',
			title: baby ? '넓은 좌석 키즈 프렌들리 카페' : '캐주얼 파스타 다이닝',
			price: baby ? 32000 : 42000,
			source: 'sai',
			outboundUrl: 'https://app.catchtable.co.kr',
			tags: baby ? ['수유실 확인', '주차'] : ['예약 후보', '맛집']
		}
	];
}

function arrayFromPayload(payload: { data?: unknown; items?: unknown[] }) {
	if (Array.isArray(payload.items)) return payload.items;
	if (payload.data && typeof payload.data === 'object') {
		const data = payload.data as { items?: unknown[]; shops?: unknown[]; restaurants?: unknown[] };
		return data.items ?? data.shops ?? data.restaurants ?? [];
	}
	return [];
}

function stringValue(value: unknown) {
	return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function freeformActivityKeyword(profile: UserProfile) {
	const text = (profile.onboardingFreeformAnswers ?? []).map((answer) => answer.answer).join(' ');
	return freeformKeywordRules.find((rule) => rule.pattern.test(text))?.activity;
}
