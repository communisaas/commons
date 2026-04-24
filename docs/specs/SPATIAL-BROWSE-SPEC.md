# Spatial Browse: From Template List to Civic Landscape

> **STATUS: ASPIRATIONAL** — Design spec. Not yet implemented.
>
> **Storage:** `topicEmbedding` / `locationEmbedding` are stored on the `templates` table in `convex/schema.ts` with Convex vector indexes. Embedding provider is Gemini `text-embedding-004` (768-dim).

**Status:** Design Spec — Active
**Author:** Architecture / Perceptual Engineering
**Created:** 2026-03-01
**Depends on:** Seed data (13 templates), `topicEmbedding` / `locationEmbedding` on the Convex `templates` table, `TemplateScope`, `TemplateJurisdiction`, `deriveTargetPresentation()`
**Companion specs:** `POWER-LANDSCAPE-SPEC.md` (detail view), `decision-maker-enrichment-pipeline.md`

---

## Problem Statement

The browse page presents templates as a flat 3-column card grid sorted by creation date. Category pills and text search are the only navigational axes. Every card occupies identical visual weight regardless of geographic scope, topic density, engagement momentum, or power structure.

A user arriving at this page must read every card to understand what exists. The dimensional structure of the template corpus — geography, topic, power level, momentum, delivery channel — is invisible. The mind has no landscape; only a shelf.

This spec defines three progressive views that transform the browse experience from a list into a navigable civic landscape — a space the mind can orient within before reading a single title.

---

## 1. GROUND: The Felt Situation

### Who Arrives Here

A person who cares about something — an issue, a place, a sense that someone should hear from citizens about *this*. They may arrive with:

- **A topic in mind** ("housing in SF", "veterans healthcare") — hunting mode, directed search with growing clarity
- **A geography in mind** ("what's happening in my district / my province") — spatial orientation, wayfinding
- **Open curiosity** ("what are people organizing around") — exploration, scanning the landscape for salience
- **Returning familiarity** ("I used that template last week, what else is nearby") — spatial memory, neighborhood expansion

### Somatic Ground-Tone

This is not a shopping experience. The user is not browsing products. They are scanning a landscape of civic concern — issues that carry weight, that affect real people, that connect to power structures. The emotional quality is:

- **Quiet seriousness** mixed with **curiosity** — "what can I do about this?"
- **Agency-seeking** — not passive consumption but looking for a lever to pull
- **Time-constrained** — most civic engagement happens in stolen moments (bus ride, waiting room, 90 seconds after reading a headline)
- **Trust-forming** — they are evaluating whether this platform takes their concerns seriously

The interface must honor this emotional register. Not playful, not corporate, not urgent-alarming. **Calm seriousness with invitation to depth.**

### Cognitive State

- **Working memory**: 4 chunks available. The current grid asks them to hold: search query + category filter + spatial position in grid + comparison across cards = exactly at capacity with no room for the actual decision.
- **Attention mode**: Peripheral scanning first (which cluster looks relevant?), then focal inspection (read the card title, description).
- **Expertise**: Ranges from first-visit to repeat user. First visit needs orientation ("where am I in this space?"). Repeat visit needs spatial memory ("I know where housing templates live").

### What Kind of Engagement

This is **navigation + progressive constraint**: moving through a possibility space, narrowing by interest, arriving at a specific template. The current flat grid collapses this into a single step (scan everything → pick one). The spatial views should create a 2-3 step journey: orient → narrow → select.

---

## 2. MAP: Experiential Qualities & Perceptual Primitives

### Experiential Qualities

**Atmosphere: Inhabited landscape, not product catalog.**
The browse page should feel like looking at a relief map of civic concern — where are the mountains (dense clusters of templates), where are the valleys (gaps), where is the terrain I recognize? The atmosphere is cartographic: measured, informative, spatially organized, with quiet invitation to explore.

**Affordance ecology: Navigate, not filter.**
The current UI affords filtering (constrain a list). The spatial views should afford navigation (move through a space). Filtering is subtractive (remove what doesn't match). Navigation is exploratory (go toward what draws you). The difference is felt: filtering feels like narrowing; navigating feels like exploring.

**Resonance with the domain.**
Civic engagement is inherently geographic and topical. People organize around places and issues. The visual language should express this directly — geography creates spatial ground, topics create neighborhoods, power structures create vertical hierarchy. The interface structure should mirror the structure of civic reality.

**Tension and resolution.**
- Tension: "There's a lot here — where do I start?" (the full landscape)
- Resolution: "Ah, this cluster is about what I care about" (finding your neighborhood)
- Deeper resolution: "This specific template speaks to my situation" (selecting)

Each transition from broad to specific should feel like resolution — the space gets sharper, not just smaller.

**Invitation to empty space.**
The gaps in the landscape — topic × geography combinations with no templates — should be perceptible and inviting. "No one has written about housing in Montana" is information. It's also an invitation: "you could be the first." Empty cells in the landscape are not failure states; they are frontier.

### Perceptual Primitives (Constraints)

**Peripheral scanning bandwidth**: ~2 bits/sec per cluster. At the landscape level, each geographic tier or topic neighborhood must be assessable in a single peripheral fixation — color + spatial position + density (how many items). No text reading required at this level.

**Focal inspection bandwidth**: ~50 bits/sec. Once the eye lands on a cluster, the user reads titles and descriptions. This is where the existing TemplateCard content lives — but in compact form.

**Spatial memory**: Extremely robust. If the layout is stable (same template always in the same position relative to neighbors), users build spatial memory after 2-3 visits. "Housing is bottom-left, healthcare is top-right." This is destroyed by re-sorting or random layouts.

**Gestalt grouping**: Proximity = relatedness. Items near each other are perceived as a group before any labels are read. This is the most powerful organizing principle available — more powerful than color, borders, or explicit section headers.

**Figure-ground**: Clusters (figures) against white space (ground). The white space between clusters is not wasted — it encodes semantic distance. More space = less related. This is the "relief" in the relief map.

**Motion**: Reserve for salience signals only — active debates (amber pulse, already implemented), new templates (fade-in on load). No decorative animation. Motion in peripheral vision triggers involuntary attention capture; use this sparingly and truthfully.

---

## 3. VIEW 1: Grouped Landscape

### Design Philosophy

Restructure the flat grid into a **geography × topic matrix** rendered as clustered sections. No new dependencies. No canvas. Pure layout transformation that reveals the dimensional structure of the corpus.

The mental model: a table where rows are geographic tiers and columns are topic neighborhoods, but rendered as a flowing spatial layout rather than a rigid grid — because most cells are empty and a rigid grid would be mostly whitespace.

### Data Model

#### Geographic Tiers (Vertical Axis)

Derived from `TemplateScope.scope_level` + `TemplateScope.country_code`:

```
Tier 0: "Everywhere"         — scope_level = null or templates with no scope
Tier 1: "United States"      — country_code = "US", scope_level = "country"
Tier 2: "US — [State]"       — country_code = "US", scope_level = "region"
Tier 3: "US — [City]"        — country_code = "US", scope_level = "locality"/"district"
Tier 4: "Canada"             — country_code = "CA", scope_level = "country"
Tier 5: "CA — [Province]"    — country_code = "CA", scope_level = "region"
Tier 6: "CA — [City]"        — country_code = "CA", scope_level = "locality"/"district"
```

Tiers with zero templates are omitted. Ordering is: user's country first (via geolocation or explicit selection), then alphabetical within sub-national.

#### Topic Neighborhoods (Horizontal Axis / Within-Tier Clustering)

Derived from `template.category` as primary grouping, `template.topics[]` as secondary affinity signal:

```typescript
// Seed data categories → neighborhoods
const NEIGHBORHOODS = {
  'Health & Safety':     ['Healthcare', 'Public Health', 'Criminal Justice'],
  'Rights & Justice':    ['Digital Rights', 'Indigenous Rights', 'Labor Rights', 'Immigration'],
  'Place & Infrastructure': ['Housing', 'Urban Development', 'Transportation', 'Environment'],
  'Education & Opportunity': ['Education'],
} as const;
```

Templates within a tier are sub-grouped by neighborhood. Within a neighborhood, templates are ordered by `verified_sends` (descending, momentum-first) with a freshness boost for `isNew` templates.

**Why not use the raw `category` values directly?** Because 13 categories with 1-2 templates each produces no meaningful clustering. The neighborhoods merge semantically adjacent categories so that clusters have visual mass. As the corpus grows beyond ~50 templates, neighborhoods can split back into finer categories.

#### Computed Layout Structure

```typescript
interface LandscapeData {
  tiers: GeographicTier[];
}

interface GeographicTier {
  /** Display label: "United States", "US — Oregon", "Canada — Montréal" */
  label: string;
  /** ISO country code */
  country: string;
  /** Scope level for sorting */
  scopeLevel: 'country' | 'region' | 'locality' | 'district';
  /** Sub-national display: state/province/city name */
  subRegion?: string;
  /** Topic clusters within this tier */
  neighborhoods: TopicNeighborhood[];
  /** Total template count (for peripheral density signal) */
  templateCount: number;
}

interface TopicNeighborhood {
  /** Display label: "Health & Safety", "Place & Infrastructure" */
  label: string;
  /** Color token for left-border accent */
  color: NeighborhoodColor;
  /** Templates in this neighborhood, ordered by momentum */
  templates: Template[];
}

type NeighborhoodColor =
  | 'health'      // rose-500    — life, body, care
  | 'rights'      // violet-500  — justice, principle, protection
  | 'place'       // amber-500   — earth, infrastructure, built environment
  | 'education';  // cyan-500    — knowledge, growth, opportunity
```

### Layout Specification

#### Tier Rendering

Each tier is a full-width section with:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  🇺🇸 United States                                    5 templates   │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  ┌─ Health & Safety ──────────┐  ┌─ Rights & Justice ────────────┐ │
│  │                            │  │                                │ │
│  │  [compact card]            │  │  [compact card]                │ │
│  │  [compact card]            │  │  [compact card]                │ │
│  │                            │  │                                │ │
│  └────────────────────────────┘  └────────────────────────────────┘ │
│                                                                     │
│  ┌─ Place & Infrastructure ───┐  ┌─ Education & Opportunity ─────┐ │
│  │                            │  │                                │ │
│  │  [compact card]            │  │  [compact card]                │ │
│  │                            │  │                                │ │
│  └────────────────────────────┘  └────────────────────────────────┘ │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  ░░░░░░░░░░░░░░░  No Labor Rights templates yet  ░░░░░░░░░░░ │ │
│  │  ░░░░░░░░░░░░░░░  Be the first to write one      ░░░░░░░░░░░ │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                           ↕ 48px gap (inter-tier distance)
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  🇺🇸 US — San Francisco                               3 templates   │
│  ─────────────────────────────────────────────────────────────────  │
│  ...                                                                │
└─────────────────────────────────────────────────────────────────────┘
```

**Tier header**: Country flag emoji + label, right-aligned template count in `text-slate-400 font-mono tabular-nums`. Thin `border-b border-slate-200` separator. `font-brand text-lg font-semibold text-slate-800`.

**Inter-tier gap**: 48px (`gap-12`). This is intentionally large — geographic distance should be spatially perceivable. Tiers in the same country have 48px gap. Between countries: 64px (`gap-16`) + a subtle `border-t border-slate-100` full-width rule.

#### Neighborhood Rendering

Within a tier, neighborhoods flow as a CSS grid: `grid-cols-2` on desktop, `grid-cols-1` on mobile. Each neighborhood is a bordered section:

**Neighborhood container**:
- `border-l-3` with neighborhood color accent
- `bg-{color}-50/30` extremely subtle background tint
- `rounded-lg` corners
- `p-4` inner padding
- No outer border — the tint + left accent is sufficient

**Neighborhood label**: `text-xs font-brand font-semibold uppercase tracking-wider text-{color}-600/70` at top. This is peripheral — recognized by color before text is read.

**Within a neighborhood**: Templates stack vertically as compact cards (see below). Gap between compact cards: 8px (`gap-2`).

**Empty neighborhoods**: Only shown for the user's home tier (to surface gaps as invitation). Rendered as a dashed-border placeholder: `border-dashed border-slate-200 bg-slate-50/50 rounded-lg p-6 text-center`. Text: "No [neighborhood] templates for [tier] yet" + "Be the first to write one" as a subtle link to `/create`.

#### Compact Card (Landscape Variant)

The existing `TemplateCard` is too tall for landscape view (title + description + footer = ~180px). The landscape variant compresses to ~80px:

```
┌──────────────────────────────────────────────────┐
│ 🏛️ Your 3 representatives                        │
│ A lifeline for veterans where the pavement ends  │
│ 127 sent · 34 districts · ● Debating             │
└──────────────────────────────────────────────────┘
```

Three lines:
1. **Power topology**: Icon + `targetInfo.primary` + `targetInfo.secondary` — `text-sm text-{emphasis}-600`
2. **Title**: `line-clamp-1 font-brand text-base font-bold text-slate-900` — single line, truncated
3. **Metrics row**: `text-xs text-slate-500 font-mono` — sends, districts/recipients, debate status badge (inline, not block)

**Hover**: `bg-slate-50` transition, slight `translate-x-1` on the row (directional hint: "this goes deeper"). No scale transform — compact cards are too small for scale to feel right.

**Click**: Navigates to `/s/{slug}` (same as current grid).

**Pre-launch behavior**: Line 3 is omitted entirely when `hasEngagement === false` (compact card becomes 2 lines, ~56px). No negative social proof.

#### Filtering Integration

The existing search bar and category pills remain, but their behavior changes:

- **Search**: Filters across all tiers. Tiers with zero matching templates collapse (animated, 300ms ease-out). The landscape contracts to show only relevant terrain.
- **Category pills**: Replaced by **neighborhood toggles** — 4 color-coded pills that highlight/dim neighborhoods across all tiers. Multiple can be active simultaneously (AND logic within tier, OR across tiers would be confusing — use highlight/dim, not show/hide).
- **Geographic filter**: New. A simple country selector (`US | CA | All`) above the tier stack. When selected, tiers outside that country collapse.

#### Responsive Behavior

- **Desktop (1280px+)**: Tiers full-width. Neighborhoods in 2-column grid within each tier.
- **Tablet (768-1024px)**: Same structure, neighborhoods collapse to 1 column within each tier.
- **Mobile (375-428px)**: Tiers become sections. Neighborhoods become collapsible `<details>` elements (open by default for the first tier, collapsed for subsequent tiers to reduce scroll depth). Compact cards at full width.

### State Architecture

```typescript
// Browse page state — fits in 3 working memory slots
interface LandscapeState {
  /** Active neighborhood filters (empty = all visible) */
  activeNeighborhoods: Set<string>;  // slot 1: "what am I looking at"
  /** Country filter */
  countryFilter: 'US' | 'CA' | 'all';  // slot 2: "where am I"
  /** Text search query */
  searchQuery: string;  // slot 3: "what am I looking for"
}
```

No additional state required. The layout structure is derived (`$derived`) from `data.templates` + `LandscapeState`. No imperative DOM manipulation.

### Transition from Current Grid

The landscape view should be the **default browse experience**, not an alternative toggle. The current flat grid becomes a fallback for edge cases (no templates match filters → show "No results" → link to clear filters). The URL remains `/browse`. No view-switcher button — the landscape IS the browse page.

### Data Loading

No changes to `+page.server.ts`. The existing query fetches all public templates with debate summaries. The landscape structure is computed client-side in a `$derived` block — 13 templates need no server-side computation. At scale (100+ templates), the tier/neighborhood computation moves to the server load function.

### Accessibility

- Tier headers are `<h2>` elements. Neighborhood labels are `<h3>`.
- Compact cards remain `<button>` elements with `aria-label="{title} — {category} template targeting {targetInfo.primary}"`.
- Neighborhood toggles are `aria-pressed` toggle buttons.
- Keyboard navigation: Tab through tier headers → neighborhood labels → compact cards. Arrow keys within a neighborhood (up/down between cards).
- `role="region"` with `aria-label` on each tier container.
- Screen reader announcement on filter change: "Showing {n} templates in {tiers} regions".

---

## 4. VIEW 2: Topic Constellation

### Design Philosophy

Project the template corpus into a 2D semantic space where **proximity encodes meaning**. Templates about similar topics cluster together. The mind reads the space as terrain — dense clusters are "hot" topics, sparse regions are frontiers, proximity between templates reveals hidden relationships that text labels miss.

This is the **analytical view** — it answers "what does the shape of civic discourse look like?" It's the view that reveals that housing and transportation templates cluster together (they share the "urban policy" tag), or that healthcare and education templates are further apart than expected (different communities of concern).

### Perceptual Mode

This is a **spatial reasoning task** (see PE recognition patterns). The user navigates relationships, structures, and neighborhoods in a 2D explorable space. Consistent layout enables proprioceptive prediction and spatial memory. The space should feel **traversable** — your body should know where things are after 2-3 visits.

### Data Pipeline

#### 1. Embedding Source

Templates already have `topicEmbedding` (Gemini `text-embedding-004`, 768-dimensional vector) stored on the Convex `templates` table. The embedding captures semantic meaning of `title + description + topics.join(', ')`.

For templates without embeddings (newly created, embedding job not yet run): exclude from constellation, show in a separate "Uncharted" sidebar list.

#### 2. Dimensionality Reduction

768D → 2D projection. Three options, ranked by suitability:

| Method | Quality | Performance | Dependencies | Deterministic |
|--------|---------|-------------|--------------|---------------|
| **UMAP** | Excellent — preserves local + global structure | ~50ms for 100 items, ~500ms for 1000 | `umap-js` (7KB gzipped) | No (random seed) |
| **t-SNE** | Good local, poor global | ~200ms for 100 items | `tsne-js` (4KB) | No |
| **PCA** | Fast but linear — misses nonlinear clusters | ~5ms for 1000 items | Built-in (SVD) | Yes |

**Decision: UMAP** for production, PCA as instant fallback.

UMAP parameters tuned for small corpus with meaningful global structure:
```typescript
const umapConfig = {
  nNeighbors: 5,        // Small corpus — fewer neighbors (default 15 is too many for <50 items)
  minDist: 0.3,         // Moderate spread — don't collapse clusters to points
  spread: 1.2,          // Slight expansion for visual clarity
  nComponents: 2,       // 2D output
  random: seedRandom(42), // Deterministic for spatial memory (same templates → same positions)
};
```

**Critical: deterministic seeding.** Spatial memory requires that the same corpus produces the same layout every time. UMAP's stochastic initialization must be seeded. The seed is derived from a hash of the template IDs in the corpus — if the corpus changes (new template added), the layout shifts gradually rather than randomizing.

#### 3. Layout Computation

Computed **server-side** in `+page.server.ts` (embeddings are already in DB, UMAP runs in <100ms for <100 items). Returned as part of page data:

```typescript
interface ConstellationData {
  nodes: ConstellationNode[];
  /** Bounding box after projection (for viewport initialization) */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** Detected clusters (HDBSCAN or simple k-means on 2D positions) */
  clusters: TopicCluster[];
}

interface ConstellationNode {
  templateId: string;
  slug: string;
  title: string;
  category: string;
  topics: string[];
  /** 2D position from UMAP projection, normalized to [0, 1] × [0, 1] */
  x: number;
  y: number;
  /** Cluster membership (index into clusters array, -1 for noise) */
  clusterId: number;
  /** Visual weight: same coordinationScale from TemplateCard */
  weight: number;
  /** Country code for color encoding */
  country: string;
  /** Power emphasis for icon selection */
  emphasis: 'federal' | 'state' | 'local' | 'neutral';
}

interface TopicCluster {
  id: number;
  /** Centroid in 2D space */
  cx: number;
  cy: number;
  /** Emergent label: most common category or topic tag in cluster */
  label: string;
  /** Convex hull vertices (for region rendering) */
  hull: Array<{ x: number; y: number }>;
  /** Neighborhood color from View 1's palette */
  color: NeighborhoodColor;
  /** Member template IDs */
  members: string[];
}
```

#### 4. Cluster Detection

For <50 templates: simple distance-based clustering (templates within 0.15 normalized distance of each other form a cluster). Label = most frequent `category` in the cluster.

For 50+ templates: HDBSCAN (`hdbscan-js`, min_cluster_size = 3). Produces variable-size clusters with noise points.

### Rendering Specification

#### Canvas Choice: SVG

For <500 nodes, SVG outperforms Canvas in:
- Accessibility (each node is a DOM element with `role="button"`)
- Hit testing (native, no coordinate math)
- Styling (CSS transitions, hover states)
- Text rendering (crisp at all zoom levels)

For 500+ nodes: migrate to Canvas with an accessibility overlay. Not needed for current corpus.

#### Viewport

The constellation occupies the full content area below the browse header. Aspect ratio: 16:10 on desktop, 1:1 on mobile (square viewport, scrollable).

**Viewport state:**
```typescript
interface ViewportState {
  /** Center of visible area in constellation coordinates [0,1]×[0,1] */
  center: { x: number; y: number };
  /** Zoom level: 1.0 = entire constellation fits in viewport */
  zoom: number;
  /** Currently hovered node (null if none) */
  hoveredNode: string | null;
  /** Currently selected node (null if none) */
  selectedNode: string | null;
}
```

**Zoom range**: 1.0 (full view) to 4.0 (detail). Zoom toward cursor/pinch center (not viewport center). Scroll wheel + pinch gestures.

**Pan**: Click-drag on empty space. Momentum-based with friction (ease-out, 300ms decay).

#### Node Rendering

Each template is rendered as a circle with layered visual encoding:

**Size**: Base radius 16px, scaled by `weight` (coordinationScale): `r = 16 + weight * 12` → range 16px to 28px. This is the same logarithmic encoding as TemplateCard's `cardScale`, but expressed as radius rather than CSS transform.

**Fill**: Country-coded.
- US templates: `fill-slate-700` (dark, grounded)
- CA templates: `fill-red-700` (maple leaf association, but muted — not bright red)
- Other countries (future): `fill-slate-400`

**Stroke**: Emphasis-coded (power level).
- Federal: `stroke-blue-500 stroke-2` (institutional blue)
- State/Provincial: `stroke-emerald-500 stroke-2`
- Local: `stroke-amber-500 stroke-2`
- Neutral: `stroke-slate-300 stroke-1`

**Hover state**: Ring expands to `r + 4`, stroke brightens. A tooltip appears (not a full card — just title + category + 1-line metrics). 150ms ease-out transition.

**Selected state**: Ring expands to `r + 6`, solid fill brightens. A detail panel slides in from the right (desktop) or bottom (mobile) showing the full compact card from View 1. The constellation dims slightly (`opacity: 0.4` on non-selected nodes, non-cluster-mates at `0.6`, cluster-mates at `0.8`).

**Active debate**: Amber pulse animation on the stroke (same `debate-pulse` keyframe from TemplateCard). This is the motion signal — sparingly used, truthfully applied.

**New template**: Subtle glow effect (`filter: drop-shadow(0 0 4px rgba(6, 182, 212, 0.4))`) — cyan glow matching the "New" badge color.

#### Cluster Regions

Behind the nodes, each cluster is rendered as a translucent convex hull:

```svg
<path d={hullPath} fill={clusterColor} fill-opacity="0.06" stroke={clusterColor} stroke-opacity="0.15" stroke-width="1" />
```

Extremely subtle — the cluster regions should be perceived as ambient ground, not as borders. They create the sense of "neighborhood" without explicit boundaries.

**Cluster label**: Positioned at the cluster centroid, offset upward by the cluster's vertical extent. `text-xs font-brand font-semibold uppercase tracking-wider` in the cluster color at 40% opacity. The label fades in only at zoom >= 1.5 (at full zoom-out, the shapes speak for themselves; zooming in reveals the names).

#### Empty Space Rendering

The void between clusters is intentional. At zoom >= 2.0, ghost labels appear in the largest empty regions: "No [topic] templates in [geography] yet" at 15% opacity. These are invitations, not labels — they emerge only when the user is actively exploring the space.

#### Interaction Model

**Discovery flow:**
1. Full constellation appears (zoom 1.0). User perceives clusters as colored shapes — no text reading needed yet. ~500ms to orient.
2. User identifies an interesting cluster (color + density + position). Zooms in (scroll/pinch).
3. Cluster label appears. Individual nodes become distinguishable. User hovers → tooltip reveals title.
4. User clicks a node → detail panel slides in. The constellation's other nodes dim. The selected node's cluster-mates remain visible (contextual neighborhood).
5. From detail panel: "Open template" navigates to `/s/{slug}`. "Back to constellation" dismisses the panel.

**Keyboard navigation:**
- Tab cycles through nodes (in cluster order, then by x-position within cluster).
- Arrow keys: move to nearest node in that direction (Voronoi-based neighbor lookup).
- Enter: select node (open detail panel).
- Escape: deselect / zoom out one step.
- `+`/`-`: zoom in/out.

**Filter integration:**
When the search bar or neighborhood toggles are active, non-matching nodes fade to `opacity: 0.1` (not removed — their positions remain as spatial anchors). Matching nodes remain at full opacity. The constellation's structure is preserved even during filtering.

### Performance Budget

| Operation | Budget | Approach |
|-----------|--------|----------|
| UMAP projection | <200ms | Server-side in load function; cached until corpus changes |
| SVG initial render | <50ms | 13 circles + 4 hulls + 4 labels = trivial |
| Hover tooltip | <16ms | CSS transition, no JS layout |
| Zoom/pan | <16ms | SVG `viewBox` transform, GPU-composited |
| Filter dim | <100ms | CSS `opacity` transition on individual nodes |
| Detail panel slide | 300ms | CSS `transform: translateX()`, ease-out |

### Data Loading

Add to `+page.server.ts`:
1. Fetch `topic_embedding` for all public templates (add to existing select).
2. Run UMAP projection (memoized — recompute only when template set changes).
3. Run cluster detection on 2D positions.
4. Compute convex hulls.
5. Return `ConstellationData` alongside existing template data.

**Cache**: The constellation layout is deterministic (seeded UMAP) and changes only when templates are added/removed/updated. Cache the `ConstellationData` in a module-level variable with a TTL of 5 minutes, invalidated on template mutation.

---

## 5. VIEW 3: Geographic Map

### Design Philosophy

Templates positioned on an actual map of their jurisdictions. The most intuitive spatial anchor — everyone knows where they are geographically. This view answers "what's happening near me?" and "what does the distribution of civic concern look like across the continent?"

### Perceptual Mode

This is **wayfinding with a known landmark** — the user's own location. The map provides the strongest possible orientation cue: "I am here. What's around me?" This is the only view where the user's physical location is directly encoded.

Unlike the constellation (which reveals semantic structure), the map reveals **power geography** — where civic action concentrates, which jurisdictions have active templates, and the relationship between local and national issues.

### Map Technology

| Option | Bundle Size | Tile Cost | Interactivity | Offline |
|--------|-------------|-----------|---------------|---------|
| **MapLibre GL JS** | 210KB gzip | Free (OSM tiles) | Excellent | Possible |
| Leaflet | 40KB gzip | Free (OSM) | Good | Limited |
| Mapbox GL JS | 210KB gzip | $0.50/1000 loads | Excellent | No |
| D3-geo (SVG) | 30KB gzip (d3-geo only) | None (own geometry) | Custom | Full |
| deck.gl | 300KB gzip | Free (OSM) | Excellent | No |

**Decision: D3-geo for initial implementation.**

Rationale:
- 13 templates don't need a tiled map. A simple SVG choropleth of US states + Canadian provinces with template markers is sufficient and vastly lighter.
- No external tile server dependency. No API keys. No CORS issues. No loading waterfall.
- Full control over visual encoding — the map IS the interface, not a platform someone else designed.
- When the corpus grows to 100+ templates with district-level precision, migrate to MapLibre GL JS for tiled rendering and smooth zoom.

### Geographic Data

#### Boundary Geometries

Use TopoJSON for compact boundary data:

```
us-states.json     — 50 states + DC + territories  (~150KB topo)
ca-provinces.json  — 13 provinces + territories     (~50KB topo)
```

Source: Natural Earth 1:50m admin-1 (public domain). Pre-processed to TopoJSON with `topojson-simplify` at appropriate detail level (no need for coastline precision at this zoom).

Both files served as static assets from `/static/geo/`. Loaded on-demand when the map view is activated.

#### Template Positioning

Each template has a geographic anchor:

- **Country-level**: Positioned at the country's geometric centroid (US: ~39.8°N, 98.5°W; CA: ~56.1°N, 106.3°W). Slight jitter to prevent overlap when multiple country-level templates exist.
- **State/Province-level**: Positioned at the state/province centroid. Derived from `TemplateScope.region_code` → centroid lookup table.
- **City/District-level**: Positioned at the city/district coordinates. Derived from `TemplateScope.latitude/longitude` if available, otherwise geocoded from `TemplateScope.display_text`.

Centroid lookup table: Pre-computed JSON mapping `region_code` → `{ lat, lng }` for all US states, Canadian provinces, and major cities in the seed data. Stored in `/static/geo/centroids.json` (~5KB).

### Rendering Specification

#### Projection

**Albers USA** for the US view (standard for US choropleth — Alaska/Hawaii inset). **Lambert Conformal Conic** for Canada. When both countries are shown: **Albers Equal Area** centered on North America.

Projection selection is automatic based on `countryFilter`:
- `'US'`: Albers USA
- `'CA'`: Lambert Conformal Conic
- `'all'`: Albers Equal Area (North America)

#### Choropleth Layer (Background)

States/provinces rendered as filled polygons:

- **Has templates**: `fill-slate-100` (light, present)
- **No templates**: `fill-slate-50` (barely there, background)
- **Hovered**: `fill-slate-200` transition (200ms)
- **State/province borders**: `stroke-slate-200 stroke-width-0.5`
- **Country border (US-CA)**: `stroke-slate-400 stroke-width-1.5`

The choropleth is ambient — it provides geographic context without competing with the template markers.

**Future**: At scale, the fill encodes template density (saturation ramp: 0 templates = `slate-50`, 10+ = `blue-200`). This creates a heat-map effect showing where civic engagement concentrates.

#### Template Markers

Each template is a circle marker positioned at its geographic anchor:

**Size**: Same formula as constellation: `r = 12 + weight * 8` (slightly smaller than constellation because map has more visual noise).

**Visual encoding**: Identical to constellation nodes — country fill, emphasis stroke, debate pulse, new glow.

**Overlap handling**: When multiple templates share the same anchor (e.g., 3 country-level US templates), apply collision avoidance:
```typescript
// Simple force-based declutter for <20 overlapping items
function declutter(markers: Marker[], minDistance: number): Marker[] {
  // Iterative relaxation: push overlapping markers apart
  for (let i = 0; i < 10; i++) {
    for (const a of markers) {
      for (const b of markers) {
        if (a === b) continue;
        const d = distance(a, b);
        if (d < minDistance) {
          const force = (minDistance - d) / 2;
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          a.x -= Math.cos(angle) * force;
          a.y -= Math.sin(angle) * force;
          b.x += Math.cos(angle) * force;
          b.y += Math.sin(angle) * force;
        }
      }
    }
  }
  return markers;
}
```

Ten iterations is sufficient for <50 markers. Runs in <1ms.

#### Interaction Model

**Hover on marker**: Tooltip with template title + category + metrics (same as constellation).

**Click on marker**: Detail panel from right (desktop) or bottom (mobile). Map pans to center the selected marker.

**Hover on state/province**: State name tooltip. If templates exist in that state, tooltip also shows count: "Oregon — 1 template".

**Click on state/province**: Zooms to state bounds. Shows only templates within that state. "Back to overview" button appears.

**User location**: If geolocation is available (from existing location infrastructure), a blue dot with accuracy ring shows the user's position. The map initializes centered on the user's location at a zoom level that shows their state/province + neighboring states.

**Keyboard navigation:**
- Tab cycles through markers (geographic order: west-to-east, north-to-south).
- Arrow keys pan the map.
- `+`/`-` zoom.
- Enter selects marker.
- Escape deselects / zooms out.

#### Responsive Behavior

- **Desktop**: Map fills content area. Detail panel overlays on the right (40% width).
- **Tablet**: Map fills content area. Detail panel slides up from bottom (50% height).
- **Mobile**: Map fills viewport. Detail panel is a full-screen modal (with "X" to dismiss and return to map).

### Performance Budget

| Operation | Budget | Approach |
|-----------|--------|----------|
| TopoJSON parse | <50ms | Pre-simplified geometry, single parse on view mount |
| SVG path generation | <100ms | D3 `geoPath()` for ~65 polygons |
| Marker render | <10ms | 13 circles |
| Declutter | <1ms | 10 iterations, <50 markers |
| Zoom/pan animation | 300ms | D3 `transition()` on projection parameters |
| State click zoom | 500ms | Animated projection change |

### Data Loading

Geo assets loaded lazily when the map view is first activated:
1. `fetch('/static/geo/us-states.json')` + `fetch('/static/geo/ca-provinces.json')` in parallel.
2. `fetch('/static/geo/centroids.json')` (tiny, can bundle inline).
3. Parse TopoJSON → GeoJSON features.
4. Compute marker positions from template scope data + centroids.

Total additional payload: ~200KB (one-time, cacheable).

Template data reuses the same `data.templates` from `+page.server.ts`. No additional API calls.

---

## 6. VIEW SWITCHING & COEXISTENCE

### Navigation Model

The three views are not tabs to switch between. They are **zoom levels of the same space**:

```
Geographic Map  ←  broadest: "where in the world"
      ↕
Grouped Landscape  ←  middle: "what clusters exist"
      ↕
Topic Constellation  ←  deepest: "how do topics relate"
```

The browse page header includes three view controls — but presented as zoom metaphor, not mode switch:

```
┌─────────────────────────────────────────────────────────┐
│  Browse Templates                                        │
│  Find templates about issues that matter to you          │
│                                                          │
│  [🗺️ Map]  [📊 Landscape]  [✦ Constellation]            │
│   ^^^^^^    ^^^^^^^^^^^^    ^^^^^^^^^^^^^^^              │
│   slate      active=bold    slate                        │
│              + underline                                 │
└─────────────────────────────────────────────────────────────┘
```

**Default view**: Landscape (View 1). It's the lightest, fastest, and most immediately legible. Map and Constellation are progressive enhancement — available once the user develops spatial curiosity.

**URL encoding**: `/browse?view=landscape` (default, omitted), `/browse?view=map`, `/browse?view=constellation`. View preference is also stored in `localStorage` for return visits.

**Transition animation**: When switching views, templates that exist in both the old and new view animate between their positions (FLIP technique — First, Last, Invert, Play). This preserves spatial continuity: "that template moved from this cluster to that map position" rather than "the page reloaded."

### Shared State

All three views share:
- `searchQuery` — text filter
- `activeNeighborhoods` — topic filter (neighborhood toggles)
- `countryFilter` — geographic filter
- `selectedTemplate` — currently focused template (if any)

Switching views preserves all shared state. If a template is selected in the constellation, switching to the map shows the same template selected at its geographic position.

### Implementation Order

1. **View 1: Grouped Landscape** — Zero new dependencies. Replaces the current grid. Ships first.
2. **View 2: Topic Constellation** — Adds `umap-js` (~7KB). Requires `topic_embedding` data in page load. Ships second.
3. **View 3: Geographic Map** — Adds `d3-geo` + `topojson-client` (~35KB) + TopoJSON assets (~200KB). Ships third.

Each view is a separate Svelte component, lazy-loaded via dynamic import when activated:
```typescript
const viewComponents = {
  landscape: () => import('./views/LandscapeView.svelte'),
  constellation: () => import('./views/ConstellationView.svelte'),
  map: () => import('./views/MapView.svelte'),
};
```

---

## 7. VALIDATE: Experiential & Analytical Criteria

### Phenomenological Validation

**Dwelling test (View 1 — Landscape):**
- Does the grouped layout feel like a landscape with terrain, or just a re-sorted list?
- Can you perceive the geographic hierarchy (US federal → US state → US city → CA federal...) without reading headers?
- Does the white space between tiers feel like distance, or just emptiness?

**Dwelling test (View 2 — Constellation):**
- Can you identify topic neighborhoods by shape/color before reading any labels?
- Does zooming in feel like leaning closer to a map, or clicking through pages?
- After 3 visits, do you remember where clusters are without labels?

**Dwelling test (View 3 — Map):**
- Does the map feel informative or decorative? (If decorative, it's not earning its 200KB.)
- Does seeing your location on the map change how you relate to the templates?
- Does clicking a state feel like "going there" or "filtering"?

**Emotional arc test (all views):**
1. Arrive: "What is this?" → Orient within 2 seconds (atmosphere + structure)
2. Scan: "What's interesting?" → Identify relevant cluster within 5 seconds (peripheral + gestalt)
3. Focus: "Tell me about this one" → Read compact card, assess relevance in 3 seconds
4. Decide: "I want to use this" → Click, navigate to template detail
5. The arc should feel like: curiosity → recognition → clarity → action

**Somatic check:**
After 5 minutes of browsing: relaxed alertness (exploring) or tense shoulders (fighting the interface)?

### Analytical Validation

**Cognitive Load (all views):**
- [ ] User tracks ≤3 state dimensions (search + topic filter + geographic filter)
- [ ] No invisible state affecting layout
- [ ] Spatial positions stable across visits (deterministic layout)
- [ ] Filter changes are reversible (toggle off = restore previous state)

**Perceptual Fidelity:**
- [ ] Tier/cluster boundaries perceivable at peripheral resolution (~2 bits/sec: "this is a group")
- [ ] Individual templates readable at focal resolution (~50 bits/sec: title, metrics)
- [ ] Motion reserved for truthful signals only (active debates, new templates)
- [ ] Color encoding consistent across all three views (same neighborhood colors, same emphasis colors)

**Timing:**
- [ ] View switch: <300ms (FLIP animation completes)
- [ ] Filter change: <100ms (opacity transition begins)
- [ ] Hover tooltip: <16ms (single frame)
- [ ] Zoom/pan: <16ms (GPU-composited transform)
- [ ] Detail panel: 300ms slide-in

**Spatial Memory:**
- [ ] Same corpus → same layout (deterministic UMAP seed, stable tier ordering)
- [ ] Adding 1 template shifts neighbors slightly, not globally
- [ ] Removing 1 template collapses its space, doesn't re-randomize

**Living Structure:**
- [ ] Strong centers: Each tier/cluster has a visual anchor (the densest neighborhood)
- [ ] Levels of scale: View → Tier → Neighborhood → Card (4 nesting levels, each perceivable)
- [ ] Good shape: White space between tiers is positive (encodes distance, not just padding)
- [ ] Boundaries: Neighborhood borders are tinted zones, not hard lines
- [ ] Not-separateness: Color encoding flows from Map → Landscape → Constellation
- [ ] Roughness: Constellation positions are organic (UMAP), not grid-snapped

**Accessibility:**
- [ ] All views navigable by keyboard alone
- [ ] Screen reader announces view name, template count, active filters
- [ ] Each interactive element has visible focus indicator
- [ ] Constellation nodes have `role="button"` with descriptive `aria-label`
- [ ] Map regions have `role="button"` with state/province name
- [ ] Color encoding is redundant (shape/position also encode the information)
- [ ] Respects `prefers-reduced-motion` (skip FLIP transitions, constellation uses PCA instead of animated UMAP)

---

## 8. SEED DATA MAPPING

For reference, how the 13 seed templates distribute across the dimensional space:

### Geographic Tier Assignment

| Template | Country | Scope | Tier |
|----------|---------|-------|------|
| va-rural-health-lifeline | US | country | US Federal |
| congress-outdated-childhood-tracking | US | country | US Federal |
| colorado-preschool-standard | US | country | US Federal |
| city-bans-affordable-innovation | US | country | US Federal |
| heal-concrete-scars | US | country | US Federal |
| us-backlog-lifetimes | US | country | US Federal |
| apple-interest-gap | US | country | US Federal |
| oregon-healing-not-prisons | US | region (OR) | US — Oregon |
| san-francisco-tax-dark-units | US | locality (SF) | US — San Francisco |
| sfmta-vanity-subway | US | locality (SF) | US — San Francisco |
| san-francisco-sites-not-sweeps | US | locality (SF) | US — San Francisco |
| stop-starving-parks | CA | country | Canada |
| ontario-libraries-debt-free | CA | region (ON) | Canada — Ontario |
| bc-energy-revenue-justice | CA | region (BC) | Canada — British Columbia |
| montreal-bixi-clean-air | CA | locality (MTL) | Canada — Montréal |

### Topic Neighborhood Assignment

| Template | Category | Neighborhood |
|----------|----------|--------------|
| va-rural-health-lifeline | Healthcare | Health & Safety |
| san-francisco-sites-not-sweeps | Public Health | Health & Safety |
| oregon-healing-not-prisons | Criminal Justice | Health & Safety |
| congress-outdated-childhood-tracking | Digital Rights | Rights & Justice |
| us-backlog-lifetimes | Immigration | Rights & Justice |
| bc-energy-revenue-justice | Indigenous Rights | Rights & Justice |
| apple-interest-gap | Labor Rights | Rights & Justice |
| city-bans-affordable-innovation | Housing | Place & Infrastructure |
| san-francisco-tax-dark-units | Housing | Place & Infrastructure |
| heal-concrete-scars | Urban Development | Place & Infrastructure |
| sfmta-vanity-subway | Transportation | Place & Infrastructure |
| montreal-bixi-clean-air | Transportation | Place & Infrastructure |
| stop-starving-parks | Environment | Place & Infrastructure |
| colorado-preschool-standard | Education | Education & Opportunity |
| ontario-libraries-debt-free | Education | Education & Opportunity |

### Resulting Landscape Matrix (View 1)

```
                    Health &     Rights &     Place &        Education &
                    Safety       Justice      Infrastructure Opportunity
                    (rose)       (violet)     (amber)        (cyan)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
US Federal (7)      1            3            2              1
                    veterans     digital-rts  housing-3D     CO preschool
                                 immigration  urban-hwy
                                 labor-apple

US — Oregon (1)     1            —            —              —
                    justice-OR

US — San Fran (3)   1            —            2              —
                    sites-sweep                SF-vacancy
                                              SFMTA-subway

Canada (1)          —            —            1              —
                                              parks-CA

CA — Ontario (1)    —            —            —              1
                                                             ON libraries

CA — BC (1)         —            1            —              —
                                 indigenous

CA — Montréal (1)   —            —            1              —
                                              BIXI-MTL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

26 cells total. 13 occupied. 13 empty (frontier — visible invitation in the user's home tier).

---

## 9. FILE STRUCTURE

```
src/routes/browse/
├── +page.svelte              ← View switcher + shared state + filters
├── +page.server.ts           ← Extended: adds constellation data
├── views/
│   ├── LandscapeView.svelte  ← View 1: Grouped geography × topic
│   ├── ConstellationView.svelte ← View 2: UMAP semantic projection
│   └── MapView.svelte        ← View 3: D3-geo choropleth + markers
├── lib/
│   ├── landscape-data.ts     ← Tier/neighborhood computation
│   ├── constellation-data.ts ← UMAP + clustering + hull computation
│   ├── map-data.ts           ← Marker positioning + declutter
│   └── shared-state.svelte.ts ← Shared reactive state (runes)
└── components/
    ├── CompactCard.svelte    ← 2-3 line template card for landscape
    ├── ConstellationNode.svelte ← SVG circle with encoding
    ├── MapMarker.svelte      ← SVG circle on map projection
    ├── DetailPanel.svelte    ← Slide-in panel for selected template
    ├── ViewSwitcher.svelte   ← Map / Landscape / Constellation tabs
    └── NeighborhoodToggle.svelte ← Color-coded topic filter pills

static/geo/
├── us-states.json            ← TopoJSON US states
├── ca-provinces.json         ← TopoJSON Canadian provinces
└── centroids.json            ← State/province/city centroid lookup
```

---

## Appendix A: Color Palette

### Neighborhood Colors (Semantic, Consistent Across All Views)

| Neighborhood | Token | Hex | Use |
|---|---|---|---|
| Health & Safety | `health` | rose-500 `#f43f5e` | Left border, cluster fill, toggle pill |
| Rights & Justice | `rights` | violet-500 `#8b5cf6` | Left border, cluster fill, toggle pill |
| Place & Infrastructure | `place` | amber-500 `#f59e0b` | Left border, cluster fill, toggle pill |
| Education & Opportunity | `education` | cyan-500 `#06b6d4` | Left border, cluster fill, toggle pill |

### Power Emphasis Colors (Existing, Extended)

| Level | Token | Use |
|---|---|---|
| Federal | `congressional-500` / `blue-500` | Node stroke, tier header accent |
| State | `emerald-500` | Node stroke, tier header accent |
| Local | `amber-500` | Node stroke, tier header accent |
| Neutral | `slate-400` | Fallback |

### Country Fill Colors (Map + Constellation)

| Country | Fill | Rationale |
|---|---|---|
| US | `slate-700` | Dark, grounded, institutional |
| CA | `red-700` | Muted maple, not bright |
| Other | `slate-400` | Neutral, future-proof |

---

## Appendix B: Timing Constants

```typescript
export const BROWSE_TIMING = {
  /** View switch FLIP animation */
  VIEW_SWITCH: 300,
  /** Filter opacity transition */
  FILTER_FADE: 150,
  /** Detail panel slide-in */
  PANEL_SLIDE: 300,
  /** Tooltip appear delay (prevent flicker on fast mouse movement) */
  TOOLTIP_DELAY: 80,
  /** Tooltip appear transition */
  TOOLTIP_FADE: 100,
  /** Map state zoom animation */
  MAP_ZOOM: 500,
  /** Constellation zoom/pan momentum decay */
  CONSTELLATION_MOMENTUM: 300,
  /** Tier collapse animation (when filtered out) */
  TIER_COLLAPSE: 250,
  /** Cluster label fade-in (on zoom threshold) */
  CLUSTER_LABEL_FADE: 200,
} as const;
```

All ease-out by default. Linear only for opacity fades.

---

## Appendix C: Dependencies

| View | Package | Size (gzip) | Purpose |
|---|---|---|---|
| 1 — Landscape | *none* | 0 | Pure layout restructuring |
| 2 — Constellation | `umap-js` | ~7KB | Dimensionality reduction |
| 2 — Constellation | (optional) `hdbscan-js` | ~3KB | Cluster detection at scale |
| 3 — Map | `d3-geo` | ~12KB | Map projections |
| 3 — Map | `d3-selection` | ~8KB | SVG DOM manipulation |
| 3 — Map | `topojson-client` | ~2KB | TopoJSON → GeoJSON |
| 3 — Map | (assets) | ~200KB | US states + CA provinces TopoJSON |

Total incremental bundle for all three views: ~32KB JS + ~200KB geo assets (lazy-loaded).
