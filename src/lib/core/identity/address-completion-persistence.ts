import { storeConstituentAddress } from './constituent-address';

export interface AddressCompletionDetail {
	address?: string;
	streetAddress?: unknown;
	city?: unknown;
	state?: unknown;
	zip?: unknown;
	representatives?: unknown;
}

function stringValue(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeState(value: unknown): string | null {
	const state = stringValue(value)?.toUpperCase() ?? null;
	return state && /^[A-Z]{2}$/.test(state) ? state : null;
}

function normalizeDistrict(rawDistrict: unknown, rawState: unknown): string | null {
	const district = stringValue(rawDistrict)?.toUpperCase() ?? null;
	const state = normalizeState(rawState);
	if (!district) return null;

	const full = district.match(/^([A-Z]{2})-(\d{1,2}|AL)$/);
	if (full) {
		const suffix = full[2] === 'AL' ? 'AL' : full[2].padStart(2, '0');
		return `${full[1]}-${suffix}`;
	}

	if (!state) return null;
	if (/^\d{1,2}$/.test(district)) return `${state}-${district.padStart(2, '0')}`;
	if (district === 'AL') return `${state}-AL`;
	return null;
}

function extractDistrictFromRepresentatives(detail: AddressCompletionDetail): string | null {
	if (!Array.isArray(detail.representatives)) return null;

	for (const rep of detail.representatives) {
		if (!rep || typeof rep !== 'object') continue;
		const r = rep as Record<string, unknown>;
		const chamber = stringValue(r.chamber)?.toLowerCase() ?? '';
		const title = stringValue(r.title)?.toLowerCase() ?? '';
		const isHouse =
			chamber === 'house' ||
			(title.length > 0 && !title.includes('senator') && !title.includes('senate'));
		if (!isHouse) continue;

		const district = normalizeDistrict(r.district, r.state ?? r.jurisdiction ?? detail.state);
		if (district) return district;
	}

	return null;
}

/**
 * Persist the browser-local encrypted address cache after server attestation.
 *
 * This cache is not an authority signal. It exists so profile and CWC witness
 * UX can avoid asking for the same address every session. The server-side
 * district credential remains the source of truth.
 */
export async function persistAddressCompletion(
	userId: string,
	detail: AddressCompletionDetail,
	districtOverride?: string | null
): Promise<void> {
	const street = stringValue(detail.streetAddress);
	const city = stringValue(detail.city);
	const state = normalizeState(detail.state);
	const zip = stringValue(detail.zip);
	if (!street || !city || !state || !zip) return;

	const district =
		normalizeDistrict(districtOverride, state) ??
		extractDistrictFromRepresentatives(detail) ??
		undefined;

	await storeConstituentAddress(userId, {
		street,
		city,
		state,
		zip,
		...(district ? { district } : {})
	});
}
