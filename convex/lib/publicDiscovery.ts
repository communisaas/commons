import { makeFunctionReference } from 'convex/server';
import type { FunctionReference } from 'convex/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export const PUBLIC_DISCOVERY_MANIFEST_KEY = 'public' as const;
export const PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED =
	'PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED' as const;
export const PUBLIC_DISCOVERY_COORDINATED_REBUILD_TOKEN_MISMATCH =
	'PUBLIC_DISCOVERY_COORDINATED_REBUILD_TOKEN_MISMATCH' as const;
export const PUBLIC_DISCOVERY_COORDINATED_REBUILD_LEASE_EXPIRED =
	'PUBLIC_DISCOVERY_COORDINATED_REBUILD_LEASE_EXPIRED' as const;
/** Long enough for the seed actions, bounded so an interrupted action is retryable. */
export const PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS = 30 * 60 * 1000;
export const PUBLIC_DISCOVERY_MANIFEST_CONTROL_RETRY_MAX_SECONDS = 300;
export const PUBLIC_DISCOVERY_MANIFEST_CONTROL_RETRY_CUSHION_MS = 1_000;
/**
 * One ordinary admission plus the launch policy's eighteen continuation
 * admissions. This local ceiling is deliberately independent of the edge gate:
 * a forged or drifting 202 response can never create an immortal Convex chain.
 */
export const PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_ATTEMPTS = 19;
/**
 * Eighteen maximum 301-second delays fit inside this window with margin for
 * scheduler latency. A retry is never scheduled at or beyond this deadline.
 */
export const PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_AGE_MS = 2 * 60 * 60 * 1_000;
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED_SIGNAL_HEADER =
	'x-public-discovery-manifest-refresh-contained';
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED_SIGNAL_PROTOCOL = '1';
export const PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED_BODY =
	'{"status":"maintenance","mode":"containment","code":"PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED","retry":false}\n';

export type PublicDiscoveryManifestControlAttemptCoordinates = {
	attempt: number;
	legacy: boolean;
	startedAt: number;
};

export type PublicDiscoveryManifestControlRetryDisposition =
	| { retry: true; nextAttempt: number }
	| { retry: false; outcome: 'attemptsExhausted' | 'ageExhausted' };

/**
 * Scheduled actions created before the bounded protocol have neither
 * coordinate. Give those jobs one useful network attempt but place it at the
 * terminal attempt so they can never bootstrap an unbounded legacy chain.
 * Partially supplied, future, or otherwise malformed coordinates receive the
 * same safe treatment.
 */
export function publicDiscoveryManifestControlAttemptCoordinates(
	attempt: number | undefined,
	startedAt: number | undefined,
	now: number
): PublicDiscoveryManifestControlAttemptCoordinates {
	const validNow = Number.isSafeInteger(now) && now >= 0;
	if (!validNow) throw new Error('PUBLIC_DISCOVERY_MANIFEST_CONTROL_CLOCK_INVALID');
	const valid =
		Number.isSafeInteger(attempt) &&
		attempt !== undefined &&
		attempt >= 1 &&
		attempt <= PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_ATTEMPTS &&
		Number.isSafeInteger(startedAt) &&
		startedAt !== undefined &&
		startedAt >= 0 &&
		startedAt <= now;
	return valid
		? { attempt: attempt as number, legacy: false, startedAt: startedAt as number }
		: {
				attempt: PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_ATTEMPTS,
				legacy: true,
				startedAt: now
			};
}

/** Decide whether one already-bounded delay may extend the current chain. */
export function publicDiscoveryManifestControlRetryDisposition(input: {
	attempt: number;
	delayMs: number;
	now: number;
	startedAt: number;
}): PublicDiscoveryManifestControlRetryDisposition {
	if (input.attempt >= PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_ATTEMPTS) {
		return { retry: false, outcome: 'attemptsExhausted' };
	}
	if (
		!Number.isSafeInteger(input.delayMs) ||
		input.delayMs < 1_000 ||
		input.delayMs >
			PUBLIC_DISCOVERY_MANIFEST_CONTROL_RETRY_MAX_SECONDS * 1_000 +
				PUBLIC_DISCOVERY_MANIFEST_CONTROL_RETRY_CUSHION_MS ||
		!Number.isSafeInteger(input.now) ||
		!Number.isSafeInteger(input.startedAt) ||
		input.startedAt < 0 ||
		input.startedAt > input.now ||
		input.now - input.startedAt >= PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_AGE_MS ||
		input.now + input.delayMs - input.startedAt >= PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_AGE_MS
	) {
		return { retry: false, outcome: 'ageExhausted' };
	}
	return { retry: true, nextAttempt: input.attempt + 1 };
}

/**
 * Pages returns an integer Retry-After when its global cadence gate coalesces a
 * producer push. Keep parsing deliberately narrower than the general HTTP
 * grammar so a malformed response cannot schedule an unbounded Convex action.
 */
export function publicDiscoveryManifestControlRetryDelayMs(
	retryAfter: string | null
): number | null {
	if (retryAfter === null || !/^[1-9]\d{0,2}$/.test(retryAfter)) return null;
	const seconds = Number(retryAfter);
	if (
		!Number.isSafeInteger(seconds) ||
		seconds < 1 ||
		seconds > PUBLIC_DISCOVERY_MANIFEST_CONTROL_RETRY_MAX_SECONDS
	) {
		return null;
	}
	return seconds * 1_000 + PUBLIC_DISCOVERY_MANIFEST_CONTROL_RETRY_CUSHION_MS;
}

/**
 * Compact-source search is not snapshot-isolated by the manifest revision.
 * During coordinated clear/reseed it must therefore fail closed instead of
 * exposing the inter-page source corpus.
 */
export async function assertPublicDiscoveryDirectSourceServingReady(
	ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>
): Promise<void> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	if (manifest?.coordinatedRebuildToken !== undefined) {
		throw new Error(PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED);
	}
}

export type PublicDiscoveryCoordinatedRebuildKind = 'clearSeed' | 'reseedTemplates';

/**
 * Canonical inventory of source tables and the snapshot families they affect.
 *
 * Keep this mapping at the serialization boundary rather than duplicating it in
 * seed/admin helpers or CI. `debateArguments` is intentionally absent: public
 * cards read only the counters denormalized onto `debates`, whose writers are
 * separately covered by the writer-contract ratchet.
 */
export const PUBLIC_DISCOVERY_SOURCE_FAMILIES = {
	templates: { list: true, relations: true },
	templateEndorsements: { list: true, relations: false },
	debates: { list: true, relations: false },
	organizations: { list: true, relations: false }
} as const;

export type PublicDiscoverySourceTable = keyof typeof PUBLIC_DISCOVERY_SOURCE_FAMILIES;

/** First dirty write owns one bounded coalescing window. */
export const PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS = 60 * 1000;
export const PUBLIC_DISCOVERY_RELATIONS_DEBOUNCE_MS = 60 * 1000;

/**
 * High-frequency derived-card changes retain a six-hour list cost floor.
 * Explicit authoring changes durably opt into the prompt path below, which
 * keeps the same one-minute coalescing window. Relations always retain their
 * independent six-hour floor unless destructive invalidation fails closed.
 */
export const PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const PUBLIC_DISCOVERY_RELATIONS_MIN_REBUILD_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Every list-affecting writer must name its product freshness class. Authored
 * copy, public visibility, and discrete lifecycle transitions are user-visible
 * state changes and publish inside the one-minute coalescing window. Aggregate
 * counters retain the six-hour write-amplification ceiling. Relations always
 * retain their independent six-hour ceiling unless destructive invalidation
 * fails closed.
 */
export const PUBLIC_DISCOVERY_LIST_FRESHNESS_MAX_DELAY_MS = {
	authored: PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS,
	visibility: PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS,
	discreteStatus: PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS,
	aggregate: PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS
} as const;

export type PublicDiscoveryListFreshnessClass =
	keyof typeof PUBLIC_DISCOVERY_LIST_FRESHNESS_MAX_DELAY_MS;

type Manifest = Doc<'publicDiscoveryManifest'>;
type ManifestAuthority = Doc<'publicDiscoveryManifestAuthority'>;
type PublicDiscoveryManifestAuthoritySource = Pick<
	Manifest,
	| 'listReady'
	| 'listRetiredRevision'
	| 'listRevision'
	| 'listUpdatedAt'
	| 'listWithdrawalEpoch'
	| 'relationsReady'
	| 'relationsRetiredRevision'
	| 'relationsRevision'
	| 'relationsUpdatedAt'
	| 'relationsWithdrawalEpoch'
>;

export const PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_PROJECTION_VERSION = 1 as const;
export const PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_MAX_BYTES = 4 * 1024;
export const PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_NOT_READY =
	'PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_NOT_READY' as const;

export type PublicDiscoveryManifestAuthorityProjection = Omit<
	ManifestAuthority,
	'_id' | '_creationTime'
>;

export type PublicDiscoveryCoordinatedRebuildLeaseSupervisionResult =
	| { status: 'idle'; shouldAlert: false }
	| { status: 'active'; shouldAlert: false; leaseExpiresAt: number }
	| { status: 'unclassified'; shouldAlert: false }
	| {
			status: 'stale';
			shouldAlert: boolean;
			leaseExpiresAt: number;
			failureAt: number;
			failureCode: string;
			retryAt: number;
			kind: PublicDiscoveryCoordinatedRebuildKind | null;
			attempt: number;
	  };

export type PublicDiscoveryCoordinatedRebuildWatchdogCoordinates = {
	coordinatedRebuildToken: string;
	coordinatedRebuildAttempt: number;
	scheduledAt: number;
};

export type PublicDiscoveryCoordinatedRebuildWatchdogResult =
	| { status: 'superseded'; shouldAlert: false }
	| { status: 'early'; shouldAlert: false; scheduledAt: number }
	| { status: 'rescheduled'; shouldAlert: false; scheduledAt: number }
	| { status: 'unclassified'; shouldAlert: false }
	| Extract<PublicDiscoveryCoordinatedRebuildLeaseSupervisionResult, { status: 'stale' }>;

type PublicDiscoveryRefreshUrgencyState = Pick<
	Manifest,
	'listRefreshUrgency' | 'relationsDirtyAt' | 'relationsRefreshUrgency'
>;

type PublicDiscoveryListRefreshPriority = 'ordinary' | 'prompt';

function listRefreshPriority(
	freshnessClass: PublicDiscoveryListFreshnessClass
): PublicDiscoveryListRefreshPriority {
	return freshnessClass === 'aggregate' ? 'ordinary' : 'prompt';
}

function requestedListRefreshUrgency(
	manifest: PublicDiscoveryRefreshUrgencyState | null,
	priority: PublicDiscoveryListRefreshPriority
): Manifest['listRefreshUrgency'] {
	if (manifest?.listRefreshUrgency === 'urgent') return 'urgent';
	if (manifest?.listRefreshUrgency === 'prompt' || priority === 'prompt') return 'prompt';
	return undefined;
}

/**
 * The list worker may own a composite list+relations generation. Its durable
 * bypass authority therefore includes an urgent dirty relation generation.
 */
export function publicDiscoveryListRefreshBypassesMinInterval(
	manifest: PublicDiscoveryRefreshUrgencyState | null
): boolean {
	return (
		manifest?.listRefreshUrgency !== undefined ||
		(manifest?.relationsDirtyAt !== undefined && manifest.relationsRefreshUrgency === 'urgent')
	);
}

/**
 * Prompt authoring generations deliberately leave ordinary relations on their
 * independent six-hour token. Ordinary list work may still coalesce with dirty
 * relations at the shared floor, and destructive relation urgency always owns
 * an immediate fail-closed composite.
 */
export function publicDiscoveryListRefreshRebuildsRelations(
	manifest: PublicDiscoveryRefreshUrgencyState | null
): boolean {
	return (
		manifest?.relationsDirtyAt !== undefined &&
		(manifest.relationsRefreshUrgency === 'urgent' || manifest.listRefreshUrgency !== 'prompt')
	);
}

/** Scheduled arguments are advisory; only this manifest field grants bypass. */
export function publicDiscoveryRelationsRefreshBypassesMinInterval(
	manifest: Pick<Manifest, 'relationsRefreshUrgency'> | null
): boolean {
	return manifest?.relationsRefreshUrgency === 'urgent';
}

type PublicDiscoveryCoordinatedRebuildLeaseState = Pick<
	Manifest,
	'coordinatedRebuildToken' | 'coordinatedRebuildStartedAt' | 'coordinatedRebuildLeaseExpiresAt'
>;

/** Read new leases while retaining a safe fallback for pre-migration locks. */
export function publicDiscoveryCoordinatedRebuildLeaseExpiresAt(
	manifest: PublicDiscoveryCoordinatedRebuildLeaseState | null
): number | undefined {
	if (!manifest || manifest.coordinatedRebuildToken === undefined) return undefined;
	if (manifest.coordinatedRebuildLeaseExpiresAt !== undefined) {
		return manifest.coordinatedRebuildLeaseExpiresAt;
	}
	return manifest.coordinatedRebuildStartedAt === undefined
		? undefined
		: manifest.coordinatedRebuildStartedAt + PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS;
}

/** Expiry permits an explicit compare-and-swap takeover; it never auto-unlocks. */
export function publicDiscoveryCoordinatedRebuildIsStale(
	manifest: PublicDiscoveryCoordinatedRebuildLeaseState | null,
	now = Date.now()
): boolean {
	const expiresAt = publicDiscoveryCoordinatedRebuildLeaseExpiresAt(manifest);
	return expiresAt !== undefined && now >= expiresAt;
}

type PublicDiscoveryPublication = {
	revision: number;
	updatedAt: number;
	coordinatedRebuildToken?: string;
};

type ScheduledListRefreshArgs = { scheduledAt: number; bypassMinInterval?: boolean };
type ScheduledRelationsRefreshArgs = { scheduledAt: number; bypassMinInterval?: boolean };

const superviseCoordinatedPublicDiscoveryRebuildWatchdogRef = makeFunctionReference<'mutation'>(
	'observability:superviseCoordinatedPublicDiscoveryRebuildWatchdog'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	PublicDiscoveryCoordinatedRebuildWatchdogCoordinates,
	PublicDiscoveryCoordinatedRebuildWatchdogResult
>;

const flushScheduledListRefreshRef = makeFunctionReference<'action'>(
	'templates:superviseScheduledPublicTemplateRefresh'
) as unknown as FunctionReference<'action', 'internal', ScheduledListRefreshArgs, unknown>;

const flushScheduledRelationsRefreshRef = makeFunctionReference<'action'>(
	'templates:superviseScheduledPublicTemplateRelationsRefresh'
) as unknown as FunctionReference<'action', 'internal', ScheduledRelationsRefreshArgs, unknown>;

const pushPublicDiscoveryManifestControlRef = makeFunctionReference<'action'>(
	'templates:pushPublicDiscoveryManifestControl'
) as unknown as FunctionReference<
	'action',
	'internal',
	{ attempt?: number; continuation?: boolean; startedAt?: number; token: string },
	unknown
>;

async function schedulePublicDiscoveryManifestControlPush(ctx: MutationCtx): Promise<void> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	if (!manifest || manifest.manifestControlPushToken !== undefined) return;
	const token = crypto.randomUUID();
	const startedAt = Date.now();
	await ctx.db.patch(manifest._id, { manifestControlPushToken: token });
	await ctx.scheduler.runAfter(0, pushPublicDiscoveryManifestControlRef, {
		attempt: 1,
		startedAt,
		token
	});
}

export type PublicDiscoveryManifestPayload = {
	list: {
		ready: boolean;
		retiredRevision: number;
		revision: number;
		updatedAt: number | null;
		withdrawalEpoch: number;
	};
	relations: {
		ready: boolean;
		retiredRevision: number;
		revision: number;
		updatedAt: number | null;
		withdrawalEpoch: number;
	};
};

export const COLD_PUBLIC_DISCOVERY_MANIFEST: PublicDiscoveryManifestPayload = {
	list: { ready: false, retiredRevision: 0, revision: 0, updatedAt: null, withdrawalEpoch: 0 },
	relations: {
		ready: false,
		retiredRevision: 0,
		revision: 0,
		updatedAt: null,
		withdrawalEpoch: 0
	}
};

function publicDiscoveryWithdrawalEpoch(
	manifest: PublicDiscoveryManifestAuthoritySource | null,
	family: 'list' | 'relations'
): number {
	const epoch =
		family === 'list' ? manifest?.listWithdrawalEpoch : manifest?.relationsWithdrawalEpoch;
	const normalized = epoch ?? 0;
	if (!Number.isSafeInteger(normalized) || normalized < 0) {
		throw new Error('PUBLIC_DISCOVERY_WITHDRAWAL_EPOCH_INVALID');
	}
	return normalized;
}

function nextPublicDiscoveryWithdrawalEpoch(
	manifest: Manifest | null,
	family: 'list' | 'relations'
): number {
	const current = publicDiscoveryWithdrawalEpoch(manifest, family);
	if (current === Number.MAX_SAFE_INTEGER) {
		throw new Error('PUBLIC_DISCOVERY_WITHDRAWAL_EPOCH_EXHAUSTED');
	}
	return current + 1;
}

export function toPublicDiscoveryManifestPayload(
	manifest: PublicDiscoveryManifestAuthoritySource | null
): PublicDiscoveryManifestPayload {
	if (!manifest) return COLD_PUBLIC_DISCOVERY_MANIFEST;
	return {
		list: {
			ready: manifest.listReady,
			retiredRevision:
				manifest.listRetiredRevision ??
				(manifest.listReady ? Math.max(0, manifest.listRevision - 1) : manifest.listRevision),
			revision: manifest.listRevision,
			updatedAt: manifest.listUpdatedAt ?? null,
			withdrawalEpoch: publicDiscoveryWithdrawalEpoch(manifest, 'list')
		},
		relations: {
			ready: manifest.relationsReady,
			retiredRevision:
				manifest.relationsRetiredRevision ??
				(manifest.relationsReady
					? Math.max(0, manifest.relationsRevision - 1)
					: manifest.relationsRevision),
			revision: manifest.relationsRevision,
			updatedAt: manifest.relationsUpdatedAt ?? null,
			withdrawalEpoch: publicDiscoveryWithdrawalEpoch(manifest, 'relations')
		}
	};
}

function assertPublicDiscoveryManifestAuthorityInteger(value: number, field: string): number {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_INVALID:${field}`);
	}
	return value;
}

function assertPublicDiscoveryManifestAuthorityTimestamp(
	value: number | null,
	field: string
): number | null {
	if (value === null) return null;
	return assertPublicDiscoveryManifestAuthorityInteger(value, field);
}

/** Exact UTF-8 JSON envelope used by the checked 4 KiB compact-row contract. */
export function publicDiscoveryManifestAuthoritySerializedBytes(
	projection: PublicDiscoveryManifestAuthorityProjection
): number {
	return new TextEncoder().encode(JSON.stringify(projection)).byteLength;
}

/**
 * Flatten only the ten public authority scalars. Scheduler tokens, migration
 * cursors, and failure strings deliberately remain on the wide control row.
 */
export function toPublicDiscoveryManifestAuthorityProjection(
	manifest: PublicDiscoveryManifestAuthoritySource | null
): PublicDiscoveryManifestAuthorityProjection {
	const payload = toPublicDiscoveryManifestPayload(manifest);
	const projection: PublicDiscoveryManifestAuthorityProjection = {
		key: PUBLIC_DISCOVERY_MANIFEST_KEY,
		projectionVersion: PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_PROJECTION_VERSION,
		listReady: payload.list.ready,
		listRetiredRevision: assertPublicDiscoveryManifestAuthorityInteger(
			payload.list.retiredRevision,
			'listRetiredRevision'
		),
		listRevision: assertPublicDiscoveryManifestAuthorityInteger(
			payload.list.revision,
			'listRevision'
		),
		listUpdatedAt: assertPublicDiscoveryManifestAuthorityTimestamp(
			payload.list.updatedAt,
			'listUpdatedAt'
		),
		listWithdrawalEpoch: assertPublicDiscoveryManifestAuthorityInteger(
			payload.list.withdrawalEpoch,
			'listWithdrawalEpoch'
		),
		relationsReady: payload.relations.ready,
		relationsRetiredRevision: assertPublicDiscoveryManifestAuthorityInteger(
			payload.relations.retiredRevision,
			'relationsRetiredRevision'
		),
		relationsRevision: assertPublicDiscoveryManifestAuthorityInteger(
			payload.relations.revision,
			'relationsRevision'
		),
		relationsUpdatedAt: assertPublicDiscoveryManifestAuthorityTimestamp(
			payload.relations.updatedAt,
			'relationsUpdatedAt'
		),
		relationsWithdrawalEpoch: assertPublicDiscoveryManifestAuthorityInteger(
			payload.relations.withdrawalEpoch,
			'relationsWithdrawalEpoch'
		)
	};
	const bytes = publicDiscoveryManifestAuthoritySerializedBytes(projection);
	if (bytes > PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_MAX_BYTES) {
		throw new Error(
			`PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_TOO_LARGE:${bytes}:${PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_MAX_BYTES}`
		);
	}
	return projection;
}

export function toPublicDiscoveryManifestPayloadFromAuthority(
	authority: PublicDiscoveryManifestAuthorityProjection
): PublicDiscoveryManifestPayload {
	if (
		authority.key !== PUBLIC_DISCOVERY_MANIFEST_KEY ||
		authority.projectionVersion !== PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_PROJECTION_VERSION ||
		publicDiscoveryManifestAuthoritySerializedBytes(authority) >
			PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_MAX_BYTES
	) {
		throw new Error(PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_NOT_READY);
	}
	return {
		list: {
			ready: authority.listReady,
			retiredRevision: assertPublicDiscoveryManifestAuthorityInteger(
				authority.listRetiredRevision,
				'listRetiredRevision'
			),
			revision: assertPublicDiscoveryManifestAuthorityInteger(
				authority.listRevision,
				'listRevision'
			),
			updatedAt: assertPublicDiscoveryManifestAuthorityTimestamp(
				authority.listUpdatedAt,
				'listUpdatedAt'
			),
			withdrawalEpoch: assertPublicDiscoveryManifestAuthorityInteger(
				authority.listWithdrawalEpoch,
				'listWithdrawalEpoch'
			)
		},
		relations: {
			ready: authority.relationsReady,
			retiredRevision: assertPublicDiscoveryManifestAuthorityInteger(
				authority.relationsRetiredRevision,
				'relationsRetiredRevision'
			),
			revision: assertPublicDiscoveryManifestAuthorityInteger(
				authority.relationsRevision,
				'relationsRevision'
			),
			updatedAt: assertPublicDiscoveryManifestAuthorityTimestamp(
				authority.relationsUpdatedAt,
				'relationsUpdatedAt'
			),
			withdrawalEpoch: assertPublicDiscoveryManifestAuthorityInteger(
				authority.relationsWithdrawalEpoch,
				'relationsWithdrawalEpoch'
			)
		}
	};
}

export async function getPublicDiscoveryManifestRow(
	ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>
): Promise<Manifest | null> {
	return await ctx.db
		.query('publicDiscoveryManifest')
		.withIndex('by_key', (q) => q.eq('key', PUBLIC_DISCOVERY_MANIFEST_KEY))
		.unique();
}

export async function getPublicDiscoveryManifestAuthorityRow(
	ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>
): Promise<ManifestAuthority | null> {
	return await ctx.db
		.query('publicDiscoveryManifestAuthority')
		.withIndex('by_key', (q) => q.eq('key', PUBLIC_DISCOVERY_MANIFEST_KEY))
		.unique();
}

function storedPublicDiscoveryManifestAuthorityProjection(
	authority: ManifestAuthority
): PublicDiscoveryManifestAuthorityProjection {
	const { _id: _ignoredId, _creationTime: _ignoredCreationTime, ...projection } = authority;
	return projection;
}

export function publicDiscoveryManifestAuthorityMatches(
	authority: ManifestAuthority,
	manifest: PublicDiscoveryManifestAuthoritySource | null
): boolean {
	const stored = storedPublicDiscoveryManifestAuthorityProjection(authority);
	const expected = toPublicDiscoveryManifestAuthorityProjection(manifest);
	return (
		stored.key === expected.key &&
		stored.projectionVersion === expected.projectionVersion &&
		stored.listReady === expected.listReady &&
		stored.listRetiredRevision === expected.listRetiredRevision &&
		stored.listRevision === expected.listRevision &&
		stored.listUpdatedAt === expected.listUpdatedAt &&
		stored.listWithdrawalEpoch === expected.listWithdrawalEpoch &&
		stored.relationsReady === expected.relationsReady &&
		stored.relationsRetiredRevision === expected.relationsRetiredRevision &&
		stored.relationsRevision === expected.relationsRevision &&
		stored.relationsUpdatedAt === expected.relationsUpdatedAt &&
		stored.relationsWithdrawalEpoch === expected.relationsWithdrawalEpoch
	);
}

/**
 * One bounded legacy cutover: read one wide singleton and insert/replace one
 * compact singleton in the same OCC transaction. Writing the compact row is
 * the activation event; the public reader never falls back to the wide row.
 */
export async function activatePublicDiscoveryManifestAuthority(
	ctx: MutationCtx
): Promise<{ activated: true; bytes: number; created: boolean }> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	const projection = toPublicDiscoveryManifestAuthorityProjection(manifest);
	const authority = await getPublicDiscoveryManifestAuthorityRow(ctx);
	if (authority) await ctx.db.replace(authority._id, projection);
	else await ctx.db.insert('publicDiscoveryManifestAuthority', projection);
	return {
		activated: true,
		bytes: publicDiscoveryManifestAuthoritySerializedBytes(projection),
		created: authority === null
	};
}

/** Mirror an authority-changing wide-row write only after explicit activation. */
export async function syncPublicDiscoveryManifestAuthorityIfActive(
	ctx: MutationCtx,
	manifest: PublicDiscoveryManifestAuthoritySource
): Promise<boolean> {
	const authority = await getPublicDiscoveryManifestAuthorityRow(ctx);
	if (!authority) return false;
	const projection = toPublicDiscoveryManifestAuthorityProjection(manifest);
	await ctx.db.replace(authority._id, projection);
	return true;
}

/**
 * Classify the coordinated-rebuild lease and durably stamp its first expiry.
 *
 * The returned one-shot alert signal is serialized by Convex OCC with the
 * evidence patch. Callers may enqueue an alert in the same mutation when it is
 * true. This transition deliberately cannot clear or replace the owner token,
 * mark either family ready, publish a revision, or schedule rebuild work.
 */
async function supervisePublicDiscoveryCoordinatedRebuildLeaseRow(
	ctx: MutationCtx,
	manifest: Manifest,
	now: number,
	clearWatchdog: boolean
): Promise<PublicDiscoveryCoordinatedRebuildLeaseSupervisionResult> {
	const leaseExpiresAt = publicDiscoveryCoordinatedRebuildLeaseExpiresAt(manifest);
	if (leaseExpiresAt === undefined) {
		// Missing legacy metadata cannot prove expiry. Remain locked and require
		// explicit operator inspection rather than guessing an unlock boundary.
		return { status: 'unclassified', shouldAlert: false };
	}
	if (now < leaseExpiresAt) {
		return { status: 'active', shouldAlert: false, leaseExpiresAt };
	}

	const shouldAlert = manifest.coordinatedRebuildFailureAt === undefined;
	const failureAt = manifest.coordinatedRebuildFailureAt ?? now;
	const failureCode =
		manifest.coordinatedRebuildFailureCode ?? PUBLIC_DISCOVERY_COORDINATED_REBUILD_LEASE_EXPIRED;
	// This is the first instant at which an explicit token-replacing retry may
	// safely claim the stale lease. It does not authorize automatic retry.
	const retryAt = manifest.coordinatedRebuildRetryAt ?? now;
	const patch = {
		...(manifest.coordinatedRebuildFailureAt === undefined
			? { coordinatedRebuildFailureAt: failureAt }
			: {}),
		...(manifest.coordinatedRebuildFailureCode === undefined
			? { coordinatedRebuildFailureCode: failureCode }
			: {}),
		...(manifest.coordinatedRebuildRetryAt === undefined
			? { coordinatedRebuildRetryAt: retryAt }
			: {}),
		...(clearWatchdog && manifest.coordinatedRebuildWatchdogScheduledAt !== undefined
			? { coordinatedRebuildWatchdogScheduledAt: undefined }
			: {})
	};
	if (Object.keys(patch).length > 0) {
		await ctx.db.patch(manifest._id, patch);
	}

	return {
		status: 'stale',
		shouldAlert,
		leaseExpiresAt,
		failureAt,
		failureCode,
		retryAt,
		kind: manifest.coordinatedRebuildKind ?? null,
		attempt: manifest.coordinatedRebuildAttempt ?? 1
	};
}

export async function supervisePublicDiscoveryCoordinatedRebuildLease(
	ctx: MutationCtx,
	now = Date.now()
): Promise<PublicDiscoveryCoordinatedRebuildLeaseSupervisionResult> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	if (!manifest || manifest.coordinatedRebuildToken === undefined) {
		return { status: 'idle', shouldAlert: false };
	}
	return await supervisePublicDiscoveryCoordinatedRebuildLeaseRow(ctx, manifest, now, false);
}

/**
 * Consume one exact event-driven watchdog slot.
 *
 * The token, attempt, and scheduled timestamp form a durable owner coordinate.
 * A delayed predecessor, duplicate invocation, completed owner, or stale owner
 * can therefore do no work after that coordinate changes. When the same owner
 * renewed its lease, consuming the old slot patches the next timestamp and
 * schedules exactly one successor in the same OCC transaction. Expiry clears
 * only the watchdog slot and stamps failure evidence; it never unlocks,
 * publishes, or retries the owning operation.
 */
export async function supervisePublicDiscoveryCoordinatedRebuildWatchdog(
	ctx: MutationCtx,
	coordinates: PublicDiscoveryCoordinatedRebuildWatchdogCoordinates,
	now = Date.now()
): Promise<PublicDiscoveryCoordinatedRebuildWatchdogResult> {
	if (
		coordinates.coordinatedRebuildToken.length === 0 ||
		!Number.isSafeInteger(coordinates.coordinatedRebuildAttempt) ||
		coordinates.coordinatedRebuildAttempt < 1 ||
		!Number.isSafeInteger(coordinates.scheduledAt) ||
		coordinates.scheduledAt < 0
	) {
		return { status: 'superseded', shouldAlert: false };
	}

	const manifest = await getPublicDiscoveryManifestRow(ctx);
	if (
		!manifest ||
		manifest.coordinatedRebuildToken !== coordinates.coordinatedRebuildToken ||
		manifest.coordinatedRebuildAttempt !== coordinates.coordinatedRebuildAttempt ||
		manifest.coordinatedRebuildWatchdogScheduledAt !== coordinates.scheduledAt
	) {
		return { status: 'superseded', shouldAlert: false };
	}

	// A manually or prematurely invoked copy cannot consume the durable slot;
	// the already-queued exact job remains its sole owner.
	if (now < coordinates.scheduledAt) {
		return { status: 'early', shouldAlert: false, scheduledAt: coordinates.scheduledAt };
	}

	const leaseExpiresAt = publicDiscoveryCoordinatedRebuildLeaseExpiresAt(manifest);
	if (leaseExpiresAt === undefined) {
		return { status: 'unclassified', shouldAlert: false };
	}
	if (now < leaseExpiresAt) {
		// Since this invocation is at or after the consumed coordinate, an active
		// lease proves that the same owner renewed it to a strictly later boundary.
		await ctx.db.patch(manifest._id, {
			coordinatedRebuildWatchdogScheduledAt: leaseExpiresAt
		});
		await ctx.scheduler.runAt(
			leaseExpiresAt,
			superviseCoordinatedPublicDiscoveryRebuildWatchdogRef,
			{
				coordinatedRebuildToken: coordinates.coordinatedRebuildToken,
				coordinatedRebuildAttempt: coordinates.coordinatedRebuildAttempt,
				scheduledAt: leaseExpiresAt
			}
		);
		return { status: 'rescheduled', shouldAlert: false, scheduledAt: leaseExpiresAt };
	}

	return (await supervisePublicDiscoveryCoordinatedRebuildLeaseRow(
		ctx,
		manifest,
		now,
		true
	)) as Extract<PublicDiscoveryCoordinatedRebuildLeaseSupervisionResult, { status: 'stale' }>;
}

function manifestInsertBase(): Omit<Manifest, '_id' | '_creationTime'> {
	return {
		key: PUBLIC_DISCOVERY_MANIFEST_KEY,
		listReady: false,
		relationsReady: false,
		listRevision: 0,
		relationsRevision: 0,
		listRetiredRevision: 0,
		relationsRetiredRevision: 0,
		listWithdrawalEpoch: 0,
		relationsWithdrawalEpoch: 0
	};
}

function assertPublicDiscoveryPublicationAuthorized(
	manifest: Manifest | null,
	coordinatedRebuildToken?: string
): void {
	const activeToken = manifest?.coordinatedRebuildToken;
	if (activeToken === undefined) {
		if (coordinatedRebuildToken !== undefined) {
			throw new Error(PUBLIC_DISCOVERY_COORDINATED_REBUILD_TOKEN_MISMATCH);
		}
		return;
	}
	if (coordinatedRebuildToken !== activeToken) {
		throw new Error(PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED);
	}
}

/**
 * Prove that a mutation suppressing ordinary refresh work belongs to the
 * currently active coordinated rebuild. The manifest read is intentionally
 * performed before the caller's first write: Convex OCC then prevents the
 * lock from being acquired, replaced, or released around that source write.
 */
export async function assertPublicDiscoveryCoordinatedRebuildAuthorized(
	ctx: MutationCtx,
	coordinatedRebuildToken?: string
): Promise<void> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	const activeToken = manifest?.coordinatedRebuildToken;
	if (activeToken === undefined) {
		throw new Error(PUBLIC_DISCOVERY_COORDINATED_REBUILD_TOKEN_MISMATCH);
	}
	if (coordinatedRebuildToken !== activeToken) {
		throw new Error(PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED);
	}

	// An authorized source mutation is positive evidence that the owner is still
	// making progress. Renew monotonically in the same OCC transaction as the
	// caller's source writes; expiry by itself never removes or replaces a token.
	const currentLeaseExpiresAt = publicDiscoveryCoordinatedRebuildLeaseExpiresAt(manifest);
	const renewedLeaseExpiresAt = Math.max(
		currentLeaseExpiresAt ?? 0,
		Date.now() + PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS
	);
	if (manifest && renewedLeaseExpiresAt !== manifest.coordinatedRebuildLeaseExpiresAt) {
		await ctx.db.patch(manifest._id, {
			coordinatedRebuildLeaseExpiresAt: renewedLeaseExpiresAt
		});
	}
}

/** Reserve (without publishing) the revision a list rebuild will own. */
export async function preparePublicDiscoveryListPublication(
	ctx: MutationCtx,
	coordinatedRebuildToken?: string,
	updatedAt = Date.now()
): Promise<PublicDiscoveryPublication> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	assertPublicDiscoveryPublicationAuthorized(manifest, coordinatedRebuildToken);
	return {
		revision: (manifest?.listRevision ?? 0) + 1,
		updatedAt,
		...(coordinatedRebuildToken !== undefined ? { coordinatedRebuildToken } : {})
	};
}

/** Mark a fully-written pair of list snapshots as the new public revision. */
export async function commitPublicDiscoveryListPublication(
	ctx: MutationCtx,
	publication: PublicDiscoveryPublication
): Promise<void> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	assertPublicDiscoveryPublicationAuthorized(manifest, publication.coordinatedRebuildToken);
	if (manifest) {
		const patch = {
			listReady: true,
			listRetiredRevision: Math.max(manifest.listRetiredRevision ?? 0, publication.revision - 1),
			listRevision: publication.revision,
			listUpdatedAt: publication.updatedAt,
			listDirtyAt: undefined,
			listRefreshUrgency: undefined,
			listFailureAt: undefined,
			listFailureCode: undefined
		};
		await ctx.db.patch(manifest._id, patch);
		await syncPublicDiscoveryManifestAuthorityIfActive(ctx, { ...manifest, ...patch });
		await schedulePublicDiscoveryManifestControlPush(ctx);
		return;
	}

	const inserted = {
		...manifestInsertBase(),
		listReady: true,
		listRetiredRevision: Math.max(0, publication.revision - 1),
		listRevision: publication.revision,
		listUpdatedAt: publication.updatedAt
	};
	await ctx.db.insert('publicDiscoveryManifest', inserted);
	await syncPublicDiscoveryManifestAuthorityIfActive(ctx, inserted);
	await schedulePublicDiscoveryManifestControlPush(ctx);
}

/** Reserve (without publishing) the revision a relation rebuild will own. */
export async function preparePublicDiscoveryRelationsPublication(
	ctx: MutationCtx,
	coordinatedRebuildToken?: string,
	updatedAt = Date.now()
): Promise<PublicDiscoveryPublication> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	assertPublicDiscoveryPublicationAuthorized(manifest, coordinatedRebuildToken);
	return {
		revision: (manifest?.relationsRevision ?? 0) + 1,
		updatedAt,
		...(coordinatedRebuildToken !== undefined ? { coordinatedRebuildToken } : {})
	};
}

/** Mark both fully-written relation variants as the new public revision. */
export async function commitPublicDiscoveryRelationsPublication(
	ctx: MutationCtx,
	publication: PublicDiscoveryPublication
): Promise<void> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	assertPublicDiscoveryPublicationAuthorized(manifest, publication.coordinatedRebuildToken);
	if (manifest) {
		const patch = {
			relationsReady: true,
			relationsRetiredRevision: Math.max(
				manifest.relationsRetiredRevision ?? 0,
				publication.revision - 1
			),
			relationsRevision: publication.revision,
			relationsUpdatedAt: publication.updatedAt,
			relationsDirtyAt: undefined,
			relationsRefreshUrgency: undefined,
			relationsFailureAt: undefined,
			relationsFailureCode: undefined
		};
		await ctx.db.patch(manifest._id, patch);
		await syncPublicDiscoveryManifestAuthorityIfActive(ctx, { ...manifest, ...patch });
		await schedulePublicDiscoveryManifestControlPush(ctx);
		return;
	}

	const inserted = {
		...manifestInsertBase(),
		relationsReady: true,
		relationsRetiredRevision: Math.max(0, publication.revision - 1),
		relationsRevision: publication.revision,
		relationsUpdatedAt: publication.updatedAt
	};
	await ctx.db.insert('publicDiscoveryManifest', inserted);
	await syncPublicDiscoveryManifestAuthorityIfActive(ctx, inserted);
	await schedulePublicDiscoveryManifestControlPush(ctx);
}

async function scheduleListRefresh(
	ctx: MutationCtx,
	scheduledAt: number,
	now: number,
	bypassMinInterval = false
): Promise<Id<'_scheduled_functions'>> {
	return await ctx.scheduler.runAfter(
		Math.max(0, scheduledAt - now),
		flushScheduledListRefreshRef,
		{ scheduledAt, ...(bypassMinInterval ? { bypassMinInterval: true } : {}) }
	);
}

async function scheduleRelationsRefresh(
	ctx: MutationCtx,
	scheduledAt: number,
	now: number,
	bypassMinInterval = false
): Promise<Id<'_scheduled_functions'>> {
	return await ctx.scheduler.runAfter(
		Math.max(0, scheduledAt - now),
		flushScheduledRelationsRefreshRef,
		{ scheduledAt, ...(bypassMinInterval ? { bypassMinInterval: true } : {}) }
	);
}

function uniqueImmediateRefreshToken(manifest: Manifest | null, now: number): number {
	const occupied = new Set([
		manifest?.listRefreshScheduledAt,
		manifest?.relationsRefreshScheduledAt,
		// A scheduled failure clears its active token before a successor writer can
		// arrive. Include durable publication/failure/dirty coordinates so an
		// immediate retry at the same clock tick cannot reuse that token (ABA) and
		// let stale recovery clear or poison the successor generation.
		manifest?.listUpdatedAt,
		manifest?.relationsUpdatedAt,
		manifest?.listFailureAt,
		manifest?.relationsFailureAt,
		manifest?.listDirtyAt,
		manifest?.relationsDirtyAt
	]);
	let scheduledAt = now;
	while (occupied.has(scheduledAt)) scheduledAt++;
	return scheduledAt;
}

/**
 * Hide a destructively changed source immediately and force one proportional
 * rebuild outside the ordinary six-hour authoring cost floor.
 *
 * The list worker owns a combined list+relations generation when both families
 * are affected. A unique token supersedes every older queued invocation while
 * preserving snapshots, calibration, leases, and the unaffected family.
 */
export async function invalidatePublicDiscoveryAfterDestructiveSourceChange(
	ctx: MutationCtx,
	families: { list: boolean; relations: boolean },
	now = Date.now()
): Promise<{ scheduledAt: number }> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	const publishesListWithdrawal = families.list && manifest?.listReady === true;
	const publishesRelationsWithdrawal = families.relations && manifest?.relationsReady === true;
	const publishesNewWithdrawal = publishesListWithdrawal || publishesRelationsWithdrawal;
	if (manifest?.coordinatedRebuildToken !== undefined) {
		throw new Error(PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED);
	}
	// A bounded destructive clear can span several transactions at the same
	// clock tick. Once an urgent worker owns a future token, every later page
	// must join that generation instead of superseding it by another millisecond
	// (which would leave the apparent immediate rebuild just out of reach). An
	// elapsed token is never reused: the unique-token path below preserves the
	// stale-worker ABA protection.
	const activeUrgentToken = families.list
		? manifest?.listRefreshUrgency === 'urgent' &&
			manifest.listRefreshScheduledAt !== undefined &&
			manifest.listRefreshScheduledAt > now
			? manifest.listRefreshScheduledAt
			: undefined
		: manifest?.relationsRefreshUrgency === 'urgent' &&
			  manifest.relationsRefreshScheduledAt !== undefined &&
			  manifest.relationsRefreshScheduledAt > now
			? manifest.relationsRefreshScheduledAt
			: undefined;
	const scheduledAt = activeUrgentToken ?? uniqueImmediateRefreshToken(manifest, now);
	const patch = {
		...(families.list
			? {
					listReady: false,
					listWithdrawalEpoch: publishesListWithdrawal
						? nextPublicDiscoveryWithdrawalEpoch(manifest, 'list')
						: publicDiscoveryWithdrawalEpoch(manifest, 'list'),
					listRetiredRevision: Math.max(
						manifest?.listRetiredRevision ?? 0,
						manifest?.listRevision ?? 0
					),
					listDirtyAt: now,
					listRefreshScheduledAt: scheduledAt,
					listRefreshUrgency: 'urgent' as const
				}
			: {}),
		...(families.relations
			? {
					relationsReady: false,
					relationsWithdrawalEpoch: publishesRelationsWithdrawal
						? nextPublicDiscoveryWithdrawalEpoch(manifest, 'relations')
						: publicDiscoveryWithdrawalEpoch(manifest, 'relations'),
					relationsRetiredRevision: Math.max(
						manifest?.relationsRetiredRevision ?? 0,
						manifest?.relationsRevision ?? 0
					),
					relationsDirtyAt: now,
					relationsRefreshScheduledAt: scheduledAt,
					relationsRefreshUrgency: 'urgent' as const
				}
			: {})
	};

	if (manifest) {
		await ctx.db.patch(manifest._id, patch);
		await syncPublicDiscoveryManifestAuthorityIfActive(ctx, { ...manifest, ...patch });
	} else {
		const inserted = {
			...manifestInsertBase(),
			...patch
		};
		await ctx.db.insert('publicDiscoveryManifest', inserted);
		await syncPublicDiscoveryManifestAuthorityIfActive(ctx, inserted);
	}
	if (publishesNewWithdrawal) await schedulePublicDiscoveryManifestControlPush(ctx);

	if (families.list) {
		await scheduleListRefresh(ctx, scheduledAt, now, true);
	} else if (families.relations) {
		await scheduleRelationsRefresh(ctx, scheduledAt, now, true);
	}
	return { scheduledAt };
}

/**
 * Begin a multi-mutation replacement without exposing stale or partial data.
 * Existing publication jobs are superseded. The owning action must publish
 * once after every source mutation is complete; the only queued work here is
 * one owner-fenced lease watchdog, which can alert but never publish or unlock.
 */
export async function invalidatePublicDiscoveryForCoordinatedRebuild(
	ctx: MutationCtx,
	families: { list: boolean; relations: boolean },
	coordinatedRebuildToken: string,
	now = Date.now(),
	operation?: { kind: PublicDiscoveryCoordinatedRebuildKind; attempt?: number }
): Promise<void> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	const publishesListWithdrawal = families.list && manifest?.listReady === true;
	const publishesRelationsWithdrawal = families.relations && manifest?.relationsReady === true;
	const publishesNewWithdrawal = publishesListWithdrawal || publishesRelationsWithdrawal;
	const takesOverStaleLease = manifest?.coordinatedRebuildToken !== undefined;
	if (takesOverStaleLease && !publicDiscoveryCoordinatedRebuildIsStale(manifest, now)) {
		throw new Error(PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED);
	}
	if (coordinatedRebuildToken.length === 0) {
		throw new Error(PUBLIC_DISCOVERY_COORDINATED_REBUILD_TOKEN_MISMATCH);
	}
	const minimumAttempt = takesOverStaleLease ? (manifest?.coordinatedRebuildAttempt ?? 1) + 1 : 1;
	const coordinatedRebuildAttempt = Math.max(minimumAttempt, operation?.attempt ?? minimumAttempt);
	const coordinatedRebuildLeaseExpiresAt = now + PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS;
	const patch = {
		coordinatedRebuildToken,
		coordinatedRebuildStartedAt: now,
		coordinatedRebuildKind: operation?.kind,
		coordinatedRebuildLeaseExpiresAt,
		coordinatedRebuildAttempt,
		coordinatedRebuildWatchdogScheduledAt: coordinatedRebuildLeaseExpiresAt,
		coordinatedRebuildRetryAt: undefined,
		coordinatedRebuildFailureAt: undefined,
		coordinatedRebuildFailureCode: undefined,
		...(families.list
			? {
					listReady: false,
					listWithdrawalEpoch: publishesListWithdrawal
						? nextPublicDiscoveryWithdrawalEpoch(manifest, 'list')
						: publicDiscoveryWithdrawalEpoch(manifest, 'list'),
					listRetiredRevision: Math.max(
						manifest?.listRetiredRevision ?? 0,
						manifest?.listRevision ?? 0
					),
					listDirtyAt: now,
					listRefreshScheduledAt: undefined
				}
			: {}),
		...(families.relations
			? {
					relationsReady: false,
					relationsWithdrawalEpoch: publishesRelationsWithdrawal
						? nextPublicDiscoveryWithdrawalEpoch(manifest, 'relations')
						: publicDiscoveryWithdrawalEpoch(manifest, 'relations'),
					relationsRetiredRevision: Math.max(
						manifest?.relationsRetiredRevision ?? 0,
						manifest?.relationsRevision ?? 0
					),
					relationsDirtyAt: now,
					relationsRefreshScheduledAt: undefined
				}
			: {})
	};

	if (manifest) {
		await ctx.db.patch(manifest._id, patch);
		await syncPublicDiscoveryManifestAuthorityIfActive(ctx, { ...manifest, ...patch });
	} else {
		const inserted = {
			...manifestInsertBase(),
			...patch
		};
		await ctx.db.insert('publicDiscoveryManifest', inserted);
		await syncPublicDiscoveryManifestAuthorityIfActive(ctx, inserted);
	}
	await ctx.scheduler.runAt(
		coordinatedRebuildLeaseExpiresAt,
		superviseCoordinatedPublicDiscoveryRebuildWatchdogRef,
		{
			coordinatedRebuildToken,
			coordinatedRebuildAttempt,
			scheduledAt: coordinatedRebuildLeaseExpiresAt
		}
	);
	if (publishesNewWithdrawal) await schedulePublicDiscoveryManifestControlPush(ctx);
}

/** Release a coordinated lock only after both families published successfully. */
export async function completePublicDiscoveryCoordinatedRebuild(
	ctx: MutationCtx,
	coordinatedRebuildToken: string
): Promise<void> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	if (!manifest || manifest.coordinatedRebuildToken !== coordinatedRebuildToken) {
		throw new Error(PUBLIC_DISCOVERY_COORDINATED_REBUILD_TOKEN_MISMATCH);
	}
	if (!manifest.listReady || !manifest.relationsReady) {
		throw new Error('PUBLIC_DISCOVERY_COORDINATED_REBUILD_INCOMPLETE');
	}
	await ctx.db.patch(manifest._id, {
		coordinatedRebuildToken: undefined,
		coordinatedRebuildStartedAt: undefined,
		coordinatedRebuildKind: undefined,
		coordinatedRebuildLeaseExpiresAt: undefined,
		coordinatedRebuildAttempt: undefined,
		coordinatedRebuildWatchdogScheduledAt: undefined,
		coordinatedRebuildRetryAt: undefined,
		coordinatedRebuildFailureAt: undefined,
		coordinatedRebuildFailureCode: undefined,
		listRefreshScheduledAt: undefined,
		relationsRefreshScheduledAt: undefined
	});
}

type PublicDiscoveryRefreshPatch = {
	listDirtyAt?: number;
	listRefreshScheduledAt?: number;
	listRefreshUrgency?: 'prompt' | 'urgent';
	relationsDirtyAt?: number;
	relationsRefreshScheduledAt?: number;
};

type RefreshPlan = {
	result: { scheduled: boolean; scheduledAt: number };
	patch: PublicDiscoveryRefreshPatch;
	shouldSchedule: boolean;
	urgent: boolean;
};

function planListRefresh(
	manifest: Manifest | null,
	now: number,
	priority: PublicDiscoveryListRefreshPriority
): RefreshPlan {
	const existingScheduledAt = manifest?.listRefreshScheduledAt;
	const listRefreshUrgency = requestedListRefreshUrgency(manifest, priority);
	const urgencyState = manifest
		? { ...manifest, listRefreshUrgency }
		: ({ listRefreshUrgency } as PublicDiscoveryRefreshUrgencyState);
	const urgent = publicDiscoveryListRefreshBypassesMinInterval(urgencyState);
	// Composite ownership does not itself grant a cost-floor bypass. Ordinary
	// list+relation work coalesces at the shared six-hour floor; only destructive
	// urgency is immediate. Prompt list authoring remains a one-minute bypass and
	// deliberately leaves ordinary relation work on its independent token.
	const immediate =
		listRefreshUrgency === 'urgent' ||
		(urgencyState.relationsDirtyAt !== undefined &&
			urgencyState.relationsRefreshUrgency === 'urgent');
	const desiredScheduledAt = immediate
		? uniqueImmediateRefreshToken(manifest, now)
		: urgent
			? now + PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS
			: Math.max(
					now + PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS,
					(manifest?.listUpdatedAt ?? 0) + PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS
				);
	if (
		manifest &&
		existingScheduledAt !== undefined &&
		existingScheduledAt > now &&
		existingScheduledAt <= desiredScheduledAt
	) {
		return {
			result: { scheduled: false, scheduledAt: existingScheduledAt },
			patch: {
				...(manifest.listDirtyAt === undefined ? { listDirtyAt: now } : {}),
				...(manifest.listRefreshUrgency !== listRefreshUrgency && listRefreshUrgency !== undefined
					? { listRefreshUrgency }
					: {})
			},
			shouldSchedule: false,
			urgent
		};
	}

	const scheduledAt = desiredScheduledAt;
	return {
		result: { scheduled: true, scheduledAt },
		patch: {
			listDirtyAt: immediate ? (manifest?.listDirtyAt ?? now) : now,
			listRefreshScheduledAt: scheduledAt,
			...(listRefreshUrgency !== undefined ? { listRefreshUrgency } : {})
		},
		shouldSchedule: true,
		urgent
	};
}

function planRelationsRefresh(manifest: Manifest | null, now: number): RefreshPlan {
	const existingScheduledAt = manifest?.relationsRefreshScheduledAt;
	const urgent = publicDiscoveryRelationsRefreshBypassesMinInterval(manifest);
	if (manifest && existingScheduledAt !== undefined && existingScheduledAt > now) {
		return {
			result: { scheduled: false, scheduledAt: existingScheduledAt },
			patch: manifest.relationsDirtyAt === undefined ? { relationsDirtyAt: now } : {},
			shouldSchedule: false,
			urgent
		};
	}

	const scheduledAt = urgent
		? uniqueImmediateRefreshToken(manifest, now)
		: Math.max(
				now + PUBLIC_DISCOVERY_RELATIONS_DEBOUNCE_MS,
				(manifest?.relationsUpdatedAt ?? 0) + PUBLIC_DISCOVERY_RELATIONS_MIN_REBUILD_INTERVAL_MS
			);
	return {
		result: { scheduled: true, scheduledAt },
		patch: {
			relationsDirtyAt: urgent ? (manifest?.relationsDirtyAt ?? now) : now,
			relationsRefreshScheduledAt: scheduledAt
		},
		shouldSchedule: true,
		urgent
	};
}

async function markPublicDiscoveryFamiliesDirty(
	ctx: MutationCtx,
	families: { list: boolean; relations: boolean },
	now: number,
	listFreshness: PublicDiscoveryListFreshnessClass = 'aggregate'
): Promise<{
	list?: { scheduled: boolean; scheduledAt: number };
	relations?: { scheduled: boolean; scheduledAt: number };
}> {
	// LOAD-BEARING NO-DROP READ: even when an existing future token makes the
	// resulting patch empty, this unconditional singleton read must stay in the
	// transaction read set so Convex OCC serializes it with an eligible flush.
	// The corresponding list scanner's membership cutoff is also load-bearing:
	// it must remain the bounded `by_status_isPublic` range in descending
	// `_creationTime` order. A score/reach sort could promote an unread row into
	// the top 50 and would invalidate the range-read OCC proof below.
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	// Every projection writer calls this helper before its mutation commits. A
	// throw therefore rolls back the source write instead of letting it escape a
	// coordinated clear/reseed and race the token-authorized final publication.
	if (manifest?.coordinatedRebuildToken !== undefined) {
		throw new Error(PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED);
	}
	const listPlan = families.list
		? planListRefresh(manifest, now, listRefreshPriority(listFreshness))
		: undefined;
	const relationsPlan = families.relations ? planRelationsRefresh(manifest, now) : undefined;
	const patch = {
		...(listPlan?.patch ?? {}),
		...(relationsPlan?.patch ?? {})
	};

	if (manifest) {
		// An empty patch is possible only while every requested family already
		// owns a strictly-future token (`scheduledAt > now`). Its flush cannot yet
		// be scanning: a scheduled function becomes eligible no earlier than that
		// token. At the token boundary (`scheduledAt <= now`) planning MUST create
		// and patch a successor token, which restores the manifest OCC conflict for
		// either serialization order around an eligible scanner.
		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(manifest._id, patch);
		}
	} else {
		const inserted = {
			...manifestInsertBase(),
			...patch
		};
		await ctx.db.insert('publicDiscoveryManifest', inserted);
		await syncPublicDiscoveryManifestAuthorityIfActive(ctx, inserted);
	}

	if (listPlan?.shouldSchedule) {
		await scheduleListRefresh(ctx, listPlan.result.scheduledAt, now, listPlan.urgent);
	}
	if (relationsPlan?.shouldSchedule) {
		await scheduleRelationsRefresh(
			ctx,
			relationsPlan.result.scheduledAt,
			now,
			relationsPlan.urgent
		);
	}

	return {
		...(listPlan ? { list: listPlan.result } : {}),
		...(relationsPlan ? { relations: relationsPlan.result } : {})
	};
}

/**
 * Convex mutations commit under serializable optimistic concurrency control.
 * That guarantee is load-bearing here: after the first writer sets a dirty bit
 * and owns a scheduled token, later writers intentionally avoid another
 * manifest patch. A flush range-reads the source index in its own transaction;
 * a source write that commits across that read either serializes before the
 * flush (and is included) or after it (and retains/schedules the next dirty
 * generation). Convex retries a conflicting flush rather than letting it clear
 * a generation whose source write was omitted.
 *
 * The no-drop property is exactly equivalent to every projection-affecting
 * source write calling the matching dirty helper in the same mutation. Moving
 * either side outside that transaction, or adding a new writer without the
 * helper, invalidates the argument. The CI writer-contract ratchet inventories
 * the current mutation boundaries and pins the newest-first range membership;
 * new projection fields/writers or a new ranking rule must extend that proof.
 *
 * Mark the list payload dirty and ensure exactly one bounded refresh job owns
 * the current window. Every caller writes only this singleton; duplicate writes
 * reuse the same scheduled token.
 */
export async function markPublicDiscoveryListDirty(
	ctx: MutationCtx,
	freshnessClass: PublicDiscoveryListFreshnessClass,
	now = Date.now()
): Promise<{ scheduled: boolean; scheduledAt: number }> {
	const result = await markPublicDiscoveryFamiliesDirty(
		ctx,
		{ list: true, relations: false },
		now,
		freshnessClass
	);
	return result.list!;
}

/**
 * Mark the embedding-heavy relation payload dirty without rebuilding it on the
 * writer's transaction. Repeated topic/tag writes share one scheduled token.
 */
export async function markPublicDiscoveryRelationsDirty(
	ctx: MutationCtx,
	now = Date.now()
): Promise<{ scheduled: boolean; scheduledAt: number }> {
	const result = await markPublicDiscoveryFamiliesDirty(ctx, { list: false, relations: true }, now);
	return result.relations!;
}

/** Dirty both snapshot families with one singleton read and at most one patch. */
export async function markPublicDiscoveryListAndRelationsDirty(
	ctx: MutationCtx,
	listFreshnessClass: PublicDiscoveryListFreshnessClass,
	now = Date.now()
): Promise<{
	list: { scheduled: boolean; scheduledAt: number };
	relations: { scheduled: boolean; scheduledAt: number };
}> {
	const result = await markPublicDiscoveryFamiliesDirty(
		ctx,
		{ list: true, relations: true },
		now,
		listFreshnessClass
	);
	return { list: result.list!, relations: result.relations! };
}

/** Replace the current job token with a later one after a bounded deferral. */
export async function reschedulePublicDiscoveryListRefresh(
	ctx: MutationCtx,
	manifest: Manifest,
	now: number,
	nextAt: number
): Promise<number> {
	const scheduledAt = Math.max(nextAt, now + PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS);
	await ctx.db.patch(manifest._id, { listRefreshScheduledAt: scheduledAt });
	await scheduleListRefresh(
		ctx,
		scheduledAt,
		now,
		publicDiscoveryListRefreshBypassesMinInterval(manifest)
	);
	return scheduledAt;
}

/** Replace the current relation job token after a bounded deferral. */
export async function reschedulePublicDiscoveryRelationsRefresh(
	ctx: MutationCtx,
	manifest: Manifest,
	now: number,
	nextAt: number
): Promise<number> {
	const scheduledAt = Math.max(nextAt, now + PUBLIC_DISCOVERY_RELATIONS_DEBOUNCE_MS);
	await ctx.db.patch(manifest._id, { relationsRefreshScheduledAt: scheduledAt });
	await scheduleRelationsRefresh(
		ctx,
		scheduledAt,
		now,
		publicDiscoveryRelationsRefreshBypassesMinInterval(manifest)
	);
	return scheduledAt;
}
