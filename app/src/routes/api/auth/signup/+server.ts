import { fail, ok, badRequest } from '$lib/server/sai/http';
import { signup } from '$lib/server/sai/repository';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as { email?: string; password?: string };
		if (!body.email || !body.password) return badRequest('email and password are required');
		return ok(await signup(body.email, body.password));
	} catch (error) {
		return fail(error);
	}
};
