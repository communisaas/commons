<script lang="ts">
	let {
		hash,
		version
	}: {
		hash: string | null;
		version: number | null;
	} = $props();

	let copied = $state(false);

	async function copyHash() {
		if (!hash) return;
		await navigator.clipboard.writeText(hash);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<div class="rounded-lg border border-slate-200 bg-white p-4">
	<h3 class="mb-3 text-sm font-semibold text-slate-700">Attestation</h3>

	{#if hash}
		<div class="space-y-2">
			<div>
				<div class="mb-1 text-xs text-slate-500">Snapshot hash (SHA-256)</div>
				<div class="flex items-center gap-2">
					<code class="flex-1 truncate rounded bg-slate-50 px-2 py-1 font-mono text-xs text-slate-600">
						{hash}
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
				<span>Methodology v{version}</span>
				<a
					href="/about/integrity"
					class="text-indigo-600 hover:text-indigo-800"
				>
					How is this calculated?
				</a>
			</div>
		</div>
	{:else}
		<p class="text-sm text-slate-400">No attestation data available</p>
	{/if}
</div>
