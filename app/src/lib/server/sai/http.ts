import { json } from '@sveltejs/kit';
import { DatabaseUnavailableError } from './db';

export function ok<T>(body: T) {
	return json(body);
}

export function fail(error: unknown) {
	if (error instanceof DatabaseUnavailableError) {
		return json({ error: error.message }, { status: 503 });
	}

	if (error instanceof Error && /duplicate key value/.test(error.message)) {
		return json({ error: 'Already exists' }, { status: 409 });
	}

	console.error(error);
	return json({ error: 'Internal server error' }, { status: 500 });
}

export function badRequest(message: string) {
	return json({ error: message }, { status: 400 });
}

export function unauthorized(message = 'Unauthorized') {
	return json({ error: message }, { status: 401 });
}
