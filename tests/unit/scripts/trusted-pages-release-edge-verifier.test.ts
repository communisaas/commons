import { describe, expect, it } from 'vitest';

import {
	TRUSTED_PAGES_EDGE_ACCESS_HEADER,
	TRUSTED_PAGES_EDGE_LATE_TRANSFORM_EXPRESSION,
	TRUSTED_PAGES_EDGE_REALMS,
	readTrustedPagesAccessApplicationInventory,
	validateTrustedPagesEdgeRoute,
	validateTrustedPagesEdgeWorker,
	validateTrustedPagesOriginAccess,
	validateTrustedPagesOriginAccessSeparation,
	validateTrustedPagesOriginDomains,
	validateTrustedPagesOriginLateTransform,
	verifyTrustedPagesAccessDenialMatrix,
	verifyTrustedPagesReleaseEdge
} from '../../../scripts/verify-trusted-pages-release-edge.mjs';

const transactionId = '123456789-3';
const serviceTokenId = 'a'.repeat(32);

type AccessAppFixture = {
	id: string;
	domain: string;
	type: string;
	read_service_tokens_from_header: string;
	policies: Array<{
		decision: string;
		include: Array<{ service_token: { token_id: string } }>;
		exclude: unknown[];
		require: unknown[];
	}>;
};

function workerSettings(environment: 'preview' | 'production') {
	const bindings: Record<string, unknown>[] = [
		{ name: 'PAGES_ORIGIN_ACCESS_TOKEN', type: 'secret_text' },
		{ name: 'PUBLIC_RELEASE_TRANSACTION_ID', type: 'plain_text', text: transactionId }
	];
	if (environment === 'production') {
		bindings.push(
			{ name: 'RELEASE_ORIGIN_PROOF_SECRET', type: 'secret_text' },
			{
				name: 'PUBLIC_CONVEX_URL',
				type: 'plain_text',
				text: TRUSTED_PAGES_EDGE_REALMS.production.publicConvexUrl
			},
			{
				name: 'PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE',
				type: 'durable_object_namespace',
				class_name: 'PublicDiscoveryManifestRefreshGate',
				script_name: 'commons-public-discovery-manifest-gate',
				namespace_id: 'gate-production'
			}
		);
	} else {
		bindings.push({ name: 'RELEASE_PROBE_SECRET', type: 'secret_text' });
	}
	return {
		result: { bindings, compatibility_flags: ['global_fetch_strictly_public'] }
	};
}

function accessApp(
	environment: 'preview' | 'production',
	tokenId: string
): AccessAppFixture {
	return {
		id: `app-${environment}`,
		domain: TRUSTED_PAGES_EDGE_REALMS[environment].originHost,
		type: 'self_hosted',
		read_service_tokens_from_header: TRUSTED_PAGES_EDGE_ACCESS_HEADER,
		policies: [
			{
				decision: 'non_identity',
				include: [{ service_token: { token_id: tokenId } }],
				exclude: [],
				require: []
			}
		]
	};
}

function accessApps(environment: 'preview' | 'production') {
	return {
		success: true,
		result: [accessApp(environment, serviceTokenId)],
		result_info: { total_count: 1, total_pages: 1 }
	};
}

function separatedAccessApps() {
	return {
		success: true,
		result: [accessApp('preview', 'a'.repeat(32)), accessApp('production', 'b'.repeat(32))],
		result_info: { total_count: 2, total_pages: 1 }
	};
}

function emptyAccessApps() {
	return {
		success: true,
		result: [],
		result_info: { total_count: 0, total_pages: 1 }
	};
}

function pagedAccessApps(result: unknown[], page = 1, totalCount = result.length) {
	return {
		success: true,
		result,
		result_info: {
			count: result.length,
			page,
			per_page: 100,
			total_count: totalCount,
			total_pages: Math.max(1, Math.ceil(totalCount / 100))
		}
	};
}

describe('trusted Pages edge live topology verifier', () => {
	it.each(['preview', 'production'] as const)(
		'accepts the exact %s Worker, route, and Service Auth boundary',
		(environment) => {
			expect(
				validateTrustedPagesEdgeWorker({
					settings: workerSettings(environment),
					subdomain: { result: { enabled: false, previews_enabled: false } },
					environment,
					expectedTransactionId: transactionId
				})
			).toMatchObject({ environment, releaseTransactionId: transactionId });
			expect(
				validateTrustedPagesEdgeRoute({
					routes: {
						success: true,
						result: [
							{
								pattern: TRUSTED_PAGES_EDGE_REALMS[environment].route,
								script: TRUSTED_PAGES_EDGE_REALMS[environment].worker
							}
						]
					},
					environment
				})
			).toBe(TRUSTED_PAGES_EDGE_REALMS[environment].route);
			expect(
				validateTrustedPagesOriginAccess({
					accessApps: accessApps(environment),
					environment,
					expectedServiceTokenId: serviceTokenId
				})
			).toEqual({ appId: `app-${environment}`, serviceTokenId });
		}
	);

	it('accepts only the intentional production API v1 route beside the trusted edge', () => {
		expect(
			validateTrustedPagesEdgeRoute({
				routes: {
					success: true,
					result: [
						{
							pattern: TRUSTED_PAGES_EDGE_REALMS.production.route,
							script: TRUSTED_PAGES_EDGE_REALMS.production.worker
						},
						{ pattern: 'commons.email/api/v1/*', script: 'commons-api-v1-edge' },
						{
							pattern: TRUSTED_PAGES_EDGE_REALMS.preview.route,
							script: TRUSTED_PAGES_EDGE_REALMS.preview.worker
						},
						{ pattern: 'atlas.commons.email/*', script: 'commons-atlas' },
						{ pattern: 'disabled.commons.email/*' }
					]
				},
				environment: 'production'
			})
		).toBe(TRUSTED_PAGES_EDGE_REALMS.production.route);
	});

	it.each([
		{
			environment: 'preview' as const,
			result: [{ pattern: 'atlas.commons.email/*', script: 'commons-atlas' }]
		},
		{
			environment: 'production' as const,
			result: [
				{ pattern: 'commons.email/api/v1/*', script: 'commons-api-v1-edge' },
				{
					pattern: TRUSTED_PAGES_EDGE_REALMS.preview.route,
					script: TRUSTED_PAGES_EDGE_REALMS.preview.worker
				}
			]
		}
	])('proves the exhaustive $environment Worker route inventory is absent', ({ environment, result }) => {
		expect(
			validateTrustedPagesEdgeRoute({
				routes: { success: true, result },
				environment,
				expectedPresent: false
			})
		).toBeNull();
	});

	it.each([
		{
			label: 'trusted route still present',
			row: {
				pattern: TRUSTED_PAGES_EDGE_REALMS.production.route,
				script: TRUSTED_PAGES_EDGE_REALMS.production.worker
			}
		},
		{
			label: 'more-specific hostile shadow',
			row: {
				pattern: 'commons.email/api/release-origin',
				script: 'stale-or-hostile-worker'
			}
		}
	])('rejects a production expected-absent inventory with a $label', ({ row }) => {
		expect(() =>
			validateTrustedPagesEdgeRoute({
				routes: { success: true, result: [row] },
				environment: 'production',
				expectedPresent: false
			})
		).toThrow(/overlapping Worker route/i);
	});

	it('rejects an incomplete Worker route inventory even for an expected-absent capture', () => {
		for (const resultInfo of [
			{ total_count: 0, total_pages: 2 },
			{ page: 1, per_page: 100 },
			'malformed'
		]) {
			expect(() =>
				validateTrustedPagesEdgeRoute({
					routes: {
						success: true,
						result: [],
						result_info: resultInfo
					},
					environment: 'production',
					expectedPresent: false
				})
			).toThrow(/route inventory pagination metadata is incomplete/i);
		}
	});

	it.each([
		{
			label: 'more-specific release proof shadow',
			row: { pattern: 'commons.email/api/release-*', script: 'stale-or-hostile-worker' }
		},
		{
			label: 'canonical-host wildcard shadow',
			row: { pattern: '*.commons.email/api/release-origin', script: 'stale-or-hostile-worker' }
		},
		{
			label: 'null-script origin bypass',
			row: { pattern: 'commons.email/api/release-origin', script: null }
		},
		{
			label: 'API v1 route with the wrong Worker',
			row: { pattern: 'commons.email/api/v1/*', script: 'stale-or-hostile-worker' }
		}
	])('rejects a production $label', ({ row }) => {
		expect(() =>
			validateTrustedPagesEdgeRoute({
				routes: {
					success: true,
					result: [
						{
							pattern: TRUSTED_PAGES_EDGE_REALMS.production.route,
							script: TRUSTED_PAGES_EDGE_REALMS.production.worker
						},
						row
					]
				},
				environment: 'production'
			})
		).toThrow(/overlapping Worker route/i);
	});

	it('rejects duplicate trusted routes and the production-only exception in staging', () => {
		const productionRoute = {
			pattern: TRUSTED_PAGES_EDGE_REALMS.production.route,
			script: TRUSTED_PAGES_EDGE_REALMS.production.worker
		};
		expect(() =>
			validateTrustedPagesEdgeRoute({
				routes: { success: true, result: [productionRoute, productionRoute] },
				environment: 'production'
			})
		).toThrow(/duplicate Worker route/i);

		expect(() =>
			validateTrustedPagesEdgeRoute({
				routes: {
					success: true,
					result: [
						{
							pattern: TRUSTED_PAGES_EDGE_REALMS.preview.route,
							script: TRUSTED_PAGES_EDGE_REALMS.preview.worker
						},
						{ pattern: 'staging.commons.email/api/v1/*', script: 'commons-api-v1-edge' }
					]
				},
				environment: 'preview'
			})
		).toThrow(/overlapping Worker route/i);
	});

	it('requires only the two active hidden Pages domains', () => {
		expect(
			validateTrustedPagesOriginDomains({
				pagesDomains: {
					success: true,
					result: [
						{ name: 'pages-origin.commons.email', status: 'active' },
						{ name: 'pages-origin-staging.commons.email', status: 'active' }
					]
				}
			})
		).toHaveLength(2);
	});

	it('requires the one exact post-Access token-removal transform', () => {
		const ruleset = {
			success: true,
			result: {
				kind: 'zone',
				phase: 'http_request_late_transform',
				rules: [
					{
						enabled: true,
						action: 'rewrite',
						expression: TRUSTED_PAGES_EDGE_LATE_TRANSFORM_EXPRESSION,
						action_parameters: {
							headers: { [TRUSTED_PAGES_EDGE_ACCESS_HEADER]: { operation: 'remove' } }
						}
					}
				]
			}
		};
		expect(validateTrustedPagesOriginLateTransform({ lateTransformRuleset: ruleset })).toEqual({
			header: TRUSTED_PAGES_EDGE_ACCESS_HEADER,
			removed: true
		});

		const broad = structuredClone(ruleset);
		broad.result.rules[0].expression = 'true';
		expect(() =>
			validateTrustedPagesOriginLateTransform({ lateTransformRuleset: broad })
		).toThrow(/not exact/i);

		const restored = structuredClone(ruleset);
		restored.result.rules.push({
			enabled: true,
			action: 'rewrite',
			expression: TRUSTED_PAGES_EDGE_LATE_TRANSFORM_EXPRESSION,
			action_parameters: {
				headers: { [TRUSTED_PAGES_EDGE_ACCESS_HEADER]: { operation: 'set' } }
			}
		});
		expect(() =>
			validateTrustedPagesOriginLateTransform({ lateTransformRuleset: restored })
		).toThrow(/not exact/i);
	});

	it('proves cross-realm service-token denial by requiring distinct policy token ids', () => {
		expect(
			validateTrustedPagesOriginAccessSeparation({ accessApps: separatedAccessApps() })
		).toEqual({ preview: 'a'.repeat(32), production: 'b'.repeat(32) });

		const shared = separatedAccessApps();
		shared.result[1].policies[0].include[0].service_token.token_id = 'a'.repeat(32);
		expect(() =>
			validateTrustedPagesOriginAccessSeparation({ accessApps: shared })
		).toThrow(/distinct Access service tokens/i);
	});

	it('rejects extra capabilities, public origins, and JWT-capable Allow policy drift', () => {
		const extra = workerSettings('preview');
		extra.result.bindings.push({ name: 'PUBLIC_DISCOVERY_R2', type: 'r2_bucket' });
		expect(() =>
			validateTrustedPagesEdgeWorker({
				settings: extra,
				subdomain: { result: { enabled: false, previews_enabled: false } },
				environment: 'preview',
				expectedTransactionId: transactionId
			})
		).toThrow(/not exact/i);

		const missingProductionProof = workerSettings('production');
		missingProductionProof.result.bindings = missingProductionProof.result.bindings.filter(
			(binding) => binding.name !== 'RELEASE_ORIGIN_PROOF_SECRET'
		);
		expect(() =>
			validateTrustedPagesEdgeWorker({
				settings: missingProductionProof,
				subdomain: { result: { enabled: false, previews_enabled: false } },
				environment: 'production',
				expectedTransactionId: transactionId
			})
		).toThrow(/binding set is not exact/i);

		const wrongProductionProofType = workerSettings('production');
		const proofBinding = wrongProductionProofType.result.bindings.find(
			(binding) => binding.name === 'RELEASE_ORIGIN_PROOF_SECRET'
		);
		expect(proofBinding).toBeDefined();
		proofBinding!.type = 'plain_text';
		expect(() =>
			validateTrustedPagesEdgeWorker({
				settings: wrongProductionProofType,
				subdomain: { result: { enabled: false, previews_enabled: false } },
				environment: 'production',
				expectedTransactionId: transactionId
			})
		).toThrow(/release-origin proof capability is missing/i);

		expect(() =>
			validateTrustedPagesOriginDomains({
				pagesDomains: {
					success: true,
					result: [
						{ name: 'pages-origin.commons.email', status: 'active' },
						{ name: 'pages-origin-staging.commons.email', status: 'active' },
						{ name: 'commons.email', status: 'active' }
					]
				}
			})
		).toThrow(/exactly the two/i);

		const jwtAllow = accessApps('production');
		jwtAllow.result[0].policies[0].decision = 'allow';
		expect(() =>
			validateTrustedPagesOriginAccess({
				accessApps: jwtAllow,
				environment: 'production',
				expectedServiceTokenId: serviceTokenId
			})
		).toThrow(/not exact Service Auth/i);
	});

	it('rejects path-scoped and wildcard apps that can override either exact root app', () => {
		const account = separatedAccessApps();
		account.result.push({
			...accessApp('production', 'c'.repeat(32)),
			id: 'app-production-path',
			domain: `${TRUSTED_PAGES_EDGE_REALMS.production.originHost}/api/*`
		});
		account.result_info.total_count = account.result.length;
		expect(() =>
			validateTrustedPagesOriginAccess({
				accountAccessApps: account,
				zoneAccessApps: emptyAccessApps(),
				environment: 'production',
				expectedServiceTokenId: 'b'.repeat(32)
			})
		).toThrow(/overlapping Access applications/i);

		const wildcard = separatedAccessApps();
		wildcard.result.push({
			...accessApp('production', 'c'.repeat(32)),
			id: 'app-hidden-origin-wildcard',
			domain: '*.commons.email'
		});
		wildcard.result_info.total_count = wildcard.result.length;
		expect(() =>
			validateTrustedPagesOriginAccessSeparation({
				accountAccessApps: wildcard,
				zoneAccessApps: emptyAccessApps()
			})
		).toThrow(/overlapping Access applications/i);
	});

	it('rejects a zone-only multi-domain destination capable of matching a hidden origin', () => {
		const zoneOnly = {
			...accessApp('production', 'c'.repeat(32)),
			id: 'zone-path-override',
			domain: 'unrelated.commons.email',
			destinations: [
				{ type: 'public', uri: 'unrelated.commons.email' },
				{
					type: 'public',
					uri: `${TRUSTED_PAGES_EDGE_REALMS.production.originHost}/private/*`
				}
			]
		};
		expect(() =>
			validateTrustedPagesOriginAccess({
				accountAccessApps: separatedAccessApps(),
				zoneAccessApps: {
					success: true,
					result: [zoneOnly],
					result_info: { total_count: 1, total_pages: 1 }
				},
				environment: 'production',
				expectedServiceTokenId: 'b'.repeat(32)
			})
		).toThrow(/overlapping Access applications/i);
	});

	it('reads every Access inventory page and rejects pagination without a complete proof', async () => {
		const applications = Array.from({ length: 101 }, (_, index) => ({
			id: `unrelated-${index}`,
			type: 'self_hosted',
			domain: `unrelated-${index}.example.com`
		}));
		const requestedPages: number[] = [];
		const inventory = await readTrustedPagesAccessApplicationInventory({
			endpoint: 'https://api.cloudflare.test/client/v4/accounts/account/access/apps',
			headers: { Authorization: 'Bearer test' },
			scope: 'account',
			fetchFn: (async (input) => {
				const page = Number(new URL(input.toString()).searchParams.get('page'));
				requestedPages.push(page);
				const start = (page - 1) * 100;
				return Response.json(pagedAccessApps(applications.slice(start, start + 100), page, 101));
			}) as typeof fetch
		});
		expect(inventory).toHaveLength(101);
		expect(requestedPages).toEqual([1, 2]);

		await expect(
			readTrustedPagesAccessApplicationInventory({
				endpoint: 'https://api.cloudflare.test/client/v4/zones/zone/access/apps',
				headers: { Authorization: 'Bearer test' },
				scope: 'zone',
				fetchFn: (async () =>
					Response.json({ success: true, result: [], result_info: { total_count: 0 } })) as typeof fetch
			})
		).rejects.toThrow(/pagination metadata is invalid/i);
	});

	it('enumerates both account- and zone-scoped Access inventories in the live proof', async () => {
		const requestedUrls: URL[] = [];
		const accountApps = separatedAccessApps().result;
		const result = await verifyTrustedPagesReleaseEdge({
			accountId: 'account',
			zoneId: 'zone',
			apiToken: 'api-token',
			environment: 'production',
			expectedTransactionId: transactionId,
			expectedServiceTokenId: 'b'.repeat(32),
			fetchFn: (async (input) => {
				const url = new URL(input.toString());
				requestedUrls.push(url);
				if (url.pathname.endsWith('/settings')) {
					return Response.json(workerSettings('production'));
				}
				if (url.pathname.endsWith('/subdomain')) {
					return Response.json({ result: { enabled: false, previews_enabled: false } });
				}
				if (url.pathname.endsWith('/workers/routes')) {
					return Response.json({
						success: true,
						result: [
							{
								pattern: TRUSTED_PAGES_EDGE_REALMS.production.route,
								script: TRUSTED_PAGES_EDGE_REALMS.production.worker
							}
						]
					});
				}
				if (url.pathname.endsWith('/domains')) {
					return Response.json({
						success: true,
						result: [
							{ name: 'pages-origin.commons.email', status: 'active' },
							{ name: 'pages-origin-staging.commons.email', status: 'active' }
						]
					});
				}
				if (url.pathname.endsWith('/access/apps')) {
					return Response.json(
						pagedAccessApps(url.pathname.startsWith('/client/v4/accounts/') ? accountApps : [])
					);
				}
				if (url.pathname.endsWith('/http_request_late_transform/entrypoint')) {
					return Response.json({
						success: true,
						result: {
							kind: 'zone',
							phase: 'http_request_late_transform',
							rules: [
								{
									enabled: true,
									action: 'rewrite',
									expression: TRUSTED_PAGES_EDGE_LATE_TRANSFORM_EXPRESSION,
									action_parameters: {
										headers: {
											[TRUSTED_PAGES_EDGE_ACCESS_HEADER]: { operation: 'remove' }
										}
									}
								}
							]
						}
					});
				}
				return new Response(null, { status: 404 });
			}) as typeof fetch
		});
		expect(result.accessTokenSeparation).toEqual({
			preview: 'a'.repeat(32),
			production: 'b'.repeat(32)
		});
		const accessRequests = requestedUrls.filter((url) => url.pathname.endsWith('/access/apps'));
		expect(accessRequests).toHaveLength(2);
		expect(accessRequests.map((url) => url.pathname)).toEqual(
			expect.arrayContaining([
				'/client/v4/accounts/account/access/apps',
				'/client/v4/zones/zone/access/apps'
			])
		);
		expect(
			accessRequests.every(
				(url) => url.searchParams.get('page') === '1' && url.searchParams.get('per_page') === '100'
			)
		).toBe(true);
	});

	it('sends a realm token only to the opposite origin and requires the full denial matrix', async () => {
		const requests: Request[] = [];
		const token = JSON.stringify({
			'cf-access-client-id': `${'c'.repeat(32)}.access`,
			'cf-access-client-secret': 's'.repeat(64)
		});
		const result = await verifyTrustedPagesAccessDenialMatrix({
			environment: 'preview',
			originAccessToken: token,
			fetchFn: (async (input, init) => {
				requests.push(new Request(input, init));
				return new Response(null, { status: 403 });
			}) as typeof fetch
		});

		expect(result.selectedTokenDeniedByOppositeOrigin).toBe(true);
		expect(result.malformedAndWrongServiceTokensDenied).toBe(true);
		expect(requests).toHaveLength(13);
		const credentialed = requests.filter((request) =>
			request.headers.has(TRUSTED_PAGES_EDGE_ACCESS_HEADER)
		);
		expect(credentialed).toHaveLength(4);
		const validCrossRealm = credentialed.filter(
			(request) => request.headers.get(TRUSTED_PAGES_EDGE_ACCESS_HEADER) === token
		);
		expect(validCrossRealm).toHaveLength(1);
		expect(new URL(validCrossRealm[0].url).hostname).toBe('pages-origin.commons.email');
		expect(
			requests.some(
				(request) =>
					new URL(request.url).hostname === 'pages-origin-staging.commons.email' &&
					request.headers.get(TRUSTED_PAGES_EDGE_ACCESS_HEADER) === token
			)
		).toBe(false);
	});
});
