# Vision

> Civic infrastructure that authors, grounds, and delivers — every action carrying proof underneath.

---

> **Positioning + pricing recenter (2026-06-14).** The center of Commons is the
> AI-native **authoring-to-delivery** spine: an org describes its objective and
> Commons grounds it against decision-makers, composes individualized messages,
> and delivers them. **Verification is ambient** — a watermark riding under
> every artifact, not the North Star headline. The org front door is **Studio**
> (authoring), not the proof packet. The delivered artifact is the **Constituent
> Report**, leading with constituents, individually-composed authorship, and
> response. There is **no free org tier**: entry is Starter ($10/mo); orgs with
> no active subscription fall to the non-marketed `inactive` floor (author a
> campaign or two free; all delivery + scale gated to zero). Recorded
> 2026-06-02 / 2026-06-14; merged through PR #34. Sections below predate this
> recenter where they still lead with verification — read them through this lens.

---

## What Commons Is

Commons is AI-native civic communication infrastructure. An org states what it
wants to change; Commons grounds that objective against the right
decision-makers, composes individually-authored messages with each constituent,
and delivers them — then hands back a Constituent Report. Not a mail merge tool
with a database. The authoring-to-delivery spine is the core; verification is
the ambient property woven underneath that makes the resulting civic speech
*provable*.

A person sends a letter through Commons. That letter carries cryptographic proof that the sender holds a government-issued credential, lives in the decision-maker's district (verified against a hierarchical Merkle tree of every public district boundary — congressional, state legislative, county, municipal, school, judicial, fire, water, transit, and more), and has an engagement history that cannot be purchased or fabricated. The decision-maker's office doesn't trust Commons. They verify the math.

An organization runs campaigns through Commons. Those campaigns produce verification packets: district-level constituent counts, engagement tier distributions, coordination integrity scores, and adversarial quality signals. A staffer opens a campaign report and sees not "847 people emailed" but "847 verified constituents in your district, 89 at Pillar tier, coordination diversity score 0.91, debate market consensus 62% AMEND."

commons.email is the application. voter-protocol is the open protocol beneath it.

## Design Thesis

The system must be indistinguishable from existing advocacy tools for someone who has never heard of zero-knowledge proofs — while delivering guarantees that existing tools architecturally cannot.

Three constraints:
1. **Cheaper** — 40-60% lower pricing, 80%+ gross margin
2. **Simpler** — fewer clicks to send a verified message than competitors require for an unverified one
3. **Unreplicable** — ZK identity, debate markets, coordination integrity, privacy architecture are structural. They cannot be bolted on after the fact.

## What Makes It Different

These are not separate features bolted onto a platform. They are properties of every surface — woven into every email, every letter, every campaign report, every agent action.

### Verified Identity

Every other advocacy platform accepts whatever name and address a user types in. Commons binds actions to government-issued credentials through zero-knowledge proofs. The proof reveals nothing about the person — only that they are real, that they hold a valid credential, and that they reside in the claimed district. This is not a feature added to email campaigns. It is the foundation that makes every campaign report, every analytics dashboard, every supporter segment fundamentally different from what any other platform produces.

### Adversarial Quality (Debate Markets)

When a campaign reaches traction, verified participants can stake on positions (SUPPORT / OPPOSE / AMEND) with structured arguments. LMSR pricing surfaces genuine conviction. A 5-model AI panel scores argument quality. Engagement-weighted: `sqrt(stake) × 2^tier` — a Pillar's $2 outweighs a newcomer's $100. The result: campaigns become quality instruments, not volume instruments.

### Coordination Integrity (Anti-Astroturf)

Congressional staffers currently have no tool to distinguish authentic grassroots from manufactured campaigns. Commons provides structural observability — Geographic Diversity Score, Author Linkage Diversity, Shannon entropy, temporal velocity — computed automatically from every action, whether submitted by a person or an agent. These signals ship with every campaign report. An org can prove its campaign is authentic. A staffer can verify it.

### Privacy Architecture

Commons cannot be subpoenaed for supporter data it does not possess. ZK proofs reveal constituency and engagement tier without revealing identity. The platform never sees the credential — only the proof derived from it. Agent memory is encrypted to the constituent's identity commitment. For organizations working on controversial issues, this is an existential requirement that no other platform can offer.

### Protocol Composability

Commons is one application on voter-protocol. The protocol is open:

```
APPLICATION LAYER
  commons.email          app-2              app-3
  (email, letters,       (city council      (union
   debates, events)       engagement)        organizing)

PROTOCOL LAYER (voter-protocol)
  ZK identity    — shared across all apps
  District map   — hierarchical global tree (24 slots per cell, every public district type)
  Debate markets — adversarial quality assurance
  Nullifiers     — one person, one action
  Engagement     — portable, non-purchasable reputation
```

A supporter who builds reputation on one organization's campaign carries it everywhere on the protocol. Identity is not siloed per-org. Reputation is not reset per-platform. Network effects compound at the protocol layer, not the application layer.

### Verified Agentic Delegation

Every advocacy platform adding AI in 2026 — Bonterra Que, Quorum Quincy, AdvocacyAI — layers AI on top of unverified identity. Commons does something structurally different: AI agents act on behalf of cryptographically verified constituents, within delegated bounds, with privacy-preserving memory.

A constituent delegates authority to an agent: "monitor school board agendas, draft responses matching my positions, notify me before sending." The agent monitors legislation across all 24 district types — not just federal. It drafts grounding-verified messages. It pre-resolves decision-makers. Every action it takes carries the same ZK proof as a manual action.

The delegation is bound to the constituent's engagement tier. An Active's agent can draft but not send. A Pillar's agent can act semi-autonomously within configured bounds. The on-chain nullifier system prevents an agent from exceeding its delegation. Revocation is instant.

The agent's memory — policy positions, engagement history, communication preferences — is encrypted to the constituent's identity commitment. The platform stores ciphertext. This is the intersection of agent memory and ZK privacy that the frontier research identifies as unexplored.

Full specification: `specs/agentic-civic-infrastructure.md`

## Political Neutrality

Every major advocacy platform is either explicitly progressive (Action Network — 501(c)(4), stated in ToS) or progressive-leaning (EveryAction — 69.5% market share, Bonterra parent). Bonterra actively deplatformed conservative nonprofits (Senate Commerce Committee investigation, 2024). Action Network rejects them at signup. The conservative side has no affordable, integrated advocacy platform — just fundraising tools (WinRed), canvassing tools (i360), and texting tools (RumbleUp), none of which connect constituents to legislators.

Commons verifies constituency, not ideology. Science-focused orgs, single-issue groups, conservative advocacy, nonpartisan coalitions, domain-obsessed local groups — the protocol doesn't filter by politics. It filters by proof. A gun rights org and a gun control org can both run verified campaigns on the same infrastructure. A tenant union and a landlord association can both target the same city council member with verified constituent contacts. The decision-maker sees proof from both sides.

This is not centrism. It is infrastructure. Roads don't check voter registration.

## Universal by Design

Commons is not a US federal advocacy tool that might expand someday. It is civic communication infrastructure designed for any org, targeting any level of government, in any country with structured district boundaries.

**Any org.** Conservative, progressive, or simply obsessed with their domain. Water rights. School safety. Transit equity. Pharmaceutical pricing. Agricultural policy. Veterans affairs. Fire district accountability. The orgs that will use Commons hardest are the ones most obsessed with their issue — because proof is what converts their obsession into legislative leverage. When you've spent years fighting a water district rate hike, and you can finally send a verification packet proving 147 verified constituents in the district oppose it with a coordination diversity score of 0.91, that changes the game. No platform has ever given these orgs anything.

**Any level of government.** The US has 90,887 local government entities and 500,396 elected officials — 96% of all elected officials. School boards, water districts, fire districts, transit authorities, county commissions, city councils, township boards. No advocacy platform covers more than 2-17% of these entities. Shadow Atlas's 24-slot model is designed to ingest every boundary type, and each new type ingested creates an entirely unserved market for verified advocacy.

**Any country.** voter-protocol uses H3 hexagonal indexing (global), country-code-keyed district registries, and a 24-slot model that accommodates any governance hierarchy. Canada's federal ridings and provincial constituencies, the UK's Westminster constituencies and devolved assemblies, Australia's federal and state electorates — all fit within the existing architecture. Boundary data ingestion is the only work required per country. One protocol, one app, many district trees.

**The business implication:** The addressable market is not $191M (US grassroots advocacy). It is every organization in every democracy that wants to prove its supporters are real. That's a market no competitor has even conceived of, because no competitor has the verification infrastructure to serve it.

## Why "Commons"

The commons is shared infrastructure that belongs to no one and serves everyone. Public roads, public water, public airwaves. Civic communication infrastructure should be a commons — not a proprietary SaaS platform owned by an advocacy organization with undisclosed funding sources.

voter-protocol is the commons. commons.email is one application on it. The identity is portable. The reputation is portable. The verification is portable. Any developer can build on the protocol. Any org can use the application. Any constituent can carry their proof anywhere.
