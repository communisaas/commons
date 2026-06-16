/**
 * Unit Tests — civic-family kinship edges (the dashed taxonomic relation).
 *
 * Asserts the behavior the relatedness graph depends on: same-anchor templates
 * link as a connected, bounded chain; cross-anchor pairs get no family edge;
 * anchorless templates stay honestly isolated; and the function is pure /
 * deterministic. Fixtures use real domain wordings whose anchor resolution is
 * verified against the shipped `matchAnchor` table (Education = Public Library /
 * Library Workforce / Universal Preschool; Housing = Housing & Zoning /
 * Affordable Housing; Transportation = Urban Freeway Removal / Bike
 * Infrastructure; "Drug Treatment Access" matches no anchor → isolated).
 */

import { describe, it, expect } from 'vitest';
import { familyEdges } from '$lib/core/topic/relation-edges';
import type { Template, RelationEdge } from '$lib/types/template';

/** Minimal node the util reads (id + domain); the rest of Template is irrelevant. */
type FamilyNode = Pick<Template, 'id' | 'domain'>;

const node = (id: string, domain: string): FamilyNode => ({ id, domain });

/** Does an undirected edge connect exactly these two ids (in either order)? */
function connects(edge: RelationEdge, x: string, y: string): boolean {
	return (edge.a === x && edge.b === y) || (edge.a === y && edge.b === x);
}

/** All ids reachable from `start` over the edge set (connectivity probe). */
function reachable(start: string, edges: RelationEdge[]): Set<string> {
	const seen = new Set<string>([start]);
	const stack = [start];
	while (stack.length) {
		const cur = stack.pop()!;
		for (const e of edges) {
			const next = e.a === cur ? e.b : e.b === cur ? e.a : null;
			if (next && !seen.has(next)) {
				seen.add(next);
				stack.push(next);
			}
		}
	}
	return seen;
}

describe('familyEdges — same-anchor linkage', () => {
	it('links two templates that share a canonical anchor', () => {
		const edges = familyEdges([
			node('hz', 'Housing & Zoning'),
			node('ah', 'Affordable Housing')
		]);
		expect(edges).toHaveLength(1);
		expect(connects(edges[0], 'hz', 'ah')).toBe(true);
	});

	it('tags every edge as a family relation (never twin)', () => {
		const edges = familyEdges([
			node('hz', 'Housing & Zoning'),
			node('ah', 'Affordable Housing')
		]);
		expect(edges.every((e) => e.kind === 'family')).toBe(true);
	});

	it('omits the measured `score` on family edges (taxonomic, not measured)', () => {
		const edges = familyEdges([
			node('hz', 'Housing & Zoning'),
			node('ah', 'Affordable Housing')
		]);
		expect(edges[0].score).toBeUndefined();
	});

	it('normalizes endpoints so the lexically-smaller id is `a`', () => {
		const edges = familyEdges([
			node('zebra', 'Affordable Housing'),
			node('alpha', 'Housing & Zoning')
		]);
		expect(edges[0].a).toBe('alpha');
		expect(edges[0].b).toBe('zebra');
	});
});

describe('familyEdges — cross-anchor absence', () => {
	it('draws no edge between templates of different anchors', () => {
		const edges = familyEdges([
			node('house', 'Affordable Housing'), // Housing
			node('bike', 'Bike Infrastructure') // Transportation
		]);
		expect(edges).toHaveLength(0);
	});

	it('separates families: housing links to housing, transit to transit, never across', () => {
		const edges = familyEdges([
			node('hz', 'Housing & Zoning'),
			node('ah', 'Affordable Housing'),
			node('freeway', 'Urban Freeway Removal'),
			node('bike', 'Bike Infrastructure')
		]);
		// Two intra-family edges, zero cross-family.
		expect(edges).toHaveLength(2);
		expect(edges.some((e) => connects(e, 'hz', 'ah'))).toBe(true);
		expect(edges.some((e) => connects(e, 'freeway', 'bike'))).toBe(true);
		expect(edges.some((e) => connects(e, 'hz', 'bike'))).toBe(false);
		expect(edges.some((e) => connects(e, 'ah', 'freeway'))).toBe(false);
	});
});

describe('familyEdges — honestly isolated, never forced', () => {
	it('gives a single same-anchor template no family edge', () => {
		expect(familyEdges([node('solo', 'Affordable Housing')])).toHaveLength(0);
	});

	it('draws no edge for a template whose domain matches no anchor', () => {
		const edges = familyEdges([
			node('drug', 'Drug Treatment Access'), // matches no anchor keyword
			node('house', 'Affordable Housing')
		]);
		expect(edges).toHaveLength(0);
	});

	it('does NOT bucket anchorless templates into a fake shared family', () => {
		// Two distinct un-anchored domains must not be linked to each other.
		const edges = familyEdges([
			node('drug', 'Drug Treatment Access'),
			node('permits', 'Local Bake Sale Permits')
		]);
		expect(edges).toHaveLength(0);
	});

	it('treats a blank/whitespace domain as anchorless (no edge)', () => {
		const edges = familyEdges([
			node('blank', '   '),
			node('empty', ''),
			node('house', 'Affordable Housing')
		]);
		expect(edges).toHaveLength(0);
	});
});

describe('familyEdges — bounded fan-out yet connected', () => {
	it('links a 3-member family as a 2-edge chain, not an all-pairs triangle', () => {
		const edges = familyEdges([
			node('lib', 'Public Library'),
			node('work', 'Library Workforce'),
			node('pre', 'Universal Preschool')
		]);
		// All three resolve to Education. All-pairs would be 3 edges; a chain is 2.
		expect(edges).toHaveLength(2);
		// Every member is reachable from any other through the chain.
		expect(reachable('lib', edges)).toEqual(new Set(['lib', 'work', 'pre']));
	});

	it('keeps a large family connected with strictly n-1 edges (no blob)', () => {
		// Twelve same-anchor templates. All-pairs = 66 edges; chain = 11.
		const big: FamilyNode[] = Array.from({ length: 12 }, (_, i) =>
			node(`h${String(i).padStart(2, '0')}`, 'Affordable Housing')
		);
		const edges = familyEdges(big);
		expect(edges).toHaveLength(big.length - 1);
		// One connected component spanning all twelve.
		expect(reachable('h00', edges).size).toBe(12);
		// Bounded degree: a chain's interior nodes touch at most two edges —
		// proof there is no central hub or complete graph.
		const degree = new Map<string, number>();
		for (const e of edges) {
			degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
			degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
		}
		expect(Math.max(...degree.values())).toBeLessThanOrEqual(2);
	});

	it('collapses a duplicate id within a family to one node (no self-loop)', () => {
		const edges = familyEdges([
			node('dup', 'Affordable Housing'),
			node('dup', 'Housing & Zoning'),
			node('other', 'Affordable Housing')
		]);
		// Two distinct nodes (dup, other) → exactly one edge, never a self-loop.
		expect(edges).toHaveLength(1);
		expect(edges.every((e) => e.a !== e.b)).toBe(true);
		expect(connects(edges[0], 'dup', 'other')).toBe(true);
	});
});

describe('familyEdges — pure & deterministic', () => {
	const corpus: FamilyNode[] = [
		node('lib', 'Public Library'),
		node('work', 'Library Workforce'),
		node('pre', 'Universal Preschool'),
		node('hz', 'Housing & Zoning'),
		node('ah', 'Affordable Housing'),
		node('freeway', 'Urban Freeway Removal'),
		node('bike', 'Bike Infrastructure'),
		node('drug', 'Drug Treatment Access'), // anchorless → isolated
		node('vets', 'Veterans Healthcare') // lone Healthcare → isolated
	];

	it('returns identical output across repeated runs', () => {
		const first = familyEdges(corpus);
		const second = familyEdges(corpus);
		expect(second).toEqual(first);
	});

	it('is independent of input ordering', () => {
		const shuffled = [...corpus].reverse();
		expect(familyEdges(shuffled)).toEqual(familyEdges(corpus));
	});

	it('produces a globally sorted edge list (by a, then b)', () => {
		const edges = familyEdges(corpus);
		for (let i = 1; i < edges.length; i++) {
			const prev = edges[i - 1];
			const cur = edges[i];
			const ordered = prev.a < cur.a || (prev.a === cur.a && prev.b <= cur.b);
			expect(ordered).toBe(true);
		}
	});

	it('relates only the real families in a mixed corpus, leaving loners unlinked', () => {
		const edges = familyEdges(corpus);
		// Education chain (2) + Housing pair (1) + Transportation pair (1) = 4.
		expect(edges).toHaveLength(4);
		// The two honestly-isolated templates appear in no edge.
		const touched = new Set(edges.flatMap((e) => [e.a, e.b]));
		expect(touched.has('drug')).toBe(false);
		expect(touched.has('vets')).toBe(false);
	});

	it('returns an empty list for an empty corpus', () => {
		expect(familyEdges([])).toEqual([]);
	});
});
