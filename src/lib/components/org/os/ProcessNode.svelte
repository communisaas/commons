<!--
  ProcessNode — the STUDIO authoring loop as a LIVING NODE, bound to ONE real
  process in the OS registry. This is the fully-spatial authoring face: it streams
  real agent reasoning (RESOLVE → GROUND → AUTHOR) and renders it across the three
  semantic-zoom tiers (glyph → summary → full), exactly as the canvas always did —
  now factored out so the canvas can render MANY concurrent processes at once, each
  in its own world-space spot, instead of only the single focused one.

  Two modes:
    · proc === null  → the IDLE studio node: the authoring instrument awaiting a
      state-bound authoring command. Honest empty state — never a faked trace.
      Renders the intent form when `composing` is on.
    · proc !== null  → a real process: glyph (zoomed out) or the open reasoning
      face (zoomed in), with the live trace, resolved decision-makers, grounded
      sources, and the authored message — all REAL streamed state.

  HONESTY: every thought / source / decision-maker / line shown here is exactly
  what the SSE stream emitted into the process record. Nothing is fabricated.

  SSR SAFETY: this component touches NO browser API directly. All actions are
  callbacks the parent (CanvasCapabilityMap) owns; the parent guards any window access.
  Pure render under svelte/server.
-->
<script lang="ts">
	import { Datum, Pulse } from '$lib/design';
	import { COORD_COLORS } from '$lib/design/motion';
	import { operatorCapabilityStateLabel } from '$lib/data/capability-state-labels';
	import type {
		StudioAuthoringReadinessRow,
		StudioAuthoringReadinessSummary
	} from '$lib/data/capability-hypergraph';
	import { isRunning, type OrgProcess } from './orgOS.svelte';
	import type { ReasoningStage } from '$lib/components/org/studio/StudioReasoning.svelte';
	import type { StudioSource } from '$lib/components/org/studio/StudioSources.svelte';

	let {
		proc,
		detail,
		focused = false,
		canPublish = true,
		composing = false,
		subjectLine = $bindable(''),
		coreMessage = $bindable(''),
		audienceGuidance = $bindable(''),
		intentError = null,
		runDisabled = false,
		runLabel = 'Start authoring',
		authoringReadiness = null,
		onCompose,
		onRun,
		onCancelCompose,
		onStop,
		onNewIntent
	}: {
		/** The bound process, or null for the IDLE studio instrument. */
		proc: OrgProcess | null;
		detail: 'glyph' | 'summary' | 'full';
		/** True when this is the focused process (subtle ring emphasis). */
		focused?: boolean;
		canPublish?: boolean;
		/** IDLE-only: reveal the intent form. */
		composing?: boolean;
		subjectLine?: string;
		coreMessage?: string;
		audienceGuidance?: string;
		intentError?: string | null;
		runDisabled?: boolean;
		runLabel?: string;
		authoringReadiness?: StudioAuthoringReadinessSummary | null;
		/** IDLE actions. */
		onCompose?: () => void;
		onRun?: () => void;
		onCancelCompose?: () => void;
		/** Running/finished actions. */
		onStop?: () => void;
		onNewIntent?: () => void;
	} = $props();

	const STAGE_META: Record<ReasoningStage, { label: string; color: string }> = {
		ground: { label: 'Ground', color: COORD_COLORS.ROUTE.solid },
		author: { label: 'Author', color: COORD_COLORS.SHARE.solid },
		resolve: { label: 'Resolve', color: COORD_COLORS.VERIFIED.solid }
	};

	const running = $derived(proc ? isRunning(proc) : false);
	const activeStage = $derived<ReasoningStage | null>(proc?.activeStage ?? null);
	const stageColor = $derived(
		activeStage ? STAGE_META[activeStage].color : COORD_COLORS.ROUTE.solid
	);
	const entries = $derived(proc?.entries ?? []);
	const stageLabel = $derived(proc?.stageLabel ?? '');
	const sources = $derived(proc?.sources ?? []);
	const sourceEvidenceObserved = $derived(proc?.sourceEvidenceObserved ?? false);
	const sourceEvidenceEvaluatedCount = $derived(
		sourceEvidenceObserved
			? Math.max(0, proc?.sourceEvidenceEvaluatedCount ?? 0)
			: sources.filter((source) => !isSearchOnlySource(source)).length
	);
	const sourceEvidenceSearchOnlyCount = $derived(
		sourceEvidenceObserved
			? Math.max(0, proc?.sourceEvidenceSearchOnlyCount ?? 0)
			: sources.filter(isSearchOnlySource).length
	);
	const sourceEvidenceEvaluationFallback = $derived(
		proc?.sourceEvidenceEvaluationFallback ?? false
	);
	const sourceEvidenceFailedCount = $derived(proc?.sourceEvidenceFailedCount ?? null);
	const sourceEvidenceSearchQueryCount = $derived(proc?.sourceEvidenceSearchQueryCount ?? null);
	const decisionMakers = $derived(proc?.decisionMakers ?? []);
	const composedMessage = $derived(proc?.composedMessage ?? '');
	const procError = $derived(proc?.errorMessage ?? null);
	const procSubject = $derived(proc?.intent.subjectLine ?? '');
	const messageParagraphs = $derived(
		composedMessage.split(/\n{2,}/).filter((p: string) => p.trim())
	);
	const glyphRhythm = $derived(entries.length > 0 ? entries.slice(-16).map((_, i) => i + 1) : []);
	const lastThought = $derived([...entries].reverse().find((e) => e.kind === 'thought'));
	const authoringContractRows = $derived<StudioAuthoringReadinessRow[]>(
		(authoringReadiness?.rows ?? []).filter((row) =>
			['intent', 'resolve', 'source-grounding', 'message-composition', 'draft-handoff'].includes(
				row.key
			)
		)
	);
	const authoringContractSignal = $derived(
		authoringReadiness?.signal ??
			(runDisabled
				? 'grounded authoring dependency-first'
				: 'intent -> resolve -> ground -> author')
	);
	const authoringContractIntro = $derived(
		authoringReadiness?.effect ??
			(runDisabled
				? 'Authoring runtime ground is not attached; Studio can shape intent, but target resolution, source grounding, and message writing stay dependency-first.'
				: 'Intent can start a real reasoning loop: resolve a contactable target, ground sources, then author output.')
	);
	const authoringContractAria = $derived(`Grounded authoring contract: ${authoringContractSignal}`);
	const canSubmitIntent = $derived(
		Boolean(subjectLine.trim() && coreMessage.trim() && !runDisabled)
	);
	const idleCommandState = $derived(runDisabled ? 'gated' : (authoringReadiness?.state ?? 'live'));
	const idleCommandAria = $derived(
		`${runLabel}. ${operatorCapabilityStateLabel(idleCommandState)}. ${authoringContractSignal}. ${authoringContractIntro}`
	);

	function submitIntent() {
		if (!canSubmitIntent) return;
		onRun?.();
	}

	const SOURCE_FALLBACK_MARKER = 'Evaluation unavailable';

	function isSearchOnlySource(source: StudioSource): boolean {
		return (
			!source.incentive_position ||
			(source.credibility_rationale ?? '').startsWith(SOURCE_FALLBACK_MARKER)
		);
	}
</script>

<div
	class="pnode"
	class:pnode--running={running}
	class:pnode--error={!!procError}
	class:pnode--focused={focused}
	class:pnode--studio={!proc}
	data-detail={detail}
	style="--stage-color: {stageColor};"
>
	<span class="pnode-halo" aria-hidden="true"></span>

	{#if !proc}
		<!-- IDLE — the authoring instrument awaiting a Compose. Honest empty state. -->
		<div class="pnode-idle" data-no-pan>
			{#if composing}
				<form
					class="intent"
					onsubmit={(e) => {
						e.preventDefault();
						submitIntent();
					}}
				>
					<label class="intent-label" for="cv-subject">Subject line</label>
					<input
						id="cv-subject"
						class="intent-input"
						type="text"
						bind:value={subjectLine}
						maxlength={200}
						placeholder="What is this action about?"
						autocomplete="off"
					/>
					<label class="intent-label" for="cv-core">Core message</label>
					<textarea
						id="cv-core"
						class="intent-textarea"
						rows={3}
						bind:value={coreMessage}
						maxlength={16000}
						placeholder="What you want the decision-makers to do, and why."
					></textarea>
					<label class="intent-label" for="cv-aud">
						Audience guidance <span class="intent-opt">optional</span>
					</label>
					<input
						id="cv-aud"
						class="intent-input"
						type="text"
						bind:value={audienceGuidance}
						placeholder="e.g. San Francisco health department leadership"
						autocomplete="off"
					/>
					<div class="intent-actions">
						<button type="submit" class="intent-run" disabled={!canSubmitIntent}>
							{runLabel}
						</button>
						<button type="button" class="intent-ghost" onclick={() => onCancelCompose?.()}>
							Cancel
						</button>
					</div>
					{#if intentError}
						<span class="intent-error" role="alert">{intentError}</span>
					{/if}
					{#if authoringContractRows.length > 0}
						<div class="studio-contract" aria-label={authoringContractAria}>
							<div class="studio-contract-head">
								<span>Grounded authoring contract</span>
								<span class="studio-contract-count">
									{authoringReadiness?.liveStepCount ?? 0}/{authoringReadiness?.rows.length ?? 0}
									armed
								</span>
							</div>
							<div class="studio-contract-grid">
								{#each authoringContractRows as row (row.key)}
									<div
										class="studio-contract-row"
										data-state={row.state}
										title="{row.label}: {row.ground} Gate: {row.gate}"
									>
										<span class="studio-contract-phase">{row.phase}</span>
										<span class="studio-contract-main">
											<span class="studio-contract-label">{row.label}</span>
											<span class="studio-contract-signal">{row.signal}</span>
										</span>
										<span class="studio-contract-state">
											{operatorCapabilityStateLabel(row.state)}
										</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</form>
			{:else}
				<div class="idle-face">
					<span class="idle-mark" aria-hidden="true"></span>
					<p class="idle-title">Studio</p>
					<p class="idle-sub">{authoringContractIntro}</p>
					{#if authoringContractRows.length > 0}
						<div class="studio-contract" aria-label={authoringContractAria}>
							<div class="studio-contract-head">
								<span>Grounded authoring contract</span>
								<span class="studio-contract-count">
									{authoringReadiness?.liveStepCount ?? 0}/{authoringReadiness?.rows.length ?? 0}
									armed
								</span>
							</div>
							<div class="studio-contract-grid">
								{#each authoringContractRows as row (row.key)}
									<div
										class="studio-contract-row"
										data-state={row.state}
										title="{row.label}: {row.ground} Gate: {row.gate}"
									>
										<span class="studio-contract-phase">{row.phase}</span>
										<span class="studio-contract-main">
											<span class="studio-contract-label">{row.label}</span>
											<span class="studio-contract-signal">{row.signal}</span>
										</span>
										<span class="studio-contract-state">
											{operatorCapabilityStateLabel(row.state)}
										</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}
					<button
						type="button"
						class="intent-run intent-run--idle"
						data-state={idleCommandState}
						aria-label={idleCommandAria}
						title={authoringContractIntro}
						onclick={() => onCompose?.()}
						data-no-pan
					>
						<span>{runLabel}</span>
						<span class="intent-run-state">{operatorCapabilityStateLabel(idleCommandState)}</span>
					</button>
				</div>
			{/if}
		</div>
	{:else if detail === 'glyph'}
		<!-- GLYPH — zoomed out: a stage dot + the arrival rhythm + a one-line title. -->
		<div class="pnode-glyph">
			<span class="glyph-dot" aria-hidden="true"></span>
			<div class="glyph-body">
				<span class="glyph-title">{proc.title}</span>
				<span class="glyph-stage">{running ? stageLabel || 'working' : proc.status}</span>
			</div>
			{#if glyphRhythm.length > 0}
				<span class="glyph-pulse" aria-hidden="true">
					<Pulse values={glyphRhythm} width={48} height={14} color={stageColor} />
				</span>
			{/if}
		</div>
	{:else}
		<!-- SUMMARY + FULL — the node opens to its reasoning. -->
		<div class="pnode-open">
			<header class="pnode-head">
				<div class="pnode-head-main">
					<span class="pnode-stage-dot" aria-hidden="true"></span>
					<span class="pnode-subject">{procSubject || proc.title}</span>
				</div>
				<span class="pnode-status" data-status={proc.status}>
					{#if running}
						{stageLabel || 'Working'}
					{:else if proc.status === 'composed'}
						Composed
					{:else if proc.status === 'error'}
						Error
					{:else}
						{proc.status}
					{/if}
				</span>
			</header>

			{#if detail === 'summary'}
				<div class="pnode-summary">
					{#if lastThought && lastThought.kind === 'thought'}
						<p class="summary-thought">
							<span class="summary-stage">{STAGE_META[lastThought.stage].label}</span>
							{lastThought.content}
						</p>
					{:else if running}
						<p class="summary-thought summary-thought--wait">
							Waiting for the first thought to stream in…
						</p>
					{:else}
						<p class="summary-thought summary-thought--wait">
							{entries.length} reasoning steps · zoom in for the full trace
						</p>
					{/if}
					{#if glyphRhythm.length > 0}
						<span class="summary-pulse" aria-hidden="true">
							<Pulse values={glyphRhythm} width={88} height={18} color={stageColor} />
						</span>
					{/if}
				</div>
			{:else}
				<!-- FULL — the entire streaming reasoning. -->
				<div
					class="pnode-trace"
					data-no-pan
					role="log"
					aria-live="polite"
					aria-relevant="additions"
					aria-busy={running}
					aria-label="Agent reasoning for {procSubject || proc.title}"
				>
					{#if entries.length === 0}
						<p class="trace-empty">
							{running ? 'Waiting for the first thought to stream in…' : 'No reasoning yet.'}
						</p>
					{:else}
						{#each entries as entry, i (i)}
							{#if entry.kind === 'thought'}
								<p class="trace-line trace-line--{entry.stage}">
									<span class="trace-tag">{STAGE_META[entry.stage].label}</span>
									<span class="trace-text">{entry.content}</span>
								</p>
							{:else}
								<div class="trace-action trace-action--{entry.status}">
									<span class="trace-action-title">{entry.title}</span>
									{#if entry.statusMessage}
										<span class="trace-action-status">{entry.statusMessage}</span>
									{/if}
								</div>
							{/if}
						{/each}
					{/if}
				</div>

				{#if decisionMakers.length > 0}
					<div class="pnode-section" data-no-pan>
						<span class="section-label">Resolved · {decisionMakers.length}</span>
						<ul class="dm-list">
							{#each decisionMakers as dm (dm.name + dm.organization)}
								<li class="dm-item">
									<span class="dm-name">{dm.name}</span>
									<span class="dm-role"
										>{dm.title}{dm.organization ? ` · ${dm.organization}` : ''}</span
									>
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if sources.length > 0}
					<div class="pnode-section" data-no-pan>
						<span class="section-label">Source ground</span>
						<div class="source-evidence" aria-label="Source ground evidence">
							<span class="source-evidence-item">
								<Datum value={sources.length} class="source-evidence-num" />
								<span>attached</span>
							</span>
							<span class="source-evidence-item">
								<Datum value={sourceEvidenceEvaluatedCount} class="source-evidence-num" />
								<span>evaluated</span>
							</span>
							{#if sourceEvidenceSearchOnlyCount > 0 || sourceEvidenceEvaluationFallback}
								<span class="source-evidence-item source-evidence-item--boundary">
									<Datum value={sourceEvidenceSearchOnlyCount} class="source-evidence-num" />
									<span>search-only</span>
								</span>
							{/if}
							{#if sourceEvidenceSearchQueryCount !== null}
								<span class="source-evidence-item">
									<Datum value={sourceEvidenceSearchQueryCount} class="source-evidence-num" />
									<span>queries</span>
								</span>
							{/if}
							{#if sourceEvidenceFailedCount !== null && sourceEvidenceFailedCount > 0}
								<span class="source-evidence-item source-evidence-item--boundary">
									<Datum value={sourceEvidenceFailedCount} class="source-evidence-num" />
									<span>failed reads</span>
								</span>
							{/if}
						</div>
						{#if sourceEvidenceSearchOnlyCount > 0 || sourceEvidenceEvaluationFallback}
							<p class="source-evidence-note">
								Search-only rows are context, not evaluated source evidence.
							</p>
						{/if}
						<ul class="src-list">
							{#each sources as s (s.num)}
								{@const searchOnly = isSearchOnlySource(s)}
								<li class="src-item" data-search-only={searchOnly}>
									<span class="src-num">{s.num}</span>
									<span class="src-title">{s.title}</span>
									{#if s.incentive_position}
										<span class="src-pos src-pos--{s.incentive_position}"
											>{s.incentive_position}</span
										>
									{:else if searchOnly}
										<span class="src-pos src-pos--search-only">search-only</span>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if composedMessage}
					<div class="pnode-section" data-no-pan>
						<span class="section-label">Authored</span>
						<div class="specimen">
							{#each messageParagraphs as para, i (i)}
								<p class="specimen-para">{para}</p>
							{/each}
						</div>
					</div>
				{/if}
			{/if}

			{#if procError}
				<p class="pnode-error" role="alert">{procError}</p>
			{/if}

			<footer class="pnode-foot" data-no-pan>
				{#if running}
					<button type="button" class="pnode-action pnode-action--stop" onclick={() => onStop?.()}
						>Stop</button
					>
				{:else}
					<button type="button" class="pnode-action" onclick={() => onNewIntent?.()}
						>New intent</button
					>
				{/if}
				{#if !canPublish}
					<span
						class="pnode-foot-note"
						title="Route handoffs and publish side effects require org authority."
						>publish handoffs gated</span
					>
				{/if}
			</footer>
		</div>
	{/if}
</div>

<style>
	.pnode {
		position: relative;
		width: 100%;
		color: var(--org-sidebar-text, oklch(0.92 0.005 55));
	}
	.pnode-halo {
		position: absolute;
		inset: -1px;
		border-radius: 8px;
		pointer-events: none;
		opacity: 0;
		box-shadow:
			0 0 0 1px var(--stage-color),
			0 0 40px -6px var(--stage-color);
		transition: opacity 220ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	.pnode--running .pnode-halo {
		opacity: 0.5;
		animation: halo-breath 2.4s ease-in-out infinite;
	}
	.pnode--focused .pnode-halo {
		opacity: 0.35;
	}
	@keyframes halo-breath {
		0%,
		100% {
			opacity: 0.28;
		}
		50% {
			opacity: 0.6;
		}
	}

	/* ─── Idle ─── */
	.pnode-idle {
		position: relative;
	}
	.idle-face {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.5rem;
	}
	.idle-mark {
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 50%;
		border: 1px solid oklch(0.4 0.02 250 / 0.6);
		background: var(--coord-route-solid, #3bc4b8);
		box-shadow:
			0 0 0 4px oklch(0.22 0.02 250 / 0.76),
			0 0 18px -6px var(--coord-route-solid, #3bc4b8);
		opacity: 0.7;
		margin-bottom: 0.25rem;
	}
	.idle-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 600;
		margin: 0;
		color: var(--org-sidebar-text, oklch(0.92 0.005 55));
	}
	.idle-sub {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.5;
		margin: 0 0 0.5rem;
		max-width: 22rem;
		color: var(--org-sidebar-text-muted, oklch(0.6 0.01 55));
	}

	.studio-contract {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		border: 1px solid oklch(0.34 0.02 250 / 0.68);
		border-radius: 8px;
		background: oklch(0.13 0.012 250 / 0.82);
		padding: 0.5rem;
		text-align: left;
	}

	.studio-contract-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--org-sidebar-text-muted, oklch(0.6 0.01 55));
	}

	.studio-contract-count {
		flex-shrink: 0;
		color: var(--org-sidebar-text, oklch(0.92 0.005 55));
		font-variant-numeric: tabular-nums;
	}

	.studio-contract-grid {
		display: grid;
		gap: 0.25rem;
	}

	.studio-contract-row {
		display: grid;
		grid-template-columns: 3.75rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.45rem;
		min-height: 2rem;
		border-radius: 6px;
		background: oklch(0.17 0.014 250 / 0.76);
		padding: 0.3rem 0.4rem;
	}

	.studio-contract-row[data-state='live'] {
		box-shadow: inset 2px 0 0 var(--coord-verified, #10b981);
	}

	.studio-contract-row[data-state='partial'] {
		box-shadow: inset 2px 0 0 var(--coord-route-solid, #3bc4b8);
	}

	.studio-contract-row[data-state='draft-only'] {
		box-shadow: inset 2px 0 0 oklch(0.75 0.13 82);
	}

	.studio-contract-row[data-state='gated'] {
		box-shadow: inset 2px 0 0 oklch(0.55 0.02 60);
	}

	.studio-contract-phase,
	.studio-contract-state {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--org-sidebar-text-muted, oklch(0.6 0.01 55));
	}

	.studio-contract-main {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.05rem;
	}

	.studio-contract-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--org-sidebar-text, oklch(0.92 0.005 55));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.studio-contract-signal {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.625rem;
		color: var(--org-sidebar-text-muted, oklch(0.6 0.01 55));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ─── Intent form ─── */
	.intent {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.intent-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--org-sidebar-text-muted, oklch(0.6 0.01 55));
	}
	.intent-opt {
		font-weight: 400;
		opacity: 0.7;
	}
	.intent-input,
	.intent-textarea {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		color: var(--org-sidebar-text, oklch(0.92 0.005 55));
		padding: 0.5rem 0.625rem;
		border-radius: 8px;
		border: 1px solid oklch(0.34 0.02 250 / 0.7);
		background: oklch(0.14 0.012 250);
		resize: vertical;
		transition:
			border-color 220ms cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 220ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	.intent-input::placeholder,
	.intent-textarea::placeholder {
		color: var(--org-sidebar-text-dim, oklch(0.45 0.01 55));
	}
	.intent-input:focus,
	.intent-textarea:focus {
		outline: none;
		border-color: var(--coord-route-solid, #3bc4b8);
		box-shadow: 0 0 0 3px oklch(0.7 0.13 190 / 0.18);
	}
	.intent-actions {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		margin-top: 0.25rem;
	}
	.intent-run {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: none;
		background: var(--coord-route-solid, #3bc4b8);
		color: oklch(0.12 0.01 250);
		cursor: pointer;
		transition: filter 220ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.intent-run--idle {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		border: 1px solid transparent;
	}

	.intent-run--idle[data-state='gated'] {
		border-color: oklch(0.55 0.02 60);
		border-left: 2px dashed oklch(0.55 0.02 60);
		background: transparent;
		color: var(--org-sidebar-text, oklch(0.92 0.005 55));
	}

	.intent-run-state {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		font-weight: 700;
		text-transform: uppercase;
		opacity: 0.72;
	}

	.intent-run:hover:not(:disabled),
	.intent-run:focus-visible:not(:disabled) {
		filter: brightness(1.08);
		outline: none;
	}
	.intent-run:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.intent-ghost {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid oklch(0.34 0.02 250 / 0.7);
		background: transparent;
		color: var(--org-sidebar-text-muted, oklch(0.6 0.01 55));
		cursor: pointer;
	}
	.intent-ghost:hover {
		color: var(--org-sidebar-text, oklch(0.92 0.005 55));
	}
	.intent-error {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: oklch(0.7 0.16 30);
	}

	/* ─── Glyph ─── */
	.pnode-glyph {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}
	.glyph-dot {
		flex-shrink: 0;
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 50%;
		background: var(--stage-color);
		box-shadow: 0 0 12px -1px var(--stage-color);
	}
	.pnode--running .glyph-dot {
		animation: dot-breath 1.8s ease-in-out infinite;
	}
	.glyph-body {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		min-width: 0;
		flex: 1 1 auto;
	}
	.glyph-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--org-sidebar-text, oklch(0.92 0.005 55));
	}
	.glyph-stage {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--org-sidebar-text-muted, oklch(0.6 0.01 55));
	}
	.glyph-pulse {
		flex-shrink: 0;
		line-height: 0;
	}

	/* ─── Open ─── */
	.pnode-open {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		position: relative;
	}
	.pnode-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.pnode-head-main {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.pnode-stage-dot {
		flex-shrink: 0;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--stage-color);
		box-shadow: 0 0 10px -1px var(--stage-color);
	}
	.pnode--running .pnode-stage-dot {
		animation: dot-breath 1.8s ease-in-out infinite;
	}
	.pnode-subject {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--org-sidebar-text, oklch(0.92 0.005 55));
	}
	.pnode-status {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding: 0.2rem 0.45rem;
		border-radius: 4px;
		background: oklch(0.26 0.018 250 / 0.7);
		color: var(--org-sidebar-text-muted, oklch(0.6 0.01 55));
	}
	.pnode-status[data-status='composed'] {
		color: var(--coord-verified, #10b981);
	}
	.pnode-status[data-status='error'] {
		color: oklch(0.7 0.16 30);
	}

	@keyframes dot-breath {
		0%,
		100% {
			opacity: 0.55;
			transform: scale(0.9);
		}
		50% {
			opacity: 1;
			transform: scale(1.1);
		}
	}

	/* Summary */
	.pnode-summary {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}
	.summary-thought {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		line-height: 1.5;
		margin: 0;
		color: var(--org-sidebar-text, oklch(0.86 0.008 55));
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.summary-thought--wait {
		color: var(--org-sidebar-text-muted, oklch(0.6 0.01 55));
		font-style: italic;
	}
	.summary-stage {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		margin-right: 0.4rem;
		color: var(--stage-color);
	}
	.summary-pulse {
		line-height: 0;
	}

	/* Full trace */
	.pnode-trace {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-height: 36vh;
		overflow-y: auto;
		padding-right: 0.25rem;
		scrollbar-width: thin;
		scrollbar-color: oklch(0.4 0.02 250 / 0.6) transparent;
	}
	.trace-empty {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-style: italic;
		color: var(--org-sidebar-text-muted, oklch(0.6 0.01 55));
		margin: 0;
	}
	.trace-line {
		display: flex;
		gap: 0.5rem;
		margin: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--org-sidebar-text, oklch(0.84 0.008 55));
	}
	.trace-tag {
		flex-shrink: 0;
		width: 3.5rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		padding-top: 0.18rem;
		color: var(--org-sidebar-text-dim, oklch(0.45 0.01 55));
	}
	.trace-line--ground .trace-tag {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.trace-line--author .trace-tag {
		color: var(--coord-share-solid, #4f46e5);
	}
	.trace-line--resolve .trace-tag {
		color: var(--coord-verified, #10b981);
	}
	.trace-text {
		min-width: 0;
	}
	.trace-action {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		padding: 0.4rem 0.625rem;
		border-radius: 6px;
		background: oklch(0.15 0.01 250);
		border-left: 2px solid oklch(0.4 0.02 250);
	}
	.trace-action--complete {
		border-left-color: var(--coord-verified, #10b981);
	}
	.trace-action--error {
		border-left-color: oklch(0.6 0.16 30);
	}
	.trace-action-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--org-sidebar-text, oklch(0.86 0.008 55));
	}
	.trace-action-status {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		color: var(--org-sidebar-text-muted, oklch(0.6 0.01 55));
	}

	/* Sections */
	.pnode-section {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding-top: 0.625rem;
		border-top: 1px solid oklch(0.28 0.018 250 / 0.6);
	}
	.section-label {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--org-sidebar-text-muted, oklch(0.6 0.01 55));
	}
	.dm-list,
	.src-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.dm-item {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
	}
	.dm-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--org-sidebar-text, oklch(0.86 0.008 55));
	}
	.dm-role {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		color: var(--org-sidebar-text-muted, oklch(0.6 0.01 55));
	}
	.source-evidence {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
	}
	.source-evidence-item {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		min-height: 1.35rem;
		padding: 0.12rem 0.4rem;
		border: 1px solid oklch(0.34 0.018 250 / 0.7);
		border-radius: 4px;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		line-height: 1;
		text-transform: uppercase;
		color: var(--org-sidebar-text-muted, oklch(0.62 0.01 55));
		background: oklch(0.16 0.012 250 / 0.42);
	}
	:global(.source-evidence-num) {
		color: var(--org-sidebar-text, oklch(0.86 0.008 55));
	}
	.source-evidence-item--boundary {
		border-color: oklch(0.55 0.12 58 / 0.55);
		color: oklch(0.74 0.08 65);
		background: oklch(0.2 0.04 65 / 0.22);
	}
	.source-evidence-note {
		margin: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.35;
		color: var(--org-sidebar-text-muted, oklch(0.62 0.01 55));
	}
	.src-item {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		font-size: 0.75rem;
	}
	.src-num {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		color: var(--org-sidebar-text-dim, oklch(0.45 0.01 55));
	}
	.src-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		color: var(--org-sidebar-text, oklch(0.82 0.008 55));
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1 1 auto;
	}
	.src-pos {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		padding: 0.1rem 0.3rem;
		border-radius: 3px;
	}
	.src-pos--adversarial {
		color: var(--coord-verified, #10b981);
		background: oklch(0.3 0.08 165 / 0.25);
	}
	.src-pos--neutral {
		color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.3 0.06 195 / 0.25);
	}
	.src-pos--aligned {
		color: var(--coord-share-solid, #4f46e5);
		background: oklch(0.3 0.08 280 / 0.25);
	}
	.src-pos--search-only {
		color: oklch(0.74 0.08 65);
		background: oklch(0.24 0.04 65 / 0.3);
	}
	.specimen {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.specimen-para {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.55;
		margin: 0;
		color: var(--org-sidebar-text, oklch(0.82 0.008 55));
		white-space: pre-wrap;
	}
	.pnode-error {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: oklch(0.72 0.16 30);
		margin: 0;
	}

	.pnode-foot {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding-top: 0.625rem;
		border-top: 1px solid oklch(0.28 0.018 250 / 0.6);
	}
	.pnode-action {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.4rem 0.75rem;
		border-radius: 7px;
		border: 1px solid oklch(0.34 0.02 250 / 0.7);
		background: transparent;
		color: var(--org-sidebar-text, oklch(0.86 0.008 55));
		cursor: pointer;
		transition: background 220ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	.pnode-action:hover {
		background: oklch(0.24 0.016 250);
	}
	.pnode-action--stop {
		border-color: oklch(0.5 0.14 30 / 0.7);
		color: oklch(0.78 0.12 30);
	}
	.pnode-foot-note {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--org-sidebar-text-dim, oklch(0.45 0.01 55));
	}

	@media (prefers-reduced-motion: reduce) {
		.pnode-halo,
		.glyph-dot,
		.pnode-stage-dot {
			animation: none !important;
		}
	}
</style>
