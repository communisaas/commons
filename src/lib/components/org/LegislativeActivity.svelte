<script lang="ts">
	import { FEATURES } from '$lib/config/features';

	interface AlertItem {
		id: string;
		type: string;
		title: string;
		summary: string;
		urgency: string;
		status: string;
		createdAt: string;
		bill: {
			id: string;
			title: string;
			status: string;
			relevanceScore: number | null;
		};
	}

	let {
		alerts: initialAlerts = [],
		orgSlug,
		pendingCount: initialPendingCount = 0
	}: {
		alerts: AlertItem[];
		orgSlug: string;
		pendingCount: number;
	} = $props();

	let alerts = $state(initialAlerts);
	let pendingCount = $state(initialPendingCount);
	let dismissing = $state<Set<string>>(new Set());

	// SSE subscription for live updates
	let eventSource: EventSource | null = null;

	$effect(() => {
		if (!FEATURES.LEGISLATION) return;

		eventSource = new EventSource(`/api/org/${orgSlug}/alerts/stream`);

		eventSource.addEventListener('alerts', (e: MessageEvent) => {
			try {
				const data = JSON.parse(e.data);
				pendingCount = data.count;
				// Merge new alerts into the list (keep dismissed state)
				if (data.alerts) {
					const dismissedIds = dismissing;
					alerts = data.alerts
						.filter((a: { id: string }) => !dismissedIds.has(a.id))
						.slice(0, 5)
						.map((a: { id: string; type: string; title: string; summary: string; urgency: string; createdAt: string; billTitle: string; billStatus: string }) => ({
							id: a.id,
							type: a.type,
							title: a.title,
							summary: a.summary,
							urgency: a.urgency,
							status: 'pending',
							createdAt: a.createdAt,
							bill: {
								id: '',
								title: a.billTitle,
								status: a.billStatus,
								relevanceScore: null
							}
						}));
				}
			} catch { /* ignore parse errors */ }
		});

		eventSource.addEventListener('error', () => {
			// Will auto-reconnect per SSE spec
		});

		return () => {
			eventSource?.close();
			eventSource = null;
		};
	});

	function urgencyColor(urgency: string): string {
		switch (urgency) {
			case 'critical': return 'text-red-400 bg-red-500/10 border-red-500/20';
			case 'high': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
			case 'normal': return 'text-teal-400 bg-teal-500/10 border-teal-500/20';
			case 'low': return 'text-text-tertiary bg-surface-raised border-surface-border';
			default: return 'text-text-tertiary bg-surface-raised border-surface-border';
		}
	}

	function urgencyOrder(urgency: string): number {
		switch (urgency) {
			case 'critical': return 0;
			case 'high': return 1;
			case 'normal': return 2;
			case 'low': return 3;
			default: return 4;
		}
	}

	const sortedAlerts = $derived(
		[...alerts]
			.sort((a, b) => {
				const urgDiff = urgencyOrder(a.urgency) - urgencyOrder(b.urgency);
				if (urgDiff !== 0) return urgDiff;
				return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
			})
			.slice(0, 5)
	);

	function relativeTime(iso: string): string {
		const diff = Date.now() - new Date(iso).getTime();
		if (diff < 0) return 'just now';
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function relevanceBadge(score: number | null): string {
		if (score === null) return '';
		if (score >= 0.8) return 'High match';
		if (score >= 0.5) return 'Medium match';
		return 'Low match';
	}

	function relevanceBadgeColor(score: number | null): string {
		if (score === null) return '';
		if (score >= 0.8) return 'text-emerald-400 bg-emerald-500/10';
		if (score >= 0.5) return 'text-teal-400 bg-teal-500/10';
		return 'text-text-quaternary bg-surface-raised';
	}

	async function dismissAlert(alertId: string): Promise<void> {
		dismissing = new Set([...dismissing, alertId]);
		alerts = alerts.filter(a => a.id !== alertId);

		try {
			const res = await fetch(`/api/org/${orgSlug}/alerts/${alertId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'dismissed' })
			});
			if (!res.ok) {
				// Revert on failure — re-fetch would be better but keep it simple
				dismissing = new Set([...dismissing].filter(id => id !== alertId));
			}
		} catch {
			dismissing = new Set([...dismissing].filter(id => id !== alertId));
		}
	}
</script>

{#if FEATURES.LEGISLATION}
	<div class="rounded-md bg-surface-base border border-surface-border p-6 shadow-[var(--shadow-sm)]">
		<div class="flex items-center justify-between mb-4">
			<div class="flex items-center gap-2">
				<p class="text-[10px] font-mono uppercase tracking-wider text-text-tertiary">Legislative Activity</p>
				{#if pendingCount > 0}
					<span class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-mono font-bold">
						{pendingCount}
					</span>
				{/if}
			</div>
		</div>

		{#if sortedAlerts.length === 0}
			<div class="py-6 text-center">
				<svg class="w-8 h-8 mx-auto mb-2 text-text-quaternary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
				</svg>
				<p class="text-sm text-text-quaternary">No legislative activity matches your issue domains yet</p>
				<a
					href="/org/{orgSlug}/settings"
					class="inline-block mt-2 text-xs text-teal-500 hover:text-teal-400 transition-colors"
				>
					Configure issue domains
				</a>
			</div>
		{:else}
			<div class="space-y-2">
				{#each sortedAlerts as alert (alert.id)}
					<div class="group flex items-start gap-3 rounded-lg border border-surface-border bg-surface-raised px-4 py-3 transition-colors hover:border-[var(--coord-route-solid)]">
						<!-- Urgency indicator -->
						<div class="flex-shrink-0 mt-1">
							<span class="inline-block text-[10px] font-mono px-1.5 py-0.5 rounded border {urgencyColor(alert.urgency)}">
								{alert.urgency}
							</span>
						</div>

						<!-- Content -->
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium text-text-primary line-clamp-1">
								{alert.bill.title}
							</p>
							<p class="text-xs text-text-tertiary mt-0.5 line-clamp-1">
								{alert.summary}
							</p>
							<div class="flex items-center gap-2 mt-1.5">
								<span class="text-[10px] font-mono text-text-quaternary">
									{relativeTime(alert.createdAt)}
								</span>
								{#if alert.bill.relevanceScore !== null}
									<span class="text-[10px] font-mono px-1 py-0.5 rounded {relevanceBadgeColor(alert.bill.relevanceScore)}">
										{relevanceBadge(alert.bill.relevanceScore)}
									</span>
								{/if}
								<span class="text-[10px] font-mono text-text-quaternary">
									{alert.bill.status}
								</span>
							</div>
						</div>

						<!-- Actions -->
						<div class="flex items-center gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
							<a
								href="/org/{orgSlug}/campaigns/new?fromAlert={alert.id}"
								class="text-[10px] font-medium text-teal-500 hover:text-teal-400 transition-colors whitespace-nowrap"
							>
								Create Campaign
							</a>
							<button
								class="text-[10px] text-text-quaternary hover:text-red-400 transition-colors"
								onclick={() => dismissAlert(alert.id)}
							>
								Dismiss
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
