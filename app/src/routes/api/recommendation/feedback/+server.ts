import { badRequest, fail, ok } from '$lib/server/sai/http';
import { saveFeedback } from '$lib/server/sai/repository';
import type { FeedbackRecord } from '$lib/sai/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as {
			userId?: string;
			sessionId?: string;
			feedback?: FeedbackRecord[];
		};

		if (!body.userId || !body.sessionId || !Array.isArray(body.feedback)) {
			return badRequest('userId, sessionId, and feedback are required');
		}

		return ok({
			saved: true,
			history: await saveFeedback(body.userId, body.sessionId, body.feedback)
		});
	} catch (error) {
		return fail(error);
	}
};
