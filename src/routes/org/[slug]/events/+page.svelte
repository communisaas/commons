<script lang="ts">
	import EventCard from '$lib/components/events/EventCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const eventCount = $derived(data.events.length);
	const publishedCount = $derived(
		data.events.filter((event) => event.status === 'PUBLISHED').length
	);
	const draftCount = $derived(data.events.filter((event) => event.status === 'DRAFT').length);
	const rsvpCount = $derived(data.events.reduce((sum, event) => sum + event.rsvpCount, 0));
</script>

<svelte:head>
	<title>Events | {data.org.name}</title>
</svelte:head>

<div class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-5xl space-y-6 px-4 py-8">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<nav class="text-text-tertiary mb-3 flex items-center gap-2 text-sm">
					<a href="/org/{data.org.slug}/studio" class="hover:text-text-secondary transition-colors">
						Studio
					</a>
					<span aria-hidden="true">/</span>
					<span>Events</span>
				</nav>
				<h1 class="text-text-primary text-xl font-semibold">Events</h1>
				<p class="text-text-tertiary mt-1 max-w-2xl text-sm">
					Publish events, take RSVPs, and check people in.
				</p>
			</div>
			<a
				href="/org/{data.org.slug}/events/new"
				class="bg-surface-overlay text-text-primary hover:bg-surface-base rounded-md px-4 py-2 text-sm font-semibold transition-colors"
			>
				Create event
			</a>
		</div>

		{#if data.events.length === 0}
			<div class="border-surface-border bg-surface-base rounded-md border py-14 text-center">
				<p class="text-text-primary text-base font-medium">No events yet.</p>
				<p class="text-text-tertiary mt-1 text-sm">
					Create a draft first, then publish it when the public RSVP page should accept people.
				</p>
				<a
					href="/org/{data.org.slug}/events/new"
					class="bg-surface-overlay text-text-primary hover:bg-surface-raised mt-4 inline-block rounded-md px-4 py-2 text-sm font-semibold transition-colors"
				>
					Create event
				</a>
			</div>
		{:else}
			<div id="event-records" class="space-y-3">
				<div class="grid gap-3 sm:grid-cols-4">
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">{eventCount}</p>
						<p class="text-text-tertiary text-xs">records</p>
					</div>
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							{publishedCount}
						</p>
						<p class="text-text-tertiary text-xs">published</p>
					</div>
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">{draftCount}</p>
						<p class="text-text-tertiary text-xs">draft</p>
					</div>
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">{rsvpCount}</p>
						<p class="text-text-tertiary text-xs">RSVPs</p>
					</div>
				</div>

				{#each data.events as event (event.id)}
					<a href="/org/{data.org.slug}/events/{event.id}" class="block">
						<EventCard {event} />
					</a>
				{/each}
			</div>
		{/if}
	</div>
</div>
