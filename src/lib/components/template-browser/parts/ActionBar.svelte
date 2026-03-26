<script lang="ts">
	import type { Template } from '$lib/types/template';
	import Button from '$lib/components/ui/Button.svelte';
	import { browser } from '$app/environment';
	import { type Spring } from 'svelte/motion';
	import { extractRecipientEmails } from '$lib/types/templateConfig';
	import { parseRecipientConfig } from '$lib/utils/deriveTargetPresentation';

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
	const isCwcTemplate = $derived(template.deliveryMethod === 'cwc');

	// Recipient count from template config
	const recipientCount = $derived.by(() => {
		const config = parseRecipientConfig(template?.recipient_config);
		const dms = config?.decisionMakers?.length ?? 0;
		const emails = extractRecipientEmails(template?.recipient_config)?.length ?? 0;
		return dms || emails;
	});

	// Button text and variant based on trust tier + delivery method
	const buttonVariant = $derived(
		isCwcTemplate && isVerifiedConstituent ? 'verified' : 'primary'
	);
	const buttonText = $derived.by(() => {
		if (isModerating) return 'Checking...';
		const count = recipientCount;
		if (isCwcTemplate && isVerifiedConstituent) {
			return count > 0 ? `Deliver as verified constituent to ${count}` : 'Deliver as verified constituent';
		}
		if (isCwcTemplate) {
			return 'Deliver to Congress';
		}
		return count > 0 ? `Deliver to ${count} decision-maker${count !== 1 ? 's' : ''}` : 'Send to Decision-Makers';
	});

	// Circuit breaker for moderation service (CI-004 hardening)
	// Fail-closed: block sends when moderation is unavailable, unless circuit trips open
	// after CIRCUIT_BREAKER_THRESHOLD consecutive failures within CIRCUIT_BREAKER_WINDOW_MS
	const CIRCUIT_BREAKER_THRESHOLD = 3;
	const CIRCUIT_BREAKER_WINDOW_MS = 60_000;
	let moderationFailures: number[] = [];
	let circuitOpen = false;

	function recordModerationFailure(): void {
		const now = Date.now();
		moderationFailures = moderationFailures.filter((t) => now - t < CIRCUIT_BREAKER_WINDOW_MS);
		moderationFailures.push(now);
		if (moderationFailures.length >= CIRCUIT_BREAKER_THRESHOLD && !circuitOpen) {
			circuitOpen = true;
			console.warn(
				`[ActionBar] Circuit breaker OPEN: ${CIRCUIT_BREAKER_THRESHOLD} moderation failures in ${CIRCUIT_BREAKER_WINDOW_MS / 1000}s — allowing sends with audit log`
			);
		} else if (moderationFailures.length < CIRCUIT_BREAKER_THRESHOLD && circuitOpen) {
			// Half-open → closed: failures aged out of window, restore fail-closed behavior
			circuitOpen = false;
		}
	}

	async function handleSendClick() {
		moderationError = null;

		// Moderate personalization text before applying (CI-004)
		const pc = personalConnectionValue?.trim();
		if (pc && pc.length > 0) {
			isModerating = true;
			try {
				const res = await fetch('/api/moderation/personalization', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ text: pc })
				});
				const result = await res.json();
				if (!result.approved) {
					moderationError = result.summary || 'Personalization text was not approved. Please edit and try again.';
					isModerating = false;
					return;
				}
			} catch {
				// Fail-closed: block the send when moderation is unavailable
				recordModerationFailure();
				if (!circuitOpen) {
					moderationError =
						'Content moderation is temporarily unavailable. Please try again in a moment.';
					isModerating = false;
					return;
				}
				// Circuit is open (repeated failures) — degrade gracefully with audit trail
				console.warn('[ActionBar] Circuit breaker open — sending without moderation (audited)');
			}
			isModerating = false;

		}

		// Save personalization for all users
		if (browser && personalConnectionValue) {
			sessionStorage.setItem(
				`template_${template.id}_personalization`,
				JSON.stringify({
					personalConnection: personalConnectionValue,
					timestamp: Date.now()
				})
			);
		}

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
