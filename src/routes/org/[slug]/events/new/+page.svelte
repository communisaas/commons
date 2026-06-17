<script lang="ts">
	import { browser } from '$app/environment';
	import type { ActionData, PageData } from './$types';

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
					Events
				</a>
				<span aria-hidden="true">/</span>
				<span>Create</span>
			</nav>
			<h1 class="text-text-primary text-xl font-semibold">Create event</h1>
			<p class="text-text-tertiary mt-1 max-w-2xl text-sm">
				Save the details first. Publishing opens the public RSVP page.
			</p>
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
						Event details
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
								The public RSVP page starts accepting responses as soon as the event is created.
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
								When the event is full, people can join a waitlist.
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
					class="border-surface-border bg-surface-base rounded-md border p-4"
				>
					<p class="text-text-primary text-sm font-medium">Check-in</p>
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
								Attendees check in by entering the event's code at the door.
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
						Calendar (ICS) and attendance (CSV) exports are available from the event page once it's
						created.
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
