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
 * Threshold provenance: TWIN_THRESHOLD is a residual (centered) cosine cutoff
 * derived from the measured pairwise distribution of the live public corpus, not
 * an absolute raw-cosine guess. Over that corpus the centered cosines separate
 * into two regimes with a clear gap: a short head of genuine cross-template
 * topical kinship — parks/public-lands stewardship with land-and-energy revenue
 * (~0.198) and the two public-library templates (~0.156) — and a noise floor at
 * and below ~0.117 (e.g. a bike-share template incidentally adjacent to the
 * parks template, a treatment-vs-prison template adjacent to an affordable-homes
 * one) that reads as topic drift, not kinship. The cutoff sits in that gap so
 * the head is emitted and the floor is not. Re-derive it from the centered-cosine
 * distribution if the corpus shifts materially: find the gap, put the cutoff in
 * it, and re-confirm the leave-one-out gate still drops fragility-dependent pairs.
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
 * for provenance: it sits in the gap between the corpus's genuine topical-kinship
 * head (lowest genuine pair ~0.156) and its register-noise floor (~0.117). A pair
 * must clear this on the full-corpus centroid AND on every leave-one-out centroid
 * (each computed with one other item removed) to be emitted.
 */
export const TWIN_THRESHOLD = 0.13;

/**
 * The persisted relatedness normalization: the corpus centroid (the genre
 * common-mode that mean-centering removes) plus the calibrated twin threshold
 * that travels with it. A scheduled job recomputes this from the live public
 * corpus so the normalization tracks the corpus as it grows, and the edge query
 * reads it instead of recomputing the centroid on every call.
 *
 * `threshold` is carried alongside the centroid so the two stay a matched set:
 * the edge gate that ran when this centroid was fit can be reproduced exactly,
 * and a future re-derivation of the cutoff from the centered-cosine
 * distribution can overwrite both together.
 */
export interface RelatednessCalibration {
  /** Corpus centroid — the common-mode subtracted before scoring. */
  centroid: number[];
  /** Calibrated centered-cosine cutoff in force when this centroid was fit. */
  threshold: number;
  /** Number of usable (embedded) templates the centroid was fit over. */
  count: number;
  /** Embedding dimensionality the centroid was fit in. */
  dim: number;
}

/**
 * Fit the relatedness normalization over a set of embedded items.
 *
 * Returns the corpus centroid + the calibrated threshold (a matched set the
 * edge query consumes), or `null` when the corpus is too thin to normalize
 * against. Mean-centering is meaningless below two usable embeddings — there is
 * no spread to remove a common-mode from — so the caller (the recompute job)
 * skips the write and keeps whatever prior calibration exists rather than
 * overwriting it with nonsense at empty/one-template N.
 *
 * Pure: no clock, no randomness, no I/O. Mirrors the same usable-item filter as
 * `computeTwinEdges`, so the centroid this fits is exactly the centroid that
 * function would compute inline over the same corpus.
 */
export function computeCalibration(
  items: EmbeddedItem[],
  options: { threshold?: number } = {},
): RelatednessCalibration | null {
  const usable = items.filter(
    (it) => Array.isArray(it.embedding) && it.embedding.length > 0,
  );
  if (usable.length < 2) return null;
  const dim = usable[0].embedding.length;
  const valid = usable.filter((it) => it.embedding.length === dim);
  if (valid.length < 2) return null;

  return {
    centroid: computeCentroid(valid.map((it) => it.embedding)),
    threshold: options.threshold ?? TWIN_THRESHOLD,
    count: valid.length,
    dim,
  };
}

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
