<!--
 * Government Credential Verification (mDL / Digital ID)
 *
 * W3C Digital Credentials API — browser-native wallet verification.
 * Flow: idle → requesting → verifying → complete / error
 *
 * Design: quiet confidence at the moment of commitment.
 * The user already decided to verify. Give them the action.
 * Privacy details in footnote, not billboard.
 -->

<script lang="ts">
	import { Loader2, Check, AlertCircle, RefreshCw, Info } from '@lucide/svelte';
	import {
		shouldUseDigitalCredentialsFlow,
		getSupportedProtocols,
		requestCredential,
		type CredentialRequestResult
	} from '$lib/core/identity/digital-credentials-api';
	import { clampTier } from '$lib/core/identity/clamp-tier';

	interface Props {
		userId: string;
		/** Deprecated account hint retained for parent compatibility. */
		userEmail?: string;
		templateSlug?: string;
		/**
		 * Minimum trust tier the gating action requires. The dead-end copy
		 * (state-unsupported / browser-unsupported) needs to know whether
		 * address-tier verification is enough for their goal. The address
		 * flow tops out at tier 2, so tier ≤ 2 ⇒ address fallback covers
		 * the action; tier ≥ 3 ⇒ genuinely needs a digital ID. Clamped to
		 * [0,5]; non-integer / NaN / out-of-range values default to 5
		 * (the strictest reading).
		 */
		minimumTier?: number;
		/**
		 * The user's actual server-side trust tier at component mount.
		 * Threaded so the dead-end copy says "address-tier verification
		 * still works for you" ONLY when the user actually has tier ≥ 2.
		 * Without this, a tier-0 user seeing the dead-end would be told
		 * the address-tier path covers them — false reassurance, since
		 * the substrate still has to gate the action at submission.
		 * Defaults to 0 (anonymous), the strictest reading.
		 */
		userTrustTier?: number;
		oncomplete?: (data: {
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
			requireReauth?: boolean;
		}) => void;
		onerror?: (data: { message: string }) => void;
		oncancel?: () => void;
	}

	let {
		userId,
		templateSlug,
		minimumTier: rawMinimumTier = 5,
		userTrustTier: rawUserTrustTier = 0,
		oncomplete,
		onerror,
		oncancel
	}: Props = $props();

	const minimumTier = $derived(clampTier(rawMinimumTier, 5));
	const userTrustTier = $derived(clampTier(rawUserTrustTier, 0));

	/**
	 * True when the user has the address-verification tier AND the gating
	 * action requires tier ≤ 2. Both conditions must hold: a tier-0 user
	 * can't be told "address-tier still works for you" because they don't
	 * have address-tier; and a tier-2 user can't be told that about a
	 * tier-4+ action because address-tier doesn't satisfy the requirement.
	 */
	const addressTierIsEnough = $derived(minimumTier <= 2 && userTrustTier >= 2);

	function shouldOfferDigitalCredentialsMdl(): boolean {
		return shouldUseDigitalCredentialsFlow();
	}

	type VerificationState =
		| 'idle'
		| 'requesting'
		| 'verifying'
		| 'complete'
		| 'error'
		| 'unsupported'
		| 'unsupported_state';

	let verificationState = $state<VerificationState>(
		shouldOfferDigitalCredentialsMdl() ? 'idle' : 'unsupported'
	);
	let errorMessage = $state<string | null>(null);
	let supportedStates = $state<string[]>([]);
	let verificationResult = $state<{
		district?: string;
		state?: string;
		credentialHash?: string;
		cellId?: string;
	} | null>(null);

	async function startVerification() {
		verificationState = 'requesting';
		errorMessage = null;

		try {
			const startResponse = await fetch('/api/identity/verify-mdl/start', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId, templateSlug })
			});

			if (!startResponse.ok) {
				const err = await startResponse.json();
				throw new Error(err.message || 'Failed to start verification');
			}

			const { requests, nonce } = await startResponse.json();

			const result: CredentialRequestResult = await requestCredential({ requests });

			if (!result.success) {
				if (result.error === 'user_cancelled') {
					verificationState = 'idle';
					return;
				}
				throw new Error(result.message);
			}

			verificationState = 'verifying';

			const verifyResponse = await fetch('/api/identity/verify-mdl/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					protocol: result.protocol,
					data: result.data,
					nonce
				})
			});

			if (!verifyResponse.ok) {
				const err = await verifyResponse.json();
				if (err.error === 'unsupported_state' && err.supportedStates) {
					supportedStates = err.supportedStates;
					verificationState = 'unsupported_state';
					return;
				}
				throw new Error(err.message || 'Verification failed');
			}

			const verification = await verifyResponse.json();
			if (verification.requireReauth === true) {
				verificationState = 'error';
				errorMessage = 'Sign in again to finish verification.';
				onerror?.({ message: errorMessage });
				return;
			}

			verificationResult = {
				district: verification.district,
				state: verification.state,
				credentialHash: verification.credentialHash,
				cellId: verification.cellId ?? undefined
			};

			verificationState = 'complete';

			oncomplete?.({
				verified: true,
				method: 'mdl',
				district: verification.district,
				state: verification.state,
				cell_id: verification.cellId ?? undefined,
				providerData: {
					provider: 'digital-credentials-api',
					credentialHash: verification.credentialHash,
					issuedAt: Date.now()
				}
			});
		} catch (err) {
			verificationState = 'error';
			errorMessage = err instanceof Error ? err.message : 'Verification failed';
			onerror?.({ message: errorMessage });
		}
	}

	function retry() {
		errorMessage = null;
		startVerification();
	}

	const enabledProtocols = $derived(getSupportedProtocols());
</script>

<div class="px-8 py-10">
	{#if verificationState === 'idle'}
		<!-- Idle: quiet confidence. The user already decided. Give them the action. -->
		<div class="mx-auto max-w-sm">
			<h3 class="font-brand text-xl font-bold text-slate-900">Verify with Digital ID</h3>

			<p class="mt-3 text-sm leading-relaxed text-slate-600">
				Your browser will ask your digital wallet for postal code, city, state, birth date, and
				document number.
			</p>

			<button
				type="button"
				onclick={startVerification}
				class="mt-8 min-h-[52px] w-full rounded-lg bg-emerald-600 px-6 py-4 text-base font-semibold
					text-white transition-colors
					hover:bg-emerald-700"
			>
				Verify
			</button>

			<p class="mt-4 text-xs leading-relaxed text-slate-400">
				Raw identity fields are used only to bind your district privately and are not stored.
			</p>
		</div>
	{:else if verificationState === 'requesting'}
		<!-- Wallet prompt active -->
		<div class="flex flex-col items-center py-6">
			<Loader2 class="mb-4 h-8 w-8 animate-spin text-emerald-600" />
			<p class="text-base font-semibold text-slate-900">Waiting for your digital wallet</p>
			<p class="mt-2 text-sm text-slate-500">
				Approve sharing your postal code, city, state, birth date, and document number
			</p>
		</div>
	{:else if verificationState === 'verifying'}
		<!-- Server verification -->
		<div class="flex flex-col items-center py-6">
			<Loader2 class="mb-4 h-8 w-8 animate-spin text-emerald-600" />
			<p class="text-base font-semibold text-slate-900">Verifying</p>
			<p class="mt-2 text-sm text-slate-500">Checking credential with state issuer</p>
		</div>
	{:else if verificationState === 'complete'}
		<!-- Success -->
		<div class="flex flex-col items-center py-6">
			<div class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
				<Check class="h-6 w-6 text-emerald-600" />
			</div>
			<p class="text-base font-semibold text-slate-900">Verified</p>
			{#if verificationResult?.district}
				<p class="mt-2 text-sm text-slate-600">
					{verificationResult.district}{verificationResult.state
						? `, ${verificationResult.state}`
						: ''}
				</p>
			{/if}
		</div>
	{:else if verificationState === 'error'}
		<!-- Error -->
		<div class="mx-auto max-w-sm">
			<div class="mb-6 flex items-start gap-3">
				<AlertCircle class="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
				<div>
					<p class="text-sm font-medium text-slate-900">Verification failed</p>
					<p class="mt-1 text-sm text-slate-600">{errorMessage}</p>
				</div>
			</div>

			<button
				type="button"
				onclick={retry}
				class="min-h-[44px] w-full rounded-lg bg-slate-800 px-6 py-3 text-sm font-semibold
					text-white transition-colors hover:bg-slate-900"
			>
				<span class="flex items-center justify-center gap-2">
					<RefreshCw class="h-4 w-4" />
					Try again
				</span>
			</button>
		</div>
	{:else if verificationState === 'unsupported_state'}
		<!-- State not supported. The "supported (N)" list was removed
		     because it implied the product was multi-state-live; in
		     fact CA is the single launch state. Misleading users into
		     thinking their state was almost-live caused a check-back-
		     soon dead end with no callback hook. -->
		<div class="mx-auto max-w-sm space-y-4">
			<div class="flex items-start gap-3">
				<Info class="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
				<div>
					<p class="text-sm font-medium text-slate-900">
						Your state issues a digital ID we don't yet read
					</p>
					<p class="mt-1 text-sm text-slate-600">
						California is the only state currently live for digital-ID
						verification.
						{#if addressTierIsEnough}
							Anything that only requires address-tier verification still
							works for you; this action does not need a digital ID.
						{:else}
							This action requires a digital ID; it won't be available
							to you until your state is live.
						{/if}
					</p>
				</div>
			</div>

			{#if oncancel}
				<button
					type="button"
					onclick={oncancel}
					class="min-h-[44px] w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium
						text-slate-700 transition-colors hover:bg-slate-50"
				>
					Go back
				</button>
			{/if}
		</div>
	{:else if verificationState === 'unsupported'}
		<!-- Browser path (typically iPhone Safari pre-Apple-Business-
		     Connect) can't read a wallet credential. Copy was previously
		     dense ("Digital Credentials," "an enabled protocol") which
		     left users stuck in jargon. Replaced with plain-voice
		     fallback to address verification — the substrate still
		     produces a verified-tier send, just without the gov-issued
		     credential. -->
		<div class="mx-auto max-w-sm">
			<div class="text-center">
				<Info class="mx-auto mb-4 h-8 w-8 text-amber-500" />
				<h3 class="font-brand text-xl font-bold text-slate-900">
					This browser can't read a digital ID
				</h3>
				<p class="mt-2 text-sm text-slate-600">
					Most iPhones don't support digital-ID readers in the
					browser yet.
					{#if addressTierIsEnough}
						Anything that only requires address-tier verification still
						works for you; this action does not need a digital ID.
					{:else}
						This action requires a digital ID; it won't be available
						from this browser until iOS support lands.
					{/if}
				</p>
				{#if enabledProtocols.mdoc && !enabledProtocols.openid4vp}
					<p class="mt-2 text-xs leading-relaxed text-slate-400">
						This browser supports the mobile-document protocol;
						the OID4VP lane it would need is not yet enabled.
					</p>
				{/if}
			</div>

			{#if oncancel}
				<button
					type="button"
					onclick={oncancel}
					class="mt-4 min-h-[44px] w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium
						text-slate-700 transition-colors hover:bg-slate-50"
				>
					Go back
				</button>
			{/if}
		</div>
	{/if}
</div>
