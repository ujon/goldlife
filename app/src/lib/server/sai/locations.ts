import { env } from '$env/dynamic/private';
import type { LocationSuggestion } from '$lib/sai/types';
import { loggedFetch } from './integration-logger';

type StandardRegionRow = {
	region_cd?: string;
	locatadd_nm?: string;
	locallow_nm?: string;
	locat_rm?: string;
};

const PUBLIC_DATA_BASE = 'https://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList';
const FALLBACK_LOCATIONS: LocationSuggestion[] = [
	{ id: 'fallback-seongsu', label: '서울 성동구 성수동', source: 'fallback' },
	{ id: 'fallback-yeonnam', label: '서울 마포구 연남동', source: 'fallback' },
	{ id: 'fallback-hongdae', label: '서울 마포구 홍대입구', source: 'fallback' },
	{ id: 'fallback-gangnam', label: '서울 강남구 강남역', source: 'fallback' },
	{ id: 'fallback-jamsil', label: '서울 송파구 잠실', source: 'fallback' },
	{ id: 'fallback-itaewon', label: '서울 용산구 이태원', source: 'fallback' },
	{ id: 'fallback-hannam', label: '서울 용산구 한남동', source: 'fallback' },
	{ id: 'fallback-bukchon', label: '서울 종로구 북촌', source: 'fallback' },
	{ id: 'fallback-haeundae', label: '부산 해운대구 해운대', source: 'fallback' },
	{ id: 'fallback-jeju', label: '제주 제주시 애월읍', source: 'fallback' }
];

export async function searchLocations(query: string): Promise<LocationSuggestion[]> {
	const normalized = normalizeLocationQuery(query);
	if (!normalized) return FALLBACK_LOCATIONS.slice(0, 5);

	const [publicDataSuggestions, fallbackSuggestions] = await Promise.all([
		searchPublicDataLocations(normalized),
		Promise.resolve(searchFallbackLocations(normalized))
	]);

	return mergeLocationSuggestions([...publicDataSuggestions, ...fallbackSuggestions]).slice(0, 6);
}

async function searchPublicDataLocations(query: string): Promise<LocationSuggestion[]> {
	const serviceKey = env.DATA_GO_KR_SERVICE_KEY;
	if (!serviceKey) return [];

	try {
		const url = publicDataUrl(serviceKey, query);

		const response = await loggedFetch({
			provider: 'public_data',
			kind: 'api',
			operation: 'standard-region-code.search',
			url,
			init: { signal: AbortSignal.timeout(2500) }
		});
		if (!response.ok) throw new Error(`Public Data ${response.status}`);

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
	return FALLBACK_LOCATIONS.filter((location) =>
		compactLocation(location.label).includes(compactQuery)
	);
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
	return query.trim().replace(/\s+/g, ' ');
}

function compactLocation(value: string) {
	return value.replace(/\s+/g, '').toLowerCase();
}
