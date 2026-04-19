<script lang="ts">
	import { Users, MessageSquare, Clock, Coins, Activity } from '@lucide/svelte';
	import {
		computeLMSRPercentages,
		getLeadingStance,
		type ArgumentStanceMap
	} from '$lib/utils/debate-stats';

	interface Props {
		debateId: string;
		propositionText: string;
		status: 'active' | 'resolved';
		argumentCount: number;
		totalStake: string;
		uniqueParticipants: number;
		deadline: string;
		prices?: Record<number, string>;
		argumentStances?: ArgumentStanceMap;
		stanceCounts?: { support: number; oppose: number; amend: number };
		currentEpoch?: number;
		epochPhase?: 'commit' | 'reveal' | 'executing' | 'idle';
		href?: string;
	}

	let {
		debateId,
		propositionText,
		status,
		argumentCount,
		totalStake,
		uniqueParticipants,
		deadline,
		prices,
		argumentStances,
		stanceCounts,
		currentEpoch,
		epochPhase,
		href
	}: Props = $props();

	// ---------------------------------------------------------------------------
	// Derived values
	// ---------------------------------------------------------------------------

	const snippet = $derived(
		propositionText.length > 120 ? propositionText.slice(0, 120).trimEnd() + '...' : propositionText
	);

	/** Format total stake from USDC smallest-unit BigInt string to human-readable dollars. */
	const formattedStake = $derived.by(() => {
		const raw = Number(totalStake) / 1e6;
		if (raw >= 1000) return '$' + (raw / 1000).toFixed(1) + 'k';
		return '$' + raw.toFixed(2);
	});

	/** Time remaining relative to deadline. */
	const timeRemaining = $derived.by(() => {
		const now = Date.now();
		const end = new Date(deadline).getTime();
		const diff = end - now;
		if (diff <= 0) return 'Ended';
		const days = Math.floor(diff / 86_400_000);
		const hours = Math.floor((diff % 86_400_000) / 3_600_000);
		if (days > 0) return `${days}d ${hours}h`;
		const minutes = Math.floor((diff % 3_600_000) / 60_000);
		return `${hours}h ${minutes}m`;
	});

	// ---------------------------------------------------------------------------
	// Mini price bar — stance-weighted proportions
	// ---------------------------------------------------------------------------

	// ── LMSR stance-grouped price bar ───────────────────────────────────────
	// When prices AND argumentStances are provided, group by stance for a
	// three-segment bar reflecting aggregate market belief per stance.
	const lmsrPcts = $derived.by(() => {
		if (!prices || !argumentStances) return null;
		if (Object.keys(prices).length === 0) return null;
		return computeLMSRPercentages(prices, argumentStances);
	});
	const leadingStance = $derived(lmsrPcts ? getLeadingStance(lmsrPcts) : null);

	// Fallback: raw proportional bar (no stance grouping)
	const priceBarSegments = $derived.by(() => {
		if (lmsrPcts) return null; // stance-grouped bar takes precedence
		if (!prices) return null;
		const entries = Object.values(prices).map(Number);
		if (entries.length === 0) return null;
		const total = entries.reduce((s, p) => s + p, 0);
		if (total === 0) return null;
		return {
			total,
			segments: entries.map((p) => (p / total) * 100)
		};
	});

	// Epoch phase label
	const epochLabel = $derived.by(() => {
		if (currentEpoch == null || !epochPhase || epochPhase === 'idle') return null;
		const phaseLabels: Record<string, string> = {
			commit: 'commit phase',
			reveal: 'reveal phase',
			executing: 'executing'
		};
		return `Epoch ${currentEpoch} · ${phaseLabels[epochPhase] ?? epochPhase}`;
	});

	// Stance dot colors (for the optional stance summary row)
	const STANCE_DOT: Record<string, string> = {
		support: 'bg-indigo-500',
		oppose: 'bg-red-500',
		amend: 'bg-amber-500'
	};
</script>

<!--
  Wrapper: if `href` is provided the card acts as a link.
  We use an <a> or a <div> accordingly to keep semantics correct.
-->
{#if href}
	<a
		{href}
		class="group block rounded-md border border-slate-200 bg-white p-4
      transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2
      focus-visible:ring-indigo-300"
		data-debate-id={debateId}
	>
		{@render cardContent()}
	</a>
{:else}
	<div class="rounded-md border border-slate-200 bg-white p-4" data-debate-id={debateId}>
		{@render cardContent()}
	</div>
{/if}

<!-- ====================================================================== -->
<!-- Card content snippet (shared between link and static variants)          -->
<!-- ====================================================================== -->
{#snippet cardContent()}
	<!-- Status badge -------------------------------------------------------- -->
	<div class="mb-2 flex items-start justify-between gap-3">
		<p class="text-sm font-medium leading-snug text-slate-800">
			{snippet}
		</p>

		<span
			class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium
        {status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}"
		>
			<span
				class="inline-block h-1.5 w-1.5 rounded-full
          {status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'}"
			></span>
			{status === 'active' ? 'Active' : 'Resolved'}
		</span>
	</div>

	<!-- Mini price bar ------------------------------------------------------ -->
	{#if lmsrPcts}
		<!-- Stance-grouped bar (LMSR market active with argument stance data) -->
		<div class="mb-3 flex h-1 w-full overflow-hidden rounded-full bg-slate-100">
			{#if lmsrPcts.supportPct > 0}
				<div
					class="h-full bg-indigo-500 transition-all duration-300"
					style="width: {lmsrPcts.supportPct}%"
				></div>
			{/if}
			{#if lmsrPcts.opposePct > 0}
				<div
					class="h-full bg-red-400 transition-all duration-300"
					style="width: {lmsrPcts.opposePct}%"
				></div>
			{/if}
			{#if lmsrPcts.amendPct > 0}
				<div
					class="h-full bg-amber-400 transition-all duration-300"
					style="width: {lmsrPcts.amendPct}%"
				></div>
			{/if}
		</div>
	{:else if priceBarSegments}
		<!-- Raw proportional bar (no stance mapping available) -->
		<div class="mb-3 flex h-1 w-full overflow-hidden rounded-full bg-slate-100">
			{#each priceBarSegments!.segments as pct, i}
				<div
					class="h-full transition-all duration-300
            {i % 3 === 0 ? 'bg-indigo-500' : i % 3 === 1 ? 'bg-red-400' : 'bg-amber-400'}"
					style="width: {pct}%"
				></div>
			{/each}
		</div>
	{:else}
		<div class="mb-3 h-1 w-full rounded-full bg-slate-100"></div>
	{/if}

	<!-- Leading stance + epoch (when market is active) ---------------------- -->
	{#if leadingStance || epochLabel}
		<div class="mb-2 flex items-center gap-3 text-xs text-slate-600">
			{#if leadingStance}
				<span class="font-semibold">{leadingStance.label} {leadingStance.pct}%</span>
			{/if}
			{#if epochLabel}
				<span class="inline-flex items-center gap-1 text-slate-400">
					<Activity class="h-3 w-3" />
					{epochLabel}
				</span>
			{/if}
		</div>
	{/if}

	<!-- Stats row ----------------------------------------------------------- -->
	<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
		<span class="inline-flex items-center gap-1">
			<Users class="h-3.5 w-3.5 text-slate-400" />
			<span class="font-mono">{uniqueParticipants}</span>
		</span>

		<span class="inline-flex items-center gap-1">
			<Coins class="h-3.5 w-3.5 text-slate-400" />
			<span class="font-mono">{formattedStake}</span>
		</span>

		<span class="inline-flex items-center gap-1">
			<Clock class="h-3.5 w-3.5 text-slate-400" />
			<span class="font-mono">{timeRemaining}</span>
		</span>

		<span class="inline-flex items-center gap-1">
			<MessageSquare class="h-3.5 w-3.5 text-slate-400" />
			<span class="font-mono">{argumentCount}</span>
		</span>
	</div>

	<!-- Stance summary (optional) ------------------------------------------ -->
	{#if stanceCounts}
		<div class="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
			{#each Object.entries(stanceCounts) as [stance, count]}
				<span class="inline-flex items-center gap-1">
					<span class="inline-block h-2 w-2 rounded-full {STANCE_DOT[stance]}"></span>
					<span class="font-mono">{count}</span>
				</span>
			{/each}
		</div>
	{/if}
{/snippet}
