import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { badRequest } from '$lib/server/sai/http';
import type { RequestHandler } from './$types';

const SUPERTONE_DEFAULT_BASE_URL = 'https://supertoneapi.com';
const SUPERTONE_DEFAULT_MODEL = 'sona_speech_2_flash';
const SUPERTONE_DEFAULT_VOICE_ID = '7c56c6a6471a12816604f0';
const SUPERTONE_DEFAULT_OUTPUT_FORMAT = 'mp3';
const SUPERTONE_MAX_TEXT_LENGTH = 300;

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
	const url = new URL(`/v1/text-to-speech/${voiceId}`, baseUrl);

	let response: Response;
	try {
		response = await fetch(url, {
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
	} catch (error) {
		console.error('Supertone TTS request failed', error);
		return json({ error: 'Supertone TTS failed' }, { status: 502 });
	}

	if (!response.ok || !response.body) {
		const detail = await response.text().catch(() => '');
		console.error(`Supertone TTS failed: ${response.status} ${detail}`);
		return json({ error: 'Supertone TTS failed' }, { status: 502 });
	}

	return new Response(response.body, {
		headers: {
			'cache-control': 'no-store',
			'content-type': outputFormat === 'wav' ? 'audio/wav' : 'audio/mpeg'
		}
	});
};

async function readTtsRequestBody(request: Request) {
	let raw = '';
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
