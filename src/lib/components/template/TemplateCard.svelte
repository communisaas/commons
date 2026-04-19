<script lang="ts">
	import { Send, Users, MapPin, ChevronRight, Building2, Landmark, Mail } from '@lucide/svelte';
	import type { Template } from '$lib/types/template';
	import { deriveTargetPresentation } from '$lib/utils/deriveTargetPresentation';
	import { topicHue } from '$lib/utils/topic-hue';
	import SimpleTooltip from '$lib/components/ui/SimpleTooltip.svelte';
	import { FEATURES } from '$lib/config/features';

	interface Props {
		template: Template;
		variant?: 'grid' | 'list';
		onSelect?: () => void;
	}

	const { template, variant = 'grid', onSelect }: Props = $props();

	// Derive perceptual representation
	const targetInfo = $derived(deriveTargetPresentation(template));

	const isCongressional = $derived(targetInfo.type === 'district-based');

	function formatNumber(num: number | undefined | null): string {
		if (num === undefined || num === null || isNaN(num)) return '0';
		return num.toLocaleString();
	}

	let hoveredMetric = $state<'sent' | 'districts' | null>(null);

	const verifiedSends = $derived(template.send_count || 0);
	const uniqueDistricts = $derived(template.unique_districts || 0);
	const hasEngagement = $derived(verifiedSends > 0 || uniqueDistricts > 0);
	const isHighActivity = $derived(verifiedSends > 100);

	// === PERCEPTUAL ENCODING: Visual weight based on coordination magnitude ===
	// Subtle scale transformation: 1.0 (baseline) to 1.15 (high coordination)
	// Logarithmic encoding makes peripheral detection possible before reading text
	const cardScale = $derived(1.0 + template.coordinationScale * 0.15);

	// === TOPIC COLOR: Per-template atmospheric hue from content domain ===
	const hue = $derived(topicHue(template.domain, template.topics, template.domainHue));
</script>

<button
	type="button"
	class="card-topic group relative flex w-full flex-col overflow-hidden rounded-md text-left transition-colors duration-200 motion-reduce:transition-none {isCongressional
		? 'card-weight-heavy'
		: 'card-weight-light'}"
	style="--card-hue: {hue}; transform: scale({cardScale}); transform-origin: center; will-change: transform; backface-visibility: hidden;"
	onclick={onSelect}
	data-testid="template-card-{template.id}"
>
	<!-- New Badge: Temporal signal (top-right corner) -->
	{#if template.isNew}
		<span
			class="absolute right-3 top-3 z-10 rounded bg-cyan-500 px-2 py-1 font-brand text-[0.6875rem] font-bold uppercase tracking-wide text-white"
		>
			New
		</span>
	{/if}

	<!-- Header Section -->
	<div class="flex flex-col p-4 {isCongressional ? 'gap-2 pb-0' : 'gap-3'}">
		{#if targetInfo.type === 'multi-level'}
			<!-- Multi-Level: Two jurisdiction lines stacked -->
			{#each targetInfo.targets as target, i}
				<div class="flex items-center gap-2" class:mt-0.5={i > 0}>
					{#if target.emphasis === 'federal'}
						<Landmark class="h-4 w-4 shrink-0 card-icon" />
						<span class="font-brand text-sm font-semibold card-label">{target.primary}</span>
					{:else}
						<Building2 class="h-4 w-4 shrink-0 card-icon" />
						<span class="font-brand text-sm font-semibold card-label">{target.primary}</span>
					{/if}
					{#if target.secondary}
						<span class="font-brand text-xs text-slate-400">{target.secondary}</span>
					{/if}
				</div>
			{/each}
			<div class="card-rule" aria-hidden="true"></div>
		{:else if isCongressional}
			<!-- Congressional: Icon + human label, rule below -->
			<div class="flex items-center gap-2">
				<Landmark class="h-4 w-4 shrink-0 card-icon" />
				<span class="font-brand text-sm font-semibold card-label">{targetInfo.primary}</span>
			</div>
			<div class="card-rule" aria-hidden="true"></div>
		{:else}
			<!-- Direct/Universal: Name-forward -->
			<div class="flex items-center gap-2">
				{#if targetInfo.icon === 'Building'}
					<Building2 class="h-4 w-4 shrink-0 card-icon" />
				{:else if targetInfo.icon === 'Mail'}
					<Mail class="h-4 w-4 shrink-0 card-icon-muted" />
				{:else}
					<Users class="h-4 w-4 shrink-0 card-icon-muted" />
				{/if}
				<span class="font-brand text-sm font-semibold card-label">{targetInfo.primary}</span>
				{#if targetInfo.secondary}
					<span class="font-brand text-sm card-label-muted">{targetInfo.secondary}</span>
				{/if}
			</div>
		{/if}

		<!-- Title: Satoshi Bold — brand voice -->
		<h3
			class="font-brand font-bold text-gray-900 group-hover:text-gray-700 {isCongressional ? 'text-lg md:text-xl' : 'text-base md:text-lg'}"
		>
			{template.title}
		</h3>

		<!-- Description: spacing tracks card density -->
		<p class="line-clamp-3 font-brand text-sm text-gray-600 {isCongressional ? '' : 'md:text-base'}">
			{template.description}
		</p>

		<!-- Org Provenance: Creator org + coalition endorsements -->
		{#if template.endorsingOrg || (template.endorsingOrgs && template.endorsingOrgs.length > 0)}
			<div class="org-provenance">
				{#if template.endorsingOrg}
					{#if template.endorsingOrg.avatar}
						<img src={template.endorsingOrg.avatar} alt="" class="org-provenance-avatar" />
					{:else}
						<span class="org-provenance-initial">{template.endorsingOrg.name.charAt(0).toUpperCase()}</span>
					{/if}
				{/if}
				{#if template.endorsingOrgs && template.endorsingOrgs.length > 0}
					{#each template.endorsingOrgs.slice(0, 3) as endorser}
						{#if endorser.avatar}
							<img src={endorser.avatar} alt="" class="org-provenance-avatar org-provenance-avatar--endorser" />
						{:else}
							<span class="org-provenance-initial org-provenance-initial--endorser">{endorser.name.charAt(0).toUpperCase()}</span>
						{/if}
					{/each}
					{#if template.endorsingOrgs.length > 3}
						<span class="org-provenance-overflow">+{template.endorsingOrgs.length - 3}</span>
					{/if}
				{/if}
				<span class="org-provenance-name">
					{#if template.endorsingOrg && template.endorsingOrgs && template.endorsingOrgs.length > 0}
						{template.endorsingOrg.name} + {template.endorsingOrgs.length}
					{:else if template.endorsingOrg}
						{template.endorsingOrg.name}
					{:else if template.endorsingOrgs && template.endorsingOrgs.length === 1}
						{template.endorsingOrgs[0].name}
					{:else if template.endorsingOrgs}
						{template.endorsingOrgs.length} orgs
					{/if}
				</span>
			</div>
		{/if}

		<!-- Domain Postmark: confirms civic space after content has spoken -->
		{#if template.domain}
			<span class="domain-postmark mt-auto">{template.domain}</span>
		{/if}
	</div>

	<!-- Footer Section: Action arrow always visible, metrics only when meaningful -->
	<div
		class="border-t border-slate-100/50 p-4"
	>
		{#if FEATURES.DEBATE && template.debateSummary}
			{@const ds = template.debateSummary}
			<div class="mb-2 flex items-center gap-2 text-sm">
				{#if ds.status === 'resolved'}
					{#if ds.winningStance === 'SUPPORT'}
						<span class="inline-flex items-center gap-1.5">
							<span class="font-mono text-xs text-emerald-700">Peer-reviewed</span>
							<span class="text-xs text-emerald-600/70">&middot; {ds.uniqueParticipants}</span>
						</span>
					{:else if ds.winningStance === 'OPPOSE'}
						<span class="inline-flex items-center gap-1.5">
							<span class="font-mono text-xs text-slate-700">Debated</span>
							<span class="text-xs text-slate-600/70">&middot; {ds.uniqueParticipants}</span>
						</span>
					{:else if ds.winningStance === 'AMEND'}
						<span class="inline-flex items-center gap-1.5">
							<span class="font-mono text-xs text-amber-700">Amended</span>
							<span class="text-xs text-amber-600/70">&middot; {ds.uniqueParticipants}</span>
						</span>
					{/if}
				{:else if ds.status === 'active'}
					<span class="debate-pulse h-2 w-2 shrink-0 rounded-full bg-amber-500"></span>
					<span class="font-brand text-amber-600">{ds.uniqueParticipants} debating</span>
				{:else}
					<span class="font-brand text-slate-500">Resolving...</span>
				{/if}
			</div>
		{:else if FEATURES.DEBATE && template.hasActiveDebate}
			<div class="mb-2 flex items-center gap-2 text-sm">
				<span class="debate-pulse h-2 w-2 shrink-0 rounded-full bg-amber-500"></span>
				<span class="font-brand text-amber-600">Deliberating</span>
			</div>
		{/if}
		<div class="flex items-center justify-between gap-4">
			{#if hasEngagement}
				<!-- Metrics Section: Only show when there's real engagement (post-launch) -->
				<!-- Verified Sends Metric: JetBrains Mono with gradient for high activity -->
				<div class="relative flex items-center gap-2 text-sm text-slate-600">
					<Users
						class="h-4 w-4 shrink-0 {isHighActivity ? 'text-teal-500' : 'text-slate-500'}"
						aria-hidden="true"
					/>
					<span
						class="font-mono font-medium tabular-nums"
						class:bg-gradient-to-br={isHighActivity}
						class:from-teal-600={isHighActivity}
						class:to-emerald-600={isHighActivity}
						class:bg-clip-text={isHighActivity}
						class:text-transparent={isHighActivity}
					>
						{formatNumber(verifiedSends)}
					</span>
					<span class="font-brand text-slate-500">sent</span>
					{#if targetInfo.coordinationContext}
						<span class="font-brand text-xs text-slate-400"
							>in {targetInfo.coordinationContext}</span
						>
					{/if}
				</div>

				{#if isCongressional && uniqueDistricts > 0}
					<!-- Congressional: Districts Covered Metric -->
					<div class="relative flex items-center gap-2 text-sm text-slate-600">
						<MapPin class="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
						<span class="font-mono font-medium tabular-nums">{formatNumber(uniqueDistricts)}</span>
						<span class="font-brand text-slate-500">districts</span>
						<span
							class="cursor-help text-slate-400 hover:text-slate-600"
							onmouseenter={() => (hoveredMetric = 'districts')}
							onmouseleave={() => (hoveredMetric = null)}
							role="tooltip"
							aria-label="District coverage information"
						>
							<svg
								class="h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
								></path>
							</svg>
						</span>

						<SimpleTooltip
							content="{uniqueDistricts > 0 ? Math.round((uniqueDistricts / 435) * 100) + '%' : '0%'} of congressional districts reached"
							placement="top"
							show={hoveredMetric === 'districts'}
						/>
					</div>
				{:else if hasEngagement}
					<!-- Direct Email: Voices count -->
					<div class="flex items-center gap-2 text-sm text-slate-600">
						<Users class="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
						<span class="font-mono font-medium tabular-nums">{formatNumber(verifiedSends)}</span>
						<span class="font-brand text-slate-500">voices</span>
					</div>
				{/if}
			{:else}
				<!-- Pre-launch: Spacer to maintain layout balance with action arrow -->
				<div class="flex-1"></div>
			{/if}

			<!-- Action Arrow: Always visible -->
			<ChevronRight
				class="h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-slate-600"
				aria-hidden="true"
			/>
		</div>
	</div>
</button>

<style>
	.debate-pulse {
		animation: debate-pulse 1.4s ease-in-out infinite;
	}

	@keyframes debate-pulse {
		0%,
		100% {
			opacity: 0.5;
		}
		50% {
			opacity: 1;
		}
	}

	/*
	 * Org Provenance — the chromatic bridge on the card.
	 *
	 * Teal accent connects three surfaces:
	 *   card endorsement → identity dropdown → org dashboard
	 * Same hue family (oklch hue 180), lower intensity here = atmospheric.
	 * Felt as "institutional backing" before consciously parsed.
	 */
	.org-provenance {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.25rem;
	}

	.org-provenance-avatar {
		width: 1rem;
		height: 1rem;
		border-radius: 3px;
		object-fit: cover;
		flex-shrink: 0;
	}

	.org-provenance-initial {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
		border-radius: 3px;
		flex-shrink: 0;
		/* Teal chromatic preview — same family as dropdown bridge */
		background: oklch(0.92 0.06 180);
		color: oklch(0.4 0.12 180);
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.5625rem;
		font-weight: 700;
	}

	/* Endorser avatars/initials overlap slightly for coalition density */
	.org-provenance-avatar--endorser,
	.org-provenance-initial--endorser {
		margin-left: -0.25rem;
		border: 1.5px solid white;
	}

	.org-provenance-overflow {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
		border-radius: 3px;
		margin-left: -0.25rem;
		border: 1.5px solid white;
		background: oklch(0.88 0.04 180);
		color: oklch(0.4 0.08 180);
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.5rem;
		font-weight: 700;
		flex-shrink: 0;
	}

	/*
	 * Domain Postmark — low-weight contextual confirmation.
	 *
	 * Encountered at the end of the downward scan, after title and description.
	 * Participates in the card's atmospheric hue at very low chroma (0.04),
	 * so it tints without competing for focal attention.
	 */
	.domain-postmark {
		display: block;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.6875rem;
		font-weight: 400;
		letter-spacing: 0.01em;
		line-height: 1.3;
		margin-top: 0.375rem;
		color: oklch(0.58 0.04 var(--card-hue));
		/* Prevent long domain names from becoming a second description */
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 1;
		-webkit-box-orient: vertical;
	}

	.org-provenance-name {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		font-weight: 500;
		color: oklch(0.48 0.06 180);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
