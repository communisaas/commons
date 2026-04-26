<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { MapPin, CheckCircle2, AlertCircle, Loader2, Home } from '@lucide/svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import type { AddressVerificationResult, Representative } from '$lib/types/any-replacements.js';
	import type { Representative as ProviderRepresentative } from '$lib/core/legislative/types';
	import { FEATURES } from '$lib/config/features';
	import { getFullCellDataFromBrowser } from '$lib/core/shadow-atlas/browser-client';
	import { poseidon2Sponge24 } from '$lib/core/crypto/poseidon';
	let {
		_template,
		oncomplete
	}: {
		_template: {
			title: string;
			deliveryMethod: string;
		};
		oncomplete?: (data: {
			address: string;
			verified: boolean;
			streetAddress: string;
			city: string;
			state: string;
			zip: string;
			representatives?: Representative[] | ProviderRepresentative[];
		}) => void;
	} = $props();

	let currentStep = $state<'collect' | 'verify' | 'complete'>('collect');

	// Address form data
	let streetAddress = $state('');
	let city = $state('');
	let stateCode = $state('');
	let zipCode = $state('');
	let addressError = $state('');
	let isVerifying = $state(false);
	let isSaving = $state(false);
	let verificationResult = $state<AddressVerificationResult | null>(null);
	let selectedAddress = $state('');

	// ZKP: Poseidon2 commitment over 24 district slots (computed client-side)
	let districtCommitment = $state<string | null>(null);
	let commitmentSlotCount = $state(0);

	function validateAddress(): boolean {
		addressError = '';

		if (!streetAddress.trim()) {
			addressError = 'Please enter your street address';
			return false;
		}
		if (!city.trim()) {
			addressError = 'Please enter your city';
			return false;
		}
		if (!stateCode.trim()) {
			addressError = 'Please enter your state';
			return false;
		}
		if (!zipCode.trim() || !/^\d{5}(-\d{4})?$/.test(zipCode)) {
			addressError = 'Please enter a valid ZIP code';
			return false;
		}

		return true;
	}

	async function verifyAddress() {
		if (!validateAddress()) return;

		isVerifying = true;
		addressError = '';

		try {
			const fullAddress = `${streetAddress}, ${city}, ${stateCode} ${zipCode}`;

			// Unified address resolution: geocode + district + officials in one call
			const response = await fetch('/api/location/resolve-address', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					street: streetAddress.trim(),
					city: city.trim(),
					state: stateCode.trim().toUpperCase(),
					zip: zipCode.trim()
				})
			});

			const data = await response.json();

			if (!response.ok || !data.resolved) {
				addressError =
					data.error || 'Unable to verify address. Please check and try again.';
				return;
			}

			const officials = (data.officials ?? []) as Representative[];

			// Client-side ZKP: use geocoded coordinates to fetch circuit-ready district
			// slots from IPFS (BN254 field elements), compute Poseidon2 commitment.
			// Server never learns which districts the user belongs to.
			if (FEATURES.SHADOW_ATLAS_VERIFICATION && data.coordinates?.lat != null && data.coordinates?.lng != null) {
				try {
					const cellData = await getFullCellDataFromBrowser({
						lat: data.coordinates.lat,
						lng: data.coordinates.lng,
					});
					if (cellData?.districts?.length === 24) {
						districtCommitment = await poseidon2Sponge24(cellData.districts);
						commitmentSlotCount = cellData.districts.filter(
							(s: string) => s !== '0x' + '0'.repeat(64)
						).length;
					}
				} catch (err) {
					// FU-1.3: emit a metric so canary monitoring can quantify
					// commitment-gen failures (IPFS gateway issues, browser
					// Poseidon failures). Without this counter, ops only sees
					// secondary effects via downgrade-guard rejections later.
					console.warn(
						'[AddressCollectionForm] ZKP commitment failed, proceeding without:',
						err
					);
					try {
						const navWithSendBeacon = navigator as Navigator & {
							sendBeacon?: (url: string, data?: BodyInit) => boolean;
						};
						const payload = JSON.stringify({
							metric: 'verify_commitment_generation_failure',
							error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
							timestamp: Date.now()
						});
						if (typeof navWithSendBeacon.sendBeacon === 'function') {
							navWithSendBeacon.sendBeacon('/api/internal/metrics/client-event', payload);
						}
					} catch {
						/* metric emission is best-effort */
					}
				}
			}

			// FU-1.1: capture coordinates so the verify-address handler can
			// recompute the expected commitment server-side. Without these,
			// the server cannot perform issuance-time authenticity verification.
			const capturedCoordinates =
				data.coordinates?.lat != null && data.coordinates?.lng != null
					? { lat: data.coordinates.lat as number, lng: data.coordinates.lng as number }
					: null;

			verificationResult = {
				verified: true,
				correctedAddress: data.address.matched,
				representatives: officials,
				zk_eligible: data.zk_eligible as boolean | undefined,
				coordinates: capturedCoordinates
			};
			selectedAddress = data.address.matched || fullAddress;
			currentStep = 'verify';
		} catch (error) {
			console.error('[AddressCollectionForm] verifyAddress failed:', error instanceof Error ? error.message : String(error));
			addressError =
				error instanceof Error
					? error.message
					: 'Verification service temporarily unavailable. Please try again.';
		} finally {
			isVerifying = false;
		}
	}

	function acceptAddress() {
		isSaving = true;
		if (oncomplete) {
			oncomplete({
				address: selectedAddress,
				verified: true,
				streetAddress,
				city,
				state: stateCode,
				zip: zipCode,
				representatives:
					Array.isArray(verificationResult?.representatives) &&
					verificationResult.representatives.every(
						(item) => typeof item === 'object' && item !== null
					)
						? (verificationResult.representatives as Representative[])
						: undefined,
				// ZKP: pass commitment so parent can send shadow_atlas instead of civic_api
				districtCommitment: districtCommitment ?? undefined,
				commitmentSlotCount: districtCommitment ? commitmentSlotCount : undefined,
				// FU-1.1: include coordinates so the verify-address handler can
				// recompute expected commitment for authenticity check.
				coordinates: verificationResult?.coordinates ?? null
			});
		} else {
			console.warn('[AddressForm] No oncomplete callback registered!');
			isSaving = false;
		}
	}

	function editAddress() {
		currentStep = 'collect';
		verificationResult = null;
	}

	function skipVerification() {
		const fullAddress = `${streetAddress}, ${city}, ${stateCode} ${zipCode}`;
		if (oncomplete) {
			oncomplete({
				address: fullAddress,
				verified: false,
				streetAddress,
				city,
				state: stateCode,
				zip: zipCode
			});
		}
	}

	function _handleKeydown(_event: KeyboardEvent) {
		if (_event.key === 'Enter' && !_event.shiftKey) {
			_event.preventDefault();
			if (currentStep === 'collect') {
				verifyAddress();
			} else if (currentStep === 'verify') {
				acceptAddress();
			}
		}
	}
</script>

<div class="p-6">
	<!-- Progress Indicator -->
	<div class="-mt-2 flex justify-center pb-6">
		<div class="flex gap-2">
			{#each ['collect', 'verify', 'complete'] as step, i}
				<div
					class="h-1.5 rounded-full transition-all duration-500 ease-out {currentStep === step
						? 'w-12 bg-blue-600 shadow-lg shadow-blue-200'
						: ['collect', 'verify', 'complete'].indexOf(currentStep) > i
							? 'w-8 bg-blue-300'
							: 'w-8 bg-slate-100'}"
				></div>
			{/each}
		</div>
	</div>

	<!-- Content -->
	<div class="relative">
		{#key currentStep}
			<div
				in:fly={{ x: 20, duration: 400, delay: 300, easing: quintOut }}
				out:fly={{ x: -20, duration: 300, easing: quintOut }}
				role="region"
				tabindex="-1"
			>
				{#if currentStep === 'collect'}
					<!-- Address Collection Step -->

					<!-- Header with "Digital Faraday Cage" Metaphor -->
					<div class="mb-6 text-center">
						<div class="relative mb-4 inline-flex h-16 w-16 items-center justify-center">
							<!-- Pulse Effect -->
							<div
								class="absolute inset-0 animate-ping rounded-full bg-blue-100 opacity-75 duration-[3000ms]"
							></div>
							<!-- Main Icon -->
							<div
								class="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-50 to-indigo-50 ring-1 ring-blue-100"
							>
								<MapPin class="h-8 w-8 text-blue-600 opacity-90" strokeWidth={1.5} />
							</div>
						</div>
						<h2 class="mb-2 text-xl font-bold text-slate-900">Locate Your District</h2>
						<p class="text-slate-600">
							We need your address to route this message to the correct office.
						</p>
					</div>

					<!-- Privacy Note (Shield) -->
					<div
						class="mb-6 flex items-start gap-3 rounded-md border border-blue-100 bg-blue-50/50 p-4"
					>
						<div
							class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-4 w-4"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
							</svg>
						</div>
						<div>
							<h3 class="text-sm font-semibold text-blue-900">Your address stays private</h3>
							<p class="mt-1 text-xs leading-relaxed text-blue-700">
								Used once to find your district, then <strong>discarded</strong>.
								We never store or share your address.
							</p>
						</div>
					</div>

					<!-- Form Fields -->
					<div class="mb-6 space-y-4">
						<div>
							<label
								for="street"
								class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500"
							>
								Street Address
							</label>
							<input
								id="street"
								type="text"
								bind:value={streetAddress}
								placeholder="123 Main Street"
								class="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 placeholder-slate-400 transition-all focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10"
							/>
						</div>

						<div>
							<label
								for="city"
								class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500"
							>
								City
							</label>
							<input
								id="city"
								type="text"
								bind:value={city}
								placeholder="City"
								class="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 placeholder-slate-400 transition-all focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10"
							/>
						</div>

						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div>
								<label
									for="state"
									class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500"
								>
									State
								</label>
								<input
									id="state"
									type="text"
									bind:value={stateCode}
									placeholder="CA"
									maxlength="2"
									class="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 placeholder-slate-400 transition-all focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10"
								/>
							</div>
							<div>
								<label
									for="zip"
									class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500"
								>
									ZIP Code
								</label>
								<input
									id="zip"
									type="text"
									bind:value={zipCode}
									placeholder="12345"
									maxlength="10"
									class="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 placeholder-slate-400 transition-all focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10"
								/>
							</div>
						</div>

						{#if addressError}
							<div
								class="flex items-start gap-3 rounded-lg border border-red-100 bg-red-50 p-3 text-red-600"
								in:fly={{ y: -10, duration: 200 }}
							>
								<AlertCircle class="mt-0.5 h-5 w-5 shrink-0" />
								<p class="text-sm font-medium">{addressError}</p>
							</div>
						{/if}
					</div>

					<div class="space-y-3">
						<button
							onclick={verifyAddress}
							disabled={isVerifying ||
								!streetAddress.trim() ||
								!city.trim() ||
								!stateCode.trim() ||
								!zipCode.trim()}
							class="group relative w-full overflow-hidden rounded-md bg-slate-900 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition-all hover:bg-slate-800 hover:shadow-md hover:shadow-slate-900/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
						>
							<div class="relative z-10 flex items-center justify-center gap-2">
								{#if isVerifying}
									<Loader2 class="h-4 w-4 animate-spin" />
									<span>Verifying...</span>
								{:else}
									<span>Find My Representatives</span>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-4 w-4 transition-transform group-hover:translate-x-0.5"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<path d="M5 12h14M12 5l7 7-7 7" />
									</svg>
								{/if}
							</div>
						</button>

						<button
							onclick={skipVerification}
							class="w-full rounded-md px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
						>
							Skip for now
						</button>
					</div>
				{:else if currentStep === 'verify'}
					<!-- Address Verification Step -->
					<div class="mb-6 text-center">
						<div class="relative mb-4 inline-flex h-16 w-16 items-center justify-center">
							<div
								class="absolute inset-0 animate-ping rounded-full bg-green-100 opacity-75 duration-[3000ms]"
							></div>
							<div
								class="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-green-50 to-emerald-50 ring-1 ring-green-100"
							>
								<CheckCircle2 class="h-8 w-8 text-green-600 opacity-90" strokeWidth={1.5} />
							</div>
						</div>
						<h2 class="mb-2 text-xl font-bold text-slate-900">Address Verified</h2>
						<p class="text-slate-600">We found your district and representatives.</p>
					</div>

					<!-- Verified Address -->
					<div class="mb-6 overflow-hidden rounded-md border border-slate-200 bg-white">
						<div class="border-b border-slate-100 bg-slate-50/50 px-4 py-3">
							<p class="text-xs font-semibold uppercase tracking-wider text-slate-500">
								Official Address
							</p>
						</div>
						<div class="flex items-start gap-3 p-4">
							<Home class="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
							<div>
								<p class="font-medium text-slate-900">{selectedAddress}</p>
							</div>
						</div>
					</div>

					<!-- Representatives Found -->
					{#if verificationResult?.representatives}
						<div class="mb-6 overflow-hidden rounded-md border border-blue-100 bg-blue-50/30">
							<div class="border-b border-blue-100 bg-blue-50/50 px-4 py-3">
								<p class="text-xs font-semibold uppercase tracking-wider text-blue-600">
									Your Representatives
								</p>
							</div>
							<div class="divide-y divide-blue-100/50">
								{#each Array.isArray(verificationResult.representatives) ? verificationResult.representatives : [] as rep}
									<div class="flex items-center gap-3 p-3">
										<div
											class="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-600"
										>
											{rep.name.charAt(0)}
										</div>
										<div>
											<p class="text-sm font-medium text-slate-900">{rep.name}</p>
											<p class="text-xs text-slate-500">{rep.office}</p>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					{#if verificationResult?.zk_eligible === false}
						<div class="mb-6 flex items-start gap-3 rounded-md border border-amber-100 bg-amber-50/50 p-4">
							<AlertCircle class="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
							<div>
								<p class="text-sm font-medium text-amber-800">
									{verificationResult.zk_warning || 'Anonymous ZK proofs are not available for this area.'}
								</p>
								<p class="mt-1 text-xs leading-relaxed text-amber-700">
									Your address is verified. District-attested delivery is available as an alternative.
								</p>
							</div>
						</div>
					{/if}

					<div class="flex gap-3">
						<button
							onclick={editAddress}
							disabled={isSaving}
							class="flex-1 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
						>
							Edit
						</button>
						<button
							onclick={acceptAddress}
							disabled={isSaving}
							class="flex-1 rounded-md bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition-all hover:bg-slate-800 hover:shadow-md hover:shadow-slate-900/30 active:scale-[0.98] disabled:opacity-50"
						>
							{#if isSaving}
								<span class="flex items-center justify-center gap-2">
									<Loader2 class="h-4 w-4 animate-spin" />
									Saving...
								</span>
							{:else}
								Confirm & Continue
							{/if}
						</button>
					</div>
				{:else}
					<!-- Completion Step -->
					<div class="mb-6 text-center">
						<div class="relative mb-4 inline-flex h-16 w-16 items-center justify-center">
							<div
								class="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-green-50 to-emerald-50 ring-1 ring-green-100"
							>
								<CheckCircle2 class="h-8 w-8 text-green-600 opacity-90" strokeWidth={1.5} />
							</div>
						</div>
						<h2 class="mb-2 text-xl font-bold text-slate-900">You're all set!</h2>
						<p class="text-slate-600">Your address has been securely saved.</p>
					</div>
				{/if}
			</div>
		{/key}
	</div>
</div>
