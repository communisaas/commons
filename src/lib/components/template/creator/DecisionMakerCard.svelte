<script lang="ts">
	import { CheckCircle2, Mail, ExternalLink, X, User } from '@lucide/svelte';
	import type { ProcessedDecisionMaker } from '$lib/types/template';

	interface Props {
		decisionMaker: ProcessedDecisionMaker;
		onremove?: () => void;
	}

	let { decisionMaker, onremove }: Props = $props();

	let showProvenance = $state(false);

	function copyEmail() {
		if (decisionMaker.email) {
			navigator.clipboard.writeText(decisionMaker.email);
		}
	}
</script>

<div class="rounded-lg border border-slate-200 bg-white p-4">
	<!-- Header: Icon + Name/Title -->
	<div class="flex items-start gap-3">
		<div
			class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full {decisionMaker.isAiResolved ? 'bg-green-100' : 'bg-slate-100'}"
		>
			{#if decisionMaker.isAiResolved}
				<CheckCircle2 class="h-4 w-4 text-green-600" />
			{:else}
				<User class="h-4 w-4 text-slate-600" />
			{/if}
		</div>

		<div class="min-w-0 flex-1">
			<h4 class="font-semibold text-slate-900">{decisionMaker.name}</h4>
			<p class="text-sm text-slate-600">
				{decisionMaker.title} • {decisionMaker.organization}
			</p>

			<!-- Reasoning -->
			{#if decisionMaker.reasoning}
				<p class="mt-2 text-sm text-slate-600">{decisionMaker.reasoning}</p>
			{/if}

			<!-- Contact & Source Row -->
			<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
				{#if decisionMaker.email}
					<button
						type="button"
						onclick={() => (showProvenance = true)}
						class="inline-flex items-center gap-1.5 text-slate-700 hover:text-slate-900"
					>
						<Mail class="h-3.5 w-3.5 text-slate-400" />
						<span class="font-medium">{decisionMaker.email}</span>
					</button>
				{/if}

				{#if decisionMaker.source}
					<a
						href={decisionMaker.source}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex items-center gap-1 text-participation-primary-600 hover:text-participation-primary-700"
					>
						<ExternalLink class="h-3.5 w-3.5" />
						<span>Source</span>
					</a>
				{/if}

				{#if onremove}
					<button
						type="button"
						onclick={onremove}
						class="ml-auto inline-flex items-center gap-1 text-red-600 hover:text-red-700"
					>
						<X class="h-3.5 w-3.5" />
						<span>Remove</span>
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>

<!-- Provenance Popover (Modal) -->
{#if showProvenance}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={(e) => {
			if (e.target === e.currentTarget) showProvenance = false;
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') showProvenance = false;
		}}
		role="dialog"
		aria-modal="true"
		aria-label="Contact details"
		tabindex="-1"
	>
		<div class="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
			<h3 class="text-lg font-semibold text-slate-900">Contact Details</h3>

			<div class="mt-4 space-y-4">
				<!-- Contact Info -->
				<div>
					<p class="text-base font-semibold text-slate-900">{decisionMaker.name}</p>
					{#if decisionMaker.email}
						<p class="mt-1 font-mono text-sm text-slate-700">{decisionMaker.email}</p>
					{/if}
				</div>

				<!-- How We Verified -->
				<div>
					<p class="text-sm font-medium text-slate-700">How we verified this:</p>
					<p class="mt-1 text-sm text-slate-600">{decisionMaker.provenance}</p>
				</div>

				<!-- Source Link -->
				{#if decisionMaker.source}
					<div>
						<p class="text-sm font-medium text-slate-700">Source:</p>
						<a
							href={decisionMaker.source}
							target="_blank"
							rel="noopener noreferrer"
							class="mt-1 inline-flex items-center gap-1 text-sm text-participation-primary-600 hover:text-participation-primary-700"
						>
							<ExternalLink class="h-3.5 w-3.5" />
							{decisionMaker.source}
						</a>
					</div>
				{/if}
			</div>

			<!-- Actions -->
			<div class="mt-6 flex gap-2">
				{#if decisionMaker.source}
					<a
						href={decisionMaker.source}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex items-center gap-1.5 rounded-lg bg-participation-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-participation-primary-700"
					>
						<ExternalLink class="h-4 w-4" />
						View source
					</a>
				{/if}

				{#if decisionMaker.email}
					<button
						type="button"
						onclick={copyEmail}
						class="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
					>
						<Mail class="h-4 w-4" />
						Copy email
					</button>
				{/if}

				<button
					type="button"
					onclick={() => (showProvenance = false)}
					class="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
				>
					Close
				</button>
			</div>
		</div>
	</div>
{/if}
