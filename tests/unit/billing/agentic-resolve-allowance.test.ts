import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	ORG_PLAN_LIMITS,
	ORG_PLAN_ORDER,
	AGENTIC_PROVIDER_REVENUE_ALLOCATION_BASIS_POINTS,
	AGENTIC_RESOLVE_PROVIDER_COST_MICROUSD,
	AGENTIC_RESOLVE_PROVIDER_UNITS,
	agenticProviderCapacityForPayment,
	agenticResolveAllowanceForPlan,
	addressResolveAllowanceForPlan
} from '../../../convex/lib/planLimits';
import budgetPolicy from '../../../config/paid-provider-budget-policy.json';
import {
	executeBudgetedConvexOperationForEvent,
	type ConvexWorkBudgetEvent
} from '../../../src/lib/server/convex-work-budget-client';

const routeMocks = vi.hoisted(() => ({
	serverQuery: vi.fn(),
	serverMutation: vi.fn(),
	enforceLLMRateLimit: vi.fn(),
	moderatePromptOnly: vi.fn(),
	resolveDecisionMakers: vi.fn(),
	readBoundedAgentRequest: vi.fn(),
	emitter: {
		send: vi.fn(),
		complete: vi.fn(),
		error: vi.fn(),
		close: vi.fn()
	}
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

vi.mock('$lib/server/sse-stream', () => ({
	SSE_HEADERS: { 'Content-Type': 'text/event-stream' },
	createSSEStream: vi.fn(() => ({
		stream: new ReadableStream({
			start(controller) {
				controller.close();
			}
		}),
		emitter: routeMocks.emitter
	}))
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

const repoSource = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('agentic resolve allowance', () => {
	it('grants no provider capacity at the inactive or unknown-plan floor', () => {
		expect(ORG_PLAN_LIMITS.inactive.agenticResolvesMonth).toBe(0);
		expect(agenticResolveAllowanceForPlan(null)).toBe(0);
		expect(agenticResolveAllowanceForPlan('not-a-plan')).toBe(0);
	});

	it('derives every marketed allowance from settled revenue, independent of the public pool', () => {
		const decisionMakerPolicy = budgetPolicy.operations['decision-makers'];
		expect(budgetPolicy.paidOrgCapacity).toEqual({
			operation: 'decision-makers',
			providerUnitsPerResolve: AGENTIC_RESOLVE_PROVIDER_UNITS,
			providerCostMicrousdPerResolve: AGENTIC_RESOLVE_PROVIDER_COST_MICROUSD,
			revenueAllocationBasisPoints: AGENTIC_PROVIDER_REVENUE_ALLOCATION_BASIS_POINTS,
			billingAuthority: 'settled-subscription-payment-only'
		});
		expect(decisionMakerPolicy.weightUnits).toBe(AGENTIC_RESOLVE_PROVIDER_UNITS);

		const results = ORG_PLAN_ORDER.map((slug) => {
			const plan = ORG_PLAN_LIMITS[slug];
			const capacity = agenticProviderCapacityForPayment(plan.priceCents);
			expect(plan.agenticResolvesMonth).toBe(capacity.resolveAllowance);
			expect(capacity.balanceUnits).toBe(
				capacity.resolveAllowance * decisionMakerPolicy.weightUnits
			);
			expect(capacity.maximumProviderSpendMicrousd).toBeLessThanOrEqual(
				capacity.allocatedRevenueMicrousd
			);
			return {
				slug,
				resolves: capacity.resolveAllowance,
				providerSpendUsd: capacity.maximumProviderSpendMicrousd / 1_000_000
			};
		});

		expect(results).toEqual([
			{ slug: 'starter', resolves: 5, providerSpendUsd: 2.9 },
			{ slug: 'organization', resolves: 38, providerSpendUsd: 22.04 },
			{ slug: 'coalition', resolves: 103, providerSpendUsd: 59.74 }
		]);
	});

	it('is monotonically non-decreasing across marketed org plans', () => {
		const allowances = ORG_PLAN_ORDER.map(
			(slug) => ORG_PLAN_LIMITS[slug].agenticResolvesMonth
		);
		for (let index = 1; index < allowances.length; index++) {
			expect(allowances[index]).toBeGreaterThanOrEqual(allowances[index - 1]);
		}
	});

	it('keeps agentic and address-resolve columns distinct for every org plan', () => {
		for (const slug of Object.keys(ORG_PLAN_LIMITS)) {
			const agentic = agenticResolveAllowanceForPlan(slug);
			const address = addressResolveAllowanceForPlan(slug);
			expect(agentic).not.toBe(address);
			expect(agentic).toBeLessThan(address);
		}
	});

	it('never reads the address-resolve substrate column on the agentic path', () => {
		const routeSource = repoSource(
			'src/routes/api/agents/stream-decision-makers/+server.ts'
		);
		const meteringSource = repoSource('convex/metering.ts');
		const admissionStart = meteringSource.indexOf('export const agenticResolveAdmission');
		const admissionEnd = meteringSource.indexOf(
			'// ---------------------------------------------------------------------------',
			admissionStart
		);
		expect(admissionStart).toBeGreaterThanOrEqual(0);
		expect(admissionEnd).toBeGreaterThan(admissionStart);
		const admissionSource = meteringSource.slice(admissionStart, admissionEnd);

		for (const source of [routeSource, admissionSource]) {
			expect(source).not.toContain('addressResolvesMonth');
			expect(source).not.toContain('addressResolveAllowanceForPlan');
			expect(source).not.toContain('resolve_address');
		}

		const addressRouteSource = repoSource('src/routes/api/v1/resolve-address/+server.ts');
		expect(addressRouteSource).not.toContain('agenticResolvesMonth');
		expect(addressRouteSource).not.toContain('agenticResolveAllowanceForPlan');
		expect(addressRouteSource).not.toContain('agentic_resolve');
	});

	it('registers the entitlement meter in the runtime and both schema unions', () => {
		const meteringSource = repoSource('convex/metering.ts');
		const schemaSource = repoSource('convex/schema.ts');

		expect(meteringSource).toMatch(
			/const METERS = \[[\s\S]*?'agentic_resolve'[\s\S]*?\] as const;/
		);
		expect(schemaSource.match(/v\.literal\('agentic_resolve'\)/g)).toHaveLength(2);
	});

	it('birth-stamps agentic ledger rows terminal so the provider drain cannot charge them', () => {
		const meteringSource = repoSource('convex/metering.ts');
		expect(meteringSource).toContain("args.meter === 'agentic_resolve'");
		expect(meteringSource).toContain('reportedToProvider: true as const');
		expect(meteringSource).toContain('providerEventId: `entitlement:${args.requestId}`');
	});

	it('returns an allowance decision when admission crosses the Convex work-budget client', async () => {
		const reservationFetch = vi.fn().mockResolvedValue(
			new Response(null, {
				status: 200,
				headers: {
					'x-budget-daily-remaining': '65472',
					'x-budget-daily-reset-at': '1800000000',
					'x-budget-monthly-remaining': '524224',
					'x-budget-monthly-reset-at': '1801000000',
					'x-convex-work-budget-protocol': '4'
				}
			})
		);
		const event: ConvexWorkBudgetEvent = {
			locals: {},
			platform: {
				env: {
					PUBLIC_CONVEX_URL: 'https://quirky-chinchilla-352.convex.cloud',
					CONVEX_WORK_BUDGET: {
						idFromName: vi.fn(() => 'budget-id'),
						get: vi.fn(() => ({ fetch: reservationFetch }))
					} as never
				}
			}
		};
		const allowanceDecision = {
			scope: 'org' as const,
			orgId: 'org_1',
			plan: 'starter',
			billingPeriodStart: Date.UTC(2026, 6, 1),
			billingPeriodEnd: Date.UTC(2026, 7, 1),
			providerBalance: { state: 'present' as const, value: { balanceUnits: 830, allowance: 5 } },
			used: 0,
			allowed: true
		};
		const execute = vi.fn().mockResolvedValue(allowanceDecision);

		await expect(
			executeBudgetedConvexOperationForEvent({
				event,
				execute,
				kind: 'query',
				localBypass: false,
				operation: 'metering:agenticResolveAdmission'
			})
		).resolves.toEqual(allowanceDecision);
		expect(execute).toHaveBeenCalledOnce();
		expect(reservationFetch).toHaveBeenCalledOnce();
		const reservation = reservationFetch.mock.calls[0]?.[0] as Request;
		expect(await reservation.clone().json()).toEqual({
			kind: 'query',
			operation: 'metering:agenticResolveAdmission',
			realm: 'production'
		});
	});
});

const validAgentBody = {
	subject_line: 'Keep the library open',
	core_message: 'Please fund weekend hours.',
	topics: ['library'],
	target_type: 'local_government'
};

function agentEvent() {
	return {
		locals: { session: { userId: 'user_1' } },
		request: new Request('http://localhost/api/agents/stream-decision-makers', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(validAgentBody)
		})
	} as never;
}

describe('POST /api/agents/stream-decision-makers agentic admission', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeMocks.readBoundedAgentRequest.mockResolvedValue(validAgentBody);
		routeMocks.serverQuery.mockResolvedValue({ scope: 'individual' });
		routeMocks.serverMutation.mockResolvedValue('usage_1');
		routeMocks.enforceLLMRateLimit.mockResolvedValue({ allowed: true, remaining: 1 });
		routeMocks.moderatePromptOnly.mockResolvedValue({
			safe: true,
			score: 0,
			threshold: 0.8
		});
		routeMocks.resolveDecisionMakers.mockResolvedValue({
			decisionMakers: [],
			researchSummary: 'No result',
			latencyMs: 1
		});
	});

	it('returns the typed 503 and reserves no rate-limit capacity when admission is unavailable', async () => {
		routeMocks.serverQuery.mockRejectedValueOnce(new Error('convex unavailable'));

		const response = await decisionMakerHandler(agentEvent());
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: 'Agentic capacity metering temporarily unavailable',
			code: 'METERING_UNAVAILABLE'
		});
		expect(routeMocks.enforceLLMRateLimit).not.toHaveBeenCalled();
		expect(routeMocks.serverMutation).not.toHaveBeenCalled();
	});

	it('returns the typed 402 before rate limiting, resolution, or metering for an exhausted org', async () => {
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

		const response = await decisionMakerHandler(agentEvent());
		expect(response.status).toBe(402);
		expect(await response.json()).toEqual({
			error: 'Agentic resolve quota exhausted for this plan period',
			code: 'AGENTIC_RESOLVE_QUOTA_EXCEEDED'
		});
		expect(routeMocks.enforceLLMRateLimit).not.toHaveBeenCalled();
		expect(routeMocks.resolveDecisionMakers).not.toHaveBeenCalled();
		expect(routeMocks.serverMutation).not.toHaveBeenCalled();
	});

	it('reports the platform monthly ceiling as BLOCKED without claiming org exhaustion', async () => {
		const resetAt = new Date('2026-08-01T00:00:00.000Z');
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
			remaining: 2,
			limit: 2,
			resetAt,
			status: 429,
			providerCeiling: {
				state: 'blocked',
				why: 'paid-provider-exa-monthly-ceiling'
			}
		});

		const response = await decisionMakerHandler(agentEvent());
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error:
				"Agentic resolution is temporarily paused because the platform's monthly provider-spend ceiling was reached. Your organization's allowance was not consumed.",
			code: 'AGENTIC_PLATFORM_CAPACITY_BLOCKED',
			resetAt: resetAt.toISOString()
		});
		expect(routeMocks.resolveDecisionMakers).not.toHaveBeenCalled();
		expect(routeMocks.serverMutation).not.toHaveBeenCalled();
	});

	it('reports a missing paid-period balance as BLOCKED, never as exhausted', async () => {
		routeMocks.serverQuery.mockResolvedValueOnce({
			scope: 'org',
			orgId: 'org_1',
			plan: 'starter',
			billingPeriodStart: Date.UTC(2026, 6, 1),
			billingPeriodEnd: Date.UTC(2026, 7, 1),
			providerBalance: {
				state: 'blocked',
				why: 'settled capacity was not found at the active billing period'
			},
			used: 0,
			allowed: false
		});

		const response = await decisionMakerHandler(agentEvent());
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: 'Agentic capacity could not be confirmed for this organization',
			code: 'AGENTIC_CAPACITY_BLOCKED'
		});
		expect(routeMocks.enforceLLMRateLimit).not.toHaveBeenCalled();
		expect(routeMocks.resolveDecisionMakers).not.toHaveBeenCalled();
		expect(routeMocks.serverMutation).not.toHaveBeenCalled();
	});

	it('reports a genuinely absent paid balance without claiming consumption', async () => {
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

		const response = await decisionMakerHandler(agentEvent());
		expect(response.status).toBe(402);
		expect(await response.json()).toEqual({
			error: 'No settled agentic resolve capacity is available for this organization',
			code: 'AGENTIC_RESOLVE_PAYMENT_REQUIRED'
		});
	});

	it('does not meter an individual caller', async () => {
		const response = await decisionMakerHandler(agentEvent());
		expect(response.status).toBe(200);
		await vi.waitFor(() => expect(routeMocks.resolveDecisionMakers).toHaveBeenCalledTimes(1));
		expect(routeMocks.serverMutation).not.toHaveBeenCalled();
	});

	it('checks admission before rate limiting and records the org unit before provider work', async () => {
		const events: string[] = [];
		routeMocks.serverQuery.mockImplementationOnce(async () => {
			events.push('admission');
			return {
				scope: 'org',
				orgId: 'org_1',
				plan: 'starter',
				billingPeriodStart: Date.UTC(2026, 6, 1),
				billingPeriodEnd: Date.UTC(2026, 7, 1),
				providerBalance: {
					state: 'present',
					value: { balanceUnits: 830, allowance: 5 }
				},
				used: 0,
				allowed: true
			};
		});
		routeMocks.enforceLLMRateLimit.mockImplementationOnce(async () => {
			events.push('rate-limit');
			return { allowed: true, remaining: 1 };
		});
		routeMocks.serverMutation.mockImplementationOnce(async () => {
			events.push('meter');
			return 'usage_1';
		});
		routeMocks.resolveDecisionMakers.mockImplementationOnce(async () => {
			events.push('resolve');
			return { decisionMakers: [], researchSummary: 'No result', latencyMs: 1 };
		});

		const response = await decisionMakerHandler(agentEvent());
		expect(response.status).toBe(200);
		await vi.waitFor(() => expect(routeMocks.resolveDecisionMakers).toHaveBeenCalledTimes(1));
		expect(events).toEqual(['admission', 'rate-limit', 'meter', 'resolve']);
		expect(routeMocks.serverQuery).toHaveBeenCalledWith(
			'metering:agenticResolveAdmission',
			{ _secret: 'test-internal-secret', userId: 'user_1' }
		);
		expect(routeMocks.enforceLLMRateLimit).toHaveBeenCalledWith(
			expect.anything(),
			'decision-makers',
			{
				orgId: 'org_1',
				balanceUnits: 830,
				periodStart: Date.UTC(2026, 6, 1),
				periodEnd: Date.UTC(2026, 7, 1)
			}
		);
		expect(routeMocks.serverMutation).toHaveBeenCalledWith(
			'metering:recordUsage',
			expect.objectContaining({
				orgId: 'org_1',
				meter: 'agentic_resolve',
				quantity: 1,
				billingPeriodStart: Date.UTC(2026, 6, 1)
			})
		);
	});
});
