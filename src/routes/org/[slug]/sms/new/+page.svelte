<script lang="ts">
	import CharacterCounter from '$lib/components/sms/CharacterCounter.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let body = $state('');
	let campaignId = $state('');
	let saving = $state(false);
	let sending = $state(false);
	let errorMsg = $state('');

	const bodyLength = $derived(body.length);
	const segmentCount = $derived(Math.ceil(bodyLength / 160) || 1);
	const isValid = $derived(body.trim().length > 0 && bodyLength <= 1600);

	async function saveDraft() {
		if (!body.trim()) {
			errorMsg = 'Message body is required';
			return;
		}
		if (bodyLength > 1600) {
			errorMsg = 'Message exceeds 1600 character limit';
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
					campaignId: campaignId || null
				})
			});

			if (res.ok) {
				const result = await res.json();
				window.location.href = `/org/${data.org.slug}/sms/${result.id}`;
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

	async function sendNow() {
		if (!body.trim()) {
			errorMsg = 'Message body is required';
			return;
		}
		if (bodyLength > 1600) {
			errorMsg = 'Message exceeds 1600 character limit';
			return;
		}

		sending = true;
		errorMsg = '';

		try {
			// Step 1: Create draft
			const createRes = await fetch(`/api/org/${data.org.slug}/sms`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					body: body.trim(),
					campaignId: campaignId || null
				})
			});

			if (!createRes.ok) {
				const err = await createRes.json().catch(() => null);
				errorMsg = err?.error ?? `Failed to create (${createRes.status})`;
				return;
			}

			const { id } = await createRes.json();

			// Step 2: Send
			const sendRes = await fetch(`/api/org/${data.org.slug}/sms/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'send' })
			});

			if (sendRes.ok) {
				window.location.href = `/org/${data.org.slug}/sms/${id}`;
			} else {
				const err = await sendRes.json().catch(() => null);
				errorMsg = err?.error ?? `Failed to send (${sendRes.status})`;
				// Still redirect since draft was created
				window.location.href = `/org/${data.org.slug}/sms/${id}`;
			}
		} catch {
			errorMsg = 'Network error';
		} finally {
			sending = false;
		}
	}
</script>

<svelte:head>
	<title>New SMS Campaign | {data.org.name}</title>
</svelte:head>

<div class="min-h-screen bg-surface-raised text-text-primary">
	<div class="mx-auto max-w-4xl px-4 py-8">
		<!-- Back link -->
		<a href="/org/{data.org.slug}/sms" class="mb-6 inline-block text-sm text-text-tertiary hover:text-text-primary">
			&larr; All SMS Campaigns
		</a>

		<h1 class="mb-8 text-2xl font-bold text-text-primary">New SMS Campaign</h1>

		<!-- Error -->
		{#if errorMsg}
			<div class="mb-6 rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400">
				{errorMsg}
			</div>
		{/if}

		<!-- Message Body -->
		<div class="mb-6 rounded-lg border border-surface-border p-4">
			<label for="sms-body" class="mb-2 block text-sm font-medium text-text-tertiary">Message</label>
			<textarea
				id="sms-body"
				bind:value={body}
				placeholder="Type your SMS message..."
				rows="5"
				maxlength={1600}
				class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-text-tertiary focus:outline-none"
			></textarea>
			<div class="mt-2">
				<CharacterCounter length={bodyLength} />
			</div>
			{#if segmentCount > 1}
				<p class="mt-1 text-xs text-text-tertiary">
					This message will be sent as {segmentCount} segments. Carriers may charge per segment.
				</p>
			{/if}
		</div>

		<!-- Campaign Link -->
		<div class="mb-6 rounded-lg border border-surface-border p-4">
			<label for="sms-campaign" class="mb-2 block text-sm font-medium text-text-tertiary">Link to Campaign (optional)</label>
			<select
				id="sms-campaign"
				bind:value={campaignId}
				class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-text-tertiary focus:outline-none"
			>
				<option value="">No campaign</option>
				{#each data.campaigns as campaign (campaign.id)}
					<option value={campaign.id}>{campaign.title}</option>
				{/each}
			</select>
		</div>

		<!-- Preview -->
		{#if body.trim()}
			<div class="mb-6 rounded-lg border border-surface-border p-4">
				<h2 class="mb-3 text-sm font-medium text-text-tertiary">Preview</h2>
				<div class="mx-auto max-w-xs rounded-lg bg-surface-overlay px-4 py-3">
					<p class="whitespace-pre-wrap text-sm text-text-primary">{body.trim()}</p>
				</div>
			</div>
		{/if}

		<!-- Actions -->
		<div class="flex items-center justify-end gap-3">
			<a
				href="/org/{data.org.slug}/sms"
				class="rounded-lg border border-surface-border-strong px-4 py-2 text-sm text-text-secondary hover:border-text-tertiary hover:text-text-primary"
			>
				Cancel
			</a>
			<button
				onclick={saveDraft}
				disabled={saving || sending || !isValid}
				class="rounded-lg border border-surface-border-strong px-4 py-2 text-sm text-text-secondary hover:border-text-tertiary hover:text-text-primary disabled:opacity-50"
			>
				{saving ? 'Saving...' : 'Save Draft'}
			</button>
			<button
				onclick={sendNow}
				disabled={saving || sending || !isValid}
				class="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
			>
				{sending ? 'Sending...' : 'Send Now'}
			</button>
		</div>
	</div>
</div>
