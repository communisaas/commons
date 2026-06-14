<script lang="ts">
	/**
	 * LensToggle — choose how the field is organised.
	 *
	 * Two ways to read the same templates: by TOPIC (hue-ordered domain bands)
	 * or by PLACE (geographic precision tiers). The toggle switches the
	 * organiser; the other dimension stays a secondary encoding — hue is always
	 * the domain, so colour never goes away, and the place tier shows on each
	 * tile in the place lens.
	 *
	 * Plain-English labels, no jargon. A small segmented control composed from
	 * the system's register (Satoshi, the warm ground, the three semantic hues),
	 * not a pill or a foreign switch. The selected segment carries `aria-pressed`
	 * so assistive tech reads the current lens.
	 */

	import { TIMING, EASING } from '$lib/design';

	export type Lens = 'topic' | 'place';

	interface Props {
		/** The currently active lens. */
		lens: Lens;
		/** Called with the chosen lens when a segment is activated. */
		onChange: (lens: Lens) => void;
	}

	let { lens, onChange }: Props = $props();
</script>

<div
	class="lens-toggle"
	role="group"
	aria-label="Organize templates"
	style="--timing-fast: {TIMING.FAST}ms; --easing: {EASING};"
>
	<span class="lens-toggle__label font-brand">Organize by</span>
	<div class="lens-toggle__group">
		<button
			type="button"
			class="lens-toggle__btn font-brand"
			class:is-active={lens === 'topic'}
			aria-pressed={lens === 'topic'}
			data-lens="topic"
			onclick={() => onChange('topic')}
		>
			topic
		</button>
		<button
			type="button"
			class="lens-toggle__btn font-brand"
			class:is-active={lens === 'place'}
			aria-pressed={lens === 'place'}
			data-lens="place"
			onclick={() => onChange('place')}
		>
			place
		</button>
	</div>
</div>

<style>
	/*
	 * The control sits as a quiet line above the field — a label and a pair of
	 * word-buttons, not a boxed widget. No background card, no border around the
	 * whole thing; only the active word is marked.
	 */
	.lens-toggle {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.lens-toggle__label {
		font-size: 0.8125rem;
		color: oklch(0.5 0.02 250);
	}

	.lens-toggle__group {
		display: inline-flex;
		align-items: baseline;
		gap: 0.125rem;
	}

	/*
	 * Each lens is a word the eye can read at a glance. The inactive word is
	 * quiet; the active word carries weight and a teal underline — the same
	 * coordination hue the rest of the surface uses for "this is live."
	 */
	.lens-toggle__btn {
		appearance: none;
		background: none;
		border: none;
		padding: 0.125rem 0.25rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: oklch(0.5 0.02 250);
		cursor: pointer;
		border-bottom: 2px solid transparent;
		transition:
			color var(--timing-fast, 150ms) var(--easing, ease-out),
			border-color var(--timing-fast, 150ms) var(--easing, ease-out);
	}

	.lens-toggle__btn:hover {
		color: oklch(0.4 0.04 250);
	}

	.lens-toggle__btn.is-active {
		color: oklch(0.42 0.06 195);
		font-weight: 700;
		border-bottom-color: oklch(0.62 0.12 195);
	}

	.lens-toggle__btn:focus-visible {
		outline: 2px solid oklch(0.62 0.12 195);
		outline-offset: 2px;
		border-radius: 2px;
	}
</style>
