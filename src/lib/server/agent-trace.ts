/**
 * Agent Trace — Stub
 *
 * Fire-and-forget observability hooks for agent pipelines.
 * Used by source-discovery.ts and llm-cost-protection.ts to record
 * trace events and completion cost data.
 *
 * Production note: Wire to Convex or an external observability
 * backend when persistent trace storage is needed.
 */

/**
 * Record an event in an agent trace.
 *
 * @param traceId - Trace identifier
 * @param pipeline - Pipeline name (e.g., 'message-generation')
 * @param event - Event name (e.g., 'source-search', 'source-evaluation')
 * @param data - Arbitrary event data
 */
export function traceEvent(
	_traceId: string,
	_pipeline: string,
	_event: string,
	_data?: unknown
): void {
	// no-op — events are logged to console by callers
}

/**
 * Record a single trace event (legacy alias).
 */
export function traceAgent(
	_agentId: string,
	_event: string,
	_data?: unknown
): void {
	// no-op
}

/**
 * Start a named trace span and return a handle to end it.
 */
export function startTrace(_name: string): { end: () => void } {
	return { end: () => {} };
}

/**
 * Record LLM completion cost data against a trace.
 *
 * @param traceId - Trace identifier
 * @param operation - Operation name
 * @param costData - Cost breakdown components
 * @param meta - Additional metadata (userId, duration, token counts)
 */
export function traceCompletion(
	_traceId: string,
	_operation: string,
	_costData?: unknown,
	_meta?: unknown
): void {
	// no-op — cost data logged by llm-cost-protection.ts callers
}
