import { clearAuthCookies } from '$lib/server/sai/auth-tokens';
import { fail, ok } from '$lib/server/sai/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, url }) => {
	try {
		clearAuthCookies(cookies, { secure: url.protocol === 'https:' });
		return ok({ loggedOut: true });
	} catch (error) {
		return fail(error);
	}
};
