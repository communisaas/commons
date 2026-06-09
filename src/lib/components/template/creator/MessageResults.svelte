<script lang="ts">
	import { Edit3, BookOpen, MapPin } from '@lucide/svelte';
	import type { Source, TemplateDraftOrigin } from '$lib/types/template';
	import type { GeoScope } from '$lib/core/agents/types';
	import type { ActiveMessageJob } from '$lib/core/agents/message-job-recovery';
	import { Artifact, Datum, Ratio } from '$lib/design';
	import { formatCapabilityClusters } from '$lib/data/capability-clusters';
	import {
		buildMessageGenerationEvidence,
		buildStudioDraftHandoffRows,
		getGateEvidence,
		messageGenerationSpineRows,
		type MessageGenerationEvidenceRow,
		type StudioDraftHandoffRow
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel,
		operatorCapabilityStateRatioSegments,
		type OperatorCapabilityStateCounts
	} from '$lib/data/capability-state-labels';
	import SourceCard from './SourceCard.svelte';
	import ResearchLog from './ResearchLog.svelte';
	import GeographicScopeEditor from './GeographicScopeEditor.svelte';
	import { splitIntoParagraphs, countWords, hasCitations } from '$lib/utils/message-processing';

	interface Props {
		message: string;
		subject: string;
		intentFieldCount?: number;
		targetCount?: number;
		sources: Source[];
		researchLog: string[];
		geographicScope?: GeoScope | null;
		activeMessageJob?: ActiveMessageJob | null;
		draftOrigin?: TemplateDraftOrigin | null;
		onEdit: () => void;
	}

	let {
		message,
		subject,
		intentFieldCount = 0,
		targetCount = 0,
		sources,
		researchLog,
		geographicScope = $bindable(),
		activeMessageJob = null,
		draftOrigin = null,
		onEdit
	}: Props = $props();

	let showResearchLog = $state(false);
	let selectedCitation = $state<number | null>(null);
	const SOURCE_EVALUATION_FALLBACK_PREFIX = 'Evaluation unavailable';

	const paragraphs = $derived(splitIntoParagraphs(message));
	const wordCount = $derived(countWords(message));
	const hasCitationsInMessage = $derived(hasCitations(message));
	const searchOnlySourceCount = $derived(
		sources.filter(
			(source) =>
				!source.incentive_position ||
				(source.credibility_rationale ?? '').startsWith(SOURCE_EVALUATION_FALLBACK_PREFIX)
		).length
	);
	const evaluatedSourceCount = $derived(sources.length - searchOnlySourceCount);
	const traceHandle = $derived(
		activeMessageJob?.traceId ? activeMessageJob.traceId.slice(0, 8) : null
	);
	const messageProofGate = getGateEvidence('CP-message-proof-binding', ['T4-2', 'T4-7'], {
		name: 'Authored artifact proof binding',
		downstream: 3,
		dependency: 'Drafted artifact proof attachment and writer proof plumbing'
	});
	const evidenceSummary = $derived(
		buildMessageGenerationEvidence({
			intentFieldCount,
			targetCount,
			phase: 'complete',
			paragraphCount: paragraphs.length,
			sourceCount: sources.length,
			evaluatedSourceCount,
			searchOnlySourceCount,
			sourceEvidenceObserved: true,
			researchStepCount: researchLog.length,
			hasRecoveryJob: Boolean(activeMessageJob),
			recoveryJobStatus: activeMessageJob?.status ?? null,
			traceHandle,
			messageProofGate
		})
	);
	const evidenceRows = $derived<MessageGenerationEvidenceRow[]>(evidenceSummary.rows);
	const evidenceStateCounts = $derived<OperatorCapabilityStateCounts>({
		live: evidenceRows.filter((row) => row.state === 'live').length,
		partial: evidenceRows.filter((row) => row.state === 'partial').length,
		'draft-only': evidenceRows.filter((row) => row.state === 'draft-only').length,
		gated: evidenceRows.filter((row) => row.state === 'gated').length
	});
	const evidenceSegments = $derived(operatorCapabilityStateRatioSegments(evidenceStateCounts));
	const evidenceSpineRows = $derived(messageGenerationSpineRows(evidenceRows));
	const studioDraftOrigin = $derived(draftOrigin?.source === 'studio' ? draftOrigin : null);
	const studioHandoffRows = $derived<StudioDraftHandoffRow[]>(
		studioDraftOrigin
			? buildStudioDraftHandoffRows({
					destination: 'public-action-template',
					targetCount,
					evaluatedSourceCount,
					searchOnlySourceCount,
					scopeLabel: geographicScope ? formatScope(geographicScope) : null,
					scopeMetricCite: 'TemplateFormData.content.geographicScope',
					recoveryJobPresent: Boolean(activeMessageJob),
					recoveryJobStatus: activeMessageJob?.status ?? null,
					recoveryMetricCite: activeMessageJob
						? 'activeMessageJob job_id/input_hash'
						: 'no active message job',
					traceHandle,
					traceMetricCite: traceHandle
						? 'activeMessageJob traceId'
						: 'stream-message traceId absent',
					draftEffect: studioDraftOrigin.effect,
					draftMetricCite: studioDraftOrigin.sourceRef,
					messageProofGate
				})
			: []
	);
	const studioHandoffStateCounts = $derived(
		studioHandoffRows.reduce(
			(acc, row) => {
				acc[row.state] += 1;
				return acc;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<
				StudioDraftHandoffRow['state'],
				number
			>
		)
	);
	const studioHandoffSegments = $derived(
		operatorCapabilityStateRatioSegments(studioHandoffStateCounts)
	);

	function stateLabel(row: MessageGenerationEvidenceRow): string {
		return operatorCapabilityStateLabel(row.state);
	}

	function actionLabel(row: MessageGenerationEvidenceRow): string {
		return operatorCapabilityActionLabel(row.state, row.action, { appendReadyArrow: true });
	}

	function studioHandoffStateLabel(row: StudioDraftHandoffRow): string {
		return operatorCapabilityStateLabel(row.state);
	}

	function studioHandoffActionLabel(row: StudioDraftHandoffRow): string {
		return operatorCapabilityActionLabel(row.state, row.action, { appendReadyArrow: true });
	}

	function handleCitationClick(citationNum: number) {
		selectedCitation = citationNum;
		const sourceElement = document.querySelector(`[data-source="${citationNum}"]`);
		if (sourceElement) {
			sourceElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}

	function handleScopeChanged(scope: GeoScope) {
		geographicScope = scope;
	}

	/**
	 * Format geographic scope for inline display
	 */
	function formatScope(s: GeoScope): string {
		if (s.type === 'international') return 'International';
		if (s.type === 'nationwide') return s.country;
		const parts: string[] = [];
		if (s.locality) parts.push(s.locality);
		if (s.subdivision) {
			// Extract state code from ISO format (e.g., "US-CA" → "CA")
			const stateCode = s.subdivision.includes('-') ? s.subdivision.split('-')[1] : s.subdivision;
			parts.push(stateCode);
		}
		return parts.join(', ') || s.country;
	}
</script>

<div class="space-y-4 py-4">
	<!-- Email preview is a bounded artifact; the evidence rail is the artifact's audit surface. -->
	<Artifact padding="compact" class="message-artifact">
		<!-- Subject Header -->
		<div
			class="flex items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/50 px-5 py-4"
		>
			<div class="min-w-0 flex-1">
				<p class="text-xs font-medium tracking-wide text-slate-500 uppercase">Subject</p>
				<p class="mt-1 text-base font-semibold text-slate-900">{subject}</p>
			</div>
			<button
				type="button"
				onclick={onEdit}
				class="flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
			>
				<Edit3 class="h-3.5 w-3.5" />
				Edit
			</button>
		</div>

		<!-- Message Body -->
		<div class="px-5 py-5">
			<div class="prose prose-sm max-w-none">
				{#each paragraphs as paragraph}
					<p class="mb-4 leading-relaxed whitespace-pre-line text-slate-700 last:mb-0">
						{#each paragraph.split(/(\[\d+\]|\*\*.*?\*\*|\*.*?\*)/) as part}
							{#if /^\[\d+\]$/.test(part)}
								{@const citationNum = parseInt(part.slice(1, -1), 10)}
								{@const source = sources.find((s) => s.num === citationNum)}
								{#if source}
									<button
										type="button"
										onclick={() => handleCitationClick(citationNum)}
										class="citation-link text-participation-primary-600 hover:text-participation-primary-700 font-semibold transition-colors"
										class:bg-participation-primary-50={selectedCitation === citationNum}
										class:px-1={selectedCitation === citationNum}
										class:rounded={selectedCitation === citationNum}
										title={source.title}
									>
										{part}
									</button>
								{:else}
									<span class="text-slate-400">{part}</span>
								{/if}
							{:else if /^\*\*.*?\*\*$/.test(part)}
								<strong class="font-semibold text-slate-900">{part.slice(2, -2)}</strong>
							{:else if /^\*.*?\*$/.test(part)}
								<em class="italic">{part.slice(1, -1)}</em>
							{:else}
								{part}
							{/if}
						{/each}
					</p>
				{/each}
			</div>
		</div>

		<!-- Footer Metadata -->
		<div
			class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 bg-slate-50/30 px-5 py-3 text-xs text-slate-500"
		>
			<span>{wordCount} words</span>
			{#if hasCitationsInMessage}
				<span class="flex items-center gap-1">
					<BookOpen class="h-3 w-3" />
					{sources.length} source{sources.length !== 1 ? 's' : ''}
				</span>
				<span>
					{evaluatedSourceCount} evaluated
					{#if searchOnlySourceCount > 0}
						/ {searchOnlySourceCount} search-only
					{/if}
				</span>
			{/if}
			{#if geographicScope}
				<span class="flex items-center gap-1">
					<MapPin class="h-3 w-3" />
					<GeographicScopeEditor scope={geographicScope} onScopeChanged={handleScopeChanged} />
				</span>
			{/if}
		</div>

		{#if studioDraftOrigin}
			<section class="studio-handoff" aria-label="Studio public action handoff contract">
				<header class="studio-handoff-head">
					<div class="studio-handoff-main">
						<span class="studio-handoff-kicker">Studio handoff</span>
						<span class="studio-handoff-title">{studioDraftOrigin.label}</span>
						<span class="studio-handoff-origin">{studioDraftOrigin.processTitle}</span>
					</div>
					<div class="studio-handoff-state" aria-label="Studio handoff state counts">
						<span>{operatorCapabilityStateLabel('draft-only')}</span>
						<span>
							<Datum value={studioHandoffRows.length} cite={studioDraftOrigin.sourceRef} />
							rows
						</span>
					</div>
				</header>
				<Ratio segments={studioHandoffSegments} height={6} />
				<div class="studio-handoff-grid">
					{#each studioHandoffRows as row (row.label)}
						<div
							class="studio-handoff-row"
							data-state={row.state}
							title="{row.label}: {row.effect} Gate: {row.gate}"
							aria-label="{row.label}: {studioHandoffStateLabel(
								row
							)}. {row.effect} Gate: {row.gate}. Action: {studioHandoffActionLabel(row)}"
						>
							<div class="studio-handoff-row-main">
								<span class="studio-handoff-row-top">
									<span class="studio-handoff-row-label">{row.label}</span>
									<span class="studio-handoff-row-state">{studioHandoffStateLabel(row)}</span>
								</span>
								<span class="studio-handoff-row-meta">
									{formatCapabilityClusters(row.clusters)}
								</span>
								<span class="studio-handoff-row-effect">{row.effect}</span>
								<span class="studio-handoff-row-gate">{row.gate}</span>
							</div>
							<div class="studio-handoff-row-metric">
								<span class="studio-handoff-row-action">{studioHandoffActionLabel(row)}</span>
								<Datum value={row.metric.value} cite={row.metric.cite} />
								<span>{row.metric.label}</span>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<section class="evidence-rail" aria-label="Authored artifact evidence">
			<header class="evidence-head">
				<div class="evidence-head-main">
					<span class="evidence-kicker">Authored artifact evidence</span>
					<span class="evidence-signal">{evidenceSummary.signal}</span>
				</div>
				<div class="evidence-state">
					<span class="evidence-state-label">
						{operatorCapabilityStateLabel(evidenceSummary.state)}
					</span>
					<span class="evidence-state-count">
						<Datum value={evidenceSummary.liveCount} cite="buildMessageGenerationEvidence" />
						/ <Datum value={evidenceRows.length} cite="buildMessageGenerationEvidence" />
					</span>
				</div>
			</header>
			<Ratio segments={evidenceSegments} height={6} />
			<div class="evidence-spine" aria-label="Authored artifact spine">
				{#each evidenceSpineRows as row (row.key)}
					<div
						class="evidence-spine-cell"
						data-state={row.state}
						title="{row.label}: {row.ground} Gate: {row.gate}"
						aria-label="{row.label}: {stateLabel(row)}. {row.metric.value ?? 'unread'} {row.metric
							.label}. {row.ground} Full gate: {row.gate}. Action: {actionLabel(row)}"
					>
						<span class="evidence-spine-top">
							<span class="evidence-spine-label">{row.label}</span>
							<span class="evidence-spine-state">{stateLabel(row)}</span>
						</span>
						<span class="evidence-spine-signal">
							<Datum value={row.metric.value} cite={row.metric.cite} />
							<span>{row.metric.label}</span>
						</span>
						<span class="evidence-spine-ground">{row.ground}</span>
						<span class="evidence-spine-action">{actionLabel(row)}</span>
					</div>
				{/each}
			</div>
			<div class="evidence-grid">
				{#each evidenceRows as row (row.key)}
					<div class="evidence-row" data-state={row.state}>
						<div class="evidence-row-main">
							<div class="evidence-row-top">
								<span class="evidence-row-label">{row.label}</span>
								<span class="evidence-row-state">{stateLabel(row)}</span>
							</div>
							<span class="evidence-row-meta">
								{row.phase} / {formatCapabilityClusters(row.clusters)}
							</span>
							<p class="evidence-row-ground">{row.ground}</p>
							<p class="evidence-row-effect">{row.effect}</p>
							<p class="evidence-row-gate">{row.gate}</p>
						</div>
						<div class="evidence-row-metric">
							<span class="evidence-row-action">{actionLabel(row)}</span>
							<Datum value={row.metric.value} cite={row.metric.cite} />
							<span title={row.metric.label}>{row.metric.label}</span>
						</div>
					</div>
				{/each}
			</div>
		</section>
	</Artifact>

	<!-- Sources -->
	{#if sources.length > 0}
		<div class="space-y-2">
			<div class="flex items-center gap-2 px-1">
				<BookOpen class="h-4 w-4 text-slate-500" />
				<h4 class="text-sm font-medium text-slate-700">Sources</h4>
			</div>
			<div class="space-y-2">
				{#each sources as source}
					<div data-source={source.num}>
						<SourceCard {source} />
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Research Log -->
	{#if researchLog.length > 0}
		<ResearchLog {researchLog} bind:expanded={showResearchLog} />
	{/if}
</div>

<style>
	.citation-link {
		cursor: pointer;
		user-select: none;
	}

	.citation-link:hover {
		text-decoration: underline;
	}

	.studio-handoff {
		display: grid;
		gap: 0.75rem;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: oklch(0.982 0.006 70);
		padding: 1rem 1.25rem 1.125rem;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
	}

	.studio-handoff-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.studio-handoff-main {
		display: grid;
		gap: 0.18rem;
		min-width: 0;
	}

	.studio-handoff-kicker,
	.studio-handoff-origin,
	.studio-handoff-state,
	.studio-handoff-row-meta,
	.studio-handoff-row-state,
	.studio-handoff-row-action,
	.studio-handoff-row-metric {
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
		text-transform: uppercase;
		letter-spacing: 0;
	}

	.studio-handoff-kicker {
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.68rem;
		font-weight: 800;
	}

	.studio-handoff-title {
		color: var(--text-primary, oklch(0.22 0.015 60));
		font-size: 0.94rem;
		font-weight: 850;
		line-height: 1.2;
	}

	.studio-handoff-origin {
		overflow: hidden;
		color: var(--text-secondary, oklch(0.38 0.012 60));
		font-size: 0.58rem;
		font-weight: 750;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.studio-handoff-state {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.15rem;
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.68rem;
		font-weight: 800;
		white-space: nowrap;
	}

	.studio-handoff-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}

	.studio-handoff-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.7rem;
		min-height: 7.75rem;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-left-width: 3px;
		border-radius: 8px;
		background: var(--surface-base, oklch(0.993 0.003 60));
		padding: 0.72rem;
	}

	.studio-handoff-row[data-state='live'] {
		border-left-color: var(--coord-verified, #10b981);
	}

	.studio-handoff-row[data-state='partial'] {
		border-left-color: var(--coord-route-solid, #3bc4b8);
	}

	.studio-handoff-row[data-state='draft-only'] {
		border-left-color: oklch(0.75 0.13 82);
		background: oklch(0.988 0.006 74);
	}

	.studio-handoff-row[data-state='gated'] {
		border-left-color: oklch(0.55 0.02 60);
		opacity: 0.86;
	}

	.studio-handoff-row-main {
		min-width: 0;
	}

	.studio-handoff-row-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.studio-handoff-row-label {
		color: var(--text-primary, oklch(0.22 0.015 60));
		font-size: 0.82rem;
		font-weight: 850;
		line-height: 1.2;
	}

	.studio-handoff-row-state {
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.56rem;
		font-weight: 850;
		white-space: nowrap;
	}

	.studio-handoff-row-meta {
		display: block;
		margin-top: 0.34rem;
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.55rem;
		font-weight: 750;
		line-height: 1.25;
	}

	.studio-handoff-row-effect {
		display: block;
		margin-top: 0.52rem;
		color: var(--text-secondary, oklch(0.38 0.012 60));
		font-size: 0.72rem;
		font-weight: 600;
		line-height: 1.35;
	}

	.studio-handoff-row-gate {
		display: block;
		margin-top: 0.46rem;
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.6rem;
		font-weight: 600;
		line-height: 1.35;
	}

	.studio-handoff-row-metric {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.15rem;
		min-width: 4.6rem;
		color: var(--text-primary, oklch(0.22 0.015 60));
		font-size: 0.95rem;
		font-weight: 850;
		line-height: 1;
		text-align: right;
	}

	.studio-handoff-row-action,
	.studio-handoff-row-metric span {
		max-width: 6.5rem;
		overflow: hidden;
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.56rem;
		font-weight: 800;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.evidence-rail {
		display: grid;
		gap: 0.75rem;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-raised, oklch(0.985 0.004 60));
		padding: 1rem 1.25rem 1.125rem;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
	}

	.evidence-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.evidence-head-main {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
	}

	.evidence-kicker,
	.evidence-spine-label,
	.evidence-spine-state,
	.evidence-spine-action,
	.evidence-row-meta,
	.evidence-row-state,
	.evidence-row-gate {
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
		text-transform: uppercase;
		letter-spacing: 0;
	}

	.evidence-kicker {
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.68rem;
		font-weight: 700;
	}

	.evidence-signal {
		color: var(--text-primary, oklch(0.22 0.015 60));
		font-size: 0.9rem;
		font-weight: 700;
		line-height: 1.2;
	}

	.evidence-state {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.15rem;
		color: var(--text-secondary, oklch(0.38 0.012 60));
		white-space: nowrap;
	}

	.evidence-state-label {
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	.evidence-state-count {
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--text-tertiary, oklch(0.48 0.012 60));
	}

	.evidence-spine {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.45rem;
	}

	.evidence-spine-cell {
		display: flex;
		min-width: 0;
		min-height: 6.8rem;
		flex-direction: column;
		gap: 0.32rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		padding: 0.56rem 0.62rem;
	}

	.evidence-spine-cell[data-state='live'] {
		border-left-color: var(--coord-verified, #10b981);
	}

	.evidence-spine-cell[data-state='partial'] {
		border-left-color: var(--coord-route-solid, #3bc4b8);
	}

	.evidence-spine-cell[data-state='draft-only'] {
		border-left-color: oklch(0.75 0.13 82);
		background: oklch(0.984 0.005 65);
	}

	.evidence-spine-cell[data-state='gated'] {
		border-left-color: oklch(0.55 0.02 60);
		background: oklch(0.982 0.004 60);
		opacity: 0.88;
	}

	.evidence-spine-top,
	.evidence-spine-signal {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.4rem;
		min-width: 0;
	}

	.evidence-spine-label,
	.evidence-spine-state {
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.55rem;
		font-weight: 850;
		line-height: 1.2;
	}

	.evidence-spine-label {
		color: var(--text-primary, oklch(0.22 0.015 60));
	}

	.evidence-spine-state {
		white-space: nowrap;
	}

	.evidence-spine-signal {
		justify-content: flex-start;
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.64rem;
		font-weight: 800;
		color: var(--text-primary, oklch(0.22 0.015 60));
	}

	.evidence-spine-signal span:last-child {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.evidence-spine-ground {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		overflow: hidden;
		color: var(--text-secondary, oklch(0.38 0.012 60));
		font-size: 0.66rem;
		font-weight: 500;
		line-height: 1.35;
	}

	.evidence-spine-action {
		margin-top: auto;
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.52rem;
		font-weight: 850;
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.evidence-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}

	.evidence-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.75rem;
		min-height: 8.25rem;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-left-width: 3px;
		border-radius: 8px;
		background: var(--surface-base, oklch(0.993 0.003 60));
		padding: 0.75rem;
	}

	.evidence-row[data-state='live'] {
		border-left-color: var(--coord-verified, #10b981);
	}

	.evidence-row[data-state='partial'] {
		border-left-color: var(--coord-route-solid, #3bc4b8);
	}

	.evidence-row[data-state='draft-only'] {
		border-left-color: oklch(0.75 0.13 82);
		background: oklch(0.984 0.005 65);
	}

	.evidence-row[data-state='gated'] {
		border-left-color: oklch(0.55 0.02 60);
		opacity: 0.84;
	}

	.evidence-row-main {
		min-width: 0;
	}

	.evidence-row-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.evidence-row-label {
		color: var(--text-primary, oklch(0.22 0.015 60));
		font-size: 0.83rem;
		font-weight: 800;
		line-height: 1.2;
	}

	.evidence-row-state {
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.58rem;
		font-weight: 800;
		white-space: nowrap;
	}

	.evidence-row-meta {
		display: block;
		margin-top: 0.35rem;
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.56rem;
		font-weight: 700;
		line-height: 1.25;
	}

	.evidence-row-ground {
		margin-top: 0.55rem;
		color: var(--text-secondary, oklch(0.38 0.012 60));
		font-size: 0.75rem;
		font-weight: 500;
		line-height: 1.35;
	}

	.evidence-row-effect,
	.evidence-row-action {
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
		text-transform: uppercase;
		letter-spacing: 0;
	}

	.evidence-row-effect {
		margin-top: 0.45rem;
		color: var(--text-secondary, oklch(0.38 0.012 60));
		font-size: 0.6rem;
		font-weight: 750;
		line-height: 1.35;
	}

	.evidence-row-gate {
		margin-top: 0.5rem;
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.6rem;
		font-weight: 600;
		line-height: 1.35;
	}

	.evidence-row-metric {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.15rem;
		min-width: 4.5rem;
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
		color: var(--text-primary, oklch(0.22 0.015 60));
		font-size: 0.95rem;
		font-weight: 800;
		line-height: 1;
		text-align: right;
	}

	.evidence-row-action,
	.evidence-row-metric span {
		max-width: 6.5rem;
		overflow: hidden;
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.58rem;
		font-weight: 700;
		text-overflow: ellipsis;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.evidence-row-action {
		font-weight: 850;
	}

	@media (max-width: 640px) {
		.studio-handoff-head {
			flex-direction: column;
		}

		.studio-handoff-state {
			align-items: flex-start;
		}

		.studio-handoff-grid {
			grid-template-columns: 1fr;
		}

		.studio-handoff-row {
			grid-template-columns: 1fr;
			min-height: 0;
		}

		.studio-handoff-row-metric {
			align-items: flex-start;
			min-width: 0;
			text-align: left;
		}

		.evidence-head {
			flex-direction: column;
		}

		.evidence-state {
			align-items: flex-start;
		}

		.evidence-grid {
			grid-template-columns: 1fr;
		}

		.evidence-spine {
			grid-template-columns: 1fr;
		}

		.evidence-row {
			min-height: 0;
		}

		.evidence-spine-cell {
			min-height: 0;
		}
	}
</style>
