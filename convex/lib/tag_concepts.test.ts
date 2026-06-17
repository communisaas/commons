import { describe, it, expect } from "vitest";
import {
  cosine,
  clusterTagConcepts,
  tagConceptMap,
  conceptEdges,
  CONCEPT_THRESHOLD,
  type EmbeddedTag,
  type TaggedTemplate,
} from "./tag_concepts";

/**
 * A tiny embedding space mirroring the measured structure of the real tag
 * corpus: every tag carries a strong shared common-mode `g` (the "civic-policy
 * term" genre), so RAW cosine between any two tags is high and near-uniform. The
 * topical signal lives in the residual after `g` is removed.
 *
 *   - Two synonyms ("libraries" / "library-card") have residuals pointing the
 *     SAME way — real synonyms that must fold into one concept.
 *   - Two genre-only tags have residuals that are OPPOSED — raw cosine links
 *     them (the common-mode dominates), centered cosine must not: no concept, no
 *     edge. This is the register-noise gate.
 */
const G = 10;

/** v = G*g + residual, with g = axis 0. */
function withGenre(residual: [number, number, number]): number[] {
  return [G + residual[0], residual[1], residual[2]];
}

/** Synonyms: residuals aligned on axis 1. Distinct vectors, same direction. */
const SYN_A: EmbeddedTag = { tag: "libraries", embedding: withGenre([0, 2, 0]) };
const SYN_B: EmbeddedTag = { tag: "library-card", embedding: withGenre([0, 1, 0]) };

/** Genre-only pair: residuals OPPOSED on axis 2 — register noise, not a concept. */
const NOISE_A: EmbeddedTag = { tag: "rural-access", embedding: withGenre([0, 0, 1]) };
const NOISE_B: EmbeddedTag = { tag: "ceo-pay-ratio", embedding: withGenre([0, 0, -1]) };

function tagFixture(): EmbeddedTag[] {
  return [SYN_A, SYN_B, NOISE_A, NOISE_B];
}

describe("clusterTagConcepts — centered synonym folding", () => {
  it("folds synonyms whose residuals align, NOT genre-only tags (centered, not raw)", () => {
    const tags = tagFixture();

    // Sanity: in RAW space the genre-only pair looks just as similar as synonyms.
    expect(cosine(NOISE_A.embedding, NOISE_B.embedding)).toBeGreaterThan(0.9);
    expect(cosine(SYN_A.embedding, SYN_B.embedding)).toBeGreaterThan(0.9);

    const concepts = clusterTagConcepts(tags);

    // Exactly one folded concept: the two synonyms.
    expect(concepts).toHaveLength(1);
    expect(concepts[0].tags).toEqual(["libraries", "library-card"]);
    // Canonical label = lexically-smallest member.
    expect(concepts[0].concept).toBe("libraries");

    // The genre-only tags fold into NOTHING — they are register noise after
    // the common-mode is removed, so neither appears in any concept.
    const folded = new Set(concepts.flatMap((c) => c.tags));
    expect(folded.has("rural-access")).toBe(false);
    expect(folded.has("ceo-pay-ratio")).toBe(false);
  });

  it("emits no concepts below two usable tags (nothing to fold)", () => {
    expect(clusterTagConcepts([])).toEqual([]);
    expect(clusterTagConcepts([SYN_A])).toEqual([]);
    // One usable + unusable: still nothing to relate.
    expect(
      clusterTagConcepts([
        SYN_A,
        { tag: "empty", embedding: [] },
        { tag: "missing", embedding: undefined as unknown as number[] },
      ]),
    ).toEqual([]);
  });

  it("keeps a concept TIGHT — complete linkage, no chaining unrelated tags", () => {
    // A bridges to B and B bridges to C in centered space, but A and C are far.
    // Single-linkage would chain all three; complete-linkage must not merge A&C
    // into one concept because their cross-pair fails the threshold. Background
    // tags pull the centroid off the three so the chain geometry is real (with
    // only three points, centering alone makes adjacent residuals degenerate).
    const tags: EmbeddedTag[] = [
      { tag: "a-tag", embedding: withGenre([2, 0, 0]) },
      { tag: "b-tag", embedding: withGenre([1, 1.2, 0]) },
      { tag: "c-tag", embedding: withGenre([0, 2, 0]) },
      { tag: "bg1", embedding: withGenre([-1, -1, 2]) },
      { tag: "bg2", embedding: withGenre([-1, -1, -2]) },
      { tag: "bg3", embedding: withGenre([0, -1, 0]) },
    ];
    // Confirm the trap: A~B and B~C clear, A~C does not, in centered space.
    const dim = tags[0].embedding.length;
    const centroid = Array.from(
      { length: dim },
      (_, i) => tags.reduce((s, t) => s + t.embedding[i], 0) / tags.length,
    );
    const r = (t: EmbeddedTag) => t.embedding.map((x, i) => x - centroid[i]);
    expect(cosine(r(tags[0]), r(tags[1]))).toBeGreaterThanOrEqual(CONCEPT_THRESHOLD);
    expect(cosine(r(tags[1]), r(tags[2]))).toBeGreaterThanOrEqual(CONCEPT_THRESHOLD);
    expect(cosine(r(tags[0]), r(tags[2]))).toBeLessThan(CONCEPT_THRESHOLD);

    const concepts = clusterTagConcepts(tags);
    // No concept may contain both the far ends.
    for (const c of concepts) {
      const has = new Set(c.tags);
      expect(has.has("a-tag") && has.has("c-tag")).toBe(false);
    }
  });

  it("is deterministic and order-independent (no clock/random)", () => {
    const a = clusterTagConcepts(tagFixture());
    const b = clusterTagConcepts([...tagFixture()].reverse());
    expect(a).toEqual(b);
  });

  it("ignores wrong-dimension tags so they cannot poison the centroid", () => {
    const concepts = clusterTagConcepts([
      ...tagFixture(),
      { tag: "wrongdim", embedding: [1, 2] },
    ]);
    expect(concepts).toHaveLength(1);
    const folded = new Set(concepts.flatMap((c) => c.tags));
    expect(folded.has("wrongdim")).toBe(false);
  });
});

describe("tagConceptMap — display normalization", () => {
  it("maps every folded synonym to its canonical label; leaves loners out", () => {
    const concepts = clusterTagConcepts(tagFixture());
    const map = tagConceptMap(concepts);
    expect(map["libraries"]).toBe("libraries");
    expect(map["library-card"]).toBe("libraries");
    // Register-noise tags never fold, so they get no entry (display raw).
    expect(map["rural-access"]).toBeUndefined();
    expect(map["ceo-pay-ratio"]).toBeUndefined();
  });
});

describe("conceptEdges — honest edge gate", () => {
  it("links templates sharing a TIGHT concept; never a raw-string or register match", () => {
    const concepts = clusterTagConcepts(tagFixture());
    const templates: TaggedTemplate[] = [
      // Two templates that each carry a synonym of the SAME tight concept.
      { id: "t1", tags: ["libraries", "rural-access"] },
      { id: "t2", tags: ["library-card", "ceo-pay-ratio"] },
    ];
    const edges = conceptEdges(templates, concepts);

    // Exactly one concept edge, on the shared tight concept.
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ a: "t1", b: "t2", concept: "libraries", kind: "concept" });
  });

  it("emits NO edge when templates share only a register-noise tag", () => {
    const concepts = clusterTagConcepts(tagFixture());
    // Both carry "rural-access" — a raw-string match — but it is register noise
    // (no tight concept), so it must ground no edge.
    const templates: TaggedTemplate[] = [
      { id: "t1", tags: ["rural-access"] },
      { id: "t2", tags: ["rural-access"] },
    ];
    expect(conceptEdges(templates, concepts)).toEqual([]);
  });

  it("emits zero edges honestly when no tight concept spans two templates", () => {
    const concepts = clusterTagConcepts(tagFixture());
    // The tight concept exists, but only ONE template carries any of its tags.
    const templates: TaggedTemplate[] = [
      { id: "t1", tags: ["libraries", "library-card"] },
      { id: "t2", tags: ["rural-access"] },
    ];
    expect(conceptEdges(templates, concepts)).toEqual([]);
  });

  it("emits zero edges when there are no tight concepts at all (sparse corpus)", () => {
    // No synonyms anywhere — every residual points its own way after centering.
    const tags: EmbeddedTag[] = [
      { tag: "alpha", embedding: withGenre([0, 1, 0]) },
      { tag: "beta", embedding: withGenre([0, 0, 1]) },
      { tag: "gamma", embedding: withGenre([0, -1, -1]) },
    ];
    const concepts = clusterTagConcepts(tags);
    expect(concepts).toEqual([]);
    const templates: TaggedTemplate[] = [
      { id: "t1", tags: ["alpha"] },
      { id: "t2", tags: ["beta"] },
      { id: "t3", tags: ["gamma"] },
    ];
    expect(conceptEdges(templates, concepts)).toEqual([]);
  });

  it("chains members of a broadly-shared concept (n-1 edges, not all-pairs)", () => {
    // Three templates all carry tags of one tight concept -> a 3-node chain
    // (2 edges), not a 3-edge triangle.
    const concepts = clusterTagConcepts(tagFixture());
    const templates: TaggedTemplate[] = [
      { id: "t1", tags: ["libraries"] },
      { id: "t2", tags: ["library-card"] },
      { id: "t3", tags: ["libraries"] },
    ];
    const edges = conceptEdges(templates, concepts);
    expect(edges).toHaveLength(2);
    for (const e of edges) expect(e.a < e.b).toBe(true);
  });

  it("returns edge tuples ONLY — no vector-shaped field leaks", () => {
    const concepts = clusterTagConcepts(tagFixture());
    const edges = conceptEdges(
      [
        { id: "t1", tags: ["libraries"] },
        { id: "t2", tags: ["library-card"] },
      ],
      concepts,
    );
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(new Set(Object.keys(e))).toEqual(new Set(["a", "b", "concept", "kind"]));
      expect(typeof e.a).toBe("string");
      expect(typeof e.b).toBe("string");
      expect(typeof e.concept).toBe("string");
      expect(e.kind).toBe("concept");
      for (const val of Object.values(e as unknown as Record<string, unknown>)) {
        expect(Array.isArray(val)).toBe(false);
      }
    }
  });

  it("is deterministic and order-independent in its endpoints (no clock/random)", () => {
    const concepts = clusterTagConcepts(tagFixture());
    const templates: TaggedTemplate[] = [
      { id: "t2", tags: ["library-card"] },
      { id: "t1", tags: ["libraries"] },
    ];
    const a = conceptEdges(templates, concepts);
    const b = conceptEdges([...templates].reverse(), concepts);
    expect(a).toEqual(b);
    for (const e of a) expect(e.a <= e.b).toBe(true);
  });
});

describe("conceptEdges — no concepts means no edges", () => {
  it("emits nothing when given an empty concept set", () => {
    const templates: TaggedTemplate[] = [
      { id: "t1", tags: ["libraries"] },
      { id: "t2", tags: ["libraries"] },
    ];
    expect(conceptEdges(templates, [])).toEqual([]);
  });
});
