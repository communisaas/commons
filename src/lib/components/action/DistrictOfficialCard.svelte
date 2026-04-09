<script lang="ts">
	/**
	 * District Official Entity — congressional representatives.
	 *
	 * Same density-contrast approach as DecisionMakerLandscapeCard.
	 * Distinguished by the emerald "Congressional" label — route type
	 * encoded in typography, not in container styling.
	 */
	import { Mail, ChevronRight, ExternalLink, Phone } from '@lucide/svelte';
	import type { LandscapeMember } from '$lib/utils/landscapeMerge';

	const ROLE_SHORT: Record<string, string> = {
		votes: 'Votes',
		executes: 'Executes',
		shapes: 'Shapes',
		funds: 'Funds',
		oversees: 'Oversees'
	};

	let {
		member,
		contacted = false,
		departing = false,
		onWriteTo,
		showRoleBadge = false
	}: {
		member: LandscapeMember;
		contacted: boolean;
		departing: boolean;
		onWriteTo: (member: LandscapeMember) => void;
		showRoleBadge?: boolean;
	} = $props();

	function extractDomain(url: string): string {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	const canAct = $derived(member.deliveryRoute !== 'recorded' && member.deliveryRoute !== 'phone_only');
	const isActive = $derived(canAct && !contacted && !departing);

	function handleClick() {
		if (isActive) {
			onWriteTo(member);
		}
	}
</script>

{#snippet entityContent()}
	<!-- Name + role/route label -->
	<div class="flex items-baseline gap-2">
		<h4 class="text-xl font-bold text-slate-900 font-brand leading-tight">{member.name}</h4>
		{#if member.deliveryRoute === 'cwc'}
			<span class="text-xs font-medium text-emerald-600 shrink-0">Congressional</span>
		{:else if showRoleBadge && member.roleCategory}
			<span class="role-badge shrink-0">{ROLE_SHORT[member.roleCategory] || member.roleCategory}</span>
		{/if}
	</div>

	<!-- Title — org is in the group header when showRoleBadge is active -->
	<p class="mt-0.5 text-sm text-slate-500 leading-snug">
		{member.title || member.organization || ''}
	</p>

	<!-- Phone for non-email officials -->
	{#if member.deliveryRoute === 'phone_only' && member.phone}
		<div class="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
			<Phone class="h-3.5 w-3.5" />
			<a href="tel:{member.phone}" class="hover:text-slate-700">{member.phone}</a>
		</div>
	{/if}

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
			{:else if member.deliveryRoute === 'cwc'}
				<span class="action-link flex items-center gap-0.5 text-xs text-slate-400 transition-colors duration-150">
					Send via Congress
					<ChevronRight class="h-3.5 w-3.5 transition-all duration-150 opacity-0 -translate-x-1" />
				</span>
			{:else if member.deliveryRoute === 'email'}
				<span class="action-link flex items-center gap-0.5 text-xs text-slate-400 transition-colors duration-150">
					Write to them
					<ChevronRight class="h-3.5 w-3.5 transition-all duration-150 opacity-0 -translate-x-1" />
				</span>
			{:else if member.deliveryRoute === 'form' && member.contactFormUrl}
				<a
					href={member.contactFormUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="flex items-center gap-0.5 text-xs text-slate-400 hover:text-[var(--coord-route-solid)] transition-colors"
					onclick={(e) => e.stopPropagation()}
				>
					Contact form
					<ExternalLink class="h-3 w-3" />
				</a>
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
	:global(.group:hover) .action-link {
		color: var(--coord-route-solid);
	}
	:global(.group:hover) .action-link :global(svg) {
		opacity: 1;
		transform: translateX(0);
	}
	.role-badge {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-slate-400);
		line-height: 1;
	}
	.entity--contacted :global(h4) { color: var(--color-slate-400); }
	.entity--contacted :global(p) { color: var(--color-slate-300); }
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
