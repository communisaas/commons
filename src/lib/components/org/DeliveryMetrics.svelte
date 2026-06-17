<script lang="ts">
	import { spring } from 'svelte/motion';
	import { SPRINGS } from '$lib/design/motion';

	interface DeliveryMetrics {
		sent: number;
		delivered: number;
		opened: number;
		clicked: number;
		bounced: number;
		deliveryRate: number;
		openRate: number;
		clickRate: number;
		bounceRate: number;
	}

	let { metrics }: { metrics: DeliveryMetrics } = $props();

	const animSent = spring(0, SPRINGS.METRIC);
	const animDelivered = spring(0, SPRINGS.METRIC);
	const animOpened = spring(0, SPRINGS.METRIC);
	const animClicked = spring(0, SPRINGS.METRIC);
	const animBounced = spring(0, SPRINGS.METRIC);
	const animDeliveryRate = spring(0, SPRINGS.METRIC);

	$effect(() => {
		animSent.set(metrics.sent);
		animDelivered.set(metrics.delivered);
		animOpened.set(metrics.opened);
		animClicked.set(metrics.clicked);
		animBounced.set(metrics.bounced);
		animDeliveryRate.set(metrics.deliveryRate);
	});

	function fmt(n: number): string {
		return Math.round(n).toLocaleString('en-US');
	}

	const isEmpty = $derived(metrics.sent === 0);
</script>

<div class="bg-surface-base border-surface-border space-y-5 rounded-md border p-6">
	<p class="text-text-quaternary font-mono text-[10px] tracking-wider uppercase">Email Delivery</p>

	{#if isEmpty}
		<div class="py-4 text-center">
			<p class="text-text-quaternary text-sm">No emails sent yet</p>
		</div>
	{:else}
		<!-- Metric grid -->
		<div class="grid grid-cols-5 gap-4">
			<div>
				<p class="text-text-primary font-mono text-2xl font-bold tabular-nums">{fmt($animSent)}</p>
				<p class="text-text-quaternary mt-1 text-[10px]">sent</p>
			</div>
			<div>
				<p class="font-mono text-2xl font-bold text-emerald-400 tabular-nums">
					{fmt($animDelivered)}
				</p>
				<p class="text-text-quaternary mt-1 text-[10px]">delivered</p>
			</div>
			<div>
				<p class="font-mono text-2xl font-bold text-teal-400 tabular-nums">{fmt($animOpened)}</p>
				<p class="text-text-quaternary mt-1 text-[10px]">opened</p>
			</div>
			<div title="Observed verify-link clicks from proof-delivery response events">
				<p class="font-mono text-2xl font-bold text-teal-300 tabular-nums">{fmt($animClicked)}</p>
				<p class="text-text-quaternary mt-1 text-[10px]">verify clicks</p>
			</div>
			<div>
				<p
					class="font-mono text-2xl font-bold tabular-nums {metrics.bounced > 0
						? 'text-red-400'
						: 'text-text-tertiary'}"
				>
					{fmt($animBounced)}
				</p>
				<p class="text-text-quaternary mt-1 text-[10px]">bounced</p>
			</div>
		</div>

		<!-- Rate bar -->
		<div class="space-y-2">
			<div class="text-text-tertiary flex items-center justify-between font-mono text-[10px]">
				<span>delivery rate</span>
				<span class="text-emerald-400">{metrics.deliveryRate}%</span>
			</div>
			<div class="bg-surface-raised h-2 overflow-hidden rounded-full">
				<div
					class="h-2 rounded-full bg-emerald-500/60 transition-all duration-700 ease-out"
					style="width: {Math.min($animDeliveryRate, 100)}%"
				></div>
			</div>
		</div>

		<!-- Sub-rates -->
		<div class="grid grid-cols-3 gap-4 pt-1">
			<div class="flex items-center gap-2">
				<div class="h-2 w-2 rounded-full bg-teal-400"></div>
				<span class="text-text-tertiary font-mono text-[10px]">open {metrics.openRate}%</span>
			</div>
			<div class="flex items-center gap-2">
				<div class="h-2 w-2 rounded-full bg-teal-300"></div>
				<span class="text-text-tertiary font-mono text-[10px]"
					>verify click {metrics.clickRate}%</span
				>
			</div>
			<div class="flex items-center gap-2">
				<div
					class="h-2 w-2 rounded-full {metrics.bounceRate > 5
						? 'bg-red-400'
						: 'bg-text-quaternary'}"
				></div>
				<span class="text-text-tertiary font-mono text-[10px]">bounce {metrics.bounceRate}%</span>
			</div>
		</div>
	{/if}
</div>
