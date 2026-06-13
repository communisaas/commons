<!--
  MantleWatermark — verification as ambient signal-weight, never headline.

  The watermark is small and subordinate by design: it is the WATERMARK on
  the org's work, not the headline. It reads as a faint coordination signal
  beneath the strong Compose center.

  Three design primitives, fed ONLY from verified-live layout data
  (getDashboardStats → tiers + growth, see +layout.server.ts):

    Rings  — engagement-tier distribution (depth, HOW COMMITTED). maxTier 4
             because engagement tiers run 0–4 (new → pillar).
    Datum  — "actions authored & sent this period" — verified actions in the
             trailing week. JetBrains Mono (auditable count). No provenance
             whisper here: provenance belongs on the decision-maker packet and
             /v/[hash], not the org's own dashboard. Spring SIGNAL: accumulated
             state growing into view, not an event tick.
    Pulse  — last-week → this-week rhythm. The temporal cadence felt as shape.

  No hardcoded zeros: when no stats are loaded the watermark renders an
  honest dormant state (em-dash Datum, no fabricated rhythm).
-->
<script lang="ts">
	import { Datum, Rings, Pulse, SPRINGS, COORD_COLORS } from '$lib/design';

	export interface WatermarkTier {
		tier: number;
		count: number;
	}

	let {
		thisWeek,
		lastWeek,
		tiers
	}: {
		/** Verified actions in the trailing 7 days. Verified-live. null = dormant. */
		thisWeek: number | null;
		/** Verified actions in the prior 7-day window. Verified-live. */
		lastWeek: number | null;
		/** Engagement-tier distribution (tiers 0–4). Verified-live. */
		tiers: WatermarkTier[];
	} = $props();

	// Only tiers with real counts fill rings; below-threshold tiers stay dormant.
	const ringTiers = $derived(tiers.filter((t) => t.count > 0));

	// Temporal rhythm — two real bins (prior, current). No synthetic interior
	// points. If either is unknown we suppress the pulse rather than invent it.
	const haveRhythm = $derived(thisWeek !== null && lastWeek !== null);
	const rhythm = $derived(haveRhythm ? [lastWeek ?? 0, thisWeek ?? 0] : []);
</script>

<div class="watermark" aria-label="Verification signal — actions authored and sent this period">
	<span class="watermark-rings" aria-hidden={ringTiers.length === 0}>
		<Rings tiers={ringTiers} maxTier={4} size={16} />
	</span>

	<span class="watermark-figure">
		<Datum
			value={thisWeek}
			animate
			spring={SPRINGS.SIGNAL}
			class="watermark-count"
		/>
		<span class="watermark-label">authored &amp; sent this period</span>
	</span>

	{#if haveRhythm}
		<span class="watermark-pulse" aria-hidden="true">
			<Pulse values={rhythm} width={48} height={12} color={COORD_COLORS.ROUTE.solid} />
		</span>
	{/if}
</div>

<style>
	.watermark {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		/* Subordinate — this is the watermark, not the headline. */
		opacity: 0.7;
	}

	.watermark-rings {
		flex-shrink: 0;
		line-height: 0;
	}

	.watermark-figure {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		min-width: 0;
	}

	/* Datum owns the register (mono + tabular-nums); we set only size/color. */
	.watermark :global(.watermark-count) {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--org-sidebar-text);
		line-height: 1.1;
	}

	.watermark-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.625rem;
		line-height: 1.15;
		color: var(--org-sidebar-text-dim);
	}

	.watermark-pulse {
		flex-shrink: 0;
		line-height: 0;
		margin-left: auto;
	}
</style>
