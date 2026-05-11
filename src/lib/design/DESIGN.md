# Design System — Agent Contract

When building or modifying UI in this codebase, follow these rules.
They encode the design philosophy structurally. Do not override them
without reading `docs/design/design-system.md` first.

## Authority

Canonical order: `docs/design/design-system.md`, then `docs/design/voice.md`,
then this contract, then shipped code plus explicit divergence banners, then
feature specs. Aspirational specs do not override this file. If a feature spec
conflicts on radius, color semantics, motion, or recipient-facing proof
language, normalize to this contract.

## Decision Tree

**Showing a number?**
→ Use `<Datum>` from `$lib/design`. It renders in JetBrains Mono
  with tabular-nums. Add `animate` for spring animation.
  Size/weight/color come from the parent element's classes.
  Add `cite="..."` to whisper provenance on hover.

**Does this number have dimensions?**
→ Numbers compress dimensions. Show them. Don't describe them.
  `<Ratio>` — segmented bar showing what a count is made of (identity,
  authorship, any composition). Citation: 3-5px. Display: 12-24px.
  `<Pulse>` — sparkline showing temporal rhythm (when things
  happened). Citation: 56×12px default. Display: 120-400×32-120px.
  Stroke width and padding scale with height; pass `strokeWidth`
  to override.
  `<Rings>` — concentric circles showing depth/tier distribution.
  Citation: 14-16px. Display: 48-128px. Stroke and ring spacing
  already scale with size.
  Use citation scale INSIDE `<Cite>` provenance snippets or standalone
  in settled artifacts. Use display scale in active-field surfaces
  where the dimension is the headline (not a footnote).
  Prefer visual dimensions over text explanations.

**Showing a cryptographic substrate fact (hash, nullifier, Merkle root, signature, version anchor, commit SHA, block height)?**
→ Use `<RegistryMark>` from `$lib/design`. JetBrains Mono with tabular-nums.
  Pick `variant` to drive prefix + screen-reader decoding. Default is full
  value; pass `truncate` for middle-elided form (8…4) when space matters
  (margin sidenotes, footers, breadcrumbs). `copy` defaults true — click
  copies the FULL value, not the truncated display. Add `href` to link to
  a verifier (explorer, registry route).
  Per CONSTITUTION.md §2.3: registry marks live in margins and footers as
  marks of the substrate, not behind copy. Don't card-chrome them. Don't
  embed in prose where the mono register competes with reading flow —
  exceptions: inline citations of a specific hash in technical prose,
  which is what `<code>` already covers.

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
  The void between entities IS the boundary. Densities:
  `tight` (24px) | `default` (32px, citation) | `spacious` (48px) |
  `display` (80px, active-field hero spacing). Internal spacing
  within each entity stays tight (4-8px).

**Rendering recipient/staffer-facing proof?**
→ Lead with what answers recipient triage: verified constituents,
  jurisdiction, verification method, authorship, geography, timing,
  and deduplication. Keep platform-internal metrics (`GDS`, `ALD`,
  entropy, `CAI`) and engagement labels (`Pillar`, `Veteran`,
  `Established`, `Active`) out of headlines. Translate them into
  plain behavioral evidence or put them in collapsed audit details.

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
- Verifiable cryptographic claims (hashes, signatures, Merkle roots, versions): use `<RegistryMark>`.
  Datum is for numeric counts; RegistryMark is for non-numeric verifiable strings.

## Three Semantic Colors

- **Teal** (`--coord-route`): Routes, connections, active coordination.
- **Emerald** (`--coord-verified`): Verified, delivered, proven.
- **Indigo** (`--coord-share`): Sharing, spreading, secondary.

Local categorical palettes are allowed only inside scoped components/specs
where color classifies a domain taxonomy, not a product action or proof state.
They must be redundant with position, shape, or text and cannot style CTAs,
verification, delivery, proof strength, or global navigation.

## Voice

Plain English per `CONSTITUTION.md` §3.3. The supersession of the prior "Direct. Specific. Institutional." register is recorded in `docs/record/vol-1/issue-1.md` §B (2026-05-06). `docs/design/voice.md` is **SUPERSEDED** and not in the authority chain.

- State what is, plainly. "Issues in CA-11" beats "Find campaigns in your area" (marketing) and "Civic-action templates filtered by user-resolved district" (technical density).
- Honest about gaps. When something does not yet ship, say so.
- Imperative is permitted, not required. "Send. Coordinate. Verify." when an action is being requested.
- Words in Satoshi. Numbers in Mono. Citations in Satoshi. Cryptographic strings via `<RegistryMark>`.

## Motion

Only coordination signals animate. Numbers: weighted, inevitable, not bouncy.
