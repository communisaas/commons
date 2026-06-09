/**
 * authoring-process — the OS-level runner for the STUDIO authoring loop.
 *
 * This is the heart of the multitasking tell: a Compose spawns a PROCESS that
 * keeps running (and streaming) independently of any component lifecycle. The
 * runner holds no Svelte reactivity of its own — it drives the orgOS process
 * registry by id, pushing real streamed state in as the SSE events arrive.
 * Because nothing here lives inside a component, switching spaces (which
 * unmounts/hides the STUDIO view) does NOT stop the stream. The process runs
 * to completion or until the operator aborts it via `orgOS.stopProcess(id)`.
 *
 * The loop, unchanged from the prior in-component implementation:
 *
 *   INTENT   — the operator's subject line + core message + audience guidance
 *   RESOLVE  — POST /api/agents/stream-decision-makers  (verbose tool loop)
 *   GROUND   — stream-message phase 'sources' thoughts + evaluatedSources
 *   AUTHOR   — stream-message phase 'message' thoughts + composed message
 *
 * RESOLVE runs first (the audience the message is authored AGAINST), then the
 * message stream grounds + authors against it.
 *
 * THE HONESTY RULE carries over verbatim: every thought, source, decision-
 * maker, and line of output pushed into a process is exactly what a REAL SSE
 * stream emitted. Nothing here fabricates a thought, a source, or a count.
 * Faking the streaming would defeat the entire point of the multitasking OS.
 */

import { parseSSEStream } from '$lib/utils/sse-stream';
import type { OrgOS, AuthoringIntent } from '$lib/components/org/os/orgOS.svelte';
import type { ReasoningStage } from '$lib/components/org/studio/StudioReasoning.svelte';
import type { StudioSource } from '$lib/components/org/studio/StudioSources.svelte';
import type { GeoScope } from '$lib/core/agents/types';
import type { SourceEvidenceUpdate } from '$lib/core/agents/agents/message-writer';
import type { ResolutionStopReason } from '$lib/data/capability-hypergraph';
import {
	computeMessageInputHash,
	decryptMessageJobResult,
	getOrCreateMessageRecoveryPublicKey,
	type ActiveMessageJob,
	type EncryptedMessageJobResult
} from '$lib/core/agents/message-job-recovery';
import { displayGeoScope } from '$lib/core/location/location-resolver';
import { getStateName, US_STATES } from '$lib/core/location/state-codes';

type ResolvedList = Array<{
	name: string;
	title: string;
	organization: string;
	email?: string;
}>;

type ScopeEvidenceSource = 'resolved-targets' | 'audience-guidance' | 'fallback';

type ScopeEvidence = {
	scope: GeoScope;
	label: string;
	basis: string;
	source: ScopeEvidenceSource;
};

type MessageGenerationPayload = {
	subject_line: string;
	core_message: string;
	topics: string[];
	decision_makers: Array<{
		name: string;
		title: string;
		organization: string;
	}>;
	geographic_scope: GeoScope;
	verbose: true;
};

type MessageGenerationResult = {
	message?: string;
	sources?: StudioSource[];
	evaluatedSources?: StudioSource[];
};

type RecoverableMessageJob = {
	jobId: string;
	inputHash: string;
	status: ActiveMessageJob['status'];
	traceId?: string;
	phase?: string | null;
	encryptedResult?: unknown;
	errorMessage?: string | null;
};

type LocalityHint = {
	patterns: string[];
	locality: string;
	state: string;
};

type NormalizedSourceEvidence = {
	sourceCount: number;
	evaluatedSourceCount: number;
	searchOnlySourceCount: number;
	mode: SourceEvidenceUpdate['mode'] | null;
	evaluationFallback: boolean;
	candidateCount: number | null;
	failedCount: number | null;
	searchQueryCount: number | null;
};

type ResolutionStopBoundary = {
	reason: ResolutionStopReason;
	detail: string;
};

const STATE_CODES = new Set(Object.values(US_STATES));
const US_LOCALITY_HINTS: LocalityHint[] = [
	{ patterns: ['san francisco', 'sf'], locality: 'San Francisco', state: 'CA' },
	{ patterns: ['new york city', 'nyc'], locality: 'New York', state: 'NY' },
	{ patterns: ['los angeles', 'la'], locality: 'Los Angeles', state: 'CA' },
	{ patterns: ['chicago'], locality: 'Chicago', state: 'IL' },
	{ patterns: ['washington dc', 'washington, dc', 'dc'], locality: 'Washington DC', state: 'DC' },
	{ patterns: ['seattle'], locality: 'Seattle', state: 'WA' },
	{ patterns: ['portland'], locality: 'Portland', state: 'OR' },
	{ patterns: ['boston'], locality: 'Boston', state: 'MA' },
	{ patterns: ['philadelphia', 'philly'], locality: 'Philadelphia', state: 'PA' },
	{ patterns: ['atlanta'], locality: 'Atlanta', state: 'GA' }
];

/** Derive search topics from the subject line (same heuristic STUDIO used). */
function deriveTopics(subjectLine: string): string[] {
	const topics = subjectLine
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length > 3)
		.slice(0, 4);
	return topics.length > 0 ? topics : [subjectLine.slice(0, 60)];
}

function phrasePattern(phrase: string): RegExp {
	const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
}

function textContainsPhrase(text: string, phrase: string): boolean {
	return phrasePattern(phrase).test(text);
}

function stateScope(state: string): GeoScope {
	const display = getStateName(state);
	return {
		type: 'subnational',
		country: 'US',
		subdivision: `US-${state}`,
		displayName: `${display}, United States`
	};
}

function localityScope(locality: string, state?: string): GeoScope {
	const stateName = state ? getStateName(state) : null;
	return {
		type: 'subnational',
		country: 'US',
		subdivision: state ? `US-${state}` : undefined,
		locality,
		displayName: stateName
			? `${locality}, ${stateName}, United States`
			: `${locality}, United States`
	};
}

function extractState(text: string): string | null {
	for (const [name, code] of Object.entries(US_STATES)) {
		if (textContainsPhrase(text, name)) return code;
	}
	const uppercaseMatches = text.match(/\b[A-Z]{2}\b/g) ?? [];
	for (const code of uppercaseMatches) {
		if (STATE_CODES.has(code)) return code;
	}
	return null;
}

function extractLocality(text: string): { locality: string; state?: string } | null {
	for (const hint of US_LOCALITY_HINTS) {
		if (hint.patterns.some((pattern) => textContainsPhrase(text, pattern))) {
			return { locality: hint.locality, state: hint.state };
		}
	}

	const patterns = [
		/City of ([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/,
		/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+(?:City Council|Board of Supervisors|Town Council|Village Board|Borough Council)/,
		/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+County/
	];
	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match?.[1]) return { locality: match[1], state: extractState(text) ?? undefined };
	}

	return null;
}

function evidence(scope: GeoScope, basis: string, source: ScopeEvidenceSource): ScopeEvidence {
	return {
		scope,
		label: displayGeoScope(scope),
		basis,
		source
	};
}

/** Heuristic geographic scope. The UI marks this as partial, never as a hard jurisdiction resolver. */
function inferScope(intent: AuthoringIntent, decisionMakers: ResolvedList): ScopeEvidence {
	if (decisionMakers.length > 0) {
		const orgs = decisionMakers.map((dm) => dm.organization || '').filter(Boolean);
		const localities = orgs
			.map(extractLocality)
			.filter((l): l is { locality: string; state?: string } => l !== null);
		if (localities.length === orgs.length) {
			const localKeys = new Set(localities.map((l) => `${l.locality}:${l.state ?? ''}`));
			if (localKeys.size === 1) {
				const local = localities[0];
				return evidence(
					localityScope(local.locality, local.state),
					'Inferred from the common locality across resolved decision-maker organizations.',
					'resolved-targets'
				);
			}
		}

		const states = orgs.map(extractState).filter((state): state is string => state !== null);
		if (states.length === orgs.length) {
			const uniqueStates = [...new Set(states)];
			if (uniqueStates.length === 1) {
				return evidence(
					stateScope(uniqueStates[0]),
					'Inferred from the common state across resolved decision-maker organizations.',
					'resolved-targets'
				);
			}
		}

		const federalPatterns =
			/\b(U\.?S\.?|United States|Congress|Senate|House of Representatives|Federal)\b/i;
		if (orgs.length > 0 && orgs.every((org) => federalPatterns.test(org))) {
			return evidence(
				{ type: 'nationwide', country: 'US', displayName: 'United States' },
				'Inferred from federal/national decision-maker organizations.',
				'resolved-targets'
			);
		}
	}

	if (intent.audienceGuidance.trim()) {
		const guidance = intent.audienceGuidance.trim();
		const guidedLocality = extractLocality(guidance);
		if (guidedLocality) {
			return evidence(
				localityScope(guidedLocality.locality, guidedLocality.state),
				'Inferred from operator audience guidance; resolved targets remain the stronger evidence.',
				'audience-guidance'
			);
		}
		const guidedState = extractState(guidance);
		if (guidedState) {
			return evidence(
				stateScope(guidedState),
				'Inferred from operator audience guidance; resolved targets remain the stronger evidence.',
				'audience-guidance'
			);
		}
	}

	return evidence(
		{ type: 'nationwide', country: 'US', displayName: 'United States' },
		'No common local/state scope was inferable; source discovery used the explicit nationwide US fallback.',
		'fallback'
	);
}

function buildResolutionStopBoundary(droppedTargetCount: number): ResolutionStopBoundary {
	if (droppedTargetCount > 0) {
		const noun = droppedTargetCount === 1 ? 'target' : 'targets';
		return {
			reason: 'no-public-email',
			detail: `${droppedTargetCount} resolved ${noun} lacked usable public email or deliverability evidence; AUTHOR stayed closed.`
		};
	}

	return {
		reason: 'no-target',
		detail:
			'No decision-maker identity with contactable public email was emitted; AUTHOR stayed closed.'
	};
}

/**
 * RESOLVE — decision-maker tool loop (verbose).
 * Streams real planning + resolved candidates into the process by id.
 * Returns the resolved decision-makers so AUTHOR can ground against them.
 */
async function runResolve(
	os: OrgOS,
	id: string,
	intent: AuthoringIntent,
	signal: AbortSignal
): Promise<ResolvedList> {
	os.setStage(id, 'resolve', 'Resolve');
	os.setStatus(id, 'resolving');

	const topics = deriveTopics(intent.subjectLine);

	const res = await fetch('/api/agents/stream-decision-makers', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		signal,
		body: JSON.stringify({
			subject_line: intent.subjectLine,
			core_message: intent.coreMessage,
			topics,
			audience_guidance: intent.audienceGuidance || undefined,
			verbose: true
		})
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		if (res.status === 401) throw new Error('Sign in required to run the authoring loop.');
		if (res.status === 429)
			throw new Error(body.error || 'Research limit reached. Try again later.');
		throw new Error(body.error || 'Decision-maker resolution failed.');
	}

	let decisionMakers: ResolvedList = [];
	let droppedTargetCount = 0;

	for await (const event of parseSSEStream<Record<string, unknown>>(res)) {
		if (signal.aborted) return decisionMakers;
		switch (event.type) {
			case 'segment': {
				const seg = event.data as {
					type?: string;
					content?: string;
					action?: string;
					title?: string;
					status?: string;
					status_message?: string;
				};
				if (seg.type === 'action' && seg.title) {
					os.pushAction(
						id,
						'resolve',
						seg.action || 'search',
						seg.title,
						(seg.status as 'in_progress' | 'complete' | 'error') || 'in_progress',
						seg.status_message
					);
				} else if (typeof seg.content === 'string' && seg.content.trim()) {
					os.pushThought(id, 'resolve', seg.content);
				}
				break;
			}
			case 'candidate-resolved': {
				const c = event.data as {
					name?: string;
					title?: string;
					organization?: string;
					email?: string;
				};
				if (c.name) {
					os.pushThought(
						id,
						'resolve',
						`Resolved ${c.name}${c.title ? ` — ${c.title}` : ''}${
							c.email ? ` (${c.email})` : ' (no public email)'
						}`
					);
				}
				break;
			}
			case 'verification': {
				const v = event.data as { message?: string };
				if (v.message) os.pushThought(id, 'resolve', v.message);
				break;
			}
			case 'complete': {
				const r = event.data as {
					decision_makers?: Array<{
						name: string;
						title: string;
						organization: string;
						email?: string;
					}>;
					pipeline_stats?: { total_resolved?: number; verified_emails?: number };
				};
				decisionMakers = (r.decision_makers || []).map((d) => ({
					name: d.name,
					title: d.title,
					organization: d.organization,
					email: d.email
				}));
				const total = r.pipeline_stats?.total_resolved ?? decisionMakers.length;
				const dropped = Math.max(0, total - decisionMakers.length);
				droppedTargetCount = dropped;
				const stopBoundary =
					decisionMakers.length === 0 ? buildResolutionStopBoundary(droppedTargetCount) : null;
				os.updateProcess(id, (p) => {
					p.decisionMakers = decisionMakers;
					p.droppedEmailless = droppedTargetCount;
					p.resolutionStopReason = stopBoundary?.reason ?? null;
					p.resolutionStopDetail = stopBoundary?.detail ?? null;
				});
				break;
			}
			case 'error':
				throw new Error(
					typeof event.data.message === 'string' ? event.data.message : 'Resolution failed'
				);
		}
	}

	if (decisionMakers.length === 0) {
		const stopBoundary = buildResolutionStopBoundary(droppedTargetCount);
		os.updateProcess(id, (p) => {
			p.droppedEmailless = droppedTargetCount;
			p.resolutionStopReason = stopBoundary.reason;
			p.resolutionStopDetail = stopBoundary.detail;
		});
		throw new Error(stopBoundary.detail);
	}

	return decisionMakers;
}

function buildMessagePayload(
	intent: AuthoringIntent,
	decisionMakers: ResolvedList,
	scope: GeoScope
): MessageGenerationPayload {
	const topics = deriveTopics(intent.subjectLine);
	return {
		subject_line: intent.subjectLine,
		core_message: intent.coreMessage,
		topics,
		decision_makers: decisionMakers.map((d) => ({
			name: d.name,
			title: d.title,
			organization: d.organization
		})),
		geographic_scope: scope,
		verbose: true
	};
}

function numberFromEvent(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value)
		? Math.max(0, Math.floor(value))
		: null;
}

function normalizeSourceEvidence(data: Record<string, unknown>): NormalizedSourceEvidence | null {
	const sourceCount = numberFromEvent(data.sourceCount);
	if (sourceCount === null) return null;

	let evaluatedSourceCount = numberFromEvent(data.evaluatedSourceCount);
	let searchOnlySourceCount = numberFromEvent(data.searchOnlySourceCount);

	if (evaluatedSourceCount === null || searchOnlySourceCount === null) {
		if (data.evaluationFallback === true) {
			evaluatedSourceCount = 0;
			searchOnlySourceCount = sourceCount;
		} else {
			evaluatedSourceCount = sourceCount;
			searchOnlySourceCount = 0;
		}
	}

	evaluatedSourceCount = Math.min(evaluatedSourceCount, sourceCount);
	searchOnlySourceCount = Math.min(
		searchOnlySourceCount,
		Math.max(0, sourceCount - evaluatedSourceCount)
	);

	return {
		sourceCount,
		evaluatedSourceCount,
		searchOnlySourceCount,
		mode: data.mode === 'discovery' || data.mode === 'preverified' ? data.mode : null,
		evaluationFallback: data.evaluationFallback === true,
		candidateCount: numberFromEvent(data.candidateCount),
		failedCount: numberFromEvent(data.failedCount),
		searchQueryCount: numberFromEvent(data.searchQueryCount)
	};
}

function applyMessageResult(os: OrgOS, id: string, result: MessageGenerationResult): string {
	const composedMessage = result.message || '';
	// Prefer evaluatedSources — they carry incentive_position +
	// credibility_rationale (the GROUND verdict). Fall back to the plain
	// source list (num/title/url/type) if absent.
	const evaluated = result.evaluatedSources;
	const sources = evaluated && evaluated.length > 0 ? evaluated : result.sources || [];
	os.updateProcess(id, (p) => {
		p.composedMessage = composedMessage;
		p.sources = sources;
		if (p.activeMessageJob) p.activeMessageJob.status = 'completed';
	});
	return composedMessage;
}

function updateActiveMessageJob(
	os: OrgOS,
	id: string,
	job: RecoverableMessageJob,
	startedAt: number
): ActiveMessageJob {
	let activeJob: ActiveMessageJob = {
		jobId: job.jobId,
		inputHash: job.inputHash,
		status: job.status,
		startedAt,
		recoveryKeyRef: job.jobId,
		traceId: job.traceId
	};
	os.updateProcess(id, (p) => {
		activeJob = {
			...activeJob,
			traceId: job.traceId ?? p.activeMessageJob?.traceId
		};
		p.activeMessageJob = activeJob;
	});
	return activeJob;
}

async function fetchRecoverableMessageJob(jobId: string, signal: AbortSignal) {
	const response = await fetch(`/api/agents/message-jobs/${encodeURIComponent(jobId)}`, {
		credentials: 'include',
		signal
	});
	if (response.status === 404) return null;
	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new Error(body.error || 'Could not recover authoring job.');
	}
	const body = (await response.json()) as { job?: RecoverableMessageJob | null };
	return body.job ?? null;
}

async function applyRecoverableMessageJob(
	os: OrgOS,
	id: string,
	job: RecoverableMessageJob,
	startedAt: number
): Promise<string | null> {
	updateActiveMessageJob(os, id, job, startedAt);

	if (job.status === 'completed' && job.encryptedResult) {
		const result = await decryptMessageJobResult<MessageGenerationResult>(
			job.jobId,
			job.inputHash,
			job.encryptedResult as EncryptedMessageJobResult
		);
		return applyMessageResult(os, id, result);
	}

	if (job.status === 'failed') {
		throw new Error(job.errorMessage || 'Authoring failed.');
	}

	if (job.status === 'expired') {
		throw new Error('Authoring expired. Please run the loop again.');
	}

	return null;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollRecoverableMessageJob(
	os: OrgOS,
	id: string,
	activeJob: ActiveMessageJob,
	signal: AbortSignal,
	maxMs = 30_000
): Promise<string | null> {
	const started = Date.now();
	while (!signal.aborted && Date.now() - started < maxMs) {
		const job = await fetchRecoverableMessageJob(activeJob.jobId, signal);
		if (!job) return null;
		const recovered = await applyRecoverableMessageJob(os, id, job, activeJob.startedAt);
		if (recovered !== null) return recovered;
		await sleep(3000);
	}
	return null;
}

/**
 * GROUND + AUTHOR — message stream (verbose).
 * Streams real GROUND thoughts + bounded source ground, then AUTHOR thoughts +
 * the composed message, into the process by id. Returns the composed message.
 */
async function runMessage(
	os: OrgOS,
	id: string,
	intent: AuthoringIntent,
	decisionMakers: ResolvedList,
	signal: AbortSignal
): Promise<string> {
	os.setStage(id, 'ground', 'Ground');
	os.setStatus(id, 'grounding');

	const scope = inferScope(intent, decisionMakers);
	const payload = buildMessagePayload(intent, decisionMakers, scope.scope);
	const inputHash = await computeMessageInputHash(payload);
	const jobId = crypto.randomUUID();
	const recoveryPublicKeyJwk = await getOrCreateMessageRecoveryPublicKey(jobId);
	const activeJob: ActiveMessageJob = {
		jobId,
		inputHash,
		status: 'pending',
		startedAt: Date.now(),
		recoveryKeyRef: jobId
	};

	os.updateProcess(id, (p) => {
		p.geographicScope = scope.scope;
		p.geographicScopeLabel = scope.label;
		p.geographicScopeBasis = scope.basis;
		p.geographicScopeSource = scope.source;
		p.activeMessageJob = activeJob;
	});

	const res = await fetch('/api/agents/stream-message', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		signal,
		body: JSON.stringify({
			...payload,
			job_id: jobId,
			input_hash: inputHash,
			recovery_public_key_jwk: recoveryPublicKeyJwk
		})
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		os.updateProcess(id, (p) => {
			p.activeMessageJob = null;
		});
		if (res.status === 401) throw new Error('Sign in required to run the authoring loop.');
		if (res.status === 429)
			throw new Error(body.error || 'Authoring limit reached. Try again later.');
		if (res.status === 403) throw new Error(body.error || 'Content flagged by the safety filter.');
		throw new Error(body.error || 'Authoring failed.');
	}

	let composedMessage = '';
	let streamCompleted = false;

	for await (const event of parseSSEStream<Record<string, unknown>>(res)) {
		if (signal.aborted) return composedMessage;
		switch (event.type) {
			case 'job': {
				const job = event.data as RecoverableMessageJob;
				updateActiveMessageJob(os, id, job, activeJob.startedAt);
				break;
			}
			case 'phase': {
				const p = event.data as { phase?: string; message?: string };
				if (p.phase === 'sources') {
					os.setStage(id, 'ground', 'Ground');
					os.setStatus(id, 'grounding');
				} else if (p.phase === 'message') {
					os.setStage(id, 'author', 'Author');
					os.setStatus(id, 'authoring');
				}
				break;
			}
			case 'thought': {
				const t = event.data as { content?: string; phase?: string };
				if (typeof t.content === 'string' && t.content.trim()) {
					const stage: ReasoningStage = t.phase === 'sources' ? 'ground' : 'author';
					os.pushThought(id, stage, t.content);
				}
				break;
			}
			case 'source-evidence': {
				const evidence = normalizeSourceEvidence(event.data);
				if (evidence) {
					os.updateProcess(id, (p) => {
						p.sourceEvidenceObserved = true;
						p.sourceEvidenceCount = evidence.sourceCount;
						p.sourceEvidenceEvaluatedCount = evidence.evaluatedSourceCount;
						p.sourceEvidenceSearchOnlyCount = evidence.searchOnlySourceCount;
						p.sourceEvidenceMode = evidence.mode;
						p.sourceEvidenceEvaluationFallback = evidence.evaluationFallback;
						p.sourceEvidenceCandidateCount = evidence.candidateCount;
						p.sourceEvidenceFailedCount = evidence.failedCount;
						p.sourceEvidenceSearchQueryCount = evidence.searchQueryCount;
					});
				}
				break;
			}
			case 'complete': {
				streamCompleted = true;
				composedMessage = applyMessageResult(os, id, event.data as MessageGenerationResult);
				break;
			}
			case 'job-complete': {
				streamCompleted = true;
				const job = (event.data as { job?: RecoverableMessageJob }).job;
				if (job) {
					composedMessage =
						(await applyRecoverableMessageJob(os, id, job, activeJob.startedAt)) ?? composedMessage;
				}
				break;
			}
			case 'job-running': {
				const job = (event.data as { job?: RecoverableMessageJob }).job;
				if (job) {
					const currentJob = updateActiveMessageJob(os, id, job, activeJob.startedAt);
					const recovered = await pollRecoverableMessageJob(os, id, currentJob, signal);
					if (recovered !== null) {
						streamCompleted = true;
						composedMessage = recovered;
					}
				}
				break;
			}
			case 'error':
				streamCompleted = true;
				throw new Error(
					typeof event.data.message === 'string' ? event.data.message : 'Authoring failed'
				);
		}
	}

	if (!streamCompleted && !signal.aborted) {
		const recovered = await pollRecoverableMessageJob(os, id, activeJob, signal);
		if (recovered !== null) return recovered;
		throw new Error('Connection closed before authoring finished. Please try again.');
	}

	return composedMessage;
}

/**
 * Spawn and DRIVE an authoring process. Callable from anywhere (STUDIO's INTENT
 * form, a future Compose-from-spotlight, etc.) — it does not depend on the
 * caller staying mounted. Returns the process id immediately; the run continues
 * in the background, streaming into the orgOS registry, and survives space
 * switches because it lives outside the component tree.
 *
 * The process's AbortController (held on the process record by spawnProcess) is
 * the single stop handle; `orgOS.stopProcess(id)` aborts it from anywhere.
 */
export function startAuthoringProcess(os: OrgOS, intent: AuthoringIntent): string {
	const proc = os.spawnProcess(intent);
	const id = proc.id;
	const signal = proc.abort?.signal ?? new AbortController().signal;

	// Fire-and-forget: the run is intentionally detached from the caller's
	// lifecycle. This is the OS process — it must outlive the STUDIO view.
	void (async () => {
		try {
			const decisionMakers = await runResolve(os, id, intent, signal);
			if (signal.aborted) return;
			await runMessage(os, id, intent, decisionMakers, signal);
			if (signal.aborted) return;
			os.setStatus(id, 'composed');
			os.setStage(id, null, '');
			os.emitSignal(`Composed “${proc.title}”`);
		} catch (err) {
			if (signal.aborted) return;
			if (err instanceof Error && err.name === 'AbortError') {
				// Operator aborted mid-stream; stopProcess already settled the record.
				return;
			}
			const message = err instanceof Error ? err.message : 'The authoring loop failed.';
			os.updateProcess(id, (p) => {
				p.errorMessage = message;
			});
			os.setStatus(id, 'error');
			os.emitSignal(`Authoring failed: ${message}`);
		}
	})();

	return id;
}
