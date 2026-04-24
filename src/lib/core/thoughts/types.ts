/**
 * Structured Thought Emission Type Definitions
 *
 * Data model for agent reasoning visualization with progressive disclosure.
 * Enables rich, explorable agent thoughts with inline citations and research traces.
 *
 * @module thoughts/types
 */

// ============================================================================
// Thought Segments
// ============================================================================

/**
 * Type of thought segment
 *
 * - reasoning: Agent's thought process and analysis
 * - action: Research or retrieval operation
 * - citation: Reference to a source
 * - insight: Key finding or discovery
 * - recommendation: Suggested next step or decision
 */
export type ThoughtSegmentType = 'reasoning' | 'action' | 'citation' | 'insight' | 'recommendation';

/**
 * Visual emphasis level for a thought segment
 *
 * - normal: Standard display
 * - highlight: Draw attention (key insights, recommendations)
 * - muted: De-emphasize (verbose details, completed actions)
 */
export type ThoughtEmphasis = 'normal' | 'highlight' | 'muted';

/**
 * A structured unit of agent reasoning.
 * Replaces raw text streaming with rich, expandable content.
 *
 * @example
 * ```typescript
 * const thought: ThoughtSegment = {
 *   id: 'thought-1',
 *   timestamp: Date.now(),
 *   type: 'reasoning',
 *   phase: 'research',
 *   content: 'Apple has committed to carbon neutrality by 2030.',
 *   expandable: true,
 *   expansion: {
 *     summary: 'According to their 2025 Environmental Report...',
 *     details: { reportUrl: 'https://...', pageNumber: 12 }
 *   },
 *   citations: [{
 *     id: 'cite-1',
 *     label: "Apple's 2025 Report",
 *     url: 'https://...',
 *     excerpt: 'We are committed to...'
 *   }],
 *   emphasis: 'highlight'
 * };
 * ```
 */
export interface ThoughtSegment {
	/** Unique identifier for this thought segment */
	id: string;

	/** Unix timestamp (ms) when this thought was emitted */
	timestamp: number;

	/** Classification of this thought segment */
	type: ThoughtSegmentType;

	/**
	 * Phase of agent reasoning
	 * Examples: 'research', 'context', 'drafting', 'validation'
	 */
	phase: string;

	/** What the user sees by default (may contain citation markers) */
	content: string;

	/** Whether this segment has expandable details */
	expandable: boolean;

	/**
	 * Progressive disclosure layers
	 * Provides increasing depth on user demand
	 */
	expansion?: ThoughtExpansion;

	/** Inline citations within content */
	citations?: Citation[];

	/** Research/retrieval action trace (for action-type segments) */
	action?: ActionTrace;

	/** Visual treatment hint for UI rendering */
	emphasis?: ThoughtEmphasis;

	/**
	 * Whether to pin this segment to Key Moments footer
	 * Important items that shouldn't scroll away
	 */
	pinToKeyMoments?: boolean;
}

// ============================================================================
// Progressive Disclosure
// ============================================================================

/**
 * Progressive disclosure layers for a thought segment
 *
 * Depth layers (from spec):
 * - L1: Citations/excerpts from the intelligence cache (Convex)
 * - L2: Research trace from Google Search grounding
 * - L3: Full documents from Reducto parse
 */
export interface ThoughtExpansion {
	/** Brief expansion shown on first click */
	summary: string;

	/** Structured details for deeper exploration (research trace, source metadata) */
	details?: StructuredData;

	/** Full content for maximum depth (full article, complete document) */
	raw?: string;
}

/**
 * Structured data container for expansion details
 * Type-safe wrapper for various expansion content types
 */
export interface StructuredData {
	/** Type of structured data */
	type: 'research_trace' | 'source_metadata' | 'document_excerpt' | 'entity_details';

	/** The actual structured data payload */
	data: Record<string, unknown>;
}

// ============================================================================
// Citations
// ============================================================================

/**
 * Source type for citations
 * Determines how to retrieve and display the citation
 */
export type CitationSourceType = 'intelligence' | 'document' | 'organization' | 'web';

/**
 * Reference to a source within thought content
 * Enables inline citation with progressive disclosure on click
 *
 * @example
 * ```typescript
 * const citation: Citation = {
 *   id: 'cite-1',
 *   label: "Apple's 2025 Report",
 *   url: 'https://...',
 *   excerpt: 'We are committed to carbon neutrality by 2030...',
 *   sourceType: 'intelligence',
 *   intelligenceId: 'j57abcdef123456'
 * };
 * ```
 */
export interface Citation {
	/** Unique identifier for this citation */
	id: string;

	/** Human-readable label (e.g., "Apple's 2025 Report") */
	label: string;

	/** Source URL (if available) */
	url?: string;

	/** Relevant excerpt or snippet from source */
	excerpt: string;

	/** Type of source being cited */
	sourceType: CitationSourceType;

	/** Convex intelligence item ID (for intelligence sources) */
	intelligenceId?: string;

	/** Reducto document ID (for parsed documents) */
	documentId?: string;
}

/**
 * Source information for creating citations
 * Simplified input format for ThoughtEmitter.cite()
 */
export interface CitationSource {
	/** Source URL */
	url?: string;

	/** Relevant excerpt text */
	excerpt: string;

	/** Convex intelligence item ID */
	intelligenceId?: string;

	/** Reducto document ID */
	documentId?: string;

	/**
	 * Explicit source type override
	 * If not provided, inferred from intelligenceId/documentId/url
	 */
	sourceType?: CitationSourceType;
}

// ============================================================================
// Action Traces
// ============================================================================

/**
 * Type of action being traced
 *
 * - research: Web research via Google Search grounding
 * - retrieve: Context retrieval from Convex vector search
 * - analyze: Analysis operation
 * - search: Search operation
 */
export type ActionType = 'research' | 'retrieve' | 'analyze' | 'search';

/**
 * Status of an action
 *
 * - pending: Action in progress
 * - complete: Action finished successfully
 * - error: Action failed
 */
export type ActionStatus = 'pending' | 'complete' | 'error';

/**
 * Type of target for research actions
 * Aligned with DecisionMakerTargetType
 */
export type ActionTargetType =
	| 'congress'
	| 'state_legislature'
	| 'local_government'
	| 'corporate'
	| 'nonprofit'
	| 'education'
	| 'healthcare'
	| 'labor'
	| 'media';

/**
 * Trace of a research or retrieval action
 * Captures what the agent did, how long it took, and what it found
 *
 * @example Research action
 * ```typescript
 * const researchTrace: ActionTrace = {
 *   type: 'research',
 *   target: 'Apple Inc.',
 *   targetType: 'corporate',
 *   status: 'complete',
 *   startTime: Date.now(),
 *   endTime: Date.now() + 2000,
 *   pagesVisited: [
 *     { url: 'https://apple.com/sustainability', title: 'Sustainability', relevant: true },
 *     { url: 'https://apple.com/leadership', title: 'Leadership', relevant: true }
 *   ],
 *   findings: [
 *     'Lisa Jackson leads Environmental Policy',
 *     'Committed to carbon neutrality by 2030'
 *   ]
 * };
 * ```
 *
 * @example Retrieval action
 * ```typescript
 * const retrievalTrace: ActionTrace = {
 *   type: 'retrieve',
 *   target: 'climate policy',
 *   status: 'complete',
 *   startTime: Date.now(),
 *   endTime: Date.now() + 500,
 *   query: 'climate policy corporate sustainability',
 *   resultsCount: 15,
 *   topResults: [
 *     { id: 'intel-1', title: 'Apple announces...', score: 0.89 },
 *     { id: 'intel-2', title: 'Microsoft commits...', score: 0.82 }
 *   ]
 * };
 * ```
 */
export interface ActionTrace {
	/** Type of action performed */
	type: ActionType;

	/** What was researched/retrieved (entity name, query, etc.) */
	target: string;

	/** Type of target (for research actions) */
	targetType?: ActionTargetType;

	/** Current status of the action */
	status: ActionStatus;

	/** Unix timestamp (ms) when action started */
	startTime: number;

	/** Unix timestamp (ms) when action completed (if finished) */
	endTime?: number;

	// Research-specific fields

	/** Pages visited during research */
	pagesVisited?: PageVisit[];

	/** Key findings from research */
	findings?: string[];

	// Retrieval-specific fields (Convex vector search)

	/** Query string used for retrieval */
	query?: string;

	/** Total number of results found */
	resultsCount?: number;

	/** Top results with relevance scores */
	topResults?: RetrievalResult[];

	// Error handling

	/** Error message (if status is 'error') */
	error?: string;
}

/**
 * A page visited during research
 */
export interface PageVisit {
	/** Page URL */
	url: string;

	/** Page title */
	title: string;

	/** Whether this page was relevant to the research */
	relevant: boolean;
}

/**
 * A retrieval result with relevance score
 */
export interface RetrievalResult {
	/** Result ID (Convex ID, intelligence item ID, etc.) */
	id: string;

	/** Result title or label */
	title: string;

	/** Relevance score (0-1) */
	score: number;
}

/**
 * Handle for updating an in-progress action
 * Returned by ThoughtEmitter.startResearch() and startRetrieval()
 *
 * @example
 * ```typescript
 * const research = emitter.startResearch('Apple Inc.', 'corporate');
 * research.addPage?.('https://apple.com', 'Apple Homepage', true);
 * research.addFinding('Lisa Jackson leads Environmental Policy');
 * research.complete('Found key leadership information');
 * ```
 */
export interface ActionHandle {
	/** Add a page visited during research (research actions only) */
	addPage?: (url: string, title: string, relevant: boolean) => void;

	/** Add a finding discovered */
	addFinding: (finding: string) => void;

	/** Mark action as complete with summary */
	complete: (summary: string) => void;

	/** Mark action as failed with error message */
	error: (message: string) => void;
}

// ============================================================================
// Key Moments
// ============================================================================

/**
 * Type of key moment
 *
 * - citation: Important source reference
 * - action: Significant research/retrieval
 * - insight: Key finding or discovery
 * - decision_maker: Identified decision-maker
 * - document: L3 full document view (user engaged deeply with content)
 */
export type KeyMomentType = 'citation' | 'action' | 'insight' | 'decision_maker' | 'document';

/**
 * Important item pinned to Key Moments footer
 * Prevents important affordances from scrolling away
 *
 * @example
 * ```typescript
 * const moment: KeyMoment = {
 *   id: 'moment-1',
 *   type: 'citation',
 *   label: "Apple's 2025 Report",
 *   icon: '📄',
 *   segmentId: 'thought-5'
 * };
 * ```
 */
export interface KeyMoment {
	/** Unique identifier */
	id: string;

	/** Type of moment */
	type: KeyMomentType;

	/** Human-readable label */
	label: string;

	/** Icon/emoji for visual identification */
	icon: string;

	/** ID of the thought segment this moment came from */
	segmentId: string;

	/** Optional metadata about the moment */
	metadata?: Record<string, unknown>;
}

// ============================================================================
// Phase State
// ============================================================================

/**
 * Status of an agent reasoning phase
 *
 * - pending: Phase not yet started
 * - active: Phase currently in progress
 * - complete: Phase finished
 */
export type PhaseStatus = 'pending' | 'active' | 'complete';

/**
 * Track progression through agent reasoning phases
 * Enables visual grouping and collapsible sections
 *
 * @example
 * ```typescript
 * const phases: PhaseState[] = [
 *   { name: 'Research', status: 'complete', startTime: 1000, endTime: 3000 },
 *   { name: 'Context', status: 'active', startTime: 3000 },
 *   { name: 'Drafting', status: 'pending' }
 * ];
 * ```
 */
export interface PhaseState {
	/** Phase name (e.g., 'research', 'context', 'drafting') */
	name: string;

	/** Current status */
	status: PhaseStatus;

	/** Unix timestamp (ms) when phase started (if started) */
	startTime?: number;

	/** Unix timestamp (ms) when phase completed (if complete) */
	endTime?: number;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Helper type for thought segment collections
 * Useful for phase containers and grouping
 */
export interface ThoughtSegmentGroup {
	/** Group identifier (usually phase name) */
	id: string;

	/** Display label for the group */
	label: string;

	/** Segments in this group */
	segments: ThoughtSegment[];

	/** Phase state (if applicable) */
	phase?: PhaseState;
}

/**
 * Helper type for streaming thought updates
 * Used by ThoughtEmitter service
 */
export type ThoughtStreamEvent =
	| { type: 'segment'; segment: ThoughtSegment }
	| { type: 'phase'; phase: PhaseState }
	| { type: 'key_moment'; moment: KeyMoment }
	| { type: 'complete'; totalSegments: number; duration: number }
	| { type: 'error'; error: string };

/**
 * Options for rendering thought segments
 * UI components can use this to customize display
 */
export interface ThoughtRenderOptions {
	/** Whether to show expandable content by default */
	autoExpand?: boolean;

	/** Whether to render citations inline */
	showCitations?: boolean;

	/** Whether to show action traces */
	showActions?: boolean;

	/** Maximum length for truncated content */
	maxContentLength?: number;

	/** Whether to enable Key Moments footer */
	enableKeyMoments?: boolean;
}

// ============================================================================
// Emitter Options
// ============================================================================

/**
 * Options for ThoughtEmitter.think() method
 */
export interface ThinkOptions {
	/** Inline citations to include */
	citations?: Citation[];

	/** Visual emphasis level */
	emphasis?: ThoughtEmphasis;

	/** Whether to pin to Key Moments footer */
	pin?: boolean;
}

/**
 * Options for ThoughtEmitter.insight() method
 */
export interface InsightOptions {
	/** Inline citations to include */
	citations?: Citation[];

	/** Whether to pin to Key Moments footer (defaults to true) */
	pin?: boolean;

	/** Icon for Key Moment display */
	icon?: string;
}

/**
 * Options for ThoughtEmitter.recommend() method
 */
export interface RecommendOptions {
	/** Inline citations to include */
	citations?: Citation[];

	/** Whether to pin to Key Moments footer (defaults to true) */
	pin?: boolean;

	/** Icon for Key Moment display */
	icon?: string;
}
