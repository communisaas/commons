<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const canCreate = $derived(
		data.membership.role === 'owner' || data.membership.role === 'editor'
	);

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
			<h1 class="text-xl font-semibold text-text-primary">Emails</h1>
			<p class="text-sm text-text-tertiary mt-1">
				{data.blasts.length} invitation{data.blasts.length === 1 ? '' : 's'} sent
			</p>
		</div>
		{#if canCreate}
			<a
				href="/org/{data.org.slug}/emails/compose"
				class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 transition-colors"
			>
				<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
				</svg>
				New Invitation
			</a>
		{/if}
	</div>

	<!-- Blast list -->
	{#if data.blasts.length === 0}
		<div class="rounded-xl bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-12 text-center">
			<div class="mx-auto w-12 h-12 rounded-full bg-surface-overlay flex items-center justify-center mb-4">
				<svg class="w-6 h-6 text-text-quaternary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
				</svg>
			</div>
			<p class="text-sm text-text-tertiary">
				No invitations sent yet. Compose your first invitation to reach your supporters.
			</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each data.blasts.filter(b => !b.isAbTest || b.abVariant === 'A' || (!b.abVariant && !b.isAbTest)) as blast (blast.id)}
				{@const isAb = blast.isAbTest && blast.abVariant === 'A'}
				<a
					href="/org/{data.org.slug}/emails/{blast.id}"
					class="block rounded-xl bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-5 hover:border-[var(--coord-route-solid)] transition-colors"
				>
					<div class="flex items-start justify-between gap-4">
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-3 mb-2">
								<h2 class="text-lg font-medium text-text-primary truncate">
									{blast.subject}
								</h2>
								{#if isAb}
									<span class="inline-flex items-center rounded-md border bg-teal-500/15 text-teal-400 border-teal-500/20 px-2 py-0.5 text-xs font-mono">
										A/B
									</span>
								{/if}
								<span class="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono {statusBadgeClass(blast.status)}">
									{blast.status}
								</span>
							</div>

							<div class="flex items-center gap-4 text-xs text-text-tertiary">
								{#if blast.campaignTitle}
									<span class="flex items-center gap-1">
										<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
											<path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
										</svg>
										{blast.campaignTitle}
									</span>
								{/if}

								<span class="font-mono tabular-nums">
									{blast.totalSent.toLocaleString()} sent
								</span>

								{#if blast.totalBounced > 0}
									<span class="font-mono tabular-nums text-red-400">
										{blast.totalBounced.toLocaleString()} bounced
									</span>
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
