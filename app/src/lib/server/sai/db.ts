import { env } from '$env/dynamic/private';
import postgres from 'postgres';

let client: ReturnType<typeof postgres> | null = null;
let schemaReady = false;
let schemaReadyPromise: Promise<void> | null = null;

export class DatabaseUnavailableError extends Error {
	constructor() {
		super('DATABASE_URL is not configured');
		this.name = 'DatabaseUnavailableError';
	}
}

export function getSql() {
	if (!env.DATABASE_URL) throw new DatabaseUnavailableError();

	client ??= postgres(env.DATABASE_URL, {
		max: 4,
		prepare: false,
		ssl: shouldRequireSsl(env.DATABASE_URL) ? 'require' : false
	});

	return client;
}

function shouldRequireSsl(databaseUrl: string) {
	try {
		const url = new URL(databaseUrl);
		if (url.searchParams.has('sslmode') || url.searchParams.has('ssl')) return false;
		if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return false;
		return url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.pooler.supabase.com');
	} catch {
		return false;
	}
}

export async function ensureSchema() {
	if (schemaReady) return;
	schemaReadyPromise ??= ensureSchemaInner();
	await schemaReadyPromise;
}

async function ensureSchemaInner() {
	const sql = getSql();

	try {
		await sql.begin(async (tx) => {
			await tx`create schema if not exists sai`;

			await tx`
			create table if not exists sai.users (
				id text primary key,
				email text not null unique,
				password_hash text not null,
				created_at timestamptz not null default now(),
				updated_at timestamptz not null default now()
			)
		`;

			await tx`
			create table if not exists sai.user_profiles (
				user_id text primary key references sai.users(id) on delete cascade,
				onboarding_completed boolean not null default false,
				activity_preferences jsonb not null default '[]'::jsonb,
				novelty_preference text not null default '',
				spending_style text not null default '',
				risk_tolerance text not null default '',
				mobility_preference text not null default '',
				mbti_type text not null default '',
				onboarding_freeform_answers jsonb not null default '[]'::jsonb,
				recent_location jsonb,
				updated_at timestamptz not null default now()
			)
		`;

			await tx`
			alter table sai.user_profiles
			add column if not exists mbti_type text not null default ''
		`;

			await tx`
			alter table sai.user_profiles
			add column if not exists onboarding_freeform_answers jsonb not null default '[]'::jsonb
		`;

			await tx`
			create table if not exists sai.recommendation_sessions (
				id text primary key,
				user_id text not null references sai.users(id) on delete cascade,
				situation text,
				location jsonb,
				available_time text,
				budget_total integer,
				weather_snapshot jsonb not null default '{}'::jsonb,
				dynamic_questions jsonb not null default '[]'::jsonb,
				dynamic_answers jsonb not null default '{}'::jsonb,
				companion_constraints jsonb not null default '{}'::jsonb,
				created_at timestamptz not null default now()
			)
		`;

			await tx`
			create table if not exists sai.recommendation_cards (
				id text primary key,
				session_id text not null references sai.recommendation_sessions(id) on delete cascade,
				label text not null,
				title text not null,
				reason text not null,
				result_type text not null,
				estimated_cost integer not null,
				estimated_duration text not null,
				distance_summary text not null default '',
				weather_fit text not null default '',
				companion_fit jsonb not null default '[]'::jsonb,
				outbound_url text not null default '',
				raw_payload jsonb not null default '{}'::jsonb,
				created_at timestamptz not null default now()
			)
		`;

			await tx`
			create table if not exists sai.recommendation_feedback (
				id bigserial primary key,
				card_id text not null references sai.recommendation_cards(id) on delete cascade,
				user_id text not null references sai.users(id) on delete cascade,
				sentiment text not null check (sentiment in ('like', 'dislike')),
				reasons jsonb not null default '[]'::jsonb,
				created_at timestamptz not null default now(),
				unique (card_id, user_id)
			)
		`;

			await tx`
			create table if not exists sai.recommendation_card_clicks (
				card_id text not null references sai.recommendation_cards(id) on delete cascade,
				user_id text not null references sai.users(id) on delete cascade,
				created_at timestamptz not null default now(),
				primary key (card_id, user_id)
			)
		`;

			await tx`
			create table if not exists sai.integration_logs (
				id bigserial primary key,
				provider text not null,
				kind text not null check (kind in ('ai', 'api')),
				operation text not null,
				method text not null,
				url text not null,
				status integer,
				ok boolean,
				duration_ms integer not null,
				request_payload jsonb,
				response_payload jsonb,
				error_message text,
				created_at timestamptz not null default now()
			)
		`;

			await tx`
			create index if not exists integration_logs_created_at_idx
			on sai.integration_logs (created_at desc)
		`;

			await tx`
			create index if not exists integration_logs_provider_idx
			on sai.integration_logs (provider, kind, created_at desc)
		`;
		});

		schemaReady = true;
	} catch (error) {
		schemaReadyPromise = null;
		throw error;
	}
}
