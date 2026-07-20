import { describe, expect, it, vi } from 'vitest';
import {
	normalizeContainmentOrigin,
	verifyContainmentDeployment
} from '../../../scripts/verify-containment-deployment.mjs';

const SHA = 'a'.repeat(40);
const SECRET = 'containment-probe-secret-padding-32-bytes';

function json(body: unknown, status: number) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }
	});
}

function successfulReadiness() {
	return {
		status: 'ok',
		mode: 'maintenance',
		authentication: { status: 'ok', internalSecretAccepted: true },
		containment: { active: true },
		release: { sha: SHA },
		publicDiscoveryCache: {
			status: 'isolated',
			bindingsAbsent: true,
			r2Bound: false,
			refreshGateBound: false,
			workBudgetBound: false
		},
		sessionCookieAuthority: { keysIsolated: true },
		externalDependencies: {
			status: 'isolated',
			calls: 0,
			convexCalls: 0,
			atlasCalls: 0,
			r2Calls: 0,
			durableObjectCalls: 0,
			fetchCalls: 0,
			cacheApiCalls: 0,
			sessionCalls: 0
		}
	};
}

function successfulFetch() {
	return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
		const pathname = new URL(String(input)).pathname;
		if (pathname === '/api/live') return json({ status: 'ok' }, 200);
		if (pathname === '/api/containment-readiness') {
			return json(successfulReadiness(), 200);
		}
		return json(
			{ status: 'maintenance', mode: 'containment', code: 'SERVICE_CONTAINMENT' },
			503
		);
	});
}

describe('containment deployment probe', () => {
	it('pins the exact approved origin shapes', () => {
		expect(normalizeContainmentOrigin('https://commons.email')).toBe('https://commons.email');
		expect(normalizeContainmentOrigin('https://staging.commons.email')).toBe(
			'https://staging.commons.email'
		);
		expect(normalizeContainmentOrigin('https://abc123.communique-site.pages.dev')).toBe(
			'https://abc123.communique-site.pages.dev'
		);
		for (const candidate of [
			'http://commons.email',
			'https://commons.email/landing',
			'https://commons.email.attacker.example',
			'https://staging.commons.email.attacker.example',
			'https://foo.pages.dev',
			'https://user@commons.email'
		]) {
			expect(() => normalizeContainmentOrigin(candidate)).toThrow(/exact approved/i);
		}
	});

	it('proves containment through the exact staging custom authority', async () => {
		await expect(
			verifyContainmentDeployment({
				url: 'https://staging.commons.email',
				expectedReleaseSha: SHA,
				internalSecret: SECRET,
				fetchFn: successfulFetch(),
				attempts: 1
			})
		).resolves.toEqual({ origin: 'https://staging.commons.email', releaseSha: SHA });
	});

	it('proves liveness, exact-SHA local readiness, and deterministic maintenance', async () => {
		const fetchFn = successfulFetch();
		await expect(
			verifyContainmentDeployment({
				url: 'https://commons.email',
				expectedReleaseSha: SHA,
				internalSecret: SECRET,
				fetchFn,
				attempts: 1
			})
		).resolves.toEqual({ origin: 'https://commons.email', releaseSha: SHA });
		expect(fetchFn.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
			'/api/live',
			'/api/containment-readiness',
			'/'
		]);
		expect(fetchFn.mock.calls[1][1]).toMatchObject({
			headers: { 'X-Internal-Secret': SECRET },
			redirect: 'manual'
		});
	});

	it.each(['fetchCalls', 'cacheApiCalls', 'sessionCalls'] as const)(
		'fails closed when containment reports nonzero %s',
		async (field) => {
			const readiness = successfulReadiness();
			readiness.externalDependencies[field] = 1;
			const fetchFn = vi.fn(async (input: string | URL | Request) => {
				const pathname = new URL(String(input)).pathname;
				if (pathname === '/api/live') return json({ status: 'ok' }, 200);
				if (pathname === '/api/containment-readiness') return json(readiness, 200);
				return json(
					{ status: 'maintenance', mode: 'containment', code: 'SERVICE_CONTAINMENT' },
					503
				);
			});

			await expect(
				verifyContainmentDeployment({
					url: 'https://commons.email',
					expectedReleaseSha: SHA,
					internalSecret: SECRET,
					fetchFn,
					attempts: 1
				})
			).rejects.toThrow(/local-only isolation/i);
		}
	);

	it('fails closed on nonzero dependency calls or a cacheable 503', async () => {
		const fetchFn = successfulFetch();
		fetchFn.mockImplementationOnce(async () => json({ status: 'ok' }, 200));
		fetchFn.mockImplementationOnce(async () =>
			json(
				{
					status: 'ok',
					mode: 'maintenance',
					authentication: { status: 'ok', internalSecretAccepted: true },
					containment: { active: true },
					release: { sha: SHA },
					publicDiscoveryCache: {
						status: 'isolated',
						bindingsAbsent: true,
						r2Bound: false,
						refreshGateBound: false,
						workBudgetBound: false
					},
					sessionCookieAuthority: { keysIsolated: true },
					externalDependencies: {
						status: 'isolated',
						calls: 1,
						convexCalls: 1,
						atlasCalls: 0,
						r2Calls: 0,
						durableObjectCalls: 0
					}
				},
				200
			)
		);
		await expect(
			verifyContainmentDeployment({
				url: 'https://commons.email',
				expectedReleaseSha: SHA,
				internalSecret: SECRET,
				fetchFn,
				attempts: 1
			})
		).rejects.toThrow(/local-only isolation/i);
	});

	it('fails closed when containment exposes a discovery binding', async () => {
		const fetchFn = successfulFetch();
		fetchFn.mockImplementationOnce(async () => json({ status: 'ok' }, 200));
		fetchFn.mockImplementationOnce(async () =>
			json(
				{
					status: 'ok',
					mode: 'maintenance',
					authentication: { status: 'ok', internalSecretAccepted: true },
					containment: { active: true },
					release: { sha: SHA },
					publicDiscoveryCache: {
						status: 'down',
						bindingsAbsent: false,
						r2Bound: true,
						refreshGateBound: false,
						workBudgetBound: false
					},
					sessionCookieAuthority: { keysIsolated: true },
					externalDependencies: {
						status: 'isolated',
						calls: 0,
						convexCalls: 0,
						atlasCalls: 0,
						r2Calls: 0,
						durableObjectCalls: 0
					}
				},
				200
			)
		);

		await expect(
			verifyContainmentDeployment({
				url: 'https://commons.email',
				expectedReleaseSha: SHA,
				internalSecret: SECRET,
				fetchFn,
				attempts: 1
			})
		).rejects.toThrow(/local-only isolation/i);
	});
});
