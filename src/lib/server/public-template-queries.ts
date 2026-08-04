import { serverQuery } from '$lib/server/convex-work-budget';
import {
	isCongressionalDelivery,
	isTemplateDeliveryMethod
} from '$convex/lib/templateDeliveryMethod';
import {
	TEMPLATE_DAILY_ARRIVAL_WINDOW_DAYS,
	TRUST_TIER_BUCKET_COUNT
} from '$convex/lib/publicAggregatePrivacy';
import { MAX_PUBLIC_TEMPLATE_DISTRICT_COUNTS } from '$convex/lib/publicTemplateDiscoverySource';
import type { FunctionReturnType } from 'convex/server';
import type { Id } from '$convex/_generated/dataModel';
import { api } from '$lib/convex';
import { getInternalSecret } from './internal/secret-auth';
import {
	PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS,
	PublicDiscoveryPayloadNotPublishedError,
	collectPublicTemplatePageArtifactGarbageForOwnedManifestRefresh,
	getCachedPublicData,
	getPublicTemplateOgImageArtifact,
	publishPublicDiscoveryPayload,
	publicTemplatePageArtifactPublicationState,
	readPublicTemplatePageBackfillProgress,
	retireWithdrawnPublicDiscoveryPayloads,
	writePublicTemplatePageBackfillProgress,
	type PublicTemplatePageBackfillProgressState
} from './public-discovery-cache';
import {
	PublicDiscoveryManifestShieldError,
	getGloballyShieldedPublicDiscoveryManifest,
	publicDiscoveryGraphGeneration,
	refreshGloballyShieldedPublicDiscoveryManifest,
	type PublicDiscoveryManifestAuthority,
	type PublicDiscoveryPublicationPlan
} from './public-discovery-manifest-shield';
import {
	PUBLIC_TEMPLATE_PAGE_INVENTORY_LOGICAL_KEY,
	PUBLIC_TEMPLATE_PAGE_INVENTORY_MAX_ENTRIES,
	buildPublicTemplatePageArtifact,
	buildPublicTemplatePageInventory,
	publicTemplatePageArtifactLogicalKey,
	readPublicTemplatePageArtifact,
	readPublicTemplatePageInventory,
	type PublicTemplatePageInventory
} from './public-template-page-artifact';
import { publicTemplatePageCoordinateDigest } from './public-template-page-coordinate';
import { stampProducerPublishedTemplateDetail } from './public-template-detail-cache';
import {
	PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX,
	PUBLIC_TEMPLATE_OG_QUEUE_SEND_ATTEMPTS_MAX,
	buildPublicTemplateOgQueueJob,
	enqueuePublicTemplateOgQueueJobs,
	type PublicTemplateOgQueueBinding
} from './public-template-og-queue';

const BUILD_RELEASE_SHA = import.meta.env.VITE_RELEASE_SHA as string | undefined;

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
type CachedPublicDiscoveryManifest = PublicDiscoveryManifestAuthority<PublicDiscoveryManifest>;
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
export type PublicDiscoveryGraphSurface = ProjectedPublicRelationsSnapshot & {
	templates: PublicTemplateCard[];
};
export type PublishedPublicDiscoveryGraphSurface = PublicDiscoveryGraphSurface & {
	/** Exact manifest coordinate that certified this bundled graph payload. */
	generation: string;
};
const PUBLIC_TEMPLATE_PROJECTION_VERSION = 4;
const MAX_PUBLIC_TEMPLATE_CARDS = 50;
const MAX_PUBLIC_RELATION_EDGES = 10_000;
const MAX_PUBLIC_CONCEPT_ENTRIES = 10_000;
const PUBLIC_DISCOVERY_GRAPH_GENERATION =
	/^list=(\d{1,20}):(\d{1,20}|cold);relations=(\d{1,20}):(\d{1,20}|cold)$/;
// Graph payloads published before the served-generation contract did not
// carry their own generation. R2 payloads are immutable, so a logical-key
// namespace bump is the only fail-closed way to backfill an unchanged
// manifest coordinate without overwriting an older object in place.
const PUBLIC_DISCOVERY_GRAPH_LOGICAL_KEY_VERSION = 2;

function publicDiscoveryGraphLogicalKey(excludeCwc: boolean): string {
	return `landing:graph:v${PUBLIC_DISCOVERY_GRAPH_LOGICAL_KEY_VERSION}:exclude-cwc=${
		excludeCwc ? '1' : '0'
	}`;
}

function snapshotGeneration(revision: number, updatedAt: number | null): string {
	return `${revision}:${updatedAt ?? 'cold'}`;
}

function publicTemplatePageBackfillGeneration(family: PublicDiscoveryManifest['list']): string {
	return `${family.ready ? 'ready' : 'withdrawn'}:${family.revision}:${
		family.updatedAt ?? 'cold'
	}:epoch=${family.withdrawalEpoch}:artifact-set=3`;
}

function isCurrentPublicTemplateArtifactSetGeneration(generation: string): boolean {
	return generation.endsWith(':artifact-set=3');
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

export class PublicTemplatePageBackfillIncompleteError extends Error {
	constructor() {
		super('PUBLIC_TEMPLATE_PAGE_BACKFILL_INCOMPLETE');
		this.name = 'PublicTemplatePageBackfillIncompleteError';
	}
}

/** Terminal Queue/protocol state. It must surface as 503 and never mint continuation work. */
export class PublicTemplateOgQueueStalledError extends Error {
	readonly code: string;

	constructor(code: string) {
		super(`PUBLIC_TEMPLATE_OG_QUEUE_STALLED:${code}`);
		this.name = 'PublicTemplateOgQueueStalledError';
		this.code = code;
	}
}

/** A provider rejected an already-CAS-recorded send; keep the durable continuation token. */
export class PublicTemplateOgQueueSendFailedError extends PublicTemplatePageBackfillIncompleteError {
	constructor() {
		super();
		this.name = 'PublicTemplateOgQueueSendFailedError';
		this.message = 'PUBLIC_TEMPLATE_OG_QUEUE_SEND_FAILED';
	}
}

export type PublicTemplateOgQueueAttemptReservation = {
	status: 'reserved' | 'exhausted';
	remaining: number;
	resetAtMs: number;
};

export type ReservePublicTemplateOgQueueAttempts = (
	messageKeys: readonly string[]
) => Promise<PublicTemplateOgQueueAttemptReservation>;

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
	daily_arrivals: publicArray(PUBLIC_NUMBER, TEMPLATE_DAILY_ARRIVAL_WINDOW_DAYS),
	district_counts: publicArray(
		publicObject({ code: PUBLIC_STRING, count: PUBLIC_NUMBER }),
		MAX_PUBLIC_TEMPLATE_DISTRICT_COUNTS
	),
	district_counts_suppressed_districts: PUBLIC_NUMBER,
	district_counts_suppressed_count: PUBLIC_NUMBER,
	tier_counts: publicArray(PUBLIC_NUMBER, TRUST_TIER_BUCKET_COUNT),
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

	const projected = projectPublicObject(
		rawTemplate,
		PUBLIC_TEMPLATE_SCHEMA,
		`template:${index}`
	) as unknown as PublicTemplateCard;
	if (projected.status !== 'published' || projected.is_public !== true) {
		throw new PublicDiscoverySnapshotContractError(`ineligible-template:${index}`);
	}
	return projected;
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
		// This projector distrusts its producer for every other field, and the payload
		// arrives as `unknown` from R2 — so an equality test is the wrong shape here.
		// An unrecognized delivery method is not "not cwc"; it is a value this build
		// cannot reason about, and letting it through is the one failure the congressional
		// containment gate exists to prevent. Refuse on non-membership, then on cwc.
		if (excludeCwc && !isTemplateDeliveryMethod(projected.deliveryMethod)) {
			throw new PublicDiscoverySnapshotContractError(`unknown-delivery-method:${index}`);
		}
		if (excludeCwc && isCongressionalDelivery(projected.deliveryMethod)) {
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

function projectPublicDiscoveryGraphSurfaceContract(
	value: unknown,
	excludeCwc: boolean,
	envelopeRevision?: string
): PublishedPublicDiscoveryGraphSurface {
	if (!isRecord(value)) {
		throw new PublicDiscoverySnapshotContractError('unsafe-graph-surface', 'relations');
	}
	const templates = projectPublicTemplateCardsContract(value.templates, excludeCwc);
	const relations = projectPublicRelationsSnapshotContract(value);
	const visibleTemplateIds = new Set<string>(templates.map((template) => template.id));
	for (const [index, edge] of relations.twinEdges.entries()) {
		if (!visibleTemplateIds.has(edge.a) || !visibleTemplateIds.has(edge.b)) {
			throw new PublicDiscoverySnapshotContractError(`orphaned-twin-edge:${index}`, 'relations');
		}
	}
	for (const [index, edge] of relations.conceptRelations.edges.entries()) {
		if (!visibleTemplateIds.has(edge.a) || !visibleTemplateIds.has(edge.b)) {
			throw new PublicDiscoverySnapshotContractError(`orphaned-concept-edge:${index}`, 'relations');
		}
	}
	const generation =
		typeof value.generation === 'string'
			? PUBLIC_DISCOVERY_GRAPH_GENERATION.exec(value.generation)
			: null;
	if (
		!generation ||
		value.generation !== envelopeRevision ||
		Number(generation[3]) !== relations.revision ||
		(generation[4] === 'cold' ? null : Number(generation[4])) !== relations.updatedAt
	) {
		throw new PublicDiscoverySnapshotContractError('unsafe-graph-generation', 'relations');
	}
	return {
		generation: value.generation as string,
		templates,
		...relations
	};
}

/**
 * A prompt publication may advance the bounded list before the deliberately
 * slower relation rebuild. Build that composite from the exact visible list,
 * pruning old relation endpoints rather than forcing embedding-heavy work on
 * the prompt path. Persisted payload reads remain stricter and reject orphans.
 */
function projectPublicDiscoveryGraphSurfaceForPublication(
	listSnapshot: unknown,
	relationsSnapshot: unknown,
	excludeCwc: boolean,
	generation: string
): PublishedPublicDiscoveryGraphSurface {
	const templates = projectPublicTemplateSnapshotContract(listSnapshot, excludeCwc);
	const relations = projectPublicRelationsSnapshotContract(relationsSnapshot);
	const generationCoordinates = PUBLIC_DISCOVERY_GRAPH_GENERATION.exec(generation);
	if (
		!generationCoordinates ||
		Number(generationCoordinates[3]) !== relations.revision ||
		(generationCoordinates[4] === 'cold' ? null : Number(generationCoordinates[4])) !==
			relations.updatedAt
	) {
		throw new PublicDiscoverySnapshotContractError('unsafe-graph-generation', 'relations');
	}
	const visibleTemplateIds = new Set<string>(templates.map((template) => template.id));
	return {
		generation,
		templates,
		...relations,
		twinEdges: relations.twinEdges.filter(
			(edge) => visibleTemplateIds.has(edge.a) && visibleTemplateIds.has(edge.b)
		),
		conceptRelations: {
			...relations.conceptRelations,
			edges: relations.conceptRelations.edges.filter(
				(edge) => visibleTemplateIds.has(edge.a) && visibleTemplateIds.has(edge.b)
			)
		}
	};
}

function projectSnapshotCoordinates(
	value: unknown,
	family: SnapshotFamily
): SnapshotCoordinates & {
	ready: boolean;
	retiredRevision: number;
	withdrawalEpoch: number;
} {
	// Schema-2 manifests written before withdrawal epochs existed remain valid
	// during a rolling deploy. Every newly written manifest includes the field.
	const withdrawalEpoch =
		isRecord(value) && value.withdrawalEpoch === undefined
			? 0
			: isRecord(value)
				? value.withdrawalEpoch
				: undefined;
	if (
		!isRecord(value) ||
		typeof value.ready !== 'boolean' ||
		!Number.isSafeInteger(value.retiredRevision) ||
		(value.retiredRevision as number) < 0 ||
		!Number.isSafeInteger(value.revision) ||
		(value.revision as number) < 0 ||
		!Number.isSafeInteger(withdrawalEpoch) ||
		(withdrawalEpoch as number) < 0 ||
		(value.updatedAt !== null &&
			(typeof value.updatedAt !== 'number' ||
				!Number.isFinite(value.updatedAt) ||
				value.updatedAt < 0)) ||
		(value.ready && value.updatedAt === null) ||
		(value.ready
			? (value.retiredRevision as number) >= (value.revision as number)
			: (value.retiredRevision as number) < (value.revision as number))
	) {
		throw new PublicDiscoverySnapshotContractError('unsafe-manifest', family);
	}
	return {
		ready: value.ready,
		retiredRevision: value.retiredRevision as number,
		revision: value.revision as number,
		updatedAt: value.updatedAt as number | null,
		withdrawalEpoch: withdrawalEpoch as number
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
function getCachedPublicDiscoveryManifestAuthority(
	context: PublicQueryContext,
	bypassLocal = false
): Promise<CachedPublicDiscoveryManifest> {
	return getGloballyShieldedPublicDiscoveryManifest(
		{ ...context, bypassLocal },
		() =>
			serverQuery(api.templates.publicDiscoveryManifest, {
				_secret: getInternalSecret()
			}),
		projectPublicDiscoveryManifestContract
	);
}

export async function getCachedPublicDiscoveryManifest(context: PublicQueryContext) {
	return (await getCachedPublicDiscoveryManifestAuthority(context)).manifest;
}

/**
 * Complete anonymous `/s/:slug` base from producer-published exact R2 objects.
 * Random nonexistent slugs stop at the shared 250-entry inventory; eligible
 * slugs add one exact artifact GET. Neither miss path has an origin loader.
 */
async function getCurrentPublicTemplatePageCoordinate(context: PublicQueryContext, slug: string) {
	const authority = await getCachedPublicDiscoveryManifestAuthority(context);
	const { manifest } = authority;
	if (!manifest.list.ready) throw new PublicDiscoverySnapshotNotReadyError('list');
	const inventory = await getCachedPublicData(
		PUBLIC_TEMPLATE_PAGE_INVENTORY_LOGICAL_KEY,
		{
			...context,
			freshForMs: PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS,
			r2Policy: 'read-only',
			revision: snapshotGeneration(manifest.list.revision, manifest.list.updatedAt),
			retiredRevisionFloor: authority.withdrawalFloors.list,
			projectCachedValue: readPublicTemplatePageInventory,
			refreshMode: 'blocking',
			shouldFallbackToStale: () => false
		},
		async () => {
			throw new Error('PUBLIC_TEMPLATE_PAGE_INVENTORY_ORIGIN_FALLBACK_FORBIDDEN');
		}
	);
	const entry = inventory.entries.find((candidate) => candidate.slug === slug);
	return entry ?? null;
}

export async function getCachedPublicTemplatePageArtifact(
	context: PublicQueryContext,
	slug: string
) {
	const entry = await getCurrentPublicTemplatePageCoordinate(context, slug);
	if (!entry) return null;
	const artifact = await getCachedPublicData(
		publicTemplatePageArtifactLogicalKey(slug),
		{
			...context,
			freshForMs: PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS,
			r2Policy: 'read-only',
			revision: entry.artifactRevision,
			retiredRevisionFloor: Number(entry.artifactRevision) - 1,
			projectCachedValue: readPublicTemplatePageArtifact,
			refreshMode: 'blocking',
			shouldFallbackToStale: () => false
		},
		async () => {
			throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_ORIGIN_FALLBACK_FORBIDDEN');
		}
	);
	if (artifact.slug !== slug) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_SLUG_MISMATCH');
	}
	return {
		...artifact,
		detail: stampProducerPublishedTemplateDetail({
			detail: artifact.detail,
			slug,
			...context
		})
	};
}

/**
 * Anonymous OG lookup: current manifest -> current bounded inventory -> exact
 * immutable PNG coordinate. There is deliberately no JSON artifact or origin
 * loader on this path.
 */
export async function getCachedPublicTemplateOgImageArtifact(
	context: PublicQueryContext,
	slug: string
): Promise<{ bytes: Uint8Array; revision: string } | null> {
	const entry = await getCurrentPublicTemplatePageCoordinate(context, slug);
	if (!entry) return null;
	return {
		bytes: await getPublicTemplateOgImageArtifact({
			...context,
			revision: entry.artifactRevision,
			slug
		}),
		revision: entry.artifactRevision
	};
}

async function publishExpectedSnapshot<TSnapshot extends SnapshotCoordinates, TValue>(
	platform: App.Platform,
	logicalKey: string,
	family: SnapshotFamily,
	expected: SnapshotCoordinates,
	loader: () => Promise<TSnapshot>,
	select: (snapshot: TSnapshot) => TValue,
	projectCachedValue: (value: unknown) => TValue,
	retireRevisions: readonly string[],
	retiredRevisionFloor: number
): Promise<TValue> {
	return publishPublicDiscoveryPayload(
		logicalKey,
		{
			platform,
			projectCachedValue,
			retireRevisions,
			retiredRevisionFloor,
			revision: snapshotGeneration(expected.revision, expected.updatedAt)
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

export const PUBLIC_TEMPLATE_PAGE_PUBLICATION_BATCH_MAX = 16;
const PUBLIC_TEMPLATE_PAGE_MATERIALIZATION_BATCH_SIZE = 4;
const PUBLIC_TEMPLATE_PAGE_INVENTORY_MAX_PAGES = 5;
export const PUBLIC_TEMPLATE_OG_QUEUE_REPAIR_DELAY_MS = 120 * 1000;
/** Initial handoff plus one delayed repair; every attempt is CAS-recorded before sendBatch. */
export const PUBLIC_TEMPLATE_OG_QUEUE_REPAIR_ATTEMPTS_MAX =
	PUBLIC_TEMPLATE_OG_QUEUE_SEND_ATTEMPTS_MAX;
const PRODUCER_CACHE_URL = new URL('https://commons.email/');

type PageInventoryEntry = {
	templateId: Id<'templates'>;
	slug: string;
	artifactRevision: number;
};

async function reconcilePublicTemplatePageBackfillProgress(
	platform: App.Platform,
	desired: PublicTemplatePageBackfillProgressState['progress']
): Promise<PublicTemplatePageBackfillProgressState> {
	const observed = await readPublicTemplatePageBackfillProgress({ platform });
	if (
		observed &&
		observed.progress.generation === desired.generation &&
		observed.progress.coordinateDigest === desired.coordinateDigest &&
		observed.progress.total === desired.total &&
		observed.progress.coordinates.length === desired.coordinates.length &&
		observed.progress.coordinates.every((coordinate, index) => {
			const expected = desired.coordinates[index];
			return (
				expected !== undefined &&
				coordinate.templateId === expected.templateId &&
				coordinate.slug === expected.slug &&
				coordinate.artifactRevision === expected.artifactRevision
			);
		})
	) {
		return observed;
	}
	const reset = await writePublicTemplatePageBackfillProgress({
		platform,
		expectedEtag: observed?.etag ?? null,
		progress: desired
	});
	if (!reset) throw new PublicTemplatePageBackfillIncompleteError();
	return reset;
}

async function readPriorPublicTemplatePageInventory(
	platform: App.Platform,
	manifest: PublicDiscoveryManifest | null
): Promise<PublicTemplatePageInventory | null> {
	if (!manifest?.list.ready) return null;
	try {
		return await getCachedPublicData(
			PUBLIC_TEMPLATE_PAGE_INVENTORY_LOGICAL_KEY,
			{
				url: PRODUCER_CACHE_URL,
				platform,
				freshForMs: PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS,
				r2Policy: 'read-only',
				revision: snapshotGeneration(manifest.list.revision, manifest.list.updatedAt),
				retiredRevisionFloor: manifest.list.retiredRevision,
				projectCachedValue: readPublicTemplatePageInventory,
				refreshMode: 'blocking',
				shouldFallbackToStale: () => false
			},
			async () => {
				throw new Error('PUBLIC_TEMPLATE_PAGE_INVENTORY_ORIGIN_FALLBACK_FORBIDDEN');
			}
		);
	} catch (error) {
		if (error instanceof PublicDiscoveryPayloadNotPublishedError) return null;
		throw error;
	}
}

function sameListAuthority(
	left: PublicDiscoveryManifest['list'],
	right: PublicDiscoveryManifest['list']
): boolean {
	return (
		left.ready === right.ready &&
		left.revision === right.revision &&
		left.updatedAt === right.updatedAt &&
		left.retiredRevision === right.retiredRevision &&
		left.withdrawalEpoch === right.withdrawalEpoch
	);
}

async function readPublicTemplatePageCoordinates(
	manifest: PublicDiscoveryManifest
): Promise<PageInventoryEntry[]> {
	const entries: PageInventoryEntry[] = [];
	let cursor: string | null = null;
	for (let pageNumber = 0; pageNumber < PUBLIC_TEMPLATE_PAGE_INVENTORY_MAX_PAGES; pageNumber += 1) {
		const page: {
			entries: PageInventoryEntry[];
			continueCursor: string | null;
			isDone: boolean;
			revision: number;
			updatedAt: number;
		} = await serverQuery(api.templates.publicTemplatePageArtifactInventoryPage, {
			_secret: getInternalSecret(),
			cursor,
			expectedListRevision: manifest.list.revision
		});
		if (
			page.revision !== manifest.list.revision ||
			page.updatedAt !== manifest.list.updatedAt ||
			page.entries.length > 64
		) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_INVENTORY_PAGE_GENERATION_MISMATCH');
		}
		for (const entry of page.entries) {
			if (entries.length >= PUBLIC_TEMPLATE_PAGE_INVENTORY_MAX_ENTRIES) {
				throw new Error('PUBLIC_TEMPLATE_PAGE_INVENTORY_CAP_EXCEEDED');
			}
			entries.push({
				templateId: entry.templateId,
				slug: entry.slug,
				artifactRevision: entry.artifactRevision
			});
		}
		if (page.isDone) {
			if (page.continueCursor !== null) {
				throw new Error('PUBLIC_TEMPLATE_PAGE_INVENTORY_CURSOR_INVALID');
			}
			const slugs = entries.map(({ slug }) => slug);
			if (new Set(slugs).size !== slugs.length) {
				throw new Error('PUBLIC_TEMPLATE_PAGE_INVENTORY_DUPLICATE_SLUG');
			}
			return entries;
		}
		if (!page.continueCursor || page.continueCursor === cursor) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_INVENTORY_CURSOR_STALLED');
		}
		cursor = page.continueCursor;
	}
	throw new Error('PUBLIC_TEMPLATE_PAGE_INVENTORY_PAGE_CAP_EXCEEDED');
}

async function publishPublicTemplatePageArtifacts(
	platform: App.Platform,
	manifest: PublicDiscoveryManifest,
	previous: PublicDiscoveryManifest | null,
	plan: PublicDiscoveryPublicationPlan,
	allowBackfill: boolean,
	reserveOgQueueAttempts: ReservePublicTemplateOgQueueAttempts
): Promise<void> {
	const priorInventory = await readPriorPublicTemplatePageInventory(platform, previous);
	const collectGarbage = async (plannedEntries: readonly PageInventoryEntry[] = []) => {
		const coordinates = new Map<string, { slug: string; artifactRevision: number | string }>();
		for (const coordinate of [...(priorInventory?.entries ?? []), ...plannedEntries]) {
			coordinates.set(`${coordinate.slug}:${coordinate.artifactRevision}`, {
				slug: coordinate.slug,
				artifactRevision: coordinate.artifactRevision
			});
		}
		await collectPublicTemplatePageArtifactGarbageForOwnedManifestRefresh({
			ownership: 'manifest-before-publish',
			platform,
			protectedCoordinates: [...coordinates.values()]
		});
	};
	if (!manifest.list.ready) {
		await reconcilePublicTemplatePageBackfillProgress(platform, {
			version: 1,
			generation: publicTemplatePageBackfillGeneration(manifest.list),
			coordinateDigest: await publicTemplatePageCoordinateDigest([]),
			coordinates: [],
			total: 0,
			nextOffset: 0,
			enqueuedOffset: 0,
			enqueuedAt: null,
			enqueueAttempts: 0
		});
		// The just-withdrawn prior inventory stays protected during the destructive
		// cutover. A later producer cycle first-marks it unreferenced, starting a
		// full authority grace rather than using the immutable object's age.
		await collectGarbage();
		if (plan.retireGenerations.list.length > 0) {
			await retireWithdrawnPublicDiscoveryPayloads(PUBLIC_TEMPLATE_PAGE_INVENTORY_LOGICAL_KEY, {
				platform,
				retiredRevisionFloor: manifest.list.retiredRevision,
				retireRevisions: plan.retireGenerations.list
			});
		}
		return;
	}
	const priorBySlug = new Map(
		priorInventory?.entries.map((entry) => [entry.slug, entry.artifactRevision]) ?? []
	);
	const backfillGeneration = publicTemplatePageBackfillGeneration(manifest.list);
	let progress = await readPublicTemplatePageBackfillProgress({ platform });
	if (
		previous &&
		priorInventory &&
		sameListAuthority(previous.list, manifest.list) &&
		progress?.progress.generation === backfillGeneration &&
		progress.progress.nextOffset === progress.progress.total
	) {
		await collectGarbage();
		return;
	}
	let plannedEntries: PageInventoryEntry[];
	let backfillCompleteArtifactSet: boolean;
	if (progress?.progress.generation === backfillGeneration) {
		plannedEntries = progress.progress.coordinates.map((coordinate) => ({
			templateId: coordinate.templateId as Id<'templates'>,
			slug: coordinate.slug,
			artifactRevision: coordinate.artifactRevision
		}));
		if (
			(await publicTemplatePageCoordinateDigest(plannedEntries)) !==
			progress.progress.coordinateDigest
		) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_CORRUPT');
		}
		// A schema bootstrap names every coordinate in `total`. Delta generations
		// name only revisions changed from the prior advertised inventory.
		backfillCompleteArtifactSet =
			progress.progress.coordinates.length > 0 &&
			progress.progress.total === progress.progress.coordinates.length;
	} else {
		// The first producer running artifact-set=3 must fill PNG siblings for
		// every already-advertised JSON coordinate. A completed artifact-set=3
		// checkpoint proves later generations may return to revision deltas.
		backfillCompleteArtifactSet = !(
			progress &&
			isCurrentPublicTemplateArtifactSetGeneration(progress.progress.generation) &&
			progress.progress.nextOffset === progress.progress.total
		);
		plannedEntries = await readPublicTemplatePageCoordinates(manifest);
		if (!priorInventory && plannedEntries.length > 0 && !allowBackfill) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_BACKFILL_AUTHORITY_REQUIRED');
		}
		const changedTotal = backfillCompleteArtifactSet
			? plannedEntries.length
			: plannedEntries.filter(
					(entry) => priorBySlug.get(entry.slug) !== String(entry.artifactRevision)
				).length;
		progress = await reconcilePublicTemplatePageBackfillProgress(platform, {
			version: 1,
			generation: backfillGeneration,
			coordinateDigest: await publicTemplatePageCoordinateDigest(plannedEntries),
			coordinates: plannedEntries.map(({ templateId, slug, artifactRevision }) => ({
				templateId: String(templateId),
				slug,
				artifactRevision
			})),
			total: changedTotal,
			nextOffset: 0,
			enqueuedOffset: 0,
			enqueuedAt: null,
			enqueueAttempts: 0
		});
	}
	if (!priorInventory && plannedEntries.length > 0 && !allowBackfill) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_BACKFILL_AUTHORITY_REQUIRED');
	}
	// Maintenance runs while this producer owns the manifest acquisition, before
	// any HEAD/reuse decision. Protect both the request-visible prior inventory
	// and every coordinate in the active durable plan.
	await collectGarbage(plannedEntries);
	const changed = backfillCompleteArtifactSet
		? plannedEntries
		: plannedEntries.filter(
				(entry) => priorBySlug.get(entry.slug) !== String(entry.artifactRevision)
			);
	if (progress.progress.total !== changed.length || progress.progress.nextOffset > changed.length) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_CORRUPT');
	}
	const coordinateDigest = progress.progress.coordinateDigest;
	const advanceProgress = async (
		next: PublicTemplatePageBackfillProgressState['progress']
	): Promise<void> => {
		const advanced = await writePublicTemplatePageBackfillProgress({
			platform,
			expectedEtag: progress!.etag,
			progress: next
		});
		if (!advanced) throw new PublicTemplatePageBackfillIncompleteError();
		progress = advanced;
	};
	const readStates = async (entries: readonly PageInventoryEntry[]) => {
		try {
			return await Promise.all(
				entries.map((entry) =>
					publicTemplatePageArtifactPublicationState(
						publicTemplatePageArtifactLogicalKey(entry.slug),
						{ platform, revision: entry.artifactRevision }
					)
				)
			);
		} catch {
			throw new PublicTemplateOgQueueStalledError('PAIR_STATE_CORRUPT');
		}
	};
	const enqueue = async (entries: readonly PageInventoryEntry[]): Promise<void> => {
		if (entries.length === 0) return;
		const queue = platform.env?.PUBLIC_TEMPLATE_OG_QUEUE as
			| PublicTemplateOgQueueBinding
			| undefined;
		const backend = platform.env?.PUBLIC_CONVEX_URL;
		const transactionId = platform.env?.PUBLIC_RELEASE_TRANSACTION_ID;
		if (
			!queue ||
			!backend ||
			typeof BUILD_RELEASE_SHA !== 'string' ||
			!/^[a-f0-9]{40}$/.test(BUILD_RELEASE_SHA) ||
			typeof transactionId !== 'string' ||
			!/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/.test(transactionId)
		) {
			throw new PublicTemplateOgQueueStalledError('BINDING_REQUIRED');
		}
		await enqueuePublicTemplateOgQueueJobs(
			queue,
			entries.map((entry) =>
				buildPublicTemplateOgQueueJob({
					backend,
					revision: entry.artifactRevision,
					sourceSha: BUILD_RELEASE_SHA,
					slug: entry.slug,
					transactionId
				})
			)
		);
	};
	const reserveQueueAttempts = async (
		entries: readonly PageInventoryEntry[],
		attempt: number
	): Promise<void> => {
		if (entries.length === 0) return;
		if (
			!platform.env?.PUBLIC_TEMPLATE_OG_QUEUE ||
			!platform.env.PUBLIC_CONVEX_URL ||
			typeof BUILD_RELEASE_SHA !== 'string' ||
			!/^[a-f0-9]{40}$/.test(BUILD_RELEASE_SHA) ||
			typeof platform.env.PUBLIC_RELEASE_TRANSACTION_ID !== 'string' ||
			!/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/.test(platform.env.PUBLIC_RELEASE_TRANSACTION_ID)
		) {
			throw new PublicTemplateOgQueueStalledError('BINDING_REQUIRED');
		}
		const messageKeys = entries.map((entry) => {
			const job = buildPublicTemplateOgQueueJob({
				backend: platform.env!.PUBLIC_CONVEX_URL!,
				revision: entry.artifactRevision,
				sourceSha: BUILD_RELEASE_SHA,
				slug: entry.slug,
				transactionId: platform.env!.PUBLIC_RELEASE_TRANSACTION_ID!
			});
			return `${job.backend}|${job.slug}|${job.revision}|${attempt}`;
		});
		let reservation: PublicTemplateOgQueueAttemptReservation;
		try {
			reservation = await reserveOgQueueAttempts(messageKeys);
		} catch {
			throw new PublicTemplateOgQueueStalledError('DAILY_BUDGET_UNAVAILABLE');
		}
		if (
			!reservation ||
			typeof reservation !== 'object' ||
			Array.isArray(reservation) ||
			Object.keys(reservation).length !== 3 ||
			!['reserved', 'exhausted'].includes(reservation.status) ||
			!Number.isSafeInteger(reservation.remaining) ||
			reservation.remaining < 0 ||
			reservation.remaining > PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX ||
			!Number.isSafeInteger(reservation.resetAtMs) ||
			reservation.resetAtMs < 1 ||
			(reservation.status === 'exhausted' && reservation.remaining !== 0)
		) {
			throw new PublicTemplateOgQueueStalledError('DAILY_BUDGET_PROTOCOL');
		}
		if (reservation.status === 'exhausted') {
			throw new PublicTemplateOgQueueStalledError('DAILY_BUDGET_EXHAUSTED');
		}
	};
	const sendRecordedIntent = async (entries: readonly PageInventoryEntry[]): Promise<void> => {
		try {
			await enqueue(entries);
		} catch (error) {
			if (error instanceof PublicTemplateOgQueueStalledError) throw error;
			throw new PublicTemplateOgQueueSendFailedError();
		}
	};

	// Phase two: certify the prior durable Queue handoff. While it is pending,
	// retries are time- and attempt-bounded in the checkpoint rather than emitted
	// by every two-minute continuation during an outage.
	if (progress.progress.enqueuedOffset > progress.progress.nextOffset) {
		let enqueued = changed.slice(progress.progress.nextOffset, progress.progress.enqueuedOffset);
		let states = await readStates(enqueued);
		let completePrefix = 0;
		while (states[completePrefix] === 'complete') completePrefix += 1;
		if (completePrefix > 0) {
			const nextOffset = progress.progress.nextOffset + completePrefix;
			const rangeComplete = nextOffset === progress.progress.enqueuedOffset;
			await advanceProgress({
				...progress.progress,
				nextOffset,
				...(rangeComplete
					? {
							enqueuedOffset: nextOffset,
							enqueuedAt: null,
							enqueueAttempts: 0
						}
					: {})
			});
			enqueued = enqueued.slice(completePrefix);
			states = states.slice(completePrefix);
		}
		if (enqueued.length > 0) {
			if (states.some((state) => state === 'missing')) {
				throw new PublicTemplateOgQueueStalledError('JSON_DISAPPEARED');
			}
			const enqueuedAt = progress.progress.enqueuedAt;
			if (
				enqueuedAt !== null &&
				Date.now() - enqueuedAt >= PUBLIC_TEMPLATE_OG_QUEUE_REPAIR_DELAY_MS
			) {
				if (progress.progress.enqueueAttempts >= PUBLIC_TEMPLATE_OG_QUEUE_REPAIR_ATTEMPTS_MAX) {
					throw new PublicTemplateOgQueueStalledError('REPAIR_EXHAUSTED');
				}
				const pending = enqueued.filter((_entry, index) => states[index] !== 'complete');
				const nextAttempt = progress.progress.enqueueAttempts + 1;
				// A UTC-day reservation is consumed before checkpoint mutation. A crash
				// can waste capacity safely but cannot emit an uncharged Queue message.
				await reserveQueueAttempts(pending, nextAttempt);
				await advanceProgress({
					...progress.progress,
					enqueuedAt: Date.now(),
					enqueueAttempts: nextAttempt
				});
				await sendRecordedIntent(pending);
			}
			throw new PublicTemplatePageBackfillIncompleteError();
		}
	}

	let selected = changed.slice(
		progress.progress.nextOffset,
		progress.progress.nextOffset + PUBLIC_TEMPLATE_PAGE_PUBLICATION_BATCH_MAX
	);
	let states = await readStates(selected);
	let alreadyComplete = 0;
	while (states[alreadyComplete] === 'complete') alreadyComplete += 1;
	if (alreadyComplete > 0) {
		const nextOffset = progress.progress.nextOffset + alreadyComplete;
		await advanceProgress({
			...progress.progress,
			nextOffset,
			enqueuedOffset: nextOffset,
			enqueuedAt: null,
			enqueueAttempts: 0
		});
		selected = selected.slice(alreadyComplete);
		states = states.slice(alreadyComplete);
	}
	if (selected.length === 0) {
		if (progress.progress.nextOffset < changed.length) {
			throw new PublicTemplatePageBackfillIncompleteError();
		}
	} else {
		const missing = selected.filter((_entry, index) => states[index] === 'missing');
		const materialized = (
			await Promise.all(
				Array.from(
					{ length: Math.ceil(missing.length / PUBLIC_TEMPLATE_PAGE_MATERIALIZATION_BATCH_SIZE) },
					(_, batchIndex) =>
						serverQuery(api.templates.publicTemplatePageArtifactsByCoordinates, {
							_secret: getInternalSecret(),
							expectedListRevision: manifest.list.revision,
							coordinates: missing
								.slice(
									batchIndex * PUBLIC_TEMPLATE_PAGE_MATERIALIZATION_BATCH_SIZE,
									(batchIndex + 1) * PUBLIC_TEMPLATE_PAGE_MATERIALIZATION_BATCH_SIZE
								)
								.map((entry) => ({
									templateId: entry.templateId,
									slug: entry.slug,
									artifactRevision: entry.artifactRevision
								}))
						})
				)
			)
		).flat();
		if (materialized.length !== missing.length) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_MATERIALIZATION_CARDINALITY_MISMATCH');
		}
		// Pages owns bounded Convex materialization and immutable JSON only. PNG
		// rasterization/compression is exclusively a Queue-consumer responsibility.
		for (
			let batchStart = 0;
			batchStart < materialized.length;
			batchStart += PUBLIC_TEMPLATE_PAGE_MATERIALIZATION_BATCH_SIZE
		) {
			await Promise.all(
				materialized
					.slice(batchStart, batchStart + PUBLIC_TEMPLATE_PAGE_MATERIALIZATION_BATCH_SIZE)
					.map(async (raw, batchIndex) => {
						const index = batchStart + batchIndex;
						const expected = missing[index]!;
						if (raw.slug !== expected.slug || raw.artifactRevision !== expected.artifactRevision) {
							throw new Error('PUBLIC_TEMPLATE_PAGE_MATERIALIZATION_ORDER_MISMATCH');
						}
						const artifact = buildPublicTemplatePageArtifact(raw);
						await publishPublicDiscoveryPayload(
							publicTemplatePageArtifactLogicalKey(expected.slug),
							{
								platform,
								projectCachedValue: readPublicTemplatePageArtifact,
								revision: expected.artifactRevision
							},
							async () => artifact
						);
					})
			);
		}
		const queued = selected.filter((_entry, index) => states[index] !== 'complete');
		await reserveQueueAttempts(queued, 1);
		// Persist the bounded send intent first. A crash or ambiguous send failure
		// can then consume at most one durable attempt; it cannot replay an
		// unrecorded Queue write on every workflow continuation.
		await advanceProgress({
			...progress.progress,
			enqueuedOffset: progress.progress.nextOffset + selected.length,
			enqueuedAt: Date.now(),
			enqueueAttempts: 1
		});
		await sendRecordedIntent(queued);
		throw new PublicTemplatePageBackfillIncompleteError();
	}
	if (progress.progress.nextOffset < changed.length) {
		throw new PublicTemplatePageBackfillIncompleteError();
	}

	// Convex writers are independent of the global Pages producer gate. Re-read
	// the small coordinates once before advertising the inventory; a concurrent
	// author/visibility/aggregate change resets the checkpoint instead of letting
	// an earlier processed slug point at an unmaterialized revision.
	const confirmedEntries = await readPublicTemplatePageCoordinates(manifest);
	const confirmedDigest = await publicTemplatePageCoordinateDigest(confirmedEntries);
	if (confirmedDigest !== coordinateDigest) {
		const confirmedChanged = confirmedEntries.filter(
			(entry) => priorBySlug.get(entry.slug) !== String(entry.artifactRevision)
		);
		const reset = await writePublicTemplatePageBackfillProgress({
			platform,
			expectedEtag: progress.etag,
			progress: {
				version: 1,
				generation: backfillGeneration,
				coordinateDigest: confirmedDigest,
				coordinates: confirmedEntries.map(({ templateId, slug, artifactRevision }) => ({
					templateId: String(templateId),
					slug,
					artifactRevision
				})),
				total: confirmedChanged.length,
				nextOffset: 0,
				enqueuedOffset: 0,
				enqueuedAt: null,
				enqueueAttempts: 0
			}
		});
		if (!reset) throw new PublicTemplatePageBackfillIncompleteError();
		throw new PublicTemplatePageBackfillIncompleteError();
	}

	const inventory = buildPublicTemplatePageInventory({
		version: 1,
		revision: manifest.list.revision,
		updatedAt: manifest.list.updatedAt,
		entries: confirmedEntries.map(({ slug, artifactRevision }) => ({
			slug,
			artifactRevision: String(artifactRevision)
		}))
	});
	await publishPublicDiscoveryPayload(
		PUBLIC_TEMPLATE_PAGE_INVENTORY_LOGICAL_KEY,
		{
			platform,
			projectCachedValue: readPublicTemplatePageInventory,
			retireRevisions: plan.retireGenerations.list,
			retiredRevisionFloor: manifest.list.retiredRevision,
			revision: snapshotGeneration(manifest.list.revision, manifest.list.updatedAt)
		},
		async () => inventory
	);
}

/**
 * Materialize all request-visible variants before the manifest coordinate is
 * committed to R2. Anonymous locations subsequently perform exact GETs only.
 */
async function publishPublicDiscoveryPayloads(
	platform: App.Platform,
	manifest: PublicDiscoveryManifest,
	previous: PublicDiscoveryManifest | null,
	plan: PublicDiscoveryPublicationPlan,
	allowPageArtifactBackfill: boolean,
	reserveOgQueueAttempts: ReservePublicTemplateOgQueueAttempts
): Promise<void> {
	await publishPublicTemplatePageArtifacts(
		platform,
		manifest,
		previous,
		plan,
		allowPageArtifactBackfill,
		reserveOgQueueAttempts
	);
	const publications: Array<Promise<unknown>> = [];
	for (const excludeCwc of [false, true] as const) {
		let listSnapshot: Promise<PublicTemplateSnapshot> | undefined;
		let relationsSnapshot: Promise<PublicRelationsSnapshot> | undefined;
		const loadList = () =>
			(listSnapshot ??= serverQuery(api.templates.publicDiscoveryList, {
				_secret: getInternalSecret(),
				excludeCwc
			}) as Promise<PublicTemplateSnapshot>);
		const loadRelations = () =>
			(relationsSnapshot ??= serverQuery(api.templates.publicDiscoveryRelations, {
				_secret: getInternalSecret(),
				excludeCwc
			}) as Promise<PublicRelationsSnapshot>);

		if (manifest.list.ready) {
			publications.push(
				publishExpectedSnapshot(
					platform,
					`templates:exclude-cwc=${excludeCwc ? '1' : '0'}`,
					'list',
					manifest.list,
					loadList,
					(snapshot) => projectPublicTemplateSnapshotContract(snapshot, excludeCwc),
					(value) => projectPublicTemplateCardsContract(value, excludeCwc),
					plan.retireGenerations.list,
					manifest.list.retiredRevision
				)
			);
		} else if (plan.retireGenerations.list.length > 0) {
			publications.push(
				retireWithdrawnPublicDiscoveryPayloads(`templates:exclude-cwc=${excludeCwc ? '1' : '0'}`, {
					platform,
					retiredRevisionFloor: manifest.list.retiredRevision,
					retireRevisions: plan.retireGenerations.list
				})
			);
		}

		if (manifest.list.ready && manifest.relations.ready) {
			const graphRevision = publicDiscoveryGraphGeneration(manifest);
			publications.push(
				publishPublicDiscoveryPayload(
					publicDiscoveryGraphLogicalKey(excludeCwc),
					{
						platform,
						projectCachedValue: (value, envelopeRevision) =>
							projectPublicDiscoveryGraphSurfaceContract(value, excludeCwc, envelopeRevision),
						retireRevisions: plan.retireGenerations.graph,
						retiredRevisionFloors: [
							manifest.list.retiredRevision,
							manifest.relations.retiredRevision
						],
						revision: graphRevision
					},
					async () => {
						const [list, relations] = await Promise.all([loadList(), loadRelations()]);
						if (!matchesGeneration(list, manifest.list)) {
							throw new PublicDiscoveryGenerationMismatchError('list', list, manifest.list);
						}
						if (!matchesGeneration(relations, manifest.relations)) {
							throw new PublicDiscoveryGenerationMismatchError(
								'relations',
								relations,
								manifest.relations
							);
						}
						return projectPublicDiscoveryGraphSurfaceForPublication(
							list,
							relations,
							excludeCwc,
							graphRevision
						);
					}
				)
			);
		} else if (plan.retireGenerations.graph.length > 0) {
			publications.push(
				retireWithdrawnPublicDiscoveryPayloads(publicDiscoveryGraphLogicalKey(excludeCwc), {
					platform,
					retiredRevisionFloors: [
						manifest.list.ready ? manifest.list.revision : manifest.list.retiredRevision,
						manifest.relations.ready
							? manifest.relations.revision
							: manifest.relations.retiredRevision
					],
					retireRevisions: plan.retireGenerations.graph
				})
			);
		}
	}
	await Promise.all(publications);
}

/** Authenticated cron/producer-push entrypoint; anonymous SSR never calls this. */
export function refreshPublicDiscoveryManifestControl(
	context: Required<Pick<PublicQueryContext, 'platform'>> & {
		allowPageArtifactBackfill?: boolean;
		reserveOgQueueAttempts: ReservePublicTemplateOgQueueAttempts;
	}
): Promise<CachedPublicDiscoveryManifest> {
	return refreshGloballyShieldedPublicDiscoveryManifest(
		{ platform: context.platform },
		() =>
			serverQuery(api.templates.publicDiscoveryManifest, {
				_secret: getInternalSecret()
			}),
		projectPublicDiscoveryManifestContract,
		{
			beforePublish: (manifest, previous, plan) =>
				publishPublicDiscoveryPayloads(
					context.platform,
					manifest,
					previous,
					plan,
					context.allowPageArtifactBackfill === true,
					context.reserveOgQueueAttempts
				),
			restorePreviousOnBeforePublishError: (error) =>
				error instanceof PublicTemplatePageBackfillIncompleteError ||
				error instanceof PublicTemplateOgQueueStalledError,
			publicationFailureCode: (error) =>
				error instanceof PublicTemplateOgQueueStalledError ? error.code : null
		}
	);
}

async function cacheExpectedSnapshot<TSnapshot extends SnapshotCoordinates, TValue>(
	context: PublicQueryContext,
	logicalKey: string,
	family: SnapshotFamily,
	expected: SnapshotCoordinates,
	loader: () => Promise<TSnapshot>,
	select: (snapshot: TSnapshot) => TValue,
	projectCachedValue: (value: unknown) => TValue,
	retiredRevisionFloor: number
): Promise<TValue> {
	return getCachedPublicData(
		logicalKey,
		{
			...context,
			freshForMs: PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS,
			r2Policy: 'read-only',
			revision: snapshotGeneration(expected.revision, expected.updatedAt),
			retiredRevisionFloor,
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
/**
 * The R2 publication shield is writable only by the deployed refresh gate, an
 * external Durable Object that has no counterpart outside Cloudflare. A local
 * backend therefore never has a manifest to read, which would leave every public
 * discovery surface empty against a fully seeded database. Fall back to the same
 * Convex producer the publication pipeline itself reads from, projected through
 * the identical contract so the shape callers receive does not change.
 *
 * Deployed builds never reach this: `import.meta.env.DEV` is a build-time
 * constant that is false there, so the shield error propagates and the surface
 * still fails closed.
 */
async function directPublicTemplatesWhenUnshielded(error: unknown, excludeCwc: boolean) {
	// Test mode is excluded deliberately: the suite asserts that a manifest
	// outage never authorizes a Convex read, which is the shield's whole purpose.
	// Only an interactive local server takes this path.
	if (!import.meta.env.DEV || import.meta.env.MODE === 'test') return null;
	if (!(error instanceof PublicDiscoveryManifestShieldError)) return null;
	const snapshot = (await serverQuery(api.templates.publicDiscoveryList, {
		_secret: getInternalSecret(),
		excludeCwc
	})) as PublicTemplateSnapshot;
	return projectPublicTemplateSnapshotContract(snapshot, excludeCwc);
}

export async function getCachedPublicTemplates(context: PublicQueryContext, excludeCwc: boolean) {
	const logicalKey = `templates:exclude-cwc=${excludeCwc ? '1' : '0'}`;
	let manifestAuthority: PublicDiscoveryManifestAuthority;
	try {
		manifestAuthority = await getCachedPublicDiscoveryManifestAuthority(context);
	} catch (error) {
		const direct = await directPublicTemplatesWhenUnshielded(error, excludeCwc);
		if (direct) return direct;
		throw error;
	}
	const { manifest } = manifestAuthority;
	if (!manifest.list.ready) throw new PublicDiscoverySnapshotNotReadyError('list');

	const read = (
		expected: SnapshotCoordinates,
		retiredRevisionFloor: number,
		prefetched?: unknown
	) =>
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
			(value) => projectPublicTemplateCardsContract(value, excludeCwc),
			retiredRevisionFloor
		);

	try {
		return await read(manifest.list, manifestAuthority.withdrawalFloors.list);
	} catch (error) {
		if (!(error instanceof PublicDiscoveryGenerationMismatchError) || error.family !== 'list') {
			throw error;
		}
		// Separate manifest and payload queries can straddle one atomic publication.
		// One dependency-invalidated manifest read closes that ordinary race and the
		// observed snapshot is reused when it already matches. If another publication
		// overtakes this bounded retry, fail closed and let the next request retry
		// instead of adding an unbounded read loop during an active publish storm.
		const freshAuthority = await getCachedPublicDiscoveryManifestAuthority(context, true);
		const freshManifest = freshAuthority.manifest;
		if (!freshManifest.list.ready) throw new PublicDiscoverySnapshotNotReadyError('list');
		const prefetched = matchesGeneration(error.snapshot as SnapshotCoordinates, freshManifest.list)
			? error.snapshot
			: undefined;
		return read(freshManifest.list, freshAuthority.withdrawalFloors.list, prefetched);
	}
}

/**
 * One bundled graph artifact: templates, twin edges, and concept relations.
 * A cold deployed graph request therefore spends at most two R2 Class-B reads
 * (manifest + surface) rather than three, preserving account-wide Free-tier
 * headroom at the Workers request ceiling.
 */
export async function getCachedPublicDiscoveryGraphSurface(
	context: PublicQueryContext,
	excludeCwc: boolean
): Promise<PublishedPublicDiscoveryGraphSurface> {
	const logicalKey = publicDiscoveryGraphLogicalKey(excludeCwc);
	const manifestAuthority = await getCachedPublicDiscoveryManifestAuthority(context);
	const { manifest } = manifestAuthority;
	if (!manifest.list.ready) throw new PublicDiscoverySnapshotNotReadyError('list');
	if (!manifest.relations.ready) {
		throw new PublicDiscoverySnapshotNotReadyError('relations');
	}

	const read = async (authority: CachedPublicDiscoveryManifest) => {
		const expected = authority.manifest;
		const expectedGeneration = publicDiscoveryGraphGeneration(expected);
		const surface = await getCachedPublicData(
			logicalKey,
			{
				...context,
				freshForMs: PUBLIC_DISCOVERY_PAYLOAD_FRESH_MS,
				r2Policy: 'read-only',
				revision: expectedGeneration,
				retiredRevisionFloors: [
					authority.withdrawalFloors.list,
					authority.withdrawalFloors.relations
				],
				projectCachedValue: (value, envelopeRevision) =>
					projectPublicDiscoveryGraphSurfaceContract(value, excludeCwc, envelopeRevision),
				shouldFallbackToStale: (error) => !(error instanceof PublicDiscoveryGenerationMismatchError)
			},
			async () => {
				const [list, relations] = (await Promise.all([
					serverQuery(api.templates.publicDiscoveryList, {
						_secret: getInternalSecret(),
						excludeCwc
					}),
					serverQuery(api.templates.publicDiscoveryRelations, {
						_secret: getInternalSecret(),
						excludeCwc
					})
				])) as [PublicTemplateSnapshot, PublicRelationsSnapshot];
				if (!matchesGeneration(list, expected.list)) {
					throw new PublicDiscoveryGenerationMismatchError('list', list, expected.list);
				}
				if (!matchesGeneration(relations, expected.relations)) {
					throw new PublicDiscoveryGenerationMismatchError(
						'relations',
						relations,
						expected.relations
					);
				}
				return projectPublicDiscoveryGraphSurfaceForPublication(
					list,
					relations,
					excludeCwc,
					expectedGeneration
				);
			}
		);
		return surface;
	};

	try {
		return await read(manifestAuthority);
	} catch (error) {
		if (!(error instanceof PublicDiscoveryGenerationMismatchError)) throw error;
		const freshAuthority = await getCachedPublicDiscoveryManifestAuthority(context, true);
		const freshManifest = freshAuthority.manifest;
		if (!freshManifest.list.ready) throw new PublicDiscoverySnapshotNotReadyError('list');
		if (!freshManifest.relations.ready) {
			throw new PublicDiscoverySnapshotNotReadyError('relations');
		}
		return read(freshAuthority);
	}
}

export async function getCachedPublicRelations(context: PublicQueryContext, excludeCwc: boolean) {
	const graph = await getCachedPublicDiscoveryGraphSurface(context, excludeCwc);
	return { twinEdges: graph.twinEdges, conceptRelations: graph.conceptRelations };
}

/** Compatibility selectors for non-homepage callers. They share one cache fill. */
export async function getCachedRelatednessEdges(context: PublicQueryContext, excludeCwc: boolean) {
	return (await getCachedPublicRelations(context, excludeCwc)).twinEdges;
}

export async function getCachedConceptRelations(context: PublicQueryContext, excludeCwc: boolean) {
	return (await getCachedPublicRelations(context, excludeCwc)).conceptRelations;
}
