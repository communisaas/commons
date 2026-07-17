import { makeFunctionReference } from 'convex/server';
import type { FunctionReference } from 'convex/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export const PUBLIC_DISCOVERY_MANIFEST_KEY = 'public' as const;
export const PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED =
	'PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED' as const;
export const PUBLIC_DISCOVERY_COORDINATED_REBUILD_TOKEN_MISMATCH =
	'PUBLIC_DISCOVERY_COORDINATED_REBUILD_TOKEN_MISMATCH' as const;
/** Long enough for the seed actions, bounded so an interrupted action is retryable. */
export const PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS = 30 * 60 * 1000;

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
 * The list materialization is deliberately expensive relative to its tiny
 * manifest. Event-driven refreshes therefore cannot run more than once per six
 * hours. Operator and cron composite rebuilds remain explicit bypasses and
 * publish immediately.
 */
export const PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const PUBLIC_DISCOVERY_RELATIONS_MIN_REBUILD_INTERVAL_MS = 6 * 60 * 60 * 1000;

type Manifest = Doc<'publicDiscoveryManifest'>;

type PublicDiscoveryPublication = {
	revision: number;
	updatedAt: number;
	coordinatedRebuildToken?: string;
};

type ScheduledListRefreshArgs = { scheduledAt: number; bypassMinInterval?: boolean };
type ScheduledRelationsRefreshArgs = { scheduledAt: number; bypassMinInterval?: boolean };

const flushScheduledListRefreshRef = makeFunctionReference<'action'>(
	'templates:superviseScheduledPublicTemplateRefresh'
) as unknown as FunctionReference<'action', 'internal', ScheduledListRefreshArgs, unknown>;

const flushScheduledRelationsRefreshRef = makeFunctionReference<'action'>(
	'templates:superviseScheduledPublicTemplateRelationsRefresh'
) as unknown as FunctionReference<'action', 'internal', ScheduledRelationsRefreshArgs, unknown>;

export type PublicDiscoveryManifestPayload = {
	list: {
		ready: boolean;
		revision: number;
		updatedAt: number | null;
	};
	relations: {
		ready: boolean;
		revision: number;
		updatedAt: number | null;
	};
};

export const COLD_PUBLIC_DISCOVERY_MANIFEST: PublicDiscoveryManifestPayload = {
	list: { ready: false, revision: 0, updatedAt: null },
	relations: { ready: false, revision: 0, updatedAt: null }
};

export function toPublicDiscoveryManifestPayload(
	manifest: Manifest | null
): PublicDiscoveryManifestPayload {
	if (!manifest) return COLD_PUBLIC_DISCOVERY_MANIFEST;
	return {
		list: {
			ready: manifest.listReady,
			revision: manifest.listRevision,
			updatedAt: manifest.listUpdatedAt ?? null
		},
		relations: {
			ready: manifest.relationsReady,
			revision: manifest.relationsRevision,
			updatedAt: manifest.relationsUpdatedAt ?? null
		}
	};
}

export async function getPublicDiscoveryManifestRow(ctx: MutationCtx): Promise<Manifest | null> {
	return await ctx.db
		.query('publicDiscoveryManifest')
		.withIndex('by_key', (q) => q.eq('key', PUBLIC_DISCOVERY_MANIFEST_KEY))
		.unique();
}

function manifestInsertBase(): Omit<Manifest, '_id' | '_creationTime'> {
	return {
		key: PUBLIC_DISCOVERY_MANIFEST_KEY,
		listReady: false,
		relationsReady: false,
		listRevision: 0,
		relationsRevision: 0
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
		await ctx.db.patch(manifest._id, {
			listReady: true,
			listRevision: publication.revision,
			listUpdatedAt: publication.updatedAt,
			listDirtyAt: undefined,
			listFailureAt: undefined,
			listFailureCode: undefined
		});
		return;
	}

	await ctx.db.insert('publicDiscoveryManifest', {
		...manifestInsertBase(),
		listReady: true,
		listRevision: publication.revision,
		listUpdatedAt: publication.updatedAt
	});
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
		await ctx.db.patch(manifest._id, {
			relationsReady: true,
			relationsRevision: publication.revision,
			relationsUpdatedAt: publication.updatedAt,
			relationsDirtyAt: undefined,
			relationsFailureAt: undefined,
			relationsFailureCode: undefined
		});
		return;
	}

	await ctx.db.insert('publicDiscoveryManifest', {
		...manifestInsertBase(),
		relationsReady: true,
		relationsRevision: publication.revision,
		relationsUpdatedAt: publication.updatedAt
	});
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
		manifest?.relationsRefreshScheduledAt
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
	if (manifest?.coordinatedRebuildToken !== undefined) {
		throw new Error(PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED);
	}
	const scheduledAt = uniqueImmediateRefreshToken(manifest, now);
	const patch = {
		...(families.list
			? {
					listReady: false,
					listDirtyAt: now,
					listRefreshScheduledAt: scheduledAt
				}
			: {}),
		...(families.relations
			? {
					relationsReady: false,
					relationsDirtyAt: now,
					relationsRefreshScheduledAt: scheduledAt
				}
			: {})
	};

	if (manifest) {
		await ctx.db.patch(manifest._id, patch);
	} else {
		await ctx.db.insert('publicDiscoveryManifest', {
			...manifestInsertBase(),
			...patch
		});
	}

	if (families.list) {
		await scheduleListRefresh(ctx, scheduledAt, now, true);
	} else if (families.relations) {
		await scheduleRelationsRefresh(ctx, scheduledAt, now, true);
	}
	return { scheduledAt };
}

/**
 * Begin a multi-mutation replacement without exposing stale or partial data.
 * Existing jobs are superseded, but no replacement job is queued: the owning
 * action must publish once after every source mutation is complete.
 */
export async function invalidatePublicDiscoveryForCoordinatedRebuild(
	ctx: MutationCtx,
	families: { list: boolean; relations: boolean },
	coordinatedRebuildToken: string,
	now = Date.now()
): Promise<void> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	if (manifest?.coordinatedRebuildToken !== undefined) {
		const startedAt = manifest.coordinatedRebuildStartedAt;
		if (
			startedAt === undefined ||
			now < startedAt + PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS
		) {
			throw new Error(PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED);
		}
	}
	if (coordinatedRebuildToken.length === 0) {
		throw new Error(PUBLIC_DISCOVERY_COORDINATED_REBUILD_TOKEN_MISMATCH);
	}
	const patch = {
		coordinatedRebuildToken,
		coordinatedRebuildStartedAt: now,
		...(families.list
			? {
					listReady: false,
					listDirtyAt: now,
					listRefreshScheduledAt: undefined
				}
			: {}),
		...(families.relations
			? {
					relationsReady: false,
					relationsDirtyAt: now,
					relationsRefreshScheduledAt: undefined
				}
			: {})
	};

	if (manifest) {
		await ctx.db.patch(manifest._id, patch);
	} else {
		await ctx.db.insert('publicDiscoveryManifest', {
			...manifestInsertBase(),
			...patch
		});
	}
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
		listRefreshScheduledAt: undefined,
		relationsRefreshScheduledAt: undefined
	});
}

type PublicDiscoveryRefreshPatch = {
	listDirtyAt?: number;
	listRefreshScheduledAt?: number;
	relationsDirtyAt?: number;
	relationsRefreshScheduledAt?: number;
};

type RefreshPlan = {
	result: { scheduled: boolean; scheduledAt: number };
	patch: PublicDiscoveryRefreshPatch;
	shouldSchedule: boolean;
};

function planListRefresh(manifest: Manifest | null, now: number): RefreshPlan {
	const existingScheduledAt = manifest?.listRefreshScheduledAt;
	if (manifest && existingScheduledAt !== undefined && existingScheduledAt > now) {
		return {
			result: { scheduled: false, scheduledAt: existingScheduledAt },
			patch: manifest.listDirtyAt === undefined ? { listDirtyAt: now } : {},
			shouldSchedule: false
		};
	}

	const nextAllowedAt =
		(manifest?.listUpdatedAt ?? 0) + PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS;
	const scheduledAt = Math.max(now + PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS, nextAllowedAt);
	return {
		result: { scheduled: true, scheduledAt },
		patch: { listDirtyAt: now, listRefreshScheduledAt: scheduledAt },
		shouldSchedule: true
	};
}

function planRelationsRefresh(manifest: Manifest | null, now: number): RefreshPlan {
	const existingScheduledAt = manifest?.relationsRefreshScheduledAt;
	if (manifest && existingScheduledAt !== undefined && existingScheduledAt > now) {
		return {
			result: { scheduled: false, scheduledAt: existingScheduledAt },
			patch: manifest.relationsDirtyAt === undefined ? { relationsDirtyAt: now } : {},
			shouldSchedule: false
		};
	}

	const nextAllowedAt =
		(manifest?.relationsUpdatedAt ?? 0) + PUBLIC_DISCOVERY_RELATIONS_MIN_REBUILD_INTERVAL_MS;
	const scheduledAt = Math.max(now + PUBLIC_DISCOVERY_RELATIONS_DEBOUNCE_MS, nextAllowedAt);
	return {
		result: { scheduled: true, scheduledAt },
		patch: { relationsDirtyAt: now, relationsRefreshScheduledAt: scheduledAt },
		shouldSchedule: true
	};
}

async function markPublicDiscoveryFamiliesDirty(
	ctx: MutationCtx,
	families: { list: boolean; relations: boolean },
	now: number
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
	const listPlan = families.list ? planListRefresh(manifest, now) : undefined;
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
		await ctx.db.insert('publicDiscoveryManifest', {
			...manifestInsertBase(),
			...patch
		});
	}

	if (listPlan?.shouldSchedule) {
		await scheduleListRefresh(ctx, listPlan.result.scheduledAt, now);
	}
	if (relationsPlan?.shouldSchedule) {
		await scheduleRelationsRefresh(ctx, relationsPlan.result.scheduledAt, now);
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
	now = Date.now()
): Promise<{ scheduled: boolean; scheduledAt: number }> {
	const result = await markPublicDiscoveryFamiliesDirty(ctx, { list: true, relations: false }, now);
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
	now = Date.now()
): Promise<{
	list: { scheduled: boolean; scheduledAt: number };
	relations: { scheduled: boolean; scheduledAt: number };
}> {
	const result = await markPublicDiscoveryFamiliesDirty(ctx, { list: true, relations: true }, now);
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
	await scheduleListRefresh(ctx, scheduledAt, now);
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
	await scheduleRelationsRefresh(ctx, scheduledAt, now);
	return scheduledAt;
}
