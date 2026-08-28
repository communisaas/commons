import { describe, expect, it } from 'vitest';

import {
	convexWorkBudgetRejectionResponse,
	handleConvexWorkBudgetResponses
} from '../../../src/lib/server/convex-work-budget-response';

const observation = {
	dailyRemainingUnits: 100,
	dailyResetAtSeconds: 1_800_000_000,
	monthlyRemainingUnits: 200,
	monthlyResetAtSeconds: 1_801_000_000
};

function event(locals: Record<string, unknown>) {
	return {
		locals,
		request: new Request('https://commons.email/example'),
		url: new URL('https://commons.email/example')
	};
}

describe('Convex work-budget response boundary', () => {
	it('returns generic no-store 429/503 bodies without exposing balances or operation names', async () => {
		for (const status of [429, 503] as const) {
			const response = convexWorkBudgetRejectionResponse({
				code: status === 429 ? 'CONVEX_WORK_BUDGET_EXHAUSTED' : 'CONVEX_WORK_BUDGET_UNAVAILABLE',
				observation,
				retryAfterSeconds: 60,
				status
			});
			const body = await response.text();
			expect(response.status).toBe(status);
			expect(response.headers.get('cache-control')).toContain('no-store');
			expect(response.headers.get('retry-after')).toBe('60');
			expect(response.headers.get('x-convex-work-budget-daily-remaining')).toBeNull();
			expect(body).not.toContain('sessionAuthority');
			expect(body).not.toContain('100');
		}
	});

	it('overrides a route-caught failure with the typed denial', async () => {
		const input = event({
			convexWorkBudgetRejection: {
				code: 'CONVEX_WORK_BUDGET_EXHAUSTED',
				observation,
				retryAfterSeconds: 30,
				status: 429
			}
		});
		const response = await handleConvexWorkBudgetResponses({
			event: input,
			resolve: async () => new Response('route swallowed it', { status: 200 })
		} as never);
		expect(response.status).toBe(429);
		expect(await response.json()).toMatchObject({ code: 'CONVEX_WORK_BUDGET_EXHAUSTED' });
	});

	it('exposes balances only after explicit internal/operator authority', async () => {
		const anonymous = await handleConvexWorkBudgetResponses({
			event: event({ convexWorkBudgetObservation: observation, user: null }),
			resolve: async () => new Response('ok')
		} as never);
		expect(anonymous.headers.get('x-convex-work-budget-daily-remaining')).toBeNull();

		const ordinaryUser = await handleConvexWorkBudgetResponses({
			event: event({ convexWorkBudgetObservation: observation, user: { id: 'u' } }),
			resolve: async () => new Response('ok')
		} as never);
		expect(ordinaryUser.headers.get('x-convex-work-budget-daily-remaining')).toBeNull();

		const operator = await handleConvexWorkBudgetResponses({
			event: event({
				convexWorkBudgetObservation: observation,
				convexWorkBudgetOperatorAuthorized: true
			}),
			resolve: async () => new Response('ok')
		} as never);
		expect(operator.headers.get('x-convex-work-budget-daily-remaining')).toBe('100');
	});
});
