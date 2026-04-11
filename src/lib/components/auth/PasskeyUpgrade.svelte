<!--
 * PasskeyUpgrade.svelte
 *
 * Nudge banner for authenticated users without a passkey to add one.
 * Passkey is a security upgrade within Tier 1, not a separate tier.
 * Dismissible with localStorage persistence (7 days).
 *
 * Design: Subtle, non-intrusive banner that encourages security upgrade.
 -->

<script lang="ts">
	import { Fingerprint, X } from '@lucide/svelte';
	import { browser } from '$app/environment';
	import PasskeyRegistration from './PasskeyRegistration.svelte';

	let {
		user,
		onregistered
	}: {
		user: { hasPasskey?: boolean; [key: string]: unknown };
		onregistered?: () => void;
	} = $props();

	const DISMISSAL_KEY = 'passkey-upgrade-dismissed';
	const DISMISSAL_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

	let isDismissed = $state(false);
	let showRegistration = $state(false);

	// Check dismissal state on mount
	$effect(() => {
		if (browser) {
			const dismissed = localStorage.getItem(DISMISSAL_KEY);
			if (dismissed) {
				const dismissedAt = parseInt(dismissed, 10);
				const now = Date.now();
				if (now - dismissedAt < DISMISSAL_DURATION) {
					isDismissed = true;
				} else {
					// Expired, clear it
					localStorage.removeItem(DISMISSAL_KEY);
				}
			}
		}
	});

	function handleDismiss() {
		if (browser) {
			localStorage.setItem(DISMISSAL_KEY, Date.now().toString());
		}
		isDismissed = true;
	}

	function handleUpgradeClick() {
		showRegistration = true;
	}

	function handleRegistered() {
		showRegistration = false;
		onregistered?.();
	}

	// Show for authenticated users who haven't added a passkey yet
	const shouldShow = $derived(
		!user.hasPasskey && !isDismissed && browser && window.PublicKeyCredential
	);
</script>

{#if shouldShow}
	{#if showRegistration}
		<!-- Registration component (replaces banner) -->
		<div class="mb-6">
			<PasskeyRegistration onregistered={handleRegistered} />
		</div>
	{:else}
		<!-- Upgrade nudge banner -->
		<div class="mb-6 overflow-hidden rounded-md border border-blue-200 bg-blue-50 shadow-sm">
			<div class="flex items-center gap-4 p-4">
				<!-- Icon -->
				<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-sky-100">
					<Fingerprint class="h-5 w-5 text-blue-700" />
				</div>

				<!-- Content -->
				<div class="flex-1">
					<h3 class="mb-0.5 text-sm font-semibold text-blue-900">
						Upgrade Your Security
					</h3>
					<p class="text-sm text-blue-700">
						Add a passkey for faster, more secure sign-in
					</p>
				</div>

				<!-- Actions -->
				<div class="flex items-center gap-2">
					<button
						onclick={handleUpgradeClick}
						class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-700 hover:shadow-md active:scale-[0.98]"
					>
						Add Passkey
					</button>

					<button
						onclick={handleDismiss}
						class="flex h-8 w-8 items-center justify-center rounded-lg text-blue-600 transition-colors hover:bg-blue-100"
						aria-label="Dismiss"
					>
						<X class="h-4 w-4" />
					</button>
				</div>
			</div>
		</div>
	{/if}
{/if}
