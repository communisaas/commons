/**
 * Per-district-type coverage disclosure for the resolve-address API.
 *
 * HONESTY CONTRACT: this table is the allowlist of served boundary types. A slot
 * is emitted in resolve results ONLY if listed here, so disclosure and emission
 * can never drift. When an atlas publish populates a new slot, serving it requires
 * adding a row here (and updating the OpenAPI mirror) — verified by unit tests.
 *
 * Coverage classes are machine-readable and factual, never marketing adjectives:
 *   - 'national': present wherever that district type exists in US governance.
 *   - 'partial':  known regional/structural limits or build gaps — absence of the
 *     type in a response is NOT evidence that no such district exists there.
 * A type absent from this table has zero live atlas data and is not served at all.
 *
 * Freshness is NOT stamped here — it already lives in the response's asOf clocks
 * and provenance.tigerVintage. This table is code-versioned with the deploy.
 * Ops rule: on each atlas publish, diff the live district-index top-level slot
 * keys against SERVED_SLOTS and reconcile before flipping the version pin.
 */
import { US_SLOT_NAMES } from './district-format';

export type CoverageClass = 'national' | 'partial';

export interface DistrictTypeCoverage {
	coverage: CoverageClass;
	/** Factual scope note (governance-structure reality or known build gap). */
	note?: string;
}

export interface ResolveCoverage {
	/** Keyed by public district_type. A type absent from this map is not served at all. */
	boundaryTypes: Record<string, DistrictTypeCoverage>;
	/** District types for which officials rosters exist. Currently ['congressional']. */
	officialsTypes: readonly string[];
}

/** Slots with live atlas data, in canonical slot order. Keep in sync with the atlas publish. */
const SERVED_SLOTS: ReadonlyArray<{ slot: number } & DistrictTypeCoverage> = [
	{ slot: 0, coverage: 'national' },
	{ slot: 2, coverage: 'national' },
	{
		slot: 3,
		coverage: 'national',
		note: 'Nebraska (unicameral legislature) and DC have no state house layer.'
	},
	{ slot: 4, coverage: 'national' },
	{
		slot: 5,
		coverage: 'partial',
		note: 'Incorporated places only, and place ingestion is incomplete in the current build; absence does not by itself mean an unincorporated location.'
	},
	{
		slot: 7,
		coverage: 'national',
		note: 'Absent where a state splits elementary/secondary school districts — see elementary-school and secondary-school.'
	},
	{
		slot: 8,
		coverage: 'partial',
		note: 'Only in states that operate split elementary/secondary school districts.'
	},
	{
		slot: 9,
		coverage: 'partial',
		note: 'Only in states that operate split elementary/secondary school districts.'
	},
	{ slot: 20, coverage: 'national' },
	{
		slot: 22,
		coverage: 'partial',
		note: 'Federally recognized tribal areas; ingestion is incomplete in the current build.'
	}
];

/** Fast membership check used by the resolver to gate slot emission. */
export const SERVED_SLOT_SET: ReadonlySet<number> = new Set(SERVED_SLOTS.map((s) => s.slot));

/**
 * Static disclosure object embedded in every resolve-address response.
 * Deeply frozen — one shared instance serves every request.
 */
export const DISTRICT_COVERAGE: ResolveCoverage = Object.freeze({
	boundaryTypes: Object.freeze(
		Object.fromEntries(
			SERVED_SLOTS.map(({ slot, coverage, note }) => [
				US_SLOT_NAMES[slot].jurisdiction,
				Object.freeze(note ? { coverage, note } : { coverage })
			])
		)
	),
	officialsTypes: Object.freeze(['congressional'])
});
