<!--
  Org-root route — superseded by the mounted OS shell.

  The org root (`/org/[slug]`) is the AUTHORING front door: it is a canonical
  space path that resolves to STUDIO. The STUDIO interior is a MOUNTED space in
  OrgShell (the org layout), driven by the OS process registry, so the layout
  detects the root, shows OrgShell's StudioSpace, and suppresses this page.

  This route still exists purely for addressability — a hard load of the org root
  must land on the STUDIO space. The layout's `isSpacePath` check makes that
  happen and renders nothing from here, so this component intentionally renders
  nothing. Rendering a space here too would double-render it. (Results — the
  Verification Packet — lives at `/org/[slug]/results`.)
-->
<script lang="ts">
	import type { PageData } from './$types';

	// Data still loads via the server load (auth/role flow through the layout),
	// but the page renders nothing: the mounted OrgShell StudioSpace is the real
	// surface, fed by the layout's per-space data.
	let { data: _data }: { data: PageData } = $props();
</script>
