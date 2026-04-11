<script lang="ts">
	import { ExternalLink, ChevronDown, ChevronUp } from '@lucide/svelte';
	import type { Source } from '$lib/types/template';
	import { getSourceTypeBadge, formatSourceCitation } from '$lib/utils/message-processing';

	interface Props {
		source: Source;
	}

	let { source }: Props = $props();

	let expanded = $state(false);

	const badge = $derived(getSourceTypeBadge(source.type));
	const citationText = $derived(formatSourceCitation(source));

	// Extract domain from URL for compact display
	const domain = $derived.by(() => {
		try {
			const url = new URL(source.url);
			return url.hostname.replace('www.', '');
		} catch {
			return source.url;
		}
	});
</script>

<div class="rounded-md border border-slate-200/80 bg-white transition-all hover:border-slate-300/80">
	<!-- Compact view -->
	<button
		type="button"
		onclick={() => (expanded = !expanded)}
		class="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-slate-50/60"
	>
		<!-- Citation number -->
		<span
			class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-participation-primary-50 text-[10px] font-bold leading-none text-participation-primary-600 font-mono"
		>
			{source.num}
		</span>

		<!-- Source info — single line when possible -->
		<div class="flex-1 min-w-0">
			<span class="text-sm text-slate-800 line-clamp-1">{source.title}</span>
			<div class="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
				<span
					class="inline-flex items-center rounded px-1 py-px font-medium {badge.text}"
				>
					{source.type}
				</span>
				<span>·</span>
				<span class="truncate">{domain}</span>
			</div>
		</div>

		<!-- Expand icon -->
		<div class="flex-shrink-0 text-slate-300">
			{#if expanded}
				<ChevronUp class="h-3.5 w-3.5" />
			{:else}
				<ChevronDown class="h-3.5 w-3.5" />
			{/if}
		</div>
	</button>

	<!-- Expanded view -->
	{#if expanded}
		<div class="border-t border-slate-100 px-3 py-2.5">
			<!-- Full URL with visit link -->
			<div class="flex items-start justify-between gap-2">
				<p class="flex-1 min-w-0 break-all text-xs text-slate-500 leading-relaxed">{source.url}</p>
				<a
					href={source.url}
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
					onclick={(e) => e.stopPropagation()}
				>
					Visit
					<ExternalLink class="h-3 w-3" />
				</a>
			</div>

			<!-- Citation format -->
			<div class="mt-2 rounded-md bg-slate-50 px-2.5 py-2">
				<p class="font-mono text-[11px] leading-relaxed text-slate-500">{citationText}</p>
			</div>
		</div>
	{/if}
</div>
