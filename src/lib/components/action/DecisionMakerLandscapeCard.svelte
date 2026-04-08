<script lang="ts">
	/**
	 * Decision-Maker Entity — typographic presence, not a card.
	 *
	 * Figure-ground through proximity ratio:
	 * - Tight internal clustering (name + title + action = one dense island)
	 * - Generous void between entities (parent handles this via space-y)
	 * - Name at text-xl creates a topographic peak for scanning
	 * - Action link latent at rest, activates on hover
	 *
	 * The entity is a cluster, not a container.
	 */
	import { Mail, ChevronRight, ExternalLink } from '@lucide/svelte';
	import type { LandscapeMember } from '$lib/utils/landscapeMerge';

	function extractDomain(url: string): string {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	let {
		member,
		contacted = false,
		departing = false,
		onWriteTo
	}: {
		member: LandscapeMember;
		contacted: boolean;
		departing: boolean;
		onWriteTo: (member: LandscapeMember) => void;
	} = $props();

	const canAct = $derived(member.deliveryRoute !== 'recorded' && member.deliveryRoute !== 'phone_only');
	const isActive = $derived(canAct && !contacted && !departing);

	function handleClick() {
		if (isActive) {
			onWriteTo(member);
		}
	}
</script>

{#snippet entityContent()}
	<!-- Name: the strong center -->
	<h4 class="text-xl font-bold text-slate-900 font-brand leading-tight">{member.name}</h4>

	<!-- Title only — org is contextually obvious and creates glaze -->
	<p class="mt-0.5 text-sm text-slate-500 leading-snug">
		{member.title || member.organization || ''}
	</p>

	<!-- Actions: receded row — clearly subordinate to title -->
	<div class="mt-1.5 flex items-center gap-3">
		{#if canAct}
			{#if departing}
				<span class="departing-pulse text-xs text-slate-400">
					Opening mail&hellip;
				</span>
			{:else if contacted}
				<span class="flex items-center gap-1 text-xs text-slate-400">
					<Mail class="h-3 w-3" />
					Email started
				</span>
			{:else}
				<span class="action-link flex items-center gap-0.5 text-xs text-slate-400 transition-colors duration-150">
					Write to them
					<ChevronRight class="h-3.5 w-3.5 transition-all duration-150 opacity-0 -translate-x-1" />
				</span>
			{/if}
		{/if}

		{#if member.emailGrounded && member.emailSource}
			<a
				href={member.emailSource}
				target="_blank"
				rel="noopener noreferrer"
				class="flex items-center gap-0.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
				onclick={(e) => e.stopPropagation()}
			>
				{extractDomain(member.emailSource)}
				<ExternalLink class="h-2.5 w-2.5" />
			</a>
		{/if}
	</div>
{/snippet}

{#if isActive}
	<button
		type="button"
		aria-label="Write to {member.name}"
		class="entity group w-full text-left min-h-[44px] cursor-pointer"
		onclick={handleClick}
	>
		{@render entityContent()}
	</button>
{:else}
	<div
		class="entity min-h-[44px]
			{departing ? 'departing-entity' : contacted ? 'entity--contacted' : ''}"
	>
		{@render entityContent()}
	</div>
{/if}

<style>
	/* Hover activates the action link — the entity comes alive through its text */
	:global(.group:hover) .action-link {
		color: var(--coord-route-solid);
	}
	:global(.group:hover) .action-link :global(svg) {
		opacity: 1;
		transform: translateX(0);
	}
	/* Contacted: the entity settles — quieter, done */
	.entity--contacted :global(h4) { color: var(--color-slate-400); }
	.entity--contacted :global(p) { color: var(--color-slate-300); }

	/* Departing */
	.departing-entity { position: relative; }
	.departing-pulse {
		animation: breathe 1.5s ease-in-out infinite;
	}
	@keyframes breathe {
		0%, 100% { opacity: 0.4; }
		50% { opacity: 1; }
	}
	@media (prefers-reduced-motion: reduce) {
		.departing-pulse { animation: none; opacity: 0.7; }
	}
</style>
