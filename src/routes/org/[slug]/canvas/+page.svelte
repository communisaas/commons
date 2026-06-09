<!--
  /org/[slug]/canvas — the optional Capability Map.

  A full-bleed capability map rendered over the canonical rail (position:fixed,
  inset-0, high z-index). It does not restructure the layout: the org layout keeps
  OrgShell mounted (hidden) beneath, so the STUDIO authoring PROCESS keeps streaming
  — this surface and the canonical shell share ONE kernel (getOrgOS) via layout
  context. Fly here, spawn a process, fly back to /studio: it is still running.

  The page is a thin host. All field behaviour (pan/zoom, the ambient field,
	  the living node, semantic zoom) lives in the canvas map component, which is client-only in
  its canvas/listener init (onMount) and SSR-safe (it renders the static node face
  during SSR, no window/canvas access).
-->
<script lang="ts">
	import { getOrgOS } from '$lib/components/org/os/orgOS.svelte';
	import CanvasCapabilityMap from '$lib/components/org/os/CanvasCapabilityMap.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Same kernel instance the rest of the org shell shares (set by the layout).
	// Reading it here only asserts the context exists; CanvasCapabilityMap reads it too.
	getOrgOS();

	const base = $derived(`/org/${data.orgSlug}`);
</script>

<svelte:head>
	<title>{data.orgName} · Capability Map</title>
</svelte:head>

<CanvasCapabilityMap
	orgName={data.orgName}
	{base}
	canPublish={data.canPublish}
	fieldSignal={data.fieldSignal}
	spaces={data.spaces}
/>
