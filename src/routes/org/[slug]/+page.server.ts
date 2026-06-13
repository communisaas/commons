import type { PageServerLoad } from './$types';

/**
 * Org-root route — server context.
 *
 * RETURN ("what came back") is now a MOUNTED space in the OS shell, hydrated by
 * the org `+layout.server.ts` (which loads every space's slice ONCE, since a
 * space switch is a pure state toggle, not a navigation). The dashboard queries
 * that used to live here — getDashboard, getDashboardStats, the verification
 * packet — moved UP to the layout so they hydrate the mounted ReturnSpace and
 * are NOT re-run when the operator toggles between spaces.
 *
 * Auth + org-membership are already enforced by the layout load (it redirects
 * unauthenticated users and non-members). This load only keeps the route
 * addressable — a hard load of the org root resolves and the layout shows the
 * mounted ReturnSpace, suppressing the (intentionally empty) page render.
 */
export const load: PageServerLoad = async ({ parent }) => {
	// Inherit org/membership from the layout; surface nothing extra. The RETURN
	// space reads its data from the layout's `spaces` slice, not from here.
	const { org } = await parent();
	return { orgSlug: org.slug };
};
