import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { badRequest } from '$lib/server/sai/http';
import type { RequestHandler } from './$types';

const SUPERTONE_DEFAULT_BASE_URL = 'https://supertoneapi.com';
const SUPERTONE_DEFAULT_MODEL = 'sona_speech_2_flash';
const SUPERTONE_DEFAULT_VOICE_ID = '7c56c6a6471a12816604f0';
const SUPERTONE_DEFAULT_OUTPUT_FORMAT = 'mp3';
const SUPERTONE_MAX_TEXT_LENGTH = 300;
const TTS_NO_CACHE_HEADERS = {
	'cache-control': 'no-store, no-cache, max-age=0, must-revalidate',
	expires: '0',
	pragma: 'no-cache'
};

type TtsAudio = {
	bytes: Uint8Array;
	contentType: string;
};

class SupertoneTtsError extends Error {
	constructor(
		readonly status: number,
		detail: string
	) {
		super(`Supertone TTS failed: ${status} ${detail}`);
	}
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await readTtsRequestBody(request);
	if (body.type === 'error') return badRequest(body.message);

	const text = typeof body.data.text === 'string' ? body.data.text.trim() : '';

	if (!text) return badRequest('text is required');
	if (text.length > SUPERTONE_MAX_TEXT_LENGTH) {
		return badRequest(`text must be ${SUPERTONE_MAX_TEXT_LENGTH} characters or fewer`);
	}
	const apiKey = env.SUPERTONE_API_KEY;
	if (!apiKey) {
		return json(
			{ error: 'SUPERTONE_API_KEY is not configured' },
			{ status: 503, headers: TTS_NO_CACHE_HEADERS }
		);
	}

	const baseUrl = env.SUPERTONE_BASE_URL || SUPERTONE_DEFAULT_BASE_URL;
	const voiceId = env.SUPERTONE_VOICE_ID || SUPERTONE_DEFAULT_VOICE_ID;
	const modelId = env.SUPERTONE_MODEL || SUPERTONE_DEFAULT_MODEL;
	const outputFormat = env.SUPERTONE_OUTPUT_FORMAT || SUPERTONE_DEFAULT_OUTPUT_FORMAT;

	try {
		const audio = await fetchSupertoneTts({
			apiKey,
			baseUrl,
			voiceId,
			modelId,
			outputFormat,
			text
		});
		return ttsAudioResponse(audio);
	} catch (error) {
		console.error(error);
		return json(
			{
				error: 'Supertone TTS failed',
				status: error instanceof SupertoneTtsError ? error.status : undefined
			},
			{
				status: error instanceof SupertoneTtsError ? error.status : 502,
				headers: TTS_NO_CACHE_HEADERS
			}
		);
	}
};

async function fetchSupertoneTts({
	apiKey,
	baseUrl,
	voiceId,
	modelId,
	outputFormat,
	text
}: {
	apiKey: string;
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
			'x-sup-api-key': apiKey
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
		throw new SupertoneTtsError(response.status, detail);
	}

	return {
		bytes: new Uint8Array(await response.arrayBuffer()),
		contentType: outputFormat === 'wav' ? 'audio/wav' : 'audio/mpeg'
	};
}

function ttsAudioResponse(audio: TtsAudio) {
	return new Response(audio.bytes.slice(), {
		headers: {
			'content-type': audio.contentType,
			...TTS_NO_CACHE_HEADERS
		}
	});
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
