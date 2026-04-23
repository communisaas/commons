# The Bubble: Geographic Identity as a Living Object

> **STATUS: ASPIRATIONAL** — Design spec. Not yet implemented.

**Status:** Design Spec — Active (Rev 2)
**Author:** Architecture / Perceptual Engineering
**Created:** 2026-03-01
**Revised:** 2026-03-01 — Rev 2: From disambiguation widget to identity object
**Depends on:** Shadow Atlas R-tree (94,166 districts), Nominatim (self-hosted), `GeocodeService.detectCountry()`
**Supersedes:** Address verification paradigm in `location-picker-spec.md`
**Companion specs:** `SPATIAL-BROWSE-SPEC.md`, `GEOGRAPHIC-IDENTITY-ROUTING.md`, [`voter-protocol/specs/CRYPTOGRAPHY-SPEC.md`](../../../voter-protocol/specs/CRYPTOGRAPHY-SPEC.md) (canonical crypto)

---

## The Fundamental Error

The previous revision treated the bubble as a **disambiguation widget** — a transient form that appears when the system can't resolve the user's district, asks them to tap a segment, then vanishes. Per-layer `resolved: true/false`. Candidate arrays. The system owned the interaction; the user serviced it.

That's address verification wearing a costume.

---

## What the Bubble Actually Is

The bubble is the **user's geographic self**. One object. Theirs. Persistent. It represents the totality of what they've chosen to disclose about where they are — as a soft, spatial region with edges they control.

The bubble is not created by ambiguity. It is created by the user. It exists from the moment they provide any location signal — a postal code, a city name, a GPS ping, a country selection. Its initial size is the extent of what they gave. Its ongoing size is the extent of what they're willing to reveal.

**The person has agency over the bubble.** They can:
- **Pinch it smaller** — reveal more precision, shed district ambiguity
- **Let it breathe** — keep it large, accept the ambiguity, access only what the bubble qualifies them for
- **Drag it** — relocate
- **Feed it more postal characters** — ZIP → ZIP+4, FSA → full code — and watch it tighten

**The bubble is bound to the user's externalities and extremities:**
- **Externalities**: The district boundaries from the shadow-atlas. These are fences that exist in the world, not in the interface. The bubble passes through them. Where a fence crosses the bubble's interior, there is ambiguity. Where the bubble is entirely within a fence, there is resolution.
- **Extremities**: The bubble's perimeter. This is the limit of disclosure. Beyond it, the system has no information. The perimeter is the user's choice — they control where it falls.

**The bubble does not pop.** It does not vanish when districts resolve. It persists as the user's geographic identity. It can be very small (a block, all districts resolved) or very large (a country, only country-level templates accessible). Both are valid states. The system works with whatever the user provides.

### The Dual Relationship

Every template has a `minimum_precision_required`: `'none' | 'country' | 'state' | 'county' | 'district'`.

The bubble has a **precision level** — derived from how many district layers it resolves:
- Bubble spans multiple countries → precision = none
- Bubble within one country but multiple states → precision = country
- Bubble within one state but multiple counties → precision = state
- Bubble within one county but multiple CDs → precision = county
- Bubble within one CD (and all finer layers) → precision = district

**Template access = bubble precision >= template requirement.** A bubble at state precision can access state-level and national templates but not district-level ones. The system doesn't gate — it shows what the bubble qualifies for and gently indicates what would become available with more precision.

This is not progressive disclosure as a dark pattern ("give us more to unlock more"). It is honest geometry: "your bubble is larger than this template's jurisdiction, so we can't confirm you're in the right place."

---

## Why Postal Codes Seed the Bubble

Postal codes are the natural entry point because they're what people know, they're non-invasive, and they resolve surprisingly well:

| Country | Format | % That Resolve All Layers | Bubble Size When Seeded |
|---------|--------|---------------------------|-------------------------|
| UK | SW1A 1AA | **99.76%** | ~15 addresses. Tiny. Almost always fully resolved. |
| Canada | A1A 1A1 | **98.8%** | ~1 city block. Very small. Usually resolved. |
| US | 12345 | **85%** (CD), **~70%** (state leg) | ~6 km² avg. Medium. Often has 1-2 fences through it. |
| US | 12345-6789 | **>99%** | ~1 block face. Tiny. Resolved. |
| Australia | 2000 | **77%** | Varies wildly. Rural = huge, urban = medium. |
| Canada | A1A (FSA only) | **25%** | City-sized. Too large. Always ask for full code. |

But the bubble doesn't require a postal code. It can be seeded by:
- A city name (bubble = city boundary)
- GPS (bubble = accuracy circle, typically 10-50m radius)
- IP geolocation (bubble = city-level, ~10km radius)
- Country selection (bubble = entire country)
- Any combination — the smallest signal wins

The postal code is just the most common seed. The bubble is format-agnostic.

---

## 1. GROUND: The Felt Situation

### Who holds the bubble

A person arriving at this platform is deciding how much of themselves to bring. Location is intimate — not in the way an address is intimate (surveillance), but in the way commitment is intimate. "I live *here*, and I care about *this*." The bubble is the spatial dimension of that commitment.

They are:

- **Declaring standing.** "I'm in this postal code. This issue touches me." The bubble is their planted flag — soft-edged, but planted.
- **Calibrating trust.** The bubble's size IS the trust level. Large bubble = "I'll tell you my country, not more." Small bubble = "I trust you with my block." The system must never demand a smaller bubble than the user offers. It must work gracefully at every size.
- **In stolen time.** Bus ride. Waiting room. The 90 seconds after reading a headline. A postal code is 5-7 characters of muscle memory. The bubble should appear in the time it takes to look up from the keyboard.
- **On a phone.** One hand. Thumb range. The bubble lives under the thumb — pinchable, draggable, a physical thing in a physical hand.

### Somatic ground-tone

When the system asks to "verify your address": **contraction.** The body pulls back. "Should I give this to them?"

When the system says "enter your postal code": **neutral.** Automatic. The same gesture as ordering pizza.

When the bubble appears — **their** bubble, soft and round, showing them the territory they just claimed: **expansion.** A quiet "oh." Not a form to fill. A map of their own standing. They see the district boundaries running through their postal code and they *recognize the landscape* — "that's my side of the freeway."

And then: **agency.** The bubble is under their finger. They can pinch it. They can leave it. The choice is theirs. Nothing is demanded. The system adapts to whatever they give.

---

## 2. MAP: Experiential Qualities

### Atmosphere

**Alive and owned.** The bubble is not a system dialog. It's a soft, breathing shape on the screen that belongs to the user. It responds to their touch with physical conviction — spring dynamics, momentum, friction. It sits in their profile, not in a modal. It is theirs the way an avatar is theirs.

The atmosphere around the bubble is **cartographic calm** — muted geography, subtle district boundary lines, the quiet authority of a well-drawn map. The bubble itself is the only warm element: a soft glow, a gentle pulse of life, the single living thing on an otherwise still terrain.

### Affordance

**The bubble affords shaping.** Not tapping segments. Not selecting from a list. The bubble is a continuous, deformable region and its primary affordance is **pinch** — two fingers drawing closer to tighten the circle, narrowing the user's disclosed area.

On mobile: literal pinch gesture. The bubble shrinks toward the midpoint of the two fingers. District fences that were inside the bubble cross to the outside and dim — those districts are shed. The bubble tightens.

On desktop: scroll-wheel zooms the bubble (centered on cursor position). Click-drag repositions.

On any device: **typing more postal characters tightens the bubble too.** ZIP → ZIP+4 in the US. FSA → full code in Canada. The postal input field and the spatial gesture are two ways to do the same thing — make the bubble smaller. They can be interleaved: type a postal code, see the bubble, pinch it a little, type the +4, watch it snap tight.

### The bubble never pops

Resolution is not a terminal state. It's a quality of the bubble's current size. At any moment, the bubble has:
- **Resolved layers**: District boundaries that are entirely outside the bubble — the user is definitively in one district for that layer.
- **Ambiguous layers**: Fences still inside the bubble — the user *could* be in any of the districts that the fence separates.

As the bubble shrinks, resolved layers accumulate. As it grows, they shed. This is continuous, not binary. There is no "popping" — the bubble is always there, always alive, always the user's.

### Tension and resolution (revised)

The tension is not "which side of this line am I on?" — that's the system's question.

The tension is: **"how much do I want to reveal?"** The bubble's size is a disclosure decision. The fences visible inside it show the user exactly what precision they'd need to reach full resolution. The tension is between privacy and access — and it's the user's tension to hold, not the system's to resolve.

Resolution arrives gradually: each fence that crosses from inside-the-bubble to outside is a small satisfying event. The fence dims, the resolved district label brightens. The bubble doesn't pop — it *clarifies*.

### Invitation to imprecision

The bubble at full postal-code size is a valid state. If the user never pinches — that's fine. They access everything their bubble qualifies them for. Templates with `minimum_precision_required: 'state'` or `'country'` work immediately. District-level templates are visible but marked as "needs more location precision" — an invitation, not a gate.

This is structurally different from "please complete your profile." The bubble makes the geometry visible: "here's what you can access at this bubble size, and here's what you'd unlock by pinching a little tighter." The user sees the exact boundary that stands between them and the template. One pinch past that boundary, and it's theirs.

---

## 3. ARCHITECTURE: Cross-Codebase Design

### Data Flow

```
ANY LOCATION SIGNAL (postal code, GPS, city name, country)
    │
    ▼
commons: Bubble is born
    │  center = signal centroid
    │  radius = signal extent
    │
    ├──────── POST /v1/bubble-query ───────────────┐
    │         { center, radius }                    │
    │                                               ▼
    │                                    shadow-atlas (backend)
    │                                    ┌──────────┤
    │                                    │          │
    │                              Nominatim    R-tree
    │                              (centroid    (all districts
    │                               + bbox)     intersecting bbox)
    │                                    │          │
    │                                    └────┬─────┘
    │                                         │
    │◄───── BubbleGeometry ───────────────────┘
    │       (all fences + district clips within bubble extent)
    │
    ▼
Bubble renders: soft circle on terrain, fences visible inside
    │
    │  ── user pinches ──► bubble shrinks (CLIENT-SIDE ONLY)
    │  │                   fences cross perimeter → dim → districts resolve
    │  │                   no API call until bubble moves outside cached extent
    │  │
    │  ── user types +4 ──► bubble radius snaps smaller
    │  │                    same client-side fence shedding
    │  │
    │  ── user drags ──► bubble moves → re-query shadow-atlas
    │                    (new center outside cached bbox)
    │
    ▼
Bubble persists in user profile
    │  stores: center + radius + resolved districts
    │  never: raw postal code or address
    │
    ▼
Template access: bubble.precision >= template.minimum_precision_required
ZK proofs: resolved district_id → Merkle proof → circuit (unchanged)
```

**Critical architecture choice**: The shadow-atlas returns ALL district geometry within the bubble's initial extent in a single call. Pinching is entirely client-side — no round-trips. The client does simple point-in-polygon / circle-intersects-polygon math against the cached geometry as the bubble shrinks. Only when the user *moves* the bubble outside the cached extent does a new API call fire.

---

## 3A. TECHNOLOGY DECISIONS

Every choice below was made against the constraint: **the pinch gesture → visual update must complete within a single frame (16.6ms at 60fps, 8.3ms at 120Hz ProMotion).** The geometry computation itself is ~0.02ms. The rendering is the bottleneck. Every technology serves the frame budget.

### Rendering Stack

```
┌─────────────────────────────────────────────────────────────┐
│  BubbleTerrain.svelte — container div, absolute inset-0     │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ MapLibre GL JS canvas (z-0)                           │   │
│  │ - 5-layer hand-crafted muted style                    │   │
│  │ - interactive: false (zero event handlers)            │   │
│  │ - PMTiles from Cloudflare R2 (no tile server)         │   │
│  │ - GeoJSON source for ALL fences (native line layer)   │   │
│  │ - Fence opacity driven by data-driven expressions     │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ Bubble SVG overlay (z-10, absolute inset-0)           │   │
│  │ - Single <circle> element                             │   │
│  │ - Animated via CSS transform: scale() ONLY            │   │
│  │ - Glow via CSS filter: drop-shadow() (compositor)     │   │
│  │ - pointer-events: all (captures pinch/drag)           │   │
│  │ - position synced via map.project() in rAF            │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ Gesture capture layer (z-20, transparent)             │   │
│  │ - Pointer Events (raw, no library)                    │   │
│  │ - touch-action: none + preventDefault() for iOS       │   │
│  │ - Dispatches to bubble state, never to MapLibre       │   │
│  └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Why this stack:**

| Component | Choice | Why | Bundle |
|-----------|--------|-----|--------|
| Terrain basemap | MapLibre GL JS 5.x | Vector tiles, custom styling, `project()` for coordinate bridge, GPU-accelerated. Non-interactive = zero event overhead. | 262 KB gz |
| Tile source | Protomaps PMTiles on Cloudflare R2 | Single static file, HTTP Range Requests, no tile server, no API key. R2 egress free <10GB/mo. | 7.5 KB gz (protocol lib) |
| Tile style | Hand-crafted 5-layer JSON | 5 layers (background, earth, water, roads, boundaries) vs ~80 in a stock style. Fewer layers = fewer GL draw calls = faster mobile render. No glyphs, no sprites, no symbols. | 0 (inline JSON) |
| Bubble circle | SVG `<circle>` | Single DOM element. Animated via `transform: scale()` (compositor thread). Supports `aria-*` attributes. CSS `filter: drop-shadow()` for glow (compositor thread). | 0 |
| Fence rendering | MapLibre GeoJSON layer | Fences are geographic data — they must project correctly with the basemap. MapLibre renders them via WebGL natively. Opacity toggled per-fence via data-driven paint expressions. | 0 (MapLibre handles) |
| Gesture input | Pointer Events Level 3 (raw) | Unified touch/mouse/pen. `getCoalescedEvents()` for 120Hz tracking. `getPredictedEvents()` for fence precomputation. No library needed. | 0 |
| Geometry math | Custom inline (~80 lines TS) | Pre-project to Web Mercator on load. Segment-circle intersection with BBOX pre-check. Total: ~0.02ms/frame. No Turf, no JSTS, no WASM. | 0 |
| Spring physics | WAAPI + `linear()` easing | Native browser spring animation. `cubic-bezier(0.34, 1.56, 0.64, 1)` fallback for Safari (no `linear()` support). | 0 |
| Bubble birth | View Transitions API | Cross-browser (89.5% support, Interop 2026). Postal input morphs to bubble circle. `::view-transition-old/new` pseudo-elements. | 0 |
| Haptics | `navigator.vibrate()` | Chrome Android only — progressive enhancement. Visual glow pulse is primary feedback on all platforms. | 0 |
| **Total added bundle** | | | **~270 KB gz** |

**What we are NOT using:**

| Rejected | Why |
|----------|-----|
| Canvas 2D for bubble | SVG `<circle>` with CSS `transform` is compositor-thread-only during pinch. Canvas would require clearing and redrawing every frame from JS — unnecessary when the bubble is a single shape. |
| WebGL/WebGPU for bubble | MapLibre already owns the WebGL context. A second GL context wastes GPU memory. The bubble is one circle — GPU compute is absurd. |
| Turf.js | GeoJSON allocation on every frame. Haversine per segment. No BBOX pre-check. 60-80 KB for what takes 80 lines inline. |
| JSTS | 3.7 MB. Java factory patterns. Server-side precision for a client-side boolean test. |
| geos-wasm | 3.2 MB. Serialization overhead (GeoJSON → WKT → WASM heap) exceeds computation time. |
| Web Workers | Message-passing roundtrip (~0.1-0.5ms) exceeds geometry computation (~0.02ms). Workers add latency, not speed. |
| WASM SIMD | 350 segment tests at 50ns each = 17.5μs. WASM module loading + data marshaling dwarfs the 17.5μs savings. |
| rbush (R-tree) | 30 fences. Flat array scan with BBOX pre-check: ~0.001ms. Tree traversal overhead exceeds benefit at n=30. |
| Leaflet | No WebGL = raster tile rendering. No custom vector styling. No `project()` for sub-pixel coordinate sync. |
| hammer.js / any gesture lib | Pointer Events give us raw two-finger distance + `getCoalescedEvents()` + `getPredictedEvents()`. No library adds value. |

### The Geometry Engine (~80 lines, zero deps)

```typescript
// bubble-geometry.ts — the complete client-side intersection engine

const DEG2RAD = Math.PI / 180;
const R = 6378137; // WGS84 semi-major axis, meters

/** Project WGS84 to Web Mercator meters. 1 trig call. */
export function toMerc(lng: number, lat: number): [number, number] {
  return [lng * DEG2RAD * R, Math.log(Math.tan((90 + lat) * DEG2RAD / 2)) * R];
}

/** Pre-projected fence stored as flat Float64Array + BBOX. */
export interface ProjectedFence {
  id: string;
  layer: string;
  sides: [{ id: string; name: string }, { id: string; name: string }];
  landmark?: string;
  coords: Float64Array;   // [x0, y0, x1, y1, ...] in Mercator meters
  vertexCount: number;
  minX: number; minY: number; maxX: number; maxY: number;
}

/** Pre-projected district stored as flat Float64Array + BBOX. */
export interface ProjectedDistrict {
  id: string;
  name: string;
  display: string;
  layer: string;
  coords: Float64Array;   // [x0, y0, x1, y1, ...] polygon ring
  vertexCount: number;
  minX: number; minY: number; maxX: number; maxY: number;
}

/** Test if a line segment intersects a circle. Pure arithmetic. */
function segmentHitsCircle(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, r: number
): boolean {
  const dx = bx - ax, dy = by - ay;
  const fx = ax - cx, fy = ay - cy;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1) || (t1 < 0 && t2 > 1);
}

/** Test if a fence has ANY segment intersecting the bubble circle. */
export function fenceInsideBubble(f: ProjectedFence, cx: number, cy: number, r: number): boolean {
  // BBOX cull (~80% of fences eliminated here)
  if (cx + r < f.minX || cx - r > f.maxX || cy + r < f.minY || cy - r > f.maxY) return false;
  for (let i = 0; i < f.vertexCount - 1; i++) {
    const j = i * 2;
    if (segmentHitsCircle(f.coords[j], f.coords[j+1], f.coords[j+2], f.coords[j+3], cx, cy, r))
      return true;
  }
  return false;
}

/** Test if the bubble center is inside a district polygon (winding number). */
export function pointInDistrict(d: ProjectedDistrict, px: number, py: number): boolean {
  if (px < d.minX || px > d.maxX || py < d.minY || py > d.maxY) return false;
  let winding = 0;
  for (let i = 0; i < d.vertexCount - 1; i++) {
    const j = i * 2;
    const y0 = d.coords[j+1], y1 = d.coords[j+3];
    if (y0 <= py) {
      if (y1 > py) {
        const cross = (d.coords[j+2] - d.coords[j]) * (py - y0) - (px - d.coords[j]) * (y1 - y0);
        if (cross > 0) winding++;
      }
    } else if (y1 <= py) {
      const cross = (d.coords[j+2] - d.coords[j]) * (py - y0) - (px - d.coords[j]) * (y1 - y0);
      if (cross < 0) winding--;
    }
  }
  return winding !== 0;
}

/** Project API response into pre-computed structures. Called once on load. */
export function projectResponse(
  fences: Fence[], districts: BubbleDistrict[]
): { projFences: ProjectedFence[]; projDistricts: ProjectedDistrict[] } {
  // ...project each coordinate through toMerc, compute BBox, pack Float64Arrays
}

/** Per-frame: compute which fences are inside the bubble, which districts contain the center. */
export function computeBubbleState(
  projFences: ProjectedFence[], projDistricts: ProjectedDistrict[],
  centerLng: number, centerLat: number, radiusMeters: number
): { insideFences: Set<string>; containingDistricts: Map<string, ProjectedDistrict> } {
  const [cx, cy] = toMerc(centerLng, centerLat);
  const insideFences = new Set<string>();
  for (const f of projFences) {
    if (fenceInsideBubble(f, cx, cy, radiusMeters)) insideFences.add(f.id);
  }
  const containingDistricts = new Map<string, ProjectedDistrict>();
  for (const d of projDistricts) {
    if (pointInDistrict(d, cx, cy)) containingDistricts.set(d.layer, d);
  }
  return { insideFences, containingDistricts };
}
```

**Performance budget**: 30 fences × 20 vertices + 20 districts × 40 vertices = ~1,400 segment tests. BBOX culls ~80% → ~350 tests × ~50ns = **0.02ms per frame**. 800x headroom within the 16.6ms budget.

### Gesture Architecture

```typescript
// bubble-gestures.ts — Pointer Events, no library

const pointerCache: PointerEvent[] = [];
let prevDist = -1;

function onPointerDown(ev: PointerEvent) {
  pointerCache.push(ev);
  el.setPointerCapture(ev.pointerId);
}

function onPointerMove(ev: PointerEvent) {
  const idx = pointerCache.findIndex(e => e.pointerId === ev.pointerId);
  if (idx >= 0) pointerCache[idx] = ev;

  if (pointerCache.length === 2) {
    // Pinch: compute scale from inter-finger distance
    const curDist = Math.hypot(
      pointerCache[0].clientX - pointerCache[1].clientX,
      pointerCache[0].clientY - pointerCache[1].clientY
    );
    if (prevDist > 0) {
      const scale = curDist / prevDist;
      bubbleState.radius *= scale; // Triggers reactive recomputation
    }
    prevDist = curDist;

    // Predictive: pre-compute fence intersections for next frame
    const predicted = ev.getPredictedEvents();
    if (predicted.length > 0) {
      preComputeFences(predicted[predicted.length - 1]);
    }
  } else if (pointerCache.length === 1) {
    // Drag: move bubble center
    // Convert screen delta to geo delta via map.unproject()
  }
}

function onPointerUp(ev: PointerEvent) {
  pointerCache.splice(pointerCache.findIndex(e => e.pointerId === ev.pointerId), 1);
  if (pointerCache.length < 2) prevDist = -1;
  // Trigger spring settle animation on release
}
```

**iOS Safari critical path**: `touch-action: none` is not supported. Intercept with:
```typescript
el.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
el.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
```

### MapLibre Style (5 layers, no fonts, no sprites)

```typescript
const MUTED_TERRAIN_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    protomaps: {
      type: 'vector',
      url: 'pmtiles://https://cdn.commons.email/tiles/na.pmtiles',
      attribution: '© OpenStreetMap'
    }
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#f8fafc' } },
    { id: 'earth', type: 'fill', source: 'protomaps', 'source-layer': 'earth',
      paint: { 'fill-color': '#f8fafc' } },
    { id: 'water', type: 'fill', source: 'protomaps', 'source-layer': 'water',
      paint: { 'fill-color': '#f1f5f9', 'fill-opacity': 0.3 } },
    { id: 'roads', type: 'line', source: 'protomaps', 'source-layer': 'roads',
      paint: { 'line-color': '#ffffff', 'line-width': 0.5, 'line-opacity': 0.4 } },
    { id: 'boundaries', type: 'line', source: 'protomaps', 'source-layer': 'boundaries',
      paint: { 'line-color': '#e2e8f0', 'line-width': 0.5, 'line-opacity': 0.2, 'line-dasharray': [2, 2] } }
  ]
};
```

### Animation Architecture

| Moment | API | Why |
|--------|-----|-----|
| Bubble birth (postal → circle) | View Transitions API | `::view-transition-old(location-widget)` fades input, `::view-transition-new(location-widget)` scales circle from 0. Cross-browser since 2025. |
| Pinch gesture (continuous) | CSS `transform: scale()` via `requestAnimationFrame` | Compositor-thread-only. No layout, no paint. The bubble `<circle>` gets `style.transform = scale(...)` on each frame. |
| Bubble glow (continuous) | CSS `filter: drop-shadow()` | Compositor-thread. Glow radius derived from bubble state — intensifies where edge crosses a fence. |
| Fence crossing (discrete) | CSS `filter` animation + `navigator.vibrate()` | Glow pulse: 300ms keyframe on the `<circle>`. Haptic: `[15, 10, 15]` pattern (Chrome Android only). |
| Pinch release (spring settle) | WAAPI `element.animate()` | `linear()` easing with 40 keypoints for spring curve (stiffness: 300, damping: 20). Safari fallback: `cubic-bezier(0.34, 1.56, 0.64, 1)`. |
| Bubble tighten (ZIP → ZIP+4) | WAAPI `element.animate()` | 300ms ease-out from current radius to new radius. |
| Drag inertia | `requestAnimationFrame` | Velocity decay: `v *= 0.92` per frame, applied to center. Stops when `|v| < 0.5px`. |

### Legacy Code Removal Plan

The Bubble paradigm supersedes the 5-signal inference architecture. Here is the complete removal manifest:

**REMOVE (dead code in the Bubble era):**

| File | Lines | What it does | Why dead |
|------|-------|-------------|---------|
| `components/template-browser/LocationFilter.svelte` | ~859 | 5-signal inference UI, progressive breadcrumbs, IndexedDB | Entire paradigm replaced by Bubble |
| `components/template-browser/DistrictBreadcrumb.svelte` | ~200 | Polymorphic breadcrumb segment, inline address form | Bubble replaces address-based district resolution |
| `components/template-browser/InlineAddressResolver.svelte` | ~150 | Country-specific address form inside breadcrumb | Address entry replaced by postal code + pinch |
| `components/template-browser/PrivacyBadge.svelte` | 39 | "Your location, your control" tooltip | Messaging tied to LocationFilter architecture |
| `core/location/inference-engine.ts` | ~300 | 5-signal priority engine (IP, browser, OAuth, behavioral, verified) | Bubble seeder replaces inference |
| `core/location/storage.ts` | ~200 | IndexedDB schema for signals, template views, inferred location | No signals to store — Bubble persists in User model |
| `core/location/behavioral-tracker.ts` | ~150 | Track template views for location inference | Behavioral signals → irrelevant with explicit Bubble |
| `core/location/oauth-location-sync.ts` | ~100 | Extract location from OAuth profiles (Google/FB/LinkedIn) | OAuth location → Bubble seeder (much simpler) |
| `core/location/types.ts` | 445 | LocationSignal, InferredLocation, signal weights/expiration | Inference types → BubbleState types |
| `core/location/index.ts` | ~20 | Re-exports all location modules | All exports become dead |
| `services/zipDistrictLookup.ts` | 156 | GitHub ZIP→district lookup table fallback | Shadow Atlas is canonical via bubble-query |

**Total removal: ~2,619 lines of dead code.**

**REPLACE (logic migrates to Bubble):**

| File | Action |
|------|--------|
| `core/location/template-filter.ts` | Filtering logic → `bubble-state.svelte.ts` derived state. Template access = `bubble.precision >= template.minimum_precision_required`. |
| `routes/+page.svelte` (LocationFilter integration) | Remove LocationFilter import + `handleLocationFilterChange()`. Replace with Bubble component in profile/header. |

**KEEP (still needed alongside Bubble):**

| File | Why |
|------|-----|
| `components/ui/LocationPicker.svelte` | Reusable autocomplete for template creation (GeographicScopeEditor) |
| `components/template-browser/LocationAutocomplete.svelte` | Reusable breadcrumb autocomplete for ClarificationPanel |
| `core/location/location-search.ts` | Server-proxied Nominatim — used by autocomplete components |
| `core/location/location-resolver.ts` | `resolveToGeoScope()`, `displayGeoScope()` — template creation + message results |
| `core/location/state-codes.ts` | US_STATES, CA_PROVINCES lookup maps — utility |
| `core/location/census-api.ts` | `getBrowserGeolocation()` — optional Bubble seeder |
| `core/location/district-config.ts` | Country-specific terminology — used by address resolution routes |
| `routes/api/location/search/+server.ts` | Nominatim proxy for autocomplete |
| `routes/api/location/ip-lookup/+server.ts` | Optional Bubble seeder from IP |
| `routes/api/location/resolve/+server.ts` | Coordinates → district for ZK proofs (post-Bubble) |
| `routes/api/location/resolve-address/+server.ts` | Address → credential issuance |
| All Prisma schema fields | `district_hash`, `district_verified`, `TemplateJurisdiction`, `TemplateScope` — structural |

**ARCHIVE (superseded spec):**

| File | Action |
|------|--------|
| `docs/specs/location-picker-spec.md` | Move to `docs/specs/archived/`. Historical record. Superseded by this spec. |

---

## 4. SHADOW-ATLAS: `POST /v1/bubble-query`

### Design Principle

The endpoint doesn't resolve anything. It doesn't decide what's ambiguous. It returns **raw geometry** — all district fences and district clip regions within a bounding box — and lets the client compute resolution based on the bubble's current state.

This is the right separation: the shadow-atlas is an oracle of district geography. The bubble is a client-side object that reads the geography. The oracle doesn't need to know about the bubble.

### Request

```typescript
interface BubbleQueryRequest {
  /**
   * Center point of the query region.
   * Can come from: postal code centroid, GPS, city centroid, manual placement.
   */
  center: { lat: number; lng: number };

  /**
   * Radius in meters. Defines the extent to query.
   * The server returns all geometry within this circle + a 20% buffer
   * (so the client has headroom for the user to grow the bubble slightly
   * without needing a re-query).
   */
  radius: number;

  /**
   * Optional: which district layers to include.
   * Default: all available layers for the country at this point.
   */
  layers?: string[];

  /**
   * Optional: postal code string for display purposes.
   * If provided, the response includes the postal code's own extent
   * (for setting the initial bubble size).
   */
  postal_code?: string;
}
```

### Response

```typescript
interface BubbleQueryResponse {
  /** Echo back the query center */
  center: { lat: number; lng: number };

  /** The actual query extent (center + radius + 20% buffer) */
  queryBbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };

  /** If postal_code was provided: its geographic extent for initial bubble sizing */
  postalExtent?: {
    centroid: { lat: number; lng: number };
    bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
    /** Approximate radius in meters */
    radius: number;
    /** Detected country */
    country: 'US' | 'CA' | 'GB' | 'AU';
  };

  /**
   * All district fences within the query extent.
   *
   * A fence is the boundary line between two adjacent districts
   * in the same layer. This is what the bubble renders as dashed lines.
   * The client tests each fence against the bubble circle to determine
   * which are "inside" (causing ambiguity) vs "outside" (irrelevant).
   */
  fences: Fence[];

  /**
   * All districts that intersect the query extent, with their
   * clipped geometries. The client tests each against the bubble
   * circle to determine which districts the user could be in.
   */
  districts: BubbleDistrict[];

  /**
   * Officials for the center point (best-guess representatives).
   * Updated client-side as the bubble resolves specific districts.
   */
  officials?: Official[];
}

interface Fence {
  /** Unique fence ID (hash of the two district IDs it separates) */
  id: string;

  /** Which district layer: "congressional", "state_senate", "state_house", etc. */
  layer: string;

  /**
   * The boundary line, clipped to query extent.
   * Simplified to <30 vertices for wire efficiency.
   */
  geometry: GeoJSON.LineString;

  /** The two districts this fence separates */
  sides: [
    { districtId: string; name: string },
    { districtId: string; name: string }
  ];

  /**
   * Human-readable landmark along the fence.
   * Derived from reverse-geocoding the fence midpoint.
   * e.g., "Market Street", "I-80", "Columbia River"
   */
  landmark?: string;

  /** How the landmark was derived */
  landmarkSource?: 'road' | 'river' | 'railway' | 'boundary_name' | 'address_range';
}

interface BubbleDistrict {
  /** District ID: "cd-0611", "sldu-06001", etc. */
  id: string;

  /** Short name: "CA-11", "SD-1" */
  name: string;

  /** Display name: "California's 11th Congressional District" */
  display: string;

  /** Layer: "congressional", "state_senate", "state_house", "county", etc. */
  layer: string;

  /**
   * District geometry clipped to query extent.
   * Simplified to <50 vertices. Used by the client for
   * circle-polygon intersection testing during pinch.
   */
  clipGeometry: GeoJSON.Polygon;
}

interface Official {
  name: string;
  title: string;
  party?: string;
  districtId: string;
  photoUrl?: string;
}
```

### Implementation

```
packages/shadow-atlas/src/serving/
├── bubble-service.ts          ← NEW: Geometry query for bubble extent
├── api.ts                     ← Add route: POST /v1/bubble-query
├── district-service.ts        ← Existing: R-tree + PIP (reused)
├── geocode-service.ts         ← Existing: Nominatim (extended for postal extent)
└── fence-service.ts           ← NEW: Compute boundary lines between adjacent districts
```

#### Fence Computation

Fences are the boundary lines between adjacent districts in the same layer. They're computed once and cached:

1. For each pair of districts in the same layer whose bounding boxes overlap:
   - Compute the geometric intersection of their boundaries
   - If the intersection produces a LineString (shared boundary): that's a fence
2. Store fences in a `fences` table indexed by bounding box (R-tree)
3. At query time: R-tree lookup for fences within the query extent, clip to extent

**Pre-computation cost**: O(n²) per layer, but with R-tree spatial filtering this is ~O(n log n). For 435 CDs, ~500 fence segments. For 7,400 state house districts, ~15,000 fence segments. Run once during `build-district-db.ts`.

**New table:**
```sql
CREATE TABLE fences (
  id TEXT PRIMARY KEY,               -- hash of district_a_id + district_b_id
  layer TEXT NOT NULL,               -- "congressional", "state_house", etc.
  district_a_id TEXT NOT NULL,
  district_b_id TEXT NOT NULL,
  district_a_name TEXT NOT NULL,
  district_b_name TEXT NOT NULL,
  geometry TEXT NOT NULL,            -- GeoJSON LineString
  landmark TEXT,                     -- Reverse-geocoded name of the boundary feature
  landmark_source TEXT,              -- "road", "river", "railway", etc.
  min_lon REAL NOT NULL,
  max_lon REAL NOT NULL,
  min_lat REAL NOT NULL,
  max_lat REAL NOT NULL,
  FOREIGN KEY (district_a_id) REFERENCES districts(id),
  FOREIGN KEY (district_b_id) REFERENCES districts(id)
);

CREATE VIRTUAL TABLE fence_rtree USING rtree(
  id, min_lon, max_lon, min_lat, max_lat
);

CREATE INDEX idx_fence_layer ON fences(layer);
```

#### Landmark Generation (Build-Time)

For each fence, reverse-geocode the midpoint via Nominatim to extract the road/river/railway name that the boundary follows. Store as `landmark` on the fence row. This runs during the build step, not at query time.

Most district boundaries follow:
- Major roads (40%)
- Rivers and waterways (25%)
- Railways and transit corridors (10%)
- Administrative boundaries with named features (15%)
- Arbitrary survey lines (10%) — these get no landmark

#### Performance

| Operation | Budget | Approach |
|-----------|--------|----------|
| Fence R-tree query | <5ms | SQLite virtual table, spatial index |
| District clip query | <10ms | Existing R-tree + simplification |
| Postal code geocode | <50ms | Nominatim local instance |
| Landmark lookup | 0ms | Pre-computed, stored on fence row |
| Total response | <100ms | Well within 300ms target |
| Response size | <50KB | Simplified geometries, ~30 fences + ~20 districts typical |
```

### Postal Code Bounding Box Sources

The system needs to know the geographic extent of a postal code (not just its centroid) to set the bubble's initial radius. Three strategies:

**Strategy A (Preferred): Nominatim bounding box.**
Nominatim returns a `boundingbox` field for every result: `[south_lat, north_lat, west_lng, east_lng]`. For postal code searches, this is the extent of the postal area. Available for US (ZCTAs in TIGER), Canada (FSAs in OSM), UK (postcode sectors in OS Open Data), and Australia (4-digit areas in ABS data via OSM). The bubble's initial radius is derived from this bbox.

**Strategy B (Fallback): Buffer around centroid.**
If Nominatim returns no bounding box (rare), use a country-specific buffer radius:
- US ZIP: 3km radius (average ZIP covers ~6km²)
- CA full code: 500m radius (very granular)
- UK postcode: 100m radius (covers ~15 addresses)
- AU 4-digit: 10km radius (coarser)

**Strategy C (Future): Pre-computed postal geometry table.**
For pixel-perfect bubble seeding, ingest actual postal code boundary polygons:
- US: ZCTA shapefiles from Census Bureau (free, ~50MB)
- CA: FSA boundary file from StatCan (free, ~5MB)
- UK: Code-Point Open from Ordnance Survey (free)
- Store in a separate `postal_areas` table in shadow-atlas DB, indexed by postal code

Strategy A is sufficient for MVP. Strategy C provides exact bubble radii and should be added when the corpus grows beyond US/CA.

### Country Detection (Extended)

Extend the existing `GeocodeService.detectCountry()`:

```typescript
static detectCountry(postalCode: string): 'US' | 'CA' | 'GB' | 'AU' | null {
  const trimmed = postalCode.trim().toUpperCase();

  // US: 5-digit or 5+4
  if (/^\d{5}(-\d{4})?$/.test(trimmed)) return 'US';

  // Canada: A1A 1A1 or A1A1A1
  if (/^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/.test(trimmed)) return 'CA';

  // UK: complex but distinctive
  // Outcode (1-2 letters + 1-2 digits) + space + incode (digit + 2 letters)
  if (/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/.test(trimmed)) return 'GB';

  // Australia: exactly 4 digits
  if (/^\d{4}$/.test(trimmed)) return 'AU';

  return null;
}
```

Note: AU (4-digit) vs partial US ZIP (4-digit, happens with leading zero ZIPs like 0210): resolved by requiring 5 digits for US. The only collision is if a user enters "0210" — handle by asking country if ambiguous.

---

## 5. COMMONS: The Bubble Component

### Component Architecture

```
src/lib/components/bubble/
├── Bubble.svelte              ← THE bubble. SVG circle + terrain + fences. Pinchable.
├── BubbleInput.svelte         ← Postal code entry that seeds/tightens the bubble
├── BubbleStatus.svelte        ← What the bubble currently resolves (district badges)
├── BubbleTerrain.svelte       ← The geography under the bubble (muted, cartographic)
└── bubble-state.svelte.ts     ← Shared reactive state: center, radius, cached geometry
```

The bubble is not in a `/location/` folder. It's not a "location component." It's the bubble.

### Bubble State: The Single Source of Truth

```typescript
// bubble-state.svelte.ts — Svelte 5 runes

export interface BubbleState {
  /** Center of the bubble in geographic coordinates */
  center: { lat: number; lng: number };

  /**
   * Radius in meters. This is the user's disclosed extent.
   * Seeded by the location signal, shaped by the user's gestures.
   *
   * Typical values:
   *   Country selection:  ~2,000,000m (continental)
   *   City name:          ~10,000m
   *   US ZIP:             ~3,000m (average ZIP extent)
   *   Canadian full code: ~500m
   *   UK postcode:        ~100m
   *   US ZIP+4:           ~50m (block face)
   *   GPS:                ~20m (accuracy circle)
   */
  radius: number;

  /** Cached district geometry within the bubble's initial query extent */
  cachedExtent: {
    bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
    fences: Fence[];
    districts: CachedDistrict[];
  } | null;

  /** Derived: current precision level */
  precision: 'none' | 'country' | 'state' | 'county' | 'district';

  /** Derived: which layers are resolved at current radius */
  resolvedLayers: Record<string, { id: string; name: string; display: string }>;

  /** Derived: which layers still have fences inside the bubble */
  ambiguousLayers: Record<string, Array<{ id: string; name: string; coverage: number }>>;
}

interface Fence {
  /** The boundary line between two districts, clipped to query extent */
  geometry: GeoJSON.LineString;
  /** Which layer this fence belongs to */
  layer: string;
  /** District on each side */
  sides: [{ id: string; name: string }, { id: string; name: string }];
  /** Landmark label along the fence, if available */
  landmark?: string;
}

interface CachedDistrict {
  id: string;
  name: string;
  display: string;
  layer: string;
  /** Geometry clipped to query extent (for intersection testing) */
  clipGeometry: GeoJSON.Polygon;
}
```

**All derived state is computed client-side** from `center`, `radius`, and `cachedExtent`. When the user pinches, only `radius` changes. The derived state recomputes instantly by testing which fences are still inside the circle. Zero API calls during pinching.

### The Bubble: Visual Specification

The bubble is an SVG element that renders on top of a muted terrain layer.

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│       muted terrain (slate-100 land, white roads)   │
│                                                     │
│              ┌─────────────┐                        │
│           ╱                   ╲                      │
│         ╱     · · · · · · · ·   ╲    ← bubble edge  │
│        │    ·                 ·   │     (soft glow)  │
│        │   · ╱ ╱ ╱ ╱ ╱ ╱ ╱   ·  │                  │
│        │  · ╱  Market St   ╱  ·  │    ← fence       │
│        │   ╱ ╱ ╱ ╱ ╱ ╱ ╱ ╱   ·  │     (dashed)     │
│        │    ·   CD-12        ·   │                  │
│         ╲    · · · · · · · ·   ╱                    │
│           ╲     CD-11        ╱                      │
│              └─────────────┘                        │
│                                                     │
│  94103 ▏▎▍▌▋▊                     pinch to tighten  │
│  ┌──────────────────┐                               │
│  │ 🏛 CA-11 resolved │  ⚪ State SD-11 resolved      │
│  │ ⚪ County: SF     │  ◐ State HD: 2 possible       │
│  └──────────────────┘                               │
└─────────────────────────────────────────────────────┘
```

#### The Bubble Circle

- **Shape**: True circle (not ellipse, not rectangle). Circles are the most natural soft boundary — no corners, no orientation bias. The radius is uniform disclosure in all directions.
- **Fill**: Radial gradient from `transparent` at center to `blue-400/8` at edge. The center is fully clear — you see the terrain through it. The edge has a whisper of color — enough to perceive the boundary.
- **Edge**: Not a hard stroke. A soft glow: `filter: drop-shadow(0 0 8px rgba(59, 130, 246, 0.15))`. The edge feels atmospheric, not geometric.
- **Edge encoding**: Where the bubble edge crosses a district boundary, the glow intensifies to `blue-400/30` — a visual cue that "this is where your disclosure matters." Where the edge is in open terrain (no fences nearby), the glow is minimal.

#### Fences Inside the Bubble

District boundaries that pass through the bubble interior:

- **Line style**: `stroke-slate-400/50 stroke-width-1 stroke-dasharray-3-2`. Subtle dashed line. Not bold — fences are facts of geography, not UI elements.
- **Landmark label**: If a fence has a `landmark` field, the name is rendered along the line: `text-[10px] font-brand text-slate-400/60 fill-slate-400/60`. Italic. Oriented along the fence direction.
- **Fences dim as they approach the bubble edge**: `opacity` ramps from 1.0 at the center to 0.3 at the perimeter. Fences near the center are important (the user is clearly straddling them). Fences near the edge are marginal (a small pinch would shed them).

#### Fences Outside the Bubble

District boundaries in the terrain outside the bubble:

- **Line style**: `stroke-slate-200/30 stroke-width-0.5`. Barely visible. They exist in the world but not in the user's disclosure.
- **Purpose**: Provide geographic context. If the user sees a fence just barely outside their bubble, they understand: "one more pinch-out and I'd be ambiguous on that layer too."

#### Terrain Layer

Behind the bubble, a muted geographic base:

- **Roads**: `stroke-white/40 stroke-width-0.5` — white hairlines on `slate-50` ground.
- **Water**: `fill-slate-100/30` — barely distinguished from land.
- **No labels** except the landmark names on fences. The terrain is context, not content.
- **Source**: Pre-rendered tile from OSM at the appropriate zoom level, desaturated and lightened. Or: a simplified vector rendering from the same Nominatim/OSM data the shadow-atlas already uses.
- **Minimal**: at small bubble sizes (block-level), show roads only. At large bubble sizes (city-level), show major roads and water features. Never show buildings, parks, or POIs — the bubble is about districts, not about maps.

### The Pinch Interaction

**Mobile (primary surface):**

The bubble responds to standard multi-touch gestures:

1. **Pinch-to-zoom** (two fingers closing): Bubble radius decreases. The circle shrinks. Fences near the edge cross the perimeter and dim — the layer resolves. The shrink follows the gesture frame-by-frame with no latency (client-side math only).

2. **Reverse pinch** (two fingers opening): Bubble radius increases. The circle grows. Fences that were outside enter the bubble and activate — layers become ambiguous again. The user is choosing to disclose less. This must work as smoothly as shrinking. **The system never prevents the user from making the bubble larger.**

3. **Drag** (one finger on the bubble): Bubble center moves. The fences inside update (some enter, some leave). If the bubble moves outside the cached extent, a new API call fires (with loading indicator — the terrain beyond the cache is blank until the response arrives).

4. **Inertia and spring**: After a pinch release, the bubble settles with spring dynamics: slight overshoot (5%), then settle (200ms, `cubic-bezier(0.34, 1.56, 0.64, 1)`). After a drag release, momentum carries the bubble for 300ms with friction decay.

**Desktop:**

1. **Scroll wheel on bubble**: Radius changes. Scroll up = shrink, scroll down = grow.
2. **Click and drag**: Moves the bubble center.
3. **Shift + scroll**: Fine-grained radius change (1/4 speed).

**Keyboard:**

1. **Focus on bubble** (Tab to reach it): `+`/`-` adjust radius in 10% steps.
2. **Arrow keys**: Move center by 1/10 of current radius per keystroke.
3. **Enter**: "Confirm current bubble" (saves current state, no further action needed unless the user returns to adjust).

**Typing postal characters:**

When the user types into the postal input field:
- The bubble center snaps to the new postal code's centroid (animated, 300ms)
- The bubble radius snaps to the new postal code's extent (animated, 300ms)
- If the new extent is outside the cached area, a new API call fires

This means: typing `94103` → bubble appears at ZIP extent. Then typing `-3114` → bubble smoothly tightens to ZIP+4 extent. The postal field and the gesture are two interfaces to the same object.

### BubbleStatus: What the Bubble Currently Resolves

Below the bubble visualization, a live readout of the bubble's resolution state:

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  ● Congressional: CA-11 (Pelosi)                    │  ← resolved (solid dot)
│  ● County: San Francisco                            │  ← resolved
│  ● State Senate: SD-11                              │  ← resolved
│  ◐ State House: HD-17 or HD-19                      │  ← ambiguous (half dot)
│    ↳ fence: Guerrero Street                         │     (the fence label)
│                                                     │
│  Bubble precision: county                           │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒░░  (visual precision bar)     │
│  country  state  county  district                   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Resolved layers**: `●` solid dot + district name + representative name (if officials data available). `text-slate-800 font-brand font-medium`.

**Ambiguous layers**: `◐` half-filled dot + candidate list + the fence that separates them. `text-slate-500 font-brand`. The fence label is actionable — hovering/tapping it highlights that fence in the bubble visualization.

**Precision bar**: A 4-segment progress indicator showing the bubble's current precision level. Filled segments = achieved. Hollow = not yet. The bar doesn't demand progress — it shows position.

**Template access hint** (contextual, only when relevant): When the user is browsing a template that requires higher precision than the bubble provides:
```
This template is for your congressional district.
Tighten your bubble past the Guerrero Street line to access it.
```
This is not a gate. It's a map legend. "Here is the geometry; here is what it means."

### Persistence

The bubble persists across sessions. Stored in the user profile as:

```typescript
interface StoredBubble {
  center: { lat: number; lng: number };
  radius: number;
  /** ISO timestamp of last modification */
  updatedAt: string;
  /** How the bubble was seeded */
  seedSource: 'postal' | 'gps' | 'city' | 'country' | 'manual';
  /** Original postal code if seeded by postal entry */
  postalCode?: string;
}
```

**What is NOT stored**: The raw postal code is not used for anything after the bubble is seeded. The bubble's center and radius are the canonical representation. The postal code is a convenience hint for display ("94103") but the system uses the geometry, not the string.

**Stored WHERE**: In the commons database on the `User` model (new fields: `bubble_lat`, `bubble_lng`, `bubble_radius`, `bubble_updated_at`, `bubble_seed_source`). Client-side also cached in localStorage for instant render before the profile loads.

**Re-seeding**: The user can re-enter a postal code at any time. The bubble animates to the new location and size. The old bubble is gone — there is only one bubble, one geographic self.

---

## 6. ZIP+4: The Textual Pinch (US Only)

For US users, typing more postal characters is the textual equivalent of pinching the bubble smaller. The gesture and the keystroke do the same thing — tighten the disclosed region.

When the bubble is seeded from a 5-digit ZIP, the input field remains active with the cursor positioned after the ZIP. A subtle affordance:

> `94103-____` — type your +4 to tighten

ZIP+4 codes (e.g., 94103-3114) narrow to a **single block face** — one side of one block of one street. The bubble's radius snaps from ~3km (ZIP extent) to ~50m (block face). Every fence that was inside the bubble crosses the perimeter in a single satisfying contraction. All layers resolve.

The experience:
1. User types `94103` → bubble appears at ZIP extent (~3km radius)
2. User sees fences inside — Market Street bisecting the bubble
3. User types `-3114` → bubble smoothly contracts (300ms, ease-out) to block-face extent
4. All fences now outside the bubble → all layers resolve → status badges fill
5. The bubble is now very small, very precise — and still the user's

The shadow-atlas doesn't need a special ZIP+4 handler. The commons client:
1. Re-queries `/v1/bubble-query` with the ZIP+4 centroid and the tighter radius
2. The response confirms all districts are resolved (zero fences inside the tiny bubble)
3. Client-side geometry math confirms: bubble fits entirely within one district per layer

**Where do people know their ZIP+4?** From their mail — it's printed on every piece of USPS mail. Also available via USPS.com lookup (free, public).

**The bubble never disappears.** Even after ZIP+4 resolves everything, the tiny bubble persists in the user's profile. They can always zoom it back out. The textual pinch is a convenience, not an alternative to the bubble — it's a way to operate the bubble with the keyboard instead of the fingers.

---

## 7. PROGRESSIVE POSTAL SPECIFICITY (Per Country)

The system accepts whatever the user gives. The bubble is born at whatever size that signal produces. More characters = tighter bubble.

### United States
```
"94103"        → Bubble seeded at ZIP extent (~3km radius)
                  85% chance: all fences outside → all layers resolved
                  15% chance: 1-2 fences visible inside → user can pinch or type more
"94103-3114"   → Bubble tightens to block face (~50m radius)
                  >99% chance: all layers resolved
```

The user is never *asked* for the +4. The input field affords it. If they know it, the bubble tightens. If they don't, the bubble is fine at ZIP size — they pinch.

### Canada
```
"K1A"          → FSA only → Bubble seeded at FSA extent (~5-15km radius)
                  Too large: 75% of the time, fences visible inside
                  Input field prompts: "Enter full code (e.g., K1A 0A6)"
"K1A 0A6"     → Full code → Bubble tightens to ~500m radius
                  98.8% chance: all layers resolved
                  1.2%: one riding fence visible — user pinches past it
```

For Canada, detect partial FSA entry and expand the input: the 3-character FSA seeds the bubble at city scale (valid, but coarse), and the field hints at the full format. The bubble never prevents access — it just honestly shows the precision level.

### United Kingdom
```
"SW1A 1AA"     → Full postcode → Bubble seeded at ~100m radius
                  99.76%: all layers resolved (tiny bubble, everything outside)
                  0.24%: one constituency fence (~4,300 split postcodes)
                  Always binary: exactly 2 constituencies max → one pinch
```

UK is the easiest case. The postcode system is so granular that the bubble is born small enough to resolve almost everything immediately. The rare split postcode produces exactly one fence — the user sees it and either pinches past it or doesn't.

### Australia
```
"2000"         → 4-digit postcode → Bubble seeded at postcode extent
                  77%: all layers resolved
                  23%: electorates straddle — fences visible inside
                  Suburb name tightens further: "Surry Hills" + 2010 → ~1km bubble
```

For Australia, the input accepts suburb names as additional tightening signals. Australian users think in suburbs, not postcodes — "Surry Hills 2010" is more natural than just "2010". The suburb centroid + postcode produces a tighter bubble that usually resolves everything.

---

## 8. CROSS-CODEBASE DATA FLOW

### shadow-atlas (voter-protocol)

**New files:**
```
src/serving/bubble-service.ts   ← BubbleService: geometry query engine
src/serving/fence-service.ts    ← FenceService: boundary line computation + cache
src/transformation/fence-builder.ts ← Build-time: compute fences between adjacent districts
```

**Modified files:**
```
src/serving/api.ts              ← Register POST /v1/bubble-query
src/serving/geocode-service.ts  ← Extend detectCountry() for UK/AU, add geocodePostal()
src/serving/district-service.ts ← Add queryBbox() and clipToExtent() public methods
src/transformation/rtree-builder.ts ← Add fence table + fence_rtree creation
src/db/schema.sql               ← Add fences table DDL
```

**New database table:** `fences` + `fence_rtree` (see Section 4). Pre-computed during `build-district-db.ts`. Adds ~2MB to the database for US + CA fences.

### commons (frontend)

**New files:**
```
src/lib/components/bubble/Bubble.svelte
src/lib/components/bubble/BubbleInput.svelte
src/lib/components/bubble/BubbleStatus.svelte
src/lib/components/bubble/BubbleTerrain.svelte
src/lib/components/bubble/bubble-state.svelte.ts
src/lib/components/bubble/bubble-geometry.ts    ← Client-side circle/polygon intersection
src/lib/core/shadow-atlas/bubble-client.ts      ← API client for /v1/bubble-query
src/routes/api/shadow-atlas/bubble/+server.ts   ← Server proxy
```

**Modified files:**
```
src/lib/components/template-browser/LocationFilter.svelte ← Replace with Bubble
src/lib/core/shadow-atlas/client.ts                        ← Add bubbleQuery()
prisma/schema.prisma                                       ← Add bubble fields to User
```

**New User model fields:**
```prisma
model User {
  // ... existing fields ...

  // Geographic bubble (persistent identity)
  bubble_lat       Float?    // Bubble center latitude
  bubble_lng       Float?    // Bubble center longitude
  bubble_radius    Float?    // Bubble radius in meters
  bubble_updated   DateTime? // Last bubble modification
  bubble_seed      String?   // How seeded: "postal", "gps", "city", "country"
}
```

**Integration with LocationFilter:** The existing 5-signal inference (GPS, IP, OAuth, timezone, verified address) becomes a **bubble seeder**. Each signal seeds the bubble at a different radius:
- GPS: seeds at accuracy-circle radius (~20m) → usually district-resolved immediately
- IP: seeds at ~10km → city-level, needs pinching for district
- Verified address: seeds at ~50m → resolved
- Postal code: seeds at postal-extent radius (varies by country)

The LocationFilter doesn't infer a district anymore. It infers a bubble seed. The bubble handles everything from there.

### voter-protocol (ZK layer)

**No circuit changes.** The community-field path uses the existing `bubble_membership` circuit, which takes H3 cells (`cell_ids[16]`, sorted ascending, zero-padded to `MAX_CELLS = 16`) — **not a `district_id`** — and produces `cell_set_root`, `epoch_nullifier`, and `cell_count` as outputs. See `voter-protocol/packages/crypto/noir/bubble_membership/src/main.nr`. The bubble is a UX concept whose resolved cell set feeds the circuit; district resolution happens client-side *after* the proof, by mapping each resolved cell to its congressional district via the Shadow Atlas. The circuit is agnostic to how the cell set was produced.

**One subtlety:** If the bubble is ambiguous (user hasn't pinched past a CD fence), the client cannot claim a specific congressional district — because the resolved cells span multiple districts. The bubble makes this visible: "tighten your bubble to claim a specific district." The ZK layer still accepts the proof (the cells *are* verifiably in the user's bubble), but the downstream district-specific claim is ambiguous until the bubble is tightened.

---

## 9. EDGE CASES

### Postal code not found
Nominatim returns no results. The input field highlights softly in rose. No bubble appears — you can't birth a bubble from a nonexistent place. Message: "We couldn't find that postal code. Check the format and try again." The bubble state remains whatever it was before (null if first entry, or previous position if re-seeding).

### User enters a Canadian FSA (3 characters only)
Auto-detect as partial. The bubble **does** appear — seeded at FSA extent (city-scale, ~15km radius). This is a valid bubble; the user just has a large one. The input field hints: "Full code for a tighter bubble (e.g., K1A 0A6)" with cursor positioned after the FSA. The user can use the FSA-scale bubble (accessing country-level and state/province-level templates) or type more characters to tighten it.

### Multiple fences from different layers inside the bubble simultaneously
Common: a US ZIP could straddle both a CD boundary and a state house boundary (different lines). The bubble shows **all** fences simultaneously, color-coded by layer: `blue-400` for congressional, `emerald-400` for state senate, `amber-400` for state house. As the user pinches, fences from different layers cross the perimeter at different radii — the user resolves layers incrementally, most-outer-fence first. There is no "tap to resolve" — the pinch handles everything continuously.

### Postal code spans a state line
153 US ZIPs cross state lines. The shadow-atlas handles this naturally — the R-tree query returns districts from both states. The bubble shows the state boundary as a fence (a thick fence, since it separates multiple downstream layers simultaneously). Pinching past the state line fence resolves the state layer AND all sub-state layers on the shed side — a cascading resolution that feels deeply satisfying.

### User moves (re-seeding the bubble)
The user enters a new postal code. The bubble animates to the new location (300ms, ease-out transition of center and radius). The old bubble is gone — there is only one bubble. Previous ZK proofs are unaffected (they're committed on-chain). The new bubble produces new `district_id` values for future actions.

If the user has a persistent bubble and opens the bubble editor, the current bubble is shown with a "Re-seed" affordance: the postal input field pre-filled with the display hint of the original seed (e.g., "94103"). Clearing and typing a new code births the bubble at the new location.

### Pre-launch: no shadow-atlas available
If the shadow-atlas API is unreachable, the bubble degrades to **postal-code-only mode**: the bubble appears at the postal code centroid with an estimated radius (country-specific defaults from Section 7), but with no fences rendered. The bubble is featureless — a soft circle on blank terrain. Precision is inferred from the postal code format alone (ZIP = state-level, full Canadian code = district-level assumption). Template scoping works at reduced granularity. When the shadow-atlas comes back online, the next bubble interaction re-queries and fences appear.

### PO Box / non-geographic postal codes
Some postal codes (e.g., US PO Boxes, Canadian "H0H 0H0" for Santa Claus) map to a building, not a region. Nominatim returns a point with no extent. The bubble seeds at the point with a minimal radius (~100m) — which usually puts the user squarely in one district for all layers. Message: "This looks like a PO Box. The bubble is placed at its location — adjust if needed."

### Bubble at maximum extent (country selection only)
If the user's only signal is country selection (no postal code, no GPS), the bubble is the entire country. Radius ~2,000km for the US. This is valid. The bubble terrain shows only the country outline (no district fences at this zoom — too many to render). Precision = country. The user accesses national-scope templates. The prompt is gentle: "Enter a postal code to see local campaigns." No gate, no demand.

### Zero-signal state (brand new user, no location at all)
No bubble exists. The user sees templates with `minimum_precision_required: 'none'` (international/universal scope). The browse page shows: "Add your location to see campaigns near you." This is the only state where the bubble literally does not exist — it has not been born yet.

---

## 10. VALIDATE: Experiential & Analytical Criteria

### Phenomenological Validation

**Birth test.** Type a postal code on a phone. The bubble should appear within 1 second of the last keystroke — the terrain materializes, fences are visible, the bubble is alive. If it takes longer, the felt connection between keystroke and spatial consequence is lost.

**Trust test.** Show the postal input to someone who has never seen the platform. Ask: "Does this feel safe to enter?" Compare with showing them a full address form. The postal code should feel trivially safe. Then show them the bubble that appears. Ask: "What is this?" The answer should be spatial ("it's showing me my area") not procedural ("it's asking me to pick something").

**Ownership test.** After the bubble appears, does the user feel it's theirs? Signs: they immediately try to touch it (pinch, drag). They refer to it as "my bubble" or "my area," not "the map" or "the thing." They resist when you suggest removing it.

**Dwelling test.** Leave the bubble on screen for 30 seconds without interacting. Does it feel like a living thing resting, or a dialog waiting for input? The gentle glow, the muted terrain, the fence labels — these should create a space you could sit in. If it feels like it's nagging you to do something, the atmosphere is wrong.

**Pinch satisfaction test.** When a fence crosses the perimeter during a pinch — does that micro-moment feel like something? The fence should dim and slide outward with a tiny bit of visual weight, and the BubbleStatus badge for that layer should fill. The resolution of each layer should be a small, satisfying event — not a checkbox, but a felt shift in the bubble's character.

**Agency test.** Can the user make the bubble larger again after shrinking it? This must be trivially easy and the system must not resist. If the user feels punished for making the bubble larger (losing access to templates they could see a moment ago), the agency model is broken. Templates don't disappear — they dim, with a gentle "tighten to access."

### Analytical Validation

**Resolution rates (target — percentage of postal codes where ALL fences are outside the initial bubble):**
- US 5-digit ZIP: >85% fully resolved at seed
- US ZIP+4: >99% fully resolved at seed
- CA full code: >98% fully resolved at seed
- UK full postcode: >99% fully resolved at seed
- AU 4-digit: >77% fully resolved at seed

**Timing:**
- Postal code → bubble-query response: <300ms (p95)
- Bubble render (terrain + fences + circle): <50ms
- Pinch gesture → visual update: <16ms (single frame — client-side math only)
- Bubble tighten animation (ZIP → ZIP+4): 300ms, ease-out
- Bubble drag → cache miss → re-query: <500ms total
- Total first-bubble experience (type postal + bubble appears): <1000ms

**Accessibility:**
- `BubbleInput`: `role="textbox"`, `aria-label="Postal code"`, format hint as `aria-describedby`
- `Bubble` (the SVG circle): `role="application"`, `aria-label="Your geographic bubble showing {n} district boundaries"`, `aria-roledescription="interactive map"`
- Fences: `role="img"`, `aria-label="{layer} boundary at {landmark}: {district_a} / {district_b}"`
- `BubbleStatus` layer badges: `role="list"`, each badge is `role="listitem"` with `aria-label="{layer}: resolved to {district}" | "{layer}: could be {a} or {b}"`
- **Keyboard pinch**: `+`/`-` adjust radius in 10% steps, arrow keys move center
- **Text-based alternative**: Below the bubble, a collapsible "Adjust with text" panel shows the input field and current resolution status as text. Screen reader users get the full experience through status announcements.
- `prefers-reduced-motion`: Bubble transitions are instant (no animation), fences appear/disappear without fade
- Screen reader announcement on resolution change: "Congressional district resolved: CA-11" (aria-live region)

**Privacy:**
- **The raw postal code is not stored.** Only `bubble_lat`, `bubble_lng`, `bubble_radius` are persisted on the User model. The postal code is a seed — once the bubble is born, the string is discarded.
- Shadow-atlas logs queries for rate limiting only (TTL 1 hour, no PII association, keyed by IP hash not user ID)
- No geolocation API is called — the postal code is user-volunteered, not observed
- The bubble visualization is rendered entirely client-side from the shadow-atlas geometry response — no third-party map tile requests that could leak location
- When the user makes the bubble larger, previously resolved district_ids are erased from client state (not just hidden — gone). The bubble forgets what it no longer encompasses.

---

## 11. IMPLEMENTATION ORDER

### Phase 1: Shadow-atlas geometry engine (voter-protocol)

**Goal**: `POST /v1/bubble-query` returns fences + districts for any point on Earth.

```
voter-protocol/packages/shadow-atlas/
├── src/db/officials-schema.sql        ← ADD fences + fence_rtree DDL
├── src/scripts/build-district-db.ts   ← ADD fence computation step
├── src/serving/fence-service.ts       ← NEW: compute + cache fences
├── src/serving/bubble-service.ts      ← NEW: geometry query for bubble extent
├── src/serving/geocode-service.ts     ← EXTEND: geocodePostal(), detectCountry() for UK/AU
├── src/serving/district-service.ts    ← EXTEND: queryBbox(), clipToExtent() public methods
├── src/serving/api.ts                 ← ADD: POST /v1/bubble-query route
└── test/bubble-service.test.ts        ← NEW: test with known ZIPs/postal codes
```

Steps:
1. Add `fences` table + `fence_rtree` to `officials-schema.sql`
2. Implement `FenceService` — for each layer, find adjacent district pairs (bbox overlap), compute shared boundary as LineString via geometric intersection
3. Implement landmark generation: reverse-geocode fence midpoints via Nominatim to extract road/river names. Store on fence row at build time.
4. Add fence computation to `build-district-db.ts` (build-time, ~5 min for US + CA, produces ~500 CD fences + ~15,000 state house fences)
5. Extend `GeocodeService.detectCountry()` for UK/AU postal formats
6. Add `geocodePostal()` method — Nominatim search with `postalcode` param, returns centroid + bbox + country
7. Implement `BubbleService.query(center, radius, layers?, postal_code?)`:
   - Expand radius by 20% buffer
   - R-tree query for fences within bbox → clip to extent, simplify to <30 vertices
   - R-tree query for districts intersecting bbox → clip to extent, simplify to <50 vertices
   - If `postal_code` provided: geocode it and return `postalExtent`
   - If officials DB available: PIP lookup at center → return best-guess officials
8. Add `POST /v1/bubble-query` route in `api.ts` with input validation (center bounds, radius 1m-5000km)
9. Test: `94103` → response includes Market St fence between CA-11/CA-12. `K1A 0A6` → response includes zero fences.
10. Performance test: response <100ms at p95, payload <50KB

**Fence computation detail**: For each layer (congressional, state_senate, state_house, county, can_fed):
```
for each district_a in layer:
  for each district_b in layer where bbox_overlaps(a, b) and a.id < b.id:
    shared_boundary = geometric_intersection(boundary_of(a), boundary_of(b))
    if shared_boundary is LineString:
      store as fence(a, b, geometry, landmark=reverse_geocode(midpoint))
```
Spatial filtering via bbox overlap makes this O(n log n) rather than O(n²).

### Phase 2: Commons bubble state + geometry engine

**Goal**: Postal code → API call → client-side geometry → reactive bubble state with derived precision.

```
commons/src/lib/
├── components/bubble/
│   ├── bubble-state.svelte.ts     ← NEW: reactive state (Svelte 5 runes)
│   └── bubble-geometry.ts         ← NEW: ~80 lines, zero deps (Section 3A)
├── core/shadow-atlas/
│   ├── client.ts                  ← EXTEND: bubbleQuery() method
│   └── bubble-client.ts           ← NEW: typed wrapper for bubble-query
├── components/bubble/
│   └── BubbleInput.svelte         ← NEW: postal code entry + country detection
├── routes/api/shadow-atlas/
│   └── bubble/+server.ts          ← NEW: server proxy for bubble-query
└── prisma/schema.prisma           ← ADD: bubble_lat/lng/radius/updated/seed on User
```

Steps:
1. Implement `bubble-geometry.ts` — the ~80-line engine from Section 3A. Pre-projects coordinates to Web Mercator on load. Segment-circle intersection with BBOX culling. Winding-number point-in-polygon for district containment. Exported types: `ProjectedFence`, `ProjectedDistrict`.
2. Create `bubble-state.svelte.ts` — Svelte 5 runes:
   - `$state`: `center`, `radius`, `cachedExtent` (fences + districts from API), `loading`
   - `$derived`: `precision` (computed from `resolvedLayers`), `resolvedLayers` (layers where center is inside exactly one district and no fence for that layer is inside the bubble), `ambiguousLayers` (layers with fences inside the bubble)
   - On `center` or `radius` change: call `computeBubbleState()` from `bubble-geometry.ts` — pure function, no API call
   - Export `seedBubble(center, radius, postalCode?)` — fires API call, hydrates `cachedExtent`, triggers derived recomputation
   - Export `persistBubble()` — saves to User model via API, also to localStorage
   - Export `restoreBubble()` — loads from localStorage (instant) then from User model (async)
3. Add server proxy: `routes/api/shadow-atlas/bubble/+server.ts` — POST handler that forwards to shadow-atlas, with rate limiting
4. Build `bubble-client.ts` — typed API client wrapping the proxy. Returns typed `BubbleQueryResponse`.
5. Build `BubbleInput.svelte`:
   - Text input with country-specific formatting (auto-detect via regex)
   - ZIP → ZIP+4 progressive affordance (cursor positioned after ZIP, `-____` placeholder)
   - Canadian FSA → full code prompt
   - On input: detect country, validate format, call `seedBubble()` with geocoded centroid
   - View Transition: `view-transition-name: location-widget` for bubble birth morph
6. Add bubble fields to Prisma User model: `bubble_lat Float?`, `bubble_lng Float?`, `bubble_radius Float?`, `bubble_updated DateTime?`, `bubble_seed String?`
7. Run Prisma migration
8. Test: type `94103` → API fires → `cachedExtent` hydrated → `precision` = `county` (state senate + county resolved, congressional ambiguous due to Market St fence)

### Phase 3: The living bubble

**Goal**: Muted terrain, pinchable circle, fence visualization, spring physics — a geographic identity object that lives under the user's thumb.

```
commons/src/lib/components/bubble/
├── Bubble.svelte              ← THE bubble: SVG circle + gesture layer
├── BubbleTerrain.svelte       ← MapLibre GL JS, 5-layer muted style, non-interactive
├── BubbleStatus.svelte        ← Resolved/ambiguous layer readout, precision bar
├── BubbleInput.svelte         ← (from Phase 2)
├── bubble-state.svelte.ts     ← (from Phase 2)
├── bubble-geometry.ts         ← (from Phase 2)
├── bubble-gestures.ts         ← NEW: Pointer Events pinch/drag handlers
├── bubble-spring.ts           ← NEW: WAAPI spring animations
└── bubble-terrain-style.ts    ← NEW: MapLibre 5-layer style JSON

commons/src/routes/
└── +page.svelte               ← MODIFY: remove LocationFilter, add Bubble
```

Steps:
1. **BubbleTerrain.svelte** — MapLibre GL JS terrain layer:
   - Dynamic import: `const maplibregl = await import('maplibre-gl')` — 262KB off critical path
   - Register PMTiles protocol: `maplibregl.addProtocol('pmtiles', protocol.tile)`
   - 5-layer hand-crafted style (background, earth, water, roads, boundaries) — no glyphs, no sprites
   - `interactive: false` — zero event overhead, map is passive
   - `antialias: false`, `renderWorldCopies: false`, `fadeDuration: 0` — mobile perf
   - Add GeoJSON source for fences from `cachedExtent` — native MapLibre line layer with:
     - Per-fence opacity driven by `computeBubbleState()` result: inside bubble = 0.5, outside = 0.15
     - Layer color coding: `match(['get', 'layer'], 'congressional', '#60a5fa', 'state_senate', '#34d399', 'state_house', '#fbbf24', '#94a3b8')`
     - Dashed line: `line-dasharray: [3, 2]`
   - Expose `project(lng, lat)` for bubble position sync
   - Expose `setView(lng, lat, zoom)` for programmatic pan
   - `ResizeObserver` for responsive canvas sizing
   - `IntersectionObserver` to pause MapLibre rendering when off-screen

2. **bubble-gestures.ts** — Pointer Events input layer:
   - `touch-action: none` on gesture container + `preventDefault({ passive: false })` for iOS Safari
   - Two-pointer pinch: track `pointerId`s, compute inter-finger distance delta → scale `radius`
   - `getCoalescedEvents()` for 120Hz displays — use last coalesced event for rendering
   - `getPredictedEvents()` — pre-compute fence intersections for next frame in the current frame's idle time
   - Single-pointer drag: delta → `map.unproject()` → geo offset → move `center`
   - Desktop: scroll-wheel → radius (up = shrink, down = grow). Shift+scroll = 1/4 speed fine control.
   - Keyboard: `+`/`-` = radius ±10%. Arrow keys = center move by radius/10. Enter = confirm.
   - Debounced cache-miss detection: if center moves outside `cachedExtent.bbox`, fire new API call (with 300ms debounce to avoid rapid-fire during drag)

3. **Bubble.svelte** — the living object:
   - SVG overlay: `position: absolute; inset: 0; z-index: 10; pointer-events: none`
   - The bubble `<circle>`: `pointer-events: all`, `will-change: transform, filter`
   - Position: `cx`/`cy` set via `map.project(center)` in `requestAnimationFrame`
   - Size: CSS `transform: scale(radiusInPixels / baseRadius)` — compositor-thread only
   - Fill: `<radialGradient>` from `transparent` at center to `blue-400/8` at edge
   - Edge glow: CSS `filter: drop-shadow(0 0 8px rgba(59, 130, 246, 0.15))` — compositor-thread
   - Edge intensity encoding: where the bubble edge is near a fence, glow intensifies — compute in `requestAnimationFrame`, apply as `filter` intensity
   - `aria-label="Your geographic bubble showing {n} district boundaries"`, `role="application"`

4. **bubble-spring.ts** — spring physics:
   - `linear()` easing: generate 40 keypoints from spring ODE (stiffness: 300, damping: 20, mass: 1)
   - Safari fallback detection: `CSS.supports('animation-timing-function', 'linear(0, 1)')` → fall back to `cubic-bezier(0.34, 1.56, 0.64, 1)`
   - Pinch release: WAAPI `animate()` with spring easing, 5% overshoot, 200ms settle
   - Drag release: velocity decay in `requestAnimationFrame` — `v *= 0.92` per frame until `|v| < 0.5px`
   - ZIP+4 tighten: WAAPI `animate()` from current radius to new radius, 300ms ease-out

5. **BubbleStatus.svelte** — live readout:
   - Layer badges: `●` resolved (solid, `text-slate-800`), `◐` ambiguous (half, `text-slate-500`)
   - For ambiguous layers: fence label is interactive — hover/tap highlights the fence in the terrain
   - Precision bar: 4-segment visual (country → state → county → district), filled = achieved
   - Template access hint (contextual): "Tighten past {fence.landmark} to access {template.title}"
   - `aria-live="polite"` region — announces resolution changes: "Congressional district resolved: CA-11"

6. **Bubble birth animation** — View Transitions API:
   - `BubbleInput` has `view-transition-name: location-widget`
   - On postal code submit: `document.startViewTransition(() => { show bubble, hide input })`
   - `::view-transition-old(location-widget)`: `animation: fade-out 200ms ease-out`
   - `::view-transition-new(location-widget)`: `animation: bubble-birth 400ms spring-easing`
   - Fallback for browsers without View Transitions: simple CSS `opacity` + `transform` transition

7. **Haptic feedback** (progressive enhancement):
   - On fence crossing: `navigator.vibrate?.([15, 10, 15])` — Chrome Android only
   - Primary feedback: CSS glow pulse (300ms keyframe on `filter`) — all platforms

8. **Integration** — wire into the app:
   - Remove LocationFilter import from `+page.svelte`
   - Remove `handleLocationFilterChange()` callback
   - Add Bubble to user profile header/sidebar (persistent, always visible)
   - Template browse page reads `bubble.precision` to show/dim templates
   - Bubble seeder from existing signals: GPS → `seedBubble(coords, accuracyRadius)`, IP → `seedBubble(coords, ~10km)`

### Phase 4: Legacy removal + polish

**Goal**: Zero dead code. No half-alive inference system. Clean codebase.

Steps:
1. **Remove dead code** (2,619 lines from the manifest in Section 3A):
   - Delete: `LocationFilter.svelte`, `DistrictBreadcrumb.svelte`, `InlineAddressResolver.svelte`, `PrivacyBadge.svelte`
   - Delete: `core/location/inference-engine.ts`, `storage.ts`, `behavioral-tracker.ts`, `oauth-location-sync.ts`, `types.ts`, `index.ts`
   - Delete: `services/zipDistrictLookup.ts`
   - Update `core/location/index.ts` exports (if kept files still need a barrel)
   - Verify: no remaining imports of deleted modules (`grep -r` for each deleted filename)

2. **Archive superseded spec**:
   - `mv docs/specs/location-picker-spec.md docs/specs/archived/location-picker-spec.md`

3. **International polish**:
   - UK postcode: tiny bubbles (~100m radius), rare fences (0.24% of codes), always binary when ambiguous
   - AU postcode: suburb name as additional tightening signal in `BubbleInput`
   - Layer color coding per country: UK (constituency = blue), AU (electorate = teal), CA (riding = red)

4. **Accessibility**:
   - `prefers-reduced-motion`: all transitions instant, no spring, no glow pulse
   - Screen reader: `aria-live` announces on every resolution change
   - Text-based alternative: collapsible panel below bubble showing current state as text, with radio buttons for manual district selection
   - Keyboard navigation: Tab to bubble → +/- for radius → arrows for center → Enter to confirm

5. **PMTiles preparation**:
   - Extract North America tiles from Protomaps planet: `pmtiles extract planet.pmtiles na.pmtiles --bbox=-170,15,-50,72 --maxzoom=14`
   - Upload to Cloudflare R2 bucket
   - Configure CORS headers for commons domain
   - Add `Content-Type: application/octet-stream` for Range Requests

6. **Performance validation**:
   - Measure: postal code → bubble visible < 1000ms (API + render + animation)
   - Measure: pinch gesture → visual update < 16ms (should be ~0.12ms from geometry + DOM)
   - Measure: MapLibre terrain render < 100ms initial, < 16ms steady state
   - Lighthouse mobile: Performance > 90 (MapLibre dynamically imported)
   - Test on: iPhone 13 Safari, Pixel 7 Chrome, Galaxy S23 Samsung Browser

---

## Appendix A: Bubble Scenarios From Seed Data

### 94103 (San Francisco, seed templates: 3 SF-scoped)

```
ZIP 94103 covers SoMa, parts of Mission, Hayes Valley.
Bubble seeded: center ≈ (37.773, -122.411), radius ≈ 3,000m

bubble-query response includes:
  fences: [
    { layer: "congressional", sides: ["CA-11", "CA-12"], landmark: "Market Street" }
  ]
  districts: [
    { id: "cd-0611", name: "CA-11", layer: "congressional" },
    { id: "cd-0612", name: "CA-12", layer: "congressional" },
    { id: "sldu-06011", name: "SD-11", layer: "state_senate" },
    { id: "sldl-06017", name: "HD-17", layer: "state_house" },
    { id: "county-06075", name: "SF County", layer: "county" }
  ]
```

**What the user sees:** A bubble at ZIP extent. One dashed line labeled "Market Street" runs through it (the congressional fence). State senate, state house, and county all have their districts entirely within the bubble — resolved. Congressional has two districts straddling the fence — ambiguous.

**BubbleStatus reads:** `● County: SF` `● State Senate: SD-11` `● State House: HD-17` `◐ Congressional: CA-11 or CA-12 (fence: Market St)`

**To resolve:** Pinch the bubble until Market Street is outside. Or type `94103-3114` — the bubble snaps to a block face, Market Street is now well outside, all layers resolve.

### K1A 0A6 (Ottawa, Parliament Hill)

```
Full Canadian postal code K1A 0A6 is Parliament Hill itself.
Bubble seeded: center ≈ (45.424, -75.700), radius ≈ 500m

bubble-query response includes:
  fences: []  (no fences within this tiny bubble)
  districts: [
    { id: "can-fed-35075", name: "Ottawa Centre", layer: "federal_riding" }
  ]
```

**What the user sees:** A tiny bubble on the Ottawa River. No fences. Everything is resolved at birth. The bubble is small and calm.

**BubbleStatus reads:** `● Federal riding: Ottawa Centre`

The bubble persists. The user sees their riding. They access all Ottawa-scoped and Canada-scoped templates. No further interaction needed.

### 97201 (Portland, OR — near seed template: Oregon healing)

```
ZIP 97201 covers downtown Portland, parts of SW Portland.
Bubble seeded: center ≈ (45.511, -122.683), radius ≈ 2,500m

bubble-query response includes:
  fences: [
    { layer: "state_house", sides: ["HD-33", "HD-36"], landmark: "Burnside Street" }
  ]
  districts: [
    { id: "cd-4101", name: "OR-01", layer: "congressional" },
    { id: "sldu-41017", name: "SD-17", layer: "state_senate" },
    { id: "sldl-41033", name: "HD-33", layer: "state_house" },
    { id: "sldl-41036", name: "HD-36", layer: "state_house" },
    { id: "county-41051", name: "Multnomah", layer: "county" }
  ]
```

**What the user sees:** A bubble at ZIP extent. Congressional, state senate, and county are all resolved (no fences for those layers). One amber fence labeled "Burnside Street" — the state house boundary.

**BubbleStatus reads:** `● Congressional: OR-01` `● State Senate: SD-17` `● County: Multnomah` `◐ State House: HD-33 or HD-36 (fence: Burnside St)`

**To resolve:** Pinch the bubble until Burnside Street is outside. One gentle tighten.

---

## Appendix B: API Wire Format Example

### Request — Bubble seeded from postal code
```json
POST /v1/bubble-query
Content-Type: application/json

{
  "center": { "lat": 37.7727, "lng": -122.4111 },
  "radius": 3000,
  "postal_code": "94103"
}
```

The `postal_code` field is optional metadata — it allows the response to include the postal code's own geographic extent (for setting the initial bubble radius). The endpoint works identically without it; `center` + `radius` are the only required fields.

### Response — Raw geometry for client-side resolution
```json
{
  "center": { "lat": 37.7727, "lng": -122.4111 },
  "queryBbox": {
    "minLat": 37.738,
    "maxLat": 37.807,
    "minLng": -122.448,
    "maxLng": -122.374
  },
  "postalExtent": {
    "centroid": { "lat": 37.7727, "lng": -122.4111 },
    "bbox": { "minLat": 37.765, "maxLat": 37.785, "minLng": -122.425, "maxLng": -122.400 },
    "radius": 2800,
    "country": "US"
  },
  "fences": [
    {
      "id": "f-cd0611-cd0612",
      "layer": "congressional",
      "geometry": {
        "type": "LineString",
        "coordinates": [[-122.425, 37.775], [-122.415, 37.777], [-122.400, 37.778]]
      },
      "sides": [
        { "districtId": "cd-0611", "name": "CA-11" },
        { "districtId": "cd-0612", "name": "CA-12" }
      ],
      "landmark": "Market Street",
      "landmarkSource": "road"
    }
  ],
  "districts": [
    {
      "id": "cd-0611",
      "name": "CA-11",
      "display": "California's 11th Congressional District",
      "layer": "congressional",
      "clipGeometry": {
        "type": "Polygon",
        "coordinates": [[[...simplified polygon, <50 vertices...]]]
      }
    },
    {
      "id": "cd-0612",
      "name": "CA-12",
      "display": "California's 12th Congressional District",
      "layer": "congressional",
      "clipGeometry": {
        "type": "Polygon",
        "coordinates": [[[...simplified polygon, <50 vertices...]]]
      }
    },
    {
      "id": "sldu-06011",
      "name": "SD-11",
      "display": "California State Senate District 11",
      "layer": "state_senate",
      "clipGeometry": {
        "type": "Polygon",
        "coordinates": [[[...simplified polygon...]]]
      }
    },
    {
      "id": "sldl-06017",
      "name": "HD-17",
      "display": "California State Assembly District 17",
      "layer": "state_house",
      "clipGeometry": {
        "type": "Polygon",
        "coordinates": [[[...simplified polygon...]]]
      }
    },
    {
      "id": "county-06075",
      "name": "SF County",
      "display": "San Francisco County",
      "layer": "county",
      "clipGeometry": {
        "type": "Polygon",
        "coordinates": [[[...simplified polygon...]]]
      }
    }
  ],
  "officials": [
    {
      "name": "Nancy Pelosi",
      "title": "U.S. Representative",
      "party": "D",
      "districtId": "cd-0611"
    },
    {
      "name": "Scott Wiener",
      "title": "State Senator",
      "party": "D",
      "districtId": "sldu-06011"
    }
  ]
}
```

**Note what the response does NOT contain:**
- No `fully_resolved` field. Resolution is a client-side computation.
- No `resolved: true/false` per layer. The client determines which fences are inside the bubble.
- No `disambiguation_hints` with directional language ("North of..."). The fences + landmarks speak for themselves — the client renders the fence with its landmark label and the user sees the spatial relationship directly.
- No `pin` field. There is no "tap to resolve" interaction. The user pinches.

### Request — Bubble moved (cache miss)
```json
POST /v1/bubble-query
Content-Type: application/json

{
  "center": { "lat": 37.800, "lng": -122.430 },
  "radius": 2000
}
```

Same endpoint, same response shape. No postal code needed — the bubble has been dragged to a new location. The shadow-atlas doesn't care how the bubble got there.
```
