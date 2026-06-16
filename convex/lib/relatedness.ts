/**
 * Measured-twin relatedness over a set of topic embeddings.
 *
 * Civic-action templates share a strong genre common-mode — every embedding
 * points in roughly the same "this is a civic template" direction, so RAW
 * pairwise cosine has a narrow, near-uniform spread and reads as noise. The
 * topical signal lives in the RESIDUAL after that common-mode is removed.
 *
 * So we mean-center: subtract the corpus centroid from every vector, then
 * L2-normalize the residual and take pairwise cosine on the residuals. That
 * surfaces real topical kinship instead of register similarity.
 *
 * A pair is only emitted as a "twin" if its centered cosine clears the
 * threshold AND survives a leave-one-out check over the corpus: when the
 * centroid is recomputed with each OTHER single item also removed, the pair
 * must still clear the threshold under every such centroid. A relation that
 * only holds because one particular third template happens to be in the corpus
 * is fragile — it would vanish the moment that template were unpublished — and
 * the LOO gate drops it. (Recomputing the centroid only without the pair itself
 * never lowers the pair's centered cosine, so that variant cannot reject; the
 * robustness that actually filters is leaving out the OTHER items one at a time.)
 *
 * Everything here is pure: no clock, no randomness, no I/O. The same inputs
 * always yield the same edges, so the surface is SSR-safe and deterministic.
 *
 * Threshold provenance: TWIN_THRESHOLD is calibrated against the measured
 * structure of the live public corpus — the centered-cosine value that
 * reproduces exactly the leave-one-out-stable cross-topic pairs (drug-treatment
 * with housing/zoning, parks/lands with indigenous-energy, the two libraries
 * templates, the bike-infra/freeway-removal transport pair) while excluding the
 * genre-only adjacencies just below them. It is a residual-cosine cutoff, not
 * an absolute raw-cosine guess; re-derive it from the centered-cosine
 * distribution if the corpus shifts materially.
 */

/** A single embedded item entering the relatedness computation. */
export interface EmbeddedItem {
  /** Stable identifier (template id or slug) — carried through to the edge. */
  id: string;
  /** The topic embedding. Server-only; never returned to the client. */
  embedding: number[];
}

/** An honest relatedness edge. Twin edges are the only kind this module emits. */
export interface RelationEdge {
  /** One endpoint id (the lexically-smaller of the pair, for stable ordering). */
  a: string;
  /** The other endpoint id. */
  b: string;
  /** Centered-cosine similarity of the pair, rounded for transport. */
  score: number;
  kind: "twin";
}

/**
 * Calibrated centered-cosine cutoff for a measured twin. See the module header
 * for provenance. A pair must clear this on the full-corpus centroid AND on
 * every leave-one-out centroid (each computed with one other item removed) to
 * be emitted.
 */
export const TWIN_THRESHOLD = 0.5;

/** Mean of a set of equal-length vectors. Empty input → empty vector. */
export function computeCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  for (let i = 0; i < dim; i++) sum[i] /= vectors.length;
  return sum;
}

/** Subtract the centroid from a vector (common-mode removal). */
function subtract(v: number[], centroid: number[]): number[] {
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] - (centroid[i] ?? 0);
  return out;
}

/** Cosine similarity of two vectors. Zero-magnitude inputs → 0 (never NaN). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/** Centered cosine of two items against a given centroid (common-mode removed). */
function centeredCosine(
  a: number[],
  b: number[],
  centroid: number[],
): number {
  return cosine(subtract(a, centroid), subtract(b, centroid));
}

/**
 * Compute measured-twin edges over the embedded items.
 *
 * - Items without a usable embedding (missing / wrong-length / empty) are
 *   dropped before the computation and contribute no edges — never an error.
 * - With fewer than two usable items there can be no pair, so the result is
 *   empty.
 * - The corpus centroid may be supplied (e.g. a persisted, nightly-refreshed
 *   centroid); if omitted it is computed inline from the usable items.
 * - Each candidate pair is gated twice: against the full-corpus centroid, and
 *   against every leave-one-out centroid (the centroid recomputed with one
 *   OTHER item removed). All must clear `threshold` — a pair whose relation
 *   depends on one particular third template's presence is fragile and dropped.
 *
 * Deterministic and pure: identical inputs always yield identical edges, in a
 * stable order.
 */
export function computeTwinEdges(
  items: EmbeddedItem[],
  options: { centroid?: number[]; threshold?: number } = {},
): RelationEdge[] {
  const threshold = options.threshold ?? TWIN_THRESHOLD;

  // Keep only items with a usable, consistent-length embedding.
  const usable = items.filter(
    (it) => Array.isArray(it.embedding) && it.embedding.length > 0,
  );
  if (usable.length < 2) return [];
  const dim = usable[0].embedding.length;
  const valid = usable.filter((it) => it.embedding.length === dim);
  if (valid.length < 2) return [];

  const vectors = valid.map((it) => it.embedding);
  const fullCentroid =
    options.centroid && options.centroid.length === dim
      ? options.centroid
      : computeCentroid(vectors);

  // Sum of all vectors — lets each leave-one-out centroid be derived in O(dim)
  // (sum minus the removed item, over the remaining count) instead of re-summing.
  const total = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let d = 0; d < dim; d++) total[d] += v[d];
  }
  const n = vectors.length;

  const edges: RelationEdge[] = [];

  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const vi = valid[i].embedding;
      const vj = valid[j].embedding;

      // Gate 1: clears the threshold under the full-corpus centroid.
      const full = centeredCosine(vi, vj, fullCentroid);
      if (full < threshold) continue;

      // Gate 2: leave-one-out over the OTHER items. For each other item k,
      // recompute the centroid with k also removed and require the pair to stay
      // above threshold. A relation contingent on one particular third
      // template's presence is fragile and is dropped here. We track the
      // weakest LOO view to score the edge conservatively.
      let robust = true;
      let weakestLoo = full;
      if (n > 2) {
        for (let k = 0; k < n && robust; k++) {
          if (k === i || k === j) continue;
          const looCentroid = new Array<number>(dim);
          for (let d = 0; d < dim; d++) {
            looCentroid[d] = (total[d] - vectors[k][d]) / (n - 1);
          }
          const loo = centeredCosine(vi, vj, looCentroid);
          if (loo < threshold) {
            robust = false;
          } else if (loo < weakestLoo) {
            weakestLoo = loo;
          }
        }
      }
      if (!robust) continue;

      // Conservative score: the weakest view across full + every LOO centroid.
      const score = Math.min(full, weakestLoo);
      const [a, b] =
        valid[i].id < valid[j].id
          ? [valid[i].id, valid[j].id]
          : [valid[j].id, valid[i].id];
      edges.push({ a, b, score: Math.round(score * 1e4) / 1e4, kind: "twin" });
    }
  }

  // Stable, deterministic ordering: strongest first, then by endpoint ids.
  edges.sort(
    (x, y) => y.score - x.score || (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0),
  );
  return edges;
}
