<script lang="ts">
	import type { Fact } from '$lib/core/fact';

	type Attestation = {
		attestationHash: string;
		methodologyVersion: number;
	};

	let { current }: { current: Fact<Attestation> } = $props();

	let copied = $state(false);

	async function copyHash() {
		if (current.state !== 'present') return;
		await navigator.clipboard.writeText(current.value.attestationHash);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<div class="rounded-lg border border-slate-200 bg-white p-4">
	<h3 class="mb-3 text-sm font-semibold text-slate-700">Attestation</h3>

	{#if current.state === 'present'}
		<div class="space-y-2">
			<div>
				<div class="mb-1 text-xs text-slate-500">Snapshot hash (SHA-256)</div>
				<div class="flex items-center gap-2">
					<code
						class="flex-1 truncate rounded bg-slate-50 px-2 py-1 font-mono text-xs text-slate-600"
					>
						{current.value.attestationHash}
					</code>
					<button
						onclick={copyHash}
						class="shrink-0 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
						title="Copy hash"
					>
						{copied ? 'Copied' : 'Copy'}
					</button>
				</div>
			</div>

			<div class="flex items-center justify-between text-xs text-slate-500">
				<span>Methodology v{current.value.methodologyVersion}</span>
				<a href="/about/integrity" class="text-indigo-600 hover:text-indigo-800">
					How is this calculated?
				</a>
			</div>
		</div>
	{:else if current.state === 'absent'}
		<p class="text-sm text-slate-400">No scorecard snapshot is recorded.</p>
	{:else if current.state === 'withheld'}
		<p class="text-sm text-slate-400">Public snapshot details are withheld.</p>
	{:else}
		<p class="text-sm text-slate-400">Snapshot details are temporarily unavailable.</p>
	{/if}
</div>
