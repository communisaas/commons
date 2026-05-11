/**
 * Jurisdiction labels for user-facing UI strings.
 *
 * The substrate is jurisdiction-agnostic; this adapter provides the labels
 * the UI uses to describe a specific jurisdiction's legislative system.
 * US federal is the first and currently only implementation. Future
 * jurisdictions can register additional label sets.
 */
export interface JurisdictionLabels {
	/** Name of the legislative body, e.g., "Congress" | "Parliament" */
	legislativeBody: string;
	/** Type of district, e.g., "Congressional District" | "Constituency" */
	districtType: string;
	/** Type of representative, e.g., "Member of Congress" | "MP" */
	representative: string;
	/** Name of the legislative record/journal, e.g., "the Congressional Record" | "Hansard" */
	legislativeRecord: string;
	/** Plural representatives noun (lowercase), e.g., "members of Congress" | "MPs" */
	representativesPlural: string;
	/** Adjective form for representative's office, e.g., "congressional" | "parliamentary" */
	legislativeAdjective: string;
}

export const US_FEDERAL: JurisdictionLabels = {
	legislativeBody: 'Congress',
	districtType: 'Congressional District',
	representative: 'Member of Congress',
	legislativeRecord: 'the Congressional Record',
	representativesPlural: 'members of Congress',
	legislativeAdjective: 'congressional'
};

/**
 * Get the jurisdiction labels for a given locale identifier.
 * Currently always returns US_FEDERAL — additional jurisdictions are
 * forward-deferred. The signature accepts a locale parameter so callsites
 * can be locale-aware now without requiring future-call-site refactors.
 */
export function getJurisdictionLabels(locale: string = 'us-federal'): JurisdictionLabels {
	// For now, all locales fall back to US_FEDERAL. When additional
	// jurisdictions register, switch on `locale` here.
	return US_FEDERAL;
}
