/**
 * District Format Utilities (shared between server and browser clients)
 *
 * Converts between different district ID representations:
 * - Substrate FIPS format: "cd-0601" (2-digit state FIPS + 2-digit district)
 * - Display format: "CA-01", "VT-AL"
 * - Normalized format: uppercase, trimmed, for consistent hashing
 */

/**
 * FIPS state codes to two-letter postal abbreviations.
 * Used to convert substrate's district ID format (cd-0601) to commons' (CA-01).
 */
const FIPS_TO_STATE: Record<string, string> = {
	'01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
	'08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
	'13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
	'19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
	'24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
	'29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
	'34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
	'39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
	'45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
	'50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
	'56': 'WY', '60': 'AS', '66': 'GU', '69': 'MP', '72': 'PR',
	'78': 'VI',
};

/**
 * Canonical slot index for the congressional district within the 24-slot
 * districts[] array stored in atlas chunks and proof public inputs.
 *
 * MUST match position 0 of US_SLOT_NAMES in client.ts AND voter-protocol's
 * CIRCUIT_SLOT_NAMES. Any divergence is a correctness bug — registration,
 * proof generation, and TEE delivery all assume slot 0 = CD.
 *
 * Hardcoding `0` at call sites instead of importing this constant has been
 * a recurring source of bugs (see G2r findings); always import.
 */
export const CONGRESSIONAL_SLOT_INDEX = 0;

/**
 * Compare two BN254 field hex strings by numeric value, not string equality.
 *
 * `0x1`, `0x01`, `0x0001` all represent the same field element but compare
 * unequal as strings. Atlas data, district indexes, and witness values can
 * each canonicalize differently — `BigInt(hex) === BigInt(hex)` covers all
 * representations including missing-prefix and case variation.
 *
 * Returns false if either input is malformed (non-hex, missing). Caller
 * MUST validate non-undefined separately if "missing" should distinguish
 * from "value mismatch" (atlas corruption vs boundary cell, per G2r).
 */
export function bn254HexEqual(a: string | undefined, b: string | undefined): boolean {
	if (typeof a !== 'string' || typeof b !== 'string') return false;
	if (a === '' || b === '') return false;
	try {
		const ah = a.startsWith('0x') || a.startsWith('0X') ? a : '0x' + a;
		const bh = b.startsWith('0x') || b.startsWith('0X') ? b : '0x' + b;
		return BigInt(ah) === BigInt(bh);
	} catch {
		return false;
	}
}

/**
 * Decode a BN254 field hex string back to its substrate-encoded source.
 *
 * The build pipeline encodes substrate IDs (e.g., "cd-0601") into BN254
 * field elements via UTF-8 byte-packing in `encodeUsGeoid` (voter-protocol/
 * packages/shadow-atlas/src/jurisdiction.ts:227). This is the inverse:
 * BN254 hex → bigint → bytes → UTF-8 string.
 *
 * Numeric paths (encoded as `BigInt(geoid)` directly): the bigint's UTF-8
 * decode yields garbage; caller falls through to `convertDistrictId` which
 * passes the input through unchanged.
 *
 * Used by the TEE delivery path (G7 option-c routing) so the resolver can
 * read witness.districts[0] — which is bound to the cellId via the SMT
 * inclusion proof — and convert it to the display code consumers expect.
 *
 * Returns the original hex if decoding fails (consumer treats as opaque).
 */
export function decodeBN254HexToSubstrate(hexValue: string): string {
	if (!hexValue || typeof hexValue !== 'string') return hexValue;
	const clean = hexValue.startsWith('0x') ? hexValue.slice(2) : hexValue;
	if (clean.length === 0 || !/^[0-9a-fA-F]+$/.test(clean)) return hexValue;

	let value: bigint;
	try {
		value = BigInt('0x' + clean);
	} catch {
		return hexValue;
	}
	if (value === 0n) return hexValue;

	// Reverse UTF-8 byte-packing. encodeUsGeoid packs bytes left-to-right
	// (`result = (result << 8) | byte`), so the bigint is big-endian bytes.
	const bytes: number[] = [];
	let v = value;
	while (v > 0n) {
		bytes.unshift(Number(v & 0xffn));
		v >>= 8n;
	}
	if (bytes.length === 0) return hexValue;

	// All bytes must be printable ASCII for the result to be a substrate ID.
	// If any byte is outside [0x20, 0x7e], this was a numeric-path encoding
	// (BigInt(geoid)) and the bytes don't form a string — return as-is.
	for (const b of bytes) {
		if (b < 0x20 || b > 0x7e) return hexValue;
	}
	return String.fromCharCode(...bytes);
}

/**
 * Convert substrate's district ID format to commons' display format.
 * "cd-0601" -> "CA-01", "cd-5000" -> "VT-AL"
 *
 * Returns the input unchanged if it doesn't match the substrate format.
 */
export function convertDistrictId(substrateId: string): string {
	// Parse: "cd-{2-digit state FIPS}{2-digit district}"
	const match = substrateId.match(/^cd-(\d{2})(\d{2})$/);
	if (!match) return substrateId; // Fallback: return as-is

	const stateFips = match[1];
	const districtNum = match[2];
	const stateCode = FIPS_TO_STATE[stateFips];
	if (!stateCode) return substrateId;

	// At-large districts: 00 (single-district states) and 98 (non-voting delegates) -> AL
	const district = (districtNum === '00' || districtNum === '98') ? 'AL' : districtNum;
	return `${stateCode}-${district}`;
}

/**
 * Normalize a district code for consistent hashing.
 * Converts substrate format first, then uppercases and trims.
 */
export function normalizeDistrictCode(code: string): string {
	return convertDistrictId(code).toUpperCase().trim();
}

/**
 * Two-letter postal abbreviation to FIPS state codes (reverse of FIPS_TO_STATE).
 */
const STATE_TO_FIPS: Record<string, string> = Object.fromEntries(
	Object.entries(FIPS_TO_STATE).map(([fips, state]) => [state, fips])
);

/**
 * Convert display district format to raw GEOID.
 * "CA-12" → "0612", "VT-AL" → "5000"
 *
 * Returns null if the state abbreviation is unknown.
 */
export function displayDistrictToGEOID(display: string): string | null {
	const match = display.match(/^([A-Z]{2})-(.+)$/);
	if (!match) return null;

	const stateAbbr = match[1];
	const districtPart = match[2];
	const fips = STATE_TO_FIPS[stateAbbr];
	if (!fips) return null;

	// At-large: "AL" → "00"
	const districtNum = districtPart === 'AL' ? '00' : districtPart.padStart(2, '0');
	return `${fips}${districtNum}`;
}
