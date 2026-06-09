<script lang="ts">
	import EventCard from '$lib/components/events/EventCard.svelte';
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
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

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

	const eventCount = $derived(data.events.length);
	const publishedCount = $derived(
		data.events.filter((event) => event.status === 'PUBLISHED').length
	);
	const draftCount = $derived(data.events.filter((event) => event.status === 'DRAFT').length);
	const waitlistEnabledCount = $derived(
		data.events.filter((event) => event.waitlistEnabled).length
	);
	const rsvpCount = $derived(data.events.reduce((sum, event) => sum + event.rsvpCount, 0));
	const verifiedAttendeeCount = $derived(
		data.events.reduce((sum, event) => sum + event.verifiedAttendees, 0)
	);
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
			context: 'index',
			event: {
				recordCount: eventCount,
				publishedCount,
				draftCount,
				rsvpCount,
				visibleRsvpRows: null,
				attendeeCount: null,
				verifiedAttendeeCount,
				status: null,
				publishRequested: null,
				waitlistEnabled: null,
				waitlistEnabledCount,
				hasCheckinCode: null,
				hasSavedRecord: eventCount > 0,
				hasCalendarExport: eventCount > 0,
				hasRosterExport: eventCount > 0
			},
			gates: {
				eventRecordGate,
				eventWaitlistGate,
				attendanceProofGate,
				eventArtifactGate
			},
			hrefs: {
				'event-record': `/org/${data.org.slug}/events/new`,
				'public-rsvp-intake': '#event-records',
				'waitlist-roster': `/org/${data.org.slug}/events/new#event-waitlist-boundary`,
				'checkin-attendance-signal': '#event-records',
				'calendar-roster-artifacts': '#event-export-boundary'
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
			href: eventRecordRow?.href ?? `/org/${data.org.slug}/events/new`,
			metric: eventRecordRow?.metric ?? eventReadiness.metric
		},
		{
			id: 'rsvp-intake',
			label: 'RSVP intake',
			state: publicRsvpRow?.state ?? eventReadiness.state,
			title: publicRsvpRow?.handoff ?? 'Public RSVP page',
			action: publicRsvpRow?.action ?? 'publish event',
			detail:
				publicRsvpRow?.ground ?? 'Public RSVP intake stays draft-only until an event is published.',
			gate: publicRsvpRow?.boundary ?? eventReadiness.gate,
			href: publicRsvpRow?.href ?? '#event-records',
			metric: publicRsvpRow?.metric ?? {
				value: publishedCount,
				label: 'published events',
				cite: 'events.status'
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
			href: nextEventLiftRow?.href ?? '#event-export-boundary',
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
</script>

<svelte:head>
	<title>Event records | {data.org.name}</title>
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
					<span>Event records</span>
				</nav>
				<h1 class="text-text-primary text-xl font-semibold">Event records</h1>
				<p class="text-text-tertiary mt-1 max-w-2xl text-sm">
					Use events as a SEND mode for public RSVP intake and attendance evidence. Logistics stay
					separate from stronger proof claims.
				</p>
			</div>
			<a
				href="/org/{data.org.slug}/events/new"
				class="bg-surface-overlay text-text-primary hover:bg-surface-base rounded-md px-4 py-2 text-sm font-semibold transition-colors"
			>
				Create event
			</a>
		</div>

		<WorkspaceCapabilityStrip label="Event capability" items={capabilityItems} />

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

		<div
			id="event-export-boundary"
			class="border-surface-border bg-surface-base rounded-md border px-4 py-3"
		>
			<p class="text-text-primary text-sm font-medium">Export boundary</p>
			<p class="text-text-tertiary mt-1 text-sm">
				Event records, encrypted RSVPs, check-in counters, org-side ICS downloads, and non-PII
				attendance CSV exports are live on each event detail route. QR image generation, decrypted
				attendee export, and waitlist auto-promotion remain off the active sheet.
			</p>
		</div>

		{#if data.events.length === 0}
			<div class="border-surface-border bg-surface-base rounded-md border py-14 text-center">
				<p class="text-text-primary text-base font-medium">No event records yet.</p>
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
						<p class="text-text-tertiary text-xs">stored RSVPs</p>
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
