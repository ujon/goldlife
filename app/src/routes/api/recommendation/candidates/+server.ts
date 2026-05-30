import { collectCandidates } from '$lib/server/sai/candidates';
import { badRequest, fail, ok } from '$lib/server/sai/http';
import type { RecommendationSession, UserProfile } from '$lib/sai/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as {
			profile?: UserProfile;
			session?: RecommendationSession;
		};
		if (!body.profile?.userId || !body.session?.id) {
			return badRequest('profile and session are required');
		}

		return ok(await collectCandidates({ profile: body.profile, session: body.session }));
	} catch (error) {
		return fail(error);
	}
};
