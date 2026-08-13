<script lang="ts">
	/**
	 * RoleGroup — one cell in the power landscape.
	 *
	 * Header names the group (org or role). Entities stack below it.
	 * When showRoleBadge is true, each entity displays its role category
	 * as an inline annotation — linking people through functional power type.
	 */
	import DecisionMakerLandscapeCard from './DecisionMakerLandscapeCard.svelte';
	import DistrictOfficialCard from './DistrictOfficialCard.svelte';
	import type { RoleGroupData, LandscapeMember } from '$lib/utils/landscapeMerge';

	let {
		group,
		contactedRecipients = new Set(),
		departingRecipients = new Set(),
		priorContactIds = new Set(),
		onWriteTo,
		isDistrictGroup = false,
		showRoleBadge = false,
		canReportBounce = false,
		reportedBounces = new Set(),
		reportingBounce = null,
		onReportBounce
	}: {
		group: RoleGroupData | { label: string; members: LandscapeMember[] };
		contactedRecipients: Set<string>;
		departingRecipients: Set<string>;
		/** Prior self-reports — annotation only; never gates an action. */
		priorContactIds?: Set<string>;
		onWriteTo: (member: LandscapeMember) => void;
		isDistrictGroup?: boolean;
		showRoleBadge?: boolean;
		canReportBounce?: boolean;
		reportedBounces?: Set<string>;
		reportingBounce?: string | null;
		onReportBounce?: (email: string) => void;
	} = $props();

	const headerMargin = $derived(group.members.length === 1 ? 'mb-2' : 'mb-3');
</script>

<div>
	<h3 class="font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500 border-b border-slate-200 pb-1.5 {headerMargin}">
		{group.label}
		<span class="text-slate-300 tabular-nums ml-1">{group.members.length}</span>
	</h3>

	<div class="flex flex-col space-y-5">
		{#each group.members as member (member.id)}
			<!--
				District officials are deliberately NOT annotated with prior contact.
				They carry a cwc_code, so resolveDeliveryRoute gives them the 'cwc'
				route, which the page sends through TemplateModal — a different write
				path that records a synthetic mailto-confirmation row, not the
				per-recipient rows this annotation reads. An email-routed district
				official is a known, named residual: it renders here without the
				annotation rather than with a claim we cannot substantiate.
			-->
			{#if member.source === 'district' || isDistrictGroup}
				<DistrictOfficialCard
					{member}
					contacted={contactedRecipients.has(member.id)}
					departing={departingRecipients.has(member.id)}
					{onWriteTo}
					{showRoleBadge}
					{canReportBounce}
					reported={!!member.email && reportedBounces.has(member.email)}
					reporting={!!member.email && reportingBounce === member.email}
					{onReportBounce}
				/>
			{:else}
				<DecisionMakerLandscapeCard
					{member}
					contacted={contactedRecipients.has(member.id)}
					departing={departingRecipients.has(member.id)}
					priorContact={priorContactIds.has(member.id)}
					{onWriteTo}
					{showRoleBadge}
					{canReportBounce}
					reported={!!member.email && reportedBounces.has(member.email)}
					reporting={!!member.email && reportingBounce === member.email}
					{onReportBounce}
				/>
			{/if}
		{/each}
	</div>
</div>

<style>
	/* No component styles — layout is utility-class driven */
</style>
