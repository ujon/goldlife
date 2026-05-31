import type {
	FeedbackRecord,
	RecommendationCard,
	RecommendationHistoryItem,
	RecommendationSession,
	UserProfile
} from '$lib/sai/types';
import { ensureSchema, getSql } from './db';

export type AuthResult = {
	user: {
		id: string;
		email: string;
		createdAt: string;
		updatedAt: string;
	};
	profile: UserProfile;
	histories: RecommendationHistoryItem[];
};

type UserRow = {
	id: string;
	email: string;
	password_hash: string;
	created_at: Date;
	updated_at: Date;
};

type ProfileRow = {
	user_id: string;
	onboarding_completed: boolean;
	activity_preferences: string[];
	novelty_preference: string;
	spending_style: string;
	risk_tolerance: string;
	mobility_preference: string;
	mbti_type: UserProfile['mbtiType'] | null;
	onboarding_freeform_answers: UserProfile['onboardingFreeformAnswers'] | null;
	recent_location: UserProfile['recentLocation'] | null;
	updated_at: Date;
};

type SessionRow = {
	id: string;
	user_id: string;
	situation: RecommendationSession['situation'] | null;
	location: RecommendationSession['location'] | null;
	available_time: string | null;
	budget_total: number | null;
	weather_snapshot: RecommendationSession['weatherSnapshot'];
	dynamic_questions: RecommendationSession['dynamicQuestions'] | null;
	dynamic_answers: RecommendationSession['dynamicAnswers'];
	companion_constraints: RecommendationSession['companionConstraints'];
	created_at: Date;
};

type CardRow = {
	id: string;
	session_id: string;
	label: string;
	title: string;
	reason: string;
	result_type: RecommendationCard['resultType'];
	estimated_cost: number;
	estimated_duration: string;
	distance_summary: string;
	weather_fit: RecommendationCard['weatherFit'];
	companion_fit: string[];
	outbound_url: string;
	raw_payload: RecommendationCard;
};

type FeedbackRow = {
	card_id: string;
	user_id: string;
	sentiment: FeedbackRecord['sentiment'];
	reasons: string[];
	created_at: Date;
};

type ClickRow = {
	card_id: string;
};

export function normalizeEmail(email: string) {
	return email.trim().toLowerCase();
}

export function userIdFromEmail(email: string) {
	return `user_${normalizeEmail(email).replace(/[^a-z0-9]+/g, '_')}`;
}

export async function hashPassword(password: string, userId: string) {
	const crypto = await import('node:crypto');
	return crypto.createHash('sha256').update(`${userId}:${password}`).digest('hex');
}

export async function signup(emailInput: string, password: string): Promise<AuthResult> {
	await ensureSchema();
	const sql = getSql();
	const email = normalizeEmail(emailInput);
	const id = userIdFromEmail(email);
	const passwordHash = await hashPassword(password, id);

	await sql.begin(async (tx) => {
		await tx`
			insert into sai.users (id, email, password_hash)
			values (${id}, ${email}, ${passwordHash})
		`;
		await tx`
			insert into sai.user_profiles (user_id)
			values (${id})
		`;
	});

	const result = await getAuthResult(id);
	if (!result) throw new Error('Failed to create user');
	return result;
}

export async function getOrCreateDevUser(
	emailInput: string,
	password: string
): Promise<AuthResult> {
	const existing = await getAuthResult(userIdFromEmail(emailInput));
	if (existing) return existing;
	return signup(emailInput, password);
}

export async function login(emailInput: string, password: string): Promise<AuthResult | null> {
	await ensureSchema();
	const sql = getSql();
	const email = normalizeEmail(emailInput);
	const rows = await sql<UserRow[]>`
		select * from sai.users where email = ${email}
	`;
	const user = rows[0];
	if (!user) return null;

	const passwordHash = await hashPassword(password, user.id);
	if (passwordHash !== user.password_hash) return null;

	return getAuthResult(user.id);
}

export async function upsertProfile(profile: UserProfile) {
	await ensureSchema();
	const sql = getSql();

	await sql`
		insert into sai.user_profiles (
			user_id,
			onboarding_completed,
			activity_preferences,
			novelty_preference,
			spending_style,
			risk_tolerance,
			mobility_preference,
			mbti_type,
			onboarding_freeform_answers,
			recent_location,
			updated_at
		)
		values (
			${profile.userId},
			${profile.onboardingCompleted},
			${sql.json(profile.activityPreferences)},
			${profile.noveltyPreference},
			${profile.spendingStyle},
			${profile.riskTolerance},
			${profile.mobilityPreference},
			${profile.mbtiType ?? ''},
			${sql.json(profile.onboardingFreeformAnswers ?? [])},
			${profile.recentLocation ? sql.json(profile.recentLocation) : null},
			now()
		)
		on conflict (user_id) do update set
			onboarding_completed = excluded.onboarding_completed,
			activity_preferences = excluded.activity_preferences,
			novelty_preference = excluded.novelty_preference,
			spending_style = excluded.spending_style,
			risk_tolerance = excluded.risk_tolerance,
			mobility_preference = excluded.mobility_preference,
			mbti_type = excluded.mbti_type,
			onboarding_freeform_answers = excluded.onboarding_freeform_answers,
			recent_location = excluded.recent_location,
			updated_at = now()
	`;
}

export async function saveRecommendationHistory(
	userId: string,
	session: RecommendationSession,
	cards: RecommendationCard[]
) {
	await ensureSchema();
	const sql = getSql();

	await sql.begin(async (tx) => {
		await tx`
			insert into sai.recommendation_sessions (
				id,
				user_id,
				situation,
				location,
				available_time,
				budget_total,
				weather_snapshot,
				dynamic_questions,
				dynamic_answers,
				companion_constraints,
				created_at
			)
			values (
				${session.id},
				${userId},
				${session.situation ?? null},
				${session.location ? tx.json(session.location) : null},
				${session.availableTime ?? null},
				${session.budgetTotal ?? null},
				${tx.json(session.weatherSnapshot)},
				${tx.json(session.dynamicQuestions ?? [])},
				${tx.json(session.dynamicAnswers)},
				${tx.json(session.companionConstraints)},
				${session.createdAt}
			)
			on conflict (id) do update set
				situation = excluded.situation,
				location = excluded.location,
				available_time = excluded.available_time,
				budget_total = excluded.budget_total,
				weather_snapshot = excluded.weather_snapshot,
				dynamic_questions = excluded.dynamic_questions,
				dynamic_answers = excluded.dynamic_answers,
				companion_constraints = excluded.companion_constraints
		`;

		for (const card of cards) {
			await tx`
				insert into sai.recommendation_cards (
					id,
					session_id,
					label,
					title,
					reason,
					result_type,
					estimated_cost,
					estimated_duration,
					distance_summary,
					weather_fit,
					companion_fit,
					outbound_url,
					raw_payload
				)
				values (
					${card.id},
					${session.id},
					${card.label},
					${card.title},
					${card.reason},
					${card.resultType},
					${card.estimatedCost},
					${card.estimatedDuration},
					${card.routeSummary},
					${card.weatherFit},
					${tx.json(card.companionFit)},
					${card.outboundUrl},
					${tx.json(card)}
				)
				on conflict (id) do update set
					label = excluded.label,
					title = excluded.title,
					reason = excluded.reason,
					result_type = excluded.result_type,
					estimated_cost = excluded.estimated_cost,
					estimated_duration = excluded.estimated_duration,
					distance_summary = excluded.distance_summary,
					weather_fit = excluded.weather_fit,
					companion_fit = excluded.companion_fit,
					outbound_url = excluded.outbound_url,
					raw_payload = excluded.raw_payload
			`;
		}
	});
}

export async function saveFeedback(userId: string, sessionId: string, feedback: FeedbackRecord[]) {
	await ensureSchema();
	const sql = getSql();
	const cardIds = feedback.map((item) => item.cardId);

	await sql.begin(async (tx) => {
		if (cardIds.length) {
			await tx`
				delete from sai.recommendation_feedback
				where user_id = ${userId}
				and card_id in ${tx(cardIds)}
			`;
		}

		for (const item of feedback) {
			await tx`
				insert into sai.recommendation_feedback (card_id, user_id, sentiment, reasons, created_at)
				values (
					${item.cardId},
					${userId},
					${item.sentiment},
					${tx.json(item.reasons)},
					${item.createdAt}
				)
				on conflict (card_id, user_id) do update set
					sentiment = excluded.sentiment,
					reasons = excluded.reasons,
					created_at = excluded.created_at
			`;
		}
	});

	return getSessionHistory(userId, sessionId);
}

export async function saveCardClick(userId: string, cardId: string) {
	await ensureSchema();
	const sql = getSql();
	await sql`
		insert into sai.recommendation_card_clicks (card_id, user_id)
		values (${cardId}, ${userId})
		on conflict (card_id, user_id) do nothing
	`;
}

export async function getAuthResult(userId: string): Promise<AuthResult | null> {
	await ensureSchema();
	const sql = getSql();
	const users = await sql<UserRow[]>`
		select * from sai.users where id = ${userId}
	`;
	const user = users[0];
	if (!user) return null;

	const profiles = await sql<ProfileRow[]>`
		select * from sai.user_profiles where user_id = ${userId}
	`;
	const profile = profiles[0] ? mapProfile(user, profiles[0]) : createProfile(user);
	const histories = await getHistories(userId);

	return {
		user: {
			id: user.id,
			email: user.email,
			createdAt: user.created_at.toISOString(),
			updatedAt: user.updated_at.toISOString()
		},
		profile,
		histories
	};
}

async function getSessionHistory(userId: string, sessionId: string) {
	const histories = await getHistories(userId);
	return histories.find((item) => item.session.id === sessionId) ?? null;
}

async function getHistories(userId: string): Promise<RecommendationHistoryItem[]> {
	const sql = getSql();
	const sessions = await sql<SessionRow[]>`
		select *
		from sai.recommendation_sessions
		where user_id = ${userId}
		order by created_at desc
		limit 12
	`;

	const histories: RecommendationHistoryItem[] = [];

	for (const sessionRow of sessions) {
		const [cards, feedback, clicks] = await Promise.all([
			sql<CardRow[]>`
				select *
				from sai.recommendation_cards
				where session_id = ${sessionRow.id}
				order by created_at asc
			`,
			sql<FeedbackRow[]>`
				select rf.*
				from sai.recommendation_feedback rf
				join sai.recommendation_cards rc on rc.id = rf.card_id
				where rf.user_id = ${userId}
				and rc.session_id = ${sessionRow.id}
				order by rf.created_at asc
			`,
			sql<ClickRow[]>`
				select rcc.card_id
				from sai.recommendation_card_clicks rcc
				join sai.recommendation_cards rc on rc.id = rcc.card_id
				where rcc.user_id = ${userId}
				and rc.session_id = ${sessionRow.id}
			`
		]);

		histories.push({
			session: mapSession(sessionRow),
			cards: cards.map(mapCard),
			feedback: feedback.map(mapFeedback),
			clickedCardIds: clicks.map((click) => click.card_id),
			createdAt: sessionRow.created_at.toISOString()
		});
	}

	return histories;
}

function createProfile(user: UserRow): UserProfile {
	return {
		userId: user.id,
		email: user.email,
		onboardingCompleted: false,
		activityPreferences: [],
		noveltyPreference: '',
		spendingStyle: '',
		riskTolerance: '',
		mobilityPreference: '',
		mbtiType: '',
		onboardingFreeformAnswers: [],
		updatedAt: user.updated_at.toISOString()
	};
}

function mapProfile(user: UserRow, row: ProfileRow): UserProfile {
	return {
		userId: user.id,
		email: user.email,
		onboardingCompleted: row.onboarding_completed,
		activityPreferences: row.activity_preferences,
		noveltyPreference: row.novelty_preference,
		spendingStyle: row.spending_style,
		riskTolerance: row.risk_tolerance,
		mobilityPreference: row.mobility_preference,
		mbtiType: row.mbti_type ?? '',
		onboardingFreeformAnswers: row.onboarding_freeform_answers ?? [],
		recentLocation: row.recent_location ?? undefined,
		updatedAt: row.updated_at.toISOString()
	};
}

function mapSession(row: SessionRow): RecommendationSession {
	return {
		id: row.id,
		situation: row.situation ?? undefined,
		location: row.location ?? undefined,
		availableTime: row.available_time ?? undefined,
		budgetTotal: row.budget_total ?? undefined,
		weatherSnapshot: row.weather_snapshot,
		dynamicQuestions: row.dynamic_questions ?? [],
		dynamicAnswers: row.dynamic_answers,
		companionConstraints: row.companion_constraints,
		createdAt: row.created_at.toISOString()
	};
}

function mapCard(row: CardRow): RecommendationCard {
	return {
		...row.raw_payload,
		id: row.id,
		label: row.label,
		title: row.title,
		reason: row.reason,
		resultType: row.result_type,
		estimatedCost: row.estimated_cost,
		estimatedDuration: row.estimated_duration,
		routeSummary: row.distance_summary,
		weatherFit: row.weather_fit,
		companionFit: row.companion_fit,
		outboundUrl: row.outbound_url
	};
}

function mapFeedback(row: FeedbackRow): FeedbackRecord {
	return {
		cardId: row.card_id,
		sentiment: row.sentiment,
		reasons: row.reasons,
		createdAt: row.created_at.toISOString()
	};
}
