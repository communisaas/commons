<script lang="ts">
	import { browser } from '$app/environment';
	import { FEATURES } from '$lib/config/features';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Step management
	type Step = 'details' | 'identify' | 'confirm' | 'success';
	let currentStep = $state<Step>('details');

	// Form state
	let name = $state('');
	let email = $state('');
	let postalCode = $state('');
	let submitting = $state(false);
	let submitError = $state('');

	// District verification state
	const districtEnabled = FEATURES.ADDRESS_SPECIFICITY === 'district';
	let districtStreet = $state('');
	let districtCity = $state('');
	let districtState = $state('');
	let districtZip = $state('');
	let districtCode = $state('');
	let districtVerified = $state(false);
	let districtVerifying = $state(false);
	let districtError = $state('');

	// Live RSVP count
	let displayCount = $state(data.event.rsvpCount);

	// Format date with timezone
	function formatDate(iso: string): string {
		const d = new Date(iso);
		return new Intl.DateTimeFormat('en-US', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			timeZone: data.event.timezone,
			timeZoneName: 'short'
		}).format(d);
	}

	// Capacity helpers
	const isFull = $derived(data.event.capacity !== null && displayCount >= data.event.capacity);
	const spotsLeft = $derived(
		data.event.capacity !== null ? Math.max(0, data.event.capacity - displayCount) : null
	);

	// Location display
	const locationDisplay = $derived(
		data.event.venue
			? [data.event.venue, data.event.address, data.event.city, data.event.state]
					.filter(Boolean)
					.join(', ')
			: null
	);

	// Poll stats every 30s
	$effect(() => {
		if (!browser) return;
		const interval = setInterval(async () => {
			try {
				const res = await fetch(`/api/e/${data.event.id}/stats`);
				if (res.ok) {
					const stats = await res.json();
					if (typeof stats.rsvpCount === 'number') {
						displayCount = stats.rsvpCount;
					}
				}
			} catch {
				/* ignore polling failures */
			}
		}, 30_000);
		return () => clearInterval(interval);
	});

	// District verification
	async function verifyDistrict() {
		if (!districtStreet || !districtCity || !districtState || !districtZip) {
			districtError = 'All address fields are required';
			return;
		}
		districtVerifying = true;
		districtError = '';
		try {
			const params = new URLSearchParams({
				street: districtStreet,
				city: districtCity,
				state: districtState,
				zip: districtZip
			});
			const res = await fetch(`/api/c/verify-district?${params}`);
			if (res.ok) {
				const result = await res.json();
				if (result.districtCode) {
					districtCode = result.districtCode;
					districtVerified = true;
				} else {
					districtError = 'Could not determine district from address';
				}
			} else {
				districtError = 'Verification failed. Please check your address.';
			}
		} catch {
			districtError = 'Network error. Please try again.';
		} finally {
			districtVerifying = false;
		}
	}

	// Submit RSVP
	async function submitRsvp() {
		submitting = true;
		submitError = '';
		try {
			const body: Record<string, string> = { name, email };
			if (postalCode) body.postalCode = postalCode;
			if (districtCode) body.districtCode = districtCode;

			const res = await fetch(`/api/e/${data.event.id}/rsvp`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (res.ok) {
				const result = await res.json();
				if (typeof result.rsvpCount === 'number') {
					displayCount = result.rsvpCount;
				}
				currentStep = 'success';
			} else {
				const err = await res.json().catch(() => null);
				submitError = err?.error ?? 'Something went wrong. Please try again.';
			}
		} catch {
			submitError = 'Network error. Please try again.';
		} finally {
			submitting = false;
		}
	}

	// Calendar link (Google Calendar)
	const calendarUrl = $derived(() => {
		const start = data.event.startAt.replace(/[-:]/g, '').replace('.000Z', 'Z');
		const end = data.event.endAt
			? data.event.endAt.replace(/[-:]/g, '').replace('.000Z', 'Z')
			: start;
		const loc = locationDisplay ?? data.event.virtualUrl ?? '';
		return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(data.event.title)}&dates=${start}/${end}&location=${encodeURIComponent(loc)}&details=${encodeURIComponent(data.event.description ?? '')}`;
	});

	// Share
	async function shareEvent() {
		if (navigator.share) {
			await navigator.share({
				title: data.event.title,
				text: `RSVP for ${data.event.title}`,
				url: window.location.href
			}).catch(() => {});
		} else {
			await navigator.clipboard.writeText(window.location.href);
		}
	}
</script>

<svelte:head>
	<title>{data.event.title} | {data.event.orgName}</title>
</svelte:head>

<main class="mx-auto min-h-[80vh] max-w-lg px-4 py-6">
	{#if currentStep === 'details'}
		<!-- Event Details -->
		<div class="mb-6">
			<p class="mb-1 text-sm text-slate-500">{data.event.orgName}</p>
			<h1 class="text-2xl font-bold text-slate-900">{data.event.title}</h1>
		</div>

		<div class="mb-6 space-y-3">
			<!-- Date/Time -->
			<div class="flex items-start gap-3">
				<div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
					<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
				</div>
				<div>
					<p class="text-sm font-medium text-slate-900">{formatDate(data.event.startAt)}</p>
					{#if data.event.endAt}
						<p class="text-sm text-slate-500">to {formatDate(data.event.endAt)}</p>
					{/if}
				</div>
			</div>

			<!-- Location -->
			{#if locationDisplay}
				<div class="flex items-start gap-3">
					<div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
					</div>
					<p class="text-sm text-slate-700">{locationDisplay}</p>
				</div>
			{/if}

			<!-- Virtual Link -->
			{#if data.event.virtualUrl && (data.event.eventType === 'VIRTUAL' || data.event.eventType === 'HYBRID')}
				<div class="flex items-start gap-3">
					<div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
					</div>
					<p class="text-sm text-slate-700">Virtual event</p>
				</div>
			{/if}

			<!-- Event Type Badge -->
			<div class="flex items-center gap-2">
				<span class="font-mono text-xs text-slate-700">
					{data.event.eventType === 'IN_PERSON' ? 'In Person' : data.event.eventType === 'VIRTUAL' ? 'Virtual' : 'Hybrid'}
				</span>
				{#if data.event.requireVerification}
					<span class="font-mono text-xs text-amber-700">
						Verified Attendance
					</span>
				{/if}
			</div>
		</div>

		<!-- Description -->
		{#if data.event.description}
			<div class="mb-6">
				<p class="whitespace-pre-line text-sm leading-relaxed text-slate-600">{data.event.description}</p>
			</div>
		{/if}

		<!-- RSVP Count -->
		<div class="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-2xl font-bold text-slate-900">{displayCount}</p>
					<p class="text-sm text-slate-500">
						{displayCount === 1 ? 'person' : 'people'} attending
						{#if data.event.capacity}
							<span class="text-slate-400">/ {data.event.capacity} spots</span>
						{/if}
					</p>
				</div>
				{#if spotsLeft !== null && spotsLeft <= 10 && spotsLeft > 0}
					<span class="text-sm font-medium text-amber-600">{spotsLeft} spots left</span>
				{/if}
			</div>
			{#if data.event.capacity}
				<div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
					<div
						class="h-full rounded-full bg-slate-700 transition-all duration-500"
						style="width: {Math.min(100, (displayCount / data.event.capacity) * 100)}%"
					></div>
				</div>
			{/if}
		</div>

		<!-- RSVP Button -->
		{#if data.event.status === 'CANCELLED'}
			<div class="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
				<p class="font-medium text-red-700">This event has been cancelled</p>
			</div>
		{:else if data.event.status === 'COMPLETED'}
			<div class="rounded-lg border border-blue-200 bg-blue-50 p-4 text-center">
				<p class="font-medium text-blue-700">This event has ended</p>
			</div>
		{:else if isFull && !data.event.waitlistEnabled}
			<div class="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
				<p class="font-medium text-slate-700">This event is full</p>
			</div>
		{:else}
			<button
				onclick={() => (currentStep = 'identify')}
				class="w-full rounded-lg bg-slate-900 px-6 py-3 text-base font-semibold text-white hover:bg-slate-800"
			>
				{isFull ? 'Join Waitlist' : 'RSVP'}
			</button>
		{/if}

	{:else if currentStep === 'identify'}
		<!-- Identify Step -->
		<button onclick={() => (currentStep = 'details')} class="mb-4 text-sm text-slate-500 hover:text-slate-700">
			&larr; Back
		</button>
		<h2 class="mb-6 text-2xl font-bold text-slate-900">Your Information</h2>

		<div class="space-y-4">
			<div>
				<label for="name" class="mb-1 block text-sm font-medium text-slate-700">Name</label>
				<input
					id="name"
					type="text"
					bind:value={name}
					required
					class="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
					placeholder="Your full name"
				/>
			</div>

			<div>
				<label for="email" class="mb-1 block text-sm font-medium text-slate-700">Email</label>
				<input
					id="email"
					type="email"
					bind:value={email}
					required
					class="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
					placeholder="you@example.com"
				/>
			</div>

			<div>
				<label for="postalCode" class="mb-1 block text-sm font-medium text-slate-700">
					Postal Code <span class="text-slate-400">(optional)</span>
				</label>
				<input
					id="postalCode"
					type="text"
					bind:value={postalCode}
					class="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
					placeholder="12345"
				/>
			</div>

			<!-- District Verification -->
			{#if districtEnabled}
				<div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
					<p class="mb-3 text-sm font-medium text-slate-700">District Verification (optional)</p>
					<div class="space-y-3">
						<input
							type="text"
							bind:value={districtStreet}
							placeholder="Street address"
							class="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
						/>
						<div class="grid grid-cols-3 gap-2">
							<input
								type="text"
								bind:value={districtCity}
								placeholder="City"
								class="rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
							/>
							<input
								type="text"
								bind:value={districtState}
								placeholder="State"
								class="rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
							/>
							<input
								type="text"
								bind:value={districtZip}
								placeholder="ZIP"
								class="rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
							/>
						</div>
						{#if districtVerified}
							<p class="text-sm text-green-600">District verified: {districtCode}</p>
						{:else}
							<button
								onclick={verifyDistrict}
								disabled={districtVerifying}
								class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
							>
								{districtVerifying ? 'Verifying...' : 'Verify District'}
							</button>
						{/if}
						{#if districtError}
							<p class="text-sm text-red-600">{districtError}</p>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<button
			onclick={() => {
				if (!name.trim() || !email.trim()) return;
				if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
				currentStep = 'confirm';
			}}
			disabled={!name.trim() || !email.trim()}
			class="mt-6 w-full rounded-lg bg-slate-900 px-6 py-3 text-base font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
		>
			Continue
		</button>

	{:else if currentStep === 'confirm'}
		<!-- Confirm Step -->
		<button onclick={() => (currentStep = 'identify')} class="mb-4 text-sm text-slate-500 hover:text-slate-700">
			&larr; Back
		</button>
		<h2 class="mb-6 text-2xl font-bold text-slate-900">Confirm RSVP</h2>

		<div class="mb-6 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
			<div>
				<p class="text-xs font-medium text-slate-500">Event</p>
				<p class="text-sm font-medium text-slate-900">{data.event.title}</p>
			</div>
			<div>
				<p class="text-xs font-medium text-slate-500">Date</p>
				<p class="text-sm text-slate-700">{formatDate(data.event.startAt)}</p>
			</div>
			{#if locationDisplay}
				<div>
					<p class="text-xs font-medium text-slate-500">Location</p>
					<p class="text-sm text-slate-700">{locationDisplay}</p>
				</div>
			{/if}
			<div>
				<p class="text-xs font-medium text-slate-500">Name</p>
				<p class="text-sm text-slate-700">{name}</p>
			</div>
			<div>
				<p class="text-xs font-medium text-slate-500">Email</p>
				<p class="text-sm text-slate-700">{email}</p>
			</div>
			{#if districtVerified}
				<div>
					<p class="text-xs font-medium text-slate-500">District</p>
					<p class="text-sm text-green-600">{districtCode} (verified)</p>
				</div>
			{/if}
		</div>

		{#if submitError}
			<p class="mb-4 text-sm text-red-600">{submitError}</p>
		{/if}

		<button
			onclick={submitRsvp}
			disabled={submitting}
			class="w-full rounded-lg bg-slate-900 px-6 py-3 text-base font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
		>
			{submitting ? 'Submitting...' : isFull ? 'Join Waitlist' : 'Confirm RSVP'}
		</button>

	{:else if currentStep === 'success'}
		<!-- Success Step -->
		<div class="text-center">
			<div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
				<svg class="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
			</div>
			<h2 class="mb-2 text-2xl font-bold text-slate-900">
				{isFull ? "You're on the waitlist!" : "You're RSVP'd!"}
			</h2>
			<p class="mb-6 text-sm text-slate-500">We'll send a confirmation to {email}</p>
		</div>

		<!-- Proof Card -->
		<div class="mb-6 rounded-lg border border-slate-200 bg-white p-5">
			<p class="mb-1 text-xs font-medium text-slate-400">RSVP CONFIRMATION</p>
			<h3 class="mb-3 text-lg font-bold text-slate-900">{data.event.title}</h3>
			<div class="space-y-2 text-sm text-slate-600">
				<p>{formatDate(data.event.startAt)}</p>
				{#if locationDisplay}
					<p>{locationDisplay}</p>
				{/if}
				<p class="font-medium text-slate-900">{name}</p>
			</div>
			<div class="mt-3 border-t border-slate-100 pt-3">
				<p class="text-xs text-slate-400">{displayCount} {displayCount === 1 ? 'person' : 'people'} attending</p>
			</div>
		</div>

		<!-- Actions -->
		<div class="space-y-3">
			<a
				href={calendarUrl()}
				target="_blank"
				rel="noopener noreferrer"
				class="block w-full rounded-lg border border-slate-300 px-6 py-3 text-center text-base font-semibold text-slate-700 hover:bg-slate-50"
			>
				Add to Calendar
			</a>
			<button
				onclick={shareEvent}
				class="w-full rounded-lg border border-slate-300 px-6 py-3 text-base font-semibold text-slate-700 hover:bg-slate-50"
			>
				Share Event
			</button>
		</div>
	{/if}
</main>
