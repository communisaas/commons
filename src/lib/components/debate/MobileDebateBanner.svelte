<script lang="ts">
	/**
	 * MobileDebateBanner — Sticky bottom discovery affordance for mobile.
	 *
	 * Problem: On mobile, the debate surface sits many scroll-lengths below the
	 * send button. Users who never scroll past the message body have no awareness
	 * that deliberation exists on this template.
	 *
	 * Solution: A fixed banner that floats above MobileBottomBar and appears once
	 * the user scrolls past the header action zone (300px threshold). For resolved
	 * debates the banner is always visible — the outcome is decision-critical
	 * information that should travel with the user.
	 *
	 * At lg: (1024px+) the two-column layout gives simultaneous visibility of both
	 * message and debate surfaces, making this banner redundant. It is suppressed
	 * there via `lg:hidden`.
	 *
	 * Positioning: `fixed bottom-20` (5rem). MobileBottomBar occupies ~64px at
	 * bottom-0 (z-100). This banner sits at z-40, safely below the header (z-50)
	 * and above page content, with ~16px of breathing room above the bar.
	 *
	 * Scroll tap target: `[data-debate-surface]` attribute on the debate panel.
	 * Uses smooth scroll behavior — cognitive load of "jump" navigation is reduced
	 * when the user can track spatial movement.
	 */
	import { fly } from 'svelte/transition';
	import { ChevronDown, ShieldCheck, AlertTriangle, PenLine } from '@lucide/svelte';
	import type { DebateData } from '$lib/stores/debateState.svelte';
	import { computeStanceCounts, computeStancePercentages, formatTimeRemaining } from '$lib/utils/debate-stats';

	interface Props {
		debate: DebateData | null;
	}

	let { debate }: Props = $props();

	// ── Visibility state ──────────────────────────────────────────────────────

	let visible = $state(false);

	// ── Status flags ──────────────────────────────────────────────────────────

	const isActive = $derived(debate?.status === 'active');
	const isResolved = $derived(debate?.status === 'resolved');
	const isResolving = $derived(
		debate?.status === 'resolving' ||
			debate?.status === 'awaiting_governance' ||
			debate?.status === 'under_appeal'
	);

	// ── Stance distribution ───────────────────────────────────────────────────

	const stanceCounts = $derived(computeStanceCounts(debate?.arguments));
	const totalArgs = $derived(stanceCounts.support + stanceCounts.oppose + stanceCounts.amend);
	const pcts = $derived(computeStancePercentages(stanceCounts));
	const supportPct = $derived(pcts.supportPct);
	const opposePct = $derived(pcts.opposePct);
	const amendPct = $derived(pcts.amendPct);

	// ── Time remaining ────────────────────────────────────────────────────────

	const timeRemaining = $derived(formatTimeRemaining(debate?.deadline));

	// ── Eager visibility for resolved/resolving debates ──────────────────────
	//
	// For resolved and resolving debates the banner must appear immediately on
	// mount — even if the user never scrolls. A $effect seeds `visible = true`
	// as soon as the relevant status is observed, rather than waiting for the
	// first scroll event. This covers the case where a user deep-links to the
	// page or arrives via browser history with the page already scrolled.
	$effect(() => {
		if (isResolved || isResolving) {
			visible = true;
		}
	});

	// ── Scroll handler ────────────────────────────────────────────────────────

	function handleScroll() {
		if (!debate) return;

		// Resolved debate outcome is decision-critical: always visible.
		// This lets users who open the page mid-scroll still see the outcome.
		if (isResolved || isResolving) {
			visible = true;
			return;
		}

		// Active debate: appear after clearing the header/action zone.
		// 300px threshold chosen to cover the header (~80px) + hero area
		// before the message body begins, so the banner doesn't intrude
		// on the primary send action affordance.
		visible = window.scrollY > 300;
	}

	// ── Scroll to debate surface ──────────────────────────────────────────────

	function scrollToDebate() {
		document.querySelector('[data-debate-surface]')?.scrollIntoView({ behavior: 'smooth' });
	}
</script>

<!--
  The scroll listener is always attached but handleScroll early-returns when
  debate is null (svelte:window must be at the component top level in Svelte 5).
-->
<svelte:window onscroll={handleScroll} />

{#if debate !== null && visible}
		<div
			class="fixed bottom-20 left-0 right-0 z-40 px-4 lg:hidden"
			transition:fly={{ y: 48, duration: 200 }}
		>
			{#if isResolved}
				<!--
					Resolved variant: outcome-colored bar.

					The color maps directly to the winning stance to create a consistent
					semantic system with DebateSignal:
					  emerald → SUPPORT  (framing validated by deliberation)
					  red     → OPPOSE   (framing contested, proceed with caution)
					  amber   → AMEND    (amendment proposed, modified framing available)

					No scroll threshold for resolved state — this is decision-critical
					information the user needs regardless of scroll position.
				-->
				{#if debate.winningStance === 'SUPPORT'}
					<button
						class="flex w-full items-center gap-3 rounded-md border border-emerald-200/60
						       bg-emerald-50/95 px-4 py-2.5 shadow-lg backdrop-blur-sm
						       transition-colors active:bg-emerald-100/95"
						onclick={scrollToDebate}
					>
						<ShieldCheck class="h-4 w-4 shrink-0 text-emerald-600" />
						<span class="flex-1 text-left text-sm font-medium text-emerald-700">
							Framing tested
						</span>
						<span class="shrink-0 text-xs text-emerald-600/70">
							{debate.uniqueParticipants} deliberated
						</span>
						<ChevronDown class="h-4 w-4 shrink-0 text-emerald-400" />
					</button>
				{:else if debate.winningStance === 'OPPOSE'}
					<button
						class="flex w-full items-center gap-3 rounded-md border border-red-200/60
						       bg-red-50/95 px-4 py-2.5 shadow-lg backdrop-blur-sm
						       transition-colors active:bg-red-100/95"
						onclick={scrollToDebate}
					>
						<AlertTriangle class="h-4 w-4 shrink-0 text-red-600" />
						<span class="flex-1 text-left text-sm font-medium text-red-700">
							Framing contested
						</span>
						<span class="shrink-0 text-xs text-red-600/70">
							{debate.uniqueParticipants} deliberated
						</span>
						<ChevronDown class="h-4 w-4 shrink-0 text-red-400" />
					</button>
				{:else if debate.winningStance === 'AMEND'}
					<button
						class="flex w-full items-center gap-3 rounded-md border border-amber-200/60
						       bg-amber-50/95 px-4 py-2.5 shadow-lg backdrop-blur-sm
						       transition-colors active:bg-amber-100/95"
						onclick={scrollToDebate}
					>
						<PenLine class="h-4 w-4 shrink-0 text-amber-600" />
						<span class="flex-1 text-left text-sm font-medium text-amber-700">
							Amendment proposed
						</span>
						<span class="shrink-0 text-xs text-amber-600/70">
							{debate.uniqueParticipants} deliberated
						</span>
						<ChevronDown class="h-4 w-4 shrink-0 text-amber-400" />
					</button>
				{/if}
			{:else}
				<!--
					Active / resolving variant: amber atmosphere.

					Amber is the deliberation accent throughout the debate surface.
					Keeping this banner in the same palette creates spatial continuity —
					the user associates amber with "debate" and understands scrolling
					down will reach that zone.

					Stance mini-bar is only shown at 3+ arguments. Below that threshold
					a two-segment bar with one dominant stance would give a misleading
					read on deliberation direction.

					aria-label on the distribution bar gives screen reader users the
					same stance breakdown the visual bar communicates.
				-->
				<button
					class="flex w-full items-center gap-3 rounded-md border border-amber-200/60
					       bg-amber-50/95 px-4 py-2.5 shadow-lg backdrop-blur-sm
					       transition-colors active:bg-amber-100/95"
					onclick={scrollToDebate}
				>
					<!-- Ambient pulse: signals live activity without demanding attention -->
					<span class="debate-dot h-2 w-2 shrink-0 rounded-full bg-amber-500"></span>

					{#if totalArgs >= 3}
						<div
							class="flex h-1.5 w-12 shrink-0 overflow-hidden rounded-full"
							role="img"
							aria-label="Stance distribution: {stanceCounts.support} support, {stanceCounts.oppose} oppose, {stanceCounts.amend} amend"
						>
							{#if stanceCounts.support > 0}
								<div class="bg-indigo-500" style="width: {supportPct}%"></div>
							{/if}
							{#if stanceCounts.oppose > 0}
								<div class="bg-red-500" style="width: {opposePct}%"></div>
							{/if}
							{#if stanceCounts.amend > 0}
								<div class="bg-amber-500" style="width: {amendPct}%"></div>
							{/if}
						</div>
					{/if}

					<span class="flex-1 text-left text-sm text-amber-800">
						{debate.uniqueParticipants} debating
					</span>

					{#if isActive && timeRemaining}
						<span class="shrink-0 text-xs text-amber-600/70">{timeRemaining}</span>
					{/if}

					<ChevronDown class="h-4 w-4 shrink-0 text-amber-400" />
				</button>
			{/if}
		</div>
{/if}

<style>
	/*
	 * Gentle opacity pulse — signals live activity without competing with
	 * primary UI elements. Slower than a typical spinner (1.4s) to keep
	 * it ambient rather than urgent. Named distinctly from DebateSignal's
	 * animation to avoid keyframe collision if both render on the same page
	 * (Svelte scopes class names but @keyframes are global in the output CSS).
	 */
	.debate-dot {
		animation: mobile-debate-pulse 1.4s ease-in-out infinite;
	}

	@keyframes mobile-debate-pulse {
		0%,
		100% {
			opacity: 0.5;
		}
		50% {
			opacity: 1;
		}
	}

	/*
	 * Respect prefers-reduced-motion. The fly transition is controlled by
	 * Svelte so we cannot suppress it here; users who need reduced motion
	 * should have their OS setting propagated. The pulse animation we own
	 * directly and must stop.
	 */
	@media (prefers-reduced-motion: reduce) {
		.debate-dot {
			animation: none;
			opacity: 1;
		}
	}
</style>
