import type { PageServerLoad } from './$types';

/**
 * Org Results route — server context.
 *
 * RETURN ("what came back") is a MOUNTED space in the OS shell, hydrated by the
 * org `+layout.server.ts` (which loads every space's slice ONCE, since a space
 * switch is a pure state toggle, not a navigation). The dashboard queries —
 * getDashboard, getDashboardStats, the verification packet — live in the layout
 * so they hydrate the mounted ReturnSpace and are NOT re-run on a space toggle.
 *
 * Auth + org-membership are already enforced by the layout load (it redirects
 * unauthenticated users and non-members). This load only keeps the route
 * addressable — a hard load of `/org/[slug]/results` resolves and the layout
 * shows the mounted ReturnSpace, suppressing the (intentionally empty) page.
 */
export const load: PageServerLoad = async ({ parent }) => {
	// Inherit org/membership from the layout; surface nothing extra. The RETURN
	// space reads its data from the layout's `spaces` slice, not from here.
	const { org } = await parent();
	return { orgSlug: org.slug };
};
