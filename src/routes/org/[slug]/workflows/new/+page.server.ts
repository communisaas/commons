// CONVEX: Keep SvelteKit — tag listing for new-workflow form
import { error, redirect } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import { getWorkflowEmailRuntimeReadinessFromEnv } from '$lib/server/workflows/workflow-email-readiness';
import type { PageServerLoad } from './$types';

type OrgContext = {
	org: {
		name: string;
		slug: string;
	};
};

type SegmentOption = {
	_id: string;
	name: string;
};

type SegmentListResult = {
	segments: SegmentOption[];
};

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');
	if (!locals.user) throw redirect(302, '/auth/login');

	const [orgCtx, segmentResult, orgKeyVerifier] = (await Promise.all([
		serverQuery(api.organizations.getOrgContext, { slug: params.slug }),
		serverQuery(api.segments.list, { slug: params.slug }),
		serverQuery(api.organizations.getOrgKeyVerifier, { slug: params.slug })
	])) as [OrgContext, SegmentListResult, { orgKeyVerifier?: string | null } | null];
	const segments = segmentResult.segments;
	const workflowEmailReadiness = getWorkflowEmailRuntimeReadinessFromEnv({
		orgKeyConfigured: Boolean(orgKeyVerifier?.orgKeyVerifier)
	});

	// Tags come from supporter tags — extract unique tag names
	return {
		org: { name: orgCtx.org.name, slug: orgCtx.org.slug },
		workflowEmailReadiness,
		tags: segments.map((s) => ({ id: s._id, name: s.name }))
	};
};
