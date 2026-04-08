<script lang="ts">
	import { mergeLandscape, type LandscapeMember, type DistrictOfficialInput } from '$lib/utils/landscapeMerge';
	import RoleGroup from './RoleGroup.svelte';
	import type { ProcessedDecisionMaker, Template } from '$lib/types/template';
	import { MapPin, ChevronRight, Mail, Loader2 } from '@lucide/svelte';
	import { onMount } from 'svelte';

	let {
		template,
		decisionMakers = [],
		districtOfficials = [],
		contactedRecipients = new Set(),
		departingRecipients = new Set(),
		onWriteTo,
		onBatchRegister,
		onVerifyAddress,
		registrationState = 'idle',
		isCongressional = false
	}: {
		template: Template;
		decisionMakers?: ProcessedDecisionMaker[];
		districtOfficials?: DistrictOfficialInput[];
		contactedRecipients?: Set<string>;
		departingRecipients?: Set<string>;
		onWriteTo: (member: LandscapeMember) => void;
		onBatchRegister: (memberIds: string[]) => void;
		onVerifyAddress?: () => void;
		registrationState?: 'idle' | 'registering' | 'complete';
		isCongressional?: boolean;
	} = $props();

	const landscape = $derived(mergeLandscape(decisionMakers, districtOfficials));
	const isCwc = $derived(template.deliveryMethod === 'cwc' || isCongressional);

	// Landscape-specific counts (only members actually in this landscape)
	const allMembers = $derived([
		...landscape.roleGroups.flatMap(g => g.members),
		...(landscape.districtGroup?.members ?? [])
	]);
	const totalCount = $derived(allMembers.length);
	const contactedInLandscape = $derived(
		allMembers.filter(m => contactedRecipients.has(m.id)).length
	);
	const remainingCount = $derived(totalCount - contactedInLandscape);

	// Count email-bearing members not yet contacted (for mobile batch bar)
	const emailRemainingCount = $derived(
		allMembers.filter(m => m.email && m.deliveryRoute === 'email' && !contactedRecipients.has(m.id)).length
	);

	let revealed = $state(false);

	onMount(() => {
		requestAnimationFrame(() => {
			revealed = true;
		});
	});

	function handleBatchRegister() {
		const allIds = [
			...landscape.roleGroups.flatMap(g => g.members.map(m => m.id)),
			...(landscape.districtGroup?.members.map(m => m.id) || [])
		].filter(id => !contactedRecipients.has(id));
		onBatchRegister(allIds);
	}
</script>

<div class="landscape" class:revealed>
	{#if landscape.totalCount === 0}
		<!-- Empty state: contextual based on delivery method -->
		{#if isCwc && onVerifyAddress}
			<!-- CWC template without district — verify to reveal -->
			<div class="py-4">
				<h2 class="font-mono text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
					Your representatives
				</h2>
				<p class="text-sm text-slate-500 leading-relaxed mb-4">
					Congressional offices prioritize messages from their own constituents. Verify your address to see who represents you.
				</p>
				<button
					type="button"
					class="group flex items-center gap-2 text-sm font-medium text-[var(--coord-route-solid)] hover:opacity-80 cursor-pointer min-h-[44px] transition-colors"
					onclick={onVerifyAddress}
				>
					<MapPin class="h-4 w-4" />
					Verify your address
					<ChevronRight class="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
				</button>
			</div>
		{:else if isCwc}
			<!-- Congressional template — guest -->
			<div class="py-4">
				<h2 class="font-mono text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
					Your representatives
				</h2>
				<p class="text-sm text-slate-500 leading-relaxed">
					Sign in and verify your address to see who represents you.
				</p>
			</div>
		{:else}
			<!-- Non-CWC template — generic empty -->
			<div class="py-4">
				<h2 class="font-mono text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
					Who decides
				</h2>
				<p class="text-sm text-slate-500">
					Decision-makers for this issue will appear here.
				</p>
			</div>
		{/if}
	{:else}
		<!-- Populated landscape -->
		<div class="space-y-5">
			<!-- Batch action header — same "Write to" gesture as cards, collective scope -->
			<div class="flex items-center justify-between">
				{#if registrationState === 'registering'}
					<span class="flex items-center gap-1.5 text-sm font-medium text-slate-400 min-h-[44px]">
						<Loader2 class="h-4 w-4 animate-spin" />
						Opening mail&hellip;
					</span>
				{:else if remainingCount > 0}
					<button
						type="button"
						class="group/batch flex items-center gap-1 text-sm font-medium text-participation-primary-600 hover:text-participation-primary-700 transition-colors cursor-pointer min-h-[44px]"
						onclick={handleBatchRegister}
					>
						Write to all {remainingCount}
						<ChevronRight class="h-4 w-4 transition-transform group-hover/batch:translate-x-0.5" />
					</button>
				{:else if totalCount > 0}
					<span class="flex items-center gap-1.5 text-sm font-medium text-slate-500">
						<Mail class="h-4 w-4" />
						All {totalCount} emails started
					</span>
				{/if}
				{#if contactedInLandscape > 0 && remainingCount > 0}
					<span class="text-xs tabular-nums text-slate-400">
						{contactedInLandscape} of {totalCount}
					</span>
				{/if}
			</div>

			<!-- Role groups in a 2-col grid — each group is one cell -->
			<div class="landscape-grid">
				{#each landscape.roleGroups as group, i (group.category)}
					<div
						class="role-group"
						class:revealed
						style="animation-delay: {i * 80}ms"
					>
						<RoleGroup
							{group}
							{contactedRecipients}
							{departingRecipients}
							{onWriteTo}
						/>
					</div>
				{/each}
			</div>

			<!-- District group spans full width below the grid -->
			{#if landscape.districtGroup}
				<div
					class="role-group"
					class:revealed
					style="animation-delay: {landscape.roleGroups.length * 100}ms"
				>
					<RoleGroup
						group={landscape.districtGroup}
						{contactedRecipients}
						{departingRecipients}
						{onWriteTo}
						isDistrictGroup={true}
					/>
				</div>
			{/if}

			<!-- Hybrid: DMs visible but congress requires address verification -->
			{#if isCwc && !landscape.districtGroup && onVerifyAddress}
				<div class="pt-4 border-t border-slate-100">
					<button
						type="button"
						class="group flex items-center gap-2 text-sm text-slate-500 hover:text-[var(--coord-route-solid)] cursor-pointer min-h-[44px] transition-colors"
						onclick={onVerifyAddress}
					>
						<MapPin class="h-4 w-4" />
						Verify your address to also contact your representatives
						<ChevronRight class="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.landscape {
		opacity: 0;
		transform: translateY(6px);
	}
	.landscape.revealed {
		animation: fadeIn 250ms ease-out forwards;
	}
	.landscape-grid {
		display: grid;
		grid-template-columns: 1fr;
		column-gap: 2rem;
		row-gap: 2.5rem;
		align-items: start;
	}
	@media (min-width: 768px) {
		.landscape-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	.role-group {
		opacity: 0;
		transform: translateY(8px);
	}
	.role-group.revealed {
		animation: revealGroup 300ms ease-out forwards;
	}
	@keyframes fadeIn {
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@keyframes revealGroup {
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.landscape,
		.role-group {
			opacity: 1;
			transform: none;
		}
		.landscape.revealed,
		.role-group.revealed {
			animation: none;
		}
	}
</style>
