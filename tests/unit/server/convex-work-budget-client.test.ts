import { describe, expect, it, vi } from 'vitest';

import {
	ConvexWorkBudgetError,
	convexWorkBudgetCoordinatorNameForGeneration,
	convexWorkBudgetRealmForConvexUrl,
	executeBudgetedConvexOperationForEvent,
	reserveConvexWorkForEvent,
	type ConvexWorkBudgetEvent
} from '../../../src/lib/server/convex-work-budget-client';

function admittedHeaders(overrides: Record<string, string> = {}) {
	return {
		'x-budget-daily-remaining': '65472',
		'x-budget-daily-reset-at': '1800000000',
		'x-budget-monthly-remaining': '524224',
		'x-budget-monthly-reset-at': '1801000000',
		'x-convex-work-budget-protocol': '4',
		...overrides
	};
}

function setup(
	response = new Response(null, { headers: admittedHeaders(), status: 200 }),
	publicConvexUrl = 'https://quirky-chinchilla-352.convex.cloud'
) {
	const fetch = vi.fn().mockResolvedValue(response);
	const get = vi.fn(() => ({ fetch }));
	const idFromName = vi.fn(() => ({ toString: () => 'id' }));
	const event: ConvexWorkBudgetEvent = {
		locals: {},
		platform: {
			env: {
				CONVEX_WORK_BUDGET: { get, idFromName },
				PUBLIC_CONVEX_URL: publicConvexUrl
			}
		}
	};
	return { event, fetch, get, idFromName };
}

describe('Pages Convex work-budget client', () => {
	it('reserves exactly once before each actual executor call', async () => {
		const runtime = setup();
		const order: string[] = [];
		runtime.fetch.mockImplementation(async () => {
			order.push('reserve');
			return new Response(null, { headers: admittedHeaders(), status: 200 });
		});
		const result = await executeBudgetedConvexOperationForEvent({
			event: runtime.event,
			execute: async () => {
				order.push('convex');
				return 'ok';
			},
			kind: 'query',
			localBypass: false,
			operation: 'sessionAuthority:get'
		});
		expect(result).toBe('ok');
		expect(order).toEqual(['reserve', 'convex']);
		expect(runtime.fetch).toHaveBeenCalledTimes(1);
		expect(runtime.idFromName).toHaveBeenCalledWith(
			'convex-work-budget:team-authority:shared-convex-quota-01'
		);
		const reservation = runtime.fetch.mock.calls[0]?.[0] as Request;
		expect(await reservation.clone().json()).toEqual({
			kind: 'query',
			operation: 'sessionAuthority:get',
			realm: 'production'
		});
	});

	it('spends zero reservations when a cache hit never invokes the helper boundary', async () => {
		const runtime = setup();
		const cached = { value: 'r2' };
		const load = async () =>
			cached.value ??
			executeBudgetedConvexOperationForEvent({
				event: runtime.event,
				execute: async () => 'convex',
				kind: 'query',
				localBypass: false,
				operation: 'sessionAuthority:get'
			});
		expect(await load()).toBe('r2');
		expect(runtime.fetch).not.toHaveBeenCalled();
	});

	it.each([
		['missing binding', (event: ConvexWorkBudgetEvent) => delete event.platform?.env?.CONVEX_WORK_BUDGET],
		['invalid realm', (event: ConvexWorkBudgetEvent) => (event.platform!.env!.PUBLIC_CONVEX_URL = 'https://evil.example')]
	])('fails closed on %s without invoking Convex', async (_name, mutate) => {
		const runtime = setup();
		mutate(runtime.event);
		const execute = vi.fn();
		await expect(
			executeBudgetedConvexOperationForEvent({
				event: runtime.event,
				execute,
				kind: 'query',
				localBypass: false,
				operation: 'sessionAuthority:get'
			})
		).rejects.toMatchObject({ rejection: { status: 503 } });
		expect(execute).not.toHaveBeenCalled();
	});

	it('fails closed on timeout, protocol drift, malformed counters, and unknown policy', async () => {
		for (const runtime of [
			setup(),
			setup(new Response(null, { headers: admittedHeaders({ 'x-convex-work-budget-protocol': '2' }), status: 200 })),
			setup(new Response(null, { headers: admittedHeaders({ 'x-budget-daily-remaining': '-1' }), status: 200 }))
		]) {
			if (runtime.fetch.mock.calls.length === 0 && runtime === undefined) continue;
		}

		const timeout = setup();
		timeout.fetch.mockRejectedValue(new DOMException('timeout', 'AbortError'));
		const drift = setup(
			new Response(null, {
				headers: admittedHeaders({ 'x-convex-work-budget-protocol': '2' }),
				status: 200
			})
		);
		const malformed = setup(
			new Response(null, {
				headers: admittedHeaders({ 'x-budget-daily-remaining': '-1' }),
				status: 200
			})
		);
		for (const [runtime, operation] of [
			[timeout, 'sessionAuthority:get'],
			[drift, 'sessionAuthority:get'],
			[malformed, 'sessionAuthority:get'],
			[setup(), 'unknown:operation']
		] as const) {
			await expect(
				reserveConvexWorkForEvent({
					event: runtime.event,
					kind: 'query',
					localBypass: false,
					operation,
					timeoutMs: 1
				})
			).rejects.toBeInstanceOf(ConvexWorkBudgetError);
			expect(runtime.event.locals.convexWorkBudgetRejection?.status).toBe(503);
		}
	});

	it('keeps explicit local/test mode usable only when no deployed env exists', async () => {
		const event: ConvexWorkBudgetEvent = { locals: {} };
		await expect(
			reserveConvexWorkForEvent({
				event,
				kind: 'query',
				localBypass: true,
				operation: 'sessionAuthority:get'
			})
		).resolves.toBeUndefined();
	});

	it('keeps local/test mode usable against a backend that maps to no budget realm', async () => {
		const runtime = setup(undefined, 'http://127.0.0.1:3210');
		await expect(
			reserveConvexWorkForEvent({
				event: runtime.event,
				kind: 'query',
				localBypass: true,
				operation: 'sessionAuthority:get'
			})
		).resolves.toBeUndefined();
		expect(runtime.fetch).not.toHaveBeenCalled();
	});

	it('still fails closed on an unrecognised realm when local bypass is off', async () => {
		const runtime = setup(undefined, 'http://127.0.0.1:3210');
		await expect(
			reserveConvexWorkForEvent({
				event: runtime.event,
				kind: 'query',
				localBypass: false,
				operation: 'sessionAuthority:get'
			})
		).rejects.toMatchObject({ rejection: { status: 503 } });
		expect(runtime.fetch).not.toHaveBeenCalled();
	});

	it('keeps local/test mode usable when an emulated platform lacks the coordinator', async () => {
		const runtime = setup();
		delete runtime.event.platform?.env?.CONVEX_WORK_BUDGET;
		await expect(
			reserveConvexWorkForEvent({
				event: runtime.event,
				kind: 'query',
				localBypass: true,
				operation: 'sessionAuthority:get'
			})
		).resolves.toBeUndefined();
		expect(runtime.fetch).not.toHaveBeenCalled();
	});

	it('still enforces in local/test mode once the coordinator is bound', async () => {
		const runtime = setup();
		await expect(
			reserveConvexWorkForEvent({
				event: runtime.event,
				kind: 'query',
				localBypass: true,
				operation: 'sessionAuthority:get'
			})
		).resolves.toBeUndefined();
		expect(runtime.fetch).toHaveBeenCalledTimes(1);
	});

	it('maps both backends and every schema generation to one stable team coordinator', async () => {
		expect(convexWorkBudgetRealmForConvexUrl('https://quirky-chinchilla-352.convex.cloud')).toBe(
			'production'
		);
		expect(convexWorkBudgetRealmForConvexUrl('https://outstanding-firefly-831.convex.cloud')).toBe(
			'preview'
		);
		expect(convexWorkBudgetRealmForConvexUrl('https://other.convex.cloud')).toBeNull();
		expect(convexWorkBudgetCoordinatorNameForGeneration('v4')).toBe(
			'convex-work-budget:team-authority:shared-convex-quota-01'
		);
		expect(convexWorkBudgetCoordinatorNameForGeneration('v4')).toBe(
			convexWorkBudgetCoordinatorNameForGeneration('v3')
		);
		expect(convexWorkBudgetCoordinatorNameForGeneration('v4')).toBe(
			convexWorkBudgetCoordinatorNameForGeneration('v5')
		);

		const production = setup();
		const preview = setup(
			new Response(null, { headers: admittedHeaders(), status: 200 }),
			'https://outstanding-firefly-831.convex.cloud'
		);
		for (const runtime of [production, preview]) {
			await reserveConvexWorkForEvent({
				event: runtime.event,
				kind: 'query',
				localBypass: false,
				operation: 'sessionAuthority:get'
			});
			expect(runtime.idFromName).toHaveBeenCalledWith(
				'convex-work-budget:team-authority:shared-convex-quota-01'
			);
		}
	});

	it('parses exhaustion but never invokes the denied executor', async () => {
		const runtime = setup(
			new Response(null, {
				headers: admittedHeaders({ 'retry-after': '3600' }),
				status: 429
			})
		);
		const execute = vi.fn();
		await expect(
			executeBudgetedConvexOperationForEvent({
				event: runtime.event,
				execute,
				kind: 'query',
				localBypass: false,
				operation: 'sessionAuthority:get'
			})
		).rejects.toMatchObject({ rejection: { retryAfterSeconds: 3600, status: 429 } });
		expect(execute).not.toHaveBeenCalled();
	});
});
