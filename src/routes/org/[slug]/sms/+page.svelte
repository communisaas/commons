<script lang="ts">
	import SmsReplyRegister from '$lib/components/sms/SmsReplyRegister.svelte';
	import SmsBlastCard from '$lib/components/sms/SmsBlastCard.svelte';
	import BoundedNotice from '$lib/components/org/BoundedNotice.svelte';
	import { textDeliveryLimitNotice } from '$lib/data/org-limit-sentences';
	import { Datum } from '$lib/design';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const draftCount = $derived(data.blasts.length);
	const sentCount = $derived(data.blasts.reduce((sum, blast) => sum + blast.sentCount, 0));
	const deliveredCount = $derived(
		data.blasts.reduce((sum, blast) => sum + blast.deliveredCount, 0)
	);
	const failedCount = $derived(data.blasts.reduce((sum, blast) => sum + blast.failedCount, 0));
	const replyCount = $derived(data.replySummary.replyCount);
	const textLimitNotice = $derived(
		data.textDispatchRuntimeReady
			? null
			: textDeliveryLimitNotice({
					dispatchRuntimeMissing: data.textDispatchRuntimeMissing,
					dispatchRuntimeDependency: data.textDispatchRuntimeDependency,
					dispatchRuntimeMessage: data.textDispatchRuntimeMessage
				})
	);
</script>

<svelte:head>
	<title>Texts | {data.org.name}</title>
</svelte:head>

<div id="text-delivery" class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-4xl px-4 py-8">
		<div class="mb-8 flex items-center justify-between">
			<div>
				<h1 class="text-text-primary text-2xl font-bold">Texts</h1>
				<p class="text-text-tertiary mt-1 text-sm">
					{draftCount}
					{draftCount === 1 ? 'text blast' : 'text blasts'} · {sentCount} sent · {deliveredCount} delivered{failedCount >
					0
						? ` · ${failedCount} failed`
						: ''}
				</p>
			</div>
			<a
				href="/org/{data.org.slug}/sms/new"
				class="bg-surface-overlay text-text-primary hover:bg-surface-base rounded-md px-4 py-2 text-sm font-semibold"
			>
				Compose text
			</a>
		</div>

		{#if textLimitNotice}
			<div class="border-surface-border bg-surface-base my-6 rounded-md border px-4 py-3">
				<BoundedNotice notice={textLimitNotice} />
			</div>
		{/if}

		<div id="text-replies" class="border-surface-border bg-surface-base mb-6 rounded-md border p-4">
			<div class="mb-4 flex flex-wrap items-start justify-between gap-4">
				<div>
					<h2 class="text-text-secondary text-sm font-medium">Replies</h2>
					<p class="text-text-tertiary mt-1 text-xs">
						Text replies from recipients are recorded here.
					</p>
				</div>
				<div class="bg-surface-overlay rounded-md px-4 py-3 text-right">
					<p class="text-text-primary text-2xl leading-none font-semibold">
						<Datum value={replyCount} />
					</p>
					<p class="text-text-tertiary mt-1 text-xs">replies</p>
				</div>
			</div>
			<SmsReplyRegister replies={data.recentReplies} orgSlug={data.org.slug} />
		</div>

		{#if data.blasts.length === 0}
			<div class="border-surface-border rounded-md border py-16 text-center">
				<p class="text-text-tertiary text-lg">No texts yet.</p>
				<p class="text-text-tertiary mt-1 text-sm">Compose your first text blast.</p>
				<a
					href="/org/{data.org.slug}/sms/new"
					class="bg-surface-overlay text-text-primary hover:bg-surface-base mt-4 inline-block rounded-md px-4 py-2 text-sm font-semibold"
				>
					Compose text
				</a>
			</div>
		{:else}
			<div id="text-audience-snapshot" class="space-y-3">
				{#each data.blasts as blast (blast.id)}
					<a href="/org/{data.org.slug}/sms/{blast.id}" class="block">
						<SmsBlastCard {blast} />
					</a>
				{/each}
			</div>
		{/if}
	</div>
</div>
