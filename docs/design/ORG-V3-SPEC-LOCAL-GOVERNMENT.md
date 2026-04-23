# /org-v3/local-government — Segment Surface Spec

**Path 3, Segment 03 — Local Government**
**Status:** Spec — boundary types + template metadata shipped; delivery system is Phase 3+.
**Date:** 2026-04-17

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** Some infrastructure is
> live; **no local-government delivery path exists**. Corrections:
>
> - **Shipped:** 24-slot Shadow Atlas boundary types including
>   city-council, unified-school, water, fire, transit, hospital,
>   library, park, conservation, utility, judicial, township,
>   precinct, tribal (`src/lib/core/shadow-atlas/client.ts:~250-274`).
>   `DecisionMaker` type enum includes `board_member`;
>   `jurisdictionLevel` includes `'municipal' | 'county'`
>   (`convex/schema.ts:~1772,1779`). Template schema supports
>   `jurisdictionType='city' | 'school_district' | 'county'` +
>   `scopeLevel='locality'`.
> - **Not shipped:** local-government decision-maker ingestion (seed
>   has exactly one local template — Portland 3D-printed housing —
>   and no local officials). No clerk-email delivery path. No public
>   comment packet assembly. No agenda-item linking for non-Granicus
>   platforms. No deadline detection.
> - **"Same component skeleton as `/org-v3/state-legislature`"**
>   (~line 112) is forward-looking — the state-legislature segment
>   delivery is also not shipped (gated by `FEATURES.CONGRESSIONAL=false`).
> - **"Commons covers all [24 boundary types]"** (~line 86)
>   overstates: boundary types are *defined* in Shadow Atlas; a
>   delivery system for local officials does not exist. Reframe as
>   "Shadow Atlas resolves all 24 boundary types; delivery to
>   local-government officials is Phase 3+."
> - **`deliveryMethod` enum on campaigns is `'cwc' | 'email' |
>   'recorded'`** (`convex/schema.ts:~311,874`) — no local-gov-specific
>   routing yet.

---

## Target segments

Advocacy orgs whose decision-makers sit on **city councils, county boards of supervisors, school boards, special districts, and planning commissions**. Specifically:

- **Housing / tenant rights** — local rent-stabilization ordinances, zoning amendments, tenant protections. Regional affordability coalitions, tenant unions.
- **Police accountability** — municipal oversight boards, budget hearings, use-of-force ordinances, civilian review commissions.
- **School boards** — curriculum fights, book-ban responses, charter expansion, budget allocations, equity committees.
- **Water / special districts** — aquifer monitoring, rate-setting, drought response, irrigation districts.
- **Planning commissions** — land use, environmental review (CEQA, NEPA local), housing element compliance.
- **Transit authorities** — service cuts, fare policy, station siting.

TAM anchor (Lens 1 synthesis): **90,887 local government entities in the US**. 24 boundary types. Most have no dedicated constituent-email tool; intake is email-to-clerk plus a PDF public-comment packet assembled before each meeting.

## Hero seed + rationale

**Seed:**
> *"Your comment arrives in the public comment packet as item 7c, page 43. Five council members have 12 minutes to read 89 pages before voting. They skim for names they recognize."*

**Rationale:** The intake mechanism at the local level is the **clerk-assembled meeting packet PDF**. This is documented in the Lens 2 intake table ("Email to `board@` + clerk-assembled PDF packet distributed before meeting"). The packet is physically finite — members open it before the meeting, scroll through it, and vote. The filter heuristic is "do I recognize this name, is this in my district, is this specific to the agenda item?"

The hero captures the **physical constraint** local decision-makers face: a packet that is read, not queried. No staff filter; the members themselves skim. This is where Commons's verified-constituent attribution wins — the packet page that shows 1,200 verified neighbors, each named by census tract, is legibly different from 1,200 signatures pasted into a spreadsheet attachment.

## Gap artifact choice + rationale

**Choice:** A rendered **public comment packet PDF** — item 7c, page 43 of 89. It shows a block of public comments as the clerk assembled them:

- An org-generated form letter pasted 47 times, each signed by a different name with no address verification.
- A clerk's footnote at the bottom: *"Staff received 312 comments substantially identical to the above; names attached as Exhibit A."*
- Exhibit A referenced but not rendered — it's a spreadsheet appendix the council members typically do not open.

**Rationale:** This is the actual format. City/county/school-board/special-district clerks produce these every week. The form-letter repetition *in the packet itself* is the gap — councilmembers skim the packet, see the form letter, skip the exhibit, move on. Commons's alternative sits in the same packet, but renders as a **single page** that summarizes 1,200 verified constituents with the audit trail, replacing 47 pasted copies plus an exhibit.

**Why this over alternatives:** City council meetings don't have the inbox-flood dynamic (state-leg) or the docket-bucket dynamic (agency). They have the **physical packet**. The gap artifact must be the packet page, not an inbox or a portal.

## Specimen example

```
AUSTIN CITY COUNCIL · DISTRICT 5 · TENANT NOTIFICATION ORD 2026-04-112
Meeting: Austin City Council, April 18, 2026 · Item 7c
Period: Mar 1 – Apr 14, 2026
Jurisdiction: City of Austin, District 5

874 verified residents in District 5
   · 312 within 0.5 mi of affected rental stock

Identity: 612 gov ID · 262 address-matched
Authorship: 701 individually composed · 173 shared statements
Geography: 28 census tracts · 11 neighborhood associations
Screening: one submission per resident · duplicates removed

AGENDA-LINKED · Item 7c (Tenant Notification Ordinance, First Reading)
CRYPTOGRAPHIC AUDIT TRAIL · INDEPENDENTLY VERIFIABLE
```

**Why these fields:** Local decision-makers weight different evidence than state-leg or federal staff.

- **Neighborhood associations** — at the local level, neighborhood-association affiliation is the proxy for "is this a real, known resident." Commons surfaces it.
- **Census tracts** — more granular than legislative district. Council members represent seats drawn by tract groupings.
- **Proximity-to-affected-stock** — for housing / zoning / environmental decisions, proximity to the *physical thing being decided* is weighted. Commons produces a geographic sub-count (0.5 mi of affected rental stock, or within the buffer zone of a planning decision, or within a school's catchment).
- **Agenda-linked** — prominent field. The #1 dismissal tell for local submissions (per Lens 2 intake table) is "not agenda-linked." Commons stamps the item number and ordinance ID.

## Anchor boundary list

Mix across the 24 boundary types (Lens 1 synthesis). Feel real:

- Austin City Council District 5
- Oakland Unified School Board
- Cook County Board of Commissioners
- Las Vegas Valley Water District
- Portland Planning Commission
- SFMTA Board of Directors
- Denver Police Oversight Commission
- Boston Zoning Board of Appeals
- San Diego County Supervisors
- Seattle Community Police Commission

**Stat footer:**
> *"24 boundary types. 90,887 local government entities. Commons covers all of them."*

This number is already load-bearing on the current `/org` page — it's the strongest local-coverage claim Commons can make. It's drawn from US Census Bureau *Census of Governments* (2022), cross-checked against the `/org` page's existing copy.

## Category displacement seed

> *"Your comment tool pastes 312 copies of your form letter into the clerk's exhibit appendix. Commons produces a single packet page that attributes 312 verified residents to specific census tracts — the page the councilmember actually reads."*

## Outcome seed

> *"Your verified residents appear in the public comment packet by name, by tract, by neighborhood association. Form-letter exhibits stay in the appendix."*

## Citations from the synthesis

Grounding the copy to research (`ADVOCACY-WORLD-SYNTHESIS.md`):

1. **"Email to `board@` + clerk-assembled PDF packet distributed before meeting"** — Lens 2 intake table, row for special districts. Same mechanism applies to city councils and school boards.
2. **"Not agenda-linked; off-topic; submitted after packet deadline"** — Lens 2 intake dismissal tells for local government.
3. **CMF 2017 "91% of staff value district-specific impact info"** — Lens 2 synthesis. Translated to local: neighborhood-level impact is the equivalent of district-level for state/federal.
4. **Walker & Le *Socius* 2023 astroturf-harm** — Lens 4; the local-gov manifestation is 47-copies-in-the-packet.
5. **Han (*Prisms of the People*)** — Lens 4; relational-organizing power is most legible at the local level where councilmembers may personally know the advocate. Commons's attribution surfaces the relational layer instead of obscuring it.
6. **Skocpol (*Diminished Democracy*)** — Lens 4; local chapters are the structural location where membership organizations historically built power. Surfacing neighborhood-association affiliation is a deliberate Skocpolian nod.
7. **US Census Bureau *Census of Governments*** — 90,887 local government entities figure; 24 boundary types.

## Design notes

- Same component skeleton as `/org-v3/state-legislature`.
- **Gap artifact visually differs**: a rendered PDF page, not an inbox. Same typographic register — white artifact card, hairline rules, mono metadata.
- **Specimen has three extra fields** vs state-leg: `Neighborhood associations`, `Census tracts`, `Agenda-linked`. These are the local-decision-maker's weighted evidence types.
- Anchor list is heterogeneous by design — city council, school board, water district, planning commission, transit authority — to demonstrate coverage breadth (24 boundary types).
- Same pricing block. Same friction line. Same CTA to `/org`.

## What this surface does NOT solve (honest gap)

- **Packet deadline detection is not automated**. Each jurisdiction has its own pre-meeting deadline (typically 24-72 hours). Commons surfaces the deadline but relies on the org to submit by it. Roadmap: calendar-feed integration.
- **Granicus / Legistar agenda-item linking** — works for jurisdictions using these platforms (majority of mid-size US cities). For smaller jurisdictions using bespoke agenda-posting systems, the agenda-link field is manually entered.
- **In-person testimony cards** — Commons produces the written packet but does not pre-fill the in-person speaker cards. Orgs still mobilize their verified constituents to show up. This is a deliberate line: Commons is the legibility layer, not the organizer.
- **Oral public comment timing** — many councils cap public comment at 1-2 min/speaker. The verified packet substitutes volume with legible proof, not more speaking time.

---

*Commons PBC · /org-v3 segment spec · 2026-04-17*
