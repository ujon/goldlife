import { generateFollowups } from '$lib/server/sai/followups';
import { badRequest, fail, ok } from '$lib/server/sai/http';
import type { RecommendationHistoryItem, RecommendationSession, UserProfile } from '$lib/sai/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as {
			profile?: UserProfile;
			session?: RecommendationSession;
			histories?: RecommendationHistoryItem[];
		};
		if (!body.profile?.userId || !body.session?.id) {
			return badRequest('profile and session are required');
		}

		return ok(await generateFollowups(body.profile, body.session, body.histories ?? []));
	} catch (error) {
		return fail(error);
	}
};
