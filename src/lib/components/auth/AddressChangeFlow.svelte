<!--
  AddressChangeFlow.svelte

  Re-grounding — single-surface composition for a verified constituent
  binding a new verified address.

  This is NOT a nested modal. The old-ground zone stays visible on the
  surface through the entire flow: capture, witnessing, AND the consequential
  diff. AddressVerificationFlow runs inline with `regroundingMode={true}` and
  drives the real async boundaries (retire + attest).

  Composition:
    - During capture + witnessing, the layout is vertical stack: Zone 1
      "Current ground" pane at top, AddressVerificationFlow below.
    - At `phase === 'complete'`, the layout morphs into a horizontal grid
      (sm+). Zone 1 remains mounted and becomes the LEFT column (the WAS
      side of the relation); AddressVerificationFlow renders only the IS
      column on the right. The user sees the SAME old-ground pane the whole
      time; the new ground arrives beside it. No structural duplication.

  Parent responsibility:
    - Disable the close × while `onPhaseChange('witnessing')` is the last
      emission, because retiring credentials is irreversible.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import AddressVerificationFlow, { type RegroundingPhase } from './AddressVerificationFlow.svelte';
	import {
		getConstituentAddress,
		type ConstituentAddress
	} from '$lib/core/identity/constituent-address';
	import type { ReverificationBudget } from '$lib/components/profile/GroundCard.svelte';

	// ---- Types ----
	interface Representative {
		name: string;
		party?: string;
		chamber?: string;
		state?: string;
		district?: string;
	}

	// ---- Props ----
	let {
		userId,
		onClose,
		initialRepresentatives = [] as Representative[],
		refreshRepresentatives,
		budget = null,
		onPhaseChange
	}: {
		userId: string;
		onClose: () => void;
		/** Current reps at open time — passed from parent for the "was" column. */
		initialRepresentatives?: Representative[];
		/**
		 * Parent-supplied refresher. Called after the new credential is issued
		 * so the "is" column can reflect the re-grounded representatives.
		 * If omitted, the "is" column shows a placeholder.
		 */
		refreshRepresentatives?: () => Promise<Representative[]>;
		/**
		 * Re-verification budget — defensive pre-flight gate. The GroundCard
		 * affordance already disables itself when throttled, but rendering a
		 * legible refusal here closes the race where stale page data lets a
		 * user open the flow during a budget change. When throttled, we render
		 * the prior-ground pane with a calm explanation instead of mounting
		 * AddressVerificationFlow at all.
		 */
		budget?: ReverificationBudget | null;
		/**
		 * Emitted on every re-grounding phase transition (capture/witnessing/complete).
		 * Parent uses this to disable its close × during the witnessing ceremony,
		 * since the retire step is irreversible once started.
		 */
		onPhaseChange?: (phase: RegroundingPhase) => void;
	} = $props();

	// Pre-flight gate. The throttle/cap/sybil checks are read-only projections
	// of `verifyAddress`'s server-side gates, mirrored to the client so we can
	// refuse mounting before any local state is touched.
	const blockedReason = $derived.by(
		(): null | {
			kind: 'throttle' | 'period' | 'sybil';
			hours?: number;
		} => {
			if (!budget || budget.tierBypass) return null;
			const now = Date.now();
			if (budget.nextAllowedAt && budget.nextAllowedAt > now) {
				return {
					kind: 'throttle',
					hours: Math.max(1, Math.ceil((budget.nextAllowedAt - now) / (60 * 60 * 1000)))
				};
			}
			if (budget.recentCount >= budget.periodCap) return { kind: 'period' };
			if (budget.emailSybilTripped) return { kind: 'sybil' };
			return null;
		}
	);

	// ---- Zone 1: Old ground ----
	let oldAddress = $state<ConstituentAddress | null>(null);
	// Freeze "was" representatives at mount — downstream prop mutation would
	// retroactively corrupt the diff.
	let oldRepresentatives = $state<Representative[]>([]);
	let loadingOld = $state(true);

	// Current re-grounding phase (mirrored from the inner flow).
	let phase = $state<RegroundingPhase>('capture');

	// Per-instance view-transition-name. The View Transitions API requires
	// the name to be UNIQUE across all currently-attached elements — two
	// concurrent mounts (HMR, embedded routes, double-mount in test) sharing
	// the global identifier `regrounding-prior-ground` produce undefined
	// browser behavior (Chrome aborts the transition with a console warning).
	// Generate a per-mount suffix so each instance has its own scope.
	const transitionName = `regrounding-prior-ground-${
		typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID().slice(0, 8)
			: Math.floor(Math.random() * 1e9).toString(36)
	}`;

	// ---- Mount: snapshot current ground ----
	onMount(async () => {
		if (initialRepresentatives.length > 0) {
			oldRepresentatives = [...initialRepresentatives];
		}
		try {
			const stored = await getConstituentAddress(userId);
			if (stored) oldAddress = stored;
		} catch (e) {
			console.warn('[AddressChangeFlow] Failed to load current address:', e);
		} finally {
			loadingOld = false;
		}
	});

	function handlePhaseChange(next: RegroundingPhase) {
		// Wave 4 (KG-3) — view-transition for the vertical-stack → 2-column
		// morph at `phase === 'complete'`. The browser snapshots the before-
		// state, applies the layout change, then crossfades between the two.
		// Old/new ground panes naturally morph into their grid columns.
		//
		// Graceful fallback: when the API is unavailable (Firefox, older
		// Safari) we just set `phase` directly — the class toggle still works,
		// just without the animated morph. The pre-API behavior was already
		// shipping; this is pure enhancement.
		const isMorphIntoComplete = next === 'complete' && phase !== 'complete';
		const supportsViewTransition =
			typeof document !== 'undefined' &&
			typeof (document as Document & { startViewTransition?: unknown }).startViewTransition ===
				'function';

		const apply = () => {
			phase = next;
			try {
				onPhaseChange?.(next);
			} catch (e) {
				console.warn('[AddressChangeFlow] onPhaseChange threw:', e);
			}
		};

		if (isMorphIntoComplete && supportsViewTransition) {
			// Wrap in try/catch — if the API throws (detached document,
			// sandboxed iframe, page navigating away), `apply()` would never
			// run and `phase` would stall in an outdated state, breaking the
			// witnessing close-guard logic.
			try {
				(
					document as Document & {
						startViewTransition: (cb: () => void) => { finished: Promise<void> };
					}
				).startViewTransition(apply);
			} catch (err) {
				console.warn('[AddressChangeFlow] startViewTransition threw, applying directly:', err);
				apply();
			}
		} else {
			apply();
		}
	}

	function handleInnerComplete(_detail: { district: string; method: string }) {
		// The consequential diff has been acknowledged by the user. Close.
		onClose();
	}

	function handleInnerCancel() {
		onClose();
	}
</script>

<!--
	Outer width widens at `complete` so two columns can breathe; tighter
	container during capture/witnessing keeps the single-column rhythm.
-->
<div
	class="mx-auto w-full px-4 py-6 transition-[max-width] duration-500"
	class:max-w-xl={phase !== 'complete'}
	class:max-w-3xl={phase === 'complete'}
>
	<!--
		Layout:
		- capture/witnessing: vertical stack — Zone 1 on top, inner flow below
		- complete: sm+ grid (WAS | IS). Zone 1 becomes the LEFT column; the
		  inner flow renders only the IS column on the RIGHT. The old-ground
		  pane the user has inhabited since mount continues to inhabit that
		  same position — no dismount, no structural duplication.

		Wave 4 (KG-3): the persistent Zone 1 pane carries
		`view-transition-name: regrounding-prior-ground` so when
		`document.startViewTransition` fires on capture/witnessing → complete,
		the browser identifies it as a single morphing element (not a
		crossfade) and animates its size/position from the top of the stack
		to the left grid column.
	-->
	<div class="gap-6" class:grid={phase === 'complete'} class:sm:grid-cols-2={phase === 'complete'}>
		<!-- ═══ ZONE 1: OLD GROUND (persists through every phase) ═══ -->
		<!--
			During capture + witnessing this section sits above the inner flow.
			At `complete` it occupies the left grid column, serving as the WAS
			side of the WAS/IS relation. The inner flow renders only the IS
			column to its right. Same pane, same typography, same position —
			continuity preserved at the decisive frame.
		-->
		<section
			class:mb-6={phase !== 'complete'}
			data-testid="prior-ground-pane"
			style="view-transition-name: {transitionName};"
		>
			<div class="mb-2 flex items-baseline justify-between">
				<span class="font-mono text-[10px] text-slate-500 uppercase" style="letter-spacing: 0.22em">
					{phase === 'complete' ? 'Prior ground' : 'Current ground'}
				</span>
				{#if phase === 'complete'}
					<span
						class="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] tracking-wider text-slate-500 uppercase"
					>
						Former
					</span>
				{/if}
			</div>
			<div class="border-t border-b border-dotted border-slate-300 py-4">
				{#if loadingOld}
					<div class="animate-pulse space-y-1">
						<div class="h-[15px] w-44 rounded bg-slate-200/60"></div>
						<div class="h-[15px] w-32 rounded bg-slate-200/60"></div>
					</div>
				{:else if oldAddress}
					<div class="space-y-1">
						<!--
							Retirement is color-dimmed, not struck out. A USPS form does not
							cross out your former address — it stamps it "former." Keeping the
							text legible acknowledges that this ground carried weight.
						-->
						<p class="text-[14px] font-medium text-slate-500">
							{oldAddress.street}
						</p>
						<p class="text-[14px] text-slate-500">
							{oldAddress.city}, {oldAddress.state}
							{oldAddress.zip}
						</p>
					</div>
					{#if oldAddress.district}
						<div class="mt-2 flex items-center gap-2 border-l-2 border-slate-300 pl-3">
							<span class="font-mono text-xs font-medium text-slate-500">{oldAddress.district}</span
							>
						</div>
					{/if}
				{:else}
					<p class="text-sm text-slate-500">No current address on file.</p>
				{/if}
				{#if phase === 'complete' && oldRepresentatives.length > 0}
					<ul class="mt-3 space-y-1">
						{#each oldRepresentatives as rep}
							<li class="text-sm text-slate-500">
								{rep.chamber === 'senate' ? 'Sen.' : 'Rep.'}
								{rep.name}{#if rep.party}&nbsp;<span class="text-slate-400">({rep.party})</span
									>{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</section>

		<!--
			Pre-flight refusal pane. When the budget query reports the user is
			outside their re-verification budget we render a calm explanation
			instead of mounting AddressVerificationFlow. The prior-ground pane
			above stays intact, so the user sees their current ground unchanged.
		-->
		{#if blockedReason}
			<section class="pt-2 pb-2" aria-live="polite" data-testid="reground-blocked">
				<div class="mb-5">
					<p class="font-mono text-[10px] text-amber-700 uppercase" style="letter-spacing: 0.22em">
						Re-grounding paused
					</p>
					<h2
						class="mt-1.5 text-xl leading-tight font-semibold text-slate-900"
						style="font-family: 'Satoshi', system-ui, sans-serif"
					>
						{#if blockedReason.kind === 'throttle'}
							Your ground was attested recently.
						{:else if blockedReason.kind === 'period'}
							You've reached the 180-day re-grounding limit.
						{:else}
							We need to look into this account before re-grounding.
						{/if}
					</h2>
				</div>

				<div class="border-t border-b border-dotted border-amber-300 py-4 text-sm text-slate-700">
					{#if blockedReason.kind === 'throttle'}
						<p>
							A 24-hour cooldown begins after each address change so the ground under each action
							stays stable. You can re-ground in
							{#if blockedReason.hours !== undefined}
								<span class="font-mono">~{blockedReason.hours}h</span>.
							{:else}
								about a day.
							{/if}
						</p>
						<p class="mt-2 text-xs text-slate-500">
							Verifying with a government ID (Tier 3+) lifts the cooldown for future moves.
						</p>
					{:else if blockedReason.kind === 'period'}
						<p>
							You've used all
							{#if budget}
								<span class="font-mono">{budget.periodCap}</span>
							{:else}
								six
							{/if}
							re-verifications in the trailing 180-day window. If you've genuinely moved again, contact
							support and we'll restore your budget.
						</p>
					{:else}
						<p>
							This email is associated with multiple accounts created in the same window. Contact
							support to consolidate before re-grounding.
						</p>
					{/if}
				</div>

				<div class="mt-6 border-t border-dotted border-slate-300 pt-4 text-right">
					<button
						type="button"
						class="font-mono text-sm text-slate-700 underline decoration-slate-400 decoration-1 underline-offset-4 transition-colors hover:text-slate-900 hover:decoration-slate-700"
						onclick={onClose}
					>
						Close &rarr;
					</button>
				</div>
			</section>
		{:else}
			<!-- ═══ ZONE 2–4: Delegated to AddressVerificationFlow in re-grounding mode ═══ -->
			<AddressVerificationFlow
				{userId}
				regroundingMode={true}
				{oldAddress}
				{oldRepresentatives}
				{refreshRepresentatives}
				onComplete={handleInnerComplete}
				onCancel={handleInnerCancel}
				onRegroundingPhaseChange={handlePhaseChange}
			/>
		{/if}
	</div>
</div>
