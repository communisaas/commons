# Competitive Analysis

> commons.email vs. the advocacy software market
> Last updated: 2026-05-27 (refresh layer added — see "Material Updates — May 2026" below)
> Original baseline: 2026-03-07

---

## Material Updates — May 2026

This section captures the deltas from a 13-lane parallel research pass completed 2026-05-26. The original March 2026 baseline analysis remains below for context. Where the two conflict, prefer this layer.

### Six structural shifts

**1. FiscalNote (NYSE→OTCID) is in going-concern distress.** NYSE delisted FiscalNote on April 13, 2026 after stock fell below $1; now trades on OTCID Basic Market with ~$5M market cap. Q1 2026 revenue collapsed 27% YoY to $20M. Forbearance agreements with subordinated creditors expire May 21, 2026 (waived NYSE delisting-triggered defaults on convertible notes until that date). FY2024 organic ARR (ex-divestitures) declined to $93.3M from $96.5M FY2023; further fell to $87.7M in Q1 2025. The board is "evaluating all strategic value-maximizing options... including evaluation of potential further divestitures." Already exited: Board.org (2023), Aicel ($9.6M Oct 2024), Oxford Analytica + Dragonfly ($40M to Dow Jones early 2025), TimeBase (May 2025). **VoterVoice (2,000+ orgs) and Fireside21 (~150 House office installs) are both candidate divestitures** — neither is core to the stated "policy-centric growth" narrative.

Important correction to the March 2026 baseline: The 65% Congress CRM figure belongs to **IQ/Leidos IQ**, not Fireside21. Fireside historically claims "150 members and committees in Congress" — a subset, not a dominance. **Indigov** (YC-backed, modern API-native Congressional CRM) has been winning freshman office installations across the 117th and 118th Congresses — a structural displacement of both Fireside and IQ in the renewal pipeline.

FiscalNote's April 8, 2026 PolicyNote API launch added VoterVoice-powered address-to-district matching as a programmatic primitive, with explicit marketing language: *"Unlike competitors who rely on third-party vendors for district matching and inherit their limitations, FiscalNote owns and maintains its district data infrastructure."* This is market validation of the Shadow Atlas thesis — stated by an incumbent under going-concern pressure. VoterVoice covers federal/state/basic local; Shadow Atlas covers 24 boundary types including special districts (water, fire, transit, etc.).

The dual-ownership "closed loop" pitch (VoterVoice + Fireside under one parent) is architectural, not operational. Documented data flow runs VoterVoice → PolicyNote (one direction). No documented Fireside → VoterVoice/PolicyNote pipe. Congressional office response data does not flow back to advocacy orgs. Latent governance concern: FiscalNote could in principle observe aggregate Fireside response patterns at the parent level; no evidence this has been exploited.

**2. Bonterra ActionKit is functionally deprecated.** MoveOn formally migrated to Action Network; contract ended **May 31, 2025**. ActionKit's developer team was cut to ~5 engineers in the September 2023 Bonterra layoffs (200+ Bonterra cuts in a single round, ~20% of staff). After public pressure from MoveOn and 20+ ActionKit client coalition, two senior engineers were rehired. Salsa Labs is **closed to new customers** (run-off mode). No official ActionKit deprecation announcement; BSD Tools (also under the same lineage) was eventually shut down post-acquisition — the same trajectory is visible.

The Bonterra rollup actually has seven distinct codebases under one brand:

| Product | Origin | Acquired | Primary Function | Advocacy-Focused? |
|---|---|---|---|---|
| EveryAction | EveryAction (DC) | 2021 (Apax merge) | Nonprofit CRM + advocacy | **Yes — primary advocacy product** |
| Network for Good | NFG | 2021 | Donor management, small charities | Peripheral (forms/petitions, no legislator matching) |
| CyberGrants | CyberGrants | 2021 | Corporate philanthropy mgmt | No |
| Social Solutions | Social Solutions | 2021 | Human services / case mgmt | No |
| ActionKit | Blue State Digital → EA (2019) | Inherited | Advocacy CRM + email (legacy progressive) | **Yes — legacy, declining** |
| Salsa Labs | EA (2021) | Inherited | Mid-market CRM + advocacy | Marginal — maintenance only |
| OneCause | MK Capital | Oct 2025 | Fundraising events/auctions | No |

The 20,000+ org figure conflates all products. Estimated per-product splits (not published): EveryAction 5K–8K, Network for Good 8K–10K, ActionKit well under 1K post-MoveOn (possibly <500), CyberGrants enterprise corporate, Social Solutions government + large human services.

**Bonterra Que (Oct 2025) ships zero advocacy features.** Skills are entirely fundraising coaching, SMS creation (Network for Good only), grantseeking, grantmaking, case management. There is no announced Que integration with EveryAction's advocacy campaign features. The marketing language ("first agentic AI platform") overstates current capabilities; shipped features are AI-assisted workflow tools.

**3. NGP VAN summer 2024 near-collapse verified in detail; TMC RFP in pilot.** During the Harris campaign ramp, NGP VAN was unable to handle the data surge. The **DNC and Harris campaign seconded full-time engineering staff to NGP VAN for months**. Allen Blue (LinkedIn co-founder, DigiDems founder 2018) personally funded emergency infrastructure work — donor-class fixer + financier role, not hands-on engineering. **The DNC privately considered invoking a contractual clause giving it access to NGP VAN source code and the right to change providers — and chose not to.** This is the most important structural detail: the escape hatch exists; it has not been pulled.

NGP VAN's own September 2025 self-assessment claims 3.6 billion API calls and ~2,700 req/s on GOTV weekend with 3x headroom — partial-and-promotional framing that omits the secondment, Allen Blue's intervention, and the source-code-clause episode.

The Movement Cooperative (TMC) issued a **publicly-available RFP February 2025** for a next-generation voter contact CRM in direct response. Timeline: Phase 1 pilot May–Jul 2025; expanded August 2025; contract negotiations Q4 2025; member migration begins **1H 2026**. Vendor finalists not public. Scope: voter-contact CRM (VoteBuilder replacement), not advocacy-to-legislator campaigning — Commons does not compete with what TMC is procuring. TMC member orgs include Greenpeace, MoveOn, Black Voters Matter, WFP, VotoLatino, NARAL, Common Cause, Alliance for Youth Action, Rural Democracy Initiative, ISAIAH, Faith in Minnesota, M4BL.

Parallel signal: **PTP's $44.1M 2026 program moved MiniVAN → TouchStone, but retained ActionKit + NGP + Mobilize.** Surgical unbundling, not wholesale departure. Sets a precedent for selective migration patterns. TouchStone's GPS anti-spoofing feature is conceptually analog to Commons's verification thesis — value is in provenance of action (real person, real location, real time), not just record of it.

Practitioner essays (Micah Sifry, *The Connector* substack — *Living with VANxiety*, *Why Are We Still Living with VANxiety?*, *Slouching to Election Day with MiniVAN*) document the mechanism keeping orgs on NGP VAN despite dissatisfaction: VAN ID continuity, training network lock-in, state party access gating, career signaling, fear of being blamed. This is institutional inertia, not loyalty.

Saudi sovereign wealth fund (Sanabil) connection via Apax's ownership chain (Intercept, April 2023) is a quiet political vulnerability for NGP VAN that Democratic users can't fully articulate publicly. It is noted as background anxiety in organizer conversations.

**4. Senate Commerce 2024 investigation is primary-source documented.** Full citation: commerce.senate.gov, *"Senate Commerce Investigation Reveals How Big Tech Weaponizes Terms of Service to Silence the Right,"* April 24, 2024. Then-Ranking Member (now Chair) Ted Cruz. Bonterra cooperated after subpoena threat in early 2025; Cruz withdrew the threat. No public policy change announced by Bonterra.

Verbatim Bonterra ToS language documented: prohibited clients denying *"rights to the LGBTQ community,"* *"a woman's right to reproductive choice,"* *"racial justice,"* or *"climate change."* EveryAction internal policy stated clients could not be *"Not Progressive Aligned"* — defined as *"Can't be a Republican org,"* *"Can't go against LGBT+,"* *"Can't be against pro-choice."*

Six deplatformed organizations named in the report:
1. **Independent Women's Forum (IWF)** — primary case. Bonterra justified termination claiming IWF *"works to restrict the rights of the LGBTQ community."* Committee found no instance of hate/discrimination/violence.
2. **Wisconsin Right to Life**
3. **Idaho Family Policy Center**
4. **Deaconess Pregnancy & Adoptions**
5. **Stand for Health Freedom**
6. **The Ruth Institute** — terminated based on SPLC "hate group" label. Bonterra employee called the policy *"absolutely ridiculous"* via internal email (Daily Signal, June 2025).

Asymmetry the report noted: Bonterra continued serving the NJ chapter of CAIR and the Institute for Palestine Studies, both of which issued Oct 7 2023-related statements.

**Migration destinations: UNDOCUMENTED.** No public source identifies where any of the six went. Direct outreach required — these are high-priority Commons prospects.

**FreedomWorks dissolved May 2024** after 40% layoffs March 2023. Its Regulatory Action Center (RAC) — which engaged supporters in federal regulatory proceedings — is unmaintained. Millions of email subscribers in the libertarian-leaning grassroots advocacy network have no current organizational home.

**5. A2P 10DLC fully enforced February 1, 2025.** All major US carriers block 100% of unregistered 10DLC traffic; $10K per-violation fines. Every org sending SMS must register brand + campaign with The Campaign Registry (TCR). Managed P2P platforms (GetThru, Hustle, Scale to Win, CallHub) handle this on behalf of clients; DIY Twilio stacks require self-registration. This is a structural tailwind for managed P2P over raw Twilio, and raises the floor cost for any SMS capability Commons ships in Phase 2/3.

Related comms-infrastructure consolidation events:
- **ActBlue acquired Impactive (Sept 2025), rebranded ActBlue Field Tools (2026).** $0 license fee, $0.015/SMS, $0.04/dial — direct price weapon against Hustle/GetThru/Scale to Win. Progressive-only ToS.
- **Hustle employees bought the company from Social Capital, May 2026** (10th anniversary). Equity capped at <4:1 spread senior-to-junior. Relaunched "Win The Future" pricing for D/progressive/independent only — explicit ideological positioning where prior Social Capital era was strategically ambiguous.
- **Spoke open-source transferred from MoveOn to StateVoices, November 19, 2024.** MoveOnOrg/Spoke repo is now historical archive. StateVoicesNational/Spoke is the active fork. Multiple maintained forks exist.

**6. Civic-data API layer collapsed in a 12-month window.**

| API | Status | Date |
|---|---|---|
| Google Civic Information API | Shut | April 30, 2025 |
| ProPublica Congress API | Shut | July 10, 2024 |
| OpenSecrets API | Shut | April 2025 |
| Congress.gov API | Outage, no restoration timeline | August 25, 2025 |

**Cicero (Melissa Data) is now the effective monopolist** for address→district at $0.03–0.04/lookup. A medium campaign (50K supporters) = $1,500–$2,000/campaign in Cicero fees; 10 campaigns/year = $15K–$20K/year just for district resolution. No commercial vendor matches Shadow Atlas's scope (24 boundary types) or cost structure ($0 marginal).

**Medium-term Census/TIGER risk:** DOGE has cut Census Bureau staffing by ~1,300 via deferred resignations/early retirement. 5 surveys terminated by May 2025. 2025 ACS data release delayed to January 2026 by October 2025 government shutdown. **TIGER/Line 2025 shipped September 23, 2025 — still functional** (boundaries as of January 1, 2025). Risk is cumulative quality degradation over 2–3 year horizon. Shadow Atlas depends on TIGER; monitor 2026 TIGER release as early warning.

### Refreshed platform profiles

#### Quorum + Capitol Canary — fresh financial and integration detail

- **Revenue:** $61M ARR (2024), up from $46M (2023), $10.5M (2020) per Latka. 32.5% YoY growth. 438 employees Dec 2024. Serent Capital minority growth equity (Aug 2020) + follow-on (Oct 2022 with Capitol Canary acquisition). No IPO or exit signal; natural PE hold window 2025–2028.
- **Capitol Canary integration (January 2024 "Next Generation Grassroots" launch)** produced documented capability regressions. Capterra reviews from Phone2Action legacy customers: *"tasks that took 20 minutes now take hours,"* lost signature collection, requirement for custom CSS where Phone2Action had dropdown UI, *"sloppy errors"* from non-technical Quorum staff conducting migrations. Some customers documented evaluating VoterVoice or Campaign Manager as alternatives.
- **Quincy AI adoption is undisclosed.** Quorum has published zero DAU, feature engagement, or activation metrics for Quincy. The only named customer quote is from Texas REALTORS®. Launch cadence (12 product launches in 2025, April 2026 Meeting Prep Agent + CRM Agent) suggests genuine R&D investment but target use case is corporate-lobbyist productivity, not constituent verification.
- **The "99.6% deliverability" claim** referenced in the March 2026 baseline is **not currently surfaced anywhere** in Quorum marketing. Treat as unverifiable; do not cite. The figure may have been Capitol Canary/Phone2Action legacy material. VoterVoice has a separately documented 95% first-time delivery rate.
- **Module-level coverage clarifications:**
  - Local module: cities/counties ≥3K population, 75K official profiles, 12.5K agenda sources monitored. **Sub-3K excluded by design.**
  - School Board module: 13,000 boards (near-complete), but only 3,000 of those have agenda monitoring; remaining 10,000 are contact-data-only.
  - **Special districts: zero coverage across Local and School Board modules.** Architecture (keyword-Boolean agenda scraping) cannot index special districts that lack machine-readable public-facing agenda portals.
- **Geography by customer count (6sense data):** US 96.4% (720), Canada 1.2% (9), UK 1.1% (8). Quorum International remains residual despite the 2019 launch.

#### Bonterra/EveryAction — see structural shift #2 above

Customer pain points from review platforms (verbatim sample): *"the EA team held the org's data hostage, prolonged the process of migration, and made the customer pay for extra months,"* *"the minute our integration was done and we were operating on EveryAction... support stopped,"* *"Bonterra bought out Salsa, and it's been over a year-long process to get out from under Bonterra's clutches. They were charging outrageous and inexplicable fees through tiers of 3 sub-processors who would not stop charging our account."*

Higher Ground Labs critique (Sept 2021, *"The EveryAction Acquisition: Where do we go from here?"*) anchored the alternative-ecosystem thesis. HGL now reports 82 portfolio companies, $42M AUM, claimed $27M+ campaign cost savings in 2024 cycle (self-reported, not third-party audited). Fund V thesis explicitly targets "citizen-centered relationship infrastructure," "advocacy technology," and "AI-native campaign systems" — direct thematic overlap with Commons.

#### Action Network — May 2025 price change + ownership clarification + Boost

- **May 27, 2025: First AN price increase since 2013** ([source](https://actionnetwork.blog/an-update-on-action-network-pricing/)). Movement minimum: $15/mo for first 12K emails; $1.25/1K above. Actions Only: $7.50/1K with $15 minimum. Network and Enterprise unchanged. **No documented backlash** — user base is captive (progressive-only ToS, high switching costs).
- **December 2025: AN's first AI feature** — Boost beta with ActionBot ("chat with your data and report"). Reporting-side AI, not advocacy-layer AI. AN has shipped no message generation, no personalization, no grounding-verified composition. This is an opportunity gap.
- **AN is structurally un-acquirable.** Action Network 501(c)(4) owns 100% of Action Squared Inc. (the for-profit C-corp that operates the platform). Action Network Fund is the 501(c)(3) sister entity. No external investors, no PE. Development Partners (AFL-CIO, Daily Kos, DNC, Canadian Labour Congress) hold governance seats but not equity. Employees unionized under NPEU Local 70. AN will not be acqui-hired and cannot be PE'd.
- **Action Squared earned $5.6M from political organizations in the 2022 cycle alone** (DNC $3.7M, Biden campaign $1.6M). Post-2022 C-corp revenue not public.
- **Recent feature additions (2H 2025–early 2026):** hybrid events, pinned events in event campaigns, Canadian cities in targeting filters, non-Latin character/emoji support, Bluesky sharing on thank-you pages, email QA checklist gating delivery on admin sign-off, BCC autoresponder support, date range filtering for email targeting, call campaign fallback numbers, donation count as A/B testing metric.
- **OSDI is dead.** GitHub repo (`opensupporter/osdi-docs`) last commit April 17, 2019. Governance Loomio group inactive. Implementations wiki last edited March 23, 2017. CiviCRM is the only meaningful independent OSDI implementation. "OSDI compliance" effectively means "AN API compatibility," not interoperability.

#### ControlShift Labs — additive complement to AN, not standalone

- Customers in 25 countries; named users 350.org, MoveOn, Color of Change, United We Dream — all large progressive orgs.
- Member-led distributed petitions (supporters launch their own campaigns under an org umbrella), distributed events, multi-target distributed campaigns.
- **One-directional dependency:** ControlShift needs AN (or ActionKit/Engaging Networks/Salesforce). AN does not need ControlShift.
- Skiftet (Sweden) used ControlShift for 50+ local petitions with 42K signers — most specific documented usage.
- **Distributed/member-led organizing is a gap in Commons's current architecture** that ControlShift fills atop AN. Commons's verified-action protocol layer could natively support distributed member-led verified campaigns without a $80/user Action Builder add-on or a separate ControlShift subscription.

#### Solidarity Tech — labor wedge, single-founder concentration risk

- Founded 2019 by Ivan Pardo. Commercial launch March 2024.
- Starting **$29/month, unlimited users**. Outreach rates: texts 1.4¢–1.8¢; calls 3¢–4¢/min.
- Powered the **Zohran Mamdani NYC mayoral campaign — 104K volunteers, 4.4M calls** in the general (most prominent recent proof point).
- Named customers: CWA, UAW, UFCW, Debt Collective, Rideshare Drivers United, Pilipino Workers Center, LA Tenants Union, Jobs with Justice, National Rural Letter Carriers Association.
- Bundled phone banking (power + predictive dialers, live call coaching), text banking, email, events, websites, volunteer relationship management. Bootstrapped, PE-free.
- Structural vulnerability: **labor union density is declining** (9.9% in 2024 vs. 20.1% in 1983). Beachhead segment is structurally shrinking. Single founder, no documented redundancy.

### Newly profiled platforms

These platforms were missed in the March 2026 baseline and warrant tracking.

#### New/Mode — closest mid-market peer

Multi-channel advocacy. **600+ orgs globally** (US/UK/Canada/Australia confirmed via feature descriptions).

| Tier | Price/mo | Notable features |
|---|---|---|
| Individual | $0 | Unlimited emails, petitions, click-to-call, social sharing |
| Grassroots | $44 | Analytics, donations, embeddable forms, contact export |
| Teams | $189 | 2 users, geolocated recipients, **Social Media Advocacy** (Twitter/FB/Instagram direct actions), submission moderation |
| Movement Builder+ | $349+ | 3+ users, CRM integrations (AN, NationBuilder, Salesforce, HubSpot), **AI message variation**, **Letter to the Editor** campaigns |

No identity verification. Free tier real but with 10% donation processing fee. **Closest mid-market peer to Commons pricing.**

#### Empower Project — true relational organizing (Han's transformational model)

**2024 scale:** 47,000 trusted messengers, 9M conversations, 3M hard-to-reach voters reached — described by the org as "the largest relational organizing campaign in history." **Free for 501(c)(3)s, 501(c)(4)s, and labor partners.** "Extremely affordable" for campaigns and PACs.

Not a P2P texting tool — fundamentally friend-network activation. Volunteers contact their own existing contacts (friends, family, coworkers); the app provides scripts, tracking, and coordination. **Different category from Hustle/GetThru/Scale to Win/Field Tools.** Orgs use Empower alongside, not instead of, broadcast P2P.

#### Engaging Networks — only true multi-country advocacy SaaS

UK-headquartered, 20+ years in market. 400+ nonprofits in 50+ countries. **$2B+ raised for clients.** Customers: Amnesty International USA, The Nature Conservancy, Human Rights Campaign, PETA, Humane Society of the United States. Privately held, no outside investors (deliberate trust signal).

E-activist module handles constituent-to-rep routing in US, UK, Canada, Germany, Australia, EU. The de facto choice for large international nonprofits needing a single platform across borders. Enterprise pricing, demo-gated, no self-serve tier, no identity verification.

**Direct competitor for Commons international expansion** — has the multi-country footprint Commons is building, lacks the verification Commons brings.

#### Civitech / CivicEngine (acquired BallotReady May 22, 2025)

Combined: voter registration outreach + officeholder database + ballot data + P2P texting + unregistered voter data. **214,000+ elected officials** including 100,000+ at small-town, township, and school board level — the deepest local-officeholder database in the public market post-Google Civic shutdown.

API handles 1,100+ peak req/sec, daily database refreshes, supports OCD-IDs and Bioguide IDs. Customers include Tinder, Snapchat, Spotify (voter-guide integrations) plus advocacy orgs.

**Does NOT do boundary geometry** (Shadow Atlas's lane). They answer "who is the official" — Shadow Atlas answers "which district does this location fall in." Complementary, not competing — **for now.** Watch for any boundary-geometry roadmap addition.

#### Indigov — modern Congressional CRM displacing Fireside21

YC-backed, API-native. **Most chosen by freshman members of 117th and 118th Congresses** (two consecutive cohorts). Modern UX vs. legacy IQ and Fireside architectures. Since freshmen anchor long-term CRM lock-in (staffers carry preferences between offices over careers), this is a structural displacement of Fireside's renewal pipeline.

#### TouchStone — anti-fake-GPS canvassing

GPS-verified door knocks with anti-spoofing (blocks fake GPS tools). Multilingual (English, Spanish, Mandarin). Integration with external media buying. **PTP picked over MiniVAN for $44M 2026 program** — first major public defection from the NGP VAN canvassing stack. OpenField data (per Sifry): alternative canvassing apps show 20–30% higher contact rate per shift than MiniVAN. The anti-fake-GPS feature is conceptually analog to Commons's verification thesis.

#### Smaller/niche additions

- **OutreachCircle** (formerly VoterCircle, rebranded 2019) — peer-to-peer friend-network advocacy. Worth monitoring as relational-organizing category grows.
- **Tatango** — nonprofit fundraising SMS. 14 years, 10B+ texts. $199+/mo. Fundraising-only, not advocacy.
- **CharityEngine** — all-in-one CRM with native advocacy module (House/Senate/President targeting, email/petitions/letters). Small market presence. **Bipartisan ToS — accessible to conservative orgs.**
- **Aristotle 360** — genuinely bipartisan voter file + PAC + grassroots. 50+ years in operation. Used by trade associations needing neutrality.
- **Springboard** (Jackson River, on Salesforce Nonprofit Cloud) — starting $750/org/mo. Customers: ACLU, NPR, ASPCA, Drug Policy Alliance. Full nonprofit stack on Salesforce.
- **Geocodio** — emerging Census API alternative for civic developers post-DOGE.
- **AdvocacyAI** — AI-native grassroots advocacy. Small/early; unclear deployment scale.

### Removals / clarifications to the original analysis

- **Tectonica** — was listed as a self-serve mid-market platform. **Reclassify as a custom digital agency**, not a platform product. Builds bespoke campaign tech for progressive parties and large NGOs (Macron's LREM, Scottish National Party, ICAN). No published pricing, no self-serve product. Remove from tier comparisons.
- **Sister District / Indivisible** — distribution channels (recommend EveryAction/VAN to chapters), NOT platforms. Worth considering as Commons distribution paths.
- **Fireside21 "65% of Congress" claim** — that's IQ/Leidos IQ. Fireside is a subset; ~150 House office installs historically.
- **Quorum "99.6% deliverability"** — unverifiable, not currently surfaced. Don't cite.

### Movement Infrastructure Layer (new section)

The advocacy CRM tier sits on top of a movement infrastructure layer not previously profiled.

**The Movement Cooperative (TMC):** Tides Foundation-housed 501(c)(3) data co-op. 95 progressive member orgs + 1,400 state/local affiliates. CEO Julia Barnes. Governance: board elected by members; Amy White (MoveOn's CTO) as board treasurer. 2024 budget $15M with $3.4M shortfall; one-third foundations, two-thirds member dues. Election-cycle-dependent fragility. **TMC's Feb 2025 RFP for next-gen voter contact CRM is the institutional response to NGP VAN's 2024 crisis.** Member migration begins H1 2026.

**Higher Ground Labs:** Democratic civic-tech VC/accelerator. 82 portfolio companies, $42M AUM across five funds. Claimed $27M+ campaign cost savings in 2024 cycle (self-reported). 2025 was their slowest investment year ("market shifting, users unsure of needs") with ~10 M&A transactions (most ever). Notable: Plural acquired BallotReady May 2025 (HGL portfolio company). Fund V thesis directly overlaps Commons positioning — citizen-centered relationship infrastructure, advocacy technology, AI-native campaign systems. **Potential Commons investor or competitive monitor.**

**Catalist (voter file):** Owned by a trust structured so the voter file *"cannot be bought, sold, or traded to commercial or for-profit purposes."* 256M+ voting-age individuals. Founded 2006 by Laura Quinn and Harold Ickes with $5M from Soros and others. 60+ professional staff, unionized data workers. **Cannot be acquired hostile; mission-locked.** Most partnership-friendly counterparty in the voter-file layer.

**Catalist–TargetSmart "bitter feud":** 2018 trade-secret lawsuit (TargetSmart sued Catalist alleging IP theft via sham acquisition talks) settled July 2020 undisclosed. Both serve the same progressive market; orgs use both for cross-validation. TargetSmart received $10.84M in FEC-trackable 2024 cycle payments. Direct API integration with NGP VAN, NationBuilder, Reach, DSPolitical.

**L2 Political / VoterMapping:** Genuinely bipartisan (used by R and D campaigns plus academics). 250M+ records, 600+ attributes. ~$0.025/record with volume discounts. Lifetime usage license (not subscription-per-cycle). Unaffected by progressive ecosystem instability.

**PDI (Political Data Inc.):** West Coast dominant, CA-heavy. Founded 1989. Minimum order ~$135 — accessible to down-ballot races. Direct API to DSPolitical.

**Data Trust (RNC) + i360 (Koch):** Data Trust founded 2011, exclusive list-sharing with RNC, 300M+ individuals with 2,500+ data points, supported 5,000+ R campaigns in 2024. i360 (190M+ voter records, 250M+ adult records) integrates with Data Trust via 2014 data exchange. In 2024 cycle: 53% of Republican professionals used Data Trust, 37% used i360. **Republicans have data redundancy that Democrats don't** — structural asymmetry TMC's RFP is trying to cure on the D side.

**Civis Analytics:** Founded 2013 from Obama 2012 data operation. **Has pivoted away from progressive politics toward commercial enterprise analytics.** $42M revenue (2024), ~62 employees. Now serves nonprofits + state/local government + federal (USAID) + commercial brands (healthcare, retail, media, energy, financial). Employee reviews note "frequent layoffs, taking any client it can get." Survival-driven commercial pivot.

### Civic Data API Collapse (new section)

A 12-month dependency cascade has reshaped what advocacy platforms can build on top of:

| Provider | Status | Implication |
|---|---|---|
| Google Civic Information API | Shut April 30, 2025 | Universal: every platform that used it (free) now pays Cicero or builds in-house |
| ProPublica Congress API | Shut July 10, 2024 | Downstream tools migrated to Congress.gov |
| OpenSecrets API | Shut April 2025 | Money-in-politics data layer gone for civic developers |
| Congress.gov API | Outage August 25, 2025 | Infinite redirect loop, no restoration timeline as of GovTech reporting |

**Cicero (Melissa Data) is the effective monopolist** at $0.03–0.04/lookup. A 50K-supporter campaign = $1,500–$2,000/campaign in Cicero fees. 10 campaigns/year = $15K–$20K just for district resolution.

**Cicero alternatives:**
- USgeocoder — fastest-growing
- BallotReady/CivicEngine — 214K officeholders, no boundary geometry
- Ballotpedia data API — 15K offices, licensed dataset, no spatial
- Geocodio — emerging post-DOGE alternative

**Shadow Atlas position:** 24 boundary types, owned infrastructure, $0 marginal cost, in production, only platform covering special districts. FiscalNote's April 2026 PolicyNote API launch explicitly markets district matching as a moat — *"Unlike competitors who rely on third-party vendors..."* — market validation under duress.

**Medium-term risk: DOGE/Census.** Census Bureau lost ~1,300 staff. 5 surveys terminated by May 2025. **TIGER/Line 2025 shipped Sept 23 2025, still functional.** Risk is cumulative quality degradation over 2–3 year horizon. Monitor 2026 TIGER release as early warning.

### International landscape — refresh

#### UK
- **mySociety WriteToThem:** Free, 22+ years operating. Postcode → representative lookup, all UK tiers (Westminster, MEPs pre-Brexit, MSPs, MSs, MLAs, councillors). Demographic skew documented in mySociety's own research (Escher 2011, updated 2019 and Dec 2025): users skew higher-degree, higher-income, male, 45+. Casework dominates for councillors; campaigning dominates for MPs. mySociety FY2024/25: SocietyWorks Ltd (commercial subsidiary) generated £299K net profit; 46% of upcoming 12-month budget secured at year-end; Welsh Government Democratic Engagement Grant for WriteToThem in Wales.
- **petition.parliament.uk:** 10K → mandatory government response; 100K → committee debate consideration. 187 petitions crossed 100K in 2019–24 parliament.
- **38 Degrees:** "More than a million" members claimed (post-2019 trajectory unclear). Donations-funded, publishes any donation over £5K.
- **Engaging Networks:** UK-headquartered (also DC office). The international advocacy SaaS option — see above.

#### EU
- **EU ECI:** 24M+ signatures since 2012; **10 of 144 proposals received Commission response** (<10%). EESC 2025 statement: "ECI needs to reach its full potential."
- **EU Transparency Register tightened September 1, 2025.** Registration now required to meet senior EU officials (Parliament Directors-General + Cabinet team leaders; Commission Directors-General + Heads of Unit). Meetings published publicly with minutes. Automatic financial-data cross-checking between client and intermediary declarations. **Direct demand-pull for verified-grassroots documentation** — exactly what a Commons verification packet provides.

#### Germany
- **abgeordnetenwatch.de:** Independent MP Q&A platform. €1.5M revenue (Dec 2023). 11 of 16 state parliaments + federal + German MEPs. Primary users: journalists and NGOs, not general public.
- **Bundestag e-petitions:** Quorum reduced **50,000 → 30,000** effective July 1, 2024. Signature period extended 4 → 6 weeks. Article 17 Grundgesetz basis. 491K new users registered in 2023.

#### France
- **RIP citizen threshold never reached.** 2019 ADP airport privatization RIP gathered only 1.09M of required ~4.87M signatures.
- **Make.org:** Civic consultation platform. Decidim integration.
- **Greenfield signal:** France lacks a WriteToThem-equivalent free citizen-to-rep tool. No org-serving advocacy SaaS at scale.

#### Canada
- **ourcommons.ca e-petitions** require MP sponsor + 500 sigs — structural barrier.
- **Leadnow.ca:** 400K members. Transitioned to new tech platform 2024 (in-house). Not a platform vendor.
- **OpenMedia:** Digital rights advocacy. Member-based, not a platform.
- **Greenfield: org-serving advocacy SaaS layer is empty.**

#### Australia
- **GetUp:** 1M+ members claimed. Post-2019 setback (~$4M against Abbott/Dutton; Coalition won). Current CEO Larissa Baldwin-Roberts (Aug 2023). Not a platform vendor.
- **ACOSS:** 600+ member orgs. Informal advocacy infrastructure.
- **Greenfield: org-serving advocacy SaaS layer is empty.** Compulsory voting + AEC open-licensed data create high verification baseline.

#### NZ / Japan / France / Netherlands / Spain / Italy / Nordic / South Africa
- **True greenfields.** No domestic org-serving advocacy platform.
- **South Africa DearSA:** 1.1M participants since 2018. Each comment individually counted (philosophy closer to Commons than to Change.org volume-aggregation).

#### Brazil / India
- **Partial greenfields, regulatory complexity.**
- **Brasil Participativo (2023):** Federal participatory platform on Decidim. 4M accesses, 8,254 proposals, 76% incorporated into PPA process.
- **MyGov.in:** 25M registered users, but government-controlled and top-down (citizens respond to ministry-set topics, no bottom-up advocacy).

#### Taiwan
- **g0v / vTaiwan:** Deliberation infrastructure (Pol.is + AI-moderated discussion). 20+ legislative reviews. OpenAI selected vTaiwan/Chatham House for "Democratic Input to AI" ($100K grant). Methodology being exported to Thailand, Japan, Korea.

### Citizen-direct tools — refresh

- **Resistbot survived a documented November 2024 near-collapse.** Founder Jason Putorti publicly posted: *"if you want to keep me running into 2025, become a member! Most canceled around Inauguration Day 2021 and I don't have enough to continue operations for much longer."* Survived only because the 2025 Trump second-term wave triggered membership surge. **Sustainability is politically contingent.** WhatsApp integration deactivated October 2024 (internal decision). AI co-author for letter drafting shipped 2024–2025.
- **5 Calls** processed **700,000 calls in a single week in February 2025** during Trump second-term opening. Donation-based via ActBlue. Similarly politically contingent.
- **POPVOX Foundation** pivoted away from grassroots into institutional infrastructure. Casework Navigator newsletter (2K congressional staff weekly). CaseCompass ($4M congressional appropriation Nov 2025). ParlLink: ~12 Caribbean parliaments + AFRIPAL Uganda inaugural (Jun 2025).
- **Democracy.io effectively dead** — House YAML files unmaintained since Jan 2017. No active fork.
- **Countable → EV3 Global (June 2024)** pivoted to employee engagement; civic mission abandoned.

### Cross-platform AI map (refreshed)

| Platform | AI Feature | Launch | What it does | Verifies identity? |
|---|---|---|---|---|
| Bonterra Que | Agentic fundraising | Oct 2025 | Fundraising coaching, SMS generation, grant matching | No |
| Quorum Quincy 2.0 | Legislative analysis | Jan 2025 (all modules May 2025) | Bill summarization, amendment tracking, NL search | No |
| Quorum Meeting Prep Agent + CRM Agent | Agentic briefings | Apr 2026 | Auto-generate briefings, log meetings from voice/text | No |
| VoterVoice SmartCheck | ChatGPT integration | 2023 | Subject line + CTA tuning | No |
| FiscalNote PolicyNote | AI policy intelligence | 2024 | Bill summaries, forecasting, stakeholder mgmt | No |
| Salesforce Agentforce Nonprofit | Multiple agents | Late 2025 | Prospect Research, Participant Management, Donor Support | No |
| Bloomerang | Predictive scoring | Ongoing | Recurring gift propensity, generosity scoring | No |
| Virtuous + Momentum AI | GPT email drafting | Aug 2025 | Inbox prioritization, automated engagement | No |
| Action Network Boost ActionBot | Chat with data | Dec 2025 (beta) | Reporting interface | No |
| Resistbot AI co-author | Letter drafting | 2024–2025 | Constituent letter composition | No |
| Hustle AI Script Assistant | Script generation | Apr 2023 | Auto-draft campaign scripts | No |
| IssueVoter Bill Q&A | Bill summaries | Nov 2025 | Bill summaries + question prompts | No |
| New/Mode | Message variation | Movement Builder+ tier | Per-campaign variant generation | No |

**Structural pattern: AI for the org user, not for the action.** Every incumbent ships AI that makes orgs faster (drafting, prospecting, briefing). None verifies the identity behind the AI-assisted action. **"AI-on-action" — per-recipient grounding + verified authorship — is an unclaimed category.** Commons Phase 3 agentic delegation can frame as the only product where AI-assisted composition carries cryptographic provenance of authorship + district + identity.

## Where Commons Wins and Where It Does Not

This section is the honest positioning frame for everything below it. The deep competitor profiles, distress facts, and pricing tables that follow are grounded research; read them through this lens.

### The wedge: authoring + reach + neutrality

Commons is AI-native civic action infrastructure. Its competitive wedge is a three-part composition no incumbent matches:

1. **AI-native authoring-to-delivery.** An end-to-end loop — intent → ground → author → resolve-targets → deliver → report — where source-grounded composition tailored to the resolved decision-maker set is shipped and config-gated-live (Gemini + Exa stratified search + Firecrawl fetch + adversarial-source-first ranking). Generation grounding is *disabled* and citations are bound to that pre-verified pool, so the model can't invent URLs out of free text — URL invention is structurally prevented (the source list is enforced; per-citation matching is schema-checked, not cryptographically proven). **Every incumbent ships AI for the org user, not for the action** (Quincy summarizes bills for a lobbyist, Que helps a fundraiser, SmartCheck tunes subject lines, ActionBot is admin chat-with-data, New/Mode varies message copy). None ships grounded AI on the constituent's action.

2. **Owned local + special-district reach (Shadow Atlas).** 24 boundary types per H3 cell at $0 marginal cost — **21 boundary types with zero competitor coverage** — the schema addresses the 39,555 special districts (water/fire/transit/school/library/hospital/judicial) and their ~84K elected officials (special-district *data* ingested state-by-state as available, not yet live nationwide) that Quorum Local (cities ≥3K pop, 0 special districts), Cicero (~400 cities, the $0.03–0.04/lookup monopoly), and VoterVoice (>250K population only) structurally cannot reach. The civic-data API collapse strengthens this reach moat; it does not make Commons a legislative-intelligence competitor.

3. **Neutrality + gate-at-delivery economics.** Universal-ideology access — no progressive-only ToS — roughly doubles the addressable market Action Network's ToS excludes ("no conservative equivalent of Action Network exists"). Paired with no free org tier and pay-to-deliver pricing: **$0 to author and preview, $10/mo Starter to send**, so the product reaches its aha before the paywall.

**Durable vs. copyable.** The durable moat is the Shadow Atlas data layer (years to clone, narrow scope) welded to grounding *discipline*. The authoring *surface* is copyable in 2-3 quarters, so the real edge is **timing** — owning the abandoned sub-$7.5K and deplatformed-conservative market during the 2026–2027 incumbent-distress window. Sell the org on **aggregation and reach across a base** (the Constituent Report aggregate, mathematically undefined for N=1, is the org-distinct moat), never on authoring (the shared individual/org substrate). One honest limit: **per-person individualization at *send time* is a documented not-yet-shipped gap** — today the loop composes one source-grounded message for the resolved decision-maker set, not a distinct message per recipient. Posture: *out-author and out-cost today; out-account when the receipts writer ships.*

### Verification is the watermark, not the letterhead

Verification is demoted from front door to ambient credibility-tiebreaker. The category thesis — that a legislative office handles a verified packet differently than an unverified one — is **unproven and carries zero measured support**. The CMF research historically cited (the 2017 "92% of staffers value individualized communication" line) measures *personalization and constituency* — is this a real constituent, did they write it themselves — **never cryptography**. The realistic verification floor today (tier-2 address-verify) barely exceeds incumbents' heuristic ZIP→Cicero. mDL scan-verification is already live on Android (`MDL_ANDROID_OID4VP`); what is years out is the *cryptographic* headline — the ZK proof-of-residency lane (Noir, pre-1.0 / off) and the iOS / Apple Business Connect lane (ops-pending). So verification is the watermark on every action, not the pitch — a trust signal that rides along for distrust-sensitive segments (science/health advocacy, astroturf-distrust contexts, EU verified-grassroots). It is the lowest-replicability moat and no competitor has started it, so do not discard it — but it earns the headline only after the receipts writer ships, the on-chain anchor is live, 10+ cross-validating coalitions exist, and at least one *measured* signal (a controlled CWC handling-difference experiment) shows an office treats a verified packet differently.

### Where Commons trails (honest)

- **Legislative intelligence (bills, roll-call votes, scorecards) — incumbent fortress.** This is Quorum/FiscalNote/CQ home turf, and Commons ships substrate/stub, not product: roll-call vote tracking is a hard stub/no-op (which hollows out scorecard alignment *and* the coalition proof-pressure that depend on it); bill embeddings are unwired — the live sync ingests bills without them (a rescore endpoint exists but isn't in the pipeline) — and per-supporter bill alerts are absent (legislativeAlerts is org-scoped only); scorecards render empty (the GDS/ALD/CAI/responsiveness arithmetic and org/DM-facing reader UIs both exist, but with the vote-tracker stubbed and zero accountability receipts there is nothing to score). Frame this as a credibility *floor*, not the front door. FiscalNote's Apr 8 2026 PolicyNote District-Matching API — an incumbent in going-concern distress marketing "we own and maintain our district data infrastructure" — restates the Shadow Atlas *reach* thesis, validating reach, not bill data.
- **Congressional delivery — dark today.** CWC congressional send is flag-off and transport-unarmed; own-rep routing is congressional-only and dark. Zero congressional deliveries today; the production send path is customer-signing-gated.
- **Multi-channel send at scale + voter file / donation rails / 2-way CRM sync — ceded.** Bulk SMS/P2P (A2P 10DLC $10K floor; ActBlue Field Tools, Hustle, GetThru own this), NGP VAN voter file, ActBlue rails, and network effects (AN 55M letters, Mobilize graph) are strategy-ceded parity categories. Only the Action Network sync adapter is armed (read/import; nine others CSV-only). Parity posture, not build mandate.

### Primary segment

The abandoned sub-$7.5K local and regional market during the 2026–2027 incumbent-distress window: local/regional 501(c)(4)s, coalitions, school-parent and rate-hike/utility fights targeting **city councils, special districts (water/fire/transit/school-board/hospital), and agency heads — not Congress**; plus deplatformed-conservative orgs (the six named in the Senate Commerce 2024 report, and FreedomWorks RAC's orphaned libertarian-grassroots base after its May 2024 dissolution). These are buyers excluded by Action Network's progressive-only ToS or priced out of Quorum's ~$10K floor — an **add-to-Quorum at $75/mo, not a rip-and-replace**. Who does *not* pay: legislative-intelligence buyers (vote tracking stubbed), Congress-targeting orgs (CWC dark), verification-pitch buyers (thesis unproven), and orgs needing EveryAction/VAN/Salesforce 2-way sync (only the AN adapter is armed).

### Axis scorecard

| Axis | Verdict | Grounding |
|---|---|---|
| AI-native authoring-to-delivery (grounded, set-tailored) | **TRANSCEND** | Source-grounded generation shipped + config-gated-live (Gemini + Exa stratified search + Firecrawl + adversarial-source-first ranking; grounding DISABLED so citations draw only from a pre-verified pool). No incumbent fetches + credibility-ranks external sources; all ship AI for the org user, not the action. |
| Local + special-district reach (Shadow Atlas) | **TRANSCEND** | 24 boundary types per H3 cell, 21 with zero competitor coverage, $0 marginal cost; 39,555 special districts / ~84K officials addressable. Cicero monopoly $0.03–0.04/lookup post-API-collapse; Quorum Local 0 special districts. |
| Neutrality + gate-at-delivery economics | **TRANSCEND** | Universal-ideology access (~doubles AN's ToS-excluded market; no conservative equivalent of AN exists — Senate Commerce 2024 primary source); no free org tier, $0-author / $10-to-send conversion at peak intent. |
| Coordination-integrity / anti-astroturf signal | **PARITY+ (substrate-real, surface thin)** | GDS/ALD/temporal-entropy/burst-velocity/CAI computed + rendered; no incumbent publishes credibility math, but it is a back-office signal, not a sold wedge. |
| Cryptographic verification packet | **PARITY (ambient, unproven)** | Lowest-replicability moat, no competitor started it — but category thesis has ZERO measured support (CMF measures personalization/constituency, not cryptography); Android mDL scan live, the ZK proof lane (Noir) + iOS off. Watermark, not letterhead. |
| Multi-channel send at scale (SMS/P2P/bulk email) | **TRAIL / CEDE** | Production send path customer-signing-gated; A2P 10DLC $10K-floor; managed-P2P (ActBlue Field Tools, Hustle, GetThru) own this. Parity posture, not build-mandate. |
| Voter file / donation rails / CRM 2-way sync | **TRAIL / CEDE** | NGP VAN voter file, ActBlue rails, network effects (AN 55M letters, Mobilize graph) not claimable; only Action Network sync adapter armed (read/import), 9 others CSV-only. |
| Legislative intelligence (bills, roll-call votes, scorecards) | **TRAIL (incumbent fortress)** | Vote-tracker is a no-op stub; bill embeddings unwired in the sync path; scorecards render empty (readers exist, but no vote data or receipts to score); CWC flag-off/unarmed. Quorum/FiscalNote/CQ own deep bill/vote intelligence. Credibility-floor, not front door. |

---

## Market Overview

### Market Size

The advocacy software market is valued at approximately **$1.0–1.5B globally** (2025–2026), growing at ~10% CAGR toward $2.4–3.8B by 2035. The grassroots advocacy subsegment — the space Commons directly competes in — is approximately **$190M** (2026), growing toward $436M by 2035 at 9.2% CAGR.

Sources vary by methodology:
- Business Research Insights: $1.02B (2026) → $2.36B (2035), 9.9% CAGR
- SNS Insider: $2.71B (2025) → $6.34B (2035), 8.87% CAGR (broader definition)
- Market Growth Reports (grassroots-specific): $191.56M (2026) → $436.03M (2035), 9.2% CAGR

### The Structural Gap

The structural gap that leads is reach, authoring, and access — not verification. No platform combines (1) grounded AI *on the constituent's action* (incumbents ship AI for the org user only), (2) owned local + special-district reach across 24 boundary types per cell — 21 with zero competitor coverage, architected to address the 39,555 special districts (data ingested state-by-state) that Quorum Local, Cicero (~400 cities), and VoterVoice (>250K pop only) structurally cannot reach — and (3) universal-ideology, gate-at-delivery access. Underneath that wedge sits an ambient credibility layer: no platform verifies constituent identity. Every platform — Action Network, Quorum, EveryAction, Muster, VoterVoice, NationBuilder — relies on self-reported addresses fed through third-party geocoding (Cicero API, formerly Google Civic Info). That verification layer is the lowest-replicability moat and no competitor has started it, but it is the watermark, not the headline: the category thesis that an office handles a verified packet differently is unproven, and the realistic floor today barely exceeds incumbents' heuristic ZIP→Cicero. Treat it as an ambient tiebreaker for distrust-sensitive segments, not the front door.

The astroturfing problem is worsening. AI-generated fake constituent messages at scale are now a documented threat ([Causes.com, 2025](https://www.causes.com/articles/55009-securing-advocacy-ai-world-understanding-authentication)). Washington state documented hundreds of phantom signatures inflating opposition to a tax bill ([WebProNews, 2025](https://www.webpronews.com/phantom-signatures-and-political-theatrics-how-fake-sign-ins-may-have-inflated-opposition-to-washington-states-millionaires-tax/)). Issue campaigns now account for 75–85% of incoming congressional mail — and offices have no tool to distinguish authentic grassroots from manufactured volume ([Congressional Management Foundation](https://www.congressfoundation.org/resources-for-congress/office-toolkit/improve-mail-operations-menu-item-new/writing-mail-home/terms/summary)).

### The District Resolution Layer

Every advocacy platform depends on **address → district → official** resolution. Two infrastructure providers dominate:

| Provider | Status | Cost |
|---|---|---|
| **Google Civic Information API** | **Shut down April 2025** | Was free |
| **Cicero (Melissa Data)** | Active; sole survivor for most platforms | ~$0.03/lookup, volume discounts; 1,000 free trial credits |
| **USgeocoder** | Emerging alternative post-Google shutdown | Per-lookup pricing |
| **BallotReady / Ballotpedia** | Officeholder data APIs | Custom pricing |

Google Civic Info's shutdown forced every advocacy platform to either pay Cicero or scramble for alternatives. **Commons owns the district layer** — Shadow Atlas (94,166 districts, 24 boundary types, R-tree spatial indexing, <50ms p95). Zero marginal cost. No third-party dependency.

---

## The Signal Crisis in Legislatures

Congressional offices received **81 million messages** in 2022 and sent **3.5 million responses** — a 43:1 ratio. The average House office processes ~65,000 emails/year (up 5x from the 1970s). Some Senate offices receive **25,000+ pieces per week**. Staff and budget have not kept pace with the 9x growth in constituents-per-member (75,000 in 1911 → 650,000 today).

The result is structural: **form emails are deleted in bulk without being read.** Fireside (FiscalNote's CRM, used by ~65% of Congress via IQ/Leidos IQ) explicitly documents this pattern. When staffers do process mail, they distinguish authentic constituents from astroturf using:

1. **Address verification** — is the sender in the district? (self-reported, no cryptographic proof)
2. **Personalization** — did the sender write their own words?
3. **Pattern recognition** — sudden volume spikes, identical talking points, confused callers

**The data on what works** (Congressional Management Foundation, 2017):
- In-person constituent visits: **94%** of staffers say "a lot of positive influence"
- Individualized email: **92%**
- Phone calls: **84%**
- Form emails: **51%**
- Form postal letters: **3%**

**Fewer than 100 personalized emails** on a given issue is enough to get an office to consider action (90% of staff agree). Yet 75-85% of incoming mail is form-generated advocacy campaigns. The signal is drowning in noise.

**The AI threat is escalating.** The FCC net neutrality proceeding (2017) revealed that **nearly 18 million of 22 million comments were fake**, with **8.5 million impersonating real people**. Lead generation firms fabricated **500,000+ fake letters to Congress** and **3.5M fake digital signatures**. The NY AG secured $615,000 in penalties. These same firms reportedly work with **40% of Fortune 500 companies**. AI-generated text makes detection orders of magnitude harder — and every advocacy platform sends unverified text from unverified identities.

Commons answers the noise crisis the way the CMF data says offices actually weight mail: individualized, source-grounded messages authored to the *correct* official. The lead is AI-native authoring (source-grounded composition tailored to the resolved decision-maker set, citation validation) plus reach across 24 boundary types so the message lands on the right decision-maker — exactly the personalization (92%) and right-constituent signal staffers reward, against the 3-51% form-mail floor. Riding along underneath, as an ambient watermark, is the proof that these are real people in-district with earned engagement history and no coordination anomalies — the "and it's provably real, not manufactured" tiebreaker, not the headline category claim.

**Sources:** [CMF Citizen-Centric Advocacy 2017](https://www.congressfoundation.org/revitalizing-congress/communicating-with-congress/citizen-centric-advocacy-2017), [Fireside CRM](https://www.fireside21.com/), [NY AG FCC Fake Comments Report](https://ag.ny.gov/sites/default/files/reports/oag-fakecommentsreport.pdf), [Bipartisan Policy Center: Listening Is Governing](https://bipartisanpolicy.org/article/listening-is-governing-modernizing-congresss-public-interface/)

---

## The Local Government Void

The US has **90,887 local government entities** (2022 Census of Governments):

| Type | Count | Elected Officials |
|------|-------|-------------------|
| Counties | 3,031 | ~58,108 |
| Municipalities (cities/towns) | 19,491 | ~135,531 |
| Townships | 16,214 | ~126,958 |
| School districts | 12,546 | ~95,000 |
| Special purpose districts | 39,555 | ~84,089 |
| **Total** | **90,887** | **~500,396** |

That's **500,396 local elected officials** — 96.2% of all elected officials in the US. Federal + state combined total just ~19,284.

**What existing platforms cover:**

| Platform | Local Coverage |
|---|---|
| Quorum Local | 75,000 official profiles, school board agendas from largest districts. No special districts. |
| FiscalNote Curate | 16,000 entities (~17.6% of 90,887). No special districts. |
| Cicero (Melissa) | ~400 cities (~2% of 19,491 municipalities). Zero special districts. |
| VoterVoice | Officials in areas >250,000 population only. Rural and suburban America uncovered. |
| Action Network | Zero legislator matching. Orgs bring their own target lists. |

**No platform covers special districts** — 39,555 entities governing water, fire protection, sewerage, transit, parks, libraries, hospitals, housing, airports, and more. Their **84,089 elected officials** are invisible to every advocacy tool on the market.

**No national boundary dataset exists for special districts.** TIGER/Line shapefiles cover congressional, state legislative, county, municipal, school district, and voting tabulation district boundaries — but NOT water districts, fire districts, transit authorities, or any other special purpose district. Each state's LAFCO (Local Agency Formation Commission) maintains its own data in its own format.

**What local advocacy orgs use today:**
- Email and phone trees (manual coordination)
- Action Network (free tier, no legislator matching — just petitions and events)
- Google Forms, Mailchimp, Facebook Groups, Nextdoor
- National PTA advocacy toolkit (calendar and contact guides — not software)
- **Nothing purpose-built for sub-state advocacy**

The enterprise platforms (Quorum at $10K+/year) serve trade associations targeting city councils, not a PTA chapter fighting a school board budget cut. A neighborhood association fighting a water district rate hike has no tool at any price.

**Commons serves 24 boundary types per cell.** Shadow Atlas already ingests TIGER/Line congressional, state legislative, county, municipal, school district, and voting tabulation district boundaries. The architecture (H3-indexed, 24 slots per cell) is designed to ingest special district boundaries as they become available — state by state, LAFCO by LAFCO. Every boundary type added instantly becomes targetable for verified advocacy campaigns. No other platform's architecture can accommodate this.

**The market opportunity:** A platform that lets a transit advocacy group, a school parent coalition, or a water district accountability org author verified campaigns to their specific local officials — free to author, $10 Starter to deliver — would have zero competition. Not underpriced competition. Zero.

**Sources:** [Census of Governments 2022](https://www.census.gov/newsroom/press-releases/2023/census-of-governments.html), [Census Special Districts by Function](https://www.census.gov/library/visualizations/2023/econ/special-district-governments-by-function.html), [TIGER/Line Shapefiles](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html), [PoliEngine Elected Officials Count](https://poliengine.com/blog/how-many-politicians-are-there-in-the-us)

---

## The Conservative Deplatforming

The conservative advocacy gap is not hypothetical. Organizations have been actively deplatformed.

**Bonterra/EveryAction** maintained internal policies stipulating clients could not be "Not Progressive Aligned" — defined as "Can't be a Republican org," "Can't go against LGBT+," "Can't be against pro-choice." This was the subject of a **Senate Commerce Committee investigation** (2024, Sen. Ted Cruz). Documented deplatformed organizations include:
- Wisconsin Right to Life
- Idaho Family Policy Center
- Deaconess Pregnancy & Adoptions
- Stand for Health Freedom
- The Ruth Institute (flagged via SPLC "hate group" label)

**Action Network** explicitly states: "The Action Network is only available to left-progressive organizations and will not assist any other type of organization that opposes progressive stances." Violation is a "material breach" of ToS. This is a front-door rejection, not a backdoor policy.

**Mailchimp** has dropped conservative organizations without warning: Virginia Citizens Defense League, Northern Virginia Tea Party (cited "potential misinformation"), Babylon Bee (automated "harmful information" flag, later reinstated).

**What conservative orgs actually cobble together:**

| Function | Progressive Tool | Conservative Equivalent |
|---|---|---|
| Advocacy (email + petitions + letters) | Action Network ($15/mo) | **Nothing** below $7,500/yr |
| CRM + fundraising | EveryAction/Bonterra | CMDI Crimson (fundraising only, $7.5B+ managed) |
| P2P texting | Hustle, ThruText | RumbleUp ($19/mo + per-message) |
| Canvassing | MiniVAN (EveryAction) | i360 Walk ($265+/mo, Koch ecosystem) |
| Fundraising | ActBlue | WinRed, Anedot, RallyRight DonateRight |
| Voter data | TargetSmart, L2 | i360, Numinar |
| All-in-one campaign | — | Campaign Nucleus ($50/mo, no advocacy) |

The gap is specific: **there is no conservative equivalent of Action Network** — an integrated, affordable platform combining email, petitions, write-your-legislator campaigns, event management, and supporter CRM at a self-serve price point. The bipartisan enterprise platforms (Quorum, VoterVoice) start at $5,000-$10,000+/year. Heritage Action's Sentinel program and Americans for Prosperity's i360 are bespoke internal systems, not commercial platforms.

Commons fills this vacuum structurally. Verification is orthogonal to ideology. The protocol doesn't check politics — it checks proof. A $10 Starter entry (with author-free onboarding) that includes email campaigns, verified advocacy, full uncapped API access, and 24-boundary-type district targeting is immediately the best tool a conservative advocacy org has ever had. It's also the best tool many progressive orgs have ever had — the ones too small for AN's $15/mo or excluded from EveryAction's ecosystem for other reasons.

**Sources:** [Senate Commerce Committee Investigation (2024)](https://www.commerce.senate.gov/2024/4/senate-commerce-investigation-reveals-how-big-tech-weaponizes-terms-of-service-to-silence-the-right), [AN Help: Who Can Use It](https://help.actionnetwork.org/hc/en-us/articles/203852955-Who-can-use-the-Action-Network-Only-progressives), [Startup Caucus: Areas of Need (2024)](https://startupcaucus.com/insights/identified-areas-of-need-in-the-republican-campaign-tech-ecosystem-2024)

---

## Beyond the United States

voter-protocol is designed for global coverage. The three-tree ZK architecture uses **24 district slots per cell** — an internationally extensible model. The Shadow Atlas uses H3 hexagonal indexing (Uber's global spatial index) and country-code-keyed district registries in the DistrictRegistry contract.

**Current coverage:** US congressional, state legislative (upper + lower), county, municipal, school district, voting tabulation district boundaries via Census Bureau TIGER/Line.

**Expansion path:**
- **Canada:** Electoral districts (338 federal ridings, ~1,000 provincial constituencies) available from Elections Canada / provincial boundary commissions
- **United Kingdom:** 650 Westminster constituencies + devolved assemblies (Scottish Parliament, Senedd Cymru, NI Assembly) + ~9,000 parish/town/community councils. Boundary data from Ordnance Survey (Open Government License)
- **European Union:** European Parliament constituencies + national parliaments + sub-national assemblies. Eurostat NUTS (Nomenclature of Territorial Units for Statistics) provides a hierarchical classification
- **Australia/New Zealand:** Federal + state/territory electorates. Australian Electoral Commission publishes boundary shapefiles

**What this means for orgs:** A UK environmental group, a Canadian healthcare coalition, an Australian transit advocacy org — all can run verified campaigns through the same protocol, with the same ZK proof guarantees, targeting any level of government where boundary data is ingested. The verified action is the universal unit. The district tree is the extensible structure. The 24-slot model accommodates any country's governance hierarchy.

No competitor operates at protocol level. AN, Quorum, VoterVoice, and Bonterra are US-centric or have separate, disconnected international products. One Click Politics claims US/Canada/UK/Australia coverage but with no verification and at $42K+/year.

---

## Citizen-Facing Tools (The Graveyard)

Several citizen-facing advocacy tools have died or pivoted, leaving a gap in individual civic engagement:

| Tool | Status | What Happened |
|---|---|---|
| **Resistbot** | Active (niche) | Text-based letter-sending to officials. ~50M letters sent, ~10M users. **Premium at $7/mo**. No verification. No CWC integration (uses email/fax/postal). No org features. Individual-only. Critics argue making contact "too easy" devalues messages. |
| **Democracy.io** | Effectively dead | EFF-built open-source tool. House contact-congress YAML files **unmaintained since Jan 2017** (switched to CWC). Senate files may be stale. Minimal maintenance. |
| **Countable** | Dead | Acquired Causes + Brigade (Sean Parker). In June 2024, entire company **acquired by EV3 Global** and pivoted to employee engagement. No longer civic tech. |
| **POPVOX** | Active (institutional) | Still operating as POPVOX Foundation. Casework Navigator for Congressional caseworkers. ParlLink for Caribbean/African legislative digitization. Not a grassroots advocacy tool. |
| **GovTrack** | Active (research) | Bulk data/API discontinued 2017. Still operates as a navigation/research site for Congress. |
| **ProPublica Congress API** | Dead | **Shut down July 10, 2024.** Migrated to Congress.gov API. |

The citizen-facing tool landscape has contracted. Resistbot is the last standing mass-use citizen tool, and it's text-based, unverified, and individual-only. The opportunity for a platform that serves both individuals (person layer) and organizations (org layer) on shared verification infrastructure is clear.

---

## Platform Profiles

### Tier 1: Enterprise ($10K+/year)

#### Bonterra (EveryAction + Network for Good)

**What they are:** The dominant force in nonprofit tech. 20,000+ organizations. Formed from the merger of EveryAction, Network for Good, Social Solutions, and CyberGrants under the Bonterra brand. Progressive-leaning but not explicitly restricted like AN.

**Core capabilities:**
- Full nonprofit CRM (donor management, fundraising, grants)
- Grassroots advocacy: 99.6% message deliverability to legislators via web comment form navigation
- Multichannel outreach (email, forms, events)
- Bonterra Que: agentic AI platform (launched Oct 2025) — fundraising optimization, workflow automation, SMS/event creation, real-time campaign optimization. Currently focused on fundraising, not advocacy verification.

**Pricing:** Custom enterprise quotes. "In line with market standards for nonprofit fundraising software." Historically criticized for opaque pricing and vendor lock-in during outbound migration.

**Key limitations:**
- No identity verification
- No free/self-serve tier — enterprise sales only
- Advocacy is a secondary feature to fundraising/CRM
- Que AI is fundraising-focused, not advocacy-verification-focused
- Progressive-leaning ecosystem (not explicitly restricted like AN, but brand perception limits conservative adoption)
- Data hostage practices documented during outbound migration

**Market share:** Claims 69.5% of the nonprofit tech market (by org count, includes fundraising — not pure advocacy).

**Sources:** [Bonterra Product](https://www.bonterratech.com/product/everyaction), [Bonterra Que Launch](https://www.businesswire.com/news/home/20251001579571/en/), [GetApp Reviews](https://www.getapp.com/nonprofit-software/a/everyaction/)

---

#### Quorum (+ Capitol Canary)

**What they are:** The bipartisan public affairs platform. Acquired Capitol Canary (Sept 2022) to combine legislative intelligence with grassroots mobilization. 2,000+ clients including 50%+ of the Fortune 100.

**Core capabilities:**
- 9 product modules: Federal, State, Local, School Board, Grassroots, PAC, Stakeholder, International, Professional Services
- Legislative tracking: federal + all 50 states + local. Real-time bill alerts, vote tracking, amendment analysis
- Quincy AI (v2.0, Jan 2025): natural language legislative search, bill summarization, amendment impact analysis, stakeholder insight surfacing. Trained specifically on legislative text.
- Grassroots: email, text, social media advocacy campaigns. AI generates up to 300 message variants per campaign
- Capitol Canary integration: patch-through calling, chatbot advocacy, social media targeting
- Legislator scorecards and auto-updating vote datasheets
- Stakeholder management with CRM-style tracking
- PAC management and compliance

**Pricing:** Enterprise only. Not publicly listed. Industry sources estimate $10K–$30K+/year depending on modules. 9 customizable plan configurations.

**Key limitations:**
- No identity verification — address-based district matching only (Cicero dependency)
- Enterprise sales only — no self-serve, no small-org tier
- Quincy AI analyzes legislation but doesn't verify the identity behind advocacy actions
- No coordination integrity signals (GDS, ALD, temporal entropy)
- Price excludes grassroots orgs, small nonprofits, and most conservative advocacy groups

**Sources:** [Quorum Products](https://www.quorum.us/products/), [Quorum Acquires Capitol Canary](https://www.quorum.us/company-news/quorum-acquires-capitol-canary-public-affairs-software-leaders/), [Quincy 2.0 Launch](https://www.quorum.us/company-news/quorum-launches-quincy-2-0/), [Quorum Pricing](https://www.quorum.us/pricing/)

---

#### FiscalNote / VoterVoice

**What they are:** Public affairs intelligence platform (FiscalNote) with integrated grassroots advocacy (VoterVoice). 2,000+ organizations. Parent company is publicly traded (NYSE: NOTE).

**Core capabilities:**
- VoterVoice: real-time advocate-to-legislator matching (local, state, federal). AI-optimized CTAs via ChatGPT integration (SmartCheck). Industry benchmarking. Email, text, push notification campaigns.
- FiscalNote: federal + state legislative/regulatory tracking (CQ product). Global policy monitoring. Media monitoring.
- 2025 Advocacy Benchmark Report: proprietary data from VoterVoice campaigns across industries.
- Flexible API with integrations.

**Pricing:** Not publicly listed. Enterprise custom quotes. Industry perception: expensive. Higher price point than most competitors.

**Key limitations:**
- No identity verification
- Enterprise pricing excludes small/grassroots orgs
- VoterVoice SmartCheck AI personalizes messages but doesn't verify senders
- Primarily serves corporate advocacy (trade associations, chambers of commerce) — not grassroots organizing
- Cicero-dependent for district matching

**Sources:** [VoterVoice](https://info.votervoice.net/), [FiscalNote Grassroots](https://fiscalnote.com/solutions/grassroots-advocacy), [2025 Benchmark Report](https://www.businesswire.com/news/home/20250825284430/en/), [VoterVoice Capterra](https://www.capterra.com/p/185592/VoterVoice/)

---

#### CiviClick

**What they are:** AI-powered grassroots advocacy platform serving businesses, associations, trade groups, nonprofits, and public affairs agencies. Bipartisan.

**Core capabilities:**
- AI-optimized multichannel outreach: email, text, phone, video, photo, social media
- 89 pre-built policy interest tags for supporter segmentation
- Gamification for supporter recruitment and participation
- Real-time campaign analytics
- Integrations: Salesforce, HubSpot, MailChimp
- Mobile-optimized action pages
- 24/7 support with dedicated community strategist

**Pricing:** Starting at $7,500/year. Custom quotes.

**Key limitations:**
- No identity verification
- High entry price ($7,500) still excludes small orgs
- Self-reported interest tags (not verified district membership)
- Smaller market presence than Quorum/VoterVoice

**Sources:** [CiviClick](https://civiclick.com/), [CiviClick Capterra](https://www.capterra.com/p/10013448/CiviClick/), [CiviClick Solutions](https://civiclick.com/solutions/)

---

#### One Click Politics

**What they are:** Digital advocacy platform focused on multi-channel legislator contact. 22,000+ campaigns managed. Bipartisan. Serves associations, corporations, nonprofits, agencies, chambers of commerce in US, Canada, Australia, UK.

**Core capabilities:**
- Prefilled web forms (20%+ conversion rate improvement)
- Video messaging: advocates record and deliver personalized video to lawmakers
- Email message rotator: multiple pre-recorded messages + subject lines auto-randomized (36 combinations) to bypass inbox filtering
- Patch-through calling
- SMS campaigns with mobile keywords
- Embeddable iframes
- Campaign activity and legislator reports
- Advocate acquisition services

**Pricing:** Starting at $3,500/month. Custom quotes.

**Key limitations:**
- No identity verification
- Very expensive ($42K+/year) — enterprise clients only
- Message rotator designed to bypass filtering rather than prove authenticity
- No coordination integrity signals

**Sources:** [One Click Politics](https://oneclickpolitics.com/), [GetApp Reviews](https://www.getapp.com/government-social-services-software/a/one-click-politics/), [One Click Capterra](https://www.capterra.com/p/163267/One-Click-Politics/)

---

#### PolicyEngage (formerly TrackBill)

**What they are:** All-in-one public affairs software combining grassroots advocacy, legislative tracking, and media monitoring.

**Core capabilities:**
- State and federal legislative tracking with real-time bill updates
- Traditional and social media monitoring
- Contact management
- Grassroots advocate engagement with legislators
- Activity tracking and stakeholder reporting

**Pricing:** Custom enterprise quotes. Not publicly listed.

**Key limitations:**
- No identity verification
- Smaller market presence
- Less grassroots-specific than dedicated advocacy platforms

**Sources:** [PolicyEngage](https://policyengage.com/), [PolicyEngage Legislative Tracking](https://policyengage.com/legislative-tracking)

---

### Tier 2: Self-Serve ($15–$300/month)

#### Action Network

**What they are:** SaaS advocacy toolkit for progressive orgs. 12,000+ orgs, 55M+ letters sent, ~14 years in market. Built on OSDI specification. **Progressive-only** (501(c)(4) ToS).

**Core capabilities:**
- Mass email: WYSIWYG, A/B testing, scheduling, SES backend
- Petitions, events, forms, surveys, fundraising pages, advocacy letter campaigns
- List management: tags, CSV import/export, report builder, saved queries
- Automation ladders (email drip sequences)
- Embeddable action widgets (iframe/JS)
- SMS/mobile messaging (newer)
- Network tier: parent/child org relationships
- OSDI API (4 req/s, 25 records/page, paid tiers only)

**Pricing:**
| Tier | Cost | Target |
|---|---|---|
| Free | $0 | Individual activists (no API) |
| Movement | $15/mo min + usage | Small-midsize orgs |
| Network | $125/mo min + usage | Federated multi-group |
| Enterprise | Custom | 1M+ emails/month |

Usage rates: $1.25–$2.50/1K emails. Action Builder add-on: ~$80/user. Boost (ML predictions): separate pricing.

**Key limitations:**
- **Progressive-only** — half the market excluded by policy
- No identity verification. Petition signatures could be bots.
- No API on free tier. 4 req/s cap on paid.
- Action history exportable only one action at a time
- No CRM beyond basic contact records
- No coordination integrity signals
- Automation ladders not exportable (migration lock-in)
- Embedded page lock-in (iframes across org websites)

**Sources:** [AN API Docs](https://actionnetwork.org/docs/v2/), [AN Pricing](https://actionnetwork.org/get-started/), [AN Pricing Blog](https://actionnetwork.blog/an-update-on-action-network-pricing/), [AN Help Center](https://help.actionnetwork.org/)

---

#### NationBuilder

**What they are:** CMS + CRM + advocacy platform. Politically neutral ("for leaders"). Serves campaigns, nonprofits, advocacy groups across spectrum.

**Core capabilities:**
- Website builder (CMS-first approach)
- People database (CRM) with tagging, segments, paths
- Email blasts (unlimited on all plans)
- Petitions, events, donations
- ActionButton (advocacy widget)
- Social media integration
- Unlimited users on all plans

**Pricing:**
| Tier | Cost | Database Size |
|---|---|---|
| Starter | $29/mo | 1,000 people |
| Pro | $99–$179/mo | 10,000 people |
| Enterprise | Custom | 100,000+ people |

14-day free trial.

**Key limitations:**
- CMS-first — advocacy tooling is weaker than dedicated platforms
- No identity verification
- No legislator matching/district resolution built in (relies on integrations)
- No legislative tracking
- Learning curve documented as steep
- Database-size pricing model penalizes growing orgs

**Sources:** [NationBuilder Pricing](https://nationbuilder.com/pricing), [NationBuilder GetApp](https://www.getapp.com/marketing-software/a/nationbuilder/), [NationBuilder vs AN](https://nationbuilder.com/how_is_nationbuilder_different_from_actionnetwork)

---

#### Muster

**What they are:** Grassroots advocacy platform for associations, nonprofits, and advocacy groups. Bipartisan. Focused on ease-of-use.

**Core capabilities:**
- Advocacy CRM with auto-updating lists
- Geographic targeting: advocate maps with heatmaps, district boundary overlays, individual pinpoints
- Embeddable action forms (CSS-customizable)
- Email and text marketing (or external tools: Mailchimp, Constant Contact, HubSpot)
- Campaign creation with custom fields and audience segmentation
- Real-time analytics dashboards
- Exportable reports (Excel, PDF)
- Salesforce AppExchange integration

**Pricing:** Not publicly listed. Plans built for nonprofits/associations with flexibility to add tools.

**Key limitations:**
- No identity verification
- Relies on external email tools for some orgs
- No legislative tracking
- No AI message personalization
- Smaller feature set than enterprise platforms

**Sources:** [Muster Platform](https://www.muster.com/product), [Muster for Associations](https://www.muster.com/solutions/associations), [Muster Campaigns](https://www.muster.com/product/advocacy-campaigns), [Muster Salesforce](https://appexchange.salesforce.com/appxListingDetail?listingId=a0N4V00000Jem1eUAB)

---

#### Ujoin

**What they are:** Cloud-based advocacy management for NGOs, trade organizations, and advocacy groups. Grassroots policy advocacy at accessible price points.

**Core capabilities:**
- Custom action pages: email, tweet, or call legislators at any level
- White-label, mobile-optimized action pages
- Click-to-call
- Custom action center displaying all org actions
- District-based advocate visualization and list segmentation
- Integrations: Neon CRM, Zapier, NationBuilder
- Dedicated community strategist per customer

**Pricing:** $99–$249/month. Free option available.

**Key limitations:**
- No identity verification
- Small platform (limited market presence)
- No legislative tracking
- No AI features
- Limited integration ecosystem

**Sources:** [Ujoin](https://ujoin.co/), [Ujoin Capterra](https://www.capterra.com/p/182558/Ujoin/), [Ujoin GetApp](https://www.getapp.com/marketing-software/a/ujoin/)

---

#### Rally Congress (Congress Plus)

**What they are:** Online advocacy platform for reaching Congress and all 50 state legislatures. Launched 2009.

**Core capabilities:**
- Campaign/petition creation for Congress and state lawmakers
- Automatic legislator lookup and message delivery (email + web form intake)
- Phone call campaigns connecting supporters to Congress
- Auto-generated bill-tracking pages with status and cosponsor lists
- Email to supporters with HTML templates and district-based segmentation
- Reporting: traffic, supporter actions, legislator contacts (weekly/daily email reports)

**Pricing:** Not publicly listed. All accounts include federal + state.

**Key limitations:**
- No identity verification
- Smaller platform
- No AI features
- Limited multichannel (no SMS, no social, no video)

**Sources:** [Rally Congress Features](https://www.rallycongress.com/marketing/features), [Rally Congress Pricing](https://www.rallycongress.com/marketing/pricing)

---

### Tier 3: Conservative / Republican Ecosystem

The conservative advocacy tech landscape is fragmented and significantly weaker than the progressive side. No conservative-specific platform offers the equivalent of Action Network's organizing toolkit.

#### i360 (Koch Network)

**What they are:** Data analytics company with 250M+ adult records, including 190M registered voters. Built for Republican campaigns and conservative advocacy. Integrated suite of grassroots technology.

**Core capabilities:**
- Predictive voter models (data science-driven)
- Walk (door-to-door canvassing app)
- Call (phone banking)
- Text (P2P texting)
- Action management system
- Digital/TV ad targeting
- Real-time analytics
- Integrations: WinRed, ActBlue, EveryAction, Anedot, NationBuilder

**Pricing:** Not publicly listed. Enterprise/custom.

**Key limitations:**
- **Campaign tool, not advocacy/organizing tool** — voter contact, not constituent-to-legislator communication
- No email advocacy campaigns
- No petition/letter campaigns to officials
- No embeddable action widgets
- Koch-affiliated branding limits adoption outside conservative movement
- No self-serve tier

**Sources:** [i360](https://www.i-360.com/), [i360 SourceWatch](https://www.sourcewatch.org/index.php/I360), [i360 Capterra](https://www.capterra.com/p/193258/i360/)

---

#### RallyRight (Loeffler)

**What they are:** Conservative tech company founded by former U.S. Senator Kelly Loeffler (R-GA). Three products for Republican campaigns.

**Core capabilities:**
- DonateRight: fundraising platform (3.5% fee — lowest published rate). Crypto, Apple Pay, Google Pay, one-click, video fundraisers.
- FieldRight: gig-economy canvassing app. AI-optimized walkbook routes. Contractors matched to nearby campaigns.
- RelayRight: P2P texting with real-time analytics.

**Pricing:** DonateRight: 3.5% flat fee. FieldRight: custom quote per target universe.

**Key limitations:**
- **Campaign tool, not advocacy tool** — fundraising + canvassing + texting, not legislator contact
- No email campaigns
- No petition/letter campaigns
- No legislator matching or district resolution
- No embeddable widgets

**Sources:** [RallyRight](https://rallyright.com/), [RallyRight DC Weekly](https://dcweekly.org/2024/01/14/rallyright-launches-innovative-technology-platforms-to-boost-fundraising-and-voter-turnout-for-conservative-candidates/), [Fox News](https://www.foxnews.com/politics/new-conservative-tech-company-inspired-swing-state-election-losses-aims-flip-script-democrats)

---

#### WinRed

**What they are:** Republican fundraising platform (counterpart to ActBlue). Not an advocacy tool.

**Key limitations:** Fundraising only. No advocacy campaigns, no legislator contact, no organizing tools.

---

#### RumbleUp

**What they are:** P2P texting platform used by all GOP national committees and 3,500+ campaigns/organizations.

**Key limitations:** Texting only. No advocacy campaigns, no legislator contact, no CRM.

---

### The Conservative Gap

| Capability | Progressive Tools | Conservative Tools |
|---|---|---|
| Mass email + list management | Action Network ($15/mo) | None at comparable price |
| Petitions + events + forms | Action Network, EveryAction | None |
| Legislator letter campaigns | AN, EveryAction, Quorum | None (must use bipartisan enterprise platforms at $10K+) |
| Self-serve advocacy ($15–$250/mo) | AN, NationBuilder, Ujoin | **Nothing** |
| Fundraising | ActBlue | WinRed, RallyRight DonateRight |
| Canvassing | MiniVAN (EveryAction) | i360 Walk, RallyRight FieldRight |
| P2P texting | Hustle, ThruText | RumbleUp, RelayRight |
| Voter data | TargetSmart, L2 | i360, Data Trust |

Conservative orgs that need affordable advocacy tooling (email + petitions + letters to legislators) either:
1. Pay enterprise prices (Quorum, VoterVoice) if they're large enough
2. Cobble together Mailchimp + Google Forms + spreadsheets
3. Use NationBuilder (mediocre advocacy features)
4. Go without

---

## Universal Capability Comparison

### What Every Platform Offers (Table Stakes)

| Capability | How Competitors Do It | How Commons Does It | Commons Advantage |
|---|---|---|---|
| **District matching** | Full street address → Cicero API (~$0.03/lookup) | Postal code → Shadow Atlas (94,166 districts, 24 types, <50ms) | Zero marginal cost. No third-party dependency. 24 boundary types vs. competitors' ~3 (federal, state upper, state lower). |
| **Official lookup** | Static database of ~500K officials (Cicero, Quorum, VoterVoice) | 3-phase agentic enrichment pipeline (identify → email enrich → validate) | More accurate for non-standard offices (water, transit, school board). Slower for standard offices — need caching. |
| **Email campaigns** | WYSIWYG, A/B testing, scheduling, SES/Sendgrid | WYSIWYG, A/B, scheduling, SES. Grounded, set-tailored composition with citation validation; segmentable by engagement tier + district. | Lead advantage is authoring quality: grounding-verified content with every citation validated accessible. Verified-district segmentation rides along as an ambient credibility note ("Established-tier constituents in CA-12" is a provable filter), not the headline. |
| **Message personalization** | AI generates 100–300 variants (Quorum, CiviClick, VoterVoice SmartCheck) | Message Writer Agent: two-phase grounding-verified composition with citation validation | Every citation validated accessible. Content is grounding-verified AND sender is identity-verified. |
| **Embeddable widgets** | iframe/JS drop-in (AN, Muster, One Click, Ujoin) | iframe + postMessage. Postal→district resolution → verified action in browser. | Widget produces ZK-verified actions, not form submissions. |
| **List management / CRM** | Email-keyed records, tags, self-reported geography, engagement scores | Email-keyed records, tags, identity commitment binding, engagement tiers (on-chain), district membership (24 types) | Tiers are non-fakeable. District membership is cryptographically proven, not self-reported. |
| **Analytics** | Opens, clicks, bounces, geographic heatmaps, engagement scores | Opens, clicks, bounces + coordination integrity (GDS, ALD, temporal entropy, burst velocity) + tier distribution | Coordination integrity signals: the org can prove its campaign is grassroots. No competitor has this. |
| **Advocate mapping** | District overlay on map (Muster, VoterVoice, Quorum). Typically federal + state legislative only. | Shadow Atlas: 24 boundary types per cell. H3-indexed. 94,166 districts. | Water districts, fire districts, school boards, transit authorities, judicial circuits — none of the competitors cover these. |

### What Only Some Platforms Offer

| Capability | Who Has It | Commons Status | Priority |
|---|---|---|---|
| **Patch-through calling** | Capitol Canary, CallHub, One Click | Not spec'd | P2 — Twilio extension. **Verified caller district** is a differentiator no one else has. |
| **Web form navigation** | Quorum, Capitol Canary, VoterVoice (99.6% deliverability) | Not planned | Skip — fragile (forms change constantly). Verification packet sent directly is more impactful. |
| **Legislative intelligence (bills, votes, alerts)** | Quorum, FiscalNote, CQ, FastDemocracy, PolicyEngage | Trail — substrate/stub only | **Incumbent fortress; Commons trails here.** Bill search + watch are live, but roll-call vote tracking is a no-op stub, bill embeddings are unwired in the sync path, and per-supporter bill alerts are absent (legislativeAlerts is org-scoped only). Quorum/FiscalNote/CQ own deep bill/vote/committee intelligence. This is a credibility floor, not the front door. |
| **Legislator scorecards** | Quorum, FastDemocracy, Legislative Scorecard | Not spec'd | P2 — Natural extension of campaign delivery + response tracking. |
| **Video messages to officials** | CiviClick, One Click | Not planned | Skip — niche, low ROI. |
| **Social media advocacy** | Quorum, Capitol Canary, CiviClick, Ujoin | Not planned | Skip — low ROI relative to engineering cost. |
| **Fax to officials** | VoterVoice, legacy platforms | Not planned | Skip — legacy. |
| **SMS campaigns** | Most platforms | Spec'd (Phase 3, Twilio) | P2/P3 |
| **Gamification** | CiviClick | Not planned | Skip — engagement tiers are structural, not gamified. |
| **Debate / quality signals** | Nobody | **Built** (LMSR + AI panel, 193 tests) | Structural advantage — no competitor has any mechanism for quality. |
| **Coordination integrity** | Nobody | Built (GDS, ALD, temporal entropy, burst velocity) | Ambient credibility tiebreaker — anti-astroturf signal that ships with every campaign. Back-office substrate, not a sold wedge. |
| **Verified identity** | Nobody | Built (5 circuits, 4 depths, mDL parsing, browser ZK) | Ambient credibility tiebreaker — lowest-replicability moat, no competitor started it, but the category thesis (an office weights a verified packet differently) is unproven, and the ZK proof lane is off (mDL scan is live on Android). Watermark, not letterhead. |
| **Portable reputation** | Nobody | **Built** (engagement tiers 0–4, on-chain, cross-org) | Structural advantage — protocol-level, not app-level. |

---

## AI Landscape

Every major platform is shipping AI in 2025–2026. None of them verify the identity behind the AI action.

| Platform | AI Product | Launch | Capabilities | Identity Verification |
|---|---|---|---|---|
| **Bonterra** | Que | Oct 2025 | Agentic AI for fundraising: workflow automation, SMS/event creation, campaign optimization, report building. Human-led (approve/reject). | **None** |
| **Quorum** | Quincy 2.0 | Jan 2025 | Legislative analysis: bill summarization, amendment tracking, natural language search, stakeholder insights. Trained on legislative text. | **None** |
| **VoterVoice** | SmartCheck (ChatGPT) | 2024 | Subject line optimization, CTA tuning, message personalization. | **None** |
| **CiviClick** | CiviClick Amplified | 2024 | AI-personalized outreach across channels, real-time analytics optimization. | **None** |
| **Action Network** | None | — | No AI features. | **None** |
| **Commons** | Message Writer, Subject Line, Decision-Maker Discovery agents + agentic delegation (spec'd) | Production (agents), spec'd (delegation) | **Grounded AI on the action**: source-grounded composition tailored to the resolved decision-maker set (citations bound to a pre-verified pool — no free-text URL invention), multi-turn subject line refinement, 3-phase decision-maker resolution to the correct official across 24 boundary types. Agentic delegation (spec'd): tier-gated authority, privacy-preserving memory. | Ambient — ZK provenance on every action |

The structural difference: Bonterra Que helps an org raise money faster. Quorum Quincy helps a lobbyist analyze bills faster. Every incumbent ships AI *for the org user*. Commons puts grounded AI *on the constituent's action* — source-grounded authoring tailored to the resolved decision-maker set, addressed to the correct official — the unclaimed "AI-on-action" category. ZK provenance rides along as the ambient guarantee that the action is real, whether composed manually or via a delegated agent; it is the watermark, not the wedge.

---

## What Congressional Offices Receive

Congressional staffers process 75–85% of incoming mail as form-generated advocacy campaigns. Personalized messages are 7x more effective than form letters. 90% of staff say individualized messages have "a lot of positive influence" on undecided Members; form messages score significantly lower ([Congressional Management Foundation](https://www.congressfoundation.org/blog/917-its-not-how-you-send-it-its-whats-inside)).

The section's own fact — personalization is 7x more effective, valued by 90% of staff — says the lead is *message quality and reaching the right official*. So the comparison leads with authoring and reach; the identity/coordination rows below cluster as the ambient "and it's provably real" tiebreaker, not the headline.

**Lead — authoring + reach (what moves offices):**

| Signal | Current Platforms | Commons |
|---|---|---|
| Message quality | Form text or 100-300 AI variants, no grounding | Source-grounded composition tailored to the resolved decision-maker set; every citation validated accessible |
| Right official | Self-reported ZIP → Cicero (federal + state only; often wrong, 15–20% of ZIPs span multiple CDs) | Resolved to the correct decision-maker across 24 boundary types — including water, fire, transit, school, judicial — that competitors do not have |
| Quality signal | None (Quorum: 300 AI variants, no quality signal) | Debate market signal (62% AMEND, market depth $247) |

**Ambient — and it's provably real (credibility tiebreaker):**

| Signal | Current Platforms | Commons |
|---|---|---|
| Count | "847 people emailed" | "847 constituents in CA-12" (verified) |
| Identity | Email address (self-reported) | ZK proof of government credential (ambient watermark) |
| District proof | None | Merkle proof against hierarchical district tree (24 boundary types) |
| Credibility | None | Engagement tier distribution (89 Pillars, 112 Established) |
| Authenticity | None | GDS 0.91, ALD 0.87, temporal entropy 0.93 |
| Privacy | Org has full PII, can be compelled to disclose | ZK — platform cannot link proof to person |

---

## Action Network — Deep Comparison

**What they are:** SaaS advocacy toolkit for progressive orgs. 12,000+ orgs, 55M+ letters sent, ~14 years in market. OSDI API v1.1.1 (capped at 4 req/s on paid plans, unavailable on free).

**What Commons is:** Not Action Network with verification bolted on. A different thing. The atom of the system is a *verified-yet-AI-authored civic action* — and what leads is authoring-to-delivery: grounded composition tailored to the resolved decision-maker set, addressed to the correct official across 24 boundary types, sold to orgs as aggregation and reach across a base. Every feature — email, letters, list management, analytics — works differently because of that authoring + reach spine. Verification is the ambient property that makes the action trustworthy, not the headline.

### Unified Feature Comparison

| Feature | Action Network | Commons |
|---|---|---|
| **Email** | WYSIWYG, A/B, SES. No grounding, no set-tailored authoring. Every recipient is an email address. | WYSIWYG, A/B, SES, plus source-grounded composition tailored to the resolved decision-maker set (citations from a pre-verified pool) — the authoring leap AN's reporting-side Boost/ActionBot AI does not attempt. Segmentable by engagement tier + district as an ambient credibility layer; an email to "Established-tier constituents in CA-12" is a different object than "people who typed 94607 into a form," but the lead difference is what's *in* the message, not just who it's to. |
| **Letter campaigns** | Congress + state legislatures. District from self-reported ZIP. No way to verify the sender lives there. | Any of 24 district types — congressional through fire, water, transit, school, judicial. District from postal→district resolution + mDL. Letter carries a ZK proof. The letter is a verified civic instrument, not a form submission. |
| **List management** | Tags, CSV import/export, self-reported geography. An org's list is a collection of unverified claims. | Tags, CSV import/export, engagement tiers (non-fakeable, on-chain), district membership across 24 boundary types. An org's list is a set of cryptographically attested relationships. |
| **Analytics** | CSV export. Opens, clicks. No way to distinguish real constituents from bots or out-of-district signers. | Full dashboard. Opens, clicks, verified actions, tier distribution, GDS, ALD, temporal entropy. Analytics answer "who engaged" with mathematical certainty, not probabilistic guessing. |
| **Identity** | Email + self-reported address. Platform stores full PII. | ZK proof of government credential. Platform stores commitment, not PII. Identity is a proof, not a record. |
| **Credibility signal** | Count of emails sent. Staffers have no basis for trust. | Verification packet: verified count, tier distribution, coordination integrity scores (GDS, ALD, entropy), debate market signal. Staffers can mathematically verify every claim. |
| **Pricing** | $15-$125/mo, no free tier | $10-$200/mo, author free + Starter $10 entry with full uncapped API |
| **Political scope** | Progressive only (501(c)(4) ToS). Half the market excluded by policy. | All — protocol verifies proof, not politics. Verification is orthogonal to ideology. |
| **API** | Paid plans only, 4 req/s cap | Free, all tiers, no cap |
| **Reputation** | None. Every supporter is equally weightless. | Engagement tiers: New (0), Active (1), Established (2), Veteran (3), Pillar (4). Non-purchasable, on-chain, portable across orgs. |
| **Privacy** | Plaintext PII. Fully subpoena-able. | ZK proofs. Platform cannot link proof to person. Cannot be compelled to disclose what it doesn't possess. Privacy is structural, not policy. |
| **Debate / quality** | None. Volume is the only metric. | LMSR market + AI panel. sqrt(stake) * 2^tier. Quality of reasoning, not just count. |
| **Agentic** | None. | Verified delegation. Tier-gated. Privacy-preserving memory. ZK proof on every agent action. |
| **Portability** | Per-org silos. Reputation resets with every new org. | Protocol-level identity. Verification and reputation travel across every org on the protocol. |
| **Custom domain** | Paid add-on | Upcoming — not yet available |
| **SQL mirror** | +$200/month add-on | Upcoming — not yet available |

### Feature Build Status

| Feature | Status | Authoring & delivery context |
|---|---|---|
| Message authoring (grounded, set-tailored) | Built | Source-grounded composition tailored to the resolved decision-maker set: Exa stratified search + Firecrawl fetch + adversarial-source-first ranking; generation grounding disabled so citations draw only from a pre-verified pool. The shipped wedge. |
| Letter campaigns / Power Landscape (Congress + state + 22 more types) | Built (code); congressional send flag-off | Decision-maker resolution to the correct official across 24 boundary types — including special districts competitors don't have. The reach spine. Note: CWC congressional send is flag-off / transport-unarmed today; the production send path is customer-signing-gated. |
| Legislative tracking / bill alerts | Trail — substrate/stub only | Bill search + watch live; roll-call vote tracking is a no-op stub, bill embeddings unwired in the sync path, per-supporter alerts absent. Incumbent fortress — intentionally not built to parity. |
| Mass email (A/B, scheduling) | Upcoming | SES backend, MJML templates. Segmentable by tier + district. |
| ZK verification pipeline / tiers / debate markets | Built (ambient substrate) | 5 circuits, 4 depths, mDL parsing, browser-side proofs; engagement tiers; LMSR + AI panel. Ambient credibility layer beneath the authoring + reach spine, not the headline. Note: CWC congressional send is flag-off / transport-unarmed today. |
| Events (RSVP, map) | Upcoming | Standard CRUD. Attendance verified against identity commitment. |
| Fundraising (0% fee) | Upcoming | Stripe integration. Donation linked to verified supporter, not just email. |
| List management / CRM | Upcoming | CSV import/export, tags, segments. Tier-aware. District membership across 24 boundary types. |
| Embeddable widgets | Upcoming | iframe + postMessage. Verification flow embeddable in org sites. |
| Multi-org networks | Upcoming | Coalition tier. Cross-org reputation portable at protocol layer. |
| Automation / ladders | Upcoming | Event-driven workflows. Trigger conditions include tier transitions and verification events. |
| Click-to-call | Upcoming | Twilio integration. Caller verified against district before connection. |
| Debate markets | Built | LMSR + AI panel. sqrt(stake) * 2^tier. On-chain resolution with appeals. |
| Engagement tiers | Built | New (0) through Pillar (4). Non-purchasable. Composite of action diversity, temporal consistency, debate participation. |
| Postal→district resolution | Built | Postal code to district without address verification. US/CA/UK/AU. |
| Shadow Atlas (district tree) | Built | 94,166 districts, 24 boundary types per cell, H3-indexed. |

---

## Moats

### Theirs

| Platform | Moat | Durability |
|---|---|---|
| **Bonterra/EveryAction** | 20K+ org installed base, full-stack nonprofit CRM, vendor lock-in during migration, progressive ecosystem entrenchment | **High** — CRM switching costs are massive. But advocacy is a secondary feature; orgs may use Commons for advocacy alongside EveryAction for fundraising. |
| **Quorum** | Legislative data feeds (all 50 states + local), Quincy AI trained on legislative text, 50%+ Fortune 100 clients, 9-module bundling | **High** — data licensing + enterprise relationships. But price ($10K+) excludes most of the market. |
| **VoterVoice** | FiscalNote parent (publicly traded, regulatory data), industry benchmarking data, 2,000+ org network | **Medium** — benchmark data is valuable but not defensible long-term. |
| **Action Network** | 12K+ org base, coalition network effects, progressive brand, embedded page lock-in (iframes across org websites) | **Medium** — OSDI provides some portability; progressive-only restriction halves addressable market; brand doesn't help with deliverability problems. |
| **i360** | 250M voter records, Koch network distribution, predictive models | **Medium-High** — data is valuable but siloed to conservative campaigns, not advocacy. |

### Ours

| Moat | Description | Replicability |
|---|---|---|
| **AI-native authoring-to-delivery spine** | End-to-end intent → ground → author → resolve-targets → deliver → report. Source-grounded composition tailored to the resolved decision-maker set (Exa + Firecrawl + adversarial-source-first ranking; grounding disabled so citations draw from a pre-verified pool). | **Medium / timing-bound** — the surface is copyable in 2-3 quarters. The durable part is grounding *discipline* welded to owned Shadow Atlas data; the real edge is owning the abandoned market during the 2026–2027 distress window first. |
| **Shadow Atlas (district layer)** | 94,166 districts, 24 boundary types, 21 with zero competitor coverage, R-tree spatial index. Owned data, zero marginal cost; architected to address 39,555 special districts / ~84K officials (data ingested state-by-state). | **Low** — Cicero charges $0.03–0.04/lookup; Google Civic shut down; the civic-data API collapse strengthens this. Building a competing district layer at this scope is a multi-year effort. The durable moat. |
| **Political neutrality** | Universal-ideology access; no progressive-only ToS. Roughly 2x addressable market vs. AN's ToS-excluded segment ("no conservative equivalent of AN exists"). | **Medium** — any new platform could be neutral, but incumbents' brand/ecosystem associations are hard to shed. |
| **Protocol composability** | Identity portable, reputation portable, network effects at protocol layer not app layer. | **Low** — requires on-chain infrastructure. App-layer competitors can't retrofit protocol-layer identity. |
| **Verification credibility layer (ambient)** | ZK identity (5 circuits, 4 depths, browser-side, $0 server cost) + coordination-integrity signals (GDS, ALD, temporal entropy, burst velocity). | **Very low** — no competitor has started it. But the category thesis (an office weights a verified packet differently) is unproven and the ZK proof lane is off (mDL scan is live on Android). A tiebreaker watermark, not a decisive moat — earns the headline only after a measured handling-difference signal. |

---

## Pricing Comparison

| Platform | Entry Price | Full-Featured | Free to Author | Self-Serve |
|---|---|---|---|---|
| **Commons** | **$10/mo (Starter)** | **$75–$200/mo** | **Yes — author free, pay $10 to deliver (full uncapped API)** | **Yes** |
| Action Network | $15/mo | $125/mo | Limited (no API) | Yes |
| NationBuilder | $29/mo | $179/mo | No (14-day trial) | Yes |
| Ujoin | $99/mo | $249/mo | Limited | Yes |
| Muster | Not published | Not published | No | Likely |
| CiviClick | $7,500/yr | Custom | No | No |
| One Click Politics | $3,500/mo | Custom | No | No |
| Rally Congress | Not published | Not published | No | Yes |
| Quorum | ~$10K+/yr | ~$30K+/yr | No | No |
| VoterVoice | Custom | Custom | No | No |
| Bonterra | Custom | Custom | No | No |
| i360 | Custom | Custom | No | No |

---

## Go-to-Market

### Beachhead segments (Year 1–2)

1. **Small orgs** — the cost + authoring wedge. Author free, Starter $10/month to deliver vs AN's $15/month minimum, full uncapped API, no paywall on analytics, and grounded set-tailored authoring no $10-tier competitor offers. $0 to author and preview; $10 to send.
2. **Nonpartisan/conservative groups** — the neutrality wedge. Structurally excluded from AN (progressive-only ToS) and priced out of enterprise platforms (Quorum, VoterVoice at $10K+). "No conservative equivalent of Action Network exists" — nothing structurally-safe and affordable at the $10–$200/mo point (the six Senate Commerce 2024 deplatformed orgs; FreedomWorks RAC's orphaned base).
3. **Local-government / special-district advocacy** — the reach wedge. School boards, water districts, transit authorities, fire districts, judicial circuits. 21 of 24 Shadow Atlas boundary types have **zero** coverage from any competitor; Shadow Atlas resolves districts Quorum and VoterVoice literally don't have. An add-to-Quorum at $75, not a switch.
4. **Science/health advocacy** — credibility over volume. ALI, disease foundations, research coalitions, low-volume high-stakes asks where the lead is grounded, credible *authoring*. Here the ambient verification watermark is the tiebreaker that makes the counts believable — not "verification is the product."

### Expansion (Year 2–4)

5. **Progressive orgs wanting proof** — run Commons alongside AN. Use AN for volume, Commons for verified actions. Migration path when they see the difference in staffer response rates. AN API sync tool (spec'd in `docs/specs/IMPORT-SPEC.md`) reduces migration from 6 months to weeks.
6. **Corporate advocacy / trade associations** — currently paying $10K–$30K+/year to Quorum/VoterVoice. Commons Organization tier at $75/mo ($900/yr) is 10–30x cheaper. Verification packet is more credible than volume metrics.

### Differentiated capabilities by segment

| Segment | What they need | What competitors offer | What Commons offers |
|---|---|---|---|
| Small orgs | Free/cheap, easy setup + good copy | AN $15/mo (no API), NationBuilder $29/mo | Author free, $10 Starter to deliver, full uncapped API, grounded set-tailored authoring |
| Conservative/nonpartisan | Affordable, structurally-safe tooling | Nothing at <$7,500/yr; "no conservative equivalent of AN" | Full platform at $10–$200/mo (author free, $10 Starter to deliver); universal-ideology access |
| Local government | Sub-state + special-district targeting | Federal + state legislative only | 24 boundary types including school, water, fire, transit, judicial — 21 with zero competitor coverage |
| Science/health | Credible, well-authored low-volume asks | Unverified email counts | Grounded credible authoring (citation-validated); ambient verified counts + tier distribution as the tiebreaker |
| Progressive orgs | Better response rates from offices | Volume-based, unverified | Grounded authoring + ambient proof side-by-side. AN sync adapter (armed) for migration. |
| Corporate/trade | Legislative tracking + advocacy | Quorum/VoterVoice at $10K+/yr | $75/mo Organization tier (add-to-Quorum). Note: legislative intelligence is incumbent turf — Commons trails there. |

---

## Sources

### Market Size
- [Business Research Insights: Advocacy Software Market](https://www.businessresearchinsights.com/market-reports/advocacy-software-market-105020)
- [SNS Insider: Advocacy Software Market](https://www.snsinsider.com/reports/advocacy-software-market-9352)
- [Market Growth Reports: Grassroots Advocacy Software](https://www.marketgrowthreports.com/market-reports/grassroots-advocacy-software-market-120061)

### Platforms
- [Bonterra EveryAction](https://www.bonterratech.com/product/everyaction)
- [Bonterra Que Launch (BusinessWire)](https://www.businesswire.com/news/home/20251001579571/en/)
- [Bonterra Advocacy Software](https://www.bonterratech.com/solutions/advocacy-software)
- [Quorum Products](https://www.quorum.us/products/)
- [Quorum Acquires Capitol Canary](https://www.quorum.us/company-news/quorum-acquires-capitol-canary-public-affairs-software-leaders/)
- [Quorum Quincy 2.0](https://www.quorum.us/company-news/quorum-launches-quincy-2-0/)
- [Quorum Grassroots](https://www.quorum.us/products/grassroots/)
- [VoterVoice Products](https://info.votervoice.net/)
- [FiscalNote Grassroots Advocacy](https://fiscalnote.com/solutions/grassroots-advocacy)
- [FiscalNote 2025 Benchmark Report](https://www.businesswire.com/news/home/20250825284430/en/)
- [CiviClick](https://civiclick.com/)
- [CiviClick Solutions](https://civiclick.com/solutions/)
- [One Click Politics](https://oneclickpolitics.com/)
- [PolicyEngage](https://policyengage.com/)
- [Action Network API Docs](https://actionnetwork.org/docs/v2/)
- [Action Network Pricing](https://actionnetwork.org/get-started/)
- [Action Network Pricing Update](https://actionnetwork.blog/an-update-on-action-network-pricing/)
- [NationBuilder Pricing](https://nationbuilder.com/pricing)
- [NationBuilder vs AN](https://nationbuilder.com/how_is_nationbuilder_different_from_actionnetwork)
- [Muster Platform](https://www.muster.com/product)
- [Muster for Associations](https://www.muster.com/solutions/associations)
- [Ujoin](https://ujoin.co/)
- [Rally Congress Features](https://www.rallycongress.com/marketing/features)
- [i360](https://www.i-360.com/)
- [i360 SourceWatch](https://www.sourcewatch.org/index.php/I360)
- [RallyRight](https://rallyright.com/)
- [RallyRight Launch (DC Weekly)](https://dcweekly.org/2024/01/14/rallyright-launches-innovative-technology-platforms-to-boost-fundraising-and-voter-turnout-for-conservative-candidates/)

### Infrastructure
- [Cicero API](https://www.cicerodata.com/api/)
- [Cicero Pricing](https://www.cicerodata.com/pricing/)
- [Google Civic Info API Shutdown](https://groups.google.com/g/google-civicinfo-api/c/9fwFn-dhktA)
- [USgeocoder (Google Civic alternative)](https://blog.usgeocoder.com/looking-for-a-google-civic-api-alternative-discover-usgeocoder-api/)

### Effectiveness Research
- [Congressional Management Foundation: Message Effectiveness](https://www.congressfoundation.org/blog/917-its-not-how-you-send-it-its-whats-inside)
- [Causes.com: Securing Advocacy in an AI World](https://www.causes.com/articles/55009-securing-advocacy-ai-world-understanding-authentication)
- [WebProNews: Phantom Signatures](https://www.webpronews.com/phantom-signatures-and-political-theatrics-how-fake-sign-ins-may-have-inflated-opposition-to-washington-states-millionaires-tax/)
- [LegBranch: Managing Constituent Correspondence](https://www.legbranch.org/2018-7-25-managing-constituent-correspondence-effects-on-citizen-advocacy-and-congressional-learning/)
- [VoterVoice: Advocacy 101](https://info.votervoice.net/resources/advocacy-101)
- [Quorum: Emailing Capitol Hill](https://www.quorum.us/blog/emailing-capitol-hill/)
