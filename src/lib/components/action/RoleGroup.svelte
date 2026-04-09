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
		onWriteTo,
		isDistrictGroup = false,
		showRoleBadge = false
	}: {
		group: RoleGroupData | { label: string; members: LandscapeMember[] };
		contactedRecipients: Set<string>;
		departingRecipients: Set<string>;
		onWriteTo: (member: LandscapeMember) => void;
		isDistrictGroup?: boolean;
		showRoleBadge?: boolean;
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
			{#if member.source === 'district' || isDistrictGroup}
				<DistrictOfficialCard
					{member}
					contacted={contactedRecipients.has(member.id)}
					departing={departingRecipients.has(member.id)}
					{onWriteTo}
					{showRoleBadge}
				/>
			{:else}
				<DecisionMakerLandscapeCard
					{member}
					contacted={contactedRecipients.has(member.id)}
					departing={departingRecipients.has(member.id)}
					{onWriteTo}
					{showRoleBadge}
				/>
			{/if}
		{/each}
	</div>
</div>

<style>
	/* No component styles — layout is utility-class driven */
</style>
