import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockServerQuery, api } = vi.hoisted(() => ({
	mockServerQuery: vi.fn(),
	api: {
			templates: {
			publicDiscoveryManifest: 'templates.publicDiscoveryManifest',
			publicDiscoveryList: 'templates.publicDiscoveryList',
			publicDiscoveryRelations: 'templates.publicDiscoveryRelations',
			publicTemplatePageArtifactInventoryPage:
				'templates.publicTemplatePageArtifactInventoryPage',
			publicTemplatePageArtifactsByCoordinates:
				'templates.publicTemplatePageArtifactsByCoordinates'
		}
	}
}));

vi.mock('convex-sveltekit', () => ({ serverQuery: mockServerQuery }));
vi.mock('$lib/convex', () => ({ api }));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: () => 'public-discovery-test-secret-32-bytes'
}));

import {
	PublicDiscoverySnapshotContractError,
	PublicDiscoverySnapshotNotReadyError,
	PublicTemplatePageBackfillIncompleteError,
	PublicTemplateOgQueueSendFailedError,
	PublicTemplateOgQueueStalledError,
	PUBLIC_TEMPLATE_PAGE_PUBLICATION_BATCH_MAX,
	PUBLIC_TEMPLATE_OG_QUEUE_REPAIR_DELAY_MS,
	getCachedPublicDiscoveryGraphSurface,
	getCachedPublicRelations,
	getCachedPublicTemplatePageArtifact,
	getCachedPublicTemplates,
	refreshPublicDiscoveryManifestControl as refreshPublicDiscoveryManifestControlWithBudget
} from '$lib/server/public-template-queries';
import {
	clearPublicDiscoveryCache,
	publishPublicDiscoveryPayload
} from '$lib/server/public-discovery-cache';
import {
	PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX,
	buildPublicTemplateOgQueueJob,
	publicTemplatePageArtifactObjectKeys
} from '$lib/server/public-template-og-queue';
import { PUBLIC_TEMPLATE_PAGE_INVENTORY_MAX_ENTRIES } from '$lib/server/public-template-page-artifact';
import {
	PUBLIC_DISCOVERY_MANIFEST_FRESH_MS,
	PUBLIC_DISCOVERY_MANIFEST_REVALIDATE_MS
} from '$lib/server/public-discovery-manifest-shield';
import {
	PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS,
	PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS,
	publicDiscoveryManifestControlRetryDelayMs
} from '../../../convex/lib/publicDiscovery';
import { CONVEX_WORK_BUDGET_MAXIMUM_CONTINUATION_ADMISSIONS_PER_REALM_DAY } from '$lib/server/convex-work-budget-policy';

const URL = new globalThis.URL('https://commons.example/');
const TEST_CONVEX_URL = 'https://production.example.convex.cloud';
const CONTEXT = { url: URL };
const mockReserveOgQueueAttempts = vi.fn();

function refreshPublicDiscoveryManifestControl(
	context: Omit<
		Parameters<typeof refreshPublicDiscoveryManifestControlWithBudget>[0],
		'reserveOgQueueAttempts'
	>
) {
	return refreshPublicDiscoveryManifestControlWithBudget({
		...context,
		reserveOgQueueAttempts: mockReserveOgQueueAttempts
	});
}

function contextWithR2() {
	type Stored = {
		body: string;
		customMetadata?: Record<string, string>;
		httpMetadata?: R2HTTPMetadata;
		etag: string;
		uploaded: Date;
	};
	const entries = new Map<string, Stored>();
	let nextEtag = 1;
	const object = (key: string, stored: Stored) => ({
		customMetadata: stored.customMetadata,
		etag: stored.etag,
		httpEtag: `"${stored.etag}"`,
		httpMetadata: stored.httpMetadata,
		json: async <T>() => JSON.parse(stored.body) as T,
		key,
		size: stored.body.length,
		text: async () => stored.body,
		uploaded: stored.uploaded
	});
	const r2 = {
		head: vi.fn(async (key: string) => {
			const stored = entries.get(key);
			return stored ? object(key, stored) : null;
		}),
		get: vi.fn(async (key: string) => {
			const stored = entries.get(key);
			return stored ? object(key, stored) : null;
		}),
		put: vi.fn(
			async (
				key: string,
				value: string,
				options?: {
					customMetadata?: Record<string, string>;
					httpMetadata?: R2HTTPMetadata | Headers;
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
				const stored: Stored = {
					body: String(value),
					customMetadata: options?.customMetadata,
					httpMetadata:
						options?.httpMetadata instanceof Headers
							? { contentType: options.httpMetadata.get('content-type') ?? undefined }
							: options?.httpMetadata,
					etag: `etag-${nextEtag++}`,
					uploaded: new Date(Date.now())
				};
				entries.set(key, stored);
				return object(key, stored);
			}
		),
		list: vi.fn(async ({
			limit = 1000,
			prefix = '',
			cursor
		}: { limit?: number; prefix?: string; cursor?: string } = {}) => {
			const matching = [...entries.entries()]
				.filter(([key]) => key.startsWith(prefix))
				.sort(([left], [right]) => left.localeCompare(right));
			const offset = cursor === undefined ? 0 : Number(cursor);
			if (!Number.isSafeInteger(offset) || offset < 0 || offset > matching.length) {
				throw new Error('invalid test R2 cursor');
			}
			const objects = matching
				.slice(offset, offset + limit)
				.map(([key, stored]) => object(key, stored));
			const nextOffset = offset + objects.length;
			const truncated = nextOffset < matching.length;
			return {
				objects,
				truncated,
				...(truncated ? { cursor: String(nextOffset) } : {})
			};
		}),
		delete: vi.fn(async (keys: string | string[]) => {
			for (const key of Array.isArray(keys) ? keys : [keys]) entries.delete(key);
		})
	} as unknown as R2Bucket;
	const completeOgImage = (slug: string, revision: number | string) => {
		const job = buildPublicTemplateOgQueueJob({
			backend: TEST_CONVEX_URL,
			revision,
			sourceSha: import.meta.env.VITE_RELEASE_SHA as string,
			slug,
			transactionId: '123456789-2'
		});
		const key = publicTemplatePageArtifactObjectKeys(job).ogImage;
		entries.set(key, {
			body: 'bounded-test-png',
			customMetadata: {
				kind: 'template-og-image',
				revision: job.revision,
				schema: '1',
				slug: job.slug
			},
			httpMetadata: { contentType: 'image/png' },
			etag: `etag-${nextEtag++}`,
			uploaded: new Date(Date.now())
		});
	};
	const queue = {
		sendBatch: vi.fn(
			async (
				messages: Iterable<{
					body: ReturnType<typeof buildPublicTemplateOgQueueJob>;
					contentType: 'json';
				}>
			) => {
				for (const message of messages) {
					expect(message.contentType).toBe('json');
					completeOgImage(message.body.slug, message.body.revision);
				}
			}
		)
	};
	return {
		url: URL,
		platform: {
			env: {
				PUBLIC_CONVEX_URL: TEST_CONVEX_URL,
				PUBLIC_DISCOVERY_R2: r2,
				PUBLIC_RELEASE_TRANSACTION_ID: '123456789-2',
				PUBLIC_TEMPLATE_OG_QUEUE: queue
			}
		} as App.Platform,
		completeOgImage,
		queue,
		r2Entries: entries
	};
}

function manifest(
	list: {
		ready: boolean;
		retiredRevision?: number;
		revision: number;
		updatedAt: number | null;
	},
	relations = list
) {
	const project = (family: typeof list) => ({
		...family,
		retiredRevision:
			family.retiredRevision ?? (family.ready ? Math.max(0, family.revision - 1) : family.revision)
	});
	return { list: project(list), relations: project(relations) };
}

function publicCard(id: string) {
	return {
		id,
		slug: id,
		title: id,
		description: 'Description',
		domain: 'Civic life',
		topics: [],
		type: 'advocacy',
		deliveryMethod: 'email',
		subject: 'Subject',
		message_body: 'Message',
		preview: 'Preview',
		endorsingOrg: null,
		endorsingOrgs: [],
		endorsementCount: 0,
		coordinationScale: 0,
		isNew: false,
		hasActiveDebate: false,
		verified_sends: null,
		unique_districts: null,
		send_count: 0,
		daily_arrivals: [],
		district_counts: [],
		district_counts_suppressed_districts: 0,
		district_counts_suppressed_count: 0,
		tier_counts: [],
		delivery_config: {},
		cwc_config: null,
		recipient_config: null,
		recipientEmails: [],
		recipient_count: 0,
		campaign_id: null,
		status: 'published',
		is_public: true,
		jurisdictions: [],
		scope: null,
		scopes: [],
		createdAt: '2026-07-18T00:00:00.000Z'
	};
}

function listSnapshot(revision: number, updatedAt: number, id: string) {
	return listSnapshotForIds(revision, updatedAt, [id]);
}

function listSnapshotForIds(revision: number, updatedAt: number, ids: string[]) {
	return {
		projectionVersion: 4,
		revision,
		updatedAt,
		templates: ids.map(publicCard)
	};
}

function relationsSnapshot(revision: number, updatedAt: number) {
	return {
		revision,
		updatedAt,
		twinEdges: [],
		conceptRelations: { edges: [], conceptMap: {} }
	};
}

function pageDetailFixture(templateId: string, slug: string) {
	const title = `Title ${slug}`;
	return {
		id: templateId,
		slug,
		title,
		description: 'Bounded public page fixture',
		domain: 'civic',
		type: 'email',
		deliveryMethod: 'email',
		subject: title,
		message_body: 'Message',
		sources: [],
		research_log: [],
		preview: 'Preview',
		is_public: true,
		verified_sends: 0,
		unique_districts: 0,
		send_count: 0,
		delivery_config: {},
		cwc_config: null,
		recipient_config: { emails: [] },
		recipient_count: 0,
		recipientEmails: [],
		topics: [],
		createdAt: '2026-07-18T00:00:00.000Z',
		author: { name: 'Bounded Author', avatar: null }
	};
}

function pageAggregateFixture(templateId: string) {
	return {
		templateId,
		messageMetrics: { districtCounts: {}, totalDistricts: 0 },
		debate: null,
		positionMetrics: {
			counts: { support: null, oppose: null, districts: null },
			engagement: null
		}
	};
}

function pageArtifactFixture(
	templateId: string,
	slug: string,
	artifactRevision: number
) {
	return {
		version: 1 as const,
		slug,
		detail: {
			...pageDetailFixture(templateId, slug),
			description: `Artifact revision ${artifactRevision}`
		},
		aggregate: pageAggregateFixture(templateId)
	};
}

type ManifestFixture = ReturnType<typeof manifest>;

/** Safe defaults for every payload variant the producer must prewarm. */
function safeProducerQueryResult(
	ref: string,
	args: { excludeCwc?: boolean; cursor?: string | null } | undefined,
	value: ManifestFixture
) {
	if (ref === api.templates.publicDiscoveryManifest) return value;
	if (ref === api.templates.publicTemplatePageArtifactInventoryPage) {
		if (!value.list.ready || value.list.updatedAt === null) {
			throw new Error('unexpected page inventory read for withdrawn family');
		}
		return {
			entries: [],
			continueCursor: null,
			isDone: true,
			revision: value.list.revision,
			updatedAt: value.list.updatedAt
		};
	}
	if (ref === api.templates.publicDiscoveryList) {
		if (!value.list.ready || value.list.updatedAt === null) {
			throw new Error('unexpected list prewarm for withdrawn family');
		}
		return listSnapshot(
			value.list.revision,
			value.list.updatedAt,
			`safe-list-${args?.excludeCwc ? 'exclude' : 'all'}`
		);
	}
	if (ref === api.templates.publicDiscoveryRelations) {
		if (!value.relations.ready || value.relations.updatedAt === null) {
			throw new Error('unexpected relations prewarm for withdrawn family');
		}
		return relationsSnapshot(value.relations.revision, value.relations.updatedAt);
	}
	throw new Error(`Unexpected query: ${ref}`);
}

async function publishFixture(
	context: ReturnType<typeof contextWithR2>,
	logicalKey: string,
	revision: string,
	value: unknown
): Promise<void> {
	await publishPublicDiscoveryPayload(
		logicalKey,
		{ platform: context.platform, revision },
		async () => value
	);
}

function installPageArtifactProducerFixture(
	value: ManifestFixture,
	coordinates: Array<{ templateId: string; slug: string; artifactRevision: number }>,
	materialized: string[] = []
): void {
	mockServerQuery.mockImplementation(async (ref: string, args) => {
		if (ref === api.templates.publicDiscoveryManifest) return value;
		if (ref === api.templates.publicTemplatePageArtifactInventoryPage) {
			return {
				entries: coordinates,
				continueCursor: null,
				isDone: true,
				revision: value.list.revision,
				updatedAt: value.list.updatedAt
			};
		}
		if (ref === api.templates.publicTemplatePageArtifactsByCoordinates) {
			return args.coordinates.map(
				(coordinate: { templateId: string; slug: string; artifactRevision: number }) => {
					materialized.push(coordinate.slug);
					const artifact = pageArtifactFixture(
						coordinate.templateId,
						coordinate.slug,
						coordinate.artifactRevision
					);
					return { ...coordinate, detail: artifact.detail, aggregate: artifact.aggregate };
				}
			);
		}
		return safeProducerQueryResult(ref, args, value);
	});
}

function persistedBackfillProgress(context: ReturnType<typeof contextWithR2>) {
	const entry = [...context.r2Entries.entries()].find(([key]) =>
		key.endsWith('/control/backfill-progress.json')
	);
	if (!entry) throw new Error('missing test backfill progress');
	return JSON.parse(entry[1].body) as {
		enqueuedAt: number | null;
		enqueuedOffset: number;
		enqueueAttempts: number;
		nextOffset: number;
	};
}

describe('public template snapshot queries', () => {
	beforeEach(() => {
		clearPublicDiscoveryCache();
		mockServerQuery.mockReset();
		vi.stubGlobal('caches', undefined);
		vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
		mockReserveOgQueueAttempts.mockReset();
		mockReserveOgQueueAttempts.mockImplementation(async (messageKeys: readonly string[]) => ({
			status: 'reserved',
			remaining:
				PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX - messageKeys.length,
			resetAtMs: 1_900_022_400_000
		}));
	});

	afterEach(() => {
		clearPublicDiscoveryCache();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('pins prompt, full-fan-out, fallback, aggregate, propagation, and outage clocks separately', () => {
		expect(PUBLIC_DISCOVERY_MANIFEST_REVALIDATE_MS).toBe(60_000);
		expect(PUBLIC_DISCOVERY_MANIFEST_FRESH_MS).toBe(9 * 60_000);
		const ordinaryRetryMs = publicDiscoveryManifestControlRetryDelayMs('300');
		const continuationRetryMs = publicDiscoveryManifestControlRetryDelayMs('120');
		expect(ordinaryRetryMs).toBe(301_000);
		expect(continuationRetryMs).toBe(121_000);
		const cycles = Math.ceil(
			PUBLIC_TEMPLATE_PAGE_INVENTORY_MAX_ENTRIES /
				PUBLIC_TEMPLATE_PAGE_PUBLICATION_BATCH_MAX
		);
		expect(cycles).toBe(16);
		expect(PUBLIC_TEMPLATE_OG_QUEUE_REPAIR_DELAY_MS).toBe(120_000);
		const maximumGateAdmissions =
			1 + CONVEX_WORK_BUDGET_MAXIMUM_CONTINUATION_ADMISSIONS_PER_REALM_DAY;
		const healthyTwoPhaseAdmissions = cycles + 1;
		const oneRepairAdmissions = healthyTwoPhaseAdmissions + 1;
		expect(maximumGateAdmissions).toBe(19);
		expect(healthyTwoPhaseAdmissions).toBe(17);
		expect(oneRepairAdmissions).toBe(18);
		expect(oneRepairAdmissions).toBeLessThanOrEqual(maximumGateAdmissions);

		const ordinaryPromptMs =
			PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS +
			ordinaryRetryMs! +
			10_000 +
			PUBLIC_DISCOVERY_MANIFEST_REVALIDATE_MS;
		expect(ordinaryPromptMs).toBeLessThanOrEqual(8 * 60_000);

		const fanoutControlMs =
			PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS +
			ordinaryRetryMs! +
			(cycles - 1) * continuationRetryMs! +
			PUBLIC_DISCOVERY_MANIFEST_REVALIDATE_MS;
		expect(fanoutControlMs).toBe(2_236_000);
		expect(fanoutControlMs + cycles * 10_000).toBeLessThanOrEqual(40 * 60_000);

		const ordinaryFallbackMs =
			PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS +
			cycles * ordinaryRetryMs! +
			cycles * 10_000 +
			PUBLIC_DISCOVERY_MANIFEST_REVALIDATE_MS;
		expect(ordinaryFallbackMs).toBeLessThanOrEqual(85 * 60_000);
		expect(PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS).toBe(6 * 60 * 60_000);
	});

	it('never lets a manifest outage authorize an independently cached payload LKG', async () => {
		const context = contextWithR2();
		const r2List = vi.mocked(context.platform?.env?.PUBLIC_DISCOVERY_R2?.list!);
		await publishFixture(
			context,
			'templates:exclude-cwc=1',
			'4:100',
			[publicCard('known-good')]
		);
		r2List.mockClear();
		// Model a new Worker isolate: no module-local cache and no local edge entry.
		clearPublicDiscoveryCache();
		mockServerQuery.mockRejectedValue(new Error('manifest unavailable'));
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		await expect(getCachedPublicTemplates(context, true)).rejects.toThrow('STATE_NOT_SEEDED');
		expect(mockServerQuery).not.toHaveBeenCalled();
		// The manifest shield uses fixed exact objects; it never scans payload LKGs
		// to manufacture control-plane authority.
		expect(r2List).not.toHaveBeenCalled();
	});

	it('revalidates after 60 seconds but expires only after the authority window', async () => {
		const context = contextWithR2();
		const readyManifest = manifest({ ready: true, revision: 4, updatedAt: 400 });
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				return readyManifest;
			}
			if (ref === api.templates.publicDiscoveryList) {
				return listSnapshot(4, 400, 'last-authoritative');
			}
			return safeProducerQueryResult(ref, args, readyManifest);
		});
		await refreshPublicDiscoveryManifestControl({ platform: context.platform! });
		await expect(getCachedPublicTemplates(context, true)).resolves.toEqual([
			publicCard('last-authoritative')
		]);

		const readsBeforeRevalidation = vi.mocked(context.platform.env!.PUBLIC_DISCOVERY_R2!.get)
			.mock.calls.length;
		vi.mocked(Date.now).mockReturnValue(
			1_800_000_000_000 + PUBLIC_DISCOVERY_MANIFEST_REVALIDATE_MS + 1
		);
		await expect(getCachedPublicTemplates(context, true)).resolves.toEqual([
			publicCard('last-authoritative')
		]);
		expect(
			vi.mocked(context.platform.env!.PUBLIC_DISCOVERY_R2!.get).mock.calls.length
		).toBeGreaterThan(readsBeforeRevalidation);

		vi.mocked(Date.now).mockReturnValue(
			1_800_000_000_000 + PUBLIC_DISCOVERY_MANIFEST_FRESH_MS + 1
		);
		await expect(getCachedPublicTemplates(context, true)).rejects.toThrow('AUTHORITY_EXPIRED');
		expect(
			mockServerQuery.mock.calls.filter(([ref]) => ref === api.templates.publicDiscoveryList)
		).toHaveLength(2);
	});

	it('does not bypass an authoritative not-ready manifest with an old payload', async () => {
		const context = contextWithR2();
		mockServerQuery.mockResolvedValue(manifest({ ready: false, revision: 0, updatedAt: null }));
		await refreshPublicDiscoveryManifestControl({ platform: context.platform });
		mockServerQuery.mockClear();
		clearPublicDiscoveryCache();

		await expect(getCachedPublicTemplates(context, true)).rejects.toBeInstanceOf(
			PublicDiscoverySnapshotNotReadyError
		);
		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, '1']) (
		'fails closed on an unsafe withdrawal epoch (%s) before loading payloads',
		async (withdrawalEpoch) => {
			const context = contextWithR2();
			const unsafeManifest = manifest({ ready: true, revision: 4, updatedAt: 400 });
			Object.assign(unsafeManifest.list, { withdrawalEpoch });
			mockServerQuery.mockResolvedValue(unsafeManifest);

			await expect(
				refreshPublicDiscoveryManifestControl({ platform: context.platform })
			).rejects.toBeInstanceOf(PublicDiscoverySnapshotContractError);
			expect(
				mockServerQuery.mock.calls.filter(
					([ref]) =>
						ref === api.templates.publicDiscoveryList ||
						ref === api.templates.publicDiscoveryRelations
				)
			).toHaveLength(0);
		}
	);

	it.each([true, false])(
		'never recovers retired revision 4 for excludeCwc=%s when ready revision 5 cannot load',
		async (excludeCwc) => {
			const context = contextWithR2();
			await publishFixture(
				context,
				`templates:exclude-cwc=${excludeCwc ? '1' : '0'}`,
				'4:400',
				[publicCard('retired-revision-4')]
			);
			clearPublicDiscoveryCache();
			const nextManifest = manifest({
				ready: true,
				retiredRevision: 4,
				revision: 5,
				updatedAt: 500
			});
			mockServerQuery.mockImplementation(async (ref: string, args) => {
				if (ref === api.templates.publicDiscoveryManifest) {
					return nextManifest;
				}
				if (ref === api.templates.publicDiscoveryList) {
					throw new Error('revision 5 unavailable');
				}
				return safeProducerQueryResult(ref, args, nextManifest);
			});
			await expect(
				refreshPublicDiscoveryManifestControl({ platform: context.platform! })
			).rejects.toThrow(
				'revision 5 unavailable'
			);
		}
	);

	it.each([true, false])(
		'denies excludeCwc=%s from a fresh list withdrawal without reading the payload origin',
		async (excludeCwc) => {
			const context = contextWithR2();
			await publishFixture(
				context,
				`templates:exclude-cwc=${excludeCwc ? '1' : '0'}`,
				'4:400',
				[publicCard('withdrawn-revision-4')]
			);
			clearPublicDiscoveryCache();
			const withdrawnManifest = manifest(
				{ ready: false, retiredRevision: 4, revision: 4, updatedAt: 400 },
				{ ready: true, retiredRevision: 3, revision: 4, updatedAt: 400 }
			);
			mockServerQuery.mockImplementation(async (ref: string, args) => {
				if (ref === api.templates.publicDiscoveryManifest) {
					return withdrawnManifest;
				}
				if (ref === api.templates.publicDiscoveryList) {
					throw new Error('withdrawn list payload must not load');
				}
				return safeProducerQueryResult(ref, args, withdrawnManifest);
			});
			await refreshPublicDiscoveryManifestControl({ platform: context.platform! });
			mockServerQuery.mockClear();

			await expect(getCachedPublicTemplates(context, excludeCwc)).rejects.toBeInstanceOf(
				PublicDiscoverySnapshotNotReadyError
			);
			expect(mockServerQuery).not.toHaveBeenCalled();
		}
	);

	it('recovers only with a newer ready payload above the durable withdrawal floor', async () => {
		const context = contextWithR2();
		await publishFixture(
			context,
			'templates:exclude-cwc=1',
			'4:400',
			[publicCard('retired-revision-4')]
		);
		clearPublicDiscoveryCache();
		const recoveredManifest = manifest({
			ready: true,
			retiredRevision: 4,
			revision: 5,
			updatedAt: 500
		});
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				return recoveredManifest;
			}
			if (ref === api.templates.publicDiscoveryList) {
				return listSnapshot(5, 500, 'ready-revision-5');
			}
			return safeProducerQueryResult(ref, args, recoveredManifest);
		});
		await refreshPublicDiscoveryManifestControl({ platform: context.platform! });

		await expect(getCachedPublicTemplates(context, true)).resolves.toEqual([
			publicCard('ready-revision-5')
		]);
	});

	it('shares one globally shielded manifest resolution across concurrent list and graph consumers', async () => {
		const context = contextWithR2();
		const relations = {
			revision: 4,
			updatedAt: 400,
			twinEdges: [{ a: 'shared', b: 'neighbor', score: 0.75, kind: 'twin' as const }],
			conceptRelations: { edges: [], conceptMap: {} }
		};
		const readyManifest = manifest({ ready: true, revision: 4, updatedAt: 400 });
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				return readyManifest;
			}
			if (ref === api.templates.publicDiscoveryList) {
				return listSnapshotForIds(4, 400, ['shared', 'neighbor']);
			}
			if (ref === api.templates.publicDiscoveryRelations) return relations;
			return safeProducerQueryResult(ref, args, readyManifest);
		});
		await refreshPublicDiscoveryManifestControl({ platform: context.platform! });

		await expect(
			Promise.all([
				getCachedPublicTemplates(context, true),
				getCachedPublicDiscoveryGraphSurface(context, true)
			])
		).resolves.toEqual([
			[publicCard('shared'), publicCard('neighbor')],
			{
				generation: 'list=4:400;relations=4:400',
				templates: [publicCard('shared'), publicCard('neighbor')],
				revision: 4,
				updatedAt: 400,
				twinEdges: relations.twinEdges,
				conceptRelations: relations.conceptRelations
			}
		]);

		expect(
			mockServerQuery.mock.calls.filter(([ref]) => ref === api.templates.publicDiscoveryManifest)
		).toHaveLength(1);
		const r2 = context.platform.env!.PUBLIC_DISCOVERY_R2!;
		expect(
			vi.mocked(r2.get).mock.calls.some(([key]) => String(key).includes('manifest'))
		).toBe(true);
		expect(
			vi.mocked(r2.put).mock.calls.some(([key]) => String(key).includes('manifest'))
		).toBe(true);
	});

	it('labels a transition fallback with the graph generation actually served', async () => {
		const context = contextWithR2();
		const initialManifest = manifest({ ready: true, revision: 4, updatedAt: 400 });
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) return initialManifest;
			if (ref === api.templates.publicDiscoveryList) {
				return listSnapshot(4, 400, 'served-generation-4');
			}
			if (ref === api.templates.publicDiscoveryRelations) return relationsSnapshot(4, 400);
			return safeProducerQueryResult(ref, args, initialManifest);
		});
		await refreshPublicDiscoveryManifestControl({ platform: context.platform! });
		await expect(getCachedPublicDiscoveryGraphSurface(context, true)).resolves.toMatchObject({
			generation: 'list=4:400;relations=4:400',
			templates: [publicCard('served-generation-4')]
		});

		const manifestEntry = [...context.r2Entries.entries()].find(([key]) =>
			key.endsWith('/control/manifest/state.json')
		);
		expect(manifestEntry).toBeDefined();
		const advancedAt = 1_800_000_061_000;
		const advanced = JSON.parse(manifestEntry![1].body);
		for (const family of ['list', 'relations'] as const) {
			advanced.manifest[family] = {
				...advanced.manifest[family],
				ready: true,
				retiredRevision: 3,
				revision: 5,
				updatedAt: 500
			};
			advanced.withdrawalFloors[family] = 3;
		}
		delete advanced.payloadGenerations;
		advanced.certifiedAt = advancedAt;
		advanced.writtenAt = advancedAt;
		manifestEntry![1].body = JSON.stringify(advanced);
		manifestEntry![1].uploaded = new Date(advancedAt);
		vi.mocked(Date.now).mockReturnValue(advancedAt);
		mockServerQuery.mockRejectedValue(new Error('generation 5 payload unavailable'));

		await expect(getCachedPublicDiscoveryGraphSurface(context, true)).resolves.toMatchObject({
			generation: 'list=4:400;relations=4:400',
			templates: [publicCard('served-generation-4')]
		});
	});

	it.each([
		'list=3:300;relations=4:400',
		'list=5:500;relations=4:400'
	])('rejects a graph whose embedded %s generation is not its immutable envelope', async (forged) => {
		const context = contextWithR2();
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const readyManifest = manifest({ ready: true, revision: 4, updatedAt: 400 });
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) return readyManifest;
			if (ref === api.templates.publicDiscoveryList) {
				return listSnapshot(4, 400, 'generation-bound');
			}
			if (ref === api.templates.publicDiscoveryRelations) return relationsSnapshot(4, 400);
			return safeProducerQueryResult(ref, args, readyManifest);
		});
		await refreshPublicDiscoveryManifestControl({ platform: context.platform! });

		const graphEntry = [...context.r2Entries.entries()].find(
			([key]) =>
				decodeURIComponent(key).includes('landing:graph:v2:exclude-cwc=1') &&
				key.endsWith('/payload.json')
		);
		expect(graphEntry).toBeDefined();
		const envelope = JSON.parse(graphEntry![1].body);
		envelope.value.generation = forged;
		graphEntry![1].body = JSON.stringify(envelope);
		graphEntry![1].etag = 'forged-generation';

		clearPublicDiscoveryCache();
		mockServerQuery.mockClear();
		await expect(getCachedPublicDiscoveryGraphSurface(context, true)).rejects.toThrow(
			'could not be read safely'
		);
		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it('isolates same-coordinate legacy graph objects behind the v2 logical-key namespace', async () => {
		const context = contextWithR2();
		const readyManifest = manifest({ ready: true, revision: 4, updatedAt: 400 });
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) return readyManifest;
			if (ref === api.templates.publicDiscoveryList) {
				return listSnapshot(4, 400, 'namespace-v2');
			}
			if (ref === api.templates.publicDiscoveryRelations) return relationsSnapshot(4, 400);
			return safeProducerQueryResult(ref, args, readyManifest);
		});
		await refreshPublicDiscoveryManifestControl({ platform: context.platform! });

		const v2Entry = [...context.r2Entries.entries()].find(
			([key]) =>
				decodeURIComponent(key).includes('landing:graph:v2:exclude-cwc=1') &&
				key.endsWith('/payload.json')
		);
		expect(v2Entry).toBeDefined();
		const legacyKey = v2Entry![0].replace(
			encodeURIComponent('landing:graph:v2:exclude-cwc=1'),
			encodeURIComponent('landing:graph:exclude-cwc=1')
		);
		const legacyEnvelope = JSON.parse(v2Entry![1].body);
		delete legacyEnvelope.value.generation;
		context.r2Entries.set(legacyKey, {
			...v2Entry![1],
			body: JSON.stringify(legacyEnvelope),
			etag: 'legacy-generationless'
		});
		context.r2Entries.delete(v2Entry![0]);

		clearPublicDiscoveryCache();
		await refreshPublicDiscoveryManifestControl({ platform: context.platform! });
		const republished = context.r2Entries.get(v2Entry![0]);
		expect(republished).toBeDefined();
		expect(JSON.parse(republished!.body)).toMatchObject({
			revision: 'list=4:400;relations=4:400',
			value: { generation: 'list=4:400;relations=4:400' }
		});
		expect(context.r2Entries.has(legacyKey)).toBe(true);
	});

	it('persists both graph variants with one envelope-bound generation', async () => {
		const context = contextWithR2();
		const readyManifest = manifest({ ready: true, revision: 4, updatedAt: 400 });
		mockServerQuery.mockImplementation(async (ref: string, args) =>
			safeProducerQueryResult(ref, args, readyManifest)
		);
		await refreshPublicDiscoveryManifestControl({ platform: context.platform! });

		const graphEntries = [...context.r2Entries.entries()].filter(
			([key]) =>
				decodeURIComponent(key).includes('landing:graph:v2:exclude-cwc=') &&
				key.endsWith('/payload.json')
		);
		expect(graphEntries).toHaveLength(2);
		for (const [key, entry] of graphEntries) {
			const envelope = JSON.parse(entry.body);
			expect(envelope.value.generation).toBe(envelope.revision);
			expect(decodeURIComponent(key)).toContain(`revision=${envelope.revision}/payload.json`);
		}
	});

	it('prunes relation endpoints evicted by a prompt-only list advance', async () => {
		const context = contextWithR2();
		const retainedIds = Array.from({ length: 49 }, (_, index) => `old-${index}`);
		const visibleIds = ['new-50', ...retainedIds];
		const nextManifest = manifest(
			{ ready: true, revision: 7, updatedAt: 700 },
			{ ready: true, revision: 6, updatedAt: 600 }
		);
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) return nextManifest;
			if (ref === api.templates.publicDiscoveryList) {
				return listSnapshotForIds(7, 700, visibleIds);
			}
			if (ref === api.templates.publicDiscoveryRelations) {
				return {
					revision: 6,
					updatedAt: 600,
					twinEdges: [
						{ a: 'old-0', b: 'old-1', score: 0.8, kind: 'twin' },
						{ a: 'old-49', b: 'old-0', score: 0.7, kind: 'twin' }
					],
					conceptRelations: {
						edges: [
							{ a: 'old-1', b: 'old-2', concept: 'retained', kind: 'concept' },
							{ a: 'old-49', b: 'old-2', concept: 'evicted', kind: 'concept' }
						],
						conceptMap: { retained: 'retained', evicted: 'evicted' }
					}
				};
			}
			return safeProducerQueryResult(ref, args, nextManifest);
		});

		await refreshPublicDiscoveryManifestControl({ platform: context.platform! });
		await expect(getCachedPublicDiscoveryGraphSurface(context, true)).resolves.toMatchObject({
			templates: visibleIds.map(publicCard),
			twinEdges: [{ a: 'old-0', b: 'old-1', score: 0.8, kind: 'twin' }],
			conceptRelations: {
				edges: [{ a: 'old-1', b: 'old-2', concept: 'retained', kind: 'concept' }]
			}
		});
	});

	it.each([
		[
			'twin',
			{
				twinEdges: [{ a: 'visible', b: 'evicted', score: 0.8, kind: 'twin' }],
				conceptRelations: { edges: [], conceptMap: {} }
			}
		],
		[
			'concept',
			{
				twinEdges: [],
				conceptRelations: {
					edges: [
						{ a: 'visible', b: 'evicted', concept: 'civic', kind: 'concept' }
					],
					conceptMap: { civic: 'civic' }
				}
			}
		]
	] as const)('rejects a persisted graph with an orphaned %s edge', async (_kind, patch) => {
		const context = contextWithR2();
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const readyManifest = manifest({ ready: true, revision: 1, updatedAt: 100 });
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) return readyManifest;
			if (ref === api.templates.publicDiscoveryList) {
				return listSnapshot(1, 100, 'visible');
			}
			if (ref === api.templates.publicDiscoveryRelations) {
				return relationsSnapshot(1, 100);
			}
			return safeProducerQueryResult(ref, args, readyManifest);
		});
		await refreshPublicDiscoveryManifestControl({ platform: context.platform! });

		const graphEntry = [...context.r2Entries.entries()].find(
			([key]) =>
				decodeURIComponent(key).includes('landing:graph:v2:exclude-cwc=1') &&
				key.endsWith('/payload.json')
		);
		expect(graphEntry).toBeDefined();
		const envelope = JSON.parse(graphEntry![1].body);
		envelope.value = { ...envelope.value, ...patch };
		graphEntry![1].body = JSON.stringify(envelope);
		graphEntry![1].etag = `poisoned-${_kind}`;

		clearPublicDiscoveryCache();
		mockServerQuery.mockClear();
		await expect(getCachedPublicDiscoveryGraphSurface(context, true)).rejects.toThrow(
			'could not be read safely'
		);
		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it('prewarms every required variant before publishing the manifest coordinate', async () => {
		const context = contextWithR2();
		const nextManifest = manifest(
			{ ready: true, revision: 4, updatedAt: 400 },
			{ ready: true, revision: 9, updatedAt: 900 }
		);
		mockServerQuery.mockImplementation(async (ref: string, args) =>
			safeProducerQueryResult(ref, args, nextManifest)
		);

		await refreshPublicDiscoveryManifestControl({ platform: context.platform });

		for (const ref of [api.templates.publicDiscoveryList, api.templates.publicDiscoveryRelations]) {
			const variants = mockServerQuery.mock.calls
				.filter(([queried]) => queried === ref)
				.map(([, args]) => args?.excludeCwc)
				.sort();
			expect(variants).toEqual([false, true]);
		}
		const puts = vi.mocked(context.platform.env!.PUBLIC_DISCOVERY_R2!.put).mock.calls;
		const finalManifestIndex = puts.findIndex(
			([key, body]) =>
				String(key).endsWith('/control/manifest/state.json') &&
				JSON.parse(String(body)).phase === 'ready'
		);
		const payloadIndexes = puts.flatMap(([key], index) =>
			String(key).endsWith('/payload.json') ? [index] : []
		);
		expect(payloadIndexes).toHaveLength(5);
		expect(finalManifestIndex).toBeGreaterThan(Math.max(...payloadIndexes));

		mockServerQuery.mockClear();
		clearPublicDiscoveryCache();
		await expect(getCachedPublicTemplates(context, true)).resolves.toEqual([
			publicCard('safe-list-exclude')
		]);
		await expect(getCachedPublicDiscoveryGraphSurface(context, false)).resolves.toEqual({
			generation: 'list=4:400;relations=9:900',
			templates: [publicCard('safe-list-all')],
			revision: 9,
			updatedAt: 900,
			twinEdges: [],
			conceptRelations: { edges: [], conceptMap: {} }
		});
		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it('keeps a maximum page-publication cycle below all three Cloudflare subrequest classes', async () => {
		const context = contextWithR2();
		const readyManifest = manifest({ ready: true, revision: 10, updatedAt: 1_000 });
		const coordinates = Array.from(
			{ length: PUBLIC_TEMPLATE_PAGE_INVENTORY_MAX_ENTRIES },
			(_, index) => {
				const suffix = index.toString().padStart(3, '0');
				return {
					templateId: `ledger-template-${suffix}`,
					slug: `ledger-page-${suffix}`,
					artifactRevision: 9_000 + index
				};
			}
		);
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) return readyManifest;
			if (ref === api.templates.publicTemplatePageArtifactInventoryPage) {
				const offset = args.cursor === null ? 0 : Number(args.cursor);
				const entries = coordinates.slice(offset, offset + 64);
				const nextOffset = offset + entries.length;
				return {
					entries,
					continueCursor: nextOffset < coordinates.length ? String(nextOffset) : null,
					isDone: nextOffset >= coordinates.length,
					revision: readyManifest.list.revision,
					updatedAt: readyManifest.list.updatedAt
				};
			}
			if (ref === api.templates.publicTemplatePageArtifactsByCoordinates) {
				return args.coordinates.map(
					(coordinate: {
						templateId: string;
						slug: string;
						artifactRevision: number;
					}) => {
						const artifact = pageArtifactFixture(
							coordinate.templateId,
							coordinate.slug,
							coordinate.artifactRevision
						);
						return { ...coordinate, detail: artifact.detail, aggregate: artifact.aggregate };
					}
				);
			}
			return safeProducerQueryResult(ref, args, readyManifest);
		});

		const edge = {
			delete: vi.fn().mockResolvedValue(false),
			match: vi.fn().mockResolvedValue(undefined),
			put: vi.fn().mockResolvedValue(undefined)
		};
		vi.stubGlobal('caches', { default: edge });
		await expect(
			refreshPublicDiscoveryManifestControl({
				platform: context.platform,
				allowPageArtifactBackfill: true
			})
		).rejects.toBeInstanceOf(PublicTemplatePageBackfillIncompleteError);

		const r2 = context.platform.env!.PUBLIC_DISCOVERY_R2!;
		const ledger = {
			external: mockServerQuery.mock.calls.length,
			cacheApi: edge.match.mock.calls.length + edge.put.mock.calls.length + edge.delete.mock.calls.length,
			internalService:
				vi.mocked(r2.get).mock.calls.length +
				vi.mocked(r2.head).mock.calls.length +
				vi.mocked(r2.put).mock.calls.length +
				vi.mocked(r2.delete).mock.calls.length +
				vi.mocked(r2.list).mock.calls.length +
				context.queue.sendBatch.mock.calls.length +
				mockReserveOgQueueAttempts.mock.calls.length
		};
		expect(ledger.external).toBeGreaterThan(0);
		expect(ledger.internalService).toBeGreaterThan(0);
		expect(ledger.external).toBeLessThan(50);
		expect(ledger.cacheApi).toBeLessThan(50);
		expect(ledger.internalService).toBeLessThan(1_000);
	});

	it('converges the full 250-template backfill in sixteen Queue batches and serves it without Convex', async () => {
		const context = contextWithR2();
		const readyManifest = manifest({ ready: true, revision: 11, updatedAt: 1_100 });
		const coordinates = Array.from({ length: 250 }, (_, index) => {
			const suffix = index.toString().padStart(3, '0');
			return {
				templateId: `template-${suffix}`,
				slug: `bounded-${suffix}`,
				artifactRevision: 10_000 + index
			};
		});
		const materializedSlugs: string[] = [];
		let now = 1_900_000_000_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) return readyManifest;
			if (ref === api.templates.publicTemplatePageArtifactInventoryPage) {
				const offset = args.cursor === null ? 0 : Number(args.cursor);
				const entries = coordinates.slice(offset, offset + 64);
				const nextOffset = offset + entries.length;
				return {
					entries,
					continueCursor: nextOffset < coordinates.length ? String(nextOffset) : null,
					isDone: nextOffset >= coordinates.length,
					revision: readyManifest.list.revision,
					updatedAt: readyManifest.list.updatedAt
				};
			}
			if (ref === api.templates.publicTemplatePageArtifactsByCoordinates) {
				return args.coordinates.map(
					(coordinate: {
						templateId: string;
						slug: string;
						artifactRevision: number;
					}) => {
						materializedSlugs.push(coordinate.slug);
						return {
							...coordinate,
							detail: pageDetailFixture(coordinate.templateId, coordinate.slug),
							aggregate: pageAggregateFixture(coordinate.templateId)
						};
					}
				);
			}
			return safeProducerQueryResult(ref, args, readyManifest);
		});

		let successfulAttempts = 0;
		let incompleteAttempts = 0;
		for (let attempt = 1; attempt <= 20; attempt += 1) {
			try {
				await refreshPublicDiscoveryManifestControl({
					platform: context.platform,
					allowPageArtifactBackfill: true
				});
				successfulAttempts += 1;
				break;
			} catch (error) {
				expect(error).toBeInstanceOf(PublicTemplatePageBackfillIncompleteError);
				incompleteAttempts += 1;
				// The production workflow waits past the 15-second writer lease.
				now += 61_000;
				clearPublicDiscoveryCache();
			}
		}

		// Each durable Queue handoff is incomplete until the following producer
		// invocation certifies the exact JSON+PNG pair. Sixteen handoffs therefore
		// require sixteen incomplete invocations and one final certification pass.
		expect(incompleteAttempts).toBe(16);
		expect(successfulAttempts).toBe(1);
		expect(materializedSlugs).toHaveLength(250);
		expect(new Set(materializedSlugs).size).toBe(250);
		const materializationCalls = mockServerQuery.mock.calls.filter(
			([ref]) => ref === api.templates.publicTemplatePageArtifactsByCoordinates
		);
		expect(materializationCalls).toHaveLength(63);
		expect(
			materializationCalls.every(
				([, args]) => args.coordinates.length > 0 && args.coordinates.length <= 4
			)
		).toBe(true);
		expect(
			mockServerQuery.mock.calls.filter(
				([ref]) => ref === api.templates.publicTemplatePageArtifactInventoryPage
			)
		).toHaveLength(8);

		const r2 = context.platform.env!.PUBLIC_DISCOVERY_R2!;
		expect(vi.mocked(r2.head)).toHaveBeenCalledTimes(1_000);
		expect(context.queue.sendBatch).toHaveBeenCalledTimes(16);
		const puts = vi.mocked(r2.put).mock.calls;
		const artifactPutIndexes = puts.flatMap(([key], index) =>
			decodeURIComponent(String(key)).includes('/template-page:slug=') &&
			String(key).endsWith('/payload.json')
				? [index]
				: []
		);
		const inventoryPutIndex = puts.findIndex(
			([key]) =>
				decodeURIComponent(String(key)).includes('/template-pages:inventory/') &&
				String(key).endsWith('/payload.json')
		);
		const finalManifestIndex = puts.findIndex(
			([key, body]) =>
				String(key).endsWith('/control/manifest/state.json') &&
				JSON.parse(String(body)).phase === 'ready'
		);
		expect(artifactPutIndexes).toHaveLength(250);
		expect(inventoryPutIndex).toBeGreaterThan(Math.max(...artifactPutIndexes));
		expect(finalManifestIndex).toBeGreaterThan(inventoryPutIndex);

		mockServerQuery.mockReset();
		mockServerQuery.mockRejectedValue(new Error('anonymous Convex fallback forbidden'));
		vi.mocked(r2.list).mockClear();
		clearPublicDiscoveryCache();
		await expect(
			getCachedPublicTemplatePageArtifact(context, 'bounded-249')
		).resolves.toMatchObject({
			slug: 'bounded-249',
			detail: { id: 'template-249' },
			aggregate: { templateId: 'template-249' }
		});
		await expect(
			getCachedPublicTemplatePageArtifact(context, 'never-published')
		).resolves.toBeNull();
		expect(mockServerQuery).not.toHaveBeenCalled();
		expect(r2.list).not.toHaveBeenCalled();
	}, 20_000);

	it('resumes after artifact PUTs complete before the checkpoint CAS without rematerializing them', async () => {
		const context = contextWithR2();
		const readyManifest = manifest({ ready: true, revision: 21, updatedAt: 2_100 });
		const coordinates = Array.from({ length: 20 }, (_, index) => ({
			templateId: `crash-template-${index.toString().padStart(2, '0')}`,
			slug: `crash-safe-${index.toString().padStart(2, '0')}`,
			artifactRevision: 20_000 + index
		}));
		for (const coordinate of coordinates.slice(0, 16)) {
			await publishFixture(
				context,
				`template-page:slug=${coordinate.slug}`,
				String(coordinate.artifactRevision),
				pageArtifactFixture(
					coordinate.templateId,
					coordinate.slug,
					coordinate.artifactRevision
				)
			);
			context.completeOgImage(coordinate.slug, coordinate.artifactRevision);
		}
		const materialized: string[] = [];
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) return readyManifest;
			if (ref === api.templates.publicTemplatePageArtifactInventoryPage) {
				return {
					entries: coordinates,
					continueCursor: null,
					isDone: true,
					revision: readyManifest.list.revision,
					updatedAt: readyManifest.list.updatedAt
				};
			}
			if (ref === api.templates.publicTemplatePageArtifactsByCoordinates) {
				return args.coordinates.map(
					(coordinate: {
						templateId: string;
						slug: string;
						artifactRevision: number;
					}) => {
						materialized.push(coordinate.slug);
						const artifact = pageArtifactFixture(
							coordinate.templateId,
							coordinate.slug,
							coordinate.artifactRevision
						);
						return { ...coordinate, detail: artifact.detail, aggregate: artifact.aggregate };
					}
				);
			}
			return safeProducerQueryResult(ref, args, readyManifest);
		});

		await expect(
			refreshPublicDiscoveryManifestControl({
				platform: context.platform,
				allowPageArtifactBackfill: true
			})
		).rejects.toBeInstanceOf(PublicTemplatePageBackfillIncompleteError);
		expect(materialized).toEqual([]);
		expect(
			mockServerQuery.mock.calls.filter(
				([ref]) => ref === api.templates.publicTemplatePageArtifactsByCoordinates
			)
		).toHaveLength(0);

		vi.mocked(Date.now).mockReturnValue(
			1_800_000_000_000 + PUBLIC_DISCOVERY_MANIFEST_FRESH_MS + 1
		);
		clearPublicDiscoveryCache();
		await expect(
			refreshPublicDiscoveryManifestControl({
				platform: context.platform,
				allowPageArtifactBackfill: true
			})
		).rejects.toBeInstanceOf(PublicTemplatePageBackfillIncompleteError);
		vi.mocked(Date.now).mockReturnValue(
			1_800_000_000_000 + PUBLIC_DISCOVERY_MANIFEST_FRESH_MS + 62_000
		);
		clearPublicDiscoveryCache();
		await refreshPublicDiscoveryManifestControl({
			platform: context.platform,
			allowPageArtifactBackfill: true
		});
		expect(materialized).toEqual(coordinates.slice(16).map(({ slug }) => slug));
		expect(
			mockServerQuery.mock.calls.filter(
				([ref]) => ref === api.templates.publicTemplatePageArtifactsByCoordinates
			)
		).toHaveLength(1);
		expect(
			mockServerQuery.mock.calls.filter(
				([ref]) => ref === api.templates.publicTemplatePageArtifactInventoryPage
			)
		).toHaveLength(2);
	});

	it('records each failed send before I/O, waits to repair, and terminates after two intents', async () => {
		const context = contextWithR2();
		const readyManifest = manifest({ ready: true, revision: 23, updatedAt: 2_300 });
		const coordinates = [
			{
				templateId: 'send-failure-template',
				slug: 'send-failure-safe',
				artifactRevision: 32_001
			}
		];
		const materialized: string[] = [];
		installPageArtifactProducerFixture(readyManifest, coordinates, materialized);
		let now = 1_900_000_000_000;
		vi.mocked(Date.now).mockImplementation(() => now);
		context.queue.sendBatch
			.mockRejectedValueOnce(new Error('Queue unavailable before delivery'))
			.mockRejectedValueOnce(new Error('Queue unavailable during repair'));

		await expect(
			refreshPublicDiscoveryManifestControl({
				platform: context.platform,
				allowPageArtifactBackfill: true
			})
		).rejects.toBeInstanceOf(PublicTemplateOgQueueSendFailedError);
		expect(persistedBackfillProgress(context)).toMatchObject({
			enqueuedOffset: 1,
			enqueueAttempts: 1,
			nextOffset: 0
		});
		const r2Put = vi.mocked(context.platform.env!.PUBLIC_DISCOVERY_R2!.put);
		const intentIndex = r2Put.mock.calls.findIndex(
			([key, body]) =>
				String(key).endsWith('/control/backfill-progress.json') &&
				JSON.parse(String(body)).enqueueAttempts === 1
		);
		expect(intentIndex).toBeGreaterThanOrEqual(0);
		expect(mockReserveOgQueueAttempts.mock.invocationCallOrder[0]).toBeLessThan(
			r2Put.mock.invocationCallOrder[intentIndex]!
		);
		expect(r2Put.mock.invocationCallOrder[intentIndex]).toBeLessThan(
			context.queue.sendBatch.mock.invocationCallOrder[0]!
		);

		// Ordinary workflow continuation is intentionally too early to spend the
		// second account-wide Queue send intent.
		now += 61_000;
		clearPublicDiscoveryCache();
		await expect(
			refreshPublicDiscoveryManifestControl({
				platform: context.platform,
				allowPageArtifactBackfill: true
			})
		).rejects.toBeInstanceOf(PublicTemplatePageBackfillIncompleteError);
		expect(context.queue.sendBatch).toHaveBeenCalledTimes(1);

		now += PUBLIC_TEMPLATE_OG_QUEUE_REPAIR_DELAY_MS;
		clearPublicDiscoveryCache();
		await expect(
			refreshPublicDiscoveryManifestControl({
				platform: context.platform,
				allowPageArtifactBackfill: true
			})
		).rejects.toBeInstanceOf(PublicTemplateOgQueueSendFailedError);
		expect(persistedBackfillProgress(context)).toMatchObject({
			enqueuedOffset: 1,
			enqueueAttempts: 2,
			nextOffset: 0
		});
		expect(context.queue.sendBatch).toHaveBeenCalledTimes(2);
		expect(mockReserveOgQueueAttempts).toHaveBeenCalledTimes(2);
		expect(mockReserveOgQueueAttempts.mock.calls.map(([keys]) => keys)).toEqual([
			[`${TEST_CONVEX_URL}|send-failure-safe|32001|1`],
			[`${TEST_CONVEX_URL}|send-failure-safe|32001|2`]
		]);

		now += PUBLIC_TEMPLATE_OG_QUEUE_REPAIR_DELAY_MS;
		clearPublicDiscoveryCache();
		await expect(
			refreshPublicDiscoveryManifestControl({
				platform: context.platform,
				allowPageArtifactBackfill: true
			})
		).rejects.toMatchObject({
			name: 'PublicTemplateOgQueueStalledError',
			code: 'REPAIR_EXHAUSTED'
		});
		expect(context.queue.sendBatch).toHaveBeenCalledTimes(2);
		expect(mockReserveOgQueueAttempts).toHaveBeenCalledTimes(2);
		expect(materialized).toEqual(['send-failure-safe']);
	});

	it('restores prior authority after an ambiguous delivered send and never sends it twice', async () => {
		const context = contextWithR2();
		let now = 1_900_000_000_000;
		vi.mocked(Date.now).mockImplementation(() => now);
		const priorManifest = manifest({ ready: true, revision: 24, updatedAt: 2_400 });
		const priorCoordinate = {
			templateId: 'ambiguous-template',
			slug: 'ambiguous-send-safe',
			artifactRevision: 33_001
		};
		installPageArtifactProducerFixture(priorManifest, [priorCoordinate]);
		await expect(
			refreshPublicDiscoveryManifestControl({
				platform: context.platform,
				allowPageArtifactBackfill: true
			})
		).rejects.toBeInstanceOf(PublicTemplatePageBackfillIncompleteError);
		now += 61_000;
		clearPublicDiscoveryCache();
		await refreshPublicDiscoveryManifestControl({
			platform: context.platform,
			allowPageArtifactBackfill: true
		});

		const nextManifest = manifest({ ready: true, revision: 25, updatedAt: 2_500 });
		const nextCoordinate = { ...priorCoordinate, artifactRevision: 34_001 };
		const nextMaterialized: string[] = [];
		installPageArtifactProducerFixture(nextManifest, [nextCoordinate], nextMaterialized);
		context.queue.sendBatch.mockClear();
		context.queue.sendBatch.mockImplementationOnce(async (messages) => {
			for (const message of messages) {
				context.completeOgImage(message.body.slug, message.body.revision);
			}
			throw new Error('provider response lost after delivery');
		});
		now += 61_000;
		clearPublicDiscoveryCache();
		await expect(
			refreshPublicDiscoveryManifestControl({ platform: context.platform })
		).rejects.toBeInstanceOf(PublicTemplateOgQueueSendFailedError);
		expect(persistedBackfillProgress(context)).toMatchObject({
			enqueuedOffset: 1,
			enqueueAttempts: 1,
			nextOffset: 0
		});

		mockServerQuery.mockClear();
		clearPublicDiscoveryCache();
		await expect(
			getCachedPublicTemplatePageArtifact(context, priorCoordinate.slug)
		).resolves.toMatchObject({
			detail: { description: `Artifact revision ${priorCoordinate.artifactRevision}` }
		});
		expect(mockServerQuery).not.toHaveBeenCalled();

		installPageArtifactProducerFixture(nextManifest, [nextCoordinate], nextMaterialized);
		now += 61_000;
		clearPublicDiscoveryCache();
		await refreshPublicDiscoveryManifestControl({ platform: context.platform });
		expect(context.queue.sendBatch).toHaveBeenCalledTimes(1);
		expect(nextMaterialized).toEqual(['ambiguous-send-safe']);
	});

	it('treats a missing Queue binding as terminal instead of minting continuations', async () => {
		const context = contextWithR2();
		const readyManifest = manifest({ ready: true, revision: 26, updatedAt: 2_600 });
		installPageArtifactProducerFixture(readyManifest, [
			{
				templateId: 'binding-template',
				slug: 'binding-required',
				artifactRevision: 35_001
			}
		]);
		delete context.platform.env!.PUBLIC_TEMPLATE_OG_QUEUE;
		const failure = refreshPublicDiscoveryManifestControl({
			platform: context.platform,
			allowPageArtifactBackfill: true
		});
		await expect(failure).rejects.toBeInstanceOf(PublicTemplateOgQueueStalledError);
		await expect(failure).rejects.not.toBeInstanceOf(PublicTemplatePageBackfillIncompleteError);
		await expect(failure).rejects.toMatchObject({ code: 'BINDING_REQUIRED' });
		expect(context.queue.sendBatch).not.toHaveBeenCalled();
		expect(mockReserveOgQueueAttempts).not.toHaveBeenCalled();
	});

	it('terminates before checkpoint or send when the durable UTC-day Queue budget is exhausted', async () => {
		const context = contextWithR2();
		const readyManifest = manifest({ ready: true, revision: 28, updatedAt: 2_800 });
		installPageArtifactProducerFixture(readyManifest, [
			{
				templateId: 'daily-budget-template',
				slug: 'daily-budget-exhausted',
				artifactRevision: 37_001
			}
		]);
		mockReserveOgQueueAttempts.mockResolvedValueOnce({
			status: 'exhausted',
			remaining: 0,
			resetAtMs: 1_900_022_400_000
		});
		const failure = refreshPublicDiscoveryManifestControl({
			platform: context.platform,
			allowPageArtifactBackfill: true
		});
		await expect(failure).rejects.toMatchObject({
			name: 'PublicTemplateOgQueueStalledError',
			code: 'DAILY_BUDGET_EXHAUSTED'
		});
		await expect(failure).rejects.not.toBeInstanceOf(PublicTemplatePageBackfillIncompleteError);
		expect(context.queue.sendBatch).not.toHaveBeenCalled();
		expect(persistedBackfillProgress(context)).toMatchObject({
			enqueuedOffset: 0,
			enqueueAttempts: 0,
			nextOffset: 0
		});
	});

	it('treats corrupt exact pair state as terminal before Convex materialization or Queue send', async () => {
		const context = contextWithR2();
		const readyManifest = manifest({ ready: true, revision: 27, updatedAt: 2_700 });
		const coordinate = {
			templateId: 'corrupt-pair-template',
			slug: 'corrupt-pair-state',
			artifactRevision: 36_001
		};
		installPageArtifactProducerFixture(readyManifest, [coordinate]);
		await publishFixture(
			context,
			`template-page:slug=${coordinate.slug}`,
			String(coordinate.artifactRevision),
			pageArtifactFixture(
				coordinate.templateId,
				coordinate.slug,
				coordinate.artifactRevision
			)
		);
		const poisoned = [...context.r2Entries.entries()].find(
			([key]) =>
				decodeURIComponent(key).includes(`template-page:slug=${coordinate.slug}`) &&
				key.endsWith('/payload.json')
		);
		expect(poisoned).toBeDefined();
		poisoned![1].customMetadata = { kind: 'not-a-payload', revision: '36001' };

		const failure = refreshPublicDiscoveryManifestControl({
			platform: context.platform,
			allowPageArtifactBackfill: true
		});
		await expect(failure).rejects.toMatchObject({
			name: 'PublicTemplateOgQueueStalledError',
			code: 'PAIR_STATE_CORRUPT'
		});
		await expect(failure).rejects.not.toBeInstanceOf(PublicTemplatePageBackfillIncompleteError);
		expect(context.queue.sendBatch).not.toHaveBeenCalled();
		expect(
			mockServerQuery.mock.calls.filter(
				([ref]) => ref === api.templates.publicTemplatePageArtifactsByCoordinates
			)
		).toHaveLength(0);
	});

	it('resets a completed checkpoint on final coordinate-digest drift without skipping the changed artifact', async () => {
		const context = contextWithR2();
		const readyManifest = manifest({ ready: true, revision: 22, updatedAt: 2_200 });
		const coordinates = Array.from({ length: 20 }, (_, index) => ({
			templateId: `drift-template-${index.toString().padStart(2, '0')}`,
			slug: `digest-drift-${index.toString().padStart(2, '0')}`,
			artifactRevision: 30_000 + index
		}));
		const materialized: Array<{ slug: string; artifactRevision: number }> = [];
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) return readyManifest;
			if (ref === api.templates.publicTemplatePageArtifactInventoryPage) {
				return {
					entries: coordinates.map((coordinate) => ({ ...coordinate })),
					continueCursor: null,
					isDone: true,
					revision: readyManifest.list.revision,
					updatedAt: readyManifest.list.updatedAt
				};
			}
			if (ref === api.templates.publicTemplatePageArtifactsByCoordinates) {
				return args.coordinates.map(
					(coordinate: {
						templateId: string;
						slug: string;
						artifactRevision: number;
					}) => {
						materialized.push({
							slug: coordinate.slug,
							artifactRevision: coordinate.artifactRevision
						});
						const artifact = pageArtifactFixture(
							coordinate.templateId,
							coordinate.slug,
							coordinate.artifactRevision
						);
						return { ...coordinate, detail: artifact.detail, aggregate: artifact.aggregate };
					}
				);
			}
			return safeProducerQueryResult(ref, args, readyManifest);
		});

		const advanceLease = (cycle: number) => {
			vi.mocked(Date.now).mockReturnValue(1_800_000_000_000 + cycle * 61_000);
			clearPublicDiscoveryCache();
		};
		await expect(
			refreshPublicDiscoveryManifestControl({
				platform: context.platform,
				allowPageArtifactBackfill: true
			})
		).rejects.toBeInstanceOf(PublicTemplatePageBackfillIncompleteError);
		coordinates[0]!.artifactRevision += 1_000;

		advanceLease(1);
		await expect(
			refreshPublicDiscoveryManifestControl({
				platform: context.platform,
				allowPageArtifactBackfill: true
			})
		).rejects.toBeInstanceOf(PublicTemplatePageBackfillIncompleteError);
		advanceLease(2);
		await expect(
			refreshPublicDiscoveryManifestControl({
				platform: context.platform,
				allowPageArtifactBackfill: true
			})
		).rejects.toBeInstanceOf(PublicTemplatePageBackfillIncompleteError);
		advanceLease(3);
		await expect(
			refreshPublicDiscoveryManifestControl({
				platform: context.platform,
				allowPageArtifactBackfill: true
			})
		).rejects.toBeInstanceOf(PublicTemplatePageBackfillIncompleteError);
		advanceLease(4);
		await refreshPublicDiscoveryManifestControl({
			platform: context.platform,
			allowPageArtifactBackfill: true
		});

		expect(
			materialized.filter(({ slug }) => slug === coordinates[0]!.slug)
		).toEqual([
			{ slug: coordinates[0]!.slug, artifactRevision: 30_000 },
			{ slug: coordinates[0]!.slug, artifactRevision: 31_000 }
		]);
		expect(
			mockServerQuery.mock.calls.filter(
				([ref]) => ref === api.templates.publicTemplatePageArtifactInventoryPage
			)
		).toHaveLength(3);
		mockServerQuery.mockClear();
		clearPublicDiscoveryCache();
		await expect(
			getCachedPublicTemplatePageArtifact(context, coordinates[0]!.slug)
		).resolves.toMatchObject({
			detail: { description: 'Artifact revision 31000' }
		});
		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it('keeps the prior 250-page authority live through every staged cycle and a post-inventory failure', async () => {
		const context = contextWithR2();
		let currentManifest = manifest({ ready: true, revision: 31, updatedAt: 3_100 });
		let coordinates = Array.from({ length: 250 }, (_, index) => {
			const suffix = index.toString().padStart(3, '0');
			return {
				templateId: `rolling-template-${suffix}`,
				slug: `rolling-page-${suffix}`,
				artifactRevision: 40_000 + index
			};
		});
		let failLandingPublication = false;
		let now = 1_900_000_000_000;
		vi.mocked(Date.now).mockImplementation(() => now);
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) return currentManifest;
			if (ref === api.templates.publicTemplatePageArtifactInventoryPage) {
				const offset = args.cursor === null ? 0 : Number(args.cursor);
				const entries = coordinates.slice(offset, offset + 64).map((entry) => ({ ...entry }));
				const nextOffset = offset + entries.length;
				return {
					entries,
					continueCursor: nextOffset < coordinates.length ? String(nextOffset) : null,
					isDone: nextOffset >= coordinates.length,
					revision: currentManifest.list.revision,
					updatedAt: currentManifest.list.updatedAt
				};
			}
			if (ref === api.templates.publicTemplatePageArtifactsByCoordinates) {
				return args.coordinates.map(
					(coordinate: {
						templateId: string;
						slug: string;
						artifactRevision: number;
					}) => {
						const artifact = pageArtifactFixture(
							coordinate.templateId,
							coordinate.slug,
							coordinate.artifactRevision
						);
						return { ...coordinate, detail: artifact.detail, aggregate: artifact.aggregate };
					}
				);
			}
			if (failLandingPublication && ref === api.templates.publicDiscoveryList) {
				throw new Error('landing publication failed after page inventory PUT');
			}
			return safeProducerQueryResult(ref, args, currentManifest);
		});

		for (let attempt = 0; attempt < 17; attempt += 1) {
			const refresh = refreshPublicDiscoveryManifestControl({
				platform: context.platform,
				allowPageArtifactBackfill: true
			});
			if (attempt < 16) {
				await expect(refresh).rejects.toBeInstanceOf(
					PublicTemplatePageBackfillIncompleteError
				);
				now += 61_000;
				clearPublicDiscoveryCache();
			} else {
				await refresh;
			}
		}
		clearPublicDiscoveryCache();
		await expect(
			getCachedPublicTemplatePageArtifact(context, 'rolling-page-249')
		).resolves.toMatchObject({ detail: { description: 'Artifact revision 40249' } });

		currentManifest = manifest({ ready: true, revision: 32, updatedAt: 3_200 });
		coordinates = coordinates.map((coordinate) => ({
			...coordinate,
			artifactRevision: coordinate.artifactRevision + 10_000
		}));
		const oldArtifactKey = [...context.r2Entries.keys()].find(
			(key) =>
				decodeURIComponent(key).includes('/template-page:slug=rolling-page-249/') &&
				decodeURIComponent(key).includes('/revision=40249/') &&
				key.endsWith('/payload.json')
		);
		expect(oldArtifactKey).toBeDefined();

		for (let attempt = 0; attempt < 16; attempt += 1) {
			await expect(
				refreshPublicDiscoveryManifestControl({ platform: context.platform })
			).rejects.toBeInstanceOf(PublicTemplatePageBackfillIncompleteError);
			const manifestState = [...context.r2Entries.entries()].find(([key]) =>
				key.endsWith('/control/manifest/state.json')
			)?.[1];
			expect(manifestState).toBeDefined();
			expect(JSON.parse(manifestState!.body)).toMatchObject({
				phase: 'ready',
				manifest: { list: { revision: 31, ready: true } }
			});
			expect(context.r2Entries.has(oldArtifactKey!)).toBe(true);

			clearPublicDiscoveryCache();
			const callsBeforeAnonymousRead = mockServerQuery.mock.calls.length;
			await expect(
				getCachedPublicTemplatePageArtifact(context, 'rolling-page-249')
			).resolves.toMatchObject({ detail: { description: 'Artifact revision 40249' } });
			expect(mockServerQuery.mock.calls).toHaveLength(callsBeforeAnonymousRead);
			now += 61_000;
			clearPublicDiscoveryCache();
		}
		expect(context.platform.env!.PUBLIC_DISCOVERY_R2!.delete).not.toHaveBeenCalled();

		// All new artifacts and the new immutable inventory now exist, but a sibling
		// landing publication fails before the ready manifest can switch authority.
		failLandingPublication = true;
		await expect(
			refreshPublicDiscoveryManifestControl({ platform: context.platform })
		).rejects.toThrow('landing publication failed after page inventory PUT');
		expect(context.r2Entries.has(oldArtifactKey!)).toBe(true);
		clearPublicDiscoveryCache();
		const callsBeforeFailedCutoverRead = mockServerQuery.mock.calls.length;
		await expect(
			getCachedPublicTemplatePageArtifact(context, 'rolling-page-249')
		).resolves.toMatchObject({ detail: { description: 'Artifact revision 40249' } });
		expect(mockServerQuery.mock.calls).toHaveLength(callsBeforeFailedCutoverRead);

		failLandingPublication = false;
		now += 61_000;
		clearPublicDiscoveryCache();
		await refreshPublicDiscoveryManifestControl({ platform: context.platform });
		clearPublicDiscoveryCache();
		await expect(
			getCachedPublicTemplatePageArtifact(context, 'rolling-page-249')
		).resolves.toMatchObject({ detail: { description: 'Artifact revision 50249' } });
		for (const coordinate of coordinates) {
			expect(
				[...context.r2Entries.keys()].some(
					(key) =>
						decodeURIComponent(key).includes(`/template-page:slug=${coordinate.slug}/`) &&
						decodeURIComponent(key).includes(
							`/revision=${coordinate.artifactRevision}/`
						) &&
						key.endsWith('/payload.json')
				)
			).toBe(true);
		}
	}, 20_000);

	it('retires only N-3 payloads and preserves the current and previous generations', async () => {
		const context = contextWithR2();
		let nextManifest = manifest({ ready: true, revision: 1, updatedAt: 100 });
		mockServerQuery.mockImplementation(async (ref: string, args) =>
			safeProducerQueryResult(ref, args, nextManifest)
		);
		for (let revision = 1; revision <= 4; revision += 1) {
			nextManifest = manifest({
				ready: true,
				revision,
				updatedAt: revision * 100
			});
			await refreshPublicDiscoveryManifestControl({ platform: context.platform });
		}

		const payloadKeys = [...context.r2Entries.keys()]
			.filter((key) => key.endsWith('/payload.json'))
			.map((key) => decodeURIComponent(key));
		expect(payloadKeys.filter((key) => key.includes('revision=1:100/'))).toHaveLength(0);
		expect(
			payloadKeys.filter((key) =>
				key.includes('revision=list=1:100;relations=1:100/')
			)
		).toHaveLength(0);
		for (const generation of ['2:200', '3:300', '4:400']) {
			expect(payloadKeys.filter((key) => key.includes(`revision=${generation}/`))).toHaveLength(3);
			expect(
				payloadKeys.filter((key) =>
					key.includes(`revision=list=${generation};relations=${generation}/`)
				)
			).toHaveLength(2);
		}
		const deletedKeys = vi
			.mocked(context.platform.env!.PUBLIC_DISCOVERY_R2!.delete)
			.mock.calls.flatMap(([keys]) => (Array.isArray(keys) ? keys : [keys]))
			.map((key) => decodeURIComponent(String(key)));
		expect(deletedKeys).toHaveLength(5);
		expect(
			deletedKeys.filter((key) => key.includes('revision=1:100/'))
		).toHaveLength(3);
		expect(
			deletedKeys.filter((key) =>
				key.includes('revision=list=1:100;relations=1:100/')
			)
		).toHaveLength(2);
		expect(
			deletedKeys.some(
				(key) =>
					key.includes('revision=3:300/') ||
					key.includes('revision=4:400/') ||
					key.includes('revision=list=3:300;relations=3:300/') ||
					key.includes('revision=list=4:400;relations=4:400/')
			)
		).toBe(false);
		expect(context.platform.env!.PUBLIC_DISCOVERY_R2!.list).toHaveBeenCalledTimes(4);
		expect(
			vi
				.mocked(context.platform.env!.PUBLIC_DISCOVERY_R2!.list)
				.mock.calls.every(
					([options]) =>
						options?.limit === 100 &&
						String(options?.prefix).startsWith('public-template-pages/v1/')
				)
		).toBe(true);
	});

	it('keeps the prior coordinate visible when a new payload prewarm fails', async () => {
		const context = contextWithR2();
		const previousManifest = manifest({ ready: true, revision: 1, updatedAt: 100 });
		mockServerQuery.mockImplementation(async (ref: string, args) =>
			safeProducerQueryResult(ref, args, previousManifest)
		);
		await refreshPublicDiscoveryManifestControl({ platform: context.platform });

		const nextManifest = manifest({ ready: true, revision: 2, updatedAt: 200 });
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) return nextManifest;
			if (ref === api.templates.publicDiscoveryList && args?.excludeCwc) {
				throw new Error('new payload prewarm failed');
			}
			return safeProducerQueryResult(ref, args, nextManifest);
		});
		await expect(
			refreshPublicDiscoveryManifestControl({ platform: context.platform })
		).rejects.toThrow('new payload prewarm failed');

		mockServerQuery.mockClear();
		clearPublicDiscoveryCache();
		await expect(getCachedPublicTemplates(context, true)).resolves.toEqual([
			publicCard('safe-list-exclude')
		]);
		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it('stages withdrawal before retirement/prewarm and remains fail-closed on failure', async () => {
		const context = contextWithR2();
		const previousManifest = manifest({ ready: true, revision: 4, updatedAt: 400 });
		mockServerQuery.mockImplementation(async (ref: string, args) =>
			safeProducerQueryResult(ref, args, previousManifest)
		);
		await refreshPublicDiscoveryManifestControl({ platform: context.platform });

		const withdrawnManifest = manifest(
			{ ready: true, revision: 5, updatedAt: 500 },
			{ ready: false, retiredRevision: 4, revision: 4, updatedAt: 400 }
		);
		let rejectPrewarm!: (error: Error) => void;
		const blockedPrewarm = new Promise<never>((_resolve, reject) => {
			rejectPrewarm = reject;
		});
		mockServerQuery.mockClear();
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) return withdrawnManifest;
			if (ref === api.templates.publicDiscoveryList) return blockedPrewarm;
			return safeProducerQueryResult(ref, args, withdrawnManifest);
		});
		const refresh = refreshPublicDiscoveryManifestControl({ platform: context.platform });
		await vi.waitFor(() =>
			expect(
				mockServerQuery.mock.calls.filter(
					([ref]) => ref === api.templates.publicDiscoveryList
				)
			).toHaveLength(2)
		);
		const r2 = context.platform.env!.PUBLIC_DISCOVERY_R2!;
		const put = vi.mocked(r2.put);
		const stagedPutIndex = put.mock.calls.findLastIndex(([, body]) => {
			try {
				const state = JSON.parse(String(body));
				return (
					state.phase === 'refreshing' &&
					state.previous?.manifest?.relations?.ready === false
				);
			} catch {
				return false;
			}
		});
		expect(stagedPutIndex).toBeGreaterThanOrEqual(0);
		const stagedPutOrder = put.mock.invocationCallOrder[stagedPutIndex];
		for (const order of vi.mocked(r2.delete).mock.invocationCallOrder) {
			expect(order).toBeGreaterThan(stagedPutOrder);
		}
		for (const [index, [ref]] of mockServerQuery.mock.calls.entries()) {
			if (ref === api.templates.publicDiscoveryList) {
				expect(mockServerQuery.mock.invocationCallOrder[index]).toBeGreaterThan(stagedPutOrder);
			}
		}

		await expect(getCachedPublicRelations(context, true)).rejects.toBeInstanceOf(
			PublicDiscoverySnapshotNotReadyError
		);
		expect(
			mockServerQuery.mock.calls.filter(([ref]) => ref === api.templates.publicDiscoveryRelations)
		).toHaveLength(0);

		rejectPrewarm(new Error('list prewarm failed'));
		await expect(refresh).rejects.toThrow('list prewarm failed');
		mockServerQuery.mockClear();
		clearPublicDiscoveryCache();
		await expect(getCachedPublicRelations(context, true)).rejects.toBeInstanceOf(
			PublicDiscoverySnapshotNotReadyError
		);
		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it.each([
		['legacy projection version', { projectionVersion: 3 }],
		['draft card', { status: 'draft' }],
		['published private card', { is_public: false }],
		['raw recipient config', { recipient_config: { recipients: ['private'] } }],
		['recipient address', { recipientEmails: ['private@example.test'] }],
		['missing required field', { message_body: undefined }],
		['object-valued primitive field', { message_body: { recipientEmail: 'private@example.test' } }],
		['malformed primitive-array element', { topics: [{ private: 'value' }] }],
		['non-array object-list field', { jurisdictions: { private: 'value' } }],
		['malformed object-list element', { scopes: [['private@example.test']] }]
	] as const)('rejects %s before the list payload can enter R2', async (_label, patch) => {
		const context = contextWithR2();
		const r2Put = vi.mocked(context.platform?.env?.PUBLIC_DISCOVERY_R2?.put!);
		const readyManifest = manifest({ ready: true, revision: 4, updatedAt: 400 });
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				return readyManifest;
			}
			if (ref === api.templates.publicDiscoveryList) {
				const snapshot = listSnapshot(4, 400, 'unsafe');
				if ('projectionVersion' in patch) Object.assign(snapshot, patch);
				else Object.assign(snapshot.templates[0], patch);
				return snapshot;
			}
			return safeProducerQueryResult(ref, args, readyManifest);
		});
		await expect(
			refreshPublicDiscoveryManifestControl({ platform: context.platform! })
		).rejects.toBeInstanceOf(
			PublicDiscoverySnapshotContractError
		);
		expect(
			r2Put.mock.calls.some(
				([key]) =>
					String(key).includes('templates%3Aexclude-cwc%3D0') &&
					String(key).endsWith('/payload.json')
			)
		).toBe(false);
	});

	it.each([
		['draft', { status: 'draft' }],
		['published-private', { is_public: false }]
	] as const)('rejects %s cards reconstructed from immutable list and graph payloads', async (_label, patch) => {
		const context = contextWithR2();
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const readyManifest = manifest({ ready: true, revision: 4, updatedAt: 400 });
		mockServerQuery.mockImplementation(async (ref: string, args) =>
			safeProducerQueryResult(ref, args, readyManifest)
		);
		await refreshPublicDiscoveryManifestControl({ platform: context.platform! });

		const payload = (logicalKey: string) => {
			const entry = [...context.r2Entries.entries()].find(
				([key]) => decodeURIComponent(key).includes(logicalKey) && key.endsWith('/payload.json')
			);
			expect(entry).toBeDefined();
			return entry!;
		};
		const listEntry = payload('templates:exclude-cwc=1');
		const listEnvelope = JSON.parse(listEntry[1].body);
		Object.assign(listEnvelope.value[0], patch);
		listEntry[1].body = JSON.stringify(listEnvelope);
		listEntry[1].etag = `ineligible-list-${_label}`;

		clearPublicDiscoveryCache();
		mockServerQuery.mockClear();
		await expect(getCachedPublicTemplates(context, true)).rejects.toThrow(
			'could not be read safely'
		);
		expect(mockServerQuery).not.toHaveBeenCalled();

		const graphEntry = payload('landing:graph:v2:exclude-cwc=1');
		const graphEnvelope = JSON.parse(graphEntry[1].body);
		Object.assign(graphEnvelope.value.templates[0], patch);
		graphEntry[1].body = JSON.stringify(graphEnvelope);
		graphEntry[1].etag = `ineligible-graph-${_label}`;

		clearPublicDiscoveryCache();
		await expect(getCachedPublicDiscoveryGraphSurface(context, true)).rejects.toThrow(
			'could not be read safely'
		);
		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it('rejects more than 50 live cards before mapping any card into R2', async () => {
		const context = contextWithR2();
		const r2Put = vi.mocked(context.platform?.env?.PUBLIC_DISCOVERY_R2?.put!);
		const readyManifest = manifest({ ready: true, revision: 4, updatedAt: 400 });
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				return readyManifest;
			}
			if (ref === api.templates.publicDiscoveryList) {
				return {
					...listSnapshot(4, 400, 'unused'),
					templates: [
						null,
						...Array.from({ length: 50 }, (_, index) => publicCard(`card-${index}`))
					]
				};
			}
			return safeProducerQueryResult(ref, args, readyManifest);
		});
		await expect(
			refreshPublicDiscoveryManifestControl({ platform: context.platform! })
		).rejects.toThrow(
			'PUBLIC_DISCOVERY_SNAPSHOT_CONTRACT:list:templates-over-cap:51'
		);
		expect(
			r2Put.mock.calls.some(
				([key]) =>
					String(key).includes('templates%3Aexclude-cwc%3D0') &&
					String(key).endsWith('/payload.json')
			)
		).toBe(false);
	});

	it('fails closed when the exclude-CWC producer leaks a congressional card', async () => {
		const context = contextWithR2();
		const r2Put = vi.mocked(context.platform?.env?.PUBLIC_DISCOVERY_R2?.put!);
		const readyManifest = manifest({ ready: true, revision: 4, updatedAt: 400 });
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				return readyManifest;
			}
			if (ref === api.templates.publicDiscoveryList) {
				return {
					...listSnapshot(4, 400, 'cwc-leak'),
					templates: [{ ...publicCard('cwc-leak'), deliveryMethod: 'cwc' }]
				};
			}
			return safeProducerQueryResult(ref, args, readyManifest);
		});
		await expect(
			refreshPublicDiscoveryManifestControl({ platform: context.platform! })
		).rejects.toMatchObject({
			name: 'PublicDiscoverySnapshotContractError',
			family: 'list'
		});
		expect(
			r2Put.mock.calls.some(
				([key]) =>
					String(key).includes('templates%3Aexclude-cwc%3D1') &&
					String(key).endsWith('/payload.json')
			)
		).toBe(false);
	});

	it('allowlists list cards before returning or persisting them', async () => {
		const context = contextWithR2();
		const readyManifest = manifest({ ready: true, revision: 4, updatedAt: 400 });
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				return readyManifest;
			}
			if (ref === api.templates.publicDiscoveryList) {
				return {
					...listSnapshot(4, 400, 'safe'),
					templates: [
						{
							...publicCard('safe'),
							authorEmail: 'private@example.test',
							delivery_config: { webhookSecret: 'private' },
							cwc_config: { account: 'private' },
							endorsingOrg: {
								name: 'Public Org',
								slug: 'public-org',
								avatar: null,
								ownerEmail: 'private@example.test'
							}
						}
					]
				};
			}
			return safeProducerQueryResult(ref, args, readyManifest);
		});
		await refreshPublicDiscoveryManifestControl({ platform: context.platform! });

		await expect(getCachedPublicTemplates(context, false)).resolves.toEqual([
			{
				...publicCard('safe'),
				endorsingOrg: { name: 'Public Org', slug: 'public-org', avatar: null }
			}
		]);
		const persisted = [...context.r2Entries.values()].map(({ body }) => body).join('\n');
		expect(persisted).not.toContain('private@example.test');
		expect(persisted).not.toContain('webhookSecret');
		expect(persisted).not.toContain('ownerEmail');
	});

	it('does not inspect a poisoned payload LKG when manifest authority is unavailable', async () => {
		const context = contextWithR2();
		const r2List = vi.mocked(context.platform?.env?.PUBLIC_DISCOVERY_R2?.list!);
		await publishFixture(
			context,
			'templates:exclude-cwc=1',
			'4:400',
			[
				{
					...publicCard('poisoned'),
					message_body: { recipientEmail: 'private@example.test' }
				}
			]
		);
		r2List.mockClear();
		clearPublicDiscoveryCache();
		mockServerQuery.mockRejectedValue(new Error('manifest unavailable'));

		await expect(getCachedPublicTemplates(context, true)).rejects.toThrow('STATE_NOT_SEEDED');
		expect(mockServerQuery).not.toHaveBeenCalled();
		expect(r2List).not.toHaveBeenCalled();
	});

	it('does not inspect an over-cap payload LKG when manifest authority is unavailable', async () => {
		const context = contextWithR2();
		const r2List = vi.mocked(context.platform?.env?.PUBLIC_DISCOVERY_R2?.list!);
		await publishFixture(
			context,
			'templates:exclude-cwc=1',
			'4:400',
			Array.from({ length: 51 }, (_, index) => publicCard(`cached-${index}`))
		);
		r2List.mockClear();
		clearPublicDiscoveryCache();
		mockServerQuery.mockRejectedValue(new Error('manifest unavailable'));

		await expect(getCachedPublicTemplates(context, true)).rejects.toThrow('STATE_NOT_SEEDED');
		expect(mockServerQuery).not.toHaveBeenCalled();
		expect(r2List).not.toHaveBeenCalled();
	});

	it('bounds a composite graph publication race to one manifest retry', async () => {
		let manifestReads = 0;
		const relations = {
			revision: 7,
			updatedAt: 700,
			twinEdges: [{ a: 'a', b: 'b', score: 0.8, kind: 'twin' }],
			conceptRelations: { edges: [], conceptMap: {} }
		};
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				manifestReads += 1;
				const generation =
					manifestReads === 1
						? { revision: 6, updatedAt: 600 }
						: { revision: 7, updatedAt: 700 };
				return manifest(
					{ ready: true, revision: 1, updatedAt: 100 },
					{ ready: true, ...generation }
				);
			}
			if (ref === api.templates.publicDiscoveryList) {
				return listSnapshotForIds(1, 100, ['a', 'b']);
			}
			if (ref === api.templates.publicDiscoveryRelations) return relations;
			throw new Error(`Unexpected query: ${ref}`);
		});

		await expect(getCachedPublicRelations(CONTEXT, true)).resolves.toEqual({
			twinEdges: relations.twinEdges,
			conceptRelations: relations.conceptRelations
		});
		expect(
			mockServerQuery.mock.calls.filter(([ref]) => ref === api.templates.publicDiscoveryManifest)
		).toHaveLength(2);
		expect(
			mockServerQuery.mock.calls.filter(([ref]) => ref === api.templates.publicDiscoveryRelations)
		).toHaveLength(2);
		expect(
			mockServerQuery.mock.calls.filter(([ref]) => ref === api.templates.publicDiscoveryList)
		).toHaveLength(2);
		expect(mockServerQuery).toHaveBeenCalledWith(api.templates.publicDiscoveryRelations, {
			_secret: 'public-discovery-test-secret-32-bytes',
			excludeCwc: true
		});
	});

	it('allowlists relation payloads before returning or persisting them', async () => {
		const context = contextWithR2();
		const safeRelations = {
			revision: 8,
			updatedAt: 800,
			twinEdges: [{ a: 'a', b: 'b', score: 0.8, kind: 'twin' as const }],
			conceptRelations: {
				edges: [{ a: 'a', b: 'b', concept: 'libraries', kind: 'concept' as const }],
				conceptMap: { library: 'libraries' }
			}
		};
		const readyManifest = manifest(
			{ ready: true, revision: 1, updatedAt: 100 },
			{ ready: true, revision: 8, updatedAt: 800 }
		);
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				return readyManifest;
			}
			if (ref === api.templates.publicDiscoveryRelations) {
				return {
					...safeRelations,
					recipientEmails: ['private@example.test'],
					twinEdges: [
						{ ...safeRelations.twinEdges[0], recipientEmail: 'private@example.test' }
					]
				};
			}
			if (ref === api.templates.publicDiscoveryList) {
				return listSnapshotForIds(1, 100, ['a', 'b']);
			}
			return safeProducerQueryResult(ref, args, readyManifest);
		});
		await refreshPublicDiscoveryManifestControl({ platform: context.platform! });

		await expect(getCachedPublicRelations(context, true)).resolves.toEqual({
			twinEdges: safeRelations.twinEdges,
			conceptRelations: safeRelations.conceptRelations
		});
		const persisted = [...context.r2Entries.values()].map(({ body }) => body).join('\n');
		expect(persisted).not.toContain('private@example.test');
		expect(persisted).not.toContain('"recipientEmail":');
	});

	it('rejects malformed relation fields before they can enter R2', async () => {
		const context = contextWithR2();
		const r2Put = vi.mocked(context.platform?.env?.PUBLIC_DISCOVERY_R2?.put!);
		const readyManifest = manifest(
			{ ready: true, revision: 1, updatedAt: 100 },
			{ ready: true, revision: 9, updatedAt: 900 }
		);
		mockServerQuery.mockImplementation(async (ref: string, args) => {
			if (ref === api.templates.publicDiscoveryManifest) {
				return readyManifest;
			}
			if (ref === api.templates.publicDiscoveryRelations) {
				return {
					revision: 9,
					updatedAt: 900,
					twinEdges: [{ a: 'a', b: 'b', score: Number.NaN, kind: 'twin' }],
					conceptRelations: { edges: [], conceptMap: {} }
				};
			}
			return safeProducerQueryResult(ref, args, readyManifest);
		});
		await expect(
			refreshPublicDiscoveryManifestControl({ platform: context.platform! })
		).rejects.toMatchObject({
			name: 'PublicDiscoverySnapshotContractError',
			family: 'relations'
		});
		expect(
			r2Put.mock.calls.some(
				([key]) =>
					String(key).includes('relations%3Acombined') &&
					String(key).endsWith('/payload.json')
			)
		).toBe(false);
	});
});
