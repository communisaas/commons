import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	CANDIDATE_ORIGIN_HOST_HEADER,
	createAccessSafeSvelteKitPagesAdapter
} from '../../../workers/access-safe-sveltekit-pages-adapter';
import {
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL,
	PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PATH,
	PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE
} from '$lib/server/public-discovery-bootstrap-runtime';

const sourceSha = 'a'.repeat(40);
const transactionId = '123456789-1';
const bootstrapLease = '00000000-0000-4000-8000-000000000077';

function originRequest(
	path = '/',
	init: RequestInit = {},
	extraHeaders: HeadersInit = {}
): Request {
	return new Request(`https://pages-origin.commons.email${path}`, {
		...init,
		headers: {
			'cf-access-jwt-assertion': 'header.payload.signature',
			'x-commons-edge-public-host': 'commons.email',
			'x-commons-edge-release-sha': sourceSha,
			'x-commons-edge-release-transaction': transactionId,
			'x-forwarded-host': 'commons.email',
			'x-forwarded-proto': 'https',
			...extraHeaders
		}
	});
}

function bootstrapRequest(
	path = PUBLIC_DISCOVERY_BOOTSTRAP_PATH,
	body = '{}',
	extraHeaders: HeadersInit = {}
): Request {
	return originRequest(
		path,
		{ body, method: 'POST' },
		{
			'content-type': 'application/json',
			'x-expected-release-sha': sourceSha,
			'x-expected-release-transaction': transactionId,
			'x-internal-secret': 'internal-bootstrap-secret'.padEnd(64, 'i'),
			'x-public-discovery-manifest-refresh-secret': 'refresh-bootstrap-secret'.padEnd(64, 'r'),
			[PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER]: bootstrapLease,
			[PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER]: PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
			'x-public-discovery-refresh-purpose': 'deploy-seed',
			...extraHeaders
		}
	);
}

function fixture(
	options: {
		assets?: Set<string>;
		prerendered?: Set<string>;
		response?: Response;
		serverAssets?: Record<string, unknown>;
		serverConstructed?: () => unknown;
	} = {}
) {
	const init = vi.fn();
	const respond = vi.fn(
		async (_request: Request, _input: unknown) => options.response ?? new Response('dynamic')
	);
	const manifest = {
		appPath: '_app',
		assets: options.assets ?? new Set<string>(),
		_: { server_assets: options.serverAssets ?? {} }
	};
	const prerendered = options.prerendered ?? new Set<string>();
	class Server {
		constructor(_manifest: unknown) {
			options.serverConstructed?.();
		}

		init(input: unknown) {
			init(input);
		}

		respond(request: Request, input: unknown) {
			return respond(request, input);
		}
	}
	const assetsFetch = vi.fn(async () => new Response('asset'));
	const waits: Promise<unknown>[] = [];
	const adapter = createAccessSafeSvelteKitPagesAdapter({
		Server,
		basePath: '',
		manifest,
		prerendered
	});
	return {
		adapter,
		assetsFetch,
		env: { ASSETS: { fetch: assetsFetch } },
		init,
		manifest,
		prerendered,
		respond,
		context: { waitUntil: (promise: Promise<unknown>) => waits.push(promise) },
		waits
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('Access-safe SvelteKit Pages adapter', () => {
	it.each([
		{
			label: 'manifest asset over production proof',
			options: { assets: new Set(['api/release-origin/index.html']) }
		},
		{
			label: 'manifest asset over staging proof',
			options: { assets: new Set(['/api/release-candidate']) }
		},
		{
			label: 'server asset over production proof',
			options: { serverAssets: { 'api/release-origin': {} } }
		},
		{
			label: 'server asset over staging proof',
			options: { serverAssets: { 'api/release-candidate/index.html': {} } }
		},
		{
			label: 'prerender over production proof',
			options: { prerendered: new Set(['/api/release-origin']) }
		},
		{
			label: 'prerender over staging proof',
			options: { prerendered: new Set(['/api/release-candidate/']) }
		}
	])('rejects a malicious $label before constructing the candidate Server', ({ options }) => {
		const serverConstructed = vi.fn();
		expect(() => fixture({ ...options, serverConstructed })).toThrow(
			/ACCESS_SAFE_PAGES_PROOF_ROUTE_SHADOW/u
		);
		expect(serverConstructed).not.toHaveBeenCalled();
	});

	it('keeps both proof routes force-dynamic after post-factory manifest mutation', async () => {
		vi.stubGlobal('caches', undefined);
		const runtime = fixture();
		runtime.manifest.assets.add('api/release-origin/index.html');
		runtime.manifest._.server_assets['api/release-candidate'] = {};
		runtime.prerendered.add('/api/release-origin');
		runtime.prerendered.add('/api/release-candidate');

		await runtime.adapter.fetch(
			originRequest('/api/release-origin'),
			runtime.env,
			runtime.context
		);
		await runtime.adapter.fetch(
			originRequest('/api/release-candidate'),
			runtime.env,
			runtime.context
		);

		expect(runtime.respond).toHaveBeenCalledTimes(2);
		expect(runtime.respond.mock.calls.map(([request]) => request.url)).toEqual([
			'https://commons.email/api/release-origin',
			'https://commons.email/api/release-candidate'
		]);
		expect(runtime.assetsFetch).not.toHaveBeenCalled();
	});

	it('restores the public URL before SvelteKit and records authenticated hidden-origin evidence', async () => {
		vi.stubGlobal('caches', undefined);
		const runtime = fixture();
		const response = await runtime.adapter.fetch(
			originRequest('/account', {
				body: 'action=save',
				method: 'POST'
			}),
			runtime.env,
			runtime.context
		);

		expect(await response.text()).toBe('dynamic');
		expect(runtime.respond).toHaveBeenCalledOnce();
		const [request, input] = runtime.respond.mock.calls[0];
		expect(request.url).toBe('https://commons.email/account');
		expect(request.headers.get(CANDIDATE_ORIGIN_HOST_HEADER)).toBe(
			'pages-origin.commons.email'
		);
		expect(await request.text()).toBe('action=save');
		expect(input).toMatchObject({ platform: { caches: undefined } });
	});

	it('fails before assets or application code for a raw public host or leaked Access credential', async () => {
		const runtime = fixture();
		const direct = await runtime.adapter.fetch(
			new Request('https://commons.email/'),
			runtime.env,
			runtime.context
		);
		const leaked = await runtime.adapter.fetch(
			originRequest('/', {}, { 'x-commons-pages-origin-access': 'must-not-survive' }),
			runtime.env,
			runtime.context
		);

		expect(direct.status).toBe(421);
		expect(leaked.status).toBe(421);
		expect(runtime.init).not.toHaveBeenCalled();
		expect(runtime.respond).not.toHaveBeenCalled();
		expect(runtime.assetsFetch).not.toHaveBeenCalled();
	});

	it('continues without cache when Cache API default access throws', async () => {
		const cacheStorage = Object.defineProperty({}, 'default', {
			get() {
				throw new Error('Access disables Cache API');
			}
		});
		vi.stubGlobal('caches', cacheStorage);
		const runtime = fixture();

		const response = await runtime.adapter.fetch(
			originRequest('/directory'),
			runtime.env,
			runtime.context
		);

		expect(await response.text()).toBe('dynamic');
		expect(runtime.respond).toHaveBeenCalledOnce();
	});

	it('fails closed before assets or application code if candidate Cache API becomes available', async () => {
		const match = vi.fn(async () => new Response('must-not-be-served'));
		const put = vi.fn(async () => undefined);
		vi.stubGlobal('caches', { default: { match, put } });
		const runtime = fixture();

		const response = await runtime.adapter.fetch(
			originRequest('/'),
			runtime.env,
			runtime.context
		);

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			code: 'CANDIDATE_CACHE_API_UNEXPECTED',
			error: 'Origin boundary unavailable'
		});
		expect(match).not.toHaveBeenCalled();
		expect(put).not.toHaveBeenCalled();
		expect(runtime.init).not.toHaveBeenCalled();
		expect(runtime.respond).not.toHaveBeenCalled();
		expect(runtime.assetsFetch).not.toHaveBeenCalled();
		expect(runtime.waits).toHaveLength(0);
	});

	it('admits only the exact Access bootstrap route without Cache API or ASSETS ownership', async () => {
		const match = vi.fn(async () => new Response('must-not-be-read'));
		vi.stubGlobal('caches', { default: { match, put: vi.fn() } });
		const runtime = fixture({ response: Response.json({ error: 'negative canary' }, { status: 401 }) });

		const response = await runtime.adapter.fetch(bootstrapRequest(), {}, runtime.context);

		expect(response.status).toBe(401);
		expect(response.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER)).toBe(
			PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL
		);
		expect(runtime.respond).toHaveBeenCalledOnce();
		const [request, input] = runtime.respond.mock.calls[0];
		expect(request.url).toBe(`https://commons.email${PUBLIC_DISCOVERY_BOOTSTRAP_PATH}`);
		expect(request.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER)).toBe(
			PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL
		);
		expect(await request.text()).toBe('{}');
		expect(input).toMatchObject({ platform: { caches: undefined, env: {} } });
		expect(match).not.toHaveBeenCalled();
		expect(runtime.assetsFetch).not.toHaveBeenCalled();
	});

	it.each([
		['wrong path', '/api/internal/public-discovery-manifest-refresh/', '{}', {}],
		['query', `${PUBLIC_DISCOVERY_BOOTSTRAP_PATH}?retry=1`, '{}', {}],
		['body', PUBLIC_DISCOVERY_BOOTSTRAP_PATH, '{ }', {}],
		['crossed tuple', PUBLIC_DISCOVERY_BOOTSTRAP_PATH, '{}', { 'x-expected-release-sha': 'b'.repeat(40) }],
		['forged boundary', PUBLIC_DISCOVERY_BOOTSTRAP_PATH, '{}', { [PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER]: 'v1' }],
		['cookie', PUBLIC_DISCOVERY_BOOTSTRAP_PATH, '{}', { cookie: 'session=forbidden' }],
		[
			'crossed secrets',
			PUBLIC_DISCOVERY_BOOTSTRAP_PATH,
			'{}',
			{
				'x-internal-secret': 'same-bootstrap-secret'.padEnd(64, 's'),
				'x-public-discovery-manifest-refresh-secret': 'same-bootstrap-secret'.padEnd(64, 's')
			}
		]
	])('rejects a bootstrap %s before SvelteKit or assets', async (_label, path, body, headers) => {
		vi.stubGlobal('caches', undefined);
		const runtime = fixture();
		const response = await runtime.adapter.fetch(
			bootstrapRequest(path, body, headers),
			runtime.env,
			runtime.context
		);

		expect(response.status).toBe(421);
		expect(response.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER)).toBe('v1');
		expect(runtime.init).not.toHaveBeenCalled();
		expect(runtime.respond).not.toHaveBeenCalled();
		expect(runtime.assetsFetch).not.toHaveBeenCalled();
	});
});
