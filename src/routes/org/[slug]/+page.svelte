<!--
  Org-root route — superseded by the mounted OS shell.

  RETURN ("what came back") is now a MOUNTED space in OrgShell (the org layout),
  rendered by `$lib/components/org/os/ReturnSpace.svelte` from data the layout
  load hydrates ONCE. The org root (`/org/[slug]`) is a canonical space path, so
  the layout detects it, shows OrgShell's ReturnSpace, and suppresses this page.

  This route still exists purely for addressability — a hard load of the org root
  must land on the RETURN space. The layout's `isSpacePath` check makes that
  happen and renders nothing from here, so this component intentionally renders
  nothing. Rendering the dashboard here too would double-render it.
-->
<script lang="ts">
	import type { PageData } from './$types';

	// Data still loads via the server load (auth/role flow through the layout),
	// but the page renders nothing: the mounted OrgShell ReturnSpace is the real
	// surface, fed by the layout's per-space data.
	let { data: _data }: { data: PageData } = $props();
</script>
