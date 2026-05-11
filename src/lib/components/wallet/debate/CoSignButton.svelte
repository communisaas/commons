<script lang="ts">
	import { walletState } from '$lib/stores/walletState.svelte';

	let {
		debateId,
		argumentIndex,
		stance,
		oncosigned
	}: {
		debateId: string;
		argumentIndex: number;
		stance: string;
		oncosigned?: (txHash: string) => void;
	} = $props();

	let uiState: 'idle' | 'input' | 'signing' | 'submitting' | 'confirmed' | 'error' = $state('idle');
	let stakeAmount = $state('1.00');
	let errorMessage = $state('');
	let txHash = $state('');

	const stanceLabel = $derived(
		stance === '0' || stance === 'SUPPORT' ? 'Support' :
		stance === '1' || stance === 'OPPOSE' ? 'Oppose' :
		'Amend'
	);

	async function handleCoSign() {
		if (!walletState.provider || parseFloat(stakeAmount) <= 0) return;

		errorMessage = '';
		uiState = 'signing';

		try {
			const { clientCoSignArgument } = await import('$lib/core/wallet/debate-client');
			const { DISTRICT_GATE_ADDRESS } = await import('$lib/core/contracts');

			const parsedStake = BigInt(Math.floor(parseFloat(stakeAmount) * 1e6));

			uiState = 'submitting';

			// Real ZK proof generation requires the identity-commitment flow
			// (district credential → V2 prover witness → proof). That work is
			// post-launch substrate. Until it lands, this co-sign path is
			// inactive — surface a legible "not implemented" rather than a
			// cryptic "Proof is empty" from validateProofInputs. The
			// `clientCoSignArgument` call site to wire when the proof flow
			// lands receives:
			//   { debateId, argumentIndex, stakeAmount, proof, publicInputs,
			//     verifierDepth: 20, districtGateAddress: DISTRICT_GATE_ADDRESS,
			//     chainId: 534351 }
			void clientCoSignArgument;
			void oncosigned;
			void txHash;
			throw new Error(
				'Co-signing via on-chain debate is not yet available. ' +
					'Real ZK proof generation (identity commitment + V2 prover) is post-launch work; ' +
					'this UI is staged but inactive.'
			);
		} catch (err: unknown) {
			const error = err as { code?: number; message?: string };
			if (error.code === 4001) {
				errorMessage = 'Transaction cancelled.';
			} else {
				errorMessage = error.message || 'Co-sign failed.';
			}
			uiState = 'error';
		}
	}
</script>

<div class="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3" style="border-radius: 12px;">
	<div class="min-w-0 flex-1">
		<p class="text-sm font-medium text-slate-700">
			Argument #{argumentIndex + 1}
			<span class="ml-1 text-xs font-normal text-slate-400">({stanceLabel})</span>
		</p>

		{#if uiState === 'confirmed'}
			<p class="mt-0.5 truncate text-xs text-emerald-600" style="font-family: 'Berkeley Mono', monospace;">
				Co-signed: {txHash.slice(0, 14)}...
			</p>
		{:else if uiState === 'error'}
			<p class="mt-0.5 text-xs text-red-600">{errorMessage}</p>
		{/if}
	</div>

	{#if uiState === 'idle'}
		<button
			onclick={() => { uiState = 'input'; }}
			class="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
			style="border-radius: 8px;"
		>
			Co-sign
		</button>
	{:else if uiState === 'input'}
		<div class="flex shrink-0 items-center gap-2">
			<input
				type="number"
				step="0.01"
				min="0.01"
				bind:value={stakeAmount}
				class="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-900 focus:border-slate-500 focus:outline-none"
				placeholder="USDC"
			/>
			<button
				onclick={handleCoSign}
				disabled={parseFloat(stakeAmount) <= 0}
				class="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
				style="border-radius: 8px;"
			>
				Stake
			</button>
		</div>
	{:else if uiState === 'signing' || uiState === 'submitting'}
		<svg class="h-4 w-4 shrink-0 animate-spin text-slate-400" viewBox="0 0 24 24" fill="none">
			<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
			<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
		</svg>
	{:else if uiState === 'error'}
		<button
			onclick={() => { uiState = 'input'; errorMessage = ''; }}
			class="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
			style="border-radius: 8px;"
		>
			Retry
		</button>
	{/if}
</div>
