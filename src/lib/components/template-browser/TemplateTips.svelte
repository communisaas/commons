<script lang="ts">
	import { Info } from '@lucide/svelte';
	import { getJurisdictionLabels } from '$lib/core/locale/jurisdiction';
	interface Props {
		isCertified?: boolean;
	}

	const { isCertified = false }: Props = $props();

	const labels = getJurisdictionLabels();
</script>

{#if isCertified}
	<div
		class="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800"
		role="status"
		aria-live="polite"
	>
		<div class="flex items-center gap-2">
			<Info class="h-4 w-4 text-blue-500" aria-hidden="true" />
			<span>Address verification required for {labels.legislativeBody} delivery</span>
		</div>
	</div>
{/if}
