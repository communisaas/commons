import type { PageServerLoad } from './$types';

/**
 * Org-root route — server context.
 *
 * The org root is the AUTHORING front door: it resolves to STUDIO, a MOUNTED
 * space in the OS shell. Every space's slice (including STUDIO and the Results
 * verification packet) is hydrated ONCE by the org `+layout.server.ts`, since a
 * space switch is a pure state toggle, not a navigation. No per-space dashboard
 * query lives here — those moved UP to the layout so a space toggle never
 * re-fetches.
 *
 * Auth + org-membership are already enforced by the layout load (it redirects
 * unauthenticated users and non-members). This load only keeps the route
 * addressable — a hard load of the org root resolves and the layout shows the
 * mounted StudioSpace, suppressing the (intentionally empty) page render.
 */
export const load: PageServerLoad = async ({ parent }) => {
	// Inherit org/membership from the layout; surface nothing extra. Each space
	// reads its data from the layout's `spaces` slice, not from here.
	const { org } = await parent();
	return { orgSlug: org.slug };
};
