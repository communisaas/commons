<script lang="ts">
	import EventMetrics from '$lib/components/events/EventMetrics.svelte';
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import { Datum } from '$lib/design';
	import {
		buildEventReadiness,
		getGateEvidence,
		type CapabilityState
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel
	} from '$lib/data/capability-state-labels';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();

	type EventPressureReadout = {
		id: string;
		label: string;
		state: CapabilityState;
		title: string;
		action: string;
		detail: string;
		gate: string;
		href: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

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
	const eventRecordGate = getGateEvidence('CP-outbound-webhooks', ['T9-3', 'T9-7', 'T6-9'], {
		name: 'Event record and RSVP evidence',
		downstream: 4,
		dependency: 'Event rows + orgEvents emission + response-event substrate'
	});
	const attendanceProofGate = getGateEvidence('CP-mainnet-deployment', ['T3-6', 'T5-3'], {
		name: 'Attendance proof ceremony',
		downstream: 2,
		dependency: 'Mainnet registry + TEE-backed proof ceremony'
	});
	const eventArtifactGate = getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-10'], {
		name: 'Event artifact survivability',
		downstream: 3,
		dependency: 'Receipt manifest archive + long-term proof pattern'
	});
	const eventWaitlistGate = getGateEvidence('CP-event-waitlist-automation', ['T1-9', 'T9-3'], {
		name: 'Event waitlist automation',
		downstream: 1,
		dependency: 'Workflow side effects + event RSVP stream'
	});
	const eventReadiness = $derived(
		buildEventReadiness({
			base: `/org/${data.org.slug}`,
			context: 'detail',
			event: {
				recordCount: 1,
				publishedCount: isPublished ? 1 : 0,
				draftCount: data.event.status === 'DRAFT' ? 1 : 0,
				rsvpCount: data.event.rsvpCount,
				visibleRsvpRows: data.rsvps.length,
				attendeeCount: data.event.attendeeCount,
				verifiedAttendeeCount: data.event.verifiedAttendees,
				status: data.event.status,
				publishRequested: isPublished,
				waitlistEnabled: data.event.waitlistEnabled,
				waitlistEnabledCount: data.event.waitlistEnabled ? 1 : 0,
				hasCheckinCode: Boolean(data.event.checkinCode),
				hasSavedRecord: true,
				hasCalendarExport: true,
				hasRosterExport: true
			},
			gates: {
				eventRecordGate,
				eventWaitlistGate,
				attendanceProofGate,
				eventArtifactGate
			},
			hrefs: {
				'event-record': '#event-record',
				'public-rsvp-intake': isPublished ? publicHref : '#event-publication',
				'waitlist-roster': '#event-roster',
				'checkin-attendance-signal': '#event-checkin-boundary',
				'calendar-roster-artifacts': rosterExportHref
			}
		})
	);
	const capabilityItems = $derived(
		eventReadiness.rows.map((row) => ({
			label: row.label,
			state: row.state,
			phase: row.phase,
			cluster: row.clusters,
			action: row.action,
			handoff: row.handoff,
			detail: row.ground,
			unlock: row.boundary,
			href: row.href,
			metric: row.metric
		}))
	);
	const eventRecordRow = $derived(
		eventReadiness.rows.find((row) => row.id === 'event-record') ?? null
	);
	const publicRsvpRow = $derived(
		eventReadiness.rows.find((row) => row.id === 'public-rsvp-intake') ?? null
	);
	const heldEventRows = $derived(
		eventReadiness.rows.filter((row) => row.state === 'draft-only' || row.state === 'gated')
	);
	const nextEventLiftRow = $derived(
		heldEventRows.find((row) => row.id !== 'public-rsvp-intake') ??
			heldEventRows[0] ??
			eventReadiness.rows.find((row) => row.id === 'checkin-attendance-signal') ??
			eventReadiness.rows.find((row) => row.id === 'calendar-roster-artifacts') ??
			null
	);
	const eventPressureReadouts = $derived<EventPressureReadout[]>([
		{
			id: 'record-ground',
			label: 'Record ground',
			state: eventRecordRow?.state ?? eventReadiness.state,
			title: eventRecordRow?.handoff ?? eventReadiness.handoff,
			action: eventRecordRow?.action ?? eventReadiness.action,
			detail: eventRecordRow?.ground ?? eventReadiness.signal,
			gate: eventRecordRow?.boundary ?? eventReadiness.gate,
			href: eventRecordRow?.href ?? '#event-record',
			metric: eventRecordRow?.metric ?? eventReadiness.metric
		},
		{
			id: 'rsvp-intake',
			label: 'RSVP intake',
			state: publicRsvpRow?.state ?? eventReadiness.state,
			title: publicRsvpRow?.handoff ?? 'Public RSVP page',
			action: publicRsvpRow?.action ?? 'publish event',
			detail:
				publicRsvpRow?.ground ??
				'Public RSVP intake stays draft-only until this event is published.',
			gate: publicRsvpRow?.boundary ?? eventReadiness.gate,
			href: publicRsvpRow?.href ?? '#event-publication',
			metric: publicRsvpRow?.metric ?? {
				value: data.event.rsvpCount,
				label: 'stored RSVPs',
				cite: 'eventRsvps.by_eventId'
			}
		},
		{
			id: 'next-event-lift',
			label: 'Next event lift',
			state: nextEventLiftRow?.state ?? eventReadiness.state,
			title: nextEventLiftRow?.handoff ?? eventReadiness.nextGate.name,
			action: nextEventLiftRow?.action ?? 'read event posture',
			detail:
				nextEventLiftRow?.ground ??
				'Attendance proof, waitlist promotion, and archived event artifacts stay bounded by their gates.',
			gate: nextEventLiftRow?.boundary ?? eventReadiness.gate,
			href: nextEventLiftRow?.href ?? '#event-checkin-boundary',
			metric: nextEventLiftRow?.metric ?? {
				value: eventReadiness.nextGate.downstream,
				label: 'downstream gates',
				cite: eventReadiness.nextGate.id
			}
		}
	]);

	function stateLabel(state: CapabilityState): string {
		return operatorCapabilityStateLabel(state);
	}

	function actionLabel(state: CapabilityState, action: string): string {
		return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });
	}

	function pressureCellClass(state: CapabilityState): string {
		const stateClass =
			state === 'live'
				? 'border-teal-500/35 bg-teal-500/10'
				: state === 'partial'
					? 'border-blue-500/30 bg-blue-500/10'
					: state === 'draft-only'
						? 'border-amber-500/30 bg-amber-500/10'
						: 'border-surface-border-strong bg-surface-overlay';
		return `rounded-md border p-3 text-left transition hover:border-text-tertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 ${stateClass}`;
	}

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
			Event records / back
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
						Public page draft-only
					</span>
				{/if}
			</div>
		</div>

		<WorkspaceCapabilityStrip label="Event packet capability" items={capabilityItems} />

		<div class="grid gap-3 md:grid-cols-3" aria-label="Event operating pressure">
			{#each eventPressureReadouts as readout (readout.id)}
				<a
					href={readout.href}
					class={pressureCellClass(readout.state)}
					data-sveltekit-preload-data="off"
					aria-label={`${readout.label}: ${stateLabel(readout.state)}; ${readout.detail}; ${readout.gate}`}
				>
					<span
						class="text-text-quaternary block font-mono text-[0.65rem] tracking-[0.18em] uppercase"
						>{readout.label}</span
					>
					<span class="text-text-primary mt-2 block text-sm font-semibold">{readout.title}</span>
					<span class="text-text-secondary mt-2 flex items-baseline gap-1 text-xs">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="text-text-tertiary mt-2 block text-xs leading-relaxed">
						{readout.detail}
					</span>
					<span class="mt-3 block text-xs font-semibold text-teal-300">
						{actionLabel(readout.state, readout.action)}
					</span>
					<span class="text-text-quaternary mt-2 block text-xs leading-relaxed">
						{readout.gate}
					</span>
				</a>
			{/each}
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
					<p class="text-text-primary text-sm font-medium">Public RSVP surface</p>
					<p class="text-text-tertiary mt-1 max-w-2xl text-sm">
						{#if isPublished}
							This event is accepting encrypted RSVPs through the public page. Public counters
							remain K-floored below five.
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
					<p class="text-text-primary text-sm font-medium">Calendar and roster artifacts</p>
					<p class="text-text-tertiary mt-1 max-w-2xl text-sm">
						ICS exports the event record. CSV exports bounded RSVP/check-in evidence without
						decrypted email or name values. QR image generation, decrypted attendee export, and
						waitlist promotion remain outside this route.
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
			class="rounded-md border border-amber-500/30 bg-amber-500/10 p-4"
		>
			<p class="text-sm font-medium text-amber-300">Check-in boundary</p>
			<p class="text-text-tertiary mt-1 text-sm">
				Attendance verification here means a code matched the event check-in code. QR rendering,
				identity-wallet attendance proof, and decrypted attendee export are not mounted in this
				route.
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
					Check-in code hidden from this role. Ask an editor or owner before claiming verified
					attendance operations.
				</p>
			{/if}
		</div>

		<div id="event-roster">
			<h3 class="text-text-tertiary mb-3 text-sm font-medium">RSVPs ({data.rsvps.length})</h3>
			{#if data.rsvps.length === 0}
				<p
					class="border-surface-border bg-surface-base text-text-tertiary rounded-md border py-8 text-center text-sm"
				>
					No visible RSVP rows yet.
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
