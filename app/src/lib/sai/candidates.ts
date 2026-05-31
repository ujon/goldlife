export type ProviderName = 'genrank' | 'myrealtrip' | 'api_fuse' | 'swing';

export type CandidateApiOperationPlan = {
	provider: ProviderName | 'exaone' | 'openai';
	operation: string;
	values: Record<string, string | number | boolean>;
	purpose: string;
};

export type CandidateQueryPlan = {
	source: 'exaone' | 'fallback';
	preferenceSummary: string;
	activityQueries: string[];
	restaurantQueries: string[];
	myrealtripKeywords: string[];
	excludedKeywords: string[];
	operations: CandidateApiOperationPlan[];
};

export type ProviderStatus = {
	provider: ProviderName;
	configured: boolean;
	ok: boolean;
	fallbackReason?: string;
};

export type OperatingStatus = 'open_at_arrival' | 'closed_at_arrival' | 'unknown';

export type ActivityCandidate = {
	id: string;
	title: string;
	price?: number;
	source: 'myrealtrip' | 'genrank' | 'api_fuse' | 'sai';
	outboundUrl?: string;
	reservationUrl?: string;
	mapUrl?: string;
	address?: string;
	lat?: number;
	lng?: number;
	availabilityText?: string;
	travelMinutes?: number;
	travelTimeText?: string;
	travelDistanceMeters?: number;
	routeMapUrl?: string;
	operatingStatus?: OperatingStatus;
	arrivalTimeText?: string;
	openingHoursText?: string;
	thumbnailUrl?: string;
	tags: string[];
	score?: number;
};

export type RestaurantCandidate = {
	id: string;
	title: string;
	price?: number;
	source: 'api_fuse' | 'sai';
	outboundUrl?: string;
	reservationUrl?: string;
	mapUrl?: string;
	address?: string;
	lat?: number;
	lng?: number;
	availabilityText?: string;
	travelMinutes?: number;
	travelTimeText?: string;
	travelDistanceMeters?: number;
	routeMapUrl?: string;
	operatingStatus?: OperatingStatus;
	arrivalTimeText?: string;
	openingHoursText?: string;
	thumbnailUrl?: string;
	tags: string[];
	reservationHint?: string;
};

export type WeatherCandidate = {
	label: string;
	condition: 'clear' | 'cloudy' | 'rain' | 'dust' | 'unknown';
	preferIndoor: boolean;
	temperature?: number;
	source: 'api_fuse' | 'sai';
};

export type MobilityCandidate = {
	label: string;
	minutes?: number;
	cost?: number;
	mode?: 'walk' | 'transit' | 'car' | 'taxi' | 'shared' | 'flight';
	routeMapUrl?: string;
	detail?: string;
	source: 'swing' | 'api_fuse' | 'sai';
};

export type FlightCandidate = {
	id: string;
	title: string;
	price?: number;
	source: 'api_fuse' | 'sai';
	outboundUrl?: string;
	reservationUrl?: string;
	departureAirport: string;
	arrivalAirport: string;
	departureDate?: string;
	returnDate?: string;
	departureTimeText?: string;
	arrivalTimeText?: string;
	durationMinutes?: number;
	durationText?: string;
	airlineText?: string;
	tags: string[];
};

export type CandidateBundle = {
	weather: WeatherCandidate;
	trendKeywords: string[];
	activities: ActivityCandidate[];
	restaurants: RestaurantCandidate[];
	flights: FlightCandidate[];
	mobility: MobilityCandidate[];
	statuses: ProviderStatus[];
	queryPlan?: CandidateQueryPlan;
};
