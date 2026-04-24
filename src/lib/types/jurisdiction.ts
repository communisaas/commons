import type { GeoFence } from './location';

/** Template jurisdiction row shape. */
export interface TemplateJurisdiction {
	id: string;
	templateId: string;
	jurisdictionType: string;
	jurisdictionCode: string;
	jurisdictionName: string;
	stateCode?: string | null;
	countryCode: string;
}

export type JurisdictionType =
	| 'country'
	| 'state'
	| 'province'
	| 'region'
	| 'municipality'
	| 'city'
	| 'district'
	| 'ward'
	| 'custom'
	| 'federal'
	| 'county'
	| 'school_district';

export interface Jurisdiction {
	id: string;
	country_code: string;
	type: JurisdictionType;
	name?: string;
	admin1?: string;
	admin2?: string;
	admin3?: string;
	external_ids?: Record<string, string>;
	geometry?: GeoFence | unknown; // Allow server-provided GeoJSON
	created_at: string | Date;
	updated_at: string | Date;
}

export interface Office {
	id: string;
	jurisdiction_id: string;
	role: string; // e.g., representative, senator, mayor, councillor
	title?: string;
	chamber?: string;
	level?: 'national' | 'state' | 'provincial' | 'municipal' | 'district' | string;
	contact_emails?: string[];
	contact_phone?: string;
	cwc_office_code?: string;
	is_active: boolean;
	created_at: string | Date;
	updated_at: string | Date;
}

export type TemplateScopeMode = 'jurisdictions' | 'geofence' | 'user_home' | 'country';

export interface TemplateScope {
	id: string;
	template_id: string;
	mode: TemplateScopeMode;
	country_codes?: string[];
	jurisdiction_ids?: string[];
	geofence?: GeoFence | unknown;
	created_at: string | Date;
	updated_at: string | Date;
}

// ===== TEMPLATE CREATOR JURISDICTION PICKER TYPES =====

/**
 * Autocomplete suggestion for jurisdiction picker
 */
export interface JurisdictionSuggestion {
	id: string;
	type: 'federal' | 'state' | 'county' | 'city' | 'school_district';
	displayName: string;
	stateCode?: string;
	congressionalDistrict?: string;
	countyFips?: string;
	countyName?: string;
	cityName?: string;
	cityFips?: string;
	schoolDistrictId?: string;
	schoolDistrictName?: string;
	estimatedPopulation?: bigint;
	latitude?: number;
	longitude?: number;
}

/**
 * Jurisdiction picker component props
 */
export interface JurisdictionPickerProps {
	selectedJurisdictions: TemplateJurisdiction[];
	onJurisdictionsChange: (jurisdictions: TemplateJurisdiction[]) => void;
	maxSelections?: number;
	placeholder?: string;
	disabled?: boolean;
}

/**
 * Coverage preview data
 */
export interface CoverageData {
	totalPopulation: bigint;
	jurisdictionBreakdown: {
		type: 'federal' | 'state' | 'county' | 'city' | 'school_district';
		count: number;
		population: bigint;
	}[];
	congressionalDistricts: string[];
	statesAffected: string[];
}

export interface CongressionalDistrictInfo {
	district: string; // "TX-18"
	state: string; // "TX"
	representative?: {
		name: string;
		party: string;
		office?: string;
	};
	population?: number;
}

