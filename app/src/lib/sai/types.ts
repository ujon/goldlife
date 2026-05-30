export type AuthMode = 'login' | 'signup';

export type Screen =
	| 'auth'
	| 'location'
	| 'onboarding'
	| 'home'
	| 'situation'
	| 'time'
	| 'budget'
	| 'followup'
	| 'generating'
	| 'results';

export type Situation = 'solo' | 'friend' | 'couple' | 'family' | 'group';

export type LocationValue = {
	mode: 'geo' | 'manual' | 'default';
	label: string;
	lat?: number;
	lng?: number;
};

export type WeatherSnapshot = {
	condition: 'clear' | 'cloudy' | 'rain' | 'dust';
	label: string;
	temperature: number;
	preferIndoor: boolean;
	avoidLongWalk: boolean;
};

export type CompanionConstraints = {
	hasBaby: boolean;
	strollerRequired: boolean;
	babyCarrierOk: boolean;
	needsNursingRoom: boolean;
	needsDiaperChangingRoom: boolean;
	preferParking: boolean;
};

export type UserProfile = {
	userId: string;
	email: string;
	onboardingCompleted: boolean;
	activityPreferences: string[];
	noveltyPreference: string;
	spendingStyle: string;
	riskTolerance: string;
	mobilityPreference: string;
	recentLocation?: LocationValue;
	updatedAt: string;
};

export type RecommendationSession = {
	id: string;
	situation?: Situation;
	location?: LocationValue;
	availableTime?: string;
	customTime?: string;
	budgetTotal?: number;
	weatherSnapshot: WeatherSnapshot;
	dynamicQuestions: FollowupQuestion[];
	dynamicAnswers: Record<string, string>;
	companionConstraints: CompanionConstraints;
	createdAt: string;
};

export type FollowupQuestion = {
	id: string;
	prompt: string;
	options: Array<{
		id: string;
		label: string;
		value: string;
	}>;
};

export type RecommendationItem = {
	slot: 'activity' | 'food' | 'move' | 'fallback';
	title: string;
	price: number;
	source: 'myrealtrip' | 'api_fuse' | 'genrank' | 'sai';
	outboundUrl: string;
};

export type RecommendationCard = {
	id: string;
	label: string;
	title: string;
	reason: string;
	resultType: 'single_activity' | 'mini_course' | 'course' | 'timetable';
	estimatedDuration: string;
	estimatedCost: number;
	budgetText: string;
	perPersonText: string;
	weatherFit: 'indoor' | 'mostly_indoor' | 'outdoor' | 'any';
	routeSummary: string;
	companionFit: string[];
	badges: string[];
	items: RecommendationItem[];
	outboundUrl: string;
};

export type FeedbackRecord = {
	cardId: string;
	sentiment: 'like' | 'dislike';
	reasons: string[];
	createdAt: string;
};

export type RecommendationHistoryItem = {
	session: RecommendationSession;
	cards: RecommendationCard[];
	feedback: FeedbackRecord[];
	clickedCardIds: string[];
	createdAt: string;
};
