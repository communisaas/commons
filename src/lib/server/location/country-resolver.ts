/**
 * Country Resolver Interface
 *
 * Abstract contract for resolving geographic coordinates to legislative
 * districts and officials across different countries.
 *
 * Each country implements this interface with its own district taxonomy,
 * API sources, and jurisdiction levels.
 */

export interface DistrictResult {
	/** District identifier (e.g., "CA-12" for US, "35004" for CA riding) */
	districtId: string;
	/** Human-readable district name */
	districtName: string;
	/** District type (e.g., "congressional", "riding", "constituency", "electorate") */
	districtType: string;
	/** Country code */
	country: string;
	/** Additional metadata (province, region, state, etc.) */
	extra?: Record<string, string>;
}

export interface Official {
	/** Unique identifier (bioguide_id for US, member ID for others) */
	id: string;
	/** Full name */
	name: string;
	/** Political party */
	party: string;
	/** Legislative chamber (e.g., "house", "senate", "house-of-commons") */
	chamber: string;
	/** State/province/region code */
	region: string;
	/** District identifier within the region (null for at-large/senate) */
	district: string | null;
	/** Office title */
	office: string;
	/** Phone number */
	phone: string | null;
	/** Email address */
	email: string | null;
	/** Contact form URL */
	contactFormUrl: string | null;
	/** Website URL */
	websiteUrl: string | null;
	/** Whether this is a voting member */
	isVoting: boolean;
}

export interface CountryResolver {
	/** ISO 3166-1 alpha-2 country code */
	readonly country: string;

	/**
	 * Resolve geographic coordinates to a legislative district.
	 * Returns null if the coordinates are outside this country's coverage.
	 */
	resolveDistrict(lat: number, lng: number): Promise<DistrictResult | null>;

	/**
	 * Get officials (representatives) for a given district code.
	 * Returns empty array if no officials data is available.
	 */
	getOfficials(districtCode: string): Promise<Official[]>;

	/**
	 * Get the jurisdiction levels supported by this country.
	 * Ordered from highest to lowest (e.g., ['federal', 'state', 'local'] for US).
	 */
	getJurisdictionLevels(): string[];
}
