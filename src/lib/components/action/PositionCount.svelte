<script lang="ts">
	import { Datum } from '$lib/design';

	let {
		count = { support: 0, oppose: 0, districts: 0 }
	}: {
		count: { support: number; oppose: number; districts: number };
	} = $props();

	const total = $derived(count.support + count.oppose);
</script>

{#if total > 0}
	<p class="text-sm text-slate-500" role="status" aria-live="polite" aria-label="{total} positions registered{count.districts > 0 ? `, ${count.districts} districts` : ''}">
		<Datum value={total} animate class="text-slate-700" />
		verified positions{#if count.districts > 0}<span class="mx-1.5">&middot;</span><Datum
				value={count.districts}
				animate
				class="text-slate-700"
			/>
			districts{/if}
	</p>
{/if}
