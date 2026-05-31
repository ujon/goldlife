<script lang="ts">
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import saiSymbol from '$lib/assets/sai-symbol.svg';
	import { createSubscriber } from 'svelte/reactivity';
	import type { CandidateBundle } from '$lib/sai/candidates';
	import {
		applyTimeUtilization,
		buildFollowupQuestions,
		companionRelationSummary,
		normalizeCompanionRelations,
		composeRecommendations,
		createRecommendationSession,
		formatKrw,
		partyCountForSession,
		primarySituationFromRelations,
		timeMeta
	} from '$lib/sai/recommendations';
	import type {
		AuthMode,
		CompanionRelation,
		FollowupQuestion,
		LocationSuggestion,
		LocationValue,
		MbtiType,
		OnboardingFreeformAnswer,
		OnboardingQuestionId,
		RecommendationCard,
		RecommendationHistoryItem,
		RecommendationSession,
		Screen,
		UserProfile
	} from '$lib/sai/types';

	type OnboardingQuestion = {
		id: OnboardingQuestionId;
		prompt: string;
		options: Array<{ id: string; label: string; value: string }>;
		multi?: boolean;
		compact?: boolean;
		reaction: string;
	};

	type KnownMbtiType = Exclude<MbtiType, '' | 'unknown'>;
	type SpeechTarget = 'situation' | 'time' | 'budget' | 'extra' | 'followup' | 'onboarding';
	type OnboardingVoiceOptions = {
		readQuestion?: boolean;
	};
	type WebSpeechRecognition = {
		lang: string;
		interimResults: boolean;
		maxAlternatives: number;
		start: () => void;
		stop: () => void;
		onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
		onerror: (() => void) | null;
		onend: (() => void) | null;
	};
	type WebSpeechRecognitionConstructor = new () => WebSpeechRecognition;
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
	type SaiScreenVoicePlan = {
		key: string;
		text: string;
		listen: Exclude<SpeechTarget, 'onboarding'> | null;
	};
	type LocationSearchResult = {
		suggestions: LocationSuggestion[];
	};
	type ServerResult<T> =
		| { type: 'ok'; data: T }
		| { type: 'error'; status: number; message: string };
	type ParsedTimePoint = {
		rawHour: number;
		hour: number;
		minute: number;
		meridiem: string;
	};
	type ParsedTimeRange = {
		start: string;
		end: string;
		label: string;
	};
	type RecommendationItem = RecommendationCard['items'][number];
	type ExternalSheet = {
		cardId: string;
		title: string;
		provider: string;
		url: string;
		description: string;
	};
	type DetailVisual = {
		key: string;
		title: string;
		subtitle: string;
		imageUrl: string;
		href: string;
		tone: number;
	};
	type LoadingSpeaker = 'left' | 'center' | 'right';
	type LoadingLine = {
		who: LoadingSpeaker;
		text: string;
		em?: string;
		nod: LoadingSpeaker[];
	};

	const defaultLocation: LocationValue = {
		mode: 'default',
		label: '서울 성수동'
	};
	const MINUTE_MS = 60 * 1000;
	const ONBOARDING_SILENCE_TIMEOUT_MS = 9000;
	const spokenOnboardingQuestionIds: OnboardingQuestionId[] = [];
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
	const validMbtiTypes = mbtiOptions.map((option) => option.value) as KnownMbtiType[];
	const loadingScript: LoadingLine[] = [
		{ who: 'left', text: '오! 이 액티비티', em: '새롭다', nod: [] },
		{ who: 'right', text: '근데 예산 좀 빠듯하지 않아?', nod: ['center'] },
		{ who: 'center', text: '둘 다 살리는 코스로 짜보자', nod: ['left', 'right'] },
		{ who: 'left', text: '비 와서', em: '실내가 낫겠다', nod: ['right'] },
		{ who: 'right', text: '여기 도보 8분컷, 동선 좋아', nod: ['center'] },
		{ who: 'center', text: '맛집 평점도 4.7 ㅋㅋ', nod: ['left'] },
		{ who: 'left', text: '이 조합', em: '완벽한데?', nod: ['center', 'right'] },
		{ who: 'right', text: 'ok 예산 딱 맞췄어', nod: ['center', 'left'] }
	];
	const loadingPhases = [
		'날씨 확인 중',
		'지도 탐색 중',
		'맛집 비교 중',
		'액티비티 추리는 중',
		'예산 맞추는 중',
		'동선 최적화 중'
	];
	const loadingTurnSubscriber = createSubscriber((update) => {
		if (!browser) return () => {};
		const timer = window.setInterval(update, 2100);
		return () => window.clearInterval(timer);
	});
	const loadingPhaseSubscriber = createSubscriber((update) => {
		if (!browser) return () => {};
		const timer = window.setInterval(update, 1900);
		return () => window.clearInterval(timer);
	});
	const mbtiVoiceAliases: Record<KnownMbtiType, string[]> = {
		ISTJ: ['아이에스티제이', '잇티제'],
		ISFJ: ['아이에스에프제이', '잇프제'],
		INFJ: ['아이엔에프제이', '인프제'],
		INTJ: ['아이엔티제이', '인티제'],
		ISTP: ['아이에스티피', '잇팁'],
		ISFP: ['아이에스에프피', '잇프피'],
		INFP: ['아이엔에프피', '인프피'],
		INTP: ['아이엔티피', '인팁'],
		ESTP: ['이에스티피', '엣팁'],
		ESFP: ['이에스에프피', '엣프피'],
		ENFP: ['이엔에프피', '엔프피'],
		ENTP: ['이엔티피', '엔팁'],
		ESTJ: ['이에스티제이', '엣티제'],
		ESFJ: ['이에스에프제이', '엣프제'],
		ENFJ: ['이엔에프제이', '엔프제'],
		ENTJ: ['이엔티제이', '엔티제']
	};

	const onboardingQuestions: OnboardingQuestion[] = [
		{
			id: 'activityPreferences',
			prompt: '쉬는 날엔 보통 뭐 하면서 보내?',
			multi: true,
			reaction: '편하게 말해줘. 다음에 놀 거리 찾을 때 네 취향부터 떠올려볼게.',
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
	const onboardingAnswerAliases: Partial<
		Record<OnboardingQuestion['id'], Record<string, string[]>>
	> = {
		activityPreferences: {
			food: ['음식', '밥', '먹', '레스토랑', '식당'],
			culture: ['문화', '미술관', '공연', '전시회'],
			experience: ['클래스', '원데이', '만들기', '체험활동'],
			walk: ['걷기', '공원', '산책하기'],
			home: ['집', '집콕', '휴식', '쉬기']
		},
		noveltyPreference: {
			high: ['새로운거', '새롭', '도전'],
			medium: ['가끔', '보통'],
			low: ['익숙', '편한']
		},
		spendingStyle: {
			value: ['저렴', '아끼', '가성비'],
			balanced: ['적당', '무난', '중간'],
			premium: ['좋은곳', '비싸도', '프리미엄']
		},
		riskTolerance: {
			safe: ['안전', '실패없는', '검증'],
			balanced: ['균형', '반반', '적당'],
			adventure: ['모험', '도전', '새로운']
		},
		mobilityPreference: {
			near: ['근처', '가까', '동네'],
			transit: ['대중교통', '지하철', '버스'],
			far: ['멀어도', '멀리', '상관없']
		},
		mbtiType: {
			unknown: ['unknown', '몰라', '모르겠어', '모름', '잘몰라', '잘모르겠어', '잘 모르겠어']
		}
	};

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
	let customSituationInput = $state('');
	let timeCustomMode = $state(false);
	let customTimeInput = $state('');
	let customBudgetInput = $state('');
	let recommendationNoteInput = $state('');
	let followupIndex = $state(0);
	let followupAnswerInput = $state('');
	let dynamicFollowups = $state<FollowupQuestion[]>([]);
	let followupSource = $state<'exaone' | 'openai' | 'fallback'>('fallback');
	let recommendations = $state<RecommendationCard[]>([]);
	let externalSheet = $state<ExternalSheet | null>(null);
	let candidateBundle = $state<CandidateBundle | null>(null);
	let activeSessionId = $state('');
	let listeningFor = $state<SpeechTarget | null>(null);
	let speechTranscript = $state('');
	let speechMessage = $state('');
	let recommendationSpeechCaptions = $state<Partial<Record<SpeechTarget, string>>>({});
	let saiSpeaking = $state(false);
	let onboardingVoicePaused = $state(false);
	let onboardingIntroVisible = $state(false);
	let onboardingAnswerInput = $state('');
	let onboardingAnswerSource = $state<OnboardingFreeformAnswer['source']>('text');
	let onboardingSpeechStatus = $state('');
	let locationSearchTimer: ReturnType<typeof setTimeout> | null = null;
	let locationSearchRequestId = 0;
	let activeRecognition: WebSpeechRecognition | null = null;
	let onboardingSilenceTimer: ReturnType<typeof setTimeout> | null = null;
	let saiSpeechRequestId = 0;
	let activeSaiAudio: HTMLAudioElement | null = null;
	let activeSaiAudioUrl = '';
	// Plain (non-reactive) dedupe key so the per-screen voice effect speaks a line
	// only once per screen entry. Seeded with 'auth' so the very first cold load
	// (no user gesture yet -> autoplay blocked) does not fire a wasted TTS request.
	let lastVoicedKey = 'auth';

	if (browser) {
		void autoLoginInDevelopment();
	}

	// Single source of truth for the recommendation coach screens: the markup snippet
	// and the spoken (TTS) line both read from here so the two never drift apart.
	const recommendationCoachContent = {
		time: {
			eyebrow: '추천 질문 1/4',
			title: '시간 얼마나 있어?',
			body: '한 시간이든 반나절이든 괜찮아. 딱 가능한 만큼만 알려줘.',
			target: 'time' as const
		},
		situation: {
			eyebrow: '추천 질문 2/4',
			title: '오늘은 누구랑 같이 움직여?',
			body: '엄마, 친구, 아내, 아이처럼 함께할 사람을 모두 골라줘. 관계별로 다르게 맞춰볼게.',
			target: 'situation' as const
		},
		budget: {
			eyebrow: '추천 질문 3/4',
			title: '오늘 예산은 얼마야?',
			body: '여러 명이어도 총 예산으로 알려줘. 그 금액 안에서 맞춰볼게.',
			target: 'budget' as const
		},
		extra: {
			eyebrow: '추천 질문 4/4',
			title: '더 하고 싶은 말 있어?',
			body: '원하는 분위기, 피하고 싶은 것, 꼭 챙길 조건이 있으면 말해줘. 없으면 바로 넘어가도 돼.',
			target: 'extra' as const
		}
	} satisfies Record<
		string,
		{ eyebrow: string; title: string; body: string; target: SpeechTarget }
	>;

	let currentOnboardingQuestion = $derived(onboardingQuestions[onboardingIndex]);
	let onboardingMascotState = $derived(
		saiSpeaking ? 'talking' : listeningFor === 'onboarding' ? 'listening' : 'idle'
	);
	let currentOnboardingFreeformAnswer = $derived(
		profile && currentOnboardingQuestion.id !== 'mbtiType'
			? getOnboardingFreeformAnswer(profile, currentOnboardingQuestion.id)
			: null
	);
	let onboardingAnswerPlaceholder = $derived(
		currentOnboardingQuestion.id === 'mbtiType'
			? '예: 나는 ENFP야 또는 잘 모르겠어'
			: currentOnboardingQuestion
				? `예: 나는 보통 캠핑 가`
				: ''
	);
	let onboardingAnswerHelp = $derived(
		currentOnboardingQuestion.id === 'mbtiType'
			? 'MBTI는 문장 안에 INTP처럼 한 가지 유형만 들어가면 돼. 모르면 잘 모르겠어도 괜찮아.'
			: currentOnboardingFreeformAnswer
				? `저장된 답변: ${currentOnboardingFreeformAnswer.answer}`
				: ''
	);
	let onboardingVoiceCaption = $derived(
		saiSpeaking
			? '질문 읽는 중이야.'
			: listeningFor === 'onboarding'
				? speechTranscript
					? `들은 답변: ${speechTranscript}`
					: '듣고 있어. 편하게 말해줘.'
				: onboardingSpeechStatus
	);
	let onboardingAnswered = $derived(
		profile ? isOnboardingAnswered(currentOnboardingQuestion, profile) : false
	);
	let onboardingCanContinue = $derived(
		onboardingAnswerInput.trim()
			? isPendingOnboardingAnswerReady(currentOnboardingQuestion, onboardingAnswerInput)
			: onboardingAnswered
	);
	let timeRangeSummary = $derived(
		timeRangeText(session.startDateTime ?? '', session.endDateTime ?? '')
	);
	let fallbackFollowupQuestions = $derived(profile ? buildFollowupQuestions(session, profile) : []);
	let followupQuestions = $derived(
		dynamicFollowups.length ? dynamicFollowups : fallbackFollowupQuestions
	);
	let currentFollowup = $derived(followupQuestions[followupIndex]);
	let recentHistory = $derived(currentUserId ? histories.slice(0, 3) : []);
	let recommendationTotalCost = $derived(
		recommendations.reduce((total, card) => total + card.estimatedCost, 0)
	);
	let recommendationBudgetLimit = $derived(
		Math.max(session.budgetTotal || recommendationTotalCost || 1, 1)
	);
	let recommendationBudgetPercent = $derived(
		`${Math.min(100, Math.round((recommendationTotalCost / recommendationBudgetLimit) * 100))}%`
	);
	let recommendationBudgetOver = $derived(recommendationTotalCost > recommendationBudgetLimit);
	let mascotState = $derived(
		saiSpeaking
			? 'talking'
			: screen === 'generating'
				? 'thinking'
				: screen === 'results'
					? 'happy'
					: 'idle'
	);
	let progress = $derived(
		getProgress(screen, onboardingIndex, followupIndex, followupQuestions.length)
	);
	let progressPercent = $derived(
		progress.total ? `${Math.min(100, (progress.current / progress.total) * 100)}%` : '0%'
	);
	let loadingTurn = $derived.by(() => {
		if (screen !== 'generating') return 0;
		loadingTurnSubscriber();
		return Math.floor(Date.now() / 2100);
	});
	let loadingPhaseIndex = $derived.by(() => {
		if (screen !== 'generating') return 0;
		loadingPhaseSubscriber();
		return Math.floor(Date.now() / 1900);
	});
	let loadingLine = $derived(loadingScript[loadingTurn % loadingScript.length]);
	let loadingPhase = $derived(loadingPhases[loadingPhaseIndex % loadingPhases.length]);

	const onboardingIntroContent = {
		eyebrow: '온보딩',
		title: '안녕, 나는 사이야.',
		body: '너한테 더 잘 맞는 선택지를 찾아주려고, 먼저 너를 조금 알아보는 질문을 몇 개만 할게.'
	} as const;

	const onboardingIntroVoicePlan = {
		key: 'onboarding-intro',
		text: `${onboardingIntroContent.title} ${onboardingIntroContent.body}`,
		listen: null
	} satisfies SaiScreenVoicePlan;

	// Followup coach content is dynamic (question + source-specific reaction), so it is a
	// derived value rather than part of the static recommendationCoachContent map above.
	let followupCoachContent = $derived({
		eyebrow: `추가 질문 ${followupIndex + 1}/${followupQuestions.length}`,
		title: currentFollowup?.prompt ?? '하나만 더 물어볼게',
		body:
			followupSource === 'exaone'
				? 'EXAONE이 더 필요한 맥락만 골라서 물어보는 중이야.'
				: followupSource === 'openai'
					? 'AI가 추천 전에 딱 필요한 맥락만 확인하는 중이야.'
					: '방금 말한 시간, 돈, 구성원은 다시 안 물어볼게.',
		target: 'followup' as const
	});

	// What SAI should say (and whether to listen afterwards) on the current screen.
	// `key` dedupes repeated entry; `listen` is the recognition target for screens that
	// take a spoken answer. Returns null for screens SAI does not narrate.
	let saiScreenVoice = $derived.by<SaiScreenVoicePlan | null>(() => {
		switch (screen) {
			case 'auth':
				return {
					key: 'auth',
					text: '오늘 뭐하지? 시간과 돈 사이에서 지금 제일 괜찮은 선택지를 찾아줄게.',
					listen: null
				};
			case 'location':
				return {
					key: 'location',
					text: '지금 어디쯤 있어? 근처로 찾아볼게. 동네 이름으로 알려줘도 돼.',
					listen: null
				};
			case 'home': {
				const name = profile?.email.split('@')[0] ?? '';
				return {
					key: `home:${name}`,
					text: `${name}야, 오늘 뭐하지? 지금 쓸 수 있는 시간과 총 예산만 알려줘.`,
					listen: null
				};
			}
			case 'time':
			case 'situation':
			case 'budget':
			case 'extra': {
				const content = recommendationCoachContent[screen];
				return { key: screen, text: `${content.title} ${content.body}`, listen: content.target };
			}
			case 'followup':
				return {
					key: `followup:${followupIndex}:${followupCoachContent.title}`,
					text: `${followupCoachContent.title} ${followupCoachContent.body}`,
					listen: 'followup'
				};
			case 'generating':
				return {
					key: 'generating',
					text: 'AI 친구들이 잠깐 회의 중이야. 날씨, 지도, 맛집, 액티비티 후보를 시간과 예산 안에서 맞춰보고 있어.',
					listen: null
				};
			case 'results':
				return { key: 'results', text: '이 3개로 추렸어.', listen: null };
			default:
				return null;
		}
	});

	// Speak the current screen's line via TTS whenever the screen (or its line) changes.
	$effect(() => {
		if (!browser) return;
		if (screen === 'onboarding') return;
		const plan = saiScreenVoice;
		if (!plan) {
			stopSaiAudio();
			saiSpeaking = false;
			return;
		}
		if (plan.key === lastVoicedKey) return;
		playSaiScreenVoice(plan);
	});

	function playSaiScreenVoice(plan: SaiScreenVoicePlan, options: { force?: boolean } = {}) {
		if (!browser) return;
		if (!options.force && plan.key === lastVoicedKey) return;
		lastVoicedKey = plan.key;
		void runScreenVoice(plan);
	}

	function replayRecommendationVoice(target: SpeechTarget) {
		if (target === 'onboarding') return;
		const plan = saiScreenVoice;
		if (plan?.listen === target) {
			playSaiScreenVoice(plan, { force: true });
			return;
		}
		startSpeech(target);
	}

	function inputValue(event: Event) {
		return (event.currentTarget as HTMLInputElement).value;
	}

	function textareaValue(event: Event) {
		return (event.currentTarget as HTMLTextAreaElement).value;
	}

	function loadingMascotState(position: LoadingSpeaker) {
		return loadingLine.who === position ? 'talking' : 'thinking';
	}

	function loadingMascotClasses(position: LoadingSpeaker) {
		const classes = ['cm', position];
		if (position !== 'center') classes.push('lean');
		if (loadingLine.who === position) classes.push('speaking');
		if (loadingLine.nod.includes(position)) classes.push('nod');
		if (loadingLine.who === 'left' && position !== 'left') classes.push('look-l');
		if (loadingLine.who === 'right' && position !== 'right') classes.push('look-r');
		if (loadingLine.who === 'center') {
			if (position === 'left') classes.push('look-r');
			if (position === 'right') classes.push('look-l');
		}
		if (position === 'left' && loadingLine.who !== 'center') classes.push('look-r');
		if (position === 'right' && loadingLine.who !== 'center') classes.push('look-l');
		return classes.join(' ');
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

	async function autoLoginInDevelopment() {
		if (currentUserId || busy) return;
		busy = true;
		const result = await serverJson<ServerAuthResult>('/api/auth/dev-login', {
			method: 'POST',
			body: null
		});
		busy = false;
		if (result.type === 'ok') {
			applyServerAuthResult(result.data);
			return;
		}
		if (result.status !== 404) authError = result.message;
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
		if (!nextProfile.recentLocation) {
			screen = 'location';
			return;
		}
		if (isProfileOnboardingComplete(nextProfile)) {
			screen = 'home';
			return;
		}
		openOnboarding(onboardingIndex);
	}

	function clearClientSession() {
		currentUserId = '';
		profile = null;
		screen = 'auth';
		onboardingIntroVisible = false;
		authPassword = '';
		authError = '';
		recommendations = [];
		candidateBundle = null;
		activeSessionId = '';
		histories = [];
	}

	async function logout() {
		if (busy) return;
		busy = true;
		const result = await serverJson<{ loggedOut: boolean }>('/api/auth/logout', {
			method: 'POST',
			body: null
		});
		busy = false;
		if (result.type === 'error') {
			authError = result.message;
			return;
		}
		clearClientSession();
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
		if (isProfileOnboardingComplete(nextProfile)) {
			onboardingIndex = missingIndex === -1 ? 0 : missingIndex;
			resetOnboardingAnswerInput();
			screen = 'home';
			return;
		}
		openOnboarding(missingIndex === -1 ? 0 : missingIndex);
	}

	function isOnboardingAnswered(question: OnboardingQuestion, targetProfile: UserProfile) {
		if (question.id === 'mbtiType') return Boolean(parseMbtiAnswer(targetProfile.mbtiType));
		if (getOnboardingFreeformAnswer(targetProfile, question.id)) return true;
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

	function isPendingOnboardingAnswerReady(question: OnboardingQuestion, value: string) {
		const answer = value.trim();
		if (!answer) return false;
		if (question.id === 'mbtiType') return Boolean(parseMbtiAnswer(answer));
		return true;
	}

	function commitOnboardingAnswerInput() {
		if (!onboardingAnswerInput.trim()) return false;
		if (listeningFor === 'onboarding') stopActiveRecognition();
		return applyOnboardingFreeformAnswer(onboardingAnswerInput, onboardingAnswerSource);
	}

	function handleOnboardingAnswerInput(event: Event) {
		onboardingAnswerInput = inputValue(event);
		onboardingAnswerSource = 'text';
		onboardingSpeechStatus = '';
	}

	function handleOnboardingAnswerKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		continueOnboarding();
	}

	function applyOnboardingFreeformAnswer(text: string, source: 'voice' | 'text') {
		if (!profile || !currentOnboardingQuestion) return false;
		const answer = text.trim();
		if (!answer) return false;
		const matches = matchOnboardingOptions(currentOnboardingQuestion, text);

		if (currentOnboardingQuestion.id === 'mbtiType') {
			const selected = matches[0];
			if (!selected) {
				onboardingSpeechStatus =
					'MBTI는 문장 안에 ENFP처럼 한 가지 유형만 포함하거나, 모르면 잘 모르겠어라고 입력해줘.';
				return false;
			}

			const nextProfile = setSingleOnboardingAnswer(profile, 'mbtiType', selected.value);
			profile = nextProfile;
			onboardingSpeechStatus = onboardingSelectionStatus(currentOnboardingQuestion, [
				selected.value
			]);
			saveProfile(nextProfile);
			return true;
		}

		let nextProfile = upsertOnboardingFreeformAnswer(
			profile,
			currentOnboardingQuestion,
			answer,
			source
		);

		if (currentOnboardingQuestion.id === 'activityPreferences') {
			const values = [
				...new Set([...nextProfile.activityPreferences, ...matches.map((item) => item.value)])
			];
			nextProfile = {
				...nextProfile,
				activityPreferences: values,
				updatedAt: new Date().toISOString()
			};
			profile = nextProfile;
			onboardingSpeechStatus = matches.length
				? `${onboardingSelectionStatus(currentOnboardingQuestion, values)} 문장 답변도 같이 저장했어.`
				: '문장 답변으로 저장했어. 추천할 때 그대로 참고할게.';
			saveProfile(nextProfile);
			return true;
		}

		if (matches[0]) {
			nextProfile = setSingleOnboardingAnswer(
				nextProfile,
				currentOnboardingQuestion.id,
				matches[0].value
			);
		}
		profile = nextProfile;
		onboardingSpeechStatus = matches[0]
			? `${onboardingSelectionStatus(currentOnboardingQuestion, [matches[0].value])} 문장 답변도 같이 저장했어.`
			: '문장 답변으로 저장했어. 추천할 때 그대로 참고할게.';
		saveProfile(nextProfile);
		return true;
	}

	function matchOnboardingOptions(question: OnboardingQuestion, text: string) {
		const normalized = normalizeAnswerText(text);
		if (!normalized) return [];

		if (question.id === 'mbtiType') {
			const type = parseMbtiAnswer(text);
			return type ? question.options.filter((option) => option.value === type) : [];
		}

		return question.options.filter((option) =>
			onboardingOptionKeywords(question, option).some((keyword) =>
				normalized.includes(normalizeAnswerText(keyword))
			)
		);
	}

	function onboardingOptionKeywords(
		question: OnboardingQuestion,
		option: OnboardingQuestion['options'][number]
	) {
		return [
			option.label,
			option.value,
			...(onboardingAnswerAliases[question.id]?.[option.id] ?? [])
		];
	}

	function normalizeAnswerText(value: string) {
		return value.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
	}

	function parseMbtiAnswer(value: string): MbtiType {
		const mentionedTypes = findMentionedMbtiTypes(value);
		if (mentionedTypes.length === 1) return mentionedTypes[0];
		if (mentionedTypes.length > 1) return '';
		return isUnknownMbtiAnswer(value) ? 'unknown' : '';
	}

	function findMentionedMbtiTypes(value: string) {
		const normalized = normalizeAnswerText(value);
		if (!normalized) return [];

		const uppercaseValue = normalized.toUpperCase();
		return validMbtiTypes.filter(
			(type) =>
				uppercaseValue.includes(type) ||
				mbtiVoiceAliases[type].some((alias) => normalized.includes(normalizeAnswerText(alias)))
		);
	}

	function isUnknownMbtiAnswer(value: string) {
		const normalized = normalizeAnswerText(value);
		if (!normalized) return false;

		return (
			onboardingAnswerAliases.mbtiType?.unknown.some((alias) =>
				normalized.includes(normalizeAnswerText(alias))
			) ?? false
		);
	}

	function getOnboardingFreeformAnswer(
		targetProfile: UserProfile,
		questionId: Exclude<OnboardingQuestionId, 'mbtiType'>
	) {
		return (targetProfile.onboardingFreeformAnswers ?? []).find(
			(answer) => answer.questionId === questionId
		);
	}

	function upsertOnboardingFreeformAnswer(
		targetProfile: UserProfile,
		question: OnboardingQuestion,
		answer: string,
		source: OnboardingFreeformAnswer['source']
	): UserProfile {
		if (question.id === 'mbtiType') return targetProfile;
		const now = new Date().toISOString();
		const freeformAnswer: OnboardingFreeformAnswer = {
			questionId: question.id,
			question: question.prompt,
			answer,
			source,
			createdAt: now
		};

		return {
			...targetProfile,
			onboardingFreeformAnswers: [
				...(targetProfile.onboardingFreeformAnswers ?? []).filter(
					(item) => item.questionId !== question.id
				),
				freeformAnswer
			],
			updatedAt: now
		};
	}

	function onboardingSelectionStatus(question: OnboardingQuestion, values: string[]) {
		const labels = question.options
			.filter((option) => values.includes(option.value))
			.map((option) => option.label);
		return labels.length ? `${labels.join(', ')}로 입력했어.` : '';
	}

	function resetOnboardingAnswerInput() {
		onboardingAnswerInput = '';
		onboardingAnswerSource = 'text';
		onboardingSpeechStatus = '';
		onboardingVoicePaused = false;
		speechTranscript = '';
		speechMessage = '';
	}

	function openOnboarding(index: number) {
		onboardingIndex = index;
		resetOnboardingAnswerInput();
		screen = 'onboarding';
		onboardingIntroVisible = index === 0 && !profile?.onboardingCompleted;
		if (onboardingIntroVisible) {
			stopOnboardingVoice();
			playSaiScreenVoice(onboardingIntroVoicePlan, { force: true });
			return;
		}
		beginOnboardingVoice(onboardingQuestions[index]);
	}

	function startOnboardingQuestions() {
		onboardingIntroVisible = false;
		resetOnboardingAnswerInput();
		beginOnboardingVoice(currentOnboardingQuestion);
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
		if (!profile) return;
		const hasAnswer = onboardingAnswerInput.trim()
			? commitOnboardingAnswerInput()
			: onboardingAnswered;
		if (!hasAnswer) return;

		if (onboardingIndex < onboardingQuestions.length - 1) {
			const nextIndex = onboardingIndex + 1;
			openOnboarding(nextIndex);
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
		onboardingIntroVisible = false;
		resetOnboardingAnswerInput();
		stopOnboardingVoice();
		screen = 'home';
	}

	function startRecommendation() {
		if (!profile) return;
		if (!isProfileOnboardingComplete(profile)) {
			const missingIndex = firstUnansweredOnboardingIndex(profile);
			openOnboarding(missingIndex === -1 ? 0 : missingIndex);
			return;
		}

		session = createRecommendationSession(profile.recentLocation ?? defaultLocation);
		customSituationInput = '';
		timeCustomMode = false;
		customTimeInput = '';
		customBudgetInput = '';
		recommendationNoteInput = '';
		followupIndex = 0;
		followupAnswerInput = '';
		dynamicFollowups = [];
		followupSource = 'fallback';
		recommendations = [];
		candidateBundle = null;
		activeSessionId = '';
		speechTranscript = '';
		speechMessage = '';
		recommendationSpeechCaptions = {};
		screen = 'time';
	}

	function setCompanionRelations(relations: CompanionRelation[]) {
		const normalized = normalizeCompanionRelations(relations);
		session.companionRelations = normalized;
		session.companionConstraints = {
			...session.companionConstraints,
			relations: normalized,
			hasBaby: session.companionConstraints.hasBaby || normalized.includes('baby')
		};
		session.situation = primarySituationFromRelations(normalized);
	}

	function companionRelationsFromText(text: string): CompanionRelation[] {
		const normalized = text.replace(/\s/g, '').toLowerCase();
		if (!normalized) return [];
		const patterns: Array<{ relation: CompanionRelation; pattern: RegExp }> = [
			{ relation: 'solo', pattern: /혼자|나혼자|솔로|혼놀|나만/ },
			{ relation: 'friend', pattern: /친구|친한친구|친구랑|친구와/ },
			{
				relation: 'spouse',
				pattern: /아내|와이프|배우자|남편|신랑|커플|연인|애인|데이트|남자친구|여자친구|남친|여친/
			},
			{ relation: 'mother', pattern: /엄마|어머니|모친/ },
			{ relation: 'father', pattern: /아빠|아버지|부친/ },
			{ relation: 'parent', pattern: /부모님|부모/ },
			{ relation: 'baby', pattern: /아기|영유아|유모차|수유|기저귀/ },
			{ relation: 'child', pattern: /아이|자녀|애들|어린이|초등|중학생|고등학생/ },
			{ relation: 'sibling', pattern: /동생|형제|자매|누나|언니|형|오빠/ },
			{ relation: 'coworker', pattern: /동료|회사|직장|회식/ },
			{ relation: 'group', pattern: /모임|팀|단체|여러명|여럿/ }
		];
		return normalizeCompanionRelations(
			patterns
				.map(({ relation, pattern }) => ({ relation, index: normalized.search(pattern) }))
				.filter((match) => match.index >= 0)
				.sort((a, b) => a.index - b.index)
				.map((match) => match.relation)
		);
	}

	function applySituationTranscript(text: string) {
		customSituationInput = text;
		const selected = companionRelationsFromText(text);
		if (selected.length) setCompanionRelations(selected);
		const normalized = text.replace(/\s/g, '');
		if (/아기|영유아|유모차|수유|기저귀/.test(normalized)) {
			session.companionConstraints = {
				...session.companionConstraints,
				hasBaby: true,
				strollerRequired: /유모차/.test(normalized),
				needsNursingRoom: /수유/.test(normalized),
				needsDiaperChangingRoom: /기저귀/.test(normalized),
				preferParking: /주차|차로|차타고/.test(normalized),
				babyCarrierOk: /아기띠/.test(normalized)
			};
		}
	}

	function handleSituationAnswerInput(event: Event) {
		applySituationTranscript(inputValue(event));
	}

	function continueSituation() {
		if (!companionRelationsFromText(customSituationInput).length) return;
		applySituationTranscript(customSituationInput);
		openRecommendationStep('budget');
	}

	function selectTime(id: string) {
		session.availableTime = id;
		timeCustomMode = id === 'custom';
		if (id !== 'custom') {
			customTimeInput = '';
			session.customTime = '';
		}
	}

	function timeIdFromText(text: string) {
		if (/\d+\s*시(?!간)|부터|까지/.test(text)) return '';
		if (/주말/.test(text)) return 'weekend';
		if (/하루|종일/.test(text)) return 'day';
		if (/반나절|오후|오전/.test(text)) return 'half_day';
		if (/2|3|두|세/.test(text)) return 'two_three';
		if (/1|한|하나/.test(text)) return 'one_hour';
		return '';
	}

	function handleTimeRangeInput(field: 'startDateTime' | 'endDateTime', value: string) {
		if (field === 'startDateTime') session.startDateTime = value || undefined;
		else session.endDateTime = value || undefined;
		syncTimeRangeFromFields();
	}

	function continueTime() {
		if (customTimeInput.trim()) applyTimeTranscript(customTimeInput);
		syncTimeRangeFromFields();
		if (!session.availableTime) return;
		if (timeCustomMode) {
			const value = customTimeInput.trim();
			if (!value && !(session.startDateTime && session.endDateTime)) return;
			session.customTime = value;
		}
		openRecommendationStep('situation');
	}

	function budgetInputShouldFormat(value: string) {
		return /[^\d,\s]/.test(value);
	}

	function applyCustomBudgetInput(value: string, options: { format?: boolean } = {}) {
		const parsed = parseBudget(value);
		if (!parsed) {
			customBudgetInput = value;
			session.budgetTotal = undefined;
			return;
		}
		session.budgetTotal = parsed;
		customBudgetInput =
			options.format || budgetInputShouldFormat(value) ? formatKrw(parsed) : value;
	}

	function handleBudgetAnswerInput(event: Event) {
		applyCustomBudgetInput(inputValue(event));
	}

	function continueBudget() {
		if (!session.budgetTotal) return;
		openRecommendationStep('extra');
	}

	async function continueExtra() {
		const note = recommendationNoteInput.trim();
		if (note) {
			session.dynamicAnswers = {
				...session.dynamicAnswers,
				extra_context: note
			};
		} else {
			const answers = { ...session.dynamicAnswers };
			delete answers.extra_context;
			session.dynamicAnswers = answers;
		}
		followupIndex = 0;
		followupAnswerInput = '';
		const result = await loadFollowups();
		dynamicFollowups = result.questions;
		session.dynamicQuestions = note
			? [
					{
						id: 'extra_context',
						prompt: '추천할 때 더 챙겼으면 하는 말 있어?',
						options: []
					},
					...result.questions
				]
			: result.questions;
		followupSource = result.source;
		clearRecommendationSpeech();
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
			followupAnswerInput = '';
			openRecommendationStep('followup');
			return;
		}

		followupAnswerInput = '';
		clearRecommendationSpeech();
		void generateRecommendations();
	}

	function followupAnswerValue(question: FollowupQuestion, text: string) {
		const normalized = text.replace(/\s/g, '');
		const selected = question.options.find((option) =>
			normalized.includes(option.label.replace(/\s/g, ''))
		);
		return selected?.value ?? text.trim();
	}

	function continueFollowup() {
		if (!currentFollowup) {
			skipFollowups();
			return;
		}
		const value = followupAnswerInput.trim()
			? followupAnswerValue(currentFollowup, followupAnswerInput)
			: '';
		if (!value) {
			skipFollowups();
			return;
		}
		answerFollowup(currentFollowup, value);
	}

	function skipFollowups() {
		followupAnswerInput = '';
		clearRecommendationSpeech();
		void generateRecommendations();
	}

	async function generateRecommendations() {
		if (!profile) return;
		screen = 'generating';
		const composed = await composeRecommendationCards(profile, session);
		candidateBundle = composed.candidates;
		session.weatherSnapshot = weatherSnapshotFromCandidates(
			composed.candidates,
			session.weatherSnapshot
		);
		await new Promise((resolve) => setTimeout(resolve, 700));
		const cards = scopeCardsToSession(composed.cards, session.id);
		recommendations = cards;
		activeSessionId = session.id;
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
				applyTimeUtilization(
					applyCandidateBundle(composeRecommendations(targetProfile, targetSession), candidates),
					targetSession
				),
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
			const mobility = bundle.mobility[index % Math.max(bundle.mobility.length, 1)];
			const flight = bundle.flights[index % Math.max(bundle.flights.length, 1)];
			const mappedItems = card.items.map((item) => {
				if (item.slot === 'activity' && activity) {
					return {
						...item,
						title: activity.title,
						price: activity.price ?? item.price,
						source: activity.source,
						sourceName: activity.sourceName ?? item.sourceName,
						outboundUrl: activity.outboundUrl ?? item.outboundUrl,
						reservationUrl: activity.reservationUrl ?? activity.outboundUrl ?? item.reservationUrl,
						mapUrl: activity.mapUrl ?? item.mapUrl,
						address: activity.address ?? item.address,
						lat: activity.lat ?? item.lat,
						lng: activity.lng ?? item.lng,
						availabilityText: activity.availabilityText ?? item.availabilityText,
						travelMinutes: activity.travelMinutes ?? item.travelMinutes,
						travelTimeText: activity.travelTimeText ?? item.travelTimeText,
						travelDistanceMeters: activity.travelDistanceMeters ?? item.travelDistanceMeters,
						routeMapUrl: activity.routeMapUrl ?? item.routeMapUrl,
						operatingStatus: activity.operatingStatus ?? item.operatingStatus,
						arrivalTimeText: activity.arrivalTimeText ?? item.arrivalTimeText,
						openingHoursText: activity.openingHoursText ?? item.openingHoursText,
						thumbnailUrl: activity.thumbnailUrl ?? item.thumbnailUrl
					};
				}

				if (item.slot === 'food' && restaurant) {
					return {
						...item,
						title: restaurant.title,
						price: restaurant.price ?? item.price,
						source: restaurant.source,
						sourceName: restaurant.sourceName ?? item.sourceName,
						outboundUrl: restaurant.outboundUrl ?? item.outboundUrl,
						reservationUrl:
							restaurant.reservationUrl ?? restaurant.outboundUrl ?? item.reservationUrl,
						mapUrl: restaurant.mapUrl ?? item.mapUrl,
						address: restaurant.address ?? item.address,
						lat: restaurant.lat ?? item.lat,
						lng: restaurant.lng ?? item.lng,
						availabilityText: restaurant.availabilityText ?? item.availabilityText,
						travelMinutes: restaurant.travelMinutes ?? item.travelMinutes,
						travelTimeText: restaurant.travelTimeText ?? item.travelTimeText,
						travelDistanceMeters: restaurant.travelDistanceMeters ?? item.travelDistanceMeters,
						routeMapUrl: restaurant.routeMapUrl ?? item.routeMapUrl,
						operatingStatus: restaurant.operatingStatus ?? item.operatingStatus,
						arrivalTimeText: restaurant.arrivalTimeText ?? item.arrivalTimeText,
						openingHoursText: restaurant.openingHoursText ?? item.openingHoursText,
						thumbnailUrl: restaurant.thumbnailUrl ?? item.thumbnailUrl
					};
				}

				return item;
			});
			const items = flight ? mergeFlightItem(mappedItems, flight) : mappedItems;
			const externalTags = [
				...(flight?.tags ?? []),
				...(activity?.tags ?? []),
				...(restaurant?.tags ?? [])
			].slice(0, 4);
			const trendTag = bundle.trendKeywords[index];
			const badges = [
				...new Set([
					...(flight ? ['항공편 포함', '이번 요청 우선'] : []),
					...card.badges,
					...externalTags,
					...(trendTag ? [trendTag] : [])
				])
			].slice(0, 8);
			const reservationUrl =
				flight?.reservationUrl ??
				flight?.outboundUrl ??
				items.find((item) => item.reservationUrl)?.reservationUrl ??
				card.reservationUrl;
			const routeMapUrl =
				flight?.outboundUrl ??
				(flight ? undefined : mobility?.routeMapUrl) ??
				items.find((item) => item.routeMapUrl)?.routeMapUrl ??
				items.find((item) => item.mapUrl)?.mapUrl ??
				card.routeMapUrl;
			const estimatedCost = flight?.price
				? Math.max(card.estimatedCost, flight.price)
				: card.estimatedCost;
			const people = partyCountForSession(session);

			return {
				...card,
				label: flight ? '항공 포함' : card.label,
				title: flight ? `${flightDestinationLabel(flight)} 항공편까지 보는 코스` : card.title,
				reason: flight
					? `${card.reason} 이번에 말한 장거리/해외 이동 의도를 온보딩 취향보다 우선해서 항공편을 포함했어.`
					: card.reason,
				estimatedCost,
				budgetText: flight?.price
					? `${flightDestinationLabel(flight)} 항공권 기준 ${formatKrw(flight.price)}부터 확인`
					: card.budgetText,
				perPersonText: `1인당 약 ${formatKrw(Math.ceil(estimatedCost / people / 1000) * 1000)}`,
				items,
				badges,
				weatherFit: bundle.weather.preferIndoor ? 'indoor' : card.weatherFit,
				routeSummary: flight ? flightRouteSummary(flight) : (mobility?.label ?? card.routeSummary),
				routeTransport: flight ? ('flight' as const) : (mobility?.mode ?? card.routeTransport),
				routeMapUrl,
				routeDetail: flight ? flightRouteDetail(flight) : (mobility?.detail ?? card.routeDetail),
				reservationUrl,
				outboundUrl: reservationUrl ?? routeMapUrl ?? card.outboundUrl
			};
		});
	}

	function mergeFlightItem(
		items: RecommendationItem[],
		flight: NonNullable<CandidateBundle['flights'][number]>
	) {
		const index = items.findIndex((item) => item.slot === 'flight');
		const flightItem = flightCandidateToItem(flight, index >= 0 ? items[index] : undefined);
		if (index >= 0) {
			return items.map((item, itemIndex) => (itemIndex === index ? flightItem : item));
		}
		return [flightItem, ...items];
	}

	function flightCandidateToItem(
		flight: NonNullable<CandidateBundle['flights'][number]>,
		fallback?: RecommendationItem
	): RecommendationItem {
		return {
			slot: 'flight',
			title: flight.title,
			price: flight.price ?? fallback?.price ?? 0,
			source: flight.source,
			sourceName: flight.sourceName ?? '네이버항공',
			outboundUrl: flight.outboundUrl ?? fallback?.outboundUrl ?? 'https://flight.naver.com',
			reservationUrl: flight.reservationUrl ?? flight.outboundUrl ?? fallback?.reservationUrl,
			availabilityText: [
				flight.airlineText,
				flight.departureTimeText,
				flight.returnDate ? `${flight.returnDate} 복귀` : undefined,
				flight.tags.slice(0, 2).join(' · ')
			]
				.filter(Boolean)
				.join(' · '),
			arrivalTimeText: flight.arrivalTimeText,
			travelTimeText: flight.durationText,
			dwellMinutes: flight.durationMinutes,
			dwellTimeText: flight.durationText ?? fallback?.dwellTimeText,
			thumbnailUrl: fallback?.thumbnailUrl
		};
	}

	function flightDestinationLabel(flight: NonNullable<CandidateBundle['flights'][number]>) {
		const airports: Record<string, string> = {
			KIX: '오사카',
			FUK: '후쿠오카',
			NRT: '도쿄',
			HND: '도쿄',
			TPE: '타이베이',
			BKK: '방콕',
			SIN: '싱가포르',
			DAD: '다낭',
			HKG: '홍콩'
		};
		return airports[flight.arrivalAirport] ?? flight.arrivalAirport;
	}

	function flightRouteSummary(flight: NonNullable<CandidateBundle['flights'][number]>) {
		return [`${flight.departureAirport} → ${flight.arrivalAirport} 항공`, flight.durationText]
			.filter(Boolean)
			.join(' · ');
	}

	function flightRouteDetail(flight: NonNullable<CandidateBundle['flights'][number]>) {
		return [
			flight.departureTimeText,
			flight.arrivalTimeText,
			flight.durationText,
			flight.airlineText,
			flight.returnDate ? `${flight.returnDate} 복귀` : undefined
		]
			.filter(Boolean)
			.join(' · ');
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
		screen = 'results';
	}

	function openRecommendationDetail(cardId: string) {
		const card = recommendations.find((item) => item.id === cardId);
		if (!card) return;
		openExternalSheet(
			card.id,
			card.title,
			cardReservationUrl(card),
			`${formatKrw(card.estimatedCost)} · 실제 예약 페이지로 이동해서 바로 예약할 수 있어.`
		);
	}

	function externalProviderLabel(url: string) {
		try {
			const host = new URL(url).hostname;
			if (host.endsWith('myrealtrip.com')) return '마이리얼트립';
			if (host.endsWith('catchtable.co.kr')) return '캐치테이블';
			if (host.includes('kakao')) return '카카오맵';
			if (host.includes('calendar.google')) return '구글 캘린더';
			if (host.includes('naver')) return '네이버';
			return host.replace(/^www\./, '');
		} catch {
			return '외부 서비스';
		}
	}

	function openExternalSheet(cardId: string, title: string, url: string, description: string) {
		if (!url) return;
		recordClick(cardId);
		externalSheet = {
			cardId,
			title,
			provider: externalProviderLabel(url),
			url,
			description
		};
	}

	function closeExternalSheet() {
		externalSheet = null;
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
		if (isProfileOnboardingComplete(profile)) {
			screen = 'home';
			return;
		}
		const missingIndex = firstUnansweredOnboardingIndex(profile);
		openOnboarding(missingIndex === -1 ? 0 : missingIndex);
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

	function parseKoreanHour(value: string) {
		const normalized = value.trim();
		const numeric = Number(normalized);
		if (numeric > 0) return numeric;
		const koreanHours: Record<string, number> = {
			한: 1,
			하나: 1,
			일: 1,
			두: 2,
			둘: 2,
			이: 2,
			세: 3,
			셋: 3,
			삼: 3,
			네: 4,
			넷: 4,
			사: 4,
			다섯: 5,
			오: 5,
			여섯: 6,
			육: 6,
			일곱: 7,
			칠: 7,
			여덟: 8,
			팔: 8,
			아홉: 9,
			구: 9,
			열: 10,
			십: 10,
			열한: 11,
			열하나: 11,
			열두: 12,
			열둘: 12
		};
		return koreanHours[normalized] ?? 0;
	}

	function parseKoreanDayCount(value: string) {
		const normalized = value.trim();
		const numeric = Number(normalized);
		if (numeric > 0) return numeric;
		const koreanDays: Record<string, number> = {
			하룻: 1,
			하루: 1,
			한: 1,
			하나: 1,
			일: 1,
			이틀: 2,
			두: 2,
			둘: 2,
			이: 2,
			사흘: 3,
			세: 3,
			셋: 3,
			삼: 3,
			나흘: 4,
			네: 4,
			넷: 4,
			사: 4,
			닷새: 5,
			다섯: 5,
			오: 5,
			엿새: 6,
			여섯: 6,
			육: 6,
			이레: 7,
			일곱: 7,
			칠: 7,
			여드레: 8,
			여덟: 8,
			팔: 8,
			아흐레: 9,
			아홉: 9,
			구: 9,
			열흘: 10,
			열: 10,
			십: 10,
			열하루: 11,
			열한: 11,
			열하나: 11,
			십일: 11,
			열이틀: 12,
			열두: 12,
			열둘: 12,
			십이: 12,
			열사흘: 13,
			열세: 13,
			열셋: 13,
			십삼: 13,
			열나흘: 14,
			열네: 14,
			열넷: 14,
			십사: 14,
			일주일: 7,
			한주: 7,
			한주일: 7,
			칠일: 7,
			며칠: 3,
			몇일: 3
		};
		return koreanDays[normalized] ?? 0;
	}

	function normalizeMeridiemHour(hour: number, meridiem: string) {
		if (/오후|낮|저녁|밤/.test(meridiem)) return hour < 12 ? hour + 12 : hour;
		if (/오전|아침|새벽/.test(meridiem)) return hour === 12 ? 0 : hour;
		return hour;
	}

	function parseTimePoint(
		hourText: string,
		minuteText: string | undefined,
		meridiem: string
	): ParsedTimePoint | null {
		const rawHour = parseKoreanHour(hourText);
		if (rawHour < 1 || rawHour > 24) return null;
		const minute = minuteText?.includes('반')
			? 30
			: Number(minuteText?.replace(/[^0-9]/g, '') || 0);
		if (minute < 0 || minute > 59) return null;
		const normalizedHour = rawHour === 24 ? 0 : rawHour;
		return {
			rawHour: normalizedHour,
			hour: normalizeMeridiemHour(normalizedHour, meridiem),
			minute,
			meridiem
		};
	}

	function dateBaseFromText(text: string) {
		const now = new Date();
		const dateOffset = /모레/.test(text) ? 2 : /내일/.test(text) ? 1 : 0;
		return new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate() + dateOffset,
			now.getHours(),
			now.getMinutes(),
			0,
			0
		);
	}

	function isTodayText(text: string) {
		return !/내일|모레/.test(text);
	}

	function dateWithTime(base: Date, hour: number, minute: number) {
		return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0, 0);
	}

	function currentDateTime() {
		const now = new Date();
		return new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
			now.getHours(),
			now.getMinutes(),
			0,
			0
		);
	}

	function toDatetimeLocalValue(date: Date) {
		const pad = (value: number) => `${value}`.padStart(2, '0');
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
	}

	function parseDatetimeLocalValue(value: string) {
		if (!value) return null;
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date;
	}

	function timeAvailabilityFromMinutes(minutes: number) {
		if (minutes <= 90) return 'one_hour';
		if (minutes <= 210) return 'two_three';
		if (minutes <= 330) return 'half_day';
		return 'day';
	}

	function formatTimeRangeLabel(start: Date, end: Date) {
		const formatter = new Intl.DateTimeFormat('ko-KR', {
			month: 'numeric',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
		return `${formatter.format(start)}부터 ${formatter.format(end)}까지`;
	}

	function timeRangeText(startValue: string, endValue: string) {
		const start = parseDatetimeLocalValue(startValue);
		const end = parseDatetimeLocalValue(endValue);
		if (!start || !end) return '';
		if (end.getTime() <= start.getTime()) return '종료 시간이 시작 시간보다 뒤여야 해.';
		const minutes = Math.round((end.getTime() - start.getTime()) / MINUTE_MS);
		return `${formatTimeRangeLabel(start, end)} · 약 ${Math.round(minutes / 60)}시간`;
	}

	function durationRangeLabel(minutes: number) {
		const hours = Math.floor(minutes / 60);
		const restMinutes = minutes % 60;
		if (hours && restMinutes) return `${hours}시간 ${restMinutes}분`;
		if (hours) return `${hours}시간`;
		return `${restMinutes}분`;
	}

	function dayDurationLabel(minutes: number) {
		const days = Math.floor(minutes / (24 * 60));
		const restHours = Math.round((minutes - days * 24 * 60) / 60);
		if (days && restHours) return `${days}일 ${restHours}시간`;
		if (days) return `${days}일`;
		return durationRangeLabel(minutes);
	}

	function applyTimeRange(range: ParsedTimeRange) {
		session.startDateTime = range.start;
		session.endDateTime = range.end;
		session.customTime = range.label;
		syncTimeRangeFromFields();
	}

	function syncTimeRangeFromFields() {
		const start = parseDatetimeLocalValue(session.startDateTime ?? '');
		const end = parseDatetimeLocalValue(session.endDateTime ?? '');
		if (start && end && end.getTime() <= start.getTime()) {
			session.availableTime = undefined;
			return;
		}
		if (!start || !end || end.getTime() <= start.getTime()) return;
		const minutes = Math.round((end.getTime() - start.getTime()) / MINUTE_MS);
		session.availableTime = timeAvailabilityFromMinutes(minutes);
		session.customTime = formatTimeRangeLabel(start, end);
		timeCustomMode = false;
	}

	function parseSpokenTimeRange(text: string): ParsedTimeRange | null {
		const timePattern =
			/(오전|오후|아침|낮|저녁|밤|새벽)?\s*(열두|열둘|열한|열하나|열|십|아홉|여덟|일곱|여섯|다섯|네|넷|세|셋|두|둘|한|하나|일|이|삼|사|오|육|칠|팔|구|\d{1,2})\s*시(?!간)\s*(반|[0-5]?\d\s*분)?/g;
		const matches = [...text.matchAll(timePattern)];
		if (matches.length < 2) return null;

		const firstMatch = matches[0];
		const secondMatch = matches[1];
		if (!firstMatch || !secondMatch) return null;

		const first = parseTimePoint(firstMatch[2] ?? '', firstMatch[3], firstMatch[1] ?? '');
		const secondRawHour = parseKoreanHour(secondMatch[2] ?? '');
		const inheritedMeridiem =
			first?.meridiem && first.rawHour < secondRawHour ? first.meridiem : '';
		const secondMeridiem = secondMatch[1] ?? inheritedMeridiem;
		const second = parseTimePoint(secondMatch[2] ?? '', secondMatch[3], secondMeridiem);
		if (!first || !second) return null;

		if (!first.meridiem && !second.meridiem && first.rawHour <= 7 && second.rawHour <= 8) {
			first.hour += 12;
			second.hour += 12;
		}

		const base = dateBaseFromText(text);
		const start = dateWithTime(base, first.hour, first.minute);
		let end = dateWithTime(base, second.hour, second.minute);

		if (end.getTime() <= start.getTime()) {
			const afternoonEnd = dateWithTime(base, second.hour + 12, second.minute);
			if (!second.meridiem && afternoonEnd.getTime() > start.getTime()) {
				end = afternoonEnd;
			} else {
				end = new Date(end.getTime() + 24 * 60 * MINUTE_MS);
			}
		}

		return {
			start: toDatetimeLocalValue(start),
			end: toDatetimeLocalValue(end),
			label: formatTimeRangeLabel(start, end)
		};
	}

	function parseFlexibleDayRange(text: string): ParsedTimeRange | null {
		const normalized = text.replace(/\s/g, '');
		const wantsDayLong = /하루종일|온종일|종일/.test(normalized);
		const wantsUntilEvening = /(지금|현재|오늘)?.*(저녁까지|밤까지)/.test(normalized);
		if (!wantsDayLong && !wantsUntilEvening) return null;

		const base = dateBaseFromText(text);
		const start = isTodayText(text) ? currentDateTime() : dateWithTime(base, 9, 0);
		const defaultEndHour = /밤까지/.test(normalized) ? 22 : 20;
		let end = dateWithTime(base, defaultEndHour, 0);
		if (end.getTime() <= start.getTime()) {
			end = dateWithTime(base, 23, 0);
		}
		if (end.getTime() <= start.getTime()) {
			end = new Date(start.getTime() + 2 * 60 * MINUTE_MS);
		}

		return {
			start: toDatetimeLocalValue(start),
			end: toDatetimeLocalValue(end),
			label: formatTimeRangeLabel(start, end)
		};
	}

	function parseMultiDayDurationFromNow(text: string): ParsedTimeRange | null {
		if (/\d+\s*시(?!간)|부터\s*\d|까지/.test(text)) return null;
		const normalized = text.replace(/\s/g, '');
		const dayCountPattern =
			'\\d{1,2}|하룻|하루|이틀|사흘|나흘|닷새|엿새|이레|여드레|아흐레|열흘|열하루|열이틀|열사흘|열나흘|열하나|열한|열두|열둘|열세|열셋|열네|열넷|십사|십삼|십이|십일|십|한|두|세|네|다섯|여섯|일곱|여덟|아홉|일|이|삼|사|오|육|칠|팔|구';
		const nightDayMatch = normalized.match(
			new RegExp(`(${dayCountPattern})박(${dayCountPattern})일?`)
		);
		const weekMatch = normalized.match(new RegExp(`(${dayCountPattern})주(?:일)?|일주일|한주일?`));
		const lexicalDayMatch = normalized.match(
			/(하룻|하루|이틀|사흘|나흘|닷새|엿새|이레|여드레|아흐레|열흘|열하루|열이틀|열사흘|열나흘|며칠|몇일)(?:동안|간|정도|쯤|만|내내|가능|있어|됨|돼|반)?/
		);
		const countedDayMatch = normalized.match(
			new RegExp(`(${dayCountPattern})일(?:동안|간|정도|쯤|만|내내|가능|있어|됨|돼|반)?`)
		);
		const dayMatch = nightDayMatch ?? lexicalDayMatch ?? countedDayMatch;

		let days = 0;
		if (nightDayMatch) {
			days = parseKoreanDayCount(nightDayMatch[2] ?? '');
		} else if (weekMatch) {
			days = parseKoreanDayCount(weekMatch[1] || '일주일') * 7;
		} else if (dayMatch) {
			days = parseKoreanDayCount(dayMatch[1] ?? '');
		}
		if (!Number.isFinite(days) || days <= 0 || days > 14) return null;

		const hourMatch = normalized.match(
			/(?:하룻|하루|일|이틀|사흘|나흘|닷새|엿새|이레|여드레|아흐레|열흘|열하루|열이틀|열사흘|열나흘|며칠|몇일)(\d{1,2}|한|두|세|네|다섯|여섯|일곱|여덟|아홉|일|이|삼|사|오|육|칠|팔|구)시간/
		);
		const extraHours = hourMatch ? parseKoreanHour(hourMatch[1] ?? '') : 0;
		const extraMinutes = /반/.test(normalized) ? 12 * 60 : 0;
		const minutes = Math.round(days * 24 * 60 + extraHours * 60 + extraMinutes);

		const base = dateBaseFromText(text);
		const start = isTodayText(text) ? currentDateTime() : dateWithTime(base, 9, 0);
		const end = new Date(start.getTime() + minutes * MINUTE_MS);

		return {
			start: toDatetimeLocalValue(start),
			end: toDatetimeLocalValue(end),
			label: `${formatTimeRangeLabel(start, end)} · ${dayDurationLabel(minutes)}`
		};
	}

	function parseDurationFromNow(text: string): ParsedTimeRange | null {
		if (/\d+\s*시(?!간)|부터|까지/.test(text)) return null;
		const normalized = text.replace(/\s/g, '');
		const decimalMatch = normalized.match(/(\d+(?:[.,]\d+)?)시간/);
		const durationMatch =
			decimalMatch ??
			normalized.match(
				/(열두|열둘|열한|열하나|열|십|아홉|여덟|일곱|여섯|다섯|네|넷|세|셋|두|둘|한|하나|일|이|삼|사|오|육|칠|팔|구|몇|\d{1,2})시간/
			);
		if (!durationMatch) return null;

		const hourText = durationMatch[1] ?? '';
		const hours =
			hourText === '몇'
				? 3
				: decimalMatch
					? Number(hourText.replace(',', '.'))
					: parseKoreanHour(hourText);
		if (!Number.isFinite(hours) || hours <= 0) return null;
		const minuteMatch = normalized.match(/([0-5]?\d)분/);
		const extraMinutes = minuteMatch?.[1]
			? Number(minuteMatch[1])
			: decimalMatch
				? 0
				: /반/.test(normalized)
					? 30
					: 0;
		const minutes = Math.round(hours * 60) + extraMinutes;
		const start = currentDateTime();
		const end = new Date(start.getTime() + minutes * MINUTE_MS);

		return {
			start: toDatetimeLocalValue(start),
			end: toDatetimeLocalValue(end),
			label: `${formatTimeRangeLabel(start, end)} · ${durationRangeLabel(minutes)}`
		};
	}

	function applyTimeTranscript(text: string) {
		const parsedRange =
			parseSpokenTimeRange(text) ??
			parseFlexibleDayRange(text) ??
			parseMultiDayDurationFromNow(text) ??
			parseDurationFromNow(text);
		if (parsedRange) {
			applyTimeRange(parsedRange);
			customTimeInput = text;
			return;
		}
		const matchedTime = timeIdFromText(text);
		if (matchedTime) {
			selectTime(matchedTime);
		} else {
			selectTime('custom');
			customTimeInput = text;
			session.customTime = text;
		}
	}

	function applyBudgetTranscript(text: string) {
		const parsed = parseBudget(text);
		if (!parsed) {
			customBudgetInput = text;
			session.budgetTotal = undefined;
			return;
		}
		session.budgetTotal = parsed;
		customBudgetInput = formatKrw(parsed);
	}

	function applyFollowupTranscript(text: string) {
		followupAnswerInput = text;
	}

	function clearRecommendationSpeech() {
		if (listeningFor && listeningFor !== 'onboarding') stopActiveRecognition();
		speechTranscript = '';
		speechMessage = '';
	}

	function openRecommendationStep(targetScreen: Screen) {
		clearRecommendationSpeech();
		screen = targetScreen;
	}

	function rememberRecommendationSpeech(target: SpeechTarget, text: string) {
		if (target === 'onboarding' || !text) return;
		recommendationSpeechCaptions = {
			...recommendationSpeechCaptions,
			[target]: text
		};
	}

	function recommendationVoiceCaption(target: SpeechTarget, idle: string) {
		if (listeningFor === target) {
			return speechTranscript ? `이렇게 들었어: ${speechTranscript}` : '듣고 있어. 편하게 말해줘.';
		}
		const remembered = recommendationSpeechCaptions[target];
		if (remembered) return `이렇게 들었어: ${remembered}`;
		return speechMessage || idle;
	}

	function stopOnboardingVoice() {
		clearOnboardingSilenceTimer();
		saiSpeaking = false;
		saiSpeechRequestId += 1;
		stopOnboardingAudio();
		if (listeningFor === 'onboarding') stopActiveRecognition();
	}

	async function beginOnboardingVoice(
		question: OnboardingQuestion = currentOnboardingQuestion,
		options: OnboardingVoiceOptions = {}
	) {
		onboardingVoicePaused = false;
		onboardingSpeechStatus = '';
		const ttsRequestId = ++saiSpeechRequestId;

		const shouldReadQuestion =
			options.readQuestion ?? !spokenOnboardingQuestionIds.includes(question.id);
		if (shouldReadQuestion) {
			const supertoneSpoken = await speakOnboardingQuestionWithSupertone(question, ttsRequestId);
			if (ttsRequestId !== saiSpeechRequestId) return;
			if (supertoneSpoken) {
				if (!spokenOnboardingQuestionIds.includes(question.id)) {
					spokenOnboardingQuestionIds.push(question.id);
				}
				return;
			}
			showOnboardingTtsError();
			return;
		}
		saiSpeaking = false;
		stopOnboardingAudio();
		startSpeech('onboarding');
	}

	function restartOnboardingVoice() {
		beginOnboardingVoice(currentOnboardingQuestion, { readQuestion: false });
	}

	function stopSaiAudio() {
		saiSpeechRequestId += 1;
		stopOnboardingAudio();
	}

	function stopOnboardingAudio() {
		if (activeSaiAudio) {
			activeSaiAudio.pause();
			activeSaiAudio.removeAttribute('src');
			activeSaiAudio.load();
			activeSaiAudio = null;
		}
		if (activeSaiAudioUrl) {
			URL.revokeObjectURL(activeSaiAudioUrl);
			activeSaiAudioUrl = '';
		}
	}

	async function runScreenVoice(plan: SaiScreenVoicePlan) {
		if (!browser) return;

		stopActiveRecognition();
		stopSaiAudio();
		saiSpeaking = true;
		speechTranscript = '';
		speechMessage = '';
		const speechRequestId = ++saiSpeechRequestId;

		try {
			const response = await fetch(resolve('/api/voice/tts'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: plan.text })
			});
			if (!response.ok) throw new Error(`Supertone TTS ${response.status}`);

			const blob = await response.blob();
			if (speechRequestId !== saiSpeechRequestId) return;

			activeSaiAudioUrl = URL.createObjectURL(blob);
			const audio = new Audio(activeSaiAudioUrl);
			activeSaiAudio = audio;

			await new Promise<void>((resolvePlayback) => {
				audio.onended = () => {
					if (activeSaiAudio === audio) {
						stopSaiAudio();
						saiSpeaking = false;
						if (plan.listen) startSpeech(plan.listen);
					}
					resolvePlayback();
				};
				audio.onerror = () => {
					if (activeSaiAudio === audio) {
						stopSaiAudio();
						saiSpeaking = false;
						if (plan.listen) startSpeech(plan.listen);
					}
					resolvePlayback();
				};
				void audio.play().catch(() => {
					if (activeSaiAudio === audio) {
						stopSaiAudio();
						saiSpeaking = false;
						if (plan.listen) startSpeech(plan.listen);
					}
					resolvePlayback();
				});
			});
		} catch (error) {
			console.error(error);
			if (speechRequestId === saiSpeechRequestId) {
				stopSaiAudio();
				saiSpeaking = false;
				if (plan.listen) startSpeech(plan.listen);
			}
		}
	}

	function showOnboardingTtsError() {
		saiSpeaking = false;
		onboardingVoicePaused = true;
		onboardingSpeechStatus = 'Supertone TTS 오류야. 설정이나 네트워크를 확인해줘.';
		if (listeningFor === 'onboarding') stopActiveRecognition();
	}

	async function speakOnboardingQuestionWithSupertone(
		question: OnboardingQuestion = currentOnboardingQuestion,
		ttsRequestId: number
	) {
		if (!browser) return false;

		stopActiveRecognition();
		stopOnboardingAudio();
		saiSpeaking = true;
		speechTranscript = '';
		speechMessage = '';
		onboardingSpeechStatus = '';

		const answerHint =
			question.id === 'mbtiType' ? 'ENFP처럼 MBTI 유형 하나만 말하거나, 잘 모르겠다고 말해줘.' : '';

		try {
			const response = await fetch(resolve('/api/voice/tts'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					text: [question.prompt, answerHint].filter(Boolean).join(' ')
				})
			});
			if (!response.ok) throw new Error(`Supertone TTS ${response.status}`);

			const blob = await response.blob();
			if (ttsRequestId !== saiSpeechRequestId) return true;

			activeSaiAudioUrl = URL.createObjectURL(blob);
			const audio = new Audio(activeSaiAudioUrl);
			activeSaiAudio = audio;

			return await new Promise<boolean>((resolveSpoken) => {
				audio.onended = () => {
					if (activeSaiAudio === audio) {
						stopOnboardingAudio();
						saiSpeaking = false;
						if (screen === 'onboarding' && !onboardingVoicePaused) startSpeech('onboarding');
					}
					resolveSpoken(true);
				};
				audio.onerror = () => {
					if (activeSaiAudio === audio) {
						stopOnboardingAudio();
						showOnboardingTtsError();
					}
					resolveSpoken(false);
				};
				void audio.play().catch(() => {
					if (activeSaiAudio === audio) {
						stopOnboardingAudio();
						showOnboardingTtsError();
					}
					resolveSpoken(false);
				});
			});
		} catch (error) {
			console.error(error);
			if (ttsRequestId === saiSpeechRequestId) {
				stopOnboardingAudio();
				showOnboardingTtsError();
			}
			return false;
		}
	}

	function clearOnboardingSilenceTimer() {
		if (!onboardingSilenceTimer) return;
		clearTimeout(onboardingSilenceTimer);
		onboardingSilenceTimer = null;
	}

	function pauseOnboardingVoice() {
		clearOnboardingSilenceTimer();
		onboardingVoicePaused = true;
		onboardingSpeechStatus = '잠깐 멈춰둘게. 캐릭터를 누르면 다시 들을게.';
		if (listeningFor === 'onboarding') stopActiveRecognition();
	}

	function armOnboardingSilenceTimer() {
		clearOnboardingSilenceTimer();
		onboardingSilenceTimer = setTimeout(() => {
			if (listeningFor === 'onboarding' && !speechTranscript.trim()) pauseOnboardingVoice();
		}, ONBOARDING_SILENCE_TIMEOUT_MS);
	}

	function stopActiveRecognition() {
		if (listeningFor === 'onboarding') clearOnboardingSilenceTimer();
		if (!activeRecognition) {
			listeningFor = null;
			return;
		}

		const recognition = activeRecognition;
		activeRecognition = null;
		recognition.stop();
		listeningFor = null;
	}

	function getWebSpeechRecognitionCtor(): WebSpeechRecognitionConstructor | undefined {
		if (!browser) return undefined;
		const speechWindow = window as Window & {
			SpeechRecognition?: WebSpeechRecognitionConstructor;
			webkitSpeechRecognition?: WebSpeechRecognitionConstructor;
		};
		return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
	}

	function startSpeech(target: SpeechTarget) {
		const SpeechRecognition = getWebSpeechRecognitionCtor();
		speechMessage = '';

		if (!SpeechRecognition) {
			speechMessage = '이 브라우저에서는 Web Speech API 음성 인식이 안 돼.';
			if (target === 'onboarding') {
				onboardingVoicePaused = true;
				onboardingSpeechStatus = 'Web Speech API 음성 인식이 안 돼. 직접 입력해줘.';
			}
			return;
		}

		stopActiveRecognition();
		const recognition = new SpeechRecognition();
		activeRecognition = recognition;
		listeningFor = target;
		speechTranscript = '';
		if (target === 'onboarding') {
			onboardingVoicePaused = false;
			onboardingSpeechStatus = '';
			armOnboardingSilenceTimer();
		}
		recognition.lang = 'ko-KR';
		recognition.interimResults = true;
		recognition.maxAlternatives = 1;
		recognition.onresult = (event) => {
			const text = Array.from(event.results)
				.map((result) => result[0]?.transcript ?? '')
				.join('')
				.trim();
			speechTranscript = text;
			rememberRecommendationSpeech(target, text);
			if (target === 'situation') applySituationTranscript(text);
			if (target === 'time') applyTimeTranscript(text);
			if (target === 'budget') applyBudgetTranscript(text);
			if (target === 'extra') recommendationNoteInput = text;
			if (target === 'followup') applyFollowupTranscript(text);
			if (target === 'onboarding') {
				onboardingAnswerInput = text;
				onboardingAnswerSource = 'voice';
				if (text) clearOnboardingSilenceTimer();
			}
		};
		recognition.onerror = () => {
			if (activeRecognition !== recognition) return;
			speechMessage = '잘 못 들었어. 아래 선택지로 이어가줘.';
			if (target === 'onboarding') {
				clearOnboardingSilenceTimer();
				onboardingVoicePaused = true;
				onboardingSpeechStatus = '잘 못 들었어. 캐릭터를 누르면 다시 들을게.';
			}
			listeningFor = null;
			activeRecognition = null;
		};
		recognition.onend = () => {
			const naturalEnd = activeRecognition === recognition;
			if (target === 'onboarding' && speechTranscript && naturalEnd) {
				clearOnboardingSilenceTimer();
				onboardingSpeechStatus = '답변 받아 적었어. 다음 누르면 저장하고 넘어갈게.';
			}
			if (target === 'onboarding' && !speechTranscript && naturalEnd && screen === 'onboarding') {
				clearOnboardingSilenceTimer();
				onboardingVoicePaused = true;
				onboardingSpeechStatus = '잠깐 멈춰둘게. 캐릭터를 누르면 다시 들을게.';
			}
			if (naturalEnd) {
				listeningFor = null;
				activeRecognition = null;
			}
		};
		try {
			recognition.start();
		} catch {
			if (target === 'onboarding') {
				clearOnboardingSilenceTimer();
				onboardingVoicePaused = true;
				onboardingSpeechStatus = '지금은 마이크를 열 수 없어. 캐릭터를 누르면 다시 시도할게.';
			}
			listeningFor = null;
			if (activeRecognition === recognition) activeRecognition = null;
		}
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

		const effectiveScreen = targetScreen;
		const flow: Screen[] = [
			'time',
			'situation',
			'budget',
			'extra',
			'followup',
			'generating',
			'results'
		];
		if (!flow.includes(effectiveScreen)) return { current: 0, total: 0, label: '' };

		const total = 6 + followupLength;
		let base = flow.indexOf(effectiveScreen) + 1;
		if (effectiveScreen === 'followup') base = 5 + targetFollowupIndex;
		if (effectiveScreen === 'generating') base = 5 + followupLength;
		if (effectiveScreen === 'results') base = 6 + followupLength;
		return {
			current: Math.min(base, total),
			total,
			label: '추천'
		};
	}

	function sourceLabel(item: RecommendationItem) {
		if (item.sourceName) return item.sourceName;
		const text = [
			item.outboundUrl,
			item.reservationUrl,
			item.mapUrl,
			item.routeMapUrl,
			item.availabilityText
		]
			.filter(Boolean)
			.join(' ');
		const tagsAndTitle = [item.title, item.address, item.availabilityText]
			.filter(Boolean)
			.join(' ');
		if (/myrealtrip\.com/i.test(text) || item.source === 'myrealtrip') return '마이리얼트립';
		if (/catchtable/i.test(text) || /캐치테이블|예약 슬롯/.test(tagsAndTitle)) return '캐치테이블';
		if (/yogiyo/i.test(text) || /요기요|배달/.test(tagsAndTitle)) return '요기요';
		if (/flight\.naver/i.test(text) || item.slot === 'flight') return '네이버항공';
		if (/naver/i.test(text) || /네이버지도/.test(tagsAndTitle)) return '네이버지도';
		if (/kakao|map\.kakao/i.test(text) || /카카오맵/.test(tagsAndTitle)) return '카카오맵';
		if (item.source === 'genrank') return 'GenRank 트렌드';
		return '추천 후보';
	}

	function itemPrimaryUrl(item: RecommendationItem) {
		return reservationUrlForItem(item) ?? itemLocationUrl(item);
	}

	function cardReservationUrl(card: RecommendationCard) {
		const fallbackQuery = card.items.find((item) => item.slot === 'activity')?.title ?? card.title;
		return (
			safeExternalUrl(card.reservationUrl, fallbackQuery) ??
			uniqueRecommendationItems(card)
				.map((item) => reservationUrlForItem(item))
				.find((url): url is string => Boolean(url)) ??
			safeExternalUrl(card.outboundUrl, fallbackQuery) ??
			kakaoSearchUrl(fallbackQuery)
		);
	}

	function uniqueRecommendationItems(card: RecommendationCard) {
		const seen: string[] = [];
		return card.items.filter((item) => {
			const key = `${item.title}-${item.address ?? ''}`.replace(/\s/g, '').toLowerCase();
			if (seen.includes(key)) return false;
			seen.push(key);
			return true;
		});
	}

	function detailVisuals(card: RecommendationCard): DetailVisual[] {
		const visualItems = uniqueRecommendationItems(card)
			.filter((item) => item.thumbnailUrl)
			.slice(0, 4);
		const sourceItems = visualItems.length
			? visualItems
			: uniqueRecommendationItems(card).slice(0, 4);
		return sourceItems.map((item, index) => ({
			key: `${item.title}-${item.thumbnailUrl ?? index}`,
			title: item.title,
			subtitle: sourceLabel(item),
			imageUrl: item.thumbnailUrl ?? '',
			href: itemPrimaryUrl(item) ?? cardReservationUrl(card),
			tone: (index % 4) + 1
		}));
	}

	function summaryVisual(card: RecommendationCard) {
		return detailVisuals(card)[0] ?? null;
	}

	function resultSlotClass(index: number) {
		return index % 3 === 0 ? 'a' : index % 3 === 1 ? 'b' : 's';
	}

	function resultSlotLabel(card: RecommendationCard, index: number) {
		return card.label || (index % 3 === 0 ? '추천 1' : index % 3 === 1 ? '추천 2' : '추천 3');
	}

	function resultBadgeClass(index: number) {
		return index % 3 === 0 ? '' : index % 3 === 1 ? 'b' : 'w';
	}

	function reservationUrlForItem(item: RecommendationItem) {
		return (
			safeExternalUrl(item.reservationUrl, item.title) ??
			safeExternalUrl(item.outboundUrl, item.title)
		);
	}

	function safeExternalUrl(url: string | undefined, fallbackQuery: string) {
		if (!url) return undefined;
		try {
			const parsed = new URL(url);
			if (!/^https?:$/i.test(parsed.protocol)) {
				return /myrealtrip/i.test(url) ? myrealtripSearchUrl(fallbackQuery) : undefined;
			}
			if (isInvalidMyrealtripUrl(parsed)) return myrealtripSearchUrl(fallbackQuery);
			if (isGenericCatchtableUrl(parsed)) return catchtableSearchUrl(fallbackQuery);
			return url;
		} catch {
			return undefined;
		}
	}

	function isInvalidMyrealtripUrl(parsed: URL) {
		if (!parsed.hostname.endsWith('myrealtrip.com')) return false;
		return /^\/offers\/(?:example|myrealtrip-\d+)(?:\/|$)/.test(parsed.pathname);
	}

	function myrealtripSearchUrl(query: string) {
		return `https://www.myrealtrip.com/search?keyword=${encodeURIComponent(query)}`;
	}

	function isGenericCatchtableUrl(parsed: URL) {
		if (!parsed.hostname.endsWith('catchtable.co.kr')) return false;
		const normalizedPath = parsed.pathname.replace(/\/+$/, '');
		return normalizedPath === '';
	}

	function catchtableSearchUrl(query: string) {
		return `https://app.catchtable.co.kr/ct/search?keyword=${encodeURIComponent(query)}`;
	}

	function itemLocationUrl(item: RecommendationItem) {
		if (item.routeMapUrl) return item.routeMapUrl;
		if (item.lat != null && item.lng != null) return kakaoMapUrl(item.title, item.lat, item.lng);
		if (item.source === 'myrealtrip' && !item.address && !item.mapUrl) return '';
		if (item.mapUrl) return item.mapUrl;
		return kakaoSearchUrl(item.address ?? item.title);
	}

	function kakaoMapUrl(title: string, lat?: number, lng?: number) {
		if (lat == null || lng == null) return kakaoSearchUrl(title);
		return `https://map.kakao.com/link/map/${encodeURIComponent(title)},${lat},${lng}`;
	}

	function kakaoSearchUrl(query: string) {
		return `https://map.kakao.com/link/search/${encodeURIComponent(query)}`;
	}
</script>

<svelte:head>
	<title>사이 SAI</title>
	<meta
		name="description"
		content="시간, 예산, 위치, 동행 상황을 반영해 오늘 할 일을 추천하는 SAI MVP"
	/>
</svelte:head>

{#snippet recommendationCoach(eyebrow: string, title: string, body: string, target: SpeechTarget)}
	<div class="onboarding-coach recommendation-coach">
		<div class="onboarding-bubble">
			<p class="eyebrow">{eyebrow}</p>
			<h1>{title}</h1>
			<p>{body}</p>
		</div>
		<button
			class={`onboarding-mascot-ring mascot-pulse ${listeningFor === target ? 'listening' : ''}`}
			type="button"
			onclick={() => replayRecommendationVoice(target)}
			aria-label="질문 다시 듣고 말로 답하기"
		>
			<div
				class={`mascot mascot-${saiSpeaking ? 'talking' : listeningFor === target ? 'listening' : 'idle'} onboarding-mascot`}
			>
				<img src={saiSymbol} alt="사이" />
			</div>
		</button>
		<p class="onboarding-voice-caption">
			{recommendationVoiceCaption(
				target,
				'나를 누르면 질문을 다시 듣고 말로 답할 수 있어. 아래에 직접 적어도 돼.'
			)}
		</p>
	</div>
{/snippet}

{#snippet cssMascot(state: string, size: number, pa: string, pb: string)}
	<div class={`sai sai--${state}`} style={`--sai:${size}px;--pa:${pa};--pb:${pb}`}>
		<div class="sai-rings"><i></i><i></i></div>
		<div class="sai-antenna"><b></b></div>
		<div class="sai-body">
			<div class="sai-gloss"></div>
			<div class="sai-face">
				<div class="sai-eyes">
					<span class="eye"><i></i></span>
					<span class="eye"><i></i></span>
				</div>
				<div class="sai-cheek l"></div>
				<div class="sai-cheek r"></div>
				<div class="sai-mouth"></div>
			</div>
		</div>
		<div class="sai-spark s1" aria-hidden="true">*</div>
		<div class="sai-spark s2" aria-hidden="true">*</div>
		<div class="sai-think" aria-hidden="true">...</div>
	</div>
{/snippet}

<main class="app-frame">
	<section class={`phone-shell state-${screen}`}>
		<header class="topbar">
			{#if progress.total > 0}
				<div
					class="linear-progress"
					aria-label={`${progress.label} ${progress.current}/${progress.total}`}
				>
					<span style:width={progressPercent}></span>
				</div>
			{:else}
				<span class="topbar-spacer"></span>
			{/if}
			{#if currentUserId}
				<button class="ghost small" type="button" onclick={logout}>나가기</button>
			{/if}
		</header>

		{#if screen === 'auth'}
			<section class="screen auth-screen">
				<div class="hero-lockup">
					<img class="hero-symbol" src={saiSymbol} alt="사이" />
					<p class="eyebrow">SITUATION-AWARE AI</p>
					<h1>오늘 뭐하지?</h1>
					<p>시간과 돈 사이에서 지금 제일 괜찮은 선택지를 찾아줄게.</p>
				</div>

				<form class="auth-form" onsubmit={(event) => event.preventDefault()}>
					<div class="auth-fields">
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
					</div>

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
			<section class="screen decision-screen onboarding-screen">
				{#if onboardingIntroVisible}
					<div class="onboarding-coach">
						<div class="onboarding-bubble onboarding-intro-bubble">
							<p class="eyebrow">{onboardingIntroContent.eyebrow}</p>
							<h1>{onboardingIntroContent.title}</h1>
							<p>{onboardingIntroContent.body}</p>
						</div>
						<div class="onboarding-mascot-ring onboarding-intro-mascot-ring" aria-hidden="true">
							<div class={`mascot mascot-${saiSpeaking ? 'talking' : 'happy'} onboarding-mascot`}>
								<img src={saiSymbol} alt="" />
							</div>
						</div>
					</div>

					<div class="bottom-actions">
						<button class="primary" type="button" onclick={startOnboardingQuestions}>
							시작하기
						</button>
					</div>
				{:else}
					<div class="onboarding-coach">
						<div class="onboarding-bubble">
							<p class="eyebrow">온보딩</p>
							<h1>{currentOnboardingQuestion.prompt}</h1>
							<p>{currentOnboardingQuestion.reaction}</p>
						</div>
						<button
							class={`onboarding-mascot-ring mascot-pulse ${listeningFor === 'onboarding' ? 'listening' : ''}`}
							type="button"
							onclick={restartOnboardingVoice}
							aria-label="말로 답하기 다시 시작"
						>
							<div class={`mascot mascot-${onboardingMascotState} onboarding-mascot`}>
								<img src={saiSymbol} alt="사이" />
							</div>
						</button>

						{#if onboardingVoiceCaption}
							<p class="onboarding-voice-caption">{onboardingVoiceCaption}</p>
						{/if}
					</div>

					<div class="onboarding-answer-panel">
						<label class="field compact">
							<span>직접 답변</span>
							<input
								value={onboardingAnswerInput}
								oninput={handleOnboardingAnswerInput}
								onkeydown={handleOnboardingAnswerKeydown}
								placeholder={onboardingAnswerPlaceholder}
							/>
						</label>
						{#if onboardingAnswerHelp}
							<p>{onboardingAnswerHelp}</p>
						{/if}
					</div>

					<div class="bottom-actions">
						<button
							class="primary"
							type="button"
							onclick={continueOnboarding}
							disabled={!onboardingCanContinue}
						>
							{onboardingIndex === onboardingQuestions.length - 1 ? '완료' : '다음'}
						</button>
					</div>
				{/if}
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
									<span>{companionRelationSummary(item.session)}</span>
									<strong>{item.cards[0]?.label ?? '추천'}</strong>
								</button>
							{/each}
						</div>
					</section>
				{/if}
			</section>
		{:else if screen === 'situation'}
			<section class="screen decision-screen onboarding-screen recommendation-screen">
				{@render recommendationCoach(
					recommendationCoachContent.situation.eyebrow,
					recommendationCoachContent.situation.title,
					recommendationCoachContent.situation.body,
					recommendationCoachContent.situation.target
				)}

				<div class="onboarding-answer-panel recommendation-answer-panel">
					<label class="field compact">
						<span>직접 말 남기기</span>
						<input
							value={customSituationInput}
							oninput={handleSituationAnswerInput}
							placeholder="예: 엄마랑 친구랑 / 아내랑 아이와 함께"
						/>
					</label>
				</div>

				<div class="bottom-actions">
					<button
						class="primary"
						type="button"
						onclick={continueSituation}
						disabled={!companionRelationsFromText(customSituationInput).length}
					>
						다음으로
					</button>
				</div>
			</section>
		{:else if screen === 'time'}
			<section class="screen decision-screen onboarding-screen recommendation-screen">
				{@render recommendationCoach(
					recommendationCoachContent.time.eyebrow,
					recommendationCoachContent.time.title,
					recommendationCoachContent.time.body,
					recommendationCoachContent.time.target
				)}

				<div class="onboarding-answer-panel recommendation-answer-panel">
					<div class="datetime-grid" aria-label="시작과 종료 시간">
						<label class="field compact">
							<span>시작 시간</span>
							<input
								type="datetime-local"
								value={session.startDateTime ?? ''}
								oninput={(event) => handleTimeRangeInput('startDateTime', inputValue(event))}
							/>
						</label>
						<label class="field compact">
							<span>종료 시간</span>
							<input
								type="datetime-local"
								value={session.endDateTime ?? ''}
								oninput={(event) => handleTimeRangeInput('endDateTime', inputValue(event))}
							/>
						</label>
					</div>
					<p>
						{timeRangeSummary ||
							(session.availableTime
								? `${timeMeta(session.availableTime).label} 정도로 볼게.`
								: '문장으로 말하면 시작이랑 끝 시간을 자동으로 채워볼게.')}
					</p>
				</div>

				<div class="bottom-actions">
					<button
						class="primary"
						type="button"
						onclick={continueTime}
						disabled={!session.availableTime || (timeCustomMode && !customTimeInput.trim())}
					>
						이만큼 가능해
					</button>
				</div>
			</section>
		{:else if screen === 'budget'}
			<section class="screen decision-screen onboarding-screen recommendation-screen">
				{@render recommendationCoach(
					recommendationCoachContent.budget.eyebrow,
					recommendationCoachContent.budget.title,
					recommendationCoachContent.budget.body,
					recommendationCoachContent.budget.target
				)}

				<div class="onboarding-answer-panel recommendation-answer-panel">
					<label class="field compact">
						<span>총 예산</span>
						<input
							inputmode="numeric"
							value={customBudgetInput}
							oninput={handleBudgetAnswerInput}
							placeholder="예: 60,000원"
						/>
					</label>
					<p>말로 답하면 예산 금액만 여기에 표시할게.</p>
				</div>

				<div class="bottom-actions">
					<button
						class="primary"
						type="button"
						onclick={continueBudget}
						disabled={!session.budgetTotal}
					>
						좋아, 다음
					</button>
				</div>
			</section>
		{:else if screen === 'extra'}
			<section class="screen decision-screen onboarding-screen recommendation-screen">
				{@render recommendationCoach(
					recommendationCoachContent.extra.eyebrow,
					recommendationCoachContent.extra.title,
					recommendationCoachContent.extra.body,
					recommendationCoachContent.extra.target
				)}

				<div class="onboarding-answer-panel recommendation-answer-panel">
					<label class="field compact">
						<span>추가로 남길 말</span>
						<textarea
							rows="3"
							value={recommendationNoteInput}
							oninput={(event) => (recommendationNoteInput = textareaValue(event))}
							placeholder="예: 너무 시끄럽지 않았으면 좋겠어"
						></textarea>
					</label>
					<p>없으면 비워두고 넘어가도 돼.</p>
				</div>

				<div class="bottom-actions">
					<button class="primary" type="button" onclick={continueExtra}> 이제 골라줘 </button>
				</div>
			</section>
		{:else if screen === 'followup'}
			<section class="screen decision-screen onboarding-screen recommendation-screen">
				{@render recommendationCoach(
					followupCoachContent.eyebrow,
					followupCoachContent.title,
					followupCoachContent.body,
					followupCoachContent.target
				)}

				<div class="onboarding-answer-panel recommendation-answer-panel">
					<label class="field compact">
						<span>직접 말 남기기</span>
						<input
							value={followupAnswerInput}
							oninput={(event) => (followupAnswerInput = inputValue(event))}
							placeholder="짧게 말해도 내가 맞춰볼게"
						/>
					</label>
					<p>선택지 없이 네 말로만 답하면 돼. 없으면 건너뛰어도 괜찮아.</p>
				</div>

				<div class="bottom-actions inline">
					<button class="secondary" type="button" onclick={skipFollowups}>건너뛰기</button>
					<button class="primary" type="button" onclick={continueFollowup}>
						{followupAnswerInput.trim() ? '이 답으로 갈래' : '바로 추천'}
					</button>
				</div>
			</section>
		{:else if screen === 'generating'}
			<section class="screen generating-screen" aria-live="polite">
				<div class="stage-wrap" aria-label="AI 친구들 회의 중">
					<div class="council-stage">
						<div class="huddle-glow"></div>
						{#each ['left', 'center', 'right'] as speaker (speaker)}
							<div class={`cbubble b-${speaker} ${loadingLine.who === speaker ? 'show' : ''}`}>
								{#if loadingLine.who === speaker}
									{loadingLine.text}
									{#if loadingLine.em}
										<span class="em">{loadingLine.em}</span>
									{/if}
								{/if}
							</div>
						{/each}
						<div class={loadingMascotClasses('left')}>
							{@render cssMascot(loadingMascotState('left'), 96, '#FF6B5E', '#B45EE8')}
						</div>
						<div class={loadingMascotClasses('right')}>
							{@render cssMascot(loadingMascotState('right'), 96, '#B45EE8', '#5B6CFF')}
						</div>
						<div class={loadingMascotClasses('center')}>
							{@render cssMascot(loadingMascotState('center'), 118, '#FF6B5E', '#5B6CFF')}
						</div>
						<div class="huddle-dots" aria-hidden="true"><i></i><i></i><i></i></div>
					</div>
				</div>
				<div class="question-block">
					<p class="eyebrow loading-phase"><span class="pip"></span>{loadingPhase}</p>
					<h1><b>AI</b> 친구들이<br />잠깐 회의 중이야</h1>
					<p>날씨, 지도, 맛집, 액티비티 후보를 시간과 예산 안에서 맞춰보고 있어.</p>
				</div>
			</section>
		{:else if screen === 'results'}
			<section class="screen results-screen">
				<div class="results-header">
					<div>
						<p class="eyebrow">
							{companionRelationSummary(session)} · {candidateBundle?.weather.label ??
								session.weatherSnapshot.label}
						</p>
						<h1>이 3개로 추렸어</h1>
					</div>
				</div>
				<div class="hostdock">
					<div class="mascot mascot-happy result-mascot">
						<img src={saiSymbol} alt="사이" />
					</div>
					<div class="said">
						<span class="nm">사이</span>
						{recommendations.length === 3
							? '지금 조건에서 바로 실행하기 좋은 3개만 남겼어.'
							: '조건에 맞는 후보를 추려봤어.'}
					</div>
				</div>

				<div
					class={`budget ${recommendationBudgetOver ? 'over' : ''}`}
					aria-label={`추천 합계 ${formatKrw(recommendationTotalCost)}, 예산 ${formatKrw(recommendationBudgetLimit)}`}
				>
					<div class="bl">
						<span>예산 합계</span>
						<span
							><b>{formatKrw(recommendationTotalCost)}</b> / {formatKrw(
								recommendationBudgetLimit
							)}</span
						>
					</div>
					<div class="meter" aria-hidden="true">
						<i style:width={recommendationBudgetPercent}></i>
					</div>
				</div>

				<div class="recommendation-list card-picker" aria-label="추천 카드 목록">
					{#each recommendations as card, index (card.id)}
						{@const visual = summaryVisual(card)}
						<button
							class="course in"
							type="button"
							style={`--delay:${index * 60}ms`}
							aria-label={`${card.title} 상세 보기`}
							onclick={() => openRecommendationDetail(card.id)}
						>
							<div class={`ph tone-${visual?.tone ?? (index % 4) + 1}`}>
								{#if visual?.imageUrl}
									<img src={visual.imageUrl} alt={`${visual.title} 사진`} loading="lazy" />
								{:else}
									<span aria-hidden="true">{card.title.slice(0, 2)}</span>
								{/if}
							</div>

							<div class="ci">
								<span class="price">{formatKrw(card.estimatedCost)}</span>
								<div class={`slot-l ${resultSlotClass(index)}`}>{resultSlotLabel(card, index)}</div>
								<div class="nm">{card.title}</div>
								<div class="meta">
									{#each card.badges.slice(0, 3) as badge, badgeIndex (badge)}
										<span class={`badge ${resultBadgeClass(badgeIndex)}`}>{badge}</span>
									{/each}
								</div>
								<div class="deeplink-row">탭하면 예약 페이지로 →</div>
							</div>
						</button>
					{/each}
				</div>

				<div class="bottom-actions inline">
					<button class="secondary" type="button" onclick={goHome}>홈</button>
					<button class="primary" type="button" onclick={startRecommendation}>다시 추천</button>
				</div>
			</section>
		{/if}

		{#if externalSheet}
			<div class="external-sheet open">
				<button
					class="sheet-backdrop"
					type="button"
					aria-label="외부 이동 시트 닫기"
					onclick={closeExternalSheet}
				></button>
				<div class="panel">
					<div class="grab"></div>
					<div class="ext">{externalSheet.provider}으로 이동</div>
					<h3>{externalSheet.title}</h3>
					<p>{externalSheet.description} 로그인·결제는 외부에서 진행돼.</p>
					<a
						class="primary link-button"
						href={externalSheet.url}
						target="_blank"
						rel="external noreferrer"
						onclick={() => {
							closeExternalSheet();
						}}>예약 페이지 열기</a
					>
					<button class="secondary" type="button" onclick={closeExternalSheet}>닫기</button>
				</div>
			</div>
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
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 24px;
		background:
			radial-gradient(circle at 50% 0, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0) 42%),
			#f3eee8;
	}

	.phone-shell {
		position: relative;
		width: min(100%, 430px);
		height: 100dvh;
		min-height: 100dvh;
		overflow-y: auto;
		margin: 0;
		border: 1px solid rgba(60, 52, 73, 0.12);
		border-radius: 0;
		background: var(--bg);
		padding: max(16px, env(safe-area-inset-top)) 20px max(18px, env(safe-area-inset-bottom));
		display: flex;
		flex-direction: column;
		gap: 14px;
		box-shadow:
			0 24px 70px rgba(70, 58, 90, 0.18),
			0 2px 8px rgba(70, 58, 90, 0.08);
	}

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 44px;
		gap: 12px;
	}

	.linear-progress {
		position: relative;
		width: min(190px, 58vw);
		height: 5px;
		overflow: hidden;
		border-radius: 999px;
		background: #e6e0ed;
	}

	.topbar-spacer {
		flex: 1;
	}

	.linear-progress span {
		position: absolute;
		inset: 0 auto 0 0;
		border-radius: 999px;
		background: var(--brand);
		transition: width 260ms ease;
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

	.auth-screen {
		justify-content: stretch;
	}

	.hero-lockup,
	.home-hero,
	.question-block {
		display: grid;
		gap: 8px;
	}

	.hero-lockup {
		flex: 0 0 auto;
		align-content: center;
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

	.auth-fields,
	.rec-card {
		border: 1px solid rgba(236, 231, 243, 0.92);
		border-radius: 20px;
		background: var(--card);
		box-shadow: 0 8px 26px rgba(120, 110, 160, 0.13);
	}

	.auth-form {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 18px;
		min-height: 0;
	}

	.auth-fields {
		display: grid;
		gap: 12px;
		margin-block: auto;
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

	.mascot {
		display: grid;
		place-items: center;
		justify-self: center;
	}

	.mascot img {
		width: 132px;
		height: 148px;
		filter: drop-shadow(0 16px 24px rgba(120, 90, 200, 0.18));
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

	.onboarding-screen {
		gap: 12px;
	}

	.recommendation-screen {
		align-items: center;
		gap: 12px;
		justify-content: stretch;
	}

	.recommendation-screen .recommendation-coach,
	.recommendation-screen .recommendation-answer-panel,
	.recommendation-screen .bottom-actions {
		width: min(100%, 370px);
	}

	.recommendation-screen .bottom-actions {
		position: static;
		flex: 0 0 auto;
		margin-top: 0;
		padding-top: 0;
		background: transparent;
	}

	.onboarding-coach {
		flex: 1;
		display: grid;
		align-content: center;
		justify-items: center;
		gap: 14px;
		min-height: 0;
	}

	.recommendation-coach {
		flex: 1 1 auto;
		align-content: center;
		justify-items: center;
		gap: 12px;
		min-height: 0;
		margin-bottom: 0;
	}

	.recommendation-coach .onboarding-bubble {
		padding: 14px;
	}

	.recommendation-coach .onboarding-mascot-ring {
		width: 118px;
		height: 126px;
	}

	.recommendation-coach .onboarding-mascot img {
		width: 104px;
		height: 116px;
	}

	.onboarding-bubble {
		position: relative;
		display: grid;
		gap: 8px;
		width: min(100%, 370px);
		padding: 16px;
		border: 1px solid rgba(236, 231, 243, 0.92);
		border-radius: 20px;
		background: #fff;
		box-shadow: 0 12px 28px rgba(120, 110, 160, 0.13);
	}

	.onboarding-bubble::before,
	.onboarding-bubble::after {
		position: absolute;
		left: 50%;
		width: 18px;
		height: 18px;
		content: '';
		transform: translateX(-50%) rotate(45deg);
	}

	.onboarding-bubble::before {
		bottom: -10px;
		border-bottom: 1px solid rgba(236, 231, 243, 0.92);
		border-right: 1px solid rgba(236, 231, 243, 0.92);
		background: #fff;
	}

	.onboarding-bubble::after {
		bottom: -8px;
		background: #fff;
	}

	.onboarding-intro-bubble {
		text-align: center;
	}

	.onboarding-intro-bubble p:not(.eyebrow) {
		line-height: 1.55;
	}

	.onboarding-mascot-ring {
		position: relative;
		display: grid;
		place-items: center;
		isolation: isolate;
	}

	.onboarding-mascot-ring {
		width: 156px;
		height: 166px;
		border: 0;
		background: transparent;
		padding: 0;
		cursor: pointer;
	}

	.onboarding-intro-mascot-ring {
		cursor: default;
	}

	.onboarding-mascot-ring:focus-visible {
		outline: 3px solid rgba(180, 94, 232, 0.28);
		outline-offset: 4px;
	}

	.mascot-pulse::before,
	.mascot-pulse::after {
		position: absolute;
		inset: 10px;
		z-index: 0;
		border: 2px solid rgba(91, 108, 255, 0.28);
		border-radius: 999px;
		background: rgba(180, 94, 232, 0.07);
		content: '';
		opacity: 0;
		pointer-events: none;
	}

	.mascot-pulse.listening::before,
	.mascot-pulse.listening::after {
		animation: listen-ring 1.55s ease-out infinite;
	}

	.mascot-pulse.listening::after {
		border-color: rgba(255, 107, 94, 0.28);
		background: rgba(255, 107, 94, 0.06);
		animation-delay: 0.72s;
	}

	.onboarding-mascot {
		z-index: 1;
	}

	.mascot-listening img {
		animation: listening-float 1.35s ease-in-out infinite;
	}

	.mascot-talking img {
		animation: talking-bounce 520ms ease-in-out infinite;
	}

	.onboarding-voice-caption {
		min-height: 22px;
		text-align: center;
		font-size: 13px;
		font-weight: 800;
	}

	.onboarding-answer-panel {
		display: grid;
		grid-template-columns: 1fr;
		gap: 8px;
	}

	.recommendation-answer-panel {
		flex: 0 0 auto;
	}

	.recommendation-answer-panel textarea {
		min-height: 86px;
	}

	.datetime-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 10px;
	}

	.datetime-grid .field,
	.datetime-grid input {
		min-width: 0;
	}

	.datetime-grid input {
		font-size: 15px;
		line-height: 1.2;
	}

	.onboarding-screen .bottom-actions {
		margin-top: 4px;
	}

	.onboarding-answer-panel p {
		grid-column: 1 / -1;
		margin: 0;
		color: var(--muted);
		font-size: 12px;
		font-weight: 800;
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

	.course-items span,
	.rec-topline span {
		color: var(--faint);
		font-size: 11px;
		font-weight: 900;
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

	.stage-wrap {
		margin-top: 0;
	}

	.sai {
		--sai: 140px;
		--pa: #ff6b5e;
		--pb: #5b6cff;
		position: relative;
		display: flex;
		width: var(--sai);
		height: var(--sai);
		flex: 0 0 var(--sai);
		align-items: center;
		justify-content: center;
		font-family: var(--pret);
	}

	.sai-body {
		position: relative;
		width: 78%;
		height: 84%;
		border-radius: 50% 50% 47% 47% / 56% 56% 44% 44%;
		background:
			radial-gradient(120% 90% at 30% 22%, rgba(255, 255, 255, 0.55), transparent 42%),
			linear-gradient(125deg, var(--pa) 8%, #b45ee8 52%, var(--pb) 95%);
		animation: sai-bob 3.4s ease-in-out infinite;
		box-shadow:
			0 16px 34px rgba(120, 90, 200, 0.3),
			inset 0 -10px 18px rgba(70, 40, 120, 0.22),
			inset 0 8px 14px rgba(255, 255, 255, 0.18);
		transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	.sai-gloss {
		position: absolute;
		top: 11%;
		left: 16%;
		width: 34%;
		height: 26%;
		border-radius: 50%;
		background: radial-gradient(circle at 40% 40%, rgba(255, 255, 255, 0.85), transparent 70%);
		pointer-events: none;
	}

	.sai-face {
		position: absolute;
		inset: 0;
	}

	.sai-eyes {
		position: absolute;
		top: 38%;
		right: 0;
		left: 0;
		display: flex;
		justify-content: center;
		gap: 16%;
		transition: transform 0.45s ease;
	}

	.sai-eyes .eye {
		position: relative;
		width: 17%;
		border-radius: 50%;
		aspect-ratio: 1 / 1.15;
		background: #2a2140;
		animation: sai-blink 4.6s infinite;
		transform-origin: center;
	}

	.sai-eyes .eye i {
		position: absolute;
		top: 18%;
		left: 22%;
		width: 34%;
		height: 34%;
		border-radius: 50%;
		background: #fff;
	}

	.sai-cheek {
		position: absolute;
		top: 52%;
		width: 13%;
		border-radius: 50%;
		aspect-ratio: 1;
		background: rgba(255, 140, 160, 0.5);
		filter: blur(1px);
	}

	.sai-cheek.l {
		left: 18%;
	}

	.sai-cheek.r {
		right: 18%;
	}

	.sai-mouth {
		position: absolute;
		top: 60%;
		left: 50%;
		width: 20%;
		height: 11%;
		border: 3px solid #2a2140;
		border-top: none;
		border-radius: 0 0 60px 60px;
		transition: all 0.3s ease;
		transform: translateX(-50%);
	}

	.sai-antenna {
		position: absolute;
		top: 2%;
		left: 50%;
		width: 3px;
		height: 16%;
		border-radius: 3px;
		background: #b45ee8;
		transform: translateX(-50%);
		transform-origin: bottom center;
	}

	.sai-antenna b {
		position: absolute;
		top: -8px;
		left: 50%;
		width: 13px;
		height: 13px;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 35%, #fff, var(--pb));
		box-shadow: 0 0 0 0 rgba(91, 108, 255, 0.5);
		transform: translateX(-50%);
	}

	.sai-rings {
		position: absolute;
		inset: 0;
		display: none;
	}

	.sai-rings i {
		position: absolute;
		inset: 4%;
		border: 2px solid rgba(91, 108, 255, 0.4);
		border-radius: 50%;
		animation: sai-ring 2s ease-out infinite;
	}

	.sai-rings i:nth-child(2) {
		border-color: rgba(255, 107, 94, 0.4);
		animation-delay: 1s;
	}

	.sai-spark {
		position: absolute;
		color: #ffc861;
		font-size: calc(var(--sai) * 0.13);
		opacity: 0;
		pointer-events: none;
	}

	.sai-spark.s1 {
		top: 4%;
		right: 10%;
	}

	.sai-spark.s2 {
		bottom: 14%;
		left: 6%;
		font-size: calc(var(--sai) * 0.1);
	}

	.sai-think {
		position: absolute;
		top: -6%;
		right: -2%;
		border-radius: 14px;
		background: #fff;
		color: #9a6bd8;
		padding: 4px 10px;
		font-size: calc(var(--sai) * 0.12);
		font-weight: 800;
		letter-spacing: 2px;
		opacity: 0;
		box-shadow: 0 6px 16px rgba(120, 90, 200, 0.2);
		transform: scale(0.6);
		transform-origin: bottom left;
	}

	.sai--thinking .sai-body {
		animation: sai-tilt 2.4s ease-in-out infinite;
	}

	.sai--thinking .sai-eyes {
		top: 33%;
	}

	.sai--thinking .sai-think {
		opacity: 1;
		animation: sai-pop 1.4s ease-in-out infinite;
		transform: scale(1);
	}

	.sai--thinking .sai-mouth {
		width: 9%;
		height: 6%;
		border-radius: 40px;
	}

	.sai--talking .sai-mouth {
		animation: sai-talk 0.42s ease-in-out infinite;
	}

	.sai--talking .sai-antenna b {
		animation: sai-bead 1.4s ease-in-out infinite;
	}

	.council-stage {
		position: relative;
		width: 300px;
		height: 230px;
		margin: 0 auto;
	}

	.cm {
		position: absolute;
		transition: transform 0.5s cubic-bezier(0.34, 1.4, 0.5, 1);
	}

	.cm.center {
		top: 4px;
		left: 50%;
		z-index: 3;
		transform: translateX(-50%);
	}

	.cm.left {
		top: 86px;
		left: 8px;
		z-index: 2;
	}

	.cm.right {
		top: 86px;
		right: 8px;
		z-index: 2;
	}

	.cm.left .sai-body {
		transform-origin: 60% 90%;
	}

	.cm.right .sai-body {
		transform-origin: 40% 90%;
	}

	.cm.left.lean .sai-body {
		animation: lean-r 3.2s ease-in-out infinite;
	}

	.cm.right.lean .sai-body {
		animation: lean-l 3.2s ease-in-out infinite;
	}

	.cm.look-l .sai-eyes {
		transform: translateX(-12%);
	}

	.cm.look-r .sai-eyes {
		transform: translateX(12%);
	}

	.cm.speaking {
		z-index: 5;
	}

	.cm.center.speaking {
		transform: translateX(-50%) scale(1.06);
	}

	.cm.left.speaking,
	.cm.right.speaking {
		transform: scale(1.06);
	}

	.cm.nod .sai-body {
		animation: nod 0.5s ease-in-out 2;
	}

	.cbubble {
		position: absolute;
		z-index: 8;
		border-radius: 15px;
		background: #fff;
		color: #2c2638;
		padding: 9px 13px;
		font-size: 13.5px;
		font-weight: 700;
		line-height: 1.35;
		white-space: nowrap;
		opacity: 0;
		pointer-events: none;
		box-shadow: 0 8px 22px rgba(120, 90, 200, 0.18);
		transform: scale(0.7) translateY(6px);
		transform-origin: bottom center;
		transition:
			opacity 0.3s ease,
			transform 0.42s cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	.cbubble.show {
		opacity: 1;
		transform: scale(1) translateY(0);
	}

	.cbubble::after {
		position: absolute;
		bottom: -5px;
		width: 12px;
		height: 12px;
		border-radius: 2px;
		background: #fff;
		content: '';
		transform: rotate(45deg);
	}

	.cbubble .em {
		background: var(--brand);
		background-clip: text;
		color: transparent;
	}

	.cbubble.b-center {
		top: -2px;
		left: 50%;
		transform: translateX(-50%) scale(0.7) translateY(6px);
	}

	.cbubble.b-center.show {
		transform: translateX(-50%) scale(1) translateY(0);
	}

	.cbubble.b-center::after {
		left: 50%;
		margin-left: -6px;
	}

	.cbubble.b-left {
		top: 64px;
		left: 70px;
	}

	.cbubble.b-left::after {
		left: 22px;
	}

	.cbubble.b-right {
		top: 64px;
		right: 70px;
	}

	.cbubble.b-right::after {
		right: 22px;
	}

	.huddle-dots {
		position: absolute;
		top: 150px;
		left: 50%;
		z-index: 1;
		display: flex;
		gap: 5px;
		transform: translateX(-50%);
	}

	.huddle-dots i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--violet);
		opacity: 0.35;
		animation: huddle-dot 1.4s ease-in-out infinite;
	}

	.huddle-dots i:nth-child(2) {
		animation-delay: 0.2s;
	}

	.huddle-dots i:nth-child(3) {
		animation-delay: 0.4s;
	}

	.huddle-glow {
		position: absolute;
		top: 168px;
		left: 50%;
		z-index: 0;
		width: 200px;
		height: 46px;
		border-radius: 50%;
		background: radial-gradient(ellipse, rgba(180, 94, 232, 0.18), transparent 70%);
		filter: blur(4px);
		transform: translateX(-50%);
	}

	.loading-phase {
		justify-content: center;
		color: var(--violet);
	}

	.loading-phase span {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--violet);
		animation: loading-pip 1s ease-in-out infinite;
	}

	.generating-screen .question-block {
		text-align: center;
	}

	.generating-screen h1 b {
		background: var(--brand);
		background-clip: text;
		color: transparent;
	}

	.results-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.hostdock {
		display: flex;
		align-items: flex-end;
		gap: 12px;
	}

	.result-mascot {
		width: 78px;
		height: 78px;
		flex: 0 0 auto;
	}

	.said {
		position: relative;
		flex: 1;
		border: 1px solid rgba(236, 231, 243, 0.92);
		border-radius: 18px;
		background: #fff;
		padding: 11px 13px;
		color: var(--ink2);
		font-size: 13px;
		font-weight: 800;
		line-height: 1.45;
		box-shadow: 0 8px 22px rgba(120, 110, 160, 0.1);
	}

	.said .nm {
		display: block;
		margin-bottom: 2px;
		background: var(--brand);
		background-clip: text;
		color: transparent;
		font-size: 12px;
		font-weight: 900;
	}

	.budget {
		border-radius: 20px;
		background: var(--card);
		padding: 13px 15px;
		margin-top: 14px;
		box-shadow: var(--soft);
	}

	.budget .bl {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 9px;
		color: var(--muted);
		font-size: 13px;
		font-weight: 700;
		white-space: nowrap;
	}

	.budget .bl b {
		background: var(--brand);
		background-clip: text;
		color: transparent;
		font-size: 16px;
	}

	.budget .meter {
		overflow: hidden;
		height: 11px;
		border-radius: 999px;
		background: #f0ecf8;
	}

	.budget .meter i {
		display: block;
		width: 0;
		height: 100%;
		border-radius: inherit;
		background: var(--brand);
		transition: width 1.1s cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.budget.over .meter i {
		background: linear-gradient(90deg, #ff8a5e, #ff4d4d);
	}

	.recommendation-list {
		display: grid;
		gap: 14px;
		padding-bottom: 0;
	}

	.rec-card {
		display: grid;
		gap: 12px;
		padding: 16px;
		animation: fade-up 420ms ease both;
		animation-delay: var(--delay);
	}

	.card-picker {
		gap: 10px;
	}

	.course {
		width: 100%;
		overflow: hidden;
		border: 0;
		border-radius: 20px;
		background: var(--card);
		color: var(--ink);
		margin-top: 4px;
		text-align: left;
		cursor: pointer;
		box-shadow: var(--soft);
		opacity: 0;
		transform: translateY(14px);
		transition: transform 0.2s;
	}

	.course.in {
		animation: msgin 0.5s ease forwards;
		animation-delay: var(--delay);
	}

	.course:active {
		transform: scale(0.985);
	}

	.course:focus-visible {
		outline: 3px solid rgba(91, 108, 255, 0.22);
		outline-offset: 3px;
	}

	.course .ph {
		display: grid;
		place-items: center;
		width: 100%;
		height: 130px;
		background:
			linear-gradient(
				135deg,
				rgba(255, 107, 94, 0.95),
				rgba(180, 94, 232, 0.88) 55%,
				rgba(91, 108, 255, 0.95)
			),
			#f8f6fb;
		color: rgba(255, 255, 255, 0.92);
		font-size: 24px;
		font-weight: 900;
	}

	.course .ph.tone-2 {
		background: linear-gradient(135deg, #5b6cff, #6fcf97);
	}

	.course .ph.tone-3 {
		background: linear-gradient(135deg, #ff6b5e, #f4b860);
	}

	.course .ph.tone-4 {
		background: linear-gradient(135deg, #211c2b, #b45ee8);
	}

	.course .ph img {
		width: 100%;
		height: 130px;
		object-fit: cover;
	}

	.course .ci {
		padding: 14px 16px;
	}

	.course .price {
		float: right;
		color: var(--ink);
		font-size: 16px;
		font-weight: 800;
	}

	.course .slot-l {
		color: var(--violet);
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.03em;
	}

	.course .slot-l.a {
		color: var(--coral);
	}

	.course .slot-l.b {
		color: var(--indigo);
	}

	.course .slot-l.s {
		color: var(--violet);
	}

	.course .nm {
		margin: 3px 0 9px;
		color: var(--ink);
		font-size: 17px;
		font-weight: 800;
		line-height: 1.28;
		letter-spacing: 0;
	}

	.course .meta {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.badge {
		border-radius: 999px;
		background: rgba(255, 107, 94, 0.12);
		color: var(--coral);
		padding: 5px 10px;
		font-size: 11px;
		font-weight: 700;
	}

	.badge.b {
		background: rgba(91, 108, 255, 0.12);
		color: var(--indigo);
	}

	.badge.w {
		background: rgba(180, 94, 232, 0.12);
		color: var(--violet);
	}

	.summary-title-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 10px;
		align-items: start;
	}

	.summary-title-row h2 {
		min-width: 0;
		line-height: 1.25;
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

	.deeplink-row {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--muted);
		font-size: 12px;
		font-weight: 800;
		margin-top: 10px;
	}

	.recommendation-detail {
		gap: 16px;
		margin-bottom: 18px;
	}

	.empty-detail {
		align-content: center;
		min-height: 240px;
	}

	.detail-visual-grid {
		display: grid;
		grid-template-columns: 1.25fr 0.75fr;
		grid-auto-rows: 112px;
		gap: 8px;
	}

	.detail-visual-card {
		position: relative;
		display: block;
		overflow: hidden;
		border: 1px solid rgba(236, 231, 243, 0.9);
		border-radius: 18px;
		background: #f8f6fb;
		color: #fff;
		padding: 0;
		text-decoration: none;
		cursor: pointer;
	}

	.detail-visual-card:first-child {
		grid-row: span 2;
	}

	.detail-visual-card img,
	.detail-visual-placeholder {
		width: 100%;
		height: 100%;
		display: grid;
		place-items: center;
		object-fit: cover;
	}

	.detail-visual-placeholder,
	.course-thumb-fallback {
		background:
			linear-gradient(
				135deg,
				rgba(255, 107, 94, 0.95),
				rgba(180, 94, 232, 0.9) 55%,
				rgba(91, 108, 255, 0.95)
			),
			#f8f6fb;
		color: rgba(255, 255, 255, 0.92);
		font-size: 18px;
		font-weight: 900;
	}

	.detail-visual-card.tone-2 .detail-visual-placeholder,
	.course-thumb-fallback.tone-2 {
		background: linear-gradient(135deg, #5b6cff, #6fcf97);
	}

	.detail-visual-card.tone-3 .detail-visual-placeholder,
	.course-thumb-fallback.tone-3 {
		background: linear-gradient(135deg, #ff6b5e, #f4b860);
	}

	.detail-visual-card.tone-4 .detail-visual-placeholder,
	.course-thumb-fallback.tone-4 {
		background: linear-gradient(135deg, #211c2b, #b45ee8);
	}

	.detail-visual-caption {
		position: absolute;
		right: 8px;
		bottom: 8px;
		left: 8px;
		display: grid;
		gap: 2px;
		border-radius: 14px;
		background: rgba(32, 28, 44, 0.68);
		padding: 8px 10px;
		backdrop-filter: blur(10px);
	}

	.detail-visual-caption strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.detail-visual-caption strong {
		font-size: 13px;
		font-weight: 900;
	}

	.detail-facts {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 7px;
	}

	.detail-facts div {
		display: grid;
		gap: 4px;
		min-width: 0;
		min-height: 62px;
		align-content: center;
		border-radius: 14px;
		background: #faf8fc;
		padding: 9px;
	}

	.detail-facts span {
		color: var(--muted);
		font-size: 11px;
		font-weight: 900;
	}

	.detail-facts strong {
		overflow: hidden;
		color: var(--ink);
		font-size: 13px;
		font-weight: 900;
		line-height: 1.2;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.route-map-panel {
		display: grid;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: #f8f6fb;
	}

	.route-map-frame,
	.route-map-fallback {
		width: 100%;
		height: 210px;
		border: 0;
	}

	.route-map-fallback {
		display: grid;
		place-items: center;
		align-content: center;
		gap: 6px;
		padding: 18px;
		text-align: center;
	}

	.route-map-fallback strong {
		color: var(--ink);
		font-size: 18px;
	}

	.route-map-fallback span {
		color: var(--muted);
		font-size: 13px;
		font-weight: 800;
	}

	.route-summary-row {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 8px;
		align-items: center;
		border-top: 1px solid var(--line);
		background: #fff;
		padding: 10px 12px;
	}

	.route-summary-row span {
		border-radius: 999px;
		background: rgba(108, 113, 245, 0.12);
		color: var(--indigo);
		padding: 5px 8px;
		font-size: 12px;
		font-weight: 900;
	}

	.route-summary-row strong {
		min-width: 0;
		color: var(--ink);
		font-size: 13px;
		line-height: 1.35;
	}

	.why {
		border-left: 4px solid var(--coral);
		border-radius: 10px;
		background: rgba(255, 107, 94, 0.08);
		padding: 10px 12px;
		color: var(--ink2);
	}

	.budget-note {
		display: grid;
		gap: 4px;
		min-height: 48px;
		align-content: center;
		border-radius: 12px;
		background: rgba(97, 176, 126, 0.12);
		color: #28764e;
		padding: 9px 12px;
		font-size: 13px;
		font-weight: 900;
	}

	.budget-note span {
		font-size: 11px;
	}

	.budget-note strong {
		font-size: 13px;
		line-height: 1.35;
	}

	.course-items {
		display: grid;
		gap: 10px;
	}

	.course-item {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 10px;
		align-items: start;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: #fff;
		padding: 10px;
		color: var(--ink);
	}

	.course-item.has-thumb {
		grid-template-columns: 82px minmax(0, 1fr) auto;
	}

	.course-thumb {
		width: 82px;
		height: 82px;
		border-radius: 14px;
		object-fit: cover;
		background: #f8f6fb;
	}

	.course-item-main {
		display: grid;
		gap: 4px;
		min-width: 0;
	}

	.course-items strong {
		font-size: 13px;
		line-height: 1.3;
	}

	.course-item-main span {
		color: var(--muted);
		font-size: 12px;
		font-weight: 900;
	}

	.item-actions,
	.execution-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.item-actions {
		grid-column: 1 / -1;
	}

	.item-actions button {
		border: 1px solid var(--line);
		border-radius: 999px;
		background: #fff;
		color: var(--ink);
		padding: 7px 10px;
		font-size: 12px;
		font-weight: 900;
		text-decoration: none;
		cursor: pointer;
	}

	.item-actions button.primary {
		border-color: transparent;
		background: linear-gradient(90deg, var(--coral), var(--violet) 55%, var(--indigo));
		color: #fff;
	}

	.execution-actions .link-button {
		flex: 1 1 120px;
	}

	.detail-primary-actions .link-button {
		min-height: 44px;
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
		border-radius: 18px;
		background: #f8f5fb;
		padding: 6px;
	}

	.feedback-bar button {
		min-height: 44px;
		border-color: transparent;
		border-radius: 14px;
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

	.external-sheet {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: flex;
		align-items: flex-end;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.3s ease;
	}

	.sheet-backdrop {
		position: absolute;
		inset: 0;
		border: 0;
		background: rgba(33, 28, 43, 0.42);
		backdrop-filter: blur(3px);
	}

	.external-sheet.open {
		opacity: 1;
		pointer-events: auto;
	}

	.external-sheet .panel {
		position: relative;
		z-index: 1;
		display: grid;
		gap: 12px;
		width: 100%;
		border-radius: 26px 26px 0 0;
		background: #fff;
		padding: 22px;
		transform: translateY(100%);
		transition: transform 0.36s cubic-bezier(0.2, 0.9, 0.2, 1);
	}

	.external-sheet.open .panel {
		transform: none;
	}

	.external-sheet .grab {
		width: 40px;
		height: 4px;
		border-radius: 4px;
		background: #e3dcec;
		margin: 0 auto 4px;
	}

	.external-sheet .ext {
		color: var(--muted);
		font-size: 12px;
		font-weight: 900;
		letter-spacing: 0.04em;
	}

	.external-sheet h3 {
		color: var(--ink);
		font-size: 20px;
		line-height: 1.28;
	}

	.external-sheet p {
		color: var(--muted);
		font-size: 14px;
		font-weight: 800;
		line-height: 1.5;
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

	@keyframes listen-ring {
		0% {
			opacity: 0.78;
			transform: scale(0.76);
		}
		100% {
			opacity: 0;
			transform: scale(1.28);
		}
	}

	@keyframes listening-float {
		0%,
		100% {
			transform: translateY(0) scale(1);
		}
		50% {
			transform: translateY(-5px) scale(1.025);
		}
	}

	@keyframes talking-bounce {
		0%,
		100% {
			transform: translateY(0) scale(1);
		}
		50% {
			transform: translateY(-3px) scale(1.018);
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

	@keyframes loading-pip {
		0%,
		100% {
			opacity: 0.3;
		}
		50% {
			opacity: 1;
		}
	}

	@keyframes huddle-dot {
		0%,
		100% {
			opacity: 0.25;
			transform: translateY(0);
		}
		50% {
			opacity: 0.7;
			transform: translateY(-5px);
		}
	}

	@keyframes sai-bob {
		0%,
		100% {
			transform: translateY(0) rotate(0);
		}
		50% {
			transform: translateY(-5%) rotate(-1.2deg);
		}
	}

	@keyframes sai-blink {
		0%,
		6%,
		100% {
			transform: scaleY(1);
		}
		3% {
			transform: scaleY(0.1);
		}
	}

	@keyframes sai-ring {
		0% {
			opacity: 0.9;
			transform: scale(0.7);
		}
		100% {
			opacity: 0;
			transform: scale(1.35);
		}
	}

	@keyframes sai-tilt {
		0%,
		100% {
			transform: rotate(-3deg);
		}
		50% {
			transform: rotate(3deg);
		}
	}

	@keyframes sai-pop {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.12);
		}
	}

	@keyframes sai-talk {
		0%,
		100% {
			width: 18%;
			height: 7%;
			border-radius: 0 0 60px 60px;
		}
		50% {
			width: 22%;
			height: 15%;
			border-radius: 0 0 40px 40px;
		}
	}

	@keyframes sai-bead {
		0%,
		100% {
			box-shadow: 0 0 0 0 rgba(91, 108, 255, 0.5);
		}
		50% {
			box-shadow: 0 0 0 7px rgba(91, 108, 255, 0);
		}
	}

	@keyframes lean-r {
		0%,
		100% {
			transform: rotate(4deg) translateY(0);
		}
		50% {
			transform: rotate(7deg) translateY(-3%);
		}
	}

	@keyframes lean-l {
		0%,
		100% {
			transform: rotate(-4deg) translateY(0);
		}
		50% {
			transform: rotate(-7deg) translateY(-3%);
		}
	}

	@keyframes nod {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(8%) rotate(0);
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

	@keyframes msgin {
		to {
			opacity: 1;
			transform: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		* {
			animation-duration: 1ms !important;
			animation-iteration-count: 1 !important;
			scroll-behavior: auto !important;
		}
	}

	@media (max-width: 520px) {
		.app-frame {
			align-items: stretch;
			padding: 0;
		}

		.phone-shell {
			width: 100%;
			height: auto;
			min-height: 100dvh;
			border: 0;
			border-radius: 0;
			box-shadow: none;
		}
	}

	@media (max-width: 360px) {
		.phone-shell {
			padding-left: 14px;
			padding-right: 14px;
		}

		.home-hero {
			grid-template-columns: 1fr;
			text-align: center;
			justify-items: center;
		}

		.course-item {
			grid-template-columns: 1fr;
		}

		.course-item.has-thumb {
			grid-template-columns: 56px minmax(0, 1fr);
		}

		.course-thumb {
			width: 56px;
			height: 56px;
		}
	}
</style>
