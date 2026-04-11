<script lang="ts">
	import { walletState } from '$lib/stores/walletState.svelte';

	let {
		debateId,
		onsubmitted
	}: {
		debateId: string;
		onsubmitted?: (txHash: string) => void;
	} = $props();

	let uiState: 'drafting' | 'signing' | 'submitting' | 'confirmed' | 'error' = $state('drafting');
	let stance: 0 | 1 | 2 = $state(0);
	let bodyText = $state('');
	let amendmentText = $state('');
	let stakeAmount = $state('');
	let errorMessage = $state('');
	let txHash = $state('');

	const stanceLabels = ['Support', 'Oppose', 'Amend'] as const;

	const canSubmit = $derived(
		bodyText.trim().length >= 10 &&
		parseFloat(stakeAmount) > 0 &&
		(stance !== 2 || amendmentText.trim().length > 0)
	);

	async function handleSubmit() {
		if (!canSubmit || !walletState.provider) return;

		errorMessage = '';
		uiState = 'signing';

		try {
			const { clientSubmitArgument } = await import('$lib/core/wallet/debate-client');
			const { keccak256, toUtf8Bytes } = await import('ethers');
			const { DISTRICT_GATE_ADDRESS } = await import('$lib/core/contracts');

			const bodyHash = keccak256(toUtf8Bytes(bodyText));
			const amendmentHash = stance === 2
				? keccak256(toUtf8Bytes(amendmentText))
				: '0x' + '0'.repeat(64);
			const parsedStake = BigInt(Math.floor(parseFloat(stakeAmount) * 1e6));

			uiState = 'submitting';

			// TODO: For MVP, using placeholder proof. Real ZK proof generation
			// requires identity commitment flow (FEATURES.WALLET + identity verification).
			const result = await clientSubmitArgument(walletState.provider, {
				debateId,
				stance,
				bodyHash,
				amendmentHash,
				stakeAmount: parsedStake,
				proof: '0x',
				publicInputs: Array(31).fill('0'),
				verifierDepth: 20,
				districtGateAddress: DISTRICT_GATE_ADDRESS,
				chainId: 534351
			});

			txHash = result.txHash;
			uiState = 'confirmed';
			onsubmitted?.(result.txHash);
		} catch (err: unknown) {
			const error = err as { code?: number; message?: string };
			if (error.code === 4001) {
				errorMessage = 'Transaction cancelled.';
			} else {
				errorMessage = error.message || 'Transaction failed.';
			}
			uiState = 'error';
		}
	}

	function retry() {
		uiState = 'drafting';
		errorMessage = '';
	}
</script>

<div class="rounded-md border border-slate-200 bg-white p-5" style="border-radius: 12px;">
	<h3 class="text-base font-bold text-slate-900" style="font-family: 'Satoshi', sans-serif;">
		Submit Argument
	</h3>

	{#if uiState === 'confirmed'}
		<div class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
			<p class="text-sm font-medium text-emerald-700">Argument submitted successfully.</p>
			<p class="mt-1 truncate text-xs text-emerald-600" style="font-family: 'Berkeley Mono', monospace;">
				tx: {txHash}
			</p>
		</div>
	{:else if uiState === 'error'}
		<div class="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
			<p class="text-sm text-red-700">{errorMessage}</p>
			<button
				onclick={retry}
				class="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
				style="border-radius: 8px;"
			>
				Try Again
			</button>
		</div>
	{:else}
		<div class="mt-4 space-y-4">
			<!-- Stance selector -->
			<div>
				<label class="block text-sm font-medium text-slate-700">Stance</label>
				<div class="mt-1 flex gap-2">
					{#each [0, 1, 2] as s}
						<button
							onclick={() => { stance = s as 0 | 1 | 2; }}
							class="rounded-lg px-4 py-2 text-sm font-medium transition-colors {stance === s
								? 'bg-slate-900 text-white'
								: 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
							style="border-radius: 8px;"
						>
							{stanceLabels[s]}
						</button>
					{/each}
				</div>
			</div>

			<!-- Body text -->
			<div>
				<label for="arg-body" class="block text-sm font-medium text-slate-700">
					Argument <span class="font-normal text-slate-400">(min 10 chars)</span>
				</label>
				<textarea
					id="arg-body"
					bind:value={bodyText}
					rows="4"
					placeholder="State your argument..."
					class="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
				></textarea>
			</div>

			<!-- Amendment text (only for AMEND) -->
			{#if stance === 2}
				<div>
					<label for="arg-amendment" class="block text-sm font-medium text-slate-700">
						Proposed Amendment
					</label>
					<textarea
						id="arg-amendment"
						bind:value={amendmentText}
						rows="3"
						placeholder="Describe the proposed amendment..."
						class="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
					></textarea>
				</div>
			{/if}

			<!-- Stake amount -->
			<div>
				<label for="arg-stake" class="block text-sm font-medium text-slate-700">
					Stake (USDC)
				</label>
				<input
					id="arg-stake"
					type="number"
					step="0.01"
					min="0.01"
					bind:value={stakeAmount}
					placeholder="0.00"
					class="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
				/>
			</div>

			<button
				onclick={handleSubmit}
				disabled={!canSubmit || uiState === 'signing' || uiState === 'submitting'}
				class="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
				style="border-radius: 8px;"
			>
				{#if uiState === 'signing'}
					<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
					Waiting for signature...
				{:else if uiState === 'submitting'}
					<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
					Confirming on-chain...
				{:else}
					Submit Argument
				{/if}
			</button>
		</div>
	{/if}
</div>
