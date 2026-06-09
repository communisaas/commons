<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { FEATURES } from '$lib/config/features';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);
	let postalCode = $state('');
	let districtStreet = $state('');
	let districtCity = $state('');
	let districtState = $state('');
	let districtZip = $state('');
	let districtCode = $state('');
	let h3Cell = $state('');
	let atlasVersion = $state('');
	let districtVerified = $state(false);
	let districtVerifying = $state(false);
	let districtError = $state('');

	// URL param customization
	const bgColor = $derived($page.url.searchParams.get('bg') || 'ffffff');
	const accentColor = $derived($page.url.searchParams.get('accent') || '0d9488');
	const hideCount = $derived($page.url.searchParams.get('hide_count') === '1');

	// Sanitize hex colors — strip # prefix and only allow hex chars
	function sanitizeHex(hex: string): string {
		const clean = hex.replace(/^#/, '').replace(/[^0-9a-fA-F]/g, '');
		// Accept 3 or 6 char hex
		if (clean.length === 3 || clean.length === 6) return clean;
		return '';
	}

	const safeBg = $derived(sanitizeHex(bgColor));
	const safeAccent = $derived(sanitizeHex(accentColor));
	const districtEvidenceEnabled = $derived(FEATURES.ADDRESS_SPECIFICITY === 'district');

	async function verifyDistrictEvidence() {
		if (districtVerifying) return;
		if (
			!districtStreet.trim() ||
			!districtCity.trim() ||
			!districtState.trim() ||
			!districtZip.trim()
		) {
			districtError = 'Enter a complete address to attach district evidence.';
			return;
		}

		districtVerifying = true;
		districtError = '';
		districtCode = '';
		h3Cell = '';
		atlasVersion = '';
		districtVerified = false;

		try {
			const res = await fetch(`/api/c/${data.campaign.id}/verify-district`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					street: districtStreet.trim(),
					city: districtCity.trim(),
					state: districtState.trim().toUpperCase(),
					zip: districtZip.trim()
				})
			});

			const result = await res.json();
			if (!res.ok || !result.resolved || !result.district?.code) {
				districtError = result.error || 'District evidence could not be attached.';
				return;
			}

			districtCode = result.district.code;
			h3Cell = result.h3Cell ?? '';
			atlasVersion = result.atlasVersion ?? '';
			districtVerified = true;
			postalCode = districtZip.trim();
		} catch {
			districtError = 'District evidence is temporarily unavailable.';
		} finally {
			districtVerifying = false;
		}
	}

	// Send postMessage to parent on success
	$effect(() => {
		if (browser && form?.success && window.parent !== window) {
			window.parent.postMessage(
				{
					type: 'commons:action',
					campaignId: data.campaign.id,
					actionCount: form.actionCount
				},
				'*'
			);
		}
	});

	// Button label based on campaign type
	const buttonLabel = $derived(
		data.campaign.type === 'EVENT'
			? 'RSVP'
			: data.campaign.type === 'LETTER'
				? 'Send Letter'
				: 'Take Action'
	);
</script>

<div
	class="min-h-screen p-4 sm:p-6"
	style:background-color={safeBg ? `#${safeBg}` : '#ffffff'}
>
	<div class="mx-auto max-w-lg">
		{#if form?.success}
			<!-- Success state -->
			<div class="rounded-md border border-emerald-200 bg-emerald-50 p-6 text-center">
				<div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
					<svg class="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
					</svg>
				</div>
				<h2 class="text-lg font-semibold text-emerald-900">Action Recorded</h2>
				<p class="mt-1 text-sm text-emerald-700">
					Thank you for taking action with {data.campaign.orgName}.
				</p>
				{#if !hideCount && typeof form.actionCount === 'number'}
					<p class="mt-3 font-mono text-sm text-emerald-600">
						{form.actionCount} verified {form.actionCount === 1 ? 'action' : 'actions'} taken
					</p>
				{/if}
			</div>
		{:else}
			<!-- Campaign header -->
			<div class="mb-5">
				<p class="text-xs font-medium uppercase tracking-wider text-gray-400">
					{data.campaign.orgName}
				</p>
				<h1 class="mt-1 text-xl font-bold text-gray-900 sm:text-2xl">
					{data.campaign.title}
				</h1>
				{#if data.campaign.body}
					<p class="mt-2 text-sm leading-relaxed text-gray-600">
						{data.campaign.body}
					</p>
				{/if}
			</div>

			<!-- Verified action count -->
			{#if !hideCount && data.campaign.verifiedActions > 0}
				<div class="mb-5 flex items-center gap-2">
					<div
						class="h-2 w-2 rounded-full"
						style:background-color={safeAccent ? `#${safeAccent}` : '#0d9488'}
					></div>
					<span class="font-mono text-sm text-gray-500">
						{data.campaign.verifiedActions} verified {data.campaign.verifiedActions === 1 ? 'action' : 'actions'} taken
					</span>
				</div>
			{/if}

			<!-- Error display -->
			{#if form?.error}
				<div class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
					{form.error}
				</div>
			{/if}

			<!-- Action form -->
			<form
				method="POST"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						submitting = false;
						await update();
					};
				}}
				class="space-y-4"
			>
				<!-- Name -->
				<div>
					<label for="name" class="block text-sm font-medium text-gray-700">
						Name <span class="text-red-500">*</span>
					</label>
					<input
						type="text"
						id="name"
						name="name"
						required
						autocomplete="name"
						placeholder="Your full name"
						class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
					/>
				</div>

				<!-- Email -->
				<div>
					<label for="email" class="block text-sm font-medium text-gray-700">
						Email <span class="text-red-500">*</span>
					</label>
					<input
						type="email"
						id="email"
						name="email"
						required
						autocomplete="email"
						placeholder="you@example.com"
						class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
					/>
				</div>

				<!-- Postal code (optional) -->
				<div>
					<label for="postalCode" class="block text-sm font-medium text-gray-700">
						Postal Code
						<span class="text-gray-400 font-normal">(optional)</span>
					</label>
					<input
						type="text"
						id="postalCode"
						name="postalCode"
						bind:value={postalCode}
						autocomplete="postal-code"
						placeholder="e.g. 90210"
						class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
					/>
				</div>

				{#if districtEvidenceEnabled}
					<div class="rounded-md border border-gray-200 bg-gray-50 p-3">
						<details>
							<summary class="cursor-pointer text-sm font-medium text-gray-700">
								Add district evidence
							</summary>
							<div class="mt-3 grid gap-3">
								<div>
									<label for="districtStreet" class="block text-xs font-medium text-gray-600">
										Street address
									</label>
									<input
										type="text"
										id="districtStreet"
										bind:value={districtStreet}
										autocomplete="street-address"
										placeholder="123 Main Street"
										class="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
									/>
								</div>
								<div>
									<label for="districtCity" class="block text-xs font-medium text-gray-600">
										City
									</label>
									<input
										type="text"
										id="districtCity"
										bind:value={districtCity}
										autocomplete="address-level2"
										placeholder="City"
										class="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
									/>
								</div>
								<div class="grid grid-cols-2 gap-3">
									<div>
										<label for="districtState" class="block text-xs font-medium text-gray-600">
											State
										</label>
										<input
											type="text"
											id="districtState"
											bind:value={districtState}
											autocomplete="address-level1"
											placeholder="CA"
											maxlength="2"
											class="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
										/>
									</div>
									<div>
										<label for="districtZip" class="block text-xs font-medium text-gray-600">
											ZIP
										</label>
										<input
											type="text"
											id="districtZip"
											bind:value={districtZip}
											autocomplete="postal-code"
											placeholder="90210"
											maxlength="10"
											class="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
										/>
									</div>
								</div>

								{#if districtError}
									<p class="text-xs text-red-600" role="alert">{districtError}</p>
								{/if}
								{#if districtVerified}
									<p class="font-mono text-xs text-emerald-700">
										District evidence attached: {districtCode}
									</p>
								{/if}

								<button
									type="button"
									onclick={verifyDistrictEvidence}
									disabled={districtVerifying ||
										!districtStreet.trim() ||
										!districtCity.trim() ||
										!districtState.trim() ||
										!districtZip.trim()}
									class="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition-colors hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
								>
									{districtVerifying ? 'Attaching...' : 'Attach district evidence'}
								</button>
							</div>
						</details>
					</div>
				{/if}

				{#if districtEvidenceEnabled && districtVerified}
					<input type="hidden" name="districtCode" value={districtCode} />
					<input type="hidden" name="h3Cell" value={h3Cell} />
					<input type="hidden" name="atlasVersion" value={atlasVersion} />
				{/if}

				<!-- Message textarea for LETTER type -->
				{#if data.campaign.type === 'LETTER'}
					<div>
						<label for="message" class="block text-sm font-medium text-gray-700">
							Your Message
							<span class="text-gray-400 font-normal">(optional)</span>
						</label>
						<textarea
							id="message"
							name="message"
							rows="4"
							placeholder="Add a personal message..."
							class="mt-1 block w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
						>{data.campaign.body ?? ''}</textarea>
					</div>
				{/if}

				<!-- Submit button -->
				<button
					type="submit"
					disabled={submitting}
					class="flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white shadow-sm transition-opacity disabled:opacity-60"
					style:background-color={safeAccent ? `#${safeAccent}` : '#0d9488'}
				>
					{#if submitting}
						<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
						</svg>
						Submitting...
					{:else}
						{buttonLabel}
					{/if}
				</button>
			</form>

			<!-- Powered by footer -->
			<p class="mt-6 text-center text-xs text-gray-400">
				Powered by <a href="https://commons.email" target="_blank" rel="noopener noreferrer" class="underline hover:text-gray-500">commons.email</a>
			</p>
		{/if}
	</div>
</div>
