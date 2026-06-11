<!--
  StudioSpace — the STUDIO space, a live VIEW over the OS process registry.

  This is the authoring center of the org-OS, but it does not own the
  authoring run. The streaming PROCESS lives in the OS process registry,
  driven by the runner (`startAuthoringProcess` in
  `$lib/core/authoring-process.ts`). STUDIO here only:

    · collects INTENT (subject line + core message + audience guidance) and
      spawns a process via the runner;
    · reads `orgOS.focusedProcess` and renders its reasoning entries, resolved
      decision-makers, source pool, and composed message as they stream in.

  Because the run lives in the registry — outside this component's lifecycle —
  switching spaces (which hides, never unmounts, this view) does NOT stop the
  stream. When the operator reopens STUDIO, the in-flight reasoning is still
  scrolling. The emitted process ledger also restores from device-local storage
  after refresh, while live streams restore as detached rather than running.

  HONESTY RULE: every thought, source, decision-maker, and line of output is
  what a REAL SSE stream emitted, threaded through the registry by the runner,
  or a recovered job result decrypted on this device. Nothing on this surface
  is fabricated; an idle/empty process renders a marked empty state, never a
  faked trace. When the authoring runtime is not connected, the surface says so
  in one plain sentence instead of pretending the loop can run.
-->
<script lang="ts">
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { Artifact, Datum } from '$lib/design';
	import { SPRINGS, TIMING, EASING } from '$lib/design/motion';
	import { getOrgOS, isRunning } from './orgOS.svelte';
	import { startAuthoringProcess } from '$lib/core/authoring-process';
	import StudioReasoning from '$lib/components/org/studio/StudioReasoning.svelte';
	import StudioSources from '$lib/components/org/studio/StudioSources.svelte';
	import StudioSend from '$lib/components/org/studio/StudioSend.svelte';
	import BoundedNotice from '$lib/components/org/BoundedNotice.svelte';
	import {
		authoringRuntimeLimitNotice,
		congressionalDeliveryLimitNotice
	} from '$lib/data/org-limit-sentences';
	import {
		saveStudioProcessAsOrgEmailDraft,
		saveStudioProcessAsTemplateDraft
	} from '$lib/components/org/studio/studio-draft-bridge';
	import type { OrgSpacesData } from './spaces';

	let {
		canPublish,
		spaces
	}: {
		/** Role-derived: owner/editor can hand drafts to delivery surfaces; members watch. */
		canPublish: boolean;
		/** OS slices loaded once by the org layout; STUDIO reads the operating ground. */
		spaces: OrgSpacesData;
	} = $props();

	type TraceReplayEvent = {
		at: number;
		endpoint: string;
		eventType: string;
		success: boolean | null;
		durationMs: number | null;
		costUsd: number | null;
		expiresAt: number;
		summary: string;
		payloadKeys: string[];
	};

	const os = getOrgOS();
	const composeHref = '/?create=true';
	const orgEmailHref = $derived(`${os.base}/emails/compose`);

	// ─── Authoring runtime ground (from the layout's real env probes) ───
	const authoringRuntime = $derived(spaces.operating?.authoring ?? null);
	const authoringRuntimeReady = $derived(authoringRuntime?.runtimeReady === true);
	const authoringNotice = $derived(authoringRuntimeLimitNotice(authoringRuntime));

	// Congressional delivery is one plain sentence until it is available.
	const congressionalDelivery = $derived(spaces.operating?.congressionalDelivery ?? null);
	const congressionalAvailable = $derived(
		congressionalDelivery?.launched === true && congressionalDelivery?.runtimeReady === true
	);
	const congressionalNotice = $derived(
		congressionalAvailable ? null : congressionalDeliveryLimitNotice(congressionalDelivery)
	);

	// ─── INTENT inputs (the only local state STUDIO still owns) ──────────
	let subjectLine = $state('');
	let coreMessage = $state('');
	let audienceGuidance = $state('');
	let intentError = $state<string | null>(null);
	let traceReplayStatus = $state<'idle' | 'loading' | 'loaded' | 'error'>('idle');
	let traceReplayTraceId = $state<string | null>(null);
	let traceReplayEvents = $state<TraceReplayEvent[]>([]);
	let traceReplayError = $state<string | null>(null);

	// ─── The focused process — STUDIO renders whatever the OS hands it ───
	const proc = $derived(os.focusedProcess);
	const running = $derived(proc ? isRunning(proc) : false);
	const runningProcessCount = $derived(os.runningProcesses.length);
	const entries = $derived(proc?.entries ?? []);
	const activeStage = $derived(proc?.activeStage ?? null);
	const stageLabel = $derived(proc?.stageLabel ?? '');
	const decisionMakers = $derived(proc?.decisionMakers ?? []);
	const droppedEmailless = $derived(proc?.droppedEmailless ?? 0);
	const sources = $derived(proc?.sources ?? []);
	const composedMessage = $derived(proc?.composedMessage ?? '');
	const messageParagraphs = $derived(
		composedMessage.split(/\n{2,}/).filter((p: string) => p.trim())
	);
	const sendReady = $derived(proc?.status === 'composed' && composedMessage.length > 0);
	// Show the process subject (not the live input) above the authored message.
	const procSubject = $derived(proc?.intent.subjectLine ?? '');

	// A loop that closed without output explains itself in one plain line.
	const closedLoopSentence = $derived(
		proc && !composedMessage
			? proc.status === 'error'
				? (proc.errorMessage ??
					proc.resolutionStopDetail ??
					'The loop failed before composing a message.')
				: proc.status === 'stopped'
					? (proc.resolutionStopDetail ??
						proc.errorMessage ??
						'This loop stopped before composing a message.')
					: null
			: null
	);

	const activeMessageJob = $derived(proc?.activeMessageJob ?? null);
	const activeTraceId = $derived(activeMessageJob?.traceId ?? null);
	const traceReplayEventCount = $derived(
		traceReplayTraceId === activeTraceId ? traceReplayEvents.length : 0
	);

	function formatTraceTime(value: number): string {
		return new Date(value).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	async function loadTraceReplay() {
		if (!activeTraceId || traceReplayStatus === 'loading') return;
		traceReplayStatus = 'loading';
		traceReplayTraceId = activeTraceId;
		traceReplayError = null;
		try {
			const response = await fetch(`/api/agents/traces/${encodeURIComponent(activeTraceId)}`, {
				credentials: 'include'
			});
			const body = (await response.json().catch(() => ({}))) as {
				error?: string;
				events?: TraceReplayEvent[];
			};
			if (!response.ok) {
				throw new Error(body.error || 'Replay is unavailable.');
			}
			traceReplayEvents = body.events ?? [];
			traceReplayStatus = 'loaded';
		} catch (err) {
			traceReplayEvents = [];
			traceReplayStatus = 'error';
			traceReplayError = err instanceof Error ? err.message : 'Replay is unavailable.';
		}
	}

	function runLoop() {
		intentError = null;
		if (!authoringRuntimeReady) {
			intentError = authoringNotice.sentence;
			return;
		}
		if (!subjectLine.trim() || !coreMessage.trim()) {
			intentError = 'An intent needs a subject line and a core message.';
			return;
		}
		// Hand the intent to the OS runner. It spawns + focuses the process and
		// drives the stream independently of this component. STUDIO immediately
		// reflects the new focused process via os.focusedProcess.
		startAuthoringProcess(os, {
			subjectLine: subjectLine.trim(),
			coreMessage: coreMessage.trim(),
			audienceGuidance: audienceGuidance.trim()
		});
	}

	function stopLoop() {
		if (proc) os.stopProcess(proc.id);
	}

	function takeToPublish() {
		if (!proc || proc.status !== 'composed' || !composedMessage.trim()) return;
		const draftId = saveStudioProcessAsTemplateDraft(proc);
		// Creation is modal-first at the public authoring entry. STUDIO hands
		// off the real resolved audience, sources, and composed message as a
		// draft instead of dropping state on a blank creator.
		window.location.href = `${composeHref}&resumeDraft=${encodeURIComponent(draftId)}`;
	}

	function takeToOrgEmail() {
		if (!proc || proc.status !== 'composed' || !composedMessage.trim()) return;
		const draftId = saveStudioProcessAsOrgEmailDraft(proc);
		window.location.href = `${orgEmailHref}?studioDraft=${encodeURIComponent(draftId)}`;
	}
</script>

<div class="studio" style="--timing-slow: {TIMING.SLOW}ms; --easing: {EASING};">
	<header class="studio-head">
		<div class="studio-head-copy">
			<h1 class="studio-title">Studio</h1>
			<p class="studio-sub">
				The action you author and send — with the instrument's reasoning visible as you go.
			</p>
		</div>
		<div class="studio-head-side">
			{#if runningProcessCount > 0}
				<span class="studio-live" role="status">
					<span class="studio-live-dot" aria-hidden="true"></span>
					<Datum value={runningProcessCount} animate spring={SPRINGS.COUNT_TICK} />
					<span>{runningProcessCount === 1 ? 'loop running' : 'loops running'}</span>
				</span>
			{/if}
			<a class="studio-public" href={composeHref} data-sveltekit-preload-data="off">
				Public action draft →
			</a>
		</div>
	</header>

	<!-- INTENT — entered in-surface, not a wizard step -->
	<section id="studio-intent" class="intent" aria-label="Author a new action">
		<div class="intent-field">
			<label class="intent-label" for="studio-subject">Subject line</label>
			<input
				id="studio-subject"
				class="intent-input"
				type="text"
				bind:value={subjectLine}
				maxlength={200}
				placeholder="What is this action about?"
				disabled={running}
			/>
		</div>
		<div class="intent-field">
			<label class="intent-label" for="studio-core">Core message</label>
			<textarea
				id="studio-core"
				class="intent-textarea"
				rows={3}
				bind:value={coreMessage}
				maxlength={16000}
				placeholder="The substance — what you want the decision-makers to do, and why."
				disabled={running}
			></textarea>
		</div>
		<div class="intent-field">
			<label class="intent-label" for="studio-audience"
				>Audience guidance <span class="intent-opt">optional</span></label
			>
			<input
				id="studio-audience"
				class="intent-input"
				type="text"
				bind:value={audienceGuidance}
				placeholder="e.g. San Francisco health department leadership"
				disabled={running}
			/>
		</div>

		{#if !authoringRuntimeReady}
			<BoundedNotice notice={authoringNotice} />
		{/if}

		<div class="intent-actions">
			<button
				type="button"
				class="intent-run"
				class:intent-run--stop={running}
				onclick={running ? stopLoop : runLoop}
				disabled={!running && !authoringRuntimeReady}
			>
				{running ? 'Stop the loop' : proc ? 'Run a new loop' : 'Run the loop'}
			</button>
			{#if intentError}
				<span class="intent-error" role="alert">{intentError}</span>
			{/if}
		</div>
	</section>

	<!-- CENTERPIECE — the live reasoning surface (read from the focused process) -->
	<StudioReasoning {entries} {activeStage} {stageLabel} />

	{#if closedLoopSentence}
		<p class="loop-boundary" role="status">{closedLoopSentence}</p>
	{/if}

	{#if activeTraceId}
		<section
			class="trace"
			aria-label="Run replay"
			in:fly={{ y: 8, duration: TIMING.SLOW, easing: cubicOut }}
		>
			<header class="trace-head">
				<div>
					<p class="trace-kicker">Run replay</p>
					<h2 class="trace-title">What this run did</h2>
				</div>
				<div class="trace-controls">
					<span class="trace-count">
						<Datum value={traceReplayEventCount || null} />
						<span>events</span>
					</span>
					<button
						type="button"
						class="trace-load"
						onclick={loadTraceReplay}
						disabled={traceReplayStatus === 'loading'}
					>
						{traceReplayStatus === 'loading'
							? 'Loading…'
							: traceReplayEventCount > 0
								? 'Refresh replay'
								: 'Load replay'}
					</button>
				</div>
			</header>
			<p class="trace-note">
				Replay is redacted: prompts and full model responses stay private. Steps, timing, and cost
				are listed for the operator who ran this loop.
			</p>
			{#if traceReplayError}
				<p class="trace-error" role="alert">{traceReplayError}</p>
			{/if}
			{#if traceReplayEvents.length > 0}
				<ol class="trace-list">
					{#each traceReplayEvents as event (event.at + event.eventType)}
						<li class="trace-event">
							<span class="trace-event-time">{formatTraceTime(event.at)}</span>
							<span class="trace-event-type">{event.eventType}</span>
							<span class="trace-event-summary">{event.summary}</span>
							{#if event.durationMs !== null}
								<span class="trace-event-metric">
									<Datum value={event.durationMs} />
									<span>ms</span>
								</span>
							{/if}
							{#if event.costUsd !== null}
								<span class="trace-event-metric">
									<Datum value={event.costUsd} decimals={4} />
									<span>usd</span>
								</span>
							{/if}
						</li>
					{/each}
				</ol>
			{/if}
		</section>
	{/if}

	<!-- The loop's products: resolved audience, source ground, authored message -->
	<div class="studio-products">
		{#if decisionMakers.length > 0 || droppedEmailless > 0}
			<section
				class="dm"
				aria-label="Resolved decision-makers"
				in:fly={{ y: 8, duration: TIMING.SLOW, easing: cubicOut }}
			>
				<header class="dm-head">
					<span class="dm-title">Resolved decision-makers</span>
					<span class="dm-count">
						<Datum value={decisionMakers.length} animate spring={SPRINGS.METRIC} class="dm-count-num" />
						<span class="dm-count-label">contactable</span>
						{#if droppedEmailless > 0}
							<span class="dm-dropped"
								>· <Datum value={droppedEmailless} class="dm-dropped-num" /> dropped, no public email</span
							>
						{/if}
					</span>
				</header>
				<ul class="dm-list">
					{#each decisionMakers as dm (dm.name + dm.organization)}
						<li class="dm-item">
							<span class="dm-name">{dm.name}</span>
							<span class="dm-role">{dm.title}{dm.organization ? ` · ${dm.organization}` : ''}</span>
							{#if dm.email}
								<span class="dm-email">{dm.email}</span>
							{:else}
								<span class="dm-noemail">no public email</span>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if sources.length > 0}
			<div in:fly={{ y: 8, duration: TIMING.SLOW, easing: cubicOut }}>
				<StudioSources {sources} />
			</div>
		{/if}

		{#if composedMessage}
			<!-- AUTHOR output — the white specimen. Every citation traces to a real URL. -->
			<div class="specimen" in:fly={{ y: 8, duration: TIMING.SLOW, easing: cubicOut }}>
				<span class="specimen-label">Authored message</span>
				<Artifact padding="default">
					{#if procSubject}
						<p class="specimen-subject">{procSubject}</p>
					{/if}
					{#each messageParagraphs as para, i (i)}
						<p class="specimen-para">{para}</p>
					{/each}
				</Artifact>
			</div>
		{/if}
	</div>

	<!-- SEND — where the authored action leaves the Studio -->
	<StudioSend
		ready={sendReady}
		{canPublish}
		{congressionalNotice}
		onpublish={takeToPublish}
		onemail={takeToOrgEmail}
	/>
</div>

<style>
	.studio {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		width: 100%;
	}

	/* ─── Head ─── */
	.studio-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.studio-head-copy {
		min-width: 0;
	}

	.studio-head-side {
		display: flex;
		flex-shrink: 0;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
	}

	.studio-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: -0.01em;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0;
	}

	.studio-sub {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		color: var(--text-tertiary, #6b7280);
		margin: 0.25rem 0 0;
		max-width: 36rem;
	}

	.studio-live {
		display: inline-flex;
		align-items: baseline;
		gap: 0.375rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--coord-route-solid, #3bc4b8);
		white-space: nowrap;
	}

	.studio-live-dot {
		align-self: center;
		width: 0.4375rem;
		height: 0.4375rem;
		border-radius: 50%;
		background: var(--coord-route-solid, #3bc4b8);
		animation: studio-live-pulse 1.6s ease-in-out infinite;
	}

	@keyframes studio-live-pulse {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.studio-live-dot {
			animation: none;
			opacity: 1;
		}
	}

	.studio-public {
		flex-shrink: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--coord-route-solid, #3bc4b8);
		text-decoration: none;
		transition: color var(--timing-slow) var(--easing);
	}
	.studio-public:hover,
	.studio-public:focus-visible {
		text-decoration: underline;
		outline: none;
	}

	@media (max-width: 760px) {
		.studio-head {
			flex-direction: column;
		}
	}

	@media (min-width: 860px) {
		.studio-head-side {
			align-items: flex-end;
		}
	}

	/* ─── Intent ─── */
	.intent {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		scroll-margin-top: 6rem;
		padding: 1.125rem;
		border-radius: 8px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-base, oklch(0.993 0.003 60));
	}

	.intent-field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.intent-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-secondary, oklch(0.4 0.01 60));
	}

	.intent-opt {
		font-weight: 400;
		color: var(--text-tertiary, #9ca3af);
		font-size: 0.6875rem;
	}

	.intent-input,
	.intent-textarea {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		color: var(--text-primary, oklch(0.25 0.01 60));
		padding: 0.625rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: #ffffff;
		resize: vertical;
		transition:
			border-color var(--timing-slow) var(--easing),
			box-shadow var(--timing-slow) var(--easing);
	}

	.intent-input:focus,
	.intent-textarea:focus {
		outline: none;
		border-color: var(--coord-route-solid, #3bc4b8);
		box-shadow: 0 0 0 3px oklch(0.7 0.13 190 / 0.12);
	}

	.intent-input:disabled,
	.intent-textarea:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.intent-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.intent-run {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 700;
		letter-spacing: 0.01em;
		padding: 0.625rem 1.25rem;
		border-radius: 8px;
		border: none;
		background: var(--coord-route-solid, #3bc4b8);
		color: #ffffff;
		cursor: pointer;
		transition: filter var(--timing-slow) var(--easing);
	}
	.intent-run:hover:not(:disabled),
	.intent-run:focus-visible:not(:disabled) {
		filter: brightness(1.06);
		outline: none;
	}
	.intent-run:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.intent-run--stop {
		background: oklch(0.55 0.18 30);
	}

	.intent-error {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.5 0.18 30);
	}

	/* ─── Closed-loop boundary line ─── */
	.loop-boundary {
		margin: 0;
		max-width: 72ch;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}

	/* ─── Run replay ─── */
	.trace {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-radius: 8px;
		padding: 1rem;
		background: var(--surface-base, oklch(0.993 0.003 60));
	}

	.trace-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.trace-kicker,
	.trace-event-type {
		margin: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		color: var(--coord-route-solid, #3bc4b8);
	}

	.trace-title {
		margin: 0.125rem 0 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 650;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.trace-controls {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.625rem;
	}

	.trace-count,
	.trace-event-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3rem;
		font-size: 0.72rem;
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}

	.trace-load {
		min-height: 2rem;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-radius: 6px;
		padding: 0.35rem 0.625rem;
		background: var(--surface-overlay, oklch(0.975 0.005 55));
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		font-weight: 650;
		color: var(--text-primary, oklch(0.25 0.01 60));
		cursor: pointer;
	}

	.trace-load:disabled {
		cursor: wait;
		opacity: 0.62;
	}

	.trace-note,
	.trace-error {
		margin: 0;
		max-width: 72ch;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.78rem;
		line-height: 1.55;
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}

	.trace-error {
		color: var(--coord-risk, #e76f51);
	}

	.trace-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.trace-event {
		display: grid;
		grid-template-columns: minmax(5rem, auto) minmax(8rem, 0.8fr) minmax(0, 2fr) auto auto;
		align-items: baseline;
		gap: 0.625rem;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.72));
		padding-top: 0.5rem;
	}

	.trace-event-time {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.72rem;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.trace-event-summary {
		min-width: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.78rem;
		line-height: 1.45;
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}

	@media (max-width: 740px) {
		.trace-head,
		.trace-controls {
			align-items: flex-start;
			flex-direction: column;
		}

		.trace-event {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	/* ─── Products ─── */
	.studio-products {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	/* Decision-makers */
	.dm {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}
	.dm-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.dm-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.dm-count {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3rem;
	}
	.dm :global(.dm-count-num) {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.dm-count-label,
	.dm-dropped {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		color: var(--text-tertiary, #6b7280);
	}
	.dm :global(.dm-dropped-num) {
		font-size: 0.6875rem;
		color: var(--text-tertiary, #9ca3af);
	}
	.dm-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.dm-item {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: #ffffff;
	}
	.dm-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.dm-role {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary, #6b7280);
	}
	.dm-email {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: var(--coord-verified, #10b981);
	}
	.dm-noemail {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: var(--text-tertiary, #9ca3af);
	}

	/* Specimen (authored message) */
	.specimen {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}
	.specimen-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.specimen-subject {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0 0 0.75rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.specimen-para {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.9375rem;
		line-height: 1.6;
		color: var(--text-secondary, oklch(0.32 0.01 60));
		margin: 0 0 0.75rem;
		white-space: pre-wrap;
	}
	.specimen-para:last-child {
		margin-bottom: 0;
	}
</style>
