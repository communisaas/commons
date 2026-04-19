<script lang="ts">
	import { browser } from '$app/environment';
	import { FEATURES } from '$lib/config/features';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Step management
	type Step = 'info' | 'amount' | 'checkout' | 'success';
	let currentStep = $state<Step>('info');

	// Form state
	let name = $state('');
	let email = $state('');
	let postalCode = $state('');
	let amountCents = $state(2500);
	let customAmount = $state('');
	let recurring = $state(false);
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

	// Preset amounts
	const presets = [1000, 2500, 5000, 10000];

	// Live stats
	let displayRaised = $state(data.campaign.raisedAmountCents);
	let displayDonors = $state(data.campaign.donorCount);

	// Currency formatting
	function formatCents(cents: number): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: data.campaign.donationCurrency
		}).format(cents / 100);
	}

	// Goal progress
	const goalPercent = $derived(
		data.campaign.goalAmountCents
			? Math.min(100, (displayRaised / data.campaign.goalAmountCents) * 100)
			: null
	);

	// Success detection from Stripe redirect
	$effect(() => {
		if (!browser) return;
		const params = new URLSearchParams(window.location.search);
		if (params.get('success') === 'true') {
			currentStep = 'success';
		}
	});

	// Poll stats every 30s
	$effect(() => {
		if (!browser) return;
		const interval = setInterval(async () => {
			try {
				const res = await fetch(`/api/d/${data.campaign.id}/stats`);
				if (res.ok) {
					const stats = await res.json();
					if (typeof stats.raisedAmountCents === 'number') {
						displayRaised = stats.raisedAmountCents;
					}
					if (typeof stats.donorCount === 'number') {
						displayDonors = stats.donorCount;
					}
				}
			} catch {
				/* ignore polling failures */
			}
		}, 30_000);
		return () => clearInterval(interval);
	});

	// Select preset amount
	function selectAmount(cents: number) {
		amountCents = cents;
		customAmount = '';
	}

	// Handle custom amount input
	function handleCustomAmount() {
		const parsed = parseFloat(customAmount);
		if (!isNaN(parsed) && parsed > 0) {
			amountCents = Math.round(parsed * 100);
		}
	}

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

	// Submit checkout
	async function submitCheckout() {
		submitting = true;
		submitError = '';
		try {
			const body: Record<string, unknown> = {
				email,
				name,
				amountCents,
				recurring,
				postalCode
			};
			if (recurring) body.recurringInterval = 'month';
			if (districtCode) body.districtCode = districtCode;

			const res = await fetch(`/api/d/${data.campaign.id}/checkout`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (res.ok) {
				const result = await res.json();
				if (result.url) {
					window.location.href = result.url;
				}
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

	// Share
	async function shareDonation() {
		const url = window.location.origin + `/d/${data.campaign.id}`;
		if (navigator.share) {
			await navigator.share({
				title: data.campaign.title,
				text: `Support ${data.campaign.title}`,
				url
			}).catch(() => {});
		} else {
			await navigator.clipboard.writeText(url);
		}
	}
</script>

<svelte:head>
	<title>{data.campaign.title} | {data.campaign.orgName}</title>
</svelte:head>

<main class="mx-auto min-h-[80vh] max-w-lg px-4 py-6">
	{#if currentStep === 'info'}
		<!-- Campaign Info -->
		<div class="mb-6">
			<p class="mb-1 text-sm text-slate-500">{data.campaign.orgName}</p>
			<h1 class="text-2xl font-bold text-slate-900">{data.campaign.title}</h1>
		</div>

		{#if data.campaign.body}
			<div class="mb-6">
				<p class="whitespace-pre-line text-sm leading-relaxed text-slate-600">{data.campaign.body}</p>
			</div>
		{/if}

		<!-- Fundraising Progress -->
		<div class="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-2xl font-bold text-slate-900">{formatCents(displayRaised)}</p>
					<p class="text-sm text-slate-500">
						raised
						{#if data.campaign.goalAmountCents}
							<span class="text-slate-400">of {formatCents(data.campaign.goalAmountCents)} goal</span>
						{/if}
					</p>
				</div>
				<div class="text-right">
					<p class="text-lg font-bold text-slate-700">{displayDonors}</p>
					<p class="text-xs text-slate-500">{displayDonors === 1 ? 'donor' : 'donors'}</p>
				</div>
			</div>
			{#if goalPercent !== null}
				<div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
					<div
						class="h-full rounded-full bg-slate-700 transition-all duration-500"
						style="width: {goalPercent}%"
					></div>
				</div>
			{/if}
		</div>

		<button
			onclick={() => (currentStep = 'amount')}
			class="w-full rounded-lg bg-slate-900 px-6 py-3 text-base font-semibold text-white hover:bg-slate-800"
		>
			Donate
		</button>

	{:else if currentStep === 'amount'}
		<!-- Amount Selection -->
		<button onclick={() => (currentStep = 'info')} class="mb-4 text-sm text-slate-500 hover:text-slate-700">
			&larr; Back
		</button>
		<h2 class="mb-6 text-2xl font-bold text-slate-900">Choose Amount</h2>

		<div class="mb-4 grid grid-cols-2 gap-3">
			{#each presets as preset}
				<button
					onclick={() => selectAmount(preset)}
					class="rounded-lg border px-4 py-3 text-base font-semibold transition-colors {amountCents === preset && !customAmount ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-700 hover:border-slate-400'}"
				>
					{formatCents(preset)}
				</button>
			{/each}
		</div>

		<div class="mb-4">
			<label for="customAmount" class="mb-1 block text-sm font-medium text-slate-700">Custom Amount</label>
			<div class="relative">
				<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
				<input
					id="customAmount"
					type="number"
					min="1"
					step="0.01"
					bind:value={customAmount}
					oninput={handleCustomAmount}
					class="w-full rounded-lg border border-slate-300 py-2.5 pl-7 pr-3 text-sm focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
					placeholder="Other amount"
				/>
			</div>
		</div>

		<div class="mb-6">
			<label class="flex cursor-pointer items-center gap-3">
				<input
					type="checkbox"
					bind:checked={recurring}
					class="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
				/>
				<span class="text-sm text-slate-700">Make this a monthly donation</span>
			</label>
		</div>

		<button
			onclick={() => {
				if (amountCents < 100) return;
				currentStep = 'checkout';
			}}
			disabled={amountCents < 100}
			class="w-full rounded-lg bg-slate-900 px-6 py-3 text-base font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
		>
			Continue with {formatCents(amountCents)}
		</button>

	{:else if currentStep === 'checkout'}
		<!-- Checkout -->
		<button onclick={() => (currentStep = 'amount')} class="mb-4 text-sm text-slate-500 hover:text-slate-700">
			&larr; Back
		</button>
		<h2 class="mb-6 text-2xl font-bold text-slate-900">Your Information</h2>

		<div class="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
			<p class="text-sm text-slate-500">
				{recurring ? 'Monthly donation' : 'One-time donation'}: <span class="font-semibold text-slate-900">{formatCents(amountCents)}</span>
			</p>
		</div>

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

		{#if submitError}
			<p class="mt-4 text-sm text-red-600">{submitError}</p>
		{/if}

		<button
			onclick={submitCheckout}
			disabled={submitting || !name.trim() || !email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
			class="mt-6 w-full rounded-lg bg-slate-900 px-6 py-3 text-base font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
		>
			{submitting ? 'Processing...' : `Proceed to Payment - ${formatCents(amountCents)}`}
		</button>

	{:else if currentStep === 'success'}
		<!-- Success -->
		<div class="text-center">
			<div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
				<svg class="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
			</div>
			<h2 class="mb-2 text-2xl font-bold text-slate-900">Thank you for your donation!</h2>
			<p class="mb-6 text-sm text-slate-500">A receipt will be sent to your email</p>
		</div>

		<!-- Proof Card -->
		<div class="mb-6 rounded-lg border border-slate-200 bg-white p-5">
			<p class="mb-1 text-xs font-medium text-slate-400">DONATION CONFIRMATION</p>
			<h3 class="mb-3 text-lg font-bold text-slate-900">{data.campaign.title}</h3>
			<div class="space-y-2 text-sm text-slate-600">
				<p>{data.campaign.orgName}</p>
			</div>
			<div class="mt-3 border-t border-slate-100 pt-3">
				<p class="text-xs text-slate-400">
					{formatCents(displayRaised)} raised from {displayDonors} {displayDonors === 1 ? 'donor' : 'donors'}
				</p>
			</div>
		</div>

		<!-- Actions -->
		<div class="space-y-3">
			<button
				onclick={shareDonation}
				class="w-full rounded-lg border border-slate-300 px-6 py-3 text-base font-semibold text-slate-700 hover:bg-slate-50"
			>
				Share
			</button>
		</div>
	{/if}
</main>
