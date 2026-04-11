<script lang="ts">
	import { browser } from '$app/environment';
	import { FEATURES } from '$lib/config/features';
	import { walletState } from '$lib/stores/walletState.svelte';
	import SubmitArgumentForm from './SubmitArgumentForm.svelte';
	import CoSignButton from './CoSignButton.svelte';

	let {
		debateId,
		debateStatus,
		arguments: debateArguments,
		debateIdOnchain
	}: {
		debateId: string;
		debateStatus: string;
		arguments: Array<{ argumentIndex: number; stance: string }>;
		debateIdOnchain?: string;
	} = $props();

	function handleArgumentSubmitted(txHash: string) {
		console.log('[debate-panel] Argument submitted:', txHash);
	}

	function handleCoSigned(txHash: string) {
		console.log('[debate-panel] Argument co-signed:', txHash);
	}
</script>

{#if browser && FEATURES.WALLET && FEATURES.DEBATE}
	<div class="mt-4 space-y-4">
		{#if !walletState.connected}
			<!-- Connect wallet prompt -->
			<div class="rounded-md border border-slate-200 bg-white p-5 text-center" style="border-radius: 12px;">
				<p class="text-sm text-slate-500">Connect your wallet to participate in this debate.</p>
				<button
					onclick={() => walletState.connectEVM()}
					disabled={walletState.connecting}
					class="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
					style="border-radius: 8px;"
				>
					{#if walletState.connecting}
						<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
						</svg>
						Connecting...
					{:else}
						Connect Wallet
					{/if}
				</button>
				{#if walletState.error}
					<p class="mt-2 text-xs text-red-600">{walletState.error}</p>
				{/if}
			</div>
		{:else if debateStatus !== 'active'}
			<!-- Read-only status -->
			<div class="rounded-md border border-slate-200 bg-slate-50 p-5 text-center" style="border-radius: 12px;">
				<p class="text-sm text-slate-500">
					Debate is <span class="font-medium text-slate-700">{debateStatus}</span>
				</p>
			</div>
		{:else}
			<!-- Active debate: submit + co-sign -->
			<SubmitArgumentForm
				debateId={debateIdOnchain ?? debateId}
				onsubmitted={handleArgumentSubmitted}
			/>

			{#if debateArguments.length > 0}
				<div class="space-y-2">
					<h4 class="text-sm font-medium text-slate-500">Existing Arguments</h4>
					{#each debateArguments as arg}
						<CoSignButton
							debateId={debateIdOnchain ?? debateId}
							argumentIndex={arg.argumentIndex}
							stance={arg.stance}
							oncosigned={handleCoSigned}
						/>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
{/if}
