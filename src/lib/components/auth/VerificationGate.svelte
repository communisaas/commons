<!--
 * Verification Gate Component
 *
 * Progressive verification interceptor that gates Congressional message submission.
 * Supports graduated trust tiers (0-5):
 *   - Tier 0 (guest):            Not handled here (requires authentication first)
 *   - Tier 1 (authenticated):    Passthrough (minimum for non-congressional actions)
 *   - Tier 2 (address-attested): AddressVerificationFlow (district credential)
 *   - Tier 3 (identity-verified): IdentityVerificationFlow
 *   - Tier 4 (legacy passport tier): Recovery path only; no active intake provider
 *   - Tier 5 (government-cred):  IdentityVerificationFlow (mDL)
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
	import CredibilityLadder from './CredibilityLadder.svelte';
	import {
		credentialMeetsMinimumTier,
		getUsableProofCredential,
		needsCredentialRecovery
	} from '$lib/core/identity/recovery-detector';
	import { clampTier } from '$lib/core/identity/clamp-tier';
	import { decryptedUser } from '$lib/stores/decryptedUser.svelte';
	import { isAnyMdlProtocolEnabled } from '$lib/config/features';
	import { getJurisdictionLabels } from '$lib/core/locale/jurisdiction';

	const labels = getJurisdictionLabels();

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

	// Defense-in-depth tier clamp at the gate boundary.
	// `userTrustTier` is consumed raw in multiple branches (lines 85, 90,
	// 96, 112, 114, 418); a non-integer/string/Infinity value would coerce
	// via `>=` and route around verification logic. Uses the shared
	// `clampTier` helper so the contract is in exactly one place across
	// this component and `GovernmentCredentialVerification.svelte`.
	// Declared before the routing derivations so source order matches the
	// reactive-graph order (TypeScript checks block-scope before runtime).
	const safeUserTrustTier = $derived(clampTier(userTrustTier, 0));
	const safeMinimumTier = $derived(clampTier(minimumTier, 5));

	// Derived: which verification flow to show. Routing reads from the
	// clamped tier values so that a junk/non-integer/out-of-range prop
	// (corrupt session, Convex contract drift, modal-payload cast) falls
	// to the conservative reading instead of coercing through `>=`.
	//
	// `forceAddressFlow` overrides tier checks — used by AddressChangeFlow to
	// re-enter the flow for an already-verified user (re-grounding / move).
	let needsTier2: boolean = $derived(
		forceAddressFlow || (safeMinimumTier <= 2 && safeUserTrustTier < 2)
	);
	let needsTier4Plus: boolean = $derived(
		!forceAddressFlow && safeMinimumTier >= 4 && safeUserTrustTier < safeMinimumTier
	);

	// Defense against callers that flip `showModal=true` without first
	// invoking `checkVerification()` (e.g., `profile/+page.svelte:243`
	// opens the gate unconditionally on "Verify Address" click). When the
	// modal opens for a user who already meets the address-tier requirement
	// and no re-grounding is forced, the catch-all `else` branch would
	// otherwise mount the mDL upgrade flow with `minimumTier=2` — bouncing
	// a verified user into an upgrade ceremony they didn't ask for. Tier-4+
	// actions remain on the existing path because they need separate proof-
	// credential material checks beyond the tier number.
	//
	// The check uses a SNAPSHOT of `userTrustTier` taken at the moment the
	// modal opens. Otherwise a successful mid-flow address verification
	// (which causes `userTrustTier` to reactively update from 0→2 just
	// before `handleAddressVerificationComplete` fires) would race with
	// the success callback and call `oncancel` for a user who actually
	// completed.
	//
	// The `alreadyMetsAddressTier` derived blocks the `else` branch from
	// mounting `IdentityVerificationFlow` synchronously in template space,
	// so no onMount-equivalent (telemetry, eager
	// /api/identity/verify-mdl/start prefetch, wallet-protocol probes)
	// runs even for one render tick.
	//
	// Rising-edge tracking via `wasOpen` is required: a single
	// `if (!showModal) reset` leaves the snapshot stale across same-tick
	// false→true coalescing — Svelte batches state mutations and the
	// effect runs once with the final `showModal=true`, so the reset
	// branch is never taken.
	//
	// `dismissedAtSnapshot` prevents oncancel re-entrancy. If a parent's
	// `oncancel` handler synchronously re-opens, the stale snapshot would
	// dismiss again — unbounded loop. The flag requires `tierSnapshotAtOpen`
	// to refresh before another dismiss can fire.
	//
	// The auto-dismiss path also resets `showRecovery = false` so stale
	// recovery flags don't leak into a future open (`handleCancel` resets
	// it on the cancel path).
	let tierSnapshotAtOpen = $state<number | null>(null);
	let wasOpen = $state(false);
	let dismissedAtSnapshot = $state<number | null>(null);
	$effect(() => {
		if (!showModal) {
			tierSnapshotAtOpen = null;
			dismissedAtSnapshot = null;
			wasOpen = false;
			return;
		}
		// Rising edge: snapshot exactly once per open cycle.
		if (!wasOpen) {
			tierSnapshotAtOpen = safeUserTrustTier;
			dismissedAtSnapshot = null;
			wasOpen = true;
		}
		const snapshot = tierSnapshotAtOpen;
		if (snapshot === null) return;
		if (dismissedAtSnapshot === snapshot) return; // F4: already dismissed this snapshot
		if (
			!forceAddressFlow &&
			safeMinimumTier <= 2 &&
			snapshot >= 2
		) {
			console.log(
				'[Verification Gate] User already meets address-tier requirement; auto-dismissing',
				{ minimumTier: safeMinimumTier, tierSnapshotAtOpen: snapshot }
			);
			dismissedAtSnapshot = snapshot;
			showRecovery = false; // F5: don't leak recovery state into the dismiss
			showModal = false;
			oncancel?.();
		}
	});

	// The template guard MUST be synchronously evaluable at first render
	// or `IdentityVerificationFlow` still mounts for one tick before the
	// snapshot-driven derived flips. Use the live clamped tier here, not
	// the snapshot — the snapshot's purpose is race-resistance for the
	// AUTO-DISMISS decision (don't cancel a user who just succeeded), not
	// for routing-decision freshness. Template routing should reflect the
	// user's actual current tier at render time.
	const alreadyMetsAddressTier = $derived(
		!forceAddressFlow &&
			safeMinimumTier <= 2 &&
			safeUserTrustTier >= 2
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
			{#if showRecovery}
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
			{:else}
				<!--
					The ladder replaces the binary "Verify X to Send" walls: it shows
					where the user stands on the climb and what the needed rung buys
					(interaction-driven), instead of a one-shot toll. mDL gates fold in
					here as a "soon" rung rather than a dead "Coming soon." headline.
					No climb/send-now buttons — the flow content below IS the climb, and
					the gate only opens when a higher tier is genuinely required.
				-->
				<div class="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-slate-100 px-8 py-6">
					<h2
						id="verification-gate-title"
						class="text-lg font-semibold text-slate-900"
						style="font-family: 'Satoshi', system-ui, sans-serif"
					>
						{#if mdlGated}Government&#8209;ID is coming soon{:else if needsTier4Plus}Verify with a government credential{:else if needsTier2}Confirm your district to send{:else}Verify to send{/if}
					</h2>
					{#if !mdlGated}
						<!--
							Not in the mdlGated case: there, the action requires gov-ID
							(unavailable), so confirming district would NOT unblock it —
							a climbable ladder would falsely imply a next step. The
							content panel below carries the honest "gov-ID is coming,
							address remains available" framing instead.
						-->
						<div class="mt-3">
							<CredibilityLadder
								currentTier={safeUserTrustTier}
								govIdAvailable={isAnyMdlProtocolEnabled()}
								electedTarget={true}
							/>
						</div>
					{/if}
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
									Government-ID verification uses browser-mediated Digital Credentials protocols for
									mobile driver's licenses. Commons opens this panel only when the deployed verifier
									has at least one protocol lane enabled.
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
				{:else if alreadyMetsAddressTier}
					<!-- Synchronous guard before the `$effect` auto-dismiss
					     fires. Without this, IdentityVerificationFlow would
					     mount for one render tick — long enough to fire onMount
					     telemetry / eager /api/identity/verify-mdl/start prefetch
					     / wallet-protocol probes — before the effect tears it
					     down. The placeholder here is intentionally minimal
					     because the modal is about to dismiss; rendering nothing
					     would briefly show empty modal chrome. -->
					<div class="mx-auto max-w-sm py-12 text-center text-slate-500">
						<p class="text-sm">You're already verified for this action.</p>
					</div>
				{:else}
					<IdentityVerificationFlow
						{userId}
						userEmail={decryptedUser.email ?? undefined}
						{templateSlug}
						{minimumTier}
						{userTrustTier}
						skipValueProp={true}
						oncomplete={handleVerificationComplete}
						oncancel={handleCancel}
					/>
				{/if}
			</div>
		</div>
	</div>
{/if}
