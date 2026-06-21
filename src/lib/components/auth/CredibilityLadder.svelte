<!--
  CredibilityLadder — the verification *ladder*, shown as a ladder you climb.

  The trust model's claim is "verification makes your message count more." The gates
  render that as binary walls ("Verify X to Send") that hide where the user stands,
  what the next rung buys, and that they can SEND RIGHT NOW at a lower tier.

  Interaction-design first, not prose: the RAIL shows state (filled = climbed, the
  next stop pulses), and each stop is hover/tap/focus-interactive — the payoff for a
  rung is REVEALED on demand in one live line, never stacked as text. The value lives
  in the affordances ("Confirm address · counts for more", "Send now"), and gov-ID is
  a future stop ("soon"), not a dead "Coming soon" wall. The send-now escape only
  appears where a lower-tier send is actually permitted (the /s/[slug] nudge, not a
  hard-required gate).

  Principle: visibility of system status + goal-gradient + progressive disclosure of
  VALUE on interaction. Honors the hard constraint that lower tiers still send.
-->
<script lang="ts">
	import { Check } from '@lucide/svelte';
	import { clampTier } from '$lib/core/identity/clamp-tier';
	import { getJurisdictionLabels } from '$lib/core/locale/jurisdiction';

	let {
		currentTier = 0,
		govIdAvailable = false,
		/**
		 * True when the target is an ELECTED office (CWC / representative messaging),
		 * where district confirmation literally weights the message as a constituent.
		 * Default false → the honest generic payoff (a verified local resident), which
		 * is true for institutional/direct targets too. Never claim "offices prioritize
		 * constituents" to an institutional recipient.
		 */
		electedTarget = false,
		onClimb,
		onSendNow,
		compact = false
	}: {
		currentTier?: number;
		govIdAvailable?: boolean;
		electedTarget?: boolean;
		onClimb?: (targetTier: number) => void;
		onSendNow?: () => void;
		compact?: boolean;
	} = $props();

	const labels = getJurisdictionLabels();
	const tier = $derived(clampTier(currentTier, 0));

	type Stop = { tier: number; short: string; label: string; payoff: string; future?: boolean };

	const stops = $derived<Stop[]>([
		{ tier: 1, short: 'Account', label: 'Account verified', payoff: 'Signed by a real, sybil-resistant account.' },
		{
			tier: 2,
			short: 'District',
			label: 'District confirmed',
			payoff: electedTarget
				? `${labels.legislativeBody} offices prioritize confirmed constituents.`
				: "Confirms you're a real local resident, not an anonymous sender."
		},
		{ tier: 4, short: 'Gov-ID', label: 'Government ID', payoff: 'Document-level credential — the highest assurance.', future: !govIdAvailable }
	]);

	const currentTierStop = $derived([...stops].reverse().find((s) => tier >= s.tier)?.tier ?? null);
	const nextStop = $derived(stops.find((s) => tier < s.tier && !s.future));

	// Interaction-driven disclosure: the one detail line reflects the stop the user is
	// exploring (hover / focus / tap); it rests on the next stop so a non-interactor
	// still sees the actionable payoff.
	let activeTier = $state<number | null>(null);
	const shownStop = $derived(
		(activeTier != null ? stops.find((s) => s.tier === activeTier) : null) ?? nextStop ?? null
	);

	function stopState(s: Stop): 'current' | 'reached' | 'next' | 'future' | 'locked' {
		if (s.tier === currentTierStop) return 'current';
		if (tier >= s.tier) return 'reached';
		if (nextStop?.tier === s.tier) return 'next';
		if (s.future) return 'future';
		return 'locked';
	}
	function toggle(t: number) {
		activeTier = activeTier === t ? null : t;
	}
</script>

{#if compact}
	<div class="cl-compact">
		<span class="cl-compact-status">
			{#if tier >= 2}You're district-confirmed{electedTarget ? ' — this counts as a constituent' : ' — a verified local resident'}.
			{:else if tier >= 1}You can send right now.
			{:else}Sign in to send.{/if}
		</span>
		{#if nextStop && onClimb}
			<button type="button" class="cl-link" onclick={() => onClimb?.(nextStop.tier)}>
				{nextStop.label} — counts for more
			</button>
		{/if}
	</div>
{:else}
	<div class="cl">
		<!-- The rail: visual state + interactive stops -->
		<ol class="cl-rail" aria-label="Your verification level — select a step to see what it unlocks">
			{#each stops as s, i (s.tier)}
				{@const state = stopState(s)}
				{#if i > 0}<li class="cl-conn" class:cl-conn--done={tier >= s.tier} aria-hidden="true"></li>{/if}
				<li class="cl-stop cl-stop--{state}" class:cl-stop--active={shownStop?.tier === s.tier}>
					<button
						type="button"
						class="cl-stop-btn"
						aria-pressed={shownStop?.tier === s.tier}
						aria-label={`${s.label}: ${s.payoff}${state === 'current' ? ' (your current level)' : state === 'future' ? ' (coming soon)' : ''}`}
						onmouseenter={() => (activeTier = s.tier)}
						onmouseleave={() => (activeTier = null)}
						onfocus={() => (activeTier = s.tier)}
						onblur={() => (activeTier = null)}
						onclick={() => toggle(s.tier)}
					>
						<span class="cl-dot">
							{#if state === 'reached' || state === 'current'}<Check class="h-3 w-3" />{/if}
						</span>
						<span class="cl-stop-label">{s.short}</span>
						<span class="cl-stop-tag">
							{#if state === 'current'}you{:else if state === 'next'}next{:else if state === 'future'}soon{/if}
						</span>
					</button>
				</li>
			{/each}
		</ol>

		<!-- One live line, driven by interaction (rests on the next stop). -->
		<p class="cl-detail" aria-live="polite">
			{#if shownStop}{shownStop.payoff}{:else if tier >= 2}You're district-confirmed — the highest level available today.{/if}
		</p>

		<!-- Affordances carry the value; no explanatory paragraph. -->
		{#if (nextStop && onClimb) || onSendNow}
			<div class="cl-actions" class:cl-actions--single={!(nextStop && onClimb) || !onSendNow}>
				{#if nextStop && onClimb}
					<button type="button" class="cl-climb" onclick={() => onClimb?.(nextStop.tier)}>
						Confirm {nextStop.tier === 2 ? 'address' : 'ID'} · counts for more
					</button>
				{/if}
				{#if onSendNow}
					<button type="button" class="cl-send-now" onclick={() => onSendNow?.()}>
						Send now
					</button>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.cl {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	/* Rail */
	.cl-rail {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		align-items: flex-start;
	}
	.cl-conn {
		flex: 1;
		height: 2px;
		margin: 0.5625rem 0.125rem 0;
		border-radius: 2px;
		background: oklch(0.88 0.01 250);
		transition: background-color 240ms ease;
	}
	.cl-conn--done {
		background: var(--coord-verified, #10b981);
	}
	.cl-stop {
		flex-shrink: 0;
	}
	.cl-stop-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.1875rem;
		width: 4.5rem;
		padding: 0.125rem 0;
		background: none;
		border: none;
		cursor: pointer;
		border-radius: 0.375rem;
	}
	.cl-stop-btn:focus-visible {
		outline: 2px solid var(--coord-verified, #10b981);
		outline-offset: 2px;
	}
	.cl-dot {
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 9999px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 2px solid oklch(0.82 0.01 250);
		background: #fff;
		color: #fff;
		transition: transform 150ms ease, box-shadow 150ms ease;
	}
	.cl-stop--reached .cl-dot,
	.cl-stop--current .cl-dot {
		background: var(--coord-verified, #10b981);
		border-color: var(--coord-verified, #10b981);
	}
	.cl-stop--current .cl-dot {
		box-shadow: 0 0 0 3px oklch(0.92 0.05 165);
	}
	/* The next rung pulses — interaction draws the eye to the climb. */
	.cl-stop--next .cl-dot {
		border-color: var(--coord-verified, #10b981);
		border-style: dashed;
		animation: cl-pulse 2s ease-in-out infinite;
	}
	.cl-stop--future .cl-dot,
	.cl-stop--locked .cl-dot {
		opacity: 0.55;
	}
	.cl-stop--active .cl-dot {
		transform: scale(1.12);
	}
	@keyframes cl-pulse {
		0%, 100% { box-shadow: 0 0 0 0 oklch(0.72 0.13 165 / 0.45); }
		50% { box-shadow: 0 0 0 5px oklch(0.72 0.13 165 / 0); }
	}
	.cl-stop-label {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-weight: 600;
		font-size: 0.75rem;
		color: oklch(0.32 0.02 250);
	}
	.cl-stop--future .cl-stop-label,
	.cl-stop--locked .cl-stop-label {
		color: oklch(0.55 0.012 250);
	}
	.cl-stop-tag {
		font-size: 0.5625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		min-height: 0.75rem;
		color: oklch(0.55 0.012 250);
	}
	.cl-stop--current .cl-stop-tag { color: oklch(0.42 0.1 165); }
	.cl-stop--next .cl-stop-tag { color: var(--coord-verified, #10b981); }

	/* One interaction-driven line */
	.cl-detail {
		margin: 0;
		min-height: 1.1rem;
		font-size: 0.75rem;
		line-height: 1.45;
		color: oklch(0.46 0.015 250);
		text-align: center;
		transition: color 150ms ease;
	}

	/* Actions */
	.cl-actions {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.5rem;
	}
	.cl-actions--single { grid-template-columns: 1fr; }
	.cl-climb,
	.cl-send-now {
		padding: 0.5625rem 0.875rem;
		border-radius: 0.5rem;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-weight: 600;
		font-size: 0.8125rem;
		cursor: pointer;
		transition: border-color 150ms ease, background-color 150ms ease;
	}
	.cl-climb {
		border: none;
		background: var(--coord-verified, #10b981);
		color: #fff;
	}
	.cl-climb:hover { background: oklch(0.62 0.13 165); }
	.cl-send-now {
		border: 1px solid oklch(0.85 0.01 250);
		background: #fff;
		color: oklch(0.3 0.02 250);
	}
	.cl-send-now:hover { border-color: var(--coord-verified, #10b981); }

	/* Compact inline nudge */
	.cl-compact {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		background: oklch(0.985 0.01 165);
		border: 1px solid oklch(0.92 0.02 165);
	}
	.cl-compact-status {
		font-size: 0.75rem;
		color: oklch(0.42 0.015 250);
	}
	.cl-link {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--coord-verified, #10b981);
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		white-space: nowrap;
	}
	.cl-link:hover { text-decoration: underline; }
	.cl-link:focus-visible {
		outline: 2px solid var(--coord-verified, #10b981);
		outline-offset: 2px;
		border-radius: 2px;
	}

	@media (prefers-reduced-motion: reduce) {
		.cl-conn,
		.cl-dot,
		.cl-climb,
		.cl-send-now,
		.cl-detail { transition: none; }
		.cl-stop--next .cl-dot { animation: none; }
		.cl-stop--active .cl-dot { transform: none; }
	}
</style>
