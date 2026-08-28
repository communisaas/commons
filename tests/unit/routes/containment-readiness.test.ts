import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createContainmentReadinessHandler,
	evaluateContainmentReadiness,
	normalizeContainmentReleaseSha,
	type ContainmentReadinessEnv
} from '$lib/server/containment-readiness';

const RELEASE_SHA = 'a'.repeat(40);
const ACTIVE_INTERNAL_SECRET = 'containment-internal-secret-active-padding';
const PREVIOUS_INTERNAL_SECRET = 'containment-internal-secret-previous-padding';
const SESSION_CREATION_SECRET = 'containment-session-creation-secret-padding';
const SESSION_COOKIE_SECRET = 'containment-cookie-signing-secret-padding';

function readyEnv(): ContainmentReadinessEnv {
	return {
		INTERNAL_API_SECRET: ACTIVE_INTERNAL_SECRET,
		INTERNAL_API_SECRET_PREVIOUS: PREVIOUS_INTERNAL_SECRET,
		SESSION_CREATION_SECRET,
		SESSION_COOKIE_SIGNING_SECRET: SESSION_COOKIE_SECRET
	};
}

function discoveryBindings() {
	return {
		CONVEX_WORK_BUDGET: {
			get: vi.fn(),
			idFromName: vi.fn()
		} as unknown as DurableObjectNamespace,
		PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE: {
			get: vi.fn(),
			idFromName: vi.fn()
		} as unknown as DurableObjectNamespace,
		PUBLIC_DISCOVERY_R2: {
			get: vi.fn(),
			put: vi.fn(),
			list: vi.fn(),
			delete: vi.fn()
		} as unknown as R2Bucket
	};
}

function event(env: ContainmentReadinessEnv, secret: string | null = ACTIVE_INTERNAL_SECRET) {
	const request = new Request('https://commons.email/api/containment-readiness', {
		headers: secret ? { 'x-internal-secret': secret } : undefined
	});
	return { platform: { env }, request, url: new URL(request.url) } as never;
}

describe('/api/containment-readiness', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('external fetch forbidden'))));
		vi.stubGlobal('caches', {
			default: {
				match: vi.fn(() => Promise.reject(new Error('Cache API forbidden'))),
				put: vi.fn(() => Promise.reject(new Error('Cache API forbidden')))
			}
		});
	});

	afterEach(() => vi.unstubAllGlobals());

	it('authenticates and proves the exact local artifact without dependency I/O', async () => {
		const env = readyEnv();
		const cacheApi = caches as unknown as {
			default: { match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
		};
		const handler = createContainmentReadinessHandler('maintenance', RELEASE_SHA);

		const response = await handler(event(env));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(body).toEqual({
			status: 'ok',
			mode: 'maintenance',
			authentication: { status: 'ok', internalSecretAccepted: true },
			containment: { status: 'ok', active: true },
			release: { status: 'ok', sha: RELEASE_SHA },
			publicDiscoveryCache: {
				status: 'isolated',
				bindingsAbsent: true,
				r2Bound: false,
				refreshGateBound: false,
				workBudgetBound: false
			},
			sessionCookieAuthority: { status: 'ok', keysIsolated: true },
			externalDependencies: {
				status: 'isolated',
				calls: 0,
				convexCalls: 0,
				atlasCalls: 0,
				r2Calls: 0,
				durableObjectCalls: 0
			}
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(cacheApi.default.match).not.toHaveBeenCalled();
		expect(cacheApi.default.put).not.toHaveBeenCalled();
		expect(env.PUBLIC_DISCOVERY_R2).toBeUndefined();
		expect(env.PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE).toBeUndefined();
	});

	it('accepts the bounded previous internal secret without doing readiness work anonymously', async () => {
		const env = readyEnv();
		const handler = createContainmentReadinessHandler('maintenance', RELEASE_SHA);

		await expect(handler(event(env, PREVIOUS_INTERNAL_SECRET))).resolves.toMatchObject({ status: 200 });
		const anonymous = await handler(event(env, null));

		expect(anonymous.status).toBe(401);
		await expect(anonymous.json()).resolves.toEqual({
			status: 'unauthorized',
			liveness: '/api/live'
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(env.PUBLIC_DISCOVERY_R2).toBeUndefined();
	});

	it.each([
		['normal artifact', 'disabled', RELEASE_SHA, readyEnv()],
		['missing SHA', 'maintenance', '', readyEnv()],
		['unexpected R2 binding', 'maintenance', RELEASE_SHA, { ...readyEnv(), ...discoveryBindings(), PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE: undefined }],
		['unexpected refresh gate binding', 'maintenance', RELEASE_SHA, { ...readyEnv(), ...discoveryBindings(), PUBLIC_DISCOVERY_R2: undefined, CONVEX_WORK_BUDGET: undefined }],
		['unexpected work budget binding', 'maintenance', RELEASE_SHA, { ...readyEnv(), ...discoveryBindings(), PUBLIC_DISCOVERY_R2: undefined, PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE: undefined }],
		[
			'reused session key',
			'maintenance',
			RELEASE_SHA,
			{ ...readyEnv(), SESSION_COOKIE_SIGNING_SECRET: SESSION_CREATION_SECRET }
		]
	] as const)('fails closed for %s', async (_label, mode, releaseSha, env) => {
		const handler = createContainmentReadinessHandler(mode, releaseSha);
		const response = await handler(event(env));

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({ status: 'down' });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('rejects discovery capabilities without invoking even malformed bindings', async () => {
		const bindings = discoveryBindings();
		const env = { ...readyEnv(), ...bindings };
		const handler = createContainmentReadinessHandler('maintenance', RELEASE_SHA);

		const response = await handler(event(env));

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			status: 'down',
			publicDiscoveryCache: {
				status: 'down',
				bindingsAbsent: false,
				r2Bound: true,
				refreshGateBound: true,
				workBudgetBound: true
			}
		});
		expect(bindings.PUBLIC_DISCOVERY_R2.get).not.toHaveBeenCalled();
		expect(bindings.PUBLIC_DISCOVERY_R2.put).not.toHaveBeenCalled();
		expect(bindings.PUBLIC_DISCOVERY_R2.list).not.toHaveBeenCalled();
		expect(bindings.PUBLIC_DISCOVERY_R2.delete).not.toHaveBeenCalled();
		expect(bindings.PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE.idFromName).not.toHaveBeenCalled();
		expect(bindings.PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE.get).not.toHaveBeenCalled();
		expect(bindings.CONVEX_WORK_BUDGET.idFromName).not.toHaveBeenCalled();
		expect(bindings.CONVEX_WORK_BUDGET.get).not.toHaveBeenCalled();
	});

	it('requires an exact lowercase 40-character Git SHA', () => {
		expect(normalizeContainmentReleaseSha(RELEASE_SHA)).toBe(RELEASE_SHA);
		for (const candidate of ['', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), 'production']) {
			expect(normalizeContainmentReleaseSha(candidate)).toBeNull();
		}
	});

	it('reports zero calls as an invariant even when local readiness is down', () => {
		const snapshot = evaluateContainmentReadiness({
			authenticated: true,
			mode: 'maintenance',
			releaseSha: RELEASE_SHA,
			env: undefined
		});
		expect(snapshot.externalDependencies).toEqual({
			status: 'isolated',
			calls: 0,
			convexCalls: 0,
			atlasCalls: 0,
			r2Calls: 0,
			durableObjectCalls: 0
		});
	});
});
