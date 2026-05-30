import { listIntegrationLogs } from '$lib/server/sai/integration-logger';
import { fail, ok } from '$lib/server/sai/http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const limit = Number(url.searchParams.get('limit') ?? '30');
		const since = url.searchParams.get('since') ?? undefined;
		const includeInternal =
			url.searchParams.get('includeInternal') === '1' ||
			url.searchParams.get('includeInternal') === 'true';

		return ok(
			await listIntegrationLogs({
				limit: Number.isFinite(limit) ? limit : 30,
				since,
				externalOnly: !includeInternal
			})
		);
	} catch (error) {
		return fail(error);
	}
};
