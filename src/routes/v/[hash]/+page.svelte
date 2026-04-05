<script lang="ts">
	/**
	 * Sender Verification Page
	 *
	 * What decision-makers see when they click commons.email/v/...
	 * Atmosphere: certificate. Sparse. Institutional. No marketing.
	 */
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Sender Verification — Commons</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="min-h-screen flex items-center justify-center px-4 py-16"
	style="background: oklch(0.995 0.003 55)"
>
	<div class="w-full max-w-sm">
		<!-- Certificate -->
		<div class="text-center mb-10">
			<h1 class="font-brand text-lg font-bold text-slate-800 tracking-tight">
				Sender Verification
			</h1>
		</div>

		<div class="space-y-4">
			<div class="flex justify-between items-baseline">
				<span class="text-sm text-slate-500">Identity</span>
				<span class="text-sm font-medium {data.verified ? 'text-emerald-700' : 'text-slate-400'}">
					{data.verified ? 'Verified' : 'Not verified'}
				</span>
			</div>

			<div class="h-px bg-slate-200/60"></div>

			<div class="flex justify-between items-baseline">
				<span class="text-sm text-slate-500">Method</span>
				<span class="text-sm font-medium text-slate-700">
					{data.method}
				</span>
			</div>

			<div class="h-px bg-slate-200/60"></div>

			<div class="flex justify-between items-baseline">
				<span class="text-sm text-slate-500">Location</span>
				<span class="text-sm font-medium {data.locationVerified ? 'text-emerald-700' : 'text-slate-400'}">
					{data.locationVerified ? 'Verified' : 'Not verified'}
				</span>
			</div>

			{#if data.identityVerified}
				<div class="h-px bg-slate-200/60"></div>

				<div class="flex justify-between items-baseline">
					<span class="text-sm text-slate-500">Gov ID</span>
					<span class="text-sm font-medium text-emerald-700">
						{data.govCredential ? 'Government credential' : 'Confirmed'}
					</span>
				</div>
			{/if}

			<div class="h-px bg-slate-200/60"></div>

			<div class="flex justify-between items-baseline">
				<span class="text-sm text-slate-500">Message</span>
				<span class="text-sm font-medium text-slate-700">
					Individually composed
				</span>
			</div>
		</div>

		<!-- Attribution -->
		<div class="mt-12 pt-6 border-t border-slate-200/40 text-center">
			<p class="text-xs text-slate-400 leading-relaxed">
				Verified through Commons
			</p>
			<a
				href="/"
				class="mt-1 block text-xs text-slate-400 hover:text-slate-600 transition-colors"
			>
				commons.email
			</a>
		</div>
	</div>
</div>
