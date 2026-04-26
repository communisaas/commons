<script lang="ts">
	/**
	 * Cross-Device Verification — Mobile Page
	 *
	 * Phone scans QR, lands here. No cookie auth — bridge session + secret
	 * (in URL fragment) IS the authorization.
	 *
	 * Anti-phishing: Before the wallet prompt, the user must visually confirm
	 * the pairing code matches what's displayed on their desktop. This is the
	 * key defense against identity-binding phishing attacks.
	 *
	 * Security properties:
	 * - Secret is in URL fragment (never hits server, no log/Referer leakage)
	 * - HMAC proves possession of secret without transmitting it
	 * - Request configs + nonce only revealed AFTER claim (HMAC-authenticated)
	 * - User explicitly confirms pairing code before wallet activation
	 */
	import { Loader2, Check, AlertCircle, RefreshCw, ShieldCheck } from '@lucide/svelte';
	import {
		isDigitalCredentialsSupported,
		requestCredential
	} from '$lib/core/identity/digital-credentials-api';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type VerifyState =
		| 'init' | 'start' | 'claiming' | 'confirm' | 'requesting'
		| 'submitting' | 'complete' | 'error' | 'unsupported' | 'used';

	let verifyState = $state<VerifyState>('init');
	let errorMessage = $state<string | null>(null);
	let resultDistrict = $state<string | null>(null);
	let secret = $state<string | null>(null);
	let credentialRequests = $state<Array<{ protocol: string; data: unknown }> | null>(null);
	let pairingCode = $state<string | null>(null);
	let desktopUserLabel = $state<string | null>(null);

	/** Compute HMAC-SHA256 client-side (Web Crypto) */
	async function computeHmac(secretHex: string, ...parts: string[]): Promise<string> {
		const encoder = new TextEncoder();
		const keyBytes = new Uint8Array(secretHex.length / 2);
		for (let i = 0; i < secretHex.length; i += 2) {
			keyBytes[i / 2] = parseInt(secretHex.substring(i, i + 2), 16);
		}
		const key = await crypto.subtle.importKey(
			'raw', keyBytes as BufferSource,
			{ name: 'HMAC', hash: { name: 'SHA-256' } } as HmacImportParams,
			false, ['sign']
		);
		const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(parts.join('|')));
		return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
	}

	onMount(() => {
		if (!isDigitalCredentialsSupported()) {
			verifyState = 'unsupported';
			return;
		}

		// Read secret from URL fragment (never sent to server)
		const hash = window.location.hash.slice(1);
		if (!hash || hash.length < 32) {
			verifyState = 'error';
			errorMessage = 'Invalid verification link — missing authorization.';
			return;
		}

		secret = hash;
		// Clear fragment from URL bar — defense in depth
		history.replaceState(null, '', window.location.pathname);

		// Require explicit user gesture before claiming — prevents automated
		// URL fetchers (link previews, QR scanner webviews) from consuming
		// the session before the user is ready.
		verifyState = 'start';
	});

	async function claimSession() {
		if (!secret) return;

		try {
			verifyState = 'claiming';
			const claimResponse = await fetch(`/api/identity/bridge/claim`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sessionId: data.sessionId,
					hmac: await computeHmac(secret, data.sessionId, 'claim')
				})
			});

			if (!claimResponse.ok) {
				if (claimResponse.status === 409) {
					verifyState = 'used';
					return;
				}
				const err = await claimResponse.json().catch(() => ({ message: 'Session expired' }));
				throw new Error(err.message || 'Failed to claim session');
			}

			const claimData = await claimResponse.json();
			credentialRequests = claimData.requests;
			pairingCode = claimData.pairingCode;
			desktopUserLabel = claimData.desktopUserLabel;

			// Show confirmation UI — user verifies account + pairing code
			// BEFORE we activate the wallet. Wallet isn't invoked until user clicks.
			verifyState = 'confirm';
		} catch (err) {
			verifyState = 'error';
			errorMessage = err instanceof Error ? err.message : 'Verification failed';
		}
	}

	async function userConfirmed() {
		if (!credentialRequests || !secret) return;

		try {
			verifyState = 'requesting';
			const result = await requestCredential({ requests: credentialRequests! });

			if (!result.success) {
				if (result.error === 'user_cancelled') {
					// Session is claimed; user can retry within the same session
					verifyState = 'confirm';
					return;
				}
				throw new Error(result.message);
			}

			// Submit credential via HMAC (secret NOT in body)
			verifyState = 'submitting';
			const credentialData = typeof result.data === 'string' ? result.data : '';
			const hmac = await computeHmac(
				secret, data.sessionId, result.protocol, credentialData
			);

			const response = await fetch('/api/identity/bridge/complete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sessionId: data.sessionId,
					protocol: result.protocol,
					data: result.data,
					hmac
				})
			});

			if (!response.ok) {
				const err = await response.json().catch(() => ({ message: 'Verification failed' }));
				throw new Error(err.message || 'Verification failed');
			}

			const verification = await response.json();
			resultDistrict = verification.district ?? null;
			verifyState = 'complete';
		} catch (err) {
			verifyState = 'error';
			errorMessage = err instanceof Error ? err.message : 'Verification failed';
		}
	}

	async function retryCredentialRequest() {
		// Session already claimed — go directly to wallet request
		if (!secret || !credentialRequests) {
			verifyState = 'error';
			errorMessage = 'Session state lost. Scan a new QR code.';
			return;
		}

		errorMessage = null;
		try {
			verifyState = 'requesting';
			const result = await requestCredential({ requests: credentialRequests });
			if (!result.success) {
				if (result.error === 'user_cancelled') {
					verifyState = 'confirm';
					return;
				}
				throw new Error(result.message);
			}
			verifyState = 'submitting';
			const credentialData = typeof result.data === 'string' ? result.data : '';
			const hmac = await computeHmac(secret, data.sessionId, result.protocol, credentialData);
			const response = await fetch('/api/identity/bridge/complete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sessionId: data.sessionId,
					protocol: result.protocol,
					data: result.data,
					hmac
				})
			});
			if (!response.ok) {
				const err = await response.json().catch(() => ({ message: 'Verification failed' }));
				throw new Error(err.message || 'Verification failed');
			}
			const verification = await response.json();
			resultDistrict = verification.district ?? null;
			verifyState = 'complete';
		} catch (err) {
			verifyState = 'error';
			errorMessage = err instanceof Error ? err.message : 'Verification failed';
		}
	}
</script>

<svelte:head>
	<title>Verify Identity — Commons</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-6 py-12"
	style="background: oklch(0.995 0.003 55)"
>
	<div class="w-full max-w-sm">
		{#if verifyState === 'init'}
			<div class="text-center">
				<Loader2 class="h-8 w-8 animate-spin text-emerald-600 mx-auto mb-4" />
				<h1 class="text-xl font-bold text-slate-900 font-brand">Connecting</h1>
			</div>

		{:else if verifyState === 'start'}
			<!-- Explicit user gesture required before claim — prevents link preview DoS -->
			<div class="text-center">
				<h1 class="text-xl font-bold text-slate-900 font-brand">
					Ready to verify?
				</h1>
				<p class="mt-3 text-sm text-slate-600 leading-relaxed">
					You'll confirm your account and then share your postal code, city, state, birth
					date, and document number with your wallet.
				</p>
				<button
					type="button"
					onclick={claimSession}
					class="mt-8 w-full rounded-lg bg-slate-800 px-6 py-4 text-base font-semibold text-white
						transition-colors hover:bg-slate-900 min-h-[52px]"
				>
					Continue
				</button>
			</div>

		{:else if verifyState === 'claiming'}
			<div class="text-center">
				<Loader2 class="h-8 w-8 animate-spin text-emerald-600 mx-auto mb-4" />
				<h1 class="text-xl font-bold text-slate-900 font-brand">Connecting</h1>
			</div>

		{:else if verifyState === 'confirm'}
			<!-- Anti-phishing: account context + pairing code. Both must match. -->
			<div>
				<h1 class="text-xl font-bold text-slate-900 font-brand text-center">
					Verify this is your account
				</h1>

				<!-- Primary anti-phishing signal: recognizable account label -->
				<div class="mt-6 rounded-lg border border-slate-200 bg-white px-5 py-4">
					<p class="text-xs text-slate-500 mb-1">You're verifying for</p>
					<p class="text-base font-semibold text-slate-900 break-all">
						{desktopUserLabel}
					</p>
				</div>

				<!-- Secondary: pairing code matches desktop -->
				<div class="mt-3 rounded-lg border border-slate-200 bg-white px-5 py-4">
					<p class="text-xs text-slate-500 mb-1">Matching code on desktop</p>
					<p class="font-mono text-lg font-bold text-slate-900 tracking-wider">
						{pairingCode}
					</p>
				</div>

				<button
					type="button"
					onclick={userConfirmed}
					class="mt-6 w-full rounded-lg bg-emerald-600 px-6 py-4 text-base font-semibold text-white
						transition-colors hover:bg-emerald-700 min-h-[52px]"
				>
					This is me — verify
				</button>

				<p class="mt-4 text-xs text-slate-500 leading-relaxed text-center">
					If this isn't your account or the code doesn't match, close this page.
				</p>
			</div>

		{:else if verifyState === 'requesting'}
			<div class="text-center">
				<Loader2 class="h-8 w-8 animate-spin text-emerald-600 mx-auto mb-4" />
				<h1 class="text-xl font-bold text-slate-900 font-brand">Waiting for wallet</h1>
				<p class="mt-2 text-sm text-slate-500">
					Approve sharing your postal code, city, state, birth date, and document number
				</p>
			</div>

		{:else if verifyState === 'submitting'}
			<div class="text-center">
				<Loader2 class="h-8 w-8 animate-spin text-emerald-600 mx-auto mb-4" />
				<h1 class="text-xl font-bold text-slate-900 font-brand">Verifying</h1>
				<p class="mt-2 text-sm text-slate-500">
					Checking credential with state issuer
				</p>
			</div>

		{:else if verifyState === 'complete'}
			<div class="text-center">
				<div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
					<Check class="h-6 w-6 text-emerald-600" />
				</div>
				<h1 class="text-xl font-bold text-slate-900 font-brand">Verified</h1>
				{#if resultDistrict}
					<p class="mt-2 text-sm text-slate-600">{resultDistrict}</p>
				{/if}
				<p class="mt-4 text-sm text-slate-500">
					Return to your desktop browser.
				</p>
			</div>

		{:else if verifyState === 'error'}
			<div class="text-center">
				<AlertCircle class="h-8 w-8 text-red-500 mx-auto mb-4" />
				<h1 class="text-xl font-bold text-slate-900 font-brand">Verification failed</h1>
				<p class="mt-2 text-sm text-slate-600">{errorMessage}</p>
				{#if credentialRequests}
					<button
						onclick={retryCredentialRequest}
						class="mt-6 flex items-center justify-center gap-2 mx-auto rounded-lg bg-slate-800 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-900 transition-colors min-h-[44px]"
					>
						<RefreshCw class="h-4 w-4" />
						Try again
					</button>
				{/if}
			</div>

		{:else if verifyState === 'used'}
			<div class="text-center">
				<ShieldCheck class="h-8 w-8 text-slate-400 mx-auto mb-4" />
				<h1 class="text-xl font-bold text-slate-900 font-brand">Link already used</h1>
				<p class="mt-2 text-sm text-slate-600">
					Scan a new QR code from your desktop.
				</p>
			</div>

		{:else if verifyState === 'unsupported'}
			<div class="text-center">
				<AlertCircle class="h-8 w-8 text-amber-500 mx-auto mb-4" />
				<h1 class="text-xl font-bold text-slate-900 font-brand">Unsupported browser</h1>
				<p class="mt-2 text-sm text-slate-600">
					Open this link in Chrome 141+ or Safari 26+.
				</p>
			</div>
		{/if}
	</div>
</div>
