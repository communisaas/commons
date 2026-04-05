<script lang="ts">
	/**
	 * RoleGroup — spatial rhythm for entity clusters.
	 *
	 * No dividers. No borders. Figure-ground through proximity ratio:
	 * - Header tight to children (mb-4) — gravitational binding
	 * - Entities separated by generous void (space-y-10 = 40px)
	 * - The void IS the boundary
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
	<!-- Header: metadata voice, gravitationally bound to first entity -->
	<h3 class="font-mono text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">
		{group.label}
	</h3>

	<!-- Entities: tight clusters separated by composed silence -->
	<div class="flex flex-col space-y-10">
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
