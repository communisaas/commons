<!--
 * Verification Gate Component
 *
 * Progressive verification interceptor that gates Congressional message submission.
 * Supports graduated trust tiers (0-5):
 *   - Tier 0 (guest):            Not handled here (requires authentication first)
 *   - Tier 1 (authenticated):    Passthrough (minimum for non-congressional actions)
 *   - Tier 2 (address-attested): AddressVerificationFlow (district credential)
 *   - Tier 3 (identity-verified): IdentityVerificationFlow (ID card / license)
 *   - Tier 4 (passport-verified): IdentityVerificationFlow (passport path)
 *   - Tier 5 (government-cred):  IdentityVerificationFlow (with mDL option)
 *
 * Flow:
 * 1. User clicks "Send Message" on Congressional template
 * 2. Check trust_tier >= minimumTier and required local proof material
 * 3. If verified: Allow submission
 * 4. If not verified: Show appropriate verification flow based on minimumTier
 * 5. After verification: Continue with original action
 *
 * This implements the "pull users naturally toward verification" paradigm.
 -->

<script lang="ts">
	import { scale, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { X } from '@lucide/svelte';
	import IdentityVerificationFlow from './IdentityVerificationFlow.svelte';
	import IdentityRecoveryFlow from './IdentityRecoveryFlow.svelte';
	import AddressVerificationFlow from './AddressVerificationFlow.svelte';
	import {
		credentialMeetsMinimumTier,
		getUsableProofCredential,
		needsCredentialRecovery
	} from '$lib/core/identity/recovery-detector';
	import { decryptedUser } from '$lib/stores/decryptedUser.svelte';
	import { isAnyMdlProtocolEnabled } from '$lib/config/features';

	interface Props {
		userId: string;
		templateSlug?: string;
		/** If true, shows the verification modal */
		showModal: boolean;
		/**
		 * Census Block GEOID (15-digit cell identifier) for three-tree ZK architecture
		 * PRIVACY: Neighborhood-level precision (600-3000 people)
		 */
		cellId?: string;
		/** Minimum trust tier required (default: 2 for address-attested) */
		minimumTier?: number;
		/** User's current trust tier from server (default: 0 for anonymous) */
		userTrustTier?: number;
		/**
		 * Force the Tier-2 address verification flow regardless of the user's
		 * current tier. Used exclusively by AddressChangeFlow for re-grounding:
		 * a tier-2+ user otherwise cannot re-enter the address flow.
		 */
		forceAddressFlow?: boolean;
		onverified?: (data: { userId: string; method: string; verified?: boolean }) => void;
		oncancel?: () => void;
	}

	let {
		userId,
		templateSlug,
		showModal = $bindable(),
		cellId,
		minimumTier = 2,
		userTrustTier = 0,
		forceAddressFlow = false,
		onverified,
		oncancel
	}: Props = $props();

	// Recovery state: tier-5 user with missing local credentials
	let showRecovery = $state(false);
	let recoveryCheckVersion = 0;

	// Check recovery state when modal opens
	$effect(() => {
		const version = ++recoveryCheckVersion;

		if (!showModal || forceAddressFlow || userTrustTier < 5) {
			showRecovery = false;
			return;
		}

		needsCredentialRecovery(userId, userTrustTier)
			.then((needs) => {
				if (
					version === recoveryCheckVersion &&
					showModal &&
					!forceAddressFlow &&
					userTrustTier >= 5
				) {
					showRecovery = needs;
				}
			})
			.catch((error) => {
				console.error('[Verification Gate] Recovery check failed:', error);
				if (version === recoveryCheckVersion) {
					showRecovery = false;
				}
			});
	});

	// Derived: which verification flow to show
	// `forceAddressFlow` overrides tier checks — used by AddressChangeFlow to
	// re-enter the flow for an already-verified user (re-grounding / move).
	let needsTier2: boolean = $derived(forceAddressFlow || (minimumTier <= 2 && userTrustTier < 2));
	let needsTier4Plus: boolean = $derived(
		!forceAddressFlow && minimumTier >= 4 && userTrustTier < minimumTier
	);

	// mDL launch gate: every path inside this gate that mounts the mDL flow
	// needs at least one enabled browser-mediated protocol. When no protocol is
	// enabled, surface a calm placeholder instead of dispatching into an
	// unavailable wallet flow.
	//
	// All non-address paths inside this gate are mDL-bound:
	//   - showRecovery — IdentityRecoveryFlow requires mDL re-verification
	//   - needsTier4Plus — explicit Tier-4+ upgrade
	//   - default "else" branch — Tier 2/3 → mDL upgrade
	//
	// The address path (needsTier2 / forceAddressFlow) doesn't touch mDL, so it
	// stays available regardless of the launch gate.
	let mdlGated: boolean = $derived(!isAnyMdlProtocolEnabled() && !needsTier2 && !forceAddressFlow);

	/**
	 * Check if user meets the minimum trust tier and has required local proof material.
	 * Called before showing modal - allows instant send if verified.
	 *
	 * Priority:
	 * 1. Tier-5 users with lost local proof material must enter recovery.
	 * 2. If proof-grade verification is required, local proof material must exist.
	 * 3. If userTrustTier >= minimumTier, user is already verified for non-proof paths.
	 * 4. Otherwise, fall back to IndexedDB proof credential presence.
	 */
	export async function checkVerification(): Promise<boolean> {
		try {
			// Re-grounding override: always force the flow, even for verified users.
			if (forceAddressFlow) {
				return false;
			}

			if (userTrustTier >= 5) {
				const recoveryRequired = await needsCredentialRecovery(userId, userTrustTier);
				if (recoveryRequired) {
					console.log('[Verification Gate] Local proof credentials need recovery');
					showRecovery = true;
					return false;
				}
			}

			let proofCredential = await getUsableProofCredential(userId);

			if (minimumTier >= 4) {
				if (!proofCredential || !credentialMeetsMinimumTier(proofCredential, minimumTier)) {
					console.log('[Verification Gate] Local proof credential missing or under-authorized');
					return false;
				}
			}

			// Fast path: server-side trust tier already meets requirement
			if (userTrustTier >= minimumTier) {
				console.log('[Verification Gate] Trust tier check passed:', { userTrustTier, minimumTier });
				return true;
			}

			// Fallback: check IndexedDB proof credential presence
			const isVerified =
				proofCredential !== null && credentialMeetsMinimumTier(proofCredential, minimumTier);
			console.log('[Verification Gate] Proof credential check:', {
				isVerified,
				userTrustTier,
				minimumTier
			});
			return isVerified;
		} catch (error) {
			console.error('[Verification Gate] Session check failed:', error);
			return false;
		}
	}

	function handleVerificationComplete(data: {
		verified: boolean;
		method: string;
		userId: string;
		district?: string;
	}) {
		console.log('[Verification Gate] Verification complete:', data);
		showModal = false;
		onverified?.({
			userId: data.userId,
			method: data.method,
			verified: data.verified
		});
	}

	/**
	 * Handle Tier 2 address verification completion (callback from AddressVerificationFlow)
	 */
	function handleAddressVerificationComplete(detail: { district: string; method: string }) {
		console.log('[Verification Gate] Address verification complete:', detail);
		showModal = false;
		onverified?.({
			userId,
			method: `address:${detail.method}`,
			verified: true
		});
	}

	function handleRecoveryComplete(data: {
		verified: boolean;
		method: string;
		userId: string;
		district?: string;
	}) {
		console.log('[Verification Gate] Recovery complete:', data);
		showRecovery = false;
		showModal = false;
		onverified?.({
			userId: data.userId,
			method: data.method,
			verified: data.verified
		});
	}

	function handleCancel() {
		showModal = false;
		showRecovery = false;
		oncancel?.();
	}
</script>

{#if showModal}
	<!-- Modal Backdrop -->
	<div
		class="fixed inset-0 z-[1010] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
		transition:fade={{ duration: 200 }}
		role="dialog"
		aria-modal="true"
		aria-labelledby="verification-gate-title"
	>
		<!-- Modal Container -->
		<div
			class="relative w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-md"
			transition:scale={{ duration: 300, start: 0.95, easing: quintOut }}
		>
			<!-- Close Button -->
			<button
				onclick={handleCancel}
				class="absolute top-4 right-4 z-10 rounded-full p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
				aria-label="Close verification modal"
			>
				<X class="h-5 w-5" />
			</button>

			<!-- Header (tier-aware) -->
			{#if mdlGated}
				<div
					class="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-slate-100 px-8 py-6"
				>
					<p class="font-mono text-[10px] text-slate-500 uppercase" style="letter-spacing: 0.22em">
						Government-ID verification
					</p>
					<h2
						id="verification-gate-title"
						class="mt-2 text-2xl font-semibold text-slate-900"
						style="font-family: 'Satoshi', system-ui, sans-serif"
					>
						Coming soon.
					</h2>
				</div>
			{:else if showRecovery}
				<div
					class="border-b border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-8 py-6"
				>
					<h2 id="verification-gate-title" class="text-2xl font-bold text-slate-900">
						Restore Proof Credentials
					</h2>
					<p class="mt-2 text-slate-600">
						Your credentials were cleared from this device. A quick re-verification will restore
						them.
					</p>
				</div>
			{:else if needsTier4Plus}
				<div
					class="border-b border-emerald-200 bg-gradient-to-r from-emerald-50 to-emerald-100 px-8 py-6"
				>
					<h2 id="verification-gate-title" class="text-2xl font-bold text-slate-900">
						Verify with Passport or Government Credential
					</h2>
					<p class="mt-2 text-slate-600">
						This action requires document-level verification. Use your passport, digital driver's
						license, or government credential for the fastest, most private verification available.
					</p>
				</div>
			{:else if needsTier2}
				<div
					class="border-b border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 px-8 py-6"
				>
					<h2 id="verification-gate-title" class="text-2xl font-bold text-slate-900">
						Verify Your Address to Send
					</h2>
					<p class="mt-2 text-slate-600">
						Confirm your district to message your representatives. Takes 30 seconds and lets you
						send instantly in the future.
					</p>
				</div>
			{:else}
				<div class="border-b border-slate-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-8 py-6">
					<h2 id="verification-gate-title" class="text-2xl font-bold text-slate-900">
						Verify Your Identity to Send
					</h2>
					<p class="mt-2 text-slate-600">
						Congressional offices prioritize verified constituents. This one-time verification takes
						30 seconds and lets you send instantly in the future.
					</p>
				</div>
			{/if}

			<!-- Verification Flow Content (tier-aware) -->
			<div class="max-h-[calc(100vh-12rem)] overflow-y-auto p-8">
				{#if mdlGated}
					<!--
						F-1.3 launch gate. Document register: mono eyebrow + Satoshi
						body + dotted rules. Honest about what's gated and why, with
						the address path surfaced as the still-available alternative
						when applicable.
					-->
					<section class="mx-auto max-w-xl py-2" data-testid="mdl-gated-panel">
						<div class="border-t border-b border-dotted border-slate-300 py-5">
							<p class="text-[14px] leading-relaxed text-slate-700">
								Government-ID verification (mobile driver's license, passport, or eID) uses
								browser-mediated Digital Credentials protocols. Commons opens this panel only when
								the deployed verifier has at least one protocol lane enabled.
							</p>
							<p class="mt-3 text-[14px] leading-relaxed text-slate-700">
								Address-attested verification (Tier&nbsp;2) remains available while additional
								wallet and browser protocols are brought online.
							</p>
						</div>

						<div
							class="mt-6 flex items-center justify-end border-t border-dotted border-slate-300 pt-4"
						>
							<button
								type="button"
								class="font-mono text-sm text-slate-700 underline decoration-slate-400 decoration-1 underline-offset-4 transition-colors hover:text-slate-900 hover:decoration-slate-700"
								onclick={handleCancel}
							>
								Close &rarr;
							</button>
						</div>
					</section>
				{:else if showRecovery}
					<IdentityRecoveryFlow
						{userId}
						userEmail={decryptedUser.email ?? undefined}
						oncomplete={handleRecoveryComplete}
						oncancel={handleCancel}
					/>
				{:else if needsTier2}
					<AddressVerificationFlow
						{userId}
						onComplete={handleAddressVerificationComplete}
						onCancel={handleCancel}
					/>
				{:else}
					<IdentityVerificationFlow
						{userId}
						userEmail={decryptedUser.email ?? undefined}
						{templateSlug}
						skipValueProp={true}
						oncomplete={handleVerificationComplete}
						oncancel={handleCancel}
					/>
				{/if}
			</div>
		</div>
	</div>
{/if}
