import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	generateTrustedContainmentWorker,
	parseTrustedContainmentGeneratorArgs,
	renderTrustedContainmentWorker
} from '../../../scripts/generate-trusted-containment-worker.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const ACTIVE_INTERNAL = 'active-internal-containment-secret-32-bytes';
const PREVIOUS_INTERNAL = 'previous-internal-containment-secret-32-bytes';
const COOKIE_ACTIVE = 'active-cookie-containment-secret-padding-32';
const COOKIE_PREVIOUS = 'previous-cookie-containment-secret-padding-32';
const CREATION_ACTIVE = 'active-creation-containment-secret-padding-32';
const CREATION_PREVIOUS = 'previous-creation-containment-secret-padding';
const roots: string[] = [];
let moduleNonce = 0;

function tempRoot() {
	const root = mkdtempSync(join(tmpdir(), 'commons-trusted-containment-'));
	roots.push(root);
	return root;
}

function readyEnv(overrides: Record<string, unknown> = {}) {
	return {
		INTERNAL_API_SECRET: ACTIVE_INTERNAL,
		INTERNAL_API_SECRET_PREVIOUS: PREVIOUS_INTERNAL,
		SESSION_COOKIE_SIGNING_SECRET: COOKIE_ACTIVE,
		SESSION_COOKIE_SIGNING_SECRET_PREVIOUS: COOKIE_PREVIOUS,
		SESSION_CREATION_SECRET: CREATION_ACTIVE,
		SESSION_CREATION_SECRET_PREVIOUS: CREATION_PREVIOUS,
		...overrides
	};
}

async function loadWorker(source = renderTrustedContainmentWorker(SOURCE_SHA)) {
	moduleNonce += 1;
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${moduleNonce}`;
	return (await import(moduleUrl)).default as {
		fetch(request: Request, env: Record<string, unknown>): Promise<Response>;
	};
}

function request(pathname: string, method = 'GET', secret?: string) {
	return new Request(`https://commons.email${pathname}`, {
		method,
		headers: secret === undefined ? undefined : { 'X-Internal-Secret': secret }
	});
}

function expectNoStore(response: Response) {
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(response.headers.get('cdn-cache-control')).toBe('no-store');
	expect(response.headers.get('cloudflare-cdn-cache-control')).toBe('no-store');
	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

afterEach(() => {
	vi.unstubAllGlobals();
	while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('trusted standalone containment Worker', () => {
	it('generates byte-identical exact-shape output from only an exact source SHA', () => {
		const firstOutput = join(tempRoot(), 'pages');
		const secondOutput = join(tempRoot(), 'pages');
		const first = generateTrustedContainmentWorker({
			outputDirectory: firstOutput,
			sourceSha: SOURCE_SHA
		});
		const second = generateTrustedContainmentWorker({
			outputDirectory: secondOutput,
			sourceSha: SOURCE_SHA
		});

		expect(readdirSync(firstOutput)).toEqual(['_worker.js']);
		expect(readFileSync(first.workerPath)).toEqual(readFileSync(second.workerPath));
		expect(first.digest).toBe(second.digest);
		expect(first.bytes).toBe(second.bytes);
		expect(readFileSync(first.workerPath, 'utf8')).toContain(`const RELEASE_SHA = '${SOURCE_SHA}';`);
		expect(first.files).toEqual(['_worker.js']);
	});

	it('rejects source injection, duplicate arguments, symlink-shaped reuse, and nonempty output', () => {
		for (const candidate of [
			'a'.repeat(39),
			'A'.repeat(40),
			`${'a'.repeat(40)};throw new Error('injected')`,
			'../' + 'a'.repeat(40)
		]) {
			expect(() => renderTrustedContainmentWorker(candidate)).toThrow(/exact lowercase/i);
		}
		expect(() =>
			parseTrustedContainmentGeneratorArgs([
				'--source-sha',
				SOURCE_SHA,
				'--source-sha',
				SOURCE_SHA,
				'--output-directory',
				'pages'
			])
		).toThrow(/only once/i);

		const output = join(tempRoot(), 'pages');
		mkdirSync(output);
		writeFileSync(join(output, 'candidate.js'), 'untrusted');
		expect(() => generateTrustedContainmentWorker({ outputDirectory: output, sourceSha: SOURCE_SHA }))
			.toThrow(/must be empty/i);

		const linkRoot = tempRoot();
		const linkTarget = join(linkRoot, 'target');
		const outputLink = join(linkRoot, 'pages');
		mkdirSync(linkTarget);
		symlinkSync(linkTarget, outputLink, 'dir');
		expect(() =>
			generateTrustedContainmentWorker({ outputDirectory: outputLink, sourceSha: SOURCE_SHA })
		).toThrow(/symbolic link/i);
	});

	it('contains no imports, candidate assets, outbound fetches, cache access, or remote URLs', () => {
		const source = renderTrustedContainmentWorker(SOURCE_SHA);
		expect(source).not.toMatch(/^\s*import\s/m);
		expect(source).not.toContain('env.ASSETS');
		expect(source).not.toContain('globalThis.fetch');
		expect(source).not.toMatch(/\bcaches\b/);
		expect(source).not.toMatch(/https?:\/\//);
		expect(source.match(/__TRUSTED_RELEASE_SHA__/g)).toBeNull();
	});

	it('serves only exact GET/HEAD liveness and authenticated readiness routes', async () => {
		const worker = await loadWorker();
		const live = await worker.fetch(request('/api/live'), readyEnv());
		expect(live.status).toBe(200);
		expect(await live.json()).toEqual({ status: 'ok' });
		expectNoStore(live);

		const liveHead = await worker.fetch(request('/api/live', 'HEAD'), readyEnv());
		expect(liveHead.status).toBe(200);
		expect(await liveHead.text()).toBe('');
		expectNoStore(liveHead);

		const readiness = await worker.fetch(
			request('/api/containment-readiness', 'GET', ACTIVE_INTERNAL),
			readyEnv()
		);
		expect(readiness.status).toBe(200);
		expectNoStore(readiness);
		expect(await readiness.json()).toMatchObject({
			status: 'ok',
			mode: 'maintenance',
			authentication: { status: 'ok', internalSecretAccepted: true },
			containment: { active: true },
			release: { sha: SOURCE_SHA },
			runtimeCapabilities: { forbiddenBindingsAbsent: true, forbiddenBindingCount: 0 },
			publicDiscoveryCache: {
				bindingsAbsent: true,
				r2Bound: false,
				refreshGateBound: false,
				workBudgetBound: false
			},
			sessionCookieAuthority: { keysIsolated: true },
			externalDependencies: {
				calls: 0,
				fetchCalls: 0,
				cacheApiCalls: 0,
				sessionCalls: 0,
				convexCalls: 0,
				atlasCalls: 0,
				r2Calls: 0,
				durableObjectCalls: 0
			}
		});

		const readinessHead = await worker.fetch(
			request('/api/containment-readiness', 'HEAD', ACTIVE_INTERNAL),
			readyEnv()
		);
		expect(readinessHead.status).toBe(200);
		expect(await readinessHead.text()).toBe('');
	});

	it.each([
		['/', 'GET'],
		['/api/live/', 'GET'],
		['/api/live?probe=1', 'GET'],
		['/api/containment-readiness?probe=1', 'GET'],
		['/api/live', 'POST'],
		['/api/containment-readiness', 'POST'],
		['/api/live', 'OPTIONS'],
		['/anything', 'DELETE']
	])('returns the exact uncached maintenance response for %s %s', async (pathname, method) => {
		const worker = await loadWorker();
		const response = await worker.fetch(request(pathname, method, ACTIVE_INTERNAL), readyEnv());
		expect(response.status).toBe(503);
		expectNoStore(response);
		expect(await response.json()).toEqual({
			status: 'maintenance',
			mode: 'containment',
			code: 'SERVICE_CONTAINMENT'
		});
	});

	it('emits one exact terminal producer signal without scheduling or touching a binding', async () => {
		const worker = await loadWorker();
		const response = await worker.fetch(
			new Request(
				'https://commons.email/api/internal/public-discovery-manifest-refresh',
				{
					body: '{}',
					headers: {
						'content-type': 'application/json',
						'x-public-discovery-manifest-refresh-secret': ACTIVE_INTERNAL
					},
					method: 'POST'
				}
			),
			readyEnv()
		);
		expect(response.status).toBe(503);
		expectNoStore(response);
		expect(response.headers.get('x-public-discovery-manifest-refresh-contained')).toBe('1');
		expect(await response.text()).toBe(
			'{"status":"maintenance","mode":"containment","code":"PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED","retry":false}\n'
		);
	});

	it.each([
		['missing bearer', undefined, ''],
		['short bearer', 'short', ''],
		['query drift', ACTIVE_INTERNAL, '?probe=1']
	])('does not emit the terminal producer signal for %s', async (_label, secret, search) => {
		const worker = await loadWorker();
		const response = await worker.fetch(
			new Request(
				`https://commons.email/api/internal/public-discovery-manifest-refresh${search}`,
				{
					headers:
						secret === undefined
							? undefined
							: { 'x-public-discovery-manifest-refresh-secret': secret },
					method: 'POST'
				}
			),
			readyEnv()
		);
		expect(response.status).toBe(503);
		expect(response.headers.get('x-public-discovery-manifest-refresh-contained')).toBeNull();
		expect(await response.json()).toEqual({
			status: 'maintenance',
			mode: 'containment',
			code: 'SERVICE_CONTAINMENT'
		});
	});

	it('accepts active and previous internal secrets and rejects every other value', async () => {
		const worker = await loadWorker();
		for (const secret of [ACTIVE_INTERNAL, PREVIOUS_INTERNAL]) {
			const response = await worker.fetch(
				request('/api/containment-readiness', 'GET', secret),
				readyEnv()
			);
			expect(response.status).toBe(200);
		}
		for (const secret of [undefined, '', 'wrong', 'x'.repeat(32)]) {
			const response = await worker.fetch(
				request('/api/containment-readiness', 'GET', secret),
				readyEnv()
			);
			expect(response.status).toBe(401);
			expectNoStore(response);
			expect(await response.json()).toEqual({
				status: 'unauthorized',
				liveness: '/api/live'
			});
		}
	});

	it('fails readiness for invalid auth rotation or non-isolated session keys', async () => {
		const worker = await loadWorker();
		const invalidEnvironments = [
			readyEnv({ INTERNAL_API_SECRET_PREVIOUS: 'short' }),
			readyEnv({ INTERNAL_API_SECRET_PREVIOUS: ACTIVE_INTERNAL }),
			readyEnv({ SESSION_COOKIE_SIGNING_SECRET: undefined }),
			readyEnv({ SESSION_COOKIE_SIGNING_SECRET: CREATION_ACTIVE }),
			readyEnv({ SESSION_COOKIE_SIGNING_SECRET_PREVIOUS: COOKIE_ACTIVE }),
			readyEnv({ SESSION_COOKIE_SIGNING_SECRET_PREVIOUS: CREATION_PREVIOUS }),
			readyEnv({ SESSION_CREATION_SECRET_PREVIOUS: CREATION_ACTIVE }),
			readyEnv({ SESSION_CREATION_SECRET_PREVIOUS: 'short' })
		];
		for (const env of invalidEnvironments) {
			const response = await worker.fetch(
				request('/api/containment-readiness', 'GET', ACTIVE_INTERNAL),
				env
			);
			expect(response.status).toBe(503);
			expectNoStore(response);
		}
	});

	it.each([
		'DC_SESSION_KV',
		'REGISTRATION_RETRY_KV',
		'REJECTION_MONITOR_KV',
		'VICAL_KV',
		'PUBLIC_DISCOVERY_R2',
		'PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE',
		'CONVEX_WORK_BUDGET'
	])('rejects a retained %s binding without invoking it', async (binding) => {
		const worker = await loadWorker();
		const get = vi.fn(() => {
			throw new Error('binding must remain inert');
		});
		const put = vi.fn(() => {
			throw new Error('binding must remain inert');
		});
		const response = await worker.fetch(
			request('/api/containment-readiness', 'GET', ACTIVE_INTERNAL),
			readyEnv({ [binding]: { get, put } })
		);
		expect(response.status).toBe(503);
		expect(get).not.toHaveBeenCalled();
		expect(put).not.toHaveBeenCalled();
		const snapshot = await response.json();
		expect(snapshot.runtimeCapabilities.forbiddenBindingsAbsent).toBe(false);
	});

	it('never calls global network or cache capabilities', async () => {
		const outboundFetch = vi.fn(() => {
			throw new Error('network forbidden');
		});
		const cacheOpen = vi.fn(() => {
			throw new Error('cache forbidden');
		});
		vi.stubGlobal('fetch', outboundFetch);
		vi.stubGlobal('caches', { open: cacheOpen, default: { match: cacheOpen } });
		const worker = await loadWorker();
		for (const pathname of ['/api/live', '/api/containment-readiness', '/']) {
			await worker.fetch(request(pathname, 'GET', ACTIVE_INTERNAL), readyEnv());
		}
		expect(outboundFetch).not.toHaveBeenCalled();
		expect(cacheOpen).not.toHaveBeenCalled();
	});
});
