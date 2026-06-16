import { describe, it, expect } from "vitest";
import {
  computeCentroid,
  computeCalibration,
  cosine,
  computeTwinEdges,
  TWIN_THRESHOLD,
  type EmbeddedItem,
  type RelationEdge,
} from "./relatedness";

/**
 * Build a small fixture in a tiny embedding space that mirrors the measured
 * structure of the real corpus:
 *
 *   - a strong shared common-mode `g` (the "all civic templates" genre), so raw
 *     cosine between any two items is high and near-uniform,
 *   - two items whose RESIDUAL (after the common-mode) points the same way —
 *     these are the real topical twins,
 *   - two items dominated by the common-mode whose residuals are OPPOSED — raw
 *     cosine links them, centered cosine must not.
 *
 * Each vector = G * g + (topical residual). G large ⇒ genre dominates raw cosine.
 */
const G = 10;
const g = [1, 0, 0, 0]; // common-mode (genre) direction

/** v = G*g + residual */
function withGenre(residual: number[]): number[] {
  return [G * g[0] + residual[0], G * g[1] + residual[1], G * g[2] + residual[2], G * g[3] + residual[3]];
}

function fixture(): EmbeddedItem[] {
  return [
    // Twin pair A — residuals aligned on axis 1.
    { id: "alpha", embedding: withGenre([0, 1, 0, 0]) },
    { id: "beta", embedding: withGenre([0, 1, 0, 0]) },
    // Genre-only pair — residuals OPPOSED on axis 2; raw cosine high, centered low.
    { id: "gamma", embedding: withGenre([0, 0, 1, 0]) },
    { id: "delta", embedding: withGenre([0, 0, -1, 0]) },
  ];
}

describe("computeCentroid", () => {
  it("returns the per-dimension mean", () => {
    expect(computeCentroid([[2, 0], [0, 4]])).toEqual([1, 2]);
  });

  it("returns an empty vector for empty input (no throw, no NaN)", () => {
    expect(computeCentroid([])).toEqual([]);
  });
});

describe("computeCalibration — persisted normalization", () => {
  it("fits the corpus centroid + carries the threshold, count, and dim", () => {
    const cal = computeCalibration(fixture());
    expect(cal).not.toBeNull();
    expect(cal!.threshold).toBe(TWIN_THRESHOLD);
    expect(cal!.count).toBe(4);
    expect(cal!.dim).toBe(4);
    // The stored centroid IS the centroid computeTwinEdges would compute inline
    // over the same corpus — the calibration and the edge gate are a matched set.
    expect(cal!.centroid).toEqual(
      computeCentroid(fixture().map((i) => i.embedding)),
    );
  });

  it("carries an explicitly supplied threshold (re-derivable cutoff)", () => {
    const cal = computeCalibration(fixture(), { threshold: 0.42 });
    expect(cal!.threshold).toBe(0.42);
  });

  it("returns null below two usable embeddings (tiny-N floor — skip the write)", () => {
    expect(computeCalibration([])).toBeNull();
    expect(computeCalibration([{ id: "only", embedding: [1, 2, 3] }])).toBeNull();
    // One usable + unusable items: still no common-mode to fit.
    expect(
      computeCalibration([
        { id: "only", embedding: [1, 2, 3] },
        { id: "empty", embedding: [] },
        { id: "missing", embedding: undefined as unknown as number[] },
      ]),
    ).toBeNull();
  });

  it("ignores unusable / wrong-dimension items, mirroring the edge filter", () => {
    const cal = computeCalibration([
      ...fixture(),
      { id: "empty", embedding: [] },
      { id: "wrongdim", embedding: [1, 2] },
    ]);
    expect(cal).not.toBeNull();
    // Only the 4 valid same-dimension items count.
    expect(cal!.count).toBe(4);
    expect(cal!.dim).toBe(4);
    expect(cal!.centroid).toEqual(
      computeCentroid(fixture().map((i) => i.embedding)),
    );
  });

  it("is deterministic and order-independent (no clock/random)", () => {
    const items = fixture();
    const a = computeCalibration(items);
    const b = computeCalibration([...items].reverse());
    expect(a).toEqual(b);
  });

  it("feeding the calibration back into the edge gate reproduces the inline edges", () => {
    const items = fixture();
    const cal = computeCalibration(items)!;
    const inline = computeTwinEdges(items);
    const persisted = computeTwinEdges(items, {
      centroid: cal.centroid,
      threshold: cal.threshold,
    });
    expect(persisted).toEqual(inline);
  });
});

/**
 * Calibration pin: the chosen TWIN_THRESHOLD against the MEASURED centered-cosine
 * structure of the live public corpus. These are the actual full-corpus centered
 * cosines (and worst leave-one-out views) measured over the published public
 * templates that carry a topic embedding — the genuine topical-kinship head and
 * the register-noise floor it must be separated from. The threshold has to sit in
 * the gap: every genuine twin clears it on both its full and worst-LOO view, and
 * the highest noise pair stays below it. If the threshold is ever retuned, these
 * are the numbers it must keep classifying correctly.
 */
describe("TWIN_THRESHOLD — calibration against measured corpus pairs", () => {
  // Genuine cross-template topical twins: { full-corpus centered cosine, worst
  // leave-one-out centered cosine } as measured over the real corpus.
  const GENUINE_TWINS = [
    { pair: "parks-lands ~ land-and-energy-revenue", full: 0.1981, worstLoo: 0.173 },
    { pair: "library ~ library", full: 0.1558, worstLoo: 0.1375 },
  ];
  // Register-noise pairs: topic drift, not kinship. Highest noise pair first.
  const NOISE_PAIRS = [
    { pair: "bike-share ~ parks-lands", full: 0.1169 },
    { pair: "treatment-not-prison ~ affordable-homes", full: 0.1062 },
    { pair: "children-privacy ~ preschool", full: 0.1119 },
  ];

  it("sits in the gap between genuine twins and the register-noise floor", () => {
    const lowestGenuine = Math.min(...GENUINE_TWINS.map((t) => t.full));
    const highestNoise = Math.max(...NOISE_PAIRS.map((p) => p.full));
    // The threshold lives strictly between the two regimes.
    expect(highestNoise).toBeLessThan(TWIN_THRESHOLD);
    expect(TWIN_THRESHOLD).toBeLessThan(lowestGenuine);
  });

  it("clears every genuine twin on BOTH its full and worst-LOO view", () => {
    for (const t of GENUINE_TWINS) {
      // Gate 1 (full centroid) and Gate 2 (every LOO centroid, worst shown) both pass.
      expect(t.full).toBeGreaterThanOrEqual(TWIN_THRESHOLD);
      expect(t.worstLoo).toBeGreaterThanOrEqual(TWIN_THRESHOLD);
    }
  });

  it("rejects every register-noise pair at Gate 1", () => {
    for (const p of NOISE_PAIRS) {
      expect(p.full).toBeLessThan(TWIN_THRESHOLD);
    }
  });
});

describe("computeTwinEdges — honesty invariants", () => {
  it("links the aligned-residual pair but NOT the genre-only pair (centered, not raw)", () => {
    const items = fixture();

    // Sanity: in RAW space the genre-only pair looks just as similar as the twins.
    const rawTwin = cosine(items[0].embedding, items[1].embedding);
    const rawGenre = cosine(items[2].embedding, items[3].embedding);
    expect(rawGenre).toBeGreaterThan(0.9);
    expect(rawTwin).toBeGreaterThan(0.9);

    const edges = computeTwinEdges(items);
    const pairs = edges.map((e) => `${e.a}|${e.b}`);

    // The real topical twins are linked.
    expect(pairs).toContain("alpha|beta");
    // The genre-only (common-mode) pair is NOT — removing the common-mode kills it.
    expect(pairs).not.toContain("delta|gamma");
    expect(pairs).not.toContain("gamma|delta");
  });

  it("drops a pair whose relation depends on one other template (leave-one-out fragile)", () => {
    // This pair clears the FULL-corpus centroid, but its centered cosine
    // collapses when one particular neutral item is left out of the centroid —
    // the relation is an artifact of that third item's presence, not a real
    // topical twin. The leave-one-out gate must reject it.
    const items: EmbeddedItem[] = [
      { id: "p1", embedding: [2, -2, 3] },
      { id: "p2", embedding: [4, 0, 3] },
      { id: "n1", embedding: [3, 1, 2] },
      { id: "n2", embedding: [-5, -3, -2] },
      { id: "n3", embedding: [2, -5, 3] },
      { id: "n4", embedding: [3, -3, 3] },
    ];

    // Confirm the trap: the pair clears under the full centroid...
    const center = (v: number[], c: number[]) => v.map((x, k) => x - c[k]);
    const fullCentroid = computeCentroid(items.map((i) => i.embedding));
    const fullScore = cosine(
      center(items[0].embedding, fullCentroid),
      center(items[1].embedding, fullCentroid),
    );
    expect(fullScore).toBeGreaterThanOrEqual(TWIN_THRESHOLD);

    // ...but leaving out at least one of the other items drops it below threshold.
    const others = items.slice(2).map((i) => i.id);
    const looScores = others.map((dropId) => {
      const looCentroid = computeCentroid(
        items.filter((i) => i.id !== dropId).map((i) => i.embedding),
      );
      return cosine(
        center(items[0].embedding, looCentroid),
        center(items[1].embedding, looCentroid),
      );
    });
    expect(Math.min(...looScores)).toBeLessThan(TWIN_THRESHOLD);

    // So the gate rejects it: not in the emitted set.
    const edges = computeTwinEdges(items);
    expect(edges.map((e) => `${e.a}|${e.b}`)).not.toContain("p1|p2");
  });

  it("returns edge tuples ONLY — no vector-shaped field leaks", () => {
    const edges = computeTwinEdges(fixture());
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(new Set(Object.keys(e))).toEqual(new Set(["a", "b", "score", "kind"]));
      expect(typeof e.a).toBe("string");
      expect(typeof e.b).toBe("string");
      expect(typeof e.score).toBe("number");
      expect(e.kind).toBe("twin");
      // No property may be an array (an embedding or residual).
      for (const val of Object.values(e as unknown as Record<string, unknown>)) {
        expect(Array.isArray(val)).toBe(false);
      }
    }
  });
});

describe("computeTwinEdges — robustness", () => {
  it("templates without an embedding produce no twin edges and do not throw", () => {
    const items = fixture();
    const withMissing: EmbeddedItem[] = [
      ...items,
      { id: "noembed", embedding: [] },
      { id: "missing", embedding: undefined as unknown as number[] },
    ];
    let edges: RelationEdge[] = [];
    expect(() => {
      edges = computeTwinEdges(withMissing);
    }).not.toThrow();
    const ids = new Set(edges.flatMap((e) => [e.a, e.b]));
    expect(ids.has("noembed")).toBe(false);
    expect(ids.has("missing")).toBe(false);
    // The valid twins are still found despite the unusable items.
    expect(edges.map((e) => `${e.a}|${e.b}`)).toContain("alpha|beta");
  });

  it("returns no edges with fewer than two usable embeddings", () => {
    expect(computeTwinEdges([])).toEqual([]);
    expect(computeTwinEdges([{ id: "only", embedding: [1, 2, 3] }])).toEqual([]);
  });

  it("ignores items whose embedding length differs from the corpus dimension", () => {
    const items: EmbeddedItem[] = [
      { id: "alpha", embedding: withGenre([0, 1, 0, 0]) },
      { id: "beta", embedding: withGenre([0, 1, 0, 0]) },
      { id: "wrongdim", embedding: [1, 2] },
    ];
    const edges = computeTwinEdges(items);
    const ids = new Set(edges.flatMap((e) => [e.a, e.b]));
    expect(ids.has("wrongdim")).toBe(false);
  });

  it("is deterministic and order-independent in its endpoints (no clock/random)", () => {
    const items = fixture();
    const a = computeTwinEdges(items);
    const b = computeTwinEdges([...items].reverse());
    // Same edge set regardless of input order; endpoints stably ordered (a < b).
    expect(a).toEqual(b);
    for (const e of a) expect(e.a < e.b).toBe(true);
  });
});
