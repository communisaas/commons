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

  ─── Re-grounding mode ───

  When `regroundingMode === true`, this component becomes the single surface
  for a verified constituent rebinding to new coordinates. The `issuing-credential`
  step renders a witnessing list bound to REAL async boundaries (no timers), and
  the `complete` step becomes a consequential diff (WAS / IS, representatives side
  by side) instead of the tier-2 success card. The phase-change callback lets the
  parent disable its close affordance while the retirement ceremony is irreversible.
-->

<script module lang="ts">
	/** Re-grounding phase, emitted to the parent so it can guard its close affordance. */
	export type RegroundingPhase = 'capture' | 'witnessing' | 'complete';
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { MapPin, CheckCircle2, Loader2, AlertCircle, Building2, ChevronRight, Navigation, Lock, Map } from '@lucide/svelte';
	import { storeCredential } from '$lib/core/identity/credential-store';
	import { getBrowserGeolocation } from '$lib/core/location/browser-location';
	import { storeConstituentAddress, clearConstituentAddress, getConstituentAddress, type ConstituentAddress } from '$lib/core/identity/constituent-address';
	import { clearSessionCredential } from '$lib/core/identity/session-credentials';
	import { addVerifiedLocationSignal } from '$lib/core/location/inference-engine';
	import { FEATURES } from '$lib/config/features';
	import {
		lookupDistrictsFromBrowser,
		getOfficialsFromBrowser,
		getFullCellDataFromBrowser,
	} from '$lib/core/shadow-atlas/browser-client';
	import { convertDistrictId } from '$lib/core/shadow-atlas/district-format';
	import { poseidon2Sponge24 } from '$lib/core/crypto/poseidon';
	import { trackAddressChanged } from '$lib/core/analytics/client';
	import MapPinSelector from './MapPinSelector.svelte';

	type FlowStep = 'path-select' | 'geolocating' | 'address-input' | 'map-pin' | 'resolving' | 'confirm-district' | 'issuing-credential' | 'complete';

	interface Representative {
		name: string;
		party?: string;
		chamber?: string;
		state?: string;
		district?: string;
		office?: string;
	}

	let {
		userId,
		onComplete,
		onCancel,
		/** When true, the flow runs as a re-grounding ceremony: witnessing list + diff. */
		regroundingMode = false,
		/** Prior address — drives the old-ground zone shown above this component, and the WAS column. */
		oldAddress = null,
		/** Prior representatives — drive the WAS column in the consequential diff. */
		oldRepresentatives = [],
		/** Parent refresher called after issuance so the IS column reflects the new reps. */
		refreshRepresentatives,
		/** Fires on every re-grounding phase transition. Used to disable parent close × during witnessing. */
		onRegroundingPhaseChange,
		/** Fires right after credentials are cleared (retire step complete). */
		onRetired,
		/** Fires right after the server attests the new district and the local credential is stored. */
		onAttested
	}: {
		userId: string;
		onComplete?: (detail: { district: string; method: string }) => void;
		onCancel?: () => void;
		regroundingMode?: boolean;
		oldAddress?: ConstituentAddress | null;
		oldRepresentatives?: Representative[];
		refreshRepresentatives?: () => Promise<Representative[]>;
		onRegroundingPhaseChange?: (phase: RegroundingPhase) => void;
		onRetired?: () => void;
		onAttested?: (detail: { district: string; method: string }) => void;
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

	// B-3: 24 district slots from IPFS (for Poseidon2 commitment)
	let districtSlots: string[] = $state([]);

	// B-3: Client-side district resolution (when SHADOW_ATLAS_VERIFICATION enabled)
	const clientSideEnabled = FEATURES.SHADOW_ATLAS_VERIFICATION;

	// ─── Re-grounding state (only used when regroundingMode === true) ───
	type RegroundingStep = 'retire' | 'attest';
	type StepState = 'pending' | 'active' | 'done';

	let regroundingStepStates = $state<Record<RegroundingStep, StepState>>({
		retire: 'pending',
		attest: 'pending'
	});

	/** New address read from IndexedDB after re-grounding, for the IS column. */
	let newAddress = $state<ConstituentAddress | null>(null);
	let newRepresentatives = $state<Representative[]>([]);
	let districtChanged = $state(false);
	let stateChanged = $state(false);

	// Order matters: attest runs first so the server has issued the new
	// credential before we clear any local state. Retire only runs after attest
	// succeeds, eliminating the half-retired-state hole that throttle bounces
	// used to leave behind.
	const witnessingLines: Array<{ id: RegroundingStep; label: string }> = [
		{ id: 'attest', label: 'Anchoring the new ground' },
		{ id: 'retire', label: 'Releasing the old' }
	];

	function markRegroundingStep(step: RegroundingStep, next: StepState) {
		regroundingStepStates = { ...regroundingStepStates, [step]: next };
	}

	function emitRegroundingPhase(phase: RegroundingPhase) {
		try {
			onRegroundingPhaseChange?.(phase);
		} catch (e) {
			console.warn('[AddressVerificationFlow] phase callback threw:', e);
		}
	}

	// Signal capture phase on mount when in re-grounding mode so the parent
	// can initialise its close-guard state from a known baseline.
	onMount(() => {
		if (regroundingMode) emitRegroundingPhase('capture');
	});

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

			// Fetch circuit-ready BN254 field elements for Poseidon2 commitment
			const cellData = await getFullCellDataFromBrowser({ lat, lng });
			if (cellData?.districts?.length === 24) {
				districtSlots = cellData.districts;
			}

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

			// NOTE: We intentionally do NOT write the address to IndexedDB here.
			// In re-grounding mode the retire step clears IndexedDB; in normal mode
			// the address is written ONCE after the server attests the credential
			// (see `handleConfirmDistrict`). Deferring the write eliminates the
			// retire-plus-repair bounce and makes the retire step strictly about
			// clearing prior state.
			//
			// Form state (street/city/stateCode/zipCode) carries the just-captured
			// coordinates through confirmation. Prefer the geocoder-normalized
			// variant when the server returned it.
			if (data.address?.street) street = data.address.street;
			if (data.address?.city) city = data.address.city;
			if (data.address?.state) stateCode = data.address.state;
			if (data.address?.zip) zipCode = data.address.zip;

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
	 * Confirm district and issue credential.
	 *
	 * In re-grounding mode this function:
	 *   1. Attests FIRST — POSTs to /api/identity/verify-address to mint the new
	 *      credential. If the server rejects (throttle, sybil, downgrade), we
	 *      bounce back to confirm-district with the old IndexedDB ground intact.
	 *      Pre-Wave-A code retired the local state before this step, which left
	 *      throttle-bounced users in a half-retired state.
	 *   2. Stores the new credential in IndexedDB (so a tab-close mid-flight
	 *      cannot strand the user without local proof).
	 *   3. Retires prior IndexedDB address + session credential (now safe — the
	 *      new credential is durable both server-side and client-side).
	 *   4. Writes the new ground (form state).
	 *   5. Advances a two-step witnessing list bound to REAL async boundaries:
	 *      attest → retire. No timers.
	 *   6. Reads back the new ground for the consequential diff.
	 */
	async function handleConfirmDistrict() {
		flowStep = 'issuing-credential';
		errorMessage = '';

		if (regroundingMode) {
			emitRegroundingPhase('witnessing');
			markRegroundingStep('attest', 'active');
		}

		try {
			// Compute Poseidon2 commitment over 24 district slots (client-side ZKP)
			// Server never sees which districts the user belongs to — only the commitment
			let requestBody: Record<string, unknown>;

			if (districtSlots.length === 24) {
				const commitment = await poseidon2Sponge24(districtSlots);
				const nonZeroSlots = districtSlots.filter(s => s !== '0x' + '0'.repeat(64)).length;

				requestBody = {
					district_commitment: commitment,
					slot_count: nonZeroSlots,
					verification_method: 'shadow_atlas',
				};
			} else {
				// Fallback: no IPFS data available (client-side resolution failed)
				requestBody = {
					district: verifiedDistrict,
					state_senate_district: verifiedStateSenate || undefined,
					state_assembly_district: verifiedStateAssembly || undefined,
					verification_method: 'civic_api',
					officials: representatives,
				};
			}

			const response = await fetch('/api/identity/verify-address', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(requestBody)
			});

			const data = await response.json();

			if (!response.ok) {
				errorMessage = data.error || 'Failed to issue district credential. Please try again.';
				flowStep = 'confirm-district';
				if (regroundingMode) {
					// Crucially: nothing has been retired yet — the old ground is
					// still intact in IndexedDB. The user can correct the cause of
					// rejection (wait out the throttle, fix the address) and retry
					// without losing state.
					markRegroundingStep('attest', 'pending');
					emitRegroundingPhase('capture');
				}
				return;
			}

			// ── Attest succeeded. New credential is durable server-side. ──

			// Store credential in IndexedDB wallet for offline access. This must
			// happen BEFORE the retire step so a tab-close mid-flight cannot
			// strand the user with no local credential.
			if (data.credential) {
				await storeCredential(
					userId,
					'district_residency',
					data.credential,
					data.credential.expirationDate
				);
			}

			const method = districtSlots.length === 24 ? 'shadow_atlas' : 'civic_api';

			if (regroundingMode) {
				markRegroundingStep('attest', 'done');
				try {
					onAttested?.({ district: verifiedDistrict, method });
				} catch (e) {
					console.warn('[AddressVerificationFlow] onAttested threw:', e);
				}

				// Now retire — old ground is being replaced and new credential is
				// locked in both server-side and locally. Failures here are
				// non-fatal cleanup; the next verification clears any residue.
				markRegroundingStep('retire', 'active');
				try {
					await Promise.all([
						clearConstituentAddress(userId),
						clearSessionCredential(userId)
					]);
				} catch (e) {
					console.warn('[AddressVerificationFlow] Retire failed (non-fatal):', e);
				}
				markRegroundingStep('retire', 'done');
				try {
					onRetired?.();
				} catch (e) {
					console.warn('[AddressVerificationFlow] onRetired threw:', e);
				}

				// Write the new ground (form state). Geolocation + map-pin paths
				// never captured an address string — the credential alone is the
				// new ground in those cases.
				if (verificationMethod === 'address' && street && city && stateCode && zipCode) {
					try {
						await storeConstituentAddress(userId, {
							street: street.trim(),
							city: city.trim(),
							state: stateCode.trim().toUpperCase(),
							zip: zipCode.trim(),
							district: verifiedDistrict || ''
						});
					} catch (e) {
						console.warn('[AddressVerificationFlow] Store new ground failed:', e);
					}
				}
			} else {
				// Initial (non-regrounding) verification: persist the address now
				// that `handleAddressPath` no longer writes eagerly.
				if (verificationMethod === 'address' && street && city && stateCode && zipCode) {
					try {
						await storeConstituentAddress(userId, {
							street: street.trim(),
							city: city.trim(),
							state: stateCode.trim().toUpperCase(),
							zip: zipCode.trim(),
							district: verifiedDistrict || ''
						});
					} catch (e) {
						console.warn('[AddressVerificationFlow] Store address failed (non-fatal):', e);
					}
				}

				// REVIEW 2.5 HIGH fix: ALWAYS clear the prior SessionCredential on a
				// successful re-verify. A tier-upgrade re-verify otherwise leaves a
				// stale districtCommitment cached client-side, which then fails
				// canonical action_domain matching with a generic 400 — wedging the
				// user. Non-fatal on failure.
				try {
					await clearSessionCredential(userId);
				} catch (e) {
					console.warn('[AddressVerificationFlow] Clear stale SessionCredential failed (non-fatal):', e);
				}
			}

			// Store verified location signal for inference engine.
			if (verifiedDistrict) {
				const parts = verifiedDistrict.split('-');
				if (parts.length >= 2) {
					await addVerifiedLocationSignal(verifiedDistrict, parts[0]);
				}
			}

			if (regroundingMode) {
				// Read back the new ground + reps so the consequential diff can render.
				await loadNewGroundForDiff();

				flowStep = 'complete';
				emitRegroundingPhase('complete');

				try {
					trackAddressChanged(districtChanged, stateChanged);
				} catch (e) {
					console.warn('[AddressVerificationFlow] analytics emit failed:', e);
				}
				// Re-grounding path does NOT auto-fire onComplete — the user dismisses
				// the consequential diff themselves via the "Done" link. That's their
				// acknowledgement that the new ground is seen.
				return;
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
				onComplete?.({ district: verifiedDistrict, method });
			}, 1500);
		} catch (err) {
			console.error('[AddressVerificationFlow] Credential issuance error:', err);
			errorMessage = 'Unable to issue credential. Please try again.';
			flowStep = 'confirm-district';
			if (regroundingMode) {
				markRegroundingStep('attest', 'pending');
				emitRegroundingPhase('capture');
			}
		}
	}

	/**
	 * Re-grounding only: pull the freshly-stored address out of IndexedDB and
	 * refresh the representative list via the parent refresher. Computes the
	 * district/state change flags used by analytics and by the diff copy.
	 */
	async function loadNewGroundForDiff() {
		try {
			// The address path writes IndexedDB post-retire in handleConfirmDistrict;
			// geolocation and map-pin paths never capture an address string. Read
			// whatever is there — null is fine (IS pane handles that case).
			const stored = await getConstituentAddress(userId);
			if (stored) newAddress = stored;
		} catch (e) {
			console.warn('[AddressVerificationFlow] Failed to read new address:', e);
		}

		if (refreshRepresentatives) {
			try {
				const reps = await refreshRepresentatives();
				if (Array.isArray(reps)) newRepresentatives = reps;
			} catch (e) {
				console.warn('[AddressVerificationFlow] refreshRepresentatives failed:', e);
			}
		}

		// District/state change flags. Prefer stored address fields if present;
		// otherwise fall back to the verifiedDistrict from resolution.
		const newDistrictCode = newAddress?.district || verifiedDistrict || '';
		const oldDistrictCode = oldAddress?.district || '';
		districtChanged = Boolean(
			oldDistrictCode && newDistrictCode && oldDistrictCode !== newDistrictCode
		);

		// State-change detection. The address path writes state into IndexedDB,
		// but the geolocation and map-pin paths never capture a state string —
		// they resolve districts directly from lat/lng via IPFS. For those
		// paths, derive state-change from senator-name diff: federal senators
		// are state-scoped, so if any OLD senator is absent from the NEW senator
		// list, state changed.
		const newState = newAddress?.state || '';
		const oldState = oldAddress?.state || '';
		if (oldState && newState) {
			stateChanged = oldState !== newState;
		} else {
			const oldSenators = new Set(
				oldRepresentatives
					.filter((r) => r.chamber === 'senate')
					.map((r) => r.name)
					.filter(Boolean)
			);
			const newSenators = new Set(
				newRepresentatives
					.filter((r) => r.chamber === 'senate')
					.map((r) => r.name)
					.filter(Boolean)
			);
			if (oldSenators.size > 0 && newSenators.size > 0) {
				// If any old senator is missing from the new set, state changed.
				let missing = false;
				for (const name of oldSenators) {
					if (!newSenators.has(name)) {
						missing = true;
						break;
					}
				}
				stateChanged = missing;
			} else {
				stateChanged = false;
			}
		}
	}

	/** Re-grounding only: user dismisses the consequential diff. */
	function handleRegroundingDone() {
		const method = districtSlots.length === 24 ? 'shadow_atlas' : 'civic_api';
		onComplete?.({ district: verifiedDistrict, method });
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

<!--
	In re-grounding mode the outer composition (AddressChangeFlow) owns the
	max-width. We drop the lg cap so the inner flow flexes into whatever grid
	cell it occupies — during capture/witnessing that's a full column; at
	`complete` it's the right-hand IS cell of a two-column grid.
-->
<div class="w-full" class:mx-auto={!regroundingMode} class:max-w-lg={!regroundingMode}>
	<!-- Step Indicator (suppressed in re-grounding — the ceremony is the progress) -->
	{#if !regroundingMode}
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
	{/if}

	<!-- PATH SELECT STEP -->
	{#if flowStep === 'path-select'}
		{#if regroundingMode}
			<!-- Re-grounding register: eyebrow + Satoshi heading, outlined path options -->
			<section class="pt-2 pb-2">
				<div class="mb-5">
					<p
						class="font-mono text-[10px] uppercase text-slate-500"
						style="letter-spacing: 0.22em"
					>
						New ground
					</p>
					<h2
						class="mt-1.5 text-xl font-semibold leading-tight text-slate-900"
						style="font-family: 'Satoshi', system-ui, sans-serif"
					>
						Choose how to attest your new coordinates.
					</h2>
				</div>

				<div class="space-y-2">
					<button
						type="button"
						class="flex w-full items-start gap-3 border-t border-dotted border-slate-300 py-4 text-left transition-colors hover:bg-slate-50/60"
						onclick={handleGeolocationPath}
					>
						<Navigation class="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium text-slate-900">Use my location</p>
							<p class="mt-0.5 text-xs text-slate-500">Device geolocation — nothing leaves the browser.</p>
						</div>
						<ChevronRight class="mt-1 h-4 w-4 shrink-0 text-slate-400" />
					</button>

					<button
						type="button"
						class="flex w-full items-start gap-3 border-t border-dotted border-slate-300 py-4 text-left transition-colors hover:bg-slate-50/60"
						onclick={handleSelectAddressPath}
					>
						{#if clientSideEnabled}
							<Map class="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
						{:else}
							<Building2 class="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
						{/if}
						<div class="min-w-0 flex-1">
							{#if clientSideEnabled}
								<p class="text-sm font-medium text-slate-900">Choose on map</p>
								<p class="mt-0.5 text-xs text-slate-500">Drop a pin on your new location.</p>
							{:else}
								<p class="text-sm font-medium text-slate-900">Enter my address</p>
								<p class="mt-0.5 text-xs text-slate-500">Verify with your new home address.</p>
							{/if}
						</div>
						<ChevronRight class="mt-1 h-4 w-4 shrink-0 text-slate-400" />
					</button>
				</div>

				{#if onCancel}
					<div class="mt-6 border-t border-dotted border-slate-300 pt-4 text-right">
						<button
							type="button"
							class="font-mono text-sm text-slate-500 underline decoration-slate-300 decoration-1 underline-offset-4 transition-colors hover:text-slate-700 hover:decoration-slate-500"
							onclick={handleCancel}
						>
							Cancel
						</button>
					</div>
				{/if}
			</section>
		{:else}
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
						class="flex w-full items-start gap-4 rounded-md border border-slate-200 p-5 text-left cursor-pointer transition-all hover:border-emerald-300 hover:bg-emerald-50/30"
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
						class="flex w-full items-start gap-4 rounded-md border border-slate-200 p-5 text-left cursor-pointer transition-all hover:border-emerald-300 hover:bg-emerald-50/30"
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
		{/if}

	<!-- GEOLOCATING STEP (loading) -->
	{:else if flowStep === 'geolocating'}
		{#if regroundingMode}
			<section class="py-6" aria-live="polite">
				<div class="mb-5">
					<p
						class="font-mono text-[10px] uppercase text-slate-500"
						style="letter-spacing: 0.22em"
					>
						New ground
					</p>
					<h2
						class="mt-1.5 text-base font-medium text-slate-900"
						style="font-family: 'Satoshi', system-ui, sans-serif"
					>
						Awaiting location permission
					</h2>
				</div>
				<div class="flex items-center gap-3 border-t border-b border-dotted border-slate-300 py-4 text-sm text-slate-500">
					<Loader2 class="h-4 w-4 shrink-0 animate-spin text-slate-500" />
					<span>Please allow location access when prompted.</span>
				</div>
			</section>
		{:else}
			<div class="flex flex-col items-center justify-center py-12 text-center">
				<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
					<Loader2 class="h-8 w-8 animate-spin text-emerald-600" />
				</div>
				<h3 class="text-lg font-semibold text-slate-900">Detecting Location</h3>
				<p class="mt-2 text-sm text-slate-600">
					Please allow location access when prompted...
				</p>
			</div>
		{/if}

	<!-- MAP PIN STEP (client-side, privacy-preserving) -->
	{:else if flowStep === 'map-pin'}
		<div class="space-y-4">
			{#if regroundingMode}
				<div class="mb-2">
					<p
						class="font-mono text-[10px] uppercase text-slate-500"
						style="letter-spacing: 0.22em"
					>
						New ground
					</p>
					<h2
						class="mt-1.5 text-xl font-semibold leading-tight text-slate-900"
						style="font-family: 'Satoshi', system-ui, sans-serif"
					>
						Drop a pin on your new location.
					</h2>
				</div>
			{/if}
			<MapPinSelector
				onSelect={handleMapPinSelect}
				onCancel={handleBack}
			/>
		</div>

	<!-- ADDRESS INPUT STEP -->
	{:else if flowStep === 'address-input'}
		{#if regroundingMode}
			<section class="pt-2 pb-2">
				<div class="mb-5">
					<p
						class="font-mono text-[10px] uppercase text-slate-500"
						style="letter-spacing: 0.22em"
					>
						New ground
					</p>
					<h2
						class="mt-1.5 text-xl font-semibold leading-tight text-slate-900"
						style="font-family: 'Satoshi', system-ui, sans-serif"
					>
						Enter your new address.
					</h2>
					{#if geoPermissionDenied}
						<p class="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
							<AlertCircle class="h-3.5 w-3.5 shrink-0" />
							Location access was denied.
						</p>
					{/if}
				</div>

				<div class="space-y-3">
					<div>
						<label for="avf-street" class="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">
							Street
						</label>
						<input
							id="avf-street"
							type="text"
							bind:value={street}
							placeholder="123 Main Street"
							class="w-full border-b border-slate-300 bg-transparent px-0 py-2 text-sm transition-colors focus:border-slate-900 focus:outline-none"
							onkeydown={handleKeydown}
						/>
					</div>

					<div class="grid grid-cols-6 gap-3">
						<div class="col-span-3">
							<label for="avf-city" class="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">City</label>
							<input
								id="avf-city"
								type="text"
								bind:value={city}
								placeholder="San Francisco"
								class="w-full border-b border-slate-300 bg-transparent px-0 py-2 text-sm transition-colors focus:border-slate-900 focus:outline-none"
								onkeydown={handleKeydown}
							/>
						</div>
						<div class="col-span-1">
							<label for="avf-state" class="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">{detectedCountry === 'CA' ? 'Prov' : 'State'}</label>
							<input
								id="avf-state"
								type="text"
								bind:value={stateCode}
								placeholder={detectedCountry === 'CA' ? 'ON' : 'CA'}
								maxlength={2}
								class="w-full border-b border-slate-300 bg-transparent px-0 py-2 text-center text-sm uppercase transition-colors focus:border-slate-900 focus:outline-none"
								onkeydown={handleKeydown}
							/>
						</div>
						<div class="col-span-2">
							<label for="avf-zip" class="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">{detectedCountry === 'CA' ? 'Postal' : 'ZIP'}</label>
							<input
								id="avf-zip"
								type="text"
								bind:value={zipCode}
								placeholder={detectedCountry === 'CA' ? 'K1A 0B1' : '94102'}
								maxlength={10}
								class="w-full border-b border-slate-300 bg-transparent px-0 py-2 text-sm transition-colors focus:border-slate-900 focus:outline-none"
								onkeydown={handleKeydown}
							/>
						</div>
					</div>
				</div>

				{#if errorMessage}
					<div class="mt-4 flex items-start gap-2 border-t border-dotted border-red-300 pt-3">
						<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
						<p class="text-sm text-red-700">{errorMessage}</p>
					</div>
				{/if}

				<!-- Primary action: document-register underlined text action -->
				<div class="mt-6 flex items-center justify-between border-t border-dotted border-slate-300 pt-4">
					<button
						type="button"
						class="font-mono text-sm text-slate-500 underline decoration-slate-300 decoration-1 underline-offset-4 transition-colors hover:text-slate-700 hover:decoration-slate-500"
						onclick={handleBack}
					>
						&larr; Back
					</button>
					<button
						type="button"
						class="font-mono text-sm font-medium text-slate-900 underline decoration-slate-400 decoration-1 underline-offset-4 transition-colors hover:text-emerald-700 hover:decoration-emerald-500 disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
						onclick={handleAddressPath}
						disabled={!isFormValid}
					>
						Resolve district &rarr;
					</button>
				</div>
			</section>
		{:else}
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
		{/if}

	<!-- RESOLVING STEP (loading) -->
	{:else if flowStep === 'resolving'}
		{#if regroundingMode}
			<section class="py-6" aria-live="polite">
				<div class="mb-5">
					<p
						class="font-mono text-[10px] uppercase text-slate-500"
						style="letter-spacing: 0.22em"
					>
						New ground
					</p>
					<h2
						class="mt-1.5 text-base font-medium text-slate-900"
						style="font-family: 'Satoshi', system-ui, sans-serif"
					>
						Resolving district
					</h2>
				</div>
				<div class="flex items-center gap-3 border-t border-b border-dotted border-slate-300 py-4 text-sm text-slate-500">
					<Loader2 class="h-4 w-4 shrink-0 animate-spin text-slate-500" />
					<span>Looking up the boundary around your coordinates.</span>
				</div>
			</section>
		{:else}
			<div class="flex flex-col items-center justify-center py-12 text-center">
				<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
					<Loader2 class="h-8 w-8 animate-spin text-emerald-600" />
				</div>
				<h3 class="text-lg font-semibold text-slate-900">Resolving District</h3>
				<p class="mt-2 text-sm text-slate-600">
					Looking up your congressional district...
				</p>
			</div>
		{/if}

	<!-- CONFIRM DISTRICT STEP -->
	{:else if flowStep === 'confirm-district'}
		{#if regroundingMode}
			<section class="pt-2 pb-2">
				<div class="mb-5">
					<p
						class="font-mono text-[10px] uppercase text-slate-500"
						style="letter-spacing: 0.22em"
					>
						New ground
					</p>
					<h2
						class="mt-1.5 text-xl font-semibold leading-tight text-slate-900"
						style="font-family: 'Satoshi', system-ui, sans-serif"
					>
						Confirm the boundary before we re-ground.
					</h2>
					{#if correctedAddress}
						<p class="mt-2 text-xs text-slate-500">
							Matched: {correctedAddress}
						</p>
					{/if}
				</div>

				<!-- District panel — document register, no emerald fill -->
				<div class="border-t border-b border-dotted border-slate-300 py-4">
					<div class="flex items-center gap-2">
						<MapPin class="h-4 w-4 text-slate-500" />
						<span
							class="font-mono text-base font-semibold text-slate-900"
							style="letter-spacing: 0.04em"
						>
							{verifiedDistrict}
						</span>
					</div>

					{#if representatives.length > 0}
						<div class="mt-3">
							<p
								class="mb-2 font-mono text-[10px] uppercase text-slate-500"
								style="letter-spacing: 0.22em"
							>
								Representatives
							</p>
							<ul class="space-y-1">
								{#each representatives as rep}
									<li class="text-sm text-slate-700">
										{rep.chamber === 'senate' ? 'Sen.' : 'Rep.'} <span class="font-medium text-slate-900">{rep.name}</span>{#if rep.party}&nbsp;<span class="text-slate-500">({rep.party})</span>{/if}
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>

				{#if errorMessage}
					<div class="mt-4 flex items-start gap-2 border-t border-dotted border-red-300 pt-3">
						<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
						<p class="text-sm text-red-700">{errorMessage}</p>
					</div>
				{/if}

				<div class="mt-6 flex items-center justify-between border-t border-dotted border-slate-300 pt-4">
					<button
						type="button"
						class="font-mono text-sm text-slate-500 underline decoration-slate-300 decoration-1 underline-offset-4 transition-colors hover:text-slate-700 hover:decoration-slate-500"
						onclick={handleEditAddress}
					>
						&larr; Edit
					</button>
					<button
						type="button"
						class="font-mono text-sm font-medium text-slate-900 underline decoration-slate-400 decoration-1 underline-offset-4 transition-colors hover:text-emerald-700 hover:decoration-emerald-500"
						onclick={handleConfirmDistrict}
					>
						Re-ground here &rarr;
					</button>
				</div>
			</section>
		{:else}
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
				<div class="rounded-md border border-emerald-200 bg-emerald-50 p-5">
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
		{/if}

	<!-- ISSUING CREDENTIAL STEP -->
	{:else if flowStep === 'issuing-credential'}
		{#if regroundingMode}
			<!--
				Re-grounding witnessing list. Two lines, bound to REAL async boundaries:
				  retire — clear IndexedDB address + session credential
				  attest — POST /api/identity/verify-address then storeCredential
				No timers. The pulsing CircleDot glyph carries active state.
			-->
			<section class="py-6" aria-live="polite">
				<div class="mb-5">
					<p
						class="font-mono text-[10px] uppercase text-slate-500"
						style="letter-spacing: 0.22em"
					>
						Re-grounding
					</p>
					<h2 class="mt-1.5 text-base font-medium text-slate-900">
						Witnessing the transition
					</h2>
				</div>

				<ul class="space-y-3">
					{#each witnessingLines as line}
						{@const s = regroundingStepStates[line.id]}
						<li class="flex items-center gap-3 text-sm" data-step={line.id} data-state={s}>
							<span aria-hidden="true" class="flex h-5 w-5 shrink-0 items-center justify-center">
								{#if s === 'done'}
									<CheckCircle2 class="h-4 w-4 text-emerald-600" />
								{:else if s === 'active'}
									<span class="relative flex h-3 w-3">
										<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60"></span>
										<span class="relative inline-flex h-3 w-3 rounded-full bg-emerald-500"></span>
									</span>
								{:else}
									<span class="h-2 w-2 rounded-full bg-slate-300"></span>
								{/if}
							</span>
							<span
								class="flex-1"
								class:text-slate-900={s === 'done'}
								class:text-emerald-700={s === 'active'}
								class:text-slate-400={s === 'pending'}
							>
								{line.label}
							</span>
						</li>
					{/each}
				</ul>
			</section>
		{:else}
			<div class="flex flex-col items-center justify-center py-12 text-center">
				<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-teal-100">
					<Loader2 class="h-8 w-8 animate-spin text-teal-600" />
				</div>
				<h3 class="text-lg font-semibold text-slate-900">Issuing Credential</h3>
				<p class="mt-2 text-sm text-slate-600">
					Creating your verifiable district credential...
				</p>
			</div>
		{/if}

	<!-- COMPLETE STEP -->
	{:else if flowStep === 'complete'}
		{#if regroundingMode}
			<!--
				Re-grounding consequential diff — IS column only.
				The WAS column is carried by AddressChangeFlow's Zone 1, which
				stays mounted through `complete` and is grid-positioned beside
				this component. Continuity: the same old-ground pane the user
				inhabited during capture IS the WAS column. No structural
				duplication.
			-->
			<section class="pt-2 pb-6">
				<div class="mb-5">
					<p
						class="font-mono text-[10px] uppercase text-emerald-700"
						style="letter-spacing: 0.22em"
					>
						Re-grounded
					</p>
					<h2
						class="mt-2 text-2xl font-semibold leading-tight text-slate-900"
						style="font-family: 'Satoshi', system-ui, sans-serif"
					>
						{#if districtChanged}
							Your representatives have changed.
						{:else if stateChanged}
							Your federal senators have changed.
						{:else}
							Your ground has been re-attested. Your representatives carry forward.
						{/if}
					</h2>

					<!--
						Change-axis chip — names the dimension that shifted in mono so
						the diff between WAS and IS is observable, not just spatial.
						District and state can both change; both rows render when they do.
						Falls back to "Senators reassigned" when state-change was inferred
						from senator-name diff (geolocation/map-pin paths never capture a
						state code, so we have nothing concrete to show).
					-->
					{#if districtChanged || stateChanged}
						<div class="mt-3 space-y-1" data-testid="reground-change-axis">
							{#if districtChanged}
								{@const oldDistrictCode = oldAddress?.district || ''}
								{@const newDistrictCode = newAddress?.district || verifiedDistrict || ''}
								<p class="font-mono text-[12px]">
									<span
										class="uppercase tracking-wider text-slate-400"
										style="letter-spacing: 0.18em"
									>
										District
									</span>
									{#if oldDistrictCode && newDistrictCode}
										<span class="ml-2 text-slate-500">{oldDistrictCode}</span>
										<span class="mx-1.5 text-slate-400">&rarr;</span>
										<span class="text-slate-900">{newDistrictCode}</span>
									{/if}
								</p>
							{/if}
							{#if stateChanged}
								{@const oldStateCode = oldAddress?.state || ''}
								{@const newStateCode = newAddress?.state || ''}
								<p class="font-mono text-[12px]">
									<span
										class="uppercase tracking-wider text-slate-400"
										style="letter-spacing: 0.18em"
									>
										State
									</span>
									{#if oldStateCode && newStateCode}
										<span class="ml-2 text-slate-500">{oldStateCode}</span>
										<span class="mx-1.5 text-slate-400">&rarr;</span>
										<span class="text-slate-900">{newStateCode}</span>
									{:else}
										<span class="ml-2 text-slate-500">Senators reassigned</span>
									{/if}
								</p>
							{/if}
						</div>
					{/if}
				</div>

				<!-- IS pane — structurally mirrors Zone 1's "Current ground" pane -->
				<div>
					<div class="mb-2 flex items-baseline justify-between">
						<span
							class="font-mono text-[10px] uppercase text-emerald-700"
							style="letter-spacing: 0.22em"
						>
							New ground
						</span>
						<span
							class="rounded-full border border-emerald-400 bg-emerald-50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-700"
						>
							Attested
						</span>
					</div>
					<div class="border-t border-b border-dotted border-emerald-400 py-4">
						{#if newAddress}
							<div class="space-y-1">
								<p class="text-[14px] font-medium text-slate-900">
									{newAddress.street}
								</p>
								<p class="text-[14px] text-slate-700">
									{newAddress.city}, {newAddress.state} {newAddress.zip}
								</p>
							</div>
						{:else}
							<p class="text-[14px] italic text-slate-500">
								Verified by location signal — no address captured.
							</p>
						{/if}
						{#if newAddress?.district || verifiedDistrict}
							<div class="mt-2 flex items-center gap-2 border-l-2 border-emerald-500 pl-3">
								<span class="font-mono text-xs font-medium text-emerald-800">
									{newAddress?.district || verifiedDistrict}
								</span>
							</div>
						{/if}
						{#if newRepresentatives.length > 0}
							<ul class="mt-3 space-y-1">
								{#each newRepresentatives as rep}
									<li class="text-sm text-slate-800">
										{rep.chamber === 'senate' ? 'Sen.' : 'Rep.'} <span class="font-medium">{rep.name}</span>{#if rep.party}&nbsp;<span class="text-slate-500">({rep.party})</span>{/if}
									</li>
								{/each}
							</ul>
						{:else}
							<p class="mt-3 text-xs italic text-slate-500">
								Refreshing representatives…
							</p>
						{/if}
					</div>
				</div>

				<!--
					Privacy receipt — the analytics emission is the most privacy-
					sensitive moment of the flow. Naming what was logged (and what
					wasn't) keeps the user's mental model honest.
				-->
				<div class="mt-5 space-y-1" data-testid="reground-privacy-receipt">
					<p
						class="font-mono text-[10px] uppercase text-slate-500"
						style="letter-spacing: 0.22em"
					>
						Privacy log
					</p>
					<p class="font-mono text-[12px] text-slate-700">
						address_changed
						<span class="mx-1 text-slate-300">&middot;</span>
						<span class="text-slate-500">d=</span>{districtChanged ? 1 : 0}
						<span class="mx-1 text-slate-300">&middot;</span>
						<span class="text-slate-500">s=</span>{stateChanged ? 1 : 0}
					</p>
					<p class="text-[12px] leading-relaxed text-slate-500">
						Two booleans, no district codes, no addresses, no IDs. Coordinates
						never left this browser.
					</p>
				</div>

				<!--
					F2 closure microcopy — re-grounding was safe to ship because
					action_domain v2 includes district_commitment in its preimage,
					so the new district has its own nullifier scope. Prior-district
					actions remain sound; nothing carries over by accident.
					Only render when the district actually changed; if you stayed
					in-district the reassurance is moot.
				-->
				{#if districtChanged}
					<p
						class="mt-5 max-w-prose text-[13px] leading-relaxed text-slate-500"
						data-testid="reground-f2-note"
					>
						Your prior-district actions remain sound. Each district carries its
						own nullifier scope, so re-grounding cannot replay or silently
						inherit anything from the ground you left.
					</p>
				{/if}

				<!-- Document-register primary action: top rule + linked text, no pill. -->
				<div class="mt-8 border-t border-dotted border-slate-300 pt-4 text-right">
					<button
						type="button"
						class="font-mono text-sm font-medium text-slate-900 underline decoration-slate-400 decoration-1 underline-offset-4 transition-colors hover:text-emerald-700 hover:decoration-emerald-500"
						onclick={handleRegroundingDone}
					>
						Done &rarr;
					</button>
				</div>
			</section>
		{:else}
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
	{/if}
</div>
