<script lang="ts">
	import { Users, Fingerprint, Loader2, AlertCircle } from '@lucide/svelte';
	import { startAuthentication } from '@simplewebauthn/browser';
	import { modalActions } from '$lib/stores/modalSystem.svelte';
	import { browser } from '$app/environment';
	import AuthButtons from './AuthButtons.svelte';

	let { onauth, onclose } = $props();

	let passkeySupported = $state(false);
	let showPasskeyForm = $state(false);
	let passkeyEmail = $state('');
	let passkeyLoading = $state(false);
	let passkeyError: string | null = $state(null);

	$effect(() => {
		if (browser && window.PublicKeyCredential) {
			passkeySupported = true;
		}
	});

	async function handleAuth(provider: string) {
		try {
			// Prepare secure return cookie then redirect to OAuth
			await fetch('/auth/prepare', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ returnTo: window.location.pathname })
			});

			onauth?.(provider);
		} catch (error) {
			console.error('[SignIn] Auth preparation failed:', error instanceof Error ? error.message : String(error));
			onauth?.(provider);
		}
	}

	async function handlePasskeyLogin() {
		if (passkeyLoading || !passkeyEmail.trim()) return;
		passkeyLoading = true;
		passkeyError = null;

		try {
			// Step 1: Get authentication options
			const optionsRes = await fetch('/api/auth/passkey/authenticate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'options', email: passkeyEmail.trim() })
			});

			if (!optionsRes.ok) {
				const err = await optionsRes.json();
				throw new Error(err.message || 'Failed to start passkey authentication');
			}

			const { options, sessionId } = await optionsRes.json();

			// Step 2: Browser WebAuthn ceremony
			const assertionResp = await startAuthentication({ optionsJSON: options });

			// Step 3: Verify with server
			const verifyRes = await fetch('/api/auth/passkey/authenticate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'verify', response: assertionResp, sessionId })
			});

			if (!verifyRes.ok) {
				const err = await verifyRes.json();
				throw new Error(err.message || 'Passkey authentication failed');
			}

			// Success — reload to pick up new session
			modalActions.closeAll();
			window.location.reload();
		} catch (err) {
			if (err instanceof Error) {
				if (err.message.includes('abort') || err.name === 'AbortError') {
					passkeyError = 'Authentication cancelled.';
				} else if (err.message.includes('No account found')) {
					passkeyError = 'No account found with that email.';
				} else if (err.message.includes('no registered passkey')) {
					passkeyError = 'No passkey registered for this account. Sign in with OAuth first.';
				} else {
					passkeyError = err.message;
				}
			} else {
				passkeyError = 'Authentication failed. Please try again.';
			}
		} finally {
			passkeyLoading = false;
		}
	}

</script>

<!-- Header -->
<div class="px-8 pb-6 pt-8 text-center">
	<div class="relative mb-6 inline-flex h-20 w-20 items-center justify-center">
		<!-- Pulse Effect -->
		<div
			class="absolute inset-0 animate-ping rounded-full bg-emerald-100 opacity-75 duration-[3000ms]"
		></div>
		<!-- Main Node -->
		<div
			class="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-50 to-teal-50 shadow-sm ring-1 ring-emerald-100"
		>
			<Users class="h-10 w-10 text-emerald-600 opacity-90" strokeWidth={1.5} />
		</div>
	</div>
	<h2 class="mb-2 text-2xl font-bold text-slate-900">Welcome to Commons</h2>
</div>

<!-- Auth Options -->
<div class="px-8 pb-6">
	<AuthButtons onAuth={handleAuth} />

	{#if passkeySupported}
		<!-- Passkey sign-in -->
		<div class="mt-4">
			<div class="flex items-center gap-3">
				<div class="h-px flex-1 bg-slate-200"></div>
				<span class="text-xs font-medium text-slate-400">or</span>
				<div class="h-px flex-1 bg-slate-200"></div>
			</div>

			{#if showPasskeyForm}
				<div class="mt-3 space-y-3">
					<input
						type="email"
						bind:value={passkeyEmail}
						placeholder="Email address"
						class="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition-colors focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
						onkeydown={(e) => { if (e.key === 'Enter') handlePasskeyLogin(); }}
					/>
					{#if passkeyError}
						<div class="flex items-start gap-2 text-xs text-red-600">
							<AlertCircle class="mt-0.5 h-3 w-3 flex-shrink-0" />
							<span>{passkeyError}</span>
						</div>
					{/if}
					<button
						onclick={handlePasskeyLogin}
						disabled={passkeyLoading || !passkeyEmail.trim()}
						class="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 transition-all hover:border-emerald-300 hover:bg-emerald-50 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
					>
						{#if passkeyLoading}
							<Loader2 class="h-4 w-4 animate-spin" />
							<span>Authenticating...</span>
						{:else}
							<Fingerprint class="h-4 w-4 text-emerald-600" />
							<span>Verify with passkey</span>
						{/if}
					</button>
				</div>
			{:else}
				<button
					onclick={() => (showPasskeyForm = true)}
					class="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-all hover:border-emerald-300 hover:bg-emerald-50 active:scale-[0.98]"
				>
					<Fingerprint class="h-4 w-4 text-emerald-600" />
					<span>Sign in with passkey</span>
				</button>
			{/if}
		</div>
	{/if}
</div>

<!-- Value Props -->
<div class="border-t border-slate-100 bg-slate-50 px-8 py-6">
	<h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
		Your account lets you
	</h3>
	<div class="space-y-2">
		<div class="flex items-start gap-3">
			<div
				class="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-100 text-blue-600"
			>
				<svg class="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="3"
						d="M5 13l4 4L19 7"
					/>
				</svg>
			</div>
			<p class="text-sm text-slate-600">Track message delivery and impact</p>
		</div>
		<div class="flex items-start gap-3">
			<div
				class="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-100 text-blue-600"
			>
				<svg class="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="3"
						d="M5 13l4 4L19 7"
					/>
				</svg>
			</div>
			<p class="text-sm text-slate-600">Save and share your own templates</p>
		</div>
		<div class="flex items-start gap-3">
			<div
				class="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-100 text-blue-600"
			>
				<svg class="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="3"
						d="M5 13l4 4L19 7"
					/>
				</svg>
			</div>
			<p class="text-sm text-slate-600">Join coordination efforts in your district</p>
		</div>
	</div>
</div>

<!-- Footer -->
<div class="border-t border-slate-100 bg-slate-50 px-8 py-4 text-center">
	<p class="text-xs text-slate-500">
		By verifying, you agree to our Terms of Service and Privacy Policy
	</p>
</div>

<style>
	@keyframes fill {
		from {
			width: 0%;
		}
		to {
			width: 100%;
		}
	}
</style>
