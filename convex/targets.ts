import { query } from './_generated/server';
import { v } from 'convex/values';
import { requireOrgRole } from './_authHelpers';

/**
 * Cohort → federal-rep targeting (C1a).
 *
 * Aggregate a cohort's SELF-DECLARED geography into a district + state histogram
 * — COUNTS ONLY, never supporter PII. The SvelteKit endpoint resolves each
 * distinct district to officials via the stateless Shadow Atlas primitives
 * (`getOfficials`), which cannot run inside a Convex function.
 *
 * `congressionalDistrict` is self-declared at CSV import (never geocoded), so the
 * result carries `provenance: 'self_declared'` — the roster must never be
 * presented as materialized district membership. This is list-scoped: it never
 * invokes the per-sender ZK-gated resolver and decrypts no PII.
 */

const COHORT_SCAN_CAP = 10_000;

// Inlined here (Convex can't import from `$lib`) — must stay in lockstep with
// `src/lib/core/targets/cohort-roster.ts` normalizeDistrictCode/normalizeStateCode.
function normDistrict(raw: string | undefined): string | null {
	if (!raw) return null;
	const t = raw.trim().replace(/\s+/g, ' ').toUpperCase();
	return /^[A-Z]{2}-([0-9]{1,2}|AL)$/.test(t) ? t : null;
}
function normState(raw: string | undefined): string | null {
	if (!raw) return null;
	const t = raw.trim().toUpperCase();
	return /^[A-Z]{2}$/.test(t) ? t : null;
}

export const cohortDistrictHistogram = query({
	args: { orgSlug: v.string() },
	handler: async (ctx, args) => {
		// Membership gate (member+). requireOrgRole throws for non-members — the
		// endpoint surfaces that as 403, scoping the cohort to the caller's org.
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');

		// Bounded, newest-first scan with a +1 truncation sentinel (mirrors the
		// supporters list pager) so we never do an unbounded table read.
		const scanned = await ctx.db
			.query('supporters')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.order('desc')
			.take(COHORT_SCAN_CAP + 1);
		const truncated = scanned.length > COHORT_SCAN_CAP;
		const cohort = truncated ? scanned.slice(0, COHORT_SCAN_CAP) : scanned;

		const districtCounts: Record<string, number> = {};
		const stateCounts: Record<string, number> = {};
		let unrecognizedDistrictCount = 0;
		for (const s of cohort) {
			const district = normDistrict(s.congressionalDistrict);
			// A valid district's prefix is the canonical state (it's atlas-format
			// STATE-NUM), so a mismatched stateCode (CA-12 + NY) can't orphan the
			// supporter's senate signal under the wrong state. stateCode is the
			// fallback only when there's no district.
			const state = district ? district.split('-')[0] : normState(s.stateCode);
			if (s.congressionalDistrict && !district) unrecognizedDistrictCount++;
			if (district) districtCounts[district] = (districtCounts[district] ?? 0) + 1;
			if (state) stateCounts[state] = (stateCounts[state] ?? 0) + 1;
		}

		return {
			districtCounts,
			stateCounts,
			scanned: cohort.length,
			truncated,
			unrecognizedDistrictCount,
			provenance: 'self_declared' as const
		};
	}
});
