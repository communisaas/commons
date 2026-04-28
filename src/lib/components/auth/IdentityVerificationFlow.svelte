<script lang="ts">
	import { untrack } from 'svelte';
	import { ChevronLeft, Check, Loader2, AlertTriangle } from '@lucide/svelte';

	import VerificationValueProp from './address-steps/VerificationValueProp.svelte';
	import GovernmentCredentialVerification from './GovernmentCredentialVerification.svelte';

	interface Props {
		userId: string;
		/** User email for parent flow display; bridge labels are derived server-side. */
		userEmail?: string;
		templateSlug?: string;
		/** Skip value proposition (if already shown earlier in flow) */
		skipValueProp?: boolean;
		oncomplete?: (data: {
			verified: boolean;
			method: string;
			userId: string;
			district?: string;
			state?: string;
			address?: { street: string; city: string; state: string; zip: string };
			cell_id?: string;
			providerData?: {
				provider: 'digital-credentials-api';
				credentialHash: string;
				issuedAt: number;
				expiresAt?: number;
			};
		}) => void;
		oncancel?: () => void;
		onback?: () => void;
	}

	let {
		userId,
		userEmail,
		templateSlug,
		skipValueProp = false,
		oncomplete,
		oncancel,
		onback
	}: Props = $props();

	type FlowStep = 'value-prop' | 'verify-mdl' | 'complete';

	let currentStep = $state<FlowStep>(untrack(() => (skipValueProp ? 'verify-mdl' : 'value-prop')));
	let verificationComplete = $state(false);
	let registrationInProgress = $state(false);
	let registrationComplete = $state(false);
	let registrationError = $state<string | null>(null);
	let oncompletePending = $state(false);
	let retryDisabled = $state(false);
	let savedDistrict = $state<string | null>(null);
	let verificationData = $state<{
		verified: boolean;
		method: string;
		district?: string;
		state?: string;
		address?: { street: string; city: string; state: string; zip: string };
		cell_id?: string;
		providerData?: {
			provider: 'digital-credentials-api';
			credentialHash: string;
			issuedAt: number;
			expiresAt?: number;
		};
	} | null>(null);

	/**
	 * Handle mDL verification completion (callback props, not CustomEvent).
	 * GovernmentCredentialVerification uses Svelte 5 callback pattern.
	 *
	 * After identity verification succeeds, triggers Shadow Atlas three-tree
	 * registration so the user can generate ZK proofs for congressional submissions.
	 */
	async function handleMdlComplete(data: {
		verified: boolean;
		method: string;
		district?: string;
		state?: string;
		address?: { street: string; city: string; state: string; zip: string };
		cell_id?: string;
		providerData?: {
			provider: 'digital-credentials-api';
			credentialHash: string;
			issuedAt: number;
		};
	}) {
		verificationComplete = true;
		verificationData = data;
		currentStep = 'complete';

		// Add verified location signal to IndexedDB (client-side only)
		if (data.district && data.state) {
			try {
				const { addVerifiedLocationSignal } = await import('$lib/core/location');
				await addVerifiedLocationSignal(data.district, data.state);
				console.log('[Verification] Added verified location signal:', {
					district: data.district,
					state: data.state
				});
			} catch (error) {
				console.error('[Verification] Failed to add location signal:', error);
			}
		}

		// Trigger Shadow Atlas three-tree registration (blocking)
		// This registers the user's leaf hash in Tree 1 and fetches Tree 2/3 proofs,
		// enabling ZK proof generation for congressional submissions.
		if (data.district) {
			await triggerShadowAtlasRegistration(data.district);

			// If registration succeeded, fire oncomplete immediately
			if (registrationComplete) {
				oncomplete?.({ ...data, userId });
			} else {
				// Registration failed — defer oncomplete to manual Continue button
				oncompletePending = true;
			}
		} else {
			console.warn('[Verification] No district available — Shadow Atlas registration deferred');
			registrationError =
				'Proof credentials could not be set up because no district was returned. Please retry verification.';
			oncompletePending = false;
		}
	}

	/**
	 * Register in Shadow Atlas three-tree architecture after identity verification.
	 *
	 * Flow:
	 *   1. Resolve district hex from display format via district index
	 *   2. Fetch full cell data from IPFS (Tree 2 proof + cellId as BN254 field element)
	 *   3. Generate client-side secrets (userSecret, registrationSalt) — NEVER leave browser
	 *   4. Compute leaf hash using IPFS-resolved cellId
	 *   5. Call registerThreeTree with tree2 data
	 *
	 * @param verifiedDistrict - Display format district code from mDL verification (e.g. "CA-12")
	 */
	async function triggerShadowAtlasRegistration(verifiedDistrict: string) {
		registrationInProgress = true;
		registrationError = null;
		// Save district for retry
		savedDistrict = verifiedDistrict;

		try {
			const { findDistrictHex, getFullCellDataFromBrowser } =
				await import('$lib/core/shadow-atlas/browser-client');
			const { registerThreeTree, recoverThreeTree } =
				await import('$lib/core/identity/shadow-atlas-handler');
			const { poseidon2Hash4 } = await import('$lib/core/crypto/poseidon');

			// Step 1: Resolve district hex from display format (e.g. "CA-12" → field element)
			const districtHex = await findDistrictHex(verifiedDistrict, 0);
			if (!districtHex) {
				throw new Error(`District "${verifiedDistrict}" not found in Shadow Atlas index`);
			}

			// Step 2: Fetch full cell data from IPFS (Tree 2 proof + cellId)
			// This is zero-server-contact — data comes from content-addressed IPFS via Storacha CDN
			const cellData = await getFullCellDataFromBrowser({ districtHex, slot: 0 });
			if (!cellData) {
				throw new Error('Failed to fetch cell proof data from IPFS');
			}

			// Step 3: Generate client-side secrets (never sent to server)
			// Values MUST be valid BN254 field elements (< modulus, ~254 bits).
			// Raw 32-byte randoms are 256 bits and exceed the modulus ~75% of the time,
			// causing poseidon hexToFr to throw. Reduce modulo BN254 after generation.
			const BN254_MODULUS =
				21888242871839275222246405745257275088548364400416034343698204186575808495617n;

			function generateFieldElement(): string {
				const bytes = crypto.getRandomValues(new Uint8Array(32));
				let value = 0n;
				for (const b of bytes) value = (value << 8n) | BigInt(b);
				value = value % BN254_MODULUS;
				return '0x' + value.toString(16).padStart(64, '0');
			}

			const userSecret = generateFieldElement();
			const registrationSalt = generateFieldElement();

			// Step 4: Compute leaf using IPFS-resolved cellId (already 0x-hex BN254 field element)
			// Authority level 5 = mDL verified. This flow only runs after mDL verification
			// which sets trustTier=5. The server derives authorityLevel from trustTier via
			// getIdentityForAtlas, so both sides agree on the value used in the leaf hash.
			const authorityLevel = 5;
			const authorityHex = '0x' + authorityLevel.toString(16).padStart(64, '0');

			// leaf = Poseidon2_H4(userSecret, cellId, registrationSalt, authorityLevel)
			// Uses 2-round sponge with DOMAIN_HASH4 — matches Noir circuit exactly
			const leaf = await poseidon2Hash4(
				userSecret,
				cellData.cellId,
				registrationSalt,
				authorityHex
			);

			// Step 5: Register with tree2 data from IPFS
			const result = await registerThreeTree({
				userId,
				leaf,
				cellId: cellData.cellId,
				tree2: {
					cellMapRoot: cellData.cellMapRoot,
					cellMapPath: cellData.cellMapPath,
					cellMapPathBits: cellData.cellMapPathBits,
					districts: cellData.districts
				},
				userSecret,
				registrationSalt,
				verificationMethod: 'digital-credentials-api',
				verifiedDistrict
			});

			if (result.success) {
				registrationComplete = true;
				console.log('[Verification] Shadow Atlas registration complete:', {
					leafIndex: result.sessionCredential?.leafIndex,
					districts: result.sessionCredential?.districts?.length ?? 0,
					engagementTier: result.sessionCredential?.engagementTier ?? 0
				});
				// If oncomplete was deferred (retry after initial failure), fire it now
				if (oncompletePending && verificationData) {
					oncompletePending = false;
					oncomplete?.({ ...verificationData, userId });
				}
			} else if (result.error && result.error.includes('Already registered')) {
				// Pivot to recovery: user was previously registered but lost local credentials.
				// Re-use the same inputs (secrets, tree2 data, cellId) — recoverThreeTree
				// sends replace: true so the Shadow Atlas zeros the old leaf and inserts the new one.
				console.info('[Identity] Already registered \u2014 pivoting to recovery');
				const recoveryResult = await recoverThreeTree({
					userId,
					leaf,
					cellId: cellData.cellId,
					tree2: {
						cellMapRoot: cellData.cellMapRoot,
						cellMapPath: cellData.cellMapPath,
						cellMapPathBits: cellData.cellMapPathBits,
						districts: cellData.districts
					},
					userSecret,
					registrationSalt,
					verificationMethod: 'digital-credentials-api',
					verifiedDistrict
				});

				if (recoveryResult.success) {
					registrationComplete = true;
					console.log('[Verification] Shadow Atlas recovery complete:', {
						leafIndex: recoveryResult.sessionCredential?.leafIndex,
						districts: recoveryResult.sessionCredential?.districts?.length ?? 0,
						engagementTier: recoveryResult.sessionCredential?.engagementTier ?? 0
					});
					if (oncompletePending && verificationData) {
						oncompletePending = false;
						oncomplete?.({ ...verificationData, userId });
					}
				} else {
					console.error('[Verification] Shadow Atlas recovery also failed:', recoveryResult.error);
					registrationError = recoveryResult.error ?? 'Recovery failed';
				}
			} else {
				console.error('[Verification] Shadow Atlas registration failed:', result.error);
				registrationError = result.error ?? 'Registration failed';
			}
		} catch (error) {
			console.error('[Verification] Shadow Atlas registration error:', error);
			registrationError = error instanceof Error ? error.message : 'Unknown error';
		} finally {
			registrationInProgress = false;
		}
	}

	function handleMdlError(data: { message: string }) {
		console.error('mDL verification error:', data.message);
	}

	function handleMdlCancel() {
		// Since mDL is the only method, canceling goes back to value-prop or parent
		if (!skipValueProp) {
			currentStep = 'value-prop';
		} else {
			onback?.();
		}
	}

	function goBack() {
		if (currentStep === 'verify-mdl' && !skipValueProp) {
			currentStep = 'value-prop';
		} else {
			onback?.();
		}
	}

	function proceedFromValueProp() {
		currentStep = 'verify-mdl';
	}
</script>

<div class="mx-auto max-w-3xl">
	<!-- Progress Indicator -->
	{#if !verificationComplete}
		<div class="mb-8">
			<div class="flex items-center justify-between text-sm">
				<span class="font-medium text-slate-700">
					{#if currentStep === 'value-prop'}
						Step 1 of 2: Understand Verification
					{:else if currentStep === 'verify-mdl'}
						Step 2 of 2: Complete Verification
					{/if}
				</span>
				<span class="text-slate-500">
					{#if currentStep === 'value-prop'}
						50%
					{:else}
						99%
					{/if}
				</span>
			</div>
			<div class="mt-2 h-2 w-full rounded-full bg-slate-200">
				<div
					class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-700 transition-all duration-500"
					style="width: {currentStep === 'value-prop' ? '50%' : '99%'}"
				></div>
			</div>
		</div>
	{/if}

	<!-- Back Button (except on first and last steps) -->
	{#if currentStep !== 'value-prop' && currentStep !== 'complete' && !skipValueProp}
		<button
			type="button"
			onclick={goBack}
			class="mb-6 flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
		>
			<ChevronLeft class="h-4 w-4" />
			<span>Back</span>
		</button>
	{/if}

	<!-- Step Content -->
	<div class="rounded-lg border border-slate-200 bg-white p-8 shadow-lg">
		{#if currentStep === 'value-prop'}
			<!-- Value Proposition -->
			<VerificationValueProp variant="full" />

			<div class="mt-8">
				<button
					type="button"
					onclick={proceedFromValueProp}
					class="w-full rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-700 px-6 py-4 text-lg font-semibold text-white shadow-lg transition-all hover:bg-emerald-700 hover:shadow-md"
				>
					Continue to Verification
				</button>
			</div>
		{:else if currentStep === 'verify-mdl'}
			<!-- mDL / Digital ID Verification (Svelte 5 callback props) -->
			<GovernmentCredentialVerification
				{userId}
				{userEmail}
				{templateSlug}
				oncomplete={handleMdlComplete}
				onerror={handleMdlError}
				oncancel={handleMdlCancel}
			/>
		{:else if currentStep === 'complete'}
			<!-- Success State -->
			<div class="py-12 text-center">
				<div
					class="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-green-400 to-emerald-600 shadow-md"
				>
					<Check class="h-10 w-10 text-white" strokeWidth={3} />
				</div>

				<h2 class="mb-3 text-3xl font-bold text-slate-900">Verification Complete!</h2>

				<p class="mb-2 text-lg text-slate-600">Your identity has been successfully verified</p>

				<div class="mx-auto mb-8 max-w-md">
					<div class="mt-6 rounded-lg border border-green-200 bg-green-50 p-4">
						<p class="text-sm font-medium text-green-900">What happens next:</p>
						<ul class="mt-2 space-y-1 text-sm text-green-800">
							<li class="flex items-start gap-2">
								<span class="text-green-600">✓</span>
								<span>Your messages will be marked as verified</span>
							</li>
							<li class="flex items-start gap-2">
								<span class="text-green-600">✓</span>
								<span>Congressional offices will prioritize your message</span>
							</li>
							<li class="flex items-start gap-2">
								<span class="text-green-600">✓</span>
								<span>You'll build reputation with every civic action</span>
							</li>
						</ul>
					</div>
				</div>

				<!-- Shadow Atlas registration status -->
				{#if registrationInProgress}
					<div class="mx-auto mb-6 max-w-md rounded-lg border border-blue-200 bg-blue-50 p-3">
						<div class="flex items-center gap-2 text-sm text-blue-700">
							<Loader2 class="h-4 w-4 animate-spin" />
							<span>Setting up proof credentials...</span>
						</div>
					</div>
				{:else if registrationError}
					<div class="mx-auto mb-6 max-w-md rounded-lg border border-amber-200 bg-amber-50 p-3">
						<div class="flex items-center gap-2 text-sm text-amber-700">
							<AlertTriangle class="h-4 w-4" />
							<span>Proof setup failed. Retry before continuing to message submission.</span>
						</div>
						{#if savedDistrict}
							<button
								type="button"
								onclick={() => {
									retryDisabled = true;
									setTimeout(() => {
										retryDisabled = false;
									}, 3000);
									triggerShadowAtlasRegistration(savedDistrict!);
								}}
								disabled={registrationInProgress || retryDisabled}
								class="mt-2 rounded-md border border-amber-300 bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-200 disabled:opacity-50"
							>
								{#if registrationInProgress}
									Retrying...
								{:else}
									Retry Proof Setup
								{/if}
							</button>
						{/if}
					</div>
				{:else if registrationComplete}
					<div class="mx-auto mb-6 max-w-md rounded-lg border border-green-200 bg-green-50 p-3">
						<div class="flex items-center gap-2 text-sm text-green-700">
							<Check class="h-4 w-4" />
							<span>Proof credentials ready</span>
						</div>
					</div>
				{/if}

				{#if registrationComplete}
					<div class="flex flex-col gap-3 sm:flex-row sm:justify-center">
						<button
							type="button"
							onclick={() => {
								oncompletePending = false;
								oncomplete?.({ ...verificationData!, userId });
							}}
							class="rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-700 px-8 py-3 text-base font-semibold text-white shadow-lg transition-all hover:bg-emerald-700 hover:shadow-md"
						>
							Continue to Message Submission
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Help Text -->
	{#if currentStep !== 'complete'}
		<div class="mt-6 text-center">
			<p class="text-sm text-slate-600">
				Having trouble? <a
					href="/help/verification"
					class="font-medium text-blue-600 hover:text-blue-700">Get help with verification</a
				>
			</p>
		</div>
	{/if}
</div>
