<!--
  IntegrityAssessment — the one-line, plain-language reading of a campaign's
  coordination metrics. Qualitative by design: raw scores live in the
  collapsed coordination audit, not here. Amber only on a burst-velocity
  spike. See integrity-assessment.ts for the privacy rationale.
-->
<script lang="ts">
	import type { IntegrityMetrics } from '$lib/types/verification-packet';
	import { assessIntegrity, hasBurstWarning } from './integrity-assessment';

	let {
		packet,
		class: className = ''
	}: {
		packet: IntegrityMetrics;
		class?: string;
	} = $props();

	const text = $derived(assessIntegrity(packet));
	const isWarning = $derived(hasBurstWarning(packet));
</script>

{#if isWarning}
	<div
		class="rounded border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-700 {className}"
	>
		{text}
	</div>
{:else}
	<p class="text-text-secondary text-sm {className}">{text}</p>
{/if}
