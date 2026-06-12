<script lang="ts">
	import EventMetrics from '$lib/components/events/EventMetrics.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();

	const statusColors: Record<string, string> = {
		DRAFT: 'border-surface-border-strong bg-surface-overlay text-text-secondary',
		PUBLISHED: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
		CANCELLED: 'border-red-500/30 bg-red-500/10 text-red-400',
		COMPLETED: 'border-blue-500/30 bg-blue-500/10 text-blue-300'
	};

	const isPublished = $derived(data.event.status === 'PUBLISHED');
	const isPubliclyViewable = $derived(data.event.status !== 'DRAFT');
	const publicHref = $derived(`/e/${data.event.id}`);
	const calendarExportHref = $derived(`/org/${data.org.slug}/events/${data.event.id}/calendar.ics`);
	const rosterExportHref = $derived(`/org/${data.org.slug}/events/${data.event.id}/attendees.csv`);

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			timeZone: data.event.timezone,
			timeZoneName: 'short'
		}).format(new Date(iso));
	}
</script>

<svelte:head>
	<title>{data.event.title} | {data.org.name}</title>
</svelte:head>

<div class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-5xl space-y-6 px-4 py-8">
		<a
			href="/org/{data.org.slug}/events"
			class="text-text-tertiary hover:text-text-primary inline-block text-sm"
		>
			Events / back
		</a>

		<div id="event-record" class="flex flex-wrap items-start justify-between gap-4">
			<div class="min-w-0">
				<div class="mb-2 flex items-center gap-3">
					<h1 class="text-text-primary text-xl font-semibold">{data.event.title}</h1>
					<span
						class="rounded-md border px-2 py-0.5 font-mono text-xs font-semibold {statusColors[
							data.event.status
						] ?? 'border-surface-border-strong bg-surface-overlay text-text-secondary'}"
					>
						{data.event.status}
					</span>
				</div>
				<p class="text-text-tertiary text-sm">
					{formatDate(data.event.startAt)}
					{#if data.event.endAt}
						/ {formatDate(data.event.endAt)}{/if}
				</p>
				{#if data.event.venue}
					<p class="text-text-tertiary mt-1 text-sm">
						{[data.event.venue, data.event.city, data.event.state].filter(Boolean).join(', ')}
					</p>
				{/if}
			</div>

			<div class="flex flex-wrap justify-end gap-2">
				<a
					href={calendarExportHref}
					class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-md border px-3 py-1.5 text-sm"
				>
					Download ICS
				</a>
				<a
					href={rosterExportHref}
					class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-md border px-3 py-1.5 text-sm"
				>
					Export CSV
				</a>
				{#if isPubliclyViewable}
					<a
						href={publicHref}
						target="_blank"
						rel="noopener"
						class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-md border px-3 py-1.5 text-sm"
					>
						Open public page
					</a>
				{:else}
					<span
						class="border-surface-border text-text-quaternary rounded-md border px-3 py-1.5 text-sm"
					>
						Not published yet
					</span>
				{/if}
			</div>
		</div>

		{#if form?.error}
			<div class="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
				{form.error}
			</div>
		{/if}
		{#if form?.statusChanged}
			<div
				class="rounded-md border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-300"
			>
				Event status changed to {form.statusChanged}.
			</div>
		{/if}

		<div id="event-publication" class="border-surface-border bg-surface-base rounded-md border p-4">
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div>
					<p class="text-text-primary text-sm font-medium">Public RSVP page</p>
					<p class="text-text-tertiary mt-1 max-w-2xl text-sm">
						{#if isPublished}
							This event is accepting RSVPs through the public page. RSVPs are stored encrypted,
							and public counts stay hidden until at least five people respond.
						{:else}
							This event is not accepting new public RSVPs while it is {data.event.status.toLowerCase()}.
						{/if}
					</p>
				</div>

				{#if data.canManageEvent}
					<div class="flex flex-wrap gap-2">
						{#if data.event.status === 'DRAFT'}
							<form method="POST" action="?/publish">
								<button
									type="submit"
									class="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-500"
								>
									Publish RSVP page
								</button>
							</form>
						{/if}
						{#if data.event.status === 'PUBLISHED'}
							<form method="POST" action="?/complete">
								<button
									type="submit"
									class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-md border px-3 py-1.5 text-sm"
								>
									Mark complete
								</button>
							</form>
							<form method="POST" action="?/cancel">
								<button
									type="submit"
									class="rounded-md border border-red-500/30 px-3 py-1.5 text-sm text-red-400 hover:border-red-400/70"
								>
									Cancel event
								</button>
							</form>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<EventMetrics
			rsvpCount={data.event.rsvpCount}
			attendeeCount={data.event.attendeeCount}
			verifiedAttendees={data.event.verifiedAttendees}
			capacity={data.event.capacity}
		/>

		<div
			id="event-export-boundary"
			class="border-surface-border bg-surface-base rounded-md border p-4"
		>
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div>
					<p class="text-text-primary text-sm font-medium">Exports</p>
					<p class="text-text-tertiary mt-1 max-w-2xl text-sm">
						ICS adds this event to a calendar. CSV exports the RSVP and check-in list without
						decrypted emails or names.
					</p>
				</div>
				<div class="flex flex-wrap gap-2">
					<a
						href={calendarExportHref}
						class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-md border px-3 py-1.5 text-sm"
					>
						Download ICS
					</a>
					<a
						href={rosterExportHref}
						class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-md border px-3 py-1.5 text-sm"
					>
						Export CSV
					</a>
				</div>
			</div>
		</div>

		<div
			id="event-checkin-boundary"
			class="border-surface-border bg-surface-base rounded-md border p-4"
		>
			<p class="text-text-primary text-sm font-medium">Check-in code</p>
			<p class="text-text-tertiary mt-1 text-sm">
				People check in by entering this code at the event.
			</p>
			{#if data.event.checkinCode}
				<p class="text-text-primary font-mono text-2xl font-bold tracking-wider">
					{data.event.checkinCode}
				</p>
				<p class="text-text-tertiary mt-1 text-xs">
					Visible to editors and owners. Share only when this event should accept check-ins.
				</p>
			{:else}
				<p class="text-text-tertiary mt-3 text-sm">
					Only editors and owners can see the check-in code.
				</p>
			{/if}
		</div>

		<div id="event-roster">
			<h3 class="text-text-tertiary mb-3 text-sm font-medium">RSVPs ({data.rsvps.length})</h3>
			{#if data.rsvps.length === 0}
				<p
					class="border-surface-border bg-surface-base text-text-tertiary rounded-md border py-8 text-center text-sm"
				>
					No RSVPs yet.
				</p>
			{:else}
				<div class="border-surface-border bg-surface-base overflow-x-auto rounded-md border">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-surface-border text-text-tertiary border-b text-xs">
								<th class="px-4 py-3 font-medium">Name</th>
								<th class="px-4 py-3 font-medium">Email</th>
								<th class="px-4 py-3 font-medium">Status</th>
								<th class="px-4 py-3 font-medium">District</th>
								<th class="px-4 py-3 font-medium">Checked In</th>
							</tr>
						</thead>
						<tbody>
							{#each data.rsvps as rsvp (rsvp.id)}
								<tr class="border-surface-border border-b last:border-0">
									<td class="text-text-primary px-4 py-3">{rsvp.name}</td>
									<td class="text-text-tertiary px-4 py-3">
										{rsvp.email ?? 'encrypted / not exposed'}
									</td>
									<td class="px-4 py-3">
										<span
											class="inline-flex rounded-md px-2 py-0.5 text-xs font-medium {rsvp.status ===
											'GOING'
												? 'bg-green-900/50 text-green-400'
												: rsvp.status === 'MAYBE'
													? 'bg-yellow-900/50 text-yellow-400'
													: rsvp.status === 'WAITLISTED'
														? 'bg-blue-900/50 text-blue-400'
														: 'bg-surface-border-strong text-text-secondary'}"
										>
											{rsvp.status}
										</span>
									</td>
									<td class="text-text-tertiary px-4 py-3 font-mono text-xs"
										>{rsvp.districtHash ?? '-'}</td
									>
									<td class="px-4 py-3">
										{#if rsvp.checkedIn}
											<span
												class="text-green-400"
												title="Checked in{rsvp.verified ? ' (verified)' : ''}"
											>
												{rsvp.verified ? 'Verified' : 'Yes'}
											</span>
										{:else}
											<span class="text-text-quaternary">-</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</div>
</div>
