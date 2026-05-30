import { badRequest, fail, ok, unauthorized } from '$lib/server/sai/http';
import { login } from '$lib/server/sai/repository';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as { email?: string; password?: string };
		if (!body.email || !body.password) return badRequest('email and password are required');

		const result = await login(body.email, body.password);
		if (!result) return unauthorized('email or password is invalid');

		return ok(result);
	} catch (error) {
		return fail(error);
	}
};
