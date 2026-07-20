/** Shared, allocation-bounded validation for debate-market HTTP inputs. */

export const DEBATE_PROOF_MAX_CHARS = 64 * 1024;
export const THREE_TREE_PUBLIC_INPUT_COUNT = 31;
export const VALID_THREE_TREE_DEPTHS = [18, 20, 22, 24] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isSafeUint(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function isBytes32(value: unknown): value is string {
	return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Proofs are encoded as hex strings. The character limit is deliberately
 * checked before the regular expression so an attacker cannot hand a very
 * large string to the regex engine after passing the streaming body limit.
 */
export function isBoundedHexBytes(
	value: unknown,
	maxChars: number = DEBATE_PROOF_MAX_CHARS
): value is string {
	if (typeof value !== 'string' || value.length < 2 || value.length > maxChars) return false;
	const raw = value.startsWith('0x') ? value.slice(2) : value;
	return raw.length > 0 && raw.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(raw);
}

/** BN254 inputs arrive as either a bounded decimal integer or a bytes32 hex value. */
export function isBoundedFieldElement(value: unknown): value is string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 80) return false;
	return /^(?:0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/.test(value);
}

export function isThreeTreePublicInputs(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.length === THREE_TREE_PUBLIC_INPUT_COUNT &&
		value.every(isBoundedFieldElement)
	);
}
