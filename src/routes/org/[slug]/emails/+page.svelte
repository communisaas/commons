<script lang="ts">
	import { FEATURES } from '$lib/config/features';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const canCreate = $derived(data.membership.role === 'owner' || data.membership.role === 'editor');
	const draftCount = $derived(data.blasts.filter((blast) => blast.status === 'draft').length);
	const sentCount = $derived(data.blasts.filter((blast) => blast.status === 'sent').length);
	const failedCount = $derived(data.blasts.filter((blast) => blast.status === 'failed').length);

	function statusBadgeClass(status: string): string {
		switch (status) {
			case 'draft':
				return 'bg-surface-overlay text-text-tertiary border-surface-border';
			case 'sending':
				return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
			case 'sent':
				return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
			case 'failed':
				return 'bg-red-500/15 text-red-400 border-red-500/20';
			default:
				return 'bg-surface-overlay text-text-tertiary border-surface-border';
		}
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '--';
		const d = new Date(iso);
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-text-primary text-xl font-semibold">Email delivery</h1>
			<p class="text-text-tertiary mt-1 text-sm">
				{data.blasts.length} delivery record{data.blasts.length === 1 ? '' : 's'} ·
				{sentCount} sent · {draftCount} draft{draftCount === 1 ? '' : 's'}{#if failedCount > 0}
					· {failedCount} failed{/if}
			</p>
		</div>
		{#if canCreate}
			<a
				href="/org/{data.org.slug}/emails/compose"
				class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500"
			>
				<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
				</svg>
				Compose delivery
			</a>
		{/if}
	</div>

	<!-- Blast list -->
	{#if data.blasts.length === 0}
		<div class="bg-surface-base border-surface-border rounded-md border p-12 text-center">
			<div
				class="bg-surface-overlay mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
			>
				<svg
					class="text-text-quaternary h-6 w-6"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="1.5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
					/>
				</svg>
			</div>
			<p class="text-text-tertiary text-sm">No emails yet. Compose your first email.</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each data.blasts.filter((b) => !b.isAbTest || b.abVariant === 'A' || (!b.abVariant && !b.isAbTest)) as blast (blast.id)}
				{@const isAb = blast.isAbTest && blast.abVariant === 'A'}
				<a
					href="/org/{data.org.slug}/emails/{blast.id}"
					class="bg-surface-base border-surface-border block rounded-md border p-5 transition-colors hover:border-[var(--coord-route-solid)]"
				>
					<div class="flex items-start justify-between gap-4">
						<div class="min-w-0 flex-1">
							<div class="mb-2 flex items-center gap-3">
								<h2 class="text-text-primary truncate text-lg font-medium">
									{blast.subject}
								</h2>
								{#if isAb}
									<span
										class="inline-flex items-center rounded-md border border-teal-500/20 bg-teal-500/15 px-2 py-0.5 font-mono text-xs text-teal-400"
									>
										A/B
									</span>
								{/if}
								<span
									class="inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs {statusBadgeClass(
										blast.status
									)}"
								>
									{blast.status}
								</span>
							</div>

							<div class="text-text-tertiary flex items-center gap-4 text-xs">
								{#if blast.campaignTitle}
									<span class="flex items-center gap-1">
										<svg
											class="h-3 w-3"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											stroke-width="1.5"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
											/>
										</svg>
										Action: {blast.campaignTitle}
									</span>
								{/if}

								{#if FEATURES.ENGAGEMENT_METRICS}
									<span class="font-mono tabular-nums">
										{blast.totalSent.toLocaleString()} sent
									</span>

									{#if blast.totalBounced > 0}
										<span class="font-mono text-red-400 tabular-nums">
											{blast.totalBounced.toLocaleString()} bounced
										</span>
									{/if}
								{/if}

								<span class="font-mono tabular-nums">
									{formatDate(blast.sentAt ?? blast.createdAt)}
								</span>
							</div>
						</div>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>
