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
		shouldUseSameDeviceFlow,
		getSupportedProtocols,
		requestCredential,
		type CredentialRequestResult
	} from '$lib/core/identity/digital-credentials-api';
	import QRCode from 'qrcode';
	import { FEATURES, isMdlBridgeEnabled, isMdlDirectQrEnabled } from '$lib/config/features';

	interface Props {
		userId: string;
		/** Deprecated bridge hint. The bridge now derives its account label from the server session. */
		userEmail?: string;
		templateSlug?: string;
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

	let { userId, templateSlug, oncomplete, onerror, oncancel }: Props = $props();

	// Platform detection
	type Platform = 'android' | 'ios' | 'desktop';

	function detectPlatform(): Platform {
		if (typeof navigator === 'undefined') return 'desktop';
		const ua = navigator.userAgent;
		const uadPlatform =
			(
				navigator as Navigator & { userAgentData?: { platform?: string } }
			).userAgentData?.platform?.toLowerCase() ?? '';
		if (uadPlatform === 'android' || ua.includes('Android')) return 'android';
		if (/iPhone|iPad/.test(ua)) return 'ios';
		// iPadOS 13+ reports macOS UA — detect via touch capability
		if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 0) return 'ios';
		return 'desktop';
	}

	function shouldOfferSameDeviceMdl(): boolean {
		return (
			detectPlatform() === 'android' &&
			FEATURES.MDL_ANDROID_OID4VP &&
			shouldUseSameDeviceFlow() &&
			getSupportedProtocols().openid4vp
		);
	}

	type VerificationState =
		| 'idle'
		| 'requesting'
		| 'verifying'
		| 'complete'
		| 'error'
		| 'unsupported'
		| 'unsupported_state';

	// Desktop browsers must always use the cross-device bridge: Chrome on macOS
	// detects DC API support but has no local wallet, falling through to CTAP2
	// hybrid transport which crashes the renderer. shouldUseSameDeviceFlow()
	// returns true only on mobile devices with DC API support.
	let verificationState = $state<VerificationState>(
		shouldOfferSameDeviceMdl() ? 'idle' : 'unsupported'
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

	const platform = $derived(detectPlatform());

	const walletName = $derived(
		platform === 'android'
			? 'Google Wallet'
			: platform === 'ios'
				? 'Apple Wallet'
				: 'your digital wallet'
	);

	// Cross-device bridge fallback (unsupported browsers)
	let bridgeQrSvg = $state<string | null>(null);
	let bridgePairingCode = $state<string | null>(null);
	let bridgeSessionId = $state<string | null>(null);
	let bridgeStatus = $state<'idle' | 'waiting' | 'claimed' | 'error'>('idle');
	let bridgeError = $state<string | null>(null);
	let sseCleanup: (() => void) | null = null;
	let directQrSvg = $state<string | null>(null);
	let directQrPayload = $state<string | null>(null);
	let directSessionId = $state<string | null>(null);
	let directAccountLabel = $state<string | null>(null);
	let directExpiresAt = $state<number | null>(null);
	let directStatus = $state<'idle' | 'waiting' | 'scanned' | 'error'>('idle');
	let directError = $state<string | null>(null);
	let directSseCleanup: (() => void) | null = null;
	let desktopFlow = $state<'direct' | 'bridge'>('bridge');
	const directExpiresIn = $derived(
		directExpiresAt ? Math.max(0, Math.ceil((directExpiresAt - Date.now()) / 60_000)) : null
	);

	async function cancelDirectSession(sessionId: string | null = directSessionId): Promise<boolean> {
		if (!sessionId) return true;
		try {
			const response = await fetch('/api/identity/direct-mdl/cancel', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionId })
			});
			if (!response.ok) throw new Error('Cancel failed');
			if (directSessionId === sessionId) directSessionId = null;
			return true;
		} catch {
			directStatus = 'error';
			directError = 'Could not cancel the current scan. Wait for it to expire before starting again.';
			return false;
		}
	}

	async function startDirectQr() {
		desktopFlow = 'direct';
		const previousSessionId = directSessionId;
		directSseCleanup?.();
		directSseCleanup = null;
		sseCleanup?.();
		sseCleanup = null;
		directQrSvg = null;
		directQrPayload = null;
		directExpiresAt = null;
		if (!(await cancelDirectSession(previousSessionId))) return;
		directStatus = 'waiting';
		directError = null;

		try {
			const response = await fetch('/api/identity/direct-mdl/start', {
				method: 'POST'
			});

			if (!response.ok) {
				throw new Error('Failed to create direct verification session');
			}

			const { sessionId, qrUrl, accountLabel, expiresAt } = await response.json();
			directSessionId = sessionId;
			directQrPayload = qrUrl;
			directAccountLabel = accountLabel;
			directExpiresAt = typeof expiresAt === 'number' ? expiresAt : null;

			if (!String(qrUrl).startsWith('openid4vp://authorize?')) {
				throw new Error('Direct verification QR was not wallet-recognized');
			}

			try {
				directQrSvg = await QRCode.toString(qrUrl, {
					type: 'svg',
					width: 240,
					margin: 2,
					color: { dark: '#1e293b', light: '#ffffff' }
				});
			} catch (err) {
				throw new Error(err instanceof Error ? err.message : 'Failed to render direct QR');
			}

			const eventSource = new EventSource(`/api/identity/direct-mdl/stream/${sessionId}`);

			eventSource.addEventListener('request_fetched', () => {
				directStatus = 'scanned';
			});

			eventSource.addEventListener('completed', (event) => {
				const data = JSON.parse(event.data) as {
					district?: string;
					state?: string;
					cellId?: string;
					credentialHash?: unknown;
					identityCommitmentBound?: unknown;
					requireReauth?: boolean;
				};
				const credentialHash =
					typeof data.credentialHash === 'string' ? data.credentialHash : '';
				if (!/^[0-9a-f]{64}$/i.test(credentialHash) || data.identityCommitmentBound !== true) {
					eventSource.close();
					directSseCleanup = null;
					directStatus = 'error';
					directError = 'Verification completed without identity binding. Try again.';
					return;
				}

				eventSource.close();
				directSseCleanup = null;
				oncomplete?.({
					verified: true,
					method: 'mdl',
					district: data.district,
					state: data.state,
					cell_id: data.cellId,
					providerData: {
						provider: 'digital-credentials-api',
						credentialHash,
						issuedAt: Date.now()
					},
					requireReauth: data.requireReauth ?? false
				});
			});

			eventSource.addEventListener('failed', (event) => {
				const data = JSON.parse(event.data);
				eventSource.close();
				directSseCleanup = null;
				directStatus = 'error';
				directError = directFailureMessage(data.error);
			});

			eventSource.addEventListener('expired', () => {
				eventSource.close();
				directSseCleanup = null;
				directStatus = 'error';
				directError = 'Session expired. Try again.';
			});

			eventSource.onerror = () => {
				if (eventSource.readyState === EventSource.CLOSED) {
					directStatus = 'error';
					directError = 'Connection lost. Try again.';
				}
			};

			directSseCleanup = () => eventSource.close();
		} catch (err) {
			directStatus = 'error';
			directError = err instanceof Error ? err.message : 'Failed to start direct verification';
		}
	}

	function directFailureMessage(error: unknown): string {
		const message = typeof error === 'string' ? error : '';
		if (message.includes('Identity fields')) {
			return 'Google Wallet did not share all required fields. Try again and approve the requested fields.';
		}
		if (message.includes('already used')) {
			return 'That wallet presentation was already used. Start a new scan.';
		}
		if (message.includes('Wallet did not complete')) {
			return 'Google Wallet did not complete the presentation. Start a new scan.';
		}
		return 'Verification failed on your phone. Start a new scan or use guided phone scan.';
	}

	async function startBridge() {
		const previousSessionId = directSessionId;
		// Close any previous SSE connection before opening a new one
		directSseCleanup?.();
		directSseCleanup = null;
		if (!(await cancelDirectSession(previousSessionId))) {
			desktopFlow = 'direct';
			return;
		}
		desktopFlow = 'bridge';
		sseCleanup?.();
		sseCleanup = null;
		bridgeStatus = 'waiting';
		bridgeError = null;

		try {
			const response = await fetch('/api/identity/bridge/start', {
				method: 'POST'
			});

			if (!response.ok) {
				throw new Error('Failed to create bridge session');
			}

			const { sessionId, qrUrl, pairingCode } = await response.json();
			bridgeSessionId = sessionId;
			bridgePairingCode = pairingCode;

			// Generate QR
			try {
				bridgeQrSvg = await QRCode.toString(qrUrl, {
					type: 'svg',
					width: 200,
					margin: 2,
					color: { dark: '#1e293b', light: '#ffffff' }
				});
			} catch {
				bridgeQrSvg = null;
			}

			// Open SSE stream to listen for mobile completion
			const eventSource = new EventSource(`/api/identity/bridge/stream/${sessionId}`);

			eventSource.addEventListener('claimed', () => {
				bridgeStatus = 'claimed';
			});

			eventSource.addEventListener('completed', (event) => {
				const data = JSON.parse(event.data) as {
					district?: string;
					state?: string;
					cellId?: string;
					credentialHash?: unknown;
					identityCommitmentBound?: unknown;
				};
				const credentialHash =
					typeof data.credentialHash === 'string' ? data.credentialHash : '';
				if (!/^[0-9a-f]{64}$/i.test(credentialHash) || data.identityCommitmentBound !== true) {
					eventSource.close();
					sseCleanup = null;
					bridgeStatus = 'error';
					bridgeError = 'Verification completed without identity binding. Try again.';
					return;
				}

				eventSource.close();
				sseCleanup = null;
				oncomplete?.({
					verified: true,
					method: 'mdl',
					district: data.district,
					state: data.state,
					cell_id: data.cellId,
					providerData: {
						provider: 'digital-credentials-api',
						credentialHash,
						issuedAt: Date.now()
					}
				});
			});

			eventSource.addEventListener('failed', (event) => {
				const data = JSON.parse(event.data);
				eventSource.close();
				sseCleanup = null;
				bridgeStatus = 'error';
				bridgeError = data.error || 'Verification failed on phone';
			});

			eventSource.addEventListener('expired', () => {
				eventSource.close();
				sseCleanup = null;
				bridgeStatus = 'error';
				bridgeError = 'Session expired. Try again.';
			});

			eventSource.onerror = () => {
				// SSE reconnects automatically; only flag if closed
				if (eventSource.readyState === EventSource.CLOSED) {
					bridgeStatus = 'error';
					bridgeError = 'Connection lost. Try again.';
				}
			};

			sseCleanup = () => eventSource.close();
		} catch (err) {
			bridgeStatus = 'error';
			bridgeError = err instanceof Error ? err.message : 'Failed to start bridge';
		}
	}

	import { onDestroy } from 'svelte';
	onDestroy(() => {
		sseCleanup?.();
		directSseCleanup?.();
		if (desktopFlow === 'direct') void cancelDirectSession();
	});

	async function cancelAndGoBack() {
		if (desktopFlow === 'direct') {
			await cancelDirectSession();
		}
		oncancel?.();
	}

	$effect(() => {
		if (verificationState !== 'unsupported' || platform !== 'desktop') return;
		if (isMdlDirectQrEnabled()) {
			startDirectQr();
		} else if (isMdlBridgeEnabled()) {
			startBridge();
		}
	});
</script>

<div class="px-8 py-10">
	{#if verificationState === 'idle'}
		<!-- Idle: quiet confidence. The user already decided. Give them the action. -->
		<div class="mx-auto max-w-sm">
			<h3 class="font-brand text-xl font-bold text-slate-900">Verify with Digital ID</h3>

				<p class="mt-3 text-sm leading-relaxed text-slate-600">
					Your browser will open {walletName}. Approve sharing your postal code, city, state,
					birth date, and document number.
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
			<p class="text-base font-semibold text-slate-900">
				Waiting for {walletName}
			</p>
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
		<!-- State not supported -->
		<div class="mx-auto max-w-sm space-y-4">
			<div class="flex items-start gap-3">
				<Info class="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
				<div>
					<p class="text-sm font-medium text-slate-900">Your state isn't supported yet</p>
					<p class="mt-1 text-sm text-slate-600">We're adding more states. Check back soon.</p>
				</div>
			</div>

			{#if supportedStates.length > 0}
				<div class="border-t border-slate-100 pt-3">
					<p class="mb-2 font-mono text-xs font-semibold tracking-wider text-slate-400 uppercase">
						Supported ({supportedStates.length})
					</p>
					<p class="text-sm text-slate-600">
						{supportedStates.sort().join(', ')}
					</p>
				</div>
			{/if}

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
		<!-- Browser unsupported — cross-device bridge -->
		<div class="mx-auto max-w-sm">
			{#if platform === 'ios'}
				<div class="text-center">
					<Info class="mx-auto mb-4 h-8 w-8 text-amber-500" />
					<h3 class="font-brand text-xl font-bold text-slate-900">Android first</h3>
					<p class="mt-2 text-sm text-slate-600">
						Digital ID verification is open on Android with Google Wallet. iPhone support follows
						after Apple Business Connect and final mdoc device-authentication work.
					</p>
				</div>
			{:else if platform === 'android'}
				<div class="text-center">
					<Info class="mx-auto mb-4 h-8 w-8 text-amber-500" />
					<h3 class="font-brand text-xl font-bold text-slate-900">Chrome required</h3>
					<p class="mt-2 text-sm text-slate-600">
						Open this page in an Android browser that supports Digital Credentials and OpenID4VP.
					</p>
				</div>
			{:else if isMdlDirectQrEnabled() && desktopFlow === 'direct' && directStatus === 'error'}
				<div class="text-center">
					<AlertCircle class="mx-auto mb-4 h-8 w-8 text-red-500" />
					<h3 class="font-brand text-xl font-bold text-slate-900">Direct scan failed</h3>
					<p class="mt-2 text-sm text-slate-600">{directError}</p>
					<button
						onclick={startDirectQr}
						class="mt-6 min-h-[44px] rounded-lg bg-slate-800 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-900"
					>
						Try again
					</button>
					{#if isMdlBridgeEnabled()}
						<button
							type="button"
							onclick={startBridge}
							class="mt-3 min-h-[44px] w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium
								text-slate-700 transition-colors hover:bg-slate-50"
						>
							Cancel and use guided phone scan
						</button>
					{/if}
				</div>
			{:else if isMdlDirectQrEnabled() && desktopFlow === 'direct' && directStatus === 'scanned'}
				<div class="text-center">
					<Loader2 class="mx-auto mb-4 h-8 w-8 animate-spin text-emerald-600" />
					<h3 class="font-brand text-xl font-bold text-slate-900">Wallet request opened</h3>
					<p class="mt-2 text-sm text-slate-500">Waiting for wallet verification on your phone</p>
					<button
						type="button"
						onclick={startDirectQr}
						class="mt-6 min-h-[44px] w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium
							text-slate-700 transition-colors hover:bg-slate-50"
					>
						New direct code
					</button>
					{#if isMdlBridgeEnabled()}
						<button
							type="button"
							onclick={startBridge}
							class="mt-3 min-h-[44px] w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium
								text-slate-700 transition-colors hover:bg-slate-50"
						>
							Cancel and use guided phone scan
						</button>
					{/if}
				</div>
			{:else if isMdlDirectQrEnabled() && desktopFlow === 'direct'}
				<h3 class="font-brand text-xl font-bold text-slate-900">Scan with Android Camera</h3>
				<p class="mt-2 text-sm text-slate-600">
					Google Wallet will ask for postal code, city, state, birth date, and document number.
				</p>

				{#if directQrSvg}
					<div class="flex justify-center py-6">
						<div class="rounded-lg border border-slate-100 p-3">
							{@html directQrSvg}
						</div>
					</div>
				{:else if directStatus === 'waiting'}
					<div class="flex justify-center py-6">
						<Loader2 class="h-6 w-6 animate-spin text-slate-400" />
					</div>
				{/if}

				<div class="mt-2 rounded-lg border border-slate-200 px-4 py-3">
					<p class="mb-1 text-xs text-slate-500">Signed in as</p>
					<p class="break-all text-sm font-semibold text-slate-900">
						{directAccountLabel ?? 'Signed-in Commons account'}
					</p>
					{#if directQrPayload}
						<p class="mt-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
							Wallet request
						</p>
					{/if}
					{#if directExpiresIn}
						<p class="mt-2 text-xs text-slate-400">Expires in {directExpiresIn} min</p>
					{/if}
					<p class="mt-2 text-xs leading-relaxed text-slate-400">
						Raw identity fields are used only to bind your district privately and are not stored.
					</p>
				</div>

				{#if isMdlBridgeEnabled()}
					<button
						type="button"
						onclick={startBridge}
						class="mt-4 min-h-[44px] w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium
							text-slate-700 transition-colors hover:bg-slate-50"
					>
						Cancel and use guided phone scan
					</button>
				{/if}
			{:else if bridgeStatus === 'error'}
				<div class="text-center">
					<AlertCircle class="mx-auto mb-4 h-8 w-8 text-red-500" />
					<h3 class="font-brand text-xl font-bold text-slate-900">Bridge failed</h3>
					<p class="mt-2 text-sm text-slate-600">{bridgeError}</p>
					<button
						onclick={startBridge}
						class="mt-6 min-h-[44px] rounded-lg bg-slate-800 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-900"
					>
						Try again
					</button>
				</div>
			{:else if bridgeStatus === 'claimed'}
				<!-- Phone connected, waiting for wallet -->
				<div class="text-center">
					<Loader2 class="mx-auto mb-4 h-8 w-8 animate-spin text-emerald-600" />
					<h3 class="font-brand text-xl font-bold text-slate-900">Phone connected</h3>
					<p class="mt-2 text-sm text-slate-500">Waiting for wallet verification on your phone</p>
				</div>
			{:else}
				<!-- Waiting for phone to scan QR -->
				<h3 class="font-brand text-xl font-bold text-slate-900">Scan with an Android phone</h3>
				<p class="mt-2 text-sm text-slate-600">
					Use an Android phone with Google Wallet to scan the code.
				</p>

				{#if bridgeQrSvg}
					<div class="flex justify-center py-6">
						<div class="rounded-lg border border-slate-100 p-3">
							{@html bridgeQrSvg}
						</div>
					</div>
				{:else if bridgeStatus === 'waiting'}
					<div class="flex justify-center py-6">
						<Loader2 class="h-6 w-6 animate-spin text-slate-400" />
					</div>
				{/if}

				<!-- Pairing code: user verifies this matches phone before approving -->
				{#if bridgePairingCode}
					<div class="mt-2 rounded-lg border border-slate-200 px-4 py-3">
						<p class="mb-1 text-xs text-slate-500">Matching code</p>
						<p class="font-mono text-base font-bold tracking-wider text-slate-900">
							{bridgePairingCode}
						</p>
						<p class="mt-2 text-xs leading-relaxed text-slate-400">
							Your phone will show this code and your account name. Verify both match before
							approving.
						</p>
					</div>
				{/if}
			{/if}

			{#if oncancel}
				<button
					type="button"
					onclick={cancelAndGoBack}
					class="mt-4 min-h-[44px] w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium
						text-slate-700 transition-colors hover:bg-slate-50"
				>
					Go back
				</button>
			{/if}
		</div>
	{/if}
</div>
