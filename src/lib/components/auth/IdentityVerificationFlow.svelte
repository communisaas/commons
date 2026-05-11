<script lang="ts">
	import { untrack } from 'svelte';
	import { ChevronLeft, Check, Loader2, AlertTriangle } from '@lucide/svelte';

	import VerificationValueProp from './address-steps/VerificationValueProp.svelte';
	import GovernmentCredentialVerification from './GovernmentCredentialVerification.svelte';
	import { getJurisdictionLabels } from '$lib/core/locale/jurisdiction';
	import { RegistryMark } from '$lib/design';

	const labels = getJurisdictionLabels();

	interface Props {
		userId: string;
		/** User email for parent flow display; bridge labels are derived server-side. */
		userEmail?: string;
		templateSlug?: string;
		/** Skip value proposition (if already shown earlier in flow) */
		skipValueProp?: boolean;
		/**
		 * Minimum trust tier the gating action requires. Threaded through
		 * to `GovernmentCredentialVerification` so the dead-end copy can
		 * tell the user honestly whether address-tier fallback is enough
		 * for their goal.
		 */
		minimumTier?: number;
		/**
		 * The user's actual server-side trust tier at flow mount. Threaded
		 * through so the dead-end copy says "address-tier still works for
		 * you" only when the user actually has tier ≥ 2.
		 */
		userTrustTier?: number;
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
		minimumTier = 5,
		userTrustTier = 0,
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
	// G1: H3 cellId from verify-mdl (server-derived from postal+city+state via
	// Nominatim). Saved alongside savedDistrict so retry preserves the
	// constituency anchor — without this, retry would fall back to the random-
	// cell path and silently downgrade the user. See specs/CONSTITUENCY-PROOF-SEMANTICS.md §4 G1.
	let savedCellId = $state<string | null>(null);
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
			// G1: pass the H3 cellId returned by verify-mdl (data.cell_id is the
			// H3 string at H3_RESOLUTION=7, derived from the wallet's ZIP+city+state).
			// triggerShadowAtlasRegistration uses this as the constituency anchor.
			// Empty-string normalization: some geocoders return "" instead of null
			// on failure; treat both as missing to trigger the T3+ hard-fail in
			// triggerShadowAtlasRegistration.
			const normalizedCellId =
				typeof data.cell_id === 'string' && data.cell_id.trim() !== ''
					? data.cell_id.trim()
					: null;
			await triggerShadowAtlasRegistration(data.district, normalizedCellId);

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
	 *   1. Resolve district hex from display format via district index (for the
	 *      leaf's expected-district public input).
	 *   2. Fetch full cell data from IPFS — for T3+ users with a server-resolved
	 *      cellId, fetch the chunk for THAT cell (constituency anchor = user's
	 *      ZIP-derived cell). Without cellId (T0 fallback), pick a random cell
	 *      in the district (privacy preserved, no constituency anchor).
	 *   3. Generate client-side secrets (userSecret, registrationSalt) — NEVER leave browser.
	 *   4. Compute leaf hash using the cellId from step 2.
	 *   5. Call registerThreeTree with tree2 data.
	 *
	 * @param verifiedDistrict - Display format district code from mDL verification (e.g. "CA-12")
	 * @param verifiedCellId - H3 cell string at H3_RESOLUTION (7) returned by verify-mdl,
	 *                          or null when not available. When non-null, the leaf binds
	 *                          to the user's actual ZIP-derived cell instead of a random
	 *                          cell in the district. See specs/CONSTITUENCY-PROOF-SEMANTICS.md §4 G1.
	 */
	async function triggerShadowAtlasRegistration(
		verifiedDistrict: string,
		verifiedCellId: string | null
	) {
		registrationInProgress = true;
		registrationError = null;
		// Save both for retry — without cellId, retry would silently downgrade
		// to the random-cell path even though we have a real cellId in hand.
		savedDistrict = verifiedDistrict;
		savedCellId = verifiedCellId;

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

			// Step 2: Fetch full cell data from IPFS.
			// G1: branch on authorityLevel, NOT cellId presence.
			// Spec defense-in-depth (CONSTITUENCY-PROOF-SEMANTICS.md §4 G1):
			// "a future bug shouldn't downgrade T3+ to T0 silently."
			// If a T3+ user reaches this path with null cellId (geocoder
			// transient failure inside privacy boundary, mDL postal_code
			// missing, etc.), we hard-fail rather than silently anchor them
			// to a random cell while keeping authorityLevel=5. This flow runs
			// only after mDL verification succeeded, so T3+ is mandatory here.
			const authorityLevel = 5;
			const isT3Plus = authorityLevel >= 3;

			// Local cellAnchorMode type — runtime constant union; canonical type
			// is CellAnchorMode in session-credentials.ts. This block uses only
			// the address-resolved/random-fallback/recovery-pivot subset.
			let cellData: Awaited<ReturnType<typeof getFullCellDataFromBrowser>>;
			let cellAnchorMode:
				| 'address-resolved'
				| 'random-fallback'
				| 'recovery-explicit'
				| 'recovery-pivot';
			if (isT3Plus) {
				if (!verifiedCellId) {
					// Hard-fail: T3+ requires the constituency anchor. The geocoder
					// returned null (Nominatim degradation, mDL postal_code missing,
					// or address resolution failure). User-actionable: retry, or
					// re-verify after the geocoder recovers.
					throw new Error(
						'T3+ verification requires a resolved cellId; geocoder returned no cell ' +
							'for this address. Retry, or wait for geocoder recovery.'
					);
				}
				cellData = await getFullCellDataFromBrowser({ cellId: verifiedCellId });
				// G8r honesty: the cellId is Nominatim/H3-derived from postal_code+
				// city+state. The wallet provides the address fields, NOT the cell.
				cellAnchorMode = 'address-resolved';
			} else {
				// T0 path: random-chunk anonymity-cell. Reserved for unverified flows.
				// (Currently unreachable — this component runs only post-mDL — but
				// kept as the structural T0 branch for future T0 entry points.)
				cellData = await getFullCellDataFromBrowser({ districtHex, slot: 0 });
				cellAnchorMode = 'random-fallback';
			}
			if (!cellData) {
				throw new Error('Failed to fetch cell proof data from IPFS');
			}

			// G6: capture atlas version for migration delta. Best-effort —
			// if manifest fetch fails the credential persists without it
			// and the migration check returns "unknown" rather than blocking.
			let atlasVersion: string | undefined;
			try {
				const { getCurrentAtlasVersion } = await import(
					'$lib/core/shadow-atlas/district-bundle'
				);
				atlasVersion = (await getCurrentAtlasVersion()) ?? undefined;
			} catch {
				atlasVersion = undefined;
			}

			// G2: detect boundary-cell mismatch. Tree 2's slot[0] for the
			// user's cell may disagree with the verified district when the
			// cell straddles a district boundary (the cell's centroid is in
			// district X but the user's address polygon-hits district Y).
			// MARK don't BLOCK for boundary mismatch — continue registration
			// with cellStraddles=true so the disagreement is visible. G5
			// receipt UI surfaces this so the user sees that delivery routes
			// to the cell-bound district, not necessarily the wallet-endorsed
			// one. (Resolver routes from witness.districts[0], cryptographically
			// bound to cellId via SMT inclusion — that's the G7r option-c
			// security guarantee, can't be weakened to "trust the wallet
			// district" without breaking the cell-splitting attack defense.)
			//
			// HARD-FAIL on atlas corruption: if districts[0] is missing or
			// malformed, that's not a boundary cell — it's broken atlas data.
			// Continuing would persist garbage into the credential's leaf
			// hash and Stage 2.7 districtCommitment.
			//
			// Compare via BigInt so 0x1 / 0x01 / no-prefix variations don't
			// produce false-positive boundaries.
			const { CONGRESSIONAL_SLOT_INDEX, bn254HexEqual } = await import(
				'$lib/core/shadow-atlas/district-format'
			);
			const tree2DistrictHex = cellData.districts[CONGRESSIONAL_SLOT_INDEX];
			if (
				isT3Plus &&
				(!tree2DistrictHex || tree2DistrictHex === '0x0' || tree2DistrictHex === '0')
			) {
				throw new Error(
					'Atlas chunk is corrupt: cellData.districts[0] is missing or zero. ' +
						'This indicates broken atlas data, not a boundary cell. Refusing ' +
						'to register a credential with garbage district binding.'
				);
			}
			const cellStraddles = isT3Plus
				? !bn254HexEqual(tree2DistrictHex, districtHex)
				: false;
			if (cellStraddles && import.meta.env.DEV) {
				// Dev-only: production console must not log district + hexes.
				// G5 surfaces boundary status to the user via the receipt UI;
				// G8: cellAnchorMode is local-only forensics (handler doesn't
				// transmit it). G3 metrics read BAF directly, not credentials.
				console.warn('[Verification] Boundary-cell mismatch detected', {
					verifiedDistrict,
					tree2DistrictHex,
					expectedDistrictHex: districtHex,
				});
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

			// Step 4: Compute leaf using IPFS-resolved cellId (already 0x-hex BN254 field element).
			// authorityLevel was set above (Step 2) — mDL flow always uses tier 5.
			// The server derives authorityLevel from trustTier via getIdentityForAtlas,
			// so both sides agree on the value used in the leaf hash.
			const authorityHex = '0x' + authorityLevel.toString(16).padStart(64, '0');

			// leaf = Poseidon2_H4(userSecret, cellId, registrationSalt, authorityLevel)
			// Uses 2-round sponge with DOMAIN_HASH4 — matches Noir circuit exactly
			const leaf = await poseidon2Hash4(
				userSecret,
				cellData.cellId,
				registrationSalt,
				authorityHex
			);

			// Step 5: Register with tree2 data from IPFS.
			// G7: thread the H3 encoding alongside the BN254 cellId so the TEE
			// resolver can compare H3-to-H3 (resolveAddress returns H3, witness
			// previously only carried BN254). h3Cell is the same value as the
			// verifiedCellId we used to fetch the chunk (T3+ path) — for T0,
			// it's null because the leaf binds to a random cell, not the user's.
			const result = await registerThreeTree({
				userId,
				leaf,
				cellId: cellData.cellId,
				h3Cell: verifiedCellId ?? undefined,
				cellStraddles,
				atlasVersion,
				cellAnchorMode,
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
					h3Cell: verifiedCellId ?? undefined,
					cellStraddles,
					atlasVersion,
					// G8: registration→recovery pivot — server returned "Already
					// registered." Distinct from explicit IdentityRecoveryFlow
					// (device-loss): this is multi-device, race, or UX defect.
					cellAnchorMode: 'recovery-pivot',
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
				<!-- No percentage label — a public record doesn't withhold the
				     last percent to push users through a funnel. The step
				     label above ("Step N of M") is the honest signal. -->
			</div>
			<div class="mt-2 h-2 w-full rounded-full bg-slate-200">
				<div
					class="h-full rounded-full bg-slate-700 transition-all duration-500"
					style="width: {currentStep === 'value-prop' ? '50%' : '100%'}"
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
				{minimumTier}
				{userTrustTier}
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

				<!-- Success as record, not celebration. Per design memory:
				     "tiers/metrics are infrastructure not headlines";
				     "verification-first hierarchy". The headline names the
				     fact (a credential was witnessed); decorative
				     "build reputation" copy is dropped because it's a
				     marketing promise the substrate doesn't make. -->
				<h2 class="mb-3 text-3xl font-semibold text-slate-900">Credential witnessed</h2>

				<p class="mb-2 text-base text-slate-600">
					Your messages to {labels.legislativeBody} offices will carry verified
					provenance.
				</p>

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
									// G1: preserve the constituency anchor across retry —
									// pass the saved cellId, not just the district.
									triggerShadowAtlasRegistration(savedDistrict!, savedCellId);
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
					<div class="mx-auto mb-2 max-w-md rounded-lg border border-green-200 bg-green-50 p-3">
						<div class="flex items-center gap-2 text-sm text-green-700">
							<Check class="h-4 w-4" />
							<span>Proof credentials ready</span>
						</div>
					</div>
					{#if verificationData?.providerData?.credentialHash}
						<p class="mx-auto mb-6 max-w-md text-right">
							<RegistryMark
								variant="sha256"
								value={verificationData.providerData.credentialHash}
								truncate={true}
								copy={false}
								class="text-[11px] text-slate-500"
							/>
						</p>
					{/if}
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
