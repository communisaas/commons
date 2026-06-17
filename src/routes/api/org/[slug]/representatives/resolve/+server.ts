import { json, error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { getOfficials } from '$lib/core/shadow-atlas/client';
import { buildCohortRoster, type ResolvedDistrict } from '$lib/core/targets/cohort-roster';
import type { RequestHandler } from './$types';

/**
 * Cohort → federal-representative resolution (C1a). Composes the org cohort's
 * self-declared district/state histogram (Convex, counts only) with officials
 * resolved from the stateless Shadow Atlas primitives (`getOfficials`).
 *
 * Deliberately uses ONLY `getOfficials` (district-code in, public officials out)
 * — never the per-sender ZK-gated `LocalConstituentResolver`/witness path, which
 * requires a proof + encrypted envelope a cohort does not have. Authoring-side
 * (free preview); it never delivers and bypasses no quota.
 */

// Bound the officials fan-out. ~435 House districts + DC/territories < 450; 600
// is headroom while capping a pathological histogram.
const MAX_DISTRICT_FANOUT = 600;

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	// Membership-gated + org-scoped: cohortDistrictHistogram calls requireOrgRole
	// (member+) keyed on the slug's org, so a non-member / cross-org caller throws
	// → 403. Returns COUNTS ONLY — no supporter PII crosses this boundary.
	let histogram: Awaited<ReturnType<typeof serverQuery<typeof api.targets.cohortDistrictHistogram>>>;
	try {
		histogram = await serverQuery(api.targets.cohortDistrictHistogram, { orgSlug: params.slug });
	} catch {
		throw error(403, 'Not authorized for this organization');
	}

	const codes = Object.keys(histogram.districtCounts).slice(0, MAX_DISTRICT_FANOUT);
	// Resolve each DISTINCT district ONCE (memoized over the histogram, not per
	// supporter). One missing officials file degrades to ok:false and never fails
	// the whole roster (mirrors s/[slug] `.catch(() => [])`).
	const resolved: ResolvedDistrict[] = await Promise.all(
		codes.map((code) =>
			getOfficials(code)
				.then((r) => ({ code, ok: true, officials: r.officials ?? [] }) as ResolvedDistrict)
				.catch(() => ({ code, ok: false, officials: [] }) as ResolvedDistrict)
		)
	);

	const result = buildCohortRoster(histogram, resolved);

	return json({
		...result,
		coverage: {
			scanned: histogram.scanned,
			truncated: histogram.truncated,
			districtsResolved: codes.length,
			districtsTotal: Object.keys(histogram.districtCounts).length,
			unrecognizedDistrictCount: histogram.unrecognizedDistrictCount
		},
		provenance: 'self_declared'
	});
};
