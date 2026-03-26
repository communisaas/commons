import type { LayoutServerLoad } from './$types';

// Override root layout — embed routes are public, no user needed.
// No dual-stack needed: no database queries, just a static override.
export const load: LayoutServerLoad = async () => {
	return { user: null };
};
