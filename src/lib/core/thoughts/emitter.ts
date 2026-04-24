/**
 * ThoughtEmitter - Structured thought emission service for agents
 *
 * Provides a clean API for agents to emit rich, expandable thought segments
 * instead of raw text streams. Supports progressive disclosure, inline citations,
 * and research traces.
 *
 * @example Basic usage
 * ```typescript
 * const emitter = new ThoughtEmitter((segment) => {
 *   console.log('New thought:', segment.content);
 * });
 *
 * emitter.startPhase('research');
 * emitter.think('Analyzing Apple Inc. sustainability leadership...');
 *
 * const research = emitter.startResearch('Apple Inc.', 'corporate');
 * research.addFinding('Lisa Jackson leads Environmental Policy');
 * research.complete('Found key sustainability leadership information');
 * ```
 *
 * @module thoughts/emitter
 */

import type {
	ThoughtSegment,
	Citation,
	CitationSource,
	ActionTrace,
	ActionHandle,
	ActionType,
	KeyMoment,
	PhaseState,
	ActionTargetType,
	ThinkOptions,
	InsightOptions,
	RecommendOptions
} from './types';

// ============================================================================
// ThoughtEmitter Class
// ============================================================================

/**
 * Agent-side service for emitting structured thoughts
 *
 * Provides a simple, intentional API for agents to express their reasoning
 * as rich, expandable segments rather than raw text streams.
 *
 * The emitter tracks:
 * - Current reasoning phase
 * - Key moments for persistent affordances
 * - Phase progression state
 *
 * All emitted segments are immediately sent to the callback for UI updates.
 */
export class ThoughtEmitter {
	/** Current reasoning phase */
	private currentPhase: string = 'init';

	/** Key moments captured for footer */
	private keyMoments: KeyMoment[] = [];

	/** Phase progression tracking */
	private phases: Map<string, PhaseState> = new Map();

	/** Callback invoked for each emitted segment */
	private onEmit: (segment: ThoughtSegment) => void;

	/**
	 * Create a new ThoughtEmitter
	 *
	 * @param onEmit - Callback invoked for each emitted thought segment
	 */
	constructor(onEmit: (segment: ThoughtSegment) => void) {
		this.onEmit = onEmit;
	}

	// ========================================================================
	// Phase Management
	// ========================================================================

	/**
	 * Start a new reasoning phase
	 *
	 * Phases group related thoughts together and enable visual organization
	 * in the UI (collapsible sections, progress indicators).
	 *
	 * Common phases:
	 * - 'understanding' - Comprehending user intent
	 * - 'research' - Gathering information
	 * - 'context' - Retrieving relevant context
	 * - 'drafting' - Creating message draft
	 * - 'validation' - Checking and refining
	 *
	 * @param phase - Phase identifier (e.g., 'research', 'context', 'drafting')
	 *
	 * @example
	 * ```typescript
	 * emitter.startPhase('research');
	 * emitter.think('Searching for Apple sustainability leadership...');
	 * ```
	 */
	startPhase(phase: string): void {
		// Complete previous phase if exists
		if (this.currentPhase !== 'init') {
			this.completePhase();
		}

		this.currentPhase = phase;

		// Initialize phase state
		const phaseState: PhaseState = {
			name: phase,
			status: 'active',
			startTime: Date.now()
		};
		this.phases.set(phase, phaseState);

		// Emit phase marker (empty reasoning segment)
		this.emit({
			type: 'reasoning',
			phase,
			content: '',
			emphasis: 'normal'
		});
	}

	/**
	 * Complete the current phase
	 *
	 * Marks the current phase as complete and records end time.
	 * Called automatically when starting a new phase.
	 *
	 * @example
	 * ```typescript
	 * emitter.startPhase('research');
	 * // ... research actions ...
	 * emitter.completePhase();
	 * ```
	 */
	completePhase(): void {
		const phaseState = this.phases.get(this.currentPhase);
		if (phaseState) {
			phaseState.status = 'complete';
			phaseState.endTime = Date.now();
		}
	}

	// ========================================================================
	// Thought Emission
	// ========================================================================

	/**
	 * Emit a reasoning thought
	 *
	 * The primary method for expressing agent reasoning. Emits a standard
	 * thought segment with optional citations and emphasis.
	 *
	 * @param content - The thought content to display
	 * @param options - Optional configuration
	 *
	 * @example Simple thought
	 * ```typescript
	 * emitter.think('Apple is a Fortune 500 company focused on sustainability.');
	 * ```
	 *
	 * @example Thought with citation
	 * ```typescript
	 * const citation = emitter.cite("Apple's 2025 Report", {
	 *   url: 'https://apple.com/report',
	 *   excerpt: 'Committed to carbon neutrality...'
	 * });
	 * emitter.think('Apple has committed to carbon neutrality by 2030.', {
	 *   citations: [citation]
	 * });
	 * ```
	 *
	 * @example Highlighted thought
	 * ```typescript
	 * emitter.think('This is a critical finding.', { emphasis: 'highlight', pin: true });
	 * ```
	 */
	think(content: string, options?: ThinkOptions): void {
		const segment = this.emit({
			type: 'reasoning',
			phase: this.currentPhase,
			content,
			citations: options?.citations,
			emphasis: options?.emphasis || 'normal',
			expandable: !!options?.citations?.length,
			pinToKeyMoments: options?.pin
		});

		// Pin to key moments if requested
		if (options?.pin) {
			this.keyMoments.push({
				id: crypto.randomUUID(),
				type: 'insight',
				label: this.truncateLabel(content),
				icon: '💭',
				segmentId: segment.id
			});
		}
	}

	/**
	 * Emit an insight (key finding or discovery)
	 *
	 * Similar to think() but with 'insight' type and highlighted by default.
	 * Automatically pins to key moments unless explicitly disabled.
	 *
	 * @param content - The insight content
	 * @param options - Optional configuration
	 *
	 * @example
	 * ```typescript
	 * emitter.insight('Lisa Jackson leads Apple Environmental Policy and reports to CEO.');
	 * ```
	 */
	insight(content: string, options?: InsightOptions): void {
		const shouldPin = options?.pin !== false; // Default to true

		const segment = this.emit({
			type: 'insight',
			phase: this.currentPhase,
			content,
			citations: options?.citations,
			emphasis: 'highlight',
			expandable: !!options?.citations?.length,
			pinToKeyMoments: shouldPin
		});

		if (shouldPin) {
			this.keyMoments.push({
				id: crypto.randomUUID(),
				type: 'insight',
				label: this.truncateLabel(content),
				icon: options?.icon || '💡',
				segmentId: segment.id
			});
		}
	}

	/**
	 * Emit a recommendation
	 *
	 * Suggests an action or decision to the user. Highlighted by default
	 * and automatically pinned to key moments.
	 *
	 * @param content - The recommendation content
	 * @param options - Optional configuration
	 *
	 * @example
	 * ```typescript
	 * emitter.recommend('I recommend contacting Lisa Jackson at Apple Inc.');
	 * ```
	 */
	recommend(content: string, options?: RecommendOptions): void {
		const shouldPin = options?.pin !== false; // Default to true

		const segment = this.emit({
			type: 'recommendation',
			phase: this.currentPhase,
			content,
			citations: options?.citations,
			emphasis: 'highlight',
			expandable: !!options?.citations?.length,
			pinToKeyMoments: shouldPin
		});

		if (shouldPin) {
			this.keyMoments.push({
				id: crypto.randomUUID(),
				type: 'insight',
				label: this.truncateLabel(content),
				icon: options?.icon || '✨',
				segmentId: segment.id
			});
		}
	}

	// ========================================================================
	// Research Actions
	// ========================================================================

	/**
	 * Start a research action (web research)
	 *
	 * Emits an action segment and returns a handle for updating the action
	 * as research progresses (adding findings, marking complete).
	 *
	 * @param target - What is being researched (e.g., 'Apple Inc.')
	 * @param targetType - Optional type of target for context
	 * @returns ActionHandle for updating the research action
	 *
	 * @example
	 * ```typescript
	 * const research = emitter.startResearch('Apple Inc.', 'corporate');
	 *
	 * // As research progresses
	 * research.addFinding('Lisa Jackson leads Environmental Policy');
	 * research.addFinding('Scope 3 emissions increased 12% in 2025');
	 *
	 * // When complete
	 * research.complete('Found sustainability leadership and emissions data');
	 * ```
	 */
	startResearch(target: string, targetType?: ActionTargetType): ActionHandle {
		const action: ActionTrace = {
			type: 'research',
			target,
			targetType,
			status: 'pending',
			startTime: Date.now(),
			pagesVisited: [],
			findings: []
		};

		const segment = this.emit({
			type: 'action',
			phase: this.currentPhase,
			content: `Researching ${target}...`,
			action,
			expandable: true,
			pinToKeyMoments: true
		});

		// Add to key moments
		this.keyMoments.push({
			id: crypto.randomUUID(),
			type: 'action',
			label: `Research: ${this.truncateLabel(target)}`,
			icon: '🔍',
			segmentId: segment.id
		});

		// Return handle for updating action
		return {
			addPage: (url: string, title: string, relevant: boolean) => {
				action.pagesVisited?.push({ url, title, relevant });
			},
			addFinding: (finding: string) => {
				action.findings?.push(finding);
			},
			complete: (summary: string) => {
				action.status = 'complete';
				action.endTime = Date.now();
				this.think(summary, { pin: true });
			},
			error: (message: string) => {
				action.status = 'error';
				action.endTime = Date.now();
				action.error = message;
				this.think(`Research failed: ${message}`, { emphasis: 'muted' });
			}
		};
	}

	/**
	 * Start a generic action (analyze, search, etc.)
	 *
	 * Emits an action segment and returns a handle for updating the action
	 * as it progresses. Useful for tool invocations like document analysis.
	 *
	 * @param actionType - Type of action (e.g., 'analyze', 'search')
	 * @param description - Human-readable description of the action
	 * @returns ActionHandle for updating the action
	 *
	 * @example
	 * ```typescript
	 * const action = emitter.startAction('analyze', 'Analyzing document: https://...');
	 *
	 * action.addFinding('Found 3 relevant sections');
	 * action.complete('Document analysis complete');
	 * ```
	 */
	startAction(actionType: ActionType, description: string): ActionHandle {
		const action: ActionTrace = {
			type: actionType,
			target: description,
			status: 'pending',
			startTime: Date.now(),
			findings: []
		};

		const segment = this.emit({
			type: 'action',
			phase: this.currentPhase,
			content: description,
			action,
			expandable: true,
			pinToKeyMoments: true
		});

		// Add to key moments
		this.keyMoments.push({
			id: crypto.randomUUID(),
			type: 'action',
			label: this.truncateLabel(description),
			icon: actionType === 'analyze' ? '📄' : '🔧',
			segmentId: segment.id
		});

		// Return handle for updating action
		return {
			addFinding: (finding: string) => {
				action.findings?.push(finding);
			},
			complete: (summary: string) => {
				action.status = 'complete';
				action.endTime = Date.now();
				this.think(summary, { pin: true });
			},
			error: (message: string) => {
				action.status = 'error';
				action.endTime = Date.now();
				action.error = message;
				this.think(`Action failed: ${message}`, { emphasis: 'muted' });
			}
		};
	}

	/**
	 * Start a retrieval action (Convex vector search)
	 *
	 * Emits an action segment for context retrieval and returns a handle
	 * for updating as results are found.
	 *
	 * @param query - Search query string
	 * @returns ActionHandle for updating the retrieval action
	 *
	 * @example
	 * ```typescript
	 * const retrieval = emitter.startRetrieval('climate policy corporate sustainability');
	 *
	 * retrieval.addFinding('Found 15 relevant intelligence items');
	 * retrieval.complete('Retrieved context on climate policy and sustainability');
	 * ```
	 */
	startRetrieval(query: string): ActionHandle {
		const action: ActionTrace = {
			type: 'retrieve',
			target: query,
			status: 'pending',
			startTime: Date.now(),
			query,
			resultsCount: 0,
			topResults: []
		};

		const segment = this.emit({
			type: 'action',
			phase: this.currentPhase,
			content: `Retrieving context: ${query}...`,
			action,
			expandable: true,
			pinToKeyMoments: false // Retrieval is less notable than research
		});

		// Return handle for updating action
		return {
			addFinding: (finding: string) => {
				// For retrieval, findings are just text notes
				if (!action.findings) {
					action.findings = [];
				}
				action.findings.push(finding);
			},
			complete: (summary: string) => {
				action.status = 'complete';
				action.endTime = Date.now();
				this.think(summary);
			},
			error: (message: string) => {
				action.status = 'error';
				action.endTime = Date.now();
				action.error = message;
				this.think(`Retrieval failed: ${message}`, { emphasis: 'muted' });
			}
		};
	}

	// ========================================================================
	// Citations
	// ========================================================================

	/**
	 * Create a citation for inline source references
	 *
	 * Citations can be included in think(), insight(), or recommend() calls
	 * to enable progressive disclosure of source material.
	 *
	 * @param label - Human-readable citation label
	 * @param source - Source information (URL, excerpt, IDs)
	 * @returns Citation object for use in thought options
	 *
	 * @example
	 * ```typescript
	 * const citation = emitter.cite("Apple's 2025 Report", {
	 *   url: 'https://apple.com/environmental-report-2025',
	 *   excerpt: 'We are committed to achieving carbon neutrality...',
	 *   intelligenceId: 'j57abcdef123456'
	 * });
	 *
	 * emitter.think('Apple has committed to carbon neutrality by 2030.', {
	 *   citations: [citation]
	 * });
	 * ```
	 */
	cite(label: string, source: CitationSource): Citation {
		const citation: Citation = {
			id: crypto.randomUUID(),
			label,
			url: source.url,
			excerpt: source.excerpt,
			sourceType: this.inferSourceType(source),
			intelligenceId: source.intelligenceId,
			documentId: source.documentId
		};

		// Add to key moments for quick access
		this.keyMoments.push({
			id: crypto.randomUUID(),
			type: 'citation',
			label: this.truncateLabel(label),
			icon: '📄',
			segmentId: citation.id, // Use citation ID as reference
			metadata: { citation }
		});

		return citation;
	}

	// ========================================================================
	// State Access
	// ========================================================================

	/**
	 * Get all captured key moments
	 *
	 * Key moments are important items (insights, citations, actions) that
	 * are pinned to a persistent footer so they don't scroll away.
	 *
	 * @returns Array of key moments
	 */
	getKeyMoments(): KeyMoment[] {
		return this.keyMoments;
	}

	/**
	 * Get all phase states
	 *
	 * Returns progression through reasoning phases for UI visualization
	 * (timeline, progress indicators, collapsible sections).
	 *
	 * @returns Array of phase states
	 */
	getPhases(): PhaseState[] {
		return Array.from(this.phases.values());
	}

	// ========================================================================
	// Internal Helpers
	// ========================================================================

	/**
	 * Emit a thought segment
	 *
	 * Internal method that creates a complete segment and invokes the callback.
	 * Handles ID generation, timestamps, and defaults.
	 *
	 * @param partial - Partial segment data
	 * @returns Complete emitted segment
	 */
	private emit(partial: Partial<ThoughtSegment>): ThoughtSegment {
		const segment: ThoughtSegment = {
			id: crypto.randomUUID(),
			timestamp: Date.now(),
			type: 'reasoning',
			phase: this.currentPhase,
			content: '',
			expandable: false,
			...partial
		};

		this.onEmit(segment);
		return segment;
	}

	/**
	 * Truncate a label to reasonable length for key moments
	 *
	 * @param text - Full text
	 * @param maxLength - Maximum length (default: 50)
	 * @returns Truncated text with ellipsis if needed
	 */
	private truncateLabel(text: string, maxLength = 50): string {
		if (text.length <= maxLength) {
			return text;
		}
		return text.slice(0, maxLength - 3) + '...';
	}

	/**
	 * Infer citation source type from source data
	 *
	 * @param source - Citation source
	 * @returns Inferred source type
	 */
	private inferSourceType(source: CitationSource): Citation['sourceType'] {
		// Use explicit sourceType if provided
		if (source.sourceType) return source.sourceType;
		// Otherwise infer from IDs/URL
		if (source.intelligenceId) return 'intelligence';
		if (source.documentId) return 'document';
		if (source.url?.includes('commons.email')) return 'organization';
		return 'web';
	}
}
