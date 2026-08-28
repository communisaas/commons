import { describe, expect, it, vi } from 'vitest';

import {
	OBSOLETE_LIFECYCLE_RULE_ID,
	PUBLIC_DISCOVERY_NONPROD_BUCKET,
	PUBLIC_DISCOVERY_BUCKET,
	PUBLIC_DISCOVERY_KV_BINDINGS,
	PUBLIC_DISCOVERY_KV_NAMESPACE_TITLES,
	parsePublicDiscoveryStorageArgs,
	planPublicDiscoveryLifecycleReconciliation,
	prefixOverlapsPublicDiscovery,
	reconcilePublicDiscoveryR2Lifecycle,
	verifyAndReconcilePublicDiscoveryStorage
} from '../../../scripts/reconcile-public-discovery-r2-lifecycle.mjs';
import { PAGES_KV_NAMESPACE_IDS } from '../../../scripts/verify-pages-durable-object-binding.mjs';

const ACCOUNT_ID = 'a'.repeat(32);

function envelope(rules: unknown[]) {
	return { result: { rules }, success: true };
}

function response(body: unknown, status = 200) {
	return Response.json(body, { status });
}

function committedKvRows() {
	return (['preview', 'production'] as const).flatMap((realm) =>
		PUBLIC_DISCOVERY_KV_BINDINGS.map((binding) => ({
			id: PAGES_KV_NAMESPACE_IDS[realm][binding],
			title: PUBLIC_DISCOVERY_KV_NAMESPACE_TITLES[realm][binding]
		}))
	);
}

type StorageFixtureOptions = {
	customDomains?: Partial<Record<'preview' | 'production', unknown[]>>;
	inventoryRows?: Array<{ id: string; title: string }>;
	lifecycleRules?: Partial<Record<'preview' | 'production', unknown[]>>;
	managedEnabled?: Partial<Record<'preview' | 'production', boolean>>;
	pageSize?: number;
	persistLifecyclePut?: boolean;
	storageClass?: Partial<Record<'preview' | 'production', string>>;
};

function storageFixture({
	customDomains = {},
	inventoryRows = committedKvRows(),
	lifecycleRules = {},
	managedEnabled = {},
	pageSize = 1_000,
	persistLifecyclePut = true,
	storageClass = {}
}: StorageFixtureOptions = {}) {
	const buckets = {
		preview: PUBLIC_DISCOVERY_NONPROD_BUCKET,
		production: PUBLIC_DISCOVERY_BUCKET
	};
	const rules = new Map(
		(['preview', 'production'] as const).map((realm) => [
			buckets[realm],
			[...(lifecycleRules[realm] ?? [unrelated])]
		])
	);
	const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		const kvSuffix = '/storage/kv/namespaces';
		if (url.pathname.endsWith(kvSuffix)) {
			const page = Number(url.searchParams.get('page'));
			const start = (page - 1) * pageSize;
			const rows = inventoryRows.slice(start, start + pageSize);
			return response({
				result: rows,
				result_info: {
					count: rows.length,
					page,
					per_page: pageSize,
					total_count: inventoryRows.length,
					total_pages: Math.max(1, Math.ceil(inventoryRows.length / pageSize))
				},
				success: true
			});
		}

		const realm = (['preview', 'production'] as const).find((candidate) =>
			url.pathname.includes(`/r2/buckets/${buckets[candidate]}`)
		);
		if (!realm) return response({ success: false }, 404);
		const bucketBase = `/r2/buckets/${buckets[realm]}`;
		if (url.pathname.endsWith(`${bucketBase}/domains/managed`)) {
			return response({
				result: {
					bucketId: realm === 'preview' ? 'b'.repeat(32) : 'c'.repeat(32),
					domain: `pub-${realm}.r2.dev`,
					enabled: managedEnabled[realm] ?? false
				},
				success: true
			});
		}
		if (url.pathname.endsWith(`${bucketBase}/domains/custom`)) {
			return response({
				result: { domains: customDomains[realm] ?? [] },
				success: true
			});
		}
		if (url.pathname.endsWith(`${bucketBase}/lifecycle`)) {
			if (init?.method === 'PUT') {
				const body = JSON.parse(String(init.body));
				if (persistLifecyclePut) rules.set(buckets[realm], body.rules);
				return response({ result: null, success: true });
			}
			return response(envelope(rules.get(buckets[realm]) ?? []));
		}
		if (url.pathname.endsWith(bucketBase)) {
			return response({
				result: {
					name: buckets[realm],
					storage_class: storageClass[realm] ?? 'Standard'
				},
				success: true
			});
		}
		return response({ success: false }, 404);
	});
	return { buckets, fetchFn: fetchFn as typeof fetch & typeof fetchFn, rules };
}

const unrelated = {
	conditions: { prefix: 'exports/' },
	deleteObjectsTransition: { condition: { maxAge: 2_592_000, type: 'Age' } },
	enabled: true,
	id: 'expire-exports'
};
const obsolete = {
	conditions: { prefix: 'public-discovery/' },
	deleteObjectsTransition: { condition: { maxAge: 691_200, type: 'Age' } },
	enabled: true,
	id: OBSOLETE_LIFECYCLE_RULE_ID
};
const defaultMultipartAbort = {
	abortMultipartUploadsTransition: { condition: { maxAge: 604_800, type: 'Age' } },
	conditions: {},
	enabled: true,
	id: 'Default Multipart Abort Rule'
};

describe('public-discovery R2 lifecycle reconciliation', () => {
	it.each(['', 'p', 'public-discovery', 'public-discovery/', 'public-discovery/v8/'])(
		'detects overlapping prefix %j',
		(prefix) => expect(prefixOverlapsPublicDiscovery(prefix)).toBe(true)
	);

	it('normalizes an omitted optional rules field but rejects malformed envelopes', () => {
		expect(planPublicDiscoveryLifecycleReconciliation({ success: true, result: {} })).toEqual({
			changed: false,
			preserved: [],
			removed: []
		});
		expect(() =>
			planPublicDiscoveryLifecycleReconciliation({ success: true, result: { rules: null } })
		).toThrow(/absent or an array/i);
		expect(() =>
			planPublicDiscoveryLifecycleReconciliation({ success: false, result: { rules: [] } })
		).toThrow(/did not report success/i);
	});

	it('rejects unknown enabled deletion or storage transitions overlapping the namespace', () => {
		for (const rule of [
			{
				conditions: {},
				deleteObjectsTransition: { condition: { maxAge: 1, type: 'Age' } },
				enabled: true,
				id: 'prefixless-delete-everything'
			},
			{
				conditions: { prefix: '' },
				deleteObjectsTransition: { condition: { maxAge: 1, type: 'Age' } },
				enabled: true,
				id: 'delete-everything'
			},
			{
				conditions: { prefix: 'public-discovery/v8/' },
				enabled: true,
				id: 'tier-discovery',
				storageClassTransitions: [
					{ condition: { maxAge: 1, type: 'Age' }, storageClass: 'InfrequentAccess' }
				]
			}
		]) {
			expect(() => planPublicDiscoveryLifecycleReconciliation(envelope([rule]))).toThrow(
				/overlap public-discovery/i
			);
		}
	});

	it('preserves Cloudflare\'s prefixless multipart-abort default', () => {
		expect(
			planPublicDiscoveryLifecycleReconciliation(envelope([defaultMultipartAbort]))
		).toEqual({
			changed: false,
			preserved: [defaultMultipartAbort],
			removed: []
		});
	});

	it('removes only the obsolete rule, preserves unrelated rules, and re-reads proof', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(response(envelope([obsolete, defaultMultipartAbort, unrelated])))
			.mockResolvedValueOnce(response({ result: null, success: true }))
			.mockResolvedValueOnce(response(envelope([defaultMultipartAbort, unrelated])));

		await expect(
			reconcilePublicDiscoveryR2Lifecycle({
				accountId: ACCOUNT_ID,
				apiToken: 'token',
				fetchFn
			})
		).resolves.toEqual({
			changed: true,
			preservedRuleIds: ['Default Multipart Abort Rule', 'expire-exports'],
			removed: [OBSOLETE_LIFECYCLE_RULE_ID]
		});
		expect(fetchFn).toHaveBeenCalledTimes(3);
		expect(fetchFn.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
		const [, update] = fetchFn.mock.calls[1] as [string, RequestInit];
		expect(update.method).toBe('PUT');
		expect(JSON.parse(String(update.body))).toEqual({
			rules: [defaultMultipartAbort, unrelated]
		});
	});

	it('performs no PUT when live state is already safe', async () => {
		const fetchFn = vi.fn().mockResolvedValueOnce(response(envelope([unrelated])));
		await expect(
			reconcilePublicDiscoveryR2Lifecycle({
				accountId: ACCOUNT_ID,
				apiToken: 'token',
				fetchFn
			})
		).resolves.toEqual({ changed: false, preservedRuleIds: ['expire-exports'] });
		expect(fetchFn).toHaveBeenCalledOnce();
	});

	it('accepts the official no-rule GET shape without mutation', async () => {
		const fetchFn = vi.fn().mockResolvedValueOnce(response({ result: {}, success: true }));
		await expect(
			reconcilePublicDiscoveryR2Lifecycle({
				accountId: ACCOUNT_ID,
				apiToken: 'token',
				fetchFn
			})
		).resolves.toEqual({ changed: false, preservedRuleIds: [] });
		expect(fetchFn).toHaveBeenCalledOnce();
	});

	it('allows the exact non-production bucket but no third realm', async () => {
		const fetchFn = vi.fn().mockResolvedValue(response({ result: {}, success: true }));
		await expect(
			reconcilePublicDiscoveryR2Lifecycle({
				accountId: ACCOUNT_ID,
				apiToken: 'token',
				bucketName: PUBLIC_DISCOVERY_NONPROD_BUCKET,
				fetchFn
			})
		).resolves.toMatchObject({ changed: false });
		await expect(
			reconcilePublicDiscoveryR2Lifecycle({
				accountId: ACCOUNT_ID,
				apiToken: 'token',
				bucketName: 'attacker-bucket',
				fetchFn
			})
		).rejects.toThrow(/unexpected R2 bucket/i);
	});

	it('fails if the post-PUT read changed an unrelated rule', async () => {
		const changed = { ...unrelated, enabled: false };
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(response(envelope([obsolete, unrelated])))
			.mockResolvedValueOnce(response({ success: true }))
			.mockResolvedValueOnce(response(envelope([changed])));
		await expect(
			reconcilePublicDiscoveryR2Lifecycle({
				accountId: ACCOUNT_ID,
				apiToken: 'token',
				fetchFn
			})
		).rejects.toThrow(/changed unrelated rule/i);
	});
});

describe('public-discovery trusted storage preflight', () => {
	it('proves both realms, complete KV pagination, private domains, and bounded requests', async () => {
		const { fetchFn } = storageFixture({
			customDomains: {
				preview: [{ domain: 'retired-preview.example', enabled: false }],
				production: [{ domain: 'retired-production.example', enabled: false }]
			},
			pageSize: 3
		});
		await expect(
			verifyAndReconcilePublicDiscoveryStorage({
				accountId: ACCOUNT_ID,
				apiToken: 'exact-token',
				environment: 'all',
				fetchFn
			})
		).resolves.toMatchObject({
			environment: 'all',
			kvInventoryCount: 8,
			realms: {
				preview: {
					bucket: PUBLIC_DISCOVERY_NONPROD_BUCKET,
					customDomainCount: 1,
					lifecycle: { changed: false },
					storageClass: 'Standard'
				},
				production: {
					bucket: PUBLIC_DISCOVERY_BUCKET,
					customDomainCount: 1,
					lifecycle: { changed: false },
					storageClass: 'Standard'
				}
			}
		});
		const kvPages = fetchFn.mock.calls
			.map(([input]) => new URL(String(input)))
			.filter((url) => url.pathname.endsWith('/storage/kv/namespaces'));
		expect(kvPages.map((url) => url.searchParams.get('page'))).toEqual(['1', '2', '3']);
		expect(kvPages.every((url) => url.searchParams.get('per_page') === '1000')).toBe(true);
		expect(
			fetchFn.mock.calls.every(([, init]) => {
				const headers = new Headers(init?.headers);
				return (
					init?.redirect === 'error' &&
					init?.signal instanceof AbortSignal &&
					headers.get('authorization') === 'Bearer exact-token'
				);
			})
		).toBe(true);
	});

	it.each([
		['missing', (rows: ReturnType<typeof committedKvRows>) => rows.slice(1), /is missing/i],
		[
			'duplicated id',
			(rows: ReturnType<typeof committedKvRows>) => [...rows, { ...rows[0] }],
			/is duplicated/i
		],
		[
			'wrong title',
			(rows: ReturnType<typeof committedKvRows>) => [
				{ ...rows[0], title: 'attacker-title' },
				...rows.slice(1)
			],
			/title is not exact/i
		],
		[
			'duplicated committed title',
			(rows: ReturnType<typeof committedKvRows>) => [
				...rows,
				{ id: 'd'.repeat(32), title: rows[0].title }
			],
			/assigned to more than one id/i
		]
	])('rejects a %s KV namespace inventory', async (_label, mutate, expected) => {
		const { fetchFn } = storageFixture({ inventoryRows: mutate(committedKvRows()) });
		await expect(
			verifyAndReconcilePublicDiscoveryStorage({
				accountId: ACCOUNT_ID,
				apiToken: 'token',
				environment: 'all',
				fetchFn
			})
		).rejects.toThrow(expected);
	});

	it('fails closed on ambiguous or truncated KV pagination', async () => {
		const rows = committedKvRows();
		const missingInfo = vi.fn().mockResolvedValue(response({ result: rows, success: true }));
		await expect(
			verifyAndReconcilePublicDiscoveryStorage({
				accountId: ACCOUNT_ID,
				apiToken: 'token',
				environment: 'preview',
				fetchFn: missingInfo
			})
		).rejects.toThrow(/no result_info/i);

		const truncated = vi.fn().mockResolvedValue(
			response({
				result: rows.slice(0, 4),
				result_info: { count: 4, page: 1, per_page: 5, total_count: 8, total_pages: 2 },
				success: true
			})
		);
		await expect(
			verifyAndReconcilePublicDiscoveryStorage({
				accountId: ACCOUNT_ID,
				apiToken: 'token',
				environment: 'preview',
				fetchFn: truncated
			})
		).rejects.toThrow(/truncated or overfull/i);

		let page = 0;
		const drifting = vi.fn().mockImplementation(() => {
			page += 1;
			const pageRows = page === 1 ? rows.slice(0, 4) : rows.slice(4);
			return response({
				result: pageRows,
				result_info: {
					count: pageRows.length,
					page,
					per_page: 4,
					total_count: page === 1 ? 8 : 9,
					total_pages: page === 1 ? 2 : 3
				},
				success: true
			});
		});
		await expect(
			verifyAndReconcilePublicDiscoveryStorage({
				accountId: ACCOUNT_ID,
				apiToken: 'token',
				environment: 'all',
				fetchFn: drifting
			})
		).rejects.toThrow(/pagination changed/i);

		const pageStorm = vi.fn().mockResolvedValue(
			response({
				result: [rows[0]],
				result_info: {
					count: 1,
					page: 1,
					per_page: 1,
					total_count: 101,
					total_pages: 101
				},
				success: true
			})
		);
		await expect(
			verifyAndReconcilePublicDiscoveryStorage({
				accountId: ACCOUNT_ID,
				apiToken: 'token',
				environment: 'preview',
				fetchFn: pageStorm
			})
		).rejects.toThrow(/bounded pagination budget/i);
		expect(pageStorm).toHaveBeenCalledOnce();
	});

	it.each([
		[
			'non-Standard storage',
			() => storageFixture({ storageClass: { production: 'InfrequentAccess' } }),
			/not the exact live Standard bucket/i
		],
		[
			'exposed r2.dev',
			() => storageFixture({ managedEnabled: { production: true } }),
			/r2\.dev managed domain must be disabled/i
		],
		[
			'enabled custom domain',
			() =>
				storageFixture({
					customDomains: {
						production: [{ domain: 'public.example', enabled: true }]
					}
				}),
			/must be disabled/i
		],
		[
			'malformed custom-domain entry',
			() => storageFixture({ customDomains: { production: [{ enabled: false }] } }),
			/is malformed/i
		]
	])('rejects %s', async (_label, makeFixture, expected) => {
		const { fetchFn } = makeFixture();
		await expect(
			verifyAndReconcilePublicDiscoveryStorage({
				accountId: ACCOUNT_ID,
				apiToken: 'token',
				environment: 'production',
				fetchFn
			})
		).rejects.toThrow(expected);
	});

	it('reconciles lifecycle only after the selected realm storage proof and re-reads propagation', async () => {
		const { fetchFn, rules } = storageFixture({
			lifecycleRules: { production: [obsolete, defaultMultipartAbort, unrelated] }
		});
		await expect(
			verifyAndReconcilePublicDiscoveryStorage({
				accountId: ACCOUNT_ID,
				apiToken: 'token',
				environment: 'production',
				fetchFn
			})
		).resolves.toMatchObject({
			realms: {
				production: {
					lifecycle: {
						changed: true,
						removed: [OBSOLETE_LIFECYCLE_RULE_ID]
					}
				}
			}
		});
		expect(rules.get(PUBLIC_DISCOVERY_BUCKET)).toEqual([defaultMultipartAbort, unrelated]);
		const lifecycleCalls = fetchFn.mock.calls.filter(([input]) =>
			new URL(String(input)).pathname.endsWith('/lifecycle')
		);
		expect(lifecycleCalls.map(([, init]) => init?.method ?? 'GET')).toEqual([
			'GET',
			'PUT',
			'GET'
		]);
	});

	it('fails if lifecycle propagation does not remove the obsolete rule', async () => {
		const { fetchFn } = storageFixture({
			lifecycleRules: { preview: [obsolete] },
			persistLifecyclePut: false
		});
		await expect(
			verifyAndReconcilePublicDiscoveryStorage({
				accountId: ACCOUNT_ID,
				apiToken: 'token',
				environment: 'preview',
				fetchFn
			})
		).rejects.toThrow(/overlap|remains after reconciliation/i);
	});

	it.each([
		['preview', PUBLIC_DISCOVERY_NONPROD_BUCKET, PUBLIC_DISCOVERY_BUCKET],
		['production', PUBLIC_DISCOVERY_BUCKET, PUBLIC_DISCOVERY_NONPROD_BUCKET]
	] as const)('scopes %s proof and mutation to that realm', async (environment, included, excluded) => {
		const selectedRows = committedKvRows().filter(({ id }) =>
			Object.values(PAGES_KV_NAMESPACE_IDS[environment]).includes(id)
		);
		const { fetchFn } = storageFixture({ inventoryRows: selectedRows });
		const proof = await verifyAndReconcilePublicDiscoveryStorage({
			accountId: ACCOUNT_ID,
			apiToken: 'token',
			environment,
			fetchFn
		});
		expect(Object.keys(proof.realms)).toEqual([environment]);
		const paths = fetchFn.mock.calls.map(([input]) => new URL(String(input)).pathname);
		const calledBucket = (bucket: string) => {
			const base = `/r2/buckets/${bucket}`;
			return paths.some((path) => path.endsWith(base) || path.includes(`${base}/`));
		};
		expect(calledBucket(included)).toBe(true);
		expect(calledBucket(excluded)).toBe(false);
	});

	it('bounds response bodies and rejects malformed Cloudflare envelopes', async () => {
		const malformed = vi.fn().mockResolvedValue(response({ result: [], success: false }));
		await expect(
			verifyAndReconcilePublicDiscoveryStorage({
				accountId: ACCOUNT_ID,
				apiToken: 'token',
				environment: 'preview',
				fetchFn: malformed
			})
		).rejects.toThrow(/did not report success/i);

		const oversized = vi.fn().mockResolvedValue(
			new Response('x'.repeat(1024 * 1024 + 1), {
				headers: { 'content-length': String(1024 * 1024 + 1) },
				status: 200
			})
		);
		await expect(
			verifyAndReconcilePublicDiscoveryStorage({
				accountId: ACCOUNT_ID,
				apiToken: 'token',
				environment: 'preview',
				fetchFn: oversized
			})
		).rejects.toThrow(/exceeds 1048576 bytes/i);
	});

	it('accepts only exact CLI arguments and credentials', async () => {
		expect(parsePublicDiscoveryStorageArgs(['--environment', 'preview'])).toEqual({
			environment: 'preview'
		});
		expect(parsePublicDiscoveryStorageArgs(['--environment', 'production'])).toEqual({
			environment: 'production'
		});
		expect(parsePublicDiscoveryStorageArgs(['--environment', 'all'])).toEqual({
			environment: 'all'
		});
		for (const argv of [
			[],
			['--environment'],
			['--environment', 'staging'],
			['--unknown', 'preview'],
			['--environment', 'preview', '--environment', 'production']
		]) {
			expect(() => parsePublicDiscoveryStorageArgs(argv)).toThrow();
		}

		const { fetchFn } = storageFixture();
		for (const options of [
			{ accountId: ACCOUNT_ID.toUpperCase(), apiToken: 'token' },
			{ accountId: ACCOUNT_ID, apiToken: '' },
			{ accountId: ACCOUNT_ID, apiToken: ' token' }
		]) {
			await expect(
				verifyAndReconcilePublicDiscoveryStorage({
					...options,
					environment: 'preview',
					fetchFn
				})
			).rejects.toThrow(/CLOUDFLARE_/i);
		}
		expect(fetchFn).not.toHaveBeenCalled();
	});
});
