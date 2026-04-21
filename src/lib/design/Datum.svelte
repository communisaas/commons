<!--
  Datum — A verifiable numeric claim.

  Renders in JetBrains Mono with tabular-nums. Always.
  The font itself is a truth claim: "this number could be audited."

  Optionally spring-animates when the value changes, using
  canonical springs from the motion system.

  When `cite` is provided, auto-wraps in a Cite whisper — the
  number confides its provenance on hover. For other citation
  forms (mark, footnote, ghost), wrap in an explicit Cite.

  Usage:
    <Datum value={248} />                                  — static
    <Datum value={248} animate />                           — spring (COUNT_TICK)
    <Datum value={248} animate spring={SPRINGS.METRIC} />   — custom spring
    <Datum value={248} cite="gov ID + address" />           — whispers provenance
    <Datum value={0.94} decimals={2} />                     — score
    <Datum value={null} />                                  — renders em-dash

  Size, weight, and color come from the parent via `class`.
  Datum owns the register (mono + tabular-nums), the animation, and
  optionally the citation.
-->
<script lang="ts">
	import { spring as svelteSpring, type SpringOptions } from 'svelte/motion';
	import { SPRINGS } from './motion';
	import Cite from './Cite.svelte';

	let {
		value,
		animate = false,
		spring: springConfig = SPRINGS.COUNT_TICK,
		decimals,
		cite = undefined,
		class: className = ''
	}: {
		/** The number to display. null renders as em-dash. */
		value: number | null;
		/** Spring-animate value changes. Respects prefers-reduced-motion. */
		animate?: boolean;
		/** Spring config object. Import SPRINGS from '$lib/design/motion'. Default: SPRINGS.COUNT_TICK */
		spring?: SpringOptions;
		/** Fixed decimal places. Omit for integer with locale formatting. */
		decimals?: number;
		/** String provenance. When set, wraps in Cite whisper. */
		cite?: string;
		/** Additional CSS classes (size, weight, color from parent) */
		class?: string;
	} = $props();

	const prefersReducedMotion =
		typeof window !== 'undefined'
			? window.matchMedia('(prefers-reduced-motion: reduce)').matches
			: false;

	const shouldAnimate = $derived(animate && !prefersReducedMotion);

	// svelte-ignore state_referenced_locally — spring config is static per instance
	const display = svelteSpring(0, springConfig);

	$effect(() => {
		if (value === null) return;
		if (shouldAnimate) {
			display.set(value);
		} else {
			display.set(value, { hard: true });
		}
	});

	function format(n: number): string {
		if (decimals !== undefined) {
			return n.toFixed(decimals);
		}
		return Math.round(n).toLocaleString('en-US');
	}
</script>

{#if cite}
	<Cite cite={cite}>
		{#if value === null}<span class="font-mono tabular-nums {className}">&mdash;</span>{:else}<span
			class="font-mono tabular-nums {className}">{format($display)}</span>{/if}
	</Cite>
{:else if value === null}<span class="font-mono tabular-nums {className}">&mdash;</span>{:else}<span
		class="font-mono tabular-nums {className}">{format($display)}</span
	>{/if}
