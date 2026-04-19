# Advocacy World — Cross-Lens Research Synthesis

**Date:** 2026-04-18
**Purpose:** Document the globally-approximal findings from four independent research lenses on the advocacy ecosystem. Grounds the Commons /org landing page design in evidence rather than assumption.
**Status:** Reference document for design decisions. Not canonical strategy — the citations are.

---

## Why this document exists

The `/org` pre-auth landing page has been iterated multiple times. Each iteration exposed that the preceding one was anchored to invented context rather than researched truth. This document captures what four parallel research passes established about the advocacy world so future design decisions can be made against cited evidence rather than plausibility.

The four lenses:

1. **Macro-structure** — Population shape of the US advocacy ecosystem (counts, sizes, geography, funding)
2. **Intake + efficacy, global** — How decision-makers across US tiers AND across democracies actually receive and triage advocacy; what academic + practitioner research says actually moves decisions
3. **Platform market** — Consolidation, real market share, pricing reality, churn, emerging threats
4. **Movement theory + practitioner voice** — Academic frameworks (Han, Skocpol, Tufekci, Schlozman/Verba/Brady, Ganz) + contemporary practitioner critique

---

## Lens 1 — Macro-structure (US advocacy ecosystem shape)

### Population table

| Tier | Count | Source |
|---|---|---|
| Total registered US nonprofits (all 501(c) subsections) | ~1.8M (Jan 2024) | IRS/NCCS via Funraise, Statista |
| 501(c)(3) public charities | ~1.08–1.3M | NCCS Sector in Brief 2019 |
| 501(c)(4) social welfare orgs | ~71,000 (FY2024) | Statista |
| NTEE R+S+T+U+V+W+Y+Z (advocacy-adjacent bucket) | 38,071 public charities (12.0% of 2016 total) | NCCS Sector in Brief 2019 |
| Federal PACs filing 2023–24 | 8,540 | FEC |

### Size distribution (public charities)

- **Under $500K expenses: 66.6% of charities, <2% of expenditures** (NCCS 2016)
- **$10M+ expenses: 5.4% of charities, 88.1% of expenditures**
- **69% of US nonprofits have budgets under $50,000** (Candid, via Nonprofit Quarterly) — mostly all-volunteer

### Geographic concentration

- Top states by count (2023): California ~200K, Texas ~148K, New York ~122K
- Nonprofit share of private employment (BLS): DC 26.6% (highest); NY + RI tied 18.1%
- Metro density: Boston #1 locally-focused per-capita, then SF, then DC
- Northeast > Midwest > West > South

### Issue concentration (2016 NCCS, 1.08M base)

| NTEE group | Share |
|---|---|
| Human Services (I–P) | 35.2% |
| Education (B) | 17.2% |
| Health (E–H) | 12.2% |
| **Advocacy-adjacent (R,S,T,U,V,W,Y,Z)** | **12.0%** |
| Arts/Culture (A) | 10.0% |
| Religion-related (X) | 6.6% |
| Environment/Animals (C,D) | 4.7% |
| International (Q) | 2.2% |

### Tech spending

- Small (<$1M budget): 13.2% of budget on IT, avg $7,595/yr
- Medium: avg $45,184/yr
- Large: 2.8% of budget, avg $101,064/yr
- Training ≈ 1% of tech budget across all sizes
- Advocacy tooling specifically (inferred): **$3,000–$15,000/yr** for a 2–50 person org

### Addressable market for Commons

**Funnel:**
1. ~1.3M public charities (base)
2. ~109,000 advocacy-oriented (R/S/T/U/V/W/Y/Z + 501(c)(4)s)
3. ~34,000 with any paid staff capacity (after stripping 69% sub-$50k volunteer band)
4. **4,000–12,000 US orgs** realistically run recurring decision-maker campaigns
5. **3,000–8,000** in the 2–50 staff sweet spot
6. Plus 1,000–2,000 coalition/union/(c)(4)/faith-based

**Commons US TAM: 4,000–10,000 orgs.** International expansion is structurally required for scale.

---

## Lens 2 — Intake + efficacy, global

### International intake table

| Country | Petition mechanism | Constituent-mail tool | Transparency register | Notable pattern |
|---|---|---|---|---|
| **UK** | petition.parliament.uk — 10k response / 100k debate consideration | WriteToThem.com (MySociety, 20+ yrs); 38 Degrees (~2M list) | UK Lobbying Register (narrow) | Users skew older, well-educated, white (MySociety research) |
| **EU** | European Citizens' Initiative (ECI) — 1M signatures + 7 of 27 member states over 12 months | Fragmented through national platforms | EU Transparency Register (mandatory 2021, tightened Sept 2025) | 24M+ signatures since 2012; 4 ECIs crossed threshold in 2025 |
| **Canada** | House e-petitions — requires MP sponsor; 500 valid signatures | Direct email to MPs | Lobbying Act / Commissioner of Lobbying | CBC reports uncertain material effect |
| **Australia** | House petitions — min 1 signature; Petitions Committee review | Direct email; ACOSS + GetUp | Australian Register of Lobbyists | Petitions tabled Mondays; ministerial response required |
| **Germany** | Bundestag e-petitions — quorum reduced 50k→30k June 2024 | Direct Bundestag email; abgeordnetenwatch.de | Bundestag Lobby Register (2022, mandatory) | Article 17 Grundgesetz guarantees petition right |
| **France** | RIP — 1/5 Parliament + 10% electorate (~4.9M) / 9 months. Citizen threshold never reached. | Direct email; change.org-style | HATVP | 2019 ADP privatization RIP got 1.09M — failed |

### US intake map (cross-tier)

| Tier | Intake system | Volume | Reader | Dismissal tell |
|---|---|---|---|---|
| US Congress | CWC/SOAPBox → Fireside21 / IQ / iConstituent "Campaign Mail" tab + A\|B diff | 10k–1M+/bill | LC → LA → LD | Identical body/subject auto-grouped |
| State legislature | Fragmented: CA Position Letter Portal, IL Witness Slips, TX Witness Registration kiosks, NY Bluebird, Indigov, IQ, Fireside State; most = generic email | 500–50k per marquee bill | CA/IL: committee bill analyst. Most states: legislator personally or 1 shared aide | Form body; no local connection; missed 7-day pre-hearing deadline |
| Federal agency | regulations.gov v4 GET+POST API; 50k–4M comments (FCC net neutrality hit 22M) | 50k–4M | Docket officer / contractor team | Identical language → "mass comment campaign" bucket; one representative sample + total count posted |
| State agency / PUC / BOE | Per-commission docket portals (OR, HI, CO, CA, PA PUCs have web forms); state-EPA/BOE use email | 100–10k | Docket clerk | Off-topic to docket; no rule-section citation |
| Governor's office | Texas: Correspondence Tracking System (CTS); some Salesforce Constituent Services; IQ at 50% of US governors | 1k–20k | Constituent Services Unit | Out-of-state sender; not identifiably a state resident |
| County board / city council | Email to clerk, written comment cards at meeting, agenda-item portals (Granicus/Legistar) | 50–2k | City/county clerk | Not agenda-linked; off-topic |
| Special district (water/school/fire) | Email to `board@` + clerk-assembled PDF packet distributed before meeting | 10–500 | District clerk | Off-topic; submitted after packet deadline |

### Efficacy research synthesis

**Congressional Management Foundation (CMF 2017, *Citizen-Centric Advocacy*)** — definitive staff survey.

Influence hierarchy (% of staff saying "some" or "a lot" of influence on undecided Member):
- **In-person constituent visits: 94%**
- **Individualized emails from constituents: 92%**
- Individualized letters: 88%
- Phone calls: 84%
- **Form emails: 51%** (near coin flip)
- Petitions: lowest

**CMF 2004/2015** — 53% of Hill staffers agreed form-message campaigns are sent *without constituents' knowledge or consent*. Another 25% unsure. **78%** of staff say it is "helpful" or "very helpful" when advocacy campaigns reveal their identity.

**CMF preparation gap**: 12% of constituents are "very prepared" for Hill meetings; **97%** of advanced-advocacy trainees are. **8x legibility delta** driven by training, not volume.

**Volume context**: Some Senate offices receive up to 25,000 messages/week. Fireside21 handles **81M messages/year** across Congress.

**GW Regulatory Studies Center (*Are Agencies Responsive to Mass Comment Campaigns?*)**: 54% of comments did not match on any dimension of final rule change. Agencies weight sophisticated technical/economic comments disproportionately.

**Walker & Le (Socius 2023, *Poisoning the Well*)**: peer-reviewed evidence astroturfing measurably *harms trust* in legitimate advocacy orgs. Citable market-failure anchor.

### Structural findings (universal across democracies)

1. **Staff, not members, triage incoming mail.** UK, Canada, Australia, EU all first-touch by caseworkers/LAs/staffers.
2. **Thresholds exist to filter, not to obligate.** UK 10k/100k, Germany 30k, Canada 500, EU 1M, France RIP — designed for self-selection.
3. **Personalization and geographic legitimacy dominate weighting.** Universal filter: "Is this person in my constituency, and did they write something specific?"
4. **Transparency registers expanding.** Direction of travel: regulated disclosure, not volume.
5. **Platforms sell volume; decision-makers consume specificity.** Consistent across every democracy.

**US-specific features**:
- CWC API standardization (unusual for a national legislature)
- 50-state fragmentation of state-leg intake (no parallel elsewhere)
- regulations.gov national rulemaking portal
- Highest professionalized-advocacy density per citizen of any democracy

---

## Lens 3 — Platform market reality

### Ownership / consolidation map

| Parent | Portfolio | Ownership | Key dates |
|---|---|---|---|
| **Bonterra** | EveryAction, Network for Good, Social Solutions, CyberGrants, ActionKit, Salsa Labs | PE — **Apax Partners** | Rebrand 2022; 20%+ layoffs Sep 2023 |
| **NGP VAN** (separate from Bonterra, same parent) | NGP VAN, Mobilize | PE — Apax | Acquired Aug 2021; near-collapse summer 2024 |
| **Quorum** | Quorum, Capitol Canary (fka Phone2Action) | PE — Serent Capital | Capitol Canary acquired Sep 2022 |
| **FiscalNote** | CQ Roll Call, VoterVoice, Fireside, PolicyNote | Public (NYSE: NOTE) | VoterVoice 2017; Fireside May 2021; divesting non-core |
| **Blackbaud** | Raiser's Edge NXT, Luminate Online | Public (NASDAQ: BLKB) | Longstanding incumbent |
| **Bloomerang** | Bloomerang, Kindful, InitLive, Qgiv | PE — JMI Equity | Kindful 2021; InitLive 2023; Qgiv Jan 2024 |
| **Salesforce.org** | Nonprofit Cloud / Agentforce Nonprofit | Public (NYSE: CRM) | NPSP feature-frozen since Mar 2023 |
| **Action Network** | Action Network, Action Builder | **501(c)(4) owns C-corp** (not PE/VC) | Founded 2012; co-developed with AFL-CIO |
| **NationBuilder** | NationBuilder | Private, founder-held | Independent |
| **The Movement Cooperative (TMC)** | Data/license co-op for 80+ progressive orgs | Nonprofit cooperative | 2018; 116 TB pooled data; $15M 2024 budget, $3.4M shortfall |

**What remains independent**: Action Network (only materially-sized non-extractive progressive option), NationBuilder, OneClickPolitics, Muster, CallHub, Resistbot, TMC.

### Market structure + structural moment

- Public affairs & advocacy software: ~$1.5–1.6B in 2025 (Research Nester)
- Grassroots advocacy: ~$192M in 2026, 9–10% CAGR to 2035

**The 2024 NGP VAN near-collapse is the structural event of the cycle.** DNC + Harris campaign seconded engineers for months. LinkedIn's Allen Blue personally intervened. Produced:
- **TMC RFP for next-generation voter database** (80+ member orgs including Greenpeace, MoveOn, Black Voters Matter, WFP, VotoLatino, NARAL, Common Cause), targeting 1H 2026 deployment
- Early-2025 DNC-operative meeting in Puerto Rico
- Progressive Turnout Project's $44M 2026 canvassing program moved to TouchStone over MiniVan/NGP VAN
- Higher Ground Labs published critique: *The EveryAction Acquisition: Where do we go from here?*

### Switching costs (load-bearing)

1. Historical constituent data irrecoverable without re-matching/de-duping
2. Integrations with ActBlue, form embeds, email domains, SMS short codes
3. c3/c4 data-firewall agreements renegotiate with each vendor
4. Donor-ID continuity affects tax-receipt audits
5. Staff training sunk cost — "VANxiety" (Sifry's term)

### Emerging threats / challengers

| Challenger | Threatens | Signal |
|---|---|---|
| TouchStone | MiniVan/NGP VAN canvassing | PTP picked over MiniVan for 2026 |
| TMC next-gen DB RFP | NGP VAN voter file | 1H 2026 deployment target |
| Higher Ground Labs portfolio (82 cos, $42M AUM) | Unbundles EveryAction/NGP VAN | Claims $27M+ 2024 cost savings |
| OneClickPolitics, Muster | VoterVoice/Capitol Canary | 400+ and dozens of orgs |
| Resistbot | Bypasses CRMs entirely | Citizen-to-rep direct |
| DIY stacks (Airtable+Mailchimp+Zapier) | SMB donor/advocacy | 78% of nonprofits using GenAI (M+R 2025) |
| AI-native entrants (BattlegroundAI, PolicyNote, Quorum AI) | Writing layer | Incumbents scrambling |

### Real pricing (list + actual)

| Platform | List | Actual signal |
|---|---|---|
| Action Network | $15/mo base + $1.25/1k emails | Mostly list; self-serve |
| NationBuilder | $34/mo published, $499–$5,000+/mo at scale | Per-active-supporter pricing cliffs |
| EveryAction / Bonterra | Demo-gated | Data migration $10k–$50k+ |
| Blackbaud RE NXT | Undisclosed; mid-5 to 6-figure/yr | $50k–$250k implementation "notorious" |
| Salesforce NPSP/Cloud | ~$60/user/mo base + add-ons | $50k–$500k SI engagement |
| Quorum | Quote-only, ~$10k–$40k/yr | Corporate premium |

---

## Lens 4 — Movement theory + practitioner voice

### Theoretical consensus (3+ thinkers agree)

1. **Professional-staff advocacy hollowed out mass membership** (Skocpol 2003)
2. **Mobilization without organization is fragile** — Tufekci's "tactical freeze" + Han's *Prisms of the People*
3. **Participation skews upper-class; internet replicates inequality** (Schlozman/Verba/Brady 2012)
4. **Relationship-building, not volume, produces power** (Han's transactional vs. transformational)
5. **Form communication is already discounted** — staff agree (CMF)

### Theoretical disagreements

- **Is the internet extractive or generative?** Tufekci cautious-pessimistic; Han conditionally optimistic; Schlozman flatly pessimistic
- **Source of decline.** Skocpol blames institutional/elite choices; Tufekci blames tech affordances; Honig implicates erosion of durable public infrastructure
- **Is mass scale a virtue?** Han/Ganz say no; Tufekci says it signals less capacity than pre-digital

### Practitioner voice (sampled quotes)

1. **CMF**: "Messages that are customized in some way by constituents are much more influential than identical form messages."
2. **Maurice Mitchell** (WFP, *Building Resilient Organizations*, 2022): movement orgs have traded durable power for performative tendencies and small-group dynamics.
3. **Hahrie Han** (Manageable interview, 2020): relational organizing "is not just an extra sentence in an email but a true commitment to relational organising: to investing in the skills and people."
4. **Marshall Ganz** (Narrative Arts): Public narrative is "a triad of leadership skills engaging the hands (action), the head (strategy), and the heart (narrative)."
5. **Building Movement Project, Race to Lead 2022/2024**: Interest in top leadership roles fell from 50%→46% (white staff) and 40%→32% (BIPOC staff).
6. **CEP State of Nonprofits 2024**: 95% of nonprofit CEOs concerned about burnout; over 50% report more personal burnout than previous years.
7. **Walker & Le (Socius 2023)**: Astroturfing "stems from unverified constituents or without a constituent's consent" and "erodes trust in legitimate advocacy organizations."
8. **Sifry (2023)**: "VANxiety" — fear of losing NGP VAN muscle memory driving retention despite dissatisfaction.

### Imagined critique — Han, Skocpol, Tufekci reading the Commons /org page

**Skocpol**: Recognizes the problem the page names, approves the rehabilitation of "constituent." But presses: *"Is Commons building federated local chapters, or is it a cleaner pipe for the same management-layer orgs?"* Pricing tiers describe staff, not members. Where is the leadership ladder for the 248 verified constituents? They appear as *evidence*, not as *members*.

**Han**: Appreciates "authored for you" and "individually composed" — a gesture toward depth. But: *"This is still mobilization, not organization. A verification packet documents a transaction. Show me the transformational arc: how does signature #1 become a team captain who recruits ten more?"*

**Tufekci**: Correctly diagnoses a legibility gap (staffers can't tell real from astroturf CSV) but may reproduce tactical-freeze at a new layer. *"If orgs can now generate verified packets faster, they still lack decision-making infrastructure for what to do when the packet fails to move the decision-maker. What is the second move?"*

All three would point at the "No demo required. No procurement review." line as a tell: Commons sells frictionless adoption, which Skocpol would call the direct-mail logic reincarnated.

---

## Cross-lens convergences (bedrock findings)

### Bedrock 1: Form communication is already discounted everywhere, measurably.

**Lenses:** Intake-global (CMF 94/92/51%), Theory (Walker & Le peer-reviewed), Platform (Trustpilot/NPTechNews user reviews).

**Implication for page:** The staff-side filter heuristic — personalization × verified constituency × local specificity — is universal. Commons's specimen maps cleanly. Page should surface this mapping more explicitly.

### Bedrock 2: TAM is small and concentrated; international is structurally required.

**Lenses:** Macro (4–10k US orgs), Platform ($192M grassroots market; vendor counts overlap heavily), Theory (Skocpol — professionalized advocacy IS shrinking), Intake-global (US has highest professionalized-advocacy density — meaning the buyer, not the constituency).

**Implication for page:** Commons can't be mass-market. Serves deeply, not broadly. Page should signal international reach or at least not preclude it.

### Bedrock 3: Incumbent ecosystem is structurally unstable RIGHT NOW.

**Lenses:** Platform (2024 NGP VAN collapse, TMC RFP, Bonterra defections, Salesforce NPSP freeze), Theory (Mitchell 2022 critique, BMP Race to Lead pipeline collapse), Intake-global (transparency registers expanding globally — EU 2021 tightened 2025, Germany 2022).

**Implication for page:** Timing is correct. Orgs are actively shopping. The page should acknowledge the moment without naming vendors — "the CRM you use was just sold again; the staffer has seen that form letter before."

### Bedrock 4: The specimen is theoretically load-bearing but under-surfaced.

The specimen contains:
- `Identity: 156 gov ID · 92 address-matched` — **verified constituency** (CMF's #1 weighted filter)
- `Authorship: 196 individually composed · 52 shared statements` — **personalization × authorship mode** (Han's transformational vs. transactional)
- `Geography: 14 communities across district` — **local specificity** (CMF "91% of staff value district-specific impact info")
- `Screening: one submission per person · duplicates removed` — **anti-astroturf** (Walker & Le market failure)

**Implication for page:** Every specimen field maps to research-validated staff behavior. The displacement line could make this explicit: not just "identity, district, authorship, audit trail" but what each does.

---

## Divergences (contested terrain)

- **Tufekci vs. platform-market on tactical freeze** — does better tooling cause or cure freeze?
- **Han vs. Commons pricing model** — tiers describe staff seats, not members. Skocpol's exact critique.
- **Theory vs. practice on AI-authored personalization** — Han/Ganz say relational trust requires depth; M+R 2025 shows 78% nonprofits using GenAI. Commons's `196 individually composed` line implicitly bets AI-assisted authorship counts.

---

## What the current page solves vs. doesn't solve

### Solves (structurally validated)

- Legibility gap at intake
- Identity + district + authorship disclosure
- Friction removal at adoption
- Price anchoring against category

### Doesn't solve (research-surfaced gaps)

1. **Incumbent-crisis moment** — 2024 NGP VAN collapse, PE anxiety, Bonterra defections. Page doesn't reference the structural signal orgs are feeling.
2. **International dimension** — If TAM is small domestically, Commons needs international. Page is US-only in framing.
3. **Tufekci's second-move question** — what happens when the verified packet doesn't move the decision-maker? Page presents delivery as terminal.
4. **Skocpol's leadership-ladder critique** — pricing tiers describe staff, not constituency. Roadmap may address; page doesn't indicate.
5. **Switching costs beyond list import** — ActBlue integrations, c3/c4 firewalls, donor-ID continuity, email deliverability, SMS short codes. "Import from Action Network or any CSV export" is necessary but incomplete.
6. **Citable anchors** — page makes structural claims but cites no research. CMF 2017, Walker & Le 2023 Socius would ground it.
7. **Authorship × verification as primary thesis** — specimen shows it; displacement copy names it in passing. Could be the thesis, not a feature list.

---

## Three paths forward

### Path 1: Tight research-informed sharpening

Keep current page structure. Surgical edits:
- Add one line acknowledging incumbent-crisis without naming vendors
- Add one citation annotation near displacement line
- Rewrite displacement line to foreground authorship × verification
- Add international anchor to boundary list
- Possibly hint at the leadership-ladder dimension

**Scope:** 4–6 edits. ~2 hours work. Low risk.

### Path 2: Full repositioning pass

Rebuild the thesis around research findings. Page restructures as an argument:
**Problem (form mail discounted) → Evidence (CMF/Walker & Le cited) → Commons mechanism (authorship × verification × geography × screening mapped to staff filters) → International reach → Incumbent crisis window → Friction removal → Price**

Treats page as an argument, not a product pitch.

**Scope:** Substantive rework. ~1 day design + engineering.

### Path 3: Segment-forked surfaces

Build three entry surfaces:
- `/org/state-legislature` (primary — repro/gun safety/LGBTQ)
- `/org/agency-rulemaking` (environmental/disability/food)
- `/org/local-government` (housing/police accountability/tenant)

Each uses the segment's actual target vocabulary. Current `/org` becomes the menu.

**Scope:** ~1 week for full implementation; scoped to exemplar + specs for this research phase.

---

## Honest gaps

- **Platform stacks at state-chapter level are inferred, not verified.** No platform publishes a per-customer directory with org size.
- **Staff sizes for JCRCs, state Catholic conferences, faith-based** — publicly under-reported.
- **Worker-center platform stack** outside SEIU/AFL-CIO ecosystem poorly documented.
- **BLM chapter landscape post-2022** — significant attrition; current count of actively-staffed chapters not publicly tracked.
- **Overwhelm patterns** composed from general nonprofit-burnout literature + segment-specific extrapolation. Needs ~3 ED interviews per segment (~45 total) to verify.
- **Vendor market-share at granularity is genuinely not public.** M+R Benchmarks and NTEN publish program benchmarks, not vendor-share splits. Any "X% of orgs use Y" claim is estimation.

---

## Citations

### Academic
- Han, Hahrie. *How Organizations Develop Activists* (Oxford, 2014). *Prisms of the People* (Chicago, 2021).
- Skocpol, Theda. *Diminished Democracy: From Membership to Management in American Civic Life* (2003).
- Tufekci, Zeynep. *Twitter and Tear Gas: The Power and Fragility of Networked Protest* (Yale, 2017).
- Schlozman, Kay, Sidney Verba & Henry Brady. *The Unheavenly Chorus* (Princeton, 2012).
- Walker, Edward & Andrew Le. "Poisoning the Well: How Astroturfing Harms Trust in Advocacy Organizations." *Socius* (2023).
- GW Regulatory Studies Center. *Are Agencies Responsive to Mass Comment Campaigns?*

### Research organizations
- Congressional Management Foundation (CMF). *Citizen-Centric Advocacy* (2017). congressfoundation.org
- Urban Institute / National Center for Charitable Statistics. Sector in Brief (2019). nccs.urban.org
- M+R Benchmarks 2024 / 2025. mrbenchmarks.com
- Nonprofit Technology Network (NTEN). 2024 Digital Investments Report. nten.org
- Building Movement Project. *Race to Lead / Meeting the Need* (2022–24). buildingmovement.org
- Center for Effective Philanthropy (CEP). *State of Nonprofits 2024*. cep.org

### Government / regulatory
- IRS Tax-Exempt Organization Search + Business Master File
- Federal Election Commission (FEC) 2023–24 cycle statistics
- US Bureau of Labor Statistics (BLS) Monthly Labor Review 2025
- House.gov Communicating with Congress (CWC) project
- regulations.gov v4 API (open.gsa.gov)

### Industry / platform
- Intercept reporting on NGP VAN / Bonterra (2022, 2023)
- Campaigns & Elections on Progressive Turnout Project / TouchStone (2026)
- The Hill on PTP 2026 spending
- Movement Cooperative (movementcooperative.org); Inside Philanthropy coverage (2024)
- Higher Ground Labs portfolio and critique pieces
- Sifry, Micah — *Living with VANxiety* (2023)

### Practitioner voice
- Mitchell, Maurice. *Building Resilient Organizations* (Convergence, Nov 2022)
- Ganz, Marshall — Public Narrative (via Narrative Arts interview)
- Action Network Trustpilot reviews
- EveryAction NPTechNews review

### International intake
- petition.parliament.uk (UK)
- citizens-initiative.europa.eu (EU ECI)
- europarl.europa.eu/at-your-service/en/transparency/lobby-groups (EU 2025 tightened disclosure)
- ourcommons.ca (Canada House e-petitions)
- aph.gov.au (Australia House petitions)
- bundestag.de (Germany quorum reduction 2024)
- conseil-constitutionnel.fr (France RIP)
- Escher, Tobias. "MySociety WriteToThem Usage Report" (2011)
- abgeordnetenwatch.de (Germany MP Q&A)

---

## Adoption (2026-04-18)

The synthesis was implemented on `/org` via Path A (hybrid): Path 2's research-grounded argument structure became the canonical page, with Path 1's hero and displacement-line wins folded in. Path 3's segment pages kept `/org-v3/state-legislature` as the Phase 2 exemplar; the segment menu was retired because `/org`'s reach section absorbed its function.

**Implementation sequence:**

1. **T44 · Fold** — Path 1's hero (`312 signatures. No proof any of them live in the district.`) replaced Path 2's stat hero; Path 1's displacement rewrite replaced Path 2's mechanism subheading; meta description updated.

2. **T45–T48 · Two brutalist cycles (structural)** — 14 sharp fixes applied across two rounds:
   - Specimen provenance "Sample" → "Example"
   - Incumbent-window narrowed from PE-universal to TMC-RFP-specific
   - Reach heading "Every jurisdiction, one pipeline" → "One packet model across fragmented intake"
   - Identity filter-map citation corrected (was overclaiming vs. source)
   - Inbox + specimen jurisdictionally aligned (CA-12 / HR 5421 throughout)
   - Inbox caption and Walker & Le citation split for honest attribution
   - International items removed from live-grid, separated below
   - "Phase 2" (internal) → "shipping 2026" (external)
   - Vague "migration everyone else ran" removed
   - Counter paragraph resequenced damning-first (51% / half / 92% positive-contrast)
   - Bridge sentence added between hero and counter
   - Factual correction: 94% → 92% (94% is in-person visits per CMF; individualized emails are 92%)
   - Beat 5 body rewritten to advance from pull-quote with switching-costs framing
   - "shipping 2026" repetition reduced from 3 mentions to 1

3. **T49 · Perceptual engineering (8 axes)** — bridge sentence weight raised; mobile inbox columns `2.25rem 5rem 1fr`; mobile reach grid 2-col from 0px; `$0.` punchline restructured with adjacent scope line (`100 verified actions · 2 seats · no time limit`); spatial arc re-tuned (window→price now largest gap); typography register corrected (`reach__footer` + `pricing-limits` numbers moved to Mono); mobile filter-map separation strengthened.

4. **T50 · Final validation gate** — programmatic DOM verification of all 14 cycle fixes + all 8 perceptual axes. Zero regressions. Promoted.

5. **T51 · Promotion** — `/org-v2` content copied to `/org` (previous sharpened Path 1 overwritten); `/org-v2` directory deleted; `/org-v3/+page.svelte` menu deleted; `/org-v3/state-legislature/` preserved for Phase 2 segment work.

**Rejected findings preserved for reference:**
- Movement-theory / Skocpol leadership-ladder objection — out of scope for pre-auth acquisition surface
- Buyer conflation (3-person vs 50-person) — partially addressed by incumbent-window narrowing; full segment-fork is Phase 2
- "Last third accumulates arguments" — each beat does distinct work
- Congress-coded artifact vs state-leg audience — reach section explicitly lists state legislatures

**Phase 2 follow-ups (tracked for future iteration):**
- Build `/org-v3/agency-rulemaking` and `/org-v3/local-government` from specs already written in `docs/design/ORG-V3-SPEC-AGENCY-RULEMAKING.md` and `docs/design/ORG-V3-SPEC-LOCAL-GOVERNMENT.md`
- Leadership-ladder / member development surface (person-layer concern per Skocpol/Han critique)
- Verify platform stacks and overwhelm patterns via ~45 ED interviews across three beachhead segments (reproductive / environmental / LGBTQ)

---

## Phase 2 — Segment-routing architecture (2026-04-18)

The canonical `/org` argument page was extended into a three-segment routing architecture under `/org/for/*`. Each segment page uses the same structural spine as `/org` but with segment-native gap artifacts, specimens, displacement framing, and reach lists.

### Routes shipped

| Route | Role |
|---|---|
| `/org` | Canonical argument page (universal) |
| `/org/for` | Routing menu — 3 typographic blocks |
| `/org/for/state-legislature` | Segment: state-leg (reproductive rights, gun safety, LGBTQ, criminal justice, environmental state chapters) |
| `/org/for/agency-rulemaking` | Segment: federal/state agency dockets (environmental, disability, food security, labor) |
| `/org/for/local-government` | Segment: city councils, county boards, school boards, special districts (housing, police accountability, tenant, water) |

### Per-segment design signatures

- **State-legislature**: shared-inbox spray (`staff@txsenate.gov` with 8 identical SB-4 subject lines, "305 more · aide rule-filed"); Texas HD-108 specimen; session-aide reader; CWC-absence window citing NCSL staffing; `01` ordinal.
- **Agency-rulemaking**: regulations.gov docket folder view with collapsed mass-comment bucket; EPA-HQ-OAR-2025-0147 specimen with 6 evidence fields including proximate impact and rule citations; docket-officer reader; GW Regulatory Studies + ACUS citations; `02` ordinal.
- **Local-government**: Times-serif PDF packet page with ToC of 7 identical comments and Fri→Mon clerk footnote; Santa Clara Valley Water rate-adjustment specimen with Census tracts and neighborhood associations; clerk reader; `board@district.gov` mailbox-pathology window; `03` ordinal.

### Reach-section wiring on /org

Three of nine reach anchors route to segment pages:
- "State legislatures" → `/org/for/state-legislature`
- "Federal agency dockets" → `/org/for/agency-rulemaking`
- "City councils" → `/org/for/local-government` (chosen over "School boards" after cycle 2 found school-board-only doorway too narrow for housing/police/tenant orgs)

Other 6 anchors stay plain text — honest signal that 3 of 9 have dedicated deeper surfaces.

### Beachhead selection rationale

Three of 15 researched advocacy segments got dedicated pages:
- **Reproductive rights / gun safety / LGBTQ** (state-leg): post-Dobbs whiplash + 500+ bills/session, Equality Federation cross-pollinates tools, ~1,500–2,500 orgs
- **Environmental / disability / food** (agency): 2017 FCC bot-comment scandal institutional memory, ~2,000–3,000 orgs
- **Housing / police / tenant** (local-gov): shared-mailbox + PDF-packet pain, clerk's triage is visibly broken, ~800–1,200 orgs

Other 12 segments deferred: civil liberties (ACLU/bail funds), labor, voting rights, immigration, criminal justice, faith-based, disability rights, racial justice, education, food security, animal welfare, veterans. These use the canonical `/org` page; dedicated segment surfaces are Phase 3.

### Iteration history

1. **T53–T54 · Scaffold** — Migrated state-legislature from `/org-v3/state-legislature` to `/org/for/state-legislature`; retired `/org-v3/` directory.

2. **T55–T58 · Parallel build** — Three agent teams concurrently built agency-rulemaking, local-government, and the `/org/for` menu. Reach-section anchors wired from `/org`.

3. **T59–T60 · Brutalist cycle 1 (11 fixes)** — State-legislature heaviest (missing filter-map, missing window, Sample→Example, pricing alignment, reader commit to session-aide, state-intake-native artifact); agency citation fidelity (3 overclaims softened); local overclaim softening (3); menu duplicate removed.

4. **T61–T62 · Brutalist cycle 2 (3 fixes)** — State-leg committee-analyst foil removed; reach link School boards → City councils; state-leg background CSS added.

5. **T63 · Perceptual engineering (8 axes)** — Cross-surface coherence unification: 54rem inner widths, 36rem hero widths, shared gap-artifact chrome register, unified filter-map and pricing patterns, Satoshi+Mono register corrected on anchor footers, spatial arc (outcome 4rem → anchors 4rem → window 5.5rem biggest pivot → price) matched across segments.

6. **T64 · Final validation gate + 3 polish fixes** — Codex flagged totalizing-language residuals ("covers all of them" on state-leg, "docket-agnostic" on agency, "full hierarchy" on local). Softened to: "supports district-keyed packets across every chamber" / "across federal rulemaking dockets; state PUCs onboarded selectively" / "clerk-assembled packets across most district types."

7. **T65 · Regression** — Screenshots captured across all 5 routes at 1280×800 + mobile verification on state-leg (biggest recent change). Navigation flows (/org → /org/for → /org/for/<segment> + back-links) verified live. Console clean on all 5.

### Rejected / deferred across cycles

- Movement-theory (Skocpol leadership-ladder) critique — out of scope for pre-auth acquisition; Phase 3 person-layer concern
- Buyer conflation (3-person vs 50-person org) — partial mitigation via incumbent-window narrowing
- Local-government filter-map block — low severity, page reads coherently without; deferred to future tightening
- Specimen label-width asymmetry (agency 7rem vs others 5.5rem) — content-driven by field-name length, justified
- Pull-quote clamp variance on local-gov — compensates for inline code-styled text

### Open questions for future iteration

- Build dedicated surfaces for remaining 12 advocacy segments? Or treat the 3 current segments as sufficient routing for the primary beachhead work?
- Verify platform stacks + overwhelm patterns via ~45 ED interviews across the 3 beachhead segments (scientist's instinct: current segment research is inferred from public signals, not primary research)
- International expansion: ship UK Parliament / EU Parliament / Bundestag adapters per the 2026 commitment now embedded in `/org` reach section and `/org/for/agency-rulemaking`
- Leadership-ladder surface (Skocpol/Han critique) — Phase 3 person-layer work if/when pricing evolves beyond seats to members

---

*Commons PBC · Research Synthesis · 2026-04-18 · Reference document for /org and /org/for design decisions.*
