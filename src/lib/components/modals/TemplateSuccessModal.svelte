<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import {
		CheckCircle,
		Clock,
		Share2,
		LayoutDashboard,
		X,
		Link,
		Check,
		AlertCircle,
		ChevronRight
	} from '@lucide/svelte';
	import type { Template } from '$lib/types/template';
	import { parseRecipientConfig } from '$lib/types/template';
	import { Datum, Ratio } from '$lib/design';
	import { formatCapabilityClusters } from '$lib/data/capability-clusters';
	import {
		buildPublicActionPublishContractRows,
		getGateEvidence,
		type PublicActionPublishContractRow
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel,
		operatorCapabilityStateRatioSegments
	} from '$lib/data/capability-state-labels';
	import { supportsWebShare, copyToClipboard as clipboardCopy } from '$lib/utils/browserUtils';
	import { generateShareMessage } from '$lib/utils/share-messages';

	let {
		template,
		publishing = false,
		error = null,
		onclose,
		onretry,
		ondashboard,
		onsend
	}: {
		template: Template;
		publishing?: boolean;
		error?: string | null;
		onclose?: () => void;
		onretry?: () => void;
		ondashboard?: () => void;
		onsend?: () => void;
	} = $props();

	const recipientConfig = $derived(parseRecipientConfig(template.recipient_config));
	const targetCount = $derived(
		(recipientConfig.decisionMakers?.length ?? 0) +
			(recipientConfig.customRecipients?.length ?? 0) +
			(recipientConfig.includesCongress ? 1 : 0)
	);
	// Extract decision-maker names from recipient_config for the reader-route preview.
	const recipientNames = $derived(
		(() => {
			const dms = recipientConfig.decisionMakers ?? [];
			return dms.map((dm) => dm.name).filter(Boolean);
		})()
	);

	const actionRoutePreviewText = $derived(
		(() => {
			if (recipientNames.length === 0) {
				return template.deliveryMethod === 'cwc'
					? 'Action page opens representative confirmation'
					: 'Action page opens reader confirmation';
			}
			const [first, second, ...rest] = recipientNames;
			if (recipientNames.length === 1) return `Action page targets ${first}`;
			if (rest.length === 0) return `Action page targets ${first} and ${second}`;
			return `Action page targets ${first}, ${second}, and ${rest.length} other${rest.length === 1 ? '' : 's'}`;
		})()
	);

	let copied = $state(false);
	let shareUrl = $derived(
		`${typeof window !== 'undefined' ? window.location.origin : ''}/s/${template.slug}`
	);

	let shareMessage = $derived(
		generateShareMessage(
			{
				template: {
					title: template.title,
					domain: template.domain || 'advocacy',
					description: template.description || template.preview
				},
				contactedNames: [],
				totalRecipients: 0,
				shareUrl
			},
			'medium'
		)
	);

	// State derivations
	let isPublished = $derived(
		!publishing && !error && template.status === 'published' && template.is_public
	);
	let isDraft = $derived(
		!publishing && !error && (template.status === 'draft' || !template.is_public)
	);
	let showShareActions = $derived(isPublished);
	let hasError = $derived(!!error);
	let useNativeShare = supportsWebShare();
	const actionRouteTitle =
		'Opens the public action route; reader-side send confirmation remains on that route.';
	const SOURCE_EVALUATION_FALLBACK_PREFIX = 'Evaluation unavailable';
	const sourceCount = $derived(template.sources?.length ?? 0);
	const searchOnlySourceCount = $derived(
		(template.sources ?? []).filter(
			(source) =>
				!source.incentive_position ||
				(source.credibility_rationale ?? '').startsWith(SOURCE_EVALUATION_FALLBACK_PREFIX)
		).length
	);
	const evaluatedSourceCount = $derived(sourceCount - searchOnlySourceCount);

	const messageProofGate = getGateEvidence('CP-message-proof-binding', ['T4-2', 'T4-7'], {
		name: 'Published action proof binding',
		downstream: 3,
		dependency: 'Drafted artifact proof attachment and writer proof plumbing'
	});
	const publishContractRows = $derived<PublicActionPublishContractRow[]>(
		buildPublicActionPublishContractRows({
			isPublished,
			publishing,
			isDraft: hasError ? false : isDraft,
			targetCount,
			evaluatedSourceCount,
			searchOnlySourceCount,
			messageProofGate
		})
	);
	const publishRecordState = $derived(
		publishContractRows.find((row) => row.id === 'publish-record')?.state ?? 'gated'
	);
	const publishContractStateCounts = $derived(
		publishContractRows.reduce(
			(acc, row) => {
				acc[row.state] += 1;
				return acc;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<
				PublicActionPublishContractRow['state'],
				number
			>
		)
	);
	const publishContractSegments = $derived(
		operatorCapabilityStateRatioSegments(publishContractStateCounts)
	);

	function publishContractStateLabel(row: PublicActionPublishContractRow): string {
		return operatorCapabilityStateLabel(row.state);
	}

	function publishContractActionLabel(row: PublicActionPublishContractRow): string {
		return operatorCapabilityActionLabel(row.state, row.action, { appendReadyArrow: true });
	}

	function handleClose() {
		onclose?.();
	}

	async function handleShare() {
		const shareData = {
			title: template.title,
			text: shareMessage,
			url: shareUrl
		};

		if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare?.(shareData)) {
			try {
				await navigator.share(shareData);
			} catch (err) {
				if (err instanceof Error && err.name !== 'AbortError') {
					console.error('[Share] Native share failed:', err);
				}
			}
		} else {
			await handleCopy();
		}
	}

	async function handleCopy() {
		const success = await clipboardCopy(shareUrl);
		if (success) {
			copied = true;
			setTimeout(() => (copied = false), 2000);
		}
	}

	function handleViewTemplate() {
		window.open(shareUrl, '_blank');
	}

	function handleDashboard() {
		ondashboard?.();
		window.location.href = '/';
	}
</script>

<div
	class="fixed inset-0 z-[1010] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
	onclick={handleClose}
	onkeydown={(e) => {
		if (e.key === 'Escape') handleClose();
		if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
			handleClose();
		}
	}}
	role="dialog"
	aria-modal="true"
	aria-label="Public action publish status"
	tabindex="0"
	in:fade={{ duration: 200 }}
	out:fade={{ duration: 150 }}
>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="success-modal-shell relative w-full max-w-md overflow-hidden rounded-md"
		role="presentation"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		in:scale={{
			duration: 300,
			start: 0.9,
			opacity: 0.5
		}}
	>
		<!-- Close button -->
		<button
			onclick={handleClose}
			class="absolute top-4 right-4 z-10 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
			aria-label="Close"
		>
			<X class="h-5 w-5" />
		</button>

		<!-- State-aware header -->
		<div
			class="publish-state px-6 pt-8 pb-6 text-center"
			data-state={hasError ? 'error' : isDraft ? 'draft' : publishing ? 'publishing' : 'published'}
		>
			<div
				class="publish-state-icon mb-4 inline-flex h-16 w-16 items-center justify-center"
				class:publishing-pulse={publishing}
				in:scale={{ duration: 600, delay: 200, start: 0 }}
			>
				{#if hasError}
					<AlertCircle class="h-12 w-12 text-red-500" />
				{:else if isDraft}
					<Clock class="h-12 w-12 text-amber-500" />
				{:else}
					<CheckCircle class="h-12 w-12 text-emerald-500" />
				{/if}
			</div>

			{#if hasError}
				<h2 class="mb-2 text-2xl font-bold text-slate-900">Couldn't publish public action</h2>
				<p class="text-sm text-red-600">{error}</p>
			{:else if isDraft}
				<h2 class="mb-2 text-2xl font-bold text-slate-900">Public action held as draft</h2>
				<p class="text-slate-600">The action page is not public until review approves it.</p>
			{:else if publishing}
				<h2 class="mb-2 text-2xl font-bold text-slate-900">Publishing public action</h2>
				<p class="text-slate-600">The action page unlocks after the server confirms creation.</p>
			{:else}
				<h2 class="mb-2 text-2xl font-bold text-slate-900">Public action published</h2>
				<p class="text-slate-600">
					The action page is live; reader confirmation and delivery remain route-owned.
				</p>
			{/if}
		</div>

		<!-- Template Preview -->
		<div class="px-6 pt-5 pb-4">
			<div class="template-contract rounded-lg p-4">
				<h3 class="mb-1 font-semibold text-slate-900">
					{template.title}
				</h3>
				<p class="line-clamp-2 text-sm text-slate-600">
					{template.description || template.preview}
				</p>
				<div class="mt-3 flex items-center gap-2">
					<span class="font-mono text-xs text-blue-700">
						{template.domain}
					</span>
					<span class="font-mono text-xs text-slate-600">
						{template.deliveryMethod === 'cwc' ? 'Congressional' : 'Direct'}
					</span>
				</div>
			</div>
		</div>

		<section class="publish-contract px-6 pb-4" aria-label="Public action publish contract">
			<div class="publish-contract-shell">
				<header class="publish-contract-head">
					<div class="publish-contract-main">
						<span class="publish-contract-kicker">Publish contract</span>
						<span class="publish-contract-title">Public action route, not delivery proof</span>
					</div>
					<div class="publish-contract-state" aria-label="Publish contract state counts">
						<span>{operatorCapabilityStateLabel(publishRecordState)}</span>
						<span>
							<Datum
								value={publishContractRows.length}
								cite="TemplateSuccessModal publishContractRows"
							/>
							rows
						</span>
					</div>
				</header>
				<Ratio segments={publishContractSegments} height={6} />
				<div class="publish-contract-grid">
					{#each publishContractRows as row (row.label)}
						<div
							class="publish-contract-row"
							data-state={row.state}
							title="{row.label}: {row.effect} Gate: {row.gate}"
							aria-label="{row.label}: {publishContractStateLabel(
								row
							)}. {row.effect} Gate: {row.gate}. Action: {publishContractActionLabel(row)}"
						>
							<div class="publish-contract-row-main">
								<span class="publish-contract-row-top">
									<span class="publish-contract-row-label">{row.label}</span>
									<span class="publish-contract-row-state">{publishContractStateLabel(row)}</span>
								</span>
								<span class="publish-contract-row-cluster">
									{formatCapabilityClusters(row.clusters)}
								</span>
								<span class="publish-contract-row-effect">{row.effect}</span>
								<span class="publish-contract-row-gate">{row.gate}</span>
							</div>
							<div class="publish-contract-row-metric">
								<span class="publish-contract-row-action">{publishContractActionLabel(row)}</span>
								<Datum value={row.metric.value} cite={row.metric.cite} />
								<span>{row.metric.label}</span>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</section>

		{#if showShareActions}
			{#if isPublished}
				<!-- Beat 2: reader-route preview -->
				<div class="beat-2 px-6 pt-1 pb-3">
					<p class="text-center text-sm font-medium text-slate-700">
						{actionRoutePreviewText}
					</p>
				</div>

				<!-- Beat 3: route handoff, not send execution -->
				<div class="beat-3 px-6 pb-2">
					<button
						onclick={() => onsend?.()}
						title={actionRouteTitle}
						aria-label="Open public action page"
						class="bg-participation-primary-600 hover:bg-participation-primary-700 flex w-full items-center justify-center gap-2 rounded-lg px-6 py-3 font-semibold text-white shadow-sm transition-all active:scale-95"
					>
						<span>Open action page</span>
						<ChevronRight class="h-5 w-5" />
					</button>
				</div>

				<!-- Beat 4: Secondary share/copy — visually subordinate -->
				<div class="beat-4 px-6 pb-3">
					{#if useNativeShare}
						<div class="flex justify-center">
							<button
								onclick={handleShare}
								class="flex items-center gap-1.5 text-sm text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-700 hover:decoration-slate-500"
							>
								<Share2 class="h-3.5 w-3.5" />
								<span>Share action page</span>
							</button>
						</div>
					{:else}
						<!-- URL bar — clickable copy surface -->
						<button onclick={handleCopy} class="url-copy-bar" class:url-copy-bar--copied={copied}>
							{#if copied}
								<Check class="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
								<span class="flex-1 text-left text-sm font-medium text-emerald-600">
									Action page copied
								</span>
							{:else}
								<Link class="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
								<span class="flex-1 truncate text-left font-mono text-xs text-slate-500">
									{shareUrl}
								</span>
								<span class="text-participation-primary-600 flex-shrink-0 text-xs font-semibold">
									Copy action page
								</span>
							{/if}
						</button>
					{/if}
				</div>

				<!-- Warm closing note -->
				<div class="beat-4 px-6 pt-0 pb-6">
					<p class="text-center text-sm leading-relaxed text-slate-500">
						Share the action page. Each reader confirms their own route.
					</p>
				</div>
			{/if}
		{:else if publishing}
			<div class="px-6 pt-1 pb-6">
				<div class="publish-boundary rounded-lg p-4">
					<p class="text-sm font-medium text-slate-800">Action page pending</p>
					<p class="mt-1 text-sm leading-relaxed text-slate-600">
						Share controls unlock only after the server confirms a public action.
					</p>
				</div>
			</div>
		{:else if isDraft}
			<!-- Draft: Explain what's happening -->
			<div class="px-6 pb-4">
				<div class="draft-boundary rounded-lg p-4">
					<p class="text-sm font-medium text-amber-800">Why is this held?</p>
					<p class="mt-1 text-sm text-amber-700">
						Consensus review did not publish this public action. It is not shareable until review
						approves it.
					</p>
				</div>
			</div>

			<!-- Draft: Primary action -->
			<div class="px-6 pb-2">
				<button
					onclick={handleDashboard}
					class="bg-participation-primary-600 hover:bg-participation-primary-700 flex w-full items-center justify-center gap-2 rounded-lg px-6 py-3 font-semibold text-white shadow-sm transition-all active:scale-95"
				>
					<LayoutDashboard class="h-5 w-5" />
					Go to Dashboard
				</button>
			</div>

			<!-- Draft: What happens next -->
			<div class="px-6 pt-1 pb-3">
				<p class="text-xs font-medium text-amber-800">What happens next</p>
				<p class="mt-1.5 text-xs leading-relaxed text-amber-700">
					The draft remains private. Re-open it after review clears or revise the action content.
				</p>
			</div>

			<!-- Draft: Secondary link -->
			<div class="flex justify-center px-6 pb-6">
				<button
					onclick={handleViewTemplate}
					class="text-sm text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-700 hover:decoration-slate-500"
				>
					Preview draft
				</button>
			</div>
		{:else if hasError}
			<!-- Error: Retry -->
			<div class="px-6 pt-1 pb-4">
				<button
					onclick={() => onretry?.()}
					class="bg-participation-primary-600 hover:bg-participation-primary-700 flex w-full items-center justify-center gap-2 rounded-lg px-6 py-3 font-semibold text-white shadow-sm transition-all active:scale-95"
				>
					Retry public action publish
				</button>
			</div>

			<div class="flex justify-center px-6 pb-6">
				<button
					onclick={handleClose}
					class="text-sm text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-700 hover:decoration-slate-500"
				>
					Close
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.success-modal-shell {
		background: var(--surface-base, oklch(0.993 0.003 60));
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		box-shadow: 0 18px 60px oklch(0.12 0.01 60 / 0.24);
	}

	.publish-state {
		border-top: 3px solid var(--coord-route-solid, #3bc4b8);
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-raised, oklch(0.985 0.004 60));
	}

	.publish-state[data-state='published'] {
		border-top-color: var(--coord-verified, #10b981);
	}

	.publish-state[data-state='draft'] {
		border-top-color: oklch(0.75 0.13 82);
	}

	.publish-state[data-state='error'] {
		border-top-color: oklch(0.58 0.18 28);
	}

	.publish-state-icon {
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-radius: 8px;
		background: var(--surface-base, oklch(0.993 0.003 60));
	}

	.template-contract,
	.publish-boundary,
	.draft-boundary {
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-raised, oklch(0.985 0.004 60));
	}

	.publish-boundary {
		border-left: 3px solid var(--coord-route-solid, #3bc4b8);
	}

	.publish-contract-shell {
		display: grid;
		gap: 0.7rem;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-radius: 8px;
		background: var(--surface-raised, oklch(0.985 0.004 60));
		padding: 0.8rem;
	}

	.publish-contract-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.publish-contract-main {
		display: grid;
		gap: 0.14rem;
		min-width: 0;
	}

	.publish-contract-kicker,
	.publish-contract-state,
	.publish-contract-row-state,
	.publish-contract-row-action,
	.publish-contract-row-metric {
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
		text-transform: uppercase;
		letter-spacing: 0;
	}

	.publish-contract-kicker {
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.62rem;
		font-weight: 800;
	}

	.publish-contract-title {
		color: var(--text-primary, oklch(0.22 0.015 60));
		font-size: 0.84rem;
		font-weight: 850;
		line-height: 1.2;
	}

	.publish-contract-state {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.12rem;
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.6rem;
		font-weight: 800;
		white-space: nowrap;
	}

	.publish-contract-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.45rem;
	}

	.publish-contract-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.65rem;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-left-width: 3px;
		border-radius: 8px;
		background: var(--surface-base, oklch(0.993 0.003 60));
		padding: 0.62rem;
	}

	.publish-contract-row[data-state='live'] {
		border-left-color: var(--coord-verified, #10b981);
	}

	.publish-contract-row[data-state='partial'] {
		border-left-color: var(--coord-route-solid, #3bc4b8);
	}

	.publish-contract-row[data-state='draft-only'] {
		border-left-color: oklch(0.75 0.13 82);
		background: oklch(0.988 0.006 74);
	}

	.publish-contract-row[data-state='gated'] {
		border-left-color: oklch(0.55 0.02 60);
		opacity: 0.88;
	}

	.publish-contract-row-main {
		min-width: 0;
	}

	.publish-contract-row-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.publish-contract-row-label {
		color: var(--text-primary, oklch(0.22 0.015 60));
		font-size: 0.76rem;
		font-weight: 850;
		line-height: 1.2;
	}

	.publish-contract-row-state {
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.52rem;
		font-weight: 850;
		white-space: nowrap;
	}

	.publish-contract-row-cluster {
		display: block;
		margin-top: 0.28rem;
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.52rem;
		font-weight: 800;
		line-height: 1.25;
		text-transform: uppercase;
	}

	.publish-contract-row-effect {
		display: block;
		margin-top: 0.4rem;
		color: var(--text-secondary, oklch(0.38 0.012 60));
		font-size: 0.66rem;
		font-weight: 600;
		line-height: 1.35;
	}

	.publish-contract-row-gate {
		display: block;
		margin-top: 0.38rem;
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.56rem;
		font-weight: 600;
		line-height: 1.35;
	}

	.publish-contract-row-metric {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.12rem;
		min-width: 4.25rem;
		color: var(--text-primary, oklch(0.22 0.015 60));
		font-size: 0.88rem;
		font-weight: 850;
		line-height: 1;
		text-align: right;
	}

	.publish-contract-row-action,
	.publish-contract-row-metric span {
		max-width: 5.75rem;
		overflow: hidden;
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.52rem;
		font-weight: 800;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.draft-boundary {
		border-left: 3px solid oklch(0.75 0.13 82);
		background: oklch(0.97 0.025 85);
	}

	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	@keyframes publish-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.6;
		}
	}

	.publishing-pulse {
		animation: publish-pulse 1.5s ease-in-out infinite;
	}

	.url-copy-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.625rem 0.75rem;
		border-radius: 0.5rem;
		border: 1.5px solid oklch(0.92 0.01 250);
		background: oklch(0.98 0.005 250);
		cursor: pointer;
		transition:
			border-color 150ms,
			background-color 150ms;
	}

	.url-copy-bar:hover {
		border-color: oklch(0.85 0.03 250);
		background: oklch(0.965 0.01 250);
	}

	.url-copy-bar--copied {
		border-color: oklch(0.78 0.12 155);
		background: oklch(0.96 0.03 155);
	}

	@keyframes beat-enter {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.beat-2 {
		animation: beat-enter 300ms ease-out 800ms both;
	}

	.beat-3 {
		animation: beat-enter 250ms ease-out 1200ms both;
	}

	.beat-4 {
		animation: beat-enter 200ms ease-out 1350ms both;
	}

	@media (prefers-reduced-motion: reduce) {
		.beat-2,
		.beat-3,
		.beat-4 {
			animation: none;
			opacity: 1;
			transform: none;
		}
	}
</style>
