<script lang="ts">
	let {
		userId: _userId,
		userEmail: _userEmail,
		templateSlug: _templateSlug,
		minimumTier: _minimumTier,
		userTrustTier: _userTrustTier,
		skipValueProp: _skipValueProp,
		oncomplete,
		oncancel
	}: {
		userId: string;
		userEmail?: string;
		templateSlug?: string;
		minimumTier?: number;
		userTrustTier?: number;
		skipValueProp?: boolean;
		oncomplete?: (data: unknown) => void;
		oncancel?: () => void;
	} = $props();
</script>

<div data-testid="identity-verification-flow-stub">
	<button type="button" data-testid="stub-mdl-complete" onclick={() => oncomplete?.({ verified: true, method: 'mdl', userId: _userId })}>
		Complete mDL
	</button>
	<button type="button" data-testid="stub-mdl-cancel" onclick={() => oncancel?.()}>
		Cancel
	</button>
</div>
