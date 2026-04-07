<script lang="ts">
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { page } from '$app/stores';
	import { invalidateAll } from '$app/navigation';
	import type { TemplateFormData } from '$lib/types/template';

	import {
		processDecisionMakers,
		extractRecipientEmails
	} from '$lib/utils/decision-maker-processing';
	import { parseSSEStream } from '$lib/utils/sse-stream';
	import AgentThinking from '$lib/components/ui/AgentThinking.svelte';
	import DecisionMakerResults from './DecisionMakerResults.svelte';
	import AuthGateOverlay from './AuthGateOverlay.svelte';

	interface Props {
		formData: TemplateFormData;
		onnext: () => void;
		onback: () => void;
		/** Draft ID for OAuth resumption */
		draftId?: string;
		/** Save draft callback for OAuth flow */
		onSaveDraft?: () => void;
	}

	let { formData = $bindable(), onnext, onback, draftId, onSaveDraft }: Props = $props();

	type Stage = 'resolving' | 'results' | 'error' | 'auth-required' | 'rate-limited';
	let stage = $state<Stage>('resolving');
	let errorMessage = $state<string | null>(null);
	let rateLimitResetAt = $state<string | null>(null);
	let isResolving = $state(false);

	// Streaming state
	let thoughts = $state<string[]>([]);

	// Progressive reveal state
	type PendingIdentity = {
		name: string;
		title: string;
		organization: string;
		status: 'pending' | 'cached' | 'resolved' | 'no-email' | 'failed';
		email?: string;
		reasoning?: string;
	};
	let pendingIdentities = $state<PendingIdentity[]>([]);
	let identitiesRevealed = $state(false);

	/**
	 * Build topics array with robust fallback chain
	 * 1. Use topics array if populated with valid entries
	 * 2. Fall back to domain (lowercased)
	 * 3. Ultimate fallback - empty array (domain carries the signal now)
	 */
	function buildTopics(): string[] {
		if (Array.isArray(formData.objective.topics) && formData.objective.topics.length > 0) {
			const valid = formData.objective.topics.filter((t) => t && t.trim());
			if (valid.length > 0) return valid;
		}
		if (formData.objective.domain && formData.objective.domain.trim()) {
			return [formData.objective.domain.toLowerCase().trim()];
		}
		return [];
	}

	/**
	 * Build voice sample with fallback chain
	 * Prefer AI-extracted voiceSample, fall back to rawInput, then description
	 */
	function buildVoiceSample(): string {
		return (
			formData.objective.voiceSample ||
			formData.objective.rawInput ||
			formData.objective.description ||
			''
		);
	}

	/** Normalize a string for fuzzy matching (lowercase, strip leading "the", trim). */
	function norm(s: string): string {
		return s.toLowerCase().replace(/^the\s+/, '').trim();
	}

	let authRetried = false;

	async function resolveDecisionMakers() {
		// Prevent concurrent calls
		if (isResolving) {
			console.log('[DecisionMakerResolver] Already resolving, skipping...');
			return;
		}

		isResolving = true;
		errorMessage = null;
		thoughts = [];
		pendingIdentities = [];
		identitiesRevealed = false;

		// Client-side idle timeout: aborts if no SSE event received for 3 minutes.
		// Resets on each event, so long-running research that's making progress
		// won't be killed. Only fires if the server truly stalls.
		// 3 minutes accommodates parallel Gemini synthesis chunks (~30-60s each)
		// which produce no intermediate events.
		const controller = new AbortController();
		let clientTimeout = setTimeout(() => controller.abort(), 180_000);
		function resetIdleTimeout() {
			clearTimeout(clientTimeout);
			clientTimeout = setTimeout(() => controller.abort(), 180_000);
		}

		try {
			// Resolve decision-makers via streaming endpoint
			stage = 'resolving';
			console.log('[DecisionMakerResolver] Starting streaming resolution...');

			// Seed thought stream with user's audience guidance (if provided)
			if (formData.objective.audienceGuidance) {
				thoughts = [`Starting from: ${formData.objective.audienceGuidance}`];
			}

			const topics = buildTopics();
			const voiceSample = buildVoiceSample();

			const response = await fetch('/api/agents/stream-decision-makers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include', // Ensure session cookie is sent after OAuth return
				signal: controller.signal,
				body: JSON.stringify({
					subject_line: formData.objective.title,
					core_message: formData.objective.description,
					topics,
					voice_sample: voiceSample,
					url_slug: formData.objective.slug,
					audience_guidance: formData.objective.audienceGuidance
				})
			});

			// Check for auth / rate-limit errors
			if (response.status === 429 || response.status === 401) {
				const errorData = await response.json().catch(() => ({}));
				console.log('[DecisionMakerResolver] Auth/rate error:', {
					status: response.status,
					error: errorData.error,
					tier: errorData.tier,
					remaining: errorData.remaining,
					limit: errorData.limit,
					resetAt: errorData.resetAt
				});

				// Guest with zero quota → auth gate
				if (response.status === 401 || errorData.tier === 'guest') {
					// Check if client-side page data says we're logged in.
					// If so, this is likely a transient auth error (DB hiccup),
					// not a genuine unauthenticated state. Retry once.
					const pageUser = $page.data.user;
					if (pageUser && !authRetried) {
						console.log('[DecisionMakerResolver] Page shows logged in but server rejected — retrying');
						authRetried = true;
						isResolving = false;
						// Refresh layout data to re-validate session
						await invalidateAll();
						// Brief delay for session re-establishment
						await new Promise(r => setTimeout(r, 500));
						return resolveDecisionMakers();
					}

					// If page also shows no user, or retry already failed → genuine auth gate
					if (pageUser && authRetried) {
						// Page STILL says logged in after retry — transient server issue.
						// Show retryable error instead of misleading auth gate.
						throw new Error('Could not verify your session. Please refresh and try again.');
					}
					throw { _kind: 'auth-required' };
				}

				// Authenticated/verified user who exhausted quota → rate-limited
				throw { _kind: 'rate-limited', resetAt: errorData.resetAt, message: errorData.error };
			}

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.error || 'Failed to resolve decision-makers');
			}

			// Process SSE stream — includes progressive reveal events
			for await (const event of parseSSEStream<Record<string, unknown>>(response)) {
				resetIdleTimeout();
				switch (event.type) {
					case 'segment': {
						const segment = event.data as { content?: string };
						if (typeof segment.content === 'string' && segment.content.trim()) {
							thoughts = [...thoughts, segment.content];
						}
						break;
					}

					case 'identity-found': {
						const identities = event.data as unknown as Array<{
							name: string; title: string; organization: string; status: string;
						}>;
						pendingIdentities = identities.map(id => ({
							name: id.name || '',
							title: id.title,
							organization: id.organization,
							status: id.status as PendingIdentity['status']
						}));
						identitiesRevealed = true;
						break;
					}

					case 'candidate-resolved': {
						const candidate = event.data as {
							name: string; title: string; organization: string;
							email?: string; status: string; reasoning?: string;
						};
						// Match pending identity using normalized fuzzy comparison.
						// Phase 2b model output may rephrase titles/orgs vs Phase 2a placeholders.
						const candOrg = norm(candidate.organization);
						const candTitle = norm(candidate.title);
						let matched = false;

						pendingIdentities = pendingIdentities.map(id => {
							if (matched) return id;
							const idOrg = norm(id.organization);
							const idTitle = norm(id.title);
							const orgMatch = idOrg === candOrg || idOrg.includes(candOrg) || candOrg.includes(idOrg);
							const titleMatch = idTitle === candTitle || idTitle.includes(candTitle) || candTitle.includes(idTitle);
							if (orgMatch && titleMatch) {
								matched = true;
								return {
									...id,
									name: candidate.name || id.name,
									email: candidate.email,
									reasoning: candidate.reasoning,
									status: candidate.status as PendingIdentity['status']
								};
							}
							return id;
						});

						// Fallback: match by org only against the first still-pending card
						if (!matched) {
							pendingIdentities = pendingIdentities.map(id => {
								if (matched || id.status !== 'pending') return id;
								if (norm(id.organization) === candOrg) {
									matched = true;
									return {
										...id,
										name: candidate.name || id.name,
										email: candidate.email,
										reasoning: candidate.reasoning,
										status: candidate.status as PendingIdentity['status']
									};
								}
								return id;
							});
						}

						// Discovered contacts have no matching pending identity — append as new card
						if (!matched && candidate.name) {
							pendingIdentities = [...pendingIdentities, {
								name: candidate.name,
								title: candidate.title,
								organization: candidate.organization,
								email: candidate.email,
								reasoning: candidate.reasoning,
								status: candidate.status as PendingIdentity['status']
							}];
						}
						break;
					}

					case 'complete': {
						const result = event.data as { decision_makers?: unknown[] };
						const rawDecisionMakers = result.decision_makers || [];
						const processed = processDecisionMakers(rawDecisionMakers as Parameters<typeof processDecisionMakers>[0]);

						// Initialize audience data if not already set
						if (!formData.audience) {
							formData.audience = {
								decisionMakers: [],
								recipientEmails: [],
								includesCongress: false,
								customRecipients: []
							};
						}

						formData.audience.decisionMakers = processed;
						formData.audience.resolvedForSubject = formData.objective.title;
						stage = 'results';
						break;
					}

					case 'error':
						throw new Error(
							typeof event.data.message === 'string'
								? event.data.message
								: 'Resolution failed'
						);
				}
			}
		} catch (err: any) {
			console.error('[DecisionMakerResolver] Error:', err);

			if (err?._kind === 'auth-required') {
				stage = 'auth-required';
			} else if (err?._kind === 'rate-limited') {
				rateLimitResetAt = err.resetAt ?? null;
				stage = 'rate-limited';
			} else if (err instanceof Error && err.name === 'AbortError') {
				errorMessage = 'Research took too long and was stopped. Please try again — it may go faster on retry.';
				stage = 'error';
			} else {
				errorMessage =
					err instanceof Error
						? err.message
						: 'Failed to resolve decision-makers. Please try again.';
				stage = 'error';
			}
		} finally {
			clearTimeout(clientTimeout);
			isResolving = false;
		}
	}

	/**
	 * Detect if we just returned from OAuth
	 * The oauth_completion cookie is set by the OAuth callback handler
	 */
	function isOAuthReturn(): boolean {
		if (typeof document === 'undefined') return false;
		return document.cookie.includes('oauth_completion');
	}

	/**
	 * Clear the OAuth completion cookie after use
	 */
	function clearOAuthCookie(): void {
		if (typeof document === 'undefined') return;
		document.cookie = 'oauth_completion=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
	}

	// Auto-run on mount (only if not already resolved)
	onMount(() => {
		const fromOAuth = isOAuthReturn();
		if (fromOAuth) {
			console.log('[DecisionMakerResolver] Detected OAuth return, clearing cookie');
			clearOAuthCookie();
		}

		// Only auto-resolve if we don't already have decision-makers
		if (!formData.audience?.decisionMakers || formData.audience.decisionMakers.length === 0) {
			console.log('[DecisionMakerResolver] No decision-makers, starting resolution', { fromOAuth });
			resolveDecisionMakers();
		} else {
			// Check if the objective changed since DMs were resolved.
			// If the subject line is different, the old DMs are stale — re-resolve.
			const resolvedFor = formData.audience.resolvedForSubject;
			const currentSubject = formData.objective.title;
			const isStale = resolvedFor && resolvedFor !== currentSubject;

			// Also detect corrupted draft data (no names on any AI-resolved DM).
			const isCorrupted = formData.audience.decisionMakers.every(
				(dm) => dm.isAiResolved && !dm.name
			);

			if (isStale) {
				console.log('[DecisionMakerResolver] Subject changed, clearing stale DMs', {
					resolvedFor, currentSubject
				});
				formData.audience.decisionMakers = [];
				formData.audience.resolvedForSubject = undefined;
				resolveDecisionMakers();
			} else if (isCorrupted) {
				console.log('[DecisionMakerResolver] Corrupted draft data (no names), re-resolving...');
				resolveDecisionMakers();
			} else {
				console.log('[DecisionMakerResolver] Restoring', formData.audience.decisionMakers.length, 'decision-makers from state');
				stage = 'results';
			}
		}
	});

	/**
	 * Skip agent resolution and go straight to results with empty AI list.
	 * User can still add custom recipients manually.
	 */
	function skipToManualRecipients() {
		if (!formData.audience) {
			formData.audience = {
				decisionMakers: [],
				recipientEmails: [],
				includesCongress: false,
				customRecipients: []
			};
		}
		stage = 'results';
	}

	function handleNext() {
		// Ensure recipientEmails is updated from decision-makers
		formData.audience.recipientEmails = extractRecipientEmails(
			formData.audience.decisionMakers,
			formData.audience.customRecipients,
			formData.audience.includesCongress
		);

		onnext();
	}
</script>

<div class="mx-auto max-w-3xl">
	{#if stage === 'resolving'}
		{#if !identitiesRevealed}
			<!-- Phase 1: thoughts only (no cards yet) -->
			<AgentThinking {thoughts} isActive={true} context="Finding decision-makers" />
		{:else}
			<!-- Phase 2: compressed thoughts + progressive cards -->
			<div class="split-view">
				<AgentThinking {thoughts} isActive={true} context="Searching contacts" compact />

				<div class="progressive-cards">
					{#each pendingIdentities as identity, i (i)}
						<div
							class="identity-card"
							class:resolved={identity.status === 'resolved' || identity.status === 'cached'}
							class:no-email={identity.status === 'no-email'}
							class:pending={identity.status === 'pending'}
							transition:slide={{ duration: 200, delay: i * 50 }}
						>
							<div class="card-status">
								{#if identity.status === 'pending'}
									<span class="status-dot pending-pulse"></span>
								{:else if identity.status === 'resolved' || identity.status === 'cached'}
									<span class="status-dot resolved"></span>
								{:else}
									<span class="status-dot no-email"></span>
								{/if}
							</div>
							<div class="card-content">
								<p class="card-name">
									{identity.name || identity.title}
								</p>
								<p class="card-org">
									{identity.title}{identity.organization ? ` · ${identity.organization}` : ''}
								</p>
								{#if identity.email}
									<p class="card-email">{identity.email}</p>
								{:else if identity.status === 'pending'}
									<p class="card-searching">Searching...</p>
								{:else if identity.status === 'no-email'}
									<p class="card-no-email">No public email found</p>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{:else if stage === 'results'}
		<!-- Results display -->
		<DecisionMakerResults
			bind:decisionMakers={formData.audience.decisionMakers}
			bind:customRecipients={formData.audience.customRecipients}
			bind:includesCongress={formData.audience.includesCongress}
			audienceGuidance={formData.objective.audienceGuidance}
			onupdate={(data) => {
				formData.audience = { ...formData.audience, ...data };
			}}
		/>

		<!-- Navigation -->
		<div class="mt-8 flex items-center justify-between border-t border-slate-200 pt-6">
			<button
				type="button"
				onclick={onback}
				class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
			>
				← Back
			</button>

			<button
				type="button"
				onclick={handleNext}
				disabled={formData.audience.decisionMakers.filter(dm => dm.email).length === 0 &&
					formData.audience.customRecipients.length === 0 &&
					!formData.audience.includesCongress}
				class="inline-flex items-center gap-2 rounded-lg bg-participation-primary-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-participation-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
			>
				Next →
			</button>
		</div>
	{:else if stage === 'error'}
		<!-- Error state -->
		<div class="space-y-4 py-8">
			<div class="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
				<p class="text-lg font-semibold text-red-900">Something went wrong</p>
				<p class="mt-2 text-sm text-red-700">{errorMessage}</p>
			</div>

			<div class="flex items-center justify-center gap-4">
				<button
					type="button"
					onclick={resolveDecisionMakers}
					class="inline-flex items-center gap-2 rounded-lg bg-participation-primary-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-participation-primary-700"
				>
					Try again
				</button>

				<button
					type="button"
					onclick={onback}
					class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
				>
					Go back
				</button>
			</div>
		</div>
	{:else if stage === 'rate-limited'}
		<!-- Rate limit reached — friendly, non-blocking -->
		<div class="space-y-6 py-8">
			<div class="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
				<p class="text-base font-semibold text-amber-900">
					Research limit reached
				</p>
				<p class="mx-auto mt-2 max-w-md text-sm text-amber-700">
					You've used all your decision-maker lookups for now.
					{#if rateLimitResetAt}
						Resets at {new Date(rateLimitResetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
					{/if}
					You can still add recipients manually below.
				</p>
			</div>

			<div class="flex items-center justify-center gap-4">
				<button
					type="button"
					onclick={skipToManualRecipients}
					class="inline-flex items-center gap-2 rounded-lg bg-participation-primary-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-participation-primary-700"
				>
					Add recipients manually
				</button>

				<button
					type="button"
					onclick={onback}
					class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
				>
					Go back
				</button>
			</div>
		</div>
	{:else if stage === 'auth-required'}
		<!-- Auth required - progressive commitment overlay -->
		<div class="relative min-h-[400px]">
			<!-- Auth overlay (full coverage) -->
			<AuthGateOverlay
				subjectLine={formData.objective.title}
				coreMessage={formData.objective.description}
				onback={onback}
				{draftId}
				{onSaveDraft}
			/>
		</div>
	{/if}
</div>

<style>
	.split-view {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.progressive-cards {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.identity-card {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		border: 1px solid #e2e8f0;
		background: white;
		transition: all 0.3s ease-out;
	}

	.identity-card.resolved {
		border-color: #86efac;
		background: #f0fdf4;
	}

	.identity-card.no-email {
		border-color: #fde68a;
		background: #fffbeb;
	}

	.identity-card.pending {
		border-color: #e2e8f0;
	}

	.card-status {
		flex-shrink: 0;
		padding-top: 0.125rem;
	}

	.status-dot {
		display: block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.status-dot.resolved {
		background: #22c55e;
	}

	.status-dot.no-email {
		background: #f59e0b;
	}

	.status-dot.pending-pulse {
		background: #94a3b8;
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 0.4; }
		50% { opacity: 1; }
	}

	.card-content {
		min-width: 0;
	}

	.card-name {
		font-weight: 600;
		font-size: 0.875rem;
		color: #1e293b;
		margin: 0;
	}

	.card-org {
		font-size: 0.75rem;
		color: #64748b;
		margin: 0.125rem 0 0;
	}

	.card-email {
		font-size: 0.75rem;
		color: #16a34a;
		margin: 0.25rem 0 0;
	}

	.card-searching {
		font-size: 0.75rem;
		color: #94a3b8;
		font-style: italic;
		margin: 0.25rem 0 0;
	}

	.card-no-email {
		font-size: 0.75rem;
		color: #d97706;
		margin: 0.25rem 0 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.status-dot.pending-pulse {
			animation: none;
			opacity: 0.7;
		}
	}
</style>
