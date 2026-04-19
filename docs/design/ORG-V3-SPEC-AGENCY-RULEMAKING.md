# /org-v3/agency-rulemaking — Segment Surface Spec

**Path 3, Segment 02 — Federal Agency Rulemaking**
**Status:** Spec. Not implemented. Companion to `/org-v3/state-legislature`.
**Date:** 2026-04-17

---

## Target segments

Advocacy orgs whose pipeline terminates at **regulations.gov** (federal) or state-level PUC / BOE / state-EPA docket portals. Specifically:

- **Environmental** — NRDC, EDF, Sierra Club state chapters, Earthjustice, Public Citizen, Center for Biological Diversity. EPA dockets on clean air, water, toxics, methane; DOE on efficiency standards.
- **Disability rights** — ADA / Section 504 comment periods at HUD, HHS, DOJ, DOT.
- **Food policy** — FDA food-labeling, FTC commercial-speech, USDA organic-standards.
- **Labor** — DOL overtime rule, OSHA standards, NLRB election procedures.
- **Consumer finance** — CFPB rulemakings.
- **State PUC coalitions** — Oregon, Hawaii, Colorado, California, Pennsylvania PUCs (utility-rate / clean-energy siting dockets).

These orgs already submit technical comments. Their gap is proving the **constituent volume attached to the technical argument** is real, and getting out of the "mass comment campaign" bucket the docket officer files away.

## Hero seed + rationale

**Seed:**
> *"Your 40,000-comment submission got one sentence and a tally in the rule preamble: 'A mass comment campaign urged the agency to go further.' The 300-page technical brief you spent six months on is in a different bucket."*

**Rationale:** GW Regulatory Studies Center's *Are Agencies Responsive to Mass Comment Campaigns?* found **54% of comments did not match on any dimension of final rule change**. Agencies explicitly bucket identical-language submissions and weight sophisticated technical/economic comments disproportionately (Lens 2 synthesis). FCC net-neutrality hit 22M comments — overwhelmingly dismissed. The staffer-side truth is that verified, individually authored constituent voice *attached to* a technical argument is the lever, not volume alone.

The hero names the buckets — "mass comment" vs "technical brief" — and positions Commons as the bridge that gets verified constituent weight into the analytic track.

## Gap artifact choice + rationale

**Choice:** A rendered regulations.gov **docket folder view** showing the "Mass Comment Campaign" bucket collapsed to a single representative-sample row with a count: `[+40,128 more — sampled]`. Adjacent: a handful of individually-named technical comments fully expanded with titles and organization affiliations.

**Rationale:** This is the literal artifact orgs see when they look at their own submissions on the public docket. It visually encodes the bucketing mechanism:

- One row represents tens of thousands of identical-body form comments.
- Individual, non-identical, technically-specific comments get their own row, full title, org affiliation.

The gap is not "your comments are ignored" — it's "your comments are categorically filed away from the analytic lane." Commons's mechanism produces submissions that stay in the individual-comment lane *because* they are individually authored and identity-verified — provable via the attached proof packet.

**Why this over alternatives:** The generic inbox-spray artifact (used for state-leg) doesn't map to regulations.gov. The docket bucket-collapse IS the artifact that shows the filter.

## Specimen example

```
EPA DOCKET EPA-HQ-OAR-2025-0184 · METHANE RULE PACKET
Docket: EPA-HQ-OAR-2025-0184 (Oil & Gas Methane Emissions)
Period: Jan 15 – Mar 30, 2026
Agency: EPA, Office of Air and Radiation

3,428 verified commenters
   · 2,104 in proximate-impact counties
   · 1,324 elsewhere in US

Identity: 2,891 gov ID · 537 address-matched
Authorship: 2,612 individually composed · 816 shared templates
Technical citations: 1,844 comments reference specific rule sections
Geography: 47 states · 312 counties · 89 proximate-impact counties
Screening: one submission per person · duplicates removed

CRYPTOGRAPHIC AUDIT TRAIL · INDEPENDENTLY VERIFIABLE
```

**Why these fields:** Rulemaking-specific evidence the docket officer actually weights.

- **Proximate-impact geography** — CMF equivalent for rulemaking is "affected community." Commons proves commenters live near oil/gas operations, refineries, aquifers, etc. (via H3 overlay on the impact geography the agency itself defined).
- **Technical citations** — distinguishes commenters who cite specific rule sections from generic-support comments. This is the signal GW Regulatory Studies Center identified as weighted.
- **Shared templates disclosed honestly** — 816 shared templates acknowledged, but each attached to a verified individual. The bucket test fails (not identical-body form mail), even though the org organized around shared framing.

## Anchor boundary list

State an appropriate mix that feels real across federal + state-agency dockets:

- EPA-HQ-OAR (Air and Radiation)
- EPA-HQ-OW (Water)
- FDA-2025-N (Food labeling)
- HUD-2025-R (Fair housing)
- DOE-HQ-EE (Energy efficiency)
- DOL-WHD (Wage and hour)
- CFPB-2025 (Consumer finance)
- California PUC Rulemaking Docket
- Oregon PUC UM
- Hawaii PUC Docket
- Pennsylvania PUC Docket

**Stat footer:**
> *"Every federal rulemaking docket on regulations.gov. Plus state PUC / BOE / state-EPA dockets in OR, HI, CO, CA, PA, and expanding."*

**Stat precision:** regulations.gov hosts dockets from ~300 federal agencies and sub-agencies. 4M+ comments submitted cumulatively to high-profile dockets. Commons coverage is docket-agnostic because the submission path is the regulations.gov v4 API (Lens 2 synthesis).

## Category displacement seed

> *"Your existing comment tool sprays identical language into the mass-comment bucket. Commons delivers comments the agency docket officer reads individually — each verified, each geographically specific, each citing the rule provision it addresses."*

## Outcome seed

> *"Individually-authored, identity-verified comments enter the rulemaking record as individual comments. Mass-comment campaigns enter the bucket."*

## Citations from the synthesis

Grounding each claim to the advocacy-world research synthesis (`ADVOCACY-WORLD-SYNTHESIS.md`):

1. **"54% of comments did not match on any dimension of final rule change"** — GW Regulatory Studies Center, *Are Agencies Responsive to Mass Comment Campaigns?* (Lens 2).
2. **FCC net neutrality 22M comments** — Lens 2 intake table, showing peak mass-comment dismissal precedent.
3. **"Agencies weight sophisticated technical/economic comments disproportionately"** — GW Regulatory Studies Center (Lens 2 synthesis).
4. **"Mass comment campaign" bucket** — regulations.gov v4 API behavior; "one representative sample + total count posted" per Lens 2 intake table.
5. **Walker & Le *Socius* 2023** — astroturfing "erodes trust in legitimate advocacy organizations." Load-bearing for the "verified, not form" displacement (Lens 4).
6. **CMF 2015** — 53% of Hill staffers agreed form-message campaigns sent without constituents' knowledge. Translated to agency context: the astroturf-detection problem is the same; the bucket mechanism is the agency-specific expression (Lens 2).

## Design notes

- Same component skeleton as `/org-v3/state-legislature`: hero → comparison (gap + specimen) → displacement + citation → outcome → anchors → price → CTA.
- **Gap artifact differs visually**: list of collapsed docket buckets, not inbox spray. Same typographic register.
- **Specimen has two extra fields** vs state-leg: `Proximate-impact geography` and `Technical citations`. These are rulemaking-specific evidence types.
- Same pricing block. Same friction line. Same CTA to `/org`.

## What this surface does NOT solve (honest gap)

- **Technical comment co-authoring** is out of scope. Orgs still need their policy team to write the technical brief. Commons attaches verified constituent weight to it; it does not replace the policy analyst.
- **State PUC adapters are partial**. OR, HI, CO, CA, PA have usable web forms. Other states require email-to-clerk. Roadmap item.
- **The mass-comment bucket is a policy choice, not a physical one.** Agencies could change their triage. Commons bets they won't — the bucket exists because it solves a real filtering problem for the docket officer.

---

*Commons PBC · /org-v3 segment spec · 2026-04-17*
