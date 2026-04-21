<script lang="ts">
	/**
	 * Rings — Depth/strength at citation scale.
	 *
	 * Concentric arcs that show HOW DEEP verification goes.
	 * Not a badge. Not a meter. A glyph of accumulated trust.
	 *
	 * 5 tiers → 5 potential rings. Filled rings = earned.
	 * Color deepens with depth. At 14-16px, this is a
	 * citation-scale summary of the TrustTierIndicator.
	 *
	 * Lives inside Cite provenance, or inline next to
	 * any count that has a tier distribution behind it.
	 */

	interface TierWeight {
		/** Tier level (0-5) */
		tier: number;
		/** Count at this tier */
		count: number;
	}

	let {
		tiers,
		maxTier = 5,
		size = 14,
		class: className = ''
	}: {
		/** Tier distribution. Only tiers with count > 0 fill. */
		tiers: TierWeight[];
		/** Maximum possible tier (determines ring count). Default 5. */
		maxTier?: number;
		/** Diameter in px. Default 14 — citation scale. */
		size?: number;
		/** Additional CSS classes */
		class?: string;
	} = $props();

	const center = $derived(size / 2);
	const strokeWidth = $derived(Math.max(1, size / 8));
	const ringGap = $derived((size / 2 - strokeWidth) / (maxTier + 0.5));

	// Tier colors — deepening with tier level (oklch hue shift)
	const TIER_COLORS = [
		'oklch(0.7 0.02 55)',      // T0: muted neutral
		'oklch(0.65 0.08 55)',     // T1: warm
		'oklch(0.6 0.12 200)',     // T2: blue
		'oklch(0.6 0.14 175)',     // T3: teal
		'oklch(0.55 0.16 165)',    // T4: deep teal
		'oklch(0.65 0.15 85)'     // T5: gold
	];

	const tierMap = $derived(
		new Map(tiers.map((t) => [t.tier, t.count]))
	);

	const ariaLabel = $derived(
		`Depth: ${tiers.filter((t) => t.count > 0).length} of ${maxTier} tiers active`
	);
</script>

<svg
	class="rings {className}"
	width={size}
	height={size}
	viewBox="0 0 {size} {size}"
	role="img"
	aria-label={ariaLabel}
>
	{#each Array(maxTier) as _, i}
		{@const tier = i + 1}
		{@const radius = ringGap * (tier + 0.5)}
		{@const count = tierMap.get(tier) ?? 0}
		{@const active = count > 0}
		<circle
			cx={center}
			cy={center}
			r={radius}
			fill="none"
			stroke={active ? TIER_COLORS[Math.min(tier, TIER_COLORS.length - 1)] : 'oklch(0.9 0.005 55)'}
			stroke-width={strokeWidth}
			opacity={active ? 0.85 : 0.25}
		/>
	{/each}
</svg>

<style>
	.rings {
		display: inline-block;
		vertical-align: middle;
	}
</style>
