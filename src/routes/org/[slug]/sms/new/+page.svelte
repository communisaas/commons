<script lang="ts">
	import CharacterCounter from '$lib/components/sms/CharacterCounter.svelte';
	import BoundedNotice from '$lib/components/org/BoundedNotice.svelte';
	import { textDeliveryLimitNotice } from '$lib/data/org-limit-sentences';
	import { Datum } from '$lib/design';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let body = $state('');
	let campaignId = $state('');
	let saving = $state(false);
	let errorMsg = $state('');
	let selectedTagIds = $state<string[]>([]);
	let excludedTagIds = $state<string[]>([]);
	let selectedSegmentIds = $state<string[]>([]);
	// svelte-ignore state_referenced_locally
	let audienceCount = $state(data.initialAudienceCount);
	// svelte-ignore state_referenced_locally
	let audienceBatchLimit = $state(data.initialAudienceBatchLimit);
	// svelte-ignore state_referenced_locally
	let audienceHasMoreThanBatchLimit = $state(data.initialAudienceHasMoreThanBatchLimit);
	let audienceCounting = $state(false);
	let audienceCountError = $state('');
	let audienceFirstRun = true;
	let audienceRequestSeq = 0;

	const bodyLength = $derived(body.length);
	const segmentCount = $derived(Math.ceil(bodyLength / 160) || 1);
	const isValid = $derived(body.trim().length > 0 && bodyLength <= 1600);
	const canContinueToDispatch = $derived(isValid && audienceCount > 0 && !audienceCounting);
	const hasAudienceFilter = $derived(
		selectedTagIds.length > 0 || excludedTagIds.length > 0 || selectedSegmentIds.length > 0
	);
	const recipientFilterPayload = $derived(
		hasAudienceFilter
			? {
					tags: selectedTagIds.length ? selectedTagIds : undefined,
					segments: selectedSegmentIds.length ? selectedSegmentIds : undefined,
					excludeTags: excludedTagIds.length ? excludedTagIds : undefined
				}
			: null
	);
	const audienceFilterKey = $derived(JSON.stringify(recipientFilterPayload ?? {}));
	const textLimitNotice = $derived(
		data.textDispatchRuntimeReady
			? null
			: textDeliveryLimitNotice({
					dispatchRuntimeMissing: data.textDispatchRuntimeMissing,
					dispatchRuntimeDependency: data.textDispatchRuntimeDependency,
					dispatchRuntimeMessage: data.textDispatchRuntimeMessage
				})
	);

	function toggle(list: string[], id: string): string[] {
		return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
	}

	function toggleIncludedTag(tagId: string) {
		selectedTagIds = toggle(selectedTagIds, tagId);
		if (selectedTagIds.includes(tagId))
			excludedTagIds = excludedTagIds.filter((id) => id !== tagId);
	}

	function toggleExcludedTag(tagId: string) {
		excludedTagIds = toggle(excludedTagIds, tagId);
		if (excludedTagIds.includes(tagId))
			selectedTagIds = selectedTagIds.filter((id) => id !== tagId);
	}

	function toggleSegment(segmentId: string) {
		selectedSegmentIds = toggle(selectedSegmentIds, segmentId);
	}

	$effect(() => {
		const key = audienceFilterKey;
		void key;

		if (audienceFirstRun) {
			audienceFirstRun = false;
			return;
		}

		const seq = ++audienceRequestSeq;
		const payload = recipientFilterPayload;
		audienceCounting = true;
		audienceCountError = '';

		const timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/org/${data.org.slug}/sms/audience-count`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ recipientFilter: payload ?? {} })
				});
				const result = await res.json().catch(() => null);
				if (seq !== audienceRequestSeq) return;
				if (!res.ok) {
					audienceCountError =
						result?.message ?? result?.error ?? `Unable to count audience (${res.status})`;
					return;
				}
				audienceCount = Number(result?.eligibleCount ?? 0);
				audienceBatchLimit = Number(result?.batchLimit ?? audienceBatchLimit);
				audienceHasMoreThanBatchLimit = Boolean(result?.hasMoreThanBatchLimit);
			} catch {
				if (seq === audienceRequestSeq) audienceCountError = 'Unable to count audience';
			} finally {
				if (seq === audienceRequestSeq) audienceCounting = false;
			}
		}, 350);

		return () => clearTimeout(timer);
	});

	async function saveDraft(continueToDispatch = false) {
		if (!body.trim()) {
			errorMsg = 'Message body is required';
			return;
		}
		if (bodyLength > 1600) {
			errorMsg = 'Message exceeds 1600 character limit';
			return;
		}
		if (continueToDispatch && audienceCount < 1) {
			errorMsg = 'Choose an audience with at least one eligible subscribed phone before dispatch.';
			return;
		}

		saving = true;
		errorMsg = '';

		try {
			const res = await fetch(`/api/org/${data.org.slug}/sms`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					body: body.trim(),
					campaignId: campaignId || null,
					recipientFilter: recipientFilterPayload
				})
			});

			if (res.ok) {
				const result = await res.json();
				window.location.href = continueToDispatch
					? `/org/${data.org.slug}/sms/${result.id}?dispatch=1#text-dispatch-status`
					: `/org/${data.org.slug}/sms/${result.id}`;
			} else {
				const err = await res.json().catch(() => null);
				errorMsg = err?.error ?? `Failed to save (${res.status})`;
			}
		} catch {
			errorMsg = 'Network error';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Compose text | {data.org.name}</title>
</svelte:head>

<div id="text-delivery-draft" class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-4xl px-4 py-8">
		<a
			href="/org/{data.org.slug}/sms"
			class="text-text-tertiary hover:text-text-primary mb-6 inline-block text-sm"
		>
			&larr; Texts
		</a>

		<h1 class="text-text-primary mb-2 text-2xl font-bold">Compose text</h1>
		<p class="text-text-tertiary mb-6 text-sm">
			Write the message, choose who gets it, then send from the text's page.
		</p>

		{#if textLimitNotice}
			<div
				id="text-dispatch"
				class="border-surface-border bg-surface-base my-6 rounded-md border px-4 py-3"
			>
				<BoundedNotice notice={textLimitNotice} />
			</div>
		{/if}

		{#if errorMsg}
			<div
				class="mb-6 rounded-md border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400"
			>
				{errorMsg}
			</div>
		{/if}

		<div id="text-message" class="border-surface-border mb-6 rounded-md border p-4">
			<label for="sms-body" class="text-text-tertiary mb-2 block text-sm font-medium">Message</label
			>
			<textarea
				id="sms-body"
				bind:value={body}
				placeholder="Write the SMS copy..."
				rows="5"
				maxlength={1600}
				class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
			></textarea>
			<div class="mt-2">
				<CharacterCounter length={bodyLength} />
			</div>
			{#if segmentCount > 1}
				<p class="text-text-tertiary mt-1 text-xs">
					This message sends as {segmentCount} text segments.
				</p>
			{/if}
		</div>

		<div id="action-record-link" class="border-surface-border mb-6 rounded-md border p-4">
			<label for="sms-campaign" class="text-text-tertiary mb-2 block text-sm font-medium"
				>Link to action record (optional)</label
			>
			<select
				id="sms-campaign"
				bind:value={campaignId}
				class="border-surface-border-strong bg-surface-raised text-text-primary focus:border-text-tertiary w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
			>
				<option value="">No action record</option>
				{#each data.campaigns as campaign (campaign.id)}
					<option value={campaign.id}>{campaign.title}</option>
				{/each}
			</select>
		</div>

		<div
			id="text-audience-snapshot"
			class="border-surface-border bg-surface-base mb-6 rounded-md border p-4"
		>
			<div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
				<div>
					<h2 class="text-text-secondary text-sm font-medium">Audience snapshot</h2>
					<p class="text-text-tertiary mt-1 text-xs">
						Counted after SMS subscription, encrypted phone presence, and saved filter rules.
					</p>
				</div>
				<div class="bg-surface-overlay rounded-md px-4 py-3 text-right">
					<p class="text-text-primary text-2xl leading-none font-semibold">
						<Datum value={audienceCount} />
					</p>
					<p class="text-text-tertiary mt-1 text-xs">
						{audienceCounting ? 'counting...' : 'eligible phones'}
					</p>
				</div>
			</div>

			<div class="mt-4 grid gap-4">
				{#if data.segments.length > 0}
					<div>
						<p class="text-text-tertiary mb-2 text-xs font-medium">Saved segments</p>
						<div class="flex flex-wrap gap-2">
							{#each data.segments as segment (segment.id)}
								<button
									type="button"
									aria-pressed={selectedSegmentIds.includes(segment.id)}
									onclick={() => toggleSegment(segment.id)}
									class="rounded-md border px-2.5 py-1 text-xs transition-colors {selectedSegmentIds.includes(
										segment.id
									)
										? 'border-teal-500/30 bg-teal-500/20 text-teal-300'
										: 'bg-surface-overlay text-text-tertiary border-surface-border-strong hover:border-text-quaternary'}"
								>
									{segment.name}
								</button>
							{/each}
						</div>
					</div>
				{/if}

				{#if data.tags.length > 0}
					<div>
						<p class="text-text-tertiary mb-2 text-xs font-medium">Include tags</p>
						<div class="flex flex-wrap gap-2">
							{#each data.tags as tag (tag.id)}
								<button
									type="button"
									aria-pressed={selectedTagIds.includes(tag.id)}
									onclick={() => toggleIncludedTag(tag.id)}
									class="rounded-md border px-2.5 py-1 text-xs transition-colors {selectedTagIds.includes(
										tag.id
									)
										? 'border-teal-500/30 bg-teal-500/20 text-teal-300'
										: 'bg-surface-overlay text-text-tertiary border-surface-border-strong hover:border-text-quaternary'}"
								>
									{tag.name}
								</button>
							{/each}
						</div>
					</div>

					<div>
						<p class="text-text-tertiary mb-2 text-xs font-medium">Exclude tags</p>
						<div class="flex flex-wrap gap-2">
							{#each data.tags as tag (tag.id)}
								<button
									type="button"
									aria-pressed={excludedTagIds.includes(tag.id)}
									onclick={() => toggleExcludedTag(tag.id)}
									class="rounded-md border px-2.5 py-1 text-xs transition-colors {excludedTagIds.includes(
										tag.id
									)
										? 'border-red-500/30 bg-red-500/15 text-red-300'
										: 'bg-surface-overlay text-text-tertiary border-surface-border-strong hover:border-text-quaternary'}"
								>
									{tag.name}
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			{#if audienceHasMoreThanBatchLimit}
				<p class="text-text-tertiary mt-3 text-xs">
					This audience sends in batches of {audienceBatchLimit} from the text's page.
				</p>
			{/if}
			{#if audienceCountError}
				<p class="mt-3 text-xs text-red-400">{audienceCountError}</p>
			{/if}
			{#if data.tags.length === 0 && data.segments.length === 0}
				<p class="text-text-tertiary mt-3 text-xs">
					No saved tags or segments are available; this draft targets all eligible subscribed
					phones.
				</p>
			{/if}
		</div>

		{#if body.trim()}
			<div class="border-surface-border mb-6 rounded-md border p-4">
				<h2 class="text-text-tertiary mb-3 text-sm font-medium">Preview</h2>
				<div class="bg-surface-overlay mx-auto max-w-xs rounded-lg px-4 py-3">
					<p class="text-text-primary text-sm whitespace-pre-wrap">{body.trim()}</p>
				</div>
			</div>
		{/if}

		<div class="flex items-center justify-end gap-3">
			<a
				href="/org/{data.org.slug}/sms"
				class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-lg border px-4 py-2 text-sm"
			>
				Cancel
			</a>
			<button
				onclick={() => saveDraft(false)}
				disabled={saving || !isValid}
				class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-md border px-4 py-2 text-sm disabled:opacity-50"
			>
				{saving ? 'Saving...' : 'Save draft'}
			</button>
			<button
				onclick={() => saveDraft(true)}
				disabled={saving || !canContinueToDispatch}
				class="border-surface-border-strong text-text-secondary rounded-md border px-4 py-2 text-sm hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-50"
			>
				{saving ? 'Saving...' : 'Save and continue to send'}
			</button>
		</div>
	</div>
</div>
