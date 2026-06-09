import type { PageServerLoad } from './$types';

/**
 * Capability Map — server context.
 *
 * This is the proof-aware map surface: the org's capability objects on a pannable,
 * zoomable map — action records, People signal, Power targets, Results
	 * artifacts, and the Studio authoring loop as living nodes laid across fixed
	 * workspace zones. It is a deep route under the org layout, so auth +
 * org-membership are already enforced by `+layout.server.ts` (which redirects
 * unauthenticated users and non-members). This load only inherits the org identity
 * + watermark (for the HUD + ambient grain) and the already-loaded workspace
 * slices (for the field objects) — never a fabricated one.
 *
 * No new queries: the constellation objects ride on `spaces` from the layout
 * load. Studio authoring nodes are driven entirely by the OS process registry
 * (the same kernel the rest of the shell shares via context). Null slices render
 * honest empty workspaces.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { org, watermark, membership, spaces } = await parent();
	return {
		orgName: org.name,
		orgSlug: org.slug,
		// Real verified-action signal for the ambient field. null = dormant; the
		// field renders a calm, near-still grain rather than inventing motion.
		fieldSignal: {
			thisWeek: watermark?.thisWeek ?? null,
			lastWeek: watermark?.lastWeek ?? null
		},
		canPublish: membership.role === 'owner' || membership.role === 'editor',
			// The org's REAL objects, already loaded by the layout. Passed through, no
			// new queries. Each slice is best-effort null → honest empty workspace.
		spaces
	};
};
