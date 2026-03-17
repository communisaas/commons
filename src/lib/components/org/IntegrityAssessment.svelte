<script lang="ts">
	interface Packet {
		gds: number | null;
		ald: number | null;
		temporalEntropy: number | null;
		burstVelocity: number | null;
		cai: number | null;
	}

	let {
		packet,
		class: className = ''
	}: {
		packet: Packet;
		class?: string;
	} = $props();

	function assessIntegrity(p: Packet): string {
		if (p.burstVelocity !== null && p.burstVelocity > 5)
			return 'WARNING: Sudden spike in actions. Decision-makers may flag this as coordinated.';
		const parts: string[] = [];
		if (p.gds !== null && p.gds >= 0.7) parts.push('geographically diverse');
		else if (p.gds !== null) parts.push('concentrated in few districts');
		if (p.ald !== null && p.ald >= 0.7) parts.push('individually authored');
		else if (p.ald !== null) parts.push('messages are similar');
		if (p.temporalEntropy !== null && p.temporalEntropy >= 2) parts.push('organically timed');
		if (parts.length === 0) return 'Accumulating verification data.';
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
