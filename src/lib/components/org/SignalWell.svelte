<!--
  SignalWell — the right-edge well for recent org signal (orgEvents).

  Layout scope reads a session-authenticated recent orgEvents slice. That is
  current operating signal, not a full SSE reattachment claim. Payloads stay
  out of the shell; only event kind and timestamp are rendered.
-->
<script lang="ts">
	import { getOrgOS } from '$lib/components/org/os/orgOS.svelte';
	import { mergeSignal } from '$lib/components/org/os/perceptual';

	export interface OrgSignal {
		id: string;
		event: string;
		emittedAt: number;
	}

	let {
		events = null
	}: {
		events?: OrgSignal[] | null;
	} = $props();

	// Read the live kernel signal in ADDITION to the server snapshot and merge —
	// the durable server events and the live this-session kernel events are
	// different kinds of truth and must not clobber each other. SignalWell only
	// ever mounts inside the OS-context layout, but guard so a standalone render
	// (tests / a context-less branch) falls back to server-prop-only and never throws.
	let os: ReturnType<typeof getOrgOS> | null = null;
	try {
		os = getOrgOS();
	} catch {
		os = null;
	}

	// `os.signal` is a reactive getter — reading it inside $derived means a live
	// emitSignal() ("Composed …" / "Authoring failed …") re-derives and scrolls
	// the new row into the well with no reload.
	const merged = $derived(mergeSignal(events, os ? os.signal : [], 12));
	const eventCount = $derived(merged.count);

	function stamp(ms: number): string {
		return new Date(ms).toLocaleTimeString('en-US', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		});
	}

	function eventLabel(event: string): string {
		switch (event) {
			case 'campaign_action.created':
				return 'Action record';
			case 'campaign.updated':
				return 'Campaign update';
			case 'supporter.created':
				return 'Person added';
			case 'supporter.updated':
				return 'Person updated';
			case 'supporter.deleted':
				return 'Person removed';
			case 'donation.completed':
				return 'Donation completed';
			case 'donation.refunded':
				return 'Donation refunded';
			case 'event.rsvp_created':
				return 'RSVP received';
			default:
				return event;
		}
	}
</script>

<section class="signal-well" aria-label="Recent activity">
	<header class="signal-head">
		<span class="signal-title">Recent activity</span>
		<span class="signal-count">
			{eventCount === null ? 'unread' : eventCount}
		</span>
	</header>

	{#if merged.rows.length === 0}
		{#if events === null}
			<p class="signal-empty">
				Activity didn't load with this page view. Reload to see what's happened recently.
			</p>
		{:else}
			<p class="signal-empty">
				Nothing's happened here yet. New actions, people, and responses show up as they come in.
			</p>
		{/if}
	{:else}
		<ul class="signal-list">
			{#each merged.rows as e (e.id)}
				<li class="signal-row">
					<time class="signal-time" datetime={new Date(e.emittedAt).toISOString()}>{stamp(e.emittedAt)}</time>
					<!-- kernel rows are verbatim sentences; only server event-keys get relabeled -->
					<span class="signal-event" title={e.event}>
						{e.source === 'kernel' ? e.event : eventLabel(e.event)}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.signal-well {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.signal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.signal-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--org-sidebar-text-dim);
	}

	.signal-count {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-variant-numeric: tabular-nums;
		color: var(--org-sidebar-text-dim);
	}

	.signal-empty {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.4;
		color: var(--org-sidebar-text-dim);
		margin: 0;
	}

	.signal-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.signal-row {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
		/* New rows ARRIVE rather than appear. Keyed-each only re-mounts the new
		   node, so this fires per fresh signal, not on every list re-render. */
		animation: signal-enter 150ms var(--header-easing, ease-out);
	}

	@keyframes signal-enter {
		from {
			opacity: 0;
			transform: translateY(-3px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.signal-row {
			animation: none;
		}
	}

	.signal-time {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		font-size: 0.625rem;
		color: var(--org-sidebar-text-dim);
		flex-shrink: 0;
	}

	.signal-event {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		color: var(--org-sidebar-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
