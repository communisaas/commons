<script lang="ts">
	import type { RoleGroupData, LandscapeMember } from '$lib/utils/landscapeMerge';

	const SHORT_LABELS: Record<string, string> = {
		'VOTE ON IT': 'VOTE',
		'EXECUTE IT': 'EXEC',
		'FUND IT': 'FUND',
		'SHAPE IT': 'SHAPE',
		'OVERSEE IT': 'WATCH'
	};

	let {
		roleGroups = [],
		districtGroup = null,
		contactedRecipients = new Set()
	}: {
		roleGroups: RoleGroupData[];
		districtGroup: { label: string; members: LandscapeMember[] } | null;
		contactedRecipients: Set<string>;
	} = $props();

	// Flatten all members for total counts
	const allMembers = $derived([
		...roleGroups.flatMap(g => g.members),
		...(districtGroup?.members ?? [])
	]);
	const totalCount = $derived(allMembers.length);
	const contactedCount = $derived(
		allMembers.filter(m => contactedRecipients.has(m.id)).length
	);

	// Per-group stats for dot display
	const groupStats = $derived(
		roleGroups.map(g => ({
			label: SHORT_LABELS[g.label] ?? g.label,
			members: g.members,
			contacted: g.members.filter(m => contactedRecipients.has(m.id)).length,
			total: g.members.length
		}))
	);
	const districtStats = $derived(
		districtGroup ? {
			label: 'REPS',
			members: districtGroup.members,
			contacted: districtGroup.members.filter(m => contactedRecipients.has(m.id)).length,
			total: districtGroup.members.length
		} : null
	);
</script>

{#if totalCount > 0}
	<div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400" role="status" aria-label="{contactedCount} of {totalCount} emails started">
		<!-- Per-category dots -->
		{#each groupStats as group}
			<div class="flex items-center gap-1.5">
				<span class="font-medium tracking-wide">{group.label}</span>
				<div class="flex gap-1">
					{#each group.members as member}
						<span
							class="spine-dot h-2 w-2 rounded-full transition-colors duration-300 ease-out
								{contactedRecipients.has(member.id) ? 'bg-participation-primary-500' : 'bg-slate-200'}"
							aria-hidden="true"
						></span>
					{/each}
				</div>
			</div>
		{/each}

		{#if districtStats}
			<div class="flex items-center gap-1.5">
				<span class="font-medium tracking-wide">{districtStats.label}</span>
				<div class="flex gap-1">
					{#each districtStats.members as member}
						<span
							class="spine-dot h-2 w-2 rounded-full transition-colors duration-300 ease-out
								{contactedRecipients.has(member.id) ? 'bg-participation-primary-500' : 'bg-slate-200'}"
							aria-hidden="true"
						></span>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Summary count -->
		<span class="ml-auto tabular-nums {contactedCount === totalCount ? 'text-participation-primary-600 font-medium' : ''}">
			{contactedCount} of {totalCount}
		</span>
	</div>
{/if}

<style>
	/* Dot fill animation — scale pulse on transition from empty to filled */
	.spine-dot {
		transition: background-color 300ms ease-out, transform 200ms ease-out;
	}
	:global(.spine-dot[class*="bg-participation-primary"]) {
		animation: dotFill 300ms ease-out;
	}
	@keyframes dotFill {
		0% { transform: scale(1); }
		50% { transform: scale(1.4); }
		100% { transform: scale(1); }
	}
	@media (prefers-reduced-motion: reduce) {
		.spine-dot { transition: none; }
		:global(.spine-dot[class*="bg-participation-primary"]) { animation: none; }
	}
</style>
