<script lang="ts">
	/**
	 * Governance Dashboard — the deliberative chamber.
	 *
	 * Perceptual design: This is a place of judgment, not a list of tasks.
	 * The atmosphere is cooler and more authoritative than the debate surface —
	 * emerald and teal instead of warm amber. Each case is a gravity well
	 * that draws the reviewer into the evidence. The action (selecting a winner
	 * and writing justification) is positioned as a weighty act, not a button click.
	 *
	 * Experiential arc: Arrival (overview of pending cases) → Investigation
	 * (expanding a case, reading AI evidence) → Deliberation (comparing arguments) →
	 * Resolution (selecting winner, writing justification) → Confirmation (review + submit)
	 *
	 * Data model: Debates with status 'awaiting_governance' from Prisma,
	 * backed by DebateMarket.sol on Scroll Sepolia. The on-chain function
	 * submitGovernanceResolution(debateId, winningIndex, justificationHash)
	 * is the terminal action.
	 */
	import type { PageData } from './$types';
	import type { DimensionScores } from '$lib/stores/debateState.svelte';
	import {
		Gavel, Scale, ChevronDown, ChevronUp, Shield,
		Users, Coins, Clock, AlertTriangle, CheckCircle2,
		ExternalLink, Hash
	} from '@lucide/svelte';
	import AIScoreBreakdown from '$lib/components/debate/AIScoreBreakdown.svelte';
	import MinerLens from '$lib/components/debate/MinerLens.svelte';
	import EvidenceChain from '$lib/components/debate/EvidenceChain.svelte';

	let { data }: { data: PageData } = $props();

	const cases = $derived(data.cases ?? []);
	const focusDebateId = $derived(data.focusDebateId);

	// Which case is expanded
	let expandedCase = $state<string | null>(null);

	// Auto-expand the focused debate on mount
	$effect(() => {
		if (focusDebateId && cases.some((c: any) => c.id === focusDebateId)) {
			expandedCase = focusDebateId;
		}
	});

	// Per-case governance action state
	let selectedWinner = $state<Record<string, number | null>>({});
	let justifications = $state<Record<string, string>>({});
	let submitting = $state<string | null>(null);
	let submitResult = $state<Record<string, { success: boolean; message: string } | null>>({});

	function toggleCase(id: string) {
		expandedCase = expandedCase === id ? null : id;
	}

	function formatBp(bp: number): string {
		return (bp / 100).toFixed(1) + '%';
	}

	function formatStake(raw: string): string {
		const val = Number(raw) / 1_000_000;
		return '$' + val.toFixed(2);
	}

	function timeAgo(iso: string): string {
		const diff = Date.now() - new Date(iso).getTime();
		const hours = Math.floor(diff / (1000 * 60 * 60));
		if (hours < 1) return 'just now';
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	const stanceConfig: Record<string, { label: string; bg: string; text: string; border: string; ring: string }> = {
		SUPPORT: { label: 'Support', bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', ring: 'ring-indigo-500' },
		OPPOSE: { label: 'Oppose', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', ring: 'ring-red-500' },
		AMEND: { label: 'Amend', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', ring: 'ring-amber-500' }
	};

	async function submitResolution(caseId: string) {
		const winner = selectedWinner[caseId];
		const justification = justifications[caseId]?.trim();
		if (winner == null || !justification) return;

		submitting = caseId;
		submitResult[caseId] = null;

		try {
			const res = await fetch(`/api/debates/${caseId}/governance-resolve`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${(window as any).__CRON_SECRET ?? ''}`
				},
				body: JSON.stringify({
					winningArgumentIndex: winner,
					justification
				})
			});

			if (res.ok) {
				const result = await res.json();
				submitResult[caseId] = {
					success: true,
					message: `Resolved — ${result.winningStance} wins. Appeal window: 7 days.`
				};
			} else {
				const text = await res.text();
				submitResult[caseId] = { success: false, message: text };
			}
		} catch (err) {
			submitResult[caseId] = { success: false, message: 'Network error' };
		} finally {
			submitting = null;
		}
	}
</script>

<svelte:head>
	<title>Governance Review | Commons</title>
</svelte:head>

<div class="max-w-5xl mx-auto">
	<!-- Chamber header -->
	<div class="mb-8">
		<div class="flex items-center gap-3 mb-2">
			<div class="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center">
				<Gavel class="h-5 w-5 text-emerald-700" />
			</div>
			<div>
				<h1 class="text-xl font-semibold text-slate-900 tracking-tight">Governance Review</h1>
				<p class="text-sm text-slate-500">
					{cases.length === 0
						? 'No cases pending'
						: `${cases.length} case${cases.length === 1 ? '' : 's'} awaiting resolution`}
				</p>
			</div>
		</div>
		<div class="h-px bg-gradient-to-r from-emerald-200 via-slate-200 to-transparent mt-4"></div>
	</div>

	{#if cases.length === 0}
		<!-- Empty state -->
		<div class="rounded-md border border-slate-200 bg-white p-12 text-center">
			<Scale class="h-12 w-12 text-slate-300 mx-auto mb-4" />
			<h2 class="text-lg font-medium text-slate-700 mb-1">No pending cases</h2>
			<p class="text-sm text-slate-500 max-w-md mx-auto">
				All debates have been resolved through AI consensus or community voting.
				Cases appear here when AI evaluators cannot reach agreement.
			</p>
		</div>
	{:else}
		<!-- Case docket -->
		<div class="space-y-4">
			{#each cases as govCase (govCase.id)}
				{@const isExpanded = expandedCase === govCase.id}
				{@const consensus = govCase.aiPanelConsensus}
				{@const resolution = govCase.aiResolution}
				{@const winner = selectedWinner[govCase.id]}
				{@const result = submitResult[govCase.id]}

				<div class="rounded-md border border-slate-200 bg-white overflow-hidden transition-shadow
					{isExpanded ? 'shadow-lg ring-1 ring-emerald-100' : 'hover:shadow-md'}">

					<!-- Case header — always visible -->
					<button
						class="w-full text-left px-6 py-4 transition-colors
							{isExpanded ? 'bg-gradient-to-r from-emerald-50/50 to-white' : 'hover:bg-slate-50/50'}"
						onclick={() => toggleCase(govCase.id)}
					>
						<div class="flex items-start gap-4">
							<!-- Severity indicator -->
							<div class="shrink-0 mt-1">
								<div class="h-8 w-8 rounded-full flex items-center justify-center
									{consensus != null && consensus < 0.3
										? 'bg-red-100 text-red-600'
										: 'bg-amber-100 text-amber-600'}">
									<AlertTriangle class="h-4 w-4" />
								</div>
							</div>

							<div class="flex-1 min-w-0">
								<!-- Template + timing -->
								<div class="flex items-center gap-2 mb-1">
									<a
										href="/s/{govCase.templateSlug}"
										class="text-xs font-medium text-teal-600 hover:text-teal-800 transition-colors"
										onclick={(e) => e.stopPropagation()}
									>
										{govCase.templateTitle}
									</a>
									<span class="text-slate-300">|</span>
									<span class="text-xs text-slate-400 flex items-center gap-1">
										<Clock size={10} />
										Escalated {timeAgo(govCase.escalatedAt)}
									</span>
								</div>

								<!-- Proposition -->
								<p class="text-sm font-medium text-slate-800 leading-snug
									{isExpanded ? '' : 'line-clamp-2'}">
									{govCase.propositionText}
								</p>

								<!-- Stats row -->
								<div class="flex items-center gap-4 mt-2 text-xs text-slate-500">
									<span class="flex items-center gap-1">
										<Users size={12} />
										{govCase.uniqueParticipants} participants
									</span>
									<span class="flex items-center gap-1">
										<Scale size={12} />
										{govCase.argumentCount} arguments
									</span>
									<span class="flex items-center gap-1">
										<Coins size={12} />
										{formatStake(govCase.totalStake)} staked
									</span>
									{#if consensus != null}
										<span class="flex items-center gap-1 font-mono
											{consensus < 0.3 ? 'text-red-600' : 'text-amber-600'}">
											<AlertTriangle size={10} />
											{Math.round(consensus * 100)}% consensus
										</span>
									{/if}
								</div>
							</div>

							<!-- Expand control -->
							<div class="shrink-0 text-slate-400 mt-1">
								{#if isExpanded}
									<ChevronUp size={20} />
								{:else}
									<ChevronDown size={20} />
								{/if}
							</div>
						</div>
					</button>

					<!-- Expanded case detail -->
					{#if isExpanded}
						<div class="border-t border-slate-100">
							<!-- Evidence section header -->
							<div class="px-6 py-3 bg-slate-50/50 border-b border-slate-100">
								<div class="flex items-center gap-2">
									<Shield class="h-3.5 w-3.5 text-emerald-500" />
									<h3 class="text-xs font-semibold text-slate-600 uppercase tracking-wider">
										AI Evaluation Evidence
									</h3>
									</div>
							</div>

							<!-- Arguments ranked by AI score -->
							<div class="divide-y divide-slate-100">
								{#each [...govCase.arguments].sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0)) as arg, rank}
									{@const sc = stanceConfig[arg.stance] ?? stanceConfig['SUPPORT']}
									{@const isSelected = winner === arg.argumentIndex}
									{@const resScore = resolution?.argumentScores.find((s) => s.argumentIndex === arg.argumentIndex)}

									<div class="px-6 py-4 transition-colors
										{isSelected ? 'bg-emerald-50/40 ring-inset ring-1 ring-emerald-200' : ''}">

										<!-- Argument header with selection -->
										<div class="flex items-start gap-3">
											<!-- Selection radio -->
											<button
												class="shrink-0 mt-1 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all
													{isSelected
														? 'border-emerald-500 bg-emerald-500'
														: 'border-slate-300 hover:border-emerald-400'}"
												onclick={() => { selectedWinner[govCase.id] = isSelected ? null : arg.argumentIndex; }}
												title="Select as winner"
											>
												{#if isSelected}
													<CheckCircle2 class="h-3 w-3 text-white" />
												{/if}
											</button>

											<div class="flex-1 min-w-0">
												<div class="flex items-center gap-2 mb-1.5">
													<!-- Rank -->
													<span class="text-xs font-mono font-semibold text-slate-400">
														#{rank + 1}
													</span>

													<!-- Stance badge -->
													<span class="inline-flex items-center text-xs font-semibold rounded-full px-2 py-0.5 border
														{sc.border} {sc.text} {sc.bg}">
														{arg.stance}
													</span>

													<!-- AI Score -->
													{#if arg.finalScore != null}
														<span class="font-mono text-sm font-semibold text-slate-700 tabular-nums">
															{formatBp(arg.finalScore)}
														</span>
													{/if}

													<!-- Community signal -->
													<span class="text-xs text-slate-400 flex items-center gap-1">
														<Users size={10} />
														{arg.coSignCount} co-signs
													</span>

													<!-- Model agreement -->
													{#if arg.modelAgreement != null}
														<span class="text-xs font-mono tabular-nums
															{arg.modelAgreement < 0.3 ? 'text-red-500' : arg.modelAgreement < 0.6 ? 'text-amber-500' : 'text-emerald-500'}">
															{Math.round(arg.modelAgreement * 100)}% agree
														</span>
													{/if}
												</div>

												<!-- Full argument body -->
												<p class="text-sm text-slate-700 leading-relaxed">
													{arg.body}
												</p>

												{#if arg.amendmentText}
													<div class="mt-2 pl-3 border-l-2 border-amber-200">
														<p class="text-xs text-amber-700 italic">{arg.amendmentText}</p>
													</div>
												{/if}
											</div>
										</div>

										<!-- AI Score breakdown (always visible in governance view) -->
										{#if arg.aiScores}
											<div class="mt-3 ml-8 space-y-3">
												<AIScoreBreakdown
													scores={arg.aiScores as DimensionScores}
												/>

												<!-- Miner evidence if available -->
												{#if resolution?.minerEvaluations}
													{@const relevantMiners = resolution.minerEvaluations.filter(
														(m) => m.argumentEvaluations.some((ae) => ae.argumentIndex === arg.argumentIndex)
													)}
													{#if relevantMiners.length > 0}
														<div class="rounded-lg border border-slate-200/70 bg-slate-50/30 p-4 space-y-3">
															<MinerLens
																argumentIndex={arg.argumentIndex}
																minerEvaluations={relevantMiners}
																medianScores={arg.aiScores as DimensionScores}
															/>
															<EvidenceChain
																argumentIndex={arg.argumentIndex}
																minerEvaluations={relevantMiners}
															/>
														</div>
													{/if}
												{/if}
											</div>
										{/if}
									</div>
								{/each}
							</div>

							<!-- Governance action panel -->
							<div class="border-t-2 border-emerald-100 bg-gradient-to-b from-emerald-50/30 to-white">
								<div class="px-6 py-5">
									<div class="flex items-center gap-2 mb-4">
										<Gavel class="h-4 w-4 text-emerald-600" />
										<h3 class="text-sm font-semibold text-slate-800">
											Submit Governance Resolution
										</h3>
									</div>

									{#if result?.success}
										<!-- Success state -->
										<div class="rounded-lg border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
											<CheckCircle2 class="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
											<div>
												<p class="text-sm font-medium text-emerald-800">{result.message}</p>
												<a
													href="/s/{govCase.templateSlug}/debate/{govCase.id}"
													class="text-xs text-emerald-600 hover:text-emerald-800 mt-1 inline-flex items-center gap-1"
												>
													View resolved debate <ExternalLink size={10} />
												</a>
											</div>
										</div>
									{:else}
										<!-- Selection summary -->
										{#if winner != null}
											{@const winnerArg = govCase.arguments.find((a) => a.argumentIndex === winner)}
											<div class="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 mb-4">
												<div class="flex items-center gap-2 text-xs text-emerald-700 mb-1">
													<CheckCircle2 size={12} />
													<span class="font-medium">Selected winner: Argument #{winner}</span>
													{#if winnerArg}
														<span class="px-1.5 py-0.5 rounded text-xs font-semibold
															{stanceConfig[winnerArg.stance]?.bg ?? ''}
															{stanceConfig[winnerArg.stance]?.text ?? ''}">
															{winnerArg.stance}
														</span>
													{/if}
												</div>
												{#if winnerArg}
													<p class="text-xs text-slate-600 line-clamp-2">{winnerArg.body}</p>
												{/if}
											</div>
										{/if}

										<!-- Justification -->
										<div class="mb-4">
											<label for="justification-{govCase.id}" class="block text-xs font-medium text-slate-600 mb-1.5">
												Governance justification
												<span class="text-slate-400 font-normal">(required — will be hashed on-chain)</span>
											</label>
											<textarea
												id="justification-{govCase.id}"
												class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2
													text-sm text-slate-800 placeholder:text-slate-400
													focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-300
													resize-y min-h-[80px]"
												placeholder="Explain the reasoning behind this governance decision. Consider: Why did AI evaluators disagree? Which arguments presented stronger evidence? How does the community signal inform the decision?"
												bind:value={justifications[govCase.id]}
											></textarea>
										</div>

										<!-- On-chain reference -->
										<div class="flex items-center gap-1.5 text-xs text-slate-400 mb-4 font-mono">
											<Hash size={10} />
											{govCase.debateIdOnchain.slice(0, 10)}...{govCase.debateIdOnchain.slice(-8)}
										</div>

										<!-- Submit -->
										<div class="flex items-center gap-3">
											<button
												class="px-4 py-2 rounded-lg text-sm font-medium transition-all
													{winner != null && justifications[govCase.id]?.trim()
														? 'bg-emerald-600 text-white hover:bg-emerald-700'
														: 'bg-slate-100 text-slate-400 cursor-not-allowed'}"
												disabled={winner == null || !justifications[govCase.id]?.trim() || submitting === govCase.id}
												onclick={() => submitResolution(govCase.id)}
											>
												{#if submitting === govCase.id}
													Submitting...
												{:else}
													Submit Resolution
												{/if}
											</button>

											{#if winner == null}
												<span class="text-xs text-slate-400">Select a winning argument above</span>
											{:else if !justifications[govCase.id]?.trim()}
												<span class="text-xs text-slate-400">Write a justification to proceed</span>
											{/if}

											{#if result && !result.success}
												<span class="text-xs text-red-600">{result.message}</span>
											{/if}
										</div>
									{/if}
								</div>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
