<script lang="ts">
	import { spring } from 'svelte/motion';

	interface DeliveryMetrics {
		sent: number;
		delivered: number;
		opened: number;
		clicked: number;
		bounced: number;
		complained: number;
		deliveryRate: number;
		openRate: number;
		clickRate: number;
		bounceRate: number;
	}

	let { metrics }: { metrics: DeliveryMetrics } = $props();

	const springOpts = { stiffness: 0.15, damping: 0.8 };
	const animSent = spring(0, springOpts);
	const animDelivered = spring(0, springOpts);
	const animOpened = spring(0, springOpts);
	const animClicked = spring(0, springOpts);
	const animBounced = spring(0, springOpts);
	const animDeliveryRate = spring(0, springOpts);

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

<div class="rounded-md bg-surface-base border border-surface-border p-6 space-y-5">
	<p class="text-[10px] font-mono uppercase tracking-wider text-text-quaternary">Email Delivery</p>

	{#if isEmpty}
		<div class="py-4 text-center">
			<p class="text-sm text-text-quaternary">No emails sent yet</p>
		</div>
	{:else}
		<!-- Metric grid -->
		<div class="grid grid-cols-5 gap-4">
			<div>
				<p class="font-mono tabular-nums text-2xl font-bold text-text-primary">{fmt($animSent)}</p>
				<p class="text-[10px] text-text-quaternary mt-1">sent</p>
			</div>
			<div>
				<p class="font-mono tabular-nums text-2xl font-bold text-emerald-400">{fmt($animDelivered)}</p>
				<p class="text-[10px] text-text-quaternary mt-1">delivered</p>
			</div>
			<div>
				<p class="font-mono tabular-nums text-2xl font-bold text-teal-400">{fmt($animOpened)}</p>
				<p class="text-[10px] text-text-quaternary mt-1">opened</p>
			</div>
			<div>
				<p class="font-mono tabular-nums text-2xl font-bold text-teal-300">{fmt($animClicked)}</p>
				<p class="text-[10px] text-text-quaternary mt-1">clicked</p>
			</div>
			<div>
				<p class="font-mono tabular-nums text-2xl font-bold {metrics.bounced > 0 ? 'text-red-400' : 'text-text-tertiary'}">{fmt($animBounced)}</p>
				<p class="text-[10px] text-text-quaternary mt-1">bounced</p>
			</div>
		</div>

		<!-- Rate bar -->
		<div class="space-y-2">
			<div class="flex items-center justify-between text-[10px] font-mono text-text-tertiary">
				<span>delivery rate</span>
				<span class="text-emerald-400">{metrics.deliveryRate}%</span>
			</div>
			<div class="h-2 rounded-full bg-surface-raised overflow-hidden">
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
				<span class="text-[10px] font-mono text-text-tertiary">open {metrics.openRate}%</span>
			</div>
			<div class="flex items-center gap-2">
				<div class="h-2 w-2 rounded-full bg-teal-300"></div>
				<span class="text-[10px] font-mono text-text-tertiary">click {metrics.clickRate}%</span>
			</div>
			<div class="flex items-center gap-2">
				<div class="h-2 w-2 rounded-full {metrics.bounceRate > 5 ? 'bg-red-400' : 'bg-text-quaternary'}"></div>
				<span class="text-[10px] font-mono text-text-tertiary">bounce {metrics.bounceRate}%</span>
			</div>
		</div>
	{/if}
</div>
