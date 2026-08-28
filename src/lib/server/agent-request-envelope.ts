import type { RequestEvent } from '@sveltejs/kit';
import { PROMPT_GUARD_MAX_CHARACTERS } from '$lib/core/server/moderation/prompt-guard-budget';
import { BoundedJsonRequestError, readBoundedJsonRequest } from './bounded-json-request';

type JsonRecord = Record<string, unknown>;

type GenerateSubjectRequest = {
	message: string;
	conversationContext?: import('$lib/core/agents/types').ConversationContext;
};

type DecisionMakerRequest = {
	subject_line: string;
	core_message: string;
	topics: string[];
	voice_sample?: string;
	target_type?: string;
	target_entity?: string;
	audience_guidance?: string;
	org_slug?: string;
	verbose?: boolean;
};

type MessageRequest = {
	subject_line: string;
	core_message: string;
	topics?: string[];
	decision_makers?: import('$lib/core/agents').DecisionMaker[];
	voice_sample?: string;
	raw_input?: string;
	template_id?: string;
	job_id?: string;
	input_hash?: string;
	recovery_public_key_jwk?: JsonWebKey;
	geographic_scope?: {
		type: 'international' | 'nationwide' | 'subnational';
		country?: string;
		subdivision?: string;
		locality?: string;
	};
	verbose?: boolean;
};

type AgentRequestEnvelopeMap = {
	'message-job': { jobId: string };
	'stream-decision-makers': DecisionMakerRequest;
	'stream-message': MessageRequest;
	'stream-subject': GenerateSubjectRequest;
	'trace-replay': { cursor?: string; traceId: string };
};

type ProviderAgentRoute = 'stream-decision-makers' | 'stream-message' | 'stream-subject';

type AgentRequestEvent = Pick<RequestEvent, 'params' | 'request' | 'url'>;

const BODY_LIMITS = Object.freeze({
	'stream-decision-makers': 48 * 1024,
	'stream-message': 96 * 1024,
	'stream-subject': 64 * 1024
});
const SHA256_HEX_RE = /^[a-f0-9]{64}$/u;
// Org context the caller declares for billing. A lookup key, never prose.
const ORG_SLUG_RE = Object.freeze(/^[a-z0-9][a-z0-9-]{0,127}$/u);
const ROUTE_IDENTIFIER_RE = /^[A-Za-z0-9:_-]+$/u;

class AgentRequestValidationError extends Error {}

function fail(message: string): never {
	throw new AgentRequestValidationError(message);
}

function record(value: unknown, message = 'Invalid request body'): JsonRecord {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(message);
	return value as JsonRecord;
}

function requiredString(
	value: unknown,
	maxLength: number,
	message: string,
	options: { trim?: boolean } = {}
): string {
	if (typeof value !== 'string' || (options.trim !== false && value.trim().length === 0))
		fail(message);
	if (value.length > maxLength) fail(message);
	return value;
}

function optionalString(value: unknown, maxLength: number, message: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || value.length > maxLength) fail(message);
	return value;
}

function optionalBoolean(value: unknown, message: string): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'boolean') fail(message);
	return value;
}

function boundedStringRecord(
	value: unknown,
	options: { maxEntries: number; maxKeyLength: number; maxValueLength: number },
	message: string
): Record<string, string> {
	const object = record(value, message);
	const entries = Object.entries(object);
	if (entries.length > options.maxEntries) fail(message);
	for (const [key, answer] of entries) {
		if (
			key.length === 0 ||
			key.length > options.maxKeyLength ||
			typeof answer !== 'string' ||
			answer.length > options.maxValueLength
		) {
			fail(message);
		}
	}
	return object as Record<string, string>;
}

function validateInferredContext(value: unknown): void {
	const context = record(value, 'Invalid conversation context');
	for (const field of [
		'detected_location',
		'detected_scope',
		'detected_target_type',
		'detected_urgency'
	]) {
		const candidate = context[field];
		if (candidate !== undefined && candidate !== null) {
			optionalString(candidate, 512, 'Conversation context contains an oversized inferred value');
		}
	}
	const ask = context.detected_ask;
	if (ask !== undefined && ask !== null) {
		optionalString(ask, 2_000, 'Conversation context contains an oversized inferred value');
	}
	optionalString(context.reasoning, 4_000, 'Conversation context reasoning is too long');
	for (const field of [
		'location_confidence',
		'scope_confidence',
		'target_type_confidence',
		'urgency_confidence'
	]) {
		const candidate = context[field];
		if (
			candidate !== undefined &&
			(typeof candidate !== 'number' ||
				!Number.isFinite(candidate) ||
				candidate < 0 ||
				candidate > 1)
		) {
			fail('Invalid conversation context confidence');
		}
	}
}

function validateClarificationQuestion(value: unknown): void {
	const question = record(value, 'Invalid clarification question');
	requiredString(question.id, 128, 'Invalid clarification question id');
	requiredString(question.question, 1_000, 'Clarification question is too long');
	const type = requiredString(question.type, 32, 'Invalid clarification question type');
	if (!['location_picker', 'open_text', 'multiple_choice'].includes(type)) {
		fail('Invalid clarification question type');
	}
	if (typeof question.required !== 'boolean') fail('Invalid clarification question requirement');
	optionalString(question.placeholder, 500, 'Clarification placeholder is too long');
	optionalString(question.prefilled_location, 256, 'Clarification location is too long');
	optionalString(question.location_level, 32, 'Invalid clarification location level');
	optionalBoolean(question.allow_other, 'Invalid clarification allow_other value');

	if (question.suggested_locations !== undefined) {
		if (!Array.isArray(question.suggested_locations) || question.suggested_locations.length > 10) {
			fail('Too many suggested clarification locations');
		}
		for (const location of question.suggested_locations) {
			requiredString(location, 256, 'Clarification location is too long', { trim: false });
		}
	}
	if (question.options !== undefined) {
		if (!Array.isArray(question.options) || question.options.length > 12) {
			fail('Too many clarification options');
		}
		for (const optionValue of question.options) {
			const option = record(optionValue, 'Invalid clarification option');
			requiredString(option.id, 128, 'Invalid clarification option id');
			requiredString(option.label, 512, 'Clarification option label is too long');
		}
	}
}

function validateConversationContext(value: unknown): void {
	const context = record(value, 'Invalid conversation context');
	requiredString(
		context.originalDescription,
		16_000,
		'Conversation context description is too long'
	);
	if (!Array.isArray(context.questionsAsked) || context.questionsAsked.length > 12) {
		fail('Too many clarification questions');
	}
	for (const question of context.questionsAsked) validateClarificationQuestion(question);
	validateInferredContext(context.inferredContext);
	boundedStringRecord(
		context.answers,
		{ maxEntries: 12, maxKeyLength: 128, maxValueLength: 4_000 },
		'Clarification answers exceed the request budget'
	);
}

function validateSubjectRequest(value: unknown): GenerateSubjectRequest {
	const body = record(value);
	requiredString(body.message, 16_000, 'Message is required');
	if (body.conversationContext !== undefined) validateConversationContext(body.conversationContext);
	return body as GenerateSubjectRequest;
}

function validateTopics(value: unknown, required: boolean): string[] | undefined {
	if (value === undefined && !required) return undefined;
	if (!Array.isArray(value) || (required && value.length === 0)) {
		fail(required ? 'At least one topic is required' : 'Invalid topics');
	}
	if (value.length > 20) fail('Too many topics');
	for (const topic of value) requiredString(topic, 64, 'Topic exceeds maximum length');
	return value as string[];
}

function validateDecisionMakerRequest(value: unknown): DecisionMakerRequest {
	const body = record(value);
	requiredString(body.subject_line, 200, 'Subject line is required');
	requiredString(body.core_message, 16_000, 'Core message is required');
	validateTopics(body.topics, true);
	optionalString(body.voice_sample, 16_000, 'Voice sample exceeds maximum length');
	optionalString(body.target_type, 128, 'Target type exceeds maximum length');
	optionalString(body.target_entity, 512, 'Target entity exceeds maximum length');
	optionalString(body.audience_guidance, 4_000, 'Audience guidance exceeds maximum length');
	const orgSlug = optionalString(body.org_slug, 128, 'Org slug exceeds maximum length');
	if (orgSlug !== undefined && !ORG_SLUG_RE.test(orgSlug)) fail('Invalid org slug');
	optionalBoolean(body.verbose, 'Invalid verbose value');
	return body as DecisionMakerRequest;
}

const DECISION_MAKER_FIELD_LIMITS: Readonly<Record<string, number>> = Object.freeze({
	accountabilityOpener: 4_000,
	contactChannel: 128,
	contactNotes: 4_000,
	deliveryTier: 8,
	email: 320,
	emailSource: 2_048,
	emailSourceTitle: 512,
	name: 256,
	organization: 512,
	personalPrompt: 4_000,
	provenance: 2_048,
	publicRecipientProvenance: 4_096,
	reasoning: 4_000,
	roleCategory: 128,
	seatRoute: 2_048,
	source_url: 2_048,
	sourceUrl: 2_048,
	title: 512
});

function validateDecisionMakers(value: unknown): void {
	if (value === undefined) return;
	if (!Array.isArray(value) || value.length > 20) fail('Too many decision makers');
	for (const candidate of value) {
		const decisionMaker = record(candidate, 'Invalid decision maker');
		requiredString(decisionMaker.name, 256, 'Decision maker name exceeds maximum length');
		requiredString(decisionMaker.title, 512, 'Decision maker title exceeds maximum length');
		requiredString(
			decisionMaker.organization,
			512,
			'Decision maker organization exceeds maximum length'
		);
		for (const [field, fieldValue] of Object.entries(decisionMaker)) {
			if (typeof fieldValue === 'string') {
				const limit = DECISION_MAKER_FIELD_LIMITS[field] ?? 2_048;
				if (fieldValue.length > limit) fail(`Decision maker ${field} exceeds maximum length`);
			}
		}
	}
}

function validateGeographicScope(value: unknown): void {
	if (value === undefined) return;
	const scope = record(value, 'Invalid geographic scope');
	const type = requiredString(scope.type, 32, 'Invalid geographic scope');
	if (!['international', 'nationwide', 'subnational'].includes(type)) {
		fail('Invalid geographic scope');
	}
	optionalString(scope.country, 64, 'Geographic country exceeds maximum length');
	optionalString(scope.subdivision, 128, 'Geographic subdivision exceeds maximum length');
	optionalString(scope.locality, 256, 'Geographic locality exceeds maximum length');
}

function validateRecoveryKey(value: unknown): void {
	if (value === undefined) return;
	const key = record(value, 'Invalid recovery public key');
	if (key.kty !== 'RSA') fail('Invalid recovery public key');
	requiredString(key.n, 2_048, 'Invalid recovery public key');
	requiredString(key.e, 16, 'Invalid recovery public key');
	optionalString(key.alg, 64, 'Invalid recovery public key');
	optionalString(key.kid, 256, 'Invalid recovery public key');
	if (key.ext !== undefined && typeof key.ext !== 'boolean') fail('Invalid recovery public key');
	if (key.key_ops !== undefined) {
		if (!Array.isArray(key.key_ops) || key.key_ops.length > 8) fail('Invalid recovery public key');
		for (const operation of key.key_ops) {
			requiredString(operation, 32, 'Invalid recovery public key');
		}
	}
}

function validateMessageRequest(value: unknown): MessageRequest {
	const body = record(value);
	if (typeof body.subject_line !== 'string' || typeof body.core_message !== 'string') {
		fail('Subject line and core message are required');
	}
	requiredString(body.subject_line, 200, 'Input field exceeds maximum length');
	requiredString(body.core_message, 16_000, 'Input field exceeds maximum length');
	validateTopics(body.topics, false);
	validateDecisionMakers(body.decision_makers);
	optionalString(body.voice_sample, 16_000, 'Input field exceeds maximum length');
	optionalString(body.raw_input, 16_000, 'Input field exceeds maximum length');
	optionalString(body.template_id, 128, 'Invalid template id');
	optionalString(body.job_id, 128, 'Invalid message generation job handle');
	const inputHash = optionalString(body.input_hash, 64, 'Invalid message generation job handle');
	if (inputHash !== undefined && !SHA256_HEX_RE.test(inputHash)) {
		fail('Invalid message generation job handle');
	}
	validateRecoveryKey(body.recovery_public_key_jwk);
	validateGeographicScope(body.geographic_scope);
	optionalBoolean(body.verbose, 'Invalid verbose value');

	const recoveryFields = [body.job_id, body.input_hash, body.recovery_public_key_jwk];
	const supplied = recoveryFields.filter((candidate) => candidate !== undefined).length;
	if (supplied !== 0 && supplied !== recoveryFields.length) {
		fail('job_id, input_hash, and recovery_public_key_jwk are required together');
	}
	return body as MessageRequest;
}

function promptParts(): {
	add: (value: unknown) => void;
	content: () => string;
} {
	const parts: string[] = [];
	const seen = new Set<string>();
	return {
		add(value: unknown) {
			if (typeof value !== 'string' || value.length === 0 || seen.has(value)) return;
			seen.add(value);
			parts.push(value);
		},
		content: () => parts.join('\n')
	};
}

function addStringRecord(
	add: (value: unknown) => void,
	value: Record<string, string> | undefined
): void {
	if (!value) return;
	for (const [key, answer] of Object.entries(value)) {
		add(key);
		add(answer);
	}
}

/**
 * Exact untrusted text surface sent to Prompt Guard and, after approval, to an
 * agent provider. Its aggregate length is enforced by readBoundedAgentRequest.
 */
export function agentPromptGuardContent(
	route: ProviderAgentRoute,
	request: GenerateSubjectRequest | DecisionMakerRequest | MessageRequest
): string {
	const parts = promptParts();
	if (route === 'stream-subject') {
		const subject = request as GenerateSubjectRequest;
		parts.add(subject.message);
		const context = subject.conversationContext;
		if (context) {
			parts.add(context.originalDescription);
			for (const question of context.questionsAsked) {
				parts.add(question.id);
				parts.add(question.question);
				parts.add(question.placeholder);
				parts.add(question.prefilled_location);
				parts.add(question.location_level);
				for (const location of question.suggested_locations ?? []) parts.add(location);
				for (const option of question.options ?? []) {
					parts.add(option.id);
					parts.add(option.label);
				}
			}
			for (const inferred of Object.values(context.inferredContext)) parts.add(inferred);
			addStringRecord(parts.add, context.answers);
		}
		return parts.content();
	}

	if (route === 'stream-decision-makers') {
		const decisionMaker = request as DecisionMakerRequest;
		for (const value of [
			decisionMaker.subject_line,
			decisionMaker.core_message,
			...decisionMaker.topics,
			decisionMaker.voice_sample,
			decisionMaker.target_type,
			decisionMaker.target_entity,
			decisionMaker.audience_guidance
		]) {
			parts.add(value);
		}
		return parts.content();
	}

	const message = request as MessageRequest;
	for (const value of [
		message.subject_line,
		message.core_message,
		...(message.topics ?? []),
		message.voice_sample,
		message.raw_input,
		message.geographic_scope?.type,
		message.geographic_scope?.country,
		message.geographic_scope?.subdivision,
		message.geographic_scope?.locality
	]) {
		parts.add(value);
	}
	for (const decisionMaker of message.decision_makers ?? []) {
		parts.add(decisionMaker.name);
		parts.add(decisionMaker.title);
		parts.add(decisionMaker.organization);
	}
	return parts.content();
}

function assertAgentPromptGuardBudget(
	route: ProviderAgentRoute,
	request: GenerateSubjectRequest | DecisionMakerRequest | MessageRequest
): void {
	if (agentPromptGuardContent(route, request).length > PROMPT_GUARD_MAX_CHARACTERS) {
		fail(`Combined agent prompt must be ≤${PROMPT_GUARD_MAX_CHARACTERS} characters`);
	}
}

function invalidResponse(message: string, status: 400 | 413 = 400): Response {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: {
			'cache-control': 'private, no-store, max-age=0',
			'content-type': 'application/json; charset=utf-8'
		}
	});
}

function pathIdentifier(value: unknown, label: string): string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > 128 ||
		!ROUTE_IDENTIFIER_RE.test(value)
	) {
		fail(`Invalid ${label}`);
	}
	return value;
}

/**
 * One reviewed boundary for every executable agent route. Handlers call this
 * immediately after session authority and before rate limits, Convex, tracing,
 * moderation, or paid providers.
 */
export async function readBoundedAgentRequest<Route extends keyof AgentRequestEnvelopeMap>(
	event: AgentRequestEvent,
	route: Route
): Promise<AgentRequestEnvelopeMap[Route] | Response> {
	try {
		if (route === 'message-job') {
			return {
				jobId: pathIdentifier(event.params?.jobId, 'message generation job id')
			} as AgentRequestEnvelopeMap[Route];
		}
		if (route === 'trace-replay') {
			const traceId = pathIdentifier(event.params?.traceId, 'trace id');
			const cursor = event.url?.searchParams?.get('cursor') ?? undefined;
			if (cursor !== undefined && cursor.length > 2_048) fail('Invalid cursor');
			return {
				traceId,
				...(cursor === undefined ? {} : { cursor })
			} as AgentRequestEnvelopeMap[Route];
		}

		const maxBytes = BODY_LIMITS[route as keyof typeof BODY_LIMITS];
		const value = await readBoundedJsonRequest(event.request, maxBytes, {
			maxArrayItems: 32,
			maxDepth: 6,
			maxNodes: 512,
			maxObjectKeys: 32,
			maxStringBytes: 16_000
		});
		if (route === 'stream-decision-makers') {
			const request = validateDecisionMakerRequest(value);
			assertAgentPromptGuardBudget(route, request);
			return request as AgentRequestEnvelopeMap[Route];
		}
		if (route === 'stream-message') {
			const request = validateMessageRequest(value);
			assertAgentPromptGuardBudget(route, request);
			return request as AgentRequestEnvelopeMap[Route];
		}
		const request = validateSubjectRequest(value);
		assertAgentPromptGuardBudget(route, request);
		return request as AgentRequestEnvelopeMap[Route];
	} catch (error) {
		if (error instanceof BoundedJsonRequestError) {
			const malformedMessage =
				error.message === 'Invalid JSON in request body'
					? route === 'stream-decision-makers'
						? 'Invalid JSON in request body'
						: 'Invalid request body'
					: error.message;
			return invalidResponse(malformedMessage, error.status);
		}
		if (error instanceof AgentRequestValidationError) return invalidResponse(error.message);
		throw error;
	}
}
