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
 * 2. Check trust_tier >= minimumTier OR session credential (hasValidSession)
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
	import AddressVerificationFlow from './AddressVerificationFlow.svelte';
	import { hasValidSession } from '$lib/core/identity/session-cache';

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
		onverified?: (data: { userId: string; method: string }) => void;
		oncancel?: () => void;
	}

	let {
		userId,
		templateSlug,
		showModal = $bindable(),
		cellId,
		minimumTier = 2,
		userTrustTier = 0,
		onverified,
		oncancel
	}: Props = $props();

	// Derived: which verification flow to show
	let needsTier2: boolean = $derived(minimumTier <= 2 && userTrustTier < 2);
	let needsTier4Plus: boolean = $derived(minimumTier >= 4 && userTrustTier < minimumTier);

	/**
	 * Check if user meets the minimum trust tier or has valid session credential.
	 * Called before showing modal - allows instant send if verified.
	 *
	 * Priority:
	 * 1. If userTrustTier >= minimumTier, user is already verified (no IndexedDB check needed)
	 * 2. Otherwise, fall back to IndexedDB session credential check (legacy Tier 3 path)
	 */
	export async function checkVerification(): Promise<boolean> {
		try {
			// Fast path: server-side trust tier already meets requirement
			if (userTrustTier >= minimumTier) {
				console.log('[Verification Gate] Trust tier check passed:', { userTrustTier, minimumTier });
				return true;
			}

			// Fallback: check IndexedDB session credential (legacy Tier 3 flow)
			const isVerified = await hasValidSession(userId);
			console.log('[Verification Gate] Session check:', { isVerified, userTrustTier, minimumTier });
			return isVerified;
		} catch (error) {
			console.error('[Verification Gate] Session check failed:', error);
			return false;
		}
	}

	function handleVerificationComplete(
		data: { verified: boolean; method: string; userId: string; district?: string }
	) {
		console.log('[Verification Gate] Verification complete:', data);
		showModal = false;
		onverified?.({
			userId: data.userId,
			method: data.method
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
			method: `address:${detail.method}`
		});
	}

	function handleCancel() {
		showModal = false;
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
			class="relative w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl"
			transition:scale={{ duration: 300, start: 0.95, easing: quintOut }}
		>
			<!-- Close Button -->
			<button
				onclick={handleCancel}
				class="absolute right-4 top-4 z-10 rounded-full p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
				aria-label="Close verification modal"
			>
				<X class="h-5 w-5" />
			</button>

			<!-- Header (tier-aware) -->
			{#if needsTier4Plus}
				<div class="border-b border-indigo-200 bg-gradient-to-r from-indigo-50 to-blue-50 px-8 py-6">
					<h2 id="verification-gate-title" class="text-2xl font-bold text-slate-900">
						Verify with Passport or Government Credential
					</h2>
					<p class="mt-2 text-slate-600">
						This action requires document-level verification. Use your passport, digital driver's
						license, or government credential for the fastest, most private verification available.
					</p>
				</div>
			{:else if needsTier2}
				<div class="border-b border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 px-8 py-6">
					<h2 id="verification-gate-title" class="text-2xl font-bold text-slate-900">
						Verify Your Address to Send
					</h2>
					<p class="mt-2 text-slate-600">
						Confirm your district to message your representatives. Takes 30 seconds
						and lets you send instantly in the future.
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
				{#if needsTier2}
					<AddressVerificationFlow
						{userId}
						onComplete={handleAddressVerificationComplete}
						onCancel={handleCancel}
					/>
				{:else}
					<IdentityVerificationFlow
						{userId}
						{templateSlug}
						{cellId}
						skipValueProp={true}
						oncomplete={handleVerificationComplete}
						oncancel={handleCancel}
					/>
				{/if}
			</div>
		</div>
	</div>
{/if}
