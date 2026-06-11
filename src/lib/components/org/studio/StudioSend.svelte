<!--
  StudioSend — where a composed action leaves the Studio.

  Two real actions, both draft handoffs the operator confirms on the delivery
  surface itself:

    · Publish as a public action page — writes the resolved audience, sources,
      and composed message into a public template draft; the creator owns
      edits and publish confirmation.
    · Send to your list — writes the subject and message into an org email
      composer draft; the composer owns recipients, preview, and the send.

  Congressional delivery is described in one plain sentence from the shared
  limit-sentence source until it is available — no internal state machinery.

  HONESTY RULE: a button is enabled only when a composed message exists, the
  operator has org authority, and a real handler is wired. A held action says
  why in one quiet line.
-->
<script lang="ts">
	import { FileUp, Mail, type Icon } from '@lucide/svelte';
	import type { Component } from 'svelte';
	import BoundedNotice from '$lib/components/org/BoundedNotice.svelte';
	import type { OrgLimitNotice } from '$lib/data/org-limit-sentences';
	import { TIMING, EASING } from '$lib/design/motion';

	type SendAction = {
		key: 'publish' | 'email';
		name: string;
		detail: string;
		icon: Component<Icon>;
		handler?: () => void;
		enabled: boolean;
	};

	let {
		ready,
		canPublish,
		congressionalNotice = null,
		onpublish,
		onemail
	}: {
		/** True once a composed message exists to hand off. */
		ready: boolean;
		/** Role-derived: members can watch; owner/editor can hand off drafts. */
		canPublish: boolean;
		/** One plain sentence about congressional delivery, when it applies. */
		congressionalNotice?: OrgLimitNotice | null;
		onpublish?: () => void;
		onemail?: () => void;
	} = $props();

	const actions = $derived<SendAction[]>([
		{
			key: 'publish',
			name: 'Publish as a public action page',
			detail:
				'Opens the public creator with your resolved audience, sources, and message as a draft. Nothing publishes until you confirm there.',
			icon: FileUp,
			handler: onpublish,
			enabled: ready && canPublish && Boolean(onpublish)
		},
		{
			key: 'email',
			name: 'Send to your list',
			detail:
				'Opens the email composer with the subject and message as a draft. You pick recipients and confirm before anything sends.',
			icon: Mail,
			handler: onemail,
			enabled: ready && canPublish && Boolean(onemail)
		}
	]);

	const holdReason = $derived(
		!ready
			? 'These open once the loop finishes composing a message.'
			: !canPublish
				? 'Your role can author and watch; publishing and sending need org authority.'
				: null
	);
</script>

<section
	id="studio-send"
	class="send"
	style="--timing-normal: {TIMING.NORMAL}ms; --easing: {EASING};"
	aria-label="Send the authored action"
>
	<header class="send-head">
		<span class="send-title">Send</span>
		<span class="send-gloss">Take the composed message to publishing or email.</span>
	</header>

	<div class="send-row" role="group" aria-label="Delivery handoffs">
		{#each actions as action (action.key)}
			{@const IconComponent = action.icon}
			<button
				type="button"
				class="channel"
				class:channel--primary={action.key === 'publish'}
				disabled={!action.enabled}
				onclick={action.handler}
				aria-label="{action.name}. {action.detail}"
			>
				<span class="channel-mark" aria-hidden="true">
					<IconComponent {...{ size: 18, strokeWidth: 1.8 } as Record<string, unknown>} />
				</span>
				<span class="channel-body">
					<span class="channel-name">{action.name}</span>
					<span class="channel-detail">{action.detail}</span>
				</span>
			</button>
		{/each}
	</div>

	{#if holdReason}
		<p class="send-note">{holdReason}</p>
	{/if}

	{#if congressionalNotice}
		<BoundedNotice notice={congressionalNotice} />
	{/if}
</section>

<style>
	.send {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.send-head {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.send-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.send-gloss {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		color: var(--text-tertiary, #6b7280);
	}

	.send-row {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
		min-width: 0;
	}

	.channel {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		box-sizing: border-box;
		min-width: 0;
		max-width: 100%;
		padding: 0.875rem;
		border-radius: 8px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-base, oklch(0.993 0.003 60));
		text-align: left;
		cursor: pointer;
		transition:
			border-color var(--timing-normal) var(--easing),
			box-shadow var(--timing-normal) var(--easing),
			transform var(--timing-normal) var(--easing);
		width: 100%;
	}

	.channel:hover:not(:disabled),
	.channel:focus-visible:not(:disabled) {
		border-color: var(--coord-route-solid, #3bc4b8);
		box-shadow: 0 10px 24px oklch(0.68 0.11 185 / 0.12);
		transform: translateY(-1px);
		outline: none;
	}

	.channel--primary:not(:disabled) {
		border-color: oklch(0.72 0.11 180 / 0.75);
	}

	.channel:disabled {
		cursor: not-allowed;
		background: var(--surface-overlay, oklch(0.975 0.005 55));
		opacity: 0.7;
	}

	.channel-mark {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 8px;
		color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.96 0.018 185);
	}

	.channel:disabled .channel-mark {
		color: var(--text-tertiary, #9ca3af);
		background: oklch(0.94 0.004 60);
	}

	.channel-body {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-width: 0;
		width: 100%;
	}

	.channel-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.9375rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.channel-detail {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--text-tertiary, #6b7280);
		overflow-wrap: anywhere;
	}

	.send-note {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary, #6b7280);
		margin: 0;
	}

	@media (max-width: 760px) {
		.send-row {
			grid-template-columns: 1fr;
		}
	}
</style>
