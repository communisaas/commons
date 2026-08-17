<script lang="ts">
	import { mergeLandscape, type LandscapeMember, type DistrictOfficialInput } from '$lib/utils/landscapeMerge';
	import RoleGroup from './RoleGroup.svelte';
	import type { RecipientConfigDecisionMaker, Template } from '$lib/types/template';
	import { MapPin, ChevronRight, Mail, Loader2 } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { getJurisdictionLabels } from '$lib/core/locale/jurisdiction';
	import { isCongressionalDelivery } from '$convex/lib/templateDeliveryMethod';
	import { ORG_ORDER_BASIS, UNRESOLVED_ORG_LABEL, compareOrgLabels } from '$lib/core/agents/org-order';

	const labels = getJurisdictionLabels();

	let {
		template,
		decisionMakers = [],
		districtOfficials = [],
		contactedRecipients = new Set(),
		departingRecipients = new Set(),
		priorContactIds = new Set(),
		onWriteTo,
		onBatchRegister,
		onVerifyAddress,
		registrationState = 'idle',
		isCongressional = false,
		viewerIsConstituent = false,
		canReportBounce = false,
		reportedBounces = new Set(),
		reportingBounce = null,
		onReportBounce
	}: {
		template: Template;
		decisionMakers?: RecipientConfigDecisionMaker[];
		districtOfficials?: DistrictOfficialInput[];
		contactedRecipients?: Set<string>;
		departingRecipients?: Set<string>;
		/**
		 * Members this viewer previously said they wrote to. Annotation only — it is
		 * deliberately absent from every count and from the batch list below, so a
		 * past self-report can never shrink what this landscape offers to send.
		 */
		priorContactIds?: Set<string>;
		onWriteTo: (member: LandscapeMember) => void;
		onBatchRegister: (memberIds: string[]) => void;
		onVerifyAddress?: () => void;
		registrationState?: 'idle' | 'registering' | 'complete';
		isCongressional?: boolean;
		/** Author or real verified/entered-address district viewer — gates the possessive label. */
		viewerIsConstituent?: boolean;
		canReportBounce?: boolean;
		reportedBounces?: Set<string>;
		reportingBounce?: string | null;
		onReportBounce?: (email: string) => void;
	} = $props();

	const landscape = $derived(mergeLandscape(decisionMakers, districtOfficials, viewerIsConstituent));
	const isCwc = $derived(isCongressionalDelivery(template.deliveryMethod) || isCongressional);

	// Group by organization — the natural institutional link between decision-makers.
	// Role categories become inline badges on each entity rather than section headers.
	// Ordered alphabetically by name, and the page says so (ORG_ORDER_BASIS); the
	// comparator and both strings live in $lib/core/agents/org-order, which carries
	// the rationale. The retired largest-first rule claimed to help packing and did
	// not: CSS `column-count: 2` (see .landscape-columns below) balances column
	// height at layout time from the flowed content, and `break-inside: avoid` on
	// .role-group already prevents a group from splitting, so array order never
	// affected packing — it only handed the top of a stranger's screen to whichever
	// institution the resolver happened to return most rows for.
	const orgGroups = $derived(() => {
		const allDMs = landscape.roleGroups.flatMap(g => g.members);
		const groups = new Map<string, LandscapeMember[]>();
		for (const m of allDMs) {
			const key = m.organization.trim();
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(m);
		}
		return [...groups.entries()]
			.sort((a, b) => compareOrgLabels(a[0], b[0]))
			.map(([key, members]) => ({
				key,
				label: key || UNRESOLVED_ORG_LABEL,
				members
			}));
	});

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

	// The set the batch control can actually address. This predicate must stay
	// equal to the one the page applies before it builds a mailto —
	// src/routes/s/[slug]/+page.svelte:724 filters `m.email && m.deliveryRoute === 'email'`.
	// Anything wider here would advertise reach the send path drops on the floor.
	const emailRemainingCount = $derived(
		allMembers.filter(m => m.email && m.deliveryRoute === 'email' && !contactedRecipients.has(m.id)).length
	);
	// Still shown, still counted, but no mailbox this control can open.
	const unroutableRemaining = $derived(remainingCount - emailRemainingCount);

	let revealed = $state(false);

	onMount(() => {
		requestAnimationFrame(() => {
			revealed = true;
		});
	});

	function handleBatchRegister() {
		// Same conjunction the label counts, chained onto the existing filter so
		// the ids handed over are exactly the ones the button promised.
		const writableIds = new Set(
			allMembers.filter(m => m.email && m.deliveryRoute === 'email').map(m => m.id)
		);
		const allIds = [
			...landscape.roleGroups.flatMap(g => g.members.map(m => m.id)),
			...(landscape.districtGroup?.members.map(m => m.id) || [])
		].filter(id => !contactedRecipients.has(id)).filter(id => writableIds.has(id));
		onBatchRegister(allIds);
	}
</script>

<div class="landscape space-y-5" class:revealed>
	{#if landscape.totalCount === 0}
		<!-- Empty state: contextual based on delivery method -->
		{#if isCwc && onVerifyAddress}
			<!-- CWC template without resolved district — find-your-reps affordance.
			     Heading stays non-possessive until a real district is resolved. -->
			<div class="py-4">
				<h2 class="font-mono text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
					{viewerIsConstituent ? 'Your representatives' : 'Representatives'}
				</h2>
				<p class="text-sm text-slate-500 leading-relaxed mb-4">
					{labels.legislativeBody} offices prioritize messages from their own constituents. Verify your address to see who represents you.
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
			<!-- Congressional template — guest. Non-possessive heading: a guest has no
			     resolved district, so these are not framed as "yours". The CTA routes
			     to login -> enter address, the same authenticated flow as any user. -->
			<div class="py-4">
				<h2 class="font-mono text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
					Representatives
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
		<!-- Batch action header — same "Write to" gesture as cards, collective scope -->
		<div class="flex items-center justify-between">
			{#if registrationState === 'registering'}
				<span class="flex items-center gap-1.5 text-sm font-medium text-slate-400 min-h-[44px]">
					<Loader2 class="h-4 w-4 animate-spin" />
					Opening mail&hellip;
				</span>
			{:else if emailRemainingCount > 0}
				<span class="flex items-center gap-3">
					<button
						type="button"
						class="group/batch flex items-center gap-1 text-sm font-medium text-participation-primary-600 hover:text-participation-primary-700 transition-colors cursor-pointer min-h-[44px]"
						onclick={handleBatchRegister}
					>
						Write to all {emailRemainingCount}
						<ChevronRight class="h-4 w-4 transition-transform group-hover/batch:translate-x-0.5" />
					</button>
					{#if unroutableRemaining > 0}
						<!-- Plain text, never a control: this batch cannot reach them. -->
						<span class="text-xs text-slate-400">
							{unroutableRemaining} more shown &middot; no email route
						</span>
					{/if}
				</span>
			{:else if remainingCount > 0}
				<!-- Everyone here is listed and counted; none of them has a mailbox this
				     control can open. Say the measured thing rather than render a 0. -->
				<p role="status" class="text-sm text-slate-500 leading-relaxed">
					No email route for these {remainingCount}. They stay listed below, and this
					collective control sends nothing. Open a card to see what each one accepts.
				</p>
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

		<!-- The order names its own basis. Suppressed below two groups: with one group
		     nothing was ordered, and stating an ordering basis for a list of one is its
		     own small lie. -->
		{#if orgGroups().length > 1}
			<p class="text-xs text-slate-500">{ORG_ORDER_BASIS}</p>
		{/if}
		<!-- Org groups: institutional clusters in column-count flow.
		     Keyed on the raw grouping key, not the display label: two distinct keys
		     ('' and '   ') both render as UNRESOLVED_ORG_LABEL, and a duplicate each-key
		     throws in Svelte 5 and blanks the page for a stranger. -->
		<div class="landscape-columns">
			{#each orgGroups() as group, i (group.key)}
				<div
					class="role-group"
					class:revealed
					data-size={group.members.length === 1 ? 'solo' : group.members.length <= 2 ? 'small' : 'normal'}
					style="animation-delay: {i * 80}ms"
				>
					<RoleGroup
						{group}
						{contactedRecipients}
						{departingRecipients}
						{priorContactIds}
						{onWriteTo}
						{canReportBounce}
						{reportedBounces}
						{reportingBounce}
						{onReportBounce}
						showRoleBadge={true}
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
					{priorContactIds}
					{onWriteTo}
					{canReportBounce}
					{reportedBounces}
					{reportingBounce}
					{onReportBounce}
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
	/*
	 * CSS column-count flow: groups pack tightly into two balanced columns
	 * rather than locking into rigid grid rows. break-inside: avoid keeps
	 * each role group intact — the browser will never split a group's members
	 * across column boundaries.
	 *
	 * On mobile (< 768px) column-count: 1 is identical to a stacked list.
	 */
	.landscape-columns {
		column-count: 1;
		column-gap: 2rem;
	}
	@media (min-width: 768px) {
		.landscape-columns {
			column-count: 2;
		}
	}
	.role-group {
		/* Critical: prevents a group from splitting across columns */
		break-inside: avoid;
		/* Spacing between groups — acts as row-gap in normal flow */
		margin-bottom: 1.75rem;
		opacity: 0;
		transform: translateY(8px);
	}
	.role-group.revealed {
		animation: revealGroup 300ms ease-out forwards;
	}
	/*
	 * Solo and small groups get a tighter top margin so they read as
	 * intentional, precise entries — not gaps. The role header still anchors
	 * them; we're just reducing the visual weight of the surrounding void.
	 */
	.role-group[data-size='solo'],
	.role-group[data-size='small'] {
		margin-bottom: 1.25rem;
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
