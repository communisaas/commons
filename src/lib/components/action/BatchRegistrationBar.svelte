<script lang="ts">
	import { Mail, Loader2 } from '@lucide/svelte';

	let {
		emailRemainingCount,
		registrationState = 'idle',
		onBatchRegister
	}: {
		emailRemainingCount: number;
		registrationState: 'idle' | 'registering' | 'complete';
		onBatchRegister: () => void;
	} = $props();
</script>

<div
	class="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white p-4 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] md:hidden"
>
	{#if registrationState === 'complete'}
		<!-- Completed state -->
		<div class="flex min-h-[44px] items-center justify-center gap-2 py-2">
			<Mail class="h-5 w-5 text-slate-500" />
			<span class="text-sm font-medium text-slate-500">
				All emails started
			</span>
		</div>
	{:else}
		<!-- Idle or registering -->
		<button
			class="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-lg bg-channel-verified-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-channel-verified-700 disabled:opacity-50"
			disabled={registrationState === 'registering' || emailRemainingCount === 0}
			onclick={onBatchRegister}
		>
			{#if registrationState === 'registering'}
				<Loader2 class="h-4 w-4 animate-spin" />
				Opening mail&hellip;
			{:else}
				Write to all {emailRemainingCount}
			{/if}
		</button>
	{/if}
</div>
