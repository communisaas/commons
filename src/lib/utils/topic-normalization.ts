/**
 * Topic normalization + location filtering.
 *
 * Normalizes raw topic strings to lowercase-hyphenated format and strips
 * any topics that are location names leaked by the LLM — using the agent's
 * own detected_location as the filter signal.
 */

/**
 * Normalize topics to lowercase, hyphenated format.
 * If detectedLocation is provided, strips topics whose tokens are
 * a subset of the location string (e.g. "san-francisco" when location
 * is "San Francisco, CA").
 */
export function normalizeTopics(topics: string[], detectedLocation?: string | null): string[] {
	const normalized = topics.map((t) =>
		t
			.toLowerCase()
			.trim()
			.replace(/\s+/g, '-')
			.replace(/[^a-z0-9-]/g, '')
	);
	if (!detectedLocation) return normalized;

	const locationTokens = detectedLocation
		.toLowerCase()
		.split(/[\s,]+/)
		.filter(Boolean);

	return normalized.filter((topic) => {
		const topicTokens = topic.split('-');
		return !topicTokens.every((w) => locationTokens.includes(w));
	});
}

/**
 * Derive a display category from normalized topics.
 * Title-cases the first topic ("public-health" → "Public Health").
 * Falls back to "General" if no topics remain.
 */
export function deriveCategory(topics: string[], detectedLocation?: string | null): string {
	const normalized = normalizeTopics(topics, detectedLocation);
	const primaryTopic = normalized[0] || 'general';
	return primaryTopic
		.split('-')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}
