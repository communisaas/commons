<script lang="ts">
	import { browser } from '$app/environment';
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import {
		buildEventReadiness,
		getGateEvidence,
		type CapabilityState
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel
	} from '$lib/data/capability-state-labels';
	import { Datum } from '$lib/design';
	import type { ActionData, PageData } from './$types';

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

	let { data, form }: { data: PageData; form?: ActionData } = $props();

	const now = new Date();
	const defaultStart = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
	defaultStart.setMinutes(0, 0, 0);
	const defaultEnd = new Date(defaultStart.getTime() + 2 * 60 * 60 * 1000);

	function toDatetimeLocal(date: Date): string {
		const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
		return local.toISOString().slice(0, 16);
	}

	function toEpochMillis(value: string): string {
		if (!value) return '';
		const parsed = new Date(value).getTime();
		return Number.isFinite(parsed) ? String(parsed) : '';
	}

	let title = $state(form?.values?.title ?? '');
	let description = $state(form?.values?.description ?? '');
	let eventType = $state(form?.values?.event_type ?? 'IN_PERSON');
	let startLocal = $state(form?.values?.start_local ?? toDatetimeLocal(defaultStart));
	let endLocal = $state(form?.values?.end_local ?? toDatetimeLocal(defaultEnd));
	let timezone = $state(form?.values?.timezone ?? 'America/Los_Angeles');
	let venue = $state(form?.values?.venue ?? '');
	let address = $state(form?.values?.address ?? '');
	let city = $state(form?.values?.city ?? '');
	let region = $state(form?.values?.state ?? '');
	let postalCode = $state(form?.values?.postal_code ?? '');
	let virtualUrl = $state(form?.values?.virtual_url ?? '');
	let capacity = $state(form?.values?.capacity ?? '');
	let waitlistEnabled = $state(form?.values?.waitlist_enabled ?? true);
	let requireVerification = $state(form?.values?.require_verification ?? false);
	let publishNow = $state(form?.values?.publish_now ?? false);

	const startAtMs = $derived(toEpochMillis(startLocal));
	const endAtMs = $derived(toEpochMillis(endLocal));
	const isPhysical = $derived(eventType === 'IN_PERSON' || eventType === 'HYBRID');
	const isVirtual = $derived(eventType === 'VIRTUAL' || eventType === 'HYBRID');
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
			context: 'draft',
			event: {
				recordCount: 0,
				publishedCount: publishNow ? 1 : 0,
				draftCount: publishNow ? 0 : 1,
				rsvpCount: 0,
				visibleRsvpRows: null,
				attendeeCount: 0,
				verifiedAttendeeCount: 0,
				status: publishNow ? 'PUBLISHED' : 'DRAFT',
				publishRequested: publishNow,
				waitlistEnabled,
				waitlistEnabledCount: waitlistEnabled ? 1 : 0,
				hasCheckinCode: true,
				hasSavedRecord: false,
				hasCalendarExport: false,
				hasRosterExport: false
			},
			gates: {
				eventRecordGate,
				eventWaitlistGate,
				attendanceProofGate,
				eventArtifactGate
			},
			hrefs: {
				'event-record': '#event-definition',
				'public-rsvp-intake': '#event-publication',
				'waitlist-roster': '#event-waitlist-boundary',
				'checkin-attendance-signal': '#event-checkin-boundary',
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
			href: eventRecordRow?.href ?? '#event-definition',
			metric: eventRecordRow?.metric ?? eventReadiness.metric
		},
		{
			id: 'rsvp-intake',
			label: 'RSVP intake',
			state: publicRsvpRow?.state ?? eventReadiness.state,
			title: publicRsvpRow?.handoff ?? 'Public RSVP page',
			action: publicRsvpRow?.action ?? 'prepare page',
			detail:
				publicRsvpRow?.ground ??
				'Public RSVP intake stays draft-only until the event is published.',
			gate: publicRsvpRow?.boundary ?? eventReadiness.gate,
			href: publicRsvpRow?.href ?? '#event-publication',
			metric: publicRsvpRow?.metric ?? {
				value: publishNow ? 1 : 0,
				label: 'publish intent',
				cite: 'local publish_now state'
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

	$effect(() => {
		if (browser && !form?.values?.timezone) {
			timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone;
		}
	});
</script>

<svelte:head>
	<title>Create event | {data.org.name}</title>
</svelte:head>

<div class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-5xl space-y-6 px-4 py-8">
		<div>
			<nav class="text-text-tertiary mb-3 flex items-center gap-2 text-sm">
				<a href="/org/{data.org.slug}/studio" class="hover:text-text-secondary transition-colors">
					Studio
				</a>
				<span aria-hidden="true">/</span>
				<a href="/org/{data.org.slug}/events" class="hover:text-text-secondary transition-colors">
					Event records
				</a>
				<span aria-hidden="true">/</span>
				<span>Create</span>
			</nav>
			<h1 class="text-text-primary text-xl font-semibold">Create event</h1>
			<p class="text-text-tertiary mt-1 max-w-2xl text-sm">
				Define the event record first. Publishing opens the public RSVP page; check-in remains a
				code-based attendance signal, not a full proof ceremony.
			</p>
		</div>

		<WorkspaceCapabilityStrip label="Event creation capability" items={capabilityItems} />

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

		<form method="POST" class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
			<input type="hidden" name="start_at_ms" value={startAtMs} />
			<input type="hidden" name="end_at_ms" value={endAtMs} />

			<div
				id="event-definition"
				class="border-surface-border bg-surface-base space-y-4 rounded-md border p-5"
			>
				<div>
					<p class="text-text-tertiary font-mono text-xs font-semibold tracking-wider uppercase">
						Event definition
					</p>
					<p class="text-text-tertiary mt-1 text-sm">
						The saved record is the live capability; public intake depends on publication state.
					</p>
				</div>

				<label class="block">
					<span class="text-text-secondary mb-1.5 block text-sm font-medium">Title</span>
					<input
						name="title"
						bind:value={title}
						required
						minlength="3"
						maxlength="200"
						class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-md border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
						placeholder="City hall turnout briefing"
					/>
				</label>

				<label class="block">
					<span class="text-text-secondary mb-1.5 block text-sm font-medium">Description</span>
					<textarea
						name="description"
						bind:value={description}
						rows="4"
						maxlength="5000"
						class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full resize-y rounded-md border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
						placeholder="What people need to know before they RSVP."
					></textarea>
				</label>

				<div class="grid gap-4 sm:grid-cols-3">
					<label class="block">
						<span class="text-text-secondary mb-1.5 block text-sm font-medium">Mode</span>
						<select
							name="event_type"
							bind:value={eventType}
							class="border-surface-border-strong bg-surface-raised text-text-primary w-full rounded-md border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
						>
							<option value="IN_PERSON">In person</option>
							<option value="VIRTUAL">Virtual</option>
							<option value="HYBRID">Hybrid</option>
						</select>
					</label>
					<label class="block">
						<span class="text-text-secondary mb-1.5 block text-sm font-medium">Start</span>
						<input
							name="start_local"
							type="datetime-local"
							bind:value={startLocal}
							required
							class="border-surface-border-strong bg-surface-raised text-text-primary w-full rounded-md border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
						/>
					</label>
					<label class="block">
						<span class="text-text-secondary mb-1.5 block text-sm font-medium">End</span>
						<input
							name="end_local"
							type="datetime-local"
							bind:value={endLocal}
							class="border-surface-border-strong bg-surface-raised text-text-primary w-full rounded-md border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
						/>
					</label>
				</div>

				<label class="block">
					<span class="text-text-secondary mb-1.5 block text-sm font-medium">Timezone</span>
					<input
						name="timezone"
						bind:value={timezone}
						maxlength="64"
						class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-md border px-3 py-2 font-mono text-sm focus:border-teal-500 focus:outline-none"
						placeholder="America/Los_Angeles"
					/>
				</label>

				{#if isPhysical}
					<div class="grid gap-4 sm:grid-cols-2">
						<label class="block">
							<span class="text-text-secondary mb-1.5 block text-sm font-medium">Venue</span>
							<input
								name="venue"
								bind:value={venue}
								maxlength="200"
								class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-md border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
								placeholder="Main library auditorium"
							/>
						</label>
						<label class="block">
							<span class="text-text-secondary mb-1.5 block text-sm font-medium">Address</span>
							<input
								name="address"
								bind:value={address}
								maxlength="200"
								class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-md border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
								placeholder="100 Civic Center Plaza"
							/>
						</label>
						<label class="block">
							<span class="text-text-secondary mb-1.5 block text-sm font-medium">City</span>
							<input
								name="city"
								bind:value={city}
								maxlength="100"
								class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-md border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
							/>
						</label>
						<div class="grid grid-cols-[1fr_7rem] gap-3">
							<label class="block">
								<span class="text-text-secondary mb-1.5 block text-sm font-medium">State</span>
								<input
									name="state"
									bind:value={region}
									maxlength="100"
									class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-md border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
								/>
							</label>
							<label class="block">
								<span class="text-text-secondary mb-1.5 block text-sm font-medium">Postal</span>
								<input
									name="postal_code"
									bind:value={postalCode}
									maxlength="16"
									class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-md border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
								/>
							</label>
						</div>
					</div>
				{/if}

				{#if isVirtual}
					<label class="block">
						<span class="text-text-secondary mb-1.5 block text-sm font-medium">Virtual URL</span>
						<input
							name="virtual_url"
							type="url"
							bind:value={virtualUrl}
							maxlength="2048"
							class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-md border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
							placeholder="https://..."
						/>
					</label>
				{/if}
			</div>

			<div class="space-y-4">
				<div
					id="event-publication"
					class="border-surface-border bg-surface-base rounded-md border p-4"
				>
					<p class="text-text-primary text-sm font-medium">Public intake</p>
					<label class="mt-3 flex items-start gap-3">
						<input
							name="publish_now"
							type="checkbox"
							bind:checked={publishNow}
							class="border-surface-border-strong bg-surface-raised mt-1 h-4 w-4 rounded text-teal-500 focus:ring-teal-500"
						/>
						<span>
							<span class="text-text-secondary block text-sm">Publish immediately</span>
							<span class="text-text-tertiary mt-0.5 block text-xs">
								When checked, /e/[id] accepts encrypted RSVPs after creation.
							</span>
						</span>
					</label>
					<label id="event-waitlist-boundary" class="mt-4 flex scroll-mt-24 items-start gap-3">
						<input
							name="waitlist_enabled"
							type="checkbox"
							bind:checked={waitlistEnabled}
							class="border-surface-border-strong bg-surface-raised mt-1 h-4 w-4 rounded text-teal-500 focus:ring-teal-500"
						/>
						<span>
							<span class="text-text-secondary block text-sm">Allow waitlist</span>
							<span class="text-text-tertiary mt-0.5 block text-xs">
								Waitlisted rows can be stored after save; promotion remains dependency-first.
							</span>
						</span>
					</label>
					<label class="mt-4 block">
						<span class="text-text-secondary mb-1.5 block text-sm font-medium">Capacity</span>
						<input
							name="capacity"
							type="number"
							min="1"
							max="1000000"
							bind:value={capacity}
							class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-md border px-3 py-2 font-mono text-sm focus:border-teal-500 focus:outline-none"
							placeholder="optional"
						/>
					</label>
				</div>

				<div
					id="event-checkin-boundary"
					class="rounded-md border border-amber-500/30 bg-amber-500/10 p-4"
				>
					<p class="text-sm font-medium text-amber-300">Check-in is code-bound</p>
					<label class="mt-3 flex items-start gap-3">
						<input
							name="require_verification"
							type="checkbox"
							bind:checked={requireVerification}
							class="border-surface-border-strong bg-surface-raised mt-1 h-4 w-4 rounded text-teal-500 focus:ring-teal-500"
						/>
						<span>
							<span class="text-text-secondary block text-sm">Require check-in code</span>
							<span class="text-text-tertiary mt-0.5 block text-xs">
								Code matches can increment verified attendance. This is not a mounted mDL/ZK
								attendance flow.
							</span>
						</span>
					</label>
				</div>

				<div
					id="event-export-boundary"
					class="border-surface-border bg-surface-base rounded-md border p-4"
				>
					<p class="text-text-primary text-sm font-medium">Available after save</p>
					<p class="text-text-tertiary mt-1 text-xs leading-5">
						ICS and non-PII attendance CSV exports are available from the event detail route after
						this record exists. QR image generation, decrypted attendee export, and waitlist
						promotion jobs stay off the active sheet.
					</p>
				</div>

				<div class="flex flex-col gap-2">
					<button
						type="submit"
						class="rounded-md bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-500"
					>
						{publishNow ? 'Create and publish' : 'Save draft event'}
					</button>
					<a
						href="/org/{data.org.slug}/events"
						class="text-text-tertiary hover:text-text-primary rounded-md px-4 py-2.5 text-center text-sm transition-colors"
					>
						Cancel
					</a>
				</div>
			</div>
		</form>
	</div>
</div>
