import { env } from '$env/dynamic/private';
import postgres from 'postgres';

let client: ReturnType<typeof postgres> | null = null;
let schemaReady = false;

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
		prepare: false
	});

	return client;
}

export async function ensureSchema() {
	if (schemaReady) return;
	const sql = getSql();

	await sql.begin(async (tx) => {
		await tx`
			create table if not exists users (
				id text primary key,
				email text not null unique,
				password_hash text not null,
				created_at timestamptz not null default now(),
				updated_at timestamptz not null default now()
			)
		`;

		await tx`
			create table if not exists user_profiles (
				user_id text primary key references users(id) on delete cascade,
				onboarding_completed boolean not null default false,
				activity_preferences jsonb not null default '[]'::jsonb,
				novelty_preference text not null default '',
				spending_style text not null default '',
				risk_tolerance text not null default '',
				mobility_preference text not null default '',
				recent_location jsonb,
				updated_at timestamptz not null default now()
			)
		`;

		await tx`
			create table if not exists recommendation_sessions (
				id text primary key,
				user_id text not null references users(id) on delete cascade,
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
			create table if not exists recommendation_cards (
				id text primary key,
				session_id text not null references recommendation_sessions(id) on delete cascade,
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
			create table if not exists recommendation_feedback (
				id bigserial primary key,
				card_id text not null references recommendation_cards(id) on delete cascade,
				user_id text not null references users(id) on delete cascade,
				sentiment text not null check (sentiment in ('like', 'dislike')),
				reasons jsonb not null default '[]'::jsonb,
				created_at timestamptz not null default now(),
				unique (card_id, user_id)
			)
		`;

		await tx`
			create table if not exists recommendation_card_clicks (
				card_id text not null references recommendation_cards(id) on delete cascade,
				user_id text not null references users(id) on delete cascade,
				created_at timestamptz not null default now(),
				primary key (card_id, user_id)
			)
		`;
	});

	schemaReady = true;
}
