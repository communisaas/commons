import type { PageServerLoad } from './$types';

/**
 * STUDIO interior — server context.
 *
 * Auth + org-membership are already enforced by the org `+layout.server.ts`
 * (it redirects unauthenticated users and 404/redirects non-members). The
 * `org` + `membership.role` it returns are inherited via `parent()`, so this
 * load only surfaces the slim slice STUDIO needs and stays out of the way.
 *
 * No agent data is fetched here: the reasoning loop is driven entirely by the
 * live SSE endpoints client-side. The HONESTY RULE forbids pre-baking any
 * reasoning, sources, or output — STUDIO renders only what the real streams
 * emit, or a marked empty/stub state.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { org, membership } = await parent();

	// Display-only: role gates authoring affordances in the UI, but is NOT
	// access enforcement (route gating lives in individual loads). A member
	// can watch the loop; owner/editor can publish.
	const canPublish = membership.role === 'owner' || membership.role === 'editor';

	return {
		studio: {
			orgName: org.name,
			orgSlug: org.slug,
			brandingAccent: org.brandingAccent ?? null,
			role: membership.role,
			canPublish
		}
	};
};
