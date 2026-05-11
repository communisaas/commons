<!--
  RegistryMark — A cryptographic substrate fact, exposed as a marginal mark.

  Per CONSTITUTION.md §2.3: "Hashes, nullifiers, Merkle roots, signatures, and
  version anchors appear in margins and footers as marks of the substrate, not
  behind copy." This component is the typographic + semantic wrapper for those
  facts. JetBrains Mono with tabular-nums, full value by default, optional
  middle-elision (8…4) for tight surfaces, optional click-to-copy, optional
  href to a verifier.

  No card chrome. No padding, no border, no background. Size, weight, and
  color come from the parent via `class` — same idiom as Datum.

  Usage:
    <RegistryMark variant="sha256" value={hash} />
                                                      — full hash with sha256: prefix, click-to-copy
    <RegistryMark variant="commit" value={sha} truncate />
                                                      — git commit, middle-elided
    <RegistryMark variant="version" value="1.0.0" copy={false} />
                                                      — @v1.0.0 plain span (no copy affordance)
    <RegistryMark variant="merkle-root" value={root} href="/registry/roots/{root}" />
                                                      — link to verifier
    <RegistryMark variant="nullifier" value={n} cite="Poseidon2 over (action, secret)" />
                                                      — wraps in Cite whisper

  Aria-label decode (per variant):
    sha256       → "sha256 hash"
    keccak256    → "keccak256 hash"
    nullifier    → "nullifier"
    merkle-root  → "Merkle root"
    signature    → "cryptographic signature"
    transaction  → "transaction hash"
    version      → "version anchor"
    commit       → "git commit"
    block        → "block height"
    tag          → "registry tag"

  When copy=true, ", click to copy" is appended to the aria-label. When the
  display is truncated, the FULL value is included in the aria-label so screen
  readers don't lose the verifiable claim.

  RegistryMark is for non-numeric verifiable claims. For numeric counts use
  Datum. They share the typographic register (mono + tabular-nums) but serve
  different semantics.
-->
<script lang="ts">
	import { fade } from 'svelte/transition';
	import Cite from './Cite.svelte';

	type RegistryMarkVariant =
		| 'sha256'
		| 'keccak256'
		| 'nullifier'
		| 'merkle-root'
		| 'signature'
		| 'transaction'
		| 'version'
		| 'commit'
		| 'block'
		| 'tag';

	let {
		variant,
		value,
		truncate = false,
		cite = undefined,
		href = undefined,
		copy = true,
		class: className = ''
	}: {
		/** Substrate kind. Drives prefix and screen-reader decoding. */
		variant: RegistryMarkVariant;
		/** Full verifiable claim string (e.g., 64-char sha256 hex). */
		value: string;
		/** Middle-elide long values (first 8 + ellipsis + last 4). Default false. */
		truncate?: boolean;
		/** String provenance. When set, wraps in Cite whisper. */
		cite?: string;
		/** Verifier URL. When set, renders as <a rel="external nofollow">. */
		href?: string;
		/** Click-to-copy the full value. Default true. Ignored when href is set. */
		copy?: boolean;
		/** Additional CSS classes (size, weight, color from parent) */
		class?: string;
	} = $props();

	// ─── Per-variant prefix + screen-reader decode ────────────
	const PREFIX = {
		sha256: 'sha256:',
		keccak256: 'keccak256:',
		nullifier: 'nullifier:',
		'merkle-root': 'root:',
		signature: 'sig:',
		transaction: 'tx ',
		version: '@v',
		commit: 'sha ',
		block: 'block ',
		tag: ''
	} as const;

	const DECODE = {
		sha256: 'sha256 hash',
		keccak256: 'keccak256 hash',
		nullifier: 'nullifier',
		'merkle-root': 'Merkle root',
		signature: 'cryptographic signature',
		transaction: 'transaction hash',
		version: 'version anchor',
		commit: 'git commit',
		block: 'block height',
		tag: 'registry tag'
	} as const;

	const prefix = $derived(PREFIX[variant]);
	const decode = $derived(DECODE[variant]);

	// ─── Truncation: middle-elide first-8 / ellipsis / last-4 ─
	// Hashes < 12 chars are not truncated; the elision would show more
	// glyphs than the value itself. The full value is always preserved
	// for clipboard and aria-label.
	const displayValue = $derived(
		truncate && value.length >= 12
			? `${value.slice(0, 8)}…${value.slice(-4)}`
			: value
	);

	// ─── Aria-label assembly ──────────────────────────────────
	// Full value is always announced (even when display is truncated) so
	// the verifiable claim survives screen-reader access. The ", click to
	// copy" affix appears only on copy-enabled marks.
	const ariaLabel = $derived(
		[
			`${decode}, full value ${value}`,
			copy && !href ? 'click to copy' : null
		]
			.filter(Boolean)
			.join(', ')
	);

	// ─── Click-to-copy state ──────────────────────────────────
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	const prefersReducedMotion =
		typeof window !== 'undefined'
			? window.matchMedia('(prefers-reduced-motion: reduce)').matches
			: false;

	async function handleCopy() {
		// Always copy the FULL value, never the truncated display form.
		try {
			if (
				typeof navigator !== 'undefined' &&
				navigator.clipboard &&
				typeof window !== 'undefined' &&
				window.isSecureContext
			) {
				await navigator.clipboard.writeText(value);
			} else if (typeof document !== 'undefined') {
				// Fallback for non-secure contexts and older browsers.
				const textArea = document.createElement('textarea');
				textArea.value = value;
				textArea.style.position = 'fixed';
				textArea.style.left = '-999999px';
				textArea.style.top = '-999999px';
				document.body.appendChild(textArea);
				textArea.focus();
				textArea.select();
				document.execCommand('copy');
				textArea.remove();
			}

			copied = true;

			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => {
				copied = false;
			}, 1500);
		} catch {
			// Clipboard API failures should not surface as errors — the user
			// can always select the visible text manually. Silently swallow.
		}
	}

	// ─── Element-shape decision ───────────────────────────────
	// href wins over copy: a link's intrinsic action is navigation. If
	// only copy is enabled, render as a button so the click semantics are
	// honest. If neither, render as a plain span — the substrate is
	// visible but not interactive.
	const elementKind = $derived<'a' | 'button' | 'span'>(
		href ? 'a' : copy ? 'button' : 'span'
	);

	// Transition duration — respects prefers-reduced-motion.
	const fadeDuration = $derived(prefersReducedMotion ? 0 : 150);
</script>

{#snippet markBody()}
	{#if elementKind === 'a'}
		<a
			class="font-mono tabular-nums {className}"
			{href}
			rel="external nofollow"
			data-mark-variant={variant}
			aria-label={ariaLabel}
		>{#if prefix}<span class="rm-prefix">{prefix}</span>{/if}{displayValue}</a>
	{:else if elementKind === 'button'}
		<button
			type="button"
			class="rm-button font-mono tabular-nums {className}"
			data-mark-variant={variant}
			aria-label={ariaLabel}
			onclick={handleCopy}
		>{#if prefix}<span class="rm-prefix">{prefix}</span>{/if}{displayValue}</button>
		{#if copied}
			<span
				class="rm-copied"
				role="status"
				aria-live="polite"
				transition:fade={{ duration: fadeDuration }}
			>copied</span>
		{/if}
	{:else}
		<span
			class="font-mono tabular-nums {className}"
			data-mark-variant={variant}
			aria-label={ariaLabel}
		>{#if prefix}<span class="rm-prefix">{prefix}</span>{/if}{displayValue}</span>
	{/if}
{/snippet}

{#if cite}
	<Cite cite={cite}>
		{@render markBody()}
	</Cite>
{:else}
	{@render markBody()}
{/if}

<style>
	/*
	 * RegistryMark is a typographic wrapper, not a chromed element. The
	 * default register matches inline <code> on the public-record route:
	 * mono + tabular-nums, color + size from the parent. The button form
	 * strips all native button affordances (no border, no padding, no
	 * background) so it looks identical to a span unless interacted with.
	 */

	.rm-prefix {
		/* The prefix is subordinate substrate metadata; tone it back so the
		   value itself reads as the load-bearing claim. Inherited color via
		   color-mix keeps the register coherent with parent text color. */
		opacity: 0.6;
	}

	.rm-button {
		/* Strip button chrome — the visual register is identical to a span
		   in the default state. Cursor changes to communicate affordance. */
		appearance: none;
		background: transparent;
		border: 0;
		padding: 0;
		margin: 0;
		font: inherit;
		color: inherit;
		text-align: inherit;
		cursor: pointer;
		/* Allow clipboard selection via long-press on touch and keep the
		   element inline with surrounding text. */
		display: inline;
		line-height: inherit;
	}

	.rm-button:focus-visible {
		outline: none;
		border-radius: 2px;
		box-shadow: 0 0 0 2px oklch(0.65 0.14 175 / 0.3);
	}

	.rm-copied {
		display: inline-block;
		margin-left: 0.5em;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem; /* 11px — subordinate */
		line-height: 1;
		color: var(--coord-verified-solid, #10b981);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		vertical-align: baseline;
	}

	a[data-mark-variant] {
		/* The anchor is a registry mark, not a content link. Underline only
		   on hover/focus so the substrate doesn't compete with prose links
		   in the same flow. */
		color: inherit;
		text-decoration: none;
	}

	a[data-mark-variant]:hover,
	a[data-mark-variant]:focus-visible {
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 2px;
	}

	a[data-mark-variant]:focus-visible {
		outline: none;
		border-radius: 2px;
		box-shadow: 0 0 0 2px oklch(0.65 0.14 175 / 0.3);
	}
</style>
