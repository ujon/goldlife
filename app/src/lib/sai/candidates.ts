export type ProviderName = 'genrank' | 'myrealtrip' | 'api_fuse' | 'swing';

export type ProviderStatus = {
	provider: ProviderName;
	configured: boolean;
	ok: boolean;
	fallbackReason?: string;
};

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
	mode?: 'walk' | 'transit' | 'car' | 'taxi' | 'shared';
	routeMapUrl?: string;
	detail?: string;
	source: 'swing' | 'api_fuse' | 'sai';
};

export type CandidateBundle = {
	weather: WeatherCandidate;
	trendKeywords: string[];
	activities: ActivityCandidate[];
	restaurants: RestaurantCandidate[];
	mobility: MobilityCandidate[];
	statuses: ProviderStatus[];
};
