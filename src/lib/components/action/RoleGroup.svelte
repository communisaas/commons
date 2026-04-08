<script lang="ts">
	/**
	 * RoleGroup — one cell in the power landscape grid.
	 *
	 * Header names the group. Entities stack below it.
	 * The grid row boundary between groups IS the figure-ground
	 * separation — no rules, no cards needed.
	 */
	import DecisionMakerLandscapeCard from './DecisionMakerLandscapeCard.svelte';
	import DistrictOfficialCard from './DistrictOfficialCard.svelte';
	import type { RoleGroupData, LandscapeMember } from '$lib/utils/landscapeMerge';

	let {
		group,
		contactedRecipients = new Set(),
		departingRecipients = new Set(),
		onWriteTo,
		isDistrictGroup = false
	}: {
		group: RoleGroupData | { label: string; members: LandscapeMember[] };
		contactedRecipients: Set<string>;
		departingRecipients: Set<string>;
		onWriteTo: (member: LandscapeMember) => void;
		isDistrictGroup?: boolean;
	} = $props();
</script>

<div>
	<h3 class="font-mono text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">
		{group.label}
	</h3>

	<div class="flex flex-col space-y-8">
		{#each group.members as member (member.id)}
			{#if member.source === 'district' || isDistrictGroup}
				<DistrictOfficialCard
					{member}
					contacted={contactedRecipients.has(member.id)}
					departing={departingRecipients.has(member.id)}
					{onWriteTo}
				/>
			{:else}
				<DecisionMakerLandscapeCard
					{member}
					contacted={contactedRecipients.has(member.id)}
					departing={departingRecipients.has(member.id)}
					{onWriteTo}
				/>
			{/if}
		{/each}
	</div>
</div>

<style>
	/* No component styles — layout is utility-class driven */
</style>
