/**
 * Decision-Maker Provider Architecture
 *
 * Abstraction layer for pluggable decision-maker resolution strategies.
 * Currently uses Gemini + Exa Search for all target types.
 */

import type { ProcessedDecisionMaker } from '$lib/types/template';
import type { TokenUsage } from '../types';

// ============================================================================
// Target Types
// ============================================================================

/**
 * Target type for decision-maker resolution.
 *
 * Open-ended string — Gemini + Exa Search can research
 * any kind of organization or power structure. Common values include
 * 'congress', 'state_legislature', 'local_government', 'corporate',
 * 'nonprofit', 'education', 'healthcare', 'labor', 'media', but
 * any descriptive string is accepted.
 */
export type DecisionMakerTargetType = string;

// ============================================================================
// Geographic Scope
// ============================================================================

/**
 * Geographic context for decision-maker resolution
 * Helps providers understand jurisdiction and scope
 */
export interface GeographicScope {
	/** ISO 3166-1 alpha-2 country code */
	country?: string;
	/** State/province code (e.g., "CA", "TX") */
	state?: string;
	/** City name */
	city?: string;
	/** Congressional district (e.g., "CA-11") */
	district?: string;
	/** Display name for UI (e.g., "San Francisco, CA") */
	displayName?: string;
}

// ============================================================================
// Streaming Callbacks
// ============================================================================

/**
 * Streaming callbacks for provider progress updates.
 * Used by providers to emit real-time thoughts, phase changes, and progress.
 */
export interface StreamingCallbacks {
	/** Emitted for model reasoning thoughts */
	onThought?: (thought: string, phase: string) => void;
	/** Emitted when entering a new phase */
	onPhase?: (phase: string, message: string) => void;
	/** Emitted for progress updates (e.g., verification progress) */
	onProgress?: (progress: {
		current?: number;
		total?: number;
		status?: string;
		candidateName?: string;
	}) => void;
	/** Emitted after Phase 2a: identities resolved, contacts pending */
	onIdentitiesFound?: (identities: IdentityPlaceholder[]) => void;
	/** Emitted per-identity as Phase 2b mini-agents complete */
	onCandidateResolved?: (candidate: ResolvedCandidate) => void;
}

/** Placeholder card data emitted after Phase 2a identity resolution */
export interface IdentityPlaceholder {
	name: string;
	title: string;
	organization: string;
	status: 'pending' | 'cached';
	/** true if this identity was discovered from page content during Stage 4 */
	discovered?: boolean;
}

/** Per-identity resolution result from Phase 2b contact hunting */
export interface ResolvedCandidate {
	name: string;
	title: string;
	organization: string;
	email?: string;
	emailSource?: string;
	reasoning?: string;
	status: 'resolved' | 'no-email' | 'failed';
	/** true if this contact was discovered from page content during Stage 4 */
	discovered?: boolean;
}

// ============================================================================
// Resolution Context
// ============================================================================

/**
 * Input context for decision-maker resolution
 * Providers use this to determine HOW to research
 */
export interface ResolveContext {
	/** Type of target entity (routes to provider) */
	targetType: DecisionMakerTargetType;

	/** Entity name for corporate/institutional targets */
	targetEntity?: string;

	/** Entity homepage/website for research */
	targetUrl?: string;

	/** Subject line from campaign */
	subjectLine: string;

	/** Core message being sent */
	coreMessage: string;

	/** Topic tags for context */
	topics: string[];

	/** Geographic scope for jurisdiction-based targets */
	geographicScope?: GeographicScope;

	/** Voice sample (emotional peak from user input) */
	voiceSample?: string;

	/** Optional natural-language guidance about who to target */
	audienceGuidance?: string;

	/** Streaming callbacks for progress updates */
	streaming?: StreamingCallbacks;

	/**
	 * Transparency level for streamed reasoning. When true (STUDIO interior),
	 * the agent's tool-loop thoughts pass through a light filter that keeps
	 * planning talk and removes only output-format mechanics. When false/omitted
	 * (public citizen flow), the strict filter applies. Never fabricates.
	 */
	verbose?: boolean;

	/** Abort signal from router timeout — providers should check on each iteration */
	signal?: AbortSignal;
}

// ============================================================================
// Resolution Result
// ============================================================================

/**
 * Result from decision-maker resolution
 * Standardized output across all providers
 */
export interface DecisionMakerResult {
	/** Resolved decision-makers with contact info */
	decisionMakers: ProcessedDecisionMaker[];

	/** Provider that generated this result */
	provider: string;

	/** Optional: organization profile data (for corporate targets) */
	orgProfile?: unknown;

	/** Whether result came from cache */
	cacheHit: boolean;

	/** Total resolution time in milliseconds */
	latencyMs: number;

	/** Optional: research summary from provider */
	researchSummary?: string;

	/** Optional: provider-specific metadata */
	metadata?: Record<string, unknown>;

	/** Accumulated token usage across all LLM calls in this resolution */
	tokenUsage?: TokenUsage;
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Decision-maker provider interface
 * All providers must implement this contract
 */
export interface DecisionMakerProvider {
	/** Provider name for logging and routing */
	readonly name: string;

	/**
	 * Informational only — not used for routing.
	 * Kept for backward compatibility; may be empty.
	 */
	readonly supportedTargetTypes: readonly string[];

	/**
	 * Check if this provider can resolve the given context.
	 * This is the sole gate for provider selection — target type
	 * is treated as an open string passed through to the model.
	 */
	canResolve(context: ResolveContext): boolean;

	/**
	 * Resolve decision-makers for the given context
	 * @throws Error if resolution fails
	 */
	resolve(context: ResolveContext): Promise<DecisionMakerResult>;
}

// ============================================================================
// Router Configuration
// ============================================================================

/**
 * Provider registration for router
 */
export interface ProviderRegistration {
	provider: DecisionMakerProvider;
	/** Priority when multiple providers support the same target type (higher wins) */
	priority: number;
}

/**
 * Router options for resolution
 */
export interface RouterOptions {
	/** Whether to allow fallback to other providers on failure */
	allowFallback?: boolean;
	/** Preferred provider name (if available) */
	preferredProvider?: string;
	/** Maximum resolution time before timeout (ms) */
	timeoutMs?: number;
}
