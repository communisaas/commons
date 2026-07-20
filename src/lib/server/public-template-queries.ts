import { serverQuery } from 'convex-sveltekit';
import type { FunctionReturnType } from 'convex/server';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
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
const MAX_PUBLIC_TEMPLATE_CARDS = 50;
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

type PublicProjectionField =
	| { kind: 'string' }
	| { kind: 'number' }
	| { kind: 'boolean' }
	| { kind: 'optional'; value: PublicProjectionField }
	| { kind: 'nullable'; value: PublicProjectionField }
	| { kind: 'array'; value: PublicProjectionField; maxItems: number }
	| { kind: 'object'; fields: Record<string, PublicProjectionField> }
	| { kind: 'redacted-object' }
	| { kind: 'redacted-null' }
	| { kind: 'redacted-array' };

const PUBLIC_STRING = { kind: 'string' } as const satisfies PublicProjectionField;
const PUBLIC_NUMBER = { kind: 'number' } as const satisfies PublicProjectionField;
const PUBLIC_BOOLEAN = { kind: 'boolean' } as const satisfies PublicProjectionField;
const PUBLIC_REDACTED_OBJECT = {
	kind: 'redacted-object'
} as const satisfies PublicProjectionField;
const PUBLIC_REDACTED_NULL = { kind: 'redacted-null' } as const satisfies PublicProjectionField;
const PUBLIC_REDACTED_ARRAY = {
	kind: 'redacted-array'
} as const satisfies PublicProjectionField;
const publicOptional = <T extends PublicProjectionField>(value: T) =>
	({ kind: 'optional', value }) as const;
const publicNullable = <T extends PublicProjectionField>(value: T) =>
	({ kind: 'nullable', value }) as const;
const publicArray = <T extends PublicProjectionField>(value: T, maxItems: number) =>
	({ kind: 'array', value, maxItems }) as const;
const publicObject = <T extends Record<string, PublicProjectionField>>(fields: T) =>
	({ kind: 'object', fields }) as const;

const PUBLIC_ORG_SCHEMA = publicObject({
	name: PUBLIC_STRING,
	slug: PUBLIC_STRING,
	avatar: publicNullable(PUBLIC_STRING)
});
const PUBLIC_SCOPE_SCHEMA = publicObject({
	id: PUBLIC_STRING,
	template_id: PUBLIC_STRING,
	country_code: PUBLIC_STRING,
	region_code: publicNullable(PUBLIC_STRING),
	locality_code: publicNullable(PUBLIC_STRING),
	district_code: publicNullable(PUBLIC_STRING),
	display_text: PUBLIC_STRING,
	scope_level: PUBLIC_STRING,
	confidence: PUBLIC_NUMBER,
	extraction_method: PUBLIC_STRING
});
const PUBLIC_JURISDICTION_SCHEMA = publicObject({
	id: PUBLIC_STRING,
	template_id: PUBLIC_STRING,
	jurisdiction_type: PUBLIC_STRING,
	congressional_district: publicNullable(PUBLIC_STRING),
	senate_class: publicNullable(PUBLIC_STRING),
	state_code: publicNullable(PUBLIC_STRING),
	state_senate_district: publicNullable(PUBLIC_STRING),
	state_house_district: publicNullable(PUBLIC_STRING),
	county_fips: publicNullable(PUBLIC_STRING),
	county_name: publicNullable(PUBLIC_STRING),
	city_name: publicNullable(PUBLIC_STRING),
	city_fips: publicNullable(PUBLIC_STRING),
	school_district_id: publicNullable(PUBLIC_STRING),
	school_district_name: publicNullable(PUBLIC_STRING),
	latitude: publicNullable(PUBLIC_NUMBER),
	longitude: publicNullable(PUBLIC_NUMBER),
	estimated_population: publicNullable(PUBLIC_NUMBER),
	coverage_notes: publicNullable(PUBLIC_STRING)
});

// This schema is both the runtime reconstruction contract and the compile-time
// field fuse. A producer field addition fails type-check until it is classified.
const PUBLIC_TEMPLATE_SCHEMA = {
	id: PUBLIC_STRING,
	slug: PUBLIC_STRING,
	title: PUBLIC_STRING,
	description: PUBLIC_STRING,
	domain: PUBLIC_STRING,
	domainHue: publicOptional(PUBLIC_NUMBER),
	topics: publicArray(PUBLIC_STRING, 200),
	type: PUBLIC_STRING,
	deliveryMethod: PUBLIC_STRING,
	subject: PUBLIC_STRING,
	message_body: PUBLIC_STRING,
	preview: PUBLIC_STRING,
	endorsingOrg: publicNullable(PUBLIC_ORG_SCHEMA),
	endorsingOrgs: publicArray(PUBLIC_ORG_SCHEMA, 6),
	endorsementCount: PUBLIC_NUMBER,
	coordinationScale: PUBLIC_NUMBER,
	isNew: PUBLIC_BOOLEAN,
	hasActiveDebate: PUBLIC_BOOLEAN,
	debateSummary: publicOptional(
		publicObject({
			status: PUBLIC_STRING,
			winningStance: publicOptional(PUBLIC_STRING),
			uniqueParticipants: publicNullable(PUBLIC_NUMBER),
			argumentCount: publicNullable(PUBLIC_NUMBER),
			deadline: publicOptional(PUBLIC_STRING)
		})
	),
	verified_sends: publicNullable(PUBLIC_NUMBER),
	unique_districts: publicNullable(PUBLIC_NUMBER),
	send_count: publicNullable(PUBLIC_NUMBER),
	daily_arrivals: publicArray(PUBLIC_NUMBER, 30),
	district_counts: publicArray(publicObject({ code: PUBLIC_STRING, count: PUBLIC_NUMBER }), 500),
	tier_counts: publicArray(PUBLIC_NUMBER, 6),
	delivery_config: PUBLIC_REDACTED_OBJECT,
	cwc_config: PUBLIC_REDACTED_NULL,
	recipient_config: PUBLIC_REDACTED_NULL,
	recipient_count: PUBLIC_NUMBER,
	campaign_id: publicNullable(PUBLIC_STRING),
	status: PUBLIC_STRING,
	is_public: PUBLIC_BOOLEAN,
	jurisdictions: publicArray(PUBLIC_JURISDICTION_SCHEMA, 100),
	scope: publicNullable(PUBLIC_SCOPE_SCHEMA),
	scopes: publicArray(PUBLIC_SCOPE_SCHEMA, 100),
	recipientEmails: PUBLIC_REDACTED_ARRAY,
	createdAt: PUBLIC_STRING
} as const satisfies { [K in keyof PublicTemplateCard]-?: PublicProjectionField };

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function projectPublicObject(
	value: unknown,
	fields: Record<string, PublicProjectionField>,
	path: string
): Record<string, unknown> {
	if (!isRecord(value)) throw new PublicDiscoverySnapshotContractError(`unsafe-${path}`);
	const projected: Record<string, unknown> = {};
	for (const [name, field] of Object.entries(fields)) {
		if (!Object.prototype.hasOwnProperty.call(value, name) || value[name] === undefined) {
			if (field.kind === 'optional') continue;
			throw new PublicDiscoverySnapshotContractError(`unsafe-${path}.${name}`);
		}
		projected[name] = projectPublicField(value[name], field, `${path}.${name}`);
	}
	return projected;
}

function projectPublicField(value: unknown, field: PublicProjectionField, path: string): unknown {
	switch (field.kind) {
		case 'string':
			if (typeof value === 'string') return value;
			break;
		case 'number':
			if (typeof value === 'number' && Number.isFinite(value)) return value;
			break;
		case 'boolean':
			if (typeof value === 'boolean') return value;
			break;
		case 'optional':
			return projectPublicField(value, field.value, path);
		case 'nullable':
			return value === null ? null : projectPublicField(value, field.value, path);
		case 'array':
			if (!Array.isArray(value) || value.length > field.maxItems) break;
			return value.map((item, index) => projectPublicField(item, field.value, `${path}:${index}`));
		case 'object':
			return projectPublicObject(value, field.fields, path);
		case 'redacted-object':
			return {};
		case 'redacted-null':
			return null;
		case 'redacted-array':
			return [];
	}
	throw new PublicDiscoverySnapshotContractError(`unsafe-${path}`);
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

	return projectPublicObject(
		rawTemplate,
		PUBLIC_TEMPLATE_SCHEMA,
		`template:${index}`
	) as unknown as PublicTemplateCard;
}

function projectPublicTemplateCardsContract(
	value: unknown,
	excludeCwc: boolean
): PublicTemplateSnapshot['templates'] {
	if (!Array.isArray(value)) {
		throw new PublicDiscoverySnapshotContractError('templates-not-array');
	}
	if (value.length > MAX_PUBLIC_TEMPLATE_CARDS) {
		throw new PublicDiscoverySnapshotContractError(`templates-over-cap:${value.length}`);
	}
	return value.map((template, index) => {
		const projected = projectPublicTemplateCard(template, index);
		if (excludeCwc && projected.deliveryMethod === 'cwc') {
			throw new PublicDiscoverySnapshotContractError(`cwc-leak:${index}`);
		}
		return projected;
	});
}

/** Refuse a legacy, malformed, recipient-bearing, or visibility-leaking payload. */
function projectPublicTemplateSnapshotContract(
	snapshot: unknown,
	excludeCwc: boolean
): PublicTemplateSnapshot['templates'] {
	if (!isRecord(snapshot)) {
		throw new PublicDiscoverySnapshotContractError('unsafe-container');
	}
	if (snapshot.projectionVersion !== PUBLIC_TEMPLATE_PROJECTION_VERSION) {
		throw new PublicDiscoverySnapshotContractError(
			`projection-version:${String(snapshot.projectionVersion)}`
		);
	}
	return projectPublicTemplateCardsContract(snapshot.templates, excludeCwc);
}

function projectPublicRelationsSnapshotContract(
	snapshot: unknown
): ProjectedPublicRelationsSnapshot {
	if (
		!isRecord(snapshot) ||
		!Number.isSafeInteger(snapshot.revision) ||
		(snapshot.revision as number) < 0 ||
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
		revision: snapshot.revision as number,
		updatedAt: snapshot.updatedAt as number | null,
		twinEdges,
		conceptRelations: { edges: conceptEdges, conceptMap }
	};
}

function projectSnapshotCoordinates(
	value: unknown,
	family: SnapshotFamily
): SnapshotCoordinates & {
	ready: boolean;
} {
	if (
		!isRecord(value) ||
		typeof value.ready !== 'boolean' ||
		!Number.isSafeInteger(value.revision) ||
		(value.revision as number) < 0 ||
		(value.updatedAt !== null &&
			(typeof value.updatedAt !== 'number' ||
				!Number.isFinite(value.updatedAt) ||
				value.updatedAt < 0)) ||
		(value.ready && value.updatedAt === null)
	) {
		throw new PublicDiscoverySnapshotContractError('unsafe-manifest', family);
	}
	return {
		ready: value.ready,
		revision: value.revision as number,
		updatedAt: value.updatedAt as number | null
	};
}

function projectPublicDiscoveryManifestContract(value: unknown): PublicDiscoveryManifest {
	if (!isRecord(value)) {
		throw new PublicDiscoverySnapshotContractError('unsafe-manifest');
	}
	return {
		list: projectSnapshotCoordinates(value.list, 'list'),
		relations: projectSnapshotCoordinates(value.relations, 'relations')
	} as PublicDiscoveryManifest;
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
			refreshMode: 'blocking',
			projectCachedValue: projectPublicDiscoveryManifestContract
		},
		() =>
			serverQuery(api.templates.publicDiscoveryManifest, {
				_secret: getInternalSecret()
			})
	);
}

async function manifestOrLastKnownGood<T>(
	context: PublicQueryContext,
	logicalKey: string,
	loadManifest: () => Promise<PublicDiscoveryManifest>,
	projectCachedValue: (value: unknown) => T
): Promise<{ manifest: PublicDiscoveryManifest } | { lkg: T }> {
	try {
		return { manifest: await loadManifest() };
	} catch (error) {
		const lkg = await getCachedPublicDataLastKnownGood<T>(logicalKey, {
			...context,
			projectCachedValue
		});
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
	select: (snapshot: TSnapshot) => TValue,
	projectCachedValue: (value: unknown) => TValue
): Promise<TValue> {
	return getCachedPublicData(
		logicalKey,
		{
			...context,
			freshForMs: PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS,
			revision: snapshotGeneration(expected.revision, expected.updatedAt),
			projectCachedValue,
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
		() => getCachedPublicDiscoveryManifest(context),
		(value) => projectPublicTemplateCardsContract(value, excludeCwc)
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
						_secret: getInternalSecret(),
						excludeCwc
					}))) as PublicTemplateSnapshot,
			(snapshot) => projectPublicTemplateSnapshotContract(snapshot, excludeCwc),
			(value) => projectPublicTemplateCardsContract(value, excludeCwc)
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
		() => getCachedPublicDiscoveryManifest(context),
		projectPublicRelationsSnapshotContract
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
						_secret: getInternalSecret(),
						excludeCwc
					}))) as PublicRelationsSnapshot,
			(snapshot) => projectPublicRelationsSnapshotContract(snapshot),
			projectPublicRelationsSnapshotContract
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
