import { env } from '$env/dynamic/private';
import {
	buildFollowupQuestions,
	companionContextText,
	companionRelationPromptGuide,
	companionRelationSummary
} from '$lib/sai/recommendations';
import type {
	FollowupQuestion,
	RecommendationHistoryItem,
	RecommendationSession,
	UserProfile
} from '$lib/sai/types';
import { loggedFetch } from './integration-logger';

export type FollowupResult = {
	questions: FollowupQuestion[];
	source: 'exaone' | 'openai' | 'fallback';
	model?: string;
	fallbackReason?: string;
};

type ResponsesPayload = {
	output_text?: string;
	output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};

type ChatPayload = {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
};

export async function generateFollowups(
	profile: UserProfile,
	session: RecommendationSession,
	histories: RecommendationHistoryItem[] = []
): Promise<FollowupResult> {
	const fallback = buildFollowupQuestions(session, profile);

	const exaone = await tryExaoneFollowups(profile, session, histories, fallback);
	if (exaone) return exaone;

	const openai = await tryOpenAIFollowups(profile, session, histories, fallback);
	if (openai) return openai;

	return {
		questions: fallback,
		source: 'fallback',
		fallbackReason: 'AI provider is not configured'
	};
}

async function tryExaoneFollowups(
	profile: UserProfile,
	session: RecommendationSession,
	histories: RecommendationHistoryItem[],
	fallback: FollowupQuestion[]
): Promise<FollowupResult | null> {
	if (!env.EXAONE_API_KEY || !env.EXAONE_BASE_URL) return null;
	const model = env.EXAONE_MODEL || 'LGAI-EXAONE/K-EXAONE-236B-A23B';

	try {
		const response = await loggedFetch({
			provider: 'exaone',
			kind: 'ai',
			operation: 'followups.generate',
			url: `${env.EXAONE_BASE_URL.replace(/\/$/, '')}/chat/completions`,
			init: {
				method: 'POST',
				headers: {
					authorization: `Bearer ${env.EXAONE_API_KEY}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					model,
					messages: [
						{
							role: 'system',
							content:
								'사이(SAI)의 귀여운 한국어 코치다. 추천 전 추가 질문 1-2개만 JSON으로 만든다. 시간, 예산, MBTI, 이미 받은 온보딩 자유 문장 답변과 동행 제약은 다시 묻지 않는다. companionRelations가 여러 개면 관계별 우선순위를 가볍게 확인하되 이미 선택한 관계 자체는 다시 묻지 않는다.'
						},
						{
							role: 'user',
							content: JSON.stringify({
								profile,
								session,
								companionSummary: companionRelationSummary(session),
								companionContext: companionContextText(session),
								companionGuide: companionRelationPromptGuide(session),
								histories: summarizeHistories(histories),
								fallback
							})
						}
					],
					response_format: { type: 'json_object' },
					chat_template_kwargs: { enable_thinking: false },
					parse_reasoning: true,
					include_reasoning: false,
					temperature: 0,
					max_tokens: 700
				}),
				signal: AbortSignal.timeout(8000)
			}
		});
		if (!response.ok) throw new Error(`EXAONE ${response.status}`);

		const payload = (await response.json()) as ChatPayload;
		const text = payload.choices?.[0]?.message?.content ?? '';
		const questions = normalizeQuestions(text ? JSON.parse(text) : null, fallback);

		return {
			questions,
			source: 'exaone',
			model
		};
	} catch {
		return null;
	}
}

async function tryOpenAIFollowups(
	profile: UserProfile,
	session: RecommendationSession,
	histories: RecommendationHistoryItem[],
	fallback: FollowupQuestion[]
): Promise<FollowupResult | null> {
	if (!env.OPENAI_API_KEY) return null;
	const model = env.OPENAI_MODEL || 'gpt-5.4-mini';

	try {
		const response = await loggedFetch({
			provider: 'openai',
			kind: 'ai',
			operation: 'followups.generate',
			url: 'https://api.openai.com/v1/responses',
			init: {
				method: 'POST',
				headers: {
					authorization: `Bearer ${env.OPENAI_API_KEY}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					model,
					input: [
						{
							role: 'system',
							content: [
								{
									type: 'input_text',
									text: [
										'사이(SAI)의 추천 전 동적 추가 질문 생성기다.',
										'질문은 1-2개만 만든다.',
										'시간과 총 예산, MBTI는 이미 받았으므로 절대 다시 묻지 않는다.',
										'profile.onboardingFreeformAnswers에 있는 온보딩 자유 문장 답변도 이미 받은 취향으로 보고 반복해서 묻지 않는다.',
										'상황, 아기 동반 여부, 핵심 아기 편의도 이미 받았으므로 다시 묻지 말고 세부 조건만 보강한다.',
										'companionRelations가 여러 개면 엄마/친구/아내/아이 등 관계별 만족 포인트의 우선순위를 묻는다. 이미 고른 관계를 다시 묻지는 않는다.',
										'짧고 친근한 반말 톤을 사용한다.'
									].join('\n')
								}
							]
						},
						{
							role: 'user',
							content: [
								{
									type: 'input_text',
									text: JSON.stringify({
										profile,
										session,
										companionSummary: companionRelationSummary(session),
										companionContext: companionContextText(session),
										companionGuide: companionRelationPromptGuide(session),
										histories: summarizeHistories(histories),
										fallback
									})
								}
							]
						}
					],
					text: {
						format: {
							type: 'json_schema',
							name: 'sai_followups',
							strict: true,
							schema: followupSchema()
						}
					}
				}),
				signal: AbortSignal.timeout(8000)
			}
		});
		if (!response.ok) throw new Error(`OpenAI ${response.status}`);

		const payload = (await response.json()) as ResponsesPayload;
		const text = extractOutputText(payload);
		const questions = normalizeQuestions(text ? JSON.parse(text) : null, fallback);

		return {
			questions,
			source: 'openai',
			model
		};
	} catch {
		return null;
	}
}

function normalizeQuestions(value: unknown, fallback: FollowupQuestion[]) {
	const source = value as { questions?: FollowupQuestion[] } | FollowupQuestion[] | null;
	const questions = Array.isArray(source) ? source : source?.questions;
	const normalized = (questions ?? []).filter(isValidQuestion).slice(0, 2);
	return normalized.length ? normalized : fallback;
}

function summarizeHistories(histories: RecommendationHistoryItem[]) {
	return histories.slice(0, 4).map((history) => ({
		situation: history.session.situation,
		companionSummary: companionRelationSummary(history.session),
		availableTime: history.session.availableTime,
		budgetTotal: history.session.budgetTotal,
		clickedCardIds: history.clickedCardIds,
		likedReasons: history.feedback
			.filter((feedback) => feedback.sentiment === 'like')
			.flatMap((feedback) => feedback.reasons),
		dislikedReasons: history.feedback
			.filter((feedback) => feedback.sentiment === 'dislike')
			.flatMap((feedback) => feedback.reasons)
	}));
}

function isValidQuestion(question: FollowupQuestion) {
	return (
		typeof question.id === 'string' &&
		typeof question.prompt === 'string' &&
		Array.isArray(question.options) &&
		question.options.length >= 2 &&
		question.options.every(
			(option) =>
				typeof option.id === 'string' &&
				typeof option.label === 'string' &&
				typeof option.value === 'string'
		)
	);
}

function extractOutputText(payload: ResponsesPayload) {
	if (payload.output_text) return payload.output_text;
	for (const item of payload.output ?? []) {
		for (const content of item.content ?? []) {
			if (content.type === 'output_text' && content.text) return content.text;
		}
	}
	return '';
}

function followupSchema() {
	const optionSchema = {
		type: 'object',
		additionalProperties: false,
		required: ['id', 'label', 'value'],
		properties: {
			id: { type: 'string' },
			label: { type: 'string' },
			value: { type: 'string' }
		}
	};

	return {
		type: 'object',
		additionalProperties: false,
		required: ['questions'],
		properties: {
			questions: {
				type: 'array',
				minItems: 1,
				maxItems: 2,
				items: {
					type: 'object',
					additionalProperties: false,
					required: ['id', 'prompt', 'options'],
					properties: {
						id: { type: 'string' },
						prompt: { type: 'string' },
						options: {
							type: 'array',
							minItems: 2,
							maxItems: 3,
							items: optionSchema
						}
					}
				}
			}
		}
	};
}
