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
			<!-- CWC template without district — the user needs to verify address -->
			<div class="rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-5">
				<h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">
					Your representatives
				</h2>
				<p class="text-sm text-slate-600 leading-relaxed mb-4">
					Congressional offices prioritize messages from their own constituents. Verify your address to see who represents you and send your position directly.
				</p>
				<button
					type="button"
					class="group flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-participation-primary-300 hover:bg-participation-primary-50 cursor-pointer min-h-[44px]"
					onclick={onVerifyAddress}
				>
					<div class="flex h-9 w-9 items-center justify-center rounded-full bg-participation-primary-50 text-participation-primary-600 transition-colors group-hover:bg-participation-primary-100">
						<MapPin class="h-4.5 w-4.5" />
					</div>
					<div class="flex-1 min-w-0">
						<span class="text-sm font-medium text-slate-900">Verify your address</span>
						<span class="block text-xs text-slate-500">Unlocks direct congressional delivery</span>
					</div>
					<ChevronRight class="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5" />
				</button>
			</div>
		{:else if isCwc}
			<!-- Congressional template without verify handler (guest/unauthenticated) -->
			<div class="rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-5">
				<h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">
					Your representatives
				</h2>
				<p class="text-sm text-slate-600 leading-relaxed">
					Sign in and verify your address to see who represents you and send your message directly.
				</p>
			</div>
		{:else}
			<!-- Non-CWC template — generic empty -->
			<div class="rounded-xl border border-slate-200 bg-white p-5">
				<h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-2">
					Who decides
				</h2>
				<p class="text-sm text-slate-500">
					Decision-makers for this issue will appear here as they're identified.
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

			<!-- Role groups in balanced columns — no row-alignment gaps -->
			<div class="landscape-columns">
				{#each landscape.roleGroups as group, i (group.category)}
					<div
						class="role-group"
						class:revealed
						style="animation-delay: {i * 100}ms"
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
				<button
					type="button"
					class="group flex w-full items-center gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-left transition-colors hover:border-participation-primary-300 hover:bg-participation-primary-50 cursor-pointer"
					onclick={onVerifyAddress}
				>
					<MapPin class="h-4 w-4 text-slate-400 transition-colors group-hover:text-participation-primary-600" />
					<span class="flex-1 text-sm text-slate-600 group-hover:text-slate-700">Verify your address to also contact your representatives</span>
					<ChevronRight class="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5" />
				</button>
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
	/* Balanced columns: content packs vertically, no row-alignment gaps */
	.landscape-columns {
		columns: 1;
		column-gap: 1.25rem;
	}
	@media (min-width: 768px) {
		.landscape-columns {
			columns: 2;
		}
	}
	.role-group {
		break-inside: avoid;
		margin-bottom: 1.25rem;
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
