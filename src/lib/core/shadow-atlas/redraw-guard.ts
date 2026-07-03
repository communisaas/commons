/**
 * Boundary-redraw staleness guard.
 *
 * The atlas carries a single TIGER vintage per build, but congressional and
 * legislative maps can be redrawn mid-cycle by a court order or a new enacted
 * plan. When a state's controlling map took effect AFTER the atlas vintage, the
 * resolved district is confidently-WRONG: the geometry the resolver matched is
 * superseded. This guard surfaces that as a loud, lowered-confidence result with
 * a warning string — it never papers a stale boundary over as a confident hit.
 *
 * Scope is narrow and additive. The resolver (client.ts) already computes the
 * confidence ladder, the boundary clock, and the district-miss / unknown-vintage
 * branches; this guard only consumes those and layers the redraw-after-vintage
 * detection + a human-readable warning on top. It mirrors the confidence ladder
 * already mirrored in client.ts (redraw → 0, like enjoined/superseded; degraded →
 * 0.4, like challenged) — no cross-repo import.
 */

import type { AddressResolutionResult } from './client';
import { districtIdToFips, STATE_TO_FIPS } from './district-format';
import { buildRedrawSignal } from './redraw-signal.data';

/**
 * Controlling-map effective dates for states whose districts were redrawn after a
 * recent TIGER vintage. Keyed by 2-digit state FIPS → ISO date the controlling map
 * took effect. When this effective date is later than the atlas vintage's data
 * as-of date (Jan 1 of the vintage year), a resolved district for that state is
 * treated as superseded (confidence 0).
 *
 * Hand-maintained; event-feed automation is P1; NOT a litigation tracker. Entries
 * record the effective date of an already-controlling map, not pending challenges.
 * An entry is added ONLY when the date is a real, citable enacted-plan effective date
 * or a court order that imposed the map; a state whose controlling-map date cannot be
 * verified to a source is OMITTED, never guessed and never borrowed from a neighbor,
 * the current time, or a TIGER vintage.
 *
 * Future automated-feed shape (documentation only — no feed/cron is wired here):
 * a recurring source would emit rows of the form
 *     { stateFips: string;  // 2-digit FIPS, e.g. "13"
 *       effectiveDate: string;  // ISO YYYY-MM-DD the controlling map took effect
 *       source: string }  // citable URL (court docket/opinion, SoS, or major outlet)
 * which would map 1:1 onto entries below (stateFips → effectiveDate). Enabling any
 * such recurring feed or cron is the OPERATOR's explicit flip — this module wires the
 * documented row SHAPE only and adds no scheduled entrypoint and no recurring infra.
 */
export const REDRAW_SIGNAL: Record<string, string> = buildRedrawSignal();

/** Parse a 4-digit year out of a TIGER vintage tag ("TIGER2024" → 2024). */
function parseVintageYear(tigerVintage: string | null | undefined): number | null {
	if (!tigerVintage || typeof tigerVintage !== 'string') return null;
	const m = tigerVintage.match(/(\d{4})/);
	if (!m) return null;
	const year = Number(m[1]);
	return Number.isFinite(year) ? year : null;
}

/**
 * Apply the redraw/staleness guard to an already-resolved address.
 *
 * Total and pure — it NEVER throws and never discards a resolved address; a guard
 * failure must degrade honestly, mirroring the best-effort manifest posture in
 * resolveAddress. It consumes the already-computed confidence/boundaryAsOf rather
 * than recomputing the miss / unknown-vintage / boundaryAsOf branches that
 * client.ts already owns.
 *
 * @param result   The base resolution result (confidence/boundaryAsOf already set).
 * @param vintage  getManifestVintage() output, or null on a manifest fetch failure.
 */
export function applyStalenessGuard(
	result: AddressResolutionResult,
	vintage: {
		tigerVintage: string | null;
		generated: string | null;
		officialsGenerated: string | null;
	} | null,
	address?: { state?: string },
): AddressResolutionResult {
	try {
		// A null `vintage` means the manifest FETCH failed (transient R2/IPFS hiccup),
		// not that the vintage is known-unknown. Best-effort: a transient infra fault must
		// NOT penalize an otherwise-clean district hit, so confidence passes through here.
		// client.ts has already nulled boundaryAsOf in this case; the guard only adds the
		// warning string. (A manifest that RESOLVED but carries no usable vintage is the
		// genuine known-unknown handled by the vintageYear === null branch below.)
		if (vintage === null) {
			return {
				...result,
				warning: result.warning ?? 'boundary vintage unknown',
			};
		}

		const vintageYear = parseVintageYear(vintage.tigerVintage);

		// (2) Resolved manifest with an unknown / absent / unparseable vintage → DEGRADED.
		// This is a genuine "vintage is unknown" signal: additive — client.ts already nulls
		// boundaryAsOf, and the guard adds the warning and clamps confidence to at most 0.4
		// (mirrors 'challenged'), since we cannot vouch for a boundary whose vintage we don't
		// know.
		if (vintageYear === null) {
			return {
				...result,
				confidence: Math.min(result.confidence, 0.4),
				boundaryAsOf: null,
				warning: 'boundary vintage unknown',
			};
		}

		// (4) District-lookup miss — client.ts already set district null + confidence 0.
		// Keep that honest 0 (do not flip it) and add a loud warning if one isn't already
		// set by a redraw/degraded branch above (this path runs with a known vintage).
		if (result.district === null || result.confidence === 0) {
			return {
				...result,
				warning: result.warning ?? 'district lookup miss',
			};
		}

		// (3) Redraw-after-vintage detection. Derive the resolved state's FIPS from the
		// district id (display "CA-01" or substrate "cd-0601"), falling back to the input
		// address's state. Reuses the single FIPS↔postal table in district-format.ts.
		const fips =
			districtIdToFips(result.district.id) ??
			(address?.state ? (STATE_TO_FIPS[address.state.toUpperCase()] ?? null) : null);

		if (fips) {
			// Date-grain compare. TIGER vintage N publishes boundaries as of Jan 1 of
			// year N, so the data's true as-of is `${vintageYear}-01-01` — NOT
			// `manifest.generated`, which is the BUILD clock (using it would under-warn
			// when old TIGER geometry is rebuilt later; the two clocks stay distinct).
			// Lexicographic > is exact on zero-padded ISO dates. An absent/unparseable
			// effective date falls through with no verdict — never fabricated.
			const effectiveDate = REDRAW_SIGNAL[fips];
			const vintageAsOf = `${vintageYear}-01-01`;
			if (
				typeof effectiveDate === 'string' &&
				/^\d{4}-\d{2}-\d{2}/.test(effectiveDate) &&
				effectiveDate > vintageAsOf
			) {
				// The controlling map post-dates the atlas geometry: the resolved district
				// is superseded. Mirror enjoined/superseded → confidence 0. Keep the real
				// vintage date in boundaryAsOf (never fabricated); confidence 0 is the
				// signal the caller uses to refuse presenting the district as confident.
				return {
					...result,
					confidence: 0,
					warning: 'district boundaries redrawn after atlas vintage',
				};
			}
		}

		// Fresh, confidently-resolved district — pass through, warning stays null.
		return result;
	} catch {
		// Best-effort: a guard fault must NOT discard an otherwise-resolved address.
		return result;
	}
}
