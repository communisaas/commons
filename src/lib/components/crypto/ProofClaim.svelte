<script lang="ts">
	/**
	 * ProofClaim — a single cryptographic claim at variable disclosure depth.
	 *
	 * One primitive, three audiences:
	 *   depth 1 → staffer: just the claim + a verification indicator
	 *   depth 2 → org: claim + private/public columns (what's hidden, what's checkable)
	 *   depth 3 → developer: adds receipt artifact identifiers (root hashes, nullifier)
	 *
	 * Visual grammar:
	 *   dashed border = private witness (never leaves the user)
	 *   solid border  = public receipt (anyone can verify)
	 *
	 * Colors encode claim type (design system semantics):
	 *   identity  → emerald (verified)
	 *   location  → teal    (routed)
	 *   uniqueness → indigo (spread)
	 */

	import { Datum } from '$lib/design';

	type ClaimType = 'identity' | 'location' | 'uniqueness';

	interface Props {
		/** Claim type — drives color + accent */
		type: ClaimType;
		/** Plain-language claim as a direct assertion, e.g., "I'm a real person" */
		claim: string;
		/** Subhead that contextualizes the claim, e.g., "Without revealing who you are" */
		subhead?: string;
		/** Private witnesses (what stays with the user) */
		privateParts?: string[];
		/** Public receipts (what anyone can verify) */
		publicParts?: string[];
		/** Receipt identifier label, e.g., "user_root" */
		receiptLabel?: string;
		/** Receipt value — rendered in mono (cryptographic artifact) */
		receiptValue?: string;
		/** Disclosure depth: 1 = claim only, 2 = + private/public, 3 = + receipt artifact */
		depth?: 1 | 2 | 3;
		/** Additional class for the container */
		class?: string;
	}

	let {
		type,
		claim,
		subhead,
		privateParts = [],
		publicParts = [],
		receiptLabel,
		receiptValue,
		depth = 2,
		class: className = ''
	}: Props = $props();

	const accentVar = $derived(
		type === 'identity' ? 'var(--coord-verified, #10b981)'
		: type === 'location' ? 'var(--coord-route-solid, #3bc4b8)'
		: 'var(--coord-share, #4f46e5)'
	);
</script>

<div class="proof-claim {className}" style="--accent: {accentVar};" data-type={type} data-depth={depth}>
	<div class="proof-claim__head">
		<span class="proof-claim__marker" aria-hidden="true"></span>
		<p class="proof-claim__label">{claim}</p>
	</div>
	{#if subhead}
		<p class="proof-claim__subhead">{subhead}</p>
	{/if}

	{#if depth >= 2 && (privateParts.length > 0 || publicParts.length > 0)}
		<div class="proof-claim__split">
			{#if privateParts.length > 0}
				<div class="proof-claim__col proof-claim__col--private">
					<p class="proof-claim__col-label">Private — stays with you</p>
					<ul class="proof-claim__items">
						{#each privateParts as part}
							<li class="proof-claim__item proof-claim__item--private">{part}</li>
						{/each}
					</ul>
				</div>
			{/if}
			{#if publicParts.length > 0}
				<div class="proof-claim__col proof-claim__col--public">
					<p class="proof-claim__col-label">Public — anyone can verify</p>
					<ul class="proof-claim__items">
						{#each publicParts as part}
							<li class="proof-claim__item proof-claim__item--public">{part}</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}

	{#if depth >= 3 && receiptLabel && receiptValue}
		<div class="proof-claim__receipt">
			<span class="proof-claim__receipt-label">{receiptLabel}</span>
			<span class="proof-claim__receipt-value">{receiptValue}</span>
		</div>
	{/if}
</div>

<style>
	.proof-claim {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.proof-claim__head {
		display: flex;
		align-items: baseline;
		gap: 0.625rem;
	}

	.proof-claim__marker {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background: var(--accent);
		flex-shrink: 0;
		transform: translateY(-1px);
	}

	.proof-claim__label {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 600;
		color: oklch(0.2 0.03 250);
		line-height: 1.3;
		margin: 0;
		letter-spacing: -0.005em;
	}
	@media (min-width: 640px) { .proof-claim__label { font-size: 1.0625rem; } }

	.proof-claim__subhead {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.48 0.01 250);
		margin: 0 0 0 1.25rem;
		line-height: 1.4;
	}

	.proof-claim__split {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin-left: 1.25rem;
		margin-top: 0.25rem;
	}
	@media (max-width: 479px) {
		.proof-claim__split {
			grid-template-columns: 1fr;
			gap: 0.625rem;
		}
	}

	.proof-claim__col-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.5625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.55 0.01 250);
		margin: 0 0 0.375rem;
	}
	@media (min-width: 640px) { .proof-claim__col-label { font-size: 0.625rem; } }

	.proof-claim__items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.proof-claim__item {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.32 0.02 250);
		padding: 0.25rem 0.5rem;
		border-radius: 3px;
		line-height: 1.4;
	}

	/* Private items — dashed border, indicates "stays with you" */
	.proof-claim__item--private {
		border: 1px dashed oklch(0.75 0.02 250);
		background: oklch(0.985 0.003 250);
	}

	/* Public items — solid colored border, indicates "receipt anyone can verify" */
	.proof-claim__item--public {
		border: 1px solid var(--accent);
		background: color-mix(in oklch, var(--accent) 8%, transparent);
		color: oklch(0.22 0.02 250);
	}

	/* Receipt artifact — developer-depth: the actual cryptographic identifier */
	.proof-claim__receipt {
		margin-left: 1.25rem;
		margin-top: 0.25rem;
		display: flex;
		align-items: baseline;
		gap: 0.625rem;
		font-size: 0.6875rem;
	}

	.proof-claim__receipt-label {
		font-family: 'JetBrains Mono', monospace;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.55 0.01 250);
	}

	.proof-claim__receipt-value {
		font-family: 'JetBrains Mono', monospace;
		font-variant-numeric: tabular-nums;
		color: oklch(0.22 0.02 250);
		background: oklch(0.96 0.004 250);
		padding: 0.125rem 0.375rem;
		border-radius: 2px;
		word-break: break-all;
	}
</style>
