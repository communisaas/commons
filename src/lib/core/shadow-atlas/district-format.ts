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
