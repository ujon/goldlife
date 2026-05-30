import { badRequest, fail, ok } from '$lib/server/sai/http';
import { saveCardClick } from '$lib/server/sai/repository';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as { userId?: string; cardId?: string };
		if (!body.userId || !body.cardId) return badRequest('userId and cardId are required');

		await saveCardClick(body.userId, body.cardId);
		return ok({ saved: true });
	} catch (error) {
		return fail(error);
	}
};
