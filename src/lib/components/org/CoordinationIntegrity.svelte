<!--
  CoordinationIntegrity — the collapsed coordination audit. Raw scores are
  auditor-facing detail, not the headline: the default reading is the
  one-line IntegrityAssessment sentence rendered by the parent surface.
  Opening the audit reveals each scalar with its computation provenance.

  Two of the five readings can carry an action. When present, the other three
  share the same no-action sentence. Non-present readings instead state their
  Fact: absent, withheld, or blocked. The labels and explanations keep those
  answers distinct, and withheld reasons distinguish a small campaign from a
  short window. No value is coloured or ranked, and neither ratio value renders below the declared action floor.
-->
<script lang="ts">
	import type { VerificationPacket } from '$lib/types/verification-packet';
	import { Datum } from '$lib/design';
	import type { Fact } from '$lib/core/fact';
	import {
		ACTION_FLOOR_WITHHELD_REASON,
		BURST_VELOCITY_REVIEW_THRESHOLD,
		DIAGNOSTIC_ACTION_FLOOR,
		coordinationReadingFacts,
		factExplanation,
		factStatusLabel
	} from './integrity-assessment';

	type CoordinationIntegrityPacket = Pick<
		VerificationPacket,
		'gds' | 'ald' | 'temporalEntropy' | 'burstVelocity' | 'cai' | 'total' | 'districtCount'
	>;

	let { packet }: { packet: CoordinationIntegrityPacket } = $props();

	const IDENTICAL_CONTENT_ALD_THRESHOLD = 0.5;

	interface ScoreEntry {
		key: string;
		label: string;
		/** The shared fact remains intact until the render branches below. */
		value: Fact<number>;
		/** The single line the org reads: what the value says, and what to do about it */
		reading: string;
		/** Provenance for the auditor: which computation produced this scalar */
		cite: string;
	}

	const scores = $derived.by((): ScoreEntry[] => {
		const facts = coordinationReadingFacts(packet, packet.total);

		let samenessReading: string;
		if (packet.ald !== null && packet.ald < IDENTICAL_CONTENT_ALD_THRESHOLD)
			samenessReading =
				'Most senders are sending the same text. Edit the template so the ask varies. Where an office deduplicates identical text, identical sends can be counted once.';
		else samenessReading = 'Message text varies across senders.';

		let arrivalReading: string;
		if (facts.arrival.state === 'present' && facts.arrival.value > BURST_VELOCITY_REVIEW_THRESHOLD)
			arrivalReading = `Your peak hour ran ${facts.arrival.value.toFixed(1)}x the average of your active hours. Did you run a push?`;
		else if (facts.arrival.state === 'present')
			arrivalReading = `Peak hour ran ${facts.arrival.value.toFixed(1)}x the average of your active hours.`;
		else arrivalReading = '';

		return [
			{
				key: 'gds',
				label: 'Geographic diversity',
				value: facts.gds,
				reading:
					packet.gds !== null && packet.districtCount === 1
						? 'One district in this campaign. This value is 0.00 by construction, not by measurement. No action available. Both directions of this reading are ambiguous.'
						: 'How spread across districts the actions are. No action available. Both directions of this reading are ambiguous.',
				cite: 'computeGDSFromDistribution'
			},
			{
				key: 'ald',
				label: 'Message sameness',
				value: facts.sameness,
				reading: samenessReading,
				cite: '1 − computeALD'
			},
			{
				key: 'te',
				label: 'Timing pattern',
				value: facts.timing,
				reading:
					'How spread over time the actions are. No action available. Both directions of this reading are ambiguous.',
				cite: 'computeEntropyFromBins'
			},
			{
				key: 'bv',
				label: 'Arrival shape',
				value: facts.arrival,
				reading: arrivalReading,
				cite: 'computeVelocityFromBins'
			},
			{
				key: 'cai',
				label: 'Engagement depth',
				value: facts.cai,
				reading:
					'How many supporters deepen engagement over time. No action available. Both directions of this reading are ambiguous.',
				cite: 'computeCAI'
			}
		];
	});

	const allNull = $derived(
		packet.gds === null &&
			packet.ald === null &&
			packet.temporalEntropy === null &&
			packet.burstVelocity === null &&
			packet.cai === null
	);
	// The screen and the row must never contradict each other: below the floor
	// the row says there is no pattern to read, so nothing may announce one.
	const identicalContentWarning = $derived(
		packet.total >= DIAGNOSTIC_ACTION_FLOOR &&
			packet.ald !== null &&
			packet.ald < IDENTICAL_CONTENT_ALD_THRESHOLD
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
		{#if absentGeographyWarning || identicalContentWarning}
			<div class="space-y-2">
				{#if absentGeographyWarning}
					<div
						class="rounded border border-orange-500/20 bg-orange-500/10 px-4 py-2 text-sm font-medium text-orange-800"
					>
						Geographic signal absent:
						<span class="font-mono tabular-nums"
							><Datum value={packet.total} cite="computeVerificationPacketCached total" /> actions</span
						>
						reached the packet, but
						<span class="font-mono tabular-nums"
							><Datum
								value={packet.districtCount}
								cite="computeVerificationPacketCached districtCount"
							/> districts</span
						>
						were available. Geographic diversity remains uncounted.
					</div>
				{/if}
				{#if identicalContentWarning}
					<div
						class="rounded border border-orange-500/20 bg-orange-500/10 px-4 py-2 text-sm font-medium text-orange-800"
					>
						Identical-content threshold crossed:
						<span class="font-mono tabular-nums"
							>ALD &lt; <Datum
								value={IDENTICAL_CONTENT_ALD_THRESHOLD}
								decimals={2}
								cite="computeALD threshold"
							/></span
						>. Many actions share the same message hash.
					</div>
				{/if}
			</div>
		{/if}

		{#if allNull && packet.total < 2}
			<p class="text-text-quaternary text-sm">
				Readings appear once a campaign has two or more actions.
			</p>
		{:else}
			<div class="space-y-3">
				{#each scores as score}
					<div class="group">
						<div class="mb-1 flex items-center justify-between">
							<span class="text-text-tertiary font-mono text-[10px]">{score.label}</span>
							{#if score.value.state === 'present'}
								<span class="text-text-secondary font-mono text-sm font-semibold tabular-nums">
									<Datum value={score.value.value} decimals={2} cite={score.cite} />
									{#if score.key === 'gds' && absentGeographyWarning}
										<span class="ml-1 text-[10px] text-orange-600">missing</span>
									{:else if score.key === 'ald' && identicalContentWarning}
										<span class="ml-1 text-[10px] text-orange-600">threshold</span>
									{/if}
								</span>
							{:else}
								<span class="text-text-quaternary font-mono text-[10px] tracking-wide uppercase">
									{factStatusLabel(score.value)}
								</span>
							{/if}
						</div>
						<p class="text-text-tertiary mt-1 text-xs">
							{score.value.state === 'present' ? score.reading : factExplanation(score.value)}
						</p>
						{#if score.value.state === 'withheld' && score.value.why === ACTION_FLOOR_WITHHELD_REASON}
							<p class="text-text-quaternary mt-1 text-xs">
								<Datum value={packet.total} cite="campaign action count" /> actions in this campaign.
							</p>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</details>
