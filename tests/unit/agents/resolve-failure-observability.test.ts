import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	RESOLVE_FAILURE_BUDGETS,
	RESOLVE_FAILURE_SIGNATURES,
	RESOLVE_FAILURE_STAGES,
	RESOLVE_PROVIDER_ATTRIBUTIONS,
	STAGE_COPY,
	attributeProviderFailure,
	describeResolveFailure
} from '../../../src/lib/core/agents/resolve-failure';
import { parseSSEStream } from '../../../src/lib/utils/sse-stream';
import {
	capturedSentryEvents,
	resetCapturedSentryEvents,
	type CapturedSentryEvent
} from '../../mocks/sentry-stub';

const routeMocks = vi.hoisted(() => ({
	serverQuery: vi.fn(),
	serverMutation: vi.fn(),
	enforceLLMRateLimit: vi.fn(),
	moderatePromptOnly: vi.fn(),
	resolveDecisionMakers: vi.fn(),
	readBoundedAgentRequest: vi.fn()
}));

vi.mock('$lib/server/convex-work-budget', () => ({
	serverQuery: (...args: unknown[]) => routeMocks.serverQuery(...args),
	serverMutation: (...args: unknown[]) => routeMocks.serverMutation(...args)
}));

vi.mock('$lib/convex', () => ({
	api: {
		metering: {
			agenticResolveAdmission: 'metering:agenticResolveAdmission',
			recordUsage: 'metering:recordUsage'
		},
		email: { filterSuppressedContactHashes: 'email:filterSuppressedContactHashes' }
	}
}));

vi.mock('$lib/server/llm-cost-protection', () => ({
	enforceLLMRateLimit: (...args: unknown[]) => routeMocks.enforceLLMRateLimit(...args),
	rateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
	addRateLimitHeaders: vi.fn(),
	getUserContext: vi.fn(() => ({ userId: 'user_1', tier: 'authenticated' })),
	logLLMOperation: vi.fn()
}));

vi.mock('$lib/core/server/moderation', () => ({
	moderatePromptOnly: (...args: unknown[]) => routeMocks.moderatePromptOnly(...args)
}));

vi.mock('$lib/core/agents/agents', () => ({
	resolveDecisionMakers: (...args: unknown[]) => routeMocks.resolveDecisionMakers(...args)
}));

vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: vi.fn(() => 'test-internal-secret')
}));

vi.mock('$lib/server/agent-request-authority', () => ({
	requireAuthenticatedAgentRequest: vi.fn(
		(event: { locals: { session?: { userId?: string } | null } }) =>
			event.locals.session?.userId ?? new Response(null, { status: 401 })
	)
}));

vi.mock('$lib/server/agent-request-envelope', () => ({
	readBoundedAgentRequest: (...args: unknown[]) => routeMocks.readBoundedAgentRequest(...args),
	agentPromptGuardContent: vi.fn(() => 'bounded prompt')
}));

vi.mock('$convex/lib/publicRecipientProvenance', () => ({
	issuePublicRecipientProvenance: vi.fn()
}));

vi.mock('$convex/_orgHash', () => ({
	computeGlobalEmailHash: vi.fn(async (email: string) => `hash:${email}`)
}));

vi.mock('$convex/lib/contactAuthority', () => ({
	RECIPIENT_SUPPRESSION_BATCH_MAX: 100
}));

const { POST: decisionMakerHandler } = await import(
	'../../../src/routes/api/agents/stream-decision-makers/+server'
);

const requestBody = {
	subject_line: 'Keep the North Star library open',
	core_message: 'Fund weekend hours for our neighborhood.',
	topics: ['library'],
	target_type: 'local_government'
};

const repoSource = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

function agentEvent() {
	return {
		locals: { session: { userId: 'user_1' } },
		request: new Request('http://localhost/api/agents/stream-decision-makers', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(requestBody)
		})
	} as never;
}

function capturedValue(event: CapturedSentryEvent): string {
	const error =
		event.error instanceof Error
			? { name: event.error.name, message: event.error.message, stack: event.error.stack }
			: event.error;
	return JSON.stringify({ error, context: event.context });
}

async function decodedEvents(rawSse: string) {
	const events: Array<{ type: string; data: Record<string, unknown> }> = [];
	for await (const event of parseSSEStream<Record<string, unknown>>(
		new Response(rawSse, { headers: { 'Content-Type': 'text/event-stream' } })
	)) {
		events.push(event);
	}
	return events;
}

describe('resolve failure observability', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetCapturedSentryEvents();
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		vi.spyOn(console, 'debug').mockImplementation(() => undefined);
		routeMocks.readBoundedAgentRequest.mockResolvedValue(requestBody);
		routeMocks.serverQuery.mockResolvedValue({ scope: 'individual' });
		routeMocks.serverMutation.mockResolvedValue('usage_1');
		routeMocks.enforceLLMRateLimit.mockResolvedValue({ allowed: true, remaining: 1 });
		routeMocks.moderatePromptOnly.mockResolvedValue({ safe: true, score: 0, threshold: 0.8 });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('sends one closed-list operator event and one staged error through the real SSE decoder', async () => {
		const leakedEmail = 'mayor@example.gov';
		const providerError = new Error(
			`network response echoed ${requestBody.subject_line}; ${requestBody.core_message}; ${leakedEmail}`
		);
		attributeProviderFailure('gemini', providerError);
		routeMocks.resolveDecisionMakers.mockRejectedValueOnce(providerError);

		const response = await decisionMakerHandler(agentEvent());
		expect(response.status).toBe(200);
		const rawSse = await response.text();
		const events = await decodedEvents(rawSse);

		expect(capturedSentryEvents).toHaveLength(1);
		const capture = capturedSentryEvents[0];
		expect(capture.context).toMatchObject({
			level: 'error',
			action: 'stream-decision-makers',
			detail: {
				stage: 'research',
				signature: 'network',
				budget: 'granted-individual',
				provider: 'gemini',
				providerAttribution: 'observed',
				traceId: expect.any(String)
			}
		});
		const detail = capture.context?.detail as Record<string, unknown>;
		expect(RESOLVE_FAILURE_STAGES).toContain(detail.stage);
		expect(RESOLVE_FAILURE_SIGNATURES).toContain(detail.signature);
		expect(RESOLVE_FAILURE_BUDGETS).toContain(detail.budget);
		expect(RESOLVE_PROVIDER_ATTRIBUTIONS).toContain(detail.providerAttribution);

		expect(events).toContainEqual({
			type: 'error',
			data: {
				message: STAGE_COPY.research,
				code: 'RESOLVE_STOPPED_RESEARCH'
			}
		});

		for (const forbidden of [requestBody.subject_line, requestBody.core_message, leakedEmail]) {
			expect(rawSse).not.toContain(forbidden);
			for (const captured of capturedSentryEvents) {
				expect(capturedValue(captured)).not.toContain(forbidden);
			}
		}
	});

	it('does not page on org quota denial but warns on platform-dark budget lanes', async () => {
		routeMocks.serverQuery.mockResolvedValueOnce({
			scope: 'org',
			orgId: 'org_1',
			plan: 'starter',
			billingPeriodStart: Date.UTC(2026, 6, 1),
			billingPeriodEnd: Date.UTC(2026, 7, 1),
			providerBalance: { state: 'present', value: { balanceUnits: 830, allowance: 5 } },
			used: 5,
			allowed: false
		});
		const quotaResponse = await decisionMakerHandler(agentEvent());
		expect(quotaResponse.status).toBe(402);
		expect(capturedSentryEvents).toHaveLength(0);

		resetCapturedSentryEvents();
		routeMocks.serverQuery.mockResolvedValueOnce({
			scope: 'org',
			orgId: 'org_1',
			plan: 'starter',
			billingPeriodStart: Date.UTC(2026, 6, 1),
			billingPeriodEnd: Date.UTC(2026, 7, 1),
			providerBalance: { state: 'present', value: { balanceUnits: 830, allowance: 5 } },
			used: 0,
			allowed: true
		});
		routeMocks.enforceLLMRateLimit.mockResolvedValueOnce({
			allowed: false,
			remaining: 0,
			limit: 2,
			resetAt: new Date('2026-08-01T00:00:00.000Z'),
			status: 429,
			providerCeiling: { state: 'blocked', why: 'paid-provider-exa-monthly-ceiling' }
		});
		const ceilingResponse = await decisionMakerHandler(agentEvent());
		expect(ceilingResponse.status).toBe(503);
		expect(capturedSentryEvents).toHaveLength(1);
		expect(capturedSentryEvents[0].context).toMatchObject({
			level: 'warning',
			detail: { stage: 'budget', budget: 'denied-platform-ceiling' }
		});

		resetCapturedSentryEvents();
		routeMocks.serverQuery.mockResolvedValueOnce({
			scope: 'org',
			orgId: 'org_1',
			plan: 'starter',
			billingPeriodStart: Date.UTC(2026, 6, 1),
			billingPeriodEnd: Date.UTC(2026, 7, 1),
			providerBalance: { state: 'blocked', why: 'settled capacity missing' },
			used: 0,
			allowed: false
		});
		const blockedResponse = await decisionMakerHandler(agentEvent());
		expect(blockedResponse.status).toBe(503);
		expect(capturedSentryEvents).toHaveLength(1);
		expect(capturedSentryEvents[0].context).toMatchObject({
			level: 'warning',
			detail: { stage: 'budget', budget: 'denied-unconfirmed' }
		});
	});

	it('captures an admission-read failure with no provider claim', async () => {
		routeMocks.serverQuery.mockRejectedValueOnce(new Error('Convex transport unavailable'));

		const response = await decisionMakerHandler(agentEvent());
		expect(response.status).toBe(503);
		expect(capturedSentryEvents).toHaveLength(1);
		expect(capturedSentryEvents[0].context).toMatchObject({
			level: 'error',
			detail: {
				stage: 'admission',
				budget: 'metering-unavailable',
				provider: 'unobserved',
				providerAttribution: 'unobserved'
			}
		});
	});

	it('keeps absence distinct, timeout copy identical, and unobserved providers null', () => {
		for (const message of Object.values(STAGE_COPY)) {
			expect(message.toLowerCase()).not.toContain('absent');
			expect(message.toLowerCase()).not.toContain('no decision-makers were found');
			expect(message.toLowerCase()).toMatch(/stopped|blocked/u);
		}

		const componentSource = repoSource(
			'src/lib/components/template/creator/DecisionMakerResolver.svelte'
		);
		expect(STAGE_COPY.timeout).toBe(
			'Research took too long and was stopped. Please try again — it may go faster on retry.'
		);
		expect(componentSource).toContain(STAGE_COPY.timeout);

		expect(
			describeResolveFailure({
				stage: 'unexpected-provider-phase',
				error: new Error('provider echoed arbitrary prose'),
				budget: 'granted-individual',
				providerAttribution: { provider: null, providerAttribution: 'unobserved' }
			})
		).toMatchObject({
			stage: 'unknown',
			signature: 'unclassified',
			provider: null,
			providerAttribution: 'unobserved',
			code: 'RESOLVE_STOPPED_UNKNOWN'
		});
	});

	it('names both person consumers and keeps the test stub API within production exports', () => {
		const componentSource = repoSource(
			'src/lib/components/template/creator/DecisionMakerResolver.svelte'
		);
		const authoringSource = repoSource('src/lib/core/authoring-process.ts');
		const routerSource = repoSource('src/lib/core/agents/providers/router.ts');
		for (const consumerSource of [componentSource, authoringSource]) {
			expect(consumerSource).toMatch(/case 'error':[\s\S]{0,240}event\.data\.message/u);
		}
		expect(componentSource).toMatch(/\{errorMessage\}<\/p>/u);
		expect(routerSource).toContain('attributeProviderFailure(provider.name, error)');

		const exportedFunctions = (source: string) =>
			new Set([...source.matchAll(/export function ([A-Za-z][A-Za-z0-9_]*)/gu)].map((match) => match[1]));
		const productionExports = exportedFunctions(
			repoSource('src/lib/server/monitoring/sentry.ts')
		);
		const stubExports = exportedFunctions(repoSource('tests/mocks/sentry-stub.ts'));
		for (const name of stubExports) expect(productionExports.has(name)).toBe(true);
	});
});
