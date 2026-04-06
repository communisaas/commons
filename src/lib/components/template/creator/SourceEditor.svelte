<!--
  SourceEditor — Live bidirectional source/citation management

  The text IS the source management interface. This component mirrors
  the citation state of the textarea above it, showing:
  - Active sources (referenced in text, source exists)
  - Dangling references (referenced in text, no source)
  - Orphaned sources (source exists, not referenced)

  Two paths to add: type [n] in text (power user) or click "+ Add source" (discovery).
  Remove cascades: strips both source object and text references.
-->
<script lang="ts">
	import type { Source } from '$lib/types/template';
	import { extractCitations, getSourceTypeBadge } from '$lib/utils/message-processing';
	import { X, Plus } from '@lucide/svelte';

	interface Props {
		sources: Source[];
		message: string;
		onSourcesChange: (sources: Source[]) => void;
		onMessageChange: (message: string) => void;
		onInsertAtCursor: (text: string) => void;
	}

	let { sources, message, onSourcesChange, onMessageChange, onInsertAtCursor }: Props = $props();

	// ── Derived States ──────────────────────────────────────────────────
	const referencedNums = $derived([...new Set(extractCitations(message))]);
	const sourceMap = $derived(new Map(sources.map((s) => [s.num, s])));
	const activeSources = $derived(
		sources.filter((s) => referencedNums.includes(s.num)).sort((a, b) => a.num - b.num)
	);
	const orphanedSources = $derived(
		sources.filter((s) => !referencedNums.includes(s.num)).sort((a, b) => a.num - b.num)
	);
	const danglingNums = $derived(
		referencedNums.filter((n) => !sourceMap.has(n)).sort((a, b) => a - b)
	);
	const nextNum = $derived(
		Math.max(0, ...sources.map((s) => s.num), ...referencedNums) + 1
	);

	function countRefs(num: number): number {
		return (message.match(new RegExp(`\\[${num}\\]`, 'g')) || []).length;
	}

	// ── Interaction State ───────────────────────────────────────────────
	let showAddForm = $state(false);
	let addingForNum = $state<number | null>(null); // null = new source, number = filling dangling
	let newUrl = $state('');
	let newTitle = $state('');
	let newType = $state<Source['type']>('other');
	let confirmingRemove = $state<number | null>(null);

	const SOURCE_TYPES: Source['type'][] = [
		'government',
		'journalism',
		'research',
		'legal',
		'advocacy',
		'other'
	];
	const TYPE_LABELS: Record<Source['type'], string> = {
		government: 'Gov',
		journalism: 'News',
		research: 'Research',
		legal: 'Legal',
		advocacy: 'Advocacy',
		other: 'Other'
	};

	// ── Actions ─────────────────────────────────────────────────────────
	function startAdd(forNum?: number) {
		showAddForm = true;
		addingForNum = forNum ?? null;
		newUrl = '';
		newTitle = '';
		newType = 'other';
		confirmingRemove = null;
	}

	function cancelAdd() {
		showAddForm = false;
		addingForNum = null;
	}

	function commitAdd() {
		const url = newUrl.trim();
		if (!url) return;

		const num = addingForNum ?? nextNum;
		const source: Source = {
			num,
			title: newTitle.trim() || extractDomain(url),
			url,
			type: newType
		};

		onSourcesChange([...sources, source].sort((a, b) => a.num - b.num));

		// Fresh add (not filling dangling ref) → insert citation at cursor
		if (addingForNum === null) {
			onInsertAtCursor(` [${num}]`);
		}

		cancelAdd();
	}

	function removeSource(num: number) {
		if (countRefs(num) > 0) {
			confirmingRemove = num;
		} else {
			onSourcesChange(sources.filter((s) => s.num !== num));
		}
	}

	function confirmRemove(num: number) {
		onSourcesChange(sources.filter((s) => s.num !== num));
		const cleaned = message.replace(new RegExp(`\\[${num}\\]`, 'g'), '').replace(/ {2,}/g, ' ');
		onMessageChange(cleaned);
		confirmingRemove = null;
	}

	function cancelRemove() {
		confirmingRemove = null;
	}

	function insertRef(num: number) {
		onInsertAtCursor(` [${num}]`);
	}

	// ── Utilities ───────────────────────────────────────────────────────
	function extractDomain(url: string): string {
		try {
			return new URL(url).hostname.replace('www.', '');
		} catch {
			return url;
		}
	}

	function inferType(url: string): Source['type'] {
		try {
			const h = new URL(url).hostname.toLowerCase();
			if (h.endsWith('.gov') || h.includes('.gov.')) return 'government';
			if (h.endsWith('.edu')) return 'research';
			if (
				[
					'nytimes',
					'washingtonpost',
					'reuters',
					'apnews',
					'bbc',
					'cnn',
					'npr',
					'politico',
					'thehill',
					'sfchronicle'
				].some((d) => h.includes(d))
			)
				return 'journalism';
			if (h.includes('court') || h.includes('law')) return 'legal';
			return 'other';
		} catch {
			return 'other';
		}
	}

	function handleUrlInput() {
		if (newUrl.trim()) newType = inferType(newUrl);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			commitAdd();
		} else if (e.key === 'Escape') {
			cancelAdd();
		}
	}

	/** Svelte action: focus element on mount */
	function autoFocus(node: HTMLInputElement) {
		requestAnimationFrame(() => node.focus());
	}
</script>

<!-- ── Form snippet (shared by dangling-ref and bottom-add) ────────── -->
{#snippet sourceForm(num: number, variant: 'dangling' | 'new')}
	<input
		type="url"
		bind:value={newUrl}
		oninput={handleUrlInput}
		onkeydown={handleKeydown}
		placeholder="Paste URL"
		use:autoFocus
		class="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm
		       placeholder:text-slate-400 focus:border-participation-primary-400
		       focus:outline-none focus:ring-1 focus:ring-participation-primary-400"
	/>
	<input
		type="text"
		bind:value={newTitle}
		onkeydown={handleKeydown}
		placeholder="Source title"
		class="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm
		       placeholder:text-slate-400 focus:border-participation-primary-400
		       focus:outline-none focus:ring-1 focus:ring-participation-primary-400"
	/>
	<!-- Type chips — recognition over recall -->
	<div class="flex flex-wrap gap-1">
		{#each SOURCE_TYPES as type}
			{@const b = getSourceTypeBadge(type)}
			<button
				type="button"
				onclick={() => (newType = type)}
				class="rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors
				       {newType === type
					? `${b.bg} ${b.text} ${b.border} ring-1 ring-offset-1 ring-slate-300`
					: 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'}"
			>
				{TYPE_LABELS[type]}
			</button>
		{/each}
	</div>
	<div class="flex items-center justify-end gap-2">
		<button
			type="button"
			onclick={cancelAdd}
			class="rounded-md px-2.5 py-1 text-xs font-medium text-slate-500
			       transition-colors hover:bg-slate-100"
		>
			Cancel
		</button>
		<button
			type="button"
			onclick={commitAdd}
			disabled={!newUrl.trim()}
			class="rounded-md bg-participation-primary-600 px-2.5 py-1 text-xs font-medium
			       text-white transition-colors hover:bg-participation-primary-700
			       disabled:opacity-50"
		>
			{variant === 'dangling' ? 'Add source' : `Add & insert [${num}]`}
		</button>
	</div>
{/snippet}

<!-- ── Source Editor ──────────────────────────────────────────────────── -->
<div class="space-y-2">
	<!-- Status bar -->
	{#if sources.length > 0 || danglingNums.length > 0}
		<div class="flex items-center gap-1.5 text-xs">
			<span class="font-medium text-slate-600">Sources</span>
			{#if activeSources.length > 0}
				<span class="text-slate-300">&middot;</span>
				<span class="text-slate-500">{activeSources.length} cited</span>
			{/if}
			{#if orphanedSources.length > 0}
				<span class="text-slate-300">&middot;</span>
				<span class="text-amber-600">{orphanedSources.length} not cited</span>
			{/if}
			{#if danglingNums.length > 0}
				<span class="text-slate-300">&middot;</span>
				<span class="text-red-500">{danglingNums.length} missing</span>
			{/if}
		</div>
	{/if}

	<!-- Active sources -->
	{#each activeSources as source (source.num)}
		{@const badge = getSourceTypeBadge(source.type)}
		{@const isConfirming = confirmingRemove === source.num}
		<div
			class="group rounded-md border bg-white transition-colors
			       {isConfirming
				? 'border-red-200 bg-red-50/30'
				: 'border-slate-200/80 hover:border-slate-300/80'}"
		>
			<div class="flex items-center gap-2.5 px-3 py-2">
				<span
					class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full
					       bg-participation-primary-50 text-[10px] font-semibold leading-none
					       text-participation-primary-600"
				>
					{source.num}
				</span>
				<div class="min-w-0 flex-1">
					<span class="line-clamp-1 text-sm text-slate-800">{source.title}</span>
					<div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
						<span
							class="inline-flex items-center rounded-full border px-1.5 py-px font-medium
							       {badge.bg} {badge.text} {badge.border}"
						>
							{source.type}
						</span>
						<span>&middot;</span>
						<span class="truncate">{extractDomain(source.url)}</span>
					</div>
				</div>
				<button
					type="button"
					onclick={() => removeSource(source.num)}
					class="flex-shrink-0 rounded p-1 text-slate-300 opacity-0 transition-all
					       hover:bg-red-50 hover:text-red-400 group-hover:opacity-100"
					aria-label="Remove source {source.num}"
				>
					<X class="h-3.5 w-3.5" />
				</button>
			</div>

			{#if isConfirming}
				<div class="border-t border-red-100 px-3 py-2.5">
					<p class="text-xs text-red-600">
						Cited {countRefs(source.num)}&times; in your message
					</p>
					<div class="mt-2 flex items-center gap-2">
						<button
							type="button"
							onclick={() => confirmRemove(source.num)}
							class="rounded-md bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700
							       transition-colors hover:bg-red-200"
						>
							Remove source & citations
						</button>
						<button
							type="button"
							onclick={cancelRemove}
							class="rounded-md px-2.5 py-1 text-xs font-medium text-slate-500
							       transition-colors hover:bg-slate-100"
						>
							Keep
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/each}

	<!-- Dangling references — referenced in text, no source object -->
	{#each danglingNums as num (num)}
		{@const isAddingThis = showAddForm && addingForNum === num}
		<div class="rounded-md border border-amber-200/80 bg-amber-50/30 transition-colors">
			<div class="flex items-center gap-2.5 px-3 py-2">
				<span
					class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full
					       bg-amber-100 text-[10px] font-semibold leading-none text-amber-700"
				>
					{num}
				</span>
				<div class="min-w-0 flex-1">
					<span class="text-sm text-amber-700">No source linked</span>
					<div class="mt-0.5 text-[11px] text-amber-500">
						Referenced {countRefs(num)}&times; in message
					</div>
				</div>
				{#if !isAddingThis}
					<button
						type="button"
						onclick={() => startAdd(num)}
						class="flex-shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1
						       text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
					>
						<span class="flex items-center gap-1">
							<Plus class="h-3 w-3" />
							Add
						</span>
					</button>
				{/if}
			</div>

			{#if isAddingThis}
				<div class="space-y-2 border-t border-amber-200/60 px-3 py-2.5">
					{@render sourceForm(num, 'dangling')}
				</div>
			{/if}
		</div>
	{/each}

	<!-- Orphaned sources — source exists, not referenced in text -->
	{#each orphanedSources as source (source.num)}
		{@const badge = getSourceTypeBadge(source.type)}
		<div
			class="group rounded-md border border-slate-200/60 bg-slate-50/50 opacity-60
			       transition-all hover:border-slate-300/80 hover:opacity-100"
		>
			<div class="flex items-center gap-2.5 px-3 py-2">
				<span
					class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full
					       bg-slate-100 text-[10px] font-semibold leading-none text-slate-400"
				>
					{source.num}
				</span>
				<div class="min-w-0 flex-1">
					<span class="line-clamp-1 text-sm text-slate-600">{source.title}</span>
					<div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
						<span
							class="inline-flex items-center rounded-full border px-1.5 py-px font-medium
							       {badge.bg} {badge.text} {badge.border}"
						>
							{source.type}
						</span>
						<span>&middot;</span>
						<span class="truncate">{extractDomain(source.url)}</span>
						<span>&middot;</span>
						<span class="italic">not cited</span>
					</div>
				</div>
				<div
					class="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
				>
					<button
						type="button"
						onclick={() => insertRef(source.num)}
						class="flex-shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1
						       text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100"
						aria-label="Insert [{source.num}] at cursor"
					>
						Insert
					</button>
					<button
						type="button"
						onclick={() => removeSource(source.num)}
						class="flex-shrink-0 rounded p-1 text-slate-300
						       hover:bg-red-50 hover:text-red-400"
						aria-label="Remove source {source.num}"
					>
						<X class="h-3.5 w-3.5" />
					</button>
				</div>
			</div>
		</div>
	{/each}

	<!-- Add source: bottom form or button -->
	{#if showAddForm && addingForNum === null}
		<div class="space-y-2 rounded-md border border-slate-200 bg-white px-3 py-2.5">
			<div class="mb-1 flex items-center gap-2">
				<span
					class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full
					       bg-participation-primary-50 text-[10px] font-semibold leading-none
					       text-participation-primary-600"
				>
					{nextNum}
				</span>
				<span class="text-sm font-medium text-slate-700">New source</span>
			</div>
			{@render sourceForm(nextNum, 'new')}
		</div>
	{:else if !showAddForm}
		<button
			type="button"
			onclick={() => startAdd()}
			class="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium
			       text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
		>
			<Plus class="h-3.5 w-3.5" />
			Add source
		</button>
	{/if}
</div>
