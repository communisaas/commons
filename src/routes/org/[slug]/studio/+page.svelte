<!--
  STUDIO route — superseded by the mounted OS shell.

  The STUDIO interior is now a MOUNTED space in OrgShell (the org layout),
  driven by the OS process registry. The authoring run lives in
  `$lib/core/authoring-process.ts` and streams into the registry independently
  of any component lifecycle, so it survives space switches. STUDIO is a pure
  VIEW (`$lib/components/org/os/StudioSpace.svelte`) reading the focused process.

  This route still exists for addressability — a hard load of /org/[slug]/studio
  must land on the STUDIO space. The layout detects the canonical /studio path
  and renders OrgShell's StudioSpace (suppressing this page), so this component
  intentionally renders nothing. It no longer owns any streaming state; doing so
  would tear the process down on navigation, the exact regression the OS fixes.
-->
<script lang="ts">
	import type { PageData } from './$types';

	// Data still loads (auth/role via the server load), but the page renders
	// nothing: the mounted OrgShell StudioSpace is the real surface.
	let { data: _data }: { data: PageData } = $props();
</script>
