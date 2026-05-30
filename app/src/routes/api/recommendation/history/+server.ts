import { badRequest, fail, ok } from '$lib/server/sai/http';
import { saveRecommendationHistory } from '$lib/server/sai/repository';
import type { RecommendationCard, RecommendationSession } from '$lib/sai/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as {
			userId?: string;
			session?: RecommendationSession;
			cards?: RecommendationCard[];
		};

		if (!body.userId || !body.session?.id || !Array.isArray(body.cards)) {
			return badRequest('userId, session, and cards are required');
		}

		await saveRecommendationHistory(body.userId, body.session, body.cards);
		return ok({ saved: true });
	} catch (error) {
		return fail(error);
	}
};
