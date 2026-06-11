<!--
  CoordinationIntegrity — the collapsed coordination audit. Raw scores are
  auditor-facing detail, not the headline: the default reading is the
  one-line IntegrityAssessment sentence rendered by the parent surface.
  Opening the audit reveals each scalar with its computation provenance.
-->
<script lang="ts">
	import type { VerificationPacket } from '$lib/types/verification-packet';
	import { Datum } from '$lib/design';
	import { BURST_VELOCITY_REVIEW_THRESHOLD } from './integrity-assessment';

	type CoordinationIntegrityPacket = Pick<
		VerificationPacket,
		'gds' | 'ald' | 'temporalEntropy' | 'burstVelocity' | 'cai' | 'total' | 'districtCount'
	>;

	let { packet }: { packet: CoordinationIntegrityPacket } = $props();

	const IDENTICAL_CONTENT_ALD_THRESHOLD = 0.5;

	interface ScoreEntry {
		key: string;
		label: string;
		description: string;
		value: number | null;
		/** Normalized 0-1 for bar display */
		normalized: number;
		color: string;
		invertedWarning: boolean;
		/** Provenance for the auditor: which computation produced this scalar */
		cite: string;
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
				invertedWarning: false,
				cite: 'computeGDSFromDistribution'
			},
			{
				key: 'ald', label: 'Message authenticity', value: packet.ald,
				description: 'How unique each message is. 1.0 = every message distinct.',
				normalized: aldNorm,
				color: qualityColor(packet.ald),
				invertedWarning: false,
				cite: 'computeALD'
			},
			{
				key: 'te', label: 'Timing pattern', value: packet.temporalEntropy,
				description: 'How spread over time. Higher = organic, not a single burst.',
				normalized: teNorm,
				color: qualityColor(teNorm > 0 ? teNorm : null),
				invertedWarning: false,
				cite: 'computeEntropyFromBins'
			},
			{
				key: 'bv', label: 'Action rate', value: packet.burstVelocity,
				description: 'Peak vs. average rate. Lower = steady, organic action.',
				normalized: bvNorm,
				color: packet.burstVelocity !== null && packet.burstVelocity > BURST_VELOCITY_REVIEW_THRESHOLD ? '#fbbf24' : qualityColor(bvNorm > 0 ? bvNorm : null),
				invertedWarning: packet.burstVelocity !== null && packet.burstVelocity > BURST_VELOCITY_REVIEW_THRESHOLD,
				cite: 'computeVelocityFromBins'
			},
			{
				key: 'cai', label: 'Engagement depth', value: packet.cai,
				description: 'How many supporters deepen engagement over time.',
				normalized: caiNorm,
				color: qualityColor(packet.cai),
				invertedWarning: false,
				cite: 'computeCAI'
			}
		];
	});

	function qualityColor(val: number | null): string {
		if (val === null) return 'oklch(0.55 0.01 55)';
		if (val >= 0.8) return '#34d399';
		if (val >= 0.5) return '#2dd4bf';
		return 'oklch(0.65 0.01 55)';
	}

	const allNull = $derived(
		packet.gds === null &&
		packet.ald === null &&
		packet.temporalEntropy === null &&
		packet.burstVelocity === null &&
		packet.cai === null
	);
	const identicalContentWarning = $derived(
		packet.ald !== null && packet.ald < IDENTICAL_CONTENT_ALD_THRESHOLD
	);
	const absentGeographyWarning = $derived(packet.total > 0 && packet.districtCount === 0);
</script>

<details>
	<summary
		class="text-text-tertiary hover:text-text-secondary cursor-pointer text-xs font-medium select-none"
	>
		Coordination audit
	</summary>

	<div class="mt-3 space-y-4">
		{#if allNull && !absentGeographyWarning}
			<p class="text-text-quaternary text-sm">Integrity scores appear after 10+ verified actions.</p>
		{:else}
			{#if absentGeographyWarning || identicalContentWarning}
				<div class="space-y-2">
					{#if absentGeographyWarning}
						<div class="bg-orange-500/10 border border-orange-500/20 px-4 py-2 rounded text-sm font-medium text-orange-800">
							Geographic signal absent:
							<span class="font-mono tabular-nums"><Datum value={packet.total} cite="computeVerificationPacketCached total" /> actions</span>
							reached the packet, but
							<span class="font-mono tabular-nums"><Datum value={packet.districtCount} cite="computeVerificationPacketCached districtCount" /> districts</span>
							were available. Geographic diversity remains uncounted.
						</div>
					{/if}
					{#if identicalContentWarning}
						<div class="bg-orange-500/10 border border-orange-500/20 px-4 py-2 rounded text-sm font-medium text-orange-800">
							Identical-content threshold crossed:
							<span class="font-mono tabular-nums">ALD &lt; <Datum value={IDENTICAL_CONTENT_ALD_THRESHOLD} decimals={2} cite="computeALD threshold" /></span>.
							Many actions share the same message hash.
						</div>
					{/if}
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
								<Datum value={score.value} decimals={2} cite={score.cite} />
								{#if score.invertedWarning}
									<span class="text-[10px] text-amber-500 ml-1">high</span>
								{:else if score.key === 'gds' && absentGeographyWarning}
									<span class="text-[10px] text-orange-600 ml-1">missing</span>
								{:else if score.key === 'ald' && identicalContentWarning}
									<span class="text-[10px] text-orange-600 ml-1">threshold</span>
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
</details>
