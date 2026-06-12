/**
 * Message Writer Agent — Two-Phase Pipeline
 *
 * Phase 1 (Source Discovery): Deterministic retrieval via Exa + Firecrawl.
 *   - Stratified Exa search (gov, news, general)
 *   - Firecrawl content fetch + provenance extraction
 *   - Gemini incentive-aware evaluation (structured JSON)
 *   - Returns evaluated source pool with credibility rationale
 *
 * Phase 2 (Message Generation): Write message using bounded source ground.
 *   - Cannot fabricate URLs—must cite from pool
 *   - Evaluated sources include incentive framing for context-aware citations
 *   - Search-only fallback sources are context, not evaluated evidence
 *
 * This prevents citation hallucination: every URL in the output must come from
 * the bounded source-ground pool, while evaluated/search-only status stays
 * explicit.
 */

import { z } from 'zod';
import { generateWithThoughts } from '../gemini-client';
import { MESSAGE_WRITER_PROMPT } from '../prompts/message-writer';
import { extractJsonFromGroundingResponse, isSuccessfulExtraction } from '../utils/grounding-json';
import { discoverSources, formatSourcesForPrompt } from './source-discovery';
import type {
	MessageResponse,
	DecisionMaker,
	TokenUsage,
	ExternalApiCounts,
	EvaluatedSource,
	Source
} from '../types';
import { sumTokenUsage, emptyExternalCounts } from '../types';
import { traceEvent } from '$lib/server/agent-trace';

// ============================================================================
// Zod Schema for Runtime Validation
// ============================================================================

const SourceSchema = z.object({
	num: z.number(),
	title: z.string(),
	url: z.string(),
	type: z.enum(['journalism', 'research', 'government', 'legal', 'advocacy', 'other'])
});

// GeoScope: ISO 3166 discriminated union (with optional displayName for human-readable preservation)
const GeoScopeSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('international') }),
	z.object({
		type: z.literal('nationwide'),
		country: z.string(),
		displayName: z.string().optional()
	}),
	z.object({
		type: z.literal('subnational'),
		country: z.string(),
		subdivision: z.string().optional(),
		locality: z.string().optional(),
		displayName: z.string().optional()
	})
]);

// Gemini sometimes returns geographic_scope as a plain string or old-format object.
// Coerce into GeoScope.
const CoercedGeoScopeSchema = z.preprocess((val) => {
	if (typeof val === 'string' && val.trim()) {
		return { type: 'subnational', country: 'US', locality: val.trim() };
	}
	// Coerce old { scope_level, scope_display } format
	if (val && typeof val === 'object' && 'scope_level' in val && 'scope_display' in val) {
		const old = val as { scope_level: string; scope_display: string };
		if (old.scope_level === 'international') return { type: 'international' };
		if (old.scope_level === 'national') return { type: 'nationwide', country: 'US' };
		return { type: 'subnational', country: 'US', locality: old.scope_display };
	}
	return val;
}, GeoScopeSchema);

const MessageResponseSchema = z.object({
	message: z.string(),
	sources: z.array(SourceSchema),
	research_log: z.array(z.string()).optional(),
	geographic_scope: CoercedGeoScopeSchema.default({ type: 'international' })
});

// ============================================================================
// Types
// ============================================================================

export type PipelinePhase = 'sources' | 'message' | 'complete';

export interface SourceEvidenceUpdate {
	sourceCount: number;
	mode: 'discovery' | 'preverified';
	evaluatedSourceCount: number;
	searchOnlySourceCount: number;
	evaluationFallback?: boolean;
	candidateCount?: number;
	failedCount?: number;
	searchQueryCount?: number;
}

export interface GenerateMessageResult extends MessageResponse {
	/** Accumulated token usage across source discovery + message generation */
	tokenUsage?: TokenUsage;
	/** External API call counts for cost tracking */
	externalCounts?: ExternalApiCounts;
	/** Full evaluated sources with incentive context — used for template source caching */
	evaluatedSources?: EvaluatedSource[];
}

export interface GenerateMessageOptions {
	subjectLine: string;
	coreMessage: string;
	topics: string[];
	decisionMakers: DecisionMaker[];
	voiceSample?: string;
	rawInput?: string;
	/** Geographic scope for source discovery */
	geographicScope?: {
		type: 'international' | 'nationwide' | 'subnational';
		country?: string;
		subdivision?: string;
		locality?: string;
	};
	/** Cached source ground (skip Phase 1 if provided) */
	verifiedSources?: EvaluatedSource[];
	/** Trace ID for observability — threaded to source discovery */
	traceId?: string;
	/** Callback for streaming thoughts */
	onThought?: (thought: string, phase?: PipelinePhase) => void;
	/** Callback for phase updates */
	onPhase?: (phase: PipelinePhase, message: string) => void;
	/** Callback when evaluated source ground becomes countable evidence */
	onSourceEvidence?: (evidence: SourceEvidenceUpdate) => void;
}

const SOURCE_EVALUATION_FALLBACK_PREFIX = 'Evaluation unavailable';

function searchOnlySourceCount(sources: EvaluatedSource[]): number {
	return sources.filter(
		(source) =>
			!source.incentive_position ||
			source.credibility_rationale.startsWith(SOURCE_EVALUATION_FALLBACK_PREFIX)
	).length;
}

// ============================================================================
// Message Generation
// ============================================================================

/**
 * Generate a research-backed message with bounded citation ground.
 *
 * Two-phase pipeline:
 * 1. Source Discovery: Find and validate source ground (unless cached sources are provided)
 * 2. Message Generation: Write using ONLY the provided source ground
 */
export async function generateMessage(
	options: GenerateMessageOptions
): Promise<GenerateMessageResult> {
	const startTime = Date.now();
	const { subjectLine, coreMessage, topics, decisionMakers, onThought, onPhase } = options;

	console.debug('[message-writer] Starting two-phase message generation...');

	// ====================================================================
	// Phase 1: Source Discovery (skip if cached source ground is provided)
	// ====================================================================

	let verifiedSources: EvaluatedSource[] = options.verifiedSources || [];
	let actualSearchQueries: string[] = []; // The REAL search queries we ran
	let sourceTokenUsage: TokenUsage | undefined;
	const externalCounts = emptyExternalCounts();

	if (verifiedSources.length === 0) {
		onPhase?.('sources', 'Finding and checking sources…');

		console.debug('[message-writer] Phase 1: Discovering sources...');

		const sourceResult = await discoverSources({
			coreMessage,
			subjectLine,
			topics,
			geographicScope: options.geographicScope,
			decisionMakers: decisionMakers.map((dm) => ({
				name: dm.name,
				title: dm.title,
				organization: dm.organization
			})),
			traceId: options.traceId,
			onThought: onThought ? (thought) => onThought(thought, 'sources') : undefined,
			onPhase: (phase, message) => {
				if (phase === 'validate') {
					onPhase?.('sources', message);
				}
			}
		});

		verifiedSources = sourceResult.evaluated;
		actualSearchQueries = sourceResult.searchQueries;
		sourceTokenUsage = sourceResult.tokenUsage;
		const searchOnlyCount = sourceResult.evaluationFallback
			? verifiedSources.length
			: searchOnlySourceCount(verifiedSources);
		options.onSourceEvidence?.({
			sourceCount: verifiedSources.length,
			mode: 'discovery',
			evaluatedSourceCount: verifiedSources.length - searchOnlyCount,
			searchOnlySourceCount: searchOnlyCount,
			evaluationFallback: sourceResult.evaluationFallback,
			candidateCount: sourceResult.discovered.length,
			failedCount: sourceResult.failed.length,
			searchQueryCount: actualSearchQueries.length
		});

		// Update external counts from new pipeline
		if (sourceResult.externalCounts) {
			externalCounts.exaSearches = sourceResult.externalCounts.exaSearches;
			externalCounts.firecrawlReads = sourceResult.externalCounts.firecrawlReads;
			externalCounts.groundingSearches = sourceResult.externalCounts.groundingSearches;
		} else {
			externalCounts.groundingSearches = sourceResult.groundingSearches;
		}

		console.debug('[message-writer] Phase 1 complete:', {
			discovered: sourceResult.discovered.length,
			evaluated: sourceResult.evaluated.length,
			failed: sourceResult.failed.length,
			searchQueries: actualSearchQueries
		});

		// Log failed sources for debugging
		if (sourceResult.failed.length > 0) {
			console.warn(
				'[message-writer] Failed source validations:',
				sourceResult.failed.map((f) => `${f.source.url}: ${f.error}`)
			);
		}

		// Bridging thought
		if (onThought && verifiedSources.length > 0) {
			const evaluatedCount = verifiedSources.length - searchOnlyCount;
			onThought(
				searchOnlyCount > 0
					? `Source ground ready: ${evaluatedCount} evaluated, ${searchOnlyCount} search-only. Now writing the message...`
					: `Evaluated ${evaluatedCount} sources. Now writing the message...`,
				'sources'
			);
		}
	} else {
		console.debug('[message-writer] Using cached source ground:', verifiedSources.length);
		const searchOnlyCount = searchOnlySourceCount(verifiedSources);
		options.onSourceEvidence?.({
			sourceCount: verifiedSources.length,
			mode: 'preverified',
			evaluatedSourceCount: verifiedSources.length - searchOnlyCount,
			searchOnlySourceCount: searchOnlyCount,
			evaluationFallback: searchOnlyCount > 0
		});
	}

	// ====================================================================
	// Phase 2: Message Generation with source ground
	// ====================================================================

	onPhase?.('message', 'Writing your message…');

	// Build decision-maker list for context
	const decisionMakerList = decisionMakers
		.map((dm) => `- ${dm.name}, ${dm.title} at ${dm.organization}`)
		.join('\n');

	// Build temporal context
	const currentDate = new Date().toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});

	// Inject current date into system prompt
	const systemPrompt = MESSAGE_WRITER_PROMPT.replace('{CURRENT_DATE}', currentDate);

	// Format evaluated sources for the prompt
	const sourcesBlock = formatSourcesForPrompt(verifiedSources);

	// Build the voice block — this is the emotional core to mine
	const voiceBlock =
		options.voiceSample || options.rawInput
			? `## THE HUMAN VOICE

${options.rawInput ? `What they wrote:\n"${options.rawInput}"\n` : ''}
${options.voiceSample ? `The emotional peak:\n"${options.voiceSample}"\n` : ''}
Find the specific trigger in these words. Build around what made them actually feel something.`
			: '';

	// Construct the user prompt — framed for emotional archaeology, not checklist
	const prompt = `${sourcesBlock}

## THE ISSUE

Subject: ${subjectLine}
Core Message: ${coreMessage}
Topics: ${topics.join(', ')}
${voiceBlock}

## DECISION-MAKERS

These are the specific people who will receive this message:
${decisionMakerList}

Make them feel the presence of real constituents behind this — people with real experiences who are watching and will remember.

## YOUR TASK

Find the emotional truth in the input above. Build a message that:
- Opens with the human experience, not context-setting
- Places [Personal Connection] where testimony amplifies the feeling
- Uses ONLY the source ground above (cite as [1], [2], etc.)
- Makes a clear, concrete ask these specific decision-makers can act on

The stranger who shares this link should think "I need to send that too." Every sender should feel "this is exactly what I wanted to say."`;

	console.debug('[message-writer] Phase 2: Generating message with source ground...');

	const messageWriteStart = Date.now();
	// Generate WITHOUT grounding — the source-ground pool is already bounded
	// This prevents the model from hallucinating additional URLs
	// Temperature 0.8: let the model's full linguistic range serve the writing.
	// Factual grounding comes from provided source ground, not token suppression.
	const result = await generateWithThoughts<MessageResponse>(
		prompt,
		{
			systemInstruction: systemPrompt,
			temperature: 0.8,
			thinkingLevel: 'high',
			enableGrounding: false, // Disabled — using bounded source ground
			maxOutputTokens: 65536
		},
		onThought ? (thought) => onThought(thought, 'message') : undefined
	);

	const messageTokenUsage = result.tokenUsage;
	const messageWriteLatencyMs = Date.now() - messageWriteStart;

	// Trace: Phase 2 Gemini call — FULL prompt + FULL response captured.
	// Privacy carried by TTL + `_secret` gate; replay needs the exact inputs
	// the model saw and the exact text it returned.
	if (options.traceId) {
		traceEvent(options.traceId, 'message-generation', 'message-write', {
			systemPrompt,
			userPrompt: prompt,
			rawResponse: result.rawText ?? null,
			tokenUsage: messageTokenUsage,
			latencyMs: messageWriteLatencyMs,
			model: 'gemini',
			temperature: 0.8,
			thinkingLevel: 'high',
			groundingEnabled: false,
			sourceGroundCount: verifiedSources.length,
			evaluatedSourceCount: verifiedSources.length - searchOnlySourceCount(verifiedSources),
			searchOnlySourceCount: searchOnlySourceCount(verifiedSources)
		});
	}

	// Extract JSON from response
	const extraction = extractJsonFromGroundingResponse<MessageResponse>(result.rawText || '');

	if (!isSuccessfulExtraction(extraction)) {
		// Log technical details for debugging (visible in browser console)
		console.error('[message-writer] JSON extraction failed:', {
			error: extraction.error,
			rawTextLength: result.rawText?.length,
			rawTextHead: result.rawText?.slice(0, 300),
			rawTextTail: result.rawText?.slice(-200)
		});
		// User-friendly error - doesn't break their vibe
		throw new Error('Message generation hit a snag. Please try again.');
	}

	console.debug('[message-writer] Extracted data keys:', Object.keys(extraction.data || {}));

	// Validate with Zod
	const validationResult = MessageResponseSchema.safeParse(extraction.data);

	if (!validationResult.success) {
		// Log technical details for debugging
		console.error('[message-writer] Invalid response structure:', validationResult.error.flatten());
		// User-friendly error
		throw new Error('Message generation hit a snag. Please try again.');
	}

	// CRITICAL: Replace generated sources with bounded source ground.
	// The model may include source metadata in its output, but we trust only the
	// source-ground pool and preserve evaluated/search-only metadata.
	const verifiedSourcesForOutput = verifiedSources.map((s): Source => {
		const base: Source = {
			num: s.num,
			title: s.title,
			url: s.url,
			type: s.type
		};
		base.credibility_rationale = s.credibility_rationale;
		base.incentive_position = s.incentive_position;
		base.source_order = s.source_order;
		return base;
	});

	// Normalize [Personal Connection] — fix case variations the model may produce
	const normalizedMessage = validationResult.data.message
		.trim()
		.replace(/\[personal\s+connection\]/gi, '[Personal Connection]');

	// Append deterministic signature (name only — address is a privacy concern)
	const messageWithSignature = `${normalizedMessage}

[Name]`;

	const latencyMs = Date.now() - startTime;

	const data: GenerateMessageResult = {
		...validationResult.data,
		message: messageWithSignature,
		sources: verifiedSourcesForOutput, // Use the bounded source-ground pool, not generated metadata
		// Use ACTUAL search queries from source discovery, not model's fabricated "research steps"
		research_log: actualSearchQueries.length > 0 ? actualSearchQueries : [],
		tokenUsage: sumTokenUsage(sourceTokenUsage, messageTokenUsage),
		externalCounts,
		evaluatedSources: verifiedSources
	};

	console.debug('[message-writer] Two-phase generation complete', {
		messageLength: data.message.length,
		sourceGroundRows: verifiedSourcesForOutput.length,
		latencyMs,
		geographicScope: data.geographic_scope?.type || 'none'
	});

	onPhase?.(
		'complete',
		verifiedSourcesForOutput.length > 0
			? `Your message is ready, with ${verifiedSourcesForOutput.length} source${verifiedSourcesForOutput.length === 1 ? '' : 's'} attached.`
			: 'Your message is ready.'
	);

	return data;
}
