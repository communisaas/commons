export const SHADOW_ATLAS_REGISTRATION_RETRY_VERSION = 2 as const;
export const SHADOW_ATLAS_REGISTRATION_RETRY_PREFIX = 'retry:v2:';
export const SHADOW_ATLAS_REGISTRATION_RETRY_MAX_BYTES = 40 * 1024;
export const SHADOW_ATLAS_REGISTRATION_RETRY_TTL_SECONDS = 7 * 24 * 60 * 60;

const IDENTITY = /^0x[0-9a-f]{64}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FIELD = /^0x[0-9a-fA-F]{1,64}$/u;
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const MAX_LEAF_INDEX = 2 ** 24 - 1;
const BN254_MODULUS = BigInt(
	'21888242871839275222246405745257275088548364400416034343698204186575808495617'
);
const encoder = new TextEncoder();

export type ShadowAtlasRegistrationRetry = {
	version: typeof SHADOW_ATLAS_REGISTRATION_RETRY_VERSION;
	userId: string;
	identityCommitment: string;
	operation: 'register' | 'replace';
	generation: number;
	leafDigest: string;
	idempotencyKey: string;
	priorLeafIndex?: number;
	atlasResult: {
		leafIndex: number;
		userRoot: string;
		userPath: string[];
	};
	queuedAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	const expected = new Set(allowed);
	return Object.keys(value).every((key) => expected.has(key));
}

function validLeafIndex(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_LEAF_INDEX;
}

function validField(value: unknown): value is string {
	return typeof value === 'string' && FIELD.test(value) && BigInt(value) < BN254_MODULUS;
}

function assertRetry(value: unknown): asserts value is ShadowAtlasRegistrationRetry {
	if (!isRecord(value)) throw new Error('SHADOW_ATLAS_REGISTRATION_RETRY_INVALID');
	if (
		!exactKeys(value, [
			'version',
			'userId',
			'identityCommitment',
			'operation',
			'generation',
			'leafDigest',
			'idempotencyKey',
			'priorLeafIndex',
			'atlasResult',
			'queuedAt'
		]) ||
		value.version !== SHADOW_ATLAS_REGISTRATION_RETRY_VERSION ||
		typeof value.userId !== 'string' ||
		!USER_ID.test(value.userId) ||
		typeof value.identityCommitment !== 'string' ||
		!IDENTITY.test(value.identityCommitment) ||
		(value.operation !== 'register' && value.operation !== 'replace') ||
		!Number.isSafeInteger(value.generation) ||
		(value.generation as number) < 1 ||
		(value.generation as number) > 1_000_000 ||
		typeof value.leafDigest !== 'string' ||
		!DIGEST.test(value.leafDigest) ||
		typeof value.idempotencyKey !== 'string' ||
		!UUID.test(value.idempotencyKey) ||
		!Number.isSafeInteger(value.queuedAt) ||
		(value.queuedAt as number) < 0
	) {
		throw new Error('SHADOW_ATLAS_REGISTRATION_RETRY_INVALID');
	}
	if (
		(value.operation === 'register' && value.priorLeafIndex !== undefined) ||
		(value.operation === 'replace' && !validLeafIndex(value.priorLeafIndex))
	) {
		throw new Error('SHADOW_ATLAS_REGISTRATION_RETRY_INVALID');
	}
	if (
		!isRecord(value.atlasResult) ||
		!exactKeys(value.atlasResult, ['leafIndex', 'userRoot', 'userPath']) ||
		!validLeafIndex(value.atlasResult.leafIndex) ||
		!validField(value.atlasResult.userRoot) ||
		!Array.isArray(value.atlasResult.userPath) ||
		![18, 20, 22, 24].includes(value.atlasResult.userPath.length) ||
		(value.atlasResult.leafIndex as number) >= 2 ** value.atlasResult.userPath.length ||
		value.atlasResult.userPath.some((field) => !validField(field))
	) {
		throw new Error('SHADOW_ATLAS_REGISTRATION_RETRY_INVALID');
	}
}

export function encodeShadowAtlasRegistrationRetry(
	value: ShadowAtlasRegistrationRetry
): string {
	assertRetry(value);
	const encoded = JSON.stringify(value);
	if (encoder.encode(encoded).byteLength > SHADOW_ATLAS_REGISTRATION_RETRY_MAX_BYTES) {
		throw new Error('SHADOW_ATLAS_REGISTRATION_RETRY_TOO_LARGE');
	}
	return encoded;
}

export function parseShadowAtlasRegistrationRetry(raw: string): ShadowAtlasRegistrationRetry {
	if (encoder.encode(raw).byteLength > SHADOW_ATLAS_REGISTRATION_RETRY_MAX_BYTES) {
		throw new Error('SHADOW_ATLAS_REGISTRATION_RETRY_TOO_LARGE');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('SHADOW_ATLAS_REGISTRATION_RETRY_INVALID');
	}
	assertRetry(parsed);
	return parsed;
}

export function shadowAtlasRegistrationRetryKey(
	value: Pick<ShadowAtlasRegistrationRetry, 'userId' | 'generation' | 'idempotencyKey'>
): string {
	if (!USER_ID.test(value.userId) || !Number.isSafeInteger(value.generation) || !UUID.test(value.idempotencyKey)) {
		throw new Error('SHADOW_ATLAS_REGISTRATION_RETRY_KEY_INVALID');
	}
	return `${SHADOW_ATLAS_REGISTRATION_RETRY_PREFIX}${value.userId}:${value.generation}:${value.idempotencyKey}`;
}
