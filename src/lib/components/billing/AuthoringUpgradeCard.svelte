<script lang="ts">
	/**
	 * At-cap upgrade card for the individual (person-layer) AI-authoring limit.
	 *
	 * Surfaced when a free-floor user hits the monthly authoring cap (the server
	 * throws AUTHORING_QUOTA_EXCEEDED). Individual tiers buy ONLY more authoring
	 * volume — never org tooling — so this card sells exactly that: Voice
	 * ($7/mo, 20 authored) and Advocate ($20/mo, 75 authored). Clicking a tier
	 * POSTs to /api/billing/checkout-individual and redirects to Stripe Checkout.
	 *
	 * The display price/volume here is presentation copy. The canonical source is
	 * INDIVIDUAL_PLANS in src/lib/server/billing/plans.ts (server-only), enforced
	 * by the dynamic authoring cap + plan-sync.test.ts.
	 */

	interface Props {
		/** Plan-aware copy from the server (the message after the coded prefix). */
		message?: string | null;
		/** Dismiss the card. */
		onclose?: () => void;
	}

	let { message = null, onclose }: Props = $props();

	const TIERS = [
		{ slug: 'voice', name: 'Voice', priceLabel: '$7/mo', authored: 20 },
		{ slug: 'advocate', name: 'Advocate', priceLabel: '$20/mo', authored: 75 }
	] as const;

	let pending = $state<string | null>(null);
	let checkoutError = $state<string | null>(null);

	async function upgrade(plan: string) {
		if (pending) return;
		pending = plan;
		checkoutError = null;
		try {
			const res = await fetch('/api/billing/checkout-individual', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ plan })
			});
			const body = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
			if (!res.ok || !body.url) {
				checkoutError = body.message || 'Could not start checkout. Please try again.';
				pending = null;
				return;
			}
			// Redirect to Stripe Checkout.
			window.location.href = body.url;
		} catch {
			checkoutError = 'Could not start checkout. Please try again.';
			pending = null;
		}
	}
</script>

<div class="authoring-upgrade" role="group" aria-label="Upgrade authoring volume">
	<p class="cap-message">
		{message ?? "You've reached your monthly AI-authoring limit."}
	</p>
	<p class="cap-sub">Keep authoring this month — upgrade for higher-volume authoring.</p>

	<div class="tiers">
		{#each TIERS as tier (tier.slug)}
			<button
				type="button"
				class="tier"
				disabled={pending !== null}
				onclick={() => upgrade(tier.slug)}
			>
				<span class="tier-name">{tier.name}</span>
				<span class="tier-price">{tier.priceLabel}</span>
				<span class="tier-volume">{tier.authored} messages / month</span>
				{#if pending === tier.slug}
					<span class="tier-pending">Redirecting…</span>
				{/if}
			</button>
		{/each}
	</div>

	{#if checkoutError}
		<p class="checkout-error" role="alert">{checkoutError}</p>
	{/if}

	{#if onclose}
		<button type="button" class="dismiss" onclick={onclose}>Maybe later</button>
	{/if}
</div>

<style>
	.authoring-upgrade {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		border: 1px solid var(--border, #e2e8f0);
		border-radius: 0.75rem;
		background: var(--surface, #fff);
	}
	.cap-message {
		font-weight: 600;
		margin: 0;
	}
	.cap-sub {
		margin: 0;
		font-size: 0.875rem;
		opacity: 0.8;
	}
	.tiers {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}
	.tier {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.75rem;
		border: 1px solid var(--border, #e2e8f0);
		border-radius: 0.5rem;
		background: transparent;
		cursor: pointer;
		text-align: left;
	}
	.tier:hover:not(:disabled) {
		border-color: var(--accent, #2563eb);
	}
	.tier:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.tier-name {
		font-weight: 600;
	}
	.tier-price {
		font-size: 1rem;
	}
	.tier-volume {
		font-size: 0.8125rem;
		opacity: 0.75;
	}
	.tier-pending {
		font-size: 0.75rem;
		opacity: 0.7;
	}
	.checkout-error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--error, #dc2626);
	}
	.dismiss {
		align-self: flex-start;
		background: none;
		border: none;
		font-size: 0.8125rem;
		text-decoration: underline;
		cursor: pointer;
		opacity: 0.7;
	}
</style>
