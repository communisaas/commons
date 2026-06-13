<script lang="ts">
	import { Datum } from '$lib/design';
	import { SPRINGS } from '$lib/design/motion';

	let {
		rsvpCount,
		attendeeCount,
		verifiedAttendees,
		capacity
	}: {
		rsvpCount: number;
		attendeeCount: number;
		verifiedAttendees: number;
		capacity: number | null;
	} = $props();

	const rsvpPercent = $derived(capacity ? Math.min(100, (rsvpCount / capacity) * 100) : null);
	const verifiedPercent = $derived(
		attendeeCount > 0 ? (verifiedAttendees / attendeeCount) * 100 : 0
	);
</script>

<div class="grid grid-cols-3 gap-3">
	<div class="border-surface-border bg-surface-base rounded-md border p-4">
		<p class="text-text-tertiary text-xs font-medium">RSVPs</p>
		<p class="text-text-primary mt-1 text-2xl font-bold">
			<Datum value={rsvpCount} animate spring={SPRINGS.METRIC} cite="events.rsvpCount" />
			{#if capacity}
				<span class="text-text-tertiary text-sm font-normal">/ {capacity}</span>
			{/if}
		</p>
		{#if rsvpPercent !== null}
			<div class="bg-surface-overlay mt-2 h-1.5 w-full overflow-hidden rounded-full">
				<div
					class="bg-text-tertiary h-full rounded-full transition-all"
					style="width: {rsvpPercent}%"
				></div>
			</div>
		{/if}
	</div>

	<div class="border-surface-border bg-surface-base rounded-md border p-4">
		<p class="text-text-tertiary text-xs font-medium">Checked in</p>
		<p class="text-text-primary mt-1 text-2xl font-bold">
			<Datum value={attendeeCount} animate spring={SPRINGS.METRIC} cite="events.attendeeCount" />
		</p>
		{#if rsvpCount > 0}
			<div class="bg-surface-overlay mt-2 h-1.5 w-full overflow-hidden rounded-full">
				<div
					class="h-full rounded-full bg-blue-500 transition-all"
					style="width: {Math.min(100, (attendeeCount / rsvpCount) * 100)}%"
				></div>
			</div>
		{/if}
	</div>

	<div class="border-surface-border bg-surface-base rounded-md border p-4">
		<p class="text-text-tertiary text-xs font-medium">Verified</p>
		<p class="mt-1 text-2xl font-bold text-green-400">
			<Datum
				value={verifiedAttendees}
				animate
				spring={SPRINGS.METRIC}
				cite="events.verifiedAttendees"
			/>
		</p>
		{#if attendeeCount > 0}
			<div class="bg-surface-overlay mt-2 h-1.5 w-full overflow-hidden rounded-full">
				<div
					class="h-full rounded-full bg-green-500 transition-all"
					style="width: {verifiedPercent}%"
				></div>
			</div>
		{/if}
	</div>
</div>
