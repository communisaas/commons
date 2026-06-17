<script lang="ts">
	import { Datum } from '$lib/design';
	import { SPRINGS } from '$lib/design/motion';

	let {
		event
	}: {
		event: {
			id: string;
			title: string;
			startAt: string;
			endAt: string | null;
			timezone: string;
			venue: string | null;
			city: string | null;
			eventType: string;
			status: string;
			rsvpCount: number;
			capacity: number | null;
			attendeeCount: number;
			verifiedAttendees: number;
		};
	} = $props();

	const statusColors: Record<string, string> = {
		DRAFT: 'border-surface-border-strong bg-surface-overlay text-text-secondary',
		PUBLISHED: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
		CANCELLED: 'border-red-500/30 bg-red-500/10 text-red-400',
		COMPLETED: 'border-blue-500/30 bg-blue-500/10 text-blue-300'
	};

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			timeZone: event.timezone
		}).format(new Date(iso));
	}

	const locationLabel = $derived(
		event.venue
			? [event.venue, event.city].filter(Boolean).join(', ')
			: event.eventType === 'VIRTUAL'
				? 'Virtual'
				: null
	);

	const capacityPercent = $derived(
		event.capacity ? Math.min(100, (event.rsvpCount / event.capacity) * 100) : null
	);
</script>

<div
	class="border-surface-border bg-surface-base hover:border-surface-border-strong hover:bg-surface-overlay rounded-md border p-4 transition-colors"
>
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0 flex-1">
			<div class="mb-1 flex items-center gap-2">
				<h3 class="text-text-primary truncate text-base font-semibold">{event.title}</h3>
				<span
					class="shrink-0 rounded-md border px-2 py-0.5 font-mono text-xs font-semibold {statusColors[
						event.status
					] ?? 'border-surface-border-strong bg-surface-overlay text-text-secondary'}"
				>
					{event.status}
				</span>
			</div>

			<p class="text-text-tertiary text-sm">{formatDate(event.startAt)}</p>

			{#if locationLabel}
				<p class="text-text-quaternary mt-0.5 text-sm">{locationLabel}</p>
			{/if}
		</div>

		<div class="shrink-0 text-right">
			<p class="text-text-primary text-lg font-bold">
				<Datum value={event.rsvpCount} animate spring={SPRINGS.METRIC} cite="events.rsvpCount" />
			</p>
			<p class="text-text-tertiary text-xs">
				RSVP{event.rsvpCount !== 1 ? 's' : ''}
				{#if event.capacity}
					/ {event.capacity}
				{/if}
			</p>
		</div>
	</div>

	{#if capacityPercent !== null}
		<div class="bg-surface-overlay mt-3 h-1 w-full overflow-hidden rounded-full">
			<div
				class="h-full rounded-full transition-all duration-300 {capacityPercent >= 90
					? 'bg-amber-500'
					: 'bg-text-tertiary'}"
				style="width: {capacityPercent}%"
			></div>
		</div>
	{/if}

	{#if event.verifiedAttendees > 0}
		<div class="mt-2 flex items-center gap-1">
			<svg
				class="h-3.5 w-3.5 text-green-400"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
				><path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
				/></svg
			>
			<span class="text-xs text-green-400">{event.verifiedAttendees} verified</span>
		</div>
	{/if}
</div>
