<script lang="ts">
	import { FEATURES } from '$lib/config/features';
	import BoundedNotice from '$lib/components/org/BoundedNotice.svelte';
	import { emailDeliveryLimitNotice } from '$lib/data/org-limit-sentences';
	import type { PageData } from './$types';

	type EmailBlast = {
		id: string;
		subject: string;
		status: string;
		abVariant?: string | null;
		totalRecipients: number;
		totalSent: number;
		totalBounced: number;
		totalOpened: number;
		totalClicked: number;
		totalComplained?: number;
		sentAt: string | null;
		createdAt?: string;
		abWinnerPickedAt?: string | null;
	};

	type BounceEvent = {
		email: string;
		timestamp: string | null;
	};

	type ViewData = Omit<PageData, 'blast' | 'variants' | 'winnerBlast' | 'bounceEvents'> & {
		abConfig?: {
			winnerMetric?: string | null;
			winnerMetricSupported?: boolean;
			winnerBlastId?: string | null;
			testGroupPct?: number | null;
			splitPct?: number | null;
			cohortSnapshot?: {
				totalCount?: number | null;
				testCount?: number | null;
				variantACount?: number | null;
				variantBCount?: number | null;
				remainderCount?: number | null;
			} | null;
		} | null;
		abCohort?: {
			totalCount: number;
			testCount: number;
			variantACount: number;
			variantBCount: number;
			remainderCount: number;
			remainderBlastId: string | null;
		} | null;
		blast: EmailBlast;
		variants: Array<EmailBlast | null>;
		remainderDraft: EmailBlast | null;
		winnerBlast: EmailBlast | null;
		receiptSummary: {
			pageCount: number;
			sentCount: number;
			failedCount: number;
			hasMore: boolean;
		};
		bounceEvents: BounceEvent[];
		serverDispatchRuntimeReady: boolean;
	};
	let { data, form }: { data: ViewData; form?: { error?: string; errorCode?: string } } = $props();

	function pct(num: number, denom: number): string {
		if (denom === 0) return '0.0%';
		return ((num / denom) * 100).toFixed(1) + '%';
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '--';
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	const metricLabels: Record<string, string> = {
		open: 'Open Rate',
		click: 'Click Rate'
	};

	function winnerMetricLabel(metric: string | null | undefined): string {
		if (!metric) return metricLabels.open;
		return metricLabels[metric] ?? 'Unsupported metric';
	}

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
	const totalComplained = $derived(
		data.isAbTest
			? data.variants.reduce((sum, v) => sum + (v?.totalComplained ?? 0), 0)
			: (data.blast.totalComplained ?? 0)
	);
	const rate = $derived(bounceRate(totalBounced, totalSent));
	const abWinnerPickedAt = $derived(
		data.variants.find((variant) => variant?.abWinnerPickedAt)?.abWinnerPickedAt ?? null
	);
	const recordedWinnerBlastId = $derived(data.abConfig?.winnerBlastId ?? null);
	const abWinnerMetricSupported = $derived(data.abConfig?.winnerMetricSupported !== false);
	const canMaterializeAbRemainder = $derived(
		abWinnerMetricSupported || Boolean(recordedWinnerBlastId)
	);
	const abWinnerVariant = $derived(data.variants.find((variant) => isWinner(variant)) ?? null);
	const suppressedSignal = $derived(totalBounced + totalComplained);
	const hasDraftAbVariant = $derived(data.variants.some((variant) => variant?.status === 'draft'));
	const hasDraftRemainder = $derived(data.remainderDraft?.status === 'draft');
	const serverDispatchRuntimeArmed = $derived(
		FEATURES.EMAIL_SERVER_DISPATCH && data.serverDispatchRuntimeReady
	);
	const emailLimitNotice = $derived(
		serverDispatchRuntimeArmed
			? null
			: emailDeliveryLimitNotice(data.spaces.operating?.emailDelivery ?? null)
	);

	function isWinner(variant: (typeof data.variants)[0]): boolean {
		if (!data.isAbTest || data.variants.length < 2) return false;
		if (recordedWinnerBlastId) return variant?.id === recordedWinnerBlastId;
		if (!abWinnerMetricSupported) return false;
		const a = data.variants[0];
		const b = data.variants[1];
		if (!a || !b) return false;
		const metric = data.abConfig?.winnerMetric ?? 'open';
		const scoreA = getScore(a, metric);
		const scoreB = getScore(b, metric);
		if (variant?.abVariant === 'A') return scoreA >= scoreB;
		return scoreB > scoreA;
	}

	function getScore(v: (typeof data.variants)[0], metric: string): number {
		if (!v) return 0;
		const sent = v.totalSent || 1;
		if (metric === 'click') return v.totalClicked / sent;
		return v.totalOpened / sent;
	}

</script>

<div class="space-y-6">
	<!-- Header -->
	<div id="email-record" class="flex scroll-mt-24 items-center gap-4">
		<a
			href="/org/{data.org.slug}/emails"
			class="text-text-tertiary hover:text-text-secondary transition-colors"
			aria-label="Back to emails"
		>
			<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
				/>
			</svg>
		</a>
		<div class="flex items-center gap-3">
			<div>
				<h1 class="text-text-primary text-xl font-semibold">
					{#if data.isAbTest}A/B Test Group{:else}Email Details{/if}
				</h1>
				<p class="text-text-tertiary mt-1 text-sm">
					{data.blast.subject}
				</p>
			</div>
			{#if FEATURES.ENGAGEMENT_METRICS && totalSent > 0}
				<span
					class="inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs {bounceRateColor(
						rate
					)}"
				>
					{rate.toFixed(1)}% bounced
				</span>
			{/if}
		</div>
	</div>

	{#if data.isAbTest && data.variants.length >= 2}
		{@const config = data.abConfig}

		<!-- Config summary -->
		<div
			class="border-surface-border bg-surface-base text-text-tertiary flex items-center gap-6 rounded-lg border px-4 py-3 text-xs"
		>
			<span
				>Winner by: <span class="text-text-secondary"
					>{winnerMetricLabel(config?.winnerMetric)}</span
				></span
			>
			<span>Test group: <span class="text-text-secondary">{config?.testGroupPct ?? 20}%</span></span
			>
			<span
				>Split: <span class="text-text-secondary"
					>{config?.splitPct ?? 50}/{100 - (config?.splitPct ?? 50)}</span
				></span
			>
			{#if abWinnerPickedAt}
				<span
					>Winner picked: <span class="text-text-secondary">{formatDate(abWinnerPickedAt)}</span
					></span
				>
			{:else}
				<span class="text-amber-400">Waiting for results...</span>
			{/if}
		</div>

		<!-- Side-by-side comparison -->
		<div
			id={FEATURES.ENGAGEMENT_METRICS ? 'email-engagement-telemetry' : undefined}
			class="grid grid-cols-1 gap-4 md:grid-cols-2"
		>
			{#each data.variants as variant, i (variant?.id ?? i)}
				{#if variant}
					{@const winner = isWinner(variant)}
					<div
						class="rounded-md border {winner
							? 'border-teal-500/30 bg-teal-500/5'
							: 'border-surface-border bg-surface-base'} space-y-4 p-6"
					>
						<div class="flex items-center justify-between">
							<h2 class="text-text-primary text-lg font-medium">Variant {variant.abVariant}</h2>
							{#if winner && abWinnerPickedAt}
								<span
									class="rounded-md border border-teal-500/20 bg-teal-500/15 px-2 py-0.5 font-mono text-xs text-teal-400"
									>WINNER</span
								>
							{/if}
						</div>

						<p class="text-text-secondary truncate text-sm">{variant.subject}</p>

						<div class="grid grid-cols-2 gap-3">
							<div class="bg-surface-overlay rounded-lg px-3 py-2.5">
								<p class="text-text-tertiary text-xs">Status</p>
								<p class="text-text-primary font-mono text-lg tabular-nums">{variant.status}</p>
							</div>
							<div class="bg-surface-overlay rounded-lg px-3 py-2.5">
								<p class="text-text-tertiary text-xs">Sent</p>
								<p class="text-text-primary font-mono text-lg tabular-nums">
									{variant.totalSent.toLocaleString()}
								</p>
							</div>
							{#if FEATURES.ENGAGEMENT_METRICS}
								<div class="bg-surface-overlay rounded-lg px-3 py-2.5">
									<p class="text-text-tertiary text-xs">Opened</p>
									<p class="text-text-primary font-mono text-lg tabular-nums">
										{variant.totalOpened.toLocaleString()}
									</p>
									<p class="text-text-tertiary font-mono text-xs">
										{pct(variant.totalOpened, variant.totalSent)}
									</p>
								</div>
								<div class="bg-surface-overlay rounded-lg px-3 py-2.5">
									<p class="text-text-tertiary text-xs">Clicked</p>
									<p class="text-text-primary font-mono text-lg tabular-nums">
										{variant.totalClicked.toLocaleString()}
									</p>
									<p class="text-text-tertiary font-mono text-xs">
										{pct(variant.totalClicked, variant.totalSent)}
									</p>
								</div>
								<div class="bg-surface-overlay rounded-lg px-3 py-2.5">
									<p class="text-text-tertiary text-xs">Bounced</p>
									<p class="text-text-primary font-mono text-lg tabular-nums">
										{variant.totalBounced.toLocaleString()}
									</p>
									<p class="text-text-tertiary font-mono text-xs">
										{pct(variant.totalBounced, variant.totalSent)}
									</p>
								</div>
							{/if}
						</div>

						<p class="text-text-quaternary text-xs">Sent {formatDate(variant.sentAt)}</p>
					</div>
				{/if}
			{/each}
		</div>

		<div
			id="email-experiment-boundary"
			class="border-surface-border bg-surface-base space-y-2 rounded-md border p-6"
		>
			<h3 class="text-text-secondary text-sm font-medium">A/B continuation</h3>
			{#if data.abCohort}
				<div class="grid grid-cols-2 gap-3 py-2 text-xs md:grid-cols-4">
					<div>
						<p class="text-text-quaternary">Snapshot</p>
						<p class="text-text-secondary font-mono tabular-nums">
							{data.abCohort.totalCount.toLocaleString()}
						</p>
					</div>
					<div>
						<p class="text-text-quaternary">Test cohort</p>
						<p class="text-text-secondary font-mono tabular-nums">
							{data.abCohort.testCount.toLocaleString()}
						</p>
					</div>
					<div>
						<p class="text-text-quaternary">Variant split</p>
						<p class="text-text-secondary font-mono tabular-nums">
							{data.abCohort.variantACount.toLocaleString()} / {data.abCohort.variantBCount.toLocaleString()}
						</p>
					</div>
					<div>
						<p class="text-text-quaternary">Remainder</p>
						<p class="text-text-secondary font-mono tabular-nums">
							{data.abCohort.remainderCount.toLocaleString()}
						</p>
					</div>
				</div>
			{/if}
			{#if !abWinnerMetricSupported}
				<div class="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
					<p class="text-xs font-medium text-amber-300">
						This test uses a winner measure that is no longer tracked
					</p>
					<p class="text-text-tertiary mt-1 text-xs leading-relaxed">
						If a winner was already recorded, the held-back group can still receive the winning
						email. Otherwise, create a new test that picks its winner by opens or clicks.
					</p>
				</div>
			{/if}
			{#if abWinnerPickedAt && data.remainderDraft}
				<p class="text-text-tertiary text-sm">
					Variant {abWinnerVariant?.abVariant ?? 'A'} won. A follow-up email for the held-back group
					is saved with status
					<span class="text-text-secondary font-mono">{data.remainderDraft.status}</span>.
				</p>
				<div class="flex flex-wrap gap-2 pt-1">
					{#if serverDispatchRuntimeArmed && hasDraftRemainder}
						<form method="POST" action="?/sendRemainder">
							<input
								type="hidden"
								name="winnerBlastId"
								value={abWinnerVariant?.id ?? data.blast.id}
							/>
							<button
								type="submit"
								class="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-teal-500"
							>
								Queue remainder send
							</button>
						</form>
					{/if}
					<a
						href="/org/{data.org.slug}/emails/{data.remainderDraft.id}"
						class="inline-flex rounded-md border border-teal-500/30 bg-teal-500/10 px-3 py-1.5 text-sm font-medium text-teal-300 transition-colors hover:bg-teal-500/15"
					>
						Open remainder draft
					</a>
				</div>
			{:else if abWinnerPickedAt && data.abCohort?.remainderCount && canMaterializeAbRemainder}
				<p class="text-text-tertiary text-sm">
					Winner marker recorded for Variant {abWinnerVariant?.abVariant ?? 'A'}. Create a follow-up
					draft for the held-back cohort using the winning subject and body.
				</p>
				{#if serverDispatchRuntimeArmed}
					<form method="POST" action="?/sendRemainder" class="pt-1">
						<input
							type="hidden"
							name="winnerBlastId"
							value={abWinnerVariant?.id ?? data.blast.id}
						/>
						<button
							type="submit"
							class="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-teal-500"
						>
							Create and queue remainder
						</button>
					</form>
				{:else}
					<form method="POST" action="?/createRemainderDraft" class="pt-1">
						<input
							type="hidden"
							name="winnerBlastId"
							value={abWinnerVariant?.id ?? data.blast.id}
						/>
						<button
							type="submit"
							class="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-teal-500"
						>
							Create remainder draft
						</button>
					</form>
				{/if}
			{:else if abWinnerPickedAt && data.abCohort?.remainderCount}
				<p class="text-text-tertiary text-sm">
					A winner was marked, but this older test didn't record which email won. The held-back
					group is unchanged; create a new test that picks its winner by opens or clicks.
				</p>
			{:else if abWinnerPickedAt}
				<p class="text-text-tertiary text-sm">
					Variant {abWinnerVariant?.abVariant ?? 'A'} won, but this older test has no saved
					recipient snapshot, so there is no held-back group to follow up with. Create a new A/B
					test to keep one.
				</p>
			{:else if hasDraftAbVariant}
				<p class="text-text-tertiary text-sm">
					Both variant drafts are saved{data.abCohort
						? ' with their exact recipient groups'
						: ''}. Recipients are not reselected at send time.
				</p>
				{#if serverDispatchRuntimeArmed}
					<form method="POST" action="?/sendTestCohorts" class="pt-1">
						<button
							type="submit"
							class="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-teal-500"
						>
							Send to test groups
						</button>
					</form>
				{/if}
			{:else}
				<p class="text-text-tertiary text-sm">
					Both variants appear here. Once results come in, the stronger one can be marked the
					winner and sent to the held-back group.
				</p>
			{/if}
			{#if emailLimitNotice}
				<BoundedNotice notice={emailLimitNotice} />
			{/if}
			{#if form?.error}
				<p class="text-sm text-red-400">{form.error}</p>
			{/if}
		</div>
	{:else}
		<!-- Non-A/B blast detail -->
		{#if FEATURES.ENGAGEMENT_METRICS}
			<div
				id="email-engagement-telemetry"
				class="border-surface-border bg-surface-base rounded-md border p-6"
			>
				<div class="grid grid-cols-2 gap-4 md:grid-cols-4">
					<div>
						<p class="text-text-tertiary text-xs">Sent</p>
						<p class="text-text-primary font-mono text-xl tabular-nums">
							{data.blast.totalSent.toLocaleString()}
						</p>
					</div>
					<div>
						<p class="text-text-tertiary text-xs">Opened</p>
						<p class="text-text-primary font-mono text-xl tabular-nums">
							{data.blast.totalOpened.toLocaleString()}
						</p>
						<p class="text-text-tertiary font-mono text-xs">
							{pct(data.blast.totalOpened, data.blast.totalSent)}
						</p>
					</div>
					<div>
						<p class="text-text-tertiary text-xs">Clicked</p>
						<p class="text-text-primary font-mono text-xl tabular-nums">
							{data.blast.totalClicked.toLocaleString()}
						</p>
						<p class="text-text-tertiary font-mono text-xs">
							{pct(data.blast.totalClicked, data.blast.totalSent)}
						</p>
					</div>
					<div>
						<p class="text-text-tertiary text-xs">Bounced</p>
						<p class="text-text-primary font-mono text-xl tabular-nums">
							{data.blast.totalBounced.toLocaleString()}
						</p>
						<p class="text-text-tertiary font-mono text-xs">
							{pct(data.blast.totalBounced, data.blast.totalSent)}
						</p>
					</div>
				</div>
			</div>
		{/if}
	{/if}

	<!-- Per-recipient delivery receipts -->
	<div
		id="email-receipt-evidence"
		class="border-surface-border bg-surface-base flex items-center justify-between gap-4 rounded-md border p-6"
	>
		<div>
			<h3 class="text-text-secondary text-sm font-medium">Delivery receipts</h3>
			<p class="font-brand text-text-tertiary mt-1 text-xs">
				Each recipient's delivery receipt records the message ID, status, and any error.
				{#if data.receiptSummary.pageCount > 0}
					{data.receiptSummary.pageCount} receipt{data.receiptSummary.pageCount === 1
						? ''
						: 's'} loaded{data.receiptSummary.hasMore ? ' so far' : ''}.
				{:else}
					No delivery receipts yet.
				{/if}
			</p>
		</div>
		<a href="receipts" class="font-brand text-sm font-medium text-indigo-600 hover:text-indigo-800">
			View receipts →
		</a>
	</div>

	<div
		id="email-list-health"
		class="border-surface-border bg-surface-base space-y-2 rounded-md border p-6"
	>
		<div class="flex items-baseline justify-between gap-4">
			<h3 class="text-text-secondary text-sm font-medium">List health</h3>
			<span class="text-text-tertiary font-mono text-xs">
				{suppressedSignal.toLocaleString()} bounced or complained
			</span>
		</div>
		<p class="font-brand text-text-tertiary text-xs">
			Bounces and complaints from this send update each person's email status automatically.
		</p>
	</div>

	<!-- Bounced Recipients -->
	{#if FEATURES.ENGAGEMENT_METRICS && data.bounceEvents.length > 0}
		<div class="border-surface-border bg-surface-base space-y-3 rounded-md border p-6">
			<h3 class="text-text-secondary text-sm font-medium">
				Bounced Recipients
				<span class="text-text-tertiary ml-2 font-mono">{data.bounceEvents.length}</span>
			</h3>
			<div class="divide-surface-border divide-y">
				{#each data.bounceEvents as event}
					<div class="flex items-center justify-between py-2 text-sm">
						<span class="text-text-tertiary font-mono">{event.email}</span>
						<span class="text-text-quaternary text-xs">{formatDate(event.timestamp)}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
