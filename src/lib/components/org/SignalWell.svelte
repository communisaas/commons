<!--
  SignalWell — the right-edge well for recent org signal (orgEvents).

  Layout scope reads a session-authenticated recent orgEvents slice. That is
  current operating signal, not a full SSE reattachment claim. Payloads stay
  out of the shell; only event kind and timestamp are rendered.
-->
<script lang="ts">
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

	const eventCount = $derived(events?.length ?? null);

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

	{#if events === null}
		<p class="signal-empty">
			Activity didn't load with this page view. Reload to see what's happened recently.
		</p>
	{:else if events.length === 0}
		<p class="signal-empty">
			Nothing's happened here yet. New actions, people, and responses show up as they come in.
		</p>
	{:else}
		<ul class="signal-list">
			{#each events as e (e.id)}
				<li class="signal-row">
					<time class="signal-time" datetime={new Date(e.emittedAt).toISOString()}>{stamp(e.emittedAt)}</time>
					<span class="signal-event" title={e.event}>{eventLabel(e.event)}</span>
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
