import { DatabaseUnavailableError, ensureSchema, getSql } from './db';

export type IntegrationKind = 'ai' | 'api';

export type IntegrationLogEvent = {
	provider: string;
	kind: IntegrationKind;
	operation: string;
	method: string;
	url: string;
	status?: number;
	ok?: boolean;
	durationMs: number;
	requestPayload?: unknown;
	responsePayload?: unknown;
	errorMessage?: string;
};

export type LoggedFetchInput = {
	provider: string;
	kind: IntegrationKind;
	operation: string;
	url: string | URL;
	init?: RequestInit;
};

type JsonPayload =
	| null
	| string
	| number
	| boolean
	| JsonPayload[]
	| { [key: string]: JsonPayload };

const PAYLOAD_LIMIT = 12000;
const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERN =
	/(authorization|api[-_]?key|password|password_hash|passwordHash|secret|token|cookie|set-cookie|email)/i;

export async function loggedFetch(input: LoggedFetchInput) {
	const startedAt = Date.now();
	const method = input.init?.method ?? 'GET';
	const url = redactUrl(input.url.toString());
	const requestPayload = {
		headers: normalizePayload(headersToRecord(input.init?.headers)),
		body: parseBody(input.init?.body)
	};

	try {
		const response = await fetch(input.url, input.init);
		const responsePayload = await responsePayloadFromClone(response);
		await logIntegrationEvent({
			provider: input.provider,
			kind: input.kind,
			operation: input.operation,
			method,
			url,
			status: response.status,
			ok: response.ok,
			durationMs: Date.now() - startedAt,
			requestPayload,
			responsePayload
		});

		return response;
	} catch (error) {
		await logIntegrationEvent({
			provider: input.provider,
			kind: input.kind,
			operation: input.operation,
			method,
			url,
			durationMs: Date.now() - startedAt,
			requestPayload,
			errorMessage: error instanceof Error ? error.message : 'Request failed'
		});
		throw error;
	}
}

export async function logIntegrationEvent(event: IntegrationLogEvent) {
	const requestPayload = normalizePayload(event.requestPayload);
	const responsePayload = normalizePayload(event.responsePayload);
	const safeEvent: IntegrationLogEvent = {
		...event,
		url: redactUrl(event.url),
		requestPayload,
		responsePayload,
		errorMessage: event.errorMessage?.slice(0, 1000)
	};

	console.info(
		'[sai.integration]',
		JSON.stringify({
			provider: safeEvent.provider,
			kind: safeEvent.kind,
			operation: safeEvent.operation,
			method: safeEvent.method,
			url: safeEvent.url,
			status: safeEvent.status,
			ok: safeEvent.ok,
			durationMs: safeEvent.durationMs,
			errorMessage: safeEvent.errorMessage
		})
	);

	try {
		await ensureSchema();
		const sql = getSql();
		await sql`
			insert into sai.integration_logs (
				provider,
				kind,
				operation,
				method,
				url,
				status,
				ok,
				duration_ms,
				request_payload,
				response_payload,
				error_message
			)
			values (
				${safeEvent.provider},
				${safeEvent.kind},
				${safeEvent.operation},
				${safeEvent.method},
				${safeEvent.url},
				${safeEvent.status ?? null},
				${safeEvent.ok ?? null},
				${safeEvent.durationMs},
				${requestPayload === undefined ? null : sql.json(requestPayload)},
				${responsePayload === undefined ? null : sql.json(responsePayload)},
				${safeEvent.errorMessage ?? null}
			)
		`;
	} catch (error) {
		if (error instanceof DatabaseUnavailableError) return;
		console.warn(
			'[sai.integration] failed to persist log',
			error instanceof Error ? error.message : error
		);
	}
}

export async function payloadFromRequest(request: Request) {
	const contentType = request.headers.get('content-type') ?? '';
	if (!request.body || !hasReadableBody(request.method)) return null;

	try {
		const text = await request.clone().text();
		return payloadFromText(text, contentType);
	} catch {
		return { unreadable: true };
	}
}

export async function payloadFromResponse(response: Response) {
	const contentType = response.headers.get('content-type') ?? '';

	try {
		const text = await response.clone().text();
		return payloadFromText(text, contentType);
	} catch {
		return { unreadable: true };
	}
}

export function headersToRecord(headers: HeadersInit | undefined) {
	if (!headers) return {};

	if (headers instanceof Headers) {
		return Object.fromEntries(headers.entries());
	}

	if (Array.isArray(headers)) {
		return Object.fromEntries(headers);
	}

	return headers;
}

function hasReadableBody(method: string) {
	return !['GET', 'HEAD'].includes(method.toUpperCase());
}

async function responsePayloadFromClone(response: Response) {
	const contentType = response.headers.get('content-type') ?? '';
	const text = await response
		.clone()
		.text()
		.catch(() => '');
	return payloadFromText(text, contentType);
}

function parseBody(body: BodyInit | null | undefined) {
	if (!body) return null;
	if (typeof body === 'string') return payloadFromText(body, 'application/json');
	if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
	if (body instanceof FormData) return { formData: Object.fromEntries(body.entries()) };
	return { bodyType: body.constructor.name };
}

function payloadFromText(text: string, contentType: string) {
	if (!text) return null;
	const trimmed = text.trim();
	const looksJson =
		contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[');

	if (looksJson) {
		try {
			return JSON.parse(trimmed) as unknown;
		} catch {
			return trimmed;
		}
	}

	return trimmed;
}

function normalizePayload(payload: unknown): JsonPayload | undefined {
	if (payload === undefined) return undefined;
	const redacted = redactSecrets(payload);
	const serialized = JSON.stringify(redacted);
	if (!serialized) return null;
	if (serialized.length <= PAYLOAD_LIMIT) return JSON.parse(serialized) as JsonPayload;

	return {
		truncated: true,
		characterCount: serialized.length,
		preview: serialized.slice(0, PAYLOAD_LIMIT)
	};
}

function redactSecrets(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redactSecrets);

	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactSecrets(item)
			])
		);
	}

	return value;
}

function redactUrl(value: string) {
	try {
		const url = new URL(value);
		for (const key of [...url.searchParams.keys()]) {
			if (SENSITIVE_KEY_PATTERN.test(key)) url.searchParams.set(key, REDACTED);
		}
		return url.toString();
	} catch {
		return value;
	}
}
