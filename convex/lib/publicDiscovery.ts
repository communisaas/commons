import { makeFunctionReference } from 'convex/server';
import type { FunctionReference } from 'convex/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export const PUBLIC_DISCOVERY_MANIFEST_KEY = 'public' as const;

/** First dirty write owns one bounded coalescing window. */
export const PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS = 60 * 1000;

/**
 * The list materialization is deliberately expensive relative to its tiny
 * manifest. Event-driven refreshes therefore cannot run more than once per six
 * hours. Operator, cron, and first-embedding composite rebuilds remain explicit
 * bypasses and publish immediately.
 */
export const PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS = 6 * 60 * 60 * 1000;

type Manifest = Doc<'publicDiscoveryManifest'>;

type ScheduledListRefreshArgs = { scheduledAt: number };

const flushScheduledListRefreshRef = makeFunctionReference<'mutation'>(
	'templates:flushScheduledPublicTemplateRefresh'
) as unknown as FunctionReference<'mutation', 'internal', ScheduledListRefreshArgs, unknown>;

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
			relationsUpdatedAt: publication.updatedAt
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

/**
 * Mark the list payload dirty and ensure exactly one bounded refresh job owns
 * the current window. Every caller writes only this singleton; duplicate writes
 * reuse the same scheduled token.
 */
export async function markPublicDiscoveryListDirty(
	ctx: MutationCtx,
	now = Date.now()
): Promise<{ scheduled: boolean; scheduledAt: number }> {
	const manifest = await getPublicDiscoveryManifestRow(ctx);
	const existingScheduledAt = manifest?.listRefreshScheduledAt;
	if (manifest && existingScheduledAt !== undefined && existingScheduledAt > now) {
		// The first write already made the singleton dirty. Avoid patching the same
		// hot row for every reach/debate event in the coalescing window. A direct
		// publish clears `listDirtyAt` but deliberately leaves its old token alive;
		// the first subsequent write restores dirty state here.
		if (manifest.listDirtyAt === undefined) {
			await ctx.db.patch(manifest._id, { listDirtyAt: now });
		}
		return { scheduled: false, scheduledAt: existingScheduledAt };
	}

	const nextAllowedAt =
		(manifest?.listUpdatedAt ?? 0) + PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS;
	const scheduledAt = Math.max(now + PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS, nextAllowedAt);

	if (manifest) {
		await ctx.db.patch(manifest._id, {
			listDirtyAt: now,
			listRefreshScheduledAt: scheduledAt
		});
	} else {
		await ctx.db.insert('publicDiscoveryManifest', {
			...manifestInsertBase(),
			listDirtyAt: now,
			listRefreshScheduledAt: scheduledAt
		});
	}

	await scheduleListRefresh(ctx, scheduledAt, now);
	return { scheduled: true, scheduledAt };
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
