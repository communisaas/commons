<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import type { TemplateFormData, Source } from '$lib/types/template';
	import type { PipelinePhase } from '$lib/core/agents/agents/message-writer';
	import { cleanHtmlFormatting } from '$lib/utils/message-processing';
	import { parseSSEStream } from '$lib/utils/sse-stream';
	import {
		computeMessageInputHash,
		decryptMessageJobResult,
		getOrCreateMessageRecoveryPublicKey,
		type ActiveMessageJob,
		type EncryptedMessageJobResult
	} from '$lib/core/agents/message-job-recovery';
	import AgentThinking from '$lib/components/ui/AgentThinking.svelte';
	import { Artifact, Datum, Ratio } from '$lib/design';
	import { formatCapabilityClusters } from '$lib/data/capability-clusters';
	import {
		buildMessageGenerationEvidence,
		getGateEvidence,
		messageGenerationSpineRows,
		type MessageGenerationEvidenceRow
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel,
		operatorCapabilityStateRatioSegments,
		type OperatorCapabilityStateCounts
	} from '$lib/data/capability-state-labels';
	import MessageResults from './MessageResults.svelte';
	import AuthGateOverlay from './AuthGateOverlay.svelte';
	import SourceEditor from './SourceEditor.svelte';
	import { FileText } from '@lucide/svelte';

	interface Props {
		formData: TemplateFormData;
		onnext: () => void;
		onback: () => void;
		/** Draft ID for OAuth resumption */
		draftId?: string;
		/** Save draft callback for OAuth flow */
		onSaveDraft?: () => void;
		/** Error message to display inline (from parent validation or API) */
		publishError?: string | null;
		/** Whether publish is in progress */
		isPublishing?: boolean;
	}

	let {
		formData = $bindable(),
		onnext,
		onback,
		draftId,
		onSaveDraft,
		publishError = null,
		isPublishing = false
	}: Props = $props();

	type Stage = 'generating' | 'results' | 'editing' | 'error' | 'auth-required' | 'rate-limited';
	type GenerationBoundary = {
		code: string;
		message: string;
		missing: string[];
		dependency: string | null;
		retryable: boolean;
	};
	let stage = $state<Stage>('generating');
	let errorMessage = $state<string | null>(null);
	let generationBoundary = $state<GenerationBoundary | null>(null);
	let rateLimitResetAt = $state<string | null>(null);
	let rateLimitMessage = $state<string | null>(null);
	let isGenerating = $state(false);
	let destroyed = false;

	// Streaming state
	let thoughts = $state<string[]>([]);
	let currentPhase = $state<PipelinePhase | 'recovering' | null>(null);
	let currentPhaseMessage = $state<string | null>(null);
	let liveSourceCount = $state(0);
	let liveEvaluatedSourceCount = $state(0);
	let liveSearchOnlySourceCount = $state(0);
	let liveSourceMode = $state<'discovery' | 'preverified' | null>(null);
	const SOURCE_EVALUATION_FALLBACK_PREFIX = 'Evaluation unavailable';
	const activeMessageJob = $derived(formData.content.activeMessageJob ?? null);
	const liveTraceHandle = $derived(
		activeMessageJob?.traceId ? activeMessageJob.traceId.slice(0, 8) : null
	);
	const messageCoreInput = $derived(
		formData.objective.description || formData.objective.rawInput || formData.objective.title
	);
	const messageIntentFieldCount = $derived(
		(formData.objective.title.trim() ? 1 : 0) + (messageCoreInput.trim() ? 1 : 0)
	);
	const selectedDecisionMakerCount = $derived(formData.audience.decisionMakers?.length ?? 0);
	const messageProofGate = getGateEvidence('CP-message-proof-binding', ['T4-2', 'T4-7'], {
		name: 'Authored artifact proof binding',
		downstream: 3,
		dependency: 'Drafted artifact proof attachment and writer proof plumbing'
	});
	const liveEvidenceSummary = $derived(
		buildMessageGenerationEvidence({
			intentFieldCount: messageIntentFieldCount,
			targetCount: selectedDecisionMakerCount,
			phase: currentPhase ?? 'preparing',
			paragraphCount: 0,
			sourceCount: liveSourceCount,
			evaluatedSourceCount: liveEvaluatedSourceCount,
			searchOnlySourceCount: liveSearchOnlySourceCount,
			sourceEvidenceObserved: liveSourceMode !== null,
			researchStepCount: thoughts.length,
			hasRecoveryJob: Boolean(activeMessageJob),
			recoveryJobStatus: activeMessageJob?.status ?? (isGenerating ? 'running' : null),
			traceHandle: liveTraceHandle,
			messageProofGate
		})
	);
	const liveEvidenceRows = $derived<MessageGenerationEvidenceRow[]>(liveEvidenceSummary.rows);
	const liveEvidenceStateCounts = $derived<OperatorCapabilityStateCounts>({
		live: liveEvidenceRows.filter((row) => row.state === 'live').length,
		partial: liveEvidenceRows.filter((row) => row.state === 'partial').length,
		'draft-only': liveEvidenceRows.filter((row) => row.state === 'draft-only').length,
		gated: liveEvidenceRows.filter((row) => row.state === 'gated').length
	});
	const liveEvidenceSegments = $derived(
		operatorCapabilityStateRatioSegments(liveEvidenceStateCounts)
	);
	const liveFocusRows = $derived(
		liveEvidenceRows.filter((row) =>
			[
				'intent-input',
				'target-basis',
				'stream-phase',
				'source-basis',
				'research-trace',
				'recovery-job',
				'proof-binding'
			].includes(row.key)
		)
	);
	const liveGenerationSpineRows = $derived(messageGenerationSpineRows(liveEvidenceRows));
	const generationBoundaryState = $derived(
		generationBoundary?.code === 'message_generation_rate_limited'
			? 'draft-only'
			: generationBoundary?.retryable === false
				? 'gated'
				: 'partial'
	);
	const generationBoundaryAction = $derived(
		operatorCapabilityActionLabel(
			generationBoundaryState,
			generationBoundary?.code === 'message_generation_rate_limited'
				? 'read quota boundary'
				: generationBoundary?.retryable === false
					? 'read runtime boundary'
					: 'retry stream',
			{
				appendReadyArrow:
					generationBoundary?.retryable !== false &&
					generationBoundary?.code !== 'message_generation_rate_limited'
			}
		)
	);
	const generationBoundaryTitle = $derived(
		generationBoundary?.code === 'message_generation_rate_limited'
			? 'Authoring quota boundary'
			: 'Authoring boundary'
	);
	const publicActionPublishAction = $derived(
		operatorCapabilityActionLabel('partial', 'publish public action template', {
			appendReadyArrow: true
		})
	);
	const publicActionRetryAction = $derived(
		operatorCapabilityActionLabel('partial', 'retry public action publish', {
			appendReadyArrow: true
		})
	);
	const publicActionPublishTitle =
		'Publishes the authored public action template; delivery routes still own send, dispatch, receipt, and proof confirmation.';
	const publicActionPublishLabel = $derived(
		isPublishing
			? 'Publishing public action template'
			: publishError
				? publicActionRetryAction
				: publicActionPublishAction
	);

	/**
	 * Check if error indicates auth is required
	 * Matches rate limiter 429 responses for guests
	 */
	function isAuthRequiredError(err: unknown): boolean {
		if (err instanceof Error) {
			const msg = err.message.toLowerCase();
			return (
				msg.includes('requires an account') ||
				msg.includes('sign in') ||
				msg.includes('authentication required') ||
				msg.includes('401')
			);
		}
		return false;
	}

	/**
	 * Build progress items for auth gate - shows sunk cost
	 */
	function buildAuthProgressItems() {
		const items = [];

		// Their subject line
		if (formData.objective.title) {
			items.push({
				label: 'Subject line',
				value: formData.objective.title,
				secondary: formData.objective.description
			});
		}

		// Their selected decision-makers (truncated list)
		const dmCount = formData.audience?.decisionMakers?.length || 0;
		if (dmCount > 0) {
			const firstDm = formData.audience.decisionMakers[0];
			const dmValue =
				dmCount === 1
					? firstDm.name
					: `${firstDm.name} + ${dmCount - 1} other${dmCount > 2 ? 's' : ''}`;
			items.push({
				label: 'Decision-makers',
				value: dmValue,
				secondary: firstDm.title
			});
		}

		return items;
	}

	function phaseLabel(phase: PipelinePhase | 'recovering' | null): string {
		if (phase === 'sources') return 'GROUND / source discovery';
		if (phase === 'message') return 'AUTHOR / artifact authoring';
		if (phase === 'complete') return 'AGGREGATE / artifact emitted';
		if (phase === 'recovering') return 'AGGREGATE / recovery poll';
		return 'INTENT / preparing run';
	}

	function rowStateLabel(row: MessageGenerationEvidenceRow): string {
		return operatorCapabilityStateLabel(row.state);
	}

	function rowActionLabel(row: MessageGenerationEvidenceRow): string {
		return operatorCapabilityActionLabel(row.state, row.action, { appendReadyArrow: true });
	}

	function boundaryFromResponse(
		body: Record<string, unknown>,
		status: number,
		fallbackMessage: string
	): GenerationBoundary {
		const code = typeof body.code === 'string' ? body.code : 'message_generation_request_failed';
		return {
			code,
			message: typeof body.error === 'string' ? body.error : fallbackMessage,
			missing: Array.isArray(body.missing)
				? body.missing.filter((item): item is string => typeof item === 'string')
				: [],
			dependency: typeof body.dependency === 'string' ? body.dependency : null,
			retryable: status >= 500 && code !== 'message_generation_runtime_not_configured'
		};
	}

	function boundaryFromThrownError(err: unknown): GenerationBoundary {
		const message =
			err instanceof Error ? err.message : 'Authoring closed before an artifact emitted.';
		const inputNotReady =
			message.includes('Missing subject line') || message.includes('No decision-makers selected');
		return {
			code: inputNotReady
				? 'message_generation_input_not_ready'
				: 'message_generation_stream_closed',
			message,
			missing: inputNotReady ? ['operator intent or selected decision-maker'] : [],
			dependency: inputNotReady ? 'subject line + core message + selected decision-maker' : null,
			retryable: !inputNotReady
		};
	}

	function isPipelinePhase(value: unknown): value is PipelinePhase {
		return value === 'sources' || value === 'message' || value === 'complete';
	}

	function isSearchOnlySource(source: Source): boolean {
		return (
			!source.incentive_position ||
			(source.credibility_rationale ?? '').startsWith(SOURCE_EVALUATION_FALLBACK_PREFIX)
		);
	}

	function sourceEvidenceCounts(sources: Source[]): {
		total: number;
		evaluated: number;
		searchOnly: number;
	} {
		const total = sources.length;
		const searchOnly = sources.filter(isSearchOnlySource).length;
		return {
			total,
			evaluated: total - searchOnly,
			searchOnly
		};
	}

	// Store original AI-generated content for "start fresh"
	let originalMessage = $state('');
	let originalSubject = $state('');
	let originalSources = $state<Source[]>([]);

	// Textarea ref for cursor-position insertion
	let editTextarea = $state<HTMLTextAreaElement>();

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

	/**
	 * Build raw input with fallback to description
	 */
	function buildRawInput(): string {
		return formData.objective.rawInput || formData.objective.description || '';
	}

	// US state abbreviations for geographic inference
	const US_STATES: Record<string, string> = {
		AL: 'Alabama',
		AK: 'Alaska',
		AZ: 'Arizona',
		AR: 'Arkansas',
		CA: 'California',
		CO: 'Colorado',
		CT: 'Connecticut',
		DE: 'Delaware',
		FL: 'Florida',
		GA: 'Georgia',
		HI: 'Hawaii',
		ID: 'Idaho',
		IL: 'Illinois',
		IN: 'Indiana',
		IA: 'Iowa',
		KS: 'Kansas',
		KY: 'Kentucky',
		LA: 'Louisiana',
		ME: 'Maine',
		MD: 'Maryland',
		MA: 'Massachusetts',
		MI: 'Michigan',
		MN: 'Minnesota',
		MS: 'Mississippi',
		MO: 'Missouri',
		MT: 'Montana',
		NE: 'Nebraska',
		NV: 'Nevada',
		NH: 'New Hampshire',
		NJ: 'New Jersey',
		NM: 'New Mexico',
		NY: 'New York',
		NC: 'North Carolina',
		ND: 'North Dakota',
		OH: 'Ohio',
		OK: 'Oklahoma',
		OR: 'Oregon',
		PA: 'Pennsylvania',
		RI: 'Rhode Island',
		SC: 'South Carolina',
		SD: 'South Dakota',
		TN: 'Tennessee',
		TX: 'Texas',
		UT: 'Utah',
		VT: 'Vermont',
		VA: 'Virginia',
		WA: 'Washington',
		WV: 'West Virginia',
		WI: 'Wisconsin',
		WY: 'Wyoming',
		DC: 'District of Columbia'
	};

	/**
	 * Infer geographic scope from decision makers' organizations.
	 * Heuristic-based — doesn't need to be perfect; Exa queries still work with approximate scope.
	 */
	function inferGeographicScope(dms: { name: string; title: string; organization: string }[]): {
		type: 'international' | 'nationwide' | 'subnational';
		country?: string;
		subdivision?: string;
		locality?: string;
	} {
		if (!dms || dms.length === 0) return { type: 'nationwide', country: 'US' };

		const orgs = dms.map((dm) => dm.organization || '');

		// Try to extract state abbreviations from org strings (e.g. "CA State Legislature")
		function extractState(org: string): string | null {
			// Match 2-letter state code at word boundary
			const match = org.match(/\b([A-Z]{2})\b/);
			if (match && US_STATES[match[1]]) return match[1];
			// Match full state names
			for (const [abbr, name] of Object.entries(US_STATES)) {
				if (org.toLowerCase().includes(name.toLowerCase())) return abbr;
			}
			return null;
		}

		// Try to extract city/locality from org strings (e.g. "San Francisco Board of Supervisors")
		// Common patterns: "City of X", "X City Council", "X Board of Supervisors", "X County"
		function extractLocality(org: string): string | null {
			const patterns = [
				/City of ([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/,
				/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+(?:City Council|Board of Supervisors|Town Council|Village Board|Borough Council)/,
				/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+County/
			];
			for (const pat of patterns) {
				const m = org.match(pat);
				if (m) return m[1];
			}
			return null;
		}

		const states = orgs.map(extractState);
		const localities = orgs.map(extractLocality);

		// Check if all share a locality
		const nonNullLocalities = localities.filter((l): l is string => l !== null);
		if (nonNullLocalities.length === dms.length) {
			const unique = [...new Set(nonNullLocalities)];
			if (unique.length === 1) {
				const state = states.find((s): s is string => s !== null);
				return {
					type: 'subnational',
					country: 'US',
					subdivision: state || undefined,
					locality: unique[0]
				};
			}
		}

		// Check if all share a state
		const nonNullStates = states.filter((s): s is string => s !== null);
		if (nonNullStates.length === dms.length) {
			const unique = [...new Set(nonNullStates)];
			if (unique.length === 1) {
				return { type: 'subnational', country: 'US', subdivision: unique[0] };
			}
		}

		// Check for US-level indicators (Congress, Senate, federal agencies)
		const federalPatterns =
			/\b(U\.?S\.?|United States|Congress|Senate|House of Representatives|Federal)\b/i;
		const allUS = orgs.every((org) => federalPatterns.test(org) || nonNullStates.length > 0);
		if (allUS) return { type: 'nationwide', country: 'US' };

		// Default: if we can't determine, assume nationwide US
		return { type: 'nationwide', country: 'US' };
	}

	type MessageGenerationPayload = {
		subject_line: string;
		core_message: string;
		topics: string[];
		decision_makers: Array<{ name: string; title: string; organization: string }>;
		voice_sample: string;
		raw_input: string;
		geographic_scope: ReturnType<typeof inferGeographicScope>;
	};

	type MessageGenerationResult = {
		message?: string;
		sources?: unknown[];
		research_log?: string[];
		geographic_scope?: unknown;
	};

	type RecoverableJobResponse = {
		job?: {
			jobId: string;
			inputHash: string;
			status: ActiveMessageJob['status'];
			encryptedResult?: EncryptedMessageJobResult | null;
			errorMessage?: string | null;
			traceId?: string | null;
		};
		error?: string;
	};

	function updateActiveMessageJobFromServer(job: {
		jobId: string;
		inputHash: string;
		status: ActiveMessageJob['status'];
		traceId?: string | null;
	}) {
		const activeJob = formData.content.activeMessageJob;
		if (!activeJob || activeJob.jobId !== job.jobId || activeJob.inputHash !== job.inputHash)
			return;

		activeJob.status = job.status;
		if (job.traceId) activeJob.traceId = job.traceId;
		onSaveDraft?.();
	}

	function buildGenerationPayload(): MessageGenerationPayload {
		const subjectLine = formData.objective.title;
		const coreMessage =
			formData.objective.description || formData.objective.rawInput || formData.objective.title;

		if (!subjectLine) {
			throw new Error('Missing subject line');
		}

		if (!formData.audience.decisionMakers || formData.audience.decisionMakers.length === 0) {
			throw new Error('No decision-makers selected');
		}

		const decisionMakers = formData.audience.decisionMakers.map((dm) => ({
			name: dm.name,
			title: dm.title,
			organization: dm.organization
		}));

		return {
			subject_line: subjectLine,
			core_message: coreMessage,
			topics: buildTopics(),
			decision_makers: decisionMakers,
			voice_sample: buildVoiceSample(),
			raw_input: buildRawInput(),
			geographic_scope: inferGeographicScope(decisionMakers)
		};
	}

	function applyMessageResult(result: MessageGenerationResult) {
		const cleanedMessage = cleanHtmlFormatting(result.message || '');
		if (Array.isArray(result.sources)) {
			const counts = sourceEvidenceCounts(result.sources as Source[]);
			liveSourceCount = counts.total;
			liveEvaluatedSourceCount = counts.evaluated;
			liveSearchOnlySourceCount = counts.searchOnly;
		}

		originalMessage = cleanedMessage;
		originalSubject = formData.objective.title;
		originalSources = [...((result.sources as Source[]) || [])];

		formData.content.preview = cleanedMessage;
		formData.content.sources = (result.sources as typeof formData.content.sources) || [];
		formData.content.researchLog = result.research_log || [];
		formData.content.geographicScope =
			(result.geographic_scope as typeof formData.content.geographicScope) || null;
		formData.content.aiGenerated = true;
		formData.content.edited = false;
		formData.content.generatedForSubject = formData.objective.title;
		if (formData.content.activeMessageJob) {
			formData.content.activeMessageJob.status = 'completed';
		}

		onSaveDraft?.();
		stage = 'results';
	}

	async function fetchRecoverableJob(jobId: string): Promise<RecoverableJobResponse['job'] | null> {
		const response = await fetch(`/api/agents/message-jobs/${encodeURIComponent(jobId)}`, {
			credentials: 'include'
		});
		if (response.status === 404) return null;
		if (!response.ok) {
			const body = (await response.json().catch(() => ({}))) as RecoverableJobResponse;
			throw new Error(body.error || 'Could not recover authoring job');
		}
		const body = (await response.json()) as RecoverableJobResponse;
		return body.job ?? null;
	}

	async function applyRecoveredJob(
		job: NonNullable<RecoverableJobResponse['job']>
	): Promise<boolean> {
		updateActiveMessageJobFromServer(job);

		if (job.status === 'completed' && job.encryptedResult) {
			const result = await decryptMessageJobResult<MessageGenerationResult>(
				job.jobId,
				job.inputHash,
				job.encryptedResult
			);
			applyMessageResult(result);
			return true;
		}

		if (job.status === 'failed') {
			throw new Error(job.errorMessage || 'Authoring failed');
		}

		if (job.status === 'expired') {
			throw new Error('Authoring expired. Please try again.');
		}

		return false;
	}

	function sleep(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	async function pollActiveMessageJob(activeJob: ActiveMessageJob, maxMs = 8 * 60 * 1000) {
		const started = Date.now();
		while (!destroyed && Date.now() - started < maxMs) {
			const job = await fetchRecoverableJob(activeJob.jobId);
			if (!job) return false;
			if (await applyRecoveredJob(job)) return true;
			await sleep(3000);
		}
		return false;
	}

	async function resumeActiveMessageJob(activeJob: ActiveMessageJob) {
		if (isGenerating) return;
		isGenerating = true;
		stage = 'generating';
		errorMessage = null;
		thoughts = ['Reconnecting to the authoring job...'];
		liveSourceCount = 0;
		liveEvaluatedSourceCount = 0;
		liveSearchOnlySourceCount = 0;
		liveSourceMode = null;
		currentPhase = 'recovering';
		currentPhaseMessage = 'Polling same-device recovery for the encrypted message result.';

		try {
			const recovered = await pollActiveMessageJob(activeJob);
			if (!recovered && !destroyed) {
				throw new Error('Authoring is still running. Please try again in a moment.');
			}
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Could not recover authoring.';
			stage = 'error';
		} finally {
			isGenerating = false;
		}
	}

	async function generateMessage() {
		// Prevent concurrent generation
		if (isGenerating) return;
		isGenerating = true;

		try {
			stage = 'generating';
			errorMessage = null;
			generationBoundary = null;
			thoughts = [];
			liveSourceCount = 0;
			liveEvaluatedSourceCount = 0;
			liveSearchOnlySourceCount = 0;
			liveSourceMode = null;
			currentPhase = null;
			currentPhaseMessage = 'Preparing recoverable authoring boundary.';
			console.log('[MessageGenerationResolver] Starting streaming generation...');

			const payload = buildGenerationPayload();
			const inputHash = await computeMessageInputHash(payload);
			const jobId = crypto.randomUUID();
			const recoveryPublicKeyJwk = await getOrCreateMessageRecoveryPublicKey(jobId);

			formData.content.activeMessageJob = {
				jobId,
				inputHash,
				status: 'pending',
				startedAt: Date.now(),
				recoveryKeyRef: jobId
			};
			onSaveDraft?.();

			// Use streaming endpoint
			const response = await fetch('/api/agents/stream-message', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include', // Ensure session cookie is sent after OAuth return
				body: JSON.stringify({
					...payload,
					job_id: jobId,
					input_hash: inputHash,
					recovery_public_key_jwk: recoveryPublicKeyJwk
				})
			});

			// Check for auth / rate-limit errors
			if (response.status === 429 || response.status === 401) {
				const errorData = await response.json().catch(() => ({}));
				formData.content.activeMessageJob = null;
				onSaveDraft?.();

				// Guest with zero quota or 401 → auth gate
				if (response.status === 401 || errorData.tier === 'guest') {
					throw { _kind: 'auth-required' };
				}

				// Authenticated/verified user who exhausted quota → rate-limited
				throw { _kind: 'rate-limited', resetAt: errorData.resetAt, message: errorData.error };
			}

			if (!response.ok) {
				const errorData = (await response.json().catch(() => ({}))) as Record<string, unknown>;
				formData.content.activeMessageJob = null;
				onSaveDraft?.();
				generationBoundary = boundaryFromResponse(
					errorData,
					response.status,
					'Authoring did not emit an artifact'
				);
				currentPhase = null;
				currentPhaseMessage = generationBoundary.message;
				throw new Error(
					typeof errorData.error === 'string'
						? errorData.error
						: 'Authoring did not emit an artifact'
				);
			}

			let streamCompleted = false;

			// Process SSE stream
			for await (const event of parseSSEStream<Record<string, unknown>>(response)) {
				switch (event.type) {
					case 'job':
						if (
							typeof event.data.jobId === 'string' &&
							typeof event.data.inputHash === 'string' &&
							typeof event.data.status === 'string'
						) {
							updateActiveMessageJobFromServer({
								jobId: event.data.jobId,
								inputHash: event.data.inputHash,
								status: event.data.status as ActiveMessageJob['status'],
								traceId: typeof event.data.traceId === 'string' ? event.data.traceId : null
							});
						} else if (formData.content.activeMessageJob) {
							formData.content.activeMessageJob.status = 'running';
						}
						break;

					case 'thought':
						if (typeof event.data.content === 'string') {
							thoughts = [...thoughts, event.data.content];
						}
						if (isPipelinePhase(event.data.phase)) {
							currentPhase = event.data.phase;
						}
						break;

					case 'phase':
						if (isPipelinePhase(event.data.phase)) {
							currentPhase = event.data.phase;
						}
						currentPhaseMessage =
							typeof event.data.message === 'string' ? event.data.message : currentPhaseMessage;
						break;

					case 'source-evidence': {
						const sourceCount =
							typeof event.data.sourceCount === 'number' && Number.isFinite(event.data.sourceCount)
								? Math.max(0, Math.floor(event.data.sourceCount))
								: null;
						let evaluatedSourceCount =
							typeof event.data.evaluatedSourceCount === 'number' &&
							Number.isFinite(event.data.evaluatedSourceCount)
								? Math.max(0, Math.floor(event.data.evaluatedSourceCount))
								: null;
						let searchOnlySourceCount =
							typeof event.data.searchOnlySourceCount === 'number' &&
							Number.isFinite(event.data.searchOnlySourceCount)
								? Math.max(0, Math.floor(event.data.searchOnlySourceCount))
								: null;
						if (sourceCount !== null) {
							liveSourceCount = sourceCount;
							if (evaluatedSourceCount === null || searchOnlySourceCount === null) {
								if (event.data.evaluationFallback === true) {
									evaluatedSourceCount = 0;
									searchOnlySourceCount = sourceCount;
								} else {
									evaluatedSourceCount = sourceCount;
									searchOnlySourceCount = 0;
								}
							}
							liveEvaluatedSourceCount = Math.min(evaluatedSourceCount, sourceCount);
							liveSearchOnlySourceCount = Math.min(
								searchOnlySourceCount,
								Math.max(0, sourceCount - liveEvaluatedSourceCount)
							);
						}
						liveSourceMode =
							event.data.mode === 'discovery' || event.data.mode === 'preverified'
								? event.data.mode
								: liveSourceMode;
						if (sourceCount !== null) {
							currentPhaseMessage =
								sourceCount === 0
									? 'No evaluated source ground attached; authoring can continue without citation support.'
									: liveSearchOnlySourceCount > 0
										? `${liveEvaluatedSourceCount} evaluated · ${liveSearchOnlySourceCount} search-only source${liveSearchOnlySourceCount === 1 ? '' : 's'} attached.`
										: liveSourceMode === 'preverified'
											? `${liveEvaluatedSourceCount} cached evaluated source${liveEvaluatedSourceCount === 1 ? '' : 's'} ready for authoring.`
											: `${liveEvaluatedSourceCount} evaluated source${liveEvaluatedSourceCount === 1 ? '' : 's'} ready for authoring.`;
						}
						break;
					}

					case 'complete': {
						streamCompleted = true;
						currentPhase = 'complete';
						currentPhaseMessage = 'Message artifact emitted with evidence boundaries.';
						const result = event.data as MessageGenerationResult;
						applyMessageResult(result);

						console.log('[MessageGenerationResolver] Message generated:', {
							message_length: formData.content.preview.length,
							sources_count: formData.content.sources?.length || 0
						});

						break;
					}

					case 'job-complete': {
						streamCompleted = true;
						const job = (event.data as { job?: RecoverableJobResponse['job'] }).job;
						if (job) await applyRecoveredJob(job);
						break;
					}

					case 'job-running': {
						const activeJob = formData.content.activeMessageJob;
						if (activeJob) {
							streamCompleted = await pollActiveMessageJob(activeJob);
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

			if (!streamCompleted) {
				const activeJob = formData.content.activeMessageJob;
				if (activeJob && (await pollActiveMessageJob(activeJob, 30_000))) return;
				throw new Error('Connection closed before authoring finished. Please try again.');
			}
		} catch (err: any) {
			console.error('[MessageGenerationResolver] Error:', err);

			if (err?._kind === 'auth-required' || isAuthRequiredError(err)) {
				console.log('[MessageGenerationResolver] Auth required, showing overlay');
				stage = 'auth-required';
			} else if (err?._kind === 'rate-limited') {
				rateLimitResetAt = err.resetAt ?? null;
				rateLimitMessage = err.message ?? null;
				generationBoundary = {
					code: 'message_generation_rate_limited',
					message: rateLimitMessage || "You've used your available authoring runs for now.",
					missing: ['available authoring quota'],
					dependency: rateLimitResetAt
						? `authoring quota reset at ${new Date(rateLimitResetAt).toLocaleString()}`
						: 'authoring quota reset or upgraded allowance',
					retryable: false
				};
				stage = 'rate-limited';
			} else {
				errorMessage = err instanceof Error ? err.message : 'Authoring failed. Please try again.';
				generationBoundary ??= boundaryFromThrownError(err);
				stage = 'error';
			}
		} finally {
			isGenerating = false;
		}
	}

	// Auto-run on mount
	onMount(() => {
		void (async () => {
			// Check if the objective changed since content was generated
			const generatedFor = formData.content.generatedForSubject;
			const currentSubject = formData.objective.title;
			const isStale = generatedFor && generatedFor !== currentSubject;

			if (isStale) {
				console.log('[MessageGenerationResolver] Subject changed, clearing stale content', {
					generatedFor,
					currentSubject
				});
				formData.content.preview = '';
				formData.content.aiGenerated = false;
				formData.content.generatedForSubject = undefined;
				formData.content.activeMessageJob = null;
				formData.content.draftOrigin = null;
				await generateMessage();
			} else if (!formData.content.preview || !formData.content.aiGenerated) {
				const activeJob = formData.content.activeMessageJob;
				if (activeJob) {
					try {
						const currentHash = await computeMessageInputHash(buildGenerationPayload());
						if (currentHash === activeJob.inputHash) {
							await resumeActiveMessageJob(activeJob);
							return;
						}
					} catch {
						// Fall through to a fresh generation; generateMessage will surface validation errors.
					}
					formData.content.activeMessageJob = null;
				}
				await generateMessage();
			} else {
				// Already have a message for the current subject, go straight to results
				originalMessage = formData.content.preview;
				originalSubject = formData.objective.title;
				originalSources = [...(formData.content.sources || [])];
				stage = 'results';
			}
		})();
	});

	onDestroy(() => {
		destroyed = true;
	});

	function handleEdit() {
		stage = 'editing';
		// Mark as edited
		formData.content.edited = true;
	}

	function handleStartFresh() {
		// Reset to original authored artifact + sources
		formData.content.preview = originalMessage;
		formData.objective.title = originalSubject;
		formData.content.sources = [...originalSources];
		formData.content.edited = false;
		formData.content.activeMessageJob = null;
		stage = 'results';
	}

	function handleSaveEdit() {
		// User finished editing, back to results
		stage = 'results';
	}

	function handleInsertAtCursor(text: string) {
		if (!editTextarea) return;
		const start = editTextarea.selectionStart ?? formData.content.preview.length;
		const end = editTextarea.selectionEnd ?? start;
		const before = formData.content.preview.slice(0, start);
		const after = formData.content.preview.slice(end);
		formData.content.preview = before + text + after;
		tick().then(() => {
			if (editTextarea) {
				editTextarea.selectionStart = editTextarea.selectionEnd = start + text.length;
				editTextarea.focus();
			}
		});
	}

	function handleNext() {
		// Ensure content is set
		if (!formData.content.preview.trim()) {
			errorMessage = 'Message content is required';
			stage = 'error';
			return;
		}

		onnext();
	}
</script>

<div class="mx-auto max-w-3xl">
	{#if stage === 'generating'}
		<div class="generation-live">
			<Artifact padding="compact" class="generation-contract-artifact">
				<section class="generation-contract" aria-label="Live authored artifact contract">
					<header class="generation-contract-head">
						<div class="generation-contract-main">
							<span class="generation-kicker">Live authoring contract</span>
							<span class="generation-phase">{phaseLabel(currentPhase)}</span>
							<span class="generation-message">
								{currentPhaseMessage ?? liveEvidenceSummary.effect}
							</span>
						</div>
						<div class="generation-state">
							<span>{operatorCapabilityStateLabel(liveEvidenceSummary.state)}</span>
							<span>
								<Datum
									value={liveEvidenceSummary.liveCount}
									cite="buildMessageGenerationEvidence"
								/>
								/ <Datum value={liveEvidenceRows.length} cite="buildMessageGenerationEvidence" />
							</span>
						</div>
					</header>
					<Ratio segments={liveEvidenceSegments} height={6} />
					<div class="generation-spine" aria-label="Authored artifact spine">
						{#each liveGenerationSpineRows as row (row.key)}
							<div
								class="generation-spine-cell"
								data-state={row.state}
								title="{row.label}: {row.ground} Gate: {row.gate}"
								aria-label="{row.label}: {rowStateLabel(row)}. {row.metric.value ?? 'unread'} {row
									.metric.label}. {row.ground} Full gate: {row.gate}. Action: {rowActionLabel(row)}"
							>
								<span class="generation-spine-top">
									<span class="generation-spine-label">{row.label}</span>
									<span class="generation-spine-state">{rowStateLabel(row)}</span>
								</span>
								<span class="generation-spine-signal">
									<Datum value={row.metric.value} cite={row.metric.cite} />
									<span>{row.metric.label}</span>
								</span>
								<span class="generation-spine-ground">{row.ground}</span>
								<span class="generation-spine-action">{rowActionLabel(row)}</span>
							</div>
						{/each}
					</div>
					<div class="generation-rows">
						{#each liveFocusRows as row (row.key)}
							<div class="generation-row" data-state={row.state}>
								<div class="generation-row-main">
									<span class="generation-row-label">{row.label}</span>
									<span class="generation-row-meta">
										{row.phase} / {formatCapabilityClusters(row.clusters)}
									</span>
									<span class="generation-row-ground">{row.ground}</span>
									<span class="generation-row-effect">{row.effect}</span>
								</div>
								<div class="generation-row-metric">
									<span class="generation-row-state">{rowStateLabel(row)}</span>
									<span class="generation-row-action">{rowActionLabel(row)}</span>
									<Datum value={row.metric.value} cite={row.metric.cite} />
								</div>
							</div>
						{/each}
					</div>
				</section>
			</Artifact>

			<!-- Thought-centered loading: the agent's reasoning IS the experience -->
			<AgentThinking
				{thoughts}
				isActive={stage === 'generating'}
				context="Grounding and authoring"
			/>
		</div>
	{:else if stage === 'results'}
		<!-- Results display with citations, sources, and research log -->
		<MessageResults
			bind:geographicScope={formData.content.geographicScope}
			message={formData.content.preview}
			subject={formData.objective.title}
			intentFieldCount={messageIntentFieldCount}
			targetCount={selectedDecisionMakerCount}
			sources={formData.content.sources || []}
			researchLog={formData.content.researchLog || []}
			activeMessageJob={formData.content.activeMessageJob}
			draftOrigin={formData.content.draftOrigin ?? null}
			onEdit={handleEdit}
		/>

		<!-- Navigation with inline error display -->
		<div class="mt-8 border-t border-slate-200 pt-6">
			{#if publishError}
				<!-- Inline error: appears at locus of action, not displaced to header/toast -->
				<div
					class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
					role="alert"
				>
					<div class="flex items-start gap-3">
						<svg
							class="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500"
							fill="currentColor"
							viewBox="0 0 20 20"
						>
							<path
								fill-rule="evenodd"
								d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
								clip-rule="evenodd"
							/>
						</svg>
						<span>{publishError}</span>
					</div>
				</div>
			{/if}

			<div class="flex items-center justify-between">
				<button
					type="button"
					onclick={onback}
					disabled={isPublishing}
					class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
				>
					← Back
				</button>

				<button
					type="button"
					onclick={handleNext}
					disabled={isPublishing}
					title={publicActionPublishTitle}
					aria-label={publicActionPublishLabel}
					class="inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all disabled:opacity-70
						{publishError
						? 'bg-red-600 hover:bg-red-700'
						: 'bg-participation-primary-600 hover:bg-participation-primary-700 hover:shadow'}"
				>
					{#if isPublishing}
						<div
							class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
						></div>
						Publishing public action...
					{:else if publishError}
						{publicActionRetryAction}
					{:else}
						{publicActionPublishAction}
					{/if}
				</button>
			</div>

			<div
				class="mt-3 flex flex-wrap items-center justify-end gap-2 text-xs text-slate-500"
				aria-label="Public action publish boundary"
				title={publicActionPublishTitle}
			>
				<span class="font-mono font-semibold tracking-wide text-slate-600 uppercase">
					Public action template
				</span>
				<span>send / dispatch / receipt proof stay route-owned</span>
			</div>
		</div>
	{:else if stage === 'editing'}
		<!-- Message editor -->
		<div class="space-y-4">
			<div>
				<h3 class="text-lg font-semibold text-slate-900">Edit your message</h3>
				<p class="mt-1 text-sm text-slate-600">
					{#if formData.content.sources && formData.content.sources.length > 0}
						Sources and citations stay linked as you edit
					{:else}
						Edit the message to match your voice. Add sources with [n] references.
					{/if}
				</p>
			</div>

			<!-- Subject line -->
			<div>
				<label for="edit-subject" class="block text-sm font-medium text-slate-700"> Subject </label>
				<input
					id="edit-subject"
					type="text"
					bind:value={formData.objective.title}
					class="focus:border-participation-primary-500 focus:ring-participation-primary-500 mt-1 w-full rounded-lg border border-slate-300 px-4 py-2 focus:ring-2"
				/>
			</div>

			<!-- Message body -->
			<div>
				<label for="edit-message" class="block text-sm font-medium text-slate-700"> Message </label>
				<textarea
					id="edit-message"
					bind:value={formData.content.preview}
					bind:this={editTextarea}
					rows={16}
					class="focus:border-participation-primary-500 focus:ring-participation-primary-500 mt-1 w-full rounded-lg border border-slate-300 px-4 py-2 font-mono text-sm focus:ring-2"
				></textarea>
				<p class="mt-1 text-xs text-slate-500">Type [1], [2], etc. to reference sources</p>
			</div>

			<!-- Source management -->
			<SourceEditor
				sources={formData.content.sources || []}
				message={formData.content.preview}
				onSourcesChange={(s) => {
					formData.content.sources = s;
				}}
				onMessageChange={(m) => {
					formData.content.preview = m;
				}}
				onInsertAtCursor={handleInsertAtCursor}
			/>

			<!-- Actions -->
			<div class="flex items-center justify-end gap-3">
				<button
					type="button"
					onclick={handleStartFresh}
					class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
				>
					Reset to original
				</button>
				<button
					type="button"
					onclick={handleSaveEdit}
					class="bg-participation-primary-600 hover:bg-participation-primary-700 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
				>
					Save changes
				</button>
			</div>
		</div>
	{:else if stage === 'error'}
		<div class="generation-live" data-state="error">
			<Artifact padding="compact" class="generation-boundary-artifact">
				<section
					class="generation-contract generation-boundary"
					data-state={generationBoundaryState}
					aria-label={generationBoundaryTitle}
				>
					<header class="generation-contract-head">
						<div class="generation-contract-main">
							<span class="generation-kicker">{generationBoundaryTitle}</span>
							<span class="generation-phase">{phaseLabel(currentPhase)}</span>
							<span class="generation-message">
								{generationBoundary?.message ?? errorMessage}
							</span>
						</div>
						<div class="generation-state">
							<span>{operatorCapabilityStateLabel(generationBoundaryState)}</span>
							<span>{generationBoundaryAction}</span>
						</div>
					</header>
					<Ratio segments={liveEvidenceSegments} height={6} />
					{#if generationBoundary}
						<div class="generation-boundary-meta" data-retryable={generationBoundary.retryable}>
							<span>{generationBoundary.code}</span>
							{#if generationBoundary.dependency}
								<span>{generationBoundary.dependency}</span>
							{/if}
							{#if generationBoundary.missing.length > 0}
								<span>missing: {generationBoundary.missing.join(', ')}</span>
							{/if}
						</div>
					{/if}
					<div class="generation-spine" aria-label="Authored artifact spine">
						{#each liveGenerationSpineRows as row (row.key)}
							<div
								class="generation-spine-cell"
								data-state={row.state}
								title="{row.label}: {row.ground} Gate: {row.gate}"
								aria-label="{row.label}: {rowStateLabel(row)}. {row.metric.value ?? 'unread'} {row
									.metric.label}. {row.ground} Full gate: {row.gate}. Action: {rowActionLabel(row)}"
							>
								<span class="generation-spine-top">
									<span class="generation-spine-label">{row.label}</span>
									<span class="generation-spine-state">{rowStateLabel(row)}</span>
								</span>
								<span class="generation-spine-signal">
									<Datum value={row.metric.value} cite={row.metric.cite} />
									<span>{row.metric.label}</span>
								</span>
								<span class="generation-spine-ground">{row.ground}</span>
								<span class="generation-spine-action">{rowActionLabel(row)}</span>
							</div>
						{/each}
					</div>
					<div class="generation-rows">
						{#each liveFocusRows as row (row.key)}
							<div class="generation-row" data-state={row.state}>
								<div class="generation-row-main">
									<span class="generation-row-label">{row.label}</span>
									<span class="generation-row-meta">
										{row.phase} / {formatCapabilityClusters(row.clusters)}
									</span>
									<span class="generation-row-ground">{row.ground}</span>
									<span class="generation-row-effect">{row.effect}</span>
								</div>
								<div class="generation-row-metric">
									<span class="generation-row-state">{rowStateLabel(row)}</span>
									<span class="generation-row-action">{rowActionLabel(row)}</span>
									<Datum value={row.metric.value} cite={row.metric.cite} />
								</div>
							</div>
						{/each}
					</div>
				</section>
			</Artifact>

			<div class="flex items-center justify-center gap-4">
				{#if generationBoundary?.retryable !== false}
					<button
						type="button"
						onclick={generateMessage}
						class="bg-participation-primary-600 hover:bg-participation-primary-700 inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-medium text-white transition-colors"
					>
						Retry stream
					</button>
				{/if}

				<button
					type="button"
					onclick={onback}
					class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
				>
					Review input
				</button>
			</div>
		</div>
	{:else if stage === 'rate-limited'}
		<div class="generation-live" data-state="rate-limited">
			<Artifact padding="compact" class="generation-boundary-artifact">
				<section
					class="generation-contract generation-boundary"
					data-state={generationBoundaryState}
					aria-label={generationBoundaryTitle}
				>
					<header class="generation-contract-head">
						<div class="generation-contract-main">
							<span class="generation-kicker">{generationBoundaryTitle}</span>
							<span class="generation-phase">{phaseLabel(currentPhase)}</span>
							<span class="generation-message">
								{generationBoundary?.message ??
									rateLimitMessage ??
									"You've used your available authoring runs for now."}
							</span>
						</div>
						<div class="generation-state">
							<span>{operatorCapabilityStateLabel(generationBoundaryState)}</span>
							<span>{generationBoundaryAction}</span>
						</div>
					</header>
					<Ratio segments={liveEvidenceSegments} height={6} />
					{#if generationBoundary}
						<div class="generation-boundary-meta" data-retryable={generationBoundary.retryable}>
							<span>{generationBoundary.code}</span>
							{#if generationBoundary.dependency}
								<span>{generationBoundary.dependency}</span>
							{/if}
							{#if generationBoundary.missing.length > 0}
								<span>missing: {generationBoundary.missing.join(', ')}</span>
							{/if}
						</div>
					{/if}
					<div class="generation-spine" aria-label="Authored artifact spine">
						{#each liveGenerationSpineRows as row (row.key)}
							<div
								class="generation-spine-cell"
								data-state={row.state}
								title="{row.label}: {row.ground} Gate: {row.gate}"
								aria-label="{row.label}: {rowStateLabel(row)}. {row.metric.value ?? 'unread'} {row
									.metric.label}. {row.ground} Full gate: {row.gate}. Action: {rowActionLabel(row)}"
							>
								<span class="generation-spine-top">
									<span class="generation-spine-label">{row.label}</span>
									<span class="generation-spine-state">{rowStateLabel(row)}</span>
								</span>
								<span class="generation-spine-signal">
									<Datum value={row.metric.value} cite={row.metric.cite} />
									<span>{row.metric.label}</span>
								</span>
								<span class="generation-spine-ground">{row.ground}</span>
								<span class="generation-spine-action">{rowActionLabel(row)}</span>
							</div>
						{/each}
					</div>
					<div class="generation-rows">
						{#each liveFocusRows as row (row.key)}
							<div class="generation-row" data-state={row.state}>
								<div class="generation-row-main">
									<span class="generation-row-label">{row.label}</span>
									<span class="generation-row-meta">
										{row.phase} / {formatCapabilityClusters(row.clusters)}
									</span>
									<span class="generation-row-ground">{row.ground}</span>
									<span class="generation-row-effect">{row.effect}</span>
								</div>
								<div class="generation-row-metric">
									<span class="generation-row-state">{rowStateLabel(row)}</span>
									<span class="generation-row-action">{rowActionLabel(row)}</span>
									<Datum value={row.metric.value} cite={row.metric.cite} />
								</div>
							</div>
						{/each}
					</div>
				</section>
			</Artifact>

			<div class="flex items-center justify-center gap-4">
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
			<AuthGateOverlay
				title="Sign in to continue authoring"
				description="Authentication preserves quota, recovery, and draft continuity for this run."
				icon={FileText}
				hints={[]}
				progress={buildAuthProgressItems()}
				{onback}
				{draftId}
				{onSaveDraft}
			/>
		</div>
	{/if}
</div>

<style>
	.generation-live {
		display: grid;
		gap: 1rem;
		padding-block: 1rem;
	}

	.generation-live :global(.generation-contract-artifact) {
		padding: 0;
		overflow: hidden;
	}

	.generation-live :global(.generation-boundary-artifact) {
		padding: 0;
		overflow: hidden;
	}

	.generation-contract {
		display: grid;
		gap: 0.75rem;
		padding: 1rem 1.125rem;
		background: var(--surface-raised, oklch(0.985 0.004 60));
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
	}

	.generation-contract-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.generation-contract-main {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
	}

	.generation-kicker,
	.generation-spine-label,
	.generation-spine-state,
	.generation-spine-action,
	.generation-row-meta,
	.generation-row-state,
	.generation-state {
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
		text-transform: uppercase;
		letter-spacing: 0;
	}

	.generation-kicker {
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.66rem;
		font-weight: 800;
	}

	.generation-phase {
		color: var(--text-primary, oklch(0.22 0.015 60));
		font-size: 0.95rem;
		font-weight: 800;
		line-height: 1.2;
	}

	.generation-message {
		color: var(--text-secondary, oklch(0.38 0.012 60));
		font-size: 0.78rem;
		font-weight: 500;
		line-height: 1.35;
	}

	.generation-state {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.15rem;
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.7rem;
		font-weight: 800;
		white-space: nowrap;
	}

	.generation-spine {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.45rem;
	}

	.generation-spine-cell {
		display: flex;
		min-width: 0;
		min-height: 6.8rem;
		flex-direction: column;
		gap: 0.32rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		padding: 0.56rem 0.62rem;
	}

	.generation-spine-cell[data-state='live'] {
		border-left-color: var(--coord-verified, #10b981);
	}

	.generation-spine-cell[data-state='partial'] {
		border-left-color: var(--coord-route-solid, #3bc4b8);
	}

	.generation-spine-cell[data-state='draft-only'] {
		border-left-color: oklch(0.75 0.13 82);
		background: oklch(0.984 0.005 65);
	}

	.generation-spine-cell[data-state='gated'] {
		border-left-color: oklch(0.55 0.02 60);
		background: oklch(0.982 0.004 60);
		opacity: 0.88;
	}

	.generation-spine-top,
	.generation-spine-signal {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.4rem;
		min-width: 0;
	}

	.generation-spine-label,
	.generation-spine-state {
		font-size: 0.55rem;
		font-weight: 850;
		line-height: 1.2;
		color: var(--text-tertiary, oklch(0.48 0.012 60));
	}

	.generation-spine-label {
		color: var(--text-primary, oklch(0.22 0.015 60));
	}

	.generation-spine-state {
		white-space: nowrap;
	}

	.generation-spine-signal {
		justify-content: flex-start;
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.64rem;
		font-weight: 800;
		color: var(--text-primary, oklch(0.22 0.015 60));
	}

	.generation-spine-signal span:last-child {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.generation-spine-ground {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		overflow: hidden;
		color: var(--text-secondary, oklch(0.38 0.012 60));
		font-size: 0.66rem;
		font-weight: 500;
		line-height: 1.35;
	}

	.generation-spine-action {
		margin-top: auto;
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.52rem;
		font-weight: 850;
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.generation-rows {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}

	.generation-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.75rem;
		min-height: 5.75rem;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-left-width: 3px;
		border-radius: 8px;
		background: var(--surface-base, oklch(0.993 0.003 60));
		padding: 0.7rem;
	}

	.generation-row[data-state='live'] {
		border-left-color: var(--coord-verified, #10b981);
	}

	.generation-row[data-state='partial'] {
		border-left-color: var(--coord-route-solid, #3bc4b8);
	}

	.generation-row[data-state='draft-only'] {
		border-left-color: oklch(0.75 0.13 82);
		background: oklch(0.984 0.005 65);
	}

	.generation-row[data-state='gated'] {
		border-left-color: oklch(0.55 0.02 60);
		opacity: 0.86;
	}

	.generation-row-main {
		display: grid;
		align-content: start;
		gap: 0.28rem;
		min-width: 0;
	}

	.generation-row-label {
		color: var(--text-primary, oklch(0.22 0.015 60));
		font-size: 0.78rem;
		font-weight: 800;
		line-height: 1.2;
	}

	.generation-row-meta,
	.generation-row-state {
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.55rem;
		font-weight: 800;
		line-height: 1.25;
	}

	.generation-row-ground {
		color: var(--text-secondary, oklch(0.38 0.012 60));
		font-size: 0.72rem;
		font-weight: 500;
		line-height: 1.35;
	}

	.generation-row-effect,
	.generation-row-action {
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
		text-transform: uppercase;
		letter-spacing: 0;
	}

	.generation-row-effect {
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.56rem;
		font-weight: 750;
		line-height: 1.3;
	}

	.generation-row-action {
		max-width: 6.5rem;
		overflow: hidden;
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-size: 0.55rem;
		font-weight: 850;
		line-height: 1.2;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.generation-row-metric {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.2rem;
		min-width: 3.5rem;
		color: var(--text-primary, oklch(0.22 0.015 60));
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.88rem;
		font-weight: 800;
		line-height: 1;
		text-align: right;
	}

	.generation-boundary {
		border-left: 3px solid oklch(0.55 0.02 60);
	}

	.generation-boundary[data-state='partial'] {
		border-left-color: var(--coord-route-solid, #3bc4b8);
	}

	.generation-boundary[data-state='draft-only'] {
		border-left-color: oklch(0.75 0.13 82);
	}

	.generation-boundary[data-state='gated'] {
		border-left-color: oklch(0.55 0.02 60);
	}

	.generation-boundary-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		color: var(--text-tertiary, oklch(0.48 0.012 60));
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.62rem;
		font-weight: 750;
		line-height: 1.3;
		text-transform: uppercase;
	}

	.generation-boundary-meta span {
		max-width: 100%;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-radius: 6px;
		padding: 0.25rem 0.4rem;
		background: var(--surface-base, oklch(0.993 0.003 60));
		overflow-wrap: anywhere;
	}

	.generation-boundary-meta[data-retryable='false'] span:first-child {
		border-color: oklch(0.65 0.11 30 / 0.35);
		color: oklch(0.42 0.1 30);
	}

	@media (max-width: 640px) {
		.generation-contract-head {
			flex-direction: column;
		}

		.generation-state {
			align-items: flex-start;
		}

		.generation-rows {
			grid-template-columns: 1fr;
		}

		.generation-spine {
			grid-template-columns: 1fr;
		}

		.generation-row {
			min-height: 0;
		}

		.generation-spine-cell {
			min-height: 0;
		}
	}
</style>
