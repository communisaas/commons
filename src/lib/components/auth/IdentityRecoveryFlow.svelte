<!--
 * Identity Recovery Flow Component
 *
 * Streamlined recovery for users who already went through full registration
 * but lost their browser data (cleared IndexedDB, new device, etc.).
 *
 * Mirrors IdentityVerificationFlow but with only 3 steps:
 *   1. explain     — Brief explanation of what happened
 *   2. verify-mdl  — mDL re-verification via GovernmentCredentialVerification
 *   3. recovering  — Spinner while credentials restore
 *   4. complete    — Success confirmation
 *
 * Uses recoverThreeTree (replace: true) instead of registerThreeTree.
 -->

<script lang="ts">
	import { Check, Loader2, AlertTriangle } from '@lucide/svelte';
	import GovernmentCredentialVerification from './GovernmentCredentialVerification.svelte';

	let { userId, userEmail, oncomplete, oncancel }: {
		userId: string;
		userEmail?: string;
		oncomplete?: (data: { verified: boolean; method: string; userId: string; district?: string }) => void;
		oncancel?: () => void;
	} = $props();

	type FlowStep = 'explain' | 'verify-mdl' | 'recovering' | 'complete';

	let currentStep = $state<FlowStep>('explain');
	let recoveryError = $state<string | null>(null);
	let savedDistrict = $state<string | null>(null);
	let retryDisabled = $state(false);

	/**
	 * Handle mDL verification completion.
	 * After identity re-verification, triggers recovery flow to restore credentials.
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
		if (data.district) {
			await triggerRecovery(data.district);
		} else {
			recoveryError = 'No district returned from verification. Please try again.';
			currentStep = 'explain';
		}
	}

	function handleMdlError(data: { message: string }) {
		console.error('[Recovery] mDL verification error:', data.message);
		recoveryError = data.message;
		currentStep = 'explain';
	}

	function handleMdlCancel() {
		oncancel?.();
	}

	/**
	 * Restore credentials via recoverThreeTree after mDL re-verification.
	 *
	 * Flow mirrors triggerShadowAtlasRegistration from IdentityVerificationFlow:
	 *   1. Resolve district hex from display format via district index
	 *   2. Fetch full cell data from IPFS (Tree 2 proof + cellId as BN254 field element)
	 *   3. Generate client-side secrets (userSecret, registrationSalt) — NEVER leave browser
	 *   4. Compute leaf via Poseidon2_H4(secret, cellId, salt, authorityHex)
	 *   5. Call recoverThreeTree (replace: true) to zero old leaf and insert new one
	 *   6. On success: show complete, call oncomplete
	 *   7. On failure: show error with retry
	 */
	async function triggerRecovery(verifiedDistrict: string) {
		currentStep = 'recovering';
		recoveryError = null;
		savedDistrict = verifiedDistrict;

		try {
			const { findDistrictHex, getFullCellDataFromBrowser } = await import('$lib/core/shadow-atlas/browser-client');
			const { recoverThreeTree } = await import('$lib/core/identity/shadow-atlas-handler');
			const { poseidon2Hash4 } = await import('$lib/core/crypto/poseidon');

			// Step 1: Resolve district hex from display format (e.g. "CA-12" -> field element)
			const districtHex = await findDistrictHex(verifiedDistrict, 0);
			if (!districtHex) {
				throw new Error(`District "${verifiedDistrict}" not found in Shadow Atlas index`);
			}

			// Step 2: Fetch full cell data from IPFS (zero server contact)
			const cellData = await getFullCellDataFromBrowser({ districtHex, slot: 0 });
			if (!cellData) {
				throw new Error('Failed to fetch cell proof data from IPFS');
			}

			// Step 3: Generate client-side secrets (never sent to server)
			// Values MUST be valid BN254 field elements (< modulus, ~254 bits)
			const BN254_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

			function generateFieldElement(): string {
				const bytes = crypto.getRandomValues(new Uint8Array(32));
				let value = 0n;
				for (const b of bytes) value = (value << 8n) | BigInt(b);
				value = value % BN254_MODULUS;
				return '0x' + value.toString(16).padStart(64, '0');
			}

			const userSecret = generateFieldElement();
			const registrationSalt = generateFieldElement();

			// Step 4: Compute leaf using IPFS-resolved cellId
			// Authority level 5 = mDL verified (recovery is always for tier-5 users)
			const authorityLevel = 5;
			const authorityHex = '0x' + authorityLevel.toString(16).padStart(64, '0');

			const leaf = await poseidon2Hash4(userSecret, cellData.cellId, registrationSalt, authorityHex);

			// Step 5: Recover via recoverThreeTree (replace: true)
			const result = await recoverThreeTree({
				userId,
				leaf,
				cellId: cellData.cellId,
				tree2: {
					cellMapRoot: cellData.cellMapRoot,
					cellMapPath: cellData.cellMapPath,
					cellMapPathBits: cellData.cellMapPathBits,
					districts: cellData.districts,
				},
				userSecret,
				registrationSalt,
				verificationMethod: 'digital-credentials-api',
				verifiedDistrict,
			});

			if (result.success) {
				currentStep = 'complete';
				console.log('[Recovery] Credentials restored:', {
					leafIndex: result.sessionCredential?.leafIndex,
					districts: result.sessionCredential?.districts?.length ?? 0,
					engagementTier: result.sessionCredential?.engagementTier ?? 0
				});

				// Brief pause so user sees the success state, then fire oncomplete
				setTimeout(() => {
					oncomplete?.({
						verified: true,
						method: 'digital-credentials-api',
						userId,
						district: verifiedDistrict,
					});
				}, 1500);
			} else {
				console.error('[Recovery] Credential recovery failed:', result.error);
				recoveryError = result.error ?? 'Recovery failed';
				currentStep = 'explain';
			}
		} catch (error) {
			console.error('[Recovery] Credential recovery error:', error);
			recoveryError = error instanceof Error ? error.message : 'Unknown error';
			currentStep = 'explain';
		}
	}
</script>

<div class="mx-auto max-w-3xl">
	<!-- Progress Indicator -->
	{#if currentStep !== 'complete'}
		<div class="mb-8">
			<div class="flex items-center justify-between text-sm">
				<span class="font-medium text-slate-700">
					{#if currentStep === 'explain'}
						Credential Recovery
					{:else if currentStep === 'verify-mdl'}
						Verify Identity
					{:else if currentStep === 'recovering'}
						Restoring...
					{/if}
				</span>
				<span class="text-slate-500">
					{#if currentStep === 'explain'}
						Step 1 of 2
					{:else}
						Step 2 of 2
					{/if}
				</span>
			</div>
			<div class="mt-2 h-2 w-full rounded-full bg-slate-200">
				<div
					class="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
					style="width: {currentStep === 'explain' ? '33%' : currentStep === 'verify-mdl' ? '66%' : '95%'}"
				></div>
			</div>
		</div>
	{/if}

	<!-- Step Content -->
	<div class="rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
		{#if currentStep === 'explain'}
			<!-- Explanation Step -->
			<div class="py-8 text-center">
				<div
					class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-amber-100 to-orange-100"
				>
					<svg class="h-8 w-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
					</svg>
				</div>

				<h2 class="mb-3 text-2xl font-bold text-slate-900">Restore Your Credentials</h2>

				<p class="mx-auto mb-6 max-w-md text-base text-slate-600">
					Your proof credentials were cleared from this device. One quick verification to restore them.
				</p>

				{#if recoveryError}
					<div class="mx-auto mb-6 max-w-md rounded-lg border border-red-200 bg-red-50 p-3">
						<div class="flex items-center gap-2 text-sm text-red-700">
							<AlertTriangle class="h-4 w-4 flex-shrink-0" />
							<span>{recoveryError}</span>
						</div>
						{#if savedDistrict}
							<button
								type="button"
								onclick={() => {
									retryDisabled = true;
									setTimeout(() => { retryDisabled = false; }, 3000);
									triggerRecovery(savedDistrict!);
								}}
								disabled={retryDisabled}
								class="mt-2 rounded-md border border-red-300 bg-red-100 px-3 py-1.5 text-sm font-medium text-red-800 transition-colors hover:bg-red-200 disabled:opacity-50"
							>
								Retry Recovery
							</button>
						{/if}
					</div>
				{/if}

				<div class="flex flex-col gap-3 sm:flex-row sm:justify-center">
					<button
						type="button"
						onclick={() => { currentStep = 'verify-mdl'; }}
						class="rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-8 py-3 text-base font-semibold text-white shadow-lg transition-all hover:from-amber-600 hover:to-orange-600 hover:shadow-md"
					>
						Restore Credentials
					</button>
					{#if oncancel}
						<button
							type="button"
							onclick={oncancel}
							class="rounded-lg border border-slate-200 px-6 py-3 text-base font-medium text-slate-600 transition-colors hover:bg-slate-50"
						>
							Cancel
						</button>
					{/if}
				</div>
			</div>

		{:else if currentStep === 'verify-mdl'}
			<!-- mDL Verification -->
			<GovernmentCredentialVerification
				{userId}
				{userEmail}
				oncomplete={handleMdlComplete}
				onerror={handleMdlError}
				oncancel={handleMdlCancel}
			/>

		{:else if currentStep === 'recovering'}
			<!-- Recovering Spinner -->
			<div class="py-16 text-center">
				<div class="mx-auto mb-6 flex h-16 w-16 items-center justify-center">
					<Loader2 class="h-10 w-10 animate-spin text-amber-500" />
				</div>
				<h2 class="mb-2 text-xl font-bold text-slate-900">Restoring Credentials...</h2>
				<p class="text-sm text-slate-500">This may take a few seconds.</p>
			</div>

		{:else if currentStep === 'complete'}
			<!-- Success State -->
			<div class="py-12 text-center">
				<div
					class="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-green-400 to-emerald-600 shadow-md"
				>
					<Check class="h-10 w-10 text-white" strokeWidth={3} />
				</div>

				<h2 class="mb-3 text-3xl font-bold text-slate-900">Credentials Restored</h2>

				<p class="mb-6 text-lg text-slate-600">
					Your proof credentials are active again on this device.
				</p>

				<div class="mx-auto max-w-md rounded-lg border border-green-200 bg-green-50 p-4">
					<div class="flex items-center gap-2 text-sm text-green-700">
						<Check class="h-4 w-4" />
						<span>Zero-knowledge proofs ready</span>
					</div>
				</div>
			</div>
		{/if}
	</div>

	<!-- Help Text -->
	{#if currentStep !== 'complete' && currentStep !== 'recovering'}
		<div class="mt-6 text-center">
			<p class="text-sm text-slate-600">
				Having trouble? <a
					href="/help/verification"
					class="font-medium text-blue-600 hover:text-blue-700">Get help with recovery</a
				>
			</p>
		</div>
	{/if}
</div>
