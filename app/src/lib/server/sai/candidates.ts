import { env } from '$env/dynamic/private';
import type {
	ActivityCandidate,
	CandidateBundle,
	CandidateQueryPlan,
	MobilityCandidate,
	ProviderStatus,
	RestaurantCandidate,
	WeatherCandidate
} from '$lib/sai/candidates';
import { partyCount } from '$lib/sai/recommendations';
import type { RecommendationSession, UserProfile } from '$lib/sai/types';
import { loggedFetch, logIntegrationEvent } from './integration-logger';

type CandidateInput = {
	profile: UserProfile;
	session: RecommendationSession;
	queryPlan?: CandidateQueryPlan;
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
	{
		pattern: /캠핑|글램핑|야영|camp/i,
		activity: '캠핑 글램핑 야외 체험',
		shortActivity: '바비큐 카페'
	},
	{ pattern: /등산|하이킹|트레킹|산에|산책/i, activity: '가벼운 트레킹 산책' },
	{ pattern: /공연|전시|미술관|박물관/i, activity: '전시 공연' },
	{ pattern: /공방|클래스|만들/i, activity: '원데이클래스' },
	{ pattern: /맛집|식당|먹|카페/i, activity: '맛집 카페 투어' }
];
const longActivityBlockedPattern =
	/글램핑|캠핑장|캠핑|야영|카라반|숙박|리조트|당일치기|등산|트레킹|하이킹/i;
const remoteShortWindowPattern =
	/공항|라운지|워터파크|테마파크|투어|여행|항공|대만|타오위안|베트남|나트랑|다낭|푸꾸옥|동나이|부산|제주|인천|김포|김해|해외|호텔|숙소/i;

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
		statuses,
		queryPlan: input.queryPlan
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
	const [myrealtripResult, apiFuseResult] = await Promise.allSettled([
		getMyrealtripActivities(input, statuses),
		getApiFuseActivityCandidates(input)
	]);
	const rawActivities = dedupeActivities([
		...(apiFuseResult.status === 'fulfilled' ? apiFuseResult.value : []),
		...(myrealtripResult.status === 'fulfilled' ? myrealtripResult.value : [])
	]);
	const activities = filterActivitiesForSession(input, rawActivities).slice(0, 8);
	await logActivityQualityGuard(input, rawActivities, activities);

	return activities.length ? activities : fallback;
}

async function getMyrealtripActivities(input: CandidateInput, statuses: ProviderStatus[]) {
	const apiKey = env.MYREALTRIP_API_KEY;
	if (!apiKey) {
		statuses.push({
			provider: 'myrealtrip',
			configured: false,
			ok: false,
			fallbackReason: 'MYREALTRIP_API_KEY is not configured'
		});
		return [];
	}

	try {
		const searchKeywords = myrealtripSearchKeywords(input);
		let payload:
			| {
					data?: { items?: Array<Record<string, unknown>> };
			  }
			| undefined;
		let lastSearchError: unknown;
		for (const keyword of searchKeywords) {
			try {
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
							page: 1,
							size: 8
						}),
						signal: AbortSignal.timeout(6500)
					}
				});
				if (!response.ok) throw new Error(`Myrealtrip ${response.status}`);

				payload = (await response.json()) as {
					data?: { items?: Array<Record<string, unknown>> };
				};
				if ((payload.data?.items ?? []).length > 0) break;
			} catch (error) {
				lastSearchError = error;
			}
		}
		if (!payload && lastSearchError) throw lastSearchError;
		const items = payload?.data?.items ?? [];
		const candidates = items.map((item, index): ActivityCandidate => {
			const gid = stringValue(item.gid) || `myrealtrip-${index}`;
			const title =
				stringValue(item.itemName) || stringValue(item.title) || '마이리얼트립 액티비티';
			const price = numberValue(item.salePrice);
			const outboundUrl =
				stringValue(item.deepLink) || stringValue(item.productUrl) || myrealtripSearchUrl(title);

			return {
				id: gid,
				title,
				price,
				source: 'myrealtrip',
				outboundUrl,
				thumbnailUrl: thumbnailFromRow(item) || undefined,
				tags: ['예약 후보', '액티비티'],
				score: numberValue(item.reviewScore)
			};
		});

		statuses.push({ provider: 'myrealtrip', configured: true, ok: candidates.length > 0 });
		const timeFiltered = filterActivitiesForSession(input, candidates);
		const enriched = await enrichActivityCandidates(input, timeFiltered, apiKey);
		return filterActivitiesForSession(input, enriched);
	} catch (error) {
		statuses.push({
			provider: 'myrealtrip',
			configured: true,
			ok: false,
			fallbackReason: error instanceof Error ? error.message : 'Myrealtrip request failed'
		});
		return [];
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

	const [catchtableResult, localResult, yogiyoResult] = await Promise.allSettled([
		getCatchtableRestaurants(input, apiKey),
		getApiFuseRestaurantPlaces(input, apiKey),
		getYogiyoRestaurants(input, apiKey)
	]);
	const restaurants = dedupeRestaurants([
		...(catchtableResult.status === 'fulfilled' ? catchtableResult.value : []),
		...(localResult.status === 'fulfilled' ? localResult.value : []),
		...(yogiyoResult.status === 'fulfilled' ? yogiyoResult.value : [])
	]).slice(0, 8);

	statuses.push({
		provider: 'api_fuse',
		configured: true,
		ok: restaurants.length > 0,
		fallbackReason: restaurants.length ? undefined : 'API Fuse restaurants returned no candidates'
	});

	return restaurants.length ? restaurants : fallback;
}

async function getCatchtableRestaurants(input: CandidateInput, apiKey: string) {
	const rows = (
		await Promise.all(
			catchtableKeywords(input)
				.slice(0, 2)
				.map(async (keyword) => {
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
								keyword,
								lat: input.session.location?.lat,
								lon: input.session.location?.lng,
								limit: 6,
								offset: 0,
								sort: 'recommended'
							}),
							signal: AbortSignal.timeout(9000)
						}
					});
					if (!response.ok) throw new Error(`API Fuse CatchTable ${response.status}`);

					return arrayFromPayload((await response.json()) as { data?: unknown; items?: unknown[] });
				})
		)
	).flat();
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
			thumbnailUrl: thumbnailFromRow(item) || undefined,
			tags: ['예약 후보', '맛집'],
			reservationHint: '예약 가능 시간 확인 필요'
		};
	});

	return enrichRestaurants(input, restaurants, apiKey);
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
		const [weatherResult, airResult] = await Promise.allSettled([
			loggedFetch({
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
			}),
			getAirQuality(input, apiKey)
		]);
		if (weatherResult.status === 'rejected') throw weatherResult.reason;
		const response = weatherResult.value;
		if (!response.ok) throw new Error(`API Fuse KMA ${response.status}`);

		const payload = (await response.json()) as Record<string, unknown>;
		const text = JSON.stringify(payload);
		const air = airResult.status === 'fulfilled' ? airResult.value : null;
		const isRain = /비|rain|shower/i.test(text);
		const isDust =
			/미세|dust|pm10|pm2/i.test(text) || air?.grade === 'bad' || air?.grade === 'very_bad';
		const condition: WeatherCandidate['condition'] = isRain ? 'rain' : isDust ? 'dust' : 'cloudy';
		const airLabel = air?.label ? ` · ${air.label}` : '';
		return {
			label: `${isRain ? '비 예보' : isDust ? '미세먼지 확인' : '날씨 확인됨'}${airLabel}`,
			condition,
			preferIndoor: isRain || isDust,
			source: 'api_fuse'
		};
	} catch {
		return fallback;
	}
}

async function getAirQuality(input: CandidateInput, apiKey: string) {
	const stationName = airKoreaStationName(
		input.session.location?.label ?? input.profile.recentLocation?.label
	);
	if (!stationName) return null;

	try {
		const response = await loggedFetch({
			provider: 'api_fuse',
			kind: 'api',
			operation: 'airkorea.realtime',
			url: `${APIFUSE_BASE}/v1/airkorea-realtime/realtime`,
			init: {
				method: 'POST',
				headers: {
					authorization: `Bearer ${apiKey}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					stationName,
					dataTerm: 'DAILY'
				}),
				signal: AbortSignal.timeout(3500)
			}
		});
		if (!response.ok) return null;

		const payload = (await response.json()) as Record<string, unknown>;
		const data = payload.data as Record<string, unknown> | undefined;
		const pm10 = data?.pm10 as Record<string, unknown> | undefined;
		const pm25 = data?.pm25 as Record<string, unknown> | undefined;
		const grade = stringValue(pm25?.grade) || stringValue(pm10?.grade);
		const label = airQualityLabel(grade);
		if (!label) return null;
		return {
			grade,
			label
		};
	} catch {
		return null;
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
	const parking = await getParkingCandidate(input, destination);
	if (parking) results.push(parking);
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
		const response = await loggedFetch({
			provider: 'swing',
			kind: 'api',
			operation: 'vehicles.search',
			url: new URL('/v1/vehicles/search', base),
			init: {
				method: 'POST',
				headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
				body: JSON.stringify({
					lat: input.session.location.lat,
					lng: input.session.location.lng,
					radius: 1200,
					count: 5
				}),
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

async function getApiFuseActivityCandidates(input: CandidateInput) {
	const apiKey = env.API_FUSE_API_KEY;
	if (!apiKey) return [];
	const queries = apiFuseActivityQueries(input).slice(0, 4);
	const rows = await searchMapPlacesByQueries(input, queries, apiKey, 4, 16);

	return filterActivitiesForSession(
		input,
		dedupeActivities(
			rows
				.map((row, index) => placeRowToActivity(row, index))
				.filter((candidate): candidate is ActivityCandidate => Boolean(candidate))
		)
	).slice(0, 8);
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
	let placeLookupCount = 0;
	return Promise.all(
		restaurants.slice(0, 8).map(async (restaurant) => {
			const needsPlaceLookup = restaurant.lat == null || restaurant.lng == null;
			const canLookupPlace = needsPlaceLookup && placeLookupCount < 3;
			if (canLookupPlace) placeLookupCount += 1;
			const [availability, place, shop] = await Promise.all([
				getCatchtableAvailability(input, restaurant, apiKey),
				canLookupPlace ? findKakaoPlace(input, restaurant.title, apiKey) : null,
				getCatchtableShopSummary(restaurant, apiKey)
			]);
			return {
				...restaurant,
				mapUrl: restaurant.mapUrl ?? place?.mapUrl,
				address: restaurant.address || shop?.address || place?.address,
				lat: restaurant.lat ?? place?.lat,
				lng: restaurant.lng ?? place?.lng,
				availabilityText: availability ?? restaurant.availabilityText,
				thumbnailUrl: restaurant.thumbnailUrl ?? shop?.thumbnailUrl,
				reservationHint: availability ?? restaurant.reservationHint,
				tags: [
					...new Set([
						...restaurant.tags,
						...(shop?.tags ?? []),
						...(availability ? ['예약 슬롯 확인'] : [])
					])
				]
			};
		})
	);
}

async function getApiFuseRestaurantPlaces(input: CandidateInput, apiKey: string) {
	const queries = restaurantPlaceQueries(input).slice(0, 3);
	const rows = await searchMapPlacesByQueries(input, queries, apiKey, 4, 16);

	return dedupeRestaurants(
		rows
			.map((row, index) => placeRowToRestaurant(row, index))
			.filter((candidate): candidate is RestaurantCandidate => Boolean(candidate))
	).slice(0, 8);
}

async function getYogiyoRestaurants(input: CandidateInput, apiKey: string) {
	if (input.session.location?.lat == null || input.session.location.lng == null) return [];

	const response = await loggedFetch({
		provider: 'api_fuse',
		kind: 'api',
		operation: 'yogiyo.find_restaurants',
		url: `${APIFUSE_BASE}/v1/yogiyo-api/find-restaurants`,
		init: {
			method: 'POST',
			headers: {
				authorization: `Bearer ${apiKey}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				keyword:
					input.queryPlan?.restaurantQueries[0] ??
					(input.session.companionConstraints.hasBaby ? '키즈' : '맛집'),
				category: '',
				address: input.session.location?.label ?? '',
				lat: input.session.location.lat,
				lng: input.session.location.lng,
				sort: 'distance',
				limit: 5
			}),
			signal: AbortSignal.timeout(4500)
		}
	});
	if (!response.ok) throw new Error(`Yogiyo restaurants ${response.status}`);

	const rows = arrayFromPayload((await response.json()) as { data?: unknown; items?: unknown[] });
	return rows.map((row, index): RestaurantCandidate => {
		const item = row as Record<string, unknown>;
		const minOrder = numberValue(item.min_order_amount);
		const deliveryFee = numberValue(item.delivery_fee);
		const deliveryMinutes =
			numberValue(item.estimated_delivery_minutes) ??
			numberValue(item.estimated_delivery_max_minutes);
		return {
			id: `yogiyo-${stringValue(item.shop_id) || index}`,
			title: stringValue(item.name) || '요기요 음식점',
			price: minOrder ? minOrder + (deliveryFee ?? 0) : undefined,
			source: 'api_fuse',
			outboundUrl: stringValue(item.web_url) || yogiyoSearchUrl(input.session.location?.label),
			mapUrl: kakaoSearchUrl(stringValue(item.name) || '요기요 음식점'),
			address: stringValue(item.address),
			lat: numberValue(item.lat),
			lng: numberValue(item.lng),
			availabilityText: deliveryMinutes ? `배달 예상 ${deliveryMinutes}분` : undefined,
			thumbnailUrl: thumbnailFromRow(item) || undefined,
			tags: ['요기요', '배달 fallback', ...(item.is_open === false ? ['영업 확인 필요'] : [])],
			reservationHint: deliveryMinutes ? `배달 예상 ${deliveryMinutes}분` : undefined
		};
	});
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
					shop_ref: restaurant.id,
					date: selectedDate,
					person: partyCount(input.session.situation),
					table_type: '_ALL_',
					visit_time: visitTimeForReservation(input.session)
				}),
				signal: AbortSignal.timeout(10000)
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

async function getCatchtableShopSummary(restaurant: RestaurantCandidate, apiKey: string) {
	if (!restaurant.id) return null;

	try {
		const response = await loggedFetch({
			provider: 'api_fuse',
			kind: 'api',
			operation: 'catchtable.shop',
			url: `${APIFUSE_BASE}/v1/catchtable/shop`,
			init: {
				method: 'POST',
				headers: {
					authorization: `Bearer ${apiKey}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					shop_ref: restaurant.id,
					include_reviews: false,
					review_limit: 1
				}),
				signal: AbortSignal.timeout(4500)
			}
		});
		if (!response.ok) throw new Error(`CatchTable shop ${response.status}`);

		const payload = (await response.json()) as { data?: Record<string, unknown> };
		const data = payload.data ?? {};
		const foodKind = stringValue(data.foodKind);
		const rating = numberValue(data.avgRating);
		const reviewCount = numberValue(data.reviewCount);
		return {
			address: stringValue(data.address) || undefined,
			thumbnailUrl: thumbnailFromRow(data) || undefined,
			tags: [
				foodKind,
				rating ? `평점 ${rating.toFixed(1)}` : '',
				reviewCount ? `리뷰 ${reviewCount.toLocaleString('ko-KR')}` : ''
			].filter(Boolean)
		};
	} catch {
		return null;
	}
}

async function findKakaoPlace(input: CandidateInput, query: string, apiKey: string) {
	const [kakaoRows, naverRows] = await Promise.allSettled([
		searchKakaoPlaces(input, query, apiKey, 5),
		searchNaverPlaces(input, query, apiKey, 5)
	]);
	const rows = [
		...(kakaoRows.status === 'fulfilled' ? kakaoRows.value : []),
		...(naverRows.status === 'fulfilled' ? naverRows.value : [])
	];
	const first = rows[0];
	if (!first) return null;
	return placeRowToGeo(first, query);
}

async function searchKakaoPlaces(
	input: CandidateInput,
	query: string,
	apiKey: string,
	pageSize = 5
) {
	if (input.session.location?.lat == null || input.session.location.lng == null) return [];

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
				page: 1,
				page_size: pageSize
			}),
			signal: AbortSignal.timeout(2500)
		}
	});
	if (!response.ok) throw new Error(`KakaoMap search ${response.status}`);

	return arrayFromPayload((await response.json()) as { data?: unknown; items?: unknown[] }).map(
		(row) => ({
			...(row as Record<string, unknown>),
			_provider: 'kakao'
		})
	);
}

async function searchNaverPlaces(input: CandidateInput, query: string, apiKey: string, size = 5) {
	if (input.session.location?.lat == null || input.session.location.lng == null) return [];

	const response = await loggedFetch({
		provider: 'api_fuse',
		kind: 'api',
		operation: 'navermap.search',
		url: `${APIFUSE_BASE}/v1/naver-map-api/search`,
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
				page: 1,
				size
			}),
			signal: AbortSignal.timeout(2500)
		}
	});
	if (!response.ok) throw new Error(`NaverMap search ${response.status}`);

	return arrayFromPayload((await response.json()) as { data?: unknown; items?: unknown[] }).map(
		(row) => ({
			...(row as Record<string, unknown>),
			_provider: 'naver'
		})
	);
}

async function searchMapPlacesByQueries(
	input: CandidateInput,
	queries: string[],
	apiKey: string,
	size: number,
	maxRows: number
) {
	const rows: Record<string, unknown>[] = [];
	for (const query of queries) {
		const [kakaoRows, naverRows] = await Promise.allSettled([
			searchKakaoPlaces(input, query, apiKey, size),
			searchNaverPlaces(input, query, apiKey, size)
		]);
		if (kakaoRows.status === 'fulfilled') rows.push(...kakaoRows.value);
		if (naverRows.status === 'fulfilled') rows.push(...naverRows.value);
		if (rows.length >= maxRows) break;
	}
	return rows.slice(0, maxRows);
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
		const routeBody: Record<string, string | number> = {
			origin_lat: input.session.location.lat,
			origin_lng: input.session.location.lng,
			dest_lat: destination.lat,
			dest_lng: destination.lng
		};
		if (mode === 'transit') {
			routeBody.sort = 'time';
			const departureTime = hhmmFromSession(input.session);
			if (departureTime) routeBody.departure_time = departureTime;
		}
		if (mode === 'car') routeBody.priority = 'TIME';

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
				body: JSON.stringify(routeBody),
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

async function getParkingCandidate(
	input: CandidateInput,
	destination?: GeoCandidate
): Promise<MobilityCandidate | null> {
	const apiKey = env.API_FUSE_API_KEY;
	if (!apiKey || input.session.location?.lat == null || input.session.location.lng == null)
		return null;

	try {
		const response = await loggedFetch({
			provider: 'api_fuse',
			kind: 'api',
			operation: 'modu_parking.search',
			url: `${APIFUSE_BASE}/v1/modu-parking/search-parking`,
			init: {
				method: 'POST',
				headers: {
					authorization: `Bearer ${apiKey}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					location: destination?.address ?? destination?.title ?? input.session.location.label,
					lat: destination?.lat ?? input.session.location.lat,
					lng: destination?.lng ?? input.session.location.lng
				}),
				signal: AbortSignal.timeout(3500)
			}
		});
		if (!response.ok) throw new Error(`Modu Parking ${response.status}`);

		const payload = (await response.json()) as Record<string, unknown>;
		const data = payload.data as Record<string, unknown> | undefined;
		const rows = Array.isArray(data?.items) ? (data.items as Record<string, unknown>[]) : [];
		const firstPurchasable =
			rows.find((row) => row.is_purchasable === true) ??
			rows.find((row) => row.has_realtime === true);
		if (!firstPurchasable) return null;
		const name = stringValue(firstPurchasable.parkinglot_name) || '주차장';
		const price = stringValue(firstPurchasable.price_display);
		return {
			label: price ? `주차 ${price}` : '주차 후보 확인됨',
			mode: 'car',
			routeMapUrl: routeMapUrl(input.session.location, {
				title: name,
				lat: numberValue(firstPurchasable.lat),
				lng: numberValue(firstPurchasable.lng),
				address: stringValue(firstPurchasable.address)
			}),
			detail: `${name}${price ? ` · ${price}` : ''}`,
			source: 'api_fuse'
		};
	} catch {
		return null;
	}
}

function fallbackActivities(input: CandidateInput): ActivityCandidate[] {
	const baby = input.session.companionConstraints.hasBaby;
	const freeformKeyword = freeformActivityKeyword(input.profile, input.session);
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

function thumbnailFromRow(row: Record<string, unknown>) {
	return (
		stringValue(row.thumbnailUrl) ||
		stringValue(row.thumbnail_url) ||
		stringValue(row.imageUrl) ||
		stringValue(row.image_url) ||
		stringValue(row.mainImageUrl) ||
		stringValue(row.main_image_url) ||
		imageUrlFromUnknown(row.images) ||
		imageUrlFromUnknown(row.image) ||
		imageUrlFromUnknown(row.thumbnail)
	);
}

function imageUrlFromUnknown(value: unknown): string {
	if (typeof value === 'string') return value;
	if (Array.isArray(value)) {
		for (const item of value) {
			const url = imageUrlFromUnknown(item);
			if (url) return url;
		}
		return '';
	}
	if (value && typeof value === 'object') {
		const row = value as Record<string, unknown>;
		return (
			stringValue(row.url) ||
			stringValue(row.src) ||
			stringValue(row.imageUrl) ||
			stringValue(row.image_url) ||
			stringValue(row.thumbnailUrl) ||
			stringValue(row.thumbnail_url) ||
			imageUrlFromUnknown(row.images) ||
			imageUrlFromUnknown(row.image)
		);
	}
	return '';
}

function apiFuseActivityQueries(input: CandidateInput) {
	const location = input.session.location?.label ?? input.profile.recentLocation?.label ?? '서울';
	const plannedQueries = input.queryPlan?.activityQueries ?? [];
	const freeformKeyword = freeformActivityKeyword(input.profile, input.session);
	const baby = input.session.companionConstraints.hasBaby;
	const base = baby
		? [`${location} 키즈카페`, `${location} 실내놀이터`, `${location} 유모차 실내`]
		: blocksLongActivity(input.session)
			? [`${location} 카페`, `${location} 전시`, `${location} 팝업`]
			: input.profile.activityPreferences.includes('culture')
				? [`${location} 전시`, `${location} 팝업`, `${location} 공연`]
				: [`${location} 원데이클래스`, `${location} 체험`, `${location} 산책`];
	return [
		...new Set(
			[...plannedQueries, freeformKeyword, ...base]
				.filter((value): value is string => Boolean(value))
				.filter((query) => !isBlockedForSession(input, query))
		)
	];
}

function restaurantPlaceQueries(input: CandidateInput) {
	const location = input.session.location?.label ?? input.profile.recentLocation?.label ?? '서울';
	const plannedQueries = input.queryPlan?.restaurantQueries ?? [];
	const baby = input.session.companionConstraints.hasBaby;
	const base = baby
		? [`${location} 키즈 프렌들리 카페`, `${location} 가족 식당`, `${location} 넓은 좌석 카페`]
		: blocksLongActivity(input.session)
			? [`${location} 카페`, `${location} 디저트`, `${location} 가벼운 식사`]
			: [`${location} 맛집`, `${location} 카페`, `${location} 캐주얼 다이닝`];
	return [
		...new Set([...plannedQueries, ...base].filter((query) => !isBlockedForSession(input, query)))
	];
}

function catchtableKeywords(input: CandidateInput) {
	return restaurantPlaceQueries(input).slice(0, 3);
}

function placeRowToGeo(row: Record<string, unknown>, fallbackTitle: string): GeoCandidate | null {
	const title = stringValue(row.name) || stringValue(row.placeName) || fallbackTitle;
	const lat = numberValue(row.lat) ?? numberValue(row.y) ?? numberValue(row.latitude);
	const lng = numberValue(row.lng) ?? numberValue(row.x) ?? numberValue(row.longitude);
	const address =
		stringValue(row.roadAddress) ||
		stringValue(row.road_address_name) ||
		stringValue(row.address) ||
		stringValue(row.address_name);
	const mapUrl =
		stringValue(row.naverMapUrl) ||
		stringValue(row.place_url) ||
		stringValue(row.placeUrl) ||
		stringValue(row.url) ||
		kakaoMapUrl(title, lat, lng);
	if (!title) return null;
	return { title, lat, lng, address, mapUrl };
}

function placeRowToActivity(row: Record<string, unknown>, index: number): ActivityCandidate | null {
	const geo = placeRowToGeo(row, '장소 후보');
	if (!geo?.title) return null;
	const provider = stringValue(row._provider);
	const category = stringValue(row.category);
	const id =
		stringValue(row.confirm_id) ||
		stringValue(row.id) ||
		`${provider || 'place'}-activity-${index}`;
	return {
		id,
		title: geo.title,
		source: 'api_fuse',
		outboundUrl: geo.mapUrl,
		mapUrl: geo.mapUrl,
		address: geo.address,
		lat: geo.lat,
		lng: geo.lng,
		availabilityText: '지도 장소 후보 확인됨',
		thumbnailUrl: thumbnailFromRow(row) || undefined,
		tags: [
			provider === 'naver' ? '네이버지도' : '카카오맵',
			category || '장소 후보',
			'APIFuse'
		].filter(Boolean)
	};
}

function placeRowToRestaurant(
	row: Record<string, unknown>,
	index: number
): RestaurantCandidate | null {
	const geo = placeRowToGeo(row, '식당 후보');
	if (!geo?.title) return null;
	const provider = stringValue(row._provider);
	const category = stringValue(row.category);
	const id =
		stringValue(row.confirm_id) ||
		stringValue(row.id) ||
		`${provider || 'place'}-restaurant-${index}`;
	return {
		id,
		title: geo.title,
		source: 'api_fuse',
		outboundUrl: geo.mapUrl,
		mapUrl: geo.mapUrl,
		address: geo.address,
		lat: geo.lat,
		lng: geo.lng,
		availabilityText: '지도 장소 후보 확인됨',
		thumbnailUrl: thumbnailFromRow(row) || undefined,
		tags: [
			provider === 'naver' ? '네이버지도' : '카카오맵',
			category || '맛집 후보',
			'APIFuse'
		].filter(Boolean),
		reservationHint: '지도 상세 확인'
	};
}

function dedupeActivities(candidates: ActivityCandidate[]) {
	const seen = new Set<string>();
	return candidates.filter((candidate) => {
		const key = `${candidate.title}-${candidate.address ?? ''}`.replace(/\s/g, '').toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function dedupeRestaurants(candidates: RestaurantCandidate[]) {
	const seen = new Set<string>();
	return candidates.filter((candidate) => {
		const key = `${candidate.title}-${candidate.address ?? ''}`.replace(/\s/g, '').toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function airKoreaStationName(locationLabel?: string) {
	if (!locationLabel) return '';
	const stationMatch = locationLabel.match(
		/(강남구|강동구|강북구|강서구|관악구|광진구|구로구|금천구|노원구|도봉구|동대문구|동작구|마포구|서대문구|서초구|성동구|성북구|송파구|양천구|영등포구|용산구|은평구|종로구|중구|중랑구)/
	);
	if (stationMatch?.[1]) return stationMatch[1];
	if (/성수|서울숲|뚝섬/.test(locationLabel)) return '성동구';
	if (/홍대|합정|망원|상암/.test(locationLabel)) return '마포구';
	if (/강남|역삼|삼성|압구정|청담/.test(locationLabel)) return '강남구';
	if (/잠실|송파/.test(locationLabel)) return '송파구';
	if (/종로|광화문|안국/.test(locationLabel)) return '종로구';
	if (/서울/.test(locationLabel)) return '중구';
	return '';
}

function airQualityLabel(grade: string) {
	if (grade === 'good') return '대기질 좋음';
	if (grade === 'moderate') return '대기질 보통';
	if (grade === 'bad') return '미세먼지 나쁨';
	if (grade === 'very_bad') return '미세먼지 매우 나쁨';
	return '';
}

function myrealtripSearchKeywords(input: CandidateInput) {
	const locationKeyword = input.session.location?.label.includes('서울') ? '서울' : '';
	const plannedKeywords = input.queryPlan?.myrealtripKeywords ?? [];
	const freeformKeyword = freeformActivityKeyword(input.profile, input.session);
	const preferenceKeyword = input.session.companionConstraints.hasBaby
		? '키즈'
		: blocksLongActivity(input.session)
			? '티켓'
			: input.profile.activityPreferences.includes('culture')
				? '티켓'
				: '체험';
	return [
		...new Set(
			[...plannedKeywords, locationKeyword, freeformKeyword, preferenceKeyword, '티켓']
				.filter((value): value is string => Boolean(value))
				.filter((keyword) => !isBlockedForSession(input, keyword))
		)
	];
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

function visitTimeForReservation(session: RecommendationSession) {
	return hhmmFromSession(session, ':') || '19:00';
}

function hhmmFromSession(session: RecommendationSession, separator = '') {
	const source = session.startDateTime ? new Date(session.startDateTime) : new Date();
	if (Number.isNaN(source.getTime())) return '';
	const pad = (value: number) => `${value}`.padStart(2, '0');
	return `${pad(source.getHours())}${separator}${pad(source.getMinutes())}`;
}

function kakaoSearchUrl(query: string) {
	return `https://map.kakao.com/link/search/${encodeURIComponent(query)}`;
}

function kakaoMapUrl(title: string, lat?: number, lng?: number) {
	if (lat == null || lng == null) return kakaoSearchUrl(title);
	return `https://map.kakao.com/link/map/${encodeURIComponent(title)},${lat},${lng}`;
}

function catchtableShopUrl(shopRef: string) {
	return shopRef && !shopRef.startsWith('catchtable-')
		? `https://app.catchtable.co.kr/ct/shop/${encodeURIComponent(shopRef)}`
		: 'https://app.catchtable.co.kr';
}

function yogiyoSearchUrl(location?: string) {
	const query = location ? `${location} 맛집` : '맛집';
	return `https://www.yogiyo.co.kr/mobile/#/?search=${encodeURIComponent(query)}`;
}

function routeMapUrl(_origin: RecommendationSession['location'], destination?: GeoCandidate) {
	if (!destination) return 'https://map.kakao.com';
	if (destination.lat != null && destination.lng != null) {
		return `https://map.kakao.com/link/to/${encodeURIComponent(destination.title)},${destination.lat},${destination.lng}`;
	}
	return kakaoSearchUrl(destination.address ?? destination.title);
}

function myrealtripSearchUrl(query: string) {
	return `https://www.myrealtrip.com/search?keyword=${encodeURIComponent(query)}`;
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
	const secondMatch = text.match(
		/(?:seconds|durationSeconds|duration_sec|duration|spendTime)"?\s*:\s*(\d+)/i
	);
	if (secondMatch?.[1]) return Math.round(Number(secondMatch[1]) / 60);
	return undefined;
}

function filterActivitiesForSession(input: CandidateInput, candidates: ActivityCandidate[]) {
	if (!blocksLongActivity(input.session)) return candidates;
	return candidates.filter((candidate) => !activityRejectReason(input, candidate));
}

function activityRejectReason(input: CandidateInput, candidate: ActivityCandidate) {
	if (!blocksLongActivity(input.session)) return '';
	const text = [candidate.title, candidate.address, ...candidate.tags].filter(Boolean).join(' ');
	if (isBlockedForSession(input, text)) return 'long_activity_keyword';
	if (isRemoteShortWindowCandidate(input, candidate)) return 'not_near_session_location';
	return '';
}

function isBlockedForSession(input: CandidateInput, text: string) {
	if (!blocksLongActivity(input.session)) return false;
	const excludedKeywords = input.queryPlan?.excludedKeywords ?? [];
	const normalized = text.replace(/\s/g, '').toLowerCase();
	const customBlock = excludedKeywords.some((keyword) =>
		normalized.includes(keyword.replace(/\s/g, '').toLowerCase())
	);
	return customBlock || longActivityBlockedPattern.test(text);
}

function isRemoteShortWindowCandidate(input: CandidateInput, candidate: ActivityCandidate) {
	const sessionLocation = input.session.location;
	if (!sessionLocation?.lat || !sessionLocation.lng) return false;
	const maxMeters = input.session.availableTime === 'one_hour' ? 3500 : 7000;
	if (candidate.lat != null && candidate.lng != null) {
		return (
			distanceMeters(sessionLocation.lat, sessionLocation.lng, candidate.lat, candidate.lng) >
			maxMeters
		);
	}
	const text = [candidate.title, candidate.address, ...candidate.tags].filter(Boolean).join(' ');
	if (remoteShortWindowPattern.test(text)) return true;
	if (candidate.source === 'myrealtrip') return true;
	return false;
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
	const toRadians = (value: number) => (value * Math.PI) / 180;
	const earthRadiusMeters = 6371000;
	const dLat = toRadians(lat2 - lat1);
	const dLng = toRadians(lng2 - lng1);
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
	return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function logActivityQualityGuard(
	input: CandidateInput,
	rawActivities: ActivityCandidate[],
	keptActivities: ActivityCandidate[]
) {
	if (!blocksLongActivity(input.session)) return;
	const keptKeys = new Set(
		keptActivities.map((candidate) =>
			`${candidate.title}-${candidate.address ?? ''}`.replace(/\s/g, '').toLowerCase()
		)
	);
	const rejected = rawActivities
		.map((candidate) => ({
			title: candidate.title,
			source: candidate.source,
			address: candidate.address,
			reason: activityRejectReason(input, candidate)
		}))
		.filter((candidate) => candidate.reason)
		.slice(0, 8);

	await logIntegrationEvent({
		provider: 'internal',
		kind: 'api',
		operation: 'candidate.activities.time_location_guard',
		method: 'INTERNAL',
		url: 'sai://candidate/activity-guard',
		ok: true,
		durationMs: 0,
		requestPayload: {
			sessionId: input.session.id,
			availableTime: input.session.availableTime,
			startDateTime: input.session.startDateTime,
			endDateTime: input.session.endDateTime,
			location: input.session.location,
			queryPlanSource: input.queryPlan?.source,
			excludedKeywords: input.queryPlan?.excludedKeywords
		},
		responsePayload: {
			rawCount: rawActivities.length,
			keptCount: keptActivities.length,
			rejectedCount: rawActivities.length - keptActivities.length,
			kept: keptActivities.slice(0, 8).map((candidate) => ({
				title: candidate.title,
				source: candidate.source,
				address: candidate.address
			})),
			rejected,
			droppedByDedupeOrLimit: rawActivities.length - keptKeys.size - rejected.length
		}
	});
}

function blocksLongActivity(session: RecommendationSession) {
	if (session.availableTime && !['day', 'weekend'].includes(session.availableTime)) return true;
	const start = session.startDateTime ? new Date(session.startDateTime) : null;
	const end = session.endDateTime ? new Date(session.endDateTime) : null;
	if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
	return end.getTime() > start.getTime() && end.getTime() - start.getTime() <= 300 * 60 * 1000;
}

function freeformActivityKeyword(profile: UserProfile, session: RecommendationSession) {
	const text = (profile.onboardingFreeformAnswers ?? []).map((answer) => answer.answer).join(' ');
	const rule = freeformKeywordRules.find((item) => item.pattern.test(text));
	if (!rule) return undefined;
	if (blocksLongActivity(session) && rule.shortActivity) return rule.shortActivity;
	return rule.activity;
}
