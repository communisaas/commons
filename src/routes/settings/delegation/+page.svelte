<script lang="ts">
	/**
	 * Delegation Settings Page
	 *
	 * Manage AI delegation grants: create, pause, revoke.
	 * Review pending actions and view delegation history.
	 * Requires Trust Tier 3+.
	 */
	import { Shield, Plus, Pause, Play, Trash2, Check, X, Bot, Clock, Zap } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Creation flow state
	let showCreate = $state(false);
	let policyInput = $state('');
	let parsing = $state(false);
	let parsedPolicy = $state<{
		scope: string;
		issueFilter: string[];
		orgFilter: string[];
		maxActionsPerDay: number;
		requireReviewAbove: number;
	} | null>(null);
	let createStep = $state<'input' | 'review'>('input');
	let creating = $state(false);
	let createError = $state('');

	// Editable fields after parsing
	let editScope = $state('campaign_sign');
	let editMaxActions = $state(5);
	let editReviewAbove = $state(10);
	let editIssues = $state('');
	let editExpiry = $state('');

	// Action states
	let actionLoading = $state<Record<string, boolean>>({});

	const scopeLabels: Record<string, string> = {
		campaign_sign: 'Sign Campaigns',
		debate_position: 'Debate Positions',
		message_generate: 'Generate Messages',
		full: 'Full Access'
	};

	const statusColors: Record<string, string> = {
		active: 'text-emerald-700',
		paused: 'text-amber-700',
		revoked: 'text-red-700',
		expired: 'text-slate-500'
	};

	async function parsePolicy() {
		parsing = true;
		createError = '';
		try {
			const res = await fetch('/api/delegation/parse-policy', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ policyText: policyInput })
			});
			if (!res.ok) {
				const err = await res.json();
				createError = err.message || 'Failed to parse policy';
				return;
			}
			const { policy } = await res.json();
			parsedPolicy = policy;
			editScope = policy.scope;
			editMaxActions = policy.maxActionsPerDay;
			editReviewAbove = policy.requireReviewAbove;
			editIssues = policy.issueFilter.join(', ');
			createStep = 'review';
		} catch {
			createError = 'Network error. Please try again.';
		} finally {
			parsing = false;
		}
	}

	async function createGrant() {
		creating = true;
		createError = '';
		try {
			const issueFilter = editIssues
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
			const res = await fetch('/api/delegation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					scope: editScope,
					policyText: policyInput,
					issueFilter,
					maxActionsPerDay: editMaxActions,
					requireReviewAbove: editReviewAbove,
					expiresAt: editExpiry || null
				})
			});
			if (!res.ok) {
				const err = await res.json();
				createError = err.message || 'Failed to create grant';
				return;
			}
			// Reset and reload
			showCreate = false;
			policyInput = '';
			parsedPolicy = null;
			createStep = 'input';
			await invalidateAll();
		} catch {
			createError = 'Network error. Please try again.';
		} finally {
			creating = false;
		}
	}

	async function toggleGrant(id: string, currentStatus: string) {
		actionLoading[id] = true;
		const newStatus = currentStatus === 'active' ? 'paused' : 'active';
		try {
			await fetch(`/api/delegation/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: newStatus })
			});
			await invalidateAll();
		} finally {
			actionLoading[id] = false;
		}
	}

	async function revokeGrant(id: string) {
		actionLoading[id] = true;
		try {
			await fetch(`/api/delegation/${id}`, { method: 'DELETE' });
			await invalidateAll();
		} finally {
			actionLoading[id] = false;
		}
	}

	async function reviewAction(reviewId: string, decision: 'approve' | 'reject') {
		actionLoading[reviewId] = true;
		try {
			await fetch(`/api/delegation/review/${reviewId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ decision })
			});
			await invalidateAll();
		} finally {
			actionLoading[reviewId] = false;
		}
	}

	function resetCreate() {
		showCreate = false;
		policyInput = '';
		parsedPolicy = null;
		createStep = 'input';
		createError = '';
	}
</script>

<svelte:head>
	<title>Delegation Settings - Commons</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-5 py-8 sm:px-8">
	<!-- Header -->
	<div class="mb-8">
		<div class="flex items-center gap-3 mb-2">
			<Bot class="h-6 w-6 text-slate-600" />
			<h1 class="text-2xl font-semibold text-slate-900">Agentic Delegation</h1>
		</div>
		<p class="text-sm text-slate-500">
			Authorize an AI agent to take civic actions on your behalf within policy constraints.
		</p>
	</div>

	<!-- Trust Tier Gate -->
	{#if data.gated}
		<div class="rounded-md border border-slate-200 bg-white p-8 text-center">
			<Shield class="mx-auto h-12 w-12 text-slate-300 mb-4" />
			<h2 class="text-lg font-medium text-slate-800 mb-2">Identity Verification Required</h2>
			<p class="text-sm text-slate-500 mb-4">
				Delegation requires Trust Tier 3+ (identity-verified). Your current tier is {data.user.trust_tier}.
			</p>
			<a
				href="/profile"
				class="inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
			>
				Verify Identity
			</a>
		</div>
	{:else}
		<!-- Active Grants -->
		<section class="mb-10">
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-lg font-medium text-slate-800">Active Grants</h2>
				<button
					onclick={() => (showCreate = true)}
					class="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
				>
					<Plus class="h-3.5 w-3.5" />
					Create Delegation
				</button>
			</div>

			{#if data.grants.length === 0}
				<div class="rounded-md border border-dashed border-slate-200 p-8 text-center">
					<Bot class="mx-auto h-10 w-10 text-slate-300 mb-3" />
					<p class="text-sm text-slate-500">No delegation grants yet. Create one to get started.</p>
				</div>
			{:else}
				<div class="space-y-3">
					{#each data.grants as grant}
						<div class="rounded-md border border-slate-200 bg-white p-5">
							<div class="flex items-start justify-between mb-3">
								<div>
									<div class="flex items-center gap-2 mb-1">
										<span class="font-mono text-xs {statusColors[grant.status] || 'text-slate-500'}">
											{grant.status}
										</span>
										<span class="font-mono text-xs text-blue-700">
											{scopeLabels[grant.scope] || grant.scope}
										</span>
									</div>
									<p class="text-sm text-slate-700 mt-1">{grant.policyText}</p>
								</div>
								<div class="flex items-center gap-1 ml-4 shrink-0">
									{#if grant.status === 'active' || grant.status === 'paused'}
										<button
											onclick={() => toggleGrant(grant.id, grant.status)}
											disabled={actionLoading[grant.id]}
											class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
											title={grant.status === 'active' ? 'Pause' : 'Resume'}
										>
											{#if grant.status === 'active'}
												<Pause class="h-4 w-4" />
											{:else}
												<Play class="h-4 w-4" />
											{/if}
										</button>
										<button
											onclick={() => revokeGrant(grant.id)}
											disabled={actionLoading[grant.id]}
											class="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
											title="Revoke"
										>
											<Trash2 class="h-4 w-4" />
										</button>
									{/if}
								</div>
							</div>
							<div class="flex items-center gap-4 text-xs text-slate-400">
								<span class="flex items-center gap-1">
									<Zap class="h-3 w-3" />
									{grant.totalActions} actions
								</span>
								<span>Max {grant.maxActionsPerDay}/day</span>
								{#if grant.issueFilter.length > 0}
									<span>Issues: {grant.issueFilter.join(', ')}</span>
								{/if}
								{#if grant.expiresAt}
									<span class="flex items-center gap-1">
										<Clock class="h-3 w-3" />
										Expires {new Date(grant.expiresAt).toLocaleDateString()}
									</span>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Creation Flow -->
		{#if showCreate}
			<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
				<div class="w-full max-w-lg rounded-lg bg-white p-6 shadow-md">
					<div class="flex items-center justify-between mb-4">
						<h3 class="text-lg font-medium text-slate-900">
							{createStep === 'input' ? 'Describe Your Policy' : 'Review Parsed Policy'}
						</h3>
						<button onclick={resetCreate} class="text-slate-400 hover:text-slate-600">
							<X class="h-5 w-5" />
						</button>
					</div>

					{#if createStep === 'input'}
						<p class="text-sm text-slate-500 mb-4">
							Describe what you'd like your agent to do in plain language.
						</p>
						<textarea
							bind:value={policyInput}
							class="w-full rounded-lg border border-slate-200 p-3 text-sm text-slate-700 placeholder-slate-400 focus:border-slate-400 focus:outline-none resize-none"
							rows="4"
							placeholder="e.g., Sign climate petitions in my district, max 3 per day. Review anything with high proof weight."
						></textarea>
						{#if createError}
							<p class="mt-2 text-xs text-red-600">{createError}</p>
						{/if}
						<div class="mt-4 flex justify-end gap-2">
							<button
								onclick={resetCreate}
								class="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
							>
								Cancel
							</button>
							<button
								onclick={parsePolicy}
								disabled={parsing || policyInput.trim().length < 5}
								class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
							>
								{parsing ? 'Parsing...' : 'Parse Policy'}
							</button>
						</div>
					{:else}
						<div class="space-y-4">
							<div>
								<label for="scope" class="block text-xs font-medium text-slate-500 mb-1">Scope</label>
								<select
									id="scope"
									bind:value={editScope}
									class="w-full rounded-lg border border-slate-200 p-2 text-sm"
								>
									<option value="campaign_sign">Sign Campaigns</option>
									<option value="debate_position">Debate Positions</option>
									<option value="message_generate">Generate Messages</option>
									<option value="full">Full Access</option>
								</select>
							</div>
							<div>
								<label for="issues" class="block text-xs font-medium text-slate-500 mb-1">Issue Domains (comma-separated)</label>
								<input
									id="issues"
									type="text"
									bind:value={editIssues}
									class="w-full rounded-lg border border-slate-200 p-2 text-sm"
									placeholder="climate, housing, healthcare"
								/>
							</div>
							<div class="grid grid-cols-2 gap-3">
								<div>
									<label for="maxActions" class="block text-xs font-medium text-slate-500 mb-1">Max Actions/Day</label>
									<input
										id="maxActions"
										type="number"
										bind:value={editMaxActions}
										min="1"
										max="20"
										class="w-full rounded-lg border border-slate-200 p-2 text-sm"
									/>
								</div>
								<div>
									<label for="reviewThreshold" class="block text-xs font-medium text-slate-500 mb-1">Review Above (proof weight)</label>
									<input
										id="reviewThreshold"
										type="number"
										bind:value={editReviewAbove}
										min="0"
										step="0.1"
										class="w-full rounded-lg border border-slate-200 p-2 text-sm"
									/>
								</div>
							</div>
							<div>
								<label for="expiry" class="block text-xs font-medium text-slate-500 mb-1">Expiry Date (optional)</label>
								<input
									id="expiry"
									type="date"
									bind:value={editExpiry}
									class="w-full rounded-lg border border-slate-200 p-2 text-sm"
								/>
							</div>
							{#if createError}
								<p class="text-xs text-red-600">{createError}</p>
							{/if}
						</div>
						<div class="mt-5 flex justify-end gap-2">
							<button
								onclick={() => (createStep = 'input')}
								class="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
							>
								Back
							</button>
							<button
								onclick={createGrant}
								disabled={creating}
								class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
							>
								{creating ? 'Creating...' : 'Confirm & Activate'}
							</button>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Review Queue -->
		{#if data.pendingReviews.length > 0}
			<section class="mb-10">
				<h2 class="text-lg font-medium text-slate-800 mb-4">Pending Reviews</h2>
				<div class="space-y-3">
					{#each data.pendingReviews as review}
						<div class="rounded-md border border-amber-100 bg-amber-50/30 p-4">
							<div class="flex items-start justify-between">
								<div>
									<p class="text-sm font-medium text-slate-800">{review.targetTitle}</p>
									<p class="text-xs text-slate-500 mt-1">{review.reasoning}</p>
									<div class="flex items-center gap-3 mt-2 text-xs text-slate-400">
										<span>Proof weight: {review.proofWeight}</span>
										<span>{new Date(review.createdAt).toLocaleDateString()}</span>
									</div>
								</div>
								<div class="flex items-center gap-1 ml-4 shrink-0">
									<button
										onclick={() => reviewAction(review.id, 'approve')}
										disabled={actionLoading[review.id]}
										class="rounded-lg bg-emerald-50 p-1.5 text-emerald-600 hover:bg-emerald-100 transition-colors"
										title="Approve"
									>
										<Check class="h-4 w-4" />
									</button>
									<button
										onclick={() => reviewAction(review.id, 'reject')}
										disabled={actionLoading[review.id]}
										class="rounded-lg bg-red-50 p-1.5 text-red-600 hover:bg-red-100 transition-colors"
										title="Reject"
									>
										<X class="h-4 w-4" />
									</button>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Action History -->
		{#if data.recentActions.length > 0}
			<section>
				<h2 class="text-lg font-medium text-slate-800 mb-4">Recent Actions</h2>
				<div class="rounded-md border border-slate-200 bg-white divide-y divide-slate-100">
					{#each data.recentActions as action}
						<div class="p-4">
							<div class="flex items-center justify-between">
								<div>
									<div class="flex items-center gap-2 mb-0.5">
										<span class="text-sm font-medium text-slate-700">{action.targetTitle}</span>
										<span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
											{scopeLabels[action.actionType] || action.actionType}
										</span>
									</div>
									<p class="text-xs text-slate-400 line-clamp-1">{action.reasoning}</p>
								</div>
								<div class="text-right text-xs text-slate-400 shrink-0 ml-4">
									<div>{new Date(action.createdAt).toLocaleDateString()}</div>
									<div>Score: {action.relevanceScore.toFixed(2)}</div>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>
