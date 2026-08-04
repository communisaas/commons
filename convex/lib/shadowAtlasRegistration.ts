import { v, type Infer } from 'convex/values';

export const SHADOW_ATLAS_TREE1_MIN_DEPTH = 18;
export const SHADOW_ATLAS_TREE1_MAX_DEPTH = 24;
export const SHADOW_ATLAS_TREE1_MAX_LEAF_INDEX = 2 ** SHADOW_ATLAS_TREE1_MAX_DEPTH - 1;
export const SHADOW_ATLAS_TREE1_MAX_GENERATION = 1_000_000;
export const SHADOW_ATLAS_TREE1_REPAIR_OBSERVATION_MS = 15 * 60_000;

const BN254_MODULUS = BigInt(
	'21888242871839275222246405745257275088548364400416034343698204186575808495617'
);
const FIELD_HEX = /^0x[0-9a-fA-F]{1,64}$/u;
const IDENTITY_HEX = /^(?:0x)?[0-9a-fA-F]{64}$/u;
const LEAF_DIGEST = /^[0-9a-f]{64}$/u;
const IDEMPOTENCY_KEY =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FAILURE_CODE = /^[A-Z0-9_]{3,64}$/u;
const CONGRESSIONAL_DISTRICT = /^[A-Z]{2}-(?:AL|[0-9]{2})$/u;

export const shadowAtlasTree1OperationStateValidator = v.object({
	v: v.literal(1),
	identityCommitment: v.string(),
	operation: v.union(v.literal('register'), v.literal('replace')),
	generation: v.number(),
	leafDigest: v.string(),
	idempotencyKey: v.string(),
	priorLeafIndex: v.optional(v.number()),
	status: v.union(
		v.literal('reserved'),
		v.literal('dispatching'),
		v.literal('ambiguous'),
		v.literal('committed')
	),
	reservedAt: v.number(),
	dispatchStartedAt: v.optional(v.number()),
	ambiguousAt: v.optional(v.number()),
	lastFailureCode: v.optional(v.string()),
	committedAt: v.optional(v.number()),
	committedLeafIndex: v.optional(v.number()),
	updatedAt: v.number()
});

export type ShadowAtlasTree1OperationState = Infer<
	typeof shadowAtlasTree1OperationStateValidator
>;

export type ShadowAtlasTree1Operation = ShadowAtlasTree1OperationState['operation'];

export type ShadowAtlasTree1Proof = {
	leafIndex: number;
	merkleRoot: string;
	merklePath: string[];
};

export function normalizeShadowAtlasTree1Identity(value: string | undefined): string | null {
	if (!value || !IDENTITY_HEX.test(value)) return null;
	const digits = value.startsWith('0x') ? value.slice(2) : value;
	if (/^0+$/u.test(digits)) return null;
	return `0x${digits.toLowerCase()}`;
}

export function assertShadowAtlasTree1Generation(value: number): void {
	if (!Number.isSafeInteger(value) || value < 1 || value > SHADOW_ATLAS_TREE1_MAX_GENERATION) {
		throw new Error('SHADOW_ATLAS_TREE1_GENERATION_INVALID');
	}
}

export function assertShadowAtlasTree1LeafIndex(value: number): void {
	if (
		!Number.isSafeInteger(value) ||
		value < 0 ||
		value > SHADOW_ATLAS_TREE1_MAX_LEAF_INDEX
	) {
		throw new Error('SHADOW_ATLAS_TREE1_LEAF_INDEX_INVALID');
	}
}

export function assertShadowAtlasTree1LeafDigest(value: string): void {
	if (!LEAF_DIGEST.test(value)) throw new Error('SHADOW_ATLAS_TREE1_LEAF_DIGEST_INVALID');
}

export function assertShadowAtlasTree1IdempotencyKey(value: string): void {
	if (value.length > 64 || !IDEMPOTENCY_KEY.test(value)) {
		throw new Error('SHADOW_ATLAS_TREE1_IDEMPOTENCY_KEY_INVALID');
	}
}

export function assertShadowAtlasTree1FailureCode(value: string): void {
	if (!FAILURE_CODE.test(value)) throw new Error('SHADOW_ATLAS_TREE1_FAILURE_CODE_INVALID');
}

function assertFieldElement(value: string): void {
	if (!FIELD_HEX.test(value) || BigInt(value) >= BN254_MODULUS) {
		throw new Error('SHADOW_ATLAS_TREE1_FIELD_INVALID');
	}
}

export function assertShadowAtlasTree1Proof(value: ShadowAtlasTree1Proof): void {
	assertShadowAtlasTree1LeafIndex(value.leafIndex);
	assertFieldElement(value.merkleRoot);
	if (
		![18, 20, 22, 24].includes(value.merklePath.length)
	) {
		throw new Error('SHADOW_ATLAS_TREE1_PATH_LENGTH_INVALID');
	}
	if (value.leafIndex >= 2 ** value.merklePath.length) {
		throw new Error('SHADOW_ATLAS_TREE1_LEAF_INDEX_INVALID');
	}
	for (const field of value.merklePath) assertFieldElement(field);
}

export function sameShadowAtlasTree1Proof(
	left: ShadowAtlasTree1Proof,
	right: ShadowAtlasTree1Proof
): boolean {
	return (
		left.leafIndex === right.leafIndex &&
		left.merkleRoot === right.merkleRoot &&
		left.merklePath.length === right.merklePath.length &&
		left.merklePath.every((field, index) => field === right.merklePath[index])
	);
}

/** Tree 1 intentionally does not carry district plaintext. Hide legacy sentinels. */
export function publicShadowAtlasCongressionalDistrict(value: string): string {
	const normalized = value.trim().toUpperCase();
	return CONGRESSIONAL_DISTRICT.test(normalized) ? normalized : '';
}
