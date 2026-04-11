<script lang="ts">
	/**
	 * AuthButtons — Perceptually-Engineered OAuth Provider Selection
	 *
	 * Soft launch: Google + LinkedIn only.
	 * - Google ⭐⭐⭐⭐ (most familiar, phone verification)
	 * - LinkedIn ⭐⭐⭐⭐ (professional identity, real-name network)
	 *
	 * Removed from UI (routes kept dormant):
	 * - Facebook ⭐⭐⭐ (moderate sybil resistance, visual clutter)
	 * - Coinbase ⭐⭐⭐⭐⭐ (KYC-verified) — OAuth client creation disabled
	 * - Discord ⭐⭐ (trivial account creation)
	 * - Twitter/X ⭐⭐ (high bot prevalence)
	 */
	import { Loader2 } from '@lucide/svelte';

	let { onAuth } = $props<{ onAuth: (provider: string) => Promise<void> | void }>();
	let loadingProvider = $state<string | null>(null);

	async function handleAuthClick(provider: string) {
		if (loadingProvider) return;
		loadingProvider = provider;

		try {
			await onAuth(provider);
		} catch (error) {
			console.error('Auth error:', error);
			loadingProvider = null;
		}
	}

	// Featured provider: Most familiar option
	const featuredProvider = { provider: 'google', name: 'Google', color: '#4285F4' };

</script>

<div class="space-y-3">
	<!-- Featured: Google — most familiar, largest visual weight -->
	<button
		onclick={() => handleAuthClick(featuredProvider.provider)}
		disabled={loadingProvider !== null}
		class="relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-md border border-slate-200 bg-white px-4 py-3.5 text-base font-semibold text-slate-900 shadow-sm transition-all duration-300 hover:border-slate-300 hover:shadow-md disabled:cursor-wait disabled:opacity-100"
	>
		<!-- Fluid fill on loading -->
		{#if loadingProvider === featuredProvider.provider}
			<div
				class="absolute inset-0 z-0 origin-left animate-[fill_2s_ease-out_forwards]"
				style="background-color: {featuredProvider.color};"
			></div>
		{/if}

		<div
			class="relative z-10 flex items-center gap-3 transition-colors duration-300"
			class:text-white={loadingProvider === featuredProvider.provider}
		>
			{#if loadingProvider === featuredProvider.provider}
				<Loader2 class="h-5 w-5 animate-spin" />
				<span>Connecting...</span>
			{:else}
				<!-- Google: Multi-color logo -->
				<svg class="h-6 w-6" viewBox="0 0 24 24">
					<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
					<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
					<path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
					<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
				</svg>
				<span>Continue with Google</span>
			{/if}
		</div>
	</button>

	<!-- Divider with "or" -->
	<div class="flex items-center gap-3">
		<div class="h-px flex-1 bg-slate-200"></div>
		<span class="text-xs font-medium text-slate-400">or continue with</span>
		<div class="h-px flex-1 bg-slate-200"></div>
	</div>

	<!-- Secondary: LinkedIn — professional identity -->
	<button
		onclick={() => handleAuthClick('linkedin')}
		disabled={loadingProvider !== null}
		class="relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 transition-all duration-300 hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm disabled:cursor-wait disabled:opacity-100"
	>
		{#if loadingProvider === 'linkedin'}
			<div
				class="absolute inset-0 z-0 origin-left animate-[fill_2s_ease-out_forwards]"
				style="background-color: #0077B5;"
			></div>
		{/if}

		<div
			class="relative z-10 flex items-center gap-2 transition-colors duration-300"
			class:text-white={loadingProvider === 'linkedin'}
		>
			{#if loadingProvider === 'linkedin'}
				<Loader2 class="h-4 w-4 animate-spin" />
				<span>Connecting...</span>
			{:else}
				<svg class="h-5 w-5" viewBox="0 0 24 24" fill="#0077B5">
					<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.771v20.451C0 23.2.774 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
				</svg>
				<span>Continue with LinkedIn</span>
			{/if}
		</div>
	</button>
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
