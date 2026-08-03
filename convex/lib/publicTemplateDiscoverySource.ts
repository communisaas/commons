import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { getConvexSize, type Value } from 'convex/values';
import {
	MAX_TEMPLATE_DELIVERY_METHOD_BYTES,
	MAX_TEMPLATE_DESCRIPTION_BYTES,
	MAX_TEMPLATE_MESSAGE_BODY_BYTES,
	MAX_TEMPLATE_PREVIEW_BYTES,
	MAX_TEMPLATE_TITLE_BYTES,
	MAX_TEMPLATE_TYPE_BYTES
} from './templateInputBudget';
import { isCongressionalDelivery, isTemplateDeliveryMethod } from './templateDeliveryMethod';
import { kFloorCounter, kFloorDistrictCount } from './publicAggregatePrivacy';
import { publishableRosterCount, recipientIntentCount } from './recipientRoster';
import {
	verifyPublicRecipientProvenance,
	type PublicRecipientProvenanceClaims
} from './publicRecipientProvenance';
import {
	markPublicDiscoveryListDirty,
	type PublicDiscoveryListFreshnessClass
} from './publicDiscovery';

declare const process: { env: Record<string, string | undefined> };

export const PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION = 4;
export const MAX_PUBLIC_TEMPLATE_DISCOVERY_SOURCE_BYTES = 16_000;
export const PUBLIC_TEMPLATE_DETAIL_PROJECTION_VERSION = 2;
export const PUBLIC_TEMPLATE_PAGE_ARTIFACT_COORDINATE_VERSION = 1;
export const PUBLIC_TEMPLATE_PAGE_AUTHOR_COORDINATE_MAX = 250;
export const MAX_PUBLIC_TEMPLATE_DETAIL_PROJECTION_BYTES = 48 * 1024;
// The published relation corpus contains at most 50 templates and authoring
// accepts at most five topics per template. Retaining 250 therefore covers the
// complete valid-input envelope without turning ordinary distinct vocabulary
// into a degraded producer generation. Legacy rows above that envelope still
// shed deterministically before any vector reads.
export const MAX_PUBLIC_RELATION_TAG_VECTORS = 250;
export const MAX_PUBLIC_TEMPLATE_DISTRICT_COUNTS = 6;

/**
 * Exact durable-counter proof shared by request readers and launch
 * observability. A status string alone must never make an incoherent or
 * partially deployed migration row look ready.
 */
export function publicRecipientMigrationIntegrityReady(
	migration: Pick<
		Doc<'publicDiscoverySourceMigrations'>,
		| 'eligible'
		| 'recipientIntentTemplates'
		| 'recipientIntentRecipients'
		| 'recipientProjectedRecipients'
		| 'recipientLossTemplates'
		| 'recipientLossRecipients'
		| 'recipientLossClassifiedTemplates'
		| 'recipientLossClassifiedRecipients'
	>
): boolean {
	const counters: unknown[] = [
		migration.recipientIntentTemplates,
		migration.recipientIntentRecipients,
		migration.recipientProjectedRecipients,
		migration.recipientLossTemplates,
		migration.recipientLossRecipients,
		migration.recipientLossClassifiedTemplates,
		migration.recipientLossClassifiedRecipients
	];
	if (!counters.every((value) => Number.isSafeInteger(value) && (value as number) >= 0)) {
		return false;
	}
	const intentTemplates = migration.recipientIntentTemplates as number;
	const intentRecipients = migration.recipientIntentRecipients as number;
	const projectedRecipients = migration.recipientProjectedRecipients as number;
	const lossTemplates = migration.recipientLossTemplates as number;
	const lossRecipients = migration.recipientLossRecipients as number;
	const classifiedTemplates = migration.recipientLossClassifiedTemplates as number;
	const classifiedRecipients = migration.recipientLossClassifiedRecipients as number;
	return (
		Number.isSafeInteger(migration.eligible) &&
		migration.eligible >= 0 &&
		intentTemplates <= migration.eligible &&
		intentRecipients >= intentTemplates &&
		intentRecipients === projectedRecipients + lossRecipients &&
		lossTemplates <= intentTemplates &&
		lossRecipients <= intentRecipients &&
		lossRecipients >= lossTemplates &&
		classifiedTemplates <= lossTemplates &&
		classifiedRecipients <= lossRecipients &&
		classifiedRecipients >= classifiedTemplates &&
		classifiedTemplates === lossTemplates &&
		classifiedRecipients === lossRecipients &&
		(intentTemplates === 0) === (intentRecipients === 0) &&
		(lossTemplates === 0) === (lossRecipients === 0) &&
		(classifiedTemplates === 0) === (classifiedRecipients === 0)
	);
}

const DETAIL_TEXT_BYTES = {
	slug: 400,
	title: MAX_TEMPLATE_TITLE_BYTES,
	description: MAX_TEMPLATE_DESCRIPTION_BYTES,
	domain: 200,
	type: MAX_TEMPLATE_TYPE_BYTES,
	deliveryMethod: MAX_TEMPLATE_DELIVERY_METHOD_BYTES,
	messageBody: MAX_TEMPLATE_MESSAGE_BODY_BYTES,
	preview: MAX_TEMPLATE_PREVIEW_BYTES,
	topic: 100,
	email: 320,
	sourceTitle: 2_000,
	sourceUrl: 8_192,
	sourceType: 256,
	sourceRationale: 4_000,
	researchEntry: 4_000,
	recipientLabel: 2_048,
	recipientPublishedCopy: 8_192,
	location: 800
} as const;
const PUBLIC_DETAIL_SOURCE_CAP = 50;
const PUBLIC_DETAIL_RESEARCH_LOG_CAP = 200;
const PUBLIC_DETAIL_RECIPIENT_CAP = 50;

type PublicTemplateSource = {
	num: number;
	title: string;
	url: string;
	type: string;
	credibility_rationale?: string;
	incentive_position?: 'adversarial' | 'neutral' | 'aligned';
	source_order?: 'primary' | 'secondary' | 'opinion';
};

type PublicTemplateDetailDecisionMaker = {
	email: string;
	emailGrounded: true;
	emailSource: string;
	name: string;
	title: string;
	organization: string;
	role?: string;
	shortName?: string;
	roleCategory?: string;
	/** Explicitly published send-page copy; no other prompt-engineering field crosses this boundary. */
	accountabilityOpener?: string;
	relevanceRank?: number;
};

type PublicTemplateDetailRecipientConfig = {
	emails: string[];
	reach?: string;
	target_type?: string;
	cwcRouting?: boolean;
	includesCongress?: boolean;
	chambers?: string[];
	location?: Record<string, string>;
	decisionMakers?: PublicTemplateDetailDecisionMaker[];
};

/**
 * The exact template-owned input needed to build a public card and relation
 * membership. It deliberately excludes configs, cached research, recipients,
 * and every vector. Debate, endorsement, and organization display data remain
 * bounded live joins during the off-request materialization.
 */
export type CompactPublicTemplateSource = Pick<
	Doc<'templates'>,
	| 'slug'
	| 'title'
	| 'description'
	| 'domain'
	| 'category'
	| 'domainHue'
	| 'topics'
	| 'type'
	| 'deliveryMethod'
	| 'messageBody'
	| 'preview'
	| 'orgId'
	| 'endorsementCount'
	| 'verifiedSends'
	| 'uniqueDistricts'
	| 'dailyArrivals'
	| 'dailyArrivalsLastDay'
	| 'tierCounts'
	| 'campaignId'
	| 'status'
	| 'isPublic'
	| 'countryCode'
	| 'jurisdictions'
	| 'scopes'
> & {
	_id: Id<'templates'>;
	_creationTime: number;
	recipientCount: number;
	districtCounts: Array<{ code: string; count: number }>;
	districtCountsSuppressedDistricts: number;
	districtCountsSuppressedCount: number;
};

export type PublicTemplateDetailProjection = {
	id: Id<'templates'>;
	slug: string;
	title: string;
	description: string;
	domain: string;
	domainHue?: number;
	type: string;
	deliveryMethod: string;
	subject: string;
	message_body: string;
	sources: PublicTemplateSource[];
	research_log: string[];
	preview: string;
	is_public: true;
	verified_sends: number | null;
	unique_districts: number | null;
	send_count: number | null;
	delivery_config: Record<string, never>;
	cwc_config: null;
	recipient_config: PublicTemplateDetailRecipientConfig;
	recipient_count: number;
	recipientEmails: string[];
	topics: string[];
	createdAt: string;
};

export function normalizePublicDiscoveryTags(topics: unknown): string[] {
	if (!Array.isArray(topics)) return [];
	const seen = new Set<string>();
	for (const value of topics) {
		if (typeof value !== 'string') continue;
		const tag = value.trim();
		if (tag.length > 0) seen.add(tag);
	}
	return [...seen].sort((a, b) => a.localeCompare(b));
}

export function publicRecipientIntentCount(recipientConfig: unknown): number {
	// The object-only door is load-bearing and stays here rather than moving into
	// the shared arithmetic. `templates.recipientConfig` is `v.any()`, so a
	// JSON-STRING config is storable; the shared counter parses such a string,
	// which would turn 0 into N for that shape and silently move both migration
	// guards that use this function as an upper bound. String parsing belongs on
	// the wire-facing side, not on this stored-document counter.
	if (!recipientConfig || typeof recipientConfig !== 'object' || Array.isArray(recipientConfig)) {
		return 0;
	}
	return recipientIntentCount(recipientConfig);
}

/** Opaque, stable evidence coordinate for operator review; never stores raw PII. */
export async function publicRecipientIntentHash(recipientConfig: unknown): Promise<string> {
	const serialized = JSON.stringify(recipientConfig ?? null) ?? 'null';
	const digest = new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized))
	);
	return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function publicHttpUrl(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	try {
		const url = new URL(value);
		if (
			url.protocol !== 'https:' ||
			url.username.length > 0 ||
			url.password.length > 0 ||
			url.search.length > 0 ||
			url.hash.length > 0
		) {
			return undefined;
		}
		return url.toString();
	} catch {
		return undefined;
	}
}

const textEncoder = new TextEncoder();

function isBoundedString(value: unknown, maxBytes: number): value is string {
	return typeof value === 'string' && textEncoder.encode(value).byteLength <= maxBytes;
}

function isNonEmptyBoundedString(value: unknown, maxBytes: number): value is string {
	return isBoundedString(value, maxBytes) && value.trim().length > 0;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	const allowedKeys = new Set(allowed);
	return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function isPublicEmail(value: unknown): value is string {
	return (
		isBoundedString(value, DETAIL_TEXT_BYTES.email) &&
		value === value.trim() &&
		/^[^\s@]+@[^\s@]+$/.test(value)
	);
}

/** Citation URLs may legitimately contain query strings and fragments. */
function publicCitationUrl(value: unknown): string | undefined {
	if (!isBoundedString(value, DETAIL_TEXT_BYTES.sourceUrl)) return undefined;
	try {
		const url = new URL(value);
		if (
			(url.protocol !== 'https:' && url.protocol !== 'http:') ||
			url.username.length > 0 ||
			url.password.length > 0
		) {
			return undefined;
		}
		return value;
	} catch {
		return undefined;
	}
}

function projectPublicSources(value: unknown): PublicTemplateSource[] {
	if (!Array.isArray(value)) return [];
	const projected: PublicTemplateSource[] = [];
	for (const candidate of value.slice(0, PUBLIC_DETAIL_SOURCE_CAP)) {
		if (!isPlainRecord(candidate)) continue;
		const url = publicCitationUrl(candidate.url);
		if (
			typeof candidate.num !== 'number' ||
			!Number.isFinite(candidate.num) ||
			!isBoundedString(candidate.title, DETAIL_TEXT_BYTES.sourceTitle) ||
			!url ||
			!isBoundedString(candidate.type, DETAIL_TEXT_BYTES.sourceType)
		) {
			continue;
		}
		const source: PublicTemplateSource = {
			num: candidate.num,
			title: candidate.title,
			url,
			type: candidate.type
		};
		if (isBoundedString(candidate.credibility_rationale, DETAIL_TEXT_BYTES.sourceRationale)) {
			source.credibility_rationale = candidate.credibility_rationale;
		}
		if (
			candidate.incentive_position === 'adversarial' ||
			candidate.incentive_position === 'neutral' ||
			candidate.incentive_position === 'aligned'
		) {
			source.incentive_position = candidate.incentive_position;
		}
		if (
			candidate.source_order === 'primary' ||
			candidate.source_order === 'secondary' ||
			candidate.source_order === 'opinion'
		) {
			source.source_order = candidate.source_order;
		}
		projected.push(source);
	}
	return projected;
}

function projectPublicResearchLog(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((entry): entry is string => isBoundedString(entry, DETAIL_TEXT_BYTES.researchEntry))
		.slice(0, PUBLIC_DETAIL_RESEARCH_LOG_CAP);
}

function projectPublicDetailTopics(value: unknown): string[] {
	return normalizePublicDiscoveryTags(value)
		.filter((topic) => isBoundedString(topic, DETAIL_TEXT_BYTES.topic))
		.slice(0, 5);
}

export async function projectPublicDetailRecipientConfig(
	recipientConfig: unknown,
	userId: string,
	secrets: readonly (string | undefined)[],
	now = Date.now()
): Promise<PublicTemplateDetailRecipientConfig> {
	const projected: PublicTemplateDetailRecipientConfig = { emails: [] };
	if (!recipientConfig || typeof recipientConfig !== 'object' || Array.isArray(recipientConfig)) {
		return projected;
	}
	const config = recipientConfig as Record<string, unknown>;
	for (const field of ['reach', 'target_type'] as const) {
		if (isBoundedString(config[field], DETAIL_TEXT_BYTES.recipientLabel)) {
			projected[field] = config[field];
		}
	}
	for (const field of ['cwcRouting', 'includesCongress'] as const) {
		if (typeof config[field] === 'boolean') projected[field] = config[field];
	}
	if (Array.isArray(config.chambers)) {
		projected.chambers = config.chambers
			.filter((value): value is string => isBoundedString(value, DETAIL_TEXT_BYTES.recipientLabel))
			.slice(0, 4);
	}
	if (config.location && typeof config.location === 'object' && !Array.isArray(config.location)) {
		const location = config.location as Record<string, unknown>;
		const publicLocation: Record<string, string> = {};
		for (const field of ['city', 'jurisdiction', 'state', 'country'] as const) {
			if (isBoundedString(location[field], DETAIL_TEXT_BYTES.location)) {
				publicLocation[field] = location[field];
			}
		}
		if (Object.keys(publicLocation).length > 0) projected.location = publicLocation;
	}
	if (Array.isArray(config.decisionMakers)) {
		const decisionMakers: PublicTemplateDetailDecisionMaker[] = [];
		const emails = new Set<string>();
		for (const value of config.decisionMakers) {
			if (decisionMakers.length >= PUBLIC_DETAIL_RECIPIENT_CAP) break;
			const claims = await verifyPublicRecipientProvenance(value, userId, secrets, now);
			// Anonymous detail is an official-contact surface, not a compatibility
			// email extractor. Only a purpose-bound server attestation produced after
			// grounded agent resolution is eligible. Client-supplied flags, top-level
			// compatibility arrays, and manual/custom-recipient arrays confer no public
			// eligibility. The verifier returns the signed canonical claims, never the
			// mutable client object.
			if (!claims) continue;

			const publicDecisionMaker = publicDecisionMakerFromClaims(claims);
			decisionMakers.push(publicDecisionMaker);
			emails.add(publicDecisionMaker.email);
		}
		projected.emails = [...emails];
		if (decisionMakers.length > 0) projected.decisionMakers = decisionMakers;
	}
	return projected;
}

function publicDecisionMakerFromClaims(
	claims: PublicRecipientProvenanceClaims
): PublicTemplateDetailDecisionMaker {
	return {
		email: claims.email,
		emailGrounded: true,
		emailSource: claims.emailSource,
		name: claims.name,
		title: claims.title,
		organization: claims.organization,
		...(claims.role === undefined ? {} : { role: claims.role }),
		...(claims.shortName === undefined ? {} : { shortName: claims.shortName }),
		...(claims.roleCategory === undefined ? {} : { roleCategory: claims.roleCategory }),
		// Accountability opener is rendered into the public mailto body. It is the
		// sole prompt-like field intentionally published and is covered by the MAC.
		...(claims.accountabilityOpener === undefined
			? {}
			: { accountabilityOpener: claims.accountabilityOpener }),
		...(claims.relevanceRank === undefined ? {} : { relevanceRank: claims.relevanceRank })
	};
}

export function buildPublicTemplateDetailProjection(
	template: Doc<'templates'>,
	recipientConfig: PublicTemplateDetailRecipientConfig
): PublicTemplateDetailProjection {
	return {
		id: template._id,
		slug: template.slug,
		title: template.title,
		description: template.description,
		domain: resolveSourceDomain(template),
		domainHue: template.domainHue,
		type: template.type,
		deliveryMethod: template.deliveryMethod,
		subject: template.title,
		message_body: template.messageBody,
		sources: projectPublicSources(template.sources),
		research_log: projectPublicResearchLog(template.researchLog),
		preview: template.preview,
		is_public: true,
		verified_sends: kFloorCounter(template.verifiedSends),
		unique_districts: kFloorDistrictCount(template.uniqueDistricts),
		send_count: kFloorCounter(template.verifiedSends),
		delivery_config: {},
		cwc_config: null,
		recipient_config: recipientConfig,
		recipient_count: publishableRosterCount(recipientConfig),
		recipientEmails: recipientConfig.emails,
		topics: projectPublicDetailTopics(template.topics),
		createdAt: new Date(template._creationTime).toISOString()
	};
}

export function publicTemplateDetailProjectionBytes(
	detail: PublicTemplateDetailProjection
): number {
	return getConvexSize(detail as unknown as Value);
}

function invalidDetail(reason: string): never {
	throw new Error(`PUBLIC_TEMPLATE_DETAIL_PROJECTION_INVALID:${reason}`);
}

function readPublicSources(value: unknown): PublicTemplateSource[] {
	if (!Array.isArray(value) || value.length > PUBLIC_DETAIL_SOURCE_CAP) {
		return invalidDetail('sources');
	}
	return value.map((candidate, index) => {
		const url = isPlainRecord(candidate) ? publicCitationUrl(candidate.url) : undefined;
		if (
			!isPlainRecord(candidate) ||
			!hasOnlyKeys(candidate, [
				'num',
				'title',
				'url',
				'type',
				'credibility_rationale',
				'incentive_position',
				'source_order'
			]) ||
			typeof candidate.num !== 'number' ||
			!Number.isFinite(candidate.num) ||
			!isBoundedString(candidate.title, DETAIL_TEXT_BYTES.sourceTitle) ||
			!url ||
			!isBoundedString(candidate.type, DETAIL_TEXT_BYTES.sourceType)
		) {
			return invalidDetail(`sources.${index}`);
		}
		if (
			candidate.credibility_rationale !== undefined &&
			!isBoundedString(candidate.credibility_rationale, DETAIL_TEXT_BYTES.sourceRationale)
		) {
			return invalidDetail(`sources.${index}.credibility_rationale`);
		}
		if (
			candidate.incentive_position !== undefined &&
			candidate.incentive_position !== 'adversarial' &&
			candidate.incentive_position !== 'neutral' &&
			candidate.incentive_position !== 'aligned'
		) {
			return invalidDetail(`sources.${index}.incentive_position`);
		}
		if (
			candidate.source_order !== undefined &&
			candidate.source_order !== 'primary' &&
			candidate.source_order !== 'secondary' &&
			candidate.source_order !== 'opinion'
		) {
			return invalidDetail(`sources.${index}.source_order`);
		}
		return {
			num: candidate.num,
			title: candidate.title,
			url,
			type: candidate.type,
			...(candidate.credibility_rationale === undefined
				? {}
				: { credibility_rationale: candidate.credibility_rationale }),
			...(candidate.incentive_position === undefined
				? {}
				: { incentive_position: candidate.incentive_position }),
			...(candidate.source_order === undefined ? {} : { source_order: candidate.source_order })
		};
	});
}

function readPublicResearchLog(value: unknown): string[] {
	if (
		!Array.isArray(value) ||
		value.length > PUBLIC_DETAIL_RESEARCH_LOG_CAP ||
		value.some((entry) => !isBoundedString(entry, DETAIL_TEXT_BYTES.researchEntry))
	) {
		return invalidDetail('research_log');
	}
	return [...value] as string[];
}

function readPublicRecipientConfig(value: unknown): PublicTemplateDetailRecipientConfig {
	if (
		!isPlainRecord(value) ||
		!hasOnlyKeys(value, [
			'emails',
			'reach',
			'target_type',
			'cwcRouting',
			'includesCongress',
			'chambers',
			'location',
			'decisionMakers'
		]) ||
		!Array.isArray(value.emails) ||
		value.emails.length > PUBLIC_DETAIL_RECIPIENT_CAP ||
		value.emails.some((email) => !isPublicEmail(email)) ||
		new Set(value.emails).size !== value.emails.length
	) {
		return invalidDetail('recipient_config');
	}
	const result: PublicTemplateDetailRecipientConfig = {
		emails: [...value.emails] as string[]
	};
	for (const field of ['reach', 'target_type'] as const) {
		if (value[field] === undefined) continue;
		if (!isBoundedString(value[field], DETAIL_TEXT_BYTES.recipientLabel)) {
			return invalidDetail(`recipient_config.${field}`);
		}
		result[field] = value[field];
	}
	for (const field of ['cwcRouting', 'includesCongress'] as const) {
		if (value[field] === undefined) continue;
		if (typeof value[field] !== 'boolean') {
			return invalidDetail(`recipient_config.${field}`);
		}
		result[field] = value[field];
	}
	if (value.chambers !== undefined) {
		if (
			!Array.isArray(value.chambers) ||
			value.chambers.length > 4 ||
			value.chambers.some((chamber) => !isBoundedString(chamber, DETAIL_TEXT_BYTES.recipientLabel))
		) {
			return invalidDetail('recipient_config.chambers');
		}
		result.chambers = [...value.chambers];
	}
	if (value.location !== undefined) {
		if (
			!isPlainRecord(value.location) ||
			!hasOnlyKeys(value.location, ['city', 'jurisdiction', 'state', 'country'])
		) {
			return invalidDetail('recipient_config.location');
		}
		const location: Record<string, string> = {};
		for (const field of ['city', 'jurisdiction', 'state', 'country'] as const) {
			if (value.location[field] === undefined) continue;
			if (!isBoundedString(value.location[field], DETAIL_TEXT_BYTES.location)) {
				return invalidDetail(`recipient_config.location.${field}`);
			}
			location[field] = value.location[field];
		}
		if (Object.keys(location).length === 0) return invalidDetail('recipient_config.location.empty');
		result.location = location;
	}
	if (value.decisionMakers !== undefined) {
		if (
			!Array.isArray(value.decisionMakers) ||
			value.decisionMakers.length > PUBLIC_DETAIL_RECIPIENT_CAP
		) {
			return invalidDetail('recipient_config.decisionMakers');
		}
		const allowedEmails = new Set(result.emails);
		result.decisionMakers = value.decisionMakers.map((candidate, index) => {
			if (
				!isPlainRecord(candidate) ||
				!hasOnlyKeys(candidate, [
					'name',
					'title',
					'role',
					'shortName',
					'organization',
					'roleCategory',
					'accountabilityOpener',
					'email',
					'emailGrounded',
					'emailSource',
					'relevanceRank'
				])
			) {
				return invalidDetail(`recipient_config.decisionMakers.${index}`);
			}
			const emailSource = publicHttpUrl(candidate.emailSource);
			if (
				!isPublicEmail(candidate.email) ||
				candidate.emailGrounded !== true ||
				!emailSource ||
				emailSource !== candidate.emailSource ||
				!allowedEmails.has(candidate.email) ||
				!isNonEmptyBoundedString(candidate.name, DETAIL_TEXT_BYTES.recipientLabel) ||
				!isNonEmptyBoundedString(candidate.title, DETAIL_TEXT_BYTES.recipientLabel) ||
				!isNonEmptyBoundedString(candidate.organization, DETAIL_TEXT_BYTES.recipientLabel)
			) {
				return invalidDetail(`recipient_config.decisionMakers.${index}.provenance`);
			}
			const decisionMaker: PublicTemplateDetailDecisionMaker = {
				email: candidate.email,
				emailGrounded: true,
				emailSource,
				name: candidate.name,
				title: candidate.title,
				organization: candidate.organization
			};
			for (const field of ['role', 'shortName', 'roleCategory'] as const) {
				if (candidate[field] === undefined) continue;
				if (!isBoundedString(candidate[field], DETAIL_TEXT_BYTES.recipientLabel)) {
					return invalidDetail(`recipient_config.decisionMakers.${index}.${field}`);
				}
				decisionMaker[field] = candidate[field];
			}
			if (candidate.accountabilityOpener !== undefined) {
				if (
					!isBoundedString(candidate.accountabilityOpener, DETAIL_TEXT_BYTES.recipientPublishedCopy)
				) {
					return invalidDetail(`recipient_config.decisionMakers.${index}.accountabilityOpener`);
				}
				decisionMaker.accountabilityOpener = candidate.accountabilityOpener;
			}
			if (candidate.relevanceRank !== undefined) {
				if (
					typeof candidate.relevanceRank !== 'number' ||
					!Number.isFinite(candidate.relevanceRank)
				) {
					return invalidDetail(`recipient_config.decisionMakers.${index}.relevanceRank`);
				}
				decisionMaker.relevanceRank = candidate.relevanceRank;
			}
			return decisionMaker;
		});
	}
	const projectedEmails = [...new Set((result.decisionMakers ?? []).map(({ email }) => email))];
	if (
		projectedEmails.length !== result.emails.length ||
		projectedEmails.some((email, index) => email !== result.emails[index])
	) {
		return invalidDetail('recipient_config.email-derivation');
	}
	return result;
}

function isNullableCounter(value: unknown): value is number | null {
	return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

/**
 * Validate and rebuild the exact public contract. Returning a fresh object is
 * intentional: even if a stored `v.any()` row is poisoned with extra keys,
 * request-path object spread can never forward them.
 */
export function readPublicTemplateDetailProjection(value: unknown): PublicTemplateDetailProjection {
	if (!isPlainRecord(value)) return invalidDetail('container');
	const allowedKeys = [
		'id',
		'slug',
		'title',
		'description',
		'domain',
		'domainHue',
		'type',
		'deliveryMethod',
		'subject',
		'message_body',
		'sources',
		'research_log',
		'preview',
		'is_public',
		'verified_sends',
		'unique_districts',
		'send_count',
		'delivery_config',
		'cwc_config',
		'recipient_config',
		'recipient_count',
		'recipientEmails',
		'topics',
		'createdAt'
	] as const;
	if (!hasOnlyKeys(value, allowedKeys)) return invalidDetail('unknown-key');
	const bytes = getConvexSize(value as Value);
	if (bytes > MAX_PUBLIC_TEMPLATE_DETAIL_PROJECTION_BYTES) {
		throw new Error(
			`PUBLIC_TEMPLATE_DETAIL_PROJECTION_TOO_LARGE:${bytes}>${MAX_PUBLIC_TEMPLATE_DETAIL_PROJECTION_BYTES}`
		);
	}
	if (
		!isBoundedString(value.id, 128) ||
		!isBoundedString(value.slug, DETAIL_TEXT_BYTES.slug) ||
		value.slug.length === 0 ||
		!isBoundedString(value.title, DETAIL_TEXT_BYTES.title) ||
		!isBoundedString(value.description, DETAIL_TEXT_BYTES.description) ||
		!isBoundedString(value.domain, DETAIL_TEXT_BYTES.domain) ||
		!isBoundedString(value.type, DETAIL_TEXT_BYTES.type) ||
		!isBoundedString(value.deliveryMethod, DETAIL_TEXT_BYTES.deliveryMethod) ||
		!isBoundedString(value.subject, DETAIL_TEXT_BYTES.title) ||
		value.subject !== value.title ||
		!isBoundedString(value.message_body, DETAIL_TEXT_BYTES.messageBody) ||
		!isBoundedString(value.preview, DETAIL_TEXT_BYTES.preview) ||
		value.is_public !== true ||
		!isNullableCounter(value.verified_sends) ||
		!isNullableCounter(value.unique_districts) ||
		!isNullableCounter(value.send_count) ||
		value.send_count !== value.verified_sends ||
		!isPlainRecord(value.delivery_config) ||
		Object.keys(value.delivery_config).length !== 0 ||
		value.cwc_config !== null ||
		typeof value.recipient_count !== 'number' ||
		!Number.isSafeInteger(value.recipient_count) ||
		value.recipient_count < 0 ||
		value.recipient_count > 200 ||
		!Array.isArray(value.topics) ||
		value.topics.length > 5 ||
		value.topics.some((topic) => !isBoundedString(topic, DETAIL_TEXT_BYTES.topic)) ||
		new Set(value.topics).size !== value.topics.length ||
		!isBoundedString(value.createdAt, 32) ||
		Number.isNaN(Date.parse(value.createdAt)) ||
		new Date(value.createdAt).toISOString() !== value.createdAt
	) {
		return invalidDetail('shape');
	}
	if (
		value.domainHue !== undefined &&
		(typeof value.domainHue !== 'number' ||
			!Number.isFinite(value.domainHue) ||
			value.domainHue < 0 ||
			value.domainHue >= 360)
	) {
		return invalidDetail('domainHue');
	}
	const recipientConfig = readPublicRecipientConfig(value.recipient_config);
	const visibleRecipientCount = publishableRosterCount(recipientConfig);
	if (
		!Array.isArray(value.recipientEmails) ||
		value.recipientEmails.length !== recipientConfig.emails.length ||
		value.recipientEmails.some((email, index) => email !== recipientConfig.emails[index]) ||
		value.recipient_count !== visibleRecipientCount
	) {
		return invalidDetail('recipient-consistency');
	}
	return {
		id: value.id as Id<'templates'>,
		slug: value.slug,
		title: value.title,
		description: value.description,
		domain: value.domain,
		...(value.domainHue === undefined ? {} : { domainHue: value.domainHue }),
		type: value.type,
		deliveryMethod: value.deliveryMethod,
		subject: value.subject,
		message_body: value.message_body,
		sources: readPublicSources(value.sources),
		research_log: readPublicResearchLog(value.research_log),
		preview: value.preview,
		is_public: true,
		verified_sends: value.verified_sends,
		unique_districts: value.unique_districts,
		send_count: value.send_count,
		delivery_config: {},
		cwc_config: null,
		recipient_config: recipientConfig,
		recipient_count: value.recipient_count,
		recipientEmails: [...recipientConfig.emails],
		topics: [...value.topics] as string[],
		createdAt: value.createdAt
	};
}

export function assertPublicTemplateDetailProjection(
	value: unknown
): asserts value is PublicTemplateDetailProjection {
	void readPublicTemplateDetailProjection(value);
}

/** Keep the six UI-consumed leaders and preserve exact omitted count mass. */
export function compactPublicDistrictCounts(
	districtCounts: Array<{ code: string; count: number }> | undefined
): Pick<
	CompactPublicTemplateSource,
	'districtCounts' | 'districtCountsSuppressedDistricts' | 'districtCountsSuppressedCount'
> {
	const sorted = [...(districtCounts ?? [])].sort((a, b) => {
		if (a.count !== b.count) return b.count - a.count;
		return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
	});
	const retained = sorted.slice(0, MAX_PUBLIC_TEMPLATE_DISTRICT_COUNTS);
	const suppressed = sorted.slice(MAX_PUBLIC_TEMPLATE_DISTRICT_COUNTS);
	return {
		districtCounts: retained,
		districtCountsSuppressedDistricts: suppressed.length,
		districtCountsSuppressedCount: suppressed.reduce((total, row) => total + row.count, 0)
	};
}

export function isPublicDiscoveryTemplate(
	template: Pick<Doc<'templates'>, 'status' | 'isPublic'>
): boolean {
	return template.status === 'published' && template.isPublic;
}

export function buildCompactPublicTemplateSource(
	template: Doc<'templates'>
): CompactPublicTemplateSource {
	const districtCounts = compactPublicDistrictCounts(template.districtCounts);
	return {
		_id: template._id,
		_creationTime: template._creationTime,
		slug: template.slug,
		title: template.title,
		description: template.description,
		domain: template.domain,
		category: template.category,
		domainHue: template.domainHue,
		topics: normalizePublicDiscoveryTags(template.topics),
		type: template.type,
		deliveryMethod: template.deliveryMethod,
		messageBody: template.messageBody,
		preview: template.preview,
		orgId: template.orgId,
		endorsementCount: template.endorsementCount,
		verifiedSends: template.verifiedSends,
		uniqueDistricts: template.uniqueDistricts,
		dailyArrivals: template.dailyArrivals,
		dailyArrivalsLastDay: template.dailyArrivalsLastDay,
		...districtCounts,
		tierCounts: template.tierCounts,
		recipientCount: publicRecipientIntentCount(template.recipientConfig),
		campaignId: template.campaignId,
		status: template.status,
		isPublic: template.isPublic,
		countryCode: template.countryCode,
		jurisdictions: template.jurisdictions,
		scopes: template.scopes
	};
}

export function compactPublicTemplateSourceBytes(source: CompactPublicTemplateSource): number {
	return getConvexSize(source as unknown as Value);
}

/**
 * Refuse a stored producer blob that is not a whole, current public card.
 *
 * `publicTemplateDiscoverySources.source` is `v.any()`, so nothing about it is
 * checked by the schema. `deliveryMethod` is therefore admitted by MEMBERSHIP
 * in the closed column vocabulary — a value outside it is a refused row, never
 * a row that quietly reads as "not congressional" and enters the
 * congressional-free feed.
 *
 * `expectedIsCwc` is the row's own schema-constrained classification. Both it
 * and the blob are projections of one write, so a disagreement is drift: the
 * blob is refused rather than allowed to contradict the constrained column that
 * feed membership is decided from.
 */
export function assertCompactPublicTemplateSource(
	value: unknown,
	expectedIsCwc?: boolean
): asserts value is CompactPublicTemplateSource {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('PUBLIC_DISCOVERY_SOURCE_INVALID:container');
	}
	const source = value as Record<string, unknown>;
	if (
		typeof source._id !== 'string' ||
		typeof source._creationTime !== 'number' ||
		!Number.isFinite(source._creationTime) ||
		typeof source.slug !== 'string' ||
		typeof source.title !== 'string' ||
		typeof source.description !== 'string' ||
		typeof source.type !== 'string' ||
		!isTemplateDeliveryMethod(source.deliveryMethod) ||
		typeof source.messageBody !== 'string' ||
		typeof source.preview !== 'string' ||
		typeof source.recipientCount !== 'number' ||
		!Number.isFinite(source.recipientCount) ||
		!Array.isArray(source.districtCounts) ||
		source.districtCounts.length > MAX_PUBLIC_TEMPLATE_DISTRICT_COUNTS ||
		source.districtCounts.some(
			(row) =>
				!row ||
				typeof row !== 'object' ||
				Array.isArray(row) ||
				typeof (row as Record<string, unknown>).code !== 'string' ||
				!Number.isSafeInteger((row as Record<string, unknown>).count) ||
				((row as Record<string, unknown>).count as number) < 0
		) ||
		!Number.isSafeInteger(source.districtCountsSuppressedDistricts) ||
		(source.districtCountsSuppressedDistricts as number) < 0 ||
		!Number.isSafeInteger(source.districtCountsSuppressedCount) ||
		(source.districtCountsSuppressedCount as number) < 0 ||
		source.status !== 'published' ||
		source.isPublic !== true
	) {
		throw new Error('PUBLIC_DISCOVERY_SOURCE_INVALID:shape');
	}
	if (
		expectedIsCwc !== undefined &&
		expectedIsCwc !== isCongressionalDelivery(source.deliveryMethod)
	) {
		throw new Error(`PUBLIC_DISCOVERY_SOURCE_INVALID:isCwc:${String(source._id)}`);
	}
	const bytes = getConvexSize(value as Value);
	if (bytes > MAX_PUBLIC_TEMPLATE_DISCOVERY_SOURCE_BYTES) {
		throw new Error(
			`PUBLIC_DISCOVERY_SOURCE_TOO_LARGE:${bytes}>${MAX_PUBLIC_TEMPLATE_DISCOVERY_SOURCE_BYTES}`
		);
	}
}

/**
 * One discovery row read as a trusted snapshot candidate.
 *
 * This is the only place a stored row becomes usable input, and it is what
 * makes "is this template bound for Congress?" a single decision: the answer is
 * the schema-constrained `isCwc: v.boolean()` column, carried alongside the blob
 * instead of re-derived from it. A caller that wants to filter the
 * congressional-free feed reads `candidate.isCwc`; there is no second answer to
 * disagree with, because the blob is refused when it disagrees.
 */
export type PublicTemplateDiscoveryCandidate = {
	isCwc: boolean;
	source: CompactPublicTemplateSource;
};

export function readPublicTemplateDiscoveryCandidate(
	row: Pick<Doc<'publicTemplateDiscoverySources'>, 'isCwc' | 'source'>
): PublicTemplateDiscoveryCandidate {
	assertCompactPublicTemplateSource(row.source, row.isCwc);
	return { isCwc: row.isCwc, source: row.source };
}

function resolveSourceDomain(template: Doc<'templates'>): string {
	if (template.domain) return template.domain;
	return template.category && template.category !== 'General' ? template.category : '';
}

function isFiniteEmbeddingVector(value: unknown): value is number[] {
	return (
		Array.isArray(value) &&
		value.length === 768 &&
		value.every((component) => typeof component === 'number' && Number.isFinite(component))
	);
}

async function activeGeneration(ctx: MutationCtx): Promise<string> {
	const migration = await ctx.db
		.query('publicDiscoverySourceMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'v1'))
		.unique();
	return migration?.runToken ?? 'precutover';
}

function nextArtifactRevision(existing: number | undefined, now: number): number {
	return Math.max(now, (existing ?? 0) + 1);
}

/**
 * Aggregate-only writers advance one tiny coordinate in the same transaction.
 * A missing row means the template is not currently eligible (or the operator
 * has not completed the additive backfill), so private activity never creates
 * public inventory membership on its own.
 */
export async function bumpPublicTemplatePageArtifactAggregateRevision(
	ctx: MutationCtx,
	templateId: Id<'templates'>,
	now = Date.now(),
	freshnessClass: PublicDiscoveryListFreshnessClass = 'aggregate'
): Promise<boolean> {
	const coordinate = await ctx.db
		.query('publicTemplatePageArtifactCoordinates')
		.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
		.unique();
	if (!coordinate) return false;
	await ctx.db.patch(coordinate._id, {
		aggregateUpdatedAt: now,
		artifactRevision: nextArtifactRevision(coordinate.artifactRevision, now),
		updatedAt: now
	});
	// The coordinate and its producer token are one transactional invariant.
	// Callers cannot advance an immutable page revision without making a later
	// list generation observable to the off-request R2 publisher.
	await markPublicDiscoveryListDirty(ctx, freshnessClass, now);
	return true;
}

/**
 * Public author display is part of the immutable artifact. Profile writers use
 * this bounded reverse index so a name/avatar change advances every eligible
 * page coordinate and the prompt (<=60s) list publication in one transaction.
 */
export async function bumpPublicTemplatePageArtifactsForAuthor(
	ctx: MutationCtx,
	userId: Id<'users'>,
	now = Date.now()
): Promise<number> {
	const coordinates = await ctx.db
		.query('publicTemplatePageArtifactCoordinates')
		.withIndex('by_userId', (q) => q.eq('userId', userId))
		.take(PUBLIC_TEMPLATE_PAGE_AUTHOR_COORDINATE_MAX + 1);
	if (coordinates.length > PUBLIC_TEMPLATE_PAGE_AUTHOR_COORDINATE_MAX) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_AUTHOR_COORDINATE_CAP_EXCEEDED');
	}
	for (const coordinate of coordinates) {
		await ctx.db.patch(coordinate._id, {
			artifactRevision: nextArtifactRevision(coordinate.artifactRevision, now),
			detailUpdatedAt: now,
			updatedAt: now
		});
	}
	if (coordinates.length > 0) await markPublicDiscoveryListDirty(ctx, 'authored', now);
	return coordinates.length;
}

async function syncCompactPublicDiscoveryProjectionRow(
	ctx: MutationCtx,
	template: Doc<'templates'>,
	generation: string
): Promise<{ source: boolean; publicRecipientCount: number }> {
	const [existingSource, existingDetail] = await Promise.all([
		ctx.db
			.query('publicTemplateDiscoverySources')
			.withIndex('by_templateId', (q) => q.eq('templateId', template._id))
			.unique(),
		ctx.db
			.query('publicTemplateDetailProjections')
			.withIndex('by_templateId', (q) => q.eq('templateId', template._id))
			.unique()
	]);
	const existingPageCoordinate = await ctx.db
		.query('publicTemplatePageArtifactCoordinates')
		.withIndex('by_templateId', (q) => q.eq('templateId', template._id))
		.unique();

	if (!isPublicDiscoveryTemplate(template)) {
		if (existingSource) await ctx.db.delete(existingSource._id);
		if (existingDetail) await ctx.db.delete(existingDetail._id);
		if (existingPageCoordinate) await ctx.db.delete(existingPageCoordinate._id);
		return { source: false, publicRecipientCount: 0 };
	}

	const sourceCandidate = buildCompactPublicTemplateSource(template);
	let recipientConfig: PublicTemplateDetailRecipientConfig | undefined;
	if (existingDetail && existingDetail.userId === template.userId) {
		try {
			// Recipient eligibility is immutable after template creation. Reuse the
			// already-validated safe projection on high-frequency counter writes and
			// across projection-version rebuilds. The current exhaustive reader, not
			// the stored version number, is authoritative; this preserves a roster
			// whose original 24-hour provenance MAC has legitimately expired without
			// ever trusting an unsigned legacy projection or a different author.
			const existingSafeDetail = readPublicTemplateDetailProjection(existingDetail.detail);
			// Never retain more public recipients than the current private config says
			// exist. This keeps migration accounting exact if a legacy config was
			// cleared while preserving a still-valid roster across version bumps.
			if (
				existingSafeDetail.recipient_count <= publicRecipientIntentCount(template.recipientConfig)
			) {
				recipientConfig = existingSafeDetail.recipient_config;
			}
		} catch {
			// A malformed stored projection is never trusted. Rebuild it from current
			// signed input below; unsigned legacy input consequently fails closed.
		}
	}
	if (!recipientConfig) {
		recipientConfig = await projectPublicDetailRecipientConfig(
			template.recipientConfig,
			template.userId ? String(template.userId) : '',
			[process.env.INTERNAL_API_SECRET, process.env.INTERNAL_API_SECRET_PREVIOUS]
		);
	}
	const detail = readPublicTemplateDetailProjection(
		buildPublicTemplateDetailProjection(template, recipientConfig)
	);
	const detailBytes = publicTemplateDetailProjectionBytes(detail);
	const detailChanged =
		!existingDetail ||
		existingDetail.projectionVersion !== PUBLIC_TEMPLATE_DETAIL_PROJECTION_VERSION ||
		existingDetail.slug !== template.slug ||
		String(existingDetail.userId ?? '') !== String(template.userId ?? '') ||
		existingDetail.detailBytes !== detailBytes ||
		JSON.stringify(existingDetail.detail) !== JSON.stringify(detail);
	// The public card and the detail/send surface must describe the same
	// actionable roster. Private authoring intent can be larger when unsigned
	// legacy recipients were deliberately redacted during migration; exposing
	// that private count on the landing card would advertise an action the public
	// detail projection cannot perform.
	const source: CompactPublicTemplateSource = {
		...sourceCandidate,
		recipientCount: detail.recipient_count
	};
	const sourceBytes = compactPublicTemplateSourceBytes(source);
	if (sourceBytes > MAX_PUBLIC_TEMPLATE_DISCOVERY_SOURCE_BYTES) {
		if (existingSource) await ctx.db.delete(existingSource._id);
		if (existingDetail) await ctx.db.delete(existingDetail._id);
		throw new Error(
			`PUBLIC_DISCOVERY_SOURCE_TOO_LARGE:${template._id}:${sourceBytes}>${MAX_PUBLIC_TEMPLATE_DISCOVERY_SOURCE_BYTES}`
		);
	}
	if (detailBytes > MAX_PUBLIC_TEMPLATE_DETAIL_PROJECTION_BYTES) {
		if (existingSource) await ctx.db.delete(existingSource._id);
		if (existingDetail) await ctx.db.delete(existingDetail._id);
		throw new Error(
			`PUBLIC_TEMPLATE_DETAIL_PROJECTION_TOO_LARGE:${template._id}:${detailBytes}>${MAX_PUBLIC_TEMPLATE_DETAIL_PROJECTION_BYTES}`
		);
	}
	const sourceRow = {
		templateId: template._id,
		generation,
		templateCreatedAt: template._creationTime,
		isCwc: template.deliveryMethod === 'cwc',
		title: template.title,
		domain: resolveSourceDomain(template),
		countryCode: template.countryCode,
		projectionVersion: PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION,
		source,
		sourceBytes,
		updatedAt: Date.now()
	};
	if (existingSource) await ctx.db.patch(existingSource._id, sourceRow);
	else await ctx.db.insert('publicTemplateDiscoverySources', sourceRow);
	const projectionUpdatedAt = Date.now();
	const detailRow = {
		templateId: template._id,
		slug: template.slug,
		userId: template.userId,
		projectionVersion: PUBLIC_TEMPLATE_DETAIL_PROJECTION_VERSION,
		detail,
		detailBytes,
		updatedAt: projectionUpdatedAt
	};
	if (existingDetail) {
		if (detailChanged) await ctx.db.patch(existingDetail._id, detailRow);
	} else {
		await ctx.db.insert('publicTemplateDetailProjections', detailRow);
	}
	const artifactContentChanged = !existingPageCoordinate || detailChanged;
	const coordinateRow = {
		templateId: template._id,
		userId: template.userId,
		generation,
		slug: template.slug,
		projectionVersion: PUBLIC_TEMPLATE_PAGE_ARTIFACT_COORDINATE_VERSION,
		artifactRevision: artifactContentChanged
			? nextArtifactRevision(existingPageCoordinate?.artifactRevision, projectionUpdatedAt)
			: existingPageCoordinate.artifactRevision,
		detailUpdatedAt: artifactContentChanged
			? projectionUpdatedAt
			: existingPageCoordinate.detailUpdatedAt,
		aggregateUpdatedAt: existingPageCoordinate?.aggregateUpdatedAt ?? projectionUpdatedAt,
		updatedAt: artifactContentChanged ? projectionUpdatedAt : existingPageCoordinate.updatedAt
	};
	if (existingPageCoordinate) await ctx.db.patch(existingPageCoordinate._id, coordinateRow);
	else await ctx.db.insert('publicTemplatePageArtifactCoordinates', coordinateRow);
	return { source: true, publicRecipientCount: detail.recipient_count };
}

/**
 * Maintain only the compact, embedding-free card/relation-membership row.
 * Counter and metadata writers use this path so they do not read or rewrite
 * unchanged 768-dimensional vectors. If a template becomes ineligible, its
 * template-owned topic vector is removed as part of the same mutation.
 */
export async function syncCompactPublicDiscoveryProjection(
	ctx: MutationCtx,
	template: Doc<'templates'>,
	requestedGeneration?: string
): Promise<{ source: boolean; publicRecipientCount: number }> {
	const generation = requestedGeneration ?? (await activeGeneration(ctx));
	const result = await syncCompactPublicDiscoveryProjectionRow(ctx, template, generation);
	if (!result.source) {
		const existingTopic = await ctx.db
			.query('publicTemplateTopicVectors')
			.withIndex('by_templateId', (q) => q.eq('templateId', template._id))
			.unique();
		if (existingTopic) await ctx.db.delete(existingTopic._id);
	}
	return result;
}

/**
 * Atomically maintain every template-owned input used by discovery. Use this
 * full path for inserts and embedding changes; projection-only writers should
 * call syncCompactPublicDiscoveryProjection to avoid vector I/O.
 */
export async function syncCompactPublicDiscoverySource(
	ctx: MutationCtx,
	template: Doc<'templates'>,
	requestedGeneration?: string
): Promise<{ source: boolean; topic: boolean; tags: number; publicRecipientCount: number }> {
	const generation = requestedGeneration ?? (await activeGeneration(ctx));
	const projection = await syncCompactPublicDiscoveryProjection(ctx, template, generation);
	if (!projection.source) {
		return { source: false, topic: false, tags: 0, publicRecipientCount: 0 };
	}

	const existingTopic = await ctx.db
		.query('publicTemplateTopicVectors')
		.withIndex('by_templateId', (q) => q.eq('templateId', template._id))
		.unique();

	let wroteTopic = false;
	if (isFiniteEmbeddingVector(template.topicEmbedding)) {
		const topicRow = {
			templateId: template._id,
			generation,
			embedding: template.topicEmbedding,
			embeddingVersion: template.embeddingVersion,
			updatedAt:
				template.topicEmbeddingsUpdatedAt ?? template.embeddingsUpdatedAt ?? template.updatedAt
		};
		if (existingTopic) await ctx.db.patch(existingTopic._id, topicRow);
		else await ctx.db.insert('publicTemplateTopicVectors', topicRow);
		wroteTopic = true;
	} else if (existingTopic) {
		await ctx.db.delete(existingTopic._id);
	}

	const currentTags = new Set(normalizePublicDiscoveryTags(template.topics));
	let tagsWritten = 0;
	for (const value of Array.isArray(template.tagEmbeddings) ? template.tagEmbeddings : []) {
		if (
			!value ||
			typeof value.tag !== 'string' ||
			!currentTags.has(value.tag) ||
			!isFiniteEmbeddingVector(value.embedding)
		) {
			continue;
		}
		const existing = await ctx.db
			.query('publicTagEmbeddingVectors')
			.withIndex('by_tag', (q) => q.eq('tag', value.tag))
			.unique();
		const row = {
			tag: value.tag,
			embedding: value.embedding,
			embeddingVersion: template.embeddingVersion,
			updatedAt: template.embeddingsUpdatedAt ?? template.updatedAt
		};
		if (existing) await ctx.db.patch(existing._id, row);
		else await ctx.db.insert('publicTagEmbeddingVectors', row);
		tagsWritten += 1;
	}
	return {
		source: true,
		topic: wroteTopic,
		tags: tagsWritten,
		publicRecipientCount: projection.publicRecipientCount
	};
}

export async function deleteCompactPublicDiscoverySource(
	ctx: MutationCtx,
	templateId: Id<'templates'>
): Promise<void> {
	const [source, topic, detail, pageCoordinate] = await Promise.all([
		ctx.db
			.query('publicTemplateDiscoverySources')
			.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
			.unique(),
		ctx.db
			.query('publicTemplateTopicVectors')
			.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
			.unique(),
		ctx.db
			.query('publicTemplateDetailProjections')
			.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
			.unique(),
		ctx.db
			.query('publicTemplatePageArtifactCoordinates')
			.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
			.unique()
	]);
	if (source) await ctx.db.delete(source._id);
	if (topic) await ctx.db.delete(topic._id);
	if (detail) await ctx.db.delete(detail._id);
	if (pageCoordinate) await ctx.db.delete(pageCoordinate._id);
}
