import { env } from '$env/dynamic/private';
import type {
	ActivityCandidate,
	CandidateBundle,
	MobilityCandidate,
	ProviderStatus,
	RestaurantCandidate,
	WeatherCandidate
} from '$lib/sai/candidates';
import { partyCount } from '$lib/sai/recommendations';
import type { RecommendationSession, UserProfile } from '$lib/sai/types';
import { loggedFetch } from './integration-logger';

type CandidateInput = {
	profile: UserProfile;
	session: RecommendationSession;
};
type GeoCandidate = {
	title: string;
	lat?: number;
	lng?: number;
	mapUrl?: string;
	address?: string;
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
	const [trendResult, activityResult, restaurantResult, weatherResult] = await Promise.all([
		getTrendKeywords(statuses),
		getActivities(input, statuses),
		getRestaurants(input, statuses),
		getWeather(input)
	]);
	const mobilityResult = await getMobility(
		input,
		statuses,
		firstGeoCandidate([...activityResult, ...restaurantResult])
	);

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
		const enriched = await enrichActivityCandidates(input, candidates, apiKey);
		return enriched.length ? enriched : fallback;
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
			const shopRef = stringValue(item.shopRef) || stringValue(item.id) || `catchtable-${index}`;
			const outboundUrl = stringValue(item.url) || catchtableShopUrl(shopRef);
			const lat = numberValue(item.lat) ?? numberValue(item.latitude);
			const lng = numberValue(item.lon) ?? numberValue(item.lng) ?? numberValue(item.longitude);
			return {
				id: shopRef,
				title: stringValue(item.name) || stringValue(item.shopName) || '캐치테이블 맛집',
				price: numberValue(item.averagePrice),
				source: 'api_fuse',
				outboundUrl,
				reservationUrl: outboundUrl,
				mapUrl: kakaoSearchUrl(stringValue(item.name) || stringValue(item.shopName) || shopRef),
				address: stringValue(item.address) || stringValue(item.roadAddress),
				lat,
				lng,
				tags: ['예약 후보', '맛집'],
				reservationHint: '예약 가능 시간 확인 필요'
			};
		});

		statuses.push({ provider: 'api_fuse', configured: true, ok: restaurants.length > 0 });
		const enriched = await enrichRestaurants(input, restaurants, apiKey);
		return enriched.length ? enriched : fallback;
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
	statuses: ProviderStatus[],
	destination?: GeoCandidate
): Promise<MobilityCandidate[]> {
	const fallback: MobilityCandidate[] = [
		{
			label: input.session.companionConstraints.hasBaby ? '차량/주차 우선' : '도보와 대중교통 우선',
			mode: input.session.companionConstraints.hasBaby ? 'car' : 'transit',
			routeMapUrl: routeMapUrl(input.session.location, destination),
			detail: destination?.title ? `${destination.title}까지 지도 앱에서 경로 확인` : undefined,
			source: 'sai'
		}
	];
	const apiKey = env.SWING_API_KEY;
	const base = env.SWING_BASE_URL || 'https://stage.playground.endpoint.swingmobility.dev';
	const results: MobilityCandidate[] = [];
	const apifuseRoute = await getKakaoRoute(input, destination);
	if (apifuseRoute) results.push(apifuseRoute);
	if (!apiKey || input.session.location?.lat == null || input.session.location.lng == null) {
		statuses.push({
			provider: 'swing',
			configured: Boolean(apiKey),
			ok: false,
			fallbackReason: !apiKey ? 'SWING_API_KEY is not configured' : 'location coordinates missing'
		});
		return results.length ? results : fallback;
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
		results.push({
			label: '근처 공유 모빌리티 확인됨',
			mode: 'shared',
			routeMapUrl: routeMapUrl(input.session.location, destination),
			source: 'swing'
		});
		const taxi = await getTaxiEta(input, destination, apiKey, base);
		if (taxi) results.push(taxi);
		return results.length ? results : fallback;
	} catch (error) {
		statuses.push({
			provider: 'swing',
			configured: true,
			ok: false,
			fallbackReason: error instanceof Error ? error.message : 'Swing request failed'
		});
		return results.length ? results : fallback;
	}
}

async function enrichActivityCandidates(
	input: CandidateInput,
	candidates: ActivityCandidate[],
	myrealtripApiKey: string
) {
	const apifuseApiKey = env.API_FUSE_API_KEY;
	return Promise.all(
		candidates.slice(0, 8).map(async (candidate) => {
			const [booking, place] = await Promise.all([
				getMyrealtripAvailability(input, candidate, myrealtripApiKey),
				apifuseApiKey ? findKakaoPlace(input, candidate.title, apifuseApiKey) : null
			]);
			return {
				...candidate,
				reservationUrl: candidate.outboundUrl,
				mapUrl: place?.mapUrl ?? candidate.mapUrl,
				address: place?.address ?? candidate.address,
				lat: place?.lat ?? candidate.lat,
				lng: place?.lng ?? candidate.lng,
				availabilityText: booking ?? candidate.availabilityText,
				tags: [...new Set([...candidate.tags, ...(booking ? ['예약 가능성 확인'] : [])])]
			};
		})
	);
}

async function enrichRestaurants(
	input: CandidateInput,
	restaurants: RestaurantCandidate[],
	apiKey: string
) {
	return Promise.all(
		restaurants.slice(0, 8).map(async (restaurant) => {
			const [availability, place] = await Promise.all([
				getCatchtableAvailability(input, restaurant, apiKey),
				restaurant.lat && restaurant.lng ? null : findKakaoPlace(input, restaurant.title, apiKey)
			]);
			return {
				...restaurant,
				mapUrl: restaurant.mapUrl ?? place?.mapUrl,
				address: restaurant.address || place?.address,
				lat: restaurant.lat ?? place?.lat,
				lng: restaurant.lng ?? place?.lng,
				availabilityText: availability ?? restaurant.availabilityText,
				reservationHint: availability ?? restaurant.reservationHint,
				tags: [...new Set([...restaurant.tags, ...(availability ? ['예약 슬롯 확인'] : [])])]
			};
		})
	);
}

async function getMyrealtripAvailability(
	input: CandidateInput,
	candidate: ActivityCandidate,
	apiKey: string
) {
	const selectedDate = selectedDateForReservation(input.session);
	if (!candidate.id || candidate.id.startsWith('myrealtrip-') || !selectedDate) return undefined;

	try {
		const response = await loggedFetch({
			provider: 'myrealtrip',
			kind: 'api',
			operation: 'tna.options',
			url: `${MYREALTRIP_BASE}/v1/products/tna/options`,
			init: {
				method: 'POST',
				headers: {
					authorization: `Bearer ${apiKey}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					gid: candidate.id,
					selectedDate
				}),
				signal: AbortSignal.timeout(2500)
			}
		});
		if (!response.ok) throw new Error(`Myrealtrip options ${response.status}`);

		const payload = await response.json();
		const text = JSON.stringify(payload);
		if (/availablePurchaseQuantity"?\s*:\s*[1-9]/i.test(text))
			return `${selectedDate} 예약 옵션 확인됨`;
		return `${selectedDate} 예약 페이지 확인`;
	} catch {
		return undefined;
	}
}

async function getCatchtableAvailability(
	input: CandidateInput,
	restaurant: RestaurantCandidate,
	apiKey: string
) {
	if (!restaurant.id) return undefined;
	const selectedDate = selectedDateForReservation(input.session);
	if (!selectedDate) return undefined;

	try {
		const response = await loggedFetch({
			provider: 'api_fuse',
			kind: 'api',
			operation: 'catchtable.availability',
			url: `${APIFUSE_BASE}/v1/catchtable/availability`,
			init: {
				method: 'POST',
				headers: {
					authorization: `Bearer ${apiKey}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					shopRef: restaurant.id,
					date: selectedDate,
					partySize: partyCount(input.session.situation)
				}),
				signal: AbortSignal.timeout(2500)
			}
		});
		if (!response.ok) throw new Error(`CatchTable availability ${response.status}`);

		const payload = await response.json();
		const text = JSON.stringify(payload);
		if (/available|예약가능|time|slot/i.test(text)) return `${selectedDate} 예약 가능 시간 확인됨`;
		return `${selectedDate} 예약 페이지 확인`;
	} catch {
		return undefined;
	}
}

async function findKakaoPlace(input: CandidateInput, query: string, apiKey: string) {
	if (input.session.location?.lat == null || input.session.location.lng == null) return null;

	try {
		const response = await loggedFetch({
			provider: 'api_fuse',
			kind: 'api',
			operation: 'kakaomap.search',
			url: `${APIFUSE_BASE}/v1/kakaomap-api/search`,
			init: {
				method: 'POST',
				headers: {
					authorization: `Bearer ${apiKey}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					query,
					lat: input.session.location.lat,
					lng: input.session.location.lng,
					radius: 5000,
					page: 1
				}),
				signal: AbortSignal.timeout(2500)
			}
		});
		if (!response.ok) throw new Error(`KakaoMap search ${response.status}`);

		const rows = arrayFromPayload((await response.json()) as { data?: unknown; items?: unknown[] });
		const first = rows[0] as Record<string, unknown> | undefined;
		if (!first) return null;
		const title = stringValue(first.name) || stringValue(first.placeName) || query;
		const lat = numberValue(first.lat) ?? numberValue(first.y) ?? numberValue(first.latitude);
		const lng = numberValue(first.lng) ?? numberValue(first.x) ?? numberValue(first.longitude);
		return {
			title,
			address:
				stringValue(first.address) ||
				stringValue(first.roadAddress) ||
				stringValue(first.road_address_name),
			lat,
			lng,
			mapUrl: stringValue(first.placeUrl) || stringValue(first.url) || kakaoSearchUrl(title)
		};
	} catch {
		return null;
	}
}

async function getKakaoRoute(
	input: CandidateInput,
	destination?: GeoCandidate
): Promise<MobilityCandidate | null> {
	const apiKey = env.API_FUSE_API_KEY;
	if (
		!apiKey ||
		destination?.lat == null ||
		destination.lng == null ||
		input.session.location?.lat == null ||
		input.session.location.lng == null
	) {
		return null;
	}

	const mode: NonNullable<MobilityCandidate['mode']> = input.session.companionConstraints.hasBaby
		? 'car'
		: input.session.availableTime === 'one_hour'
			? 'walk'
			: 'transit';
	const operation =
		mode === 'car' ? 'car-directions' : mode === 'walk' ? 'walk-directions' : 'transit-directions';
	try {
		const response = await loggedFetch({
			provider: 'api_fuse',
			kind: 'api',
			operation: `kakaomap.${operation}`,
			url: `${APIFUSE_BASE}/v1/kakaomap-api/${operation}`,
			init: {
				method: 'POST',
				headers: {
					authorization: `Bearer ${apiKey}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					startLat: input.session.location.lat,
					startLng: input.session.location.lng,
					endLat: destination.lat,
					endLng: destination.lng
				}),
				signal: AbortSignal.timeout(3000)
			}
		});
		if (!response.ok) throw new Error(`KakaoMap route ${response.status}`);

		const payload = await response.json();
		const text = JSON.stringify(payload);
		const minutes = extractMinutes(text);
		return {
			label: minutes
				? `${transportLabel(mode)} 약 ${minutes}분`
				: `${transportLabel(mode)} 경로 확인됨`,
			minutes,
			mode,
			routeMapUrl: routeMapUrl(input.session.location, destination),
			detail: `${input.session.location.label}에서 ${destination.title}까지 ${transportLabel(mode)} 경로`,
			source: 'api_fuse'
		};
	} catch {
		return null;
	}
}

async function getTaxiEta(
	input: CandidateInput,
	destination: GeoCandidate | undefined,
	apiKey: string,
	base: string
): Promise<MobilityCandidate | null> {
	if (
		destination?.lat == null ||
		destination.lng == null ||
		input.session.location?.lat == null ||
		input.session.location.lng == null
	) {
		return null;
	}

	try {
		const response = await loggedFetch({
			provider: 'swing',
			kind: 'api',
			operation: 'taxi.eta',
			url: `${base}/v1/taxi/eta`,
			init: {
				method: 'POST',
				headers: {
					'x-api-key': apiKey,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					startLat: input.session.location.lat,
					startLng: input.session.location.lng,
					endLat: destination.lat,
					endLng: destination.lng
				}),
				signal: AbortSignal.timeout(2500)
			}
		});
		if (!response.ok) throw new Error(`Swing taxi ${response.status}`);

		const payload = (await response.json()) as Record<string, unknown>;
		const spendTime = numberValue(payload.spendTime);
		const taxiFare = numberValue(payload.taxiFare);
		const minutes = spendTime ? Math.round(spendTime / 60) : undefined;
		return {
			label: minutes ? `택시 약 ${minutes}분` : '택시 예상 경로 확인됨',
			minutes,
			cost: taxiFare,
			mode: 'taxi',
			routeMapUrl: routeMapUrl(input.session.location, destination),
			detail: taxiFare ? `예상 택시비 ${taxiFare.toLocaleString('ko-KR')}원` : undefined,
			source: 'swing'
		};
	} catch {
		return null;
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
			mapUrl: kakaoSearchUrl(baby ? '영유아 동반 실내 체험관' : '실내 원데이 클래스'),
			tags: baby ? ['유모차', '실내'] : ['온보딩 답변 반영', '예약 후보']
		},
		{
			id: 'fallback-activity-2',
			title: baby ? '실내 식물원 산책' : '짧은 전시 또는 팝업',
			price: baby ? 16000 : 22000,
			source: 'sai',
			outboundUrl: 'https://map.kakao.com',
			mapUrl: kakaoSearchUrl(baby ? '실내 식물원 산책' : '짧은 전시 팝업'),
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
			reservationUrl: 'https://app.catchtable.co.kr',
			mapUrl: kakaoSearchUrl(baby ? '키즈 프렌들리 카페' : '캐주얼 파스타 다이닝'),
			tags: baby ? ['수유실 확인', '주차'] : ['예약 후보', '맛집']
		}
	];
}

function arrayFromPayload(payload: { data?: unknown; items?: unknown[]; documents?: unknown[] }) {
	if (Array.isArray(payload.items)) return payload.items;
	if (Array.isArray(payload.documents)) return payload.documents;
	if (payload.data && typeof payload.data === 'object') {
		const data = payload.data as {
			items?: unknown[];
			shops?: unknown[];
			restaurants?: unknown[];
			documents?: unknown[];
			places?: unknown[];
			results?: unknown[];
		};
		return (
			data.items ??
			data.shops ??
			data.restaurants ??
			data.documents ??
			data.places ??
			data.results ??
			[]
		);
	}
	return [];
}

function stringValue(value: unknown) {
	return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown) {
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value.trim());
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstGeoCandidate(candidates: GeoCandidate[]) {
	return candidates.find((candidate) => candidate.lat != null && candidate.lng != null);
}

function selectedDateForReservation(session: RecommendationSession) {
	const source = session.startDateTime ? new Date(session.startDateTime) : new Date();
	if (Number.isNaN(source.getTime())) return '';
	const pad = (value: number) => `${value}`.padStart(2, '0');
	return `${source.getFullYear()}-${pad(source.getMonth() + 1)}-${pad(source.getDate())}`;
}

function kakaoSearchUrl(query: string) {
	return `https://map.kakao.com/?q=${encodeURIComponent(query)}`;
}

function catchtableShopUrl(shopRef: string) {
	return shopRef && !shopRef.startsWith('catchtable-')
		? `https://app.catchtable.co.kr/ct/shop/${encodeURIComponent(shopRef)}`
		: 'https://app.catchtable.co.kr';
}

function routeMapUrl(origin: RecommendationSession['location'], destination?: GeoCandidate) {
	if (!destination) return 'https://map.kakao.com';
	const url = new URL('https://map.kakao.com/');
	url.searchParams.set('sName', origin?.label ?? '현재 위치');
	url.searchParams.set('eName', destination.title);
	if (origin?.lat != null && origin.lng != null) {
		url.searchParams.set('sY', String(origin.lat));
		url.searchParams.set('sX', String(origin.lng));
	}
	if (destination.lat != null && destination.lng != null) {
		url.searchParams.set('eY', String(destination.lat));
		url.searchParams.set('eX', String(destination.lng));
	}
	return url.toString();
}

function transportLabel(mode: NonNullable<MobilityCandidate['mode']>) {
	if (mode === 'walk') return '도보';
	if (mode === 'car') return '자동차';
	if (mode === 'taxi') return '택시';
	if (mode === 'shared') return '공유 모빌리티';
	return '대중교통';
}

function extractMinutes(text: string) {
	const minuteMatch = text.match(/(?:minutes|min|durationMinutes|timeMinutes)"?\s*:\s*(\d+)/i);
	if (minuteMatch?.[1]) return Number(minuteMatch[1]);
	const secondMatch = text.match(/(?:seconds|durationSeconds|spendTime)"?\s*:\s*(\d+)/i);
	if (secondMatch?.[1]) return Math.round(Number(secondMatch[1]) / 60);
	return undefined;
}

function freeformActivityKeyword(profile: UserProfile) {
	const text = (profile.onboardingFreeformAnswers ?? []).map((answer) => answer.answer).join(' ');
	return freeformKeywordRules.find((rule) => rule.pattern.test(text))?.activity;
}
