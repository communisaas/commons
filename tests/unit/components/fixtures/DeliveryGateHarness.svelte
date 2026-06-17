<!--
	Test-only harness that reproduces the exact in-app delivery surfaces'
	branch: when a send action returns the subscribe-gate code, show the
	conversion prompt; otherwise fall back to the raw error box. Mirrors the
	`{#if showDeliveryGate} ... {:else if errorMsg}` logic in the email compose
	and campaign-report pages so the test exercises the live selection rule,
	not a duplicated string.
-->
<script lang="ts">
	import DeliveryGateNotice from '$lib/components/org/DeliveryGateNotice.svelte';
	import {
		DELIVERY_QUOTA_SUBSCRIBE_GATE,
		deliveryPlanGridHref
	} from '$lib/data/org-limit-sentences';

	let {
		form,
		slug
	}: {
		form: { error?: string; errorCode?: string } | null;
		slug: string;
	} = $props();

	const showDeliveryGate = $derived(
		!!form && 'errorCode' in form && form.errorCode === DELIVERY_QUOTA_SUBSCRIBE_GATE
	);
	const errorMsg = $derived(form && 'error' in form ? form.error : null);
	const planGridHref = $derived(deliveryPlanGridHref(slug));
</script>

{#if showDeliveryGate}
	<DeliveryGateNotice planHref={planGridHref} />
{:else if errorMsg}
	<div data-testid="raw-error">{errorMsg}</div>
{/if}
