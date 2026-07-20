import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	PUBLIC_DISCOVERY_MANIFEST_CLAIM_LEASE_MS,
	PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_SURVIVAL_RESERVE_MS,
	PUBLIC_DISCOVERY_MANIFEST_CRON_HTTP_TIMEOUT_MS,
	PUBLIC_DISCOVERY_MANIFEST_CRON_POLL_MS,
	PUBLIC_DISCOVERY_MANIFEST_FRESH_MS,
	PUBLIC_DISCOVERY_MANIFEST_MAX_POLLS,
	PUBLIC_DISCOVERY_MANIFEST_OBJECT_MAX_BYTES,
	PUBLIC_DISCOVERY_MANIFEST_ORDINARY_GATE_MS,
	PUBLIC_DISCOVERY_MANIFEST_REVALIDATE_MS,
	PUBLIC_DISCOVERY_MANIFEST_SCHEDULER_JITTER_BUDGET_MS,
	PUBLIC_DISCOVERY_MANIFEST_SEED_PRIORITY_MS,
	PUBLIC_DISCOVERY_PUBLICATION_LAG_SLA_MS,
	clearPublicDiscoveryManifestShield,
	getGloballyShieldedPublicDiscoveryManifest,
	readPublicDiscoveryPublicationStatus,
	refreshGloballyShieldedPublicDiscoveryManifest,
	type PublicDiscoveryPublicationPlan,
	type PublicDiscoveryManifestValue
} from '$lib/server/public-discovery-manifest-shield';
import { planPublicTemplateOgBackfillRearm } from '../../../scripts/rearm-public-template-og-backfill.mjs';

const NOW = 1_800_000_000_000;
const CONVEX_URL = 'https://production.example.convex.cloud';

type StoredR2Object = {
	body: string;
	customMetadata?: Record<string, string>;
	etag: string;
	uploaded: Date;
};

type TestR2 = R2Bucket & {
	delete: ReturnType<typeof vi.fn>;
	entries: Map<string, StoredR2Object>;
	get: ReturnType<typeof vi.fn>;
	list: ReturnType<typeof vi.fn>;
	put: ReturnType<typeof vi.fn>;
};

function installR2(): TestR2 {
	const entries = new Map<string, StoredR2Object>();
	let nextEtag = 1;
	const object = (key: string, stored: StoredR2Object) => ({
		customMetadata: stored.customMetadata,
		etag: stored.etag,
		httpEtag: `"${stored.etag}"`,
		json: async <T>() => JSON.parse(stored.body) as T,
		key,
		size: new TextEncoder().encode(stored.body).byteLength,
		text: async () => stored.body,
		uploaded: stored.uploaded
	});
	const get = vi.fn(async (key: string) => {
		const stored = entries.get(key);
		return stored ? object(key, stored) : null;
	});
	const put = vi.fn(
		async (
			key: string,
			value: string,
			options?: {
				customMetadata?: Record<string, string>;
				onlyIf?: Headers | { etagMatches?: string };
			}
		) => {
			const existing = entries.get(key);
			const ifNoneMatch =
				options?.onlyIf instanceof Headers ? options.onlyIf.get('If-None-Match') : null;
			const etagMatches =
				options?.onlyIf && !(options.onlyIf instanceof Headers)
					? options.onlyIf.etagMatches
					: undefined;
			if (ifNoneMatch === '*' && existing) return null;
			if (etagMatches !== undefined && existing?.etag !== etagMatches) return null;
			const stored: StoredR2Object = {
				body: String(value),
				customMetadata: options?.customMetadata,
				etag: `etag-${nextEtag++}`,
				uploaded: new Date(Date.now())
			};
			entries.set(key, stored);
			return object(key, stored);
		}
	);
	return {
		delete: vi.fn(),
		entries,
		get,
		list: vi.fn(() => {
			throw new Error('manifest control plane must never list R2');
		}),
		put
	} as unknown as TestR2;
}

function context(r2: R2Bucket, host = 'commons.example'): {
	platform: App.Platform;
	url: URL;
} {
	return {
		platform: {
			env: { PUBLIC_CONVEX_URL: CONVEX_URL, PUBLIC_DISCOVERY_R2: r2 }
		} as App.Platform,
		url: new URL(`https://${host}/`)
	};
}

function installEdgeCache(): void {
	const entries = new Map<string, Response>();
	vi.stubGlobal('caches', {
		default: {
			match: vi.fn(async (key: Request) => entries.get(key.url)?.clone()),
			put: vi.fn(async (key: Request, response: Response) => {
				entries.set(key.url, response.clone());
			})
		}
	});
}

function ready(
	revision: number,
	updatedAt = revision * 100,
	retiredRevision = Math.max(0, revision - 1),
	withdrawalEpoch = 0
): PublicDiscoveryManifestValue {
	return {
		list: { ready: true, retiredRevision, revision, updatedAt, withdrawalEpoch },
		relations: { ready: true, retiredRevision, revision, updatedAt, withdrawalEpoch }
	};
}

function withdrawn(
	revision: number,
	updatedAt = revision * 100,
	withdrawalEpoch = 1
): PublicDiscoveryManifestValue {
	return {
		list: { ready: false, retiredRevision: revision, revision, updatedAt, withdrawalEpoch },
		relations: { ready: false, retiredRevision: revision, revision, updatedAt, withdrawalEpoch }
	};
}

function project(value: unknown): PublicDiscoveryManifestValue {
	if (!value || typeof value !== 'object') throw new Error('invalid manifest');
	const candidate = value as Record<string, unknown>;
	const family = (name: 'list' | 'relations'): PublicDiscoveryManifestValue[typeof name] => {
		const raw = candidate[name];
		if (!raw || typeof raw !== 'object') throw new Error('invalid manifest family');
		const projected = raw as Record<string, unknown>;
		return {
			...projected,
			// Schema-2 R2 and Cache API envelopes written before the epoch field are
			// a bounded rolling-deploy compatibility case. Missing alone maps to zero;
			// malformed values remain malformed and fail the shield validator.
			withdrawalEpoch: projected.withdrawalEpoch ?? 0
		} as PublicDiscoveryManifestValue[typeof name];
	};
	return { list: family('list'), relations: family('relations') };
}

function stateBody(r2: TestR2): Record<string, unknown> {
	const stored = [...r2.entries.values()][0];
	if (!stored) throw new Error('missing manifest state');
	return JSON.parse(stored.body);
}

function deferred<T>(): {
	promise: Promise<T>;
	reject: (error: unknown) => void;
	resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, reject, resolve };
}

describe('global public-discovery manifest shield', () => {
	beforeEach(() => {
		clearPublicDiscoveryManifestShield();
		vi.spyOn(Date, 'now').mockReturnValue(NOW);
		vi.stubGlobal('caches', undefined);
	});

	afterEach(() => {
		clearPublicDiscoveryManifestShield();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('makes a 24-POP request wave read-only after one two-write authenticated refresh', async () => {
		const r2 = installR2();
		const refreshLoader = vi.fn().mockResolvedValue(ready(1));
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			refreshLoader,
			project
		);
		expect(refreshLoader).toHaveBeenCalledOnce();
		expect(r2.put).toHaveBeenCalledTimes(2); // refreshing acquisition + fenced completion
		expect(r2.entries).toHaveLength(1);

		r2.put.mockClear();
		r2.get.mockClear();
		const isolates: Array<typeof import('$lib/server/public-discovery-manifest-shield')> = [];
		for (let index = 0; index < 24; index += 1) {
			vi.resetModules();
			isolates.push(await import('$lib/server/public-discovery-manifest-shield'));
		}
		const forbiddenOrigin = vi.fn().mockRejectedValue(new Error('request path called origin'));
		const results = await Promise.all(
			isolates.map((isolate, index) =>
				isolate.getGloballyShieldedPublicDiscoveryManifest(
					context(r2, `pop-${index}.commons.example`),
					forbiddenOrigin,
					project
				)
			)
		);

		expect(results.every((result) => result.manifest.list.revision === 1)).toBe(true);
		expect(forbiddenOrigin).not.toHaveBeenCalled();
		expect(r2.put).not.toHaveBeenCalled();
		expect(r2.list).not.toHaveBeenCalled();
		expect(r2.get).toHaveBeenCalledTimes(24);
	});

	it('gives one concurrent authenticated writer ownership and makes the loser poll only', async () => {
		const r2 = installR2();
		const winnerValue = deferred<PublicDiscoveryManifestValue>();
		const winnerLoader = vi.fn(() => winnerValue.promise);
		const loserLoader = vi.fn().mockResolvedValue(ready(99));
		vi.resetModules();
		const winnerIsolate = await import('$lib/server/public-discovery-manifest-shield');
		vi.resetModules();
		const loserIsolate = await import('$lib/server/public-discovery-manifest-shield');
		const winner = winnerIsolate.refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			winnerLoader,
			project
		);
		await vi.waitFor(() => expect(winnerLoader).toHaveBeenCalledOnce());
		const loser = loserIsolate.refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			loserLoader,
			project
		);
		winnerValue.resolve(ready(2));

		await expect(Promise.all([winner, loser])).resolves.toMatchObject([
			{ manifest: { list: { revision: 2 } } },
			{ manifest: { list: { revision: 2 } } }
		]);
		expect(loserLoader).not.toHaveBeenCalled();
		expect(r2.put).toHaveBeenCalledTimes(2);
		expect(r2.get.mock.calls.length).toBeLessThanOrEqual(PUBLIC_DISCOVERY_MANIFEST_MAX_POLLS + 2);
	});

	it('fences an old owner when takeover occurs and the successor crashes before completion', async () => {
		const r2 = installR2();
		const oldValue = deferred<PublicDiscoveryManifestValue>();
		vi.resetModules();
		const oldOwner = await import('$lib/server/public-discovery-manifest-shield');
		const oldRefresh = oldOwner.refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			() => oldValue.promise,
			project
		);
		await vi.waitFor(() => expect(r2.put).toHaveBeenCalledTimes(1));
		const oldLeaseEtag = [...r2.entries.values()][0].etag;

		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_DISCOVERY_MANIFEST_CLAIM_LEASE_MS + 1);
		const successorValue = deferred<PublicDiscoveryManifestValue>();
		vi.resetModules();
		const successor = await import('$lib/server/public-discovery-manifest-shield');
		const successorRefresh = successor.refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			() => successorValue.promise,
			project
		);
		await vi.waitFor(() => expect(r2.put).toHaveBeenCalledTimes(2));
		const successorLeaseEtag = [...r2.entries.values()][0].etag;
		expect(successorLeaseEtag).not.toBe(oldLeaseEtag);

		oldValue.resolve(ready(1));
		await expect(oldRefresh).rejects.toThrow('REFRESH_OWNER_FENCED');
		expect(stateBody(r2)).toMatchObject({ phase: 'refreshing' });
		successorValue.reject(new Error('successor crashed'));
		await expect(successorRefresh).rejects.toThrow('successor crashed');
	});

	it('rejects a delayed pre-change query instead of leasing it from completion time', async () => {
		const r2 = installR2();
		const delayed = deferred<PublicDiscoveryManifestValue>();
		const refresh = refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			() => delayed.promise,
			project
		);
		await vi.waitFor(() => expect(r2.put).toHaveBeenCalledOnce());
		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_DISCOVERY_MANIFEST_FRESH_MS + 1);
		delayed.resolve(ready(1));

		await expect(refresh).rejects.toThrow('REFRESH_COMPLETION_EXPIRED');
		expect(r2.put).toHaveBeenCalledOnce();
		await expect(
			getGloballyShieldedPublicDiscoveryManifest(
				context(r2, 'cold.commons.example'),
				vi.fn().mockResolvedValue(ready(99)),
				project
			)
		).rejects.toThrow('REFRESH_IN_PROGRESS');
	});

	it('revalidates locally every 60 seconds inside the exact nine-minute survival envelope', async () => {
		expect(PUBLIC_DISCOVERY_MANIFEST_REVALIDATE_MS).toBe(60 * 1000);
		expect(PUBLIC_DISCOVERY_MANIFEST_FRESH_MS).toBe(9 * 60 * 1000);
		expect(PUBLIC_DISCOVERY_MANIFEST_FRESH_MS).toBe(
			PUBLIC_DISCOVERY_MANIFEST_ORDINARY_GATE_MS +
				PUBLIC_DISCOVERY_MANIFEST_SEED_PRIORITY_MS +
				PUBLIC_DISCOVERY_MANIFEST_CRON_POLL_MS +
				PUBLIC_DISCOVERY_MANIFEST_CRON_HTTP_TIMEOUT_MS +
				PUBLIC_DISCOVERY_MANIFEST_SCHEDULER_JITTER_BUDGET_MS +
				PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_SURVIVAL_RESERVE_MS
		);
		expect(PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_SURVIVAL_RESERVE_MS).toBeGreaterThan(0);
		const r2 = installR2();
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(ready(1)),
			project
		);
		r2.get.mockClear();

		// The first delayed minute tick forces an exact global re-read without
		// extending the producer's original certification coordinate.
		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_DISCOVERY_MANIFEST_REVALIDATE_MS + 1);
		await expect(
			getGloballyShieldedPublicDiscoveryManifest(context(r2), vi.fn(), project)
		).resolves.toMatchObject({ manifest: { list: { revision: 1 } } });
		expect(r2.get).toHaveBeenCalledTimes(1);

		// A second delayed tick still has valid authority and revalidates again.
		vi.mocked(Date.now).mockReturnValue(
			NOW + PUBLIC_DISCOVERY_MANIFEST_REVALIDATE_MS * 2 + 2
		);
		await expect(
			getGloballyShieldedPublicDiscoveryManifest(context(r2), vi.fn(), project)
		).resolves.toMatchObject({ manifest: { list: { revision: 1 } } });
		expect(r2.get).toHaveBeenCalledTimes(2);

		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_DISCOVERY_MANIFEST_FRESH_MS + 1);
		await expect(
			getGloballyShieldedPublicDiscoveryManifest(context(r2), vi.fn(), project)
		).rejects.toThrow('AUTHORITY_EXPIRED');
	});

	it('retains a producer floor when false→ready completes entirely between R2 refreshes', async () => {
		const r2 = installR2();
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(ready(4, 400, 3)),
			project
		);
		clearPublicDiscoveryManifestShield();
		const postDestructiveReady = ready(5, 500, 4, 1);
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(postDestructiveReady),
			project
		);

		expect(stateBody(r2)).toMatchObject({
			manifest: postDestructiveReady,
			withdrawalFloors: { list: 4, relations: 4 }
		});
	});

	it('stages a missed false→ready epoch before prewarm and keeps old content denied across takeover', async () => {
		const r2 = installR2();
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(ready(4, 400, 3, 0)),
			project
		);
		clearPublicDiscoveryManifestShield();
		const recovered = ready(5, 500, 4, 1);
		let firstPlan: PublicDiscoveryPublicationPlan | undefined;
		const refresh = refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(recovered),
			project,
			{
				beforePublish: async (_loaded, _previous, plan) => {
					firstPlan = plan;
					expect(stateBody(r2)).toMatchObject({
						phase: 'refreshing',
						previous: {
							manifest: {
								list: { ready: false, revision: 4, withdrawalEpoch: 1 },
								relations: { ready: false, revision: 4, withdrawalEpoch: 1 }
							},
							pendingRetireGenerations: {
								list: ['4:400'],
								graph: ['list=4:400;relations=4:400']
							}
						}
					});
					const duringPrewarm = await getGloballyShieldedPublicDiscoveryManifest(
						context(r2, 'missed-withdrawal.commons.example'),
						vi.fn().mockRejectedValue(new Error('origin forbidden')),
						project
					);
					expect(duringPrewarm.manifest.list.ready).toBe(false);
					expect(duringPrewarm.manifest.relations.ready).toBe(false);
					throw new Error('payload prewarm failed');
				}
			}
		);

		await expect(refresh).rejects.toThrow('payload prewarm failed');
		expect(firstPlan).toEqual({
			retireGenerations: {
				list: ['4:400'],
				graph: ['list=4:400;relations=4:400']
			}
		});
		clearPublicDiscoveryManifestShield();
		await expect(
			getGloballyShieldedPublicDiscoveryManifest(
				context(r2, 'missed-withdrawal-failed.commons.example'),
				vi.fn().mockRejectedValue(new Error('origin forbidden')),
				project
			)
		).resolves.toMatchObject({
			manifest: { list: { ready: false }, relations: { ready: false } }
		});

		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_DISCOVERY_MANIFEST_CLAIM_LEASE_MS + 1);
		clearPublicDiscoveryManifestShield();
		let takeoverPlan: PublicDiscoveryPublicationPlan | undefined;
		await expect(
			refreshGloballyShieldedPublicDiscoveryManifest(
				{ platform: context(r2).platform },
				vi.fn().mockResolvedValue(recovered),
				project,
				{
					beforePublish: async (_loaded, _previous, plan) => {
						takeoverPlan = plan;
					}
				}
			)
		).resolves.toMatchObject({ manifest: recovered });
		expect(takeoverPlan).toEqual(firstPlan);
		expect(stateBody(r2)).toMatchObject({
			manifest: recovered,
			pendingRetireGenerations: { list: [], graph: [] },
			phase: 'ready'
		});
	});

	it('keeps the previous ready authority available when an ordinary prewarm fails', async () => {
		const r2 = installR2();
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(ready(4, 400, 3, 2)),
			project
		);
		clearPublicDiscoveryManifestShield();
		const ordinary = ready(5, 500, 4, 2);
		await expect(
			refreshGloballyShieldedPublicDiscoveryManifest(
				{ platform: context(r2).platform },
				vi.fn().mockResolvedValue(ordinary),
				project,
				{
					beforePublish: async () => {
						expect(stateBody(r2)).toMatchObject({
							phase: 'refreshing',
							previous: {
								manifest: { list: { ready: true, revision: 4, withdrawalEpoch: 2 } }
							}
						});
						throw new Error('ordinary prewarm failed');
					}
				}
			)
		).rejects.toThrow('ordinary prewarm failed');

		clearPublicDiscoveryManifestShield();
		await expect(
			getGloballyShieldedPublicDiscoveryManifest(
				context(r2, 'ordinary-failed.commons.example'),
				vi.fn().mockRejectedValue(new Error('origin forbidden')),
				project
			)
		).resolves.toMatchObject({
			manifest: { list: { ready: true, revision: 4, withdrawalEpoch: 2 } }
		});
	});

	it('recertifies prior ready authority across a retryable multi-cycle publication', async () => {
		const r2 = installR2();
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(ready(4, 400, 3, 2)),
			project
		);
		const retryAt = NOW + PUBLIC_DISCOVERY_MANIFEST_FRESH_MS - 1;
		vi.mocked(Date.now).mockReturnValue(retryAt);
		clearPublicDiscoveryManifestShield();
		const retryable = new Error('bounded publication incomplete');
		await expect(
			refreshGloballyShieldedPublicDiscoveryManifest(
				{ platform: context(r2).platform },
				vi.fn().mockResolvedValue(ready(5, 500, 4, 2)),
				project,
				{
					beforePublish: async () => {
						throw retryable;
					},
					restorePreviousOnBeforePublishError: (error) => error === retryable
				}
			)
		).rejects.toBe(retryable);
		expect(stateBody(r2)).toMatchObject({
			phase: 'ready',
			certifiedAt: retryAt,
			manifest: { list: { ready: true, revision: 4 } }
		});

		// The original certificate is now expired; only the durable retry receipt
		// can keep the prior authority available to an anonymous, origin-free read.
		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_DISCOVERY_MANIFEST_FRESH_MS + 1);
		clearPublicDiscoveryManifestShield();
		await expect(
			getGloballyShieldedPublicDiscoveryManifest(
				context(r2, 'multi-cycle-retry.commons.example'),
				vi.fn().mockRejectedValue(new Error('origin forbidden')),
				project
			)
		).resolves.toMatchObject({ manifest: { list: { revision: 4, ready: true } } });
	});

	it('keeps terminal readiness through an operator rearm and another failed publication', async () => {
		const r2 = installR2();
		const platform = context(r2).platform;
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform },
			vi.fn().mockResolvedValue(ready(4, 400, 3, 2)),
			project
		);
		const target = ready(5, 500, 4, 2);
		const terminalAt = NOW + 1_000;
		vi.mocked(Date.now).mockReturnValue(terminalAt);
		clearPublicDiscoveryManifestShield();
		const exhausted = new Error('Queue repair exhausted');
		await expect(
			refreshGloballyShieldedPublicDiscoveryManifest(
				{ platform },
				vi.fn().mockResolvedValue(target),
				project,
				{
					beforePublish: async () => {
						throw exhausted;
					},
					publicationFailureCode: (error) =>
						error === exhausted ? 'REPAIR_EXHAUSTED' : null,
					restorePreviousOnBeforePublishError: () => true
				}
			)
		).rejects.toBe(exhausted);
		expect(stateBody(r2)).toMatchObject({
			publicationLag: {
				startedAt: terminalAt,
				lastObservedAt: terminalAt,
				targetGeneration: 'list=5:500;relations=5:500',
				terminalCode: 'REPAIR_EXHAUSTED'
			}
		});

		// The operator's exact-key checkpoint CAS does not mutate shield state. The
		// next producer failure is retryable, but it must not clear terminal health.
		const afterRearmAt = terminalAt + 1_000;
		const rearm = planPublicTemplateOgBackfillRearm({
			checkpoint: {
				version: 1,
				generation: 'ready:5:500:epoch=2:artifact-set=3',
				coordinateDigest: 'd'.repeat(64),
				coordinates: [{ artifactRevision: 5, slug: 'target', templateId: 'template-5' }],
				total: 1,
				nextOffset: 0,
				enqueuedOffset: 1,
				enqueuedAt: terminalAt - 120_000,
				enqueueAttempts: 2
			},
			expectedCoordinateDigest: 'd'.repeat(64),
			now: terminalAt
		});
		expect(rearm.next).toMatchObject({
			nextOffset: 0,
			enqueuedOffset: 0,
			enqueuedAt: null,
			enqueueAttempts: 0
		});
		expect(stateBody(r2)).toMatchObject({
			publicationLag: { terminalCode: 'REPAIR_EXHAUSTED' }
		});
		vi.mocked(Date.now).mockReturnValue(afterRearmAt);
		clearPublicDiscoveryManifestShield();
		const incomplete = new Error('rearmed Queue handoff incomplete');
		await expect(
			refreshGloballyShieldedPublicDiscoveryManifest(
				{ platform },
				vi.fn().mockResolvedValue(target),
				project,
				{
					beforePublish: async () => {
						throw incomplete;
					},
					publicationFailureCode: () => null,
					restorePreviousOnBeforePublishError: () => true
				}
			)
		).rejects.toBe(incomplete);
		expect(stateBody(r2)).toMatchObject({
			publicationLag: {
				startedAt: terminalAt,
				lastObservedAt: afterRearmAt,
				terminalCode: 'REPAIR_EXHAUSTED'
			}
		});
		await expect(readPublicDiscoveryPublicationStatus({ platform })).resolves.toMatchObject({
			healthy: false,
			status: 'terminal',
			terminalCode: 'REPAIR_EXHAUSTED'
		});
		clearPublicDiscoveryManifestShield();
		await expect(
			getGloballyShieldedPublicDiscoveryManifest(
				context(r2, 'terminal-lkg.commons.example'),
				vi.fn().mockRejectedValue(new Error('origin forbidden')),
				project
			)
		).resolves.toMatchObject({ manifest: { list: { revision: 4, ready: true } } });

		clearPublicDiscoveryManifestShield();
		await expect(
			refreshGloballyShieldedPublicDiscoveryManifest(
				{ platform },
				vi.fn().mockResolvedValue(target),
				project,
				{ beforePublish: async () => undefined }
			)
		).resolves.toMatchObject({ manifest: { list: { revision: 5 } } });
		expect(stateBody(r2)).toMatchObject({ publicationLag: null });
		await expect(readPublicDiscoveryPublicationStatus({ platform })).resolves.toMatchObject({
			healthy: true,
			status: 'ready',
			terminalCode: null
		});
	});

	it('preserves one lag clock across retries and superseding targets through the exact SLA boundary', async () => {
		const r2 = installR2();
		const platform = context(r2).platform;
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform },
			vi.fn().mockResolvedValue(ready(4, 400, 3, 2)),
			project
		);
		const startedAt = NOW + 1_000;
		const retryable = new Error('publication incomplete');
		const failAt = async (at: number, target: PublicDiscoveryManifestValue) => {
			vi.mocked(Date.now).mockReturnValue(at);
			clearPublicDiscoveryManifestShield();
			await expect(
				refreshGloballyShieldedPublicDiscoveryManifest(
					{ platform },
					vi.fn().mockResolvedValue(target),
					project,
					{
						beforePublish: async () => {
							throw retryable;
						},
						restorePreviousOnBeforePublishError: () => true
					}
				)
			).rejects.toBe(retryable);
		};
		await failAt(startedAt, ready(5, 500, 4, 2));
		await failAt(
			startedAt + PUBLIC_DISCOVERY_PUBLICATION_LAG_SLA_MS,
			ready(6, 600, 5, 2)
		);
		expect(stateBody(r2)).toMatchObject({
			publicationLag: {
				startedAt,
				lastObservedAt: startedAt + PUBLIC_DISCOVERY_PUBLICATION_LAG_SLA_MS,
				targetGeneration: 'list=6:600;relations=6:600',
				terminalCode: null
			}
		});
		await expect(readPublicDiscoveryPublicationStatus({ platform })).resolves.toMatchObject({
			healthy: true,
			lagAgeMs: PUBLIC_DISCOVERY_PUBLICATION_LAG_SLA_MS,
			status: 'active'
		});
		clearPublicDiscoveryManifestShield();
		await expect(
			getGloballyShieldedPublicDiscoveryManifest(
				context(r2, 'lag-boundary.commons.example'),
				vi.fn().mockRejectedValue(new Error('origin forbidden')),
				project
			)
		).resolves.toMatchObject({ manifest: { list: { revision: 4, ready: true } } });

		vi.mocked(Date.now).mockReturnValue(
			startedAt + PUBLIC_DISCOVERY_PUBLICATION_LAG_SLA_MS + 1
		);
		clearPublicDiscoveryManifestShield();
		await expect(readPublicDiscoveryPublicationStatus({ platform })).resolves.toMatchObject({
			healthy: false,
			status: 'overdue'
		});
		await expect(
			getGloballyShieldedPublicDiscoveryManifest(
				context(r2, 'lag-overdue.commons.example'),
				vi.fn().mockRejectedValue(new Error('origin forbidden')),
				project
			)
		).rejects.toThrow('AUTHORITY_EXPIRED');
	});

	it('fails authenticated publication proof closed on legacy, malformed, and backward-clock state', async () => {
		const r2 = installR2();
		const platform = context(r2).platform;
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform },
			vi.fn().mockResolvedValue(ready(4, 400, 3, 2)),
			project
		);
		const stored = [...r2.entries.values()][0]!;
		const legacy = JSON.parse(stored.body) as Record<string, unknown>;
		delete legacy.publicationLag;
		stored.body = JSON.stringify(legacy);
		clearPublicDiscoveryManifestShield();
		await expect(readPublicDiscoveryPublicationStatus({ platform })).resolves.toMatchObject({
			healthy: false,
			status: 'terminal',
			terminalCode: 'LEGACY_PUBLICATION_STATE_UNKNOWN'
		});

		const malformed = JSON.parse(stored.body) as Record<string, unknown>;
		malformed.publicationLag = {
			startedAt: NOW + 1,
			lastObservedAt: NOW,
			targetGeneration: 'list=5:500;relations=5:500',
			terminalCode: null
		};
		stored.body = JSON.stringify(malformed);
		clearPublicDiscoveryManifestShield();
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		await expect(readPublicDiscoveryPublicationStatus({ platform })).resolves.toMatchObject({
			healthy: false,
			status: 'unavailable'
		});

		stored.body = JSON.stringify({ ...legacy, publicationLag: null });
		vi.mocked(Date.now).mockReturnValue(NOW - 1);
		clearPublicDiscoveryManifestShield();
		await expect(readPublicDiscoveryPublicationStatus({ platform })).resolves.toMatchObject({
			healthy: false,
			status: 'clock-regression',
			terminalCode: 'CLOCK_REGRESSION'
		});
	});

	it('never restores a pre-withdrawal ready authority after destructive staging', async () => {
		const r2 = installR2();
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(ready(4, 400, 3, 0)),
			project
		);
		clearPublicDiscoveryManifestShield();
		const retryable = new Error('withdrawal publication incomplete');
		await expect(
			refreshGloballyShieldedPublicDiscoveryManifest(
				{ platform: context(r2).platform },
				vi.fn().mockResolvedValue(withdrawn(4, 400, 1)),
				project,
				{
					beforePublish: async () => {
						throw retryable;
					},
					restorePreviousOnBeforePublishError: () => true
				}
			)
		).rejects.toBe(retryable);
		expect(stateBody(r2)).toMatchObject({
			phase: 'refreshing',
			previous: {
				manifest: { list: { ready: false, retiredRevision: 4, withdrawalEpoch: 1 } }
			}
		});
	});

	it('keeps list authority while a missed relations-only withdrawal retires only the graph', async () => {
		const r2 = installR2();
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(ready(4, 400, 3, 0)),
			project
		);
		clearPublicDiscoveryManifestShield();
		const relationsRecovered: PublicDiscoveryManifestValue = {
			list: {
				ready: true,
				retiredRevision: 3,
				revision: 4,
				updatedAt: 400,
				withdrawalEpoch: 0
			},
			relations: {
				ready: true,
				retiredRevision: 4,
				revision: 5,
				updatedAt: 500,
				withdrawalEpoch: 1
			}
		};

		await expect(
			refreshGloballyShieldedPublicDiscoveryManifest(
				{ platform: context(r2).platform },
				vi.fn().mockResolvedValue(relationsRecovered),
				project,
				{
					beforePublish: async (_loaded, _previous, plan) => {
						expect(plan).toEqual({
							retireGenerations: {
								list: [],
								graph: ['list=4:400;relations=4:400']
							}
						});
						expect(stateBody(r2)).toMatchObject({
							previous: {
								manifest: {
									list: { ready: true, revision: 4, withdrawalEpoch: 0 },
									relations: { ready: false, revision: 4, withdrawalEpoch: 1 }
								}
							}
						});
						throw new Error('relations prewarm failed');
					}
				}
			)
		).rejects.toThrow('relations prewarm failed');

		clearPublicDiscoveryManifestShield();
		await expect(
			getGloballyShieldedPublicDiscoveryManifest(
				context(r2, 'relations-withdrawal.commons.example'),
				vi.fn().mockRejectedValue(new Error('origin forbidden')),
				project
			)
		).resolves.toMatchObject({
			manifest: { list: { ready: true }, relations: { ready: false } }
		});
	});

	it('rejects a higher revision that rolls back a withdrawal epoch', async () => {
		const r2 = installR2();
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(ready(4, 400, 3, 2)),
			project
		);
		clearPublicDiscoveryManifestShield();

		await expect(
			refreshGloballyShieldedPublicDiscoveryManifest(
				{ platform: context(r2).platform },
				vi.fn().mockResolvedValue(ready(5, 500, 4, 1)),
				project
			)
		).rejects.toThrow('INCOMPARABLE_MANIFEST');
	});

	it('rejects an advanced withdrawal epoch whose floor does not retire prior authority', async () => {
		const r2 = installR2();
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(ready(4, 400, 3, 0)),
			project
		);
		clearPublicDiscoveryManifestShield();

		await expect(
			refreshGloballyShieldedPublicDiscoveryManifest(
				{ platform: context(r2).platform },
				vi.fn().mockResolvedValue(ready(5, 500, 3, 1)),
				project
			)
		).rejects.toThrow('INCOMPARABLE_MANIFEST');
	});

	it('projects pre-epoch schema-2 R2 authority as epoch zero', async () => {
		const r2 = installR2();
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(ready(4)),
			project
		);
		const stored = [...r2.entries.values()][0];
		if (!stored) throw new Error('missing manifest state');
		const legacy = JSON.parse(stored.body) as {
			manifest: { list: Record<string, unknown>; relations: Record<string, unknown> };
		};
		delete legacy.manifest.list.withdrawalEpoch;
		delete legacy.manifest.relations.withdrawalEpoch;
		stored.body = JSON.stringify(legacy);
		clearPublicDiscoveryManifestShield();

		await expect(
			getGloballyShieldedPublicDiscoveryManifest(
				context(r2, 'legacy-epoch.commons.example'),
				vi.fn().mockRejectedValue(new Error('origin forbidden')),
				project
			)
		).resolves.toMatchObject({
			manifest: {
				list: { ready: true, withdrawalEpoch: 0 },
				relations: { ready: true, withdrawalEpoch: 0 }
			}
		});
	});

	it('retains a three-generation ring and retires N-3 but never current or previous', async () => {
		const r2 = installR2();
		let finalPlan: PublicDiscoveryPublicationPlan | undefined;
		for (let revision = 1; revision <= 4; revision += 1) {
			await refreshGloballyShieldedPublicDiscoveryManifest(
				{ platform: context(r2).platform },
				vi.fn().mockResolvedValue(ready(revision)),
				project,
				{
					beforePublish: async (_next, _previous, plan) => {
						if (revision === 4) finalPlan = plan;
					}
				}
			);
		}

		expect(finalPlan).toEqual({
			retireGenerations: {
				list: ['1:100'],
				graph: ['list=1:100;relations=1:100']
			}
		});
		expect(finalPlan?.retireGenerations.list).not.toContain('3:300');
		expect(finalPlan?.retireGenerations.list).not.toContain('4:400');
		expect(finalPlan?.retireGenerations.graph).not.toContain(
			'list=3:300;relations=3:300'
		);
		expect(finalPlan?.retireGenerations.graph).not.toContain(
			'list=4:400;relations=4:400'
		);
		expect(stateBody(r2)).toMatchObject({
			payloadGenerations: {
				list: ['2:200', '3:300', '4:400'],
				graph: [
					'list=2:200;relations=2:200',
					'list=3:300;relations=3:300',
					'list=4:400;relations=4:400'
				]
			}
		});
	});

	it('stages a withdrawal before prewarm and preserves it when prewarm fails', async () => {
		const r2 = installR2();
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(ready(4, 400, 3)),
			project
		);
		const next = {
			list: {
				ready: false,
				retiredRevision: 4,
				revision: 4,
				updatedAt: 400,
				withdrawalEpoch: 1
			},
			relations: {
				ready: true,
				retiredRevision: 4,
				revision: 5,
				updatedAt: 500,
				withdrawalEpoch: 0
			}
		};
		const refresh = refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(next),
			project,
			{
				beforePublish: async (_loaded, _previous, plan) => {
					expect(plan.retireGenerations.list).toEqual(['4:400']);
					expect(stateBody(r2)).toMatchObject({
						phase: 'refreshing',
						previous: {
							manifest: { list: { ready: false, retiredRevision: 4 } },
							pendingRetireGenerations: {
								list: ['4:400'],
								graph: ['list=4:400;relations=4:400']
							},
							payloadGenerations: { list: [] }
						}
					});
					const duringPrewarm = await getGloballyShieldedPublicDiscoveryManifest(
						context(r2, 'during-withdrawal.commons.example'),
						vi.fn().mockRejectedValue(new Error('origin forbidden')),
						project
					);
					expect(duringPrewarm.manifest.list.ready).toBe(false);
					throw new Error('payload prewarm failed');
				}
			}
		);

		await expect(refresh).rejects.toThrow('payload prewarm failed');
		clearPublicDiscoveryManifestShield();
		const afterFailure = await getGloballyShieldedPublicDiscoveryManifest(
			context(r2, 'after-withdrawal.commons.example'),
			vi.fn().mockRejectedValue(new Error('origin forbidden')),
			project
		);
		expect(afterFailure.manifest.list.ready).toBe(false);

		// A cleanup can partially succeed before a sibling deletion or prewarm
		// fails. The staged tombstone must retain every exact coordinate so the
		// next owner retries idempotently instead of orphaning private payloads.
		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_DISCOVERY_MANIFEST_CLAIM_LEASE_MS + 1);
		clearPublicDiscoveryManifestShield();
		let retryPlan: PublicDiscoveryPublicationPlan | undefined;
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(next),
			project,
			{
				beforePublish: async (_loaded, _previous, plan) => {
					retryPlan = plan;
				}
			}
		);
		expect(retryPlan).toEqual({
			retireGenerations: {
				list: ['4:400'],
				graph: ['list=4:400;relations=4:400']
			}
		});
		expect(stateBody(r2)).toMatchObject({
			pendingRetireGenerations: { list: [], graph: [] },
			phase: 'ready'
		});
	});

	it.each([
		{
			list: {
				ready: false,
				retiredRevision: 4,
				revision: 4,
				updatedAt: 400,
				withdrawalEpoch: 1
			},
			relations: {
				ready: true,
				retiredRevision: 3,
				revision: 4,
				updatedAt: 400,
				withdrawalEpoch: 0
			}
		},
		{
			list: {
				ready: true,
				retiredRevision: 3,
				revision: 4,
				updatedAt: 400,
				withdrawalEpoch: 0
			},
			relations: {
				ready: false,
				retiredRevision: 4,
				revision: 4,
				updatedAt: 400,
				withdrawalEpoch: 1
			}
		}
	])('fails both families closed when a mixed tombstone authority expires', async (manifest) => {
		const r2 = installR2();
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(manifest),
			project
		);
		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_DISCOVERY_MANIFEST_FRESH_MS + 1);
		clearPublicDiscoveryManifestShield();
		const result = await getGloballyShieldedPublicDiscoveryManifest(
			context(r2, 'mixed-outage.commons.example'),
			vi.fn().mockResolvedValue(ready(99)),
			project
		);
		expect(result.manifest.list.ready).toBe(false);
		expect(result.manifest.relations.ready).toBe(false);
	});

	it('recovers a withdrawn authority only with a newer ready generation above the floor', async () => {
		const r2 = installR2();
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(withdrawn(4, 400)),
			project
		);
		clearPublicDiscoveryManifestShield();
		const recovered = await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(ready(5, 500, 4, 1)),
			project
		);
		expect(recovered).toMatchObject({
			manifest: { list: { ready: true, revision: 5 } },
			withdrawalFloors: { list: 4, relations: 4 }
		});
	});

	it('memoizes outage denial without writes, polls, lists, or origin work', async () => {
		const r2 = installR2();
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(ready(1)),
			project
		);
		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_DISCOVERY_MANIFEST_FRESH_MS + 1);
		clearPublicDiscoveryManifestShield();
		r2.get.mockClear();
		r2.put.mockClear();
		const origin = vi.fn().mockRejectedValue(new Error('must stay read-only'));
		const requests = Array.from({ length: 100 }, (_, index) =>
			getGloballyShieldedPublicDiscoveryManifest(
				context(r2, `flood-${index}.commons.example`),
				origin,
				project
			).catch((error) => error)
		);
		await Promise.all(requests);
		await getGloballyShieldedPublicDiscoveryManifest(
			context(r2, 'repeat.commons.example'),
			origin,
			project
		).catch(() => undefined);

		expect(origin).not.toHaveBeenCalled();
		expect(r2.put).not.toHaveBeenCalled();
		expect(r2.list).not.toHaveBeenCalled();
		// One module flight pays one exact Class-B GET. The local negative lease
		// keeps the later request read-only even after that flight settles.
		expect(r2.get).toHaveBeenCalledOnce();
	});

	it('shares a bounded outage denial through Cache API with a cold module isolate', async () => {
		const r2 = installR2();
		await refreshGloballyShieldedPublicDiscoveryManifest(
			{ platform: context(r2).platform },
			vi.fn().mockResolvedValue(ready(1)),
			project
		);
		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_DISCOVERY_MANIFEST_FRESH_MS + 1);
		clearPublicDiscoveryManifestShield();
		installEdgeCache();
		r2.get.mockClear();

		await expect(
			getGloballyShieldedPublicDiscoveryManifest(context(r2), vi.fn(), project)
		).rejects.toThrow('AUTHORITY_EXPIRED');
		expect(r2.get).toHaveBeenCalledOnce();

		vi.resetModules();
		const cold = await import('$lib/server/public-discovery-manifest-shield');
		await expect(
			cold.getGloballyShieldedPublicDiscoveryManifest(context(r2), vi.fn(), project)
		).rejects.toThrow('AUTHORITY_EXPIRED');
		expect(r2.get).toHaveBeenCalledOnce();
	});

	it('rejects an oversized fixed state object without listing, writing, or origin fallback', async () => {
		expect(PUBLIC_DISCOVERY_MANIFEST_OBJECT_MAX_BYTES).toBe(4 * 1024);
		const r2 = installR2();
		const realm = encodeURIComponent(`backend=${new URL(CONVEX_URL).origin}`);
		r2.entries.set(`public-discovery/v8/${realm}/control/manifest/state.json`, {
			body: 'x'.repeat(PUBLIC_DISCOVERY_MANIFEST_OBJECT_MAX_BYTES + 1),
			etag: 'oversized',
			uploaded: new Date(NOW)
		});
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const origin = vi.fn().mockResolvedValue(ready(1));

		await expect(
			getGloballyShieldedPublicDiscoveryManifest(context(r2), origin, project)
		).rejects.toThrow('R2_STATE_UNREADABLE');
		expect(origin).not.toHaveBeenCalled();
		expect(r2.put).not.toHaveBeenCalled();
		expect(r2.list).not.toHaveBeenCalled();
	});

	it.each(['declared', 'lengthless'] as const)(
		'rejects a %s oversized Cache API envelope with a bounded stream read',
		async (kind) => {
			const r2 = installR2();
			await refreshGloballyShieldedPublicDiscoveryManifest(
				{ platform: context(r2).platform },
				vi.fn().mockResolvedValue(ready(1)),
				project
			);
			clearPublicDiscoveryManifestShield();
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(
						new TextEncoder().encode(
							'x'.repeat(PUBLIC_DISCOVERY_MANIFEST_OBJECT_MAX_BYTES + 1)
						)
					);
					controller.close();
				}
			});
			const response = new Response(body, {
				headers:
					kind === 'declared'
						? { 'content-length': String(PUBLIC_DISCOVERY_MANIFEST_OBJECT_MAX_BYTES + 1) }
						: undefined
			});
			const match = vi.fn(async () => response.clone());
			vi.stubGlobal('caches', {
				default: { match, put: vi.fn().mockResolvedValue(undefined) }
			});
			const origin = vi.fn().mockResolvedValue(ready(99));

			await expect(
				getGloballyShieldedPublicDiscoveryManifest(context(r2), origin, project)
			).resolves.toMatchObject({ manifest: { list: { revision: 1 } } });
			expect(origin).not.toHaveBeenCalled();
			expect(r2.get).toHaveBeenCalled();
		}
	);
});
