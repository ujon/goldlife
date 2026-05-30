<script lang="ts">
	import { browser } from '$app/environment';
	import saiSymbol from '$lib/assets/sai-symbol.svg';
	import type { CandidateBundle } from '$lib/sai/candidates';
	import {
		babyFacilityOptions,
		budgetOptions,
		buildFollowupQuestions,
		composeRecommendations,
		createEmptyCompanionConstraints,
		createRecommendationSession,
		dislikeReasons,
		formatKrw,
		likeReasons,
		partyCount,
		situationLabel,
		situationOptions,
		timeMeta,
		timeOptions
	} from '$lib/sai/recommendations';
	import type {
		AuthMode,
		FeedbackRecord,
		FollowupQuestion,
		LocationSuggestion,
		LocationValue,
		RecommendationCard,
		RecommendationHistoryItem,
		RecommendationSession,
		Screen,
		Situation,
		UserProfile
	} from '$lib/sai/types';

	type OnboardingQuestion = {
		id:
			| 'activityPreferences'
			| 'noveltyPreference'
			| 'spendingStyle'
			| 'riskTolerance'
			| 'mobilityPreference'
			| 'mbtiType';
		prompt: string;
		options: Array<{ id: string; label: string; value: string }>;
		multi?: boolean;
		compact?: boolean;
		reaction: string;
	};

	type SpeechTarget = 'time' | 'budget' | 'followup';
	type SpeechRecognitionLike = {
		lang: string;
		interimResults: boolean;
		maxAlternatives: number;
		start: () => void;
		stop: () => void;
		onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
		onerror: (() => void) | null;
		onend: (() => void) | null;
	};
	type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
	type ServerAuthResult = {
		user: {
			id: string;
			email: string;
			createdAt: string;
			updatedAt: string;
		};
		profile: UserProfile;
		histories: RecommendationHistoryItem[];
	};
	type ComposeResult = {
		cards: RecommendationCard[];
		candidates: CandidateBundle | null;
		source: 'openai' | 'fallback';
		model?: string;
		fallbackReason?: string;
	};
	type FollowupResult = {
		questions: FollowupQuestion[];
		source: 'exaone' | 'openai' | 'fallback';
		model?: string;
		fallbackReason?: string;
	};
	type LocationSearchResult = {
		suggestions: LocationSuggestion[];
	};
	type ServerResult<T> =
		| { type: 'ok'; data: T }
		| { type: 'error'; status: number; message: string };

	const defaultLocation: LocationValue = {
		mode: 'default',
		label: '서울 성수동'
	};
	const mbtiOptions = [
		'ISTJ',
		'ISFJ',
		'INFJ',
		'INTJ',
		'ISTP',
		'ISFP',
		'INFP',
		'INTP',
		'ESTP',
		'ESFP',
		'ENFP',
		'ENTP',
		'ESTJ',
		'ESFJ',
		'ENFJ',
		'ENTJ'
	].map((type) => ({ id: type.toLowerCase(), label: type, value: type }));

	const onboardingQuestions: OnboardingQuestion[] = [
		{
			id: 'activityPreferences',
			prompt: '쉬는 날엔 보통 뭐가 좋아?',
			multi: true,
			reaction: '좋아, 추천 후보에서 이 취향을 먼저 떠올릴게.',
			options: [
				{ id: 'food', label: '맛집', value: 'food' },
				{ id: 'culture', label: '전시', value: 'culture' },
				{ id: 'experience', label: '체험', value: 'experience' },
				{ id: 'walk', label: '산책', value: 'walk' },
				{ id: 'home', label: '집에서 쉬기', value: 'home' }
			]
		},
		{
			id: 'noveltyPreference',
			prompt: '새로운 걸 해보는 편이야?',
			reaction: '오케이. 너무 뻔하거나 너무 실험적인 쪽을 조절해둘게.',
			options: [
				{ id: 'high', label: '완전 좋아', value: 'high' },
				{ id: 'medium', label: '가끔 좋아', value: 'medium' },
				{ id: 'low', label: '익숙한 게 좋아', value: 'low' }
			]
		},
		{
			id: 'spendingStyle',
			prompt: '돈 쓸 때 어떤 쪽이 편해?',
			reaction: '예산 안에서 어디에 힘을 줄지 기억해둘게.',
			options: [
				{ id: 'value', label: '가성비', value: 'value' },
				{ id: 'balanced', label: '적당히', value: 'balanced' },
				{ id: 'premium', label: '프리미엄', value: 'premium' }
			]
		},
		{
			id: 'riskTolerance',
			prompt: '실패 없는 선택이 좋아, 모험도 괜찮아?',
			reaction: '추천 이유에서 안정감과 새로움의 비율을 맞춰볼게.',
			options: [
				{ id: 'safe', label: '실패 회피', value: 'safe' },
				{ id: 'balanced', label: '균형', value: 'balanced' },
				{ id: 'adventure', label: '모험 선호', value: 'adventure' }
			]
		},
		{
			id: 'mobilityPreference',
			prompt: '이동은 어느 정도 괜찮아?',
			reaction: '동선 계산할 때 이동 부담을 같이 볼게.',
			options: [
				{ id: 'near', label: '가까운 곳', value: 'near' },
				{ id: 'transit', label: '대중교통 가능', value: 'public_transport_ok' },
				{ id: 'far', label: '멀어도 됨', value: 'far_ok' }
			]
		},
		{
			id: 'mbtiType',
			prompt: 'MBTI 알려줄래?',
			reaction: '모르면 괜찮아. 성격 힌트는 추천 톤만 살짝 맞추는 데 쓸게.',
			compact: true,
			options: [...mbtiOptions, { id: 'unknown', label: '잘 모르겠어', value: 'unknown' }]
		}
	];

	let screen = $state<Screen>('auth');
	let authMode = $state<AuthMode>('login');
	let authEmail = $state('');
	let authPassword = $state('');
	let authError = $state('');
	let currentUserId = $state('');
	let profile = $state<UserProfile | null>(null);
	let histories = $state<RecommendationHistoryItem[]>([]);
	let busy = $state(false);
	let manualRegion = $state(defaultLocation.label);
	let locationSuggestions = $state<LocationSuggestion[]>([]);
	let locationSuggestionsOpen = $state(false);
	let locationSuggestionsLoading = $state(false);
	let locationSearchMessage = $state('');
	let onboardingIndex = $state(0);
	let session = $state<RecommendationSession>(createRecommendationSession(defaultLocation));
	let timeCustomMode = $state(false);
	let customTimeInput = $state('');
	let budgetCustomMode = $state(false);
	let customBudgetInput = $state('');
	let followupIndex = $state(0);
	let dynamicFollowups = $state<FollowupQuestion[]>([]);
	let followupSource = $state<'exaone' | 'openai' | 'fallback'>('fallback');
	let recommendations = $state<RecommendationCard[]>([]);
	let candidateBundle = $state<CandidateBundle | null>(null);
	let compositionSource = $state<'openai' | 'fallback'>('fallback');
	let activeSessionId = $state('');
	let feedbackDraft = $state<Record<string, { sentiment?: 'like' | 'dislike'; reasons: string[] }>>(
		{}
	);
	let listeningFor = $state<SpeechTarget | null>(null);
	let speechTranscript = $state('');
	let speechMessage = $state('');
	let locationSearchTimer: ReturnType<typeof setTimeout> | null = null;
	let locationSearchRequestId = 0;

	let currentOnboardingQuestion = $derived(onboardingQuestions[onboardingIndex]);
	let onboardingAnswered = $derived(
		profile ? isOnboardingAnswered(currentOnboardingQuestion, profile) : false
	);
	let selectedSituation = $derived(
		situationOptions.find((option) => option.id === session.situation)
	);
	let perPersonBudget = $derived(
		session.budgetTotal
			? Math.ceil(session.budgetTotal / partyCount(session.situation) / 1000) * 1000
			: 0
	);
	let fallbackFollowupQuestions = $derived(profile ? buildFollowupQuestions(session, profile) : []);
	let followupQuestions = $derived(
		dynamicFollowups.length ? dynamicFollowups : fallbackFollowupQuestions
	);
	let currentFollowup = $derived(followupQuestions[followupIndex]);
	let recentHistory = $derived(currentUserId ? histories.slice(0, 3) : []);
	let mascotState = $derived(
		screen === 'generating' ? 'thinking' : screen === 'results' ? 'happy' : 'idle'
	);
	let progress = $derived(
		getProgress(screen, onboardingIndex, followupIndex, followupQuestions.length)
	);
	let progressDots = $derived(range(progress.total));

	function inputValue(event: Event) {
		return (event.currentTarget as HTMLInputElement).value;
	}

	function range(length: number) {
		const values: number[] = [];
		for (let index = 0; index < length; index += 1) values.push(index);
		return values;
	}

	function textareaValue(event: Event) {
		return (event.currentTarget as HTMLTextAreaElement).value;
	}

	function jsonCopy<T>(value: T): T {
		return JSON.parse(JSON.stringify(value)) as T;
	}

	function normalizeEmail(email: string) {
		return email.trim().toLowerCase();
	}

	async function serverJson<T>(
		path: string,
		init: RequestInit & { body?: BodyInit | null }
	): Promise<ServerResult<T>> {
		try {
			const response = await fetch(path, {
				...init,
				headers: {
					'content-type': 'application/json',
					...(init.headers ?? {})
				}
			});

			const payload = (await response.json().catch(() => ({}))) as { error?: string };
			if (!response.ok) {
				return {
					type: 'error',
					status: response.status,
					message:
						response.status === 503
							? 'PostgreSQL 연결이 필요해. 루트에서 make server-dev로 실행해줘.'
							: (payload.error ?? '서버 요청에 실패했어.')
				};
			}

			return { type: 'ok', data: payload as T };
		} catch (error) {
			return {
				type: 'error',
				status: 0,
				message:
					error instanceof Error
						? `서버에 연결할 수 없어: ${error.message}`
						: '서버에 연결할 수 없어.'
			};
		}
	}

	async function authenticateWithServer(mode: AuthMode, email: string, password: string) {
		return serverJson<ServerAuthResult>(`/api/auth/${mode}`, {
			method: 'POST',
			body: JSON.stringify({ email, password })
		});
	}

	async function syncServerProfile(nextProfile: UserProfile) {
		return serverJson<{ saved: boolean }>('/api/profile', {
			method: 'PUT',
			body: JSON.stringify({ profile: nextProfile })
		});
	}

	async function syncServerHistory(
		nextSession: RecommendationSession,
		cards: RecommendationCard[]
	) {
		if (!currentUserId) return;
		return serverJson<{ saved: boolean }>('/api/recommendation/history', {
			method: 'POST',
			body: JSON.stringify({ userId: currentUserId, session: nextSession, cards })
		});
	}

	async function syncServerFeedback(sessionId: string, feedback: FeedbackRecord[]) {
		if (!currentUserId) return;
		return serverJson<{ saved: boolean }>('/api/recommendation/feedback', {
			method: 'POST',
			body: JSON.stringify({ userId: currentUserId, sessionId, feedback })
		});
	}

	async function syncServerClick(cardId: string) {
		if (!currentUserId) return;
		return serverJson<{ saved: boolean }>('/api/recommendation/click', {
			method: 'POST',
			body: JSON.stringify({ userId: currentUserId, cardId })
		});
	}

	function applyServerAuthResult(result: ServerAuthResult) {
		histories = result.histories;
		enterUser(result.user.id, result.profile);
	}

	function saveProfile(nextProfile: UserProfile | null = profile) {
		if (!nextProfile) return;
		profile = nextProfile;
		void syncServerProfile(nextProfile);
	}

	async function submitAuth() {
		if (busy) return;
		authError = '';
		const email = normalizeEmail(authEmail);

		if (!email || !authPassword) {
			authError = '이메일과 비밀번호를 입력해줘.';
			return;
		}

		busy = true;
		const serverAuth = await authenticateWithServer(authMode, email, authPassword);

		if (serverAuth.type === 'ok') {
			applyServerAuthResult(serverAuth.data);
			authPassword = '';
			busy = false;
			return;
		}

		authError =
			serverAuth.status === 409
				? '이미 가입된 이메일이야. 로그인으로 들어와줘.'
				: serverAuth.status === 401
					? '이메일이나 비밀번호가 맞지 않아.'
					: serverAuth.message;
		busy = false;
	}

	function enterUser(userId: string, nextProfile: UserProfile) {
		currentUserId = userId;
		profile = nextProfile;
		manualRegion = nextProfile.recentLocation?.label ?? defaultLocation.label;
		session = createRecommendationSession(nextProfile.recentLocation ?? defaultLocation);
		const missingIndex = firstUnansweredOnboardingIndex(nextProfile);
		onboardingIndex = missingIndex === -1 ? 0 : missingIndex;
		screen = !nextProfile.recentLocation
			? 'location'
			: isProfileOnboardingComplete(nextProfile)
				? 'home'
				: 'onboarding';
	}

	function logout() {
		currentUserId = '';
		profile = null;
		screen = 'auth';
		authPassword = '';
		authError = '';
		recommendations = [];
		candidateBundle = null;
		compositionSource = 'fallback';
		activeSessionId = '';
		histories = [];
	}

	async function requestLocation() {
		if (!profile || busy) return;
		busy = true;

		if (!browser || !navigator.geolocation) {
			saveLocation({ mode: 'default', label: defaultLocation.label });
			busy = false;
			return;
		}

		try {
			const position = await new Promise<GeolocationPosition>((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(resolve, reject, {
					enableHighAccuracy: false,
					timeout: 8000,
					maximumAge: 300000
				});
			});
			saveLocation({
				mode: 'geo',
				label: '현재 위치',
				lat: Number(position.coords.latitude.toFixed(5)),
				lng: Number(position.coords.longitude.toFixed(5))
			});
		} catch {
			saveLocation({ mode: 'default', label: defaultLocation.label });
		}

		busy = false;
	}

	function saveManualLocation() {
		const label = manualRegion.trim() || defaultLocation.label;
		saveLocation({ mode: 'manual', label });
	}

	function handleManualRegionInput(event: Event) {
		manualRegion = inputValue(event);
		locationSuggestionsOpen = true;
		locationSearchMessage = '';

		if (locationSearchTimer) clearTimeout(locationSearchTimer);
		locationSearchTimer = setTimeout(() => {
			void loadLocationSuggestions(manualRegion);
		}, 180);
	}

	function handleManualRegionFocus() {
		locationSuggestionsOpen = true;
		if (!locationSuggestions.length) void loadLocationSuggestions(manualRegion);
	}

	function handleManualRegionKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		saveManualLocation();
	}

	function selectLocationSuggestion(suggestion: LocationSuggestion) {
		manualRegion = suggestion.label;
		locationSuggestionsOpen = false;
		locationSearchMessage = '';
	}

	async function loadLocationSuggestions(query: string) {
		const trimmed = query.trim();
		const requestId = ++locationSearchRequestId;

		if (!trimmed) {
			locationSuggestions = [];
			locationSuggestionsOpen = false;
			locationSuggestionsLoading = false;
			return;
		}

		locationSuggestionsLoading = true;
		const result = await serverJson<LocationSearchResult>(
			`/api/locations/search?q=${encodeURIComponent(trimmed)}`,
			{ method: 'GET' }
		);
		if (requestId !== locationSearchRequestId) return;

		locationSuggestionsLoading = false;
		if (result.type === 'ok') {
			locationSuggestions = result.data.suggestions;
			locationSearchMessage = result.data.suggestions.length
				? ''
				: '비슷한 지역을 못 찾았어. 입력한 지역으로 바로 시작할 수 있어.';
			return;
		}

		locationSuggestions = [];
		locationSearchMessage = '지역 후보를 불러오지 못했어. 입력한 지역으로 시작해도 돼.';
	}

	function saveLocation(location: LocationValue) {
		if (!profile) return;
		const nextProfile = {
			...profile,
			recentLocation: location,
			updatedAt: new Date().toISOString()
		};

		profile = nextProfile;
		saveProfile(nextProfile);
		session = createRecommendationSession(location);
		const missingIndex = firstUnansweredOnboardingIndex(nextProfile);
		onboardingIndex = missingIndex === -1 ? 0 : missingIndex;
		screen = isProfileOnboardingComplete(nextProfile) ? 'home' : 'onboarding';
	}

	function isOnboardingAnswered(question: OnboardingQuestion, targetProfile: UserProfile) {
		if (question.id === 'activityPreferences') return targetProfile.activityPreferences.length > 0;
		return Boolean(targetProfile[question.id]);
	}

	function firstUnansweredOnboardingIndex(targetProfile: UserProfile) {
		return onboardingQuestions.findIndex(
			(question) => !isOnboardingAnswered(question, targetProfile)
		);
	}

	function isProfileOnboardingComplete(targetProfile: UserProfile) {
		return (
			targetProfile.onboardingCompleted && firstUnansweredOnboardingIndex(targetProfile) === -1
		);
	}

	function isOnboardingSelected(question: OnboardingQuestion, value: string) {
		if (!profile) return false;
		if (question.id === 'activityPreferences') return profile.activityPreferences.includes(value);
		return profile[question.id] === value;
	}

	function selectOnboardingOption(question: OnboardingQuestion, value: string) {
		if (!profile) return;

		if (question.id === 'activityPreferences') {
			const selected = profile.activityPreferences.includes(value)
				? profile.activityPreferences.filter((item) => item !== value)
				: [...profile.activityPreferences, value];

			const nextProfile = {
				...profile,
				activityPreferences: selected,
				updatedAt: new Date().toISOString()
			};
			profile = nextProfile;
			saveProfile(nextProfile);
			return;
		}

		const nextProfile = setSingleOnboardingAnswer(profile, question.id, value);
		profile = nextProfile;
		saveProfile(nextProfile);
	}

	function setSingleOnboardingAnswer(
		targetProfile: UserProfile,
		id: Exclude<OnboardingQuestion['id'], 'activityPreferences'>,
		value: string
	): UserProfile {
		const updatedAt = new Date().toISOString();

		switch (id) {
			case 'noveltyPreference':
				return { ...targetProfile, noveltyPreference: value, updatedAt };
			case 'spendingStyle':
				return { ...targetProfile, spendingStyle: value, updatedAt };
			case 'riskTolerance':
				return { ...targetProfile, riskTolerance: value, updatedAt };
			case 'mobilityPreference':
				return { ...targetProfile, mobilityPreference: value, updatedAt };
			case 'mbtiType':
				return { ...targetProfile, mbtiType: value as UserProfile['mbtiType'], updatedAt };
		}

		return targetProfile;
	}

	function continueOnboarding() {
		if (!profile || !onboardingAnswered) return;

		if (onboardingIndex < onboardingQuestions.length - 1) {
			onboardingIndex += 1;
			return;
		}

		const nextProfile = {
			...profile,
			onboardingCompleted: true,
			updatedAt: new Date().toISOString()
		};
		profile = nextProfile;
		saveProfile(nextProfile);
		onboardingIndex = 0;
		screen = 'home';
	}

	function startRecommendation() {
		if (!profile) return;
		if (!isProfileOnboardingComplete(profile)) {
			const missingIndex = firstUnansweredOnboardingIndex(profile);
			onboardingIndex = missingIndex === -1 ? 0 : missingIndex;
			screen = 'onboarding';
			return;
		}

		session = createRecommendationSession(profile.recentLocation ?? defaultLocation);
		timeCustomMode = false;
		customTimeInput = '';
		budgetCustomMode = false;
		customBudgetInput = '';
		followupIndex = 0;
		dynamicFollowups = [];
		followupSource = 'fallback';
		recommendations = [];
		activeSessionId = '';
		feedbackDraft = {};
		speechTranscript = '';
		speechMessage = '';
		screen = 'situation';
	}

	function setSituation(situation: Situation) {
		session.situation = situation;
	}

	function toggleBaby() {
		session.companionConstraints = {
			...session.companionConstraints,
			hasBaby: !session.companionConstraints.hasBaby
		};

		if (!session.companionConstraints.hasBaby) {
			session.companionConstraints = createEmptyCompanionConstraints();
		}
	}

	function toggleBabyFacility(field: (typeof babyFacilityOptions)[number]['id']) {
		session.companionConstraints = {
			...session.companionConstraints,
			[field]: !session.companionConstraints[field]
		};
	}

	function toggleBabyCarrier() {
		session.companionConstraints = {
			...session.companionConstraints,
			babyCarrierOk: !session.companionConstraints.babyCarrierOk
		};
	}

	function continueSituation() {
		if (!session.situation) return;
		screen = 'time';
	}

	function selectTime(id: string) {
		session.availableTime = id;
		timeCustomMode = id === 'custom';
		if (id !== 'custom') {
			customTimeInput = '';
			session.customTime = '';
		}
	}

	function continueTime() {
		if (!session.availableTime) return;
		if (timeCustomMode) {
			const value = customTimeInput.trim();
			if (!value) return;
			session.customTime = value;
		}
		screen = 'budget';
	}

	function selectBudget(value: number) {
		budgetCustomMode = value === 0;
		if (value > 0) {
			session.budgetTotal = value;
			customBudgetInput = '';
		}
	}

	function applyCustomBudgetInput(value: string) {
		customBudgetInput = value;
		const parsed = parseBudget(value);
		if (parsed) session.budgetTotal = parsed;
	}

	async function continueBudget() {
		if (!session.budgetTotal) return;
		followupIndex = 0;
		const result = await loadFollowups();
		dynamicFollowups = result.questions;
		session.dynamicQuestions = result.questions;
		followupSource = result.source;
		screen = followupQuestions.length ? 'followup' : 'generating';
		if (!followupQuestions.length) {
			void generateRecommendations();
		}
	}

	async function loadFollowups() {
		if (!profile) {
			return {
				questions: [],
				source: 'fallback' as const
			};
		}

		const result = await serverJson<FollowupResult>('/api/recommendation/followups', {
			method: 'POST',
			body: JSON.stringify({ profile, session, histories })
		});

		if (result.type === 'ok') return result.data;

		return {
			questions: fallbackFollowupQuestions,
			source: 'fallback' as const,
			fallbackReason: result.type === 'error' ? result.message : 'followup API unavailable'
		};
	}

	function answerFollowup(question: FollowupQuestion, value: string) {
		session.dynamicAnswers = {
			...session.dynamicAnswers,
			[question.id]: value
		};

		if (followupIndex < followupQuestions.length - 1) {
			followupIndex += 1;
			return;
		}

		void generateRecommendations();
	}

	async function generateRecommendations() {
		if (!profile) return;
		screen = 'generating';
		const composed = await composeRecommendationCards(profile, session);
		candidateBundle = composed.candidates;
		compositionSource = composed.source;
		session.weatherSnapshot = weatherSnapshotFromCandidates(
			composed.candidates,
			session.weatherSnapshot
		);
		await new Promise((resolve) => setTimeout(resolve, 700));
		const cards = scopeCardsToSession(composed.cards, session.id);
		recommendations = cards;
		activeSessionId = session.id;
		feedbackDraft = {};
		saveHistory(cards);
		screen = 'results';
	}

	async function composeRecommendationCards(
		targetProfile: UserProfile,
		targetSession: RecommendationSession
	) {
		const result = await serverJson<ComposeResult>('/api/recommendation/compose', {
			method: 'POST',
			body: JSON.stringify({
				profile: targetProfile,
				session: targetSession,
				histories
			})
		});
		if (result.type === 'ok') return result.data;

		const candidates = await collectCandidateBundle(targetProfile, targetSession);
		return {
			cards: scopeCardsToSession(
				applyCandidateBundle(composeRecommendations(targetProfile, targetSession), candidates),
				targetSession.id
			),
			candidates,
			source: 'fallback' as const,
			fallbackReason: result.type === 'error' ? result.message : 'compose API unavailable'
		};
	}

	function scopeCardsToSession(cards: RecommendationCard[], sessionId: string) {
		return cards.map((card) => {
			const id = card.id.startsWith(`${sessionId}:`) ? card.id : `${sessionId}:${card.id}`;
			return {
				...card,
				id
			};
		});
	}

	function weatherSnapshotFromCandidates(
		bundle: CandidateBundle | null,
		fallback: RecommendationSession['weatherSnapshot']
	): RecommendationSession['weatherSnapshot'] {
		if (!bundle) return fallback;

		return {
			condition:
				bundle.weather.condition === 'unknown' ? fallback.condition : bundle.weather.condition,
			label: bundle.weather.label,
			temperature: bundle.weather.temperature ?? fallback.temperature,
			preferIndoor: bundle.weather.preferIndoor,
			avoidLongWalk: fallback.avoidLongWalk || bundle.weather.preferIndoor
		};
	}

	async function collectCandidateBundle(
		targetProfile: UserProfile,
		targetSession: RecommendationSession
	) {
		const result = await serverJson<CandidateBundle>('/api/recommendation/candidates', {
			method: 'POST',
			body: JSON.stringify({ profile: targetProfile, session: targetSession })
		});
		return result.type === 'ok' ? result.data : null;
	}

	function applyCandidateBundle(cards: RecommendationCard[], bundle: CandidateBundle | null) {
		if (!bundle) return cards;

		return cards.map((card, index) => {
			const activity = bundle.activities[index % Math.max(bundle.activities.length, 1)];
			const restaurant = bundle.restaurants[index % Math.max(bundle.restaurants.length, 1)];
			const items = card.items.map((item) => {
				if (item.slot === 'activity' && activity) {
					return {
						...item,
						title: activity.title,
						price: activity.price ?? item.price,
						source: activity.source,
						outboundUrl: activity.outboundUrl ?? item.outboundUrl
					};
				}

				if (item.slot === 'food' && restaurant) {
					return {
						...item,
						title: restaurant.title,
						price: restaurant.price ?? item.price,
						source: restaurant.source,
						outboundUrl: restaurant.outboundUrl ?? item.outboundUrl
					};
				}

				return item;
			});
			const externalTags = [...(activity?.tags ?? []), ...(restaurant?.tags ?? [])].slice(0, 2);
			const trendTag = bundle.trendKeywords[index];
			const badges = [
				...new Set([...card.badges, ...externalTags, ...(trendTag ? [trendTag] : [])])
			].slice(0, 8);

			return {
				...card,
				items,
				badges,
				weatherFit: bundle.weather.preferIndoor ? 'indoor' : card.weatherFit
			};
		});
	}

	function saveHistory(cards: RecommendationCard[]) {
		if (!currentUserId) return;
		const historyItem: RecommendationHistoryItem = {
			session: jsonCopy(session),
			cards: jsonCopy(cards),
			feedback: [],
			clickedCardIds: [],
			createdAt: new Date().toISOString()
		};
		histories = [historyItem, ...histories].slice(0, 12);
		void syncServerHistory(historyItem.session, historyItem.cards);
	}

	function loadHistory(item: RecommendationHistoryItem) {
		session = jsonCopy(item.session);
		recommendations = jsonCopy(item.cards);
		activeSessionId = item.session.id;
		feedbackDraft = Object.fromEntries(
			item.feedback.map((feedback) => [
				feedback.cardId,
				{
					sentiment: feedback.sentiment,
					reasons: feedback.reasons
				}
			])
		);
		screen = 'results';
	}

	function setFeedback(cardId: string, sentiment: 'like' | 'dislike') {
		const current = feedbackDraft[cardId] ?? { reasons: [] };
		feedbackDraft = {
			...feedbackDraft,
			[cardId]: {
				...current,
				sentiment
			}
		};
		syncFeedback();
	}

	function toggleFeedbackReason(cardId: string, reason: string) {
		const current = feedbackDraft[cardId] ?? { reasons: [] };
		const reasons = current.reasons.includes(reason)
			? current.reasons.filter((item) => item !== reason)
			: [...current.reasons, reason];
		feedbackDraft = {
			...feedbackDraft,
			[cardId]: {
				...current,
				reasons
			}
		};
		syncFeedback();
	}

	function syncFeedback() {
		if (!currentUserId || !activeSessionId) return;
		const feedback: FeedbackRecord[] = Object.entries(feedbackDraft)
			.filter(([, value]) => value.sentiment)
			.map(([cardId, value]) => ({
				cardId,
				sentiment: value.sentiment ?? 'like',
				reasons: value.reasons,
				createdAt: new Date().toISOString()
			}));
		histories = histories.map((item) =>
			item.session.id === activeSessionId ? { ...item, feedback } : item
		);
		void syncServerFeedback(activeSessionId, feedback);
	}

	function recordClick(cardId: string) {
		if (!currentUserId || !activeSessionId) return;
		histories = histories.map((item) => {
			if (item.session.id !== activeSessionId || item.clickedCardIds.includes(cardId)) return item;
			return {
				...item,
				clickedCardIds: [...item.clickedCardIds, cardId]
			};
		});
		void syncServerClick(cardId);
	}

	function goHome() {
		if (!profile) {
			screen = 'auth';
			return;
		}
		screen = isProfileOnboardingComplete(profile) ? 'home' : 'onboarding';
	}

	function parseBudget(value: string) {
		const normalized = value.replaceAll(',', '').trim();
		const numeric = Number(normalized.replace(/[^0-9]/g, ''));
		if (numeric > 0) {
			return /만/.test(normalized) && numeric < 1000 ? numeric * 10000 : numeric;
		}
		if (/십오|열다섯/.test(normalized)) return 150000;
		if (/십|열/.test(normalized)) return 100000;
		if (/오|다섯/.test(normalized)) return 50000;
		if (/삼|셋/.test(normalized)) return 30000;
		if (/일|하나|한/.test(normalized)) return 10000;
		return 0;
	}

	function applyTimeTranscript(text: string) {
		if (/주말/.test(text)) selectTime('weekend');
		else if (/하루|종일/.test(text)) selectTime('day');
		else if (/반나절|오후|오전/.test(text)) selectTime('half_day');
		else if (/2|3|두|세/.test(text)) selectTime('two_three');
		else if (/1|한|하나/.test(text)) selectTime('one_hour');
		else {
			selectTime('custom');
			customTimeInput = text;
			session.customTime = text;
		}
	}

	function applyBudgetTranscript(text: string) {
		const parsed = parseBudget(text);
		if (!parsed) {
			budgetCustomMode = true;
			customBudgetInput = text;
			return;
		}
		session.budgetTotal = parsed;
		budgetCustomMode = false;
		customBudgetInput = '';
	}

	function applyFollowupTranscript(text: string) {
		if (!currentFollowup) return;
		const normalized = text.replace(/\s/g, '');
		const selected =
			currentFollowup.options.find((option) =>
				normalized.includes(option.label.replace(/\s/g, ''))
			) ?? currentFollowup.options[0];
		answerFollowup(currentFollowup, selected.value);
	}

	function getSpeechCtor(): SpeechRecognitionConstructor | undefined {
		if (!browser) return undefined;
		const speechWindow = window as Window & {
			SpeechRecognition?: SpeechRecognitionConstructor;
			webkitSpeechRecognition?: SpeechRecognitionConstructor;
		};
		return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
	}

	function startSpeech(target: SpeechTarget) {
		const SpeechRecognition = getSpeechCtor();
		speechMessage = '';

		if (!SpeechRecognition) {
			speechMessage = '음성 인식이 안 되면 칩으로 바로 골라도 돼.';
			return;
		}

		const recognition = new SpeechRecognition();
		listeningFor = target;
		speechTranscript = '';
		recognition.lang = 'ko-KR';
		recognition.interimResults = true;
		recognition.maxAlternatives = 1;
		recognition.onresult = (event) => {
			const text = Array.from(event.results)
				.map((result) => result[0]?.transcript ?? '')
				.join('')
				.trim();
			speechTranscript = text;
			if (target === 'time') applyTimeTranscript(text);
			if (target === 'budget') applyBudgetTranscript(text);
		};
		recognition.onerror = () => {
			speechMessage = '잘 못 들었어. 아래 선택지로 이어가줘.';
			listeningFor = null;
		};
		recognition.onend = () => {
			if (target === 'followup' && speechTranscript) applyFollowupTranscript(speechTranscript);
			listeningFor = null;
		};
		recognition.start();
	}

	function speakResults() {
		if (!browser || !recommendations.length || !window.speechSynthesis) return;
		window.speechSynthesis.cancel();
		const summary = recommendations
			.map((card, index) => `${index + 1}번, ${card.label}. ${card.reason}`)
			.join(' ');
		const utterance = new SpeechSynthesisUtterance(summary);
		utterance.lang = 'ko-KR';
		window.speechSynthesis.speak(utterance);
	}

	function getProgress(
		targetScreen: Screen,
		targetOnboardingIndex: number,
		targetFollowupIndex: number,
		followupLength: number
	) {
		if (targetScreen === 'onboarding') {
			return {
				current: targetOnboardingIndex + 1,
				total: onboardingQuestions.length,
				label: '온보딩'
			};
		}

		const flow: Screen[] = ['situation', 'time', 'budget', 'followup', 'generating', 'results'];
		if (!flow.includes(targetScreen)) return { current: 0, total: 0, label: '' };

		const total = 5 + followupLength;
		let base = flow.indexOf(targetScreen) + 1;
		if (targetScreen === 'followup') base = 4 + targetFollowupIndex;
		if (targetScreen === 'generating') base = 4 + followupLength;
		if (targetScreen === 'results') base = 5 + followupLength;
		return {
			current: Math.min(base, total),
			total,
			label: '추천'
		};
	}

	function sourceLabel(source: RecommendationCard['items'][number]['source']) {
		if (source === 'myrealtrip') return '마이리얼트립';
		if (source === 'api_fuse') return 'API Fuse';
		if (source === 'genrank') return 'GenRank';
		return 'SAI';
	}

	function providerLabel(provider: CandidateBundle['statuses'][number]['provider']) {
		if (provider === 'myrealtrip') return '마이리얼트립';
		if (provider === 'api_fuse') return 'API Fuse';
		if (provider === 'genrank') return 'GenRank';
		return 'Swing';
	}

	function resultTypeLabel(card: RecommendationCard) {
		if (card.resultType === 'single_activity') return '단일 활동';
		if (card.resultType === 'mini_course') return '미니 코스';
		if (card.resultType === 'timetable') return '시간표형';
		return '코스형';
	}

	function weatherFitLabel(card: RecommendationCard) {
		if (card.weatherFit === 'indoor') return '실내 중심';
		if (card.weatherFit === 'mostly_indoor') return '대부분 실내';
		if (card.weatherFit === 'outdoor') return '야외 적합';
		return '날씨 무난';
	}
</script>

<svelte:head>
	<title>사이 SAI</title>
	<meta
		name="description"
		content="시간, 예산, 위치, 동행 상황을 반영해 오늘 할 일을 추천하는 SAI MVP"
	/>
</svelte:head>

<main class="app-frame">
	<section class={`phone-shell state-${screen}`}>
		<header class="topbar">
			<button class="brand-button" type="button" onclick={goHome} aria-label="홈으로">
				<img src={saiSymbol} alt="" />
				<span>사이</span>
			</button>
			{#if currentUserId}
				<button class="ghost small" type="button" onclick={logout}>나가기</button>
			{/if}
		</header>

		{#if progress.total > 0}
			<div
				class="stepper"
				style={`--steps:${progress.total}`}
				aria-label={`${progress.label} ${progress.current}/${progress.total}`}
			>
				{#each progressDots as index (index)}
					<span class={index < progress.current ? 'active' : ''}></span>
				{/each}
			</div>
		{/if}

		{#if screen === 'auth'}
			<section class="screen auth-screen">
				<div class="hero-lockup">
					<img class="hero-symbol" src={saiSymbol} alt="사이" />
					<p class="eyebrow">SITUATION-AWARE AI</p>
					<h1>오늘 뭐하지?</h1>
					<p>시간과 돈 사이에서 지금 제일 괜찮은 선택지를 찾아줄게.</p>
				</div>

				<form class="auth-form" onsubmit={(event) => event.preventDefault()}>
					<div class="auth-toggle" aria-label="로그인 또는 회원가입">
						<button
							class={authMode === 'login' ? 'active' : ''}
							type="button"
							onclick={() => (authMode = 'login')}>로그인</button
						>
						<button
							class={authMode === 'signup' ? 'active' : ''}
							type="button"
							onclick={() => (authMode = 'signup')}>회원가입</button
						>
					</div>

					<label class="field">
						<span>이메일</span>
						<input
							type="email"
							autocomplete="email"
							value={authEmail}
							oninput={(event) => (authEmail = inputValue(event))}
							placeholder="you@example.com"
						/>
					</label>
					<label class="field">
						<span>비밀번호</span>
						<input
							type="password"
							autocomplete={authMode === 'login' ? 'current-password' : 'new-password'}
							value={authPassword}
							oninput={(event) => (authPassword = inputValue(event))}
							placeholder="비밀번호"
						/>
					</label>

					{#if authError}
						<p class="error-text">{authError}</p>
					{/if}

					<button class="primary" type="button" onclick={submitAuth} disabled={busy}>
						{busy ? '잠깐만' : authMode === 'login' ? '로그인' : '회원가입'}
					</button>
				</form>
			</section>
		{:else if screen === 'location'}
			<section class="screen decision-screen location-screen">
				<div class="location-speaker">
					<div class="location-bubble">
						<p class="eyebrow">위치</p>
						<h1>지금 어디쯤 있어?</h1>
						<p>근처로 찾아볼게. 동네 이름으로 알려줘도 돼.</p>
					</div>
					<div class={`mascot mascot-${mascotState} location-mascot`}>
						<img src={saiSymbol} alt="사이" />
					</div>
				</div>

				<div class="bottom-actions">
					<div class="location-entry">
						<label class="field compact">
							<span>동네 입력</span>
							<input
								value={manualRegion}
								onfocus={handleManualRegionFocus}
								oninput={handleManualRegionInput}
								onkeydown={handleManualRegionKeydown}
								placeholder="예: 성수동, 홍대입구"
								autocomplete="off"
							/>
						</label>
						{#if locationSuggestionsOpen && (locationSuggestionsLoading || locationSuggestions.length || locationSearchMessage)}
							<div class="location-suggestions" aria-live="polite">
								{#if locationSuggestionsLoading}
									<p>지역 후보 찾는 중</p>
								{/if}
								{#each locationSuggestions as suggestion (suggestion.id)}
									<button type="button" onclick={() => selectLocationSuggestion(suggestion)}>
										<strong>{suggestion.label}</strong>
										{#if suggestion.description}
											<span>{suggestion.description}</span>
										{/if}
									</button>
								{/each}
								{#if locationSearchMessage}
									<p>{locationSearchMessage}</p>
								{/if}
							</div>
						{/if}
					</div>
					<button class="secondary" type="button" onclick={saveManualLocation}>
						이 지역으로 시작
					</button>
					<button class="primary" type="button" onclick={requestLocation} disabled={busy}>
						{busy ? '위치 확인 중' : '현재 위치로 찾기'}
					</button>
				</div>
			</section>
		{:else if screen === 'onboarding'}
			<section class="screen decision-screen">
				<div class="coach-row">
					<div class={`mini-mascot mascot-${mascotState}`}>
						<img src={saiSymbol} alt="" />
					</div>
					<div class="speech-bubble">
						<p class="eyebrow">{progress.current}/{progress.total}</p>
						<h1>{currentOnboardingQuestion.prompt}</h1>
						<p>{currentOnboardingQuestion.reaction}</p>
					</div>
				</div>

				<div class={`choice-stack ${currentOnboardingQuestion.compact ? 'compact-grid' : ''}`}>
					{#each currentOnboardingQuestion.options as option (option.id)}
						<button
							class={isOnboardingSelected(currentOnboardingQuestion, option.value) ? 'active' : ''}
							type="button"
							onclick={() => selectOnboardingOption(currentOnboardingQuestion, option.value)}
						>
							{option.label}
						</button>
					{/each}
				</div>

				<div class="bottom-actions">
					<button
						class="primary"
						type="button"
						onclick={continueOnboarding}
						disabled={!onboardingAnswered}
					>
						{onboardingIndex === onboardingQuestions.length - 1 ? '온보딩 끝내기' : '다음'}
					</button>
				</div>
			</section>
		{:else if screen === 'home'}
			<section class="screen home-screen">
				<div class="home-hero">
					<div class={`mascot mascot-${mascotState}`}>
						<img src={saiSymbol} alt="사이" />
					</div>
					<div>
						<p class="eyebrow">{profile?.recentLocation?.label ?? defaultLocation.label}</p>
						<h1>{profile?.email.split('@')[0]}야, 오늘 뭐하지?</h1>
						<p>지금 쓸 수 있는 시간과 총 예산만 알려줘.</p>
					</div>
				</div>

				<button class="primary large" type="button" onclick={startRecommendation}>추천받기</button>

				{#if recentHistory.length}
					<section class="history-strip" aria-label="최근 추천">
						<h2>최근 추천</h2>
						<div class="history-list">
							{#each recentHistory as item (item.session.id)}
								<button class="history-chip" type="button" onclick={() => loadHistory(item)}>
									<span>{situationLabel(item.session.situation)}</span>
									<strong>{item.cards[0]?.label ?? '추천'}</strong>
								</button>
							{/each}
						</div>
					</section>
				{/if}
			</section>
		{:else if screen === 'situation'}
			<section class="screen decision-screen">
				<div class="question-block">
					<p class="eyebrow">오늘의 상황</p>
					<h1>오늘 누구랑?</h1>
					<p>아기 동반 같은 제약은 이번 추천에만 저장할게.</p>
				</div>

				<div class="situation-grid">
					{#each situationOptions as option (option.id)}
						<button
							class={`situation-card accent-${option.accent} ${session.situation === option.id ? 'active' : ''}`}
							type="button"
							onclick={() => setSituation(option.id)}
						>
							<span>{option.icon}</span>
							<strong>{option.label}</strong>
						</button>
					{/each}
				</div>

				<button
					class={`baby-toggle ${session.companionConstraints.hasBaby ? 'active' : ''}`}
					type="button"
					onclick={toggleBaby}
				>
					<span class="toggle-dot"></span>
					<strong>아기(영유아) 동반</strong>
				</button>

				{#if session.companionConstraints.hasBaby}
					<div class="facility-panel">
						<p>필요한 편의를 골라줘.</p>
						<div class="chip-grid">
							{#each babyFacilityOptions as option (option.id)}
								<button
									class={session.companionConstraints[option.id] ? 'active' : ''}
									type="button"
									onclick={() => toggleBabyFacility(option.id)}
								>
									{option.label}
								</button>
							{/each}
							<button
								class={session.companionConstraints.babyCarrierOk ? 'active' : ''}
								type="button"
								onclick={toggleBabyCarrier}>아기띠도 가능</button
							>
						</div>
					</div>
				{/if}

				<div class="bottom-actions">
					<button
						class="primary"
						type="button"
						onclick={continueSituation}
						disabled={!selectedSituation}
					>
						다음
					</button>
				</div>
			</section>
		{:else if screen === 'time'}
			<section class="screen decision-screen">
				<div class="question-block">
					<p class="eyebrow">{selectedSituation?.label ?? '상황'} · 시간</p>
					<h1>쓸 수 있는 시간이 얼마나 돼?</h1>
					<p>시간이 길수록 코스형으로 묶어볼게.</p>
				</div>

				<div class="chip-grid">
					{#each timeOptions as option (option.id)}
						<button
							class={session.availableTime === option.id ? 'active' : ''}
							type="button"
							onclick={() => selectTime(option.id)}
						>
							{option.label}
						</button>
					{/each}
				</div>

				{#if timeCustomMode}
					<label class="field">
						<span>직접 입력</span>
						<textarea
							rows="2"
							value={customTimeInput}
							oninput={(event) => (customTimeInput = textareaValue(event))}
							placeholder="예: 오늘 3시부터 7시까지"
						></textarea>
					</label>
				{/if}

				<div class="voice-row">
					<button
						class={`mic ${listeningFor === 'time' ? 'listening' : ''}`}
						type="button"
						onclick={() => startSpeech('time')}
						aria-label="시간 음성 입력"
					>
						<span></span>
					</button>
					<p>{speechTranscript || speechMessage || '말해도 되고, 칩으로 골라도 돼.'}</p>
				</div>

				<div class="bottom-actions">
					<button
						class="primary"
						type="button"
						onclick={continueTime}
						disabled={!session.availableTime}
					>
						다음
					</button>
				</div>
			</section>
		{:else if screen === 'budget'}
			<section class="screen decision-screen">
				<div class="question-block">
					<p class="eyebrow">{timeMeta(session.availableTime).label} · 총 예산</p>
					<h1>이번 활동 총 예산은?</h1>
					<p>여러 명이어도 총액 기준으로 계산할게.</p>
				</div>

				<div class="chip-grid">
					{#each budgetOptions as option (option.id)}
						<button
							class={option.value > 0
								? session.budgetTotal === option.value
									? 'active'
									: ''
								: budgetCustomMode
									? 'active'
									: ''}
							type="button"
							onclick={() => selectBudget(option.value)}
						>
							{option.label}
						</button>
					{/each}
				</div>

				{#if budgetCustomMode}
					<label class="field">
						<span>직접 입력</span>
						<input
							inputmode="numeric"
							value={customBudgetInput}
							oninput={(event) => applyCustomBudgetInput(inputValue(event))}
							placeholder="예: 60000"
						/>
					</label>
				{/if}

				<div class="budget-meter" aria-label="예산 요약">
					<div>
						<span>총 예산</span>
						<strong>{session.budgetTotal ? formatKrw(session.budgetTotal) : '-'}</strong>
					</div>
					<div>
						<span>참고 1인당</span>
						<strong>{perPersonBudget ? formatKrw(perPersonBudget) : '-'}</strong>
					</div>
				</div>

				<div class="voice-row">
					<button
						class={`mic ${listeningFor === 'budget' ? 'listening' : ''}`}
						type="button"
						onclick={() => startSpeech('budget')}
						aria-label="예산 음성 입력"
					>
						<span></span>
					</button>
					<p>{speechTranscript || speechMessage || '예: 십만원, 6만원처럼 말해도 돼.'}</p>
				</div>

				<div class="bottom-actions">
					<button
						class="primary"
						type="button"
						onclick={continueBudget}
						disabled={!session.budgetTotal}
					>
						AI에게 물어보기
					</button>
				</div>
			</section>
		{:else if screen === 'followup'}
			<section class="screen decision-screen">
				<div class="coach-row">
					<div class="mini-mascot mascot-thinking">
						<img src={saiSymbol} alt="" />
					</div>
					<div class="speech-bubble">
						<p class="eyebrow">
							AI 추가 질문 {followupIndex + 1}/{followupQuestions.length} · {followupSource ===
							'exaone'
								? 'EXAONE'
								: followupSource === 'openai'
									? 'OpenAI'
									: 'fallback'}
						</p>
						<h1>{currentFollowup?.prompt}</h1>
						<p>시간, 예산, 동행 제약은 이미 받았으니 다시 묻지 않을게.</p>
					</div>
				</div>

				<div class="choice-stack">
					{#each currentFollowup?.options ?? [] as option (option.id)}
						<button
							type="button"
							onclick={() => currentFollowup && answerFollowup(currentFollowup, option.value)}
						>
							{option.label}
						</button>
					{/each}
				</div>

				<div class="voice-row">
					<button
						class={`mic ${listeningFor === 'followup' ? 'listening' : ''}`}
						type="button"
						onclick={() => startSpeech('followup')}
						aria-label="추가 질문 음성 답변"
					>
						<span></span>
					</button>
					<p>{speechTranscript || speechMessage || '짧게 말해도 내가 골라볼게.'}</p>
				</div>
			</section>
		{:else if screen === 'generating'}
			<section class="screen generating-screen" aria-live="polite">
				<div class={`mascot mascot-${mascotState}`}>
					<img src={saiSymbol} alt="사이" />
				</div>
				<div class="question-block">
					<p class="eyebrow">API 후보 수집</p>
					<h1>AI 친구들이 잠깐 회의 중이야</h1>
					<p>날씨, 지도, 맛집, 액티비티 후보를 시간과 예산 안에서 맞춰보고 있어.</p>
				</div>
				<div class="loading-stack">
					<span></span>
					<span></span>
					<span></span>
				</div>
			</section>
		{:else if screen === 'results'}
			<section class="screen results-screen">
				<div class="results-header">
					<div>
						<p class="eyebrow">
							{situationLabel(session.situation)} · {candidateBundle?.weather.label ??
								session.weatherSnapshot.label}
						</p>
						<h1>이 3개로 추렸어</h1>
					</div>
					<div class="result-tools">
						<span>{compositionSource === 'openai' ? 'OpenAI 작곡' : 'fallback 작곡'}</span>
						<button class="secondary small" type="button" onclick={speakResults}>읽어줘</button>
					</div>
				</div>

				{#if candidateBundle}
					<div class="source-strip" aria-label="후보 수집 출처">
						{#each candidateBundle.statuses as status, index (`${status.provider}-${index}`)}
							<span class={status.ok ? 'ok' : ''}>
								{providerLabel(status.provider)}
								{status.ok ? '연결' : status.configured ? 'fallback' : 'mock'}
							</span>
						{/each}
					</div>
				{/if}

				<div class="recommendation-list">
					{#each recommendations as card, index (card.id)}
						<article class="rec-card" style={`--delay:${index * 60}ms`}>
							<div class="rec-topline">
								<span class="label-chip">{card.label}</span>
								<span>{resultTypeLabel(card)}</span>
							</div>
							<h2>{card.title}</h2>
							<p class="why">{card.reason}</p>

							<div class="plan-grid">
								<div>
									<span>시간</span>
									<strong>{card.estimatedDuration}</strong>
								</div>
								<div>
									<span>예상 비용</span>
									<strong>{formatKrw(card.estimatedCost)}</strong>
								</div>
								<div>
									<span>1인당</span>
									<strong>{card.perPersonText.replace('1인당 약 ', '')}</strong>
								</div>
								<div>
									<span>이동</span>
									<strong>{card.routeSummary}</strong>
								</div>
								<div>
									<span>날씨</span>
									<strong>{weatherFitLabel(card)}</strong>
								</div>
							</div>

							<div class="budget-note">{card.budgetText}</div>

							<div class="course-items">
								{#each card.items as item (item.title)}
									<a
										href={item.outboundUrl}
										target="_blank"
										rel="external noreferrer"
										onclick={() => recordClick(card.id)}
									>
										<span>{sourceLabel(item.source)}</span>
										<strong>{item.title}</strong>
										<em>{formatKrw(item.price)}</em>
									</a>
								{/each}
							</div>

							<div class="badge-row">
								{#each card.badges as badge (badge)}
									<span>{badge}</span>
								{/each}
								{#each card.companionFit as fit (fit)}
									<span class="companion">{fit}</span>
								{/each}
							</div>

							<div class="rec-actions">
								<a
									class="primary link-button"
									href={card.outboundUrl}
									target="_blank"
									rel="external noreferrer"
									onclick={() => recordClick(card.id)}>상세/길찾기</a
								>
							</div>

							<div class="feedback-bar">
								<button
									class={feedbackDraft[card.id]?.sentiment === 'like' ? 'active' : ''}
									type="button"
									onclick={() => setFeedback(card.id, 'like')}>좋아요</button
								>
								<button
									class={feedbackDraft[card.id]?.sentiment === 'dislike' ? 'active' : ''}
									type="button"
									onclick={() => setFeedback(card.id, 'dislike')}>별로예요</button
								>
							</div>

							{#if feedbackDraft[card.id]?.sentiment}
								<div class="reason-chips">
									{#each feedbackDraft[card.id]?.sentiment === 'like' ? likeReasons : dislikeReasons as reason (reason)}
										<button
											class={feedbackDraft[card.id]?.reasons.includes(reason) ? 'active' : ''}
											type="button"
											onclick={() => toggleFeedbackReason(card.id, reason)}
										>
											{reason}
										</button>
									{/each}
								</div>
							{/if}
						</article>
					{/each}
				</div>

				<div class="bottom-actions inline">
					<button class="secondary" type="button" onclick={goHome}>홈</button>
					<button class="primary" type="button" onclick={startRecommendation}>다시 추천</button>
				</div>
			</section>
		{/if}
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		min-height: 100vh;
		background: #f3eee8;
		color: var(--ink);
		font-family:
			Pretendard,
			ui-sans-serif,
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
	}

	:global(*) {
		box-sizing: border-box;
	}

	:global(button),
	:global(input),
	:global(textarea) {
		font: inherit;
	}

	:global(button) {
		-webkit-tap-highlight-color: transparent;
	}

	.app-frame {
		--coral: #ff6b5e;
		--violet: #b45ee8;
		--indigo: #5b6cff;
		--ink: #211c2b;
		--ink2: #4a4458;
		--muted: #6b6478;
		--faint: #9a93a8;
		--line: #ece7f3;
		--bg: #faf7f4;
		--card: #ffffff;
		--good: oklch(0.64 0.13 152);
		--warn: oklch(0.7 0.15 55);
		--brand: linear-gradient(90deg, #ff6b5e, #b45ee8 55%, #5b6cff);
		min-height: 100vh;
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.38), rgba(255, 255, 255, 0)), var(--bg);
	}

	.phone-shell {
		width: min(100%, 480px);
		min-height: 100vh;
		margin: 0 auto;
		padding: max(16px, env(safe-area-inset-top)) 20px max(18px, env(safe-area-inset-bottom));
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 44px;
	}

	.brand-button {
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		border: 0;
		background: transparent;
		color: var(--ink);
		font-weight: 900;
		cursor: pointer;
	}

	.brand-button img {
		width: 32px;
		height: 36px;
	}

	.stepper {
		display: grid;
		grid-template-columns: repeat(var(--steps, 5), minmax(0, 1fr));
		gap: 6px;
	}

	.stepper span {
		height: 6px;
		border-radius: 999px;
		background: #e6e0ed;
	}

	.stepper span.active {
		background: var(--brand);
	}

	.screen {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 18px;
		min-height: 0;
	}

	.auth-screen,
	.home-screen,
	.generating-screen {
		justify-content: center;
	}

	.hero-lockup,
	.home-hero,
	.question-block {
		display: grid;
		gap: 8px;
	}

	.hero-lockup {
		text-align: center;
		justify-items: center;
		margin-top: 10px;
	}

	.hero-symbol {
		width: 112px;
		height: 126px;
	}

	.eyebrow {
		margin: 0;
		color: var(--faint);
		font-size: 12px;
		font-weight: 900;
		letter-spacing: 0;
		text-transform: uppercase;
	}

	h1,
	h2,
	p {
		margin: 0;
		word-break: keep-all;
	}

	h1 {
		color: var(--ink);
		font-size: 28px;
		line-height: 1.16;
		font-weight: 900;
		letter-spacing: 0;
	}

	h2 {
		color: var(--ink);
		font-size: 20px;
		line-height: 1.22;
		font-weight: 900;
		letter-spacing: 0;
	}

	p {
		color: var(--muted);
		font-size: 15px;
		line-height: 1.5;
		font-weight: 600;
	}

	.auth-form,
	.facility-panel,
	.rec-card {
		border: 1px solid rgba(236, 231, 243, 0.92);
		border-radius: 20px;
		background: var(--card);
		box-shadow: 0 8px 26px rgba(120, 110, 160, 0.13);
	}

	.auth-form {
		display: grid;
		gap: 12px;
		padding: 16px;
	}

	.auth-toggle {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
		padding: 4px;
		border-radius: 16px;
		background: #f2edf7;
	}

	.auth-toggle button,
	.choice-stack button,
	.chip-grid button,
	.feedback-bar button,
	.reason-chips button {
		min-height: 44px;
		border: 1px solid transparent;
		border-radius: 14px;
		background: transparent;
		color: var(--ink2);
		font-weight: 850;
		cursor: pointer;
	}

	.auth-toggle button.active,
	.choice-stack button.active,
	.chip-grid button.active,
	.reason-chips button.active {
		background: var(--ink);
		color: #fff;
	}

	.field {
		display: grid;
		gap: 7px;
	}

	.field span {
		color: var(--muted);
		font-size: 12px;
		font-weight: 900;
	}

	.field input,
	.field textarea {
		width: 100%;
		min-height: 52px;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: #fff;
		color: var(--ink);
		padding: 13px 14px;
		outline: none;
		resize: vertical;
	}

	.field input:focus,
	.field textarea:focus {
		border-color: var(--violet);
		box-shadow: 0 0 0 4px rgba(180, 94, 232, 0.14);
	}

	.field.compact input {
		min-height: 48px;
	}

	.error-text {
		color: #c9483d;
		font-size: 13px;
		font-weight: 800;
	}

	.primary,
	.secondary,
	.ghost {
		min-height: 52px;
		border-radius: 16px;
		padding: 0 16px;
		font-weight: 900;
		cursor: pointer;
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.primary {
		border: 0;
		background: var(--brand);
		color: #fff;
		box-shadow: 0 12px 26px rgba(180, 94, 232, 0.24);
	}

	.primary:disabled,
	.secondary:disabled {
		cursor: not-allowed;
		background: #e3deea;
		color: var(--faint);
		box-shadow: none;
	}

	.secondary {
		border: 1px solid var(--line);
		background: #fff;
		color: var(--ink);
	}

	.ghost {
		border: 0;
		background: transparent;
		color: var(--muted);
	}

	.small {
		min-height: 40px;
		border-radius: 14px;
		padding: 0 12px;
		font-size: 13px;
	}

	.large {
		min-height: 60px;
		font-size: 17px;
	}

	.mascot,
	.mini-mascot {
		display: grid;
		place-items: center;
		justify-self: center;
	}

	.mascot img {
		width: 132px;
		height: 148px;
		filter: drop-shadow(0 16px 24px rgba(120, 90, 200, 0.18));
	}

	.mini-mascot img {
		width: 58px;
		height: 65px;
		filter: drop-shadow(0 8px 14px rgba(120, 90, 200, 0.14));
	}

	.mascot-idle img {
		animation: idle-float 3.2s ease-in-out infinite;
		transform-origin: 50% 86%;
	}

	.mascot-thinking img,
	.mascot-thinking {
		animation: bob 1.15s ease-in-out infinite;
	}

	.mascot-happy img {
		animation: happy 900ms ease-in-out both;
	}

	.decision-screen {
		padding-top: 6px;
	}

	.location-screen {
		text-align: left;
	}

	.location-speaker {
		display: grid;
		justify-items: center;
		gap: 12px;
		padding-top: 2px;
	}

	.location-mascot {
		width: 100%;
	}

	.location-bubble {
		position: relative;
		display: grid;
		gap: 8px;
		width: min(100%, 360px);
		padding: 16px;
		border: 1px solid rgba(236, 231, 243, 0.92);
		border-radius: 20px;
		background: #fff;
		box-shadow: 0 12px 28px rgba(120, 110, 160, 0.13);
	}

	.location-bubble::before,
	.location-bubble::after {
		position: absolute;
		left: 50%;
		width: 18px;
		height: 18px;
		content: '';
		transform: translateX(-50%) rotate(45deg);
	}

	.location-bubble::before {
		bottom: -10px;
		border-bottom: 1px solid rgba(236, 231, 243, 0.92);
		border-right: 1px solid rgba(236, 231, 243, 0.92);
		background: #fff;
	}

	.location-bubble::after {
		bottom: -8px;
		background: #fff;
	}

	.location-entry {
		position: relative;
		display: grid;
		gap: 8px;
	}

	.location-suggestions {
		position: absolute;
		right: 0;
		bottom: calc(100% + 8px);
		left: 0;
		z-index: 4;
		display: grid;
		gap: 6px;
		max-height: 178px;
		overflow-y: auto;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: #fff;
		padding: 8px;
		box-shadow: 0 12px 24px rgba(120, 110, 160, 0.13);
	}

	.location-suggestions button {
		display: grid;
		gap: 2px;
		min-height: 44px;
		border: 0;
		border-radius: 12px;
		background: transparent;
		color: var(--ink);
		padding: 8px 10px;
		text-align: left;
		cursor: pointer;
	}

	.location-suggestions button:hover,
	.location-suggestions button:focus-visible {
		background: #f6f1fb;
		outline: none;
	}

	.location-suggestions strong {
		font-size: 14px;
		font-weight: 900;
	}

	.location-suggestions span,
	.location-suggestions p {
		color: var(--muted);
		font-size: 12px;
		font-weight: 700;
	}

	.coach-row {
		display: grid;
		grid-template-columns: 66px 1fr;
		gap: 12px;
		align-items: start;
	}

	.speech-bubble {
		display: grid;
		gap: 8px;
		padding: 16px;
		border: 1px solid var(--line);
		border-radius: 20px;
		background: #fff;
		box-shadow: 0 4px 14px rgba(120, 110, 160, 0.1);
	}

	.choice-stack,
	.chip-grid {
		display: grid;
		gap: 10px;
	}

	.choice-stack button,
	.chip-grid button {
		border-color: var(--line);
		background: #fff;
		text-align: left;
		padding: 0 14px;
	}

	.choice-stack button.active,
	.chip-grid button.active {
		border-color: var(--ink);
	}

	.choice-stack.compact-grid {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}

	.choice-stack.compact-grid button {
		min-height: 42px;
		padding: 0 6px;
		text-align: center;
	}

	.chip-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.chip-grid button {
		text-align: center;
	}

	.situation-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}

	.situation-card {
		min-height: 94px;
		display: grid;
		place-items: center;
		gap: 8px;
		border: 1px solid var(--line);
		border-radius: 18px;
		background: #fff;
		color: var(--ink);
		cursor: pointer;
	}

	.situation-card span {
		display: grid;
		place-items: center;
		width: 38px;
		height: 38px;
		border-radius: 999px;
		background: #f6f1fb;
		font-size: 13px;
		font-weight: 950;
	}

	.situation-card strong {
		font-weight: 900;
	}

	.situation-card.active {
		border-color: currentColor;
		box-shadow: 0 8px 22px rgba(120, 110, 160, 0.14);
	}

	.accent-solo {
		color: oklch(0.58 0.13 30);
	}

	.accent-friend {
		color: oklch(0.52 0.13 75);
	}

	.accent-couple {
		color: oklch(0.58 0.13 352);
	}

	.accent-family {
		color: oklch(0.5 0.12 155);
	}

	.accent-group {
		color: oklch(0.5 0.13 265);
	}

	.baby-toggle {
		min-height: 52px;
		display: flex;
		align-items: center;
		gap: 10px;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: #fff;
		color: var(--ink);
		padding: 0 14px;
		cursor: pointer;
	}

	.toggle-dot {
		width: 22px;
		height: 22px;
		border: 2px solid #d8d0e2;
		border-radius: 999px;
	}

	.baby-toggle.active {
		border-color: rgba(100, 180, 130, 0.5);
		background: rgba(100, 180, 130, 0.1);
	}

	.baby-toggle.active .toggle-dot {
		border-color: var(--good);
		background: var(--good);
		box-shadow: inset 0 0 0 5px #fff;
	}

	.facility-panel {
		display: grid;
		gap: 12px;
		padding: 14px;
	}

	.home-hero {
		grid-template-columns: 132px 1fr;
		align-items: center;
	}

	.history-strip {
		display: grid;
		gap: 10px;
	}

	.history-list {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		padding-bottom: 4px;
	}

	.history-chip {
		min-width: 160px;
		min-height: 68px;
		display: grid;
		align-content: center;
		gap: 4px;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: #fff;
		color: var(--ink);
		padding: 10px;
		text-align: left;
		cursor: pointer;
	}

	.history-chip span {
		color: var(--faint);
		font-size: 12px;
		font-weight: 900;
	}

	.history-chip strong {
		font-size: 14px;
		line-height: 1.3;
	}

	.budget-meter {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}

	.budget-meter div {
		display: grid;
		gap: 5px;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: #fff;
		padding: 14px;
	}

	.budget-meter span,
	.plan-grid span,
	.course-items span,
	.rec-topline span {
		color: var(--faint);
		font-size: 11px;
		font-weight: 900;
	}

	.budget-meter strong,
	.plan-grid strong {
		color: var(--ink);
		font-size: 14px;
		line-height: 1.35;
	}

	.voice-row {
		display: grid;
		grid-template-columns: 52px 1fr;
		gap: 10px;
		align-items: center;
		min-height: 56px;
	}

	.mic {
		position: relative;
		width: 52px;
		height: 52px;
		border: 0;
		border-radius: 999px;
		background: var(--brand);
		cursor: pointer;
		box-shadow: 0 8px 20px rgba(180, 94, 232, 0.24);
	}

	.mic span,
	.mic::before {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
	}

	.mic span {
		width: 14px;
		height: 22px;
		border-radius: 999px;
		background: #fff;
	}

	.mic::before {
		content: '';
		width: 24px;
		height: 28px;
		border: 3px solid rgba(255, 255, 255, 0.78);
		border-top: 0;
		border-radius: 0 0 999px 999px;
	}

	.mic.listening {
		animation: pulse 900ms ease-in-out infinite;
	}

	.loading-stack {
		display: grid;
		gap: 10px;
	}

	.loading-stack span {
		height: 72px;
		border-radius: 20px;
		background: linear-gradient(90deg, #eee7f4, #fff, #eee7f4);
		background-size: 240% 100%;
		animation: shimmer 1.2s linear infinite;
	}

	.results-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.result-tools {
		display: grid;
		justify-items: end;
		gap: 6px;
	}

	.result-tools span {
		color: var(--faint);
		font-size: 11px;
		font-weight: 900;
	}

	.source-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.source-strip span {
		border-radius: 999px;
		background: #f2edf7;
		color: var(--muted);
		padding: 6px 9px;
		font-size: 11px;
		font-weight: 900;
	}

	.source-strip span.ok {
		background: rgba(97, 176, 126, 0.12);
		color: #28764e;
	}

	.recommendation-list {
		display: grid;
		gap: 14px;
		padding-bottom: 90px;
	}

	.rec-card {
		display: grid;
		gap: 12px;
		padding: 16px;
		animation: fade-up 420ms ease both;
		animation-delay: var(--delay);
	}

	.rec-topline {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.label-chip {
		display: inline-flex;
		align-items: center;
		min-height: 30px;
		border-radius: 999px;
		padding: 0 10px;
		background: rgba(255, 107, 94, 0.12);
		color: var(--coral) !important;
		font-size: 12px !important;
	}

	.why {
		border-left: 4px solid var(--coral);
		border-radius: 10px;
		background: rgba(255, 107, 94, 0.08);
		padding: 10px 12px;
		color: var(--ink2);
	}

	.plan-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}

	.plan-grid div {
		display: grid;
		gap: 5px;
		min-height: 72px;
		border-radius: 14px;
		background: #faf8fc;
		padding: 10px;
	}

	.budget-note {
		min-height: 36px;
		display: flex;
		align-items: center;
		border-radius: 12px;
		background: rgba(97, 176, 126, 0.12);
		color: #28764e;
		padding: 0 12px;
		font-size: 13px;
		font-weight: 900;
	}

	.course-items {
		display: grid;
		gap: 8px;
	}

	.course-items a {
		display: grid;
		grid-template-columns: 86px 1fr auto;
		gap: 8px;
		align-items: center;
		min-height: 50px;
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 8px 10px;
		color: var(--ink);
		text-decoration: none;
	}

	.course-items strong {
		font-size: 13px;
		line-height: 1.3;
	}

	.course-items em {
		color: var(--muted);
		font-size: 12px;
		font-style: normal;
		font-weight: 900;
		white-space: nowrap;
	}

	.badge-row,
	.reason-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.badge-row span {
		border-radius: 999px;
		background: #f0ecff;
		color: var(--indigo);
		padding: 6px 9px;
		font-size: 12px;
		font-weight: 900;
	}

	.badge-row span.companion {
		background: rgba(97, 176, 126, 0.12);
		color: #28764e;
	}

	.rec-actions {
		display: grid;
	}

	.link-button {
		width: 100%;
	}

	.feedback-bar {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		padding-top: 4px;
	}

	.feedback-bar button {
		border-color: var(--line);
		background: #fff;
	}

	.feedback-bar button.active:first-child {
		border-color: rgba(97, 176, 126, 0.45);
		background: rgba(97, 176, 126, 0.12);
		color: #28764e;
	}

	.feedback-bar button.active:last-child {
		border-color: rgba(255, 107, 94, 0.45);
		background: rgba(255, 107, 94, 0.12);
		color: #b33d34;
	}

	.reason-chips button {
		min-height: 34px;
		border-color: var(--line);
		background: #fff;
		padding: 0 10px;
		font-size: 12px;
	}

	.bottom-actions {
		position: sticky;
		bottom: 0;
		z-index: 3;
		display: grid;
		gap: 10px;
		margin-top: auto;
		padding-top: 18px;
		background: linear-gradient(180deg, rgba(250, 247, 244, 0), var(--bg) 22px);
	}

	.bottom-actions.inline {
		grid-template-columns: 0.72fr 1fr;
	}

	@keyframes bob {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-8px);
		}
	}

	@keyframes idle-float {
		0%,
		100% {
			transform: translateY(0) rotate(0deg) scale(1);
		}
		30% {
			transform: translateY(-4px) rotate(-1.4deg) scale(1.01);
		}
		62% {
			transform: translateY(2px) rotate(1.2deg) scale(0.998);
		}
	}

	@keyframes happy {
		0% {
			transform: scale(0.96);
		}
		70% {
			transform: scale(1.04);
		}
		100% {
			transform: scale(1);
		}
	}

	@keyframes pulse {
		0%,
		100% {
			box-shadow: 0 8px 20px rgba(180, 94, 232, 0.24);
		}
		50% {
			box-shadow:
				0 8px 20px rgba(180, 94, 232, 0.24),
				0 0 0 9px rgba(180, 94, 232, 0.12);
		}
	}

	@keyframes shimmer {
		to {
			background-position: -240% 0;
		}
	}

	@keyframes fade-up {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		* {
			animation-duration: 1ms !important;
			animation-iteration-count: 1 !important;
			scroll-behavior: auto !important;
		}
	}

	@media (max-width: 360px) {
		.phone-shell {
			padding-left: 14px;
			padding-right: 14px;
		}

		.choice-stack.compact-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		.home-hero {
			grid-template-columns: 1fr;
			text-align: center;
			justify-items: center;
		}

		.course-items a {
			grid-template-columns: 1fr;
		}
	}
</style>
