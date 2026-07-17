import { makeFunctionReference } from 'convex/server';
import type { FunctionReference } from 'convex/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export const PUBLIC_DISCOVERY_MANIFEST_KEY = 'public' as const;

/** First dirty write owns one bounded coalescing window. */
export const PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS = 60 * 1000;
export const PUBLIC_DISCOVERY_RELATIONS_DEBOUNCE_MS = 60 * 1000;

/**
 * The list materialization is deliberately expensive relative to its tiny
 * manifest. Event-driven refreshes therefore cannot run more than once per six
 * hours. Operator, cron, and first-embedding composite rebuilds remain explicit
 * bypasses and publish immediately.
 */
export const PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const PUBLIC_DISCOVERY_RELATIONS_MIN_REBUILD_INTERVAL_MS = 6 * 60 * 60 * 1000;

type Manifest = Doc<'publicDiscoveryManifest'>;

type ScheduledListRefreshArgs = { scheduledAt: number };
type ScheduledRelationsRefreshArgs = { scheduledAt: number };

const flushScheduledListRefreshRef = makeFunctionReference<'mutation'>(
	'templates:flushScheduledPublicTemplateRefresh'
) as unknown as FunctionReference<'mutation', 'internal', ScheduledListRefreshArgs, unknown>;

const flushScheduledRelationsRefreshRef = makeFunctionReference<'mutation'>(
	'templates:flushScheduledPublicTemplateRelationsRefresh'
) as unknown as FunctionReference<'mutation', 'internal', ScheduledRelationsRefreshArgs, unknown>;

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

/** Reserve (without publishing) the revision a list rebuild will own. */
export async function preparePublicDiscoveryListPublication(
	ctx: MutationCtx,
	updatedAt = Date.now()
): Promise<{ revision: number; updatedAt: number }> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	return { revision: (manifest?.listRevision ?? 0) + 1, updatedAt };
}

/** Mark a fully-written pair of list snapshots as the new public revision. */
export async function commitPublicDiscoveryListPublication(
	ctx: MutationCtx,
	publication: { revision: number; updatedAt: number }
): Promise<void> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	if (manifest) {
		await ctx.db.patch(manifest._id, {
			listReady: true,
			listRevision: publication.revision,
			listUpdatedAt: publication.updatedAt,
			listDirtyAt: undefined
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
	updatedAt = Date.now()
): Promise<{ revision: number; updatedAt: number }> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	return { revision: (manifest?.relationsRevision ?? 0) + 1, updatedAt };
}

/** Mark a fully-written relation snapshot as the new public revision. */
export async function commitPublicDiscoveryRelationsPublication(
	ctx: MutationCtx,
	publication: { revision: number; updatedAt: number }
): Promise<void> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	if (manifest) {
		await ctx.db.patch(manifest._id, {
			relationsReady: true,
			relationsRevision: publication.revision,
			relationsUpdatedAt: publication.updatedAt,
			relationsDirtyAt: undefined
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
	now: number
): Promise<Id<'_scheduled_functions'>> {
	return await ctx.scheduler.runAfter(
		Math.max(0, scheduledAt - now),
		flushScheduledListRefreshRef,
		{ scheduledAt }
	);
}

async function scheduleRelationsRefresh(
	ctx: MutationCtx,
	scheduledAt: number,
	now: number
): Promise<Id<'_scheduled_functions'>> {
	return await ctx.scheduler.runAfter(
		Math.max(0, scheduledAt - now),
		flushScheduledRelationsRefreshRef,
		{ scheduledAt }
	);
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
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	const listPlan = families.list ? planListRefresh(manifest, now) : undefined;
	const relationsPlan = families.relations ? planRelationsRefresh(manifest, now) : undefined;
	const patch = {
		...(listPlan?.patch ?? {}),
		...(relationsPlan?.patch ?? {})
	};

	if (manifest) {
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
