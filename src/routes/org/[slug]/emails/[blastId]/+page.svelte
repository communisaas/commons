<script lang="ts">
	import { FEATURES } from '$lib/config/features';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function pct(num: number, denom: number): string {
		if (denom === 0) return '0.0%';
		return (num / denom * 100).toFixed(1) + '%';
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '--';
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short', day: 'numeric', year: 'numeric',
			hour: 'numeric', minute: '2-digit'
		});
	}

	const metricLabels: Record<string, string> = {
		open: 'Open Rate',
		click: 'Click Rate',
		verified_action: 'Verified Action Rate'
	};

	function bounceRate(bounced: number, sent: number): number {
		if (sent === 0) return 0;
		return (bounced / sent) * 100;
	}

	function bounceRateColor(rate: number): string {
		if (rate < 2) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
		if (rate <= 5) return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
		return 'bg-red-500/15 text-red-400 border-red-500/20';
	}

	// Compute total bounced/sent across all relevant blasts
	const totalBounced = $derived(
		data.isAbTest
			? data.variants.reduce((sum, v) => sum + (v?.totalBounced ?? 0), 0)
			: data.blast.totalBounced
	);
	const totalSent = $derived(
		data.isAbTest
			? data.variants.reduce((sum, v) => sum + (v?.totalSent ?? 0), 0)
			: data.blast.totalSent
	);
	const rate = $derived(bounceRate(totalBounced, totalSent));

	function isWinner(variant: typeof data.variants[0]): boolean {
		if (!data.isAbTest || data.variants.length < 2) return false;
		const a = data.variants[0];
		const b = data.variants[1];
		if (!a || !b) return false;
		const metric = data.abConfig?.winnerMetric ?? 'open';
		const scoreA = getScore(a, metric);
		const scoreB = getScore(b, metric);
		if (variant?.abVariant === 'A') return scoreA >= scoreB;
		return scoreB > scoreA;
	}

	function getScore(v: typeof data.variants[0], metric: string): number {
		if (!v) return 0;
		const sent = v.totalSent || 1;
		if (metric === 'click') return v.totalClicked / sent;
		return v.totalOpened / sent;
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-center gap-4">
		<a
			href="/org/{data.org.slug}/emails"
			class="text-text-tertiary hover:text-text-secondary transition-colors"
			aria-label="Back to emails"
		>
			<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
			</svg>
		</a>
		<div class="flex items-center gap-3">
			<div>
				<h1 class="text-xl font-semibold text-text-primary">
					{#if data.isAbTest}A/B Test Results{:else}Email Details{/if}
				</h1>
				<p class="text-sm text-text-tertiary mt-1">
					{data.blast.subject}
				</p>
			</div>
			{#if FEATURES.ENGAGEMENT_METRICS && totalSent > 0}
				<span class="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono {bounceRateColor(rate)}">
					{rate.toFixed(1)}% bounced
				</span>
			{/if}
		</div>
	</div>

	{#if data.isAbTest && data.variants.length >= 2}
		{@const config = data.abConfig}

		<!-- Config summary -->
		<div class="rounded-lg border border-surface-border bg-surface-base px-4 py-3 flex items-center gap-6 text-xs text-text-tertiary">
			<span>Winner by: <span class="text-text-secondary">{metricLabels[config?.winnerMetric ?? 'open']}</span></span>
			<span>Test group: <span class="text-text-secondary">{config?.testGroupPct ?? 20}%</span></span>
			<span>Split: <span class="text-text-secondary">{config?.splitPct ?? 50}/{100 - (config?.splitPct ?? 50)}</span></span>
			{#if data.variants[0]?.abWinnerPickedAt}
				<span>Winner picked: <span class="text-text-secondary">{formatDate(data.variants[0].abWinnerPickedAt)}</span></span>
			{:else}
				<span class="text-amber-400">Waiting for results...</span>
			{/if}
		</div>

		<!-- Side-by-side comparison -->
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			{#each data.variants as variant, i (variant?.id ?? i)}
				{#if variant}
					{@const winner = isWinner(variant)}
					<div class="rounded-md border {winner ? 'border-teal-500/30 bg-teal-500/5' : 'border-surface-border bg-surface-base'} p-6 space-y-4">
						<div class="flex items-center justify-between">
							<h2 class="text-lg font-medium text-text-primary">Variant {variant.abVariant}</h2>
							{#if winner && data.variants[0]?.abWinnerPickedAt}
								<span class="rounded-md bg-teal-500/15 border border-teal-500/20 px-2 py-0.5 text-xs font-mono text-teal-400">WINNER</span>
							{/if}
						</div>

						<p class="text-sm text-text-secondary truncate">{variant.subject}</p>

						{#if FEATURES.ENGAGEMENT_METRICS}
							<div class="grid grid-cols-2 gap-3">
								<div class="rounded-lg bg-surface-overlay px-3 py-2.5">
									<p class="text-xs text-text-tertiary">Sent</p>
									<p class="text-lg font-mono tabular-nums text-text-primary">{variant.totalSent.toLocaleString()}</p>
								</div>
								<div class="rounded-lg bg-surface-overlay px-3 py-2.5">
									<p class="text-xs text-text-tertiary">Opened</p>
									<p class="text-lg font-mono tabular-nums text-text-primary">{variant.totalOpened.toLocaleString()}</p>
									<p class="text-xs font-mono text-text-tertiary">{pct(variant.totalOpened, variant.totalSent)}</p>
								</div>
								<div class="rounded-lg bg-surface-overlay px-3 py-2.5">
									<p class="text-xs text-text-tertiary">Clicked</p>
									<p class="text-lg font-mono tabular-nums text-text-primary">{variant.totalClicked.toLocaleString()}</p>
									<p class="text-xs font-mono text-text-tertiary">{pct(variant.totalClicked, variant.totalSent)}</p>
								</div>
								<div class="rounded-lg bg-surface-overlay px-3 py-2.5">
									<p class="text-xs text-text-tertiary">Bounced</p>
									<p class="text-lg font-mono tabular-nums text-text-primary">{variant.totalBounced.toLocaleString()}</p>
									<p class="text-xs font-mono text-text-tertiary">{pct(variant.totalBounced, variant.totalSent)}</p>
								</div>
							</div>
						{/if}

						<p class="text-xs text-text-quaternary">Sent {formatDate(variant.sentAt)}</p>
					</div>
				{/if}
			{/each}
		</div>

		<!-- Winner send info -->
		{#if FEATURES.ENGAGEMENT_METRICS && data.winnerBlast}
			<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-2">
				<h3 class="text-sm font-medium text-text-secondary">Winner Send</h3>
				<p class="text-sm text-text-tertiary">
					Winning variant sent to {data.winnerBlast.totalSent.toLocaleString()} remaining recipients
					{#if data.winnerBlast.sentAt}on {formatDate(data.winnerBlast.sentAt)}{/if}
				</p>
				<div class="flex gap-4 text-xs text-text-tertiary font-mono">
					<span>{data.winnerBlast.totalOpened} opened ({pct(data.winnerBlast.totalOpened, data.winnerBlast.totalSent)})</span>
					<span>{data.winnerBlast.totalClicked} clicked ({pct(data.winnerBlast.totalClicked, data.winnerBlast.totalSent)})</span>
				</div>
			</div>
		{/if}
	{:else}
		<!-- Non-A/B blast detail -->
		{#if FEATURES.ENGAGEMENT_METRICS}
			<div class="rounded-md border border-surface-border bg-surface-base p-6">
				<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
					<div>
						<p class="text-xs text-text-tertiary">Sent</p>
						<p class="text-xl font-mono tabular-nums text-text-primary">{data.blast.totalSent.toLocaleString()}</p>
					</div>
					<div>
						<p class="text-xs text-text-tertiary">Opened</p>
						<p class="text-xl font-mono tabular-nums text-text-primary">{data.blast.totalOpened.toLocaleString()}</p>
						<p class="text-xs font-mono text-text-tertiary">{pct(data.blast.totalOpened, data.blast.totalSent)}</p>
					</div>
					<div>
						<p class="text-xs text-text-tertiary">Clicked</p>
						<p class="text-xl font-mono tabular-nums text-text-primary">{data.blast.totalClicked.toLocaleString()}</p>
						<p class="text-xs font-mono text-text-tertiary">{pct(data.blast.totalClicked, data.blast.totalSent)}</p>
					</div>
					<div>
						<p class="text-xs text-text-tertiary">Bounced</p>
						<p class="text-xl font-mono tabular-nums text-text-primary">{data.blast.totalBounced.toLocaleString()}</p>
						<p class="text-xs font-mono text-text-tertiary">{pct(data.blast.totalBounced, data.blast.totalSent)}</p>
					</div>
				</div>
			</div>
		{/if}
	{/if}

	<!-- Bounced Recipients -->
	{#if FEATURES.ENGAGEMENT_METRICS && data.bounceEvents.length > 0}
		<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-3">
			<h3 class="text-sm font-medium text-text-secondary">
				Bounced Recipients
				<span class="ml-2 font-mono text-text-tertiary">{data.bounceEvents.length}</span>
			</h3>
			<div class="divide-y divide-surface-border">
				{#each data.bounceEvents as event}
					<div class="flex items-center justify-between py-2 text-sm">
						<span class="font-mono text-text-tertiary">{event.email}</span>
						<span class="text-xs text-text-quaternary">{formatDate(event.timestamp)}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
