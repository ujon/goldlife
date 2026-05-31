import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { setAuthCookies } from '$lib/server/sai/auth-tokens';
import { fail, ok } from '$lib/server/sai/http';
import { getOrCreateDevUser } from '$lib/server/sai/repository';
import type { RequestHandler } from './$types';

const DEFAULT_DEV_EMAIL = 'codex-local@example.com';
const DEFAULT_DEV_PASSWORD = 'codex-local-password';

export const POST: RequestHandler = async ({ cookies, url }) => {
	if (!dev || env.DEV_AUTO_LOGIN !== 'true') {
		return json({ error: 'Not found' }, { status: 404 });
	}

	try {
		const result = await getOrCreateDevUser(
			env.DEV_AUTO_LOGIN_EMAIL || DEFAULT_DEV_EMAIL,
			env.DEV_AUTO_LOGIN_PASSWORD || DEFAULT_DEV_PASSWORD
		);
		await setAuthCookies(cookies, result.user, { secure: url.protocol === 'https:' });
		return ok(result);
	} catch (error) {
		return fail(error);
	}
};
