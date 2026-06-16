/**
 * Civic-family kinship edges — the taxonomic relation, derivable on the client.
 *
 * Two public templates are civic-family kin when their domains resolve to the
 * SAME canonical anchor (Healthcare, Housing, Transportation, …). This is the
 * dashed, visually-subordinate relation of the relatedness graph: it asserts a
 * real taxonomic fact ("both are transportation concerns"), not a measured
 * semantic similarity. The solid `twin` edges (mean-centered embedding cosine,
 * computed server-side) carry the measured signal; family edges carry the
 * shared-category one.
 *
 * Honest, by construction:
 *
 *   - The kinship key is the canonical anchor a domain's WORDING points at,
 *     read straight from `matchAnchor` (the same anchor table that fixes the
 *     spectrum hue). A template whose domain matches no anchor — a hashed
 *     unknown, or a blank/null domain — gets NO family edge. It renders
 *     honestly isolated unless a measured twin connects it. There is no
 *     fabricated "Other" family that would invent kinship between unrelated
 *     loners (R4).
 *   - No embeddings are needed or touched: this runs from the already-shipped
 *     `domain` string alone, so it is fully client-derivable and never widens
 *     the wire payload (R8).
 *
 * Bounded fan-out (R7 — blooms with the corpus): within a same-anchor group the
 * members are linked as a single connected CHAIN, ordered by template id, not
 * as a complete graph. A group of n members yields n − 1 edges (every member
 * reachable from every other through the chain) instead of n(n − 1)/2. At the
 * seed every family is tiny, but the chain keeps a future 30-member domain from
 * exploding into a 435-edge blob that would drown the measured twins.
 *
 * Pure, deterministic, SSR-safe: no wall-clock reads, no randomness, no browser
 * globals. The same template set always yields the identical edge list, in a
 * stable order, with each edge's endpoints normalized so the lexically-smaller
 * id is `a` (matching the `twin` edges so the two sources dedupe cleanly).
 */

import type { Template, RelationEdge } from '$lib/types/template';
import { matchAnchor } from '$lib/utils/domain-hue';

/** The minimum the smaller-of-pair endpoint, so `a < b` holds on every edge. */
function orderedPair(x: string, y: string): { a: string; b: string } {
	return x <= y ? { a: x, b: y } : { a: y, b: x };
}

/**
 * The canonical-anchor key two templates must SHARE to be civic-family kin, or
 * `null` when the template resolves to no anchor (and so has no admissible
 * family). Keyed on the domain WORDING via `matchAnchor` rather than the hue
 * projection, so kinship is the plain taxonomic fact ("Public Library" and
 * "Library Workforce" are both Education) regardless of whether the embedding
 * hue backfill has run.
 */
function familyKey(template: Pick<Template, 'domain'>): number | null {
	const domain = typeof template.domain === 'string' ? template.domain.trim() : '';
	if (!domain) return null;
	return matchAnchor(domain);
}

/**
 * Derive the civic-family (`kind: 'family'`) edges for a set of public templates.
 *
 * Templates are bucketed by their shared canonical anchor; each non-trivial
 * bucket (≥ 2 members) is linked as an id-ordered chain so the whole family is
 * connected without an all-pairs blob. Templates with no anchor are dropped from
 * the family graph entirely — they stand alone unless a measured twin reaches them.
 *
 * @param templates - the public templates to relate
 * @returns the family edges, deterministically ordered (by `a` then `b`)
 */
export function familyEdges(templates: Pick<Template, 'id' | 'domain'>[]): RelationEdge[] {
	// Bucket by shared canonical anchor; skip the anchorless (honestly isolated).
	const byAnchor = new Map<number, string[]>();
	for (const template of templates) {
		const key = familyKey(template);
		if (key === null) continue;
		const id = template.id;
		if (typeof id !== 'string' || id.length === 0) continue;
		const bucket = byAnchor.get(key);
		if (bucket) bucket.push(id);
		else byAnchor.set(key, [id]);
	}

	const edges: RelationEdge[] = [];
	for (const ids of byAnchor.values()) {
		// One template is not a family; a chain needs at least a pair.
		if (ids.length < 2) continue;
		// Stable id order so the chain — and thus the whole edge set — is
		// reproducible regardless of input ordering. A duplicate id in the set
		// collapses to a single node, never a self-loop.
		const unique = Array.from(new Set(ids)).sort((x, y) => x.localeCompare(y));
		for (let i = 1; i < unique.length; i++) {
			const { a, b } = orderedPair(unique[i - 1], unique[i]);
			edges.push({ a, b, kind: 'family' });
		}
	}

	// Global stable order so two runs over the same input return an identical
	// array (the layout consumes this directly; determinism is load-bearing).
	edges.sort((e1, e2) => (e1.a === e2.a ? e1.b.localeCompare(e2.b) : e1.a.localeCompare(e2.a)));
	return edges;
}
