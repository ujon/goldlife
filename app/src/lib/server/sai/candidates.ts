import { env } from '$env/dynamic/private';
import type {
	ActivityCandidate,
	CandidateBundle,
	CandidateQueryPlan,
	FlightCandidate,
	MobilityCandidate,
	OperatingStatus,
	ProviderStatus,
	RestaurantCandidate,
	WeatherCandidate
} from '$lib/sai/candidates';
import {
	availableSessionMinutes,
	hasFlightIntent,
	partyCount,
	sessionRequestText
} from '$lib/sai/recommendations';
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
type CandidateSlot = 'activity' | 'food' | 'fallback';
type OperatingInfo = {
	operatingStatus: OperatingStatus;
	travelMinutes: number;
	travelTimeText: string;
	travelDistanceMeters?: number;
	routeMapUrl?: string;
	arrivalTimeText: string;
	openingHoursText?: string;
	label: string;
};
type AvailabilityCheck = OperatingInfo & {
	text: string;
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
	const [trendResult, activityResult, restaurantResult, weatherResult, flightResult] =
		await Promise.all([
			getTrendKeywords(statuses),
			getActivities(input, statuses),
			getRestaurants(input, statuses),
			getWeather(input),
			getFlights(input, statuses)
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
		flights: flightResult,
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
	const activities = prioritizeByOperatingStatus(
		dropTravelTooLong(
			dropClosedAtArrival(filterActivitiesForSession(input, rawActivities)),
			input.session
		)
	).slice(0, 8);
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
				sourceName: '마이리얼트립',
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
	]);
	const arrivalSafeRestaurants = prioritizeByOperatingStatus(
		dropTravelTooLong(dropClosedAtArrival(restaurants), input.session)
	).slice(0, 8);

	statuses.push({
		provider: 'api_fuse',
		configured: true,
		ok: arrivalSafeRestaurants.length > 0,
		fallbackReason: arrivalSafeRestaurants.length
			? undefined
			: 'API Fuse restaurants returned no candidates'
	});

	return arrivalSafeRestaurants.length ? arrivalSafeRestaurants : fallback;
}

async function getFlights(
	input: CandidateInput,
	statuses: ProviderStatus[]
): Promise<FlightCandidate[]> {
	if (!hasFlightIntent(input.session)) return [];

	const apiKey = env.API_FUSE_API_KEY;
	const fallback = fallbackFlightCandidates(input);
	if (!apiKey) {
		statuses.push({
			provider: 'api_fuse',
			configured: false,
			ok: false,
			fallbackReason: 'API_FUSE_API_KEY is not configured for naver-flight'
		});
		return fallback;
	}

	const plans = flightSearchPlans(input).slice(0, 2);
	const results = await Promise.allSettled(plans.map((plan) => searchFlights(input, apiKey, plan)));
	const flights = dedupeFlights(
		results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
	).slice(0, 3);

	statuses.push({
		provider: 'api_fuse',
		configured: true,
		ok: flights.length > 0,
		fallbackReason: flights.length ? undefined : 'Naver Flight returned no candidates'
	});

	return flights.length ? flights : fallback;
}

type FlightSearchPlan = {
	departure: string;
	arrival: string;
	departureDate: string;
	returnDate?: string;
	destinationLabel: string;
};

async function searchFlights(
	input: CandidateInput,
	apiKey: string,
	plan: FlightSearchPlan
): Promise<FlightCandidate[]> {
	const roundTrip = Boolean(plan.returnDate);
	const response = await loggedFetch({
		provider: 'api_fuse',
		kind: 'api',
		operation: roundTrip ? 'naver_flight.search_flights' : 'naver_flight.search_oneway',
		url: `${APIFUSE_BASE}/v1/naver-flight/${roundTrip ? 'search-flights' : 'search-oneway-flights'}`,
		init: {
			method: 'POST',
			headers: {
				authorization: `Bearer ${apiKey}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				departure: plan.departure,
				arrival: plan.arrival,
				departureDate: plan.departureDate,
				airlines: [],
				maxResults: 5,
				...(plan.returnDate ? { returnDate: plan.returnDate } : {})
			}),
			signal: AbortSignal.timeout(12000)
		}
	});
	if (!response.ok) throw new Error(`Naver Flight ${response.status}`);

	const payload = (await response.json()) as { data?: Record<string, unknown> };
	const data = payload.data ?? {};
	const rows = Array.isArray(data.flights) ? (data.flights as Record<string, unknown>[]) : [];
	return rows.map((row, index) => flightRowToCandidate(input, row, plan, index));
}

function flightRowToCandidate(
	input: CandidateInput,
	row: Record<string, unknown>,
	plan: FlightSearchPlan,
	index: number
): FlightCandidate {
	const outbound = objectValue(row.outbound);
	const inbound = objectValue(row.inbound);
	const fare = objectValue(row.fare);
	const flightNumber = stringValue(outbound.flight) || `flight-${index + 1}`;
	const airlineText = stringValue(outbound.airlineName) || stringValue(outbound.airlineCode);
	const departureTime = stringValue(outbound.depTime);
	const arrivalTime = stringValue(outbound.arrTime);
	const outboundMinutes = numberValue(outbound.durationMin) ?? 0;
	const inboundMinutes = numberValue(inbound.durationMin) ?? 0;
	const durationMinutes = outboundMinutes + inboundMinutes || outboundMinutes || undefined;
	const price =
		numberValue(fare.bestCardFare) ??
		numberValue(fare.generalFare) ??
		numberValue(fare.promotionFare);
	const curationTags = Array.isArray(row.curationTags)
		? row.curationTags.filter((tag): tag is string => typeof tag === 'string')
		: [];
	const title = `${plan.departure}→${plan.arrival} ${plan.destinationLabel} 항공편`;

	return {
		id: `flight-${plan.departure}-${plan.arrival}-${flightNumber}-${index}`,
		title,
		price,
		source: 'api_fuse',
		sourceName: '네이버항공',
		outboundUrl: naverFlightUrl(plan),
		reservationUrl: naverFlightUrl(plan),
		departureAirport: plan.departure,
		arrivalAirport: plan.arrival,
		departureDate: plan.departureDate,
		returnDate: plan.returnDate,
		departureTimeText: departureTime ? `${plan.departureDate} ${departureTime} 출발` : undefined,
		arrivalTimeText: arrivalTime ? `${arrivalTime} 도착` : undefined,
		durationMinutes,
		durationText: durationMinutes ? `비행 약 ${formatFlightDuration(durationMinutes)}` : undefined,
		airlineText: airlineText || undefined,
		tags: [
			'항공편',
			'네이버항공',
			...(plan.returnDate ? ['왕복'] : ['편도']),
			...curationTags,
			...timeFitFlightTags(input)
		]
	};
}

function fallbackFlightCandidates(input: CandidateInput): FlightCandidate[] {
	return flightSearchPlans(input)
		.slice(0, 2)
		.map((plan, index) => ({
			id: `fallback-flight-${plan.arrival}-${index}`,
			title: `${plan.departure}→${plan.arrival} ${plan.destinationLabel} 항공편 확인`,
			source: 'sai' as const,
			sourceName: '네이버항공 검색',
			outboundUrl: naverFlightUrl(plan),
			reservationUrl: naverFlightUrl(plan),
			departureAirport: plan.departure,
			arrivalAirport: plan.arrival,
			departureDate: plan.departureDate,
			returnDate: plan.returnDate,
			tags: ['항공편', '검색 링크', ...timeFitFlightTags(input)]
		}));
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
			sourceName: '캐치테이블',
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
				.map((row, index) => placeRowToActivity(input, row, index))
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
			const isMyrealtrip = candidate.source === 'myrealtrip';
			const [booking, place] = await Promise.all([
				getMyrealtripAvailability(input, candidate, myrealtripApiKey),
				apifuseApiKey ? findCandidatePlace(input, candidate, apifuseApiKey) : null
			]);
			const enriched = withOperatingInfo(
				{
					...candidate,
					reservationUrl: candidate.outboundUrl,
					sourceName: candidate.sourceName ?? sourceNameForCandidate(candidate),
					mapUrl: place?.mapUrl ?? (isMyrealtrip ? undefined : candidate.mapUrl),
					address: place?.address ?? candidate.address,
					lat: place?.lat ?? candidate.lat,
					lng: place?.lng ?? candidate.lng,
					availabilityText: booking ?? candidate.availabilityText,
					tags: [...new Set([...candidate.tags, ...(booking ? ['예약 가능성 확인'] : [])])]
				},
				operatingInfoForCandidate(input, place ?? candidate, 'activity')
			);
			return isMyrealtrip && !place ? stripUnverifiedMapInfo(enriched) : enriched;
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
			const operatingInfo =
				availability ?? operatingInfoForCandidate(input, place ?? restaurant, 'food');
			return withOperatingInfo(
				{
					...restaurant,
					mapUrl: restaurant.mapUrl ?? place?.mapUrl,
					address: restaurant.address || shop?.address || place?.address,
					lat: restaurant.lat ?? place?.lat,
					lng: restaurant.lng ?? place?.lng,
					availabilityText: availability?.text ?? restaurant.availabilityText,
					thumbnailUrl: restaurant.thumbnailUrl ?? shop?.thumbnailUrl,
					reservationHint: availability?.text ?? restaurant.reservationHint,
					tags: [
						...new Set([
							...restaurant.tags,
							...(shop?.tags ?? []),
							...(availability ? ['예약 슬롯 확인'] : [])
						])
					]
				},
				operatingInfo
			);
		})
	);
}

async function getApiFuseRestaurantPlaces(input: CandidateInput, apiKey: string) {
	const queries = restaurantPlaceQueries(input).slice(0, 3);
	const rows = await searchMapPlacesByQueries(input, queries, apiKey, 4, 16);

	return dedupeRestaurants(
		rows
			.map((row, index) => placeRowToRestaurant(input, row, index))
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
		const operatingInfo = operatingInfoForRow(input, item, 'food');
		return withOperatingInfo(
			{
				id: `yogiyo-${stringValue(item.shop_id) || index}`,
				title: stringValue(item.name) || '요기요 음식점',
				price: minOrder ? minOrder + (deliveryFee ?? 0) : undefined,
				source: 'api_fuse',
				sourceName: '요기요',
				outboundUrl: stringValue(item.web_url) || yogiyoSearchUrl(input.session.location?.label),
				mapUrl: kakaoSearchUrl(stringValue(item.name) || '요기요 음식점'),
				address: stringValue(item.address),
				lat: numberValue(item.lat),
				lng: numberValue(item.lng),
				availabilityText: deliveryMinutes ? `배달 예상 ${deliveryMinutes}분` : undefined,
				thumbnailUrl: thumbnailFromRow(item) || undefined,
				tags: ['요기요', '배달 fallback'],
				reservationHint: deliveryMinutes ? `배달 예상 ${deliveryMinutes}분` : undefined
			},
			operatingInfo
		);
	});
}

async function getMyrealtripAvailability(
	input: CandidateInput,
	candidate: ActivityCandidate,
	apiKey: string
) {
	const arrival = arrivalDateForCandidate(input, candidate, 'activity');
	const selectedDate = selectedDateForDate(arrival);
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
): Promise<AvailabilityCheck | undefined> {
	if (!restaurant.id) return undefined;
	const arrival = arrivalDateForCandidate(input, restaurant, 'food');
	const travelInfo = travelInfoForCandidate(input, restaurant, 'food');
	const selectedDate = selectedDateForDate(arrival);
	const visitTime = hhmmFromDate(arrival, ':');
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
					visit_time: visitTime
				}),
				signal: AbortSignal.timeout(10000)
			}
		});
		if (!response.ok) throw new Error(`CatchTable availability ${response.status}`);

		const payload = await response.json();
		return catchtableAvailabilityInfo(payload, selectedDate, visitTime, arrival, travelInfo);
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
	const detail = await getPlaceDetail(first, apiKey);
	return placeRowToGeo(detail ? { ...first, ...detail } : first, query);
}

async function findCandidatePlace(
	input: CandidateInput,
	candidate: ActivityCandidate,
	apiKey: string
) {
	const query =
		candidate.source === 'myrealtrip'
			? [input.session.location?.label, candidate.title].filter(Boolean).join(' ')
			: candidate.title;
	const place = await findKakaoPlace(input, query, apiKey);
	if (!place) return null;
	if (candidate.source !== 'myrealtrip') return place;
	return isReliableMyrealtripPlace(input, candidate, place) ? place : null;
}

function isReliableMyrealtripPlace(
	input: CandidateInput,
	candidate: ActivityCandidate,
	place: GeoCandidate
) {
	if (place.lat == null || place.lng == null) return false;
	const placeText = normalizeSearchText([place.title, place.address].filter(Boolean).join(' '));
	const titleTokens = searchableTokens(candidate.title);
	const hasTitleOverlap = titleTokens.some((token) => placeText.includes(token));
	const locationTokens = searchableTokens(input.session.location?.label ?? '').slice(0, 3);
	const hasLocationOverlap =
		!locationTokens.length ||
		locationTokens.some((token) => normalizeSearchText(place.address ?? '').includes(token));
	return hasTitleOverlap && hasLocationOverlap;
}

function stripUnverifiedMapInfo(candidate: ActivityCandidate): ActivityCandidate {
	return {
		...candidate,
		mapUrl: undefined,
		address: undefined,
		lat: undefined,
		lng: undefined,
		travelMinutes: undefined,
		travelTimeText: undefined,
		travelDistanceMeters: undefined,
		routeMapUrl: undefined,
		arrivalTimeText: undefined,
		operatingStatus: 'unknown',
		openingHoursText: undefined,
		availabilityText: candidate.availabilityText ?? '마이리얼트립 상세에서 위치 확인 필요',
		tags: [...new Set([...candidate.tags, '위치 상세 확인 필요'])]
	};
}

function sourceNameForCandidate(
	candidate: Pick<ActivityCandidate, 'source' | 'sourceName' | 'tags'>
) {
	if (candidate.sourceName) return candidate.sourceName;
	if (candidate.source === 'myrealtrip') return '마이리얼트립';
	if (candidate.tags.includes('네이버지도')) return '네이버지도';
	if (candidate.tags.includes('카카오맵')) return '카카오맵';
	if (candidate.source === 'genrank') return 'GenRank 트렌드';
	return '카카오맵 검색';
}

function normalizeSearchText(text: string) {
	return text.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
}

function searchableTokens(text: string) {
	const stopWords = new Set([
		'서울',
		'경기',
		'부산',
		'대구',
		'인천',
		'광주',
		'대전',
		'울산',
		'세종',
		'제주',
		'원데이',
		'클래스',
		'티켓',
		'입장권',
		'체험',
		'투어',
		'예약',
		'후보'
	]);
	return text
		.split(/[^\p{L}\p{N}]+/u)
		.map((token) => token.trim().toLowerCase())
		.filter((token) => token.length >= 2 && !stopWords.has(token));
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
	return enrichPlaceRowsWithDetails(rows.slice(0, maxRows), apiKey);
}

async function enrichPlaceRowsWithDetails(rows: Record<string, unknown>[], apiKey: string) {
	let detailLookupCount = 0;
	const maxDetailLookups = 8;
	return Promise.all(
		rows.map(async (row) => {
			if (detailLookupCount >= maxDetailLookups) return row;
			const detailId = placeDetailId(row);
			if (!detailId) return row;
			detailLookupCount += 1;
			const detail = await getPlaceDetail(row, apiKey);
			return detail ? { ...row, ...detail } : row;
		})
	);
}

function placeDetailId(row: Record<string, unknown>) {
	const provider = stringValue(row._provider);
	if (provider === 'naver') return stringValue(row.id);
	return stringValue(row.confirm_id);
}

async function getPlaceDetail(row: Record<string, unknown>, apiKey: string) {
	const provider = stringValue(row._provider);
	const detailId = placeDetailId(row);
	if (!detailId) return null;

	try {
		const isNaver = provider === 'naver';
		const response = await loggedFetch({
			provider: 'api_fuse',
			kind: 'api',
			operation: isNaver ? 'navermap.place' : 'kakaomap.place',
			url: `${APIFUSE_BASE}/v1/${isNaver ? 'naver-map-api' : 'kakaomap-api'}/place`,
			init: {
				method: 'POST',
				headers: {
					authorization: `Bearer ${apiKey}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify(isNaver ? { place_id: detailId } : { confirm_id: detailId }),
				signal: AbortSignal.timeout(2500)
			}
		});
		if (!response.ok) return null;

		const payload = (await response.json()) as { data?: Record<string, unknown> };
		const data = payload.data ?? {};
		if (isNaver) {
			const place = data.place as Record<string, unknown> | null | undefined;
			return place ?? null;
		}
		return data;
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
		withOperatingInfo(
			{
				id: 'fallback-activity-1',
				title: baby
					? '영유아 동반 실내 체험관'
					: freeformKeyword
						? `${freeformKeyword} 후보`
						: '실내 원데이 클래스',
				price: baby ? 18000 : 36000,
				source: 'sai',
				sourceName: '카카오맵 검색',
				outboundUrl: 'https://map.kakao.com',
				mapUrl: kakaoSearchUrl(baby ? '영유아 동반 실내 체험관' : '실내 원데이 클래스'),
				tags: baby ? ['유모차', '실내'] : ['온보딩 답변 반영', '예약 후보']
			},
			operatingInfoForCandidate(input, {}, 'activity')
		),
		withOperatingInfo(
			{
				id: 'fallback-activity-2',
				title: baby ? '실내 식물원 산책' : '짧은 전시 또는 팝업',
				price: baby ? 16000 : 22000,
				source: 'sai',
				sourceName: '카카오맵 검색',
				outboundUrl: 'https://map.kakao.com',
				mapUrl: kakaoSearchUrl(baby ? '실내 식물원 산책' : '짧은 전시 팝업'),
				tags: ['날씨 fallback', '짧은 동선']
			},
			operatingInfoForCandidate(input, {}, 'activity')
		)
	];
}

function fallbackRestaurants(input: CandidateInput): RestaurantCandidate[] {
	const baby = input.session.companionConstraints.hasBaby;
	return [
		withOperatingInfo(
			{
				id: 'fallback-restaurant-1',
				title: baby ? '넓은 좌석 키즈 프렌들리 카페' : '캐주얼 파스타 다이닝',
				price: baby ? 32000 : 42000,
				source: 'sai',
				sourceName: '캐치테이블 검색',
				outboundUrl: 'https://app.catchtable.co.kr',
				reservationUrl: 'https://app.catchtable.co.kr',
				mapUrl: kakaoSearchUrl(baby ? '키즈 프렌들리 카페' : '캐주얼 파스타 다이닝'),
				tags: baby ? ['수유실 확인', '주차'] : ['예약 후보', '맛집']
			},
			operatingInfoForCandidate(input, {}, 'food')
		)
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

function objectValue(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function numberValue(value: unknown) {
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value.trim());
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown) {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		if (/^(true|open|영업|운영)$/i.test(value.trim())) return true;
		if (/^(false|closed|휴무|종료)$/i.test(value.trim())) return false;
	}
	return undefined;
}

function withOperatingInfo<T extends { availabilityText?: string; tags: string[] }>(
	candidate: T,
	info: OperatingInfo
) {
	return {
		...candidate,
		availabilityText: appendUniqueText(candidate.availabilityText, info.label),
		travelMinutes: info.travelMinutes,
		travelTimeText: info.travelTimeText,
		travelDistanceMeters: info.travelDistanceMeters,
		routeMapUrl: info.routeMapUrl,
		operatingStatus: info.operatingStatus,
		arrivalTimeText: info.arrivalTimeText,
		openingHoursText: info.openingHoursText,
		tags: [...new Set([...candidate.tags, operatingStatusTag(info.operatingStatus)])]
	};
}

function operatingInfoForRow(
	input: CandidateInput,
	row: Record<string, unknown>,
	slot: CandidateSlot
): OperatingInfo {
	return operatingInfoForCandidate(input, row, slot, row);
}

function operatingInfoForCandidate(
	input: CandidateInput,
	candidate: { title?: string; address?: string; lat?: number; lng?: number },
	slot: CandidateSlot,
	row?: Record<string, unknown>
): OperatingInfo {
	const travelInfo = travelInfoForCandidate(input, candidate, slot);
	const arrival = arrivalDateForCandidate(input, candidate, slot);
	const arrivalTimeText = formatArrivalTime(arrival);
	const openingHoursText = row ? openingHoursTextFromRow(row, arrival) : undefined;
	const hoursStatus = row ? operatingStatusFromHours(row, arrival) : undefined;
	const currentStatus = row ? operatingStatusFromCurrentStatus(row, arrival) : undefined;
	const operatingStatus = hoursStatus ?? currentStatus ?? 'unknown';
	return {
		operatingStatus,
		...travelInfo,
		arrivalTimeText,
		openingHoursText,
		label: operatingInfoLabel(operatingStatus, arrivalTimeText, openingHoursText)
	};
}

function catchtableAvailabilityInfo(
	payload: unknown,
	selectedDate: string,
	visitTime: string,
	arrival: Date,
	travelInfo: Pick<
		OperatingInfo,
		'travelMinutes' | 'travelTimeText' | 'travelDistanceMeters' | 'routeMapUrl'
	>
): AvailabilityCheck {
	const data =
		payload && typeof payload === 'object'
			? ((payload as { data?: Record<string, unknown> }).data ?? {})
			: {};
	const slots = Array.isArray(data.time_slots)
		? data.time_slots.filter((slot): slot is string => typeof slot === 'string')
		: [];
	const nearestSlot = nearestTimeSlot(slots, visitTime);
	const arrivalTimeText = formatArrivalTime(arrival);
	const openingHoursText = slots.length
		? `예약 가능 시간 ${slots.slice(0, 5).join(', ')}`
		: undefined;

	if (nearestSlot && Math.abs(minutesFromTime(nearestSlot) - minutesFromTime(visitTime)) <= 45) {
		const text = `${selectedDate} ${nearestSlot} 예약 가능`;
		return {
			operatingStatus: 'open_at_arrival',
			...travelInfo,
			arrivalTimeText,
			openingHoursText,
			label: `${arrivalTimeText} 운영 확인`,
			text
		};
	}

	if (slots.length) {
		const text = `${selectedDate} ${visitTime} 근처 예약 확인 필요`;
		return {
			operatingStatus: 'unknown',
			...travelInfo,
			arrivalTimeText,
			openingHoursText,
			label: `${arrivalTimeText} 운영 확인 필요`,
			text
		};
	}

	return {
		operatingStatus: 'unknown',
		...travelInfo,
		arrivalTimeText,
		label: `${arrivalTimeText} 운영 확인 필요`,
		text: `${selectedDate} 예약 페이지 확인`
	};
}

function nearestTimeSlot(slots: string[], targetTime: string) {
	const targetMinutes = minutesFromTime(targetTime);
	return slots
		.map((slot) => ({ slot, diff: Math.abs(minutesFromTime(slot) - targetMinutes) }))
		.filter((item) => Number.isFinite(item.diff))
		.sort((a, b) => a.diff - b.diff)[0]?.slot;
}

function operatingStatusFromHours(row: Record<string, unknown>, arrival: Date) {
	const businessHours = row.businessHours ?? row.business_hours ?? row.openingHours;
	if (Array.isArray(businessHours)) return operatingStatusFromBusinessHours(businessHours, arrival);
	const text = openingHoursTextFromRow(row, arrival);
	if (!text) return undefined;
	return operatingStatusFromHoursText(text, arrival);
}

function operatingStatusFromBusinessHours(hours: unknown[], arrival: Date) {
	const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
	const arrivalDay = dayNames[kstDateParts(arrival).day];
	const rows = hours
		.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
		.filter((item) => {
			const day = stringValue(item.day);
			return !day || day.includes('매일') || day.includes('오늘') || day.includes(arrivalDay);
		});
	if (!rows.length) return undefined;
	if (rows.some((item) => item.isHoliday === true)) return 'closed_at_arrival' as const;
	for (const row of rows) {
		const open = stringValue(row.open);
		const close = stringValue(row.close);
		if (!open || !close) continue;
		if (isTimeInWindow(kstMinutes(arrival), minutesFromTime(open), minutesFromTime(close))) {
			return 'open_at_arrival' as const;
		}
	}
	return rows.some((row) => stringValue(row.open) && stringValue(row.close))
		? ('closed_at_arrival' as const)
		: undefined;
}

function operatingStatusFromCurrentStatus(row: Record<string, unknown>, arrival: Date) {
	const statusText = [
		stringValue(row.status),
		stringValue(row.currentStatus),
		stringValue(row.currentStatusDetail),
		stringValue(row.open_status_code)
	].join(' ');
	const openNow =
		booleanValue(row.is_open) ??
		booleanValue(row.open) ??
		(/OPEN|영업\s*중|운영\s*중/i.test(statusText)
			? true
			: /CLOSED|휴무|영업\s*종료|운영\s*종료/i.test(statusText)
				? false
				: undefined);
	if (openNow == null) return undefined;
	const minutesUntilArrival = Math.round((arrival.getTime() - Date.now()) / 60000);
	if (minutesUntilArrival > 90) return undefined;
	return openNow ? ('open_at_arrival' as const) : ('closed_at_arrival' as const);
}

function openingHoursTextFromRow(row: Record<string, unknown>, arrival: Date) {
	const direct =
		stringValue(row.openingHours) ||
		stringValue(row.opening_hours) ||
		stringValue(row.business_hours) ||
		stringValue(row.operatingHours) ||
		stringValue(row.operationTime) ||
		stringValue(row.hours);
	if (direct) return direct;
	const businessHours = row.businessHours;
	if (!Array.isArray(businessHours)) return undefined;
	const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
	const arrivalDay = dayNames[kstDateParts(arrival).day];
	const rows = businessHours.filter((item): item is Record<string, unknown> => {
		if (!item || typeof item !== 'object') return false;
		const day = stringValue(item.day);
		return !day || day.includes('매일') || day.includes('오늘') || day.includes(arrivalDay);
	});
	return rows
		.map((item) => {
			const day = stringValue(item.day);
			if (item.isHoliday === true) return day ? `${day} 휴무` : '휴무';
			const open = stringValue(item.open);
			const close = stringValue(item.close);
			if (!open || !close) return day;
			return `${day ? `${day} ` : ''}${open}-${close}`;
		})
		.filter(Boolean)
		.join(', ');
}

function operatingStatusFromHoursText(text: string, arrival: Date): OperatingStatus | undefined {
	const windows = [
		...text.matchAll(
			/(?:(오전|오후)\s*)?(\d{1,2})(?::(\d{2}))?\s*[~-]\s*(?:(오전|오후)\s*)?(\d{1,2})(?::(\d{2}))?/g
		)
	];
	if (!windows.length) return undefined;
	const arrivalMinutes = kstMinutes(arrival);
	const openWindow = windows.some((match) => {
		const open = minutesFromMatch(match[1], match[2], match[3]);
		const close = minutesFromMatch(match[4], match[5], match[6]);
		return isTimeInWindow(arrivalMinutes, open, close);
	});
	return openWindow ? 'open_at_arrival' : 'closed_at_arrival';
}

function minutesFromMatch(ampm: string | undefined, hourValue?: string, minuteValue?: string) {
	let hour = Number(hourValue ?? 0);
	const minute = Number(minuteValue ?? 0);
	if (ampm === '오후' && hour < 12) hour += 12;
	if (ampm === '오전' && hour === 12) hour = 0;
	return hour * 60 + minute;
}

function isTimeInWindow(current: number, open: number, close: number) {
	if (!Number.isFinite(open) || !Number.isFinite(close)) return false;
	if (close <= open) return current >= open || current <= close;
	return current >= open && current <= close;
}

function arrivalDateForCandidate(
	input: CandidateInput,
	candidate: { title?: string; address?: string; lat?: number; lng?: number },
	slot: CandidateSlot
) {
	const base = sessionStartDate(input.session);
	const stageOffset = slot === 'food' ? plannedFoodOffsetMinutes(input.session) : 0;
	const travelOffset = travelInfoForCandidate(input, candidate, slot).travelMinutes;
	const offset = slot === 'food' ? Math.max(stageOffset, travelOffset) : travelOffset;
	return new Date(base.getTime() + offset * 60000);
}

function travelInfoForCandidate(
	input: CandidateInput,
	candidate: { title?: string; address?: string; lat?: number; lng?: number },
	slot: CandidateSlot
): Pick<
	OperatingInfo,
	'travelMinutes' | 'travelTimeText' | 'travelDistanceMeters' | 'routeMapUrl'
> {
	const minutes = estimateTravelMinutes(input, candidate, slot);
	const distance = travelDistanceMeters(input, candidate);
	const destination =
		candidate.title || candidate.address
			? {
					title: candidate.title ?? candidate.address ?? '도착지',
					lat: candidate.lat,
					lng: candidate.lng,
					address: candidate.address
				}
			: undefined;
	return {
		travelMinutes: minutes,
		travelTimeText: `${transportLabel(transportModeForSession(input.session))} 약 ${minutes}분`,
		travelDistanceMeters: distance,
		routeMapUrl: routeMapUrl(input.session.location, destination)
	};
}

function sessionStartDate(session: RecommendationSession) {
	const source = session.startDateTime ? new Date(session.startDateTime) : new Date();
	return Number.isNaN(source.getTime()) ? new Date() : source;
}

function plannedFoodOffsetMinutes(session: RecommendationSession) {
	if (session.availableTime === 'one_hour') return 30;
	if (session.availableTime === 'two_three') return 75;
	if (session.availableTime === 'day' || session.availableTime === 'weekend') return 150;
	return 105;
}

function estimateTravelMinutes(
	input: CandidateInput,
	candidate: { lat?: number; lng?: number },
	slot: CandidateSlot
) {
	const origin = input.session.location;
	if (!origin?.lat || !origin.lng || candidate.lat == null || candidate.lng == null) {
		return slot === 'food' ? 20 : 12;
	}
	const distance = distanceMeters(origin.lat, origin.lng, candidate.lat, candidate.lng);
	if (input.session.companionConstraints.hasBaby) return clampMinutes(distance / 420 + 8, 8, 55);
	if (input.session.availableTime === 'one_hour' && distance <= 1600) {
		return clampMinutes(distance / 75, 5, 25);
	}
	return clampMinutes(distance / 360 + 8, 8, 60);
}

function travelDistanceMeters(input: CandidateInput, candidate: { lat?: number; lng?: number }) {
	const origin = input.session.location;
	if (!origin?.lat || !origin.lng || candidate.lat == null || candidate.lng == null)
		return undefined;
	return Math.round(distanceMeters(origin.lat, origin.lng, candidate.lat, candidate.lng));
}

function transportModeForSession(
	session: RecommendationSession
): NonNullable<MobilityCandidate['mode']> {
	if (session.companionConstraints.hasBaby) return 'car';
	if (session.availableTime === 'one_hour') return 'walk';
	return 'transit';
}

function clampMinutes(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, Math.round(value)));
}

function formatArrivalTime(date: Date) {
	return `도착 예상 ${hhmmFromDate(date, ':')}`;
}

function selectedDateForDate(source: Date) {
	if (Number.isNaN(source.getTime())) return '';
	const { year, month, date } = kstDateParts(source);
	return `${year}-${`${month}`.padStart(2, '0')}-${`${date}`.padStart(2, '0')}`;
}

function hhmmFromDate(source: Date, separator = '') {
	const { hour, minute } = kstDateParts(source);
	return `${`${hour}`.padStart(2, '0')}${separator}${`${minute}`.padStart(2, '0')}`;
}

function kstDateParts(source: Date) {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Seoul',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
		weekday: 'short'
	}).formatToParts(source);
	const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
	const dayMap: Record<string, number> = {
		Sun: 0,
		Mon: 1,
		Tue: 2,
		Wed: 3,
		Thu: 4,
		Fri: 5,
		Sat: 6
	};
	return {
		year: Number(value('year')),
		month: Number(value('month')),
		date: Number(value('day')),
		hour: Number(value('hour')),
		minute: Number(value('minute')),
		day: dayMap[value('weekday')] ?? 0
	};
}

function kstMinutes(source: Date) {
	const { hour, minute } = kstDateParts(source);
	return hour * 60 + minute;
}

function minutesFromTime(value: string) {
	const match = value.match(/(\d{1,2})(?::(\d{2}))?/);
	if (!match) return Number.NaN;
	return Number(match[1]) * 60 + Number(match[2] ?? 0);
}

function operatingInfoLabel(
	status: OperatingStatus,
	arrivalTimeText: string,
	openingHoursText?: string
) {
	if (status === 'open_at_arrival') return `${arrivalTimeText} 운영 확인`;
	if (status === 'closed_at_arrival') return `${arrivalTimeText} 영업 종료 가능`;
	return openingHoursText
		? `${arrivalTimeText} 운영 시간 확인 필요`
		: `${arrivalTimeText} 운영 확인 필요`;
}

function operatingStatusTag(status: OperatingStatus) {
	if (status === 'open_at_arrival') return '도착 시간 운영 확인';
	if (status === 'closed_at_arrival') return '도착 시간 영업 종료 가능';
	return '운영 시간 확인 필요';
}

function appendUniqueText(...values: Array<string | undefined>) {
	const seen = new Set<string>();
	return values
		.flatMap((value) => (value ? value.split(' · ') : []))
		.filter((value) => {
			const key = value.replace(/\s/g, '').toLowerCase();
			if (!key || seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.join(' · ');
}

function prioritizeByOperatingStatus<
	T extends { operatingStatus?: OperatingStatus; score?: number; travelMinutes?: number }
>(candidates: T[]) {
	const priority: Record<OperatingStatus, number> = {
		open_at_arrival: 0,
		unknown: 1,
		closed_at_arrival: 2
	};
	return [...candidates].sort((a, b) => {
		const statusDiff =
			priority[a.operatingStatus ?? 'unknown'] - priority[b.operatingStatus ?? 'unknown'];
		if (statusDiff !== 0) return statusDiff;
		const travelDiff = travelSortValue(a) - travelSortValue(b);
		if (travelDiff !== 0) return travelDiff;
		return (b.score ?? 0) - (a.score ?? 0);
	});
}

function dropClosedAtArrival<T extends { operatingStatus?: OperatingStatus }>(candidates: T[]) {
	const openOrUnknown = candidates.filter(
		(candidate) => candidate.operatingStatus !== 'closed_at_arrival'
	);
	return openOrUnknown.length ? openOrUnknown : [];
}

function dropTravelTooLong<T extends { travelMinutes?: number }>(
	candidates: T[],
	session: RecommendationSession
) {
	const limit = maxTravelMinutes(session);
	return candidates.filter((candidate) => (candidate.travelMinutes ?? 0) <= limit);
}

function travelSortValue(candidate: { travelMinutes?: number }) {
	return candidate.travelMinutes ?? Number.MAX_SAFE_INTEGER;
}

function maxTravelMinutes(session: RecommendationSession) {
	const explicitWindow = availableWindowMinutes(session);
	if (explicitWindow) return Math.max(15, Math.min(75, Math.floor(explicitWindow * 0.35)));
	if (session.availableTime === 'one_hour') return 25;
	if (session.availableTime === 'two_three') return 45;
	if (session.availableTime === 'half_day') return 60;
	return 90;
}

function availableWindowMinutes(session: RecommendationSession) {
	const start = session.startDateTime ? new Date(session.startDateTime) : null;
	const end = session.endDateTime ? new Date(session.endDateTime) : null;
	if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
		return undefined;
	const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
	return minutes > 0 ? minutes : undefined;
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

function mapProviderLabel(provider: string) {
	if (provider === 'naver') return '네이버지도';
	return '카카오맵';
}

function placeRowToActivity(
	input: CandidateInput,
	row: Record<string, unknown>,
	index: number
): ActivityCandidate | null {
	const geo = placeRowToGeo(row, '장소 후보');
	if (!geo?.title) return null;
	const provider = stringValue(row._provider);
	const category = stringValue(row.category);
	const id =
		stringValue(row.confirm_id) ||
		stringValue(row.id) ||
		`${provider || 'place'}-activity-${index}`;
	return withOperatingInfo(
		{
			id,
			title: geo.title,
			source: 'api_fuse' as const,
			sourceName: mapProviderLabel(provider),
			outboundUrl: geo.mapUrl,
			mapUrl: geo.mapUrl,
			address: geo.address,
			lat: geo.lat,
			lng: geo.lng,
			availabilityText: '지도 장소 후보 확인됨',
			thumbnailUrl: thumbnailFromRow(row) || undefined,
			tags: [mapProviderLabel(provider), category || '장소 후보', '장소 검색'].filter(Boolean)
		},
		operatingInfoForRow(input, row, 'activity')
	);
}

function placeRowToRestaurant(
	input: CandidateInput,
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
	return withOperatingInfo(
		{
			id,
			title: geo.title,
			source: 'api_fuse' as const,
			sourceName: mapProviderLabel(provider),
			outboundUrl: geo.mapUrl,
			mapUrl: geo.mapUrl,
			address: geo.address,
			lat: geo.lat,
			lng: geo.lng,
			availabilityText: '지도 장소 후보 확인됨',
			thumbnailUrl: thumbnailFromRow(row) || undefined,
			tags: [mapProviderLabel(provider), category || '맛집 후보', '장소 검색'].filter(Boolean),
			reservationHint: '지도 상세 확인'
		},
		operatingInfoForRow(input, row, 'food')
	);
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

function dedupeFlights(candidates: FlightCandidate[]) {
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

function flightSearchPlans(input: CandidateInput): FlightSearchPlan[] {
	const requestText = sessionRequestText(input.session);
	const departure = departureAirportForLocation(
		input.session.location?.label ?? input.profile.recentLocation?.label ?? ''
	);
	const destinations = flightDestinationsForText(requestText);
	const departureDate = flightDepartureDate(input.session);
	const returnDate = flightReturnDate(input.session, departureDate);

	return destinations.map((destination) => ({
		departure,
		arrival: destination.airport,
		destinationLabel: destination.label,
		departureDate,
		returnDate
	}));
}

function departureAirportForLocation(location: string) {
	if (/부산|김해|경남|울산/.test(location)) return 'PUS';
	if (/제주/.test(location)) return 'CJU';
	if (/김포/.test(location)) return 'GMP';
	return 'ICN';
}

function flightDestinationsForText(text: string) {
	const normalized = text.replace(/\s/g, '');
	if (/오사카|간사이|kix/i.test(normalized)) return [{ airport: 'KIX', label: '오사카' }];
	if (/후쿠오카|fuk/i.test(normalized)) return [{ airport: 'FUK', label: '후쿠오카' }];
	if (/도쿄|나리타|일본|nrt/i.test(normalized)) return [{ airport: 'NRT', label: '도쿄' }];
	if (/대만|타이베이|타오위안|tpe/i.test(normalized))
		return [{ airport: 'TPE', label: '타이베이' }];
	if (/방콕|태국|bkk/i.test(normalized)) return [{ airport: 'BKK', label: '방콕' }];
	if (/싱가포르|sin/i.test(normalized)) return [{ airport: 'SIN', label: '싱가포르' }];
	if (/베트남|다낭|danang|dad/i.test(normalized)) return [{ airport: 'DAD', label: '다낭' }];
	if (/홍콩|hkg/i.test(normalized)) return [{ airport: 'HKG', label: '홍콩' }];
	return [
		{ airport: 'FUK', label: '후쿠오카' },
		{ airport: 'NRT', label: '도쿄' }
	];
}

function flightDepartureDate(session: RecommendationSession) {
	const start = session.startDateTime ? new Date(session.startDateTime) : tomorrow();
	const source = Number.isNaN(start.getTime()) || start.getTime() < Date.now() ? tomorrow() : start;
	return selectedDateForDate(source);
}

function flightReturnDate(session: RecommendationSession, departureDate: string) {
	const start = dateFromYmd(departureDate);
	const end = session.endDateTime ? new Date(session.endDateTime) : null;
	if (
		end &&
		!Number.isNaN(end.getTime()) &&
		end.getTime() - start.getTime() >= 18 * 60 * 60 * 1000
	) {
		return selectedDateForDate(end);
	}
	if (session.availableTime === 'weekend') return selectedDateForDate(addDays(start, 2));
	if (session.availableTime === 'day') return selectedDateForDate(addDays(start, 1));
	return undefined;
}

function tomorrow() {
	return addDays(new Date(), 1);
}

function addDays(source: Date, days: number) {
	const next = new Date(source);
	next.setDate(next.getDate() + days);
	return next;
}

function dateFromYmd(value: string) {
	const [year, month, day] = value.split('-').map(Number);
	return new Date(year, (month ?? 1) - 1, day ?? 1, 9, 0, 0);
}

function formatFlightDuration(minutes: number) {
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (!hours) return `${rest}분`;
	if (!rest) return `${hours}시간`;
	return `${hours}시간 ${rest}분`;
}

function timeFitFlightTags(input: CandidateInput) {
	const availableMinutes = availableSessionMinutes(input.session);
	if (!availableMinutes) return ['장거리 요청 반영'];
	if (availableMinutes >= 420) return ['사용 시간 크게 활용'];
	return ['시간 확인 필요'];
}

function firstGeoCandidate(candidates: GeoCandidate[]) {
	return candidates.find((candidate) => candidate.lat != null && candidate.lng != null);
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

function naverFlightUrl(plan: FlightSearchPlan) {
	const query = `${plan.departure} ${plan.arrival} ${plan.departureDate} 항공권`;
	return `https://flight.naver.com/flights/international/${plan.departure}-${plan.arrival}-${plan.departureDate}${plan.returnDate ? `/${plan.arrival}-${plan.departure}-${plan.returnDate}` : ''}?adult=1&fareType=Y&query=${encodeURIComponent(query)}`;
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
	if (mode === 'flight') return '항공';
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
	if (
		candidate.travelMinutes != null &&
		candidate.travelMinutes > maxTravelMinutes(input.session)
	) {
		return 'travel_time_too_long';
	}
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
	const currentRequestText = sessionRequestText(session);
	const text =
		currentRequestText ||
		(profile.onboardingFreeformAnswers ?? []).map((answer) => answer.answer).join(' ');
	if (hasFlightIntent(session)) return '공항 항공편';
	const rule = freeformKeywordRules.find((item) => item.pattern.test(text));
	if (!rule) return undefined;
	if (blocksLongActivity(session) && rule.shortActivity) return rule.shortActivity;
	return rule.activity;
}
