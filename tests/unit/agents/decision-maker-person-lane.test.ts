import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The person lane, replayed through the real route handler.
 *
 * The live consumer is `src/lib/components/template/creator/DecisionMakerResolver.svelte`
 * — a person's browser, sending a body that carries no org context at all. That
 * request must be served on the free lane: no org paywall, no usage written
 * against an org, and no sentence about "this organization". The paid lane is
 * proven still armed by the last case, where org context IS declared.
 */

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
	requireAuthenticatedAgentRequest: vi.fn(() => 'user_1')
}));

vi.mock('$lib/server/agent-request-envelope', () => ({
	readBoundedAgentRequest: (...args: unknown[]) => routeMocks.readBoundedAgentRequest(...args),
	agentPromptGuardContent: vi.fn(() => 'bounded prompt')
}));

vi.mock('$lib/server/paid-provider-budget-client', () => ({
	paidProviderMonthlyCeilingWasReached: vi.fn(() => false)
}));

vi.mock('$convex/lib/publicRecipientProvenance', () => ({
	issuePublicRecipientProvenance: vi.fn(async () => undefined)
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

// The literal body `DecisionMakerResolver.svelte` builds for a person: note
// `url_slug` (the template's own slug), never `org_slug`.
const personBody = {
	subject_line: 'Fund safer crossings',
	core_message: 'Please fund safer crossings this year.',
	topics: ['street safety'],
	voice_sample: 'Neighbors have asked for this crossing for two winters.',
	url_slug: 'fund-safer-crossings',
	audience_guidance: 'City council members who vote on the transport budget.'
};

function agentEvent(body: Record<string, unknown>) {
	return {
		locals: { session: { userId: 'user_1' } },
		request: new Request('http://localhost/api/agents/stream-decision-makers', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as never;
}

function admissionCallArgs(): Record<string, unknown> {
	const call = routeMocks.serverQuery.mock.calls.find(
		(args) => args[0] === 'metering:agenticResolveAdmission'
	);
	expect(call).toBeDefined();
	return call?.[1] as Record<string, unknown>;
}

describe('POST /api/agents/stream-decision-makers person lane', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeMocks.readBoundedAgentRequest.mockResolvedValue(personBody);
		routeMocks.serverQuery.mockResolvedValue({ scope: 'individual' });
		routeMocks.serverMutation.mockResolvedValue('usage_1');
		routeMocks.enforceLLMRateLimit.mockResolvedValue({ allowed: true, remaining: 1 });
		routeMocks.moderatePromptOnly.mockResolvedValue({ safe: true, score: 0, threshold: 0.8 });
		routeMocks.resolveDecisionMakers.mockResolvedValue({
			decisionMakers: [],
			researchSummary: 'No contactable decision-maker was resolved.',
			latencyMs: 1
		});
	});

	it('serves the browser body with no org context on the free lane', async () => {
		const response = await decisionMakerHandler(agentEvent(personBody));

		expect(admissionCallArgs()).toMatchObject({
			_secret: 'test-internal-secret',
			userId: 'user_1'
		});
		expect(admissionCallArgs().orgSlug).toBeUndefined();
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/event-stream');

		const streamed = await response.text();
		expect(streamed).not.toContain('this organization');
		expect(routeMocks.serverMutation).not.toHaveBeenCalled();
	});

	it('never answers a person with an org payment or capacity status', async () => {
		const response = await decisionMakerHandler(agentEvent(personBody));

		expect(response.status).not.toBe(402);
		expect(response.status).not.toBe(503);
		await response.text();
	});

	it('still charges the paywall where org context was declared', async () => {
		const orgBody = { ...personBody, org_slug: 'climate-action-now' };
		routeMocks.readBoundedAgentRequest.mockResolvedValue(orgBody);
		routeMocks.serverQuery.mockResolvedValueOnce({
			scope: 'org',
			orgId: 'org_1',
			plan: 'inactive',
			billingPeriodStart: 0,
			billingPeriodEnd: 0,
			providerBalance: { state: 'absent' },
			used: 0,
			allowed: false
		});

		const response = await decisionMakerHandler(agentEvent(orgBody));

		expect(admissionCallArgs().orgSlug).toBe('climate-action-now');
		expect(response.status).toBe(402);
		expect(await response.json()).toMatchObject({
			code: 'AGENTIC_RESOLVE_PAYMENT_REQUIRED'
		});
		expect(routeMocks.resolveDecisionMakers).not.toHaveBeenCalled();
		expect(routeMocks.serverMutation).not.toHaveBeenCalled();
	});
});
