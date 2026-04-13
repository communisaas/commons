<script lang="ts">
	import type { IntegrityMetrics } from '$lib/types/verification-packet';

	let {
		packet,
		class: className = ''
	}: {
		packet: IntegrityMetrics;
		class?: string;
	} = $props();

	function assessIntegrity(p: IntegrityMetrics): string {
		if (p.burstVelocity !== null && p.burstVelocity > 5)
			return 'Unusual activity spike detected. May warrant review.';
		const parts: string[] = [];
		if (p.gds !== null && p.gds >= 0.7) parts.push('spread across multiple areas');
		else if (p.gds !== null) parts.push('concentrated in a few areas');
		if (p.ald !== null && p.ald >= 0.7) parts.push('most messages are distinct');
		else if (p.ald !== null) parts.push('many messages are similar');
		if (p.temporalEntropy !== null && p.temporalEntropy >= 2) parts.push('submitted over time');
		if (parts.length === 0) return 'Accumulating data.';
		return parts.join(', ') + '.';
	}

	const text = $derived(assessIntegrity(packet));
	const isWarning = $derived(packet.burstVelocity !== null && packet.burstVelocity > 5);
	const capitalized = $derived(text.charAt(0).toUpperCase() + text.slice(1));
</script>

{#if isWarning}
	<div class="bg-amber-500/10 border border-amber-500/20 px-4 py-2 rounded text-sm font-medium text-amber-700 {className}">
		{capitalized}
	</div>
{:else}
	<p class="text-sm text-secondary {className}">{capitalized}</p>
{/if}
