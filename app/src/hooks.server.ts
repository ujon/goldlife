import type { Handle } from '@sveltejs/kit';
import {
	headersToRecord,
	logIntegrationEvent,
	payloadFromRequest,
	payloadFromResponse
} from '$lib/server/sai/integration-logger';

export const handle: Handle = async ({ event, resolve }) => {
	if (!event.url.pathname.startsWith('/api')) {
		return resolve(event);
	}

	const startedAt = Date.now();
	const requestPayload = {
		headers: headersToRecord(event.request.headers),
		body: await payloadFromRequest(event.request)
	};

	try {
		const response = await resolve(event);
		await logIntegrationEvent({
			provider: 'internal',
			kind: 'api',
			operation: event.url.pathname,
			method: event.request.method,
			url: event.url.toString(),
			status: response.status,
			ok: response.ok,
			durationMs: Date.now() - startedAt,
			requestPayload,
			responsePayload: {
				headers: headersToRecord(response.headers),
				body: await payloadFromResponse(response)
			}
		});

		return response;
	} catch (error) {
		await logIntegrationEvent({
			provider: 'internal',
			kind: 'api',
			operation: event.url.pathname,
			method: event.request.method,
			url: event.url.toString(),
			durationMs: Date.now() - startedAt,
			requestPayload,
			errorMessage: error instanceof Error ? error.message : 'API request failed'
		});
		throw error;
	}
};
