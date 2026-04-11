<script lang="ts">
	import { FileText, ChevronDown, ChevronUp } from '@lucide/svelte';

	interface Props {
		researchLog: string[];
		expanded?: boolean;
	}

	let { researchLog, expanded = $bindable(false) }: Props = $props();
</script>

<div class="rounded-md border border-slate-200/80 bg-white">
	<!-- Header -->
	<button
		type="button"
		onclick={() => (expanded = !expanded)}
		class="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-slate-50/60"
	>
		<div class="flex items-center gap-2.5">
			<div class="rounded-md bg-slate-100 p-1.5">
				<FileText class="h-3.5 w-3.5 text-slate-500" />
			</div>
			<div>
				<h3 class="text-sm font-medium text-slate-800">Research Log</h3>
				<p class="text-[11px] text-slate-400">
					{researchLog.length} research steps · See how we built this message
				</p>
			</div>
		</div>

		<div class="text-slate-300">
			{#if expanded}
				<ChevronUp class="h-3.5 w-3.5" />
			{:else}
				<ChevronDown class="h-3.5 w-3.5" />
			{/if}
		</div>
	</button>

	<!-- Expanded log -->
	{#if expanded}
		<div class="border-t border-slate-100 px-3 py-2.5">
			<div class="space-y-2">
				{#each researchLog as step, i}
					<div class="flex gap-2.5">
						<!-- Step number -->
						<div
							class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-bold font-mono text-slate-500"
						>
							{i + 1}
						</div>

						<!-- Step text -->
						<p class="flex-1 text-xs leading-relaxed text-slate-600">{step}</p>
					</div>
				{/each}
			</div>

			<!-- Educational context -->
			<div class="mt-3 rounded-md bg-slate-50 px-2.5 py-2">
				<p class="text-[11px] leading-relaxed text-slate-500">
					<span class="font-medium text-slate-600">Why transparency matters:</span>
					This log shows the agent's research process. You can verify the reasoning, check sources, and
					understand why specific points were included.
				</p>
			</div>
		</div>
	{/if}
</div>
