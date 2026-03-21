<script lang="ts">
	import ScorecardDashboard from '$lib/components/org/ScorecardDashboard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<ScorecardDashboard
	scorecards={data.scorecards}
	meta={data.meta}
	orgSlug={data.org.slug}
	orgName={data.org.name}
	isMember={data.isMember}
/>
