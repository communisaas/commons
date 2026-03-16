<script lang="ts">
	import { Brain, Gavel, ShieldAlert, CheckCircle, Clock } from '@lucide/svelte';

	type ResolutionPhase = 'resolving' | 'resolved' | 'awaiting_governance' | 'under_appeal';

	interface Props {
		phase: ResolutionPhase;
		resolutionMethod?: 'ai_community' | 'governance_override' | 'community_only';
		appealDeadline?: string;
		compact?: boolean;
		source?: 'ai_panel' | string;
		minerCount?: number;
	}

	let { phase, resolutionMethod, appealDeadline, compact = false, source, minerCount }: Props = $props();

	const PHASE_CONFIG: Record<
		ResolutionPhase,
		{ icon: typeof Brain; label: string; badge: string; description: string }
	> = {
		resolving: {
			icon: Brain,
			label: 'AI EVALUATION',
			badge: 'bg-violet-100 text-violet-700 ring-violet-600/20',
			description: 'Models scored. Awaiting resolution.'
		},
		resolved: {
			icon: CheckCircle,
			label: 'RESOLVED',
			badge: 'bg-emerald-100 text-emerald-700 ring-emerald-600/20',
			description: 'Final scores computed.'
		},
		awaiting_governance: {
			icon: Gavel,
			label: 'GOVERNANCE REVIEW',
			badge: 'bg-amber-100 text-amber-700 ring-amber-600/20',
			description: 'AI consensus insufficient. Governance decides.'
		},
		under_appeal: {
			icon: ShieldAlert,
			label: 'UNDER APPEAL',
			badge: 'bg-red-100 text-red-700 ring-red-600/20',
			description: 'Resolution contested.'
		}
	};

	const config = $derived(PHASE_CONFIG[phase]);

	const methodLabel = $derived.by(() => {
		if (!resolutionMethod) return '';
		const labels: Record<string, string> = {
			ai_community: 'AI + Participants',
			governance_override: 'Governance Override',
			community_only: 'Participants Only'
		};
		return labels[resolutionMethod] ?? '';
	});

	// Appeal countdown
	const appealTimeRemaining = $derived.by(() => {
		if (!appealDeadline || phase !== 'under_appeal') return null;
		const now = Date.now();
		const end = new Date(appealDeadline).getTime();
		const diff = end - now;
		if (diff <= 0) return 'Appeal window closed';
		const days = Math.floor(diff / (1000 * 60 * 60 * 24));
		const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
		if (days > 0) return `${days}d ${hours}h to appeal`;
		return `${hours}h to appeal`;
	});
</script>

<div
	class="inline-flex items-center {compact ? 'gap-2' : 'gap-3'}"
	role="status"
	aria-label="{config.label}"
>
	<span
		class="inline-flex items-center gap-1.5 rounded-full ring-1 ring-inset font-medium
			{config.badge}
			{compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'}"
	>
		<svelte:component
			this={config.icon}
			size={compact ? 12 : 14}
			class="{phase === 'resolving' ? 'animate-pulse' : ''}"
			strokeWidth={2.5}
		/>
		{config.label}
	</span>

	{#if methodLabel && phase === 'resolved'}
		<span class="text-xs font-medium text-slate-500">
			via {methodLabel}
		</span>
	{/if}

	{#if appealTimeRemaining}
		<span class="inline-flex items-center gap-1 text-xs font-medium text-red-600">
			<Clock size={12} />
			{appealTimeRemaining}
		</span>
	{/if}

	{#if !compact}
		<span class="text-xs text-slate-500">
			{config.description}
		</span>
	{/if}
</div>
