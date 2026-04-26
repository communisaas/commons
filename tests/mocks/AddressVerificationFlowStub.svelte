<script module lang="ts">
	export type RegroundingPhase = 'capture' | 'witnessing' | 'complete';
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	let {
		onCancel,
		onRegroundingPhaseChange
	}: {
		onCancel?: () => void;
		onRegroundingPhaseChange?: (phase: RegroundingPhase) => void;
	} = $props();

	onMount(() => {
		onRegroundingPhaseChange?.('capture');
	});
</script>

<div data-testid="address-verification-flow-stub">
	<button
		type="button"
		data-testid="stub-phase-witnessing"
		onclick={() => onRegroundingPhaseChange?.('witnessing')}
	>
		Witnessing
	</button>
	<button
		type="button"
		data-testid="stub-phase-complete"
		onclick={() => onRegroundingPhaseChange?.('complete')}
	>
		Complete
	</button>
	<button type="button" data-testid="stub-cancel" onclick={() => onCancel?.()}>
		Cancel
	</button>
</div>
