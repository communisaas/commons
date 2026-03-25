<script lang="ts">
	/**
	 * DebateSettlement — org admin controls for settling a debate.
	 *
	 * When the debate is active and the user is an org admin, shows settlement
	 * controls (outcome selector + reasoning). After settlement, shows the
	 * outcome badge and reasoning in read-only mode.
	 */

	interface Props {
		debateId: string;
		debateStatus: string;
		winningStance?: string | null;
		reasoning?: string | null;
		canSettle: boolean;
		onSettled?: (result: { outcome: string; reasoning: string }) => void;
	}

	let { debateId, debateStatus, winningStance, reasoning, canSettle, onSettled }: Props = $props();

	let selectedOutcome = $state<'support' | 'oppose' | null>(null);
	let settlementReasoning = $state('');
	let showConfirm = $state(false);
	let settling = $state(false);
	let settlementError = $state<string | null>(null);

	const isResolved = $derived(debateStatus === 'resolved');
	const canShowControls = $derived(canSettle && !isResolved && debateStatus !== 'under_appeal');

	async function handleSettle() {
		if (!selectedOutcome || !settlementReasoning.trim() || settling) return;

		settling = true;
		settlementError = null;

		try {
			const res = await fetch(`/api/debates/${debateId}/settle`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					outcome: selectedOutcome,
					reasoning: settlementReasoning.trim()
				})
			});

			if (!res.ok) {
				const msg = await res.json().catch(() => ({ message: 'Settlement failed' }));
				settlementError = msg.message || `Settlement failed (${res.status})`;
				return;
			}

			showConfirm = false;
			onSettled?.({ outcome: selectedOutcome, reasoning: settlementReasoning.trim() });
		} catch {
			settlementError = 'Network error — please try again';
		} finally {
			settling = false;
		}
	}
</script>

{#if isResolved && winningStance}
	<!-- Read-only: show settlement outcome -->
	<div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
		<div class="flex items-center gap-2">
			<span class="inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-mono font-medium text-emerald-400">
				Settled: {winningStance}
			</span>
		</div>
		{#if reasoning}
			<p class="text-sm text-text-tertiary leading-relaxed">{reasoning}</p>
		{/if}
	</div>
{:else if canShowControls}
	<!-- Settlement controls for org admin -->
	<div class="rounded-lg border border-surface-border bg-surface-raised p-4 space-y-4">
		<div>
			<p class="text-sm font-medium text-text-secondary">Settle Debate</p>
			<p class="text-xs text-text-tertiary mt-0.5">
				Declare the outcome of this debate. This action cannot be undone.
			</p>
		</div>

		<!-- Outcome selector -->
		<div class="flex gap-3">
			<button
				type="button"
				class="flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors
					{selectedOutcome === 'support'
						? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-400'
						: 'border-surface-border-strong bg-surface-overlay text-text-tertiary hover:text-text-secondary hover:border-surface-border-strong'}"
				onclick={() => { selectedOutcome = 'support'; }}
			>
				Support
			</button>
			<button
				type="button"
				class="flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors
					{selectedOutcome === 'oppose'
						? 'border-red-500/50 bg-red-500/10 text-red-400'
						: 'border-surface-border-strong bg-surface-overlay text-text-tertiary hover:text-text-secondary hover:border-surface-border-strong'}"
				onclick={() => { selectedOutcome = 'oppose'; }}
			>
				Oppose
			</button>
		</div>

		<!-- Reasoning textarea -->
		<div>
			<label for="settlement-reasoning" class="block text-xs font-medium text-text-tertiary mb-1.5">
				Reasoning <span class="text-text-quaternary">(required, 10-2000 characters)</span>
			</label>
			<textarea
				id="settlement-reasoning"
				bind:value={settlementReasoning}
				rows="3"
				placeholder="Explain the rationale for this outcome..."
				class="w-full rounded-lg border border-surface-border-strong bg-surface-overlay px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors resize-y"
			></textarea>
		</div>

		{#if settlementError}
			<div class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
				{settlementError}
			</div>
		{/if}

		{#if !showConfirm}
			<button
				type="button"
				disabled={!selectedOutcome || settlementReasoning.trim().length < 10}
				onclick={() => { showConfirm = true; }}
				class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
			>
				Settle Debate
			</button>
		{:else}
			<!-- Confirmation dialog -->
			<div class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
				<p class="text-sm font-medium text-amber-400">
					Confirm settlement
				</p>
				<p class="text-xs text-text-tertiary">
					You are about to settle this debate as <span class="font-medium text-text-secondary">{selectedOutcome}</span>. This cannot be undone.
				</p>
				<div class="flex gap-2">
					<button
						type="button"
						disabled={settling}
						onclick={handleSettle}
						class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 transition-colors disabled:opacity-50"
					>
						{settling ? 'Settling...' : 'Confirm Settlement'}
					</button>
					<button
						type="button"
						disabled={settling}
						onclick={() => { showConfirm = false; }}
						class="rounded-lg border border-surface-border-strong bg-surface-overlay px-4 py-2 text-sm font-medium text-text-tertiary hover:text-text-secondary transition-colors"
					>
						Cancel
					</button>
				</div>
			</div>
		{/if}
	</div>
{/if}
