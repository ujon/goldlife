import { badRequest, fail, ok } from '$lib/server/sai/http';
import { upsertProfile } from '$lib/server/sai/repository';
import type { UserProfile } from '$lib/sai/types';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as { profile?: UserProfile };
		if (!body.profile?.userId) return badRequest('profile.userId is required');

		await upsertProfile(body.profile);
		return ok({ saved: true });
	} catch (error) {
		return fail(error);
	}
};
