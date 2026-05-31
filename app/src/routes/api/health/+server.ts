import { env } from '$env/dynamic/private';
import { ok } from '$lib/server/sai/http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () =>
	ok({
		status: 'UP',
		databaseConfigured: Boolean(env.DATABASE_URL),
		openaiConfigured: Boolean(env.OPENAI_API_KEY),
		openaiModel: env.OPENAI_MODEL || 'gpt-5.4-mini',
		exaoneConfigured: Boolean(env.EXAONE_API_KEY && env.EXAONE_BASE_URL),
		exaoneModel: env.EXAONE_MODEL || 'LGAI-EXAONE/K-EXAONE-236B-A23B',
		supertoneConfigured: Boolean(env.SUPERTONE_API_KEY),
		supertoneModel: env.SUPERTONE_MODEL || 'sona_speech_2_flash',
		providers: {
			apiFuse: Boolean(env.API_FUSE_API_KEY),
			myrealtrip: Boolean(env.MYREALTRIP_API_KEY),
			genrank: true,
			publicData: Boolean(env.DATA_GO_KR_SERVICE_KEY),
			swing: Boolean(env.SWING_API_KEY)
		}
	});
