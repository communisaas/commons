/**
 * Unit Tests — the relation-graph layout engine.
 *
 * Asserts the contract the relatedness surface leans on:
 *   - DETERMINISM: same (nodes, edges, size, seed) ⇒ byte-identical positions,
 *     independent of input order — so the SSR render and the client render
 *     agree to the pixel and the graph never lurches on hydration.
 *   - HONESTLY ISOLATED: nodes with no edge settle toward the periphery, not
 *     the centre — the sparsity reads as intentional, never forced inward.
 *   - NO OVERLAP: a minimum centre-to-centre separation is enforced so two
 *     clusters never pile on one spot.
 *   - BOUNDED + ON-CANVAS: the layout terminates and every position lands
 *     inside the given width/height.
 *
 * The fixture mirrors the live seed's measured structure: four twin pairs, one
 * family chain, and a few honestly-isolated loners — so the invariants are
 * checked on the shape the surface actually renders.
 */

import { describe, it, expect } from 'vitest';
import {
	layoutRelationGraph,
	layoutRelationGraphMemo,
	type GraphLayoutNode,
	type GraphLayoutEdge,
	type Point
} from '$lib/core/topic/graph-layout';

// --- Fixture: the measured seed shape --------------------------------------

const node = (id: string): GraphLayoutNode => ({ id });
const twin = (a: string, b: string): GraphLayoutEdge => ({ a, b, kind: 'twin' });
const family = (a: string, b: string): GraphLayoutEdge => ({ a, b, kind: 'family' });

/** Connected ids (carry at least one edge below) and the honestly-isolated ones. */
const CONNECTED_IDS = [
	'lib',
	'work',
	'pre',
	'priv',
	'drug',
	'house',
	'parks',
	'indig',
	'freeway',
	'bike'
];
const ISOLATED_IDS = ['vets', 'retail', 'green'];
const ALL_IDS = [...CONNECTED_IDS, ...ISOLATED_IDS];

const NODES: GraphLayoutNode[] = ALL_IDS.map(node);
const EDGES: GraphLayoutEdge[] = [
	twin('lib', 'work'),
	twin('priv', 'pre'),
	twin('drug', 'house'),
	twin('parks', 'indig'),
	twin('bike', 'freeway'),
	family('lib', 'pre'),
	family('pre', 'work')
];

const SIZE = { width: 1080, height: 600 } as const;

// --- Helpers ----------------------------------------------------------------

function dist(p: Point, q: Point): number {
	return Math.hypot(p.x - q.x, p.y - q.y);
}

/** Distance from the canvas centre — the "how peripheral is this node" probe. */
function radius(p: Point, width: number, height: number): number {
	return Math.hypot(p.x - width / 2, p.y - height / 2);
}

function mean(values: number[]): number {
	return values.reduce((s, v) => s + v, 0) / values.length;
}

/** The smallest centre-to-centre distance over every distinct pair. */
function minPairSeparation(pos: Map<string, Point>): number {
	const ids = [...pos.keys()];
	let smallest = Infinity;
	for (let i = 0; i < ids.length; i++) {
		for (let j = i + 1; j < ids.length; j++) {
			const d = dist(pos.get(ids[i])!, pos.get(ids[j])!);
			if (d < smallest) smallest = d;
		}
	}
	return smallest;
}

// --- Determinism ------------------------------------------------------------

describe('layoutRelationGraph — determinism (SSR ⇄ client parity)', () => {
	it('returns byte-identical positions across repeated runs', () => {
		const first = layoutRelationGraph(NODES, EDGES, { ...SIZE, seed: 0 });
		const second = layoutRelationGraph(NODES, EDGES, { ...SIZE, seed: 0 });
		expect(second.size).toBe(first.size);
		for (const [id, point] of first) {
			expect(second.get(id)).toEqual(point);
		}
	});

	it('is independent of node input order', () => {
		const forward = layoutRelationGraph(NODES, EDGES, { ...SIZE, seed: 0 });
		const reversed = layoutRelationGraph([...NODES].reverse(), EDGES, { ...SIZE, seed: 0 });
		for (const [id, point] of forward) {
			expect(reversed.get(id)).toEqual(point);
		}
	});

	it('is independent of edge input order and endpoint orientation', () => {
		const forward = layoutRelationGraph(NODES, EDGES, { ...SIZE, seed: 0 });
		// Reverse the edge list AND flip each edge's endpoints (undirected).
		const shuffledEdges = [...EDGES].reverse().map((e) => ({ a: e.b, b: e.a, kind: e.kind }));
		const other = layoutRelationGraph(NODES, shuffledEdges, { ...SIZE, seed: 0 });
		for (const [id, point] of forward) {
			expect(other.get(id)).toEqual(point);
		}
	});

	it('produces a different (still deterministic) arrangement for a different seed', () => {
		const a1 = layoutRelationGraph(NODES, EDGES, { ...SIZE, seed: 42 });
		const a2 = layoutRelationGraph(NODES, EDGES, { ...SIZE, seed: 42 });
		const b = layoutRelationGraph(NODES, EDGES, { ...SIZE, seed: 1337 });
		// Same seed: identical.
		for (const [id, point] of a1) expect(a2.get(id)).toEqual(point);
		// Different seed: at least one node moved (the seed actually re-rolls).
		let anyMoved = false;
		for (const [id, point] of a1) {
			const other = b.get(id)!;
			if (other.x !== point.x || other.y !== point.y) anyMoved = true;
		}
		expect(anyMoved).toBe(true);
	});

	it('defaults the seed to 0 when omitted', () => {
		const explicit = layoutRelationGraph(NODES, EDGES, { ...SIZE, seed: 0 });
		const implicit = layoutRelationGraph(NODES, EDGES, { ...SIZE });
		for (const [id, point] of explicit) {
			expect(implicit.get(id)).toEqual(point);
		}
	});
});

// --- Honestly isolated, never forced ---------------------------------------

describe('layoutRelationGraph — isolated nodes fall to the periphery (R4)', () => {
	it('places no-edge nodes further from centre than the connected mean', () => {
		const pos = layoutRelationGraph(NODES, EDGES, { ...SIZE, seed: 0 });
		const isoRadii = ISOLATED_IDS.map((id) => radius(pos.get(id)!, SIZE.width, SIZE.height));
		const conRadii = CONNECTED_IDS.map((id) => radius(pos.get(id)!, SIZE.width, SIZE.height));
		// The isolated cohort sits, on average, nearer the rim than the connected
		// cohort — the loners are pushed out, not pulled inward to a fake cluster.
		expect(mean(isoRadii)).toBeGreaterThan(mean(conRadii));
	});

	it('keeps the periphery property across several seeds (not a lucky basin)', () => {
		for (const seed of [0, 1, 7, 42, 1337]) {
			const pos = layoutRelationGraph(NODES, EDGES, { ...SIZE, seed });
			const isoRadii = ISOLATED_IDS.map((id) => radius(pos.get(id)!, SIZE.width, SIZE.height));
			const conRadii = CONNECTED_IDS.map((id) => radius(pos.get(id)!, SIZE.width, SIZE.height));
			expect(mean(isoRadii)).toBeGreaterThan(mean(conRadii));
		}
	});

	it('seats every isolate in the rim band, past the connected mean — not intermixed', () => {
		// Stronger than the cohort-mean comparison: EACH loner must sit out in the
		// rim band (≥78% of the way to the canvas edge on its own axis) AND further
		// from centre than the connected mean. This is the property the rim push
		// guarantees and the live defect (loners landing among the connected core)
		// violated. The elliptical band fraction is axis-normalized, so a wide
		// canvas pushing a loner to the left/right edge counts the same as one
		// pushed top/bottom. (Note: a connected twin-pair can be declump-clamped
		// against an edge too, so we don't claim every isolate beats every
		// connected node — only that no isolate reads as nestled in the core.)
		const RIM_BAND_FLOOR = 0.78;
		for (const seed of [0, 1, 7, 42, 1337]) {
			const pos = layoutRelationGraph(NODES, EDGES, { ...SIZE, seed });
			const ellipseFraction = (id: string) => {
				const p = pos.get(id)!;
				return Math.hypot(
					(p.x - SIZE.width / 2) / (SIZE.width / 2),
					(p.y - SIZE.height / 2) / (SIZE.height / 2)
				);
			};
			const connectedMeanRadius = mean(
				CONNECTED_IDS.map((id) => radius(pos.get(id)!, SIZE.width, SIZE.height))
			);
			for (const id of ISOLATED_IDS) {
				expect(ellipseFraction(id)).toBeGreaterThanOrEqual(RIM_BAND_FLOOR);
				expect(radius(pos.get(id)!, SIZE.width, SIZE.height)).toBeGreaterThan(
					connectedMeanRadius
				);
			}
		}
	});

	it('draws no edge-derived attraction for an isolated node (it has no edge)', () => {
		// A graph of ONLY isolated nodes still lays them out — spread, not stacked.
		const lone = ['a', 'b', 'c', 'd'].map(node);
		const pos = layoutRelationGraph(lone, [], { ...SIZE, seed: 0 });
		expect(pos.size).toBe(4);
		expect(minPairSeparation(pos)).toBeGreaterThanOrEqual(132 - 1);
	});
});

// --- No overlap (declump min separation) -----------------------------------

describe('layoutRelationGraph — minimum separation (no overlapping clusters)', () => {
	it('keeps every pair at least the default minimum apart', () => {
		const pos = layoutRelationGraph(NODES, EDGES, { ...SIZE, seed: 0 });
		// Allow a 1px tolerance for the final hard clamp into [0,w]×[0,h].
		expect(minPairSeparation(pos)).toBeGreaterThanOrEqual(132 - 1);
	});

	it('honors a caller-supplied larger minimum separation', () => {
		const pos = layoutRelationGraph(NODES, EDGES, { ...SIZE, seed: 0, minSeparation: 160 });
		expect(minPairSeparation(pos)).toBeGreaterThanOrEqual(160 - 1);
	});

	it('still settles connected twins nearer each other than the typical loner', () => {
		const pos = layoutRelationGraph(NODES, EDGES, { ...SIZE, seed: 0 });
		// The measured twin pairs end up at (or near) the declump floor — far
		// closer than an isolated node sits to anything.
		const twinGap = mean([
			dist(pos.get('lib')!, pos.get('work')!),
			dist(pos.get('parks')!, pos.get('indig')!),
			dist(pos.get('bike')!, pos.get('freeway')!)
		]);
		// Nearest-neighbour distance of an isolated node (to anything at all).
		const isoNearest = mean(
			ISOLATED_IDS.map((id) => {
				const p = pos.get(id)!;
				let nearest = Infinity;
				for (const [other, q] of pos) {
					if (other === id) continue;
					nearest = Math.min(nearest, dist(p, q));
				}
				return nearest;
			})
		);
		expect(twinGap).toBeLessThanOrEqual(isoNearest);
	});
});

// --- Bounded + on-canvas ----------------------------------------------------

describe('layoutRelationGraph — bounded + within canvas (R9)', () => {
	it('places every node inside [0, width] × [0, height]', () => {
		const pos = layoutRelationGraph(NODES, EDGES, { ...SIZE, seed: 0 });
		for (const point of pos.values()) {
			expect(point.x).toBeGreaterThanOrEqual(0);
			expect(point.x).toBeLessThanOrEqual(SIZE.width);
			expect(point.y).toBeGreaterThanOrEqual(0);
			expect(point.y).toBeLessThanOrEqual(SIZE.height);
		}
	});

	it('terminates and stays on-canvas at a larger corpus (blooms — R7)', () => {
		// 60 synthetic nodes, half linked into pairs, half isolated. Same fn,
		// no code change — exercises the bounded-iteration + clamp guarantees.
		const grown: GraphLayoutNode[] = Array.from({ length: 60 }, (_, i) =>
			node(`t${String(i).padStart(2, '0')}`)
		);
		const grownEdges: GraphLayoutEdge[] = [];
		for (let i = 0; i + 1 < 30; i += 2) {
			grownEdges.push(twin(`t${String(i).padStart(2, '0')}`, `t${String(i + 1).padStart(2, '0')}`));
		}
		const pos = layoutRelationGraph(grown, grownEdges, { width: 1440, height: 900, seed: 0 });
		expect(pos.size).toBe(60);
		for (const point of pos.values()) {
			expect(point.x).toBeGreaterThanOrEqual(0);
			expect(point.x).toBeLessThanOrEqual(1440);
			expect(point.y).toBeGreaterThanOrEqual(0);
			expect(point.y).toBeLessThanOrEqual(900);
		}
	});
});

// --- Memoization (one compute per distinct graph; no stale cache) -----------

describe('layoutRelationGraphMemo — memoized by (nodeIds, edgeKey, size)', () => {
	it('returns the SAME map instance for identical inputs (no recompute)', () => {
		const first = layoutRelationGraphMemo(NODES, EDGES, { ...SIZE, seed: 0 });
		const second = layoutRelationGraphMemo(NODES, EDGES, { ...SIZE, seed: 0 });
		// Reference equality is the proof the layout did not run again — a hover or a
		// keystroke that re-derives with the same graph pays nothing.
		expect(second).toBe(first);
	});

	it('is keyed independent of node/edge order (same logical graph → same instance)', () => {
		const forward = layoutRelationGraphMemo(NODES, EDGES, { ...SIZE, seed: 0 });
		const shuffledNodes = [...NODES].reverse();
		const shuffledEdges = [...EDGES].reverse().map((e) => ({ a: e.b, b: e.a, kind: e.kind }));
		const reordered = layoutRelationGraphMemo(shuffledNodes, shuffledEdges, { ...SIZE, seed: 0 });
		// The key canonicalizes ids + edges, so reordering hits the same cache entry.
		expect(reordered).toBe(forward);
	});

	it('does NOT serve a stale map when the edge set genuinely changes', () => {
		const base = layoutRelationGraphMemo(NODES, EDGES, { ...SIZE, seed: 0 });
		// Drop one measured twin — a genuinely different graph. The memo must recompute,
		// not hand back the prior arrangement (the R9 stale-graph risk).
		const fewerEdges = EDGES.filter((e) => !(e.a === 'bike' && e.b === 'freeway'));
		const next = layoutRelationGraphMemo(NODES, fewerEdges, { ...SIZE, seed: 0 });
		expect(next).not.toBe(base);
		// And the positions actually differ where the dropped tie mattered.
		expect(next.get('bike')).not.toEqual(base.get('bike'));
	});

	it('recomputes for a different size or seed (size/seed are part of the key)', () => {
		const a = layoutRelationGraphMemo(NODES, EDGES, { ...SIZE, seed: 0 });
		const bigger = layoutRelationGraphMemo(NODES, EDGES, { width: 1440, height: 900, seed: 0 });
		const reseeded = layoutRelationGraphMemo(NODES, EDGES, { ...SIZE, seed: 9 });
		expect(bigger).not.toBe(a);
		expect(reseeded).not.toBe(a);
	});

	it('agrees with the pure layout — memoization changes caching, not geometry', () => {
		const pure = layoutRelationGraph(NODES, EDGES, { ...SIZE, seed: 0 });
		const memoized = layoutRelationGraphMemo(NODES, EDGES, { ...SIZE, seed: 0 });
		expect(memoized.size).toBe(pure.size);
		for (const [id, point] of pure) {
			expect(memoized.get(id)).toEqual(point);
		}
	});

	it('a second render with the same graph reuses the cache — the one-time mount cost (R9)', () => {
		// Simulate SSR then client: two calls with the same logical graph. The second
		// is a cache hit (same instance), so the quadratic compute is paid exactly once
		// regardless of how many times the reactive surface re-derives.
		const ssr = layoutRelationGraphMemo(NODES, EDGES, { ...SIZE });
		const client = layoutRelationGraphMemo(NODES, EDGES, { ...SIZE });
		expect(client).toBe(ssr);
	});
});

// --- SSR ⇄ client position parity (the R9 measure) --------------------------

describe('layoutRelationGraph — SSR ⇄ client parity (no post-hydration jump)', () => {
	it('the seed-shape graph lays out byte-identically on a "server" and "client" pass', () => {
		// Two independent computes stand in for the server render and the client
		// hydration. With no clock or randomness in the path, every coordinate must
		// match exactly — so the painted map cannot lurch when the client takes over.
		const server = layoutRelationGraph(NODES, EDGES, { ...SIZE });
		const client = layoutRelationGraph(NODES, EDGES, { ...SIZE });
		for (const [id, point] of server) {
			const c = client.get(id)!;
			expect(c.x).toBe(point.x);
			expect(c.y).toBe(point.y);
		}
	});
});

// --- Degenerate inputs ------------------------------------------------------

describe('layoutRelationGraph — degenerate inputs', () => {
	it('returns an empty map for no nodes', () => {
		expect(layoutRelationGraph([], [], { ...SIZE }).size).toBe(0);
	});

	it('centres a single node', () => {
		const pos = layoutRelationGraph([node('only')], [], { ...SIZE });
		expect(pos.get('only')).toEqual({ x: SIZE.width / 2, y: SIZE.height / 2 });
	});

	it('collapses duplicate ids to a single placed node', () => {
		const pos = layoutRelationGraph([node('dup'), node('dup'), node('other')], [], { ...SIZE });
		expect(pos.size).toBe(2);
		expect(pos.has('dup')).toBe(true);
		expect(pos.has('other')).toBe(true);
	});

	it('ignores edges referencing ids absent from the node set', () => {
		// An edge to a ghost id must not throw, nor invent a node.
		const pos = layoutRelationGraph([node('a'), node('b')], [twin('a', 'ghost')], { ...SIZE });
		expect(pos.size).toBe(2);
		expect(pos.has('ghost')).toBe(false);
	});

	it('skips blank / non-string ids without placing them', () => {
		const pos = layoutRelationGraph(
			[node('real'), node(''), { id: undefined } as unknown as GraphLayoutNode],
			[],
			{ ...SIZE }
		);
		expect(pos.size).toBe(1);
		expect(pos.has('real')).toBe(true);
	});
});
