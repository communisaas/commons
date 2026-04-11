<script lang="ts">
	import CallLogTable from '$lib/components/sms/CallLogTable.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let showModal = $state(false);
	let supporterSearch = $state('');
	let supporters = $state<Array<{ id: string; name: string; email: string; phone: string }>>([]);
	let searching = $state(false);
	let selectedSupporter = $state<{ id: string; name: string; phone: string } | null>(null);
	let targetPhone = $state('');
	let targetName = $state('');
	let callCampaignId = $state('');
	let initiating = $state(false);
	let errorMsg = $state('');
	let statusFilter = $state('');

	const filteredCalls = $derived(
		statusFilter ? data.calls.filter((c) => c.status === statusFilter) : data.calls
	);

	async function searchSupporters() {
		if (supporterSearch.trim().length < 2) return;
		searching = true;
		try {
			const res = await fetch(
				`/api/org/${data.org.slug}/supporters?search=${encodeURIComponent(supporterSearch.trim())}&hasPhone=true&limit=10`
			);
			if (res.ok) {
				const result = await res.json();
				supporters = (result.data ?? result.supporters ?? []).filter(
					(s: { phone?: string }) => s.phone
				);
			}
		} catch {
			/* ignore */
		} finally {
			searching = false;
		}
	}

	function selectSupporter(s: { id: string; name: string; phone: string }) {
		selectedSupporter = s;
		supporterSearch = s.name;
		supporters = [];
	}

	async function initiateCall() {
		if (!selectedSupporter) {
			errorMsg = 'Select a supporter';
			return;
		}
		if (!targetPhone.trim()) {
			errorMsg = 'Target phone number is required';
			return;
		}

		initiating = true;
		errorMsg = '';

		try {
			const res = await fetch(`/api/org/${data.org.slug}/calls`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					supporterId: selectedSupporter.id,
					targetPhone: targetPhone.trim(),
					targetName: targetName.trim() || null,
					campaignId: callCampaignId || null
				})
			});

			if (res.ok) {
				showModal = false;
				resetForm();
				window.location.reload();
			} else {
				const err = await res.json().catch(() => null);
				errorMsg = err?.error ?? `Failed to initiate call (${res.status})`;
			}
		} catch {
			errorMsg = 'Network error';
		} finally {
			initiating = false;
		}
	}

	function resetForm() {
		supporterSearch = '';
		supporters = [];
		selectedSupporter = null;
		targetPhone = '';
		targetName = '';
		callCampaignId = '';
		errorMsg = '';
	}
</script>

<svelte:head>
	<title>Patch-Through Calls | {data.org.name}</title>
</svelte:head>

<div class="min-h-screen bg-surface-raised text-text-primary">
	<div class="mx-auto max-w-4xl px-4 py-8">
		<!-- Header -->
		<div class="mb-8 flex items-center justify-between">
			<h1 class="text-2xl font-bold text-text-primary">Patch-Through Calls</h1>
			<button
				onclick={() => { showModal = true; }}
				class="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500"
			>
				Initiate Call
			</button>
		</div>

		<!-- Filter -->
		<div class="mb-6">
			<select
				bind:value={statusFilter}
				class="rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-text-tertiary focus:outline-none"
			>
				<option value="">All statuses</option>
				<option value="initiated">Initiated</option>
				<option value="ringing">Ringing</option>
				<option value="in-progress">In Progress</option>
				<option value="completed">Completed</option>
				<option value="failed">Failed</option>
				<option value="no-answer">No Answer</option>
				<option value="busy">Busy</option>
			</select>
		</div>

		<!-- Call Log -->
		<CallLogTable calls={filteredCalls} />
	</div>
</div>

<!-- Initiate Call Modal -->
{#if showModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="mx-4 w-full max-w-lg rounded-md border border-surface-border bg-surface-raised p-6"
			onclick={(e) => e.stopPropagation()}
		>
			<h2 class="mb-4 text-lg font-bold text-text-primary">Initiate Patch-Through Call</h2>

			{#if errorMsg}
				<div class="mb-4 rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400">
					{errorMsg}
				</div>
			{/if}

			<!-- Supporter Search -->
			<div class="mb-4">
				<label for="call-supporter" class="mb-1 block text-sm font-medium text-text-tertiary">Supporter</label>
				<div class="relative">
					<input
						id="call-supporter"
						type="text"
						bind:value={supporterSearch}
						oninput={searchSupporters}
						placeholder="Search by name or email..."
						class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-text-tertiary focus:outline-none"
					/>
					{#if supporters.length > 0}
						<div class="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-y-auto rounded-lg border border-surface-border-strong bg-surface-raised">
							{#each supporters as s (s.id)}
								<button
									onclick={() => selectSupporter(s)}
									class="w-full px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-overlay"
								>
									{s.name} &middot; {s.phone}
								</button>
							{/each}
						</div>
					{/if}
				</div>
				{#if selectedSupporter}
					<p class="mt-1 text-xs text-green-400">Selected: {selectedSupporter.name} ({selectedSupporter.phone})</p>
				{/if}
			</div>

			<!-- Target Phone -->
			<div class="mb-4">
				<label for="call-target-phone" class="mb-1 block text-sm font-medium text-text-tertiary">Target Phone (E.164)</label>
				<input
					id="call-target-phone"
					type="tel"
					bind:value={targetPhone}
					placeholder="+12025551234"
					class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-text-tertiary focus:outline-none"
				/>
			</div>

			<!-- Target Name -->
			<div class="mb-4">
				<label for="call-target-name" class="mb-1 block text-sm font-medium text-text-tertiary">Target Name (optional)</label>
				<input
					id="call-target-name"
					type="text"
					bind:value={targetName}
					placeholder="e.g. Rep. Smith"
					class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-text-tertiary focus:outline-none"
				/>
			</div>

			<!-- Campaign -->
			<div class="mb-6">
				<label for="call-campaign" class="mb-1 block text-sm font-medium text-text-tertiary">Campaign (optional)</label>
				<select
					id="call-campaign"
					bind:value={callCampaignId}
					class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-text-tertiary focus:outline-none"
				>
					<option value="">No campaign</option>
					{#each data.campaigns as campaign (campaign.id)}
						<option value={campaign.id}>{campaign.title}</option>
					{/each}
				</select>
			</div>

			<!-- Buttons -->
			<div class="flex items-center justify-end gap-3">
				<button
					onclick={() => { showModal = false; resetForm(); }}
					class="rounded-lg border border-surface-border-strong px-4 py-2 text-sm text-text-secondary hover:border-text-tertiary hover:text-text-primary"
				>
					Cancel
				</button>
				<button
					onclick={initiateCall}
					disabled={initiating || !selectedSupporter || !targetPhone.trim()}
					class="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
				>
					{initiating ? 'Initiating...' : 'Connect Call'}
				</button>
			</div>
		</div>
	</div>
{/if}
