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
type PublicTemplateCard = PublicTemplateSnapshot['templates'][number];
type ProjectedPublicRelationsSnapshot = {
	revision: number;
	updatedAt: number | null;
	twinEdges: Array<{ a: string; b: string; score: number; kind: 'twin' }>;
	conceptRelations: {
		edges: Array<{ a: string; b: string; concept: string; kind: 'concept' }>;
		conceptMap: Record<string, string>;
	};
};
const PUBLIC_TEMPLATE_PROJECTION_VERSION = 4;
const MAX_PUBLIC_RELATION_EDGES = 10_000;
const MAX_PUBLIC_CONCEPT_ENTRIES = 10_000;

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

export class PublicDiscoverySnapshotContractError extends Error {
	readonly family: SnapshotFamily;

	constructor(detail: string, family: SnapshotFamily = 'list') {
		super(`PUBLIC_DISCOVERY_SNAPSHOT_CONTRACT:${family}:${detail}`);
		this.name = 'PublicDiscoverySnapshotContractError';
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

const PUBLIC_TEMPLATE_FIELDS = [
	'id',
	'slug',
	'title',
	'description',
	'domain',
	'domainHue',
	'topics',
	'type',
	'deliveryMethod',
	'subject',
	'message_body',
	'preview',
	'endorsingOrg',
	'endorsingOrgs',
	'endorsementCount',
	'coordinationScale',
	'isNew',
	'hasActiveDebate',
	'debateSummary',
	'verified_sends',
	'unique_districts',
	'send_count',
	'daily_arrivals',
	'district_counts',
	'tier_counts',
	'delivery_config',
	'cwc_config',
	'recipient_config',
	'recipient_count',
	'campaign_id',
	'status',
	'is_public',
	'jurisdictions',
	'scope',
	'scopes',
	'recipientEmails',
	'createdAt'
] as const satisfies readonly (keyof PublicTemplateCard)[];

// A producer field addition must make this module fail type-check until the
// anonymous allowlist is reviewed. Runtime projection then drops fields from a
// version-skewed or compromised producer instead of promoting them to the LKG.
type MissingPublicTemplateField = Exclude<
	keyof PublicTemplateCard,
	(typeof PUBLIC_TEMPLATE_FIELDS)[number]
>;
const PUBLIC_TEMPLATE_FIELDS_ARE_EXHAUSTIVE: MissingPublicTemplateField extends never
	? true
	: never = true;
void PUBLIC_TEMPLATE_FIELDS_ARE_EXHAUSTIVE;

const PUBLIC_ORG_FIELDS = ['name', 'slug', 'avatar'] as const;
const PUBLIC_DEBATE_FIELDS = [
	'status',
	'winningStance',
	'uniqueParticipants',
	'argumentCount',
	'deadline'
] as const;
const PUBLIC_DISTRICT_COUNT_FIELDS = ['code', 'count'] as const;
const PUBLIC_JURISDICTION_FIELDS = [
	'id',
	'template_id',
	'jurisdiction_type',
	'congressional_district',
	'senate_class',
	'state_code',
	'state_senate_district',
	'state_house_district',
	'county_fips',
	'county_name',
	'city_name',
	'city_fips',
	'school_district_id',
	'school_district_name',
	'latitude',
	'longitude',
	'estimated_population',
	'coverage_notes'
] as const;
const PUBLIC_SCOPE_FIELDS = [
	'id',
	'template_id',
	'country_code',
	'region_code',
	'locality_code',
	'district_code',
	'display_text',
	'scope_level',
	'confidence',
	'extraction_method'
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pickFields(value: unknown, fields: readonly string[]): Record<string, unknown> | null {
	if (!isRecord(value)) return null;
	const projected: Record<string, unknown> = {};
	for (const field of fields) {
		if (Object.prototype.hasOwnProperty.call(value, field)) projected[field] = value[field];
	}
	return projected;
}

function projectObjectArray(value: unknown, fields: readonly string[]): unknown {
	if (!Array.isArray(value)) return value;
	return value.map((item) => pickFields(item, fields) ?? item);
}

/**
 * Construct the anonymous card from an exhaustive allowlist. Unknown producer
 * fields never cross the cache boundary; config-bearing list fields are
 * deliberately normalized because direct-send routes have a separate private,
 * no-store detail projection.
 */
function projectPublicTemplateCard(rawTemplate: unknown, index: number): PublicTemplateCard {
	if (!isRecord(rawTemplate)) {
		throw new PublicDiscoverySnapshotContractError(`unsafe-template:${index}`);
	}
	if (
		rawTemplate.recipient_config !== null ||
		!Array.isArray(rawTemplate.recipientEmails) ||
		rawTemplate.recipientEmails.length !== 0 ||
		typeof rawTemplate.recipient_count !== 'number' ||
		!Number.isSafeInteger(rawTemplate.recipient_count) ||
		rawTemplate.recipient_count < 0
	) {
		throw new PublicDiscoverySnapshotContractError(`unsafe-template:${index}`);
	}

	const projected = pickFields(rawTemplate, PUBLIC_TEMPLATE_FIELDS)!;
	if (rawTemplate.endorsingOrg !== undefined) {
		projected.endorsingOrg =
			rawTemplate.endorsingOrg === null
				? null
				: pickFields(rawTemplate.endorsingOrg, PUBLIC_ORG_FIELDS);
	}
	if (rawTemplate.endorsingOrgs !== undefined) {
		projected.endorsingOrgs = projectObjectArray(rawTemplate.endorsingOrgs, PUBLIC_ORG_FIELDS);
	}
	if (rawTemplate.debateSummary !== undefined) {
		projected.debateSummary = pickFields(rawTemplate.debateSummary, PUBLIC_DEBATE_FIELDS);
	}
	if (rawTemplate.district_counts !== undefined) {
		projected.district_counts = projectObjectArray(
			rawTemplate.district_counts,
			PUBLIC_DISTRICT_COUNT_FIELDS
		);
	}
	if (rawTemplate.jurisdictions !== undefined) {
		projected.jurisdictions = projectObjectArray(
			rawTemplate.jurisdictions,
			PUBLIC_JURISDICTION_FIELDS
		);
	}
	if (rawTemplate.scope !== undefined) {
		projected.scope =
			rawTemplate.scope === null ? null : pickFields(rawTemplate.scope, PUBLIC_SCOPE_FIELDS);
	}
	if (rawTemplate.scopes !== undefined) {
		projected.scopes = projectObjectArray(rawTemplate.scopes, PUBLIC_SCOPE_FIELDS);
	}
	projected.delivery_config = {};
	projected.cwc_config = null;
	projected.recipient_config = null;
	projected.recipientEmails = [];
	return projected as PublicTemplateCard;
}

/** Refuse a legacy or recipient-bearing producer payload before any cache write. */
function projectPublicTemplateSnapshotContract(
	snapshot: PublicTemplateSnapshot
): PublicTemplateSnapshot['templates'] {
	if (snapshot.projectionVersion !== PUBLIC_TEMPLATE_PROJECTION_VERSION) {
		throw new PublicDiscoverySnapshotContractError(
			`projection-version:${String(snapshot.projectionVersion)}`
		);
	}
	if (!Array.isArray(snapshot.templates)) {
		throw new PublicDiscoverySnapshotContractError('templates-not-array');
	}
	return snapshot.templates.map((template, index) => projectPublicTemplateCard(template, index));
}

function projectPublicRelationsSnapshotContract(
	snapshot: PublicRelationsSnapshot
): ProjectedPublicRelationsSnapshot {
	if (
		!Number.isSafeInteger(snapshot.revision) ||
		snapshot.revision < 0 ||
		(snapshot.updatedAt !== null &&
			(typeof snapshot.updatedAt !== 'number' ||
				!Number.isFinite(snapshot.updatedAt) ||
				snapshot.updatedAt < 0)) ||
		!Array.isArray(snapshot.twinEdges) ||
		snapshot.twinEdges.length > MAX_PUBLIC_RELATION_EDGES ||
		!isRecord(snapshot.conceptRelations) ||
		!Array.isArray(snapshot.conceptRelations.edges) ||
		snapshot.conceptRelations.edges.length > MAX_PUBLIC_RELATION_EDGES ||
		!isRecord(snapshot.conceptRelations.conceptMap) ||
		Object.keys(snapshot.conceptRelations.conceptMap).length > MAX_PUBLIC_CONCEPT_ENTRIES
	) {
		throw new PublicDiscoverySnapshotContractError('unsafe-container', 'relations');
	}

	const twinEdges = snapshot.twinEdges.map((rawEdge, index) => {
		const edge = rawEdge as unknown;
		if (
			!isRecord(edge) ||
			typeof edge.a !== 'string' ||
			typeof edge.b !== 'string' ||
			typeof edge.score !== 'number' ||
			!Number.isFinite(edge.score) ||
			edge.kind !== 'twin'
		) {
			throw new PublicDiscoverySnapshotContractError(`unsafe-twin-edge:${index}`, 'relations');
		}
		return { a: edge.a, b: edge.b, score: edge.score, kind: 'twin' as const };
	});
	const conceptEdges = snapshot.conceptRelations.edges.map((rawEdge, index) => {
		const edge = rawEdge as unknown;
		if (
			!isRecord(edge) ||
			typeof edge.a !== 'string' ||
			typeof edge.b !== 'string' ||
			typeof edge.concept !== 'string' ||
			edge.kind !== 'concept'
		) {
			throw new PublicDiscoverySnapshotContractError(`unsafe-concept-edge:${index}`, 'relations');
		}
		return { a: edge.a, b: edge.b, concept: edge.concept, kind: 'concept' as const };
	});
	const conceptMap: Record<string, string> = {};
	for (const [tag, concept] of Object.entries(snapshot.conceptRelations.conceptMap)) {
		if (typeof concept !== 'string') {
			throw new PublicDiscoverySnapshotContractError('unsafe-concept-map', 'relations');
		}
		conceptMap[tag] = concept;
	}

	return {
		revision: snapshot.revision,
		updatedAt: snapshot.updatedAt,
		twinEdges,
		conceptRelations: { edges: conceptEdges, conceptMap }
	};
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
			(snapshot) => {
				return projectPublicTemplateSnapshotContract(snapshot);
			}
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
	const resolved = await manifestOrLastKnownGood<ProjectedPublicRelationsSnapshot>(
		context,
		logicalKey,
		() => getCachedPublicDiscoveryManifest(context)
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
			(snapshot) => projectPublicRelationsSnapshotContract(snapshot)
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
