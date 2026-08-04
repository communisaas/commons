<script lang="ts">
	import type { Template } from '$lib/types/template';
	import Button from '$lib/components/ui/Button.svelte';
	import { type Spring } from 'svelte/motion';
	import { recipientIntentCount } from '$convex/lib/recipientRoster';
	import { isCongressionalDelivery } from '$convex/lib/templateDeliveryMethod';
	import { getJurisdictionLabels } from '$lib/core/locale/jurisdiction';
	import { moderatePersonalConnection } from '$lib/utils/personal-connection';
	import { laneCarriesSenderText, SENDER_TEXT_NOT_CARRIED_REASON } from '$lib/services/send-lane';

	const labels = getJurisdictionLabels();

	let {
		template,
		user,
		personalConnectionValue,
		onSendMessage,
		localShowEmailModal = $bindable(),
		actionProgress = $bindable(),
		onEmailModalClose: _onEmailModalClose,
		componentId: _componentId
	}: {
		template: Template;
		user: { id: string; name: string | null; trust_tier?: number } | null;
		personalConnectionValue: string;
		onSendMessage: (() => void) | null;
		localShowEmailModal: boolean;
		actionProgress: Spring<number>;
		onEmailModalClose: () => void;
		componentId: string;
	} = $props();

	let flightState = $state<
		'sent' | 'ready' | 'taking-off' | 'flying' | 'departing' | 'returning' | undefined
	>('ready');
	let moderationError = $state<string | null>(null);
	let isModerating = $state(false);

	// Derived trust tier state
	const userTrustTier = $derived(user?.trust_tier ?? 0);
	const isVerifiedConstituent = $derived(userTrustTier >= 2);
	const isCwcTemplate = $derived(isCongressionalDelivery(template.deliveryMethod));

	// Whether this send's lane delivers the sender's own words. Keyed on the lane,
	// not on the delivery method: a guest on a congressional template goes out
	// through the mailto relay, which carries the note like any other letter.
	const carriesSenderText = $derived(laneCarriesSenderText(template, user));

	// Recipient count from template config
	const recipientCount = $derived(
		typeof template.recipient_count === 'number'
			? template.recipient_count
			: recipientIntentCount(template?.recipient_config)
	);

	// Button text and variant based on trust tier + delivery method
	const buttonVariant = $derived(isCwcTemplate && isVerifiedConstituent ? 'verified' : 'primary');
	const buttonText = $derived.by(() => {
		if (isModerating) return 'Checking...';
		const count = recipientCount;
		if (isCwcTemplate && isVerifiedConstituent) {
			return count > 0
				? `Deliver as verified constituent to ${count}`
				: 'Deliver as verified constituent';
		}
		if (isCwcTemplate) {
			return `Deliver to ${labels.legislativeBody}`;
		}
		return count > 0
			? `Deliver to ${count} decision-maker${count !== 1 ? 's' : ''}`
			: 'Send to Decision-Makers';
	});

	async function handleSendClick() {
		moderationError = null;

		// Fail closed before the send even reaches moderation: on a lane that
		// transmits no sender-typed words, a note that exists is refused with the
		// reason. Moderating it and then dropping it on the way out would spend the
		// sender's attention on words this lane was never going to deliver.
		if (!carriesSenderText && personalConnectionValue.trim()) {
			moderationError = SENDER_TEXT_NOT_CARRIED_REASON;
			return;
		}

		// The sender's own words pass the shared send-time gate before anything else
		// runs. Same gate, same failure policy, as every other send lane.
		isModerating = true;
		const moderation = await moderatePersonalConnection(personalConnectionValue);
		isModerating = false;
		if (!moderation.approved) {
			moderationError = moderation.reason;
			return;
		}

		// Persistence across the OAuth round trip belongs to TemplatePreview, which
		// owns the storage key and gates the write on the lane. A second writer here
		// would re-seed a note the lane cannot carry, past that gate.

		// Let parent handle the entire flow (auth, address, or email modal)
		if (onSendMessage) {
			onSendMessage();
		}
	}
</script>

{#if onSendMessage}
	{#if moderationError}
		<div class="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
			{moderationError}
		</div>
	{/if}
	<div class="mt-4 flex shrink-0 flex-col items-center gap-2">
		{#if isCwcTemplate}
			<Button
				variant={buttonVariant}
				size="lg"
				testId="contact-congress-button"
				classNames="w-full pr-5"
				enableFlight={!!user}
				icon="send"
				bind:flightState
				{user}
				onclick={handleSendClick}
				disabled={isModerating}
				text={buttonText}
			/>
		{:else}
			<Button
				variant={isVerifiedConstituent ? 'verified' : 'primary'}
				size="lg"
				testId="send-email-button"
				classNames="w-full pr-5"
				enableFlight={!!user}
				icon="send"
				bind:flightState
				{user}
				onclick={handleSendClick}
				disabled={isModerating}
				text={buttonText}
			/>
		{/if}
	</div>
{/if}
