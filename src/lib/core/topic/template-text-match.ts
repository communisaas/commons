/**
 * Search-First Text Matching for Existing Campaigns
 *
 * A pure, SSR-safe, deterministic matcher that scores the user's typed
 * grievance against the public template corpus already loaded on the homepage.
 * No embeddings, no network, no server search — just weighted token overlap
 * over the fields the `templates.listPublic` projection already ships to the
 * client (`title`, `topics[]`, `domain`, `description`).
 *
 * Honest by construction: a template only surfaces if it clears `minScore`.
 * When nothing clears the floor, `matchExistingCampaigns` returns `[]` — the
 * caller renders nothing rather than fabricating a match or false scarcity.
 *
 * This is the textual sibling of `template-filter.ts` (which scores LOCATION
 * relevance only) and is intentionally distinct from `embedding-search.ts`
 * (which delegates to the `/api/templates/search` server endpoint). The
 * front-door type-ahead must stay client-side and zero-cost, so it lives here.
 */

import type { Template } from '$lib/types/template';

/**
 * Minimum trimmed length before the matcher engages. Below this, a stray word
 * or two would surface noise, so the matcher stays silent until the typed text
 * carries enough signal to be a real grievance.
 */
export const MIN_QUERY_LENGTH = 12;

/**
 * Default score floor a template must clear to surface. Tuned against the
 * capped sum of per-token best-field credit below (see `scoreTemplateAgainstText`):
 * a single curated-topic (0.5) or title (0.4) or domain (0.25) hit clears it, but
 * a lone description brush (0.1) does not, so an incidental shared word never pulls
 * an unrelated campaign into view. Because credit is summed (not averaged over query
 * length), one strong facet hit clears the floor regardless of how long the typed
 * sentence is — natural lay phrasing is no longer structurally penalized.
 */
const DEFAULT_MIN_SCORE = 0.25;

/**
 * Per-field credit. Each MATCHED query token is credited the weight of the
 * STRONGEST field it lands in: topics are curated facet tags (highest signal),
 * the title is the human-readable ask (high), the domain is a coarse civic
 * bucket (medium), and the description is prose that mentions many incidental
 * words (low — confirms a match, never drives one). Crediting the best field
 * per token (rather than summing every field) keeps a precise single-facet hit
 * — e.g. "afford" landing on the housing title, or "ceo" on a `ceo-pay-ratio`
 * topic — meaningful without letting a word that happens to appear in both
 * description and topic double-count.
 */
const WEIGHT_TOPIC = 0.5;
const WEIGHT_TITLE = 0.4;
const WEIGHT_DOMAIN = 0.25;
const WEIGHT_DESCRIPTION = 0.1;

/**
 * Small stopword set — high-frequency function words that carry no topical
 * signal. Kept deliberately short: over-pruning hurts recall on short
 * grievances. Tokens shorter than 3 chars are dropped separately, so most
 * particles ("a", "to", "of", "is") never reach this set anyway.
 */
const STOPWORDS = new Set([
	'the',
	'and',
	'but',
	'for',
	'are',
	'was',
	'were',
	'has',
	'have',
	'had',
	'our',
	'out',
	'their',
	'them',
	'they',
	'this',
	'that',
	'these',
	'those',
	'with',
	'from',
	'into',
	'about',
	'keeps',
	'going',
	'just',
	'than',
	'then',
	'will',
	'would',
	'could',
	'should',
	'been',
	'being',
	'does',
	'doesnt',
	'dont',
	'cant',
	'wont',
	'not',
	'you',
	'your',
	'who',
	'what',
	'when',
	'where',
	'which',
	'how',
	'why',
	'all',
	'any',
	'can',
	'get',
	'got'
]);

/**
 * Tokenize free text into comparable tokens.
 *
 * Lowercases, folds dashes and underscores to spaces (so the `topics`
 * convention "rural-access" matches a typed "rural access"), strips remaining
 * punctuation, splits on whitespace, drops tokens shorter than 3 chars and the
 * stopword set, and de-duplicates. Pure — no browser globals — so it is safe
 * under SSR and in tests.
 */
export function tokenize(text: string): string[] {
	if (!text) return [];
	const raw = text
		.toLowerCase()
		.replace(/[-_]+/g, ' ')
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((tok) => tok.length >= 3 && !STOPWORDS.has(tok));
	// De-duplicate while preserving order for determinism.
	return [...new Set(raw)];
}

/**
 * Score one template against an already-tokenized query.
 *
 * For each query token, credit the weight of the STRONGEST field it lands in
 * (topic > title > domain > description), then SUM those credits and clamp to 1.
 *
 * Summing (not averaging by query length) is deliberate: lay grievances are full
 * sentences, but a campaign's curated facets are terse. Averaging divided a single
 * strong topic hit (0.5) across every word the user typed, so a 5-token sentence
 * scored 0.10 — below the floor — purely because it was phrased naturally. That
 * structurally penalized real grievances and made the matcher inert on the launch
 * corpus. With a capped sum, one strong facet hit clears the floor on its own,
 * length-independent, while the per-token best-field rule still prevents a word
 * that appears in several fields from double-counting. Precision is preserved by
 * the weights: a lone description brush (0.1) can't clear the 0.25 floor, and it
 * takes three independent description hits (a genuine topical overlap) to reach it.
 * The clamp at 1 keeps scores comparable for ranking. Returns 0 when nothing overlaps.
 */
export function scoreTemplateAgainstText(template: Template, queryTokens: string[]): number {
	if (queryTokens.length === 0) return 0;

	const topicTokens = new Set<string>();
	for (const topic of template.topics ?? []) {
		for (const tok of tokenize(topic)) topicTokens.add(tok);
	}
	const titleTokens = new Set(tokenize(template.title));
	const domainTokens = new Set(tokenize(template.domain));
	const descriptionTokens = new Set(tokenize(template.description));

	let credit = 0;
	for (const tok of queryTokens) {
		if (topicTokens.has(tok)) credit += WEIGHT_TOPIC;
		else if (titleTokens.has(tok)) credit += WEIGHT_TITLE;
		else if (domainTokens.has(tok)) credit += WEIGHT_DOMAIN;
		else if (descriptionTokens.has(tok)) credit += WEIGHT_DESCRIPTION;
	}

	return Math.min(credit, 1);
}

/** A template that cleared the floor, paired with its match score. */
export interface TextMatch {
	template: Template;
	score: number;
}

export interface MatchOptions {
	/** Maximum number of matches to return. Defaults to 3. */
	limit?: number;
	/** Score floor a template must clear to surface. Defaults to DEFAULT_MIN_SCORE. */
	minScore?: number;
}

/**
 * Find existing public campaigns whose curated facets match the typed text.
 *
 * Deterministic: tokenize once, score every template, drop anything below the
 * floor, then sort by score (desc) with a `send_count` tie-break (mirroring the
 * convention in `domain-grouping.ts`) and a final stable slug tie-break. Returns
 * the top `limit` — or `[]` when the text is too short or nothing clears the
 * floor. The empty case is the honest default: no match, no row.
 */
export function matchExistingCampaigns(
	templates: Template[],
	text: string,
	options: MatchOptions = {}
): TextMatch[] {
	const { limit = 3, minScore = DEFAULT_MIN_SCORE } = options;

	const trimmed = text.trim();
	if (trimmed.length < MIN_QUERY_LENGTH) return [];

	const queryTokens = tokenize(trimmed);
	if (queryTokens.length === 0) return [];

	const scored: TextMatch[] = [];
	for (const template of templates) {
		const score = scoreTemplateAgainstText(template, queryTokens);
		if (score >= minScore) {
			scored.push({ template, score });
		}
	}

	scored.sort((a, b) => {
		const byScore = b.score - a.score;
		if (byScore !== 0) return byScore;
		const bySend = (b.template.send_count || 0) - (a.template.send_count || 0);
		if (bySend !== 0) return bySend;
		// Final, fully-deterministic tie-break on a stable identifier.
		return (a.template.slug || a.template.id || '').localeCompare(
			b.template.slug || b.template.id || ''
		);
	});

	return scored.slice(0, limit);
}
