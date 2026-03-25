<!--
 * Security Settings Page
 *
 * Manage passkey registration for faster, phishing-resistant sign-in.
 * Passkey is additive — users must have OAuth (email-verified) account first.
 -->

<script lang="ts">
	import { Fingerprint, ShieldCheck, Trash2, Loader2, CheckCircle2, AlertCircle } from '@lucide/svelte';
	import { startRegistration } from '@simplewebauthn/browser';
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let isSupported = $state(false);
	let registering = $state(false);
	let removing = $state(false);
	let confirmRemove = $state(false);
	let errorMessage: string | null = $state(null);
	let successMessage: string | null = $state(null);

	$effect(() => {
		if (browser && window.PublicKeyCredential) {
			isSupported = true;
		}
	});

	function formatDate(iso: string | null): string {
		if (!iso) return 'Unknown';
		return new Date(iso).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	async function handleRegister() {
		if (registering) return;
		registering = true;
		errorMessage = null;
		successMessage = null;

		try {
			// Step 1: Get registration options
			const optionsRes = await fetch('/api/auth/passkey/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});

			if (!optionsRes.ok) {
				const err = await optionsRes.json();
				throw new Error(err.message || 'Failed to get registration options');
			}

			const { options, sessionId } = await optionsRes.json();

			// Step 2: Browser WebAuthn ceremony
			const attResp = await startRegistration({ optionsJSON: options });

			// Step 3: Verify with server
			const verifyRes = await fetch('/api/auth/passkey/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ response: attResp, sessionId })
			});

			if (!verifyRes.ok) {
				const err = await verifyRes.json();
				throw new Error(err.message || 'Failed to verify passkey');
			}

			successMessage = 'Passkey registered successfully.';
			await invalidateAll();
		} catch (err) {
			if (err instanceof Error) {
				if (err.message.includes('abort') || err.name === 'AbortError') {
					errorMessage = 'Registration cancelled.';
				} else if (err.message.includes('timeout')) {
					errorMessage = 'Registration timed out. Please try again.';
				} else {
					errorMessage = err.message;
				}
			} else {
				errorMessage = 'An unexpected error occurred.';
			}
		} finally {
			registering = false;
		}
	}

	async function handleRemove() {
		if (removing) return;
		removing = true;
		errorMessage = null;
		successMessage = null;

		try {
			const res = await fetch('/api/auth/passkey', { method: 'DELETE' });

			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.message || 'Failed to remove passkey');
			}

			successMessage = 'Passkey removed.';
			confirmRemove = false;
			await invalidateAll();
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to remove passkey.';
		} finally {
			removing = false;
		}
	}
</script>

<svelte:head>
	<title>Security | Commons</title>
</svelte:head>

<div class="space-y-8">
	<!-- Header -->
	<div>
		<h1 class="text-xl font-bold text-slate-900 sm:text-2xl" style="font-family: 'Satoshi', system-ui, sans-serif">
			Security
		</h1>
		<p class="mt-1 text-sm text-slate-600">Manage your authentication methods.</p>
	</div>

	<!-- Status messages -->
	{#if successMessage}
		<div class="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
			<CheckCircle2 class="h-4 w-4 flex-shrink-0 text-emerald-600" />
			<p class="text-sm text-emerald-800">{successMessage}</p>
		</div>
	{/if}

	{#if errorMessage}
		<div class="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
			<AlertCircle class="h-4 w-4 flex-shrink-0 text-red-600" />
			<p class="text-sm text-red-800">{errorMessage}</p>
		</div>
	{/if}

	<!-- Passkey section -->
	<section class="rounded-xl border border-slate-200 bg-white">
		<div class="border-b border-slate-100 px-5 py-4 sm:px-6">
			<div class="flex items-center gap-3">
				<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
					<Fingerprint class="h-5 w-5 text-emerald-600" />
				</div>
				<div>
					<h2 class="text-sm font-semibold text-slate-900">Passkeys</h2>
					<p class="text-xs text-slate-500">Phishing-resistant sign-in with biometrics or security keys</p>
				</div>
			</div>
		</div>

		<div class="px-5 py-5 sm:px-6">
			{#if !isSupported}
				<p class="text-sm text-slate-500">
					Your browser does not support passkeys. Try Chrome, Safari, or Edge on a device with biometric authentication.
				</p>
			{:else if data.passkey}
				<!-- Existing passkey -->
				<div class="flex items-start justify-between gap-4">
					<div class="space-y-1.5">
						<div class="flex items-center gap-2">
							<ShieldCheck class="h-4 w-4 text-emerald-600" />
							<span class="text-sm font-medium text-slate-900">Passkey registered</span>
						</div>
						<div class="space-y-0.5 text-xs text-slate-500">
							<p>Created: {formatDate(data.passkey.createdAt)}</p>
							{#if data.passkey.lastUsedAt}
								<p>Last used: {formatDate(data.passkey.lastUsedAt)}</p>
							{/if}
						</div>
					</div>

					{#if confirmRemove}
						<div class="flex items-center gap-2">
							<span class="text-xs text-red-600">Remove?</span>
							<button
								onclick={handleRemove}
								disabled={removing}
								class="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
							>
								{#if removing}
									<Loader2 class="inline h-3 w-3 animate-spin" /> Removing...
								{:else}
									Confirm
								{/if}
							</button>
							<button
								onclick={() => (confirmRemove = false)}
								class="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
							>
								Cancel
							</button>
						</div>
					{:else}
						<button
							onclick={() => (confirmRemove = true)}
							class="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
						>
							<Trash2 class="h-3 w-3" />
							Remove
						</button>
					{/if}
				</div>
			{:else}
				<!-- No passkey — registration prompt -->
				<div class="space-y-4">
					<p class="text-sm text-slate-600">
						No passkeys registered. Add one for faster, more secure sign-in using biometrics or a security key.
					</p>
					<button
						onclick={handleRegister}
						disabled={registering}
						class="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
					>
						{#if registering}
							<Loader2 class="h-4 w-4 animate-spin" />
							Setting up passkey...
						{:else}
							<Fingerprint class="h-4 w-4" />
							Register Passkey
						{/if}
					</button>
				</div>
			{/if}
		</div>
	</section>

	<!-- OAuth section (informational) -->
	<section class="rounded-xl border border-slate-200 bg-white">
		<div class="border-b border-slate-100 px-5 py-4 sm:px-6">
			<div class="flex items-center gap-3">
				<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
					<ShieldCheck class="h-5 w-5 text-blue-600" />
				</div>
				<div>
					<h2 class="text-sm font-semibold text-slate-900">Connected Accounts</h2>
					<p class="text-xs text-slate-500">OAuth providers linked to your account</p>
				</div>
			</div>
		</div>
		<div class="px-5 py-5 sm:px-6">
			<p class="text-sm text-slate-500">
				Your account is linked via OAuth (Google or LinkedIn). This provides email verification, which is required for your civic identity.
			</p>
		</div>
	</section>
</div>
