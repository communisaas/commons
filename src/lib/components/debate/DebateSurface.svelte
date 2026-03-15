<script lang="ts">
	/**
	 * Deliberation Surface — always visible, graduated affordance.
	 *
	 * Every template's framing can be challenged through structured, staked
	 * argument. This surface is visible at every trust tier — what changes
	 * is the available action, not the awareness.
	 */
	import ActiveDebatePanel from './ActiveDebatePanel.svelte';
	import { ShieldCheck } from '@lucide/svelte';
	import type { DebateData } from '$lib/stores/debateState.svelte';

	interface Props {
		debate: DebateData | null;
		userTrustTier?: number;
		userOpposed?: boolean;
		onInitiateDebate?: () => void;
		onParticipate?: () => void;
		onCoSign?: (argumentIndex: number) => void;
		onCommit?: (trade: {
			argumentIndex: number;
			direction: 'BUY' | 'SELL';
			stakeAmount: number;
			weightedAmount: string;
			noteCommitment: string;
			proof?: Uint8Array;
		}) => void;
		onAppeal?: () => void;
		onEscalate?: () => void;
		onVerifyIdentity?: () => void;
	}

	let {
		debate,
		userTrustTier = 0,
		userOpposed = false,
		onInitiateDebate,
		onParticipate,
		onCoSign,
		onCommit,
		onAppeal,
		onEscalate,
		onVerifyIdentity
	}: Props = $props();

	const canInitiate = $derived(userTrustTier >= 3 && debate === null);
</script>

<div class="space-y-4" data-debate-surface>
	<h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">
		Public deliberation
	</h2>

	{#if debate}
		<ActiveDebatePanel
			{debate}
			{userTrustTier}
			{onParticipate}
			{onCoSign}
			{onCommit}
			{onAppeal}
			{onEscalate}
			{onVerifyIdentity}
		/>
	{:else if canInitiate}
		<div class="space-y-3">
			{#if userOpposed}
				<p class="text-sm text-slate-600 leading-relaxed">
					You've registered your opposition. Now make it count — open a public
					deliberation and stake your credibility on a counter-argument.
				</p>
				<button
					class="inline-flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-100 transition-colors"
					onclick={onInitiateDebate}
				>
					<ShieldCheck class="h-4 w-4" />
					Open a deliberation
				</button>
			{:else}
				<p class="text-sm text-slate-600 leading-relaxed">
					Disagree with this framing? Open a deliberation — stake your credibility
					on a counter-argument.
				</p>
				<button
					class="text-sm font-medium text-participation-primary-600 hover:text-participation-primary-700 transition-colors"
					onclick={onInitiateDebate}
				>
					Challenge this framing
				</button>
			{/if}
		</div>
	{:else}
		<div class="space-y-2">
			{#if userOpposed}
				<p class="text-sm text-slate-600">
					Your opposition is recorded. No one has opened a deliberation on this framing yet.
				</p>
			{:else}
				<p class="text-sm text-slate-500">
					No one has challenged this framing yet.
				</p>
			{/if}
			{#if userTrustTier < 3 && onVerifyIdentity}
				<button
					class="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500
						hover:text-slate-700 transition-colors"
					onclick={onVerifyIdentity}
				>
					<ShieldCheck class="h-3.5 w-3.5" />
					{userOpposed ? 'Verify your identity to open a deliberation' : 'Verify to participate in deliberations'}
				</button>
			{/if}
		</div>
	{/if}
</div>
