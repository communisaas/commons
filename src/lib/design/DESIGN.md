# Design System — Agent Contract

When building or modifying UI in this codebase, follow these rules.
They encode the design philosophy structurally. Do not override them
without reading `docs/design/design-system.md` first.

## Decision Tree

**Showing a number?**
→ Use `<Datum>` from `$lib/design`. It renders in JetBrains Mono
  with tabular-nums. Add `animate` for spring animation.
  Size/weight/color come from the parent element's classes.
  Add `cite="..."` to whisper provenance on hover.

**Does this number have dimensions?**
→ Numbers compress dimensions. Show them. Don't describe them.
  `<Ratio>` — segmented bar showing what a count is made of (identity,
  authorship, any composition). 3-5px tall, colored proportionally.
  `<Pulse>` — tiny sparkline showing temporal rhythm (when things
  happened). 56×12px default, Catmull-Rom smooth.
  `<Rings>` — concentric circles showing depth/tier distribution
  at 14-16px glyph scale. Citation-scale TrustTierIndicator.
  Use these INSIDE `<Cite>` provenance snippets or standalone.
  Prefer visual dimensions over text explanations.

**Does this claim have provenance?**
→ Every verifiable number should cite its source. Four forms:
  `whisper` (visual dims materialize below on hover),
  `mark` (dotted underline, popover), `footnote` (superscript,
  collects at Artifact bottom), `ghost` (aria-only).
  Provenance is a `provenance` snippet — put Ratio/Pulse/Rings
  inside it. Text `cite="..."` only for methodology notes.
  `.cite-anchor` (mono hashes), `.cite-sep`, `.cite-method`.

**Showing a bounded object (proof specimen, email preview, template card)?**
→ Use `<Artifact>` from `$lib/design`. White background, warm border,
  atmospheric shadow. This component earns card treatment.
  Any `<Cite form="footnote">` inside an Artifact auto-collects as
  numbered references at its bottom with a hairline rule separator.

**Showing a list of entities (supporters, campaigns, settings)?**
→ Use `<EntityCluster>` from `$lib/design`. No cards. No borders.
  The void between entities IS the boundary (32px default gap).
  Internal spacing within each entity stays tight (4-8px).

**Need spring animation?**
→ Import `SPRINGS` from `$lib/design/motion`. Named configs:
  `COUNT_TICK` (scoreboard), `METRIC` (dashboard), `DEPARTURE`
  (message leaving), `SCORE_BAR` (width fill), `SIGNAL` (slow
  growth), `ENTRANCE` (panel slide-in).
  Never invent new spring params — use or extend these.

## Prohibitions

- `rounded-xl` / `rounded-2xl` — Max `rounded-lg` (8px). Civic edges.
- `shadow-sm` on static elements — Shadow means "floats." Remove if nothing below.
- `bg-white` as container — White is for Artifacts only. Ground is warm cream.
- Pill badges — Use typographic annotations instead.
- Decorative borders — Borders for register changes or bounded artifacts only.
- Arbitrary spring configs — Import from `$lib/design/motion`.
- Uncited hero numbers — Hero metrics MUST cite their provenance.
- Text where a dimension exists — If you have composition data, use
  Ratio. If you have temporal data, use Pulse. If you have tier data,
  use Rings. Never write "40% gov ID, 35% address" when a Ratio shows it.

## Typography Register

- **Satoshi** (font-sans, default): Words, headlines, UI copy, CTAs.
- **JetBrains Mono** (font-mono): Counts, scores, dates, hashes, district codes.
  If a value is verifiable or auditable, use Datum. Citations are
  always Satoshi — they explain, they don't assert.

## Three Semantic Colors

- **Teal** (`--coord-route`): Routes, connections, active coordination.
- **Emerald** (`--coord-verified`): Verified, delivered, proven.
- **Indigo** (`--coord-share`): Sharing, spreading, secondary.

## Voice

- **Person layer**: Imperative. Never "campaign." Never defensive.
- **Org layer**: Observational. "Campaign" permitted here.
- Words in Satoshi. Numbers in Mono. Citations in Satoshi.

## Motion

Only coordination signals animate. Numbers: weighted, inevitable, not bouncy.
