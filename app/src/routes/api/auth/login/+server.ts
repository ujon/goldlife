import { badRequest, fail, ok, unauthorized } from '$lib/server/sai/http';
import { setAuthCookies } from '$lib/server/sai/auth-tokens';
import { login } from '$lib/server/sai/repository';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, request, url }) => {
	try {
		const body = (await request.json()) as { email?: string; password?: string };
		if (!body.email || !body.password) return badRequest('email and password are required');

		const result = await login(body.email, body.password);
		if (!result) return unauthorized('email or password is invalid');

		await setAuthCookies(cookies, result.user, { secure: url.protocol === 'https:' });
		return ok(result);
	} catch (error) {
		return fail(error);
	}
};
