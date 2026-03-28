<!--
  AddressVerificationFlow.svelte

  Dual-path Tier 2 verification flow: geolocation OR address-based.

  When SHADOW_ATLAS_VERIFICATION is enabled (client-side path):
    Path A: Browser geolocation → IPFS district lookup (no server call) → commitment
    Path B: Manual address → server geocode only → IPFS district lookup → commitment

  When disabled (legacy server-side path):
    Path A: Browser geolocation → /api/location/resolve
    Path B: Manual address → /api/location/resolve-address

  Flow: path-select → [geolocating | address-input] → resolving → confirm-district → issuing-credential → complete
-->

<script lang="ts">
	import { MapPin, CheckCircle2, Loader2, AlertCircle, Building2, ChevronRight, Navigation, Lock, Map } from '@lucide/svelte';
	import { storeCredential } from '$lib/core/identity/credential-store';
	import { getBrowserGeolocation } from '$lib/core/location/browser-location';
	import { storeConstituentAddress } from '$lib/core/identity/constituent-address';
	import { addVerifiedLocationSignal } from '$lib/core/location/inference-engine';
	import { FEATURES } from '$lib/config/features';
	import {
		lookupDistrictsFromBrowser,
		getOfficialsFromBrowser,
	} from '$lib/core/shadow-atlas/browser-client';
	import { convertDistrictId } from '$lib/core/shadow-atlas/district-format';
	import MapPinSelector from './MapPinSelector.svelte';

	type FlowStep = 'path-select' | 'geolocating' | 'address-input' | 'map-pin' | 'resolving' | 'confirm-district' | 'issuing-credential' | 'complete';

	let { userId, onComplete, onCancel }: {
		userId: string;
		onComplete?: (detail: { district: string; method: string }) => void;
		onCancel?: () => void;
	} = $props();

	// Form fields (never name a variable "state" — conflicts with $state rune)
	let street: string = $state('');
	let city: string = $state('');
	let stateCode: string = $state('');
	let zipCode: string = $state('');

	// Auto-detect country from postal code format
	let detectedCountry: 'US' | 'CA' = $derived(
		/^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(zipCode.trim()) ? 'CA' : 'US'
	);

	// Flow state
	let flowStep: FlowStep = $state('path-select');
	let errorMessage: string = $state('');
	let geoPermissionDenied: boolean = $state(false);

	// Verification results
	let verifiedDistrict: string = $state('');
	let verifiedStateSenate: string = $state('');
	let verifiedStateAssembly: string = $state('');
	let correctedAddress: string = $state('');
	let representatives: Array<{
		name: string;
		office: string;
		chamber: string;
		party: string;
		district?: string;
	}> = $state([]);

	// Which verification path was chosen
	let verificationMethod: 'browser' | 'address' = $state('browser');

	// B-3: Client-side district resolution (when SHADOW_ATLAS_VERIFICATION enabled)
	const clientSideEnabled = FEATURES.SHADOW_ATLAS_VERIFICATION;

	// Derived: form validation
	let isFormValid: boolean = $derived(
		street.trim().length > 0 &&
		city.trim().length > 0 &&
		stateCode.trim().length === 2 &&
		(/^\d{5}(-\d{4})?$/.test(zipCode.trim()) || /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(zipCode.trim()))
	);

	/**
	 * Process the /api/location/resolve response and transition to confirm-district.
	 *
	 * Response shape: { resolved, district: { code, name, state }, officials: [...], ... }
	 */
	function processResolveResponse(data: Record<string, unknown>, ok: boolean) {
		if (!ok || !data.resolved || !data.district) {
			errorMessage = (data.error as string) || 'Could not determine your district. Please try again.';
			flowStep = verificationMethod === 'browser' ? 'path-select' : 'address-input';
			return;
		}

		const district = data.district as { code: string; name: string; state: string };
		verifiedDistrict = district.code || '';

		// Use geocoder-standardized address if available (from resolve-address endpoint)
		const address = data.address as { matched?: string } | undefined;
		correctedAddress = address?.matched || '';

		representatives = ((data.officials as typeof representatives) || []);
		verifiedStateSenate = '';
		verifiedStateAssembly = '';

		flowStep = 'confirm-district';
	}

	/**
	 * B-3: Client-side district resolution from lat/lng via IPFS.
	 * Returns true if resolution succeeded, false to fall through to server path.
	 */
	async function resolveClientSide(lat: number, lng: number): Promise<boolean> {
		try {
			const cellDistricts = await lookupDistrictsFromBrowser(lat, lng);
			if (!cellDistricts || !cellDistricts.slots[0]) return false;

			// Slot 0 = congressional district (substrate FIPS format → display format)
			const rawDistrict = cellDistricts.slots[0];
			verifiedDistrict = convertDistrictId(rawDistrict);

			// Fetch officials from IPFS for UI display
			const officials = await getOfficialsFromBrowser(verifiedDistrict);
			if (officials) {
				representatives = officials.officials.map(o => ({
					name: o.name,
					office: o.office_address || '',
					chamber: o.chamber,
					party: o.party,
					district: o.chamber === 'house' ? verifiedDistrict : o.state
				}));
			} else {
				representatives = [];
			}

			verifiedStateSenate = '';
			verifiedStateAssembly = '';
			flowStep = 'confirm-district';
			return true;
		} catch (err) {
			console.warn('[AddressVerificationFlow] Client-side resolution failed, falling back:', err);
			return false;
		}
	}

	/**
	 * Path A: Browser geolocation flow
	 */
	async function handleGeolocationPath() {
		verificationMethod = 'browser';
		flowStep = 'geolocating';
		errorMessage = '';

		try {
			// Step 1: Get browser geolocation (returns LocationSignal with lat/lng only)
			const signal = await getBrowserGeolocation();

			if (!signal) {
				// Permission denied or unavailable — auto-redirect to address path
				geoPermissionDenied = true;
				flowStep = 'address-input';
				verificationMethod = 'address';
				return;
			}

			const lat = signal.latitude;
			const lng = signal.longitude;

			if (lat == null || lng == null) {
				geoPermissionDenied = true;
				flowStep = 'address-input';
				verificationMethod = 'address';
				return;
			}

			flowStep = 'resolving';

			// B-3: Client-side resolution (no server call) when feature flag enabled
			if (clientSideEnabled) {
				const resolved = await resolveClientSide(lat, lng);
				if (resolved) return;
				// Client-side failed — show error instead of leaking to server
				errorMessage = 'Could not resolve your district from IPFS data. Please try the map pin option.';
				flowStep = 'path-select';
				return;
			}

			// Legacy server path (only when SHADOW_ATLAS_VERIFICATION is off)
			const response = await fetch('/api/location/resolve', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					lat,
					lng,
					signal_type: 'browser',
					confidence: 0.6
				})
			});

			const data = await response.json();
			processResolveResponse(data, response.ok);
		} catch (err) {
			console.error('[AddressVerificationFlow] Geolocation error:', err);
			errorMessage = 'Location detection failed. Please enter your address instead.';
			geoPermissionDenied = true;
			flowStep = 'address-input';
			verificationMethod = 'address';
		}
	}

	/**
	 * Path B: Address-based verification flow
	 */
	async function handleAddressPath() {
		if (!isFormValid) return;

		verificationMethod = 'address';
		flowStep = 'resolving';
		errorMessage = '';

		try {
			// Single call: address → geocoder-standardized address + district + officials + cell_id
			const response = await fetch('/api/location/resolve-address', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					street: street.trim(),
					city: city.trim(),
					state: stateCode.trim().toUpperCase(),
					zip: zipCode.trim(),
					...(detectedCountry === 'CA' ? { country: 'CA' } : {})
				})
			});

			const data = await response.json();

			if (!response.ok || !data.resolved) {
				errorMessage = data.error || 'Could not verify your address. Please check and try again.';
				flowStep = 'address-input';
				return;
			}

			// Store geocoder-standardized address in IndexedDB
			await storeConstituentAddress(userId, {
				street: data.address?.street || street.trim(),
				city: data.address?.city || city.trim(),
				state: data.address?.state || stateCode.trim().toUpperCase(),
				zip: data.address?.zip || zipCode.trim(),
				district: data.district?.code || ''
			});

			// B-3: Use server-geocoded coordinates for client-side district resolution
			if (clientSideEnabled && data.coordinates?.lat != null && data.coordinates?.lng != null) {
				correctedAddress = data.address?.matched || '';
				const resolved = await resolveClientSide(data.coordinates.lat, data.coordinates.lng);
				if (resolved) return;
				// Fall through to server response if client-side fails
			}

			// Process response (same as geolocation path)
			processResolveResponse(data, response.ok);
		} catch (err) {
			console.error('[AddressVerificationFlow] Address verification error:', err);
			errorMessage = 'Unable to verify address. Please try again.';
			flowStep = 'address-input';
		}
	}

	/**
	 * Confirm district and issue credential
	 */
	async function handleConfirmDistrict() {
		flowStep = 'issuing-credential';
		errorMessage = '';

		try {
			const response = await fetch('/api/identity/verify-address', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					district: verifiedDistrict,
					state_senate_district: verifiedStateSenate || undefined,
					state_assembly_district: verifiedStateAssembly || undefined,
					verification_method: 'civic_api',
					officials: representatives,
				})
			});

			const data = await response.json();

			if (!response.ok) {
				errorMessage = data.error || 'Failed to issue district credential. Please try again.';
				flowStep = 'confirm-district';
				return;
			}

			// Store credential in IndexedDB wallet for offline access
			if (data.credential) {
				await storeCredential(
					userId,
					'district_residency',
					data.credential,
					data.credential.expirationDate
				);
			}

			// Store verified location signal for inference engine
			if (verifiedDistrict) {
				const parts = verifiedDistrict.split('-');
				if (parts.length >= 2) {
					await addVerifiedLocationSignal(verifiedDistrict, parts[0]);
				}
			}

			// NOTE: Do NOT call invalidateAll() here. This component is conditionally
			// rendered inside VerificationGate via {#if needsTier2}, which is a $derived
			// value of userTrustTier. Calling invalidateAll() refreshes page data, which
			// updates trustTier to 2, which flips needsTier2 to false, which DESTROYS
			// this component mid-execution — before the success screen renders or
			// onComplete fires. The parent (profile page, TemplateModal) handles
			// invalidateAll() in its own onverified/onComplete callback, AFTER the
			// modal closes and the reactive cascade is harmless.

			flowStep = 'complete';

			// Notify parent after a brief delay to show success state
			setTimeout(() => {
				onComplete?.({ district: verifiedDistrict, method: 'civic_api' });
			}, 1500);
		} catch (err) {
			console.error('[AddressVerificationFlow] Credential issuance error:', err);
			errorMessage = 'Unable to issue credential. Please try again.';
			flowStep = 'confirm-district';
		}
	}

	function handleSelectAddressPath() {
		verificationMethod = 'address';
		geoPermissionDenied = false;
		flowStep = clientSideEnabled ? 'map-pin' : 'address-input';
	}

	/**
	 * Path B (client-side): Map pin selection flow.
	 * User drops a pin on the map — no address string ever leaves the browser.
	 */
	async function handleMapPinSelect(coords: { lat: number; lng: number }) {
		verificationMethod = 'address';
		flowStep = 'resolving';
		errorMessage = '';

		const resolved = await resolveClientSide(coords.lat, coords.lng);
		if (!resolved) {
			errorMessage = 'Could not determine your district from this location. Please try a different spot or use device location.';
			flowStep = 'map-pin';
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && isFormValid && flowStep === 'address-input') {
			handleAddressPath();
		}
	}

	function handleCancel() {
		onCancel?.();
	}

	function handleBack() {
		errorMessage = '';
		geoPermissionDenied = false;
		flowStep = 'path-select';
	}

	function handleEditAddress() {
		flowStep = 'address-input';
		errorMessage = '';
	}
</script>

<div class="mx-auto w-full max-w-lg">
	<!-- Step Indicator -->
	<div class="mb-6 flex items-center justify-center gap-2">
		{#each ['path-select', 'confirm-district', 'complete'] as step, i}
			{@const stepLabels = ['Verify', 'Confirm', 'Done']}
			{@const stepIndex = ['path-select', 'confirm-district', 'complete'].indexOf(flowStep)}
			{@const isActive = i <= stepIndex
				|| (flowStep === 'geolocating' || flowStep === 'address-input' || flowStep === 'resolving') && i === 0
				|| flowStep === 'issuing-credential' && i <= 1}
			<div class="flex items-center gap-2">
				<div
					class="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-300"
					class:bg-emerald-600={isActive}
					class:text-white={isActive}
					class:bg-slate-200={!isActive}
					class:text-slate-500={!isActive}
				>
					{#if i < stepIndex || (flowStep === 'complete' && i <= 2)}
						<CheckCircle2 class="h-4 w-4" />
					{:else}
						{i + 1}
					{/if}
				</div>
				<span class="text-xs font-medium" class:text-emerald-700={isActive} class:text-slate-400={!isActive}>
					{stepLabels[i]}
				</span>
				{#if i < 2}
					<ChevronRight class="h-3 w-3 text-slate-300" />
				{/if}
			</div>
		{/each}
	</div>

	<!-- PATH SELECT STEP -->
	{#if flowStep === 'path-select'}
		<div class="space-y-5">
			<div class="text-center">
				<div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
					<MapPin class="h-6 w-6 text-emerald-600" />
				</div>
				<h3 class="text-lg font-semibold text-slate-900">Verify Your District</h3>
				<p class="mt-1 text-sm text-slate-600">
					Choose how to confirm your congressional district.
				</p>
			</div>

			<div class="space-y-3">
				<!-- Option A: Use my location -->
				<button
					type="button"
					class="flex w-full items-start gap-4 rounded-xl border border-slate-200 p-5 text-left cursor-pointer transition-all hover:border-emerald-300 hover:bg-emerald-50/30"
					onclick={handleGeolocationPath}
				>
					<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
						<Navigation class="h-5 w-5 text-emerald-600" />
					</div>
					<div class="min-w-0 flex-1">
						<p class="text-sm font-semibold text-slate-900">Use my location</p>
						<p class="mt-0.5 text-xs text-slate-500">Quick verification using your device's location</p>
					</div>
					<ChevronRight class="mt-2.5 h-4 w-4 shrink-0 text-slate-400" />
				</button>

				<!-- Option B: Choose on map (client-side) or Enter address (legacy) -->
				<button
					type="button"
					class="flex w-full items-start gap-4 rounded-xl border border-slate-200 p-5 text-left cursor-pointer transition-all hover:border-emerald-300 hover:bg-emerald-50/30"
					onclick={handleSelectAddressPath}
				>
					<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
						{#if clientSideEnabled}
							<Map class="h-5 w-5 text-emerald-600" />
						{:else}
							<Building2 class="h-5 w-5 text-emerald-600" />
						{/if}
					</div>
					<div class="min-w-0 flex-1">
						{#if clientSideEnabled}
							<p class="text-sm font-semibold text-slate-900">Choose on map</p>
							<p class="mt-0.5 text-xs text-slate-500">Drop a pin on your location — nothing leaves your browser</p>
						{:else}
							<p class="text-sm font-semibold text-slate-900">Enter my address</p>
							<p class="mt-0.5 text-xs text-slate-500">Verify with your home address for constituency proof</p>
						{/if}
					</div>
					<ChevronRight class="mt-2.5 h-4 w-4 shrink-0 text-slate-400" />
				</button>
			</div>

			<!-- Privacy note -->
			<div class="flex items-center justify-center gap-1.5">
				<Lock class="h-3 w-3 text-emerald-700" />
				<p class="text-xs font-medium text-emerald-700">
					{#if clientSideEnabled}
						Your location never leaves your browser. District data fetched from decentralized storage.
					{:else}
						Your address is matched to a district, then forgotten. Nothing is stored.
					{/if}
				</p>
			</div>

			{#if onCancel}
				<button
					type="button"
					class="w-full text-center text-sm text-slate-500 transition-colors hover:text-slate-700"
					onclick={handleCancel}
				>
					Cancel
				</button>
			{/if}
		</div>

	<!-- GEOLOCATING STEP (loading) -->
	{:else if flowStep === 'geolocating'}
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
				<Loader2 class="h-8 w-8 animate-spin text-emerald-600" />
			</div>
			<h3 class="text-lg font-semibold text-slate-900">Detecting Location</h3>
			<p class="mt-2 text-sm text-slate-600">
				Please allow location access when prompted...
			</p>
		</div>

	<!-- MAP PIN STEP (client-side, privacy-preserving) -->
	{:else if flowStep === 'map-pin'}
		<div class="space-y-4">
			<MapPinSelector
				onSelect={handleMapPinSelect}
				onCancel={handleBack}
			/>
		</div>

	<!-- ADDRESS INPUT STEP -->
	{:else if flowStep === 'address-input'}
		<div class="space-y-5">
			<div class="text-center">
				<div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
					<Building2 class="h-6 w-6 text-emerald-600" />
				</div>
				<h3 class="text-lg font-semibold text-slate-900">Enter Your Address</h3>
				<p class="mt-1 text-sm text-slate-600">
					Confirm your district to send messages to your representatives.
				</p>
				{#if geoPermissionDenied}
					<div class="mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2">
						<AlertCircle class="h-3.5 w-3.5 text-amber-600" />
						<p class="text-xs text-amber-700">Location access was denied. Please enter your address instead.</p>
					</div>
				{/if}
				<p class="mt-1 text-xs font-medium text-emerald-700">
					Address used once for verification, then deleted.
				</p>
			</div>

			<div class="space-y-3">
				<div>
					<label for="avf-street" class="mb-1 block text-sm font-medium text-slate-700">
						Street Address
					</label>
					<input
						id="avf-street"
						type="text"
						bind:value={street}
						placeholder="123 Main Street"
						class="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm transition-colors focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
						onkeydown={handleKeydown}
					/>
				</div>

				<div class="grid grid-cols-6 gap-3">
					<div class="col-span-3">
						<label for="avf-city" class="mb-1 block text-sm font-medium text-slate-700">City</label>
						<input
							id="avf-city"
							type="text"
							bind:value={city}
							placeholder="San Francisco"
							class="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm transition-colors focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
							onkeydown={handleKeydown}
						/>
					</div>
					<div class="col-span-1">
						<label for="avf-state" class="mb-1 block text-sm font-medium text-slate-700">{detectedCountry === 'CA' ? 'Prov' : 'State'}</label>
						<input
							id="avf-state"
							type="text"
							bind:value={stateCode}
							placeholder={detectedCountry === 'CA' ? 'ON' : 'CA'}
							maxlength={2}
							class="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center text-sm uppercase transition-colors focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
							onkeydown={handleKeydown}
						/>
					</div>
					<div class="col-span-2">
						<label for="avf-zip" class="mb-1 block text-sm font-medium text-slate-700">{detectedCountry === 'CA' ? 'Postal' : 'ZIP'}</label>
						<input
							id="avf-zip"
							type="text"
							bind:value={zipCode}
							placeholder={detectedCountry === 'CA' ? 'K1A 0B1' : '94102'}
							maxlength={10}
							class="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm transition-colors focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
							onkeydown={handleKeydown}
						/>
					</div>
				</div>
			</div>

			{#if errorMessage}
				<div class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
					<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
					<p class="text-sm text-red-700">{errorMessage}</p>
				</div>
			{/if}

			<button
				type="button"
				class="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-sm font-medium text-white shadow-sm transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
				onclick={handleAddressPath}
				disabled={!isFormValid}
			>
				<MapPin class="h-4 w-4" />
				Verify Address
			</button>

			<button
				type="button"
				class="w-full text-center text-sm text-slate-500 transition-colors hover:text-slate-700"
				onclick={handleBack}
			>
				Back
			</button>

			<!-- Privacy note -->
			<details class="text-center">
				<summary class="cursor-pointer text-xs text-slate-400 hover:text-slate-600">
					How is my address used?
				</summary>
				<p class="mt-2 text-xs leading-relaxed text-slate-500">
					Your address is sent to our server, geocoded via self-hosted infrastructure,
					and matched to your {detectedCountry === 'CA' ? 'federal electoral district (riding)' : 'congressional district'}. After verification, the address is encrypted
					locally. Only your district is sent to issue a verifiable credential.
				</p>
			</details>
		</div>

	<!-- RESOLVING STEP (loading) -->
	{:else if flowStep === 'resolving'}
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
				<Loader2 class="h-8 w-8 animate-spin text-emerald-600" />
			</div>
			<h3 class="text-lg font-semibold text-slate-900">Resolving District</h3>
			<p class="mt-2 text-sm text-slate-600">
				Looking up your congressional district...
			</p>
		</div>

	<!-- CONFIRM DISTRICT STEP -->
	{:else if flowStep === 'confirm-district'}
		<div class="space-y-5">
			<div class="text-center">
				<div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
					<Building2 class="h-6 w-6 text-emerald-600" />
				</div>
				<h3 class="text-lg font-semibold text-slate-900">Your District</h3>
				<p class="mt-1 text-sm text-slate-600">
					Confirm this is correct to receive your district credential.
				</p>
			</div>

			<!-- District Card -->
			<div class="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-5">
				<div class="mb-3 flex items-center gap-2">
					<MapPin class="h-5 w-5 text-emerald-600" />
					<span class="text-lg font-bold text-emerald-900">{verifiedDistrict}</span>
				</div>
				{#if correctedAddress}
					<p class="mb-3 text-xs text-slate-500">
						Verified address: {correctedAddress}
					</p>
				{/if}

				<!-- Representatives -->
				{#if representatives.length > 0}
					<div class="space-y-2">
						<p class="text-xs font-semibold uppercase tracking-wider text-slate-500">Your Representatives</p>
						{#each representatives as rep}
							<div class="flex items-center gap-3 rounded-lg bg-white/70 px-3 py-2">
								<div class="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
									{rep.chamber === 'house' ? 'H' : 'S'}
								</div>
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium text-slate-900">{rep.name}</p>
									<p class="truncate text-xs text-slate-500">{rep.office}</p>
								</div>
								{#if rep.party}
									<span class="text-xs font-medium text-slate-400">({rep.party})</span>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>

			{#if errorMessage}
				<div class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
					<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
					<p class="text-sm text-red-700">{errorMessage}</p>
				</div>
			{/if}

			<div class="flex gap-3">
				<button
					type="button"
					class="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
					onclick={handleEditAddress}
				>
					Edit Address
				</button>
				<button
					type="button"
					class="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-emerald-700"
					onclick={handleConfirmDistrict}
				>
					<CheckCircle2 class="h-4 w-4" />
					Confirm &amp; Get Credential
				</button>
			</div>
		</div>

	<!-- ISSUING CREDENTIAL STEP (loading) -->
	{:else if flowStep === 'issuing-credential'}
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-teal-100">
				<Loader2 class="h-8 w-8 animate-spin text-teal-600" />
			</div>
			<h3 class="text-lg font-semibold text-slate-900">Issuing Credential</h3>
			<p class="mt-2 text-sm text-slate-600">
				Creating your verifiable district credential...
			</p>
		</div>

	<!-- COMPLETE STEP -->
	{:else if flowStep === 'complete'}
		<div class="flex flex-col items-center justify-center py-8 text-center">
			<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
				<CheckCircle2 class="h-8 w-8 text-emerald-600" />
			</div>
			<h3 class="text-lg font-bold text-emerald-900">District Verified</h3>
			<p class="mt-2 text-sm text-slate-600">
				You're verified as a constituent of <strong class="text-emerald-700">{verifiedDistrict}</strong>.
			</p>
			<p class="mt-1 text-xs text-slate-500">
				You can now send messages to your representatives.
			</p>

			<div class="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
				<div class="flex items-center gap-2 text-sm font-medium text-emerald-800">
					<CheckCircle2 class="h-4 w-4" />
					Trust Tier 2: Address Attested
				</div>
			</div>
		</div>
	{/if}
</div>
