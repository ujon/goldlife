import { env } from '$env/dynamic/private';
import type { LocationSuggestion } from '$lib/sai/types';
import { loggedFetch } from './integration-logger';

type StandardRegionRow = {
	region_cd?: string;
	locatadd_nm?: string;
	locallow_nm?: string;
	locat_rm?: string;
};

type RegionCodeRow = {
	code?: string;
	name?: string;
};

const PUBLIC_DATA_BASE = 'https://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList';
const REGION_CODE_BASE = 'https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes';
const LOCATION_SUGGESTION_LIMIT = 8;
const REGION_CODE_PREFIXES = [
	'11',
	'26',
	'27',
	'28',
	'29',
	'30',
	'31',
	'36',
	'41',
	'43',
	'44',
	'46',
	'47',
	'48',
	'50',
	'51',
	'52'
];
const REGION_PREFIX_ALIASES = [
	{ prefix: '11', aliases: ['서울'] },
	{ prefix: '26', aliases: ['부산'] },
	{ prefix: '27', aliases: ['대구'] },
	{ prefix: '28', aliases: ['인천'] },
	{ prefix: '29', aliases: ['광주'] },
	{ prefix: '30', aliases: ['대전'] },
	{ prefix: '31', aliases: ['울산'] },
	{ prefix: '36', aliases: ['세종'] },
	{ prefix: '41', aliases: ['경기'] },
	{ prefix: '43', aliases: ['충북', '충청북도'] },
	{ prefix: '44', aliases: ['충남', '충청남도'] },
	{ prefix: '46', aliases: ['전남', '전라남도'] },
	{ prefix: '47', aliases: ['경북', '경상북도'] },
	{ prefix: '48', aliases: ['경남', '경상남도'] },
	{ prefix: '50', aliases: ['제주'] },
	{ prefix: '51', aliases: ['강원'] },
	{ prefix: '52', aliases: ['전북', '전라북도'] }
];
const FALLBACK_LOCATIONS: LocationSuggestion[] = [
	{ id: 'fallback-seongsu', label: '서울 성동구 성수동', source: 'fallback' },
	{ id: 'fallback-yeonnam', label: '서울 마포구 연남동', source: 'fallback' },
	{ id: 'fallback-hongdae', label: '서울 마포구 홍대입구', source: 'fallback' },
	{ id: 'fallback-gangnam', label: '서울 강남구 강남역', source: 'fallback' },
	{ id: 'fallback-jamsil', label: '서울 송파구 잠실', source: 'fallback' },
	{ id: 'fallback-itaewon', label: '서울 용산구 이태원', source: 'fallback' },
	{ id: 'fallback-hannam', label: '서울 용산구 한남동', source: 'fallback' },
	{ id: 'fallback-bukchon', label: '서울 종로구 북촌', source: 'fallback' },
	{ id: 'fallback-pangyo', label: '경기 성남시 분당구 판교', source: 'fallback' },
	{ id: 'fallback-jeongja', label: '경기 성남시 분당구 정자동', source: 'fallback' },
	{ id: 'fallback-seohyeon', label: '경기 성남시 분당구 서현동', source: 'fallback' },
	{ id: 'fallback-sunae', label: '경기 성남시 분당구 수내동', source: 'fallback' },
	{ id: 'fallback-moran', label: '경기 성남시 중원구 성남동', source: 'fallback' },
	{ id: 'fallback-wirye', label: '경기 성남시 수정구 위례', source: 'fallback' },
	{ id: 'fallback-suwon', label: '경기 수원시 팔달구 행궁동', source: 'fallback' },
	{ id: 'fallback-yongin', label: '경기 용인시 수지구 성복동', source: 'fallback' },
	{ id: 'fallback-goyang', label: '경기 고양시 일산동구 정발산동', source: 'fallback' },
	{ id: 'fallback-bucheon', label: '경기 부천시 원미구 중동', source: 'fallback' },
	{ id: 'fallback-anyang', label: '경기 안양시 동안구 범계', source: 'fallback' },
	{ id: 'fallback-hanam', label: '경기 하남시 미사', source: 'fallback' },
	{ id: 'fallback-incheon-songdo', label: '인천 연수구 송도동', source: 'fallback' },
	{ id: 'fallback-haeundae', label: '부산 해운대구 해운대', source: 'fallback' },
	{ id: 'fallback-daegu-dongseongro', label: '대구 중구 동성로', source: 'fallback' },
	{ id: 'fallback-daejeon-dunsan', label: '대전 서구 둔산동', source: 'fallback' },
	{ id: 'fallback-gwangju-chungjangro', label: '광주 동구 충장로', source: 'fallback' },
	{ id: 'fallback-jeju', label: '제주 제주시 애월읍', source: 'fallback' }
];
const regionCodeRowsByPrefix = new Map<string, Promise<RegionCodeRow[]>>();
let publicDataDisabled = false;

export async function searchLocations(query: string): Promise<LocationSuggestion[]> {
	const rawQuery = normalizeWhitespace(query);
	const normalized = normalizeLocationQuery(rawQuery);
	if (!normalized) return FALLBACK_LOCATIONS.slice(0, 5);
	const canSearchNationwide = compactLocation(normalized).length >= 2;

	const [regionCodeSuggestions, publicDataSuggestions, fallbackSuggestions] = await Promise.all([
		canSearchNationwide ? searchRegionCodeLocations(normalized) : Promise.resolve([]),
		canSearchNationwide ? searchPublicDataLocations(normalized, rawQuery) : Promise.resolve([]),
		Promise.resolve(searchFallbackLocations(normalized))
	]);

	return mergeLocationSuggestions([
		...regionCodeSuggestions,
		...publicDataSuggestions,
		...fallbackSuggestions
	]).slice(0, LOCATION_SUGGESTION_LIMIT);
}

async function searchPublicDataLocations(
	query: string,
	rawQuery = query
): Promise<LocationSuggestion[]> {
	const serviceKey = env.DATA_GO_KR_SERVICE_KEY;
	if (!serviceKey || publicDataDisabled) return [];

	const queryVariants = buildPublicDataQueryVariants(rawQuery, query);
	const variantResults = await Promise.all(
		queryVariants.map((queryVariant) => searchPublicDataLocationVariant(serviceKey, queryVariant))
	);

	return mergeLocationSuggestions(variantResults.flat());
}

async function searchPublicDataLocationVariant(
	serviceKey: string,
	query: string
): Promise<LocationSuggestion[]> {
	try {
		const url = publicDataUrl(serviceKey, query);

		const response = await loggedFetch({
			provider: 'public_data',
			kind: 'api',
			operation: 'standard-region-code.search',
			url,
			init: { signal: AbortSignal.timeout(2500) }
		});
		if (!response.ok) {
			if (response.status === 401 || response.status === 403) publicDataDisabled = true;
			throw new Error(`Public Data ${response.status}`);
		}

		const payload = (await response.json()) as unknown;
		return extractStandardRegionRows(payload)
			.filter((row) => isActiveRegion(row))
			.map((row, index): LocationSuggestion => {
				const label = row.locatadd_nm?.trim() || row.locallow_nm?.trim() || query;
				return {
					id: row.region_cd || `public-data-${index}-${label}`,
					label,
					description: row.locallow_nm?.trim() || undefined,
					source: 'public_data'
				};
			})
			.filter((suggestion) => suggestion.label.length > 0);
	} catch {
		return [];
	}
}

async function searchRegionCodeLocations(query: string): Promise<LocationSuggestion[]> {
	const compactQuery = compactLocation(query);
	const queryTokens = locationTokens(query);
	const prefixes = regionCodePrefixesForQuery(query);
	const settledRows = await Promise.allSettled(prefixes.map((prefix) => getRegionCodeRows(prefix)));
	const rows = settledRows.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));

	return rows
		.map((row, index) => {
			const rawLabel = displayRegionName(row.name ?? '');
			const label = regionUnitLabel(rawLabel);
			const score = Math.max(
				locationLabelMatchScore(rawLabel, compactQuery, queryTokens),
				locationLabelMatchScore(label, compactQuery, queryTokens)
			);

			return { row, index, label, score };
		})
		.filter((item) => item.score > 0 && isSelectableRegion(item.label))
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.map(
			(item): LocationSuggestion => ({
				id: item.row.code ? `region-code-${item.row.code}` : `region-code-${item.index}`,
				label: item.label,
				source: 'region_code'
			})
		);
}

function getRegionCodeRows(prefix: string) {
	const cached = regionCodeRowsByPrefix.get(prefix);
	if (cached) return cached;

	const pending = fetchRegionCodeRows(prefix).catch(() => []);
	regionCodeRowsByPrefix.set(prefix, pending);
	return pending;
}

async function fetchRegionCodeRows(prefix: string): Promise<RegionCodeRow[]> {
	const url = new URL(REGION_CODE_BASE);
	url.search = new URLSearchParams({
		regcode_pattern: `${prefix}*`,
		is_ignore_zero: 'true'
	}).toString();

	const response = await loggedFetch({
		provider: 'region_code',
		kind: 'api',
		operation: 'region-code.prefix',
		url,
		init: { signal: AbortSignal.timeout(2500) }
	});
	if (!response.ok) throw new Error(`Region code ${response.status}`);

	const payload = (await response.json()) as { regcodes?: unknown };
	if (!Array.isArray(payload.regcodes)) return [];

	return payload.regcodes.filter((row): row is RegionCodeRow => {
		if (!row || typeof row !== 'object') return false;
		return typeof (row as RegionCodeRow).name === 'string';
	});
}

function publicDataUrl(serviceKey: string, query: string) {
	const url = new URL(PUBLIC_DATA_BASE);
	const params = new URLSearchParams({
		type: 'json',
		pageNo: '1',
		numOfRows: '20',
		locatadd_nm: query
	});
	const normalizedKey = serviceKey.includes('%') ? serviceKey : encodeURIComponent(serviceKey);
	url.search = `serviceKey=${normalizedKey}&${params.toString()}`;
	return url;
}

function extractStandardRegionRows(payload: unknown): StandardRegionRow[] {
	if (!payload || typeof payload !== 'object') return [];
	const source = payload as Record<string, unknown>;
	const groups = Array.isArray(source.StanReginCd) ? source.StanReginCd : [];
	const rowGroup = groups.find(
		(group) => group && typeof group === 'object' && Array.isArray((group as { row?: unknown }).row)
	) as { row?: unknown } | undefined;

	return Array.isArray(rowGroup?.row) ? (rowGroup.row as StandardRegionRow[]) : [];
}

function isActiveRegion(row: StandardRegionRow) {
	const name = row.locatadd_nm?.trim();
	if (!name) return false;
	return !/폐지|말소|삭제/.test(row.locat_rm ?? '');
}

function searchFallbackLocations(query: string) {
	const compactQuery = compactLocation(query);
	const queryTokens = locationTokens(query);

	return FALLBACK_LOCATIONS.map((location, index) => ({
		index,
		location,
		score: locationMatchScore(location, compactQuery, queryTokens)
	}))
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.map((item) => item.location);
}

function locationMatchScore(
	location: LocationSuggestion,
	compactQuery: string,
	queryTokens: string[]
) {
	return locationLabelMatchScore(location.label, compactQuery, queryTokens);
}

function locationLabelMatchScore(label: string, compactQuery: string, queryTokens: string[]) {
	const compactLabel = compactLocation(label);
	if (compactLabel === compactQuery) return 100;
	if (compactLabel.includes(compactQuery)) return 80;
	if (compactQuery.includes(compactLabel)) return 70;

	const labelTokens = locationTokens(label);
	const matchedTokens = queryTokens.filter((queryToken) =>
		labelTokens.some(
			(labelToken) => labelToken.includes(queryToken) || queryToken.includes(labelToken)
		)
	);
	if (queryTokens.length > 1 && matchedTokens.length < queryTokens.length) return 0;

	return matchedTokens.length ? matchedTokens.length * 10 : 0;
}

function mergeLocationSuggestions(suggestions: LocationSuggestion[]) {
	const seen = new Set<string>();
	const merged: LocationSuggestion[] = [];

	for (const suggestion of suggestions) {
		const key = compactLocation(suggestion.label);
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(suggestion);
	}

	return merged;
}

function normalizeLocationQuery(query: string) {
	return normalizeAdministrativeNames(normalizeWhitespace(query));
}

function compactLocation(value: string) {
	return normalizeAdministrativeNames(value).replace(/\s+/g, '').toLowerCase();
}

function locationTokens(value: string) {
	return normalizeLocationQuery(value).split(/\s+/).map(compactLocation).filter(Boolean);
}

function normalizeWhitespace(value: string) {
	return value.trim().replace(/\s+/g, ' ');
}

function buildPublicDataQueryVariants(rawQuery: string, normalizedQuery: string) {
	const variants = [rawQuery, normalizedQuery, expandAdministrativeNames(normalizedQuery)]
		.map(normalizeWhitespace)
		.filter(Boolean);

	return Array.from(new Set(variants));
}

function regionCodePrefixesForQuery(query: string) {
	const compactQuery = compactLocation(query);
	const matchedPrefixes = REGION_PREFIX_ALIASES.filter((region) =>
		region.aliases.some((alias) => compactQuery.includes(compactLocation(alias)))
	).map((region) => region.prefix);

	return matchedPrefixes.length ? matchedPrefixes : REGION_CODE_PREFIXES;
}

function displayRegionName(value: string) {
	return normalizeLocationQuery(value);
}

function regionUnitLabel(value: string) {
	const tokens = value.split(/\s+/).filter(Boolean);
	const last = tokens.at(-1);
	const previous = tokens.at(-2);

	if (last && previous && /리$/.test(last) && /(읍|면)$/.test(previous)) {
		return tokens.slice(0, -1).join(' ');
	}

	return tokens.join(' ');
}

function isSelectableRegion(value: string) {
	const last = value.split(/\s+/).filter(Boolean).at(-1) ?? '';
	return /(시|군|구|동|읍|면|\d가|가)$/.test(last);
}

function normalizeAdministrativeNames(value: string) {
	return value
		.replace(/서울특별시/g, '서울')
		.replace(/부산광역시/g, '부산')
		.replace(/대구광역시/g, '대구')
		.replace(/인천광역시/g, '인천')
		.replace(/광주광역시/g, '광주')
		.replace(/대전광역시/g, '대전')
		.replace(/울산광역시/g, '울산')
		.replace(/세종특별자치시/g, '세종')
		.replace(/경기도/g, '경기')
		.replace(/강원특별자치도|강원도/g, '강원')
		.replace(/충청북도/g, '충북')
		.replace(/충청남도/g, '충남')
		.replace(/전북특별자치도|전라북도/g, '전북')
		.replace(/전라남도/g, '전남')
		.replace(/경상북도/g, '경북')
		.replace(/경상남도/g, '경남')
		.replace(/제주특별자치도/g, '제주');
}

function expandAdministrativeNames(value: string) {
	return value
		.replace(/^서울(?=\s|$)/, '서울특별시')
		.replace(/^부산(?=\s|$)/, '부산광역시')
		.replace(/^대구(?=\s|$)/, '대구광역시')
		.replace(/^인천(?=\s|$)/, '인천광역시')
		.replace(/^광주(?=\s|$)/, '광주광역시')
		.replace(/^대전(?=\s|$)/, '대전광역시')
		.replace(/^울산(?=\s|$)/, '울산광역시')
		.replace(/^세종(?=\s|$)/, '세종특별자치시')
		.replace(/^경기(?=\s|$)/, '경기도')
		.replace(/^강원(?=\s|$)/, '강원특별자치도')
		.replace(/^충북(?=\s|$)/, '충청북도')
		.replace(/^충남(?=\s|$)/, '충청남도')
		.replace(/^전북(?=\s|$)/, '전북특별자치도')
		.replace(/^전남(?=\s|$)/, '전라남도')
		.replace(/^경북(?=\s|$)/, '경상북도')
		.replace(/^경남(?=\s|$)/, '경상남도')
		.replace(/^제주(?=\s|$)/, '제주특별자치도');
}
