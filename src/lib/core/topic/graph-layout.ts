/**
 * Relation-graph layout — a deterministic, SSR-safe force + declump engine.
 *
 * Places the relatedness graph's nodes in a 2-D field so that:
 *   - templates joined by an edge (measured twin or civic-family kin) settle
 *     near each other — the connected clusters read as the structure;
 *   - templates with NO admissible edge sit honestly alone at the periphery,
 *     never dragged inward to look less lonely (R4);
 *   - connected clusters never overlap — a declump pass enforces a minimum
 *     centre-to-centre separation so two families don't pile on one spot.
 *
 * This is our own layout, ported from the approved mock — no d3, no foreign
 * force/graph library (R8). Two stages, matching the mock:
 *
 *   1. Fruchterman–Reingold: every pair repels (k²/d); every edge attracts
 *      (d²/k, scaled by the relation's pull weight — a measured twin pulls
 *      harder than taxonomic kin); a cooling schedule freezes the field over a
 *      bounded iteration count.
 *   2. Screen-space declump: a bounded relaxation that pushes any two nodes
 *      closer than `minSeparation` apart, then clamps every node inside the
 *      canvas. Connected nodes have already been pulled together in stage 1, so
 *      this only resolves overlaps — it does not tear clusters apart.
 *
 * DETERMINISM is load-bearing (R9): the surface renders on the server and again
 * on the client and the two MUST agree to the pixel, or the graph lurches on
 * hydration. So this module reads no wall-clock, no randomness and no browser
 * globals — every value is a pure function of its inputs. The initial layout is
 * seeded from a pure hash of each node's id (folded with the `seed` option),
 * which also makes the result independent of input ORDER — shuffling the node
 * array yields the identical positions. Same `(nodeIds, edgeKey, size, seed)` ⇒
 * byte-identical `Map`, so the caller can memoize on those keys.
 *
 * Pull weights (twin > family) reproduce the mock's edge stiffness; the FR
 * constants (repulsion gain, cooling) are the mock's, tuned there against the
 * live seed so the four measured twin-pairs cluster while the loners drift out.
 */

/** A node to lay out. Only the stable `id` is required; `hue` rides along for
 *  the renderer but does not affect geometry. The layout reads `id` alone. */
export interface GraphLayoutNode {
	/** Stable template id — the seed for this node's deterministic placement. */
	id: string;
}

/** An undirected relation between two node ids. Mirrors `RelationEdge` (the
 *  shipped edge tuple) without importing it, so the layout has no opinion on
 *  where edges come from — it lays out whatever honest edge set it is given. */
export interface GraphLayoutEdge {
	/** One endpoint id. */
	a: string;
	/** The other endpoint id. */
	b: string;
	/** The relation kind. A measured twin pulls harder than taxonomic kin. */
	kind: 'twin' | 'family';
}

/** Options. `width`/`height` are the canvas the positions fall inside; `seed`
 *  folds into the per-node hash so a caller can re-roll the arrangement without
 *  touching the data (still fully deterministic per seed). */
export interface GraphLayoutOptions {
	width: number;
	height: number;
	/** Folded into each node's placement hash. Default 0. */
	seed?: number;
	/** Minimum centre-to-centre separation the declump pass enforces, in px.
	 *  Defaults to a spacing that keeps a labelled node from colliding. */
	minSeparation?: number;
}

/** A laid-out position. */
export interface Point {
	x: number;
	y: number;
}

// --- Tunable constants (the mock's, kept together and named) ----------------

/** Force-layout iterations. Bounded so the function always terminates (R9). */
const FORCE_ITERATIONS = 400;
/** Declump relaxation iterations; exits early once nothing moves. */
const DECLUMP_ITERATIONS = 300;
/** Ideal edge length in the unit (pre-scale) field; the FR `k`. */
const IDEAL_DISTANCE = 1.4;
/** Repulsion gain — the mock's 1.3× over the bare k²/d. */
const REPULSION_GAIN = 1.3;
/** Pull weight per relation kind. Measured twins pull harder than kin (mock). */
const TWIN_PULL = 1.4;
const FAMILY_PULL = 0.7;
/** Cooling schedule: temperature falls linearly from PEAK to FLOOR over the run. */
const TEMP_PEAK = 0.09;
const TEMP_FLOOR = 0.004;
/** Inset from the canvas edge the laid-out field is scaled into. */
const PADDING = 150;
/** Default declump minimum separation (px) — the mock's MIN. */
const DEFAULT_MIN_SEPARATION = 132;
/** Guard against divide-by-zero when two nodes coincide. */
const EPSILON = 1e-3;

// --- Deterministic seeded init ---------------------------------------------

/**
 * A pure 32-bit string hash (djb2 variant, the same idiom as `topic-hue`).
 * Deterministic and SSR-safe — no globals, no clock. Used to derive a stable
 * starting angle/radius per node, so the layout never reaches for randomness.
 */
function hashString(value: string): number {
	let hash = 5381;
	for (let i = 0; i < value.length; i++) {
		hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
	}
	return hash >>> 0; // unsigned
}

/** Map a hash to the unit interval [0, 1). */
function unit(hash: number): number {
	return (hash % 100000) / 100000;
}

// --- The layout -------------------------------------------------------------

/**
 * Lay out the relation graph deterministically.
 *
 * @param nodes - the nodes to place (read by stable `id`)
 * @param edges - the honest relations between them (twin = solid, family = dashed)
 * @param opts  - canvas size, optional seed + min separation
 * @returns a `Map` from node id to its `{x, y}` inside `[0, width] × [0, height]`
 *
 * Determinism contract: same `(nodes-by-id, edges, width, height, seed)` ⇒
 * byte-identical map, regardless of the order `nodes`/`edges` are passed in.
 */
export function layoutRelationGraph(
	nodes: GraphLayoutNode[],
	edges: GraphLayoutEdge[],
	opts: GraphLayoutOptions
): Map<string, Point> {
	const { width, height } = opts;
	const seed = opts.seed ?? 0;
	const minSeparation = opts.minSeparation ?? DEFAULT_MIN_SEPARATION;

	// Dedupe + order-independence: collapse to a stable, id-sorted node list so
	// the geometry depends only on WHICH ids are present, not their array order.
	const byId = new Map<string, GraphLayoutNode>();
	for (const node of nodes) {
		if (typeof node?.id === 'string' && node.id.length > 0 && !byId.has(node.id)) {
			byId.set(node.id, node);
		}
	}
	const ids = Array.from(byId.keys()).sort((x, y) => x.localeCompare(y));
	const n = ids.length;
	const result = new Map<string, Point>();
	if (n === 0) return result;

	const index = new Map<string, number>();
	for (let i = 0; i < n; i++) index.set(ids[i], i);

	// Which nodes carry at least one admissible edge. Edges referencing an id
	// not in the node set are ignored (the layout lays out the nodes it is given).
	const connected = new Array<boolean>(n).fill(false);
	// Normalised, deduped edges as (lo, hi, weight) index triples — endpoints
	// ordered lo<hi, sorted into a canonical order below (see the sort comment).
	const weightByPair = new Map<string, { lo: number; hi: number; w: number }>();
	for (const edge of edges) {
		const ai = index.get(edge.a);
		const bi = index.get(edge.b);
		if (ai === undefined || bi === undefined || ai === bi) continue;
		const lo = Math.min(ai, bi);
		const hi = Math.max(ai, bi);
		const key = `${lo}-${hi}`;
		const w = edge.kind === 'twin' ? TWIN_PULL : FAMILY_PULL;
		const existing = weightByPair.get(key);
		// If both a twin and a family edge join the same pair, keep the stronger
		// pull (the measured relation dominates) — order-independent by max.
		if (!existing || w > existing.w) weightByPair.set(key, { lo, hi, w });
		connected[lo] = true;
		connected[hi] = true;
	}
	// Sort into a CANONICAL (lo, hi) order so the force accumulation visits edges
	// in the same sequence no matter how the caller ordered or oriented them.
	// Float addition is not associative, so a fixed visitation order is what makes
	// the result byte-identical across SSR and client (R9 parity).
	const triples = Array.from(weightByPair.values()).sort((p, q) =>
		p.lo === q.lo ? p.hi - q.hi : p.lo - q.lo
	);
	const linkA = triples.map((t) => t.lo);
	const linkB = triples.map((t) => t.hi);
	const linkW = triples.map((t) => t.w);

	// Single node: centre it (no relations to lay out against).
	if (n === 1) {
		result.set(ids[0], { x: width / 2, y: height / 2 });
		return result;
	}

	// --- Seeded deterministic init ----------------------------------------
	// Connected nodes start on an inner ring, isolated nodes on an OUTER ring —
	// a structural head start toward the periphery so a no-kin template reads as
	// honestly alone (R4) rather than relying on repulsion alone to expel it.
	// Angle + a small radial jitter come from a pure hash of (id, seed), so the
	// arrangement is reproducible and order-independent, with no two nodes
	// landing exactly on top of each other.
	const pos: Array<[number, number]> = new Array(n);
	for (let i = 0; i < n; i++) {
		const h = hashString(`${ids[i]}#${seed}`);
		const angle = unit(h) * Math.PI * 2;
		// A second hash decorrelates the radial jitter from the angle.
		const jitter = unit(hashString(`${ids[i]}~${seed}`)) * 0.25;
		const baseRadius = connected[i] ? 0.55 : 1.15;
		const radius = baseRadius + jitter;
		pos[i] = [Math.cos(angle) * radius, Math.sin(angle) * radius];
	}

	// --- Stage 1: Fruchterman–Reingold ------------------------------------
	const k = IDEAL_DISTANCE;
	for (let it = 0; it < FORCE_ITERATIONS; it++) {
		const disp: Array<[number, number]> = new Array(n);
		for (let i = 0; i < n; i++) disp[i] = [0, 0];

		// Repulsion between every pair.
		for (let i = 0; i < n; i++) {
			for (let j = 0; j < n; j++) {
				if (i === j) continue;
				const dx = pos[i][0] - pos[j][0];
				const dy = pos[i][1] - pos[j][1];
				const d = Math.hypot(dx, dy) || EPSILON;
				const force = ((k * k) / d) * REPULSION_GAIN;
				disp[i][0] += (dx / d) * force;
				disp[i][1] += (dy / d) * force;
			}
		}

		// Attraction along edges (pull weight by relation kind).
		for (let e = 0; e < linkA.length; e++) {
			const a = linkA[e];
			const b = linkB[e];
			const dx = pos[a][0] - pos[b][0];
			const dy = pos[a][1] - pos[b][1];
			const d = Math.hypot(dx, dy) || EPSILON;
			const force = ((d * d) / k) * linkW[e];
			disp[a][0] -= (dx / d) * force;
			disp[a][1] -= (dy / d) * force;
			disp[b][0] += (dx / d) * force;
			disp[b][1] += (dy / d) * force;
		}

		// Cool: bound each node's step by the falling temperature.
		const temp = TEMP_PEAK * (1 - it / FORCE_ITERATIONS) + TEMP_FLOOR;
		for (let i = 0; i < n; i++) {
			const len = Math.hypot(disp[i][0], disp[i][1]) || EPSILON;
			const step = Math.min(len, temp);
			pos[i][0] += (disp[i][0] / len) * step;
			pos[i][1] += (disp[i][1] / len) * step;
		}
	}

	// --- Scale the unit field into the padded canvas ----------------------
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (let i = 0; i < n; i++) {
		if (pos[i][0] < minX) minX = pos[i][0];
		if (pos[i][0] > maxX) maxX = pos[i][0];
		if (pos[i][1] < minY) minY = pos[i][1];
		if (pos[i][1] > maxY) maxY = pos[i][1];
	}
	const spanX = maxX - minX + 1e-9;
	const spanY = maxY - minY + 1e-9;
	const usableW = width - 2 * PADDING;
	const usableH = height - 2 * PADDING;
	const screen: Array<[number, number]> = new Array(n);
	for (let i = 0; i < n; i++) {
		screen[i] = [
			PADDING + ((pos[i][0] - minX) / spanX) * usableW,
			PADDING + ((pos[i][1] - minY) / spanY) * usableH
		];
	}

	// --- Stage 2: declump (enforce min separation, then clamp) ------------
	// Isolated nodes are allowed to ride a little past the inner padding band
	// toward the true edge, so they read as peripheral; connected nodes stay
	// within the inner field. The clamp keeps everyone on-canvas (R-risk).
	const loEdgeX = PADDING - 40;
	const hiEdgeX = width - PADDING + 40;
	const loEdgeY = PADDING - 30;
	const hiEdgeY = height - PADDING + 30;
	for (let pass = 0; pass < DECLUMP_ITERATIONS; pass++) {
		let moved = false;
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				const dx = screen[i][0] - screen[j][0];
				const dy = screen[i][1] - screen[j][1];
				const d = Math.hypot(dx, dy) || EPSILON;
				if (d < minSeparation) {
					const push = (minSeparation - d) / 2;
					const ux = dx / d;
					const uy = dy / d;
					screen[i][0] += ux * push;
					screen[i][1] += uy * push;
					screen[j][0] -= ux * push;
					screen[j][1] -= uy * push;
					moved = true;
				}
			}
		}
		// Clamp into the (slightly extended) canvas every pass so the push above
		// never walks a node off-screen.
		for (let i = 0; i < n; i++) {
			screen[i][0] = Math.min(hiEdgeX, Math.max(loEdgeX, screen[i][0]));
			screen[i][1] = Math.min(hiEdgeY, Math.max(loEdgeY, screen[i][1]));
		}
		if (!moved) break;
	}

	// --- Seat edge-free nodes on the rim ----------------------------------
	// The outer-ring seed gives isolates a head start, but FR repulsion from the
	// dense connected core, the scale-to-bounds normalization, and the declump
	// above can all pull a loner back in among the connected nodes — so live, the
	// no-kin templates read as intermixed, not "at the edges". This deterministic
	// final step seats each edge-free node out on the rim, after declump (so the
	// declump's tighter interior band can't cap it) and before the on-canvas clamp
	// below (which keeps it in bounds).
	//
	// The loners are handed EVENLY-SPREAD rim bearings rather than pushed along
	// wherever FR left them: sort by id (order-independent, deterministic), fan
	// them around the circle, and fold a per-id-set hash into the fan's phase so
	// the bearing is data-driven, not a fixed compass rose. With three loners that
	// is ≥120° apart at the rim — hundreds of px — so they never collide with each
	// other, and the connected core sits well inside the rim, so they clear it
	// too. The connected nodes are left exactly where declump settled them.
	const cx = width / 2;
	const cy = height / 2;
	const halfW = width / 2;
	const halfH = height / 2;
	// The rim, in AXIS-NORMALIZED (elliptical) space so a bearing toward the short
	// axis seats just as peripherally as one toward the long axis — on a wide
	// canvas a loner fanned to the top still reads as "at the edge", not stranded
	// mid-field. A small inset under 1.0 keeps the glyph + its label on-canvas
	// rather than clipped at the very edge by the hard clamp.
	const RIM_FRACTION = 0.9;
	const ellipseFraction = (x: number, y: number) =>
		Math.hypot((x - cx) / halfW, (y - cy) / halfH);
	const isolateIds = ids.filter((_, i) => !connected[i]).sort((x, y) => x.localeCompare(y));
	const isolateCount = isolateIds.length;
	if (isolateCount > 0) {
		const phase = unit(hashString(`${isolateIds.join('|')}@rim#${seed}`)) * Math.PI * 2;
		for (let k = 0; k < isolateCount; k++) {
			const i = index.get(isolateIds[k]);
			if (i === undefined) continue;
			const angle = phase + (k / isolateCount) * Math.PI * 2;
			const targetX = cx + Math.cos(angle) * RIM_FRACTION * halfW;
			const targetY = cy + Math.sin(angle) * RIM_FRACTION * halfH;
			// Only ever seat a loner FURTHER out (in ellipse space) than it already
			// sits — never drag one the force pass already expelled past the rim
			// back inward.
			if (ellipseFraction(targetX, targetY) > ellipseFraction(screen[i][0], screen[i][1])) {
				screen[i][0] = targetX;
				screen[i][1] = targetY;
			}
		}

		// A rim seat can land a loner within the minimum separation of a node the
		// first declump already settled (e.g. one clamped against an edge). Run the
		// SAME separation relaxation once more so the no-overlap invariant still
		// holds after seating. The seat gave every loner a strong outward start, so
		// at the default spacing this only nudges, leaving the rim read intact; a
		// caller that asks for a separation too large for the rim to hold sees the
		// loners relax inward just enough to honour it — overlap-freedom wins.
		for (let pass = 0; pass < DECLUMP_ITERATIONS; pass++) {
			let moved = false;
			for (let i = 0; i < n; i++) {
				for (let j = i + 1; j < n; j++) {
					const dx = screen[i][0] - screen[j][0];
					const dy = screen[i][1] - screen[j][1];
					const d = Math.hypot(dx, dy) || EPSILON;
					if (d < minSeparation) {
						const push = (minSeparation - d) / 2;
						const ux = dx / d;
						const uy = dy / d;
						screen[i][0] += ux * push;
						screen[i][1] += uy * push;
						screen[j][0] -= ux * push;
						screen[j][1] -= uy * push;
						moved = true;
					}
				}
			}
			// Clamp into the FULL canvas (not the tighter interior band the first
			// declump used) so the rim seating is preserved — a loner fanned toward
			// the short axis stays out near the true edge instead of being re-capped
			// into the interior. The final hard clamp below is into these same bounds.
			for (let i = 0; i < n; i++) {
				screen[i][0] = Math.min(width, Math.max(0, screen[i][0]));
				screen[i][1] = Math.min(height, Math.max(0, screen[i][1]));
			}
			if (!moved) break;
		}
	}

	// Final hard clamp into the real bounds [0, width] × [0, height] so a caller
	// can trust every position is on-canvas regardless of declump residue.
	for (let i = 0; i < n; i++) {
		const x = Math.min(width, Math.max(0, screen[i][0]));
		const y = Math.min(height, Math.max(0, screen[i][1]));
		result.set(ids[i], { x, y });
	}
	return result;
}
