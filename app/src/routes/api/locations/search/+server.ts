import { searchLocations } from '$lib/server/sai/locations';
import { fail, ok } from '$lib/server/sai/http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const query = url.searchParams.get('q') ?? '';
		return ok({ suggestions: await searchLocations(query) });
	} catch (error) {
		return fail(error);
	}
};
