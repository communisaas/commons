/**
 * Cohort → federal-representative roster (C1a). Pure composition over a
 * self-declared district/state histogram and the officials resolved (once per
 * distinct district) from the stateless Shadow Atlas primitives.
 *
 * Honesty contract (ties to Phase A / RG-1): `congressionalDistrict` is
 * self-declared at CSV import (never geocoded), so every rep carries
 * `provenance: 'self_declared'`. This roster is NOT materialized district
 * membership and must never be presented as such. It is list-scoped — it never
 * touches the per-sender ZK-gated resolver, never requires a proof, never
 * decrypts supporter PII (only counts + public officials data flow through).
 *
 * Senators resolve only via a district (the atlas exposes no senators-by-state
 * primitive), so a state present in the cohort with NO district that resolved is
 * surfaced in `statesMissingSenators` rather than fabricated.
 */

export interface CohortHistogram {
	/** Self-declared district code → supporter count (validated STATE-NUM/AL codes only). */
	districtCounts: Record<string, number>;
	/** Two-letter state → supporter count (covers district + state-only supporters). */
	stateCounts: Record<string, number>;
}

export interface OfficialLite {
	bioguide_id?: string | null;
	name?: string;
	party?: string | null;
	chamber?: 'house' | 'senate' | null;
	state?: string;
	district?: string | null;
	office?: string;
	phone?: string | null;
	contact_form_url?: string | null;
	website_url?: string | null;
	is_voting?: boolean;
}

export interface ResolvedDistrict {
	code: string;
	/** false when getOfficials threw / no officials file — degrades to "unavailable". */
	ok: boolean;
	officials: OfficialLite[];
}

export interface CohortRep {
	bioguideId: string | null;
	name: string;
	party: string | null;
	chamber: 'house' | 'senate';
	state: string;
	district: string | null;
	office: string;
	phone: string | null;
	contactFormUrl: string | null;
	websiteUrl: string | null;
	isVoting: boolean;
	/** Supporters mapping to this rep — district count for a house rep, state count for a senator. */
	supporterCount: number;
	provenance: 'self_declared';
}

export interface CohortRoster {
	roster: CohortRep[];
	/** Distinct district codes whose officials file was missing/unresolvable. */
	unavailableDistricts: string[];
	/** States with cohort supporters but no resolved senators (no district in-cohort for that state). */
	statesMissingSenators: string[];
}

export function buildCohortRoster(
	hist: CohortHistogram,
	resolved: ResolvedDistrict[]
): CohortRoster {
	const roster = new Map<string, CohortRep>();
	const unavailableDistricts: string[] = [];
	const coveredStates = new Set<string>();

	for (const d of resolved) {
		if (!d.ok || d.officials.length === 0) {
			unavailableDistricts.push(d.code);
			continue;
		}
		const districtCount = hist.districtCounts[d.code] ?? 0;
		for (const o of d.officials) {
			const chamber: 'house' | 'senate' = o.chamber === 'senate' ? 'senate' : 'house';
			const state = o.state ?? '';
			const key = o.bioguide_id
				? `bio:${o.bioguide_id}`
				: `${chamber}:${state}:${o.district ?? ''}:${o.name ?? ''}`;
			// House rep coverage = supporters in this district; senator coverage = the
			// state total (the senator recurs across every district of their state).
			const coverage = chamber === 'senate' ? (hist.stateCounts[state] ?? 0) : districtCount;
			const existing = roster.get(key);
			if (existing) {
				// A senator appears once per district of their state — state coverage is
				// set once, never re-summed. House coverage sums (defensive; a rep maps
				// to one district normally).
				if (chamber === 'house') existing.supporterCount += coverage;
			} else {
				roster.set(key, {
					bioguideId: o.bioguide_id ?? null,
					name: o.name ?? '',
					party: o.party ?? null,
					chamber,
					state,
					district: o.district ?? null,
					office: o.office ?? (chamber === 'senate' ? `Senator, ${state}` : `Representative, ${state}`),
					phone: o.phone ?? null,
					contactFormUrl: o.contact_form_url ?? null,
					websiteUrl: o.website_url ?? null,
					isVoting: o.is_voting ?? true,
					supporterCount: coverage,
					provenance: 'self_declared'
				});
			}
			if (chamber === 'senate' && state) coveredStates.add(state);
		}
	}

	const statesMissingSenators = Object.keys(hist.stateCounts).filter((s) => !coveredStates.has(s));
	return { roster: [...roster.values()], unavailableDistricts, statesMissingSenators };
}

/**
 * Validate + normalize a self-declared district code to match the CSV-import
 * normalization (uppercase, single-spaced), accepting only plausible STATE-NUM /
 * STATE-AL codes so garbage (path-traversal, injection, lowercase dupes) can
 * never reach the officials fetch or double-count the histogram. Returns null
 * for anything not shaped like a real district code.
 */
export function normalizeDistrictCode(raw: string | undefined | null): string | null {
	if (!raw) return null;
	const t = raw.trim().replace(/\s+/g, ' ').toUpperCase();
	return /^[A-Z]{2}-([0-9]{1,2}|AL)$/.test(t) ? t : null;
}

export function normalizeStateCode(raw: string | undefined | null): string | null {
	if (!raw) return null;
	const t = raw.trim().toUpperCase();
	return /^[A-Z]{2}$/.test(t) ? t : null;
}
