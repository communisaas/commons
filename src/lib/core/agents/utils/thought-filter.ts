/**
 * Thought Filter for Agent Traces
 *
 * Filters implementation details from user-visible agent thoughts.
 * Models often "think out loud" about output formatting, JSON structure,
 * and schema compliance — these are internal details that break immersion.
 *
 * Two-layer approach based on research:
 * 1. Prompt engineering: Tell model to focus on problem, not format
 * 2. Semantic filtering: Filter thoughts that discuss implementation
 *
 * @see https://arxiv.org/pdf/2503.09780 (AGENTDAM privacy research)
 * @see https://www.marktechpost.com/2025/06/25/new-ai-research-reveals-privacy-risks-in-llm-reasoning-traces/
 */

/**
 * Implementation detail patterns to filter from user-visible thoughts
 *
 * Research shows naive regex filtering is brittle, but semantic patterns
 * targeting specific leakage categories work well. We filter thoughts that
 * discuss output formatting rather than problem-solving.
 */
const IMPLEMENTATION_PATTERNS = [
	// JSON/schema structure
	/\bjson\b/i,
	/\bschema\b/i,
	/\bfield[s]?\b/i,
	/\bproperty|properties\b/i,
	/\bobject\b/i,
	/\barray\b/i,
	/\bstruct(ure)?d?\b/i,
	// Output formatting
	/\boutput format/i,
	/\bresponse format/i,
	/\bformat(ting)?\s+(the|my|this)/i,
	/\brequired field/i,
	/\bvalid(ation)?\b/i,
	// Common schema field names
	/\bneeds_clarification\b/i,
	/\bsubject_line\b/i,
	/\bcore_message\b/i,
	/\burl_slug\b/i,
	/\bvoice_sample\b/i,
	/\binferred_context\b/i,
	/\bclarification_questions\b/i,
	/\bgeographic_scope\b/i,
	/\bresearch_log\b/i,
	/\bsources\b.*\barray\b/i,
	// Meta-discussion about response
	/\bI (need to|should|must|will) (include|provide|output|return|generate|create)\b/i,
	/\blet me (structure|format|organize|create)\b/i,
	/\bthe (output|response|result) (should|must|will)\b/i,
	/\baccording to (the|my) (schema|format|structure)\b/i
];

/**
 * Output-format / schema patterns — the narrow set that is ALWAYS noise,
 * regardless of how transparent the surface wants to be. These leak the
 * model's serialization mechanics ("the JSON should…", "needs_clarification
 * field…") and carry no problem-solving signal. The light filter removes
 * only these; the strict filter removes these plus self-referential planning.
 */
const OUTPUT_FORMAT_PATTERNS = [
	/\bjson\b/i,
	/\bschema\b/i,
	/\boutput format/i,
	/\bresponse format/i,
	/\brequired field/i,
	/\bneeds_clarification\b/i,
	/\bsubject_line\b/i,
	/\bcore_message\b/i,
	/\burl_slug\b/i,
	/\bvoice_sample\b/i,
	/\binferred_context\b/i,
	/\bclarification_questions\b/i,
	/\bgeographic_scope\b/i,
	/\bresearch_log\b/i,
	/\bsources\b.*\barray\b/i,
	/\baccording to (the|my) (schema|format|structure)\b/i,
	/\blet me (structure|format)\b/i
];

/**
 * Check if a thought is primarily about implementation details
 */
function isImplementationThought(thought: string): boolean {
	const lowerThought = thought.toLowerCase();

	// Quick length check - very short thoughts are often format-related
	if (thought.length < 30) return true;

	// Check against implementation patterns
	for (const pattern of IMPLEMENTATION_PATTERNS) {
		if (pattern.test(thought)) {
			return true;
		}
	}

	// Check if thought is mostly about "I will/should/need to" without substance
	const selfReferentialCount = (lowerThought.match(/\bi (will|should|need|must|can)\b/g) || [])
		.length;
	const wordCount = thought.split(/\s+/).length;
	if (selfReferentialCount > 0 && wordCount < 20) {
		return true;
	}

	return false;
}

/**
 * Clean thought content for UI display
 *
 * Two-layer approach:
 * 1. Semantic filtering: Skip thoughts about implementation details
 * 2. Format cleanup: Remove markdown artifacts from remaining thoughts
 *
 * @param thought - Raw thought content from the model
 * @param options - Configuration options
 * @returns Cleaned thought string, or empty string if thought should be filtered
 */
export function cleanThoughtForDisplay(
	thought: string,
	options: {
		minLength?: number;
	} = {}
): string {
	const { minLength = 25 } = options;

	if (!thought?.trim()) return '';

	// Layer 1: Semantic filter - skip implementation-focused thoughts
	if (isImplementationThought(thought)) {
		return '';
	}

	// Layer 2: Format cleanup for user-visible thoughts
	// Remove markdown bold headings like "**Analyzing the Issue**"
	let cleaned = thought.replace(/^\*\*([^*]+)\*\*\s*[-–—]?\s*/i, '');

	// Remove leading newlines
	cleaned = cleaned.replace(/^\n+/, '');

	// Trim
	cleaned = cleaned.trim();

	// Skip if too short after cleanup (likely format-only content)
	if (cleaned.length < minLength) {
		return '';
	}

	// No truncation - show full thought traces
	return cleaned;
}

/**
 * Light filter for transparent reasoning surfaces (the STUDIO interior).
 *
 * The strict `cleanThoughtForDisplay` suppresses ~60-70% of raw model
 * reasoning — including legitimate planning steps like "Now I need to
 * evaluate these candidates' email deliverability" — because it treats any
 * short self-referential thought as noise. For STUDIO, making the agent's
 * real thinking VISIBLE is the whole point (the HONESTY RULE), so we keep
 * problem-solving talk and remove ONLY output-format/schema mechanics.
 *
 * It never fabricates: it returns '' for a thought that is pure
 * serialization chatter, and the cleaned, full thought otherwise.
 *
 * @param thought - Raw thought content from the model
 * @param options - Configuration options
 * @returns Cleaned thought string, or empty string if it is format-only.
 */
export function lightThoughtFilter(
	thought: string,
	options: {
		minLength?: number;
	} = {}
): string {
	// Lower floor than strict: short-but-substantive planning lines are kept.
	const { minLength = 12 } = options;

	if (!thought?.trim()) return '';

	// Remove ONLY output-format / schema mechanics. Keep planning talk.
	for (const pattern of OUTPUT_FORMAT_PATTERNS) {
		if (pattern.test(thought)) return '';
	}

	// Format cleanup (same as strict path).
	let cleaned = thought.replace(/^\*\*([^*]+)\*\*\s*[-–—]?\s*/i, '');
	cleaned = cleaned.replace(/^\n+/, '').trim();

	if (cleaned.length < minLength) return '';

	return cleaned;
}

/**
 * Filter a thought for display at a given transparency level.
 *
 *   'strict'  — public citizen flow. Suppresses planning chatter for a
 *               calm, immersive trace. (`cleanThoughtForDisplay`.)
 *   'verbose' — STUDIO interior. Surfaces real reasoning; removes only
 *               output-format mechanics. (`lightThoughtFilter`.)
 */
export function filterThoughtForDisplay(
	thought: string,
	mode: 'strict' | 'verbose'
): string {
	return mode === 'verbose' ? lightThoughtFilter(thought) : cleanThoughtForDisplay(thought);
}
