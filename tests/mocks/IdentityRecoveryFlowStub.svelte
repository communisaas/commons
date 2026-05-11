<script lang="ts">
	let {
		userId: _userId,
		userEmail: _userEmail,
		oncomplete,
		oncancel
	}: {
		userId: string;
		userEmail?: string;
		oncomplete?: (data: unknown) => void;
		oncancel?: () => void;
	} = $props();
</script>

<div data-testid="identity-recovery-flow-stub">
	<button type="button" data-testid="stub-recovery-complete" onclick={() => oncomplete?.({ verified: true, method: 'recovery', userId: _userId })}>
		Complete recovery
	</button>
	<button type="button" data-testid="stub-recovery-cancel" onclick={() => oncancel?.()}>
		Cancel
	</button>
</div>
