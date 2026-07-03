/**
 * Redraw-signal seed data + source SHAPE.
 *
 * Externalizes the hand-maintained controlling-map effective dates out of
 * redraw-guard.ts so the consuming guard imports a built map rather than carrying
 * a literal object. The dates are the SAME real, citable enacted-plan / court-order
 * effective dates — copied verbatim, never derived from now() or a TIGER vintage.
 *
 * Each row also carries its citation (`source`), so the provenance that previously
 * lived in inline comments is now a first-class field.
 */

/** One controlling-map redraw record: a state's effective date plus its citation. */
export interface RedrawSignalRow {
	/** 2-digit state FIPS, e.g. "13". */
	stateFips: string;
	/** ISO YYYY-MM-DD the controlling map took effect. */
	effectiveDate: string;
	/** Citable provenance: court docket/opinion, SoS, enacted bill, or major outlet. */
	source: string;
}

/**
 * Source of redraw rows.
 *
 * A future feed-loader (recurring source emitting `RedrawSignalRow`s) would implement
 * this interface; this module wires the SHAPE only. No feed, cron, fetch, or scheduled
 * entrypoint is added here — enabling any recurring ingestion is the operator's explicit
 * flip. The static seed below is the only implementation shipped.
 */
export interface RedrawSignalSource {
	load(): RedrawSignalRow[];
}

/**
 * Hand-maintained controlling-map effective dates for states whose districts were
 * redrawn after a recent TIGER vintage. Copied verbatim from the prior inline literal —
 * no date added, removed, or altered; an absent state stays absent.
 */
export const STATIC_REDRAW_ROWS: RedrawSignalRow[] = [
	{
		// North Carolina enacted a new congressional map (S.L. 2023-145) controlling
		// from the 2024 election cycle — later than TIGER2022 geometry.
		stateFips: '37',
		effectiveDate: '2023-10-25',
		source: 'NC S.L. 2023-145 (new congressional map controlling from the 2024 election cycle)',
	},
	{
		// Louisiana's court-ordered congressional map (SB8, 2024 special session) took
		// effect for 2024, redrawing the 2022 lines.
		stateFips: '22',
		effectiveDate: '2024-01-19',
		source: 'LA SB8 (2024 special session) court-ordered congressional map',
	},
	{
		// Alabama: court-imposed special-master remedial plan (Allen v. Milligan remedial
		// phase) — three-judge panel order approving the map for the 2024 cycle, 2023-10-05.
		stateFips: '01',
		effectiveDate: '2023-10-05',
		source:
			'AL court-imposed special-master remedial plan (Allen v. Milligan): https://redistricting.lls.edu/case/milligan-v-allen/',
	},
	{
		// Georgia: SB 3-EX, "Georgia Congressional Redistricting Act of 2023", signed by
		// Gov. Kemp 2023-12-08 (enacted plan; later upheld by Judge Jones 2023-12-28).
		stateFips: '13',
		effectiveDate: '2023-12-08',
		source:
			'GA SB 3-EX, Georgia Congressional Redistricting Act of 2023 (signed by Gov. Kemp): https://gov.georgia.gov/document/2023-special-session-signed-legislation/sb-3ex/download',
	},
	{
		// New York: Ch. 99 of 2024 (S.8653A/A.9310A), signed by Gov. Hochul 2024-02-28 and
		// effective immediately, replacing the 2022 congressional lines.
		stateFips: '36',
		effectiveDate: '2024-02-28',
		source:
			'NY Ch. 99 of 2024 (S.8653A/A.9310A, signed by Gov. Hochul): https://www.cbsnews.com/newyork/news/new-york-new-congressional-map-approved/',
	},
	{
		// Texas: HB 4 (2025 mid-decade redraw), signed by Gov. Abbott 2025-08-29 (enacted
		// plan; cleared by the U.S. Supreme Court for the 2026 elections, 2025-12-04).
		stateFips: '48',
		effectiveDate: '2025-08-29',
		source:
			'TX HB 4 (2025 mid-decade redraw, signed by Gov. Abbott): https://www.texastribune.org/2025/08/29/greg-abbott-signs-texas-congressional-map-redistricting/',
	},
];

/** The shipped static source: the verbatim seed above. */
export const staticRedrawSource: RedrawSignalSource = {
	load: () => STATIC_REDRAW_ROWS,
};

/**
 * Reduce redraw rows into the `{ [stateFips]: effectiveDate }` map the guard consumes.
 * Last-writer-wins on a duplicate FIPS; the static seed rows are unique.
 */
export function buildRedrawSignal(
	src: RedrawSignalSource = staticRedrawSource,
): Record<string, string> {
	return src.load().reduce<Record<string, string>>((acc, row) => {
		acc[row.stateFips] = row.effectiveDate;
		return acc;
	}, {});
}
