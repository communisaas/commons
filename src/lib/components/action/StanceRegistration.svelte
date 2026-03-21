<script lang="ts">
	import { Check, Loader2, ArrowRight, Swords } from '@lucide/svelte';
	import { positionState } from '$lib/stores/positionState.svelte';
	import PositionCount from './PositionCount.svelte';

	let {
		templateId,
		onRegistered = undefined,
		recipientCount = 0,
		isCongressional = false,
		debateExists = false,
		canInitiateDebate = false,
		onChallenge = undefined,
		onVerifyForChallenge = undefined
	}: {
		templateId: string;
		onRegistered?: (stance: 'support' | 'oppose') => void;
		recipientCount?: number;
		isCongressional?: boolean;
		debateExists?: boolean;
		canInitiateDebate?: boolean;
		onChallenge?: () => void;
		onVerifyForChallenge?: () => void;
	} = $props();

	const recipientLabel = $derived(
		recipientCount > 0
			? isCongressional
				? `${recipientCount} representative${recipientCount !== 1 ? 's' : ''}`
				: `${recipientCount} decision-maker${recipientCount !== 1 ? 's' : ''}`
			: isCongressional
				? 'your congressional representatives'
				: 'decision-makers'
	);

	async function handleRegister(selectedStance: 'support' | 'oppose') {
		if (positionState.registrationState !== 'idle') return;

		// Minimum 200ms delay so the registering state feels intentional
		const [success] = await Promise.all([
			positionState.register(selectedStance),
			new Promise((resolve) => setTimeout(resolve, 200))
		]);

		if (success) {
			onRegistered?.(selectedStance);
		}
	}
</script>

<div>
	{#if positionState.isRegistered}
		<!-- Registered state -->
		<div role="status" aria-live="polite">
			{#if positionState.stance === 'support'}
				<!-- Support: simple confirmation -->
				<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
					<Check class="h-4 w-4 text-channel-verified-600" />
					<span class="text-sm font-medium text-channel-verified-600">You support this</span>
					{#if positionState.totalCount > 0}
						<span class="text-slate-300">&middot;</span>
						<PositionCount count={positionState.count} />
					{/if}
				</div>
			{:else}
				<!-- Oppose: opposition is a challenge — route into deliberation -->
				<div class="space-y-3">
					<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
						<Check class="h-4 w-4 text-red-500" />
						<span class="text-sm font-medium text-red-600">You oppose this</span>
						{#if positionState.totalCount > 0}
							<span class="text-slate-300">&middot;</span>
							<PositionCount count={positionState.count} />
						{/if}
					</div>
					{#if debateExists && onChallenge}
						<button
							class="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700 transition-colors"
							onclick={onChallenge}
						>
							<Swords class="h-3.5 w-3.5" />
							Join the deliberation
						</button>
					{:else if canInitiateDebate && onChallenge}
						<button
							class="inline-flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-100 transition-colors"
							onclick={onChallenge}
						>
							<Swords class="h-4 w-4" />
							Challenge this framing — open a deliberation
						</button>
					{:else if onVerifyForChallenge}
						<button
							class="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
							onclick={onVerifyForChallenge}
						>
							<Swords class="h-3.5 w-3.5" />
							Verify your identity to challenge this framing
						</button>
					{/if}
				</div>
			{/if}
		</div>
	{:else}
		<!-- Pre-registration: framing context + stance buttons -->
		<div class="space-y-3">
			<p class="flex items-center gap-1.5 text-sm text-slate-600">
				<span>Contact {recipientLabel}</span>
				<ArrowRight class="h-3.5 w-3.5 text-slate-400" />
				<span class="text-slate-500">first, where do you stand?</span>
			</p>
			<div class="flex flex-wrap items-center gap-3">
				<button
					class="flex min-h-[44px] flex-1 items-center justify-center rounded-lg bg-participation-primary-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-participation-primary-700 disabled:opacity-50 sm:flex-none"
					disabled={positionState.registrationState === 'registering'}
					onclick={() => handleRegister('support')}
				>
					{#if positionState.registrationState === 'registering' && positionState.stance === 'support'}
						<Loader2 class="h-4 w-4 animate-spin" />
					{:else}
						I support this
					{/if}
				</button>

				<button
					class="flex min-h-[44px] flex-1 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 sm:flex-none"
					disabled={positionState.registrationState === 'registering'}
					onclick={() => handleRegister('oppose')}
				>
					{#if positionState.registrationState === 'registering' && positionState.stance === 'oppose'}
						<Loader2 class="h-4 w-4 animate-spin" />
					{:else}
						I oppose this
					{/if}
				</button>

				{#if positionState.totalCount > 0}
					<PositionCount count={positionState.count} />
				{/if}
			</div>
		</div>
	{/if}
</div>
