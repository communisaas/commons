import { v, type Infer } from 'convex/values';

// EngagementRootRegistry accepts registered roots for at most 180 days. This
// cache is deliberately far inside that protocol window; it collapses replays
// without depending on an unregistered or latest-root-only witness.
export const SHADOW_ATLAS_ENGAGEMENT_CACHE_TTL_MS = 60_000;
export const SHADOW_ATLAS_ENGAGEMENT_FAILURE_COOLDOWN_MS = 30_000;
export const SHADOW_ATLAS_ENGAGEMENT_LEASE_MS = 45_000;
export const SHADOW_ATLAS_ENGAGEMENT_REPAIR_OBSERVATION_MS = 15 * 60_000;
export const SHADOW_ATLAS_ENGAGEMENT_MAX_DEPTH = 24;
export const SHADOW_ATLAS_ENGAGEMENT_MAX_LEAF_INDEX = 2 ** SHADOW_ATLAS_ENGAGEMENT_MAX_DEPTH - 1;

export const shadowAtlasEngagementSnapshotValidator = v.object({
	engagementRoot: v.string(),
	engagementPath: v.array(v.string()),
	engagementIndex: v.number(),
	engagementTier: v.number(),
	actionCount: v.string(),
	diversityScore: v.string()
});

export type ShadowAtlasEngagementSnapshot = Infer<typeof shadowAtlasEngagementSnapshotValidator>;

export const shadowAtlasEngagementStateValidator = v.object({
	identityCommitment: v.string(),
	registrationGeneration: v.number(),
	registrationStatus: v.union(
		v.literal('unseen'),
		v.literal('write_reserved'),
		v.literal('registered')
	),
	leafIndex: v.optional(v.number()),
	registrationWriteReservedAt: v.optional(v.number()),
	leaseToken: v.optional(v.string()),
	leaseExpiresAt: v.optional(v.number()),
	nextAttemptAt: v.optional(v.number()),
	failureCount: v.number(),
	repairCount: v.number(),
	lastRepairAt: v.optional(v.number()),
	lastRepairOperator: v.optional(v.string()),
	lastRepairEvidence: v.optional(v.string()),
	lastFailureStage: v.optional(
		v.union(v.literal('metrics'), v.literal('registration'), v.literal('path'))
	),
	snapshot: v.optional(shadowAtlasEngagementSnapshotValidator),
	snapshotExpiresAt: v.optional(v.number()),
	updatedAt: v.number()
});

export type ShadowAtlasEngagementState = Infer<typeof shadowAtlasEngagementStateValidator>;

const FIELD_HEX = /^(?:0x)?[0-9a-fA-F]{64}$/u;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const LEASE_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DECIMAL = /^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,12})?$/u;
const ROOT_HEX = /^0x[0-9a-fA-F]{64}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const textEncoder = new TextEncoder();

export function normalizeShadowAtlasIdentityCommitment(value: string): string | null {
	if (!FIELD_HEX.test(value)) return null;
	const digits = value.startsWith('0x') ? value.slice(2) : value;
	if (/^0+$/u.test(digits)) return null;
	return `0x${digits.toLowerCase()}`;
}

export function normalizeShadowAtlasSignerAddress(value: string | undefined): string | null {
	return value && EVM_ADDRESS.test(value) ? value.toLowerCase() : null;
}

export function assertShadowAtlasLeaseToken(value: string): void {
	if (value.length > 64 || !LEASE_TOKEN.test(value)) {
		throw new Error('SHADOW_ATLAS_ENGAGEMENT_LEASE_TOKEN_INVALID');
	}
}

export function assertShadowAtlasLeafIndex(value: number): void {
	if (!Number.isSafeInteger(value) || value < 0 || value > SHADOW_ATLAS_ENGAGEMENT_MAX_LEAF_INDEX) {
		throw new Error('SHADOW_ATLAS_ENGAGEMENT_LEAF_INDEX_INVALID');
	}
}

export function assertShadowAtlasRegistrationGeneration(value: number): void {
	if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
		throw new Error('SHADOW_ATLAS_ENGAGEMENT_GENERATION_INVALID');
	}
}

export function normalizeShadowAtlasRepairReference(
	value: string,
	label: 'operator' | 'evidence'
): string {
	const normalized = value.normalize('NFKC').trim();
	const minimum = label === 'operator' ? 3 : 8;
	const maximum = label === 'operator' ? 128 : 256;
	if (
		normalized.length < minimum ||
		normalized.length > maximum ||
		textEncoder.encode(normalized).byteLength > maximum * 2 ||
		CONTROL_CHARACTERS.test(normalized)
	) {
		throw new Error(`SHADOW_ATLAS_ENGAGEMENT_REPAIR_${label.toUpperCase()}_INVALID`);
	}
	return normalized;
}

export function assertShadowAtlasEngagementSnapshot(value: ShadowAtlasEngagementSnapshot): void {
	if (!ROOT_HEX.test(value.engagementRoot)) {
		throw new Error('SHADOW_ATLAS_ENGAGEMENT_ROOT_INVALID');
	}
	if (
		value.engagementPath.length < 18 ||
		value.engagementPath.length > SHADOW_ATLAS_ENGAGEMENT_MAX_DEPTH ||
		value.engagementPath.some((element) => !ROOT_HEX.test(element))
	) {
		throw new Error('SHADOW_ATLAS_ENGAGEMENT_PATH_INVALID');
	}
	assertShadowAtlasLeafIndex(value.engagementIndex);
	if (
		!Number.isSafeInteger(value.engagementTier) ||
		value.engagementTier < 0 ||
		value.engagementTier > 4
	) {
		throw new Error('SHADOW_ATLAS_ENGAGEMENT_TIER_INVALID');
	}
	if (
		value.actionCount.length > 16 ||
		value.diversityScore.length > 32 ||
		!DECIMAL.test(value.actionCount) ||
		!DECIMAL.test(value.diversityScore)
	) {
		throw new Error('SHADOW_ATLAS_ENGAGEMENT_METRICS_INVALID');
	}
}
