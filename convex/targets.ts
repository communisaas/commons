import { query } from './_generated/server';
import { v } from 'convex/values';

type CohortDistrictHistogram = {
	districtCounts: Record<string, number>;
	stateCounts: Record<string, number>;
	scanned: number;
	truncated: boolean;
	unrecognizedDistrictCount: number;
	provenance: 'self_declared';
};

/**
 * Cohort → federal-rep targeting (C1a).
 *
 * @deprecated Disabled until a write-maintained geography projection replaces
 * the former 10,001-supporter scan. The SvelteKit route is independently gated
 * by the launch-disabled congressional feature, and this tombstone closes the
 * direct Convex surface if that route gate is bypassed.
 */
export const cohortDistrictHistogram = query({
	args: { orgSlug: v.string() },
	handler: async (): Promise<CohortDistrictHistogram> => {
		throw new Error('COHORT_GEOGRAPHY_PROJECTION_REQUIRED');
	}
});
