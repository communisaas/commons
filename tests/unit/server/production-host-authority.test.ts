import { readFileSync } from 'node:fs';
import type { Handle } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	ACCESS_ASSERTION_HEADER,
	CANDIDATE_ORIGIN_HOST_HEADER,
	createProductionHostAuthorityHandle,
	EDGE_PUBLIC_HOST_HEADER,
	EDGE_RELEASE_SHA_HEADER,
	EDGE_RELEASE_TRANSACTION_HEADER,
	hasAccessAssertionShape,
	reconstructProductionPublicUrl
} from '$lib/server/production-host-authority';

const releaseSha = import.meta.env.VITE_RELEASE_SHA as string;
const releaseTransactionId = '123456789-2';
const productionBackend = 'https://quirky-chinchilla-352.convex.cloud';

afterEach(() => {
	vi.unstubAllGlobals();
});

function jwtSegment(value: Record<string, unknown>): string {
	return btoa(JSON.stringify(value)).replace(/=/gu, '').replace(/\+/gu, '-').replace(/\//gu, '_');
}

function accessAssertion(
	header: Record<string, unknown> = { alg: 'RS256', kid: 'access-signing-key' },
	claims: Record<string, unknown> = {
		aud: ['commons-pages-origin'],
		exp: 1_900_000_000,
		iat: 1_899_999_000,
		iss: 'https://commons.cloudflareaccess.com',
		sub: 'service-token'
	}
): string {
	return `${jwtSegment(header)}.${jwtSegment(claims)}.${'s'.repeat(342)}`;
}

const exactContractHeaders: Record<string, string> = {
	[ACCESS_ASSERTION_HEADER]: accessAssertion(),
	[CANDIDATE_ORIGIN_HOST_HEADER]: 'pages-origin.commons.email',
	[EDGE_PUBLIC_HOST_HEADER]: 'commons.email',
	[EDGE_RELEASE_SHA_HEADER]: releaseSha,
	[EDGE_RELEASE_TRANSACTION_HEADER]: releaseTransactionId
};

function authorityNamespace(
	status: 'absent' | 'committed' | 'contained' | 'provisional' | 'qualified' = 'committed'
): { namespace: DurableObjectNamespace; requests: Request[] } {
	const requests: Request[] = [];
	const fetch = vi.fn(async (request: Request) => {
		requests.push(request);
		return new Response(null, {
			headers: {
				'x-commons-release-authority-status': status,
				'x-public-discovery-refresh-gate-protocol': '3',
				'x-public-template-og-release-sha': releaseSha,
				'x-public-template-og-release-transaction': releaseTransactionId
			},
			status: 200
		});
	});
	const id = { toString: () => 'release-authority-id' } as DurableObjectId;
	return {
		namespace: {
			get: vi.fn(() => ({ fetch })),
			idFromName: vi.fn(() => id)
		} as unknown as DurableObjectNamespace,
		requests
	};
}

function input(
	url = 'https://commons.email/directory?limit=10',
	{
		authorityStatus,
		headers = {},
		isSubRequest = false,
		method = 'GET',
		platformTransaction = releaseTransactionId,
		trustedEdge = true,
		resolveImplementation
	}: {
		authorityStatus?: 'absent' | 'committed' | 'contained' | 'provisional' | 'qualified';
		headers?: Record<string, string | null>;
		isSubRequest?: boolean;
		method?: string;
		platformTransaction?: string;
		trustedEdge?: boolean;
		resolveImplementation?: (event: Parameters<Handle>[0]['event']) => Promise<Response>;
	} = {}
) {
	const requestHeaders = new Headers(exactContractHeaders);
	for (const [name, value] of Object.entries(headers)) {
		if (value === null) requestHeaders.delete(name);
		else requestHeaders.set(name, value);
	}
	const authority = authorityStatus === undefined ? null : authorityNamespace(authorityStatus);
	const request = new Request(url, { headers: requestHeaders, method });
	const eventUrl = new URL(url);
	const resolve = vi.fn(
		resolveImplementation ?? (async () => new Response(null, { status: 204 }))
	);
	return {
		authority,
		eventUrl,
		resolve,
		value: {
			event: {
				isSubRequest,
				locals: {},
				platform: {
					env: {
						// This suite is about the ENFORCED topology: the trusted edge owns
						// commons.email and this worker answers on pages-origin. Enforcement
						// now follows that topology rather than being unconditional, so the
						// fixture has to declare it. The unenforced path -- no edge deployed,
						// serve directly, headers still scrubbed -- is covered separately
						// below, because it is the state production is actually in.
						...(trustedEdge ? { TRUSTED_RELEASE_EDGE: '1' } : {}),
						PUBLIC_CONVEX_URL: productionBackend,
						...(authority
							? { PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE: authority.namespace }
							: {}),
						PUBLIC_RELEASE_TRANSACTION_ID: platformTransaction
					}
				},
				request,
				url: eventUrl
			},
			resolve
		} as never
	};
}

describe('production hidden-origin host authority', () => {
	it('admits the exact post-Access adapter contract and scrubs its capabilities', async () => {
		let resolvedOrigin: string | null = null;
		const request = input('https://commons.email/s/example?view=summary', {
			headers: { cookie: 'auth-session=public-application-cookie' },
			resolveImplementation: async (event) => {
				resolvedOrigin = event.url.origin;
				expect(event.url.href).toBe('https://commons.email/s/example?view=summary');
				expect(event.request.headers.get('cookie')).toBe(
					'auth-session=public-application-cookie'
				);
				for (const header of [
					ACCESS_ASSERTION_HEADER,
					CANDIDATE_ORIGIN_HOST_HEADER,
					EDGE_PUBLIC_HOST_HEADER,
					EDGE_RELEASE_SHA_HEADER,
					EDGE_RELEASE_TRANSACTION_HEADER
				]) {
					expect(event.request.headers.get(header), header).toBeNull();
				}
				return new Response(null, { status: 204 });
			}
		});

		expect((await createProductionHostAuthorityHandle()(request.value)).status).toBe(204);
		expect(resolvedOrigin).toBe('https://commons.email');
		expect(request.resolve).toHaveBeenCalledOnce();
	});

	it('serves the canonical host directly when no trusted edge is deployed', async () => {
		// The state production is in. commons.email answered 421 on EVERY path,
		// homepage included, because this contract was enforced with no edge in
		// front to satisfy it -- no request could have. Enforcement now follows the
		// topology, so an unstamped visitor is served instead of refused.
		let resolvedOrigin: string | null = null;
		const request = input('https://commons.email/s/example?view=summary', {
			trustedEdge: false,
			headers: {
				[ACCESS_ASSERTION_HEADER]: null,
				[CANDIDATE_ORIGIN_HOST_HEADER]: null,
				[EDGE_PUBLIC_HOST_HEADER]: null,
				[EDGE_RELEASE_SHA_HEADER]: null,
				[EDGE_RELEASE_TRANSACTION_HEADER]: null,
				cookie: 'auth-session=public-application-cookie'
			},
			resolveImplementation: async (event) => {
				resolvedOrigin = event.url.origin;
				return new Response(null, { status: 204 });
			}
		});

		expect((await createProductionHostAuthorityHandle()(request.value)).status).toBe(204);
		expect(resolvedOrigin).toBe('https://commons.email');
	});

	it('still scrubs forged authority headers when no trusted edge is deployed', async () => {
		// Fail-open on the CONTRACT must not mean fail-open on the capabilities it
		// carries. A client that stamps the edge's own headers must not have them
		// reach application code, or serving directly would hand every visitor the
		// ability to forge exactly what the edge is supposed to prove.
		const request = input('https://commons.email/s/example', {
			trustedEdge: false,
			resolveImplementation: async (event) => {
				for (const header of [
					ACCESS_ASSERTION_HEADER,
					CANDIDATE_ORIGIN_HOST_HEADER,
					EDGE_PUBLIC_HOST_HEADER,
					EDGE_RELEASE_SHA_HEADER,
					EDGE_RELEASE_TRANSACTION_HEADER
				]) {
					expect(event.request.headers.get(header), header).toBeNull();
				}
				return new Response(null, { status: 204 });
			}
		});

		expect((await createProductionHostAuthorityHandle()(request.value)).status).toBe(204);
	});

	it('re-arms the contract the moment the edge is declared', async () => {
		// Same unstamped request, edge declared: refused. This is the whole point
		// of keying enforcement to the topology -- deploying the edge and setting
		// TRUSTED_RELEASE_EDGE restores the boundary with no code change.
		const request = input('https://commons.email/s/example', {
			trustedEdge: true,
			headers: {
				[ACCESS_ASSERTION_HEADER]: null,
				[CANDIDATE_ORIGIN_HOST_HEADER]: null,
				[EDGE_PUBLIC_HOST_HEADER]: null,
				[EDGE_RELEASE_SHA_HEADER]: null,
				[EDGE_RELEASE_TRANSACTION_HEADER]: null
			}
		});
		expect((await createProductionHostAuthorityHandle()(request.value)).status).toBe(421);
	});

	it('mutates the framework URL in place for cookie, redirect, and CSRF semantics', async () => {
		const frameworkUrl = new URL(
			'https://pages-origin.commons.email/api/auth/passkey/register?return=%2Faccount'
		);
		const cookieClosureUrl = frameworkUrl;

		expect(reconstructProductionPublicUrl(frameworkUrl)).toBe(frameworkUrl);
		expect(cookieClosureUrl.origin).toBe('https://commons.email');
		expect(cookieClosureUrl.pathname).toBe('/api/auth/passkey/register');
		expect(cookieClosureUrl.search).toBe('?return=%2Faccount');
		expect(new URL('/account', frameworkUrl).href).toBe('https://commons.email/account');

		const request = input('https://commons.email/api/auth/passkey/register', {
			headers: { origin: 'https://commons.email' },
			method: 'POST',
			resolveImplementation: async (event) => {
				expect(event.request.headers.get('origin')).toBe(event.url.origin);
				return new Response(null, {
					status: 303,
					headers: { location: new URL('/account', event.url).toString() }
				});
			}
		});
		const response = await createProductionHostAuthorityHandle()(request.value);
		expect(response.headers.get('location')).toBe('https://commons.email/account');
	});

	it('preserves production route-auth headers while erasing adapter evidence', async () => {
		const request = input('https://commons.email/api/health', {
			headers: {
				'x-expected-release-sha': releaseSha,
				'x-expected-release-transaction': releaseTransactionId,
				'x-internal-secret': 'route-owned-production-capability'
			},
			resolveImplementation: async (event) => {
				expect(event.request.headers.get('x-expected-release-sha')).toBe(releaseSha);
				expect(event.request.headers.get('x-expected-release-transaction')).toBe(
					releaseTransactionId
				);
				expect(event.request.headers.get('x-internal-secret')).toBe(
					'route-owned-production-capability'
				);
				expect(event.request.headers.get(ACCESS_ASSERTION_HEADER)).toBeNull();
				return new Response(null, { status: 204 });
			}
		});
		expect((await createProductionHostAuthorityHandle()(request.value)).status).toBe(204);
	});

	it('terminates the exact production post-commit proof before every downstream hook', async () => {
		vi.stubGlobal('caches', undefined);
		const request = input('https://commons.email/api/release-origin', {
			headers: {
				accept: 'application/json',
				'x-commons-release-origin-purpose': 'post-commit-v1'
			}
		});

		const response = await createProductionHostAuthorityHandle()(request.value);
		expect(response.status).toBe(200);
		expect(response.headers.get('x-commons-origin-proof-secret')).toBe('absent');
		await expect(response.json()).resolves.toEqual({
			releaseSha,
			transactionId: releaseTransactionId,
			originAccessToken: 'absent',
			originProofSecret: 'absent',
			cacheApi: 'unavailable',
			externalIo: 0
		});
		expect(request.resolve).not.toHaveBeenCalled();
	});

	it.each([
		['production origin proof', 'https://commons.email/api/release-origin'],
		['ordinary production request', 'https://commons.email/directory']
	] as const)('rejects a proof capability leaked through T on an exact %s', async (_label, url) => {
		const request = input(url, {
			headers: {
				accept: 'application/json',
				'x-commons-release-origin-purpose': 'post-commit-v1',
				'x-commons-release-origin-proof-secret': 'a'.repeat(48)
			}
		});

		expect((await createProductionHostAuthorityHandle()(request.value)).status).toBe(421);
		expect(request.resolve).not.toHaveBeenCalled();
	});

	it.each([
		['wrong purpose', 'https://commons.email/api/release-origin', 'application/json', 'wrong'],
		['wrong accept', 'https://commons.email/api/release-origin', 'text/html', 'post-commit-v1'],
		[
			'query string',
			'https://commons.email/api/release-origin?probe=1',
			'application/json',
			'post-commit-v1'
		]
	] as const)('rejects a malformed production origin proof: %s', async (_label, url, accept, purpose) => {
		const request = input(url, {
			headers: {
				accept,
				'x-commons-release-origin-purpose': purpose
			}
		});

		expect((await createProductionHostAuthorityHandle()(request.value)).status).toBe(421);
		expect(request.resolve).not.toHaveBeenCalled();
	});

	it('fails the production proof closed if candidate Cache API unexpectedly exists', async () => {
		const match = vi.fn(async () => undefined);
		vi.stubGlobal('caches', { default: { match } });
		const request = input('https://commons.email/api/release-origin', {
			headers: {
				accept: 'application/json',
				'x-commons-release-origin-purpose': 'post-commit-v1'
			}
		});

		expect((await createProductionHostAuthorityHandle()(request.value)).status).toBe(503);
		expect(match).toHaveBeenCalledOnce();
		expect(request.resolve).not.toHaveBeenCalled();
	});

	it('terminates the exact Access-fronted staging proof before every downstream hook', async () => {
		vi.stubGlobal('caches', undefined);
		const request = input('https://staging.commons.email/api/release-candidate', {
			headers: {
				[CANDIDATE_ORIGIN_HOST_HEADER]: 'pages-origin-staging.commons.email',
				[EDGE_PUBLIC_HOST_HEADER]: 'staging.commons.email',
				'x-expected-release-sha': releaseSha,
				'x-expected-release-transaction': releaseTransactionId
			}
		});

		const response = await createProductionHostAuthorityHandle()(request.value);
		expect(response.status).toBe(204);
		expect(response.body).toBeNull();
		expect(response.headers.get('x-commons-origin-access-token')).toBe('absent');
		expect(response.headers.get('x-commons-preview-cache-api')).toBe('unavailable');
		expect(request.resolve).not.toHaveBeenCalled();
	});

	it.each([
		['ordinary staging path', 'https://staging.commons.email/directory', {}],
		[
			'staging query',
			'https://staging.commons.email/api/release-candidate?extra=1',
			{}
		],
		[
			'wrong staging origin marker',
			'https://staging.commons.email/api/release-candidate',
			{ [CANDIDATE_ORIGIN_HOST_HEADER]: 'pages-origin.commons.email' }
		],
		[
			'missing expected staging tuple',
			'https://staging.commons.email/api/release-candidate',
			{ 'x-expected-release-sha': null, 'x-expected-release-transaction': null }
		],
		[
			'production bearer on staging',
			'https://staging.commons.email/api/release-candidate',
			{ 'x-internal-secret': 'must-not-reach-preview' }
		],
		[
			'credentialed staging request',
			'https://staging.commons.email/api/release-candidate',
			{ authorization: 'Bearer must-not-reach-preview' }
		]
	] as const)('keeps %s closed before application work', async (_label, url, override) => {
		const request = input(url, {
			headers: {
				[CANDIDATE_ORIGIN_HOST_HEADER]: 'pages-origin-staging.commons.email',
				[EDGE_PUBLIC_HOST_HEADER]: 'staging.commons.email',
				'x-expected-release-sha': releaseSha,
				'x-expected-release-transaction': releaseTransactionId,
				...override
			}
		});
		expect((await createProductionHostAuthorityHandle()(request.value)).status).toBe(421);
		expect(request.resolve).not.toHaveBeenCalled();
	});

	it.each([
		['raw hidden origin', 'https://pages-origin.commons.email/directory', {}],
		['Pages project host', 'https://communique-site.pages.dev/directory', {}],
		['immutable Pages host', 'https://abc123.communique-site.pages.dev/directory', {}],
		['staging public host', 'https://staging.commons.email/directory', {}],
		['alternate public port', 'https://commons.email:8443/directory', {}],
		['missing raw-origin marker', 'https://commons.email/directory', { [CANDIDATE_ORIGIN_HOST_HEADER]: null }],
		['public raw-origin marker', 'https://commons.email/directory', { [CANDIDATE_ORIGIN_HOST_HEADER]: 'commons.email' }],
		['wrong public host metadata', 'https://commons.email/directory', { [EDGE_PUBLIC_HOST_HEADER]: 'attacker.example' }],
		['missing Access assertion', 'https://commons.email/directory', { [ACCESS_ASSERTION_HEADER]: null }],
		['malformed Access assertion', 'https://commons.email/directory', { [ACCESS_ASSERTION_HEADER]: 'not.a.jwt' }],
		['unsigned Access assertion', 'https://commons.email/directory', { [ACCESS_ASSERTION_HEADER]: accessAssertion({ alg: 'none' }) }],
		['custom Access bearer survived', 'https://commons.email/directory', { 'x-commons-pages-origin-access': 'must-be-absent' }],
		['standard Access client id survived', 'https://commons.email/directory', { 'cf-access-client-id': 'must-be-absent' }],
		['standard Access client secret survived', 'https://commons.email/directory', { 'cf-access-client-secret': 'must-be-absent' }],
		['standard Access token survived', 'https://commons.email/directory', { 'cf-access-token': 'must-be-absent' }],
		[
			'Access authorization cookie survived',
			'https://commons.email/directory',
			{ cookie: 'auth-session=allowed; CF_Authorization=must-be-absent' }
		],
		[
			'staging probe bearer survived',
			'https://commons.email/directory',
			{ 'x-release-probe-secret': 'must-be-absent' }
		],
		['wrong release SHA', 'https://commons.email/directory', { [EDGE_RELEASE_SHA_HEADER]: 'f'.repeat(40) }],
		['wrong release transaction', 'https://commons.email/directory', { [EDGE_RELEASE_TRANSACTION_HEADER]: '123456789-99' }]
	] as const)('rejects %s before release-authority I/O', async (_label, url, headers) => {
		const request = input(url, { authorityStatus: 'committed', headers: { ...headers } });
		const response = await createProductionHostAuthorityHandle()(request.value);

		expect(response.status).toBe(421);
		expect(response.headers.get('cache-control')).toContain('no-store');
		expect(request.authority?.requests).toHaveLength(0);
		expect(request.resolve).not.toHaveBeenCalled();
	});

	it('rejects malformed Pages release metadata before authority I/O', async () => {
		const request = input('https://commons.email/', {
			authorityStatus: 'committed',
			platformTransaction: 'not-a-release-transaction'
		});
		expect((await createProductionHostAuthorityHandle()(request.value)).status).toBe(421);
		expect(request.authority?.requests).toHaveLength(0);
		expect(request.resolve).not.toHaveBeenCalled();
	});

	it('leaves terminal C to the trusted edge and spends no cadence-DO read on origin traffic', async () => {
		const request = input('https://commons.email/directory', { authorityStatus: 'absent' });
		expect((await createProductionHostAuthorityHandle()(request.value)).status).toBe(204);
		expect(request.authority?.requests).toHaveLength(0);
		expect(request.resolve).toHaveBeenCalledOnce();
	});

	it('does not require a release-authority binding in the least-capability candidate realm', async () => {
		const request = input('https://commons.email/directory');
		expect((await createProductionHostAuthorityHandle()(request.value)).status).toBe(204);
		expect(request.authority).toBeNull();
		expect(request.resolve).toHaveBeenCalledOnce();
	});

	it('allows only framework-controlled canonical recursion without replaying edge headers', async () => {
		const internal = input('https://commons.email/api/templates', {
			headers: Object.fromEntries(Object.keys(exactContractHeaders).map((header) => [header, null])),
			isSubRequest: true
		});
		expect((await createProductionHostAuthorityHandle()(internal.value)).status).toBe(204);
		expect(internal.resolve).toHaveBeenCalledOnce();

		const topLevel = input('https://commons.email/api/templates', {
			headers: Object.fromEntries(Object.keys(exactContractHeaders).map((header) => [header, null]))
		});
		expect((await createProductionHostAuthorityHandle()(topLevel.value)).status).toBe(421);
		expect(topLevel.resolve).not.toHaveBeenCalled();
	});

	it('keeps the retired release-control route outside candidate code', async () => {
		const request = input(
			'https://commons.email/api/internal/public-template-og-release-authority',
			{ authorityStatus: 'committed', method: 'POST' }
		);
		expect((await createProductionHostAuthorityHandle()(request.value)).status).toBe(421);
		expect(request.authority?.requests).toHaveLength(0);
		expect(request.resolve).not.toHaveBeenCalled();
	});

	it('keeps local development explicit and production closed', async () => {
		const blocked = input('http://localhost:5173/s/example', {
			headers: Object.fromEntries(Object.keys(exactContractHeaders).map((header) => [header, null]))
		});
		expect((await createProductionHostAuthorityHandle()(blocked.value)).status).toBe(421);

		const allowed = input('http://localhost:5173/s/example', {
			headers: Object.fromEntries(Object.keys(exactContractHeaders).map((header) => [header, null]))
		});
		expect(
			(
				await createProductionHostAuthorityHandle({ allowLocalDevelopment: true })(allowed.value)
			).status
		).toBe(204);
	});

	it('recognizes only a decoded signed compact-JWS shape', () => {
		expect(hasAccessAssertionShape(accessAssertion())).toBe(true);
		expect(hasAccessAssertionShape(null)).toBe(false);
		expect(hasAccessAssertionShape('a.b.c')).toBe(false);
		expect(hasAccessAssertionShape(accessAssertion({ alg: '' }))).toBe(false);
		expect(hasAccessAssertionShape(accessAssertion({ alg: 'none' }))).toBe(false);
		expect(
			hasAccessAssertionShape(`${jwtSegment({ alg: 'RS256' })}.not-json.${'s'.repeat(342)}`)
		).toBe(false);
	});

	it('is the first normal application hook, before Convex initialization', () => {
		const hooks = readFileSync('src/hooks.server.ts', 'utf8');
		const sequence = hooks.slice(hooks.indexOf('const applicationHandle = sequence('));
		expect(sequence.indexOf('handleProductionHostAuthority')).toBeGreaterThanOrEqual(0);
		expect(sequence.indexOf('handleProductionHostAuthority')).toBeLessThan(
			sequence.indexOf('handleConvexInitialization')
		);
	});
});
