<script lang="ts">
	/**
	 * TemplateTile — one template as a dimensional instrument.
	 *
	 * The reusable card the landscape composes from: a topic-tinted surface
	 * (`--card-hue` from the template's domain), a target line (who the message
	 * reaches), title and description, the verified-send dimensions (rhythm /
	 * districts / identity-depth), and an ambient deliberation signal.
	 *
	 * Every visual channel cites a real field:
	 * - hue tint       ← `resolvedHue` (the band's hue authority, in the landscape)
	 *                    or the template's domain (`topicHue`, in the list) → `--card-hue`
	 * - target icon    ← `deriveTargetPresentation` over delivery + recipients
	 * - weight class   ← `deliveryMethod === 'cwc'` (congressional reach is heavier)
	 * - mini-Pulse     ← `daily_arrivals` (only when sends have arrived)
	 * - Ratio          ← `district_counts` (only with ≥2 districts)
	 * - Rings          ← `tier_counts` (only when a tier has weight)
	 * - deliberation   ← `hasActiveDebate`
	 *
	 * Pre-launch, with zero sends, the momentum primitives are ABSENT — never a
	 * dead `0` or flat line. They appear as the substrate fills.
	 *
	 * Narrow-tile shedding: the tile is its own size container, so the dimension
	 * row reads the TILE's width, not the viewport. When a tile is squeezed below
	 * the width three primitives can sit on (a narrow column, a small phone), the
	 * Ratio and Rings step aside and the mini-Pulse — the single most legible
	 * rhythm mark — stays. The row never wraps into a cramped overflow; it sheds.
	 *
	 * Selection, hover, keyboard navigation, and the staggered entrance are owned
	 * by the list (which knows the row's place in the whole) and threaded in as
	 * props, so the tile stays a pure instrument and the list keeps one source of
	 * truth for focus order and reveal timing.
	 */

	import { ChevronRight, Landmark, Building2, Mail, Users, MapPin } from '@lucide/svelte';
	import type { Template } from '$lib/types/template';
	import MessageMetrics from '../MessageMetrics.svelte';
	import { Pulse, Ratio, Rings } from '$lib/design';
	import { deriveTargetPresentation } from '$lib/utils/deriveTargetPresentation';
	import { topicHue } from '$lib/utils/topic-hue';
	import { FEATURES } from '$lib/config/features';

	interface Props {
		/** The template this tile renders. */
		template: Template;
		/** Whether this tile is the current selection. */
		selected?: boolean;
		/** Called with the template id when the tile is activated. */
		onSelect: (id: string) => void;
		/** Called on pointer enter (true) / leave (false) so the list can preload. */
		onHover?: (id: string, isHovering: boolean) => void;
		/** Flat index across all visible rows — for keyboard navigation order. */
		index?: number;
		/** Keydown handler owned by the list (focus management across rows). */
		onKeydown?: (event: KeyboardEvent, id: string, index: number) => void;
		/** True when this row entered after the initial batch (fade + rise on reveal). */
		newlyRevealed?: boolean;
		/** True during the skeleton → content transition window (staggered entrance). */
		justLoaded?: boolean;
		/** Per-row entrance delay in ms, applied only during the staggered entrance. */
		animationDelay?: number;
		/** Hue authority from the landscape: the band's resolved domain hue, so the
		 *  tile tint agrees with the band spine (one resolver, no clash). Absent in
		 *  the list → topicHue, keeping the list pixel-equivalent. */
		resolvedHue?: number;
		/** In the place lens, the geographic tier this tile sits in — rendered as a
		 *  small place chip so place stays visible while hue keeps encoding topic.
		 *  Absent in the topic lens and the list → no chip, tile unchanged. */
		placeLabel?: string | null;
	}

	let {
		template,
		selected = false,
		onSelect,
		onHover,
		index = 0,
		onKeydown,
		newlyRevealed = false,
		justLoaded = false,
		animationDelay = 0,
		resolvedHue,
		placeLabel = null
	}: Props = $props();

	// Congressional sends carry heavier coordination weight — the card-weight
	// class cites `deliveryMethod`, the same signal the list has always used.
	const isCongressional = $derived(template.deliveryMethod === 'cwc');

	// Domain → hue angle, consumed as --card-hue at three chroma levels. In the
	// landscape the band passes its resolved hue (one authority shared with the
	// spine); in the list the prop is absent and the tile resolves its own tint.
	const hue = $derived(resolvedHue ?? topicHue(template.domain, template.topics, template.domainHue));

	// Who the message reaches — icon + label derived from delivery + recipients.
	const targetInfo = $derived(deriveTargetPresentation(template));

	// Verified-send dimensions: present only when real sends back them.
	const arrivals = $derived(template.daily_arrivals ?? []);
	const districts = $derived(
		(template.district_counts ?? [])
			.slice()
			.sort((a, b) => b.count - a.count)
			.slice(0, 6)
	);
	const tiers = $derived((template.tier_counts ?? []).map((count, tier) => ({ tier, count })));
	const hasSends = $derived((template.send_count ?? 0) > 0);
</script>

<button
	type="button"
	data-template-button
	data-template-id={template.id}
	data-testid="template-button-{template.id}"
	class="template-card card-topic relative flex w-full items-start justify-between gap-3 rounded-md p-3 text-left transition-colors duration-200 md:p-4 {isCongressional
		? 'card-weight-heavy'
		: 'card-weight-light'}"
	class:newly-revealed={newlyRevealed}
	class:initial-reveal={justLoaded}
	class:card-selected={selected}
	style="--card-hue: {hue}; will-change: transform; backface-visibility: hidden;{justLoaded
		? ` animation-delay: ${animationDelay}ms;`
		: ''}"
	class:cursor-pointer={!selected}
	class:cursor-default={selected}
	onmouseenter={() => onHover?.(template.id, true)}
	onmouseleave={() => onHover?.(template.id, false)}
	onclick={() => onSelect(template.id)}
	onkeydown={(e) => onKeydown?.(e, template.id, index)}
>
	<div class="min-w-0 flex-1">
		{#if targetInfo.type === 'multi-level'}
			<!-- Multi-Level: Stacked jurisdiction lines -->
			<div class="mb-1.5 space-y-0.5">
				{#each targetInfo.targets as target}
					<div class="flex items-center gap-1.5">
						{#if target.emphasis === 'federal'}
							<Landmark class="h-3.5 w-3.5 shrink-0 card-icon" />
							<span class="font-brand text-xs font-medium card-label">{target.primary}</span>
						{:else}
							<Building2 class="h-3.5 w-3.5 shrink-0 card-icon" />
							<span class="font-brand text-xs font-semibold card-label">{target.primary}</span>
						{/if}
						{#if target.secondary}
							<span class="text-xs font-medium text-slate-500">{target.secondary}</span>
						{/if}
					</div>
				{/each}
			</div>
		{:else if isCongressional}
			<!-- Congressional -->
			<div class="mb-1.5 flex items-center gap-1.5">
				<Landmark class="h-3.5 w-3.5 shrink-0 card-icon" />
				<span class="font-brand text-xs font-medium card-label">{targetInfo.primary}</span>
			</div>
		{:else}
			<!-- Direct/Universal: Name-forward -->
			<div class="mb-1.5 flex items-center gap-1.5">
				{#if targetInfo.icon === 'Building'}
					<Building2 class="h-3.5 w-3.5 shrink-0 card-icon" />
				{:else if targetInfo.icon === 'Users'}
					<Users class="h-3.5 w-3.5 shrink-0 card-icon-muted" />
				{:else}
					<Mail class="h-3.5 w-3.5 shrink-0 card-icon-muted" />
				{/if}
				<span class="font-brand text-sm font-bold card-label">{targetInfo.primary}</span>
				{#if targetInfo.secondary}
					<span class="text-xs font-medium text-slate-500">{targetInfo.secondary}</span>
				{/if}
			</div>
		{/if}

		<h3 class="truncate font-medium text-gray-900">
			{template.title}
		</h3>

		{#if placeLabel}
			<!-- Place chip: the geographic tier this tile sits in, shown only in the
			     place lens so the organising dimension stays visible on the tile
			     while hue keeps carrying topic. A quiet mark, not a pill. -->
			<div class="place-chip">
				<MapPin class="h-3 w-3 shrink-0" aria-hidden="true" />
				<span class="font-brand">{placeLabel}</span>
			</div>
		{/if}

		<p class="mb-2 line-clamp-2 text-xs text-gray-600 md:mb-3 md:text-sm">
			{template.description}
		</p>

		<MessageMetrics {template} />

		{#if hasSends}
			<dl class="template-dimensions" aria-hidden="true">
				{#if arrivals.length > 0}
					<!-- Rhythm: the mini-Pulse. The mark that stays when the tile narrows. -->
					<div class="template-dimension template-dimension--rhythm">
						<Pulse values={arrivals} width={64} height={14} color="oklch(0.45 0.02 250)" />
					</div>
				{/if}
				{#if districts.length >= 2}
					<!-- Districts: sheds first on a narrow tile (the mini-Pulse carries on). -->
					<div class="template-dimension template-dimension--districts">
						<Ratio
							height={4}
							segments={districts.map((d) => ({
								value: d.count,
								color: 'var(--coord-route-solid, #3bc4b8)',
								label: d.code
							}))}
						/>
					</div>
				{/if}
				{#if tiers.some((t) => t.count > 0)}
					<!-- Identity depth: sheds with the districts on a narrow tile. -->
					<div class="template-dimension template-dimension--depth">
						<Rings {tiers} maxTier={5} size={16} />
					</div>
				{/if}
			</dl>
		{/if}

		{#if FEATURES.DEBATE && template.hasActiveDebate}
			<div class="mt-1 flex items-center gap-2 text-sm">
				<span class="debate-pulse h-2 w-2 shrink-0 rounded-full bg-amber-500"></span>
				<span class="font-brand text-amber-600">Deliberating</span>
			</div>
		{/if}

		{#if template.domain}
			<span class="topic-ground">{template.domain}</span>
		{/if}
	</div>

	<!-- Mobile indicator -->
	<div class="shrink-0 text-slate-400 md:hidden">
		<ChevronRight class="h-5 w-5" />
	</div>
</button>

<style>
	/*
	 * Topic Ground — anchoring context at the card's base.
	 *
	 * Sits below metrics, flush to the card's bottom edge.
	 * Reads as provenance — like a postmark or a colophon.
	 * The eye catches it at the end of a downward scan,
	 * confirming domain after the content has spoken.
	 *
	 * Normal case, 500 weight, neutral — editorial, not decorative.
	 */
	.topic-ground {
		display: block;
		font-size: 0.6875rem;
		color: oklch(0.58 0.04 var(--card-hue));
		font-weight: 400;
		letter-spacing: 0.01em;
		line-height: 1.3;
		margin-top: 0.375rem;
	}

	/*
	 * Place chip — the geographic tier a tile belongs to in the place lens.
	 * Sits just under the title as a quiet mark (icon + words), not a boxed
	 * badge. Neutral ink so it reads as provenance, leaving the hue to topic.
	 */
	.place-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin: 0.125rem 0 0.125rem;
		font-size: 0.6875rem;
		font-weight: 500;
		color: oklch(0.5 0.02 250);
	}

	/* Newly revealed templates fade in with a small upward motion (8px). */
	.template-card.newly-revealed {
		animation: reveal 200ms ease-out forwards;
	}

	/* Staggered entrance when skeleton → content transition completes */
	.template-card.initial-reveal {
		opacity: 0;
		animation: initial-reveal 250ms ease-out forwards;
	}

	@keyframes initial-reveal {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes reveal {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/*
	 * The tile is its own size container: the dimension row below reads the
	 * TILE's width, not the viewport, so primitive shedding tracks how wide the
	 * card actually sits — a narrow desktop column and a small phone shed the
	 * same way. `inline-size` constrains only the inline axis, so the card's
	 * height stays content-driven.
	 */
	.template-card {
		container-type: inline-size;
		container-name: tile;
	}

	/* Per-template dimensional row — citation-scale Pulse / Ratio / Rings
	   citing the substrate (rhythm / districts / identity-depth) of this
	   template's verified sends. K-anon floor (<5) applied at render time so
	   thin cohorts cannot be re-identified from the row. */
	.template-dimensions {
		margin: 0.5rem 0 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}

	.template-dimension {
		display: flex;
		align-items: center;
		margin: 0;
	}

	/*
	 * Narrow-tile shedding. Three primitives need room to read as distinct
	 * marks; below the width they can share, the row would cramp and overflow.
	 * So when the tile narrows past that point, the Ratio (districts) and Rings
	 * (identity depth) step aside and the mini-Pulse (rhythm) — the single most
	 * legible verified-send mark — stays. The row sheds rather than wraps into a
	 * squeeze. The threshold is read off the TILE container (not the viewport),
	 * so it holds in a narrow desktop column exactly as on a small phone.
	 */
	@container tile (max-width: 252px) {
		.template-dimension--districts,
		.template-dimension--depth {
			display: none;
		}
	}

	/* Debate Deliberation Indicator (Ambient Status Signal) */
	.debate-pulse {
		animation: debate-pulse 1.4s ease-in-out infinite;
	}

	@keyframes debate-pulse {
		0%,
		100% {
			opacity: 0.5;
		}
		50% {
			opacity: 1;
		}
	}

	/* Respect vestibular preferences */
	@media (prefers-reduced-motion: reduce) {
		.template-card.newly-revealed,
		.template-card.initial-reveal {
			animation: none;
			opacity: 1;
		}

		.debate-pulse {
			animation: none;
		}
	}
</style>
