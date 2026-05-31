import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { badRequest } from '$lib/server/sai/http';
import type { RequestHandler } from './$types';

const SUPERTONE_DEFAULT_BASE_URL = 'https://supertoneapi.com';
const SUPERTONE_DEFAULT_MODEL = 'sona_speech_2_flash';
const SUPERTONE_DEFAULT_VOICE_ID = '7c56c6a6471a12816604f0';
const SUPERTONE_DEFAULT_OUTPUT_FORMAT = 'mp3';
const SUPERTONE_MAX_TEXT_LENGTH = 300;
const SUPERTONE_TTS_CACHE_DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const SUPERTONE_TTS_CACHE_DEFAULT_MAX_ENTRIES = 100;

type TtsCacheEntry = {
	bytes: Uint8Array;
	contentType: string;
	expiresAt: number;
};

const ttsCache = new Map<string, TtsCacheEntry>();
const pendingTtsRequests = new Map<string, Promise<TtsCacheEntry>>();

export const POST: RequestHandler = async ({ request }) => {
	const body = await readTtsRequestBody(request);
	if (body.type === 'error') return badRequest(body.message);

	const text = typeof body.data.text === 'string' ? body.data.text.trim() : '';

	if (!text) return badRequest('text is required');
	if (text.length > SUPERTONE_MAX_TEXT_LENGTH) {
		return badRequest(`text must be ${SUPERTONE_MAX_TEXT_LENGTH} characters or fewer`);
	}
	if (!env.SUPERTONE_API_KEY)
		return json({ error: 'SUPERTONE_API_KEY is not configured' }, { status: 503 });

	const baseUrl = env.SUPERTONE_BASE_URL || SUPERTONE_DEFAULT_BASE_URL;
	const voiceId = env.SUPERTONE_VOICE_ID || SUPERTONE_DEFAULT_VOICE_ID;
	const modelId = env.SUPERTONE_MODEL || SUPERTONE_DEFAULT_MODEL;
	const outputFormat = env.SUPERTONE_OUTPUT_FORMAT || SUPERTONE_DEFAULT_OUTPUT_FORMAT;
	const cacheKey = JSON.stringify({
		baseUrl,
		voiceId,
		modelId,
		outputFormat,
		language: 'ko',
		text
	});

	pruneExpiredTtsCache();

	const cached = ttsCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		ttsCache.delete(cacheKey);
		ttsCache.set(cacheKey, cached);
		return ttsAudioResponse(cached, 'HIT');
	}
	if (cached) ttsCache.delete(cacheKey);

	try {
		const pending =
			pendingTtsRequests.get(cacheKey) ??
			fetchSupertoneTts({ baseUrl, voiceId, modelId, outputFormat, text });
		pendingTtsRequests.set(cacheKey, pending);

		const entry = await pending;
		pendingTtsRequests.delete(cacheKey);

		ttsCache.set(cacheKey, entry);
		pruneTtsCache(SUPERTONE_TTS_CACHE_DEFAULT_MAX_ENTRIES);

		return ttsAudioResponse(entry, 'MISS');
	} catch (error) {
		pendingTtsRequests.delete(cacheKey);
		console.error(error);
		return json({ error: 'Supertone TTS failed' }, { status: 502 });
	}
};

async function fetchSupertoneTts({
	baseUrl,
	voiceId,
	modelId,
	outputFormat,
	text
}: {
	baseUrl: string;
	voiceId: string;
	modelId: string;
	outputFormat: string;
	text: string;
}) {
	const url = new URL(`/v1/text-to-speech/${voiceId}`, baseUrl);
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-sup-api-key': env.SUPERTONE_API_KEY
		},
		body: JSON.stringify({
			text,
			language: 'ko',
			model: modelId,
			output_format: outputFormat
		})
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => '');
		throw new Error(`Supertone TTS failed: ${response.status} ${detail}`);
	}

	return {
		bytes: new Uint8Array(await response.arrayBuffer()),
		contentType: outputFormat === 'wav' ? 'audio/wav' : 'audio/mpeg',
		expiresAt: Date.now() + SUPERTONE_TTS_CACHE_DEFAULT_TTL_SECONDS * 1000
	};
}

function ttsAudioResponse(entry: TtsCacheEntry, cacheStatus: 'HIT' | 'MISS') {
	return new Response(entry.bytes.slice(), {
		headers: {
			'cache-control': 'no-store',
			'content-type': entry.contentType,
			'x-tts-cache': cacheStatus
		}
	});
}

function pruneExpiredTtsCache() {
	const now = Date.now();
	for (const [key, entry] of ttsCache) {
		if (entry.expiresAt <= now) ttsCache.delete(key);
	}
}

function pruneTtsCache(maxEntries: number) {
	while (ttsCache.size > maxEntries) {
		const oldestKey = ttsCache.keys().next().value;
		if (!oldestKey) return;
		ttsCache.delete(oldestKey);
	}
}

async function readTtsRequestBody(request: Request) {
	let raw: string;
	try {
		raw = await request.text();
	} catch {
		return { type: 'error' as const, message: 'request body is invalid' };
	}

	if (!raw.trim()) return { type: 'ok' as const, data: {} as { text?: unknown } };

	try {
		const data = JSON.parse(raw) as unknown;
		if (!data || typeof data !== 'object' || Array.isArray(data)) {
			return { type: 'ok' as const, data: {} as { text?: unknown } };
		}
		return { type: 'ok' as const, data: data as { text?: unknown } };
	} catch {
		return { type: 'error' as const, message: 'request body must be valid JSON' };
	}
}
