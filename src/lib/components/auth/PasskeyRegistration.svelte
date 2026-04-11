<!--
 * PasskeyRegistration.svelte
 *
 * Passkey registration component for logged-in OAuth users.
 * Handles the full WebAuthn registration flow and upgrades user to trust_tier: 1.
 *
 * States: idle → registering → success/error
 * Feature detection for browser support and biometric availability.
 -->

<script lang="ts">
	import { startRegistration } from '@simplewebauthn/browser';
	import { Fingerprint, ShieldCheck, Loader2, CheckCircle2, AlertCircle } from '@lucide/svelte';
	import { browser } from '$app/environment';

	let { onregistered }: { onregistered?: () => void } = $props();

	type State = 'idle' | 'registering' | 'success' | 'error';
	let uiState: State = $state('idle');
	let errorMessage: string | null = $state(null);
	let isSupported = $state(false);
	let hasBiometric = $state(false);

	// Feature detection (must run in effect for SSR compatibility)
	$effect(() => {
		if (browser && window.PublicKeyCredential) {
			isSupported = true;

			// Check for biometric support
			PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
				.then((available) => {
					hasBiometric = available;
				})
				.catch(() => {
					hasBiometric = false;
				});
		}
	});

	async function handleRegister() {
		if (uiState ==='registering') return;

		uiState = 'registering';
		errorMessage = null;

		try {
			// Step 1: Get registration options from server
			const optionsRes = await fetch('/api/auth/passkey/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});

			if (!optionsRes.ok) {
				const error = await optionsRes.json();
				throw new Error(error.message || 'Failed to get registration options');
			}

			const { options, sessionId } = await optionsRes.json();

			// Step 2: Trigger browser's WebAuthn ceremony
			const attResp = await startRegistration({ optionsJSON: options });

			// Step 3: Verify the registration with server
			const verifyRes = await fetch('/api/auth/passkey/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					response: attResp,
					sessionId
				})
			});

			if (!verifyRes.ok) {
				const error = await verifyRes.json();
				throw new Error(error.message || 'Failed to verify passkey');
			}

			const result = await verifyRes.json();

			if (result.success) {
				uiState = 'success';

				// Notify parent after brief celebration
				setTimeout(() => {
					onregistered?.();
				}, 1500);
			} else {
				throw new Error('Registration failed');
			}
		} catch (err) {
			console.error('Passkey registration error:', err);
			uiState = 'error';

			if (err instanceof Error) {
				// User-friendly error messages
				if (err.message.includes('abort')) {
					errorMessage = 'Registration cancelled. Try again when ready.';
				} else if (err.message.includes('timeout')) {
					errorMessage = 'Registration timed out. Please try again.';
				} else if (err.message.includes('credential')) {
					errorMessage = 'This passkey may already be registered.';
				} else {
					errorMessage = err.message;
				}
			} else {
				errorMessage = 'An unexpected error occurred. Please try again.';
			}
		}
	}

	function retry() {
		uiState = 'idle';
		errorMessage = null;
	}
</script>

{#if !isSupported}
	<!-- Browser doesn't support WebAuthn -->
	<div class="rounded-md border border-slate-200 bg-slate-50 p-6">
		<div class="flex items-start gap-4">
			<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100">
				<ShieldCheck class="h-5 w-5 text-slate-400" />
			</div>
			<div>
				<h3 class="mb-1 text-sm font-semibold text-slate-900">Passkeys Not Available</h3>
				<p class="text-sm text-slate-600">
					Your browser doesn't support passkeys. Try using Chrome, Safari, or Edge on a device with biometric authentication.
				</p>
			</div>
		</div>
	</div>
{:else if uiState ==='success'}
	<!-- Success state with celebration -->
	<div class="rounded-md border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
		<div class="flex items-start gap-4">
			<div class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 ring-4 ring-emerald-50">
				<CheckCircle2 class="h-6 w-6 text-emerald-600" />
			</div>
			<div>
				<h3 class="mb-1 text-base font-semibold text-emerald-900">Passkey Registered!</h3>
				<p class="text-sm text-emerald-700">
					Your account is now secured with biometric authentication. You can sign in faster next time.
				</p>
			</div>
		</div>
	</div>
{:else if uiState ==='error'}
	<!-- Error state with retry -->
	<div class="rounded-md border border-red-200 bg-red-50 p-6">
		<div class="flex items-start gap-4">
			<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-red-100">
				<AlertCircle class="h-5 w-5 text-red-600" />
			</div>
			<div class="flex-1">
				<h3 class="mb-1 text-sm font-semibold text-red-900">Registration Failed</h3>
				<p class="mb-3 text-sm text-red-700">
					{errorMessage || 'Something went wrong. Please try again.'}
				</p>
				<button
					onclick={retry}
					class="rounded-lg bg-red-100 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-200"
				>
					Try Again
				</button>
			</div>
		</div>
	</div>
{:else}
	<!-- Idle state: Registration prompt -->
	<div class="rounded-md border border-slate-200 bg-slate-50 p-6 shadow-sm transition-all hover:border-emerald-200 hover:shadow-md">
		<div class="mb-4 flex items-center gap-3">
			<div class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 ring-2 ring-emerald-100">
				{#if hasBiometric}
					<Fingerprint class="h-6 w-6 text-emerald-600" />
				{:else}
					<ShieldCheck class="h-6 w-6 text-emerald-600" />
				{/if}
			</div>
			<div>
				<h3 class="text-base font-semibold text-slate-900">Secure Your Account</h3>
				<p class="text-sm text-slate-600">Add a passkey for faster sign-in</p>
			</div>
		</div>

		<p class="mb-4 text-sm leading-relaxed text-slate-600">
			{#if hasBiometric}
				Use your device's biometric authentication (Face ID, Touch ID, Windows Hello) for secure, password-free sign-in.
			{:else}
				Add a security key or use your device's built-in authentication for secure, password-free sign-in.
			{/if}
		</p>

		<button
			onclick={handleRegister}
			disabled={uiState ==='registering'}
			class="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-700 hover:shadow-md disabled:cursor-wait disabled:opacity-90"
		>
			{#if uiState ==='registering'}
				<Loader2 class="h-4 w-4 animate-spin" />
				<span>Setting up your passkey...</span>
			{:else}
				<ShieldCheck class="h-4 w-4" />
				<span>Register Passkey</span>
			{/if}
		</button>
	</div>
{/if}
