<!--
	Conversion prompt shown at the moment of peak intent: the operator has
	authored a campaign and tried to deliver it, but the org has no active
	plan (the gated `inactive` floor sets every delivery quota to zero). Instead
	of a raw quota error, this presents a focused subscribe-to-send prompt with
	loss-aversion framing — the work is done, only sending needs a plan — and a
	primary CTA to the in-app pricing grid.

	This is presentation only. The 0-quota floor is enforced server-side; this
	component never relaxes it.
-->
<script lang="ts">
	let {
		planHref,
		headline = "Your campaign's ready — choose a plan to send it"
	}: {
		/** In-app pricing grid anchor, e.g. `/org/<slug>/settings#plan-feature-boundary`. */
		planHref: string;
		headline?: string;
	} = $props();
</script>

<div class="delivery-gate" role="status">
	<h2 class="delivery-gate__headline">{headline}</h2>
	<p class="delivery-gate__line">Authoring is free; sending to your people needs a plan.</p>
	<a class="delivery-gate__cta" href={planHref}>Choose a plan</a>
</div>

<style>
	.delivery-gate {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.625rem;
		border: 1px solid color-mix(in oklch, var(--accent-teal, oklch(0.7 0.12 180)) 40%, transparent);
		background: color-mix(in oklch, var(--accent-teal, oklch(0.7 0.12 180)) 6%, transparent);
		border-radius: 0.5rem;
		padding: 1.25rem 1.5rem;
	}
	.delivery-gate__headline {
		margin: 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 1.0625rem;
		font-weight: 600;
		line-height: 1.4;
		color: var(--text-primary, oklch(0.25 0.02 60));
	}
	.delivery-gate__line {
		margin: 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}
	.delivery-gate__cta {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		box-sizing: border-box;
		margin-top: 0.125rem;
		padding: 0 1rem;
		border-radius: 0.5rem;
		background: var(--accent-teal-strong, oklch(0.6 0.13 185));
		color: #fff;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 600;
		text-decoration: none;
		transition: background-color 150ms ease-out;
	}
	.delivery-gate__cta:hover {
		background: var(--accent-teal, oklch(0.66 0.13 185));
	}
</style>
