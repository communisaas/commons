import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import {
	PUBLIC_DISCOVERY_MANIFEST_FRESH_MS,
	PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS,
	getCachedPublicData
} from '$lib/server/public-discovery-cache';

type PublicQueryContext = {
	url: URL;
	platform?: App.Platform;
};

type SnapshotFamily = 'list' | 'relations';

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

/**
 * The control-plane query reads one tiny singleton. Its one-minute edge TTL is
 * the upper bound on cache invalidation propagation; Convex's own query cache
 * makes unchanged manifest reads database-bandwidth-free.
 */
export function getCachedPublicDiscoveryManifest(context: PublicQueryContext) {
	return getCachedPublicData(
		'manifest',
		{
			...context,
			freshForMs: PUBLIC_DISCOVERY_MANIFEST_FRESH_MS,
			refreshMode: 'blocking'
		},
		() => serverQuery(api.templates.publicDiscoveryManifest, {})
	);
}

/** Cached public template cards, separated by the congressional visibility gate. */
export async function getCachedPublicTemplates(context: PublicQueryContext, excludeCwc: boolean) {
	const manifest = await getCachedPublicDiscoveryManifest(context);
	if (!manifest.list.ready) throw new PublicDiscoverySnapshotNotReadyError('list');

	return getCachedPublicData(
		`templates:exclude-cwc=${excludeCwc ? '1' : '0'}`,
		{
			...context,
			freshForMs: PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS,
			revision: snapshotGeneration(manifest.list.revision, manifest.list.updatedAt)
		},
		async () => {
			const snapshot = await serverQuery(api.templates.publicDiscoveryList, { excludeCwc });
			if (
				snapshot.revision !== manifest.list.revision ||
				snapshot.updatedAt !== manifest.list.updatedAt
			) {
				throw new Error(
					`PUBLIC_DISCOVERY_GENERATION_MISMATCH:list:${snapshot.revision}:${snapshot.updatedAt}:${manifest.list.revision}:${manifest.list.updatedAt}`
				);
			}
			return snapshot.templates;
		}
	);
}

/**
 * One cache entry and one Convex snapshot read for the graph's twin + concept
 * relations. The embedded row revision is checked before the value can become
 * a last-known-good cache entry.
 */
export async function getCachedPublicRelations(context: PublicQueryContext) {
	const manifest = await getCachedPublicDiscoveryManifest(context);
	if (!manifest.relations.ready) {
		throw new PublicDiscoverySnapshotNotReadyError('relations');
	}

	const expectedRevision = manifest.relations.revision;
	return getCachedPublicData(
		'relations:combined',
		{
			...context,
			freshForMs: PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS,
			revision: snapshotGeneration(expectedRevision, manifest.relations.updatedAt)
		},
		async () => {
			const snapshot = await serverQuery(api.templates.publicDiscoveryRelations, {});
			if (
				snapshot.revision !== expectedRevision ||
				snapshot.updatedAt !== manifest.relations.updatedAt
			) {
				throw new Error(
					`PUBLIC_DISCOVERY_GENERATION_MISMATCH:relations:${snapshot.revision}:${snapshot.updatedAt}:${expectedRevision}:${manifest.relations.updatedAt}`
				);
			}
			return snapshot;
		}
	);
}

/** Compatibility selectors for non-homepage callers. They share one cache fill. */
export async function getCachedRelatednessEdges(context: PublicQueryContext) {
	return (await getCachedPublicRelations(context)).twinEdges;
}

export async function getCachedConceptRelations(context: PublicQueryContext) {
	return (await getCachedPublicRelations(context)).conceptRelations;
}
