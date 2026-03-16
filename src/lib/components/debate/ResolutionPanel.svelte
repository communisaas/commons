<script lang="ts">
	/**
	 * Resolution Panel — the strong center of the post-deadline debate view.
	 *
	 * This is where clarity crystallizes. The deliberation is over; now the
	 * citizen sees HOW the verdict was reached. Every number is transparent.
	 *
	 * Perceptual design:
	 * - The winning argument is the strong center (golden ring, elevated)
	 * - The alpha-blend bar shows the governance parameter physically
	 * - Dimension breakdowns are secondary (expandable, not overwhelming)
	 * - Model agreement dots are ambient (peripheral confidence signal)
	 * - The whole panel shifts the atmosphere from amber (deliberation)
	 *   to a cooler violet-tinged clarity (verdict)
	 *
	 * Experiential arc: Resolution phase indicator (where we are) →
	 * Winner announcement (the answer) → Score breakdown (how we got there) →
	 * Appeal path (what happens next)
	 */
	import ResolutionPhaseIndicator from './ResolutionPhaseIndicator.svelte';
	import AlphaBlendBar from './AlphaBlendBar.svelte';
	import AIScoreBreakdown from './AIScoreBreakdown.svelte';
	import ModelAgreementDots from './ModelAgreementDots.svelte';
	import AppealBanner from './AppealBanner.svelte';
	import EvidencePanel from './EvidencePanel.svelte';
	import type { DebateData, ArgumentData } from '$lib/stores/debateState.svelte';
	import { Trophy, ChevronDown, ChevronUp } from '@lucide/svelte';

	interface Props {
		debate: DebateData;
		onAppeal?: () => void;
		onEscalate?: () => void;
	}

	let { debate, onAppeal, onEscalate }: Props = $props();

	const resolution = $derived(debate.aiResolution);
	const winnerArg = $derived(
		debate.arguments.find((a) => a.argumentIndex === debate.winningArgumentIndex)
	);
	const winnerScore = $derived(
		resolution?.argumentScores.find((s) => s.argumentIndex === debate.winningArgumentIndex)
	);

	const stanceColors: Record<string, { bg: string; border: string; text: string; accent: string }> = {
		SUPPORT: { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-800', accent: 'text-indigo-600' },
		OPPOSE: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', accent: 'text-red-600' },
		AMEND: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', accent: 'text-amber-600' }
	};

	const winnerColors = $derived(
		stanceColors[debate.winningStance ?? ''] ?? stanceColors['SUPPORT']
	);

	// Expandable per-argument breakdown
	let expandedArg = $state<number | null>(null);

	function toggleArg(index: number) {
		expandedArg = expandedArg === index ? null : index;
	}

	// Sort arguments by final score (descending)
	const rankedArguments = $derived.by(() => {
		if (!resolution) return debate.arguments;
		return [...debate.arguments].sort((a, b) => {
			const scoreA = resolution.argumentScores.find((s) => s.argumentIndex === a.argumentIndex);
			const scoreB = resolution.argumentScores.find((s) => s.argumentIndex === b.argumentIndex);
			return (scoreB?.finalScore ?? 0) - (scoreA?.finalScore ?? 0);
		});
	});

	function formatBp(bp: number): string {
		return (bp / 100).toFixed(1) + '%';
	}
</script>

<!-- Resolution container: cooler atmosphere than the amber deliberation surface -->
<div class="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/80 overflow-hidden">
	<!-- Phase + Model agreement header -->
	<div class="px-5 pt-4 pb-3 flex items-center justify-between flex-wrap gap-3">
		<ResolutionPhaseIndicator
			phase={debate.status === 'resolved' ? 'resolved'
				: debate.status === 'resolving' ? 'resolving'
				: debate.status === 'awaiting_governance' ? 'awaiting_governance'
				: 'under_appeal'}
			resolutionMethod={resolution?.resolutionMethod}
			appealDeadline={resolution?.appealDeadline}
			source={resolution?.source}
			minerCount={resolution?.minerCount}
		/>

		{#if resolution}
			<ModelAgreementDots
				agreement={winnerScore?.modelAgreement ?? 0}
				modelCount={resolution.modelCount}
				signatureCount={resolution.signatureCount}
				quorumRequired={resolution.quorumRequired}
				compact
			/>
		{/if}
	</div>

	<!-- Winner announcement — the strong center -->
	{#if winnerArg && debate.winningStance}
		<div class="mx-4 mb-4 rounded-lg border-2 {winnerColors.border} {winnerColors.bg} p-4">
			<div class="flex items-start gap-3">
				<div class="shrink-0 mt-0.5">
					<div class="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center">
						<Trophy class="h-4 w-4 text-amber-600" />
					</div>
				</div>
				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-2 mb-1.5">
						<span class="inline-flex items-center text-xs font-semibold rounded-full px-2 py-0.5 border
							{winnerColors.border} {winnerColors.text} {winnerColors.bg}">
							{debate.winningStance}
						</span>
						{#if winnerScore}
							<span class="font-mono text-sm font-semibold {winnerColors.accent}">
								{formatBp(winnerScore.finalScore)}
							</span>
						{/if}
					</div>
					<p class="text-sm {winnerColors.text} leading-relaxed line-clamp-3">
						{winnerArg.body}
					</p>
				</div>
			</div>

			<!-- Alpha blend bar for the winner -->
			{#if winnerScore && resolution}
				<div class="mt-3 pt-3 border-t {winnerColors.border}">
					<AlphaBlendBar
						aiScore={winnerScore.weightedAIScore}
						communityScore={winnerScore.communityScore}
						alphaWeight={resolution.alphaWeight}
						finalScore={winnerScore.finalScore}
						compact
					/>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Per-argument score breakdown (expandable list) -->
	{#if resolution}
		<div class="border-t border-slate-100">
			<div class="px-5 py-3">
				<h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">
					All Arguments — Scored
				</h3>
			</div>

			{#each rankedArguments as arg, rank}
				{@const score = resolution.argumentScores.find((s) => s.argumentIndex === arg.argumentIndex)}
				{@const isWinner = arg.argumentIndex === debate.winningArgumentIndex}
				{@const isExpanded = expandedArg === arg.argumentIndex}
				{@const stanceBorderColor: Record<string, string> = {
					SUPPORT: 'border-l-indigo-500',
					OPPOSE: 'border-l-red-500',
					AMEND: 'border-l-amber-500'
				}}

				<button
					class="w-full text-left border-t border-slate-100 transition-colors
						{isWinner ? 'bg-amber-50/30' : 'hover:bg-slate-50/80'}"
					onclick={() => toggleArg(arg.argumentIndex)}
				>
					<div class="px-5 py-3 flex items-center gap-3
						border-l-3 {stanceBorderColor[arg.stance] ?? 'border-l-slate-300'}">
						<!-- Rank -->
						<span class="w-5 text-xs font-mono font-semibold text-slate-400 shrink-0">
							#{rank + 1}
						</span>

						<!-- Stance badge -->
						<span class="inline-flex items-center text-xs font-medium rounded-full px-2 py-0.5
							{arg.stance === 'SUPPORT' ? 'bg-indigo-50 text-indigo-700'
								: arg.stance === 'OPPOSE' ? 'bg-red-50 text-red-700'
								: 'bg-amber-50 text-amber-700'}">
							{arg.stance}
						</span>

						<!-- Truncated body -->
						<span class="flex-1 text-sm text-slate-700 truncate">
							{arg.body.slice(0, 80)}{arg.body.length > 80 ? '...' : ''}
						</span>

						<!-- Score -->
						{#if score}
							<span class="font-mono text-sm font-semibold text-slate-700 tabular-nums shrink-0">
								{formatBp(score.finalScore)}
							</span>
						{/if}

						<!-- Model agreement (compact dots) -->
						{#if score}
							<div class="flex items-center gap-0.5 shrink-0" title="{Math.round(score.modelAgreement * 100)}% agreement">
								{#each Array(resolution.modelCount) as _, i}
									<div
										class="rounded-full h-1.5 w-1.5
											{i < Math.round(score.modelAgreement * resolution.modelCount)
												? 'bg-emerald-400'
												: 'bg-slate-200'}"
									></div>
								{/each}
							</div>
						{/if}

						<!-- Expand chevron -->
						<div class="shrink-0 text-slate-400">
							{#if isExpanded}
								<ChevronUp size={16} />
							{:else}
								<ChevronDown size={16} />
							{/if}
						</div>
					</div>
				</button>

				<!-- Expanded detail -->
				{#if isExpanded && score}
					{@const dimensions = arg.aiScore ?? score.dimensions}
					<div class="px-5 py-4 bg-slate-50/50 border-t border-slate-100 space-y-4">
						<!-- Dimension breakdown -->
						<AIScoreBreakdown scores={dimensions} />

						<!-- Level 3: Per-evaluator evidence (when multi-evaluator data exists) -->
						{#if resolution?.minerEvaluations}
							<EvidencePanel
								argumentIndex={arg.argumentIndex}
								minerEvaluations={resolution.minerEvaluations}
								medianScores={dimensions}
							/>
						{/if}

						<!-- Full alpha blend -->
						<AlphaBlendBar
							aiScore={score.weightedAIScore}
							communityScore={score.communityScore}
							alphaWeight={resolution.alphaWeight}
							finalScore={score.finalScore}
						/>

						<!-- Model agreement detail -->
						<ModelAgreementDots
							agreement={score.modelAgreement}
							modelCount={resolution.modelCount}
							signatureCount={resolution.signatureCount}
							quorumRequired={resolution.quorumRequired}
						/>
					</div>
				{/if}
			{/each}
		</div>
	{/if}

	<!-- Appeal / Governance actions -->
	{#if debate.status === 'under_appeal' || debate.status === 'awaiting_governance'}
		<div class="border-t border-slate-100">
			<AppealBanner
				status={debate.status}
				appealDeadline={resolution?.appealDeadline}
				hasAppeal={resolution?.hasAppeal ?? false}
				{onAppeal}
				{onEscalate}
			/>
		</div>
	{/if}
</div>
