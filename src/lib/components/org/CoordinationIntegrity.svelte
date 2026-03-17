<script lang="ts">
	interface Packet {
		gds: number | null;
		ald: number | null;
		temporalEntropy: number | null;
		burstVelocity: number | null;
		cai: number | null;
	}

	let { packet }: { packet: Packet } = $props();

	interface ScoreEntry {
		key: string;
		label: string;
		description: string;
		value: number | null;
		/** Normalized 0-1 for bar display */
		normalized: number;
		color: string;
		invertedWarning: boolean;
	}

	const scores = $derived.by((): ScoreEntry[] => {
		const gdsNorm = packet.gds ?? 0;
		const aldNorm = packet.ald ?? 0;
		// Temporal entropy: normalize to log2(24) ~ 4.58 (max hourly bins in a day)
		const teNorm = packet.temporalEntropy !== null
			? Math.min(packet.temporalEntropy / 4.58, 1)
			: 0;
		// Burst velocity: invert — lower is better, cap at 10
		const bvNorm = packet.burstVelocity !== null
			? Math.max(1 - packet.burstVelocity / 10, 0)
			: 0;
		const caiNorm = packet.cai !== null ? Math.min(packet.cai, 1) : 0;

		return [
			{
				key: 'gds', label: 'Geographic diversity', value: packet.gds,
				description: 'How spread across districts. 1.0 = one action per district.',
				normalized: gdsNorm,
				color: qualityColor(packet.gds),
				invertedWarning: false
			},
			{
				key: 'ald', label: 'Message authenticity', value: packet.ald,
				description: 'How unique each message is. 1.0 = every message distinct.',
				normalized: aldNorm,
				color: qualityColor(packet.ald),
				invertedWarning: false
			},
			{
				key: 'te', label: 'Timing pattern', value: packet.temporalEntropy,
				description: 'How spread over time. Higher = organic, not a single burst.',
				normalized: teNorm,
				color: qualityColor(teNorm > 0 ? teNorm : null),
				invertedWarning: false
			},
			{
				key: 'bv', label: 'Action rate', value: packet.burstVelocity,
				description: 'Peak vs. average rate. Lower = steady, organic action.',
				normalized: bvNorm,
				color: packet.burstVelocity !== null && packet.burstVelocity > 5 ? '#fbbf24' : qualityColor(bvNorm > 0 ? bvNorm : null),
				invertedWarning: packet.burstVelocity !== null && packet.burstVelocity > 5
			},
			{
				key: 'cai', label: 'Engagement depth', value: packet.cai,
				description: 'How many supporters deepen engagement over time.',
				normalized: caiNorm,
				color: qualityColor(packet.cai),
				invertedWarning: false
			}
		];
	});

	function qualityColor(val: number | null): string {
		if (val === null) return 'oklch(0.55 0.01 55)';
		if (val >= 0.8) return '#34d399';
		if (val >= 0.5) return '#2dd4bf';
		return 'oklch(0.65 0.01 55)';
	}

	function fmtScore(val: number | null): string {
		if (val === null) return '\u2014';
		return val.toFixed(2);
	}

	const allNull = $derived(
		packet.gds === null &&
		packet.ald === null &&
		packet.temporalEntropy === null &&
		packet.burstVelocity === null &&
		packet.cai === null
	);
</script>

<div class="rounded-xl bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-6 space-y-4">
	<p class="text-[10px] font-mono uppercase tracking-wider text-text-quaternary">Coordination Integrity</p>

	{#if allNull}
		<div class="py-4 text-center">
			<p class="text-sm text-text-quaternary">Integrity scores appear after 10+ verified actions.</p>
		</div>
	{:else}
		{#if packet.burstVelocity !== null && packet.burstVelocity > 5}
			<div class="bg-amber-500/10 border border-amber-500/20 px-4 py-2 rounded text-sm font-medium text-amber-700">
				Action rate spike detected — decision-makers may question authenticity.
			</div>
		{/if}

		<div class="space-y-3">
			{#each scores as score}
				<div class="group">
					<div class="flex items-center justify-between mb-1">
						<span class="text-[10px] font-mono text-text-tertiary">{score.label}</span>
						<span
							class="font-mono tabular-nums text-sm font-semibold"
							style="color: {score.color}"
						>
							{fmtScore(score.value)}
							{#if score.invertedWarning}
								<span class="text-[10px] text-amber-500 ml-1">high</span>
							{/if}
						</span>
					</div>
					<div class="h-2 rounded-full bg-surface-raised overflow-hidden">
						{#if score.value !== null}
							<div
								class="h-full rounded-full transition-all duration-700 ease-out"
								style="width: {Math.max(score.normalized * 100, 2)}%; background-color: {score.color}"
							></div>
						{/if}
					</div>
					<p class="text-xs text-text-tertiary mt-1">{score.description}</p>
				</div>
			{/each}
		</div>

		<p class="text-[9px] text-text-quaternary pt-2">
			Higher scores indicate more organic, geographically diverse participation. Burst velocity is inverted: lower is better.
		</p>
	{/if}
</div>
