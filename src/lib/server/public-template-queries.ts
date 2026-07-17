import { serverQuery } from 'convex-sveltekit';
import type { FunctionReturnType } from 'convex/server';
import { api } from '$lib/convex';
import {
	PUBLIC_DISCOVERY_MANIFEST_FRESH_MS,
	PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS,
	getCachedPublicData,
	getCachedPublicDataLastKnownGood
} from './public-discovery-cache';

type PublicQueryContext = {
	url: URL;
	platform?: App.Platform;
};

type SnapshotFamily = 'list' | 'relations';

type SnapshotCoordinates = {
	revision: number;
	updatedAt: number | null;
};

type PublicDiscoveryManifest = FunctionReturnType<typeof api.templates.publicDiscoveryManifest>;
type PublicTemplateSnapshot = FunctionReturnType<typeof api.templates.publicDiscoveryList>;
type PublicRelationsSnapshot = FunctionReturnType<typeof api.templates.publicDiscoveryRelations>;

function snapshotGeneration(revision: number, updatedAt: number | null): string {
	return `${revision}:${updatedAt ?? 'cold'}`;
}

export class PublicDiscoverySnapshotNotReadyError extends Error {
	readonly family: SnapshotFamily;

	constructor(family: SnapshotFamily) {
		super(`PUBLIC_DISCOVERY_SNAPSHOT_NOT_READY:${family}`);
		this.name = 'PublicDiscoverySnapshotNotReadyError';
		this.family = family;
	}
}

class PublicDiscoveryGenerationMismatchError extends Error {
	readonly family: SnapshotFamily;
	readonly snapshot: unknown;

	constructor(family: SnapshotFamily, snapshot: unknown, expected: SnapshotCoordinates) {
		const actual = snapshot as SnapshotCoordinates;
		super(
			`PUBLIC_DISCOVERY_GENERATION_MISMATCH:${family}:${actual.revision}:${actual.updatedAt}:${expected.revision}:${expected.updatedAt}`
		);
		this.name = 'PublicDiscoveryGenerationMismatchError';
		this.family = family;
		this.snapshot = snapshot;
	}
}

function matchesGeneration(snapshot: SnapshotCoordinates, expected: SnapshotCoordinates): boolean {
	return snapshot.revision === expected.revision && snapshot.updatedAt === expected.updatedAt;
}

/**
 * The control-plane query reads one tiny singleton. Its one-minute edge TTL is
 * the upper bound on cache invalidation propagation; Convex's own query cache
 * makes unchanged manifest reads database-bandwidth-free. `forceRefresh`
 * bypasses this application's cache layers, not Convex's query cache; Convex
 * invalidates that cache when a dependency changes, so it does not add a second
 * time-based staleness window after a committed publication.
 */
export function getCachedPublicDiscoveryManifest(
	context: PublicQueryContext,
	forceRefresh = false
) {
	return getCachedPublicData(
		'manifest',
		{
			...context,
			freshForMs: PUBLIC_DISCOVERY_MANIFEST_FRESH_MS,
			forceRefresh,
			refreshMode: 'blocking'
		},
		() => serverQuery(api.templates.publicDiscoveryManifest, {})
	);
}

async function manifestOrLastKnownGood<T>(
	context: PublicQueryContext,
	logicalKey: string,
	loadManifest: () => Promise<PublicDiscoveryManifest>
): Promise<{ manifest: PublicDiscoveryManifest } | { lkg: T }> {
	try {
		return { manifest: await loadManifest() };
	} catch (error) {
		const lkg = await getCachedPublicDataLastKnownGood<T>(logicalKey, context);
		if (lkg === undefined) throw error;
		console.warn(
			`[public-template-queries] manifest unavailable; serving ${logicalKey} last-known-good:`,
			error instanceof Error ? error.message : String(error)
		);
		return { lkg };
	}
}

async function cacheExpectedSnapshot<TSnapshot extends SnapshotCoordinates, TValue>(
	context: PublicQueryContext,
	logicalKey: string,
	family: SnapshotFamily,
	expected: SnapshotCoordinates,
	loader: () => Promise<TSnapshot>,
	select: (snapshot: TSnapshot) => TValue
): Promise<TValue> {
	return getCachedPublicData(
		logicalKey,
		{
			...context,
			freshForMs: PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS,
			revision: snapshotGeneration(expected.revision, expected.updatedAt),
			// A coordinate mismatch is a benign publication race, not an origin
			// outage. Let the typed error reach the one-retry manifest path instead
			// of hiding it behind an older payload and a 15-minute retry backoff.
			shouldFallbackToStale: (error) => !(error instanceof PublicDiscoveryGenerationMismatchError)
		},
		async () => {
			const snapshot = await loader();
			if (!matchesGeneration(snapshot, expected)) {
				throw new PublicDiscoveryGenerationMismatchError(family, snapshot, expected);
			}
			return select(snapshot);
		}
	);
}

/** Cached public template cards, separated by the congressional visibility gate. */
export async function getCachedPublicTemplates(context: PublicQueryContext, excludeCwc: boolean) {
	const logicalKey = `templates:exclude-cwc=${excludeCwc ? '1' : '0'}`;
	const resolved = await manifestOrLastKnownGood<PublicTemplateSnapshot['templates']>(
		context,
		logicalKey,
		() => getCachedPublicDiscoveryManifest(context)
	);
	if ('lkg' in resolved) return resolved.lkg;
	const { manifest } = resolved;
	if (!manifest.list.ready) throw new PublicDiscoverySnapshotNotReadyError('list');

	const read = (expected: SnapshotCoordinates, prefetched?: unknown) =>
		cacheExpectedSnapshot(
			context,
			logicalKey,
			'list',
			expected,
			async () =>
				(prefetched ??
					(await serverQuery(api.templates.publicDiscoveryList, {
						excludeCwc
					}))) as PublicTemplateSnapshot,
			(snapshot) => snapshot.templates
		);

	try {
		return await read(manifest.list);
	} catch (error) {
		if (!(error instanceof PublicDiscoveryGenerationMismatchError) || error.family !== 'list') {
			throw error;
		}
		// Separate manifest and payload queries can straddle one atomic publication.
		// One dependency-invalidated manifest read closes that ordinary race and the
		// observed snapshot is reused when it already matches. If another publication
		// overtakes this bounded retry, fail closed and let the next request retry
		// instead of adding an unbounded read loop during an active publish storm.
		const freshManifest = await getCachedPublicDiscoveryManifest(context, true);
		if (!freshManifest.list.ready) throw new PublicDiscoverySnapshotNotReadyError('list');
		const prefetched = matchesGeneration(error.snapshot as SnapshotCoordinates, freshManifest.list)
			? error.snapshot
			: undefined;
		return read(freshManifest.list, prefetched);
	}
}

/**
 * One cache entry and one Convex snapshot read for the graph's twin + concept
 * relations. The embedded row revision is checked before the value can become
 * a last-known-good cache entry.
 */
export async function getCachedPublicRelations(context: PublicQueryContext, excludeCwc: boolean) {
	const logicalKey = `relations:combined:exclude-cwc=${excludeCwc ? '1' : '0'}`;
	const resolved = await manifestOrLastKnownGood<PublicRelationsSnapshot>(context, logicalKey, () =>
		getCachedPublicDiscoveryManifest(context)
	);
	if ('lkg' in resolved) return resolved.lkg;
	const { manifest } = resolved;
	if (!manifest.relations.ready) {
		throw new PublicDiscoverySnapshotNotReadyError('relations');
	}

	const read = (expected: SnapshotCoordinates, prefetched?: unknown) =>
		cacheExpectedSnapshot(
			context,
			logicalKey,
			'relations',
			expected,
			async () =>
				(prefetched ??
					(await serverQuery(api.templates.publicDiscoveryRelations, {
						excludeCwc
					}))) as PublicRelationsSnapshot,
			(snapshot) => snapshot
		);

	try {
		return await read(manifest.relations);
	} catch (error) {
		if (
			!(error instanceof PublicDiscoveryGenerationMismatchError) ||
			error.family !== 'relations'
		) {
			throw error;
		}
		const freshManifest = await getCachedPublicDiscoveryManifest(context, true);
		if (!freshManifest.relations.ready) {
			throw new PublicDiscoverySnapshotNotReadyError('relations');
		}
		const prefetched = matchesGeneration(
			error.snapshot as SnapshotCoordinates,
			freshManifest.relations
		)
			? error.snapshot
			: undefined;
		return read(freshManifest.relations, prefetched);
	}
}

/** Compatibility selectors for non-homepage callers. They share one cache fill. */
export async function getCachedRelatednessEdges(context: PublicQueryContext, excludeCwc: boolean) {
	return (await getCachedPublicRelations(context, excludeCwc)).twinEdges;
}

export async function getCachedConceptRelations(context: PublicQueryContext, excludeCwc: boolean) {
	return (await getCachedPublicRelations(context, excludeCwc)).conceptRelations;
}
