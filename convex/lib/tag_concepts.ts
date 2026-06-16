/**
 * Tag-concept normalization — denoise the tag space, add an honest edge source.
 *
 * Raw tag strings carry almost no relation across the corpus: two templates
 * about the same concern label it with different words ("libraries" vs "library
 * card", "preschool" vs "early-childhood"), so exact tag overlap is ~zero and an
 * edge drawn from a shared raw string would be an accident of vocabulary, not a
 * real relation. And the tag embeddings, like the template embeddings, share a
 * strong genre common-mode (every tag points partly in the "civic-policy term"
 * direction), so RAW tag cosine reads as register noise — everything looks
 * similar because the genre dominates.
 *
 * So we treat tags the same way `relatedness.ts` treats templates: subtract the
 * tag-corpus centroid (remove the common-mode), L2-normalize the residual, and
 * work in centered-cosine space where the topical signal survives and the
 * register similarity is gone. In that space we cluster tags into CONCEPTS — a
 * concept is a set of tags whose centered residuals all point the same way, so
 * "libraries" and "library card" fold into one concept while "libraries" and
 * "rural-access" stay apart.
 *
 * Two things come out of this:
 *
 *   1. A raw-tag -> concept map, for consistent display: synonymous tags share a
 *      canonical concept label so the surface doesn't show "libraries" and
 *      "library card" as two unrelated topics.
 *
 *   2. An ADDITIVE, honest edge source. Two templates that each carry a tag in
 *      the SAME tight concept get a `kind:'concept'` edge — subordinate to the
 *      measured `twin`, comparable to the taxonomic `family`. The gate is the
 *      same shape as the twin gate: only concepts that are TIGHT clusters in
 *      centered space count. A concept formed only by raw-string match, or by
 *      register-level proximity (tags that are close only because of the genre
 *      common-mode), is never tight after centering and so emits no edge. If the
 *      corpus is too sparse to form any tight cross-template concept — which is
 *      the honest state at the seed — ZERO concept edges are emitted. The bar is
 *      never lowered to manufacture them.
 *
 * Everything here is pure: no clock, no randomness, no I/O. Same inputs always
 * yield the same concepts and edges, so the surface stays SSR-safe and
 * deterministic. Raw embedding vectors enter these functions and never leave —
 * only concept labels, the display map, and `{a,b,kind}` edge tuples cross out.
 *
 * Threshold provenance: CONCEPT_THRESHOLD is a centered-cosine cutoff calibrated
 * the same way the twin threshold is — high enough that only genuinely
 * synonymous tags (residuals pointing the same way) merge, while genre-only
 * proximity (the common-mode that centering removes) falls below it. It is a
 * residual-cosine cutoff, not a raw-cosine guess; re-derive it from the
 * centered-cosine distribution if the tag corpus shifts materially.
 */

/** A raw tag paired with its server-only embedding. Vectors never leave here. */
export interface EmbeddedTag {
  /** The raw tag string as authored (e.g. "early-childhood"). */
  tag: string;
  /** The tag's topic embedding. Server-only; consumed here, never returned. */
  embedding: number[];
}

/** A template and the raw tags it carries. */
export interface TaggedTemplate {
  /** Stable identifier (template id) — carried through to any concept edge. */
  id: string;
  /** The template's raw tags. */
  tags: string[];
}

/**
 * A tag concept: a tight cluster of synonymous tags in centered space. Carries
 * the member tags and the canonical label used for display + edge attribution.
 */
export interface TagConcept {
  /**
   * Canonical concept label — the lexically-smallest member tag. Stable and
   * deterministic; chosen by string, never by a wall-clock or insertion order.
   */
  concept: string;
  /** The raw tags that fold into this concept (includes the canonical label). */
  tags: string[];
}

/**
 * A concept relation edge between two templates. Endpoints are template ids,
 * stably ordered (`a <= b`). Taxonomic in spirit like `family`, so no score —
 * the shared concept label is the justification a reader can check.
 */
export interface ConceptEdge {
  a: string;
  b: string;
  /** The shared tight concept's canonical label — the edge's justification. */
  concept: string;
  kind: "concept";
}

/**
 * Centered-cosine cutoff a pair of tags must clear to share a concept (and so a
 * concept to be "tight"). Calibrated as a residual-cosine cutoff — see header.
 * The same value gates both clustering (synonym folding) and the edge source, so
 * a concept that yields an edge is exactly a concept tight enough to fold its
 * tags for display: one bar, no second looser gate.
 */
export const CONCEPT_THRESHOLD = 0.5;

/** Mean of a set of equal-length vectors. Empty input -> empty vector. */
function computeCentroid(vectors: number[][]): number[] {
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

/** Cosine similarity of two vectors. Zero-magnitude inputs -> 0 (never NaN). */
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

/**
 * Keep one embedding per distinct tag, dropping unusable / wrong-dimension ones.
 *
 * The same tag may be authored on several templates; we cluster the tag VOCAB,
 * not its occurrences, so a tag collapses to a single point here. When a tag
 * appears with more than one embedding (e.g. embedded in slightly different
 * contexts) the lexically-first occurrence wins — deterministic, no clock.
 */
function distinctUsableTags(tags: EmbeddedTag[]): EmbeddedTag[] {
  const usable = tags.filter(
    (t) =>
      typeof t.tag === "string" &&
      t.tag.length > 0 &&
      Array.isArray(t.embedding) &&
      t.embedding.length > 0,
  );
  if (usable.length === 0) return [];
  // Lock the dimension to the most common length so a stray wrong-dim vector
  // can't poison the centroid; mirrors the edge filter's same-dim discipline.
  const dim = usable[0].embedding.length;
  const sameDim = usable.filter((t) => t.embedding.length === dim);

  const byTag = new Map<string, EmbeddedTag>();
  for (const t of [...sameDim].sort((x, y) => (x.tag < y.tag ? -1 : x.tag > y.tag ? 1 : 0))) {
    if (!byTag.has(t.tag)) byTag.set(t.tag, t);
  }
  return Array.from(byTag.values());
}

/**
 * Cluster the tag vocabulary into CONCEPTS in mean-centered space.
 *
 * Steps:
 *   1. Drop unusable tags; keep one vector per distinct tag (same dimension).
 *   2. Subtract the tag-corpus centroid (remove the common-mode) and score every
 *      tag pair by cosine on the residuals — the register-only similarity is
 *      gone, only topical kinship remains.
 *   3. Agglomerate with COMPLETE linkage: two clusters merge only if EVERY
 *      cross-pair clears `threshold`. Complete linkage keeps a concept tight —
 *      no chaining "library card" -> "card games" -> "board games" into one
 *      blob — so a concept means "all these tags are mutually synonymous in
 *      centered space", which is exactly the honesty the edge gate needs.
 *
 * Returns concepts with >= 2 tags only (a lone tag is its own trivial concept
 * and needs no folding); the canonical label is the lexically-smallest member.
 * Fewer than two usable tags -> no concepts (nothing to fold or relate).
 *
 * Pure and deterministic: identical inputs -> identical concepts, stable order.
 */
export function clusterTagConcepts(
  tags: EmbeddedTag[],
  options: { threshold?: number } = {},
): TagConcept[] {
  const threshold = options.threshold ?? CONCEPT_THRESHOLD;
  const distinct = distinctUsableTags(tags);
  if (distinct.length < 2) return [];

  const centroid = computeCentroid(distinct.map((t) => t.embedding));
  const residuals = distinct.map((t) => subtract(t.embedding, centroid));

  // Pairwise centered cosine, symmetric. sim[i][j] is the residual cosine.
  const n = distinct.length;
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = cosine(residuals[i], residuals[j]);
      sim[i][j] = s;
      sim[j][i] = s;
    }
  }

  // Agglomerative complete-linkage. Each tag starts as its own cluster (a list
  // of member indices). Merge the closest pair whose COMPLETE linkage (the
  // weakest cross-pair) still clears the threshold; stop when none qualifies.
  let clusters: number[][] = distinct.map((_, i) => [i]);

  const completeLinkage = (ca: number[], cb: number[]): number => {
    let weakest = Infinity;
    for (const i of ca) {
      for (const j of cb) {
        if (sim[i][j] < weakest) weakest = sim[i][j];
      }
    }
    return weakest;
  };

  for (;;) {
    let bestLink = -Infinity;
    let bestPair: [number, number] | null = null;
    for (let x = 0; x < clusters.length; x++) {
      for (let y = x + 1; y < clusters.length; y++) {
        const link = completeLinkage(clusters[x], clusters[y]);
        if (link >= threshold && link > bestLink) {
          bestLink = link;
          bestPair = [x, y];
        }
      }
    }
    if (!bestPair) break;
    const [x, y] = bestPair;
    const merged = [...clusters[x], ...clusters[y]];
    clusters = clusters.filter((_, idx) => idx !== x && idx !== y);
    clusters.push(merged);
  }

  // Materialize concepts of >= 2 tags. Canonical label = lexically-smallest tag.
  const concepts: TagConcept[] = [];
  for (const members of clusters) {
    if (members.length < 2) continue;
    const tagStrings = members
      .map((i) => distinct[i].tag)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    concepts.push({ concept: tagStrings[0], tags: tagStrings });
  }
  // Stable order: by canonical label.
  concepts.sort((a, b) => (a.concept < b.concept ? -1 : a.concept > b.concept ? 1 : 0));
  return concepts;
}

/**
 * Build the raw-tag -> canonical-concept display map from a concept set.
 *
 * Only tags that fold into a multi-tag concept appear; a tag that stands alone
 * is its own label and needs no entry (callers display the raw tag unchanged).
 * Deterministic: the map is derived purely from the (already-sorted) concepts.
 */
export function tagConceptMap(concepts: TagConcept[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const c of concepts) {
    for (const tag of c.tags) map[tag] = c.concept;
  }
  return map;
}

/**
 * Emit the honest concept edges over a set of tagged templates.
 *
 * A concept edge links two templates that EACH carry at least one tag belonging
 * to the SAME tight concept. The tightness gate already ran in
 * `clusterTagConcepts` (complete-linkage above the centered-cosine threshold),
 * so only genuinely synonymous tag groups can ground an edge — never a raw
 * string match, never register-level proximity. Concepts that no two templates
 * share emit nothing; if NO tight concept spans two templates, the result is
 * empty (the honest state at a sparse corpus).
 *
 * Within a concept the member templates are linked as a single id-ordered CHAIN
 * (n-1 edges), not an all-pairs blob — same bounded fan-out as the family edges,
 * so a future broadly-shared concept doesn't drown the measured twins.
 *
 * Pure and deterministic: identical inputs -> identical edges, stable order.
 * Endpoints normalized so `a <= b`, matching the twin/family edge convention so
 * the three sources dedupe cleanly downstream.
 */
export function conceptEdges(
  templates: TaggedTemplate[],
  concepts: TagConcept[],
): ConceptEdge[] {
  if (concepts.length === 0) return [];

  // raw tag -> canonical concept (only folded, multi-tag concepts).
  const tagToConcept = tagConceptMap(concepts);

  // concept label -> the set of template ids that carry any tag in it.
  const byConcept = new Map<string, Set<string>>();
  for (const t of templates) {
    const id = t.id;
    if (typeof id !== "string" || id.length === 0) continue;
    if (!Array.isArray(t.tags)) continue;
    // A template touches a concept at most once, even if it carries several of
    // its synonyms — we relate templates, not tag occurrences.
    const touched = new Set<string>();
    for (const tag of t.tags) {
      const concept = tagToConcept[tag];
      if (concept) touched.add(concept);
    }
    for (const concept of touched) {
      const set = byConcept.get(concept);
      if (set) set.add(id);
      else byConcept.set(concept, new Set([id]));
    }
  }

  const edges: ConceptEdge[] = [];
  for (const [concept, idSet] of byConcept) {
    if (idSet.size < 2) continue; // a concept one template carries relates nobody
    const ids = Array.from(idSet).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    for (let i = 1; i < ids.length; i++) {
      const lo = ids[i - 1];
      const hi = ids[i];
      const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
      edges.push({ a, b, concept, kind: "concept" });
    }
  }

  // Stable global order: by endpoints then concept.
  edges.sort(
    (e1, e2) =>
      e1.a < e2.a
        ? -1
        : e1.a > e2.a
          ? 1
          : e1.b < e2.b
            ? -1
            : e1.b > e2.b
              ? 1
              : e1.concept < e2.concept
                ? -1
                : e1.concept > e2.concept
                  ? 1
                  : 0,
  );
  return edges;
}
