import {
	query,
	mutation,
	action,
	internalAction,
	internalQuery,
	internalMutation,
	type ActionCtx,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';
import { makeFunctionReference } from 'convex/server';
import type { FunctionReference } from 'convex/server';
import { ConvexError, getConvexSize, v, type Value } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { requireAuth, requireOrgRole, loadOrg } from './_authHelpers';
import { requireInternalSecret } from './_internalAuth';
import {
	startOfMonthUTC,
	decideIndividualAuthoring,
	authoredLimitForPlan,
	AUTHORING_QUOTA_EXCEEDED
} from './_individualAuthoringCap';
import anchorsData from './domain-anchors.json';
import { computeTwinEdges, computeCalibration } from './lib/relatedness';
import { clusterTagConcepts, conceptEdges, tagConceptMap } from './lib/tag_concepts';
import { captureToSentry } from './_sentry';
import {
	MAX_PUBLIC_TEMPLATE_JURISDICTIONS,
	MAX_PUBLIC_TEMPLATE_SCOPES,
	MAX_TEMPLATE_SLUG_BYTES,
	MAX_TEMPLATE_TOPICS,
	MAX_TEMPLATE_TOPIC_BYTES,
	isCanonicalTemplateSlug,
	validateBoundedJson,
	validateTemplateInputBudgets,
	validateTemplateMetadataBudgets
} from './lib/templateInputBudget';
import { isTemplateDeliveryMethod } from './lib/templateDeliveryMethod';
import {
	DAILY_ARRIVAL_BUCKET_MS,
	kFloorCounter,
	kFloorDistrictCount,
	partitionDistrictCountsByFloor,
	zeroBelowCounterFloor
} from './lib/publicAggregatePrivacy';
import {
	PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_MAX_BYTES,
	PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_NOT_READY,
	PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_PROJECTION_VERSION,
	PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED,
	PUBLIC_DISCOVERY_COORDINATED_REBUILD_TOKEN_MISMATCH,
	PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS,
	PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_AGE_MS,
	PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_ATTEMPTS,
	PUBLIC_DISCOVERY_MANIFEST_CONTROL_RETRY_MAX_SECONDS,
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED_BODY,
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED_SIGNAL_HEADER,
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED_SIGNAL_PROTOCOL,
	PUBLIC_DISCOVERY_RELATIONS_DEBOUNCE_MS,
	PUBLIC_DISCOVERY_RELATIONS_MIN_REBUILD_INTERVAL_MS,
	activatePublicDiscoveryManifestAuthority,
	completePublicDiscoveryCoordinatedRebuild,
	commitPublicDiscoveryListPublication,
	commitPublicDiscoveryRelationsPublication,
	assertPublicDiscoveryDirectSourceServingReady,
	getPublicDiscoveryManifestAuthorityRow,
	getPublicDiscoveryManifestRow,
	invalidatePublicDiscoveryAfterDestructiveSourceChange,
	markPublicDiscoveryListAndRelationsDirty,
	markPublicDiscoveryListDirty,
	markPublicDiscoveryRelationsDirty,
	preparePublicDiscoveryListPublication,
	preparePublicDiscoveryRelationsPublication,
	publicDiscoveryManifestControlAttemptCoordinates,
	publicDiscoveryManifestControlRetryDelayMs,
	publicDiscoveryManifestControlRetryDisposition,
	publicDiscoveryManifestAuthorityMatches,
	publicDiscoveryManifestAuthoritySerializedBytes,
	publicDiscoveryListRefreshBypassesMinInterval,
	publicDiscoveryListRefreshRebuildsRelations,
	publicDiscoveryRelationsRefreshBypassesMinInterval,
	reschedulePublicDiscoveryListRefresh,
	reschedulePublicDiscoveryRelationsRefresh,
	toPublicDiscoveryManifestPayloadFromAuthority
} from './lib/publicDiscovery';
import {
	MAX_PUBLIC_RELATION_TAG_VECTORS,
	PUBLIC_TEMPLATE_DETAIL_PROJECTION_VERSION,
	PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION,
	PUBLIC_TEMPLATE_PAGE_ARTIFACT_COORDINATE_VERSION,
	assertCompactPublicTemplateSource,
	deleteCompactPublicDiscoverySource,
	normalizePublicDiscoveryTags,
	publicRecipientIntentCount,
	publicRecipientIntentHash,
	publicRecipientMigrationIntegrityReady,
	publicTemplateDetailProjectionBytes,
	readPublicTemplateDetailProjection,
	readPublicTemplateDiscoveryCandidate,
	syncCompactPublicDiscoveryProjection,
	syncCompactPublicDiscoverySource,
	type CompactPublicTemplateSource,
	type PublicTemplateDiscoveryCandidate
} from './lib/publicTemplateDiscoverySource';
import {
	TEMPLATE_LIST_MAX_PAGE_SIZE,
	TEMPLATE_LIST_PROJECTION_KEY,
	deleteTemplateListProjection,
	getTemplateListProjectionMigration,
	readTemplateListPageByOrg,
	readTemplateListPageByUser,
	requireTemplateListProjectionReady,
	syncTemplateListProjection,
	templateListPaginationValidator,
	toAuthenticatedTemplateListItem,
	toOrgTemplateListItem
} from './lib/templateListProjection';
import {
	LEGACY_ENDORSEMENT_COUNT_REPAIR_LIMIT,
	boundedExactEndorsementCount,
	isAuthoritativeEndorsementCount,
	throwEndorsementCountRepairRequired
} from './lib/templateEndorsementCount';
import {
	PUBLIC_RECIPIENT_PAGE_METRICS_BATCH_MAX,
	readPublicRecipientPageMetricsBatch
} from './lib/recipientMetrics';
import {
	PUBLIC_TEMPLATE_PAGE_DEBATE_BATCH_MAX,
	readPublicTemplatePageDebatesBatch
} from './debates';

declare const process: { env: Record<string, string | undefined> };

const PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL = '3';
const PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL_HEADER =
	'x-public-discovery-refresh-gate-protocol';
const PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PURPOSE_HEADER = 'x-public-discovery-refresh-purpose';
const PUBLIC_DISCOVERY_MANIFEST_REFRESH_PAGE_CONTINUATION_PURPOSE = 'page-backfill-continuation';
const PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_HEADER =
	'x-public-discovery-page-backfill-continuation';

const templateGeographicScopeValidator = v.union(
	v.object({ type: v.literal('international') }),
	v.object({
		type: v.literal('nationwide'),
		country: v.string(),
		displayName: v.optional(v.string())
	}),
	v.object({
		type: v.literal('subnational'),
		country: v.string(),
		subdivision: v.optional(v.string()),
		subdivisionName: v.optional(v.string()),
		locality: v.optional(v.string()),
		displayName: v.optional(v.string())
	})
);

const rateLimitCheckRef = makeFunctionReference<'mutation'>(
	'_rateLimit:check'
) as unknown as FunctionReference<'mutation', 'internal'>;
const textSearchRef = makeFunctionReference<'query'>(
	'templates:textSearch'
) as unknown as FunctionReference<'query', 'internal'>;
const publicDiscoverySearchReadinessRef = makeFunctionReference<'query'>(
	'templates:publicDiscoverySearchReadiness'
) as unknown as FunctionReference<'query', 'internal', Record<string, never>, unknown>;
const migrateTopicEmbeddingMarkersRef = makeFunctionReference<'mutation'>(
	'templates:migrateTopicEmbeddingMarkers'
) as unknown as FunctionReference<'mutation', 'internal'>;
type MissingDomainHuePage = {
	candidates: Array<{ _id: Id<'templates'>; topicEmbedding: number[] }>;
	scanned: number;
	continueCursor: string | null;
	isDone: boolean;
};
const listMissingDomainHueRef = makeFunctionReference<'query'>(
	'templates:_listMissingDomainHue'
) as unknown as FunctionReference<'query', 'internal', { cursor?: string }, MissingDomainHuePage>;
const patchDomainHueRef = makeFunctionReference<'mutation'>(
	'templates:_patchDomainHue'
) as unknown as FunctionReference<'mutation', 'internal'>;
const reportPublicDiscoverySnapshotFailureRef = makeFunctionReference<'action'>(
	'templates:reportPublicDiscoverySnapshotFailure'
) as unknown as FunctionReference<
	'action',
	'internal',
	{ family: 'list' | 'relations'; code: string; failedAt: number },
	unknown
>;
const claimPublicDiscoveryManifestControlPushRef = makeFunctionReference<'mutation'>(
	'templates:claimPublicDiscoveryManifestControlPush'
) as unknown as FunctionReference<'mutation', 'internal', { token: string }, boolean>;
type PublicDiscoveryManifestControlOutcome =
	| 'succeeded'
	| 'contained'
	| 'attemptsExhausted'
	| 'ageExhausted';
const requeuePublicDiscoveryManifestControlPushRef = makeFunctionReference<'mutation'>(
	'templates:requeuePublicDiscoveryManifestControlPush'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{
		attempt: number;
		continuation?: boolean;
		delayMs?: number;
		outcome?: PublicDiscoveryManifestControlOutcome;
		startedAt: number;
		token: string;
	},
	{ requeued: boolean; superseded: boolean }
>;
const pushPublicDiscoveryManifestControlRef = makeFunctionReference<'action'>(
	'templates:pushPublicDiscoveryManifestControl'
) as unknown as FunctionReference<
	'action',
	'internal',
	{ attempt?: number; continuation?: boolean; startedAt?: number; token: string },
	unknown
>;
const rebuildPublicTemplateSnapshotsForCronAttemptRef = makeFunctionReference<'mutation'>(
	'templates:rebuildPublicTemplateSnapshotsForCronAttempt'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	Record<string, never>,
	| { status: 'rebuilt'; rebuilt: PublicTemplateSnapshotRebuildResult }
	| { status: 'oversize' }
	| { status: 'invalid' }
>;
const rebuildRelationSnapshotForCronAttemptRef = makeFunctionReference<'mutation'>(
	'templates:rebuildRelationSnapshotForCronAttempt'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	Record<string, never>,
	| { status: 'rebuilt'; rebuilt: RelationSnapshotRebuildResult }
	| { status: 'oversize' }
	| { status: 'invalid' }
	| { status: 'failed' }
>;
const rebuildHomepageSnapshotsForCronAttemptRef = makeFunctionReference<'mutation'>(
	'templates:rebuildHomepageSnapshotsForCronAttempt'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	Record<string, never>,
	{ status: 'rebuilt'; rebuilt: HomepageSnapshotRebuildResult }
>;
type PublicDiscoveryCronAttemptState = {
	manifestId: Id<'publicDiscoveryManifest'> | null;
	listReady: boolean;
	listRevision: number;
	listUpdatedAt: number | null;
	listScheduledAt: number | null;
	listDirtyAt: number | null;
	listFailureCode: string | null;
	relationsReady: boolean;
	relationsRevision: number;
	relationsUpdatedAt: number | null;
	relationsScheduledAt: number | null;
	relationsDirtyAt: number | null;
	relationsFailureCode: string | null;
	nextTemporalRebuildAt: number | null;
	temporalScheduleVersion: number | null;
};
type PublicDiscoveryCronFailure = {
	family: 'list' | 'relations';
	code: string;
};
const recordPublicDiscoverySnapshotRuntimeFailureRef = makeFunctionReference<'mutation'>(
	'templates:recordPublicDiscoverySnapshotRuntimeFailure'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{
		failures: PublicDiscoveryCronFailure[];
		failedAt: number;
		attempt: PublicDiscoveryCronAttemptState;
	},
	unknown
>;
const publicDiscoveryCronAttemptStateRef = makeFunctionReference<'query'>(
	'templates:publicDiscoveryCronAttemptState'
) as unknown as FunctionReference<
	'query',
	'internal',
	Record<string, never>,
	PublicDiscoveryCronAttemptState
>;
type ScheduledPublicDiscoveryRefreshArgs = {
	scheduledAt: number;
	bypassMinInterval?: boolean;
};
const scheduledPublicDiscoveryRefreshAttemptStateRef = makeFunctionReference<'query'>(
	'templates:scheduledPublicDiscoveryRefreshAttemptState'
) as unknown as FunctionReference<
	'query',
	'internal',
	ScheduledPublicDiscoveryRefreshArgs & { family: 'list' | 'relations' },
	{
		current: boolean;
		rebuildsRelations: boolean;
		relationsScheduledAt?: number;
	}
>;
const flushScheduledPublicTemplateRefreshRef = makeFunctionReference<'mutation'>(
	'templates:flushScheduledPublicTemplateRefresh'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	ScheduledPublicDiscoveryRefreshArgs,
	unknown
>;
const flushScheduledPublicTemplateRelationsRefreshRef = makeFunctionReference<'mutation'>(
	'templates:flushScheduledPublicTemplateRelationsRefresh'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	ScheduledPublicDiscoveryRefreshArgs,
	unknown
>;
const recoverPublicDiscoveryScheduledRefreshFailureRef = makeFunctionReference<'mutation'>(
	'templates:recoverPublicDiscoveryScheduledRefreshFailure'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{
		family: 'list' | 'relations';
		scheduledAt: number;
		relationsScheduledAt?: number;
		code: string;
		failedAt: number;
	},
	unknown
>;
const migratePublicDiscoverySourcePageRef = makeFunctionReference<'mutation'>(
	'templates:migratePublicDiscoverySourcePage'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{
		runToken: string;
		cursor?: string;
		startedAt: number;
		listDirtyAtAtStart?: number;
		relationsDirtyAtAtStart?: number;
		scanned: number;
		eligible: number;
		sourcesWritten: number;
		topicVectorsWritten: number;
		tagVectorsWritten: number;
		rejected: number;
		scheduleContinuation?: boolean;
	},
	unknown
>;
const migrateEndorsementCountsRef = makeFunctionReference<'mutation'>(
	'templates:migrateEndorsementCounts'
) as unknown as FunctionReference<'mutation', 'internal', { runToken: string }, unknown>;
const migrateTemplateListProjectionRef = makeFunctionReference<'mutation'>(
	'templates:migrateTemplateListProjection'
) as unknown as FunctionReference<'mutation', 'internal', { runToken: string }, unknown>;

// ── Domain hue projection (cosine similarity → circular hue interpolation) ──

interface DomainAnchor {
	label: string;
	hue: number;
	embedding: number[];
}
const DOMAIN_ANCHORS: DomainAnchor[] = anchorsData as DomainAnchor[];

function cosineSim(a: number[], b: number[]): number {
	let dot = 0,
		magA = 0,
		magB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		magA += a[i] * a[i];
		magB += b[i] * b[i];
	}
	const denom = Math.sqrt(magA) * Math.sqrt(magB);
	return denom === 0 ? 0 : dot / denom;
}

function projectToHue(embedding: number[], topK = 3): number {
	if (!embedding?.length || DOMAIN_ANCHORS.length === 0) return 0;
	const scored = DOMAIN_ANCHORS.map((a) => ({
		hue: a.hue,
		similarity: cosineSim(embedding, a.embedding)
	}));
	scored.sort((a, b) => b.similarity - a.similarity);
	const top = scored.slice(0, topK);
	const minSim = Math.min(...top.map((t) => t.similarity));
	const shifted = top.map((t) => ({
		hue: t.hue,
		weight: Math.max(0, t.similarity - minSim + 0.01)
	}));
	let sinSum = 0,
		cosSum = 0,
		weightSum = 0;
	for (const s of shifted) {
		const rad = (s.hue * Math.PI) / 180;
		sinSum += s.weight * Math.sin(rad);
		cosSum += s.weight * Math.cos(rad);
		weightSum += s.weight;
	}
	if (weightSum === 0) return 0;
	const angle = (Math.atan2(sinSum / weightSum, cosSum / weightSum) * 180) / Math.PI;
	return ((angle % 360) + 360) % 360;
}

// =============================================================================
// TEMPLATES — Queries & Actions
// =============================================================================

/** Resolve domain from document, falling back to pre-migration category field.
 *  Filters out "General" — the old meaningless deriveCategory() default. */
function resolveDomain(doc: any): string {
	if (doc.domain) return doc.domain;
	const cat = doc.category;
	if (cat && cat !== 'General') return cat;
	return '';
}

/**
 * Normalize a template's `topics` (stored as untyped JSON) into clean tag
 * strings: non-empty trimmed strings only, de-duplicated, stably ordered. Used
 * by the bounded tag-vector intake and the concept query so both see the same
 * vocabulary regardless of how the raw field was authored.
 */
function normalizeTags(topics: unknown): string[] {
	return normalizePublicDiscoveryTags(topics);
}

function toPublicTemplate(t: PublicTemplateEnrichmentSource, score?: number | null) {
	const projected = {
		_id: t._id,
		slug: t.slug,
		title: t.title,
		description: t.description,
		domain: resolveDomain(t),
		domainHue: t.domainHue ?? undefined,
		type: t.type,
		deliveryMethod: t.deliveryMethod,
		status: t.status,
		isPublic: t.isPublic,
		verifiedSends: kFloorCounter(t.verifiedSends),
		uniqueDistricts: kFloorDistrictCount(t.uniqueDistricts),
		createdAt: new Date(t._creationTime).toISOString()
	};
	return score === undefined ? projected : { ...projected, _score: score };
}

/**
 * Retired legacy surface. It used to hydrate 50 canonical, embedding-bearing
 * rows and selected published-but-private templates. Keeping only an internal
 * coded tombstone makes accidental callers fail before any database I/O.
 */
export const list = internalQuery({
	args: {},
	handler: async () => {
		throw new ConvexError({ code: 'TEMPLATES_LIST_RETIRED' });
	}
});

/**
 * Public: Get a single template by slug.
 */
export const getBySlug = query({
	args: { _secret: v.optional(v.string()), slug: v.string() },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret ?? '');
		if (
			args.slug.length === 0 ||
			new TextEncoder().encode(args.slug).byteLength > MAX_TEMPLATE_SLUG_BYTES
		) {
			throw new ConvexError({
				code: 'TEMPLATE_SLUG_VALUE_INVALID',
				maxBytes: MAX_TEMPLATE_SLUG_BYTES
			});
		}
		await requireTemplateListProjectionReady(ctx);
		const template = await ctx.db
			.query('templateListProjections')
			.withIndex('by_slug', (q) => q.eq('slug', args.slug))
			.unique();

		if (!template) return null;

		// A public surface requires both publication and explicit visibility.
		if (template.status !== 'published' || !template.isPublic) {
			return null;
		}

		return {
			id: template.templateId,
			slug: template.slug,
			title: template.title,
			status: template.status,
			isPublic: template.isPublic
		};
	}
});

/** One server call for the requested slug plus up to five collision candidates. */
export const templateSlugsExist = query({
	args: { _secret: v.optional(v.string()), slugs: v.array(v.string()) },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret ?? '');
		if (args.slugs.length < 1 || args.slugs.length > 6) {
			throw new ConvexError({ code: 'TEMPLATE_SLUG_BATCH_SIZE_INVALID', max: 6 });
		}
		if (new Set(args.slugs).size !== args.slugs.length) {
			throw new ConvexError({ code: 'TEMPLATE_SLUG_BATCH_DUPLICATE' });
		}
		const encoder = new TextEncoder();
		if (args.slugs.some((slug) => slug.length === 0 || encoder.encode(slug).byteLength > 400)) {
			throw new ConvexError({ code: 'TEMPLATE_SLUG_BATCH_VALUE_INVALID', maxBytes: 400 });
		}
		await requireTemplateListProjectionReady(ctx);
		return await Promise.all(
			args.slugs.map(async (slug) => {
				const row = await ctx.db
					.query('templateListProjections')
					.withIndex('by_slug', (q) => q.eq('slug', slug))
					.first();
				return row !== null;
			})
		);
	}
});

type PublicTemplateSnapshotKey = 'all' | 'excludeCwc';
type RelationSnapshotKey = PublicTemplateSnapshotKey;
const PUBLIC_TEMPLATE_SNAPSHOT_SCAN_CAP = 250;
const PUBLIC_TEMPLATE_SNAPSHOT_VARIANT_CAP = 50;
const PUBLIC_TEMPLATE_SNAPSHOT_VALIDATION_BATCH = 50;
const PUBLIC_TEMPLATE_PROJECTION_VERSION = 4;
// TemplateCard renders three avatars. Read the newest six endorsement rows so
// filtering a possible owner endorsement still leaves a bounded display sample.
// Across the worst-case 250-row validation scan this permits <=1,500 endorsement
// rows and <=1,500 endorsement-org gets. Normal healthy corpora stop after the
// first 50-card batch. The authoritative counter travels separately; this array
// is never a total.
const PUBLIC_TEMPLATE_ENDORSEMENT_CAP = 6;
const RELATION_SNAPSHOT_VARIANT_CAP = 50;
// Fifty cards at this cap leave roughly 100 KB for the row envelope and array
// metadata below the 900 KB document guard. Exact aggregate sizing below is
// still authoritative and deterministically sheds the largest remaining card
// if a future schema expansion consumes that headroom.
const MAX_PUBLIC_TEMPLATE_CARD_BYTES = 16_000;
const MAX_PUBLIC_TEMPLATE_SNAPSHOT_BYTES = 900_000;
const PUBLIC_DISCOVERY_SOURCE_MIGRATION_KEY = 'v1' as const;
const PUBLIC_DISCOVERY_SOURCE_MIGRATION_PAGE_SIZE = 4;

async function publicDiscoverySourceMigrationRow(ctx: { db: QueryCtx['db'] }) {
	return await ctx.db
		.query('publicDiscoverySourceMigrations')
		.withIndex('by_key', (q) => q.eq('key', PUBLIC_DISCOVERY_SOURCE_MIGRATION_KEY))
		.unique();
}

/**
 * A completed migration is the explicit producer cutover. Until it is ready,
 * every compact-plane consumer fails closed; there is no legacy template-scan
 * fallback. After cutover, template-owned projection writers dual-write this
 * plane in the same transaction. General discovery dirty timestamps also cover
 * live joins and therefore are not a source-freshness signal.
 */
async function compactDiscoveryPlaneReady(ctx: { db: QueryCtx['db'] }) {
	const migration = await publicDiscoverySourceMigrationRow(ctx);
	if (
		migration?.status !== 'ready' ||
		migration.completedAt === undefined ||
		migration.projectionVersion !== PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION ||
		migration.pageArtifactCoordinatesWritten !== migration.sourcesWritten ||
		!publicRecipientMigrationIntegrityReady(migration)
	) {
		throw new Error('PUBLIC_DISCOVERY_SOURCE_PLANE_NOT_READY');
	}
	return migration;
}

async function upsertCompactDiscoveryProjection(
	ctx: MutationCtx,
	template: Doc<'templates'>,
	requestedGeneration?: string
): Promise<{ source: boolean }> {
	return await syncCompactPublicDiscoveryProjection(ctx, template, requestedGeneration);
}

async function upsertCompactDiscoverySource(
	ctx: MutationCtx,
	template: Doc<'templates'>,
	requestedGeneration?: string
): Promise<{
	source: boolean;
	topic: boolean;
	tags: number;
	publicRecipientCount: number;
}> {
	return await syncCompactPublicDiscoverySource(ctx, template, requestedGeneration);
}

async function deleteCompactDiscoveryRows(
	ctx: MutationCtx,
	templateId: Id<'templates'>
): Promise<void> {
	await deleteCompactPublicDiscoverySource(ctx, templateId);
}

function classifyPublicTemplateSnapshotFreeze(error: unknown): 'oversize' | 'invalid' | null {
	if (!(error instanceof Error)) return null;
	if (error.message.startsWith('PUBLIC_TEMPLATE_SNAPSHOT_TOO_LARGE:')) return 'oversize';
	if (error.message.startsWith('PUBLIC_TEMPLATE_SNAPSHOT_NO_VALID_CARDS:')) return 'invalid';
	if (error.message.startsWith('PUBLIC_TEMPLATE_SNAPSHOT_INVALID:')) return 'invalid';
	return null;
}

/** Emit the out-of-band alert scheduled by a failed snapshot mutation. */
export const reportPublicDiscoverySnapshotFailure = internalAction({
	args: {
		family: v.union(v.literal('list'), v.literal('relations')),
		code: v.string(),
		failedAt: v.number()
	},
	handler: async (_ctx, args) => {
		await captureToSentry(new Error(args.code), {
			action: 'templates:publicDiscoverySnapshotRebuild',
			level: 'error',
			extra: { family: args.family, failedAt: args.failedAt, code: args.code }
		});
		return { reported: true };
	}
});

/**
 * Push a committed ready/withdrawn control state to the authenticated Pages
 * writer. The minute Cloudflare cron is the recovery backstop; this producer
 * hook keeps ordinary publication visibility inside the 60-second lease.
 */
async function readBoundedManifestRefreshFailure(
	response: Response,
	maximumBytes = 512
): Promise<string> {
	const declared = response.headers.get('content-length');
	if (declared !== null) {
		if (!/^\d+$/.test(declared)) return '<invalid-content-length>';
		const declaredBytes = Number(declared);
		if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maximumBytes) {
			return '<response-too-large>';
		}
	}
	if (!response.body) return '';
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let received = 0;
	let detail = '';
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			received += chunk.value.byteLength;
			if (received > maximumBytes) {
				await reader.cancel('manifest refresh failure response too large').catch(() => undefined);
				return '<response-too-large>';
			}
			detail += decoder.decode(chunk.value, { stream: true });
		}
		detail += decoder.decode();
		return detail;
	} finally {
		reader.releaseLock();
	}
}

/**
 * Containment is terminal only when the trusted artifact's entire small wire
 * contract agrees. A generic 503, a copied header, or a protocol/body drift is
 * an ordinary bounded failure and cannot silently suppress producer recovery.
 */
async function isExactPublicDiscoveryManifestRefreshContainment(
	response: Response
): Promise<boolean> {
	if (
		response.status !== 503 ||
		response.headers.get(PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED_SIGNAL_HEADER) !==
			PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED_SIGNAL_PROTOCOL ||
		response.headers.get('content-type') !== 'application/json; charset=utf-8' ||
		response.headers.get('cache-control') !== 'no-store' ||
		response.headers.get(PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL_HEADER) !== null ||
		response.headers.get(PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_HEADER) !== null ||
		response.headers.get('retry-after') !== null
	) {
		return false;
	}
	return (
		(await readBoundedManifestRefreshFailure(response)) ===
		PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED_BODY
	);
}

/**
 * Claim and clear one queued producer notification before network I/O. A
 * publication racing the action observes the cleared slot and schedules one
 * successor; an obsolete/duplicate action cannot clear that successor token.
 */
export const claimPublicDiscoveryManifestControlPush = internalMutation({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const manifest = await getPublicDiscoveryManifestRow(ctx);
		if (!manifest || manifest.manifestControlPushToken !== args.token) return false;
		await ctx.db.patch(manifest._id, { manifestControlPushToken: undefined });
		return true;
	}
});

/**
 * Settle a completed chain or restore one bounded notification only when no
 * newer publication already owns the durable slot. Terminal settlement never
 * touches the slot, so a racing successor remains authoritative. Retry state
 * and its scheduler write commit atomically.
 */
export const requeuePublicDiscoveryManifestControlPush = internalMutation({
	args: {
		attempt: v.number(),
		continuation: v.optional(v.boolean()),
		delayMs: v.optional(v.number()),
		outcome: v.optional(
			v.union(
				v.literal('succeeded'),
				v.literal('contained'),
				v.literal('attemptsExhausted'),
				v.literal('ageExhausted')
			)
		),
		startedAt: v.number(),
		token: v.string()
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		if (
			!Number.isSafeInteger(args.attempt) ||
			args.attempt < 1 ||
			args.attempt > PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_ATTEMPTS ||
			!Number.isSafeInteger(args.startedAt) ||
			args.startedAt < 0 ||
			args.startedAt > now
		) {
			throw new Error('PUBLIC_DISCOVERY_MANIFEST_REFRESH_RETRY_COORDINATE_INVALID');
		}
		const manifest = await getPublicDiscoveryManifestRow(ctx);
		if (!manifest) return { requeued: false, superseded: true };
		if (args.outcome !== undefined) {
			if (args.delayMs !== undefined || args.continuation !== undefined) {
				throw new Error('PUBLIC_DISCOVERY_MANIFEST_REFRESH_OUTCOME_INVALID');
			}
			await ctx.db.patch(manifest._id, {
				manifestControlPushLastOutcome: args.outcome,
				manifestControlPushLastOutcomeAt: now,
				manifestControlPushLastOutcomeAttempt: args.attempt,
				manifestControlPushLastOutcomeStartedAt: args.startedAt
			});
			return {
				requeued: false,
				superseded: manifest.manifestControlPushToken !== undefined
			};
		}
		if (
			args.delayMs === undefined ||
			!Number.isSafeInteger(args.delayMs) ||
			args.delayMs < 1_000 ||
			args.delayMs > 301_000 ||
			args.attempt < 2 ||
			now + args.delayMs - args.startedAt >= PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_AGE_MS
		) {
			throw new Error('PUBLIC_DISCOVERY_MANIFEST_REFRESH_RETRY_DELAY_INVALID');
		}
		if (manifest.manifestControlPushToken !== undefined) {
			return { requeued: false, superseded: true };
		}
		await ctx.db.patch(manifest._id, { manifestControlPushToken: args.token });
		await ctx.scheduler.runAfter(args.delayMs, pushPublicDiscoveryManifestControlRef, {
			attempt: args.attempt,
			...(args.continuation === true ? { continuation: true } : {}),
			startedAt: args.startedAt,
			token: args.token
		});
		return { requeued: true, superseded: false };
	}
});

export const pushPublicDiscoveryManifestControl = internalAction({
	args: {
		attempt: v.optional(v.number()),
		continuation: v.optional(v.boolean()),
		startedAt: v.optional(v.number()),
		token: v.string()
	},
	handler: async (ctx, args) => {
		const claimed = await ctx.runMutation(claimPublicDiscoveryManifestControlPushRef, {
			token: args.token
		});
		if (!claimed) return { refreshed: false, superseded: true };
		const coordinates = publicDiscoveryManifestControlAttemptCoordinates(
			args.attempt,
			args.startedAt,
			Date.now()
		);
		const settle = async (outcome: PublicDiscoveryManifestControlOutcome) =>
			await ctx.runMutation(requeuePublicDiscoveryManifestControlPushRef, {
				attempt: coordinates.attempt,
				outcome,
				startedAt: coordinates.startedAt,
				token: args.token
			});
		if (
			!coordinates.legacy &&
			Date.now() - coordinates.startedAt >= PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_AGE_MS
		) {
			const terminal = await settle('ageExhausted');
			return {
				exhausted: true,
				outcome: 'ageExhausted' as const,
				refreshed: false,
				retryScheduled: false,
				superseded: terminal.superseded
			};
		}
		try {
			const endpoint = process.env.PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL;
			const secret = process.env.DISCOVERY_MANIFEST_REFRESH_SECRET;
			if (!endpoint || !secret || new TextEncoder().encode(secret).byteLength < 32) {
				throw new Error('PUBLIC_DISCOVERY_MANIFEST_REFRESH_NOT_CONFIGURED');
			}
			let url: URL;
			try {
				url = new URL(endpoint);
			} catch {
				throw new Error('PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL_INVALID');
			}
			if (
				url.protocol !== 'https:' ||
				url.username ||
				url.password ||
				url.pathname !== '/api/internal/public-discovery-manifest-refresh' ||
				url.search ||
				url.hash
			) {
				throw new Error('PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL_INVALID');
			}
			const response = await fetch(url, {
				body: '{}',
				headers: {
					'content-type': 'application/json',
					...(args.continuation === true
						? {
								[PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PURPOSE_HEADER]:
									PUBLIC_DISCOVERY_MANIFEST_REFRESH_PAGE_CONTINUATION_PURPOSE
							}
						: {}),
					'x-public-discovery-manifest-refresh-secret': secret
				},
				method: 'POST',
				signal: AbortSignal.timeout(10_000)
			});
			if (await isExactPublicDiscoveryManifestRefreshContainment(response)) {
				const terminal = await settle('contained');
				return {
					contained: true,
					refreshed: false,
					retryScheduled: false,
					superseded: terminal.superseded
				};
			}
			if (response.status === 202) {
				if (
					response.headers.get(PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL_HEADER) !==
					PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL
				) {
					throw new Error('PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL_INVALID');
				}
				const continuationHeader = response.headers.get(
					PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_HEADER
				);
				if (continuationHeader !== null && continuationHeader !== '1') {
					throw new Error('PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_PROTOCOL_INVALID');
				}
				const delayMs = publicDiscoveryManifestControlRetryDelayMs(
					response.headers.get('retry-after')
				);
				if (delayMs === null) {
					throw new Error('PUBLIC_DISCOVERY_MANIFEST_REFRESH_RETRY_AFTER_INVALID');
				}
				const disposition = publicDiscoveryManifestControlRetryDisposition({
					attempt: coordinates.attempt,
					delayMs,
					now: Date.now(),
					startedAt: coordinates.startedAt
				});
				if (!disposition.retry) {
					const terminal = await settle(disposition.outcome);
					return {
						exhausted: true,
						outcome: disposition.outcome,
						refreshed: false,
						retryScheduled: false,
						superseded: terminal.superseded
					};
				}
				const retry = await ctx.runMutation(requeuePublicDiscoveryManifestControlPushRef, {
					attempt: disposition.nextAttempt,
					...(args.continuation === true || continuationHeader === '1'
						? { continuation: true }
						: {}),
					delayMs,
					startedAt: coordinates.startedAt,
					token: args.token
				});
				return {
					refreshed: false,
					retryScheduled: retry.requeued,
					superseded: retry.superseded
				};
			}
			if (!response.ok) {
				const detail = await readBoundedManifestRefreshFailure(response);
				throw new Error(`PUBLIC_DISCOVERY_MANIFEST_REFRESH_FAILED:${response.status}:${detail}`);
			}
			if (
				response.headers.get(PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL_HEADER) !==
				PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL
			) {
				throw new Error('PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL_INVALID');
			}
			const completed = await settle('succeeded');
			return completed.superseded ? { refreshed: true, superseded: true } : { refreshed: true };
		} catch (error) {
			// Claim-before-I/O lets a racing publication install a successor token.
			// Every ordinary failure either preserves that successor, restores one
			// bounded retry, or stamps terminal singleton evidence. The independent
			// Cloudflare cron is eventual recovery after a terminal producer chain.
			const delayMs = publicDiscoveryManifestControlRetryDelayMs(
				String(PUBLIC_DISCOVERY_MANIFEST_CONTROL_RETRY_MAX_SECONDS)
			);
			if (delayMs === null) {
				throw new Error('PUBLIC_DISCOVERY_MANIFEST_REFRESH_RETRY_DELAY_INVALID', {
					cause: error
				});
			}
			const disposition = publicDiscoveryManifestControlRetryDisposition({
				attempt: coordinates.attempt,
				delayMs,
				now: Date.now(),
				startedAt: coordinates.startedAt
			});
			if (disposition.retry) {
				await ctx.runMutation(requeuePublicDiscoveryManifestControlPushRef, {
					attempt: disposition.nextAttempt,
					...(args.continuation === true ? { continuation: true } : {}),
					delayMs,
					startedAt: coordinates.startedAt,
					token: args.token
				});
			} else {
				await settle(disposition.outcome);
			}
			throw error;
		}
	}
});

async function recordPublicDiscoverySnapshotFailure(
	ctx: MutationCtx,
	manifest: Doc<'publicDiscoveryManifest'>,
	family: 'list' | 'relations',
	error: Error,
	failedAt: number,
	previousFailure?: { code?: string; failedAt?: number },
	expectedScheduledAt?: number | null
): Promise<void> {
	const code = error.message.slice(0, 500);
	const currentCode = family === 'list' ? manifest.listFailureCode : manifest.relationsFailureCode;
	const currentFailedAt = family === 'list' ? manifest.listFailureAt : manifest.relationsFailureAt;
	const priorCode = previousFailure === undefined ? currentCode : previousFailure.code;
	const priorFailedAt = previousFailure === undefined ? currentFailedAt : previousFailure.failedAt;
	const repeatedFailure = priorCode === code && priorFailedAt !== undefined;
	const durableFailedAt = repeatedFailure ? priorFailedAt : failedAt;
	const currentScheduledAt =
		family === 'list' ? manifest.listRefreshScheduledAt : manifest.relationsRefreshScheduledAt;
	const mayClearScheduledToken =
		expectedScheduledAt === undefined ||
		currentScheduledAt === (expectedScheduledAt === null ? undefined : expectedScheduledAt);

	// A successful-but-degraded publication first clears the old failure in its
	// commit marker, then calls this helper with `previousFailure`. If the exact
	// same unsafe source rows are still present, retain their original evidence
	// without re-dirtying the just-published revision or emitting another alert.
	// A source write will dirty the family again, while the daily supervisor can
	// still prove whether the degradation has been repaired.
	const listDirtyAt =
		repeatedFailure && previousFailure !== undefined
			? undefined
			: (manifest.listDirtyAt ?? failedAt);
	const relationsDirtyAt =
		repeatedFailure && previousFailure !== undefined
			? undefined
			: (manifest.relationsDirtyAt ?? failedAt);
	await ctx.db.patch(
		manifest._id,
		family === 'list'
			? {
					listDirtyAt,
					...(mayClearScheduledToken ? { listRefreshScheduledAt: undefined } : {}),
					listFailureAt: durableFailedAt,
					listFailureCode: code
				}
			: {
					relationsDirtyAt,
					...(mayClearScheduledToken ? { relationsRefreshScheduledAt: undefined } : {}),
					relationsFailureAt: durableFailedAt,
					relationsFailureCode: code
				}
	);
	if (!repeatedFailure) {
		await ctx.scheduler.runAfter(0, reportPublicDiscoverySnapshotFailureRef, {
			family,
			code,
			failedAt
		});
	}
}

async function freezePublicDiscoverySnapshotFailure(
	ctx: MutationCtx,
	family: 'list' | 'relations',
	error: Error,
	failedAt: number,
	expectedScheduledAt?: number | null
): Promise<void> {
	let manifest = await getPublicDiscoveryManifestRow(ctx);
	if (manifest?.coordinatedRebuildToken !== undefined) {
		// A cron/operator attempt without the owning token must not translate the
		// lock rejection into failure metadata or clear coordinated dirty state.
		throw error;
	}
	if (!manifest) {
		// A first-ever cron can fail before a manifest exists. Create the tiny
		// dirty control row through the normal scheduler path. An in-transaction
		// deterministic freeze clears that token; guarded action recovery retains
		// it because the cron observed no token before the failed attempt.
		if (family === 'list') {
			await markPublicDiscoveryListDirty(ctx, 'aggregate', failedAt);
		} else {
			await markPublicDiscoveryRelationsDirty(ctx, failedAt);
		}
		manifest = await getPublicDiscoveryManifestRow(ctx);
	}
	if (!manifest) throw error;

	await recordPublicDiscoverySnapshotFailure(
		ctx,
		manifest,
		family,
		error,
		failedAt,
		undefined,
		expectedScheduledAt
	);
	console.error(
		`[public-discovery] ${family} snapshot frozen at last-good until the next source write or daily cron: ${error.message}`
	);
}

/** Persist a failure observed outside the failed rebuild mutation transaction. */
export const recordPublicDiscoverySnapshotRuntimeFailure = internalMutation({
	args: {
		failures: v.array(
			v.object({
				family: v.union(v.literal('list'), v.literal('relations')),
				code: v.string()
			})
		),
		failedAt: v.number(),
		attempt: v.object({
			manifestId: v.union(v.id('publicDiscoveryManifest'), v.null()),
			listReady: v.boolean(),
			listRevision: v.number(),
			listUpdatedAt: v.union(v.number(), v.null()),
			listScheduledAt: v.union(v.number(), v.null()),
			listDirtyAt: v.union(v.number(), v.null()),
			listFailureCode: v.union(v.string(), v.null()),
			relationsReady: v.boolean(),
			relationsRevision: v.number(),
			relationsUpdatedAt: v.union(v.number(), v.null()),
			relationsScheduledAt: v.union(v.number(), v.null()),
			relationsDirtyAt: v.union(v.number(), v.null()),
			relationsFailureCode: v.union(v.string(), v.null()),
			nextTemporalRebuildAt: v.union(v.number(), v.null()),
			temporalScheduleVersion: v.union(v.number(), v.null())
		})
	},
	handler: async (ctx, args) => {
		const manifest = await getPublicDiscoveryManifestRow(ctx);
		if (manifest?.coordinatedRebuildToken !== undefined) {
			return { recorded: [] as Array<'list' | 'relations'> };
		}
		const sameManifest = (manifest?._id ?? null) === args.attempt.manifestId;
		const eligible = sameManifest
			? args.failures.filter(({ family }, index, failures) => {
					if (failures.findIndex((failure) => failure.family === family) !== index) return false;
					return family === 'list'
						? (manifest?.listRevision ?? 0) === args.attempt.listRevision &&
								(manifest?.listUpdatedAt ?? null) === args.attempt.listUpdatedAt
						: (manifest?.relationsRevision ?? 0) === args.attempt.relationsRevision &&
								(manifest?.relationsUpdatedAt ?? null) === args.attempt.relationsUpdatedAt;
				})
			: [];

		// Compute eligibility before the first freeze. A first-ever composite cron
		// has no manifest; recording the list failure creates one, but the sibling
		// relation failure still belongs to the same absent-manifest attempt.
		const recorded: Array<'list' | 'relations'> = [];
		for (const failure of eligible) {
			await freezePublicDiscoverySnapshotFailure(
				ctx,
				failure.family,
				new Error(failure.code.slice(0, 500)),
				args.failedAt,
				failure.family === 'list' ? args.attempt.listScheduledAt : args.attempt.relationsScheduledAt
			);
			recorded.push(failure.family);
		}
		return { recorded };
	}
});

/** Capture publication identity, coordinates, and tokens before a cron attempt. */
export const publicDiscoveryCronAttemptState = internalQuery({
	args: {},
	handler: async (ctx) => {
		const manifest = await ctx.db
			.query('publicDiscoveryManifest')
			.withIndex('by_key', (q) => q.eq('key', 'public'))
			.unique();
		return {
			manifestId: manifest?._id ?? null,
			listReady: manifest?.listReady ?? false,
			listRevision: manifest?.listRevision ?? 0,
			listUpdatedAt: manifest?.listUpdatedAt ?? null,
			listScheduledAt: manifest?.listRefreshScheduledAt ?? null,
			listDirtyAt: manifest?.listDirtyAt ?? null,
			listFailureCode: manifest?.listFailureCode ?? null,
			relationsReady: manifest?.relationsReady ?? false,
			relationsRevision: manifest?.relationsRevision ?? 0,
			relationsUpdatedAt: manifest?.relationsUpdatedAt ?? null,
			relationsScheduledAt: manifest?.relationsRefreshScheduledAt ?? null,
			relationsDirtyAt: manifest?.relationsDirtyAt ?? null,
			relationsFailureCode: manifest?.relationsFailureCode ?? null,
			nextTemporalRebuildAt: manifest?.nextTemporalRebuildAt ?? null,
			temporalScheduleVersion: manifest?.temporalScheduleVersion ?? null
		};
	}
});

/**
 * Capture the tokens a supervised scheduled attempt is about to consume.
 *
 * The action/mutation boundary is intentional: if the rebuild transaction
 * rolls back after a database-write failure, the supervising action still has
 * the exact pre-attempt tokens needed to record the failure without clearing a
 * newer generation scheduled by a concurrent source write.
 */
export const scheduledPublicDiscoveryRefreshAttemptState = internalQuery({
	args: {
		family: v.union(v.literal('list'), v.literal('relations')),
		scheduledAt: v.number()
	},
	handler: async (ctx, args) => {
		const manifest = await ctx.db
			.query('publicDiscoveryManifest')
			.withIndex('by_key', (q) => q.eq('key', 'public'))
			.unique();
		const current =
			args.family === 'list'
				? manifest?.listRefreshScheduledAt === args.scheduledAt
				: manifest?.relationsRefreshScheduledAt === args.scheduledAt;
		const rebuildsRelations =
			args.family === 'list' && current && publicDiscoveryListRefreshRebuildsRelations(manifest);

		return {
			current,
			rebuildsRelations,
			...(rebuildsRelations && manifest?.relationsRefreshScheduledAt !== undefined
				? { relationsScheduledAt: manifest.relationsRefreshScheduledAt }
				: {})
		};
	}
});

/**
 * Persist an unknown scheduled rebuild failure after its mutation rolled back.
 * Token equality is the authority to clear a job: a newer writer-owned token
 * is never touched. A failed composite list attempt records both affected
 * families so neither elapsed token can spin or silently disappear.
 */
export const recoverPublicDiscoveryScheduledRefreshFailure = internalMutation({
	args: {
		family: v.union(v.literal('list'), v.literal('relations')),
		scheduledAt: v.number(),
		relationsScheduledAt: v.optional(v.number()),
		code: v.string(),
		failedAt: v.number()
	},
	handler: async (ctx, args) => {
		const manifest = await getPublicDiscoveryManifestRow(ctx);
		if (!manifest) return { recorded: [] as Array<'list' | 'relations'> };
		if (manifest.coordinatedRebuildToken !== undefined) {
			return { recorded: [] as Array<'list' | 'relations'> };
		}

		const recorded: Array<'list' | 'relations'> = [];
		if (args.family === 'list' && manifest.listRefreshScheduledAt === args.scheduledAt) {
			await recordPublicDiscoverySnapshotFailure(
				ctx,
				manifest,
				'list',
				new Error(args.code.slice(0, 500)),
				args.failedAt
			);
			recorded.push('list');
		}

		if (args.family === 'relations' && manifest.relationsRefreshScheduledAt === args.scheduledAt) {
			await recordPublicDiscoverySnapshotFailure(
				ctx,
				manifest,
				'relations',
				new Error(args.code.slice(0, 500)),
				args.failedAt
			);
			recorded.push('relations');
		} else if (
			args.family === 'list' &&
			args.relationsScheduledAt !== undefined &&
			manifest.relationsRefreshScheduledAt === args.relationsScheduledAt
		) {
			await recordPublicDiscoverySnapshotFailure(
				ctx,
				manifest,
				'relations',
				new Error(`PUBLIC_DISCOVERY_RELATIONS_COMPOSITE_REBUILD_FAILED:${args.code}`.slice(0, 500)),
				args.failedAt
			);
			recorded.push('relations');
		}

		return { recorded };
	}
});

async function superviseScheduledPublicDiscoveryRefresh(
	ctx: ActionCtx,
	family: 'list' | 'relations',
	attempt: FunctionReference<'mutation', 'internal', ScheduledPublicDiscoveryRefreshArgs, unknown>,
	args: ScheduledPublicDiscoveryRefreshArgs
) {
	let relationsScheduledAt: number | undefined;
	try {
		const state = await ctx.runQuery(scheduledPublicDiscoveryRefreshAttemptStateRef, {
			family,
			scheduledAt: args.scheduledAt
		});
		if (state.current && state.rebuildsRelations) {
			relationsScheduledAt = state.relationsScheduledAt;
		}
		return await ctx.runMutation(attempt, args);
	} catch (error) {
		const failedAt = Date.now();
		const message = error instanceof Error ? error.message : String(error);
		await ctx.runMutation(recoverPublicDiscoveryScheduledRefreshFailureRef, {
			family,
			scheduledAt: args.scheduledAt,
			...(relationsScheduledAt !== undefined ? { relationsScheduledAt } : {}),
			code: `PUBLIC_DISCOVERY_${family.toUpperCase()}_SCHEDULED_REBUILD_FAILED:${message}`.slice(
				0,
				500
			),
			failedAt
		});
		throw error;
	}
}

/** Durable supervisor for the list token scheduled by publicDiscovery.ts. */
export const superviseScheduledPublicTemplateRefresh = internalAction({
	args: { scheduledAt: v.number(), bypassMinInterval: v.optional(v.boolean()) },
	handler: async (ctx, args) =>
		await superviseScheduledPublicDiscoveryRefresh(
			ctx,
			'list',
			flushScheduledPublicTemplateRefreshRef,
			args
		)
});

/** Durable supervisor for the relation token scheduled by publicDiscovery.ts. */
export const superviseScheduledPublicTemplateRelationsRefresh = internalAction({
	args: { scheduledAt: v.number(), bypassMinInterval: v.optional(v.boolean()) },
	handler: async (ctx, args) =>
		await superviseScheduledPublicDiscoveryRefresh(
			ctx,
			'relations',
			flushScheduledPublicTemplateRelationsRefreshRef,
			args
		)
});

async function supervisePublicDiscoveryCronRebuild<Result>(
	ctx: ActionCtx,
	family: 'list' | 'relations',
	attempt: FunctionReference<'mutation', 'internal', Record<string, never>, Result>
): Promise<Result> {
	// The failed attempt rolls back, then recovery runs in a fresh transaction.
	// Capture publication coordinates first so recovery cannot re-dirty a newer
	// successful generation or clear a successor token from a source writer.
	const attemptState = await ctx.runQuery(publicDiscoveryCronAttemptStateRef, {});
	try {
		return await ctx.runMutation(attempt, {});
	} catch (error) {
		const failedAt = Date.now();
		const message = error instanceof Error ? error.message : String(error);
		await ctx.runMutation(recordPublicDiscoverySnapshotRuntimeFailureRef, {
			failures: [
				{
					family,
					code: `PUBLIC_DISCOVERY_${family.toUpperCase()}_REBUILD_FAILED:${message}`.slice(0, 500)
				}
			],
			failedAt,
			attempt: attemptState
		});
		throw error;
	}
}

/**
 * Align a stored oldest-first rolling arrival window with the materialization
 * day without mutating the source template. Arrival writes shift the window
 * when traffic resumes; this projection also ages it on quiet templates so an
 * old final bucket cannot continue to look like today's activity indefinitely.
 * Legacy rows without dailyArrivalsLastDay retain their existing shape because
 * there is no truthful anchor from which to infer elapsed days.
 */
function normalizeDailyArrivalsForSnapshot(
	arrivals: number[] | undefined,
	lastDay: number | undefined,
	materializedAt: number
): number[] {
	if (!arrivals || arrivals.length === 0) return [];
	if (lastDay === undefined || !Number.isFinite(lastDay)) return [...arrivals];

	const currentDay = Math.floor(materializedAt / DAILY_ARRIVAL_BUCKET_MS) * DAILY_ARRIVAL_BUCKET_MS;
	const anchoredDay = Math.floor(lastDay / DAILY_ARRIVAL_BUCKET_MS) * DAILY_ARRIVAL_BUCKET_MS;
	const elapsedDays = Math.floor((currentDay - anchoredDay) / DAILY_ARRIVAL_BUCKET_MS);
	if (elapsedDays <= 0) return [...arrivals];
	if (elapsedDays >= arrivals.length) return new Array<number>(arrivals.length).fill(0);

	return [...arrivals.slice(elapsedDays), ...new Array<number>(elapsedDays).fill(0)];
}

/**
 * Build the existing `listPublic` projection over a bounded, already-selected
 * source set. This helper is mutation-only: public requests must read the
 * materialized payload and never call it.
 */
type PublicTemplateEnrichmentSource = Doc<'templates'> | CompactPublicTemplateSource;

/** Earliest clock-only instant at which an unchanged selected card can differ. */
function nextPublicTemplateTemporalRebuildAt(
	templates: PublicTemplateEnrichmentSource[],
	materializedAt: number
): number | null {
	let next: number | null = null;
	const consider = (candidate: number): void => {
		if (!Number.isSafeInteger(candidate) || candidate <= materializedAt) return;
		next = next === null ? candidate : Math.min(next, candidate);
	};
	for (const template of templates) {
		const newUntil = template._creationTime + 7 * DAILY_ARRIVAL_BUCKET_MS;
		if (materializedAt <= newUntil) consider(Math.floor(newUntil) + 1);

		const arrivals = normalizeDailyArrivalsForSnapshot(
			template.dailyArrivals,
			template.dailyArrivalsLastDay,
			materializedAt
		);
		if (arrivals.some((count) => Number.isFinite(count) && count !== 0)) {
			consider(
				Math.floor(materializedAt / DAILY_ARRIVAL_BUCKET_MS) * DAILY_ARRIVAL_BUCKET_MS +
					DAILY_ARRIVAL_BUCKET_MS
			);
		}
	}
	return next;
}

function requireAuthoritativeEndorsementCount(template: PublicTemplateEnrichmentSource): number {
	const count = template.endorsementCount;
	if (!Number.isSafeInteger(count) || (count ?? -1) < 0) {
		throw new Error(
			`PUBLIC_TEMPLATE_SNAPSHOT_INVALID:${template._id}:endorsement-count-not-materialized`
		);
	}
	return count as number;
}

async function enrichPublicTemplates(
	ctx: MutationCtx,
	templates: PublicTemplateEnrichmentSource[]
) {
	const templateIds = templates.map((t) => t._id);

	// Batch-fetch related data in parallel
	const [allDebates, allEndorsements, orgMap] = await Promise.all([
		// Debates for these templates
		Promise.all(
			templateIds.map((tid) =>
				ctx.db
					.query('debates')
					.withIndex('by_templateId', (q) => q.eq('templateId', tid))
					.order('desc')
					.first()
			)
		),
		// Endorsements for these templates
		Promise.all(
			templateIds.map((tid) =>
				ctx.db
					.query('templateEndorsements')
					.withIndex('by_templateId', (q) => q.eq('templateId', tid))
					.order('desc')
					.take(PUBLIC_TEMPLATE_ENDORSEMENT_CAP)
			)
		),
		// Collect unique orgIds and batch-fetch orgs
		(async () => {
			const orgIds = new Set<Id<'organizations'>>();
			for (const t of templates) {
				if (t.orgId) orgIds.add(t.orgId);
			}
			const orgs = await Promise.all([...orgIds].map((id) => ctx.db.get(id)));
			const map = new Map<string, { name: string; slug: string; avatar: string | null }>();
			for (const org of orgs) {
				if (org) {
					map.set(org._id, { name: org.name, slug: org.slug, avatar: org.avatar ?? null });
				}
			}
			return map;
		})()
	]);

	// Also fetch orgs from endorsements
	const endorsementOrgIds = new Set<Id<'organizations'>>();
	for (const endorsements of allEndorsements) {
		for (const e of endorsements) {
			endorsementOrgIds.add(e.orgId);
		}
	}
	// Remove already-fetched orgIds
	for (const key of orgMap.keys()) {
		endorsementOrgIds.delete(key as Id<'organizations'>);
	}
	// Fetch remaining endorsement orgs
	const extraOrgs = await Promise.all([...endorsementOrgIds].map((id) => ctx.db.get(id)));
	for (const org of extraOrgs) {
		if (org) {
			orgMap.set(org._id, { name: org.name, slug: org.slug, avatar: org.avatar ?? null });
		}
	}

	// Build enriched results
	const materializedAt = Date.now();
	return templates.map((template, i) => {
		const debate = allDebates[i];
		const endorsements = allEndorsements[i] ?? [];
		// `endorsements` is only the newest display sample. Publishing its bounded
		// length as the total silently undercounts legacy templates, so retain the
		// last-good snapshot until the authoritative counter migration completes.
		const endorsementCount = requireAuthoritativeEndorsementCount(template);

		// Endorsing org (template owner)
		const endorsingOrg = template.orgId ? (orgMap.get(template.orgId) ?? null) : null;

		// Additional endorsing orgs (excluding the template owner)
		const endorsingOrgs = endorsements
			.filter((e) => e.orgId !== template.orgId)
			.map((e) => orgMap.get(e.orgId))
			.filter((o): o is NonNullable<typeof o> => o != null);

		// Debate summary
		const hasActiveDebate = debate?.status === 'active';
		// debate.status was tightened to a closed union; the prior
		// `!== "cancelled"` defensive check is now dead (the validator
		// would reject any row with that value at write time). Keep the
		// null-guard on `debate` itself; drop the obsolete value check.
		const debateSummary = debate
			? {
					status: debate.status,
					winningStance: debate.winningStance ?? undefined,
					uniqueParticipants: kFloorCounter(debate.uniqueParticipants ?? 0),
					argumentCount: kFloorCounter(debate.argumentCount ?? 0),
					deadline: debate.deadline ? new Date(debate.deadline).toISOString() : undefined
				}
			: undefined;

		// Coordination scale
		const sendCount = template.verifiedSends || 0;
		const coordinationScale = Math.min(1.0, Math.log10(Math.max(1, sendCount)) / 3);
		const creationTime = template._creationTime;
		const daysSinceCreation = (materializedAt - creationTime) / (1000 * 60 * 60 * 24);
		const isNew = daysSinceCreation <= 7;
		const dailyArrivals = normalizeDailyArrivalsForSnapshot(
			template.dailyArrivals,
			template.dailyArrivalsLastDay,
			materializedAt
		);
		const retainedDistrictCounts = template.districtCounts ?? [];
		const { visible: visibleDistrictCounts, suppressed: privacySuppressedDistrictCounts } =
			partitionDistrictCountsByFloor(retainedDistrictCounts);
		const projectionSuppressedDistricts =
			'districtCountsSuppressedDistricts' in template
				? template.districtCountsSuppressedDistricts
				: 0;
		const projectionSuppressedCount =
			'districtCountsSuppressedCount' in template ? template.districtCountsSuppressedCount : 0;

		return {
			id: template._id,
			slug: template.slug,
			title: template.title,
			description: template.description,
			domain: resolveDomain(template),
			domainHue: template.domainHue ?? undefined,
			topics: normalizeTags(template.topics).slice(0, 200),
			type: template.type,
			deliveryMethod: template.deliveryMethod,
			subject: template.title,
			message_body: template.messageBody,
			preview: template.preview,
			endorsingOrg,
			endorsingOrgs,
			endorsementCount,
			coordinationScale,
			isNew,
			hasActiveDebate,
			debateSummary,
			verified_sends: kFloorCounter(template.verifiedSends),
			unique_districts: kFloorDistrictCount(template.uniqueDistricts),
			send_count: kFloorCounter(template.verifiedSends),
			daily_arrivals: dailyArrivals.map((c: number) => zeroBelowCounterFloor(c)),
			// District rows, tier buckets and daily buckets below the shared
			// counter floor are suppressed here; see
			// convex/lib/publicAggregatePrivacy.ts for why.
			district_counts: visibleDistrictCounts,
			district_counts_suppressed_districts:
				projectionSuppressedDistricts + privacySuppressedDistrictCounts.length,
			district_counts_suppressed_count:
				projectionSuppressedCount +
				privacySuppressedDistrictCounts.reduce((total, district) => total + district.count, 0),
			tier_counts: (template.tierCounts ?? []).map((c: number) => zeroBelowCounterFloor(c)),
			// Discovery cards never execute delivery. Provider routing and CWC
			// workflow configuration are not part of any anonymous public payload.
			delivery_config: {},
			cwc_config: null,
			// Recipient addresses and decision-maker configuration are private source
			// data. Anonymous discovery needs only the non-identifying target count.
			recipient_config: null,
			recipient_count:
				'recipientCount' in template
					? template.recipientCount
					: publicRecipientIntentCount(template.recipientConfig),
			campaign_id: template.campaignId ?? null,
			status: template.status,
			is_public: template.isPublic,
			jurisdictions: (template.jurisdictions ?? []).map((j, ji) => ({
				id: template._id + '_j' + ji,
				template_id: template._id,
				jurisdiction_type: j.jurisdictionType,
				congressional_district: j.congressionalDistrict ?? null,
				senate_class: j.senateClass ?? null,
				state_code: j.stateCode ?? null,
				state_senate_district: j.stateSenateDistrict ?? null,
				state_house_district: j.stateHouseDistrict ?? null,
				county_fips: j.countyFips ?? null,
				county_name: j.countyName ?? null,
				city_name: j.cityName ?? null,
				city_fips: j.cityFips ?? null,
				school_district_id: j.schoolDistrictId ?? null,
				school_district_name: j.schoolDistrictName ?? null,
				latitude: j.latitude ?? null,
				longitude: j.longitude ?? null,
				estimated_population: j.estimatedPopulation ?? null,
				coverage_notes: j.coverageNotes ?? null
			})),
			scope:
				(template.scopes ?? []).length > 0
					? {
							id: template._id + '_s0',
							template_id: template._id,
							country_code: template.scopes![0].countryCode,
							region_code: template.scopes![0].regionCode ?? null,
							locality_code: template.scopes![0].localityCode ?? null,
							district_code: template.scopes![0].districtCode ?? null,
							display_text: template.scopes![0].displayText,
							scope_level: template.scopes![0].scopeLevel,
							confidence: template.scopes![0].confidence,
							extraction_method: template.scopes![0].extractionMethod
						}
					: null,
			scopes: (template.scopes ?? []).map((s, si) => ({
				id: template._id + '_s' + si,
				template_id: template._id,
				country_code: s.countryCode,
				region_code: s.regionCode ?? null,
				locality_code: s.localityCode ?? null,
				district_code: s.districtCode ?? null,
				display_text: s.displayText,
				scope_level: s.scopeLevel,
				confidence: s.confidence,
				extraction_method: s.extractionMethod
			})),
			recipientEmails: [],
			createdAt: new Date(creationTime).toISOString()
		};
	});
}

type PublicTemplatePayload = Awaited<ReturnType<typeof enrichPublicTemplates>>[number];

/**
 * Runtime schema for producer-trusted snapshot rows.
 *
 * `publicTemplateSnapshots.templates` remains `v.any()` during the live-row
 * migration, but public readers never return a stored object or nested producer
 * object verbatim. The `Record<keyof PublicTemplatePayload, SnapshotField>`
 * constraint also makes a newly added producer field fail type-check until its
 * public exposure and runtime shape are reviewed.
 */
type SnapshotField =
	| { kind: 'string' }
	| { kind: 'number' }
	| { kind: 'boolean' }
	| { kind: 'redacted'; replacement: 'emptyObject' | 'emptyArray' | 'null' }
	| { kind: 'optional'; value: SnapshotField }
	| { kind: 'nullable'; value: SnapshotField }
	| { kind: 'array'; value: SnapshotField; maxItems: number }
	| { kind: 'object'; fields: Record<string, SnapshotField> };

type SnapshotSchemaFor<T> = {
	[K in keyof T]-?: undefined extends T[K]
		? Extract<SnapshotField, { kind: 'optional' }>
		: Exclude<SnapshotField, { kind: 'optional' }>;
};

const SNAPSHOT_STRING = { kind: 'string' } as const satisfies SnapshotField;
const SNAPSHOT_NUMBER = { kind: 'number' } as const satisfies SnapshotField;
const SNAPSHOT_BOOLEAN = { kind: 'boolean' } as const satisfies SnapshotField;
const snapshotRedacted = (
	replacement: 'emptyObject' | 'emptyArray' | 'null'
): Extract<SnapshotField, { kind: 'redacted' }> => ({ kind: 'redacted', replacement });
const snapshotOptional = <T extends SnapshotField>(value: T): { kind: 'optional'; value: T } => ({
	kind: 'optional',
	value
});
const snapshotNullable = <T extends SnapshotField>(value: T): { kind: 'nullable'; value: T } => ({
	kind: 'nullable',
	value
});
const snapshotArray = <T extends SnapshotField>(
	value: T,
	maxItems: number
): { kind: 'array'; value: T; maxItems: number } => ({
	kind: 'array',
	value,
	maxItems
});
const snapshotObject = <T extends Record<string, SnapshotField>>(
	fields: T
): { kind: 'object'; fields: T } => ({
	kind: 'object',
	fields
});

const SNAPSHOT_ORG = snapshotObject({
	name: SNAPSHOT_STRING,
	slug: SNAPSHOT_STRING,
	avatar: snapshotNullable(SNAPSHOT_STRING)
});
const SNAPSHOT_SCOPE = snapshotObject({
	id: SNAPSHOT_STRING,
	template_id: SNAPSHOT_STRING,
	country_code: SNAPSHOT_STRING,
	region_code: snapshotNullable(SNAPSHOT_STRING),
	locality_code: snapshotNullable(SNAPSHOT_STRING),
	district_code: snapshotNullable(SNAPSHOT_STRING),
	display_text: SNAPSHOT_STRING,
	scope_level: SNAPSHOT_STRING,
	confidence: SNAPSHOT_NUMBER,
	extraction_method: SNAPSHOT_STRING
});
const SNAPSHOT_JURISDICTION = snapshotObject({
	id: SNAPSHOT_STRING,
	template_id: SNAPSHOT_STRING,
	jurisdiction_type: SNAPSHOT_STRING,
	congressional_district: snapshotNullable(SNAPSHOT_STRING),
	senate_class: snapshotNullable(SNAPSHOT_STRING),
	state_code: snapshotNullable(SNAPSHOT_STRING),
	state_senate_district: snapshotNullable(SNAPSHOT_STRING),
	state_house_district: snapshotNullable(SNAPSHOT_STRING),
	county_fips: snapshotNullable(SNAPSHOT_STRING),
	county_name: snapshotNullable(SNAPSHOT_STRING),
	city_name: snapshotNullable(SNAPSHOT_STRING),
	city_fips: snapshotNullable(SNAPSHOT_STRING),
	school_district_id: snapshotNullable(SNAPSHOT_STRING),
	school_district_name: snapshotNullable(SNAPSHOT_STRING),
	latitude: snapshotNullable(SNAPSHOT_NUMBER),
	longitude: snapshotNullable(SNAPSHOT_NUMBER),
	estimated_population: snapshotNullable(SNAPSHOT_NUMBER),
	coverage_notes: snapshotNullable(SNAPSHOT_STRING)
});

const PUBLIC_TEMPLATE_SNAPSHOT_SCHEMA = {
	id: SNAPSHOT_STRING,
	slug: SNAPSHOT_STRING,
	title: SNAPSHOT_STRING,
	description: SNAPSHOT_STRING,
	domain: SNAPSHOT_STRING,
	domainHue: snapshotOptional(SNAPSHOT_NUMBER),
	topics: snapshotArray(SNAPSHOT_STRING, 200),
	type: SNAPSHOT_STRING,
	deliveryMethod: SNAPSHOT_STRING,
	subject: SNAPSHOT_STRING,
	message_body: SNAPSHOT_STRING,
	preview: SNAPSHOT_STRING,
	endorsingOrg: snapshotNullable(SNAPSHOT_ORG),
	endorsingOrgs: snapshotArray(SNAPSHOT_ORG, PUBLIC_TEMPLATE_ENDORSEMENT_CAP),
	endorsementCount: SNAPSHOT_NUMBER,
	coordinationScale: SNAPSHOT_NUMBER,
	isNew: SNAPSHOT_BOOLEAN,
	hasActiveDebate: SNAPSHOT_BOOLEAN,
	debateSummary: snapshotOptional(
		snapshotObject({
			status: SNAPSHOT_STRING,
			winningStance: snapshotOptional(SNAPSHOT_STRING),
			uniqueParticipants: snapshotNullable(SNAPSHOT_NUMBER),
			argumentCount: snapshotNullable(SNAPSHOT_NUMBER),
			deadline: snapshotOptional(SNAPSHOT_STRING)
		})
	),
	verified_sends: snapshotNullable(SNAPSHOT_NUMBER),
	unique_districts: snapshotNullable(SNAPSHOT_NUMBER),
	send_count: snapshotNullable(SNAPSHOT_NUMBER),
	daily_arrivals: snapshotArray(SNAPSHOT_NUMBER, 30),
	district_counts: snapshotArray(
		snapshotObject({ code: SNAPSHOT_STRING, count: SNAPSHOT_NUMBER }),
		6
	),
	district_counts_suppressed_districts: SNAPSHOT_NUMBER,
	district_counts_suppressed_count: SNAPSHOT_NUMBER,
	tier_counts: snapshotArray(SNAPSHOT_NUMBER, 6),
	// These compatibility keys are deliberately represented as redactions in
	// the schema itself. There is no generic "config" projector that a future
	// field can accidentally use to clone producer secrets into public output.
	delivery_config: snapshotRedacted('emptyObject'),
	cwc_config: snapshotRedacted('null'),
	recipient_config: snapshotRedacted('null'),
	recipient_count: SNAPSHOT_NUMBER,
	campaign_id: snapshotNullable(SNAPSHOT_STRING),
	status: SNAPSHOT_STRING,
	is_public: SNAPSHOT_BOOLEAN,
	jurisdictions: snapshotArray(SNAPSHOT_JURISDICTION, MAX_PUBLIC_TEMPLATE_JURISDICTIONS),
	scope: snapshotNullable(SNAPSHOT_SCOPE),
	scopes: snapshotArray(SNAPSHOT_SCOPE, MAX_PUBLIC_TEMPLATE_SCOPES),
	recipientEmails: snapshotRedacted('emptyArray'),
	createdAt: SNAPSHOT_STRING
} satisfies SnapshotSchemaFor<PublicTemplatePayload>;

const INVALID_SNAPSHOT_VALUE = Symbol('INVALID_SNAPSHOT_VALUE');

function projectSnapshotField(
	value: unknown,
	field: SnapshotField
): unknown | typeof INVALID_SNAPSHOT_VALUE {
	switch (field.kind) {
		case 'string':
			return typeof value === 'string' ? value : INVALID_SNAPSHOT_VALUE;
		case 'number':
			return typeof value === 'number' && Number.isFinite(value) ? value : INVALID_SNAPSHOT_VALUE;
		case 'boolean':
			return typeof value === 'boolean' ? value : INVALID_SNAPSHOT_VALUE;
		case 'redacted':
			return field.replacement === 'emptyObject'
				? {}
				: field.replacement === 'emptyArray'
					? []
					: null;
		case 'optional':
			return projectSnapshotField(value, field.value);
		case 'nullable':
			return value === null ? null : projectSnapshotField(value, field.value);
		case 'array': {
			if (!Array.isArray(value) || value.length > field.maxItems) return INVALID_SNAPSHOT_VALUE;
			const projected: unknown[] = [];
			for (const item of value) {
				const next = projectSnapshotField(item, field.value);
				if (next === INVALID_SNAPSHOT_VALUE) return INVALID_SNAPSHOT_VALUE;
				projected.push(next);
			}
			return projected;
		}
		case 'object': {
			if (value === null || typeof value !== 'object' || Array.isArray(value)) {
				return INVALID_SNAPSHOT_VALUE;
			}
			const stored = value as Record<string, unknown>;
			const projected: Record<string, unknown> = {};
			for (const [name, nestedField] of Object.entries(field.fields)) {
				if (!Object.prototype.hasOwnProperty.call(stored, name) || stored[name] === undefined) {
					if (nestedField.kind === 'optional') continue;
					return INVALID_SNAPSHOT_VALUE;
				}
				const next = projectSnapshotField(stored[name], nestedField);
				if (next === INVALID_SNAPSHOT_VALUE) return INVALID_SNAPSHOT_VALUE;
				projected[name] = next;
			}
			return projected;
		}
	}
}

function projectStoredPublicTemplate(value: unknown): PublicTemplatePayload | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const stored = value as Record<string, unknown>;
	const projected: Record<string, unknown> = {};
	for (const [name, field] of Object.entries(PUBLIC_TEMPLATE_SNAPSHOT_SCHEMA)) {
		// Redact/minimize legacy snapshots at the public read boundary as well as
		// in the producer. The replacement travels with the field descriptor, so a
		// rename or newly reviewed config field cannot fall through to generic JSON
		// cloning merely because a hard-coded field-name list was not updated.
		if (field.kind === 'redacted') {
			projected[name] = projectSnapshotField(undefined, field);
			continue;
		}
		if (
			name === 'recipient_count' &&
			(!Object.prototype.hasOwnProperty.call(stored, name) || stored[name] === undefined)
		) {
			const legacyEmailCount = Array.isArray(stored.recipientEmails)
				? stored.recipientEmails.filter((email) => typeof email === 'string').length
				: 0;
			projected[name] = Math.max(
				publicRecipientIntentCount(stored.recipient_config),
				legacyEmailCount
			);
			continue;
		}
		if (!Object.prototype.hasOwnProperty.call(stored, name) || stored[name] === undefined) {
			if (field.kind === 'optional') continue;
			return null;
		}
		const next = projectSnapshotField(stored[name], field);
		if (next === INVALID_SNAPSHOT_VALUE) return null;
		projected[name] = next;
	}
	const template = projected as PublicTemplatePayload;
	// The stored snapshot is a denormalized trust boundary, not proof that the
	// source selector was correct. Manual corruption or a future migration must
	// never make a well-shaped draft/private card anonymously visible.
	if (template.status !== 'published' || template.is_public !== true) return null;
	return template;
}

function projectStoredPublicTemplates(
	value: unknown,
	context: { key: PublicTemplateSnapshotKey; revision: number }
): PublicTemplatePayload[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		console.error(
			`[public-discovery] PUBLIC_TEMPLATE_SNAPSHOT_STORED_INVALID:key=${context.key}:revision=${context.revision}:container=non_array`
		);
		return [];
	}

	const templates: PublicTemplatePayload[] = [];
	let dropped = 0;
	for (const stored of value) {
		const template = projectStoredPublicTemplate(stored);
		if (template) templates.push(template);
		else dropped += 1;
	}
	if (dropped > 0) {
		// Queries cannot schedule the Sentry action without violating Convex query
		// purity. Emit one stable, counted error per read so Convex log alerts can
		// detect at-rest/manual corruption without sacrificing the valid cards.
		console.error(
			`[public-discovery] PUBLIC_TEMPLATE_SNAPSHOT_STORED_INVALID:key=${context.key}:revision=${context.revision}:dropped=${dropped}:stored=${value.length}`
		);
	}
	return templates;
}

/**
 * One bounded operator cutover from the legacy control row to its compact
 * public authority projection. The compact insert/replace is the activation
 * event; the public reader never falls back to the wide row.
 */
export const migratePublicDiscoveryManifestAuthority = internalMutation({
	args: {},
	handler: async (ctx) => await activatePublicDiscoveryManifestAuthority(ctx)
});

async function readPublicDiscoveryManifestAuthorityStatus(ctx: QueryCtx) {
	const [manifest, authority] = await Promise.all([
		getPublicDiscoveryManifestRow(ctx),
		getPublicDiscoveryManifestAuthorityRow(ctx)
	]);
	const bytes = authority ? publicDiscoveryManifestAuthoritySerializedBytes(authority) : null;
	let matches = false;
	if (authority) {
		try {
			matches = publicDiscoveryManifestAuthorityMatches(authority, manifest);
		} catch {
			matches = false;
		}
	}
	return {
		ready:
			authority !== null &&
			authority.projectionVersion === PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_PROJECTION_VERSION &&
			bytes !== null &&
			bytes <= PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_MAX_BYTES &&
			matches,
		bytes,
		maxBytes: PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_MAX_BYTES,
		projectionVersion: authority?.projectionVersion ?? null,
		matches
	};
}

/** Read-only pre-Pages proof using the existing server-read secret. */
export const publicDiscoveryManifestAuthorityStatus = query({
	args: { _secret: v.optional(v.string()) },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret ?? '');
		return await readPublicDiscoveryManifestAuthorityStatus(ctx);
	}
});

/** CLI-safe operator proof; avoids putting the server secret in process args. */
export const publicDiscoveryManifestAuthorityOperatorStatus = internalQuery({
	args: {},
	handler: async (ctx) => await readPublicDiscoveryManifestAuthorityStatus(ctx)
});

/**
 * Tiny compact control plane for edge versioning and honest cold starts.
 * Missing authority means the one-time cutover has not completed and fails
 * closed. A successful empty-corpus rebuild remains `ready:true`, revision 1.
 */
export const publicDiscoveryManifest = query({
	args: { _secret: v.optional(v.string()) },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret ?? '');
		const authority = await getPublicDiscoveryManifestAuthorityRow(ctx);
		if (!authority) throw new Error(PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_NOT_READY);
		return toPublicDiscoveryManifestPayloadFromAuthority(authority);
	}
});

/** Operator detail for a producer serving a frozen or explicitly degraded revision. */
export const publicDiscoveryFailureStatus = internalQuery({
	args: {},
	handler: async (ctx) => {
		const manifest = await ctx.db
			.query('publicDiscoveryManifest')
			.withIndex('by_key', (q) => q.eq('key', 'public'))
			.unique();
		return {
			list:
				manifest?.listFailureAt === undefined
					? null
					: { failedAt: manifest.listFailureAt, code: manifest.listFailureCode ?? 'UNKNOWN' },
			relations:
				manifest?.relationsFailureAt === undefined
					? null
					: {
							failedAt: manifest.relationsFailureAt,
							code: manifest.relationsFailureCode ?? 'UNKNOWN'
						}
		};
	}
});

/** Observable state for the additive compact-source/vector cutover. */
export const publicDiscoverySourceMigrationStatus = internalQuery({
	args: {},
	handler: async (ctx) => {
		const migration = await publicDiscoverySourceMigrationRow(ctx);
		return migration
			? {
					status: migration.status,
					projectionVersion: migration.projectionVersion ?? null,
					runToken: migration.runToken,
					startedAt: migration.startedAt,
					completedAt: migration.completedAt ?? null,
					scanned: migration.scanned,
					eligible: migration.eligible,
					sourcesWritten: migration.sourcesWritten,
					pageArtifactCoordinatesWritten: migration.pageArtifactCoordinatesWritten ?? null,
					topicVectorsWritten: migration.topicVectorsWritten,
					tagVectorsWritten: migration.tagVectorsWritten,
					rejected: migration.rejected,
					recipientIntentTemplates: migration.recipientIntentTemplates ?? null,
					recipientIntentRecipients: migration.recipientIntentRecipients ?? null,
					recipientProjectedRecipients: migration.recipientProjectedRecipients ?? null,
					recipientLossTemplates: migration.recipientLossTemplates ?? null,
					recipientLossRecipients: migration.recipientLossRecipients ?? null,
					recipientLossClassifiedTemplates: migration.recipientLossClassifiedTemplates ?? null,
					recipientLossClassifiedRecipients: migration.recipientLossClassifiedRecipients ?? null
				}
			: { status: 'not-started' as const };
	}
});

type PublicRecipientMigrationDisposition =
	| 'no_intent'
	| 're_attested'
	| 'pending'
	| 'intentionally_redacted';

async function recordPublicRecipientMigrationReview(
	ctx: MutationCtx,
	template: Doc<'templates'>,
	runToken: string,
	projectedCount: number
) {
	const intentCount = publicRecipientIntentCount(template.recipientConfig);
	const intentHash = await publicRecipientIntentHash(template.recipientConfig);
	const lostRecipients = Math.max(0, intentCount - projectedCount);
	const existing = await ctx.db
		.query('publicRecipientMigrationReviews')
		.withIndex('by_templateId', (q) => q.eq('templateId', template._id))
		.unique();
	let disposition: PublicRecipientMigrationDisposition;
	if (intentCount === 0) disposition = 'no_intent';
	else if (lostRecipients === 0) disposition = 're_attested';
	else if (
		existing?.projectionVersion === PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION &&
		existing.intentHash === intentHash &&
		existing.disposition === 'intentionally_redacted'
	) {
		disposition = 'intentionally_redacted';
	} else {
		disposition = 'pending';
	}
	const now = Date.now();
	const row = {
		templateId: template._id,
		projectionVersion: PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION,
		runToken,
		intentHash,
		intentCount,
		projectedCount,
		disposition,
		operatorReference:
			disposition === 'intentionally_redacted' ? existing?.operatorReference : undefined,
		classifiedAt: disposition === 'intentionally_redacted' ? existing?.classifiedAt : undefined,
		updatedAt: now
	};
	if (existing) await ctx.db.patch(existing._id, row);
	else await ctx.db.insert('publicRecipientMigrationReviews', row);
	const classified = disposition === 'intentionally_redacted';
	return {
		intentTemplates: intentCount > 0 ? 1 : 0,
		intentRecipients: intentCount,
		projectedRecipients: projectedCount,
		lossTemplates: lostRecipients > 0 ? 1 : 0,
		lossRecipients: lostRecipients,
		classifiedTemplates: classified ? 1 : 0,
		classifiedRecipients: classified ? lostRecipients : 0
	};
}

/** Bounded operator queue; it exposes IDs, counts, and hashes, never raw recipient PII. */
export const listPublicRecipientMigrationBlockers = internalQuery({
	args: { cursor: v.optional(v.string()), limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		if ((args.cursor?.length ?? 0) > 2_048) {
			throw new Error('PUBLIC_RECIPIENT_MIGRATION_CURSOR_INVALID');
		}
		const limit = args.limit ?? 25;
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
			throw new Error('PUBLIC_RECIPIENT_MIGRATION_LIMIT_INVALID');
		}
		const migration = await publicDiscoverySourceMigrationRow(ctx);
		if (
			!migration ||
			migration.status !== 'migrated' ||
			migration.projectionVersion !== PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION
		) {
			throw new Error('PUBLIC_RECIPIENT_MIGRATION_REVIEW_NOT_READY');
		}
		const page = await ctx.db
			.query('publicRecipientMigrationReviews')
			.withIndex('by_disposition_runToken', (q) =>
				q.eq('disposition', 'pending').eq('runToken', migration.runToken)
			)
			.order('asc')
			.paginate({ cursor: args.cursor ?? null, numItems: limit });
		return {
			page: page.page.map((review) => ({
				templateId: review.templateId,
				intentHash: review.intentHash,
				intentCount: review.intentCount,
				projectedCount: review.projectedCount
			})),
			continueCursor: page.isDone ? null : page.continueCursor
		};
	}
});

/**
 * Explicitly accept redaction for one exact current private-intent hash. The
 * source migration must be rerun afterward so activation proves every loss
 * against a complete bounded scan rather than trusting mutable review rows.
 */
export const classifyPublicRecipientMigrationRedaction = internalMutation({
	args: {
		templateId: v.id('templates'),
		expectedIntentHash: v.string(),
		operatorReference: v.string()
	},
	handler: async (ctx, args) => {
		if (!/^[a-f0-9]{64}$/.test(args.expectedIntentHash)) {
			throw new Error('PUBLIC_RECIPIENT_MIGRATION_HASH_INVALID');
		}
		const operatorReference = args.operatorReference.trim();
		if (operatorReference.length === 0 || operatorReference.length > 512) {
			throw new Error('PUBLIC_RECIPIENT_MIGRATION_REFERENCE_INVALID');
		}
		const migration = await publicDiscoverySourceMigrationRow(ctx);
		if (
			!migration ||
			migration.status !== 'migrated' ||
			migration.projectionVersion !== PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION
		) {
			throw new Error('PUBLIC_RECIPIENT_MIGRATION_REVIEW_NOT_READY');
		}
		const template = await ctx.db.get(args.templateId);
		if (!template || template.status !== 'published' || template.isPublic !== true) {
			throw new Error('PUBLIC_RECIPIENT_MIGRATION_TEMPLATE_INELIGIBLE');
		}
		const intentHash = await publicRecipientIntentHash(template.recipientConfig);
		if (intentHash !== args.expectedIntentHash) {
			throw new Error('PUBLIC_RECIPIENT_MIGRATION_INTENT_CHANGED');
		}
		const intentCount = publicRecipientIntentCount(template.recipientConfig);
		const detailRow = await ctx.db
			.query('publicTemplateDetailProjections')
			.withIndex('by_templateId', (q) => q.eq('templateId', template._id))
			.unique();
		if (!detailRow || detailRow.projectionVersion !== PUBLIC_TEMPLATE_DETAIL_PROJECTION_VERSION) {
			throw new Error('PUBLIC_RECIPIENT_MIGRATION_DETAIL_NOT_READY');
		}
		const projectedCount = readPublicTemplateDetailProjection(detailRow.detail).recipient_count;
		if (intentCount <= projectedCount) {
			throw new Error('PUBLIC_RECIPIENT_MIGRATION_NO_LOSS');
		}
		const existing = await ctx.db
			.query('publicRecipientMigrationReviews')
			.withIndex('by_templateId', (q) => q.eq('templateId', template._id))
			.unique();
		if (
			!existing ||
			existing.runToken !== migration.runToken ||
			existing.disposition !== 'pending' ||
			existing.intentHash !== intentHash
		) {
			throw new Error('PUBLIC_RECIPIENT_MIGRATION_REVIEW_STALE');
		}
		const now = Date.now();
		const row = {
			templateId: template._id,
			projectionVersion: PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION,
			runToken: migration?.runToken ?? 'operator-preflight',
			intentHash,
			intentCount,
			projectedCount,
			disposition: 'intentionally_redacted' as const,
			operatorReference,
			classifiedAt: now,
			updatedAt: now
		};
		await ctx.db.patch(existing._id, row);
		return {
			status: 'classified' as const,
			templateId: template._id,
			intentHash,
			lostRecipients: intentCount - projectedCount,
			requiresRemigration: true
		};
	}
});

/**
 * Self-paging, idempotent cutover. Four legacy documents per transaction keep
 * even near-1 MiB embedding-bearing rows comfortably below Convex's 16 MiB
 * transaction-read ceiling. A run token is stamped into every compact row; the
 * producer reads only the completed generation, so rows orphaned by a restart
 * or legacy destructive operation cannot re-enter discovery.
 */
export const migratePublicDiscoverySourcePage = internalMutation({
	args: {
		runToken: v.optional(v.string()),
		cursor: v.optional(v.string()),
		startedAt: v.optional(v.number()),
		listDirtyAtAtStart: v.optional(v.number()),
		relationsDirtyAtAtStart: v.optional(v.number()),
		scanned: v.optional(v.number()),
		eligible: v.optional(v.number()),
		sourcesWritten: v.optional(v.number()),
		pageArtifactCoordinatesWritten: v.optional(v.number()),
		topicVectorsWritten: v.optional(v.number()),
		tagVectorsWritten: v.optional(v.number()),
		rejected: v.optional(v.number()),
		recipientIntentTemplates: v.optional(v.number()),
		recipientIntentRecipients: v.optional(v.number()),
		recipientProjectedRecipients: v.optional(v.number()),
		recipientLossTemplates: v.optional(v.number()),
		recipientLossRecipients: v.optional(v.number()),
		recipientLossClassifiedTemplates: v.optional(v.number()),
		recipientLossClassifiedRecipients: v.optional(v.number()),
		scheduleContinuation: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const continuation = args.runToken !== undefined;
		const manifest = await getPublicDiscoveryManifestRow(ctx);
		const existing = await publicDiscoverySourceMigrationRow(ctx);
		const runToken = args.runToken ?? crypto.randomUUID();
		const startedAt = continuation ? (existing?.startedAt ?? Date.now()) : Date.now();
		const listDirtyAtAtStart = continuation ? existing?.listDirtyAtAtStart : manifest?.listDirtyAt;
		const relationsDirtyAtAtStart = continuation
			? existing?.relationsDirtyAtAtStart
			: manifest?.relationsDirtyAt;

		if (continuation) {
			if (!existing || existing.status !== 'running' || existing.runToken !== runToken) {
				return { status: 'superseded' as const, runToken };
			}
		} else {
			const initial = {
				key: PUBLIC_DISCOVERY_SOURCE_MIGRATION_KEY,
				status: 'running' as const,
				projectionVersion: PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION,
				runToken,
				cursor: undefined,
				startedAt,
				completedAt: undefined,
				listDirtyAtAtStart,
				relationsDirtyAtAtStart,
				scanned: 0,
				eligible: 0,
				sourcesWritten: 0,
				pageArtifactCoordinatesWritten: 0,
				topicVectorsWritten: 0,
				tagVectorsWritten: 0,
				rejected: 0,
				recipientIntentTemplates: 0,
				recipientIntentRecipients: 0,
				recipientProjectedRecipients: 0,
				recipientLossTemplates: 0,
				recipientLossRecipients: 0,
				recipientLossClassifiedTemplates: 0,
				recipientLossClassifiedRecipients: 0,
				updatedAt: Date.now()
			};
			if (existing) await ctx.db.patch(existing._id, initial);
			else await ctx.db.insert('publicDiscoverySourceMigrations', initial);
		}

		const page = await ctx.db
			.query('templates')
			.withIndex('by_status_isPublic', (q) => q.eq('status', 'published').eq('isPublic', true))
			.order('asc')
			.paginate({
				cursor: continuation ? (existing?.cursor ?? null) : null,
				numItems: PUBLIC_DISCOVERY_SOURCE_MIGRATION_PAGE_SIZE
			});

		let pageSources = 0;
		let pageArtifactCoordinates = 0;
		let pageTopics = 0;
		let pageTags = 0;
		let pageRejected = 0;
		let pageRecipientIntentTemplates = 0;
		let pageRecipientIntentRecipients = 0;
		let pageRecipientProjectedRecipients = 0;
		let pageRecipientLossTemplates = 0;
		let pageRecipientLossRecipients = 0;
		let pageRecipientLossClassifiedTemplates = 0;
		let pageRecipientLossClassifiedRecipients = 0;
		for (const template of page.page) {
			try {
				const written = await upsertCompactDiscoverySource(ctx, template, runToken);
				if (written.source) {
					pageSources += 1;
					pageArtifactCoordinates += 1;
				}
				if (written.topic) pageTopics += 1;
				pageTags += written.tags;
				const review = await recordPublicRecipientMigrationReview(
					ctx,
					template,
					runToken,
					written.publicRecipientCount
				);
				pageRecipientIntentTemplates += review.intentTemplates;
				pageRecipientIntentRecipients += review.intentRecipients;
				pageRecipientProjectedRecipients += review.projectedRecipients;
				pageRecipientLossTemplates += review.lossTemplates;
				pageRecipientLossRecipients += review.lossRecipients;
				pageRecipientLossClassifiedTemplates += review.classifiedTemplates;
				pageRecipientLossClassifiedRecipients += review.classifiedRecipients;
			} catch (error) {
				pageRejected += 1;
				console.error(
					`[public-discovery] compact source rejected ${template._id}: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}

		const totals = {
			scanned: (continuation ? (existing?.scanned ?? 0) : 0) + page.page.length,
			eligible: (continuation ? (existing?.eligible ?? 0) : 0) + page.page.length,
			sourcesWritten: (continuation ? (existing?.sourcesWritten ?? 0) : 0) + pageSources,
			pageArtifactCoordinatesWritten:
				(continuation ? (existing?.pageArtifactCoordinatesWritten ?? 0) : 0) +
				pageArtifactCoordinates,
			topicVectorsWritten: (continuation ? (existing?.topicVectorsWritten ?? 0) : 0) + pageTopics,
			tagVectorsWritten: (continuation ? (existing?.tagVectorsWritten ?? 0) : 0) + pageTags,
			rejected: (continuation ? (existing?.rejected ?? 0) : 0) + pageRejected,
			recipientIntentTemplates:
				(continuation ? (existing?.recipientIntentTemplates ?? 0) : 0) +
				pageRecipientIntentTemplates,
			recipientIntentRecipients:
				(continuation ? (existing?.recipientIntentRecipients ?? 0) : 0) +
				pageRecipientIntentRecipients,
			recipientProjectedRecipients:
				(continuation ? (existing?.recipientProjectedRecipients ?? 0) : 0) +
				pageRecipientProjectedRecipients,
			recipientLossTemplates:
				(continuation ? (existing?.recipientLossTemplates ?? 0) : 0) + pageRecipientLossTemplates,
			recipientLossRecipients:
				(continuation ? (existing?.recipientLossRecipients ?? 0) : 0) + pageRecipientLossRecipients,
			recipientLossClassifiedTemplates:
				(continuation ? (existing?.recipientLossClassifiedTemplates ?? 0) : 0) +
				pageRecipientLossClassifiedTemplates,
			recipientLossClassifiedRecipients:
				(continuation ? (existing?.recipientLossClassifiedRecipients ?? 0) : 0) +
				pageRecipientLossClassifiedRecipients
		};
		const migration = await publicDiscoverySourceMigrationRow(ctx);
		if (!migration || migration.runToken !== runToken || migration.status !== 'running') {
			return { status: 'superseded' as const, runToken, ...totals };
		}

		if (!page.isDone) {
			await ctx.db.patch(migration._id, {
				cursor: page.continueCursor,
				...totals,
				updatedAt: Date.now()
			});
			if (args.scheduleContinuation !== false) {
				await ctx.scheduler.runAfter(0, migratePublicDiscoverySourcePageRef, {
					runToken,
					cursor: page.continueCursor,
					startedAt,
					listDirtyAtAtStart,
					relationsDirtyAtAtStart,
					...totals
				});
			}
			return {
				status: 'running' as const,
				runToken,
				continueCursor: page.continueCursor,
				startedAt,
				listDirtyAtAtStart,
				relationsDirtyAtAtStart,
				...totals
			};
		}

		const completedAt = Date.now();
		await ctx.db.patch(migration._id, {
			status: 'migrated',
			cursor: undefined,
			completedAt,
			...totals,
			updatedAt: completedAt
		});
		return {
			status: 'migrated' as const,
			runToken,
			completedAt,
			...totals
		};
	}
});

/**
 * Explicit cutover switch. Keep this separate from paging so deployment can
 * verify migration counts and the complete atomic-writer contract first. Until
 * activation every producer fails closed; it never falls back to templates.
 */
export const activatePublicDiscoverySourcePlane = internalMutation({
	args: {},
	handler: async (ctx) => {
		const migration = await publicDiscoverySourceMigrationRow(ctx);
		if (!migration || migration.status !== 'migrated' || migration.completedAt === undefined) {
			throw new Error('PUBLIC_DISCOVERY_SOURCE_PLANE_MIGRATION_INCOMPLETE');
		}
		if (
			migration.rejected !== 0 ||
			migration.sourcesWritten + migration.rejected !== migration.eligible ||
			migration.pageArtifactCoordinatesWritten !== migration.sourcesWritten ||
			!publicRecipientMigrationIntegrityReady(migration)
		) {
			throw new Error(
				`PUBLIC_DISCOVERY_SOURCE_PLANE_MIGRATION_UNSAFE:eligible=${migration.eligible}:written=${migration.sourcesWritten}:pageCoordinates=${migration.pageArtifactCoordinatesWritten ?? 'missing'}:rejected=${migration.rejected}:recipientIntentTemplates=${migration.recipientIntentTemplates ?? 'missing'}:recipientIntentRecipients=${migration.recipientIntentRecipients ?? 'missing'}:recipientProjectedRecipients=${migration.recipientProjectedRecipients ?? 'missing'}:recipientLossTemplates=${migration.recipientLossTemplates ?? 'missing'}:recipientLossClassifiedTemplates=${migration.recipientLossClassifiedTemplates ?? 'missing'}:recipientLossRecipients=${migration.recipientLossRecipients ?? 'missing'}:recipientLossClassifiedRecipients=${migration.recipientLossClassifiedRecipients ?? 'missing'}`
			);
		}
		await ctx.db.patch(migration._id, { status: 'ready', updatedAt: Date.now() });
		return {
			status: 'ready' as const,
			runToken: migration.runToken,
			eligible: migration.eligible,
			sourcesWritten: migration.sourcesWritten,
			recipientLossTemplates: migration.recipientLossTemplates,
			recipientLossRecipients: migration.recipientLossRecipients
		};
	}
});

/**
 * Public: List public templates with enriched data for the homepage.
 *
 * Signature and successful payload are unchanged, but the request path reads
 * one compact singleton selected by `excludeCwc`. A missing snapshot is an
 * explicit not-ready error; only a published empty snapshot returns `[]`.
 * There is deliberately no live-scan fallback.
 */
export const listPublic = query({
	args: {
		_secret: v.optional(v.string()),
		excludeCwc: v.optional(v.boolean())
	},
	handler: async (ctx, args): Promise<PublicTemplatePayload[]> => {
		requireInternalSecret(args._secret ?? '');
		const key: PublicTemplateSnapshotKey = args.excludeCwc ? 'excludeCwc' : 'all';
		const snapshot = await ctx.db
			.query('publicTemplateSnapshots')
			.withIndex('by_key', (q) => q.eq('key', key))
			.unique();
		if (!snapshot) {
			throw new Error(`PUBLIC_DISCOVERY_LIST_SNAPSHOT_NOT_READY:${key}`);
		}
		return projectStoredPublicTemplates(snapshot.templates, {
			key,
			revision: snapshot.revision ?? 0
		});
	}
});

/**
 * Versioned list payload for edge consumers. Consumers compare this row's
 * revision with `publicDiscoveryManifest.list.revision` and cache only a match.
 * The manifest owns readiness, which distinguishes cold start from a valid
 * empty-corpus snapshot without adding a redundant manifest read here.
 */
export const publicDiscoveryList = query({
	args: { _secret: v.optional(v.string()), excludeCwc: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret ?? '');
		const key: PublicTemplateSnapshotKey = args.excludeCwc ? 'excludeCwc' : 'all';
		const snapshot = await ctx.db
			.query('publicTemplateSnapshots')
			.withIndex('by_key', (q) => q.eq('key', key))
			.unique();
		return {
			projectionVersion: snapshot?.projectionVersion ?? 0,
			revision: snapshot?.revision ?? 0,
			updatedAt: snapshot?.updatedAt ?? null,
			templates: projectStoredPublicTemplates(snapshot?.templates, {
				key,
				revision: snapshot?.revision ?? 0
			})
		};
	}
});

type PublicTemplateSnapshotRebuildResult = {
	sourceCap: number;
	scannedCount: number;
	allCount: number;
	excludeCwcCount: number;
	invalidCount: number;
	oversizedCardCount: number;
	aggregateShedCount: number;
	excludedCount: number;
	allSnapshotBytes: number;
	excludeCwcSnapshotBytes: number;
};

type PublicDiscoveryPublication = {
	revision: number;
	updatedAt: number;
	coordinatedRebuildToken?: string;
};

type PublicTemplateSnapshotRow = {
	key: PublicTemplateSnapshotKey;
	projectionVersion: number;
	revision: number;
	templates: PublicTemplatePayload[];
	sourceCount: number;
	updatedAt: number;
};

type PublicTemplateSnapshotPlan = {
	sourceGeneration: string;
	nextTemporalRebuildAt: number | null;
	candidates: PublicTemplateEnrichmentSource[];
	sources: Record<PublicTemplateSnapshotKey, PublicTemplateEnrichmentSource[]>;
	rows: PublicTemplateSnapshotRow[];
	rowSizes: Map<PublicTemplateSnapshotKey, number>;
	invalidTemplateIds: string[];
	oversizedTemplateIds: string[];
	aggregateShedIds: string[];
	exclusionCodes: string[];
};

type PublicTemplateRelationSelection = Pick<
	PublicTemplateSnapshotPlan,
	'sourceGeneration' | 'candidates' | 'sources'
>;

/**
 * Build and atomically upsert both `listPublic` materializations.
 *
 * The exact `(published, public)` index removes drafts/private rows before any
 * document hydration. The descending source scan is hard-capped at 250 rows,
 * plus at most one equally capped indexed read when that window holds too few
 * congressional-free rows to fill the gated variant. Candidates are enriched and
 * validated in newest-first batches before either variant takes its 50-card
 * limit, so an invalid/oversized card is backfilled by the next valid candidate
 * within the same explicit I/O budget. Shared cards are enriched once per batch.
 *
 * Which variant a candidate may fill is decided by its row's schema-constrained
 * `isCwc` column, never by a delivery method read back out of the `v.any()`
 * producer blob beside it.
 */
async function preparePublicTemplateSnapshotPlan(
	ctx: MutationCtx,
	publication: PublicDiscoveryPublication
): Promise<PublicTemplateSnapshotPlan> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	if (manifest?.endorsementCountMigrationStatus !== 'complete') {
		throw new Error(
			`PUBLIC_TEMPLATE_SNAPSHOT_INVALID:endorsement-count-migration-${manifest?.endorsementCountMigrationStatus ?? 'not-started'}`
		);
	}
	const migration = await compactDiscoveryPlaneReady(ctx);
	const candidateRows = await ctx.db
		.query('publicTemplateDiscoverySources')
		.withIndex('by_generation_templateCreatedAt_templateId', (q) =>
			q.eq('generation', migration.runToken)
		)
		.order('desc')
		.take(PUBLIC_TEMPLATE_SNAPSHOT_SCAN_CAP);
	const readCandidate = (row: Doc<'publicTemplateDiscoverySources'>) => {
		if (row.projectionVersion !== PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION) {
			throw new Error(`PUBLIC_DISCOVERY_SOURCE_VERSION_MISMATCH:${row.projectionVersion}`);
		}
		return readPublicTemplateDiscoveryCandidate(row);
	};
	const candidates: PublicTemplateDiscoveryCandidate[] = candidateRows.map(readCandidate);

	// The gated variant is not a guaranteed subset of the newest-250 window: a
	// burst of congressional templates can crowd every congressional-free row out
	// of it and starve the feed the homepage serves when congressional delivery is
	// off. `by_generation_isCwc_templateCreatedAt_templateId` answers exactly that
	// question — the newest congressional-free rows of this generation — so the
	// top-up is one indexed range read. It is taken only when the mixed scan hit
	// its cap without already carrying a full variant's worth, which is the only
	// case where older rows exist for it to find. Every row it adds is older than
	// the mixed scan's tail, so appending preserves newest-first order.
	const scannedExcludeCwcCount = candidates.filter((candidate) => !candidate.isCwc).length;
	if (
		candidateRows.length >= PUBLIC_TEMPLATE_SNAPSHOT_SCAN_CAP &&
		scannedExcludeCwcCount < PUBLIC_TEMPLATE_SNAPSHOT_VARIANT_CAP
	) {
		const scannedIds = new Set(candidateRows.map((row) => String(row.templateId)));
		const excludeCwcRows = await ctx.db
			.query('publicTemplateDiscoverySources')
			.withIndex('by_generation_isCwc_templateCreatedAt_templateId', (q) =>
				q.eq('generation', migration.runToken).eq('isCwc', false)
			)
			.order('desc')
			.take(PUBLIC_TEMPLATE_SNAPSHOT_SCAN_CAP);
		for (const row of excludeCwcRows) {
			if (scannedIds.has(String(row.templateId))) continue;
			candidates.push(readCandidate(row));
		}
	}

	const candidateSources: PublicTemplateEnrichmentSource[] = candidates.map(
		(candidate) => candidate.source
	);
	// Congressional membership travels with the row, not with the card built from
	// it. A projected card that lost its classification is a refused snapshot, not
	// a card that defaults into the congressional-free variant.
	const isCwcById = new Map(
		candidates.map((candidate) => [candidate.source._id, candidate.isCwc] as const)
	);
	const requireIsCwc = (id: Id<'templates'>): boolean => {
		const isCwc = isCwcById.get(id);
		if (isCwc === undefined) {
			throw new Error(`PUBLIC_TEMPLATE_SNAPSHOT_INVALID:${String(id)}:cwc-classification-missing`);
		}
		return isCwc;
	};

	const invalidTemplateIds: string[] = [];
	const oversizedTemplateIds: string[] = [];
	const aggregateShedIds: string[] = [];
	const exclusionCodes: string[] = [];
	const cardBytesById = new Map<string, number>();
	const enrichedById = new Map<Id<'templates'>, PublicTemplatePayload>();
	const allTemplateIds: Array<Id<'templates'>> = [];
	const excludeCwcTemplateIds: Array<Id<'templates'>> = [];
	const allTargetCount = Math.min(PUBLIC_TEMPLATE_SNAPSHOT_VARIANT_CAP, candidates.length);
	const excludeCwcTargetCount = Math.min(
		PUBLIC_TEMPLATE_SNAPSHOT_VARIANT_CAP,
		candidates.filter((candidate) => !candidate.isCwc).length
	);
	let validatedCandidateCount = 0;

	candidateScan: for (
		let offset = 0;
		offset < candidates.length;
		offset += PUBLIC_TEMPLATE_SNAPSHOT_VALIDATION_BATCH
	) {
		const needsAll = allTemplateIds.length < allTargetCount;
		const needsExcludeCwc = excludeCwcTemplateIds.length < excludeCwcTargetCount;
		if (!needsAll && !needsExcludeCwc) break;

		// Once the normal variant is full, do not pay enrichment joins for CWC
		// candidates that cannot backfill the gated variant.
		const batch = candidates
			.slice(offset, offset + PUBLIC_TEMPLATE_SNAPSHOT_VALIDATION_BATCH)
			.filter((candidate) => needsAll || !candidate.isCwc)
			.map((candidate) => candidate.source);
		const enrichedBatch = await enrichPublicTemplates(ctx, batch);
		for (const template of enrichedBatch) {
			const canFillAll = allTemplateIds.length < allTargetCount;
			const canFillExcludeCwc =
				!requireIsCwc(template.id) && excludeCwcTemplateIds.length < excludeCwcTargetCount;
			if (!canFillAll && !canFillExcludeCwc) continue;
			validatedCandidateCount += 1;

			const projected = projectStoredPublicTemplate(template);
			if (!projected) {
				const id = String(template.id);
				invalidTemplateIds.push(id);
				exclusionCodes.push(`PUBLIC_TEMPLATE_SNAPSHOT_INVALID:${id}`);
				continue;
			}
			const cardBytes = getConvexSize(projected as unknown as Value);
			if (cardBytes > MAX_PUBLIC_TEMPLATE_CARD_BYTES) {
				const id = String(projected.id);
				oversizedTemplateIds.push(id);
				exclusionCodes.push(
					`PUBLIC_TEMPLATE_CARD_TOO_LARGE:${id}:${cardBytes}>${MAX_PUBLIC_TEMPLATE_CARD_BYTES}`
				);
				continue;
			}

			cardBytesById.set(String(projected.id), cardBytes);
			enrichedById.set(projected.id, projected);
			if (canFillAll) allTemplateIds.push(projected.id);
			if (canFillExcludeCwc) excludeCwcTemplateIds.push(projected.id);
			if (
				allTemplateIds.length >= allTargetCount &&
				excludeCwcTemplateIds.length >= excludeCwcTargetCount
			) {
				break candidateScan;
			}
		}
	}

	const noValidCardsError = () =>
		new Error(
			`PUBLIC_TEMPLATE_SNAPSHOT_NO_VALID_CARDS:candidates=${candidates.length}:validated=${validatedCandidateCount}:` +
				exclusionCodes.slice(0, 3).join('|')
		);
	if (candidates.length > 0 && allTemplateIds.length === 0) {
		throw noValidCardsError();
	}

	const projectSelectedIds = (ids: Array<Id<'templates'>>) =>
		ids.flatMap((id) => {
			const projected = enrichedById.get(id);
			return projected ? [projected] : [];
		});
	const buildRows = (): PublicTemplateSnapshotRow[] => {
		const allTemplates = projectSelectedIds(allTemplateIds);
		const excludeCwcTemplates = projectSelectedIds(excludeCwcTemplateIds);
		return [
			{
				key: 'all',
				projectionVersion: PUBLIC_TEMPLATE_PROJECTION_VERSION,
				revision: publication.revision,
				templates: allTemplates,
				sourceCount: allTemplates.length,
				updatedAt: publication.updatedAt
			},
			{
				key: 'excludeCwc',
				projectionVersion: PUBLIC_TEMPLATE_PROJECTION_VERSION,
				revision: publication.revision,
				templates: excludeCwcTemplates,
				sourceCount: excludeCwcTemplates.length,
				updatedAt: publication.updatedAt
			}
		];
	};

	// Per-card bounds make the normal 50-card case fit with headroom. The exact
	// row guard remains authoritative: if future envelope growth crosses it,
	// remove the largest card from both variants and recompute until the matched
	// revision is publishable. Every exclusion is durable failure evidence, so
	// availability recovers without silently corrupting or truncating content.
	let rows = buildRows();
	const rowSizes = new Map<PublicTemplateSnapshotKey, number>();
	while (true) {
		rowSizes.clear();
		const oversizedRow = rows.find((row) => {
			const bytes = getConvexSize(row as unknown as Value);
			rowSizes.set(row.key, bytes);
			return bytes > MAX_PUBLIC_TEMPLATE_SNAPSHOT_BYTES;
		});
		if (!oversizedRow) break;

		const oversizedBytes = rowSizes.get(oversizedRow.key)!;
		const largest = [...oversizedRow.templates].sort((a, b) => {
			const sizeDelta =
				(cardBytesById.get(String(b.id)) ?? 0) - (cardBytesById.get(String(a.id)) ?? 0);
			return sizeDelta || String(a.id).localeCompare(String(b.id));
		})[0];
		if (!largest) {
			throw new Error(
				`PUBLIC_TEMPLATE_SNAPSHOT_TOO_LARGE:${oversizedRow.key}:${oversizedBytes}>${MAX_PUBLIC_TEMPLATE_SNAPSHOT_BYTES}`
			);
		}

		const id = String(largest.id);
		enrichedById.delete(largest.id);
		aggregateShedIds.push(id);
		exclusionCodes.push(
			`PUBLIC_TEMPLATE_SNAPSHOT_AGGREGATE_SHED:${id}:${oversizedRow.key}:${oversizedBytes}>${MAX_PUBLIC_TEMPLATE_SNAPSHOT_BYTES}`
		);
		rows = buildRows();
	}

	if (candidates.length > 0 && rows.every((row) => row.templates.length === 0)) {
		throw noValidCardsError();
	}

	const candidatesById = new Map(candidateSources.map((template) => [template._id, template]));
	const projectSelectedSources = (ids: Array<Id<'templates'>>) =>
		ids.flatMap((id) => {
			if (!enrichedById.has(id)) return [];
			const source = candidatesById.get(id);
			return source ? [source] : [];
		});
	const sources = {
		all: projectSelectedSources(allTemplateIds),
		excludeCwc: projectSelectedSources(excludeCwcTemplateIds)
	};
	const temporalSources = [
		...new Map(
			[...sources.all, ...sources.excludeCwc].map((source) => [source._id, source] as const)
		).values()
	];

	return {
		sourceGeneration: migration.runToken,
		nextTemporalRebuildAt: nextPublicTemplateTemporalRebuildAt(
			temporalSources,
			publication.updatedAt
		),
		candidates: candidateSources,
		sources,
		rows,
		rowSizes,
		invalidTemplateIds,
		oversizedTemplateIds,
		aggregateShedIds,
		exclusionCodes
	};
}

async function publishPublicTemplateSnapshotPlan(
	ctx: MutationCtx,
	publication: PublicDiscoveryPublication,
	plan: PublicTemplateSnapshotPlan
): Promise<PublicTemplateSnapshotRebuildResult> {
	const previousManifest = await getPublicDiscoveryManifestRow(ctx);

	for (const row of plan.rows) {
		const existing = await ctx.db
			.query('publicTemplateSnapshots')
			.withIndex('by_key', (q) => q.eq('key', row.key))
			.unique();
		if (existing) {
			await ctx.db.patch(existing._id, row);
		} else {
			await ctx.db.insert('publicTemplateSnapshots', row);
		}
	}

	// The manifest revision is the commit marker. Convex mutation atomicity means
	// a later failure in the composite list+relations rebuild rolls this back too.
	await commitPublicDiscoveryListPublication(ctx, publication);
	const committedManifest = await getPublicDiscoveryManifestRow(ctx);
	if (!committedManifest) {
		throw new Error('PUBLIC_DISCOVERY_MANIFEST_MISSING_AFTER_LIST_PUBLICATION');
	}
	await ctx.db.patch(committedManifest._id, {
		nextTemporalRebuildAt: plan.nextTemporalRebuildAt ?? undefined,
		temporalScheduleVersion: 1
	});

	if (plan.exclusionCodes.length > 0) {
		const manifest = await getPublicDiscoveryManifestRow(ctx);
		if (!manifest) throw new Error('PUBLIC_DISCOVERY_MANIFEST_MISSING_AFTER_LIST_PUBLICATION');
		const failure = new Error(
			plan.exclusionCodes.length === 1
				? plan.exclusionCodes[0]
				: `PUBLIC_TEMPLATE_SNAPSHOT_EXCLUDED:${plan.exclusionCodes.join('|')}`
		);
		await recordPublicDiscoverySnapshotFailure(
			ctx,
			manifest,
			'list',
			failure,
			publication.updatedAt,
			{
				code: previousManifest?.listFailureCode,
				failedAt: previousManifest?.listFailureAt
			}
		);
		if (plan.oversizedTemplateIds.length === 0 && plan.aggregateShedIds.length === 0) {
			console.error(
				`[public-discovery] list revision ${publication.revision} excluded ${plan.invalidTemplateIds.length} invalid template card(s); valid cards remain available`
			);
		} else {
			console.error(
				`[public-discovery] list revision ${publication.revision} excluded ${plan.exclusionCodes.length} unsafe or oversized template card(s); valid cards remain available`
			);
		}
	}

	const allTemplates = plan.rows.find((row) => row.key === 'all')!.templates;
	const excludeCwcTemplates = plan.rows.find((row) => row.key === 'excludeCwc')!.templates;

	return {
		sourceCap: PUBLIC_TEMPLATE_SNAPSHOT_SCAN_CAP,
		scannedCount: plan.candidates.length,
		allCount: allTemplates.length,
		excludeCwcCount: excludeCwcTemplates.length,
		invalidCount: plan.invalidTemplateIds.length,
		oversizedCardCount: plan.oversizedTemplateIds.length,
		aggregateShedCount: plan.aggregateShedIds.length,
		excludedCount: plan.exclusionCodes.length,
		allSnapshotBytes: plan.rowSizes.get('all')!,
		excludeCwcSnapshotBytes: plan.rowSizes.get('excludeCwc')!
	};
}

async function rebuildPublicTemplateSnapshotsImpl(
	ctx: MutationCtx
): Promise<PublicTemplateSnapshotRebuildResult> {
	// Reserve the revision without mutating the manifest. It becomes visible only
	// after BOTH list rows have passed their size guards and been upserted.
	const publication = await preparePublicDiscoveryListPublication(ctx);
	const plan = await preparePublicTemplateSnapshotPlan(ctx, publication);
	return await publishPublicTemplateSnapshotPlan(ctx, publication, plan);
}

/** Internal/operator entry point for the low-cost public-list materialization. */
export const rebuildPublicTemplateSnapshots = internalMutation({
	args: {},
	handler: rebuildPublicTemplateSnapshotsImpl
});

/** Mutation attempt supervised by the cron action below. */
export const rebuildPublicTemplateSnapshotsForCronAttempt = internalMutation({
	args: {},
	handler: async (ctx) => {
		try {
			return { status: 'rebuilt' as const, rebuilt: await rebuildPublicTemplateSnapshotsImpl(ctx) };
		} catch (error) {
			const status = classifyPublicTemplateSnapshotFreeze(error);
			if (!status) throw error;
			await freezePublicDiscoverySnapshotFailure(ctx, 'list', error as Error, Date.now());
			return { status };
		}
	}
});

/** Daily supervisor persists even unknown rebuild failures in a new mutation. */
export const rebuildPublicTemplateSnapshotsForCron = internalAction({
	args: {},
	handler: async (ctx) =>
		await supervisePublicDiscoveryCronRebuild(
			ctx,
			'list',
			rebuildPublicTemplateSnapshotsForCronAttemptRef
		)
});

/** Internal entry point used by tests/operators and future write modules. */
export const requestPublicTemplateSnapshotRefresh = internalMutation({
	args: {},
	handler: async (ctx) => markPublicDiscoveryListDirty(ctx, 'aggregate')
});

/**
 * Coalesced write-driven list refresh.
 *
 * User-authored public content gets one prompt generation after the 60-second
 * coalescing window. High-frequency derived metrics retain the six-hour floor.
 * Ordinary relation dirtiness never delays the list; only destructive urgent
 * invalidation owns an immediate composite list+relations rebuild.
 */
export const flushScheduledPublicTemplateRefresh = internalMutation({
	args: { scheduledAt: v.number(), bypassMinInterval: v.optional(v.boolean()) },
	handler: async (ctx, { scheduledAt }) => {
		const manifest = await getPublicDiscoveryManifestRow(ctx);
		if (!manifest || manifest.listRefreshScheduledAt !== scheduledAt) {
			return { status: 'superseded' as const };
		}

		if (manifest.listDirtyAt === undefined) {
			await ctx.db.patch(manifest._id, { listRefreshScheduledAt: undefined });
			return { status: 'clean' as const };
		}

		const now = Date.now();
		const rebuildsRelations = publicDiscoveryListRefreshRebuildsRelations(manifest);
		const listNextAllowedAt =
			(manifest.listUpdatedAt ?? 0) + PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS;
		const relationsNextAllowedAt = rebuildsRelations
			? (manifest.relationsUpdatedAt ?? 0) + PUBLIC_DISCOVERY_RELATIONS_MIN_REBUILD_INTERVAL_MS
			: 0;
		const nextAllowedAt = Math.max(listNextAllowedAt, relationsNextAllowedAt);
		if (!publicDiscoveryListRefreshBypassesMinInterval(manifest) && now < nextAllowedAt) {
			const nextScheduledAt = await reschedulePublicDiscoveryListRefresh(
				ctx,
				manifest,
				now,
				nextAllowedAt
			);
			// Prompt list work never enters this composite branch. Ordinary list and
			// relation dirtiness may share the later six-hour floor; destructive
			// fail-closed work bypasses both floors before reaching this branch.
			const relationsScheduledAt = rebuildsRelations ? nextScheduledAt : undefined;
			if (relationsScheduledAt !== undefined) {
				await ctx.db.patch(manifest._id, {
					relationsRefreshScheduledAt: relationsScheduledAt
				});
			}
			return {
				status: 'deferred' as const,
				scheduledAt: nextScheduledAt,
				...(relationsScheduledAt !== undefined ? { relationsScheduledAt } : {})
			};
		}

		try {
			const rebuilt = rebuildsRelations
				? await rebuildHomepageSnapshotsImpl(ctx)
				: await rebuildPublicTemplateSnapshotsImpl(ctx);
			const publishedManifest = await getPublicDiscoveryManifestRow(ctx);
			if (publishedManifest) {
				const patch: {
					listRefreshScheduledAt?: undefined;
					relationsRefreshScheduledAt?: undefined;
				} = {};
				if (publishedManifest.listRefreshScheduledAt === scheduledAt) {
					patch.listRefreshScheduledAt = undefined;
				}
				if (
					rebuildsRelations &&
					publishedManifest.relationsRefreshScheduledAt === manifest.relationsRefreshScheduledAt
				) {
					patch.relationsRefreshScheduledAt = undefined;
				}
				if (Object.keys(patch).length > 0) {
					await ctx.db.patch(publishedManifest._id, patch);
				}
			}
			return { status: 'rebuilt' as const, rebuilt };
		} catch (error) {
			// Size or runtime-schema rejection is detected before either snapshot row
			// is written. Retain the dirty/failure evidence but clear this elapsed
			// token: deterministic invalid input is retried by the next source write
			// or daily cron, not four times per day forever. Unknown database/runtime
			// failures are rethrown so Convex rolls the transaction back atomically.
			const status = classifyPublicTemplateSnapshotFreeze(error);
			if (!status) throw error;
			await freezePublicDiscoverySnapshotFailure(ctx, 'list', error as Error, now);
			if (rebuildsRelations) {
				await freezePublicDiscoverySnapshotFailure(
					ctx,
					'relations',
					new Error(
						`PUBLIC_DISCOVERY_RELATIONS_BLOCKED_BY_LIST:${(error as Error).message}`.slice(0, 500)
					),
					now
				);
			}
			return { status };
		}
	}
});

/**
 * Selector for the public-corpus normalization. Relation payloads use the same
 * `all` / `excludeCwc` keys as their list variants so every returned edge has
 * endpoints in the exact graph being displayed.
 */
const RELATEDNESS_CALIBRATION_KEY = 'public';

function relationSnapshotKey(excludeCwc: boolean | undefined): RelationSnapshotKey {
	return excludeCwc ? 'excludeCwc' : 'all';
}

/** Leave headroom for Convex document system fields below the 1 MiB value cap. */
const MAX_RELATION_SNAPSHOT_BYTES = 900_000;

/**
 * Public: measured-twin relatedness edges over the public template set.
 *
 * Request-path invariant: this query reads exactly one compact materialized row
 * and never hydrates `templates` or the calibration centroid. The nightly
 * `rebuildRelationSnapshot` mutation owns all embedding-heavy computation.
 *
 * A missing snapshot is the honest cold-start state: return no edges. There is
 * deliberately no live-scan fallback, because a fallback would reintroduce the
 * database-I/O failure mode this materialization exists to remove.
 */
export const relatednessEdges = query({
	args: { _secret: v.optional(v.string()), excludeCwc: v.optional(v.boolean()) },
	handler: async (
		ctx,
		args
	): Promise<Array<{ a: string; b: string; score: number; kind: 'twin' }>> => {
		requireInternalSecret(args._secret ?? '');
		const snapshot = await ctx.db
			.query('templateRelationSnapshots')
			.withIndex('by_key', (q) => q.eq('key', relationSnapshotKey(args.excludeCwc)))
			.unique();
		return snapshot?.twinEdges ?? [];
	}
});

/**
 * Refit the persisted relatedness normalization over the bounded homepage
 * corpus (the newest 50 published+public templates). This cap is intentionally
 * lower than the list candidate cap because `computeTwinEdges` is O(n^3*d).
 *
 * Recomputes the corpus centroid (the genre common-mode removed before scoring
 * template twins) + the calibrated threshold via the same pure helper the edge
 * query uses, and upserts the optional operator-observability singleton. The
 * relation snapshot computes its matched calibration inline, so correctness
 * and recurring freshness do not depend on this maintenance function.
 *
 * Idempotent and side-effect-free beyond the single singleton write: same
 * corpus → same centroid → same row. Guards the tiny-corpus floor — fewer than
 * two embedded public templates leaves nothing to fit a common-mode against, so
 * the write is skipped and any prior calibration is preserved rather than
 * overwritten with nonsense. Pure Convex compute, no external cost.
 */
export const recomputeRelatednessCalibration = internalMutation({
	args: {},
	handler: async (ctx): Promise<{ updated: boolean; count: number; dim: number }> => {
		const migration = await compactDiscoveryPlaneReady(ctx);
		const sources = await ctx.db
			.query('publicTemplateDiscoverySources')
			.withIndex('by_generation_templateCreatedAt_templateId', (q) =>
				q.eq('generation', migration.runToken)
			)
			.order('desc')
			.take(RELATION_SNAPSHOT_VARIANT_CAP);
		const vectors = await Promise.all(
			sources.map((source) =>
				ctx.db
					.query('publicTemplateTopicVectors')
					.withIndex('by_templateId', (q) => q.eq('templateId', source.templateId))
					.unique()
			)
		);
		const items = vectors.flatMap((row) =>
			row?.generation === migration.runToken && isFiniteEmbeddingVector(row.embedding)
				? [{ id: row.templateId as string, embedding: row.embedding }]
				: []
		);

		const calibration = computeCalibration(items);
		// Too thin to normalize — keep the prior calibration (if any) untouched.
		if (!calibration) {
			return { updated: false, count: items.length, dim: 0 };
		}

		const existing = await ctx.db
			.query('relatednessCalibration')
			.withIndex('by_key', (q) => q.eq('key', RELATEDNESS_CALIBRATION_KEY))
			.unique();

		const row = {
			key: RELATEDNESS_CALIBRATION_KEY,
			centroid: calibration.centroid,
			threshold: calibration.threshold,
			count: calibration.count,
			dim: calibration.dim,
			updatedAt: Date.now()
		};

		if (existing) {
			await ctx.db.patch(existing._id, row);
		} else {
			await ctx.db.insert('relatednessCalibration', row);
		}

		return { updated: true, count: calibration.count, dim: calibration.dim };
	}
});

/**
 * Public: tag-concept relations over the public template set.
 *
 * Raw tag strings barely overlap and read as register noise, so they carry no
 * relation on their own. The nightly snapshot rebuild pools and clusters the
 * server-only per-tag embeddings; this request-path query reads only the compact
 * materialized result. From those tight concepts it returns:
 *
 *   - `conceptMap`: raw tag -> canonical concept label, for consistent display
 *     (so "libraries" and "library card" show as one topic, not two).
 *   - `edges`: `kind:'concept'` edges between templates that share a tight
 *     concept — the additive, honest edge source (subordinate to `twin`,
 *     comparable to `family`).
 *
 * Honest by construction: the same tightness gate that folds tags for display
 * grounds the edges, so a concept formed by raw-string match or register-level
 * proximity yields neither a fold nor an edge. If the corpus is too sparse to
 * form any tight cross-template concept — the honest state at the seed — the
 * `edges` array is empty. A missing snapshot also returns that same honest empty
 * shape, with no live-scan fallback. Vectors are consumed only by the rebuild and
 * NEVER leave; only labels and `{a,b,concept,kind}` tuples cross the boundary.
 */
export const conceptRelations = query({
	args: { _secret: v.optional(v.string()), excludeCwc: v.optional(v.boolean()) },
	handler: async (
		ctx,
		args
	): Promise<{
		edges: Array<{ a: string; b: string; concept: string; kind: 'concept' }>;
		conceptMap: Record<string, string>;
	}> => {
		requireInternalSecret(args._secret ?? '');
		const snapshot = await ctx.db
			.query('templateRelationSnapshots')
			.withIndex('by_key', (q) => q.eq('key', relationSnapshotKey(args.excludeCwc)))
			.unique();
		if (!snapshot) return { edges: [], conceptMap: {} };

		return {
			edges: snapshot.conceptEdges,
			conceptMap: Object.fromEntries(
				snapshot.conceptEntries.map(({ tag, concept }) => [tag, concept])
			)
		};
	}
});

/**
 * One-call relation payload for the edge cache. The legacy split queries stay
 * available during rollout, but new consumers should use this shape so twin and
 * concept data can never come from different cache generations.
 */
export const publicDiscoveryRelations = query({
	args: { _secret: v.optional(v.string()), excludeCwc: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret ?? '');
		const key = relationSnapshotKey(args.excludeCwc);
		const snapshot = await ctx.db
			.query('templateRelationSnapshots')
			.withIndex('by_key', (q) => q.eq('key', key))
			.unique();
		if (!snapshot) {
			return {
				revision: 0,
				updatedAt: null,
				twinEdges: [],
				conceptRelations: { edges: [], conceptMap: {} }
			};
		}

		return {
			revision: snapshot.revision ?? 0,
			updatedAt: snapshot.updatedAt,
			twinEdges: snapshot.twinEdges,
			conceptRelations: {
				edges: snapshot.conceptEdges,
				conceptMap: Object.fromEntries(
					snapshot.conceptEntries.map(({ tag, concept }) => [tag, concept])
				)
			}
		};
	}
});

/**
 * Nightly materialization for both public relation variants.
 *
 * This is the ONLY request-independent path that reads the embedding-heavy
 * public template corpus. It preserves the former scoring and filtering rules
 * over an explicitly bounded discovery corpus:
 *
 * - one bounded newest-250 source scan is card-validated and backfilled before
 *   deriving the exact same at-most-50 `all` and non-CWC sets as the list;
 * - each graph consumes only edges whose endpoints are in its displayed list;
 * - twin edges fit their calibration from this exact bounded generation, so a
 *   stale optional maintenance row cannot skew a newly published snapshot;
 * - concept clustering pools one vector per distinct raw tag across that same
 *   corpus, then relates all tagged templates against the resulting concepts.
 *
 * Both compact results are size-checked before either is written. Oversized
 * derived arrays shed deterministic prefixes, publish a bounded usable graph,
 * and retain unhealthy producer evidence until a clean repair. If computation
 * or a base guard fails, Convex mutation atomicity preserves both last-good
 * rows. Public queries never fall back to this scan.
 */
type RelationSnapshotVariantRebuildResult = {
	sourceCap: number;
	sourceTemplateCount: number;
	embeddedTemplateCount: number;
	tagVectorCandidateCount: number;
	tagVectorCount: number;
	tagVectorShedCount: number;
	twinEdgeCount: number;
	conceptEdgeCount: number;
	conceptEntryCount: number;
	twinEdgeShedCount: number;
	conceptEdgeShedCount: number;
	conceptEntryShedCount: number;
	snapshotBytes: number;
};

type RelationSnapshotRow = {
	key: RelationSnapshotKey;
	revision: number;
	twinEdges: ReturnType<typeof computeTwinEdges>;
	conceptEdges: ReturnType<typeof conceptEdges>;
	conceptEntries: Array<{ tag: string; concept: string }>;
	sourceCap: number;
	sourceTemplateCount: number;
	embeddedTemplateCount: number;
	tagVectorCandidateCount: number;
	tagVectorCount: number;
	tagVectorShedCount: number;
	updatedAt: number;
};

type RelationSnapshotVariantBuild = {
	snapshot: RelationSnapshotRow;
	result: RelationSnapshotVariantRebuildResult;
	degradationCode?: string;
};

type RelationTemplateSource = PublicTemplateEnrichmentSource & {
	topicEmbedding?: number[];
	tagEmbeddings?: Array<{ tag: string; embedding: number[] }>;
};

type RelationVariantInput = {
	templates: RelationTemplateSource[];
	tagVectorCandidateCount: number;
	tagVectorShedCount: number;
};

async function prepareRelationVariantInput(
	ctx: MutationCtx,
	templates: PublicTemplateEnrichmentSource[],
	sourceGeneration: string
): Promise<RelationVariantInput> {
	const distinctTags: string[] = [];
	const seenTags = new Set<string>();
	for (const template of templates) {
		for (const tag of normalizeTags(template.topics)) {
			if (seenTags.has(tag)) continue;
			seenTags.add(tag);
			distinctTags.push(tag);
		}
	}
	const retainedTags = distinctTags.slice(0, MAX_PUBLIC_RELATION_TAG_VECTORS);
	const retainedTagSet = new Set(retainedTags);
	const tagVectorShedCount = Math.max(0, distinctTags.length - retainedTags.length);

	// The global tag cap is applied above, before any tag-vector database read.
	const [topicRows, tagRows] = await Promise.all([
		Promise.all(
			templates.map((template) =>
				ctx.db
					.query('publicTemplateTopicVectors')
					.withIndex('by_templateId', (q) => q.eq('templateId', template._id))
					.unique()
			)
		),
		Promise.all(
			retainedTags.map((tag) =>
				ctx.db
					.query('publicTagEmbeddingVectors')
					.withIndex('by_tag', (q) => q.eq('tag', tag))
					.unique()
			)
		)
	]);
	const topicsByTemplate = new Map(
		topicRows.flatMap((row) =>
			row?.generation === sourceGeneration ? [[row.templateId, row.embedding] as const] : []
		)
	);
	const tagsByName = new Map(
		tagRows.flatMap((row) => (row ? [[row.tag, row.embedding] as const] : []))
	);
	return {
		templates: templates.map((template) => ({
			...template,
			topicEmbedding: topicsByTemplate.get(template._id),
			tagEmbeddings: normalizeTags(template.topics).flatMap((tag) => {
				if (!retainedTagSet.has(tag)) return [];
				const embedding = tagsByName.get(tag);
				return embedding ? [{ tag, embedding }] : [];
			})
		})),
		tagVectorCandidateCount: distinctTags.length,
		tagVectorShedCount
	};
}

function maximumFittingPrefixLength(
	length: number,
	fits: (prefixLength: number) => boolean
): number {
	let low = 0;
	let high = length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (fits(middle)) low = middle;
		else high = middle - 1;
	}
	return low;
}

function buildRelationSnapshotVariant(
	key: RelationSnapshotKey,
	input: RelationVariantInput,
	publication: PublicDiscoveryPublication
): RelationSnapshotVariantBuild {
	const { templates, tagVectorCandidateCount, tagVectorShedCount } = input;
	// Measured twins: missing embeddings contribute no edge, exactly as before.
	// Reject malformed legacy vectors before calibration: the first vector must
	// never get to redefine the canonical dimensionality for the whole corpus.
	const items = templates
		.filter((t) => isFiniteEmbeddingVector(t.topicEmbedding))
		.map((t) => ({ id: t._id as string, embedding: t.topicEmbedding as number[] }));

	// Fit the matched centroid/threshold from the exact snapshot generation.
	// This is bounded pure compute over <=50 rows and saves a database read; the
	// optional operational calibration job remains useful as observability, but
	// correctness never depends on its cadence.
	const calibration = computeCalibration(items);
	const twinEdges = computeTwinEdges(
		items,
		calibration ? { centroid: calibration.centroid, threshold: calibration.threshold } : undefined
	);

	// Tag concepts: retain the former first-occurrence de-duplication and stable
	// template/tag traversal order so a rebuild is byte-for-byte deterministic
	// for an unchanged corpus (apart from the audit timestamp).
	const tagVectors: Array<{ tag: string; embedding: number[] }> = [];
	const taggedTemplates: Array<{ id: string; tags: string[] }> = [];
	const seenTag = new Set<string>();
	for (const template of templates) {
		const currentTags = normalizeTags(template.topics);
		const currentTagSet = new Set(currentTags);
		taggedTemplates.push({
			id: template._id as string,
			tags: currentTags
		});
		const tagEmbeddings = Array.isArray(template.tagEmbeddings) ? template.tagEmbeddings : [];
		for (const tagEmbedding of tagEmbeddings) {
			if (
				tagEmbedding &&
				typeof tagEmbedding.tag === 'string' &&
				currentTagSet.has(tagEmbedding.tag) &&
				isFiniteEmbeddingVector(tagEmbedding.embedding) &&
				!seenTag.has(tagEmbedding.tag)
			) {
				seenTag.add(tagEmbedding.tag);
				tagVectors.push({
					tag: tagEmbedding.tag,
					embedding: tagEmbedding.embedding
				});
			}
		}
	}

	const concepts = clusterTagConcepts(tagVectors);
	const allConceptEdges = conceptEdges(taggedTemplates, concepts);
	const allConceptEntries = Object.entries(tagConceptMap(concepts)).map(([tag, concept]) => ({
		tag,
		concept
	}));

	const buildSnapshot = (
		retainedTwinEdges: ReturnType<typeof computeTwinEdges>,
		retainedConceptEdges: ReturnType<typeof conceptEdges>,
		retainedConceptEntries: Array<{ tag: string; concept: string }>
	): RelationSnapshotRow => ({
		key,
		revision: publication.revision,
		twinEdges: retainedTwinEdges,
		conceptEdges: retainedConceptEdges,
		conceptEntries: retainedConceptEntries,
		sourceCap: RELATION_SNAPSHOT_VARIANT_CAP,
		sourceTemplateCount: templates.length,
		embeddedTemplateCount: items.length,
		tagVectorCandidateCount,
		tagVectorCount: tagVectors.length,
		tagVectorShedCount,
		updatedAt: publication.updatedAt
	});
	const measureSnapshot = (
		retainedTwinEdges: ReturnType<typeof computeTwinEdges>,
		retainedConceptEdges: ReturnType<typeof conceptEdges>,
		retainedConceptEntries: Array<{ tag: string; concept: string }>
	) =>
		getConvexSize(
			buildSnapshot(
				retainedTwinEdges,
				retainedConceptEdges,
				retainedConceptEntries
			) as unknown as Value
		);

	let retainedTwinEdges = twinEdges;
	let retainedConceptEdges = allConceptEdges;
	let retainedConceptEntries = allConceptEntries;
	const initialSnapshotBytes = measureSnapshot(
		retainedTwinEdges,
		retainedConceptEdges,
		retainedConceptEntries
	);

	if (initialSnapshotBytes > MAX_RELATION_SNAPSHOT_BYTES) {
		// Preserve the primary measured-twin graph first. Concept edges are
		// additive, followed by the display-only concept map, and weakest twins
		// are the last resort. Every array already has a deterministic quality
		// order; binary-searching prefixes bounds fitting work and keeps rebuilds
		// byte-stable for an unchanged corpus.
		const conceptEdgeCount = maximumFittingPrefixLength(
			retainedConceptEdges.length,
			(count) =>
				measureSnapshot(
					retainedTwinEdges,
					retainedConceptEdges.slice(0, count),
					retainedConceptEntries
				) <= MAX_RELATION_SNAPSHOT_BYTES
		);
		retainedConceptEdges = retainedConceptEdges.slice(0, conceptEdgeCount);

		if (
			measureSnapshot(retainedTwinEdges, retainedConceptEdges, retainedConceptEntries) >
			MAX_RELATION_SNAPSHOT_BYTES
		) {
			const conceptEntryCount = maximumFittingPrefixLength(
				retainedConceptEntries.length,
				(count) =>
					measureSnapshot(
						retainedTwinEdges,
						retainedConceptEdges,
						retainedConceptEntries.slice(0, count)
					) <= MAX_RELATION_SNAPSHOT_BYTES
			);
			retainedConceptEntries = retainedConceptEntries.slice(0, conceptEntryCount);
		}

		if (
			measureSnapshot(retainedTwinEdges, retainedConceptEdges, retainedConceptEntries) >
			MAX_RELATION_SNAPSHOT_BYTES
		) {
			const twinEdgeCount = maximumFittingPrefixLength(
				retainedTwinEdges.length,
				(count) =>
					measureSnapshot(
						retainedTwinEdges.slice(0, count),
						retainedConceptEdges,
						retainedConceptEntries
					) <= MAX_RELATION_SNAPSHOT_BYTES
			);
			retainedTwinEdges = retainedTwinEdges.slice(0, twinEdgeCount);
		}
	}

	const snapshot = buildSnapshot(retainedTwinEdges, retainedConceptEdges, retainedConceptEntries);
	// RelationEdge/ConceptEdge are nominal interfaces without Value's index
	// signature, but every field above is a concrete Convex value.
	const snapshotBytes = getConvexSize(snapshot as unknown as Value);
	if (snapshotBytes > MAX_RELATION_SNAPSHOT_BYTES) {
		throw new Error(
			`RELATION_SNAPSHOT_TOO_LARGE:${key}:${snapshotBytes}>${MAX_RELATION_SNAPSHOT_BYTES}`
		);
	}

	const twinEdgeShedCount = twinEdges.length - retainedTwinEdges.length;
	const conceptEdgeShedCount = allConceptEdges.length - retainedConceptEdges.length;
	const conceptEntryShedCount = allConceptEntries.length - retainedConceptEntries.length;
	const payloadShed = twinEdgeShedCount + conceptEdgeShedCount + conceptEntryShedCount;
	const degradationCode =
		payloadShed > 0 || tagVectorShedCount > 0
			? `RELATION_SNAPSHOT_DEGRADED:${key}:initial=${initialSnapshotBytes}:final=${snapshotBytes}:twin=${twinEdgeShedCount}:concept=${conceptEdgeShedCount}:entries=${conceptEntryShedCount}:tag-vectors=${tagVectorShedCount}`
			: undefined;

	return {
		snapshot,
		degradationCode,
		result: {
			sourceCap: RELATION_SNAPSHOT_VARIANT_CAP,
			sourceTemplateCount: templates.length,
			embeddedTemplateCount: items.length,
			tagVectorCandidateCount,
			tagVectorCount: tagVectors.length,
			tagVectorShedCount,
			twinEdgeCount: retainedTwinEdges.length,
			conceptEdgeCount: retainedConceptEdges.length,
			conceptEntryCount: retainedConceptEntries.length,
			twinEdgeShedCount,
			conceptEdgeShedCount,
			conceptEntryShedCount,
			snapshotBytes
		}
	};
}

type RelationSnapshotRebuildResult = {
	sourceScanCap: number;
	scannedCount: number;
	all: RelationSnapshotVariantRebuildResult;
	excludeCwc: RelationSnapshotVariantRebuildResult;
};

type HomepageSnapshotRebuildResult = {
	list: PublicTemplateSnapshotRebuildResult;
	relations: RelationSnapshotRebuildResult;
};

type PreparedRelationSnapshotRebuild = {
	publication: PublicDiscoveryPublication;
	selection: PublicTemplateRelationSelection;
	variants: Record<RelationSnapshotKey, RelationSnapshotVariantBuild>;
	existingRows: Record<RelationSnapshotKey, Doc<'templateRelationSnapshots'> | null>;
};

function normalizeRelationSnapshotError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function isPublicDiscoveryCoordinationError(error: Error): boolean {
	return (
		error.message === PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED ||
		error.message === PUBLIC_DISCOVERY_COORDINATED_REBUILD_TOKEN_MISMATCH
	);
}

function classifyRelationSnapshotFreeze(error: Error): 'oversize' | 'invalid' | 'failed' {
	if (error.message.startsWith('RELATION_SNAPSHOT_TOO_LARGE:')) return 'oversize';
	const listStatus = classifyPublicTemplateSnapshotFreeze(error);
	if (listStatus === 'oversize') return 'oversize';
	if (listStatus === 'invalid') return 'invalid';
	return 'failed';
}

type PublicDiscoveryDatabaseReader = QueryCtx['db'];

/**
 * Resolve the exact template IDs in the currently published list generation.
 * Relation rebuilds and tag maintenance share this tiny control/list read so
 * neither needs another published-corpus index scan.
 */
async function readPublishedPublicTemplateIds(ctx: {
	db: PublicDiscoveryDatabaseReader;
}): Promise<Record<PublicTemplateSnapshotKey, Array<Id<'templates'>>>> {
	const manifest = await ctx.db
		.query('publicDiscoveryManifest')
		.withIndex('by_key', (q) => q.eq('key', 'public'))
		.unique();
	if (!manifest?.listReady || manifest.listUpdatedAt === undefined) {
		throw new Error('PUBLIC_TEMPLATE_SNAPSHOT_INVALID:relations:list-not-ready');
	}

	const rows = {
		all: await ctx.db
			.query('publicTemplateSnapshots')
			.withIndex('by_key', (q) => q.eq('key', 'all'))
			.unique(),
		excludeCwc: await ctx.db
			.query('publicTemplateSnapshots')
			.withIndex('by_key', (q) => q.eq('key', 'excludeCwc'))
			.unique()
	};
	const idsByKey = {} as Record<PublicTemplateSnapshotKey, Array<Id<'templates'>>>;
	for (const key of ['all', 'excludeCwc'] as const) {
		const row = rows[key];
		if (
			!row ||
			row.projectionVersion !== PUBLIC_TEMPLATE_PROJECTION_VERSION ||
			row.revision !== manifest.listRevision ||
			row.updatedAt !== manifest.listUpdatedAt
		) {
			throw new Error(`PUBLIC_TEMPLATE_SNAPSHOT_INVALID:relations:published-generation:${key}`);
		}
		idsByKey[key] = projectStoredPublicTemplates(row.templates, {
			key,
			revision: row.revision
		}).map((template) => {
			const id = ctx.db.normalizeId('templates', String(template.id));
			if (!id) {
				throw new Error(`PUBLIC_TEMPLATE_SNAPSHOT_INVALID:relations:template-id:${key}`);
			}
			return id;
		});
	}

	return idsByKey;
}

async function preparePublishedPublicTemplateRelationSelection(
	ctx: MutationCtx
): Promise<PublicTemplateRelationSelection> {
	const idsByKey = await readPublishedPublicTemplateIds(ctx);

	const uniqueIds = [...new Set([...idsByKey.all, ...idsByKey.excludeCwc])];
	const migration = await compactDiscoveryPlaneReady(ctx);
	const hydrated: PublicTemplateEnrichmentSource[] = (
		await Promise.all(
			uniqueIds.map(async (id) => {
				const row = await ctx.db
					.query('publicTemplateDiscoverySources')
					.withIndex('by_templateId', (q) => q.eq('templateId', id))
					.unique();
				if (!row || row.generation !== migration.runToken) return null;
				assertCompactPublicTemplateSource(row.source, row.isCwc);
				return row.source;
			})
		)
	).filter((value): value is CompactPublicTemplateSource => value !== null);
	const templatesById = new Map(hydrated.map((template) => [template._id, template] as const));
	const sources = {
		all: idsByKey.all.flatMap((id) => {
			const template = templatesById.get(id);
			return template ? [template] : [];
		}),
		excludeCwc: idsByKey.excludeCwc.flatMap((id) => {
			const template = templatesById.get(id);
			return template ? [template] : [];
		})
	};

	return {
		sourceGeneration: migration.runToken,
		candidates: [...templatesById.values()],
		sources
	};
}

async function prepareRelationSnapshotRebuild(
	ctx: MutationCtx,
	selection?: PublicTemplateRelationSelection,
	coordinatedRebuildToken?: string
): Promise<PreparedRelationSnapshotRebuild> {
	// Reserve without advancing either manifest revision. A relation-only rebuild
	// hydrates the exact IDs in the currently published list generation; the
	// composite rebuild supplies its already-computed plan.
	const publication = await preparePublicDiscoveryRelationsPublication(
		ctx,
		coordinatedRebuildToken
	);
	const existingRows = {
		all: await ctx.db
			.query('templateRelationSnapshots')
			.withIndex('by_key', (q) => q.eq('key', 'all'))
			.unique(),
		excludeCwc: await ctx.db
			.query('templateRelationSnapshots')
			.withIndex('by_key', (q) => q.eq('key', 'excludeCwc'))
			.unique()
	};
	const resolvedSelection =
		selection ?? (await preparePublishedPublicTemplateRelationSelection(ctx));
	const [allInput, excludeCwcInput] = await Promise.all([
		prepareRelationVariantInput(
			ctx,
			resolvedSelection.sources.all,
			resolvedSelection.sourceGeneration
		),
		prepareRelationVariantInput(
			ctx,
			resolvedSelection.sources.excludeCwc,
			resolvedSelection.sourceGeneration
		)
	]);

	// Building both variants performs every size check before the first write.
	const variants = {
		all: buildRelationSnapshotVariant('all', allInput, publication),
		excludeCwc: buildRelationSnapshotVariant('excludeCwc', excludeCwcInput, publication)
	};

	return { publication, selection: resolvedSelection, variants, existingRows };
}

async function publishRelationSnapshotRebuild(
	ctx: MutationCtx,
	prepared: PreparedRelationSnapshotRebuild
): Promise<RelationSnapshotRebuildResult> {
	const { publication, selection, variants, existingRows } = prepared;
	const previousManifest = await getPublicDiscoveryManifestRow(ctx);

	for (const key of ['all', 'excludeCwc'] as const) {
		const existing = existingRows[key];
		if (existing) {
			await ctx.db.patch(existing._id, variants[key].snapshot);
		} else {
			await ctx.db.insert('templateRelationSnapshots', variants[key].snapshot);
		}
	}

	await commitPublicDiscoveryRelationsPublication(ctx, publication);

	const degradationCodes = (['all', 'excludeCwc'] as const).flatMap((key) => {
		const code = variants[key].degradationCode;
		return code ? [code] : [];
	});
	if (degradationCodes.length > 0) {
		const manifest = await getPublicDiscoveryManifestRow(ctx);
		if (!manifest) {
			throw new Error('PUBLIC_DISCOVERY_MANIFEST_MISSING_AFTER_RELATIONS_PUBLICATION');
		}
		const failure = new Error(degradationCodes.join('|'));
		await recordPublicDiscoverySnapshotFailure(
			ctx,
			manifest,
			'relations',
			failure,
			publication.updatedAt,
			{
				code: previousManifest?.relationsFailureCode,
				failedAt: previousManifest?.relationsFailureAt
			}
		);
		console.error(
			`[public-discovery] relation revision ${publication.revision} shed bounded payload data; retained graph remains available`
		);
	}

	return {
		sourceScanCap: PUBLIC_TEMPLATE_SNAPSHOT_SCAN_CAP,
		scannedCount: selection.candidates.length,
		all: variants.all.result,
		excludeCwc: variants.excludeCwc.result
	};
}

async function rebuildRelationSnapshotImpl(
	ctx: MutationCtx,
	selection?: PublicTemplateRelationSelection
): Promise<RelationSnapshotRebuildResult> {
	return await publishRelationSnapshotRebuild(
		ctx,
		await prepareRelationSnapshotRebuild(ctx, selection)
	);
}

/** Internal/operator entry point for relation-only refreshes and the cron. */
export const rebuildRelationSnapshot = internalMutation({
	args: {},
	handler: async (ctx) => await rebuildRelationSnapshotImpl(ctx)
});

/** Mutation attempt supervised by the cron action below. */
export const rebuildRelationSnapshotForCronAttempt = internalMutation({
	args: {},
	handler: async (ctx) => {
		let prepared: PreparedRelationSnapshotRebuild;
		try {
			prepared = await prepareRelationSnapshotRebuild(ctx);
		} catch (error) {
			const normalized = normalizeRelationSnapshotError(error);
			if (isPublicDiscoveryCoordinationError(normalized)) throw normalized;
			const status = classifyRelationSnapshotFreeze(normalized);
			await freezePublicDiscoverySnapshotFailure(ctx, 'relations', normalized, Date.now());
			return { status };
		}
		// Keep database-write errors throwable so this transaction rolls every
		// partial upsert back; the outer action records them in a fresh mutation.
		return {
			status: 'rebuilt' as const,
			rebuilt: await publishRelationSnapshotRebuild(ctx, prepared)
		};
	}
});

/** Daily supervisor persists even unknown rebuild failures in a new mutation. */
export const rebuildRelationSnapshotForCron = internalAction({
	args: {},
	handler: async (ctx) =>
		await supervisePublicDiscoveryCronRebuild(
			ctx,
			'relations',
			rebuildRelationSnapshotForCronAttemptRef
		)
});

/** Internal entry point used by tests/operators and relation-affecting writers. */
export const requestPublicTemplateRelationSnapshotRefresh = internalMutation({
	args: {},
	handler: async (ctx) => markPublicDiscoveryRelationsDirty(ctx)
});

/**
 * Coalesced write-driven relation refresh.
 *
 * Topic and tag-embedding writes only dirty the compact control-plane row.
 * The first write schedules this bounded rebuild; subsequent writes reuse the
 * token, and no scheduled relation rebuild can run more than once per six-hour
 * cost window. A successful publication clears the dirty marker. Oversize and
 * runtime failures preserve the last-good relation row and leave it dirty.
 */
export const flushScheduledPublicTemplateRelationsRefresh = internalMutation({
	args: { scheduledAt: v.number(), bypassMinInterval: v.optional(v.boolean()) },
	handler: async (ctx, { scheduledAt }) => {
		const manifest = await getPublicDiscoveryManifestRow(ctx);
		if (!manifest || manifest.relationsRefreshScheduledAt !== scheduledAt) {
			return { status: 'superseded' as const };
		}

		if (manifest.relationsDirtyAt === undefined) {
			await ctx.db.patch(manifest._id, { relationsRefreshScheduledAt: undefined });
			return { status: 'clean' as const };
		}

		const now = Date.now();
		if (manifest.listDirtyAt !== undefined) {
			if (manifest.listRefreshScheduledAt === undefined) {
				const blocked = new Error(
					`PUBLIC_DISCOVERY_RELATIONS_BLOCKED_BY_LIST:${manifest.listFailureCode ?? 'UNSCHEDULED_DIRTY'}`.slice(
						0,
						500
					)
				);
				await freezePublicDiscoverySnapshotFailure(ctx, 'relations', blocked, now);
				return { status: 'blocked-by-list' as const };
			}
			const nextScheduledAt = await reschedulePublicDiscoveryRelationsRefresh(
				ctx,
				manifest,
				now,
				manifest.listRefreshScheduledAt + PUBLIC_DISCOVERY_RELATIONS_DEBOUNCE_MS
			);
			return {
				status: 'deferred-for-list' as const,
				scheduledAt: nextScheduledAt
			};
		}
		const nextAllowedAt =
			(manifest.relationsUpdatedAt ?? 0) + PUBLIC_DISCOVERY_RELATIONS_MIN_REBUILD_INTERVAL_MS;
		if (!publicDiscoveryRelationsRefreshBypassesMinInterval(manifest) && now < nextAllowedAt) {
			const nextScheduledAt = await reschedulePublicDiscoveryRelationsRefresh(
				ctx,
				manifest,
				now,
				nextAllowedAt
			);
			return { status: 'deferred' as const, scheduledAt: nextScheduledAt };
		}

		let prepared: PreparedRelationSnapshotRebuild;
		try {
			prepared = await prepareRelationSnapshotRebuild(ctx);
		} catch (error) {
			const normalized = normalizeRelationSnapshotError(error);
			if (isPublicDiscoveryCoordinationError(normalized)) throw normalized;
			const status = classifyRelationSnapshotFreeze(normalized);
			await freezePublicDiscoverySnapshotFailure(ctx, 'relations', normalized, now);
			return { status };
		}

		// Preparation is side-effect-free, so every compute/validation failure is
		// durably classified above. Publication errors still throw to preserve
		// Convex's all-or-nothing rollback for the two snapshot rows.
		const rebuilt = await publishRelationSnapshotRebuild(ctx, prepared);
		const publishedManifest = await getPublicDiscoveryManifestRow(ctx);
		if (publishedManifest?.relationsRefreshScheduledAt === scheduledAt) {
			await ctx.db.patch(publishedManifest._id, {
				relationsRefreshScheduledAt: undefined
			});
		}
		return { status: 'rebuilt' as const, rebuilt };
	}
});

async function rebuildHomepageSnapshotsImpl(
	ctx: MutationCtx,
	coordinatedRebuildToken?: string
): Promise<HomepageSnapshotRebuildResult> {
	const listPublication = await preparePublicDiscoveryListPublication(ctx, coordinatedRebuildToken);
	const selection = await preparePublicTemplateSnapshotPlan(ctx, listPublication);
	const preparedRelations = await prepareRelationSnapshotRebuild(
		ctx,
		selection,
		coordinatedRebuildToken
	);

	// Finish both pure preparations before the first row write. The relation
	// graph therefore consumes the exact cards the list publishes, and a guard
	// failure cannot expose a half-prepared generation even transiently.
	const list = await publishPublicTemplateSnapshotPlan(ctx, listPublication, selection);
	const relations = await publishRelationSnapshotRebuild(ctx, preparedRelations);
	if (coordinatedRebuildToken !== undefined) {
		await completePublicDiscoveryCoordinatedRebuild(ctx, coordinatedRebuildToken);
	}
	return { list, relations };
}

/**
 * One-shot activation and post-authoring refresh for every homepage snapshot.
 * Both materializations publish in one transaction, so callers can never
 * observe a freshly rebuilt list paired with relations from a failed rebuild.
 */
export const rebuildHomepageSnapshots = internalMutation({
	args: { coordinatedRebuildToken: v.optional(v.string()) },
	handler: async (ctx, args) =>
		await rebuildHomepageSnapshotsImpl(ctx, args.coordinatedRebuildToken)
});

/** One atomic list+relations attempt used by the consolidated daily cron. */
export const rebuildHomepageSnapshotsForCronAttempt = internalMutation({
	args: {},
	handler: async (ctx) => ({
		status: 'rebuilt' as const,
		rebuilt: await rebuildHomepageSnapshotsImpl(ctx)
	})
});

/**
 * Persist failures outside the rolled-back composite transaction. Both
 * families are marked because neither generation advances when any prepare or
 * publish stage fails.
 */
export const rebuildHomepageSnapshotsForCron = internalAction({
	args: {},
	handler: async (ctx) => {
		const attemptState = await ctx.runQuery(publicDiscoveryCronAttemptStateRef, {});
		const temporalDue =
			attemptState.nextTemporalRebuildAt !== null &&
			attemptState.nextTemporalRebuildAt <= Date.now();
		const rebuildRequired =
			attemptState.temporalScheduleVersion !== 1 ||
			!attemptState.listReady ||
			!attemptState.relationsReady ||
			attemptState.listDirtyAt !== null ||
			attemptState.relationsDirtyAt !== null ||
			attemptState.listFailureCode !== null ||
			attemptState.relationsFailureCode !== null ||
			temporalDue;
		if (!rebuildRequired) {
			return {
				status: 'clean' as const,
				nextTemporalRebuildAt: attemptState.nextTemporalRebuildAt
			};
		}
		try {
			return await ctx.runMutation(rebuildHomepageSnapshotsForCronAttemptRef, {});
		} catch (error) {
			const failedAt = Date.now();
			const message = error instanceof Error ? error.message : String(error);
			await ctx.runMutation(recordPublicDiscoverySnapshotRuntimeFailureRef, {
				failures: (['list', 'relations'] as const).map((family) => ({
					family,
					code: `PUBLIC_DISCOVERY_${family.toUpperCase()}_COMPOSITE_CRON_REBUILD_FAILED:${message}`.slice(
						0,
						500
					)
				})),
				failedAt,
				attempt: attemptState
			});
			throw error;
		}
	}
});

/**
 * SSR-only: Get one published template for an explicit detail/send route.
 *
 * This indexed query is deliberately separate from the materialized discovery
 * snapshots. Detail/send pages need the target roster to render the power
 * landscape and construct a mailto action; homepage/list snapshots must never
 * contain it. The server credential prevents browser/direct-origin access, and
 * every stored `v.any()` value is still treated as hostile: this boundary
 * validates and reconstructs the exhaustive public contract before return.
 * Provider and CWC configuration are redacted in the projection writer rather
 * than merely at the HTTP edge.
 */
export const getBySlugPublic = query({
	args: { _secret: v.optional(v.string()), slug: v.string() },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret ?? '');
		if (
			args.slug.length === 0 ||
			new TextEncoder().encode(args.slug).byteLength > MAX_TEMPLATE_SLUG_BYTES
		) {
			throw new ConvexError({
				code: 'TEMPLATE_SLUG_VALUE_INVALID',
				maxBytes: MAX_TEMPLATE_SLUG_BYTES
			});
		}
		await assertPublicDiscoveryDirectSourceServingReady(ctx);
		await compactDiscoveryPlaneReady(ctx);
		const projection = await ctx.db
			.query('publicTemplateDetailProjections')
			.withIndex('by_slug', (q) => q.eq('slug', args.slug))
			.unique();

		// Only published+public writers create this row. Missing is an honest
		// private/draft/not-found result after the versioned cutover gate above.
		if (!projection) return null;
		if (projection.projectionVersion !== PUBLIC_TEMPLATE_DETAIL_PROJECTION_VERSION) {
			throw new Error(
				`PUBLIC_TEMPLATE_DETAIL_PROJECTION_VERSION_MISMATCH:${projection.projectionVersion}`
			);
		}
		const detail = readPublicTemplateDetailProjection(projection.detail);
		if (
			String(detail.id) !== String(projection.templateId) ||
			detail.slug !== projection.slug ||
			detail.slug !== args.slug ||
			projection.detailBytes !== publicTemplateDetailProjectionBytes(detail)
		) {
			throw new Error('PUBLIC_TEMPLATE_DETAIL_PROJECTION_INVALID:row-consistency');
		}

		// Fetch author info. Post-PII-elimination (2026-04-10) the users table
		// stores plaintext `name`; the legacy `encryptedName` blob is deprecated
		// and not produced for new users.
		let author: { name: string | null; avatar: string | null } | null = null;
		if (projection.userId) {
			const user = await ctx.db.get(projection.userId);
			if (user) {
				author = { name: user.name ?? null, avatar: user.avatar ?? null };
			}
		}
		return {
			...detail,
			author
		};
	}
});

export const PUBLIC_TEMPLATE_PAGE_INVENTORY_PAGE_SIZE = 64;
export const PUBLIC_TEMPLATE_PAGE_MATERIALIZATION_BATCH_SIZE = 4;
const PUBLIC_TEMPLATE_PAGE_INVENTORY_PAGE_MAX_BYTES = 128 * 1024;

if (
	PUBLIC_TEMPLATE_PAGE_MATERIALIZATION_BATCH_SIZE !== PUBLIC_RECIPIENT_PAGE_METRICS_BATCH_MAX ||
	PUBLIC_TEMPLATE_PAGE_MATERIALIZATION_BATCH_SIZE !== PUBLIC_TEMPLATE_PAGE_DEBATE_BATCH_MAX
) {
	throw new Error('PUBLIC_TEMPLATE_PAGE_INVENTORY_BATCH_CONTRACT_MISMATCH');
}

/**
 * Producer-only, cursor-paged inventory of every eligible public detail route.
 *
 * The authenticated Pages control plane supplies the exact list generation it
 * is about to advertise. This query range-reads only the active compact-source
 * generation and returns only per-template dirty coordinates. Unchanged pages
 * therefore cost a few hundred bytes of Convex I/O—not their detail copy or up
 * to 25 argument bodies. A separate bounded query materializes only coordinates
 * absent from the previous immutable R2 inventory.
 */
export const publicTemplatePageArtifactInventoryPage = query({
	args: {
		_secret: v.optional(v.string()),
		cursor: v.optional(v.union(v.string(), v.null())),
		expectedListRevision: v.number()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret ?? '');
		if (
			!Number.isSafeInteger(args.expectedListRevision) ||
			args.expectedListRevision < 1 ||
			(args.cursor !== undefined && args.cursor !== null && args.cursor.length > 2_048)
		) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_INVENTORY_CONTROL_INVALID');
		}
		await assertPublicDiscoveryDirectSourceServingReady(ctx);
		const manifest = await getPublicDiscoveryManifestRow(ctx);
		if (
			!manifest?.listReady ||
			manifest.listRevision !== args.expectedListRevision ||
			manifest.listUpdatedAt === undefined
		) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_INVENTORY_GENERATION_MISMATCH');
		}
		const migration = await compactDiscoveryPlaneReady(ctx);
		const page = await ctx.db
			.query('publicTemplatePageArtifactCoordinates')
			.withIndex('by_generation_slug', (q) => q.eq('generation', migration.runToken))
			.order('asc')
			.paginate({
				cursor: args.cursor ?? null,
				numItems: PUBLIC_TEMPLATE_PAGE_INVENTORY_PAGE_SIZE,
				maximumRowsRead: PUBLIC_TEMPLATE_PAGE_INVENTORY_PAGE_SIZE + 1,
				maximumBytesRead: PUBLIC_TEMPLATE_PAGE_INVENTORY_PAGE_MAX_BYTES
			});
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('PUBLIC_TEMPLATE_PAGE_INVENTORY_PAGE_SPLIT_REQUIRED');
		}

		const entries = page.page.map((coordinate) => {
			if (
				coordinate.projectionVersion !== PUBLIC_TEMPLATE_PAGE_ARTIFACT_COORDINATE_VERSION ||
				!Number.isSafeInteger(coordinate.artifactRevision) ||
				coordinate.artifactRevision < 1
			) {
				throw new Error('PUBLIC_TEMPLATE_PAGE_INVENTORY_COORDINATE_INVALID');
			}
			return {
				templateId: coordinate.templateId,
				slug: coordinate.slug,
				artifactRevision: coordinate.artifactRevision
			};
		});
		return {
			entries,
			continueCursor: page.isDone ? null : page.continueCursor,
			isDone: page.isDone,
			revision: manifest.listRevision,
			updatedAt: manifest.listUpdatedAt
		};
	}
});

/** Materialize only the changed coordinates selected by the producer. */
export const publicTemplatePageArtifactsByCoordinates = query({
	args: {
		_secret: v.optional(v.string()),
		expectedListRevision: v.number(),
		coordinates: v.array(
			v.object({
				templateId: v.id('templates'),
				slug: v.string(),
				artifactRevision: v.number()
			})
		)
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret ?? '');
		if (
			args.coordinates.length < 1 ||
			args.coordinates.length > PUBLIC_TEMPLATE_PAGE_MATERIALIZATION_BATCH_SIZE ||
			!Number.isSafeInteger(args.expectedListRevision) ||
			new Set(args.coordinates.map(({ templateId }) => String(templateId))).size !==
				args.coordinates.length
		) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_MATERIALIZATION_CONTROL_INVALID');
		}
		await assertPublicDiscoveryDirectSourceServingReady(ctx);
		const manifest = await getPublicDiscoveryManifestRow(ctx);
		if (!manifest?.listReady || manifest.listRevision !== args.expectedListRevision) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_MATERIALIZATION_GENERATION_MISMATCH');
		}
		const migration = await compactDiscoveryPlaneReady(ctx);
		const coordinates = await Promise.all(
			args.coordinates.map(({ templateId }) =>
				ctx.db
					.query('publicTemplatePageArtifactCoordinates')
					.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
					.unique()
			)
		);
		const projections = await Promise.all(
			args.coordinates.map(({ templateId }) =>
				ctx.db
					.query('publicTemplateDetailProjections')
					.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
					.unique()
			)
		);
		for (const [index, requested] of args.coordinates.entries()) {
			const coordinate = coordinates[index];
			if (
				!coordinate ||
				coordinate.generation !== migration.runToken ||
				coordinate.projectionVersion !== PUBLIC_TEMPLATE_PAGE_ARTIFACT_COORDINATE_VERSION ||
				coordinate.slug !== requested.slug ||
				coordinate.artifactRevision !== requested.artifactRevision
			) {
				throw new Error('PUBLIC_TEMPLATE_PAGE_MATERIALIZATION_COORDINATE_MISMATCH');
			}
		}
		const templateIds = args.coordinates.map(({ templateId }) => templateId);
		const [metrics, debates] = await Promise.all([
			readPublicRecipientPageMetricsBatch(ctx, templateIds),
			readPublicTemplatePageDebatesBatch(ctx, templateIds)
		]);
		return await Promise.all(
			args.coordinates.map(async (requested, index) => {
				const projection = projections[index];
				if (
					!projection ||
					projection.projectionVersion !== PUBLIC_TEMPLATE_DETAIL_PROJECTION_VERSION ||
					String(projection.templateId) !== String(requested.templateId)
				) {
					throw new Error('PUBLIC_TEMPLATE_PAGE_MATERIALIZATION_DETAIL_MISSING');
				}
				const detail = readPublicTemplateDetailProjection(projection.detail);
				if (
					String(detail.id) !== String(requested.templateId) ||
					detail.slug !== projection.slug ||
					detail.slug !== requested.slug ||
					projection.detailBytes !== publicTemplateDetailProjectionBytes(detail)
				) {
					throw new Error('PUBLIC_TEMPLATE_PAGE_MATERIALIZATION_DETAIL_INVALID');
				}
				let author: { name: string | null; avatar: string | null } | null = null;
				if (projection.userId) {
					const user = await ctx.db.get(projection.userId);
					if (user) author = { name: user.name ?? null, avatar: user.avatar ?? null };
				}
				return {
					slug: detail.slug,
					artifactRevision: requested.artifactRevision,
					detail: { ...detail, author },
					aggregate: {
						templateId: String(requested.templateId),
						messageMetrics: metrics[index]!.messageMetrics,
						debate: debates[index],
						positionMetrics: metrics[index]!.positionMetrics
					}
				};
			})
		);
	}
});

/**
 * Internal: Batch lookup templates by IDs.
 * Used by search action to hydrate results after vector search.
 */
export const publicDiscoverySearchReadiness = internalQuery({
	args: {},
	handler: async (ctx) => {
		await assertPublicDiscoveryDirectSourceServingReady(ctx);
		const migration = await compactDiscoveryPlaneReady(ctx);
		return { generation: migration.runToken };
	}
});

export const getByIds = internalQuery({
	args: { ids: v.array(v.id('templates')) },
	handler: async (ctx, args) => {
		await assertPublicDiscoveryDirectSourceServingReady(ctx);
		const migration = await compactDiscoveryPlaneReady(ctx);
		const results = await Promise.all(
			args.ids.slice(0, 50).map(async (id) => {
				const row = await ctx.db
					.query('publicTemplateDiscoverySources')
					.withIndex('by_templateId', (q) => q.eq('templateId', id))
					.unique();
				if (!row || row.generation !== migration.runToken) return null;
				assertCompactPublicTemplateSource(row.source, row.isCwc);
				return row.source;
			})
		);
		return results.filter((value): value is CompactPublicTemplateSource => value !== null);
	}
});

// =============================================================================
// SEARCH — authenticated, provider-free compact text-index action
// =============================================================================

/**
 * Search the compact public source plane without provider or vector work.
 * The server-secret boundary prevents direct public action calls, the stable
 * actor bucket bounds repeated searches, and the internal query owns the exact
 * indexed read limit.
 */
export const search = action({
	args: {
		_secret: v.string(),
		actorKey: v.string(),
		query: v.string(),
		limit: v.optional(v.number()),
		domain: v.optional(v.string()),
		countryCode: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		// This action is intentionally reachable only through the authenticated
		// SvelteKit route. Reject direct public Convex calls before rate-limit I/O,
		// then charge every query variation to one stable actor bucket.
		requireInternalSecret(args._secret);
		if (args.actorKey.length === 0 || args.actorKey.length > 160) {
			throw new Error('SEARCH_ACTOR_KEY_INVALID');
		}
		const queryText = args.query.trim();
		if (queryText.length < 2) {
			throw new Error('Query must be at least 2 characters');
		}
		if (queryText.length > 200) {
			throw new Error('Query too long (max 200 characters)');
		}

		// Bound domain + countryCode at the action boundary. The SvelteKit
		// boundary takes a separate path and does not enforce these caps
		// for direct Convex callers.
		if (args.domain !== undefined && args.domain.length > 64) {
			throw new Error('DOMAIN_TOO_LARGE');
		}
		if (args.countryCode !== undefined && args.countryCode.length > 8) {
			throw new Error('COUNTRY_CODE_TOO_LARGE');
		}

		const limit = Math.min(Math.max(args.limit ?? 10, 1), 20);

		// Fail before the rate-limit write while a coordinated clear/reseed owns the
		// compact source plane.
		await ctx.runQuery(publicDiscoverySearchReadinessRef, {});

		const burst = await ctx.runMutation(rateLimitCheckRef, {
			key: `templates.search:burst:${args.actorKey}`,
			windowMs: 60_000,
			maxRequests: 30
		});
		if (!burst.allowed) {
			throw new ConvexError({ code: 'TEMPLATE_SEARCH_BURST_LIMITED' });
		}

		const textResults = (await ctx.runQuery(textSearchRef, {
			query: queryText,
			limit,
			domain: args.domain,
			countryCode: args.countryCode
		})) as CompactPublicTemplateSource[];
		return {
			templates: textResults.map((template) => toPublicTemplate(template, null)),
			method: 'keyword' as const
		};
	}
});

/**
 * Internal bounded search over the compact Convex text index.
 */
export const textSearch = internalQuery({
	args: {
		query: v.string(),
		limit: v.number(),
		domain: v.optional(v.string()),
		countryCode: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await assertPublicDiscoveryDirectSourceServingReady(ctx);
		const migration = await compactDiscoveryPlaneReady(ctx);
		const q = ctx.db
			.query('publicTemplateDiscoverySources')
			.withSearchIndex('search_title', (s) => {
				let search = s.search('title', args.query);
				search = search.eq('generation', migration.runToken);
				if (args.domain) search = search.eq('domain', args.domain);
				if (args.countryCode) search = search.eq('countryCode', args.countryCode);
				return search;
			});

		const results = await q.take(Math.min(args.limit + 20, 50));
		return results.slice(0, args.limit).map((row) => {
			assertCompactPublicTemplateSource(row.source, row.isCwc);
			return row.source;
		});
	}
});

const TEMPLATE_LIST_PROJECTION_MIGRATION_PAGE_SIZE = 4;
const TEMPLATE_LIST_PROJECTION_MIGRATION_MAX_BYTES = 5 * 1024 * 1024;

/** Observable state for the embedding-free authenticated-list cutover. */
export const templateListProjectionMigrationStatus = internalQuery({
	args: {},
	handler: async (ctx) => {
		const migration = await getTemplateListProjectionMigration(ctx);
		return migration
			? {
					status: migration.status,
					runToken: migration.runToken,
					startedAt: migration.startedAt,
					completedAt: migration.completedAt ?? null,
					scanned: migration.scanned,
					projected: migration.projected,
					failureCode: migration.failureCode ?? null,
					failureTemplateId: migration.failureTemplateId ?? null
				}
			: { status: 'not-started' as const };
	}
});

/**
 * Idempotently project four canonical templates per transaction. Canonical rows
 * may approach 1 MiB, so both row and byte reads are explicitly bounded. Live
 * writers dual-write before cutover; restart safely replays the current corpus.
 */
export const migrateTemplateListProjection = internalMutation({
	args: {
		runToken: v.optional(v.string()),
		restart: v.optional(v.boolean()),
		scheduleContinuation: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		if (args.runToken !== undefined && args.restart) {
			throw new Error('TEMPLATE_LIST_PROJECTION_MIGRATION_INVALID_CONTROL');
		}

		let migration = await getTemplateListProjectionMigration(ctx);
		let runToken: string;
		let cursor: string | undefined;
		let scanned: number;
		let projected: number;

		if (args.runToken !== undefined) {
			if (!migration || migration.status !== 'running' || migration.runToken !== args.runToken) {
				return { status: 'superseded' as const, runToken: args.runToken };
			}
			runToken = args.runToken;
			cursor = migration.cursor;
			scanned = migration.scanned;
			projected = migration.projected;
		} else if (!args.restart && migration?.status === 'ready') {
			return {
				status: 'already-ready' as const,
				runToken: migration.runToken,
				scanned: migration.scanned,
				projected: migration.projected,
				completedAt: migration.completedAt ?? null
			};
		} else if (!args.restart && migration?.status === 'migrated') {
			return {
				status: 'already-migrated' as const,
				runToken: migration.runToken,
				scanned: migration.scanned,
				projected: migration.projected,
				completedAt: migration.completedAt ?? null
			};
		} else if (!args.restart && migration?.status === 'running') {
			return {
				status: 'already-running' as const,
				runToken: migration.runToken,
				scanned: migration.scanned,
				projected: migration.projected
			};
		} else if (!args.restart && migration?.status === 'blocked') {
			return {
				status: 'blocked' as const,
				runToken: migration.runToken,
				failureCode: migration.failureCode ?? null,
				failureTemplateId: migration.failureTemplateId ?? null
			};
		} else {
			runToken = crypto.randomUUID();
			cursor = undefined;
			const startedAt = Date.now();
			scanned = 0;
			projected = 0;
			const initial = {
				key: TEMPLATE_LIST_PROJECTION_KEY,
				status: 'running' as const,
				runToken,
				cursor: undefined,
				startedAt,
				completedAt: undefined,
				scanned,
				projected,
				failureCode: undefined,
				failureTemplateId: undefined,
				updatedAt: startedAt
			};
			if (migration) await ctx.db.patch(migration._id, initial);
			else await ctx.db.insert('templateListProjectionMigrations', initial);
			migration = await getTemplateListProjectionMigration(ctx);
		}

		if (!migration || migration.runToken !== runToken) {
			throw new Error('TEMPLATE_LIST_PROJECTION_MIGRATION_STATE_MISSING');
		}
		const page = await ctx.db
			.query('templates')
			.order('asc')
			.paginate({
				cursor: cursor ?? null,
				numItems: TEMPLATE_LIST_PROJECTION_MIGRATION_PAGE_SIZE,
				maximumRowsRead: TEMPLATE_LIST_PROJECTION_MIGRATION_PAGE_SIZE + 1,
				maximumBytesRead: TEMPLATE_LIST_PROJECTION_MIGRATION_MAX_BYTES
			});

		if (page.pageStatus === 'SplitRequired') {
			const failureCode = 'TEMPLATE_LIST_PROJECTION_MIGRATION_PAGE_SPLIT_REQUIRED';
			await ctx.db.patch(migration._id, {
				status: 'blocked',
				failureCode,
				updatedAt: Date.now()
			});
			return { status: 'blocked' as const, runToken, failureCode };
		}

		for (const template of page.page) {
			try {
				await syncTemplateListProjection(ctx, template);
			} catch (error) {
				const failureCode = error instanceof Error ? error.message : String(error);
				await ctx.db.patch(migration._id, {
					status: 'blocked',
					failureCode,
					failureTemplateId: template._id,
					updatedAt: Date.now()
				});
				return {
					status: 'blocked' as const,
					runToken,
					failureCode,
					failureTemplateId: template._id
				};
			}
		}

		scanned += page.page.length;
		projected += page.page.length;
		const completedAt = page.isDone ? Date.now() : undefined;
		await ctx.db.patch(migration._id, {
			status: page.isDone ? 'migrated' : 'running',
			cursor: page.isDone ? undefined : page.continueCursor,
			completedAt,
			scanned,
			projected,
			failureCode: undefined,
			failureTemplateId: undefined,
			updatedAt: Date.now()
		});

		if (!page.isDone && args.scheduleContinuation !== false) {
			await ctx.scheduler.runAfter(0, migrateTemplateListProjectionRef, { runToken });
		}
		return {
			status: page.isDone ? ('migrated' as const) : ('running' as const),
			runToken,
			scanned,
			projected,
			completedAt: completedAt ?? null,
			...(page.isDone ? {} : { continueCursor: page.continueCursor })
		};
	}
});

/** Explicit reader cutover after the bounded migration has completed exactly. */
export const activateTemplateListProjection = internalMutation({
	args: {},
	handler: async (ctx) => {
		const migration = await getTemplateListProjectionMigration(ctx);
		if (migration?.status === 'ready') {
			return {
				status: 'ready' as const,
				runToken: migration.runToken,
				scanned: migration.scanned,
				projected: migration.projected
			};
		}
		if (!migration || migration.status !== 'migrated') {
			throw new ConvexError({
				code: 'TEMPLATE_LIST_PROJECTION_MIGRATION_INCOMPLETE',
				status: migration?.status ?? 'not-started'
			});
		}
		if (migration.scanned !== migration.projected) {
			throw new ConvexError({
				code: 'TEMPLATE_LIST_PROJECTION_MIGRATION_INEXACT',
				scanned: migration.scanned,
				projected: migration.projected
			});
		}
		await ctx.db.patch(migration._id, { status: 'ready', updatedAt: Date.now() });
		return {
			status: 'ready' as const,
			runToken: migration.runToken,
			scanned: migration.scanned,
			projected: migration.projected
		};
	}
});

async function currentTemplateListUser(ctx: QueryCtx) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error('Authentication required');
	return identity.email
		? await ctx.db
				.query('users')
				.withIndex('by_email', (q) => q.eq('email', identity.email))
				.first()
		: null;
}

function legacyTemplateListPageRequired(scope: 'user' | 'org'): never {
	throw new ConvexError({
		code: 'TEMPLATE_LIST_PAGINATION_REQUIRED',
		scope,
		maxPageSize: TEMPLATE_LIST_MAX_PAGE_SIZE
	});
}

/**
 * Authenticated, cursor-paginated templates belonging to the current user.
 * Reads only the cutover-gated, embedding-free projection plane.
 */
export const listByUserPage = query({
	args: { paginationOpts: templateListPaginationValidator },
	handler: async (ctx, { paginationOpts }) => {
		const user = await currentTemplateListUser(ctx);
		if (!user) {
			await requireTemplateListProjectionReady(ctx);
			return { page: [], isDone: true, continueCursor: '' };
		}
		const result = await readTemplateListPageByUser(ctx, user._id, paginationOpts);
		return { ...result, page: result.page.map(toAuthenticatedTemplateListItem) };
	}
});

/**
 * Backward-compatible array contract for older direct callers. It never
 * truncates: accounts beyond the bounded first page receive a coded error and
 * must move to `listByUserPage`.
 */
export const listByUser = query({
	args: {},
	handler: async (ctx) => {
		const user = await currentTemplateListUser(ctx);
		if (!user) {
			await requireTemplateListProjectionReady(ctx);
			return [];
		}
		const result = await readTemplateListPageByUser(ctx, user._id, {
			cursor: null,
			numItems: TEMPLATE_LIST_MAX_PAGE_SIZE
		});
		if (!result.isDone) legacyTemplateListPageRequired('user');
		return result.page.map(toAuthenticatedTemplateListItem);
	}
});

/** Authenticated, cursor-paginated templates belonging to an organization. */
export const listByOrgPage = query({
	args: {
		slug: v.string(),
		paginationOpts: templateListPaginationValidator
	},
	handler: async (ctx, { slug, paginationOpts }) => {
		const { org } = await requireOrgRole(ctx, slug, 'member');
		const result = await readTemplateListPageByOrg(ctx, org._id, paginationOpts);
		return {
			...result,
			page: result.page.map(toOrgTemplateListItem).sort((a, b) => a.title.localeCompare(b.title))
		};
	}
});

/**
 * Backward-compatible array contract for older direct callers. It never
 * truncates: larger organizations must use `listByOrgPage`.
 */
export const listByOrg = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org } = await requireOrgRole(ctx, slug, 'member');
		const result = await readTemplateListPageByOrg(ctx, org._id, {
			cursor: null,
			numItems: TEMPLATE_LIST_MAX_PAGE_SIZE
		});
		if (!result.isDone) legacyTemplateListPageRequired('org');
		return result.page.map(toOrgTemplateListItem).sort((a, b) => a.title.localeCompare(b.title));
	}
});

// =============================================================================
// ENDORSEMENTS — Org endorses/un-endorses a template
// =============================================================================

async function storedEndorsementCountIsTrusted(
	ctx: MutationCtx,
	count: number | undefined
): Promise<boolean> {
	if (!isAuthoritativeEndorsementCount(count)) return false;
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	return manifest?.endorsementCountMigrationStatus === 'complete';
}

async function persistEndorsementCount(
	ctx: MutationCtx,
	template: Doc<'templates'>,
	endorsementCount: number
): Promise<void> {
	await ctx.db.patch(template._id, { endorsementCount });
	await syncTemplateListProjection(ctx, { ...template, endorsementCount });
	if (template.status === 'published' && template.isPublic) {
		await upsertCompactDiscoveryProjection(ctx, { ...template, endorsementCount });
		await markPublicDiscoveryListDirty(ctx, 'aggregate');
	}
}

/** Operator-visible progress for the one-time exact counter reconciliation. */
export const endorsementCountMigrationStatus = internalQuery({
	args: {},
	handler: async (ctx) => {
		const [manifest, missing] = await Promise.all([
			ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique(),
			ctx.db
				.query('templates')
				.withIndex('by_endorsementCount', (q) => q.eq('endorsementCount', undefined))
				.first()
		]);
		return {
			status: manifest?.endorsementCountMigrationStatus ?? ('not-started' as const),
			runToken: manifest?.endorsementCountMigrationRunToken ?? null,
			startedAt: manifest?.endorsementCountMigrationStartedAt ?? null,
			completedAt: manifest?.endorsementCountMigrationCompletedAt ?? null,
			scannedTemplates: manifest?.endorsementCountMigrationScannedTemplates ?? 0,
			repairedTemplates: manifest?.endorsementCountMigrationRepairedTemplates ?? 0,
			endorsementsCounted: manifest?.endorsementCountMigrationEndorsementsCounted ?? 0,
			failureCode: manifest?.endorsementCountMigrationFailureCode ?? null,
			failureTemplateId: manifest?.endorsementCountMigrationFailureTemplateId ?? null,
			missingCounterTemplateId: missing?._id ?? null
		};
	}
});

/**
 * Recompute every legacy counter, including already-defined values that an old
 * `undefined ?? 0` writer may have corrupted. Exactly one template and at most
 * 501 small endorsement rows are read per transaction. The 501st row blocks the
 * launch gate instead of publishing an inexact total. `resume` rotates the run
 * token while retaining the durable cursor; delayed jobs from the old chain then
 * become harmlessly superseded.
 */
export const migrateEndorsementCounts = internalMutation({
	args: {
		runToken: v.optional(v.string()),
		resume: v.optional(v.boolean()),
		restart: v.optional(v.boolean()),
		scheduleContinuation: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		if (args.runToken !== undefined && (args.resume || args.restart)) {
			throw new Error('ENDORSEMENT_COUNT_MIGRATION_INVALID_CONTINUATION');
		}
		if (args.resume && args.restart) {
			throw new Error('ENDORSEMENT_COUNT_MIGRATION_INVALID_CONTROL');
		}

		const manifest = await getPublicDiscoveryManifestRow(ctx);
		let manifestId = manifest?._id;
		let runToken: string;
		let cursor: string | undefined;
		let scannedTemplates: number;
		let repairedTemplates: number;
		let endorsementsCounted: number;

		if (args.runToken !== undefined) {
			if (
				!manifestId ||
				manifest?.endorsementCountMigrationStatus !== 'running' ||
				manifest.endorsementCountMigrationRunToken !== args.runToken
			) {
				return { status: 'superseded' as const, runToken: args.runToken };
			}
			runToken = args.runToken;
			cursor = manifest.endorsementCountMigrationCursor;
			scannedTemplates = manifest.endorsementCountMigrationScannedTemplates ?? 0;
			repairedTemplates = manifest.endorsementCountMigrationRepairedTemplates ?? 0;
			endorsementsCounted = manifest.endorsementCountMigrationEndorsementsCounted ?? 0;
		} else if (manifest?.endorsementCountMigrationStatus === 'complete' && !args.restart) {
			return {
				status: 'already-complete' as const,
				runToken: manifest.endorsementCountMigrationRunToken ?? null,
				scannedTemplates: manifest.endorsementCountMigrationScannedTemplates ?? 0,
				repairedTemplates: manifest.endorsementCountMigrationRepairedTemplates ?? 0,
				endorsementsCounted: manifest.endorsementCountMigrationEndorsementsCounted ?? 0,
				completedAt: manifest.endorsementCountMigrationCompletedAt ?? null
			};
		} else if (
			(manifest?.endorsementCountMigrationStatus === 'running' ||
				manifest?.endorsementCountMigrationStatus === 'blocked') &&
			!args.resume &&
			!args.restart
		) {
			return {
				status:
					manifest.endorsementCountMigrationStatus === 'blocked'
						? ('blocked' as const)
						: ('already-running' as const),
				runToken: manifest.endorsementCountMigrationRunToken ?? null,
				failureCode: manifest.endorsementCountMigrationFailureCode ?? null,
				failureTemplateId: manifest.endorsementCountMigrationFailureTemplateId ?? null
			};
		} else {
			const retainingProgress = args.resume === true && manifest !== null;
			runToken = crypto.randomUUID();
			cursor = retainingProgress ? manifest?.endorsementCountMigrationCursor : undefined;
			const startedAt = retainingProgress
				? (manifest?.endorsementCountMigrationStartedAt ?? Date.now())
				: Date.now();
			scannedTemplates = retainingProgress
				? (manifest?.endorsementCountMigrationScannedTemplates ?? 0)
				: 0;
			repairedTemplates = retainingProgress
				? (manifest?.endorsementCountMigrationRepairedTemplates ?? 0)
				: 0;
			endorsementsCounted = retainingProgress
				? (manifest?.endorsementCountMigrationEndorsementsCounted ?? 0)
				: 0;
			const progress = {
				endorsementCountMigrationStatus: 'running' as const,
				endorsementCountMigrationRunToken: runToken,
				endorsementCountMigrationCursor: cursor,
				endorsementCountMigrationStartedAt: startedAt,
				endorsementCountMigrationCompletedAt: undefined,
				endorsementCountMigrationScannedTemplates: scannedTemplates,
				endorsementCountMigrationRepairedTemplates: repairedTemplates,
				endorsementCountMigrationEndorsementsCounted: endorsementsCounted,
				endorsementCountMigrationFailureCode: undefined,
				endorsementCountMigrationFailureTemplateId: undefined
			};
			if (manifestId) {
				await ctx.db.patch(manifestId, progress);
			} else {
				const inserted = {
					key: 'public' as const,
					listReady: false,
					relationsReady: false,
					listRevision: 0,
					relationsRevision: 0,
					...progress
				};
				manifestId = await ctx.db.insert('publicDiscoveryManifest', inserted);
			}
		}

		if (!manifestId) throw new Error('ENDORSEMENT_COUNT_MIGRATION_STATE_MISSING');
		const page = await ctx.db
			.query('templates')
			.order('asc')
			.paginate({ cursor: cursor ?? null, numItems: 1 });
		const template = page.page[0];

		if (!template) {
			const completedAt = Date.now();
			await ctx.db.patch(manifestId, {
				endorsementCountMigrationStatus: 'complete',
				endorsementCountMigrationCursor: undefined,
				endorsementCountMigrationCompletedAt: completedAt,
				endorsementCountMigrationFailureCode: undefined,
				endorsementCountMigrationFailureTemplateId: undefined
			});
			return {
				status: 'complete' as const,
				runToken,
				scannedTemplates,
				repairedTemplates,
				endorsementsCounted,
				completedAt
			};
		}

		const exactCount = await boundedExactEndorsementCount(ctx, template._id);
		if (exactCount === null) {
			const failureCode = `ENDORSEMENT_COUNT_MIGRATION_OVERFLOW:>${LEGACY_ENDORSEMENT_COUNT_REPAIR_LIMIT}`;
			await ctx.db.patch(manifestId, {
				endorsementCountMigrationStatus: 'blocked',
				endorsementCountMigrationFailureCode: failureCode,
				endorsementCountMigrationFailureTemplateId: template._id
			});
			return {
				status: 'blocked' as const,
				runToken,
				failureCode,
				failureTemplateId: template._id
			};
		}

		const repaired =
			!isAuthoritativeEndorsementCount(template.endorsementCount) ||
			template.endorsementCount !== exactCount;
		if (repaired) {
			await ctx.db.patch(template._id, { endorsementCount: exactCount });
		}
		await syncTemplateListProjection(ctx, {
			...template,
			endorsementCount: exactCount
		});
		// Reconcile the compact source even when the stored counter was already
		// right: a pre-migration dual write may have copied the old sampled value.
		if (template.status === 'published' && template.isPublic) {
			await upsertCompactDiscoveryProjection(ctx, {
				...template,
				endorsementCount: exactCount
			});
			if (repaired) await markPublicDiscoveryListDirty(ctx, 'aggregate');
		}

		scannedTemplates += 1;
		repairedTemplates += repaired ? 1 : 0;
		endorsementsCounted += exactCount;
		const completedAt = page.isDone ? Date.now() : undefined;
		await ctx.db.patch(manifestId, {
			endorsementCountMigrationStatus: page.isDone ? 'complete' : 'running',
			endorsementCountMigrationCursor: page.isDone ? undefined : page.continueCursor,
			endorsementCountMigrationCompletedAt: completedAt,
			endorsementCountMigrationScannedTemplates: scannedTemplates,
			endorsementCountMigrationRepairedTemplates: repairedTemplates,
			endorsementCountMigrationEndorsementsCounted: endorsementsCounted,
			endorsementCountMigrationFailureCode: undefined,
			endorsementCountMigrationFailureTemplateId: undefined
		});

		if (!page.isDone && args.scheduleContinuation !== false) {
			await ctx.scheduler.runAfter(0, migrateEndorsementCountsRef, { runToken });
		}
		return {
			status: page.isDone ? ('complete' as const) : ('running' as const),
			runToken,
			continueCursor: page.isDone ? null : page.continueCursor,
			scannedTemplates,
			repairedTemplates,
			endorsementsCounted,
			completedAt: completedAt ?? null
		};
	}
});

/**
 * Endorse a template on behalf of an org. Requires editor role.
 * Upserts to handle duplicate endorsement gracefully.
 */
export const endorse = mutation({
	args: {
		orgSlug: v.string(),
		templateId: v.id('templates')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		// Verify template exists and is public
		const template = await ctx.db.get(args.templateId);
		if (!template) throw new Error('Template not found');
		if (!template.isPublic) throw new Error('Cannot endorse a private template');

		// Check if already endorsed (upsert behavior)
		const existing = await ctx.db
			.query('templateEndorsements')
			.withIndex('by_templateId_orgId', (q) =>
				q.eq('templateId', args.templateId).eq('orgId', org._id)
			)
			.first();

		if (existing) {
			if (!(await storedEndorsementCountIsTrusted(ctx, template.endorsementCount))) {
				const exactCount = await boundedExactEndorsementCount(ctx, template._id);
				if (exactCount === null) throwEndorsementCountRepairRequired(template._id);
				await persistEndorsementCount(ctx, template, exactCount);
			}
			return { id: existing._id };
		}

		const id = await ctx.db.insert('templateEndorsements', {
			templateId: args.templateId,
			orgId: org._id,
			endorsedAt: Date.now()
		});

		// Before the reconciliation is proven complete, recompute in the same
		// transaction so counters already corrupted by the old `undefined ?? 0`
		// path are repaired too. Afterwards this is the normal O(1) increment.
		const trusted = await storedEndorsementCountIsTrusted(ctx, template.endorsementCount);
		const nextCount = trusted
			? (template.endorsementCount as number) + 1
			: await boundedExactEndorsementCount(ctx, template._id);
		if (nextCount === null) throwEndorsementCountRepairRequired(template._id);
		await persistEndorsementCount(ctx, template, nextCount);

		return { id };
	}
});

/**
 * Remove an endorsement. Requires editor role.
 */
export const removeEndorsement = mutation({
	args: {
		orgSlug: v.string(),
		templateId: v.id('templates')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		const existing = await ctx.db
			.query('templateEndorsements')
			.withIndex('by_templateId_orgId', (q) =>
				q.eq('templateId', args.templateId).eq('orgId', org._id)
			)
			.first();

		const template = await ctx.db.get(args.templateId);
		if (existing) await ctx.db.delete(existing._id);

		if (template) {
			const trusted = await storedEndorsementCountIsTrusted(ctx, template.endorsementCount);
			if (existing || !trusted) {
				const nextCount = trusted
					? Math.max(0, (template.endorsementCount as number) - 1)
					: await boundedExactEndorsementCount(ctx, template._id);
				if (nextCount === null) throwEndorsementCountRepairRequired(template._id);
				await persistEndorsementCount(ctx, template, nextCount);
			}
		}

		return { ok: true };
	}
});

// =============================================================================
// Template source cache (for stream-message LLM pipeline)
// =============================================================================

/**
 * Get cached sources for a template (72h TTL checked by caller).
 */
const TEMPLATE_SOURCE_CACHE_MAX_ENTRIES = 20;
const SOURCE_CACHE_INPUT_HASH_RE = /^[a-f0-9]{64}$/;
const TEMPLATE_SOURCE_CACHE_STRUCTURE_BUDGET = {
	maxBytes: 64 * 1024,
	maxDepth: 4,
	maxNodes: 512,
	maxContainerEntries: 200
} as const;

function assertTemplateSourceCache(value: unknown): void {
	if (!Array.isArray(value) || value.length > TEMPLATE_SOURCE_CACHE_MAX_ENTRIES) {
		throw new ConvexError({ code: 'TEMPLATE_SOURCE_CACHE_INVALID_STRUCTURE' });
	}
	const budget = validateBoundedJson(value, TEMPLATE_SOURCE_CACHE_STRUCTURE_BUDGET);
	if (!budget.ok) {
		throw new ConvexError({
			code: 'TEMPLATE_SOURCE_CACHE_BUDGET_EXCEEDED',
			reason: budget.reason,
			actual: budget.actual,
			limit: budget.limit
		});
	}
}

function requireExpectedTemplateCacheUser(
	authenticatedUserId: Id<'users'>,
	expectedUserId: Id<'users'>
): void {
	if (String(authenticatedUserId) !== String(expectedUserId)) {
		throw new ConvexError({ code: 'TEMPLATE_SOURCE_CACHE_USER_MISMATCH' });
	}
}

export const getSourceCache = query({
	args: {
		_secret: v.optional(v.string()),
		userId: v.id('users'),
		templateId: v.id('templates')
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret ?? '');
		const { userId } = await requireAuth(ctx);
		requireExpectedTemplateCacheUser(userId, args.userId);
		const template = await ctx.db.get(args.templateId);
		if (!template) return null;
		if (template.userId !== userId) {
			throw new ConvexError({ code: 'TEMPLATE_SOURCE_CACHE_NOT_OWNED' });
		}
		if (template.cachedSources !== undefined) {
			assertTemplateSourceCache(template.cachedSources);
		}
		return {
			cachedSources: template.cachedSources ?? null,
			sourcesCachedAt: template.sourcesCachedAt ?? null,
			sourceCacheInputHash: template.sourceCacheInputHash ?? null
		};
	}
});

/**
 * Update cached sources on a template (lifetime-bound from stream-message).
 */
export const updateSourceCache = mutation({
	args: {
		_secret: v.optional(v.string()),
		userId: v.id('users'),
		templateId: v.id('templates'),
		cachedSources: v.any(),
		sourcesCachedAt: v.number(),
		sourceCacheInputHash: v.string()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret ?? '');
		assertTemplateSourceCache(args.cachedSources);
		if (!Number.isSafeInteger(args.sourcesCachedAt) || args.sourcesCachedAt < 0) {
			throw new ConvexError({ code: 'TEMPLATE_SOURCE_CACHE_TIMESTAMP_INVALID' });
		}
		if (!SOURCE_CACHE_INPUT_HASH_RE.test(args.sourceCacheInputHash)) {
			throw new ConvexError({ code: 'TEMPLATE_SOURCE_CACHE_INPUT_HASH_INVALID' });
		}
		const { userId } = await requireAuth(ctx);
		requireExpectedTemplateCacheUser(userId, args.userId);
		const template = await ctx.db.get(args.templateId);
		if (!template) throw new ConvexError({ code: 'TEMPLATE_SOURCE_CACHE_TEMPLATE_NOT_FOUND' });
		if (template.userId !== userId) {
			throw new ConvexError({ code: 'TEMPLATE_SOURCE_CACHE_NOT_OWNED' });
		}
		await ctx.db.patch(args.templateId, {
			cachedSources: args.cachedSources,
			sourcesCachedAt: args.sourcesCachedAt,
			sourceCacheInputHash: args.sourceCacheInputHash
		});
	}
});

const EMBEDDING_BACKFILL_BATCH_LIMIT = 100;
const EMBEDDING_MARKER_MIGRATION_BATCH_LIMIT = 4;
const EMBEDDING_MARKER_MIGRATION_MAX_BYTES = 5 * 1024 * 1024;
const EMBEDDING_MARKER_MIGRATION_STALE_MS = 15 * 60 * 1000;
const EMBEDDING_BACKFILL_LEASE_MS = 15 * 60 * 1000;

function assertEmbeddingBackfillLeaseToken(token: string): void {
	if (token.length < 16 || token.length > 100) {
		throw new ConvexError({ code: 'EMBEDDING_BACKFILL_LEASE_TOKEN_INVALID' });
	}
}

async function requireActiveEmbeddingBackfillLease(ctx: MutationCtx, token: string): Promise<void> {
	assertEmbeddingBackfillLeaseToken(token);
	const lease = await ctx.db
		.query('embeddingBackfillLeases')
		.withIndex('by_key', (q) => q.eq('key', 'topic'))
		.unique();
	if (!lease || lease.token !== token) {
		throw new ConvexError({ code: 'EMBEDDING_BACKFILL_LEASE_NOT_OWNED' });
	}
	if (lease.expiresAt <= Date.now()) {
		throw new ConvexError({ code: 'EMBEDDING_BACKFILL_LEASE_EXPIRED' });
	}
}

/**
 * Claim one distributed repair lease before the Pages route spends Gemini I/O.
 *
 * The indexed read and insert/patch share a Convex mutation, so concurrent
 * isolates serialize on the `topic` key. The lease expires if a worker is
 * evicted before its token-checked release runs.
 */
export const claimEmbeddingBackfillLease = mutation({
	args: { _secret: v.string(), token: v.string() },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		assertEmbeddingBackfillLeaseToken(args.token);
		const now = Date.now();
		const existing = await ctx.db
			.query('embeddingBackfillLeases')
			.withIndex('by_key', (q) => q.eq('key', 'topic'))
			.unique();

		if (existing && existing.expiresAt > now) {
			return { acquired: false as const, retryAt: existing.expiresAt };
		}

		const expiresAt = now + EMBEDDING_BACKFILL_LEASE_MS;
		if (existing) {
			await ctx.db.patch(existing._id, { token: args.token, expiresAt });
		} else {
			await ctx.db.insert('embeddingBackfillLeases', {
				key: 'topic',
				token: args.token,
				expiresAt
			});
		}
		return { acquired: true as const, expiresAt };
	}
});

/** Release only the lease generation owned by this request. */
export const releaseEmbeddingBackfillLease = mutation({
	args: { _secret: v.string(), token: v.string() },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		assertEmbeddingBackfillLeaseToken(args.token);
		const existing = await ctx.db
			.query('embeddingBackfillLeases')
			.withIndex('by_key', (q) => q.eq('key', 'topic'))
			.unique();
		if (!existing || existing.token !== args.token) {
			return { released: false as const };
		}
		await ctx.db.delete(existing._id);
		return { released: true as const };
	}
});

function embeddingBackfillLimit(limit: number | undefined): number {
	if (limit === undefined) return EMBEDDING_BACKFILL_BATCH_LIMIT;
	return Math.max(1, Math.min(EMBEDDING_BACKFILL_BATCH_LIMIT, Math.floor(limit)));
}

async function listMissingEmbeddingsImpl(ctx: QueryCtx, requestedLimit?: number) {
	const templates = await ctx.db
		.query('templates')
		.withIndex('by_status_isPublic_topicEmbeddingsUpdatedAt', (q) =>
			q.eq('status', 'published').eq('isPublic', true).eq('topicEmbeddingsUpdatedAt', undefined)
		)
		.order('desc')
		.take(embeddingBackfillLimit(requestedLimit));

	return templates.map((t) => ({
		_id: t._id,
		title: t.title,
		description: t.description ?? null,
		domain: resolveDomain(t),
		messageBody: t.messageBody
	}));
}

/** Server-only bounded batch used by the authenticated SvelteKit admin route. */
export const listMissingEmbeddings = query({
	args: { _secret: v.string(), limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		return await listMissingEmbeddingsImpl(ctx, args.limit);
	}
});

export function topicEmbeddingMarkerSplitRequiredResult(progress: {
	startedAt: number;
	scanned: number;
	marked: number;
}) {
	return {
		status: 'blocked' as const,
		failureCode: 'TOPIC_EMBEDDING_MARKER_MIGRATION_PAGE_SPLIT_REQUIRED' as const,
		pageScanned: 0,
		pageMarked: 0,
		scanned: progress.scanned,
		marked: progress.marked,
		isDone: false as const,
		startedAt: progress.startedAt,
		completedAt: null
	};
}

/**
 * One-time bounded migration for rows created before the topic-specific marker.
 * It never calls Gemini: already-valid vectors inherit their existing update
 * timestamp, while genuinely missing/wrong-dimension rows remain in the exact
 * repair index. Each transaction scans at most four stable creation-order rows
 * and schedules the next page, avoiding one oversized migration transaction.
 * Progress lives on the public-discovery singleton so operators can prove every
 * scheduled page finished. A top-level invocation restarts a run whose first
 * page is older than 15 minutes; the new start token supersedes any delayed old
 * continuation. Once complete, an accidental rerun is a no-op.
 */
export const migrateTopicEmbeddingMarkers = internalMutation({
	args: {
		cursor: v.optional(v.string()),
		startedAt: v.optional(v.number()),
		scanned: v.optional(v.number()),
		marked: v.optional(v.number()),
		restart: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const isContinuation = args.startedAt !== undefined;
		if (
			!isContinuation &&
			(args.cursor !== undefined || args.scanned !== undefined || args.marked !== undefined)
		) {
			throw new Error('TOPIC_EMBEDDING_MARKER_MIGRATION_INVALID_CONTINUATION');
		}

		const manifest = await getPublicDiscoveryManifestRow(ctx);
		if (!isContinuation && !args.restart) {
			if (manifest?.topicEmbeddingMarkerMigrationCompletedAt !== undefined) {
				return {
					status: 'already-complete' as const,
					scanned: manifest.topicEmbeddingMarkerMigrationScanned ?? 0,
					marked: manifest.topicEmbeddingMarkerMigrationMarked ?? 0,
					isDone: true,
					startedAt: manifest.topicEmbeddingMarkerMigrationStartedAt ?? null,
					completedAt: manifest.topicEmbeddingMarkerMigrationCompletedAt
				};
			}
			if (manifest?.topicEmbeddingMarkerMigrationFailureCode !== undefined) {
				return {
					status: 'blocked' as const,
					failureCode: manifest.topicEmbeddingMarkerMigrationFailureCode,
					scanned: manifest.topicEmbeddingMarkerMigrationScanned ?? 0,
					marked: manifest.topicEmbeddingMarkerMigrationMarked ?? 0,
					isDone: false,
					startedAt: manifest.topicEmbeddingMarkerMigrationStartedAt ?? null,
					completedAt: null
				};
			}
			if (manifest?.topicEmbeddingMarkerMigrationStartedAt !== undefined) {
				const stale =
					Date.now() - manifest.topicEmbeddingMarkerMigrationStartedAt >=
					EMBEDDING_MARKER_MIGRATION_STALE_MS;
				if (!stale) {
					return {
						status: 'already-running' as const,
						scanned: manifest.topicEmbeddingMarkerMigrationScanned ?? 0,
						marked: manifest.topicEmbeddingMarkerMigrationMarked ?? 0,
						isDone: false,
						startedAt: manifest.topicEmbeddingMarkerMigrationStartedAt,
						completedAt: null
					};
				}
			}
		}

		const startedAt = args.startedAt ?? Date.now();
		let manifestId = manifest?._id;
		if (!isContinuation) {
			const progress = {
				topicEmbeddingMarkerMigrationStartedAt: startedAt,
				topicEmbeddingMarkerMigrationCompletedAt: undefined,
				topicEmbeddingMarkerMigrationScanned: 0,
				topicEmbeddingMarkerMigrationMarked: 0,
				topicEmbeddingMarkerMigrationFailureCode: undefined
			};
			if (manifestId) {
				await ctx.db.patch(manifestId, progress);
			} else {
				const inserted = {
					key: 'public' as const,
					listReady: false,
					relationsReady: false,
					listRevision: 0,
					relationsRevision: 0,
					...progress
				};
				manifestId = await ctx.db.insert('publicDiscoveryManifest', inserted);
			}
		} else if (
			!manifestId ||
			manifest?.topicEmbeddingMarkerMigrationStartedAt !== startedAt ||
			manifest.topicEmbeddingMarkerMigrationCompletedAt !== undefined ||
			manifest.topicEmbeddingMarkerMigrationFailureCode !== undefined
		) {
			return {
				status: 'superseded' as const,
				scanned: args.scanned ?? 0,
				marked: args.marked ?? 0,
				isDone: false,
				startedAt,
				completedAt: null
			};
		}

		const page = await ctx.db
			.query('templates')
			.order('asc')
			.paginate({
				cursor: args.cursor ?? null,
				numItems: EMBEDDING_MARKER_MIGRATION_BATCH_LIMIT,
				maximumRowsRead: EMBEDDING_MARKER_MIGRATION_BATCH_LIMIT + 1,
				maximumBytesRead: EMBEDDING_MARKER_MIGRATION_MAX_BYTES
			});
		if (page.pageStatus === 'SplitRequired') {
			const failureCode = 'TOPIC_EMBEDDING_MARKER_MIGRATION_PAGE_SPLIT_REQUIRED';
			await ctx.db.patch(manifestId, {
				topicEmbeddingMarkerMigrationFailureCode: failureCode
			});
			return topicEmbeddingMarkerSplitRequiredResult({
				startedAt,
				scanned: args.scanned ?? 0,
				marked: args.marked ?? 0
			});
		}
		let pageMarked = 0;
		for (const template of page.page) {
			if (
				template.topicEmbeddingsUpdatedAt === undefined &&
				isFiniteEmbeddingVector(template.topicEmbedding)
			) {
				await ctx.db.patch(template._id, {
					topicEmbeddingsUpdatedAt: template.embeddingsUpdatedAt ?? template.updatedAt
				});
				pageMarked += 1;
			}
		}

		const scanned = (args.scanned ?? 0) + page.page.length;
		const marked = (args.marked ?? 0) + pageMarked;
		const completedAt = page.isDone ? Date.now() : undefined;
		await ctx.db.patch(manifestId, {
			topicEmbeddingMarkerMigrationScanned: scanned,
			topicEmbeddingMarkerMigrationMarked: marked,
			topicEmbeddingMarkerMigrationCompletedAt: completedAt,
			topicEmbeddingMarkerMigrationFailureCode: undefined
		});

		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, migrateTopicEmbeddingMarkersRef, {
				cursor: page.continueCursor,
				startedAt,
				scanned,
				marked
			});
		}

		return {
			status: page.isDone ? ('complete' as const) : ('running' as const),
			pageScanned: page.page.length,
			pageMarked,
			scanned,
			marked,
			isDone: page.isDone,
			startedAt,
			completedAt: completedAt ?? null,
			...(page.isDone ? {} : { continueCursor: page.continueCursor })
		};
	}
});

/** Observable completion proof for the one-time marker-migration cutover. */
export const topicEmbeddingMarkerMigrationStatus = internalQuery({
	args: {},
	handler: async (ctx) => {
		const manifest = await ctx.db
			.query('publicDiscoveryManifest')
			.withIndex('by_key', (q) => q.eq('key', 'public'))
			.unique();
		const startedAt = manifest?.topicEmbeddingMarkerMigrationStartedAt ?? null;
		const completedAt = manifest?.topicEmbeddingMarkerMigrationCompletedAt ?? null;
		const failureCode = manifest?.topicEmbeddingMarkerMigrationFailureCode ?? null;
		return {
			status:
				completedAt !== null
					? 'complete'
					: failureCode !== null
						? 'blocked'
						: startedAt !== null
							? 'running'
							: 'not-started',
			startedAt,
			completedAt,
			failureCode,
			scanned: manifest?.topicEmbeddingMarkerMigrationScanned ?? 0,
			marked: manifest?.topicEmbeddingMarkerMigrationMarked ?? 0
		};
	}
});

type TemplateEmbeddingWrite = {
	locationEmbedding: number[];
	topicEmbedding: number[];
	domainHue?: number;
};

function isFiniteEmbeddingVector(value: unknown): value is number[] {
	return (
		Array.isArray(value) &&
		value.length === 768 &&
		value.every((component) => typeof component === 'number' && Number.isFinite(component))
	);
}

function assertEmbeddingDimensions(args: TemplateEmbeddingWrite): void {
	if (args.locationEmbedding.length !== 768 || args.topicEmbedding.length !== 768) {
		throw new Error('INVALID_EMBEDDING_DIMENSION:expected=768');
	}
	if (
		!isFiniteEmbeddingVector(args.locationEmbedding) ||
		!isFiniteEmbeddingVector(args.topicEmbedding)
	) {
		throw new Error('INVALID_EMBEDDING_VALUE:finite-numbers-required');
	}
	if (
		args.domainHue !== undefined &&
		(!Number.isFinite(args.domainHue) || args.domainHue < 0 || args.domainHue >= 360)
	) {
		throw new Error('INVALID_DOMAIN_HUE:expected=0..<360');
	}
}

async function patchTemplateEmbeddingValues(
	ctx: MutationCtx,
	template: Doc<'templates'>,
	args: TemplateEmbeddingWrite,
	embeddingVersion: string
): Promise<void> {
	const embeddingsUpdatedAt = Date.now();
	const embeddingPatch = {
		locationEmbedding: args.locationEmbedding,
		topicEmbedding: args.topicEmbedding,
		embeddingVersion,
		embeddingsUpdatedAt,
		topicEmbeddingsUpdatedAt: embeddingsUpdatedAt,
		...(args.domainHue !== undefined ? { domainHue: args.domainHue } : {})
	};
	await ctx.db.patch(template._id, embeddingPatch);
	await syncTemplateListProjection(ctx, { ...template, ...embeddingPatch });

	if (template.status !== 'published' || !template.isPublic) return;
	await upsertCompactDiscoverySource(ctx, { ...template, ...embeddingPatch });

	// Topic vectors always affect twins. Domain hue affects the list card, but
	// the vectors and repair markers themselves never enter the public list row.
	const listChanged = args.domainHue !== undefined && args.domainHue !== template.domainHue;
	if (listChanged) {
		await markPublicDiscoveryListAndRelationsDirty(ctx, 'aggregate');
	} else {
		await markPublicDiscoveryRelationsDirty(ctx);
	}
}

/**
 * Complete the one missing embedding write started by an authenticated template
 * creation request. The caller captures `expectedUserId` before entering its
 * post-response continuation, so this bridge does not depend on request-local
 * Convex auth surviving a `waitUntil`/provider await. The server secret protects
 * the bridge, the expected owner prevents cross-request mixups, and missing-only
 * semantics prevent it from becoming an embedding-overwrite capability.
 *
 * The original creation dirties both snapshot families. Completion always
 * dirties relations and also dirties the list when domain hue changes, reusing
 * the existing coalesced tokens; no first-embedding path can bypass the
 * six-hour relation cost ceiling.
 */
export const completePublicTemplateEmbeddings = mutation({
	args: {
		templateId: v.id('templates'),
		expectedUserId: v.id('users'),
		locationEmbedding: v.array(v.float64()),
		topicEmbedding: v.array(v.float64()),
		domainHue: v.optional(v.float64()),
		_secret: v.string()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		assertEmbeddingDimensions(args);
		const template = await ctx.db.get(args.templateId);
		if (!template) throw new Error('Template not found');
		if (template.userId !== args.expectedUserId) {
			throw new Error('EMBEDDING_COMPLETION_OWNER_MISMATCH');
		}
		if (template.status !== 'published' || !template.isPublic) {
			throw new Error('EMBEDDING_COMPLETION_PUBLIC_TEMPLATE_REQUIRED');
		}
		if (
			template.topicEmbeddingsUpdatedAt !== undefined ||
			isFiniteEmbeddingVector(template.topicEmbedding)
		) {
			throw new Error('TOPIC_EMBEDDINGS_ALREADY_PRESENT');
		}

		await patchTemplateEmbeddingValues(ctx, template, args, 'v1');
		return { updated: true };
	}
});

/**
 * Narrow secret-gated bridge for the SvelteKit repair batch.
 *
 * This path deliberately has no end-user ownership context. It can only fill a
 * row still selected by the missing-topic marker and only while the caller owns
 * the unexpired distributed lease; it cannot overwrite an existing embedding.
 * The batch publishes once through `rebuildHomepageSnapshotsAfterBackfill`.
 */
export const updateMissingEmbeddingsForBackfill = mutation({
	args: {
		templateId: v.id('templates'),
		locationEmbedding: v.array(v.float64()),
		topicEmbedding: v.array(v.float64()),
		domainHue: v.optional(v.float64()),
		_secret: v.string(),
		leaseToken: v.string()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		await requireActiveEmbeddingBackfillLease(ctx, args.leaseToken);
		assertEmbeddingDimensions(args);
		const template = await ctx.db.get(args.templateId);
		if (!template) throw new Error('Template not found');
		if (template.status !== 'published' || !template.isPublic) {
			throw new Error('EMBEDDING_BACKFILL_PUBLIC_TEMPLATE_REQUIRED');
		}
		if (
			template.topicEmbeddingsUpdatedAt !== undefined ||
			isFiniteEmbeddingVector(template.topicEmbedding)
		) {
			throw new Error('TOPIC_EMBEDDINGS_ALREADY_PRESENT');
		}

		await patchTemplateEmbeddingValues(ctx, template, args, 'gemini-001-768');
		return { updated: true };
	}
});

/** Publish exactly once after a server-side embedding repair batch. */
export const rebuildHomepageSnapshotsAfterBackfill = mutation({
	args: { _secret: v.string(), leaseToken: v.string() },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		await requireActiveEmbeddingBackfillLease(ctx, args.leaseToken);
		return await rebuildHomepageSnapshotsImpl(ctx);
	}
});

/**
 * Find template by content hash (dedup check).
 */
export const findByContentHash = query({
	args: { userId: v.string(), contentHash: v.string() },
	handler: async (ctx, { userId, contentHash }) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (String(authUserId) !== userId) {
			throw new ConvexError({ code: 'TEMPLATE_CONTENT_HASH_USER_MISMATCH' });
		}
		const template = await ctx.db
			.query('templates')
			.withIndex('by_userId_contentHash', (q) =>
				q.eq('userId', authUserId).eq('contentHash', contentHash)
			)
			.unique();
		if (!template) return null;
		return {
			_id: template._id,
			_creationTime: template._creationTime,
			slug: template.slug,
			title: template.title,
			description: template.description,
			domain: template.domain,
			category: template.category,
			topics: template.topics,
			type: template.type,
			deliveryMethod: template.deliveryMethod,
			messageBody: template.messageBody,
			sources: template.sources,
			researchLog: template.researchLog,
			preview: template.preview,
			verifiedSends: template.verifiedSends,
			uniqueDistricts: template.uniqueDistricts,
			deliveryConfig: template.deliveryConfig,
			cwcConfig: template.cwcConfig,
			recipientConfig: template.recipientConfig,
			campaignId: template.campaignId,
			status: template.status,
			isPublic: template.isPublic,
			updatedAt: template.updatedAt
		};
	}
});

const MAX_ORG_TEMPLATE_AUTHORING_ALLOWANCE = 1_000;

type TemplateAuthoringReadCtx = Pick<QueryCtx | MutationCtx, 'db'>;

type TemplateAuthoringAllowance =
	| { ok: true; orgId?: Id<'organizations'> }
	| { ok: false; code: 'TEMPLATE_QUOTA_EXCEEDED' }
	| { ok: false; code: typeof AUTHORING_QUOTA_EXCEEDED; message: string };

/**
 * Resolve the current authoring allowance with bounded indexed reads.
 *
 * Both the cost-saving HTTP preflight and the authoritative create mutation
 * call this helper. The preflight avoids provider work for known denials; the
 * mutation repeats the decision in the write transaction so concurrent creates
 * cannot oversubscribe the allowance.
 */
async function evaluateTemplateAuthoringAllowance(
	ctx: TemplateAuthoringReadCtx,
	userId: Id<'users'>,
	now: number
): Promise<TemplateAuthoringAllowance> {
	// The quota counts the list projection plane: one embedding-free row per
	// template, so the month-to-date read stays cheap on a hot mutation.
	// createTemplate inserts the canonical row and its projection in the same
	// transaction, so Convex OCC still serializes concurrent creates against a
	// single allowance.
	const monthStart = startOfMonthUTC(now);
	const membership = await ctx.db
		.query('orgMemberships')
		.withIndex('by_userId_orgId', (q) => q.eq('userId', userId))
		.first();

	if (membership) {
		const org = await ctx.db.get(membership.orgId);
		if (!org) throw new Error('TEMPLATE_AUTHORING_ORG_REPAIR_REQUIRED');

		const limit = org.maxTemplatesMonth;
		if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_ORG_TEMPLATE_AUTHORING_ALLOWANCE) {
			throw new Error('TEMPLATE_AUTHORING_ORG_LIMIT_REPAIR_REQUIRED');
		}
		if (limit === 0) return { ok: false, code: 'TEMPLATE_QUOTA_EXCEEDED' };

		const monthToDate = await ctx.db
			.query('templateListProjections')
			.withIndex('by_orgId', (q) =>
				q.eq('orgId', membership.orgId).gte('templateCreatedAt', monthStart)
			)
			.take(limit);
		if (monthToDate.length >= limit) {
			return { ok: false, code: 'TEMPLATE_QUOTA_EXCEEDED' };
		}
		return { ok: true, orgId: membership.orgId };
	}

	const subscriptionRows = await ctx.db
		.query('subscriptions')
		.withIndex('by_userId', (q) => q.eq('userId', userId))
		.take(2);
	if (subscriptionRows.length > 1) {
		throw new Error('SUBSCRIPTION_CARDINALITY_REPAIR_REQUIRED');
	}
	const subscription = subscriptionRows[0] ?? null;
	const effectivelyActive =
		subscription?.status === 'active' ||
		subscription?.status === 'trialing' ||
		(subscription?.status === 'past_due' && subscription.pastDueSince !== undefined);
	const limit = effectivelyActive
		? authoredLimitForPlan(subscription?.plan)
		: authoredLimitForPlan(null);
	const monthToDate = await ctx.db
		.query('templateListProjections')
		.withIndex('by_userId', (q) => q.eq('userId', userId).gte('templateCreatedAt', monthStart))
		.take(limit);
	const decision = decideIndividualAuthoring(monthToDate.length, now, limit);
	return decision.ok
		? { ok: true }
		: { ok: false, code: AUTHORING_QUOTA_EXCEEDED, message: decision.message };
}

function templateAuthoringResponse(template: Doc<'templates'>, deduplicated: boolean) {
	return {
		_id: template._id,
		_creationTime: template._creationTime,
		slug: template.slug,
		title: template.title,
		description: template.description,
		domain: template.domain,
		category: template.category,
		topics: template.topics,
		type: template.type,
		deliveryMethod: template.deliveryMethod,
		messageBody: template.messageBody,
		sources: template.sources,
		researchLog: template.researchLog,
		preview: template.preview,
		verifiedSends: template.verifiedSends,
		uniqueDistricts: template.uniqueDistricts,
		endorsementCount: template.endorsementCount,
		deliveryConfig: template.deliveryConfig,
		cwcConfig: template.cwcConfig,
		recipientConfig: template.recipientConfig,
		campaignId: template.campaignId,
		status: template.status,
		isPublic: template.isPublic,
		scopes: template.scopes,
		updatedAt: template.updatedAt,
		deduplicated
	};
}

const TEMPLATE_AUTHORING_LEASE_MS = 10 * 60 * 1000;

function assertTemplateAuthoringLeaseToken(token: string): void {
	if (token.length < 16 || token.length > 100 || !/^[A-Za-z0-9-]+$/.test(token)) {
		throw new ConvexError({ code: 'TEMPLATE_AUTHORING_LEASE_TOKEN_INVALID' });
	}
}

function assertTemplateAuthoringLeaseCoordinate(contentHash: string, slug: string): void {
	if (contentHash.length < 1 || contentHash.length > 128) {
		throw new ConvexError({ code: 'TEMPLATE_AUTHORING_CONTENT_HASH_INVALID' });
	}
	if (!isCanonicalTemplateSlug(slug)) {
		throw new ConvexError({ code: 'TEMPLATE_AUTHORING_SLUG_INVALID' });
	}
}

async function requireActiveTemplateAuthoringLease(
	ctx: MutationCtx,
	input: { userId: Id<'users'>; contentHash: string; slug: string; token: string }
) {
	assertTemplateAuthoringLeaseToken(input.token);
	assertTemplateAuthoringLeaseCoordinate(input.contentHash, input.slug);
	const lease = await ctx.db
		.query('templateAuthoringLeases')
		.withIndex('by_userId_contentHash', (q) =>
			q.eq('userId', input.userId).eq('contentHash', input.contentHash)
		)
		.unique();
	if (!lease || lease.token !== input.token || lease.slug !== input.slug) {
		throw new ConvexError({ code: 'TEMPLATE_AUTHORING_LEASE_NOT_OWNED' });
	}
	if (lease.expiresAt <= Date.now()) {
		throw new ConvexError({ code: 'TEMPLATE_AUTHORING_LEASE_EXPIRED' });
	}
	return lease;
}

/**
 * Atomically claim provider work for one user/content and one global slug.
 * Convex OCC serializes both indexed reads, preventing duplicate moderation
 * when concurrent isolates pass the cheaper query preflight together.
 */
export const claimTemplateAuthoringLease = mutation({
	args: {
		_secret: v.string(),
		userId: v.id('users'),
		contentHash: v.string(),
		slug: v.string(),
		token: v.string()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const { userId: authUserId } = await requireAuth(ctx);
		if (authUserId !== args.userId) {
			throw new ConvexError({ code: 'TEMPLATE_AUTHORING_LEASE_USER_MISMATCH' });
		}
		assertTemplateAuthoringLeaseToken(args.token);
		assertTemplateAuthoringLeaseCoordinate(args.contentHash, args.slug);

		const existingContent = await ctx.db
			.query('templates')
			.withIndex('by_userId_contentHash', (q) =>
				q.eq('userId', authUserId).eq('contentHash', args.contentHash)
			)
			.unique();
		if (existingContent) {
			return {
				outcome: 'duplicate' as const,
				template: templateAuthoringResponse(existingContent, true)
			};
		}

		const existingSlug = await ctx.db
			.query('templates')
			.withIndex('by_slug', (q) => q.eq('slug', args.slug))
			.first();
		if (existingSlug) return { outcome: 'slug_taken' as const };

		const now = Date.now();
		const contentLease = await ctx.db
			.query('templateAuthoringLeases')
			.withIndex('by_userId_contentHash', (q) =>
				q.eq('userId', authUserId).eq('contentHash', args.contentHash)
			)
			.unique();
		const slugLeases = await ctx.db
			.query('templateAuthoringLeases')
			.withIndex('by_slug', (q) => q.eq('slug', args.slug))
			.take(2);
		if (slugLeases.length > 1) {
			throw new ConvexError({ code: 'TEMPLATE_AUTHORING_LEASE_CARDINALITY_INVALID' });
		}
		const slugLease = slugLeases[0] ?? null;
		const activeLease = [contentLease, slugLease].find(
			(lease) => lease !== null && lease.expiresAt > now
		);
		if (activeLease) {
			return { outcome: 'in_progress' as const, retryAt: activeLease.expiresAt };
		}

		const allowance = await evaluateTemplateAuthoringAllowance(ctx, authUserId, now);
		if (!allowance.ok) {
			return {
				outcome: 'quota_exceeded' as const,
				code: allowance.code,
				...('message' in allowance ? { message: allowance.message } : {})
			};
		}

		const staleIds = new Set(
			[contentLease, slugLease].flatMap((lease) =>
				lease && lease.expiresAt <= now ? [String(lease._id)] : []
			)
		);
		for (const staleId of staleIds) {
			const staleLeaseId: Id<'templateAuthoringLeases'> = staleId as Id<'templateAuthoringLeases'>;
			await ctx.db.delete(staleLeaseId);
		}
		const expiresAt = now + TEMPLATE_AUTHORING_LEASE_MS;
		await ctx.db.insert('templateAuthoringLeases', {
			userId: authUserId,
			contentHash: args.contentHash,
			slug: args.slug,
			token: args.token,
			expiresAt
		});
		return { outcome: 'claimed' as const, expiresAt };
	}
});

/** Release only the exact template-authoring provider lease generation. */
export const releaseTemplateAuthoringLease = mutation({
	args: {
		_secret: v.string(),
		userId: v.id('users'),
		contentHash: v.string(),
		token: v.string()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const { userId: authUserId } = await requireAuth(ctx);
		if (authUserId !== args.userId) {
			throw new ConvexError({ code: 'TEMPLATE_AUTHORING_LEASE_USER_MISMATCH' });
		}
		assertTemplateAuthoringLeaseToken(args.token);
		const lease = await ctx.db
			.query('templateAuthoringLeases')
			.withIndex('by_userId_contentHash', (q) =>
				q.eq('userId', authUserId).eq('contentHash', args.contentHash)
			)
			.unique();
		if (!lease || lease.token !== args.token) return { released: false as const };
		await ctx.db.delete(lease._id);
		return { released: true as const };
	}
});

/**
 * Get user's org membership (for quota check).
 */
export const getUserOrgId = internalQuery({
	args: { userId: v.id('users') },
	handler: async (ctx, { userId }) => {
		const membership = await ctx.db
			.query('orgMemberships')
			.withIndex('by_userId_orgId', (q) => q.eq('userId', userId))
			.first();
		return membership ? { orgId: membership.orgId } : null;
	}
});

/**
 * Create a template (with quota check and geographic scope).
 */
export const createTemplate = mutation({
	args: {
		_secret: v.string(),
		userId: v.id('users'),
		title: v.string(),
		slug: v.string(),
		description: v.string(),
		messageBody: v.string(),
		preview: v.string(),
		type: v.string(),
		// Left as a string on purpose: the handler checks the value against the
		// shared vocabulary so callers get the named INVALID_DELIVERY_METHOD code
		// instead of an opaque Convex ArgumentValidationError.
		deliveryMethod: v.string(),
		domain: v.string(),
		topics: v.array(v.string()),
		sources: v.optional(v.any()),
		researchLog: v.optional(v.any()),
		contentHash: v.string(),
		authoringLeaseToken: v.optional(v.string()),
		status: v.string(),
		isPublic: v.boolean(),
		deliveryConfig: v.optional(v.any()),
		cwcConfig: v.optional(v.any()),
		recipientConfig: v.optional(v.any()),
		consensusApproved: v.boolean(),
		geographicScope: v.optional(templateGeographicScopeValidator),
		domainHue: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		// Moderation, publication state, and public visibility are derived by the
		// SvelteKit server. Convex functions are internet-callable, so require the
		// server credential before trusting any of those fields.
		requireInternalSecret(args._secret);
		// Also force-match the authenticated identity. The credential closes the
		// server-derived moderation/publication boundary; this identity check keeps
		// a server request from accidentally attributing content to another user.
		const { userId: authUserId } = await requireAuth(ctx);
		if (String(authUserId) !== String(args.userId)) {
			throw new Error('Authenticated user does not match args.userId');
		}
		const ALLOWED_TEMPLATE_STATUSES = ['draft', 'published', 'archived', 'pending'] as const;
		if (
			!ALLOWED_TEMPLATE_STATUSES.includes(args.status as (typeof ALLOWED_TEMPLATE_STATUSES)[number])
		) {
			throw new Error('INVALID_TEMPLATE_STATUS');
		}
		if (!isTemplateDeliveryMethod(args.deliveryMethod)) {
			throw new Error('INVALID_DELIVERY_METHOD');
		}

		// Mirror the HTTP boundary before any quota reads or source write. The
		// internal secret is a trust boundary, not permission to store a document
		// large enough to exhaust the bounded homepage materializer.
		const inputBudget = validateTemplateInputBudgets(
			{
				title: args.title,
				slug: args.slug,
				description: args.description,
				messageBody: args.messageBody,
				preview: args.preview,
				type: args.type,
				deliveryMethod: args.deliveryMethod,
				domain: args.domain,
				topics: args.topics,
				sources: args.sources,
				researchLog: args.researchLog,
				deliveryConfig: args.deliveryConfig,
				cwcConfig: args.cwcConfig,
				recipientConfig: args.recipientConfig,
				geographicScope: args.geographicScope,
				contentHash: args.contentHash,
				status: args.status,
				isPublic: args.isPublic
			},
			{ includePublicInput: args.status === 'published' && args.isPublic }
		);
		if (!inputBudget.ok) {
			throw new Error(`TEMPLATE_INPUT_BUDGET_EXCEEDED:${inputBudget.scope}:${inputBudget.reason}`);
		}

		const authoringLease = args.authoringLeaseToken
			? await requireActiveTemplateAuthoringLease(ctx, {
					userId: authUserId,
					contentHash: args.contentHash,
					slug: args.slug,
					token: args.authoringLeaseToken
				})
			: null;
		const authoringLeaseId: Id<'templateAuthoringLeases'> | null = authoringLease?._id ?? null;

		// Content dedupe is authoritative here as well as in the provider-saving
		// preflight. Convex OCC retries a concurrent loser against the winner's
		// indexed row, so only one same-content template can be inserted.
		const existingContent = await ctx.db
			.query('templates')
			.withIndex('by_userId_contentHash', (q) =>
				q.eq('userId', authUserId).eq('contentHash', args.contentHash)
			)
			.unique();
		if (existingContent) {
			if (authoringLeaseId) await ctx.db.delete(authoringLeaseId);
			return templateAuthoringResponse(existingContent, true);
		}

		// Fail duplicate links before the more expensive plan/quota reads. This
		// indexed range read remains authoritative: Convex OCC serializes a
		// concurrent same-slug insert and retries the loser against the new row.
		const existingSlug = await ctx.db
			.query('templates')
			.withIndex('by_slug', (q) => q.eq('slug', args.slug))
			.first();
		if (existingSlug) throw new ConvexError({ code: 'TEMPLATE_SLUG_TAKEN' });

		const allowance = await evaluateTemplateAuthoringAllowance(ctx, args.userId, Date.now());
		if (!allowance.ok) {
			if (allowance.code === 'TEMPLATE_QUOTA_EXCEEDED') {
				throw new Error('TEMPLATE_QUOTA_EXCEEDED');
			}
			throw new Error(`${AUTHORING_QUOTA_EXCEEDED}:${allowance.message}`);
		}

		const templateId = await ctx.db.insert('templates', {
			userId: args.userId,
			orgId: allowance.orgId,
			title: args.title,
			slug: args.slug,
			description: args.description,
			messageBody: args.messageBody,
			preview: args.preview,
			type: args.type,
			deliveryMethod: args.deliveryMethod,
			domain: args.domain,
			topics: args.topics,
			sources: args.sources ?? [],
			researchLog: args.researchLog ?? [],
			contentHash: args.contentHash,
			status: args.status,
			isPublic: args.isPublic,
			deliveryConfig: args.deliveryConfig ?? {},
			cwcConfig: args.cwcConfig ?? {},
			recipientConfig: args.recipientConfig ?? {},
			verificationStatus: args.consensusApproved ? 'approved' : 'pending',
			countryCode: 'US',
			reputationApplied: false,
			consensusApproved: args.consensusApproved,
			verifiedSends: 0,
			uniqueDistricts: 0,
			endorsementCount: 0,
			embeddingVersion: 'gemini-001',
			flaggedByModeration: !args.consensusApproved,
			reputationDelta: 0.0,
			updatedAt: Date.now()
		});

		// Create geographic scope if provided
		if (args.geographicScope && args.geographicScope.type !== 'international') {
			const geo = args.geographicScope;
			let countryCode = 'US';
			let regionCode: string | null = null;
			let localityCode: string | null = null;
			let scopeLevel = 'country';
			let displayText = 'Nationwide';

			if (geo.type === 'nationwide') {
				countryCode = geo.country;
				displayText = geo.country;
			} else if (geo.type === 'subnational') {
				countryCode = geo.country;
				if (geo.subdivision) {
					regionCode = geo.subdivision;
					scopeLevel = 'region';
					displayText = geo.subdivision;
				}
				if (geo.locality) {
					localityCode = geo.locality;
					scopeLevel = 'locality';
					displayText = geo.locality + (geo.subdivision ? `, ${geo.subdivision}` : '');
				}
			}

			await ctx.db.patch(templateId, {
				scopes: [
					{
						countryCode,
						...(regionCode ? { regionCode } : {}),
						...(localityCode ? { localityCode } : {}),
						displayText,
						scopeLevel,
						confidence: 1.0,
						extractionMethod: 'gemini_inline'
					}
				]
			});
		}

		// Do not make public discovery publication depend on the external embedding
		// call. A new row can enter/evict the relation graph's bounded top-50 even
		// before it has vectors, so Gemini failure must still refresh both families.
		// A successful embedding patch below reuses the relation dirty token (and
		// the list token when domain hue changes); it never starts a direct rebuild.
		const template = await ctx.db.get(templateId);
		if (!template) throw new Error(`TEMPLATE_LIST_PROJECTION_CREATE_MISSING:${templateId}`);
		await syncTemplateListProjection(ctx, template);
		if (args.status === 'published' && args.isPublic) {
			await upsertCompactDiscoverySource(ctx, template);
			await markPublicDiscoveryListAndRelationsDirty(ctx, 'authored');
		}
		if (authoringLeaseId) await ctx.db.delete(authoringLeaseId);
		return templateAuthoringResponse(template, false);
	}
});

/** Delete a template by ID (internal only). */
export const deleteTemplate = internalMutation({
	args: { templateId: v.id('templates') },
	handler: async (ctx, { templateId }) => {
		const template = await ctx.db.get(templateId);
		await deleteCompactDiscoveryRows(ctx, templateId);
		await deleteTemplateListProjection(ctx, templateId);
		await ctx.db.delete(templateId);
		if (template?.status === 'published' && template.isPublic) {
			await invalidatePublicDiscoveryAfterDestructiveSourceChange(ctx, {
				list: true,
				relations: true
			});
		}
	}
});

/**
 * Patch domain + topics on an existing template (dedupe metadata refresh).
 * Called when content-hash matches an existing document but metadata has changed.
 */
export const patchMetadata = mutation({
	args: {
		templateId: v.id('templates'),
		domain: v.optional(v.string()),
		topics: v.optional(v.array(v.string()))
	},
	handler: async (ctx, args) => {
		const { userId } = await requireAuth(ctx);
		const template = await ctx.db.get(args.templateId);
		if (!template) throw new Error('Template not found');
		if (template.userId !== userId) throw new Error('Unauthorized');

		// Validate exactly the fields this mutation can change. Historical rows may
		// predate today's config budgets; unchanged legacy config remains
		// grandfathered instead of blocking an otherwise bounded metadata repair.
		const inputBudget = validateTemplateMetadataBudgets({
			domain: args.domain,
			topics: args.topics
		});
		if (!inputBudget.ok) {
			throw new Error(`TEMPLATE_INPUT_BUDGET_EXCEEDED:${inputBudget.scope}:${inputBudget.reason}`);
		}

		const metadataPatch = {
			updatedAt: Date.now(),
			...(args.domain !== undefined ? { domain: args.domain } : {}),
			...(args.topics !== undefined ? { topics: args.topics } : {}),
			// Research inputs changed. Removing all three fields prevents an old
			// source array from surviving as an apparently current cache entry.
			cachedSources: undefined,
			sourcesCachedAt: undefined,
			sourceCacheInputHash: undefined
		};
		await ctx.db.patch(args.templateId, metadataPatch);
		await syncTemplateListProjection(ctx, { ...template, ...metadataPatch });
		if (template.status === 'published' && template.isPublic) {
			await upsertCompactDiscoveryProjection(ctx, { ...template, ...metadataPatch });
			if (args.topics !== undefined) {
				await markPublicDiscoveryListAndRelationsDirty(ctx, 'authored');
			} else if (args.domain !== undefined) {
				await markPublicDiscoveryListDirty(ctx, 'authored');
			}
		}
	}
});

/**
 * Set CWC verification status on a template.
 */
export const setCwcVerification = mutation({
	args: {
		_secret: v.optional(v.string()),
		expectedUserId: v.id('users'),
		templateId: v.id('templates'),
		verificationStatus: v.string(),
		countryCode: v.string(),
		reputationApplied: v.boolean()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret ?? '');
		const allowedVerificationStatuses = new Set(['pending', 'approved', 'rejected', 'verified']);
		if (!allowedVerificationStatuses.has(args.verificationStatus)) {
			throw new ConvexError({ code: 'CWC_VERIFICATION_STATUS_INVALID' });
		}
		if (!/^[A-Z]{2}$/.test(args.countryCode)) {
			throw new ConvexError({ code: 'CWC_VERIFICATION_COUNTRY_CODE_INVALID' });
		}
		const { userId } = await requireAuth(ctx);
		if (userId !== args.expectedUserId) {
			throw new ConvexError({ code: 'CWC_VERIFICATION_EXPECTED_USER_MISMATCH' });
		}
		const template = await ctx.db.get(args.templateId);
		if (!template) throw new Error('Template not found');
		if (template.userId !== userId) {
			throw new ConvexError({ code: 'CWC_VERIFICATION_TEMPLATE_NOT_OWNED' });
		}
		await ctx.db.patch(args.templateId, {
			verificationStatus: args.verificationStatus,
			countryCode: args.countryCode,
			reputationApplied: args.reputationApplied
		});
		if (template.status === 'published' && template.isPublic) {
			await upsertCompactDiscoveryProjection(ctx, {
				...template,
				countryCode: args.countryCode,
				verificationStatus: args.verificationStatus,
				reputationApplied: args.reputationApplied
			});
			await markPublicDiscoveryListDirty(ctx, 'discreteStatus');
		}
	}
});

// =============================================================================
// TAG-VECTOR INTAKE (provider work is coordinated outside Convex)
// =============================================================================

/**
 * Internal: public published templates whose tags are not yet embedded.
 *
 * A template needs a tag-vector pass when it carries tags but its stored
 * `tagEmbeddings` don't cover the current tag set (newly authored, or tags
 * edited since the last pass). This bounded reader lets an externally
 * coordinated, admitted producer discover only the displayed corpus.
 */
export const listMissingTagEmbeddings = internalQuery({
	args: {},
	handler: async (ctx) => {
		let idsByKey: Record<PublicTemplateSnapshotKey, Array<Id<'templates'>>>;
		try {
			idsByKey = await readPublishedPublicTemplateIds(ctx);
		} catch (error) {
			if (
				error instanceof Error &&
				error.message === 'PUBLIC_TEMPLATE_SNAPSHOT_INVALID:relations:list-not-ready'
			) {
				// Cold start has no truthful displayed corpus yet. The consolidated
				// homepage rebuild publishes it later. A later external producer pass
				// then sees only those displayed IDs.
				return [];
			}
			throw error;
		}

		const selectedIds = [...new Set([...idsByKey.all, ...idsByKey.excludeCwc])];
		const migration = await compactDiscoveryPlaneReady(ctx);
		const sources = (
			await Promise.all(
				selectedIds.map(async (id) => {
					const row = await ctx.db
						.query('publicTemplateDiscoverySources')
						.withIndex('by_templateId', (q) => q.eq('templateId', id))
						.unique();
					if (!row || row.generation !== migration.runToken) return null;
					assertCompactPublicTemplateSource(row.source, row.isCwc);
					return row.source;
				})
			)
		).filter((source): source is CompactPublicTemplateSource => source !== null);
		const retained = new Set<string>();
		for (const source of sources) {
			for (const tag of normalizeTags(source.topics).slice(0, MAX_TEMPLATE_TOPICS)) {
				if (retained.size >= MAX_PUBLIC_RELATION_TAG_VECTORS) break;
				retained.add(tag);
			}
		}
		const coveredRows = await Promise.all(
			[...retained].map((tag) =>
				ctx.db
					.query('publicTagEmbeddingVectors')
					.withIndex('by_tag', (q) => q.eq('tag', tag))
					.unique()
			)
		);
		const covered = new Set(
			coveredRows.flatMap((row) => (row && isFiniteEmbeddingVector(row.embedding) ? [row.tag] : []))
		);
		return sources.flatMap((source) => {
			const tags = normalizeTags(source.topics)
				.slice(0, MAX_TEMPLATE_TOPICS)
				.filter((tag) => retained.has(tag));
			return tags.length > 0 && tags.some((tag) => !covered.has(tag))
				? [{ _id: source._id, tags }]
				: [];
		});
	}
});

/**
 * Internal mutation for vectors that were already generated through the
 * shared provider-budget coordinator. Convex stores and projects the bounded
 * result but never owns provider credentials or provider I/O for this path.
 */
export const patchTagEmbeddings = internalMutation({
	args: {
		templateId: v.id('templates'),
		tagEmbeddings: v.array(v.object({ tag: v.string(), embedding: v.array(v.float64()) }))
	},
	handler: async (ctx, args) => {
		if (args.tagEmbeddings.length > MAX_TEMPLATE_TOPICS) {
			throw new Error('TOO_MANY_TAG_EMBEDDINGS');
		}
		const tagEncoder = new TextEncoder();
		const normalizedTags = args.tagEmbeddings.map(({ tag }) => tag.trim());
		if (
			normalizedTags.some(
				(tag) => tag.length === 0 || tagEncoder.encode(tag).byteLength > MAX_TEMPLATE_TOPIC_BYTES
			) ||
			new Set(normalizedTags).size !== normalizedTags.length
		) {
			throw new Error('INVALID_TAG_EMBEDDING_LABELS');
		}
		if (args.tagEmbeddings.some(({ embedding }) => !isFiniteEmbeddingVector(embedding))) {
			throw new Error('INVALID_TAG_EMBEDDING_DIMENSION:expected=768');
		}
		const template = await ctx.db.get(args.templateId);
		if (!template) throw new Error('Template not found');
		const embeddingsUpdatedAt = Date.now();
		await ctx.db.patch(args.templateId, {
			tagEmbeddings: args.tagEmbeddings.map((entry, index) => ({
				tag: normalizedTags[index],
				embedding: entry.embedding
			})),
			embeddingsUpdatedAt
		});
		if (template.status === 'published' && template.isPublic) {
			await upsertCompactDiscoverySource(ctx, {
				...template,
				tagEmbeddings: args.tagEmbeddings.map((entry, index) => ({
					tag: normalizedTags[index],
					embedding: entry.embedding
				})),
				embeddingsUpdatedAt
			});
			await markPublicDiscoveryRelationsDirty(ctx);
		}
	}
});

// =============================================================================
// DOMAIN HUE BACKFILL
// =============================================================================

/** Cosine similarity between two equal-length vectors. */
function _cosine(a: number[], b: number[]): number {
	let dot = 0,
		magA = 0,
		magB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		magA += a[i] * a[i];
		magB += b[i] * b[i];
	}
	const denom = Math.sqrt(magA) * Math.sqrt(magB);
	return denom === 0 ? 0 : dot / denom;
}

/** Circular weighted mean of hue angles (handles 350° + 10° → 0°). */
function _circularMean(hues: number[], weights: number[]): number {
	let sinSum = 0,
		cosSum = 0,
		weightSum = 0;
	for (let i = 0; i < hues.length; i++) {
		const rad = (hues[i] * Math.PI) / 180;
		sinSum += weights[i] * Math.sin(rad);
		cosSum += weights[i] * Math.cos(rad);
		weightSum += weights[i];
	}
	if (weightSum === 0) return 0;
	const angle = (Math.atan2(sinSum / weightSum, cosSum / weightSum) * 180) / Math.PI;
	return ((angle % 360) + 360) % 360;
}

/** Project embedding onto anchors → hue angle. */
function _projectToHue(
	embedding: number[],
	anchors: Array<{ hue: number; embedding: number[] }>,
	topK = 3
): number {
	const scored = anchors.map((a) => ({
		hue: a.hue,
		similarity: _cosine(embedding, a.embedding)
	}));
	scored.sort((a, b) => b.similarity - a.similarity);
	const top = scored.slice(0, topK);
	const minSim = Math.min(...top.map((t) => t.similarity));
	const shifted = top.map((t) => ({
		hue: t.hue,
		weight: Math.max(0, t.similarity - minSim + 0.01)
	}));
	return _circularMean(
		shifted.map((s) => s.hue),
		shifted.map((s) => s.weight)
	);
}

function validateDomainHueAnchors(anchors: Array<{ hue: number; embedding: number[] }>): number {
	if (anchors.length === 0) {
		throw new ConvexError({ code: 'DOMAIN_HUE_ANCHORS_EMPTY' });
	}
	const dimension = anchors[0]?.embedding.length ?? 0;
	if (dimension === 0) {
		throw new ConvexError({ code: 'DOMAIN_HUE_ANCHOR_DIMENSION_INVALID' });
	}
	for (const [index, anchor] of anchors.entries()) {
		if (!Number.isFinite(anchor.hue) || anchor.hue < 0 || anchor.hue >= 360) {
			throw new ConvexError({ code: 'DOMAIN_HUE_ANCHOR_HUE_INVALID', index });
		}
		if (
			anchor.embedding.length !== dimension ||
			anchor.embedding.some((component) => !Number.isFinite(component))
		) {
			throw new ConvexError({
				code: 'DOMAIN_HUE_ANCHOR_VECTOR_INVALID',
				index,
				expectedDimension: dimension
			});
		}
	}
	return dimension;
}

function assertDomainHueCandidateEmbedding(embedding: number[], dimension: number): void {
	if (
		embedding.length !== dimension ||
		embedding.some((component) => !Number.isFinite(component))
	) {
		throw new ConvexError({
			code: 'DOMAIN_HUE_CANDIDATE_VECTOR_INVALID',
			expectedDimension: dimension
		});
	}
}

function assertDomainHueValue(domainHue: number): void {
	if (!Number.isFinite(domainHue) || domainHue < 0 || domainHue >= 360) {
		throw new ConvexError({ code: 'DOMAIN_HUE_VALUE_INVALID' });
	}
}

const DOMAIN_HUE_BACKFILL_SCAN_PAGE_SIZE = 8;

/**
 * Backfill every template that has a topic embedding and no stored domain hue.
 * A hue of zero is already materialized and must not be recomputed. The action
 * walks bounded query pages until the full table has been scanned, including
 * pages with no candidates.
 *
 * Usage: npx convex run templates:backfillDomainHue '{"anchors": <contents of domain-anchors.json>}'
 */
export const backfillDomainHue = internalAction({
	args: {
		anchors: v.array(
			v.object({
				hue: v.float64(),
				embedding: v.array(v.float64())
			})
		)
	},
	handler: async (ctx, args) => {
		// Validate caller-controlled math inputs before the first Convex read.
		const anchorDimension = validateDomainHueAnchors(args.anchors);
		let processed = 0;
		let scanned = 0;
		let pages = 0;
		let cursor: string | undefined;
		let isDone = false;

		while (!isDone) {
			const batch = await ctx.runQuery(
				listMissingDomainHueRef,
				cursor === undefined ? {} : { cursor }
			);
			pages += 1;
			scanned += batch.scanned;
			console.log(
				`[backfillDomainHue] page ${pages}: scanned ${batch.scanned}, missing ${batch.candidates.length}`
			);

			// Validate the whole page before scheduling any patch, so one malformed
			// candidate cannot leave its valid page siblings partially materialized.
			for (const template of batch.candidates) {
				assertDomainHueCandidateEmbedding(template.topicEmbedding, anchorDimension);
			}
			for (const template of batch.candidates) {
				const hue = _projectToHue(template.topicEmbedding, args.anchors);
				assertDomainHueValue(hue);
				await ctx.runMutation(patchDomainHueRef, {
					templateId: template._id,
					domainHue: hue
				});
				processed += 1;
				console.log(`[backfillDomainHue] ${template._id} → hue ${hue.toFixed(1)}`);
			}

			isDone = batch.isDone;
			if (!isDone && batch.continueCursor === null) {
				throw new Error('DOMAIN_HUE_BACKFILL_CURSOR_MISSING');
			}
			cursor = batch.continueCursor ?? undefined;
		}

		console.log(
			`[backfillDomainHue] complete: processed ${processed}, scanned ${scanned} across ${pages} pages`
		);
		return { processed, total: processed, scanned, pages };
	}
});

/**
 * Scan one bounded full-template page for missing domain hues. Callers must
 * advance `continueCursor` even when `candidates` is empty so later rows cannot
 * be starved by an already-complete prefix.
 */
export const _listMissingDomainHue = internalQuery({
	args: { cursor: v.optional(v.string()) },
	handler: async (ctx, args): Promise<MissingDomainHuePage> => {
		// Legacy templates can approach Convex's 1 MiB document ceiling, so this
		// query deliberately hydrates no more than eight full rows per transaction.
		const page = await ctx.db
			.query('templates')
			.order('asc')
			.paginate({ cursor: args.cursor ?? null, numItems: DOMAIN_HUE_BACKFILL_SCAN_PAGE_SIZE });
		const candidates = page.page
			.filter(
				(template): template is typeof template & { topicEmbedding: number[] } =>
					template.topicEmbedding !== undefined && template.domainHue === undefined
			)
			.map((template) => ({
				_id: template._id,
				topicEmbedding: template.topicEmbedding
			}));
		return {
			candidates,
			scanned: page.page.length,
			continueCursor: page.isDone ? null : page.continueCursor,
			isDone: page.isDone
		};
	}
});

/** Internal mutation: set domainHue on a single template. */
export const _patchDomainHue = internalMutation({
	args: {
		templateId: v.id('templates'),
		domainHue: v.float64()
	},
	handler: async (ctx, args) => {
		assertDomainHueValue(args.domainHue);
		const template = await ctx.db.get(args.templateId);
		if (!template) throw new Error('Template not found');
		await ctx.db.patch(args.templateId, { domainHue: args.domainHue });
		await syncTemplateListProjection(ctx, { ...template, domainHue: args.domainHue });
		if (template.status === 'published' && template.isPublic) {
			await upsertCompactDiscoveryProjection(ctx, { ...template, domainHue: args.domainHue });
			await markPublicDiscoveryListDirty(ctx, 'aggregate');
		}
	}
});
