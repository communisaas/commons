import { describe, expect, it, vi } from 'vitest';

import {
	paidProviderActorHash,
	paidProviderBudgetCoordinatorName,
	paidProviderMonthlyCeilingWasReached,
	readPaidProviderBudgetStatus,
	reservePaidProviderBudget
} from '../../../src/lib/server/paid-provider-budget-client';
import {
	EXA_PAID_ORG_MONTHLY_CEILING_REASON,
	FIRECRAWL_PAID_ORG_MONTHLY_CEILING_REASON,
	PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS,
	PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS,
	PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS,
	PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS,
	budgetScopeForReason,
	paidProviderBudgetOperationNames,
	paidProviderBudgetPolicyFor
} from '../../../src/lib/server/paid-provider-budget-policy';

function eventWithStub(fetch: (request: Request) => Promise<Response> | Response) {
	const idFromName = vi.fn((name: string) => ({ toString: () => name }));
	const get = vi.fn(() => ({ fetch }));
	return {
		event: {
			platform: {
				env: {
					PUBLIC_CONVEX_URL: 'https://quirky-chinchilla-352.convex.cloud',
					CONVEX_WORK_BUDGET: { idFromName, get }
				}
			}
		} as never,
		get,
		idFromName
	};
}

function admittedHeaders(overrides: Record<string, string> = {}): Headers {
	return new Headers({
		'x-paid-provider-budget-protocol': '1',
		'x-paid-provider-operation-remaining': '1',
		'x-paid-provider-actor-daily-remaining': '8',
		'x-paid-provider-reset-at': String(Date.UTC(2026, 6, 21, 13) / 1_000),
		...overrides
	});
}

function balance(limit: number, used: number, resetAt: number) {
	return { limit, used, remaining: limit - used, resetAt };
}

function validStatus() {
	const hourlyResetAt = Date.UTC(2026, 6, 20, 13) / 1_000;
	const dailyResetAt = Date.UTC(2026, 6, 21) / 1_000;
	const monthlyResetAt = Date.UTC(2026, 7, 1) / 1_000;
	return {
		schema: 1,
		realm: 'production',
		observedAt: Date.UTC(2026, 6, 20, 12, 30),
		global: {
			daily: balance(PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS, 400, dailyResetAt),
			monthly: balance(PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS, 800, monthlyResetAt)
		},
		public: {
			daily: balance(PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS, 300, dailyResetAt),
			monthly: balance(PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS, 600, monthlyResetAt)
		},
		operatorReserve: {
			daily: {
				available: 600,
				protectedLimit: 250,
				protectedRemaining: 150,
				resetAt: dailyResetAt,
				used: 100
			},
			monthly: {
				available: 1_600,
				protectedLimit: 600,
				protectedRemaining: 400,
				resetAt: monthlyResetAt,
				used: 200
			}
		},
		actor: { daily: balance(15, 3, dailyResetAt) },
		operations: Object.fromEntries(
			paidProviderBudgetOperationNames().map((operation) => {
				const policy = paidProviderBudgetPolicyFor(operation, 'operator')!;
				return [
					operation,
					{
						actorHourly: balance(policy.hourlyReservations, 0, hourlyResetAt),
						publicDaily: balance(policy.publicDailyUnits, 0, dailyResetAt),
						publicMonthly: balance(policy.publicMonthlyUnits, 0, monthlyResetAt)
					}
				];
			})
		)
	};
}

describe('paid provider budget client', () => {
	it('uses one stable shared authority object and sends only a domain-separated actor hash', async () => {
		let captured: Request | undefined;
		const runtime = eventWithStub((request) => {
			captured = request;
			return new Response(null, { status: 200, headers: admittedHeaders() });
		});

		const result = await reservePaidProviderBudget({
			event: runtime.event,
			identifier: 'user@example.com',
			operation: 'decision-makers',
			tier: 'authenticated'
		});

		expect(result).toMatchObject({ allowed: true, limit: 2, remaining: 1, status: 200 });
		expect(result.providerCeiling).toEqual({
			state: 'present',
			value: { withinMonthlyCeilings: true }
		});
		expect(runtime.idFromName).toHaveBeenCalledWith(paidProviderBudgetCoordinatorName());
		expect(captured?.url).toBe('https://convex-work-budget.internal/reserve-provider');
		const body = JSON.parse(await captured!.clone().text());
		expect(body).toEqual({
			actorHash: await paidProviderActorHash('user@example.com'),
			operation: 'decision-makers',
			realm: 'production',
			tier: 'authenticated'
		});
		expect(JSON.stringify(body)).not.toContain('user@example.com');
	});

	it('sends a paid organization grant as hashed period capacity, never raw org identity', async () => {
		let captured: Request | undefined;
		const runtime = eventWithStub((request) => {
			captured = request;
			return new Response(null, { status: 200, headers: admittedHeaders() });
		});
		const periodStart = Date.UTC(2026, 6, 1);
		const periodEnd = Date.UTC(2026, 7, 1);

		await expect(
			reservePaidProviderBudget({
				event: runtime.event,
				identifier: 'user_1',
				operation: 'decision-makers',
				tier: 'authenticated',
				paidOrg: { orgId: 'org_secret_1', balanceUnits: 830, periodStart, periodEnd }
			})
		).resolves.toMatchObject({ allowed: true, status: 200 });

		const body = await captured!.clone().json();
		expect(body.paidOrg).toEqual({
			orgHash: expect.stringMatching(/^[a-f0-9]{64}$/),
			balanceUnits: 830,
			periodStart,
			periodEnd
		});
		expect(JSON.stringify(body)).not.toContain('org_secret_1');
	});

	it('preserves a coordinated rejection without exposing platform balances', async () => {
		const runtime = eventWithStub(
			() =>
				new Response(null, {
					status: 429,
					headers: admittedHeaders({
						'retry-after': '120',
						'x-paid-provider-budget-reason': 'platform-daily',
						'x-paid-provider-operation-remaining': '2',
						'x-paid-provider-actor-daily-remaining': '10'
					})
				})
		);

		const result = await reservePaidProviderBudget({
			event: runtime.event,
			identifier: 'user_1',
			operation: 'decision-makers',
			tier: 'authenticated'
		});

		expect(result).toMatchObject({ allowed: false, limit: 2, remaining: 2, status: 429 });
		expect(result.reason).not.toMatch(/platform|global|1000|2400/i);
		expect(result.providerCeiling).toEqual({
			state: 'present',
			value: { withinMonthlyCeilings: true }
		});
	});

	it.each([EXA_PAID_ORG_MONTHLY_CEILING_REASON, FIRECRAWL_PAID_ORG_MONTHLY_CEILING_REASON])(
		'emits the %s denial as a BLOCKED fact',
		async (budgetReason) => {
			const runtime = eventWithStub(
				() =>
					new Response(null, {
						status: 429,
						headers: admittedHeaders({
							'retry-after': '120',
							'x-paid-provider-budget-reason': budgetReason,
							'x-paid-provider-operation-remaining': '2',
							'x-paid-provider-actor-daily-remaining': '10'
						})
					})
			);

			const result = await reservePaidProviderBudget({
				event: runtime.event,
				identifier: 'user_1',
				operation: 'decision-makers',
				tier: 'authenticated',
				paidOrg: {
					orgId: 'org_1',
					balanceUnits: 830,
					periodStart: Date.UTC(2026, 6, 1),
					periodEnd: Date.UTC(2026, 7, 1)
				}
			});

			expect(result.providerCeiling).toEqual({ state: 'blocked', why: budgetReason });
			expect(paidProviderMonthlyCeilingWasReached(result.providerCeiling)).toBe(true);
		}
	);

	it.each([
		{ reason: 'operation', scope: 'actor' },
		{ reason: 'actor-daily', scope: 'actor' },
		{ reason: 'actor-monthly', scope: 'actor' },
		{ reason: 'paid-org-balance', scope: 'actor' },
		{ reason: 'operation-daily', scope: 'platform' },
		{ reason: 'operation-monthly', scope: 'platform' },
		{ reason: 'public-daily', scope: 'platform' },
		{ reason: 'public-monthly', scope: 'platform' },
		{ reason: 'platform-daily', scope: 'platform' },
		{ reason: 'platform-monthly', scope: 'platform' },
		{ reason: EXA_PAID_ORG_MONTHLY_CEILING_REASON, scope: 'platform' },
		{ reason: FIRECRAWL_PAID_ORG_MONTHLY_CEILING_REASON, scope: 'platform' }
	])('reports the $reason denial as $scope capacity', async ({ reason, scope }) => {
		const runtime = eventWithStub(
			() =>
				new Response(null, {
					status: 429,
					headers: admittedHeaders({
						'retry-after': '120',
						'x-paid-provider-budget-reason': reason,
						'x-paid-provider-operation-remaining': '2',
						'x-paid-provider-actor-daily-remaining': '10'
					})
				})
		);

		const result = await reservePaidProviderBudget({
			event: runtime.event,
			identifier: 'user_1',
			operation: 'decision-makers',
			tier: 'authenticated'
		});

		expect(result.budgetScope).toBe(scope);
	});

	it.each<{ label: string; headers: Record<string, string> }>([
		{ label: 'an absent reason header', headers: {} },
		{ label: 'an unrecognised reason', headers: { 'x-paid-provider-budget-reason': 'nonsense' } },
		{ label: 'an empty reason', headers: { 'x-paid-provider-budget-reason': '' } },
		{
			label: 'a near-miss reason',
			headers: { 'x-paid-provider-budget-reason': 'actor-weekly' }
		}
	])('reports %s as blocked rather than guessing the caller spent it', async ({ headers }) => {
		const runtime = eventWithStub(
			() =>
				new Response(null, {
					status: 429,
					headers: admittedHeaders({
						'retry-after': '120',
						'x-paid-provider-operation-remaining': '2',
						'x-paid-provider-actor-daily-remaining': '10',
						...headers
					})
				})
		);

		const result = await reservePaidProviderBudget({
			event: runtime.event,
			identifier: 'user_1',
			operation: 'decision-makers',
			tier: 'authenticated'
		});

		expect(result.budgetScope).toBe('blocked');
		expect(result.budgetScope).not.toBe('actor');
	});

	it('never reports actor capacity for a denial it could not attribute', () => {
		// Every string that resolves to `actor` must be a reason the worker emits.
		const attributedToActor = [
			'operation',
			'actor-daily',
			'actor-monthly',
			'paid-org-balance',
			'operation-daily',
			'public-monthly',
			'platform-monthly',
			EXA_PAID_ORG_MONTHLY_CEILING_REASON,
			'',
			'actor',
			'ACTOR-DAILY',
			'actor-daily ',
			'unknown',
			'undefined',
			'null'
		].filter((reason) => budgetScopeForReason(reason) === 'actor');

		expect(attributedToActor).toEqual([
			'operation',
			'actor-daily',
			'actor-monthly',
			'paid-org-balance'
		]);
		expect(budgetScopeForReason(null)).toBe('blocked');
	});

	it('reports an unreachable admission authority as blocked, not as the caller overspending', async () => {
		const unavailable = await reservePaidProviderBudget({
			event: { platform: { env: {} } } as never,
			identifier: 'user_1',
			operation: 'subject-line',
			tier: 'authenticated'
		});
		expect(unavailable).toMatchObject({ status: 503, budgetScope: 'blocked' });
	});

	it('fails closed on a missing binding, unknown operation, protocol drift, or malformed balances', async () => {
		const missing = await reservePaidProviderBudget({
			event: { platform: { env: {} } } as never,
			identifier: 'user_1',
			operation: 'subject-line',
			tier: 'authenticated'
		});
		expect(missing).toMatchObject({ allowed: false, status: 503 });

		const unknown = await reservePaidProviderBudget({
			event: {} as never,
			identifier: 'user_1',
			operation: 'unreviewed-work',
			tier: 'authenticated'
		});
		expect(unknown).toMatchObject({ allowed: false, status: 503 });

		for (const headers of [
			admittedHeaders({ 'x-paid-provider-budget-protocol': '0' }),
			admittedHeaders({ 'x-paid-provider-operation-remaining': '999' })
		]) {
			const runtime = eventWithStub(() => new Response(null, { status: 200, headers }));
			const drift = await reservePaidProviderBudget({
				event: runtime.event,
				identifier: 'user_1',
				operation: 'subject-line',
				tier: 'authenticated'
			});
			expect(drift).toMatchObject({ allowed: false, status: 503 });
		}
	});

	it('rejects raw or oversized actor identifiers before calling the namespace', async () => {
		expect(await paidProviderActorHash('')).toBeNull();
		expect(await paidProviderActorHash('x'.repeat(513))).toBeNull();
	});

	it('reads and validates the bounded operator status without sending a raw user identifier', async () => {
		let captured: Request | undefined;
		const runtime = eventWithStub((request) => {
			captured = request;
			return Response.json(validStatus(), {
				headers: { 'x-paid-provider-budget-protocol': '1' }
			});
		});

		const status = await readPaidProviderBudgetStatus({
			event: runtime.event,
			identifier: 'launch-operator'
		});

		expect(status).toMatchObject({
			schema: 1,
			realm: 'production',
			global: { daily: { used: 400, remaining: 600 } },
			operatorReserve: { daily: { used: 100, protectedRemaining: 150 } },
			actor: { daily: { used: 3, remaining: 12 } }
		});
		expect(captured?.url).toBe('https://convex-work-budget.internal/status-provider');
		const requestBody = JSON.parse(await captured!.clone().text());
		expect(requestBody).toEqual({
			actorHash: await paidProviderActorHash('launch-operator'),
			realm: 'production'
		});
		expect(JSON.stringify(requestBody)).not.toContain('launch-operator');
	});

	it('fails closed on a malformed, oversized, wrong-protocol, or crossed status response', async () => {
		const crossed = validStatus();
		crossed.public.daily.used = 500;
		crossed.public.daily.remaining = 250;
		crossed.global.daily.used = 400;
		crossed.global.daily.remaining = 600;
		for (const response of [
			Response.json(crossed, { headers: { 'x-paid-provider-budget-protocol': '1' } }),
			Response.json(validStatus(), { headers: { 'x-paid-provider-budget-protocol': '0' } }),
			new Response('{', {
				status: 200,
				headers: {
					'content-type': 'application/json',
					'x-paid-provider-budget-protocol': '1'
				}
			}),
			new Response('x'.repeat(16 * 1024 + 1), {
				status: 200,
				headers: {
					'content-type': 'application/json',
					'x-paid-provider-budget-protocol': '1'
				}
			})
		]) {
			const runtime = eventWithStub(() => response);
			await expect(
				readPaidProviderBudgetStatus({
					event: runtime.event,
					identifier: 'launch-operator'
				})
			).resolves.toBeNull();
		}
	});
});
