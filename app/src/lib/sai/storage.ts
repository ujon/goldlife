import type { RecommendationHistoryItem, UserProfile } from './types';

export type StoredUser = {
	id: string;
	email: string;
	passwordHash: string;
	createdAt: string;
	updatedAt: string;
};

export type StoredState = {
	users: StoredUser[];
	profiles: Record<string, UserProfile>;
	histories: Record<string, RecommendationHistoryItem[]>;
};

const STORAGE_KEY = 'sai_mvp_state_v1';

export function emptyStoredState(): StoredState {
	return {
		users: [],
		profiles: {},
		histories: {}
	};
}

export function loadStoredState(): StoredState {
	if (typeof localStorage === 'undefined') return emptyStoredState();

	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return emptyStoredState();

		const parsed = JSON.parse(raw) as Partial<StoredState>;

		return {
			users: Array.isArray(parsed.users) ? parsed.users : [],
			profiles: parsed.profiles && typeof parsed.profiles === 'object' ? parsed.profiles : {},
			histories: parsed.histories && typeof parsed.histories === 'object' ? parsed.histories : {}
		};
	} catch {
		return emptyStoredState();
	}
}

export function saveStoredState(state: StoredState) {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function normalizeEmail(email: string) {
	return email.trim().toLowerCase();
}

export function userIdFromEmail(email: string) {
	return `user_${normalizeEmail(email).replace(/[^a-z0-9]+/g, '_')}`;
}

export async function hashPassword(password: string, userId: string) {
	const value = `${userId}:${password}`;

	if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
		const bytes = new TextEncoder().encode(value);
		const digest = await crypto.subtle.digest('SHA-256', bytes);
		return Array.from(new Uint8Array(digest))
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('');
	}

	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash << 5) - hash + value.charCodeAt(index);
		hash |= 0;
	}

	return `fallback_${Math.abs(hash)}_${value.length}`;
}

export function createDefaultProfile(userId: string, email: string): UserProfile {
	return {
		userId,
		email,
		onboardingCompleted: false,
		activityPreferences: [],
		noveltyPreference: '',
		spendingStyle: '',
		riskTolerance: '',
		mobilityPreference: '',
		updatedAt: new Date().toISOString()
	};
}
