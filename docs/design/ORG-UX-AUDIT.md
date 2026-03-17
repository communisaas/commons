# Org Layer UX Audit: The CRM Divergence

**Status:** Audit findings (2026-03-17)
**Method:** Multi-agent critique (Claude, Codex, Gemini) + structured adversarial debate + founder review
**Severity:** Critical — the org layer implementation has diverged from its own design philosophy
**Depends on:** PERCEPTUAL-BRIDGE.md, design-system.md, CAMPAIGN-ORCHESTRATION-SPEC.md, org-data-model.md

---

## Executive Summary

The org layer backend is transcendent: ZK proofs, privacy-preserving analytics, coordination integrity scoring, cryptographic proof packets, aggregate-only supporter visibility. The org layer frontend presents as a generic CRM: sidebar nav, contact tables, email composers, campaign cards with status badges.

PERCEPTUAL-BRIDGE.md explicitly states:

> **Don't Build:** "Campaign management", "List management", "Email marketing", "Analytics dashboard"
> **Do Build:** "Verification packet assembler", "Invitation composer", "Segment lens", "Report shipper", "Migration garden", "Coalition endorsement"

The implementation built exactly what the design doc says not to build. The philosophy is correct. The execution diverged. This document records the findings exhaustively so the redesign has a complete map of what's wrong and why.

---

## The Core Failure

**The interface makes verification a *feature* of a CRM instead of making CRM a *consequence* of verification.**

Every screen opens with operational CRM affordances (manage contacts, compose emails, track campaigns) and buries verification capabilities as secondary metrics, colored badges, or below-fold analytics. The information hierarchy is inverted from the design intent.

The backend answers: "What cryptographic proof of constituent legitimacy has been assembled?"
The frontend answers: "How do I manage my contact list and send emails?"

---

## Finding 1: The Navigation Is a CRM Confession

**Severity:** Critical
**File:** `src/routes/org/[slug]/+layout.svelte:18-25`

```js
const navItems = $derived([
    { href: base, label: 'Dashboard', icon: 'chart' },
    { href: `${base}/supporters`, label: 'Supporters', icon: 'people' },
    { href: `${base}/campaigns`, label: 'Campaigns', icon: 'send' },
    { href: `${base}/emails`, label: 'Emails', icon: 'email' },
    ...
    { href: `${base}/settings`, label: 'Settings', icon: 'gear' }
]);
```

**What's wrong:** This is the exact sidebar of every CRM since 2014 — Dashboard, Contacts, Campaigns, Emails, Settings. The words "verification," "proof," "integrity," "district," or "decision-maker" appear nowhere in the primary navigation. The user's mental model from the first second is: "this is where I manage contacts and send emails."

**Design intent (PERCEPTUAL-BRIDGE.md):** "The org dashboard is a weather station, not a control panel." The navigation should reflect verification-native concepts, not CRM concepts.

**Impact:** The navigation is the product's identity statement. This one says "I'm a CRM." Every session begins with a lie about what the product actually does.

**Violation of:** PERCEPTUAL-BRIDGE.md principle: "Don't Build: Campaign management, List management, Email marketing"

---

## Finding 2: Onboarding Trains CRM Muscle Memory

**Severity:** Critical
**File:** `src/lib/components/org/OnboardingChecklist.svelte:141-308`

The 5-step onboarding:
1. Add a description and billing email
2. Invite your team
3. Import supporters
4. Create your first campaign
5. Send your first email

**What's wrong:** This is the exact onboarding for Mailchimp, EveryAction, and Action Network. Step for step. "Import contacts, create a campaign, send an email." There is zero mention of verification, proof assembly, coordination integrity, or what happens when that email arrives at a legislator's desk with a cryptographic proof packet attached.

Step 3 hint: "Upload CSV or sync from Action Network" — tells users they're importing a contact list, not seeding a verification graph.

Step 5 hint: "Reach supporters with verified delivery" — buries the most important word ("verified") in a phrase that reads as a synonym for "your email won't bounce."

**Design intent (PERCEPTUAL-BRIDGE.md):** The migration should feel like planting seeds ("Migration garden"), not moving a contact list. The first experience should produce a felt verification signal.

**Impact:** First-time users complete onboarding thinking they set up a basic email tool. The aha moment is deferred indefinitely.

---

## Finding 3: The Supporter Table Contradicts the Privacy Model

**Severity:** Critical
**File:** `src/routes/org/[slug]/supporters/+page.svelte:379-478`

The supporters page is a data table with columns: Status, Name, Email, Postal, Tags, Source, Added. The verification state is a tiny 3-letter badge in the first column (VER, POST, IMP). The filter bar offers 5 dimensions — 4 are CRM concerns (email deliverability, tags, source tracking), 1 is verification.

**What's wrong (two failures):**

**Failure A — CRM mental model:** The table triggers "Contact Management" expectations. Users will try to click rows to see individual supporter profiles, search for specific people, manage individual records. This is the CRM interaction pattern. But Commons architecturally prevents orgs from seeing individual identities. When users try to "use it like a CRM" and hit the privacy wall, they'll perceive the system as broken rather than principled.

**Failure B — Verification is decorative:** The summary bar shows three colored dots (green: verified, amber: postal, gray: imported). This is a CRM pipeline metric — "how many contacts are in which stage of data hygiene." It should be an urgency signal: "412 of your supporters are still just email addresses. They have no proof weight. Here's what that means for your next campaign delivery."

**Design intent (PERCEPTUAL-BRIDGE.md):** "Segments are lenses into the protocol, not SQL queries." The supporter view should show the collective proof graph, not individual contact records.

**Impact:** Users manage supporters the way they manage contacts in any CRM — search, filter, tag, segment, email. Nobody feels motivated to push supporters through the verification pipeline because the interface treats VER/POST/IMP as passive status badges, not an active verification journey with consequences for proof weight.

---

## Finding 4: Campaign Detail Leads with Admin, Not Proof

**Severity:** Critical
**File:** `src/routes/org/[slug]/campaigns/[id]/+page.svelte:170-324`

The campaign detail page information hierarchy:
1. Administrative fields (title, type, description, template) — set once, never change
2. Geographic targeting controls
3. Debate market toggle with no context
4. **Then** verification packet and analytics (below fold)

**What's wrong:** The user spends their first 30 seconds looking at form fields. The verification packet — the actual point of the campaign — is below the fold. The "Debate Market" toggle says "Enable on-chain debate for this campaign" with a threshold number input. No explanation of what this means, why you'd want it, or what happens when the threshold is met.

Decision-Maker Targets is a manual data entry form (name, email, title, district). This is where cryptographic proof packets get delivered, and the interface treats it like an address book entry.

**Design intent (CAMPAIGN-ORCHESTRATION-SPEC.md):** "The dashboard shows what the decision-maker will see. The org's job is to make the packet as strong as possible. The dashboard is the packet, assembling live." The verification packet should be the primary surface, with admin controls secondary.

**Impact:** Users fill out the form, click save, and scroll past the verification data because it looks like analytics they'll check later.

---

## Finding 5: "Preview Report" Buries the Nuclear Weapon

**Severity:** Critical
**File:** `src/routes/org/[slug]/campaigns/[id]/+page.svelte:441-453`

```svelte
<a href="/org/{data.org.slug}/campaigns/{data.campaign.id}/report"
   class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white">
    Preview Report
</a>
```

The cryptographic proof packet — the thing that makes Commons categorically different from every competitor — is a teal button below the fold labeled "Preview Report." It sits after the edit form, after the verification analytics, after the geographic spread chart, after the decision-maker target table.

**What's wrong:** "Preview Report" sounds like an analytics export. It doesn't communicate that clicking this button shows the unforgeable, privacy-preserving proof of constituent legitimacy that gets delivered to the decision-maker. This is the product's nuclear weapon, labeled like a PDF download.

**Design intent (PERCEPTUAL-BRIDGE.md):** "The org's job is to read the weather and decide when to ship the report." Shipping the report is the org's PRIMARY action — it should be the most prominent affordance in the entire interface, not a button below the fold.

**Design intent (CAMPAIGN-ORCHESTRATION-SPEC.md):** The spec explicitly places `[Preview Report] [Send to Targets]` as the primary CTA of the campaign dashboard, inside the verification packet section — not below it.

**Impact:** Most users will never click this button. Those who do will think they're looking at a PDF preview, not the cryptographic proof assembly that makes their advocacy credible.

---

## Finding 6: Coordination Integrity Scores Are Incomprehensible

**Severity:** High
**Files:** `src/lib/components/org/VerificationPacket.svelte:96-220`, `src/lib/components/org/CoordinationIntegrity.svelte:23-73`

Five metrics with normalized bars and color coding: GDS, ALD, temporal entropy, burst velocity, CAI. Descriptions are in `title` attributes (invisible on touch, nobody hovers).

**What's wrong:** Target users are 3-5 person advocacy teams, not data scientists. "Temporal entropy" is a physics term. "Burst velocity" is meaningless without context. The scores are displayed as numbers (0.82, 0.67, 3.2) with color coding but no human-readable interpretation.

The burst velocity warning (`burstVelocity > 5`) shows a tiny amber "high" label. This should be a red alarm: "Your campaign looks like a bot attack. Decision-makers will dismiss it."

**Design intent (design-system.md):** "Technical Details in Popovers — Primary UI stays simple." The integrity scores answer "will the decision-maker take us seriously?" perfectly — but they encode the answer in academic jargon instead of plain language.

**Impact:** Users ignore the coordination integrity panel entirely. It looks like analytics noise. They never understand that these scores determine whether their proof packet is credible or dismissed.

**What it should say instead:**

| Score | Current label | Should say |
|-------|--------------|------------|
| GDS 0.91 | "Geo Spread: 0.91" | "Your supporters span 91% of targeted districts — strong geographic diversity" |
| ALD 0.87 | "Msg Unique: 0.87" | "87% of messages are original — not a copy-paste campaign" |
| H(t) 3.42 | "Time Spread: 3.42" | "Actions spread organically over time — no coordinated burst" |
| BV 1.8 | "Burst: 1.8" | "Action rate is steady — looks organic to recipients" |
| BV 8.3 | "Burst: 8.3 (high)" | "WARNING: Sudden spike in actions. Decision-makers may flag this as inauthentic." |
| CAI 0.12 | "Depth: 0.12" | "12% of supporters have deepened engagement over time" |

---

## Finding 7: The Dashboard Is a Metrics Wall, Not a Command Center

**Severity:** High
**File:** `src/routes/org/[slug]/+page.svelte:163-466`

Dashboard layout, top to bottom:
1. Onboarding checklist (first run)
2. Verification Packet (coordination integrity scores)
3. Verification Funnel (imported -> postal -> identity -> district)
4. Engagement Tier Distribution (T0-T4 bars)
5. Campaigns list (cards with status and ring charts)
6. Recent Activity (timeline feed)
7. Endorsed Templates (search + endorse)

**What's wrong:** Seven sections of data with equal visual weight — identical card styling (`rounded-xl bg-surface-base border border-surface-border p-6`). No hierarchy of attention. No urgency. No actionable next step. The page title says "Verification signals for {orgName}" — the word "signals" is passive.

**Design intent (PERCEPTUAL-BRIDGE.md):** "The dashboard's primary surface is the live verification packet. Not email metrics. Not supporter counts. The verification packet — the thing that ships to the decision-maker — dominates the screen. Everything else is secondary."

The spec includes an ASCII mockup showing the verification packet as a large dominant section with `[Preview Report] [Send to Council ->]` as primary CTAs, and everything else as "SECONDARY."

**Impact:** Users glance at the dashboard, see a wall of charts, and navigate to Supporters or Emails because those feel familiar. The dashboard becomes a destination for power users, not the thing that teaches new users why this system matters.

---

## Finding 8: Email Compose Is Mailchimp

**Severity:** High
**File:** `src/routes/org/[slug]/emails/compose/+page.svelte`

The email compose page has: subject line, from name, from email, rich text editor, merge fields, recipient selection, A/B testing toggle. This is Mailchimp. The page title is "Compose Email" with subtitle "Send an email blast to your supporters."

The verification context is a small notice under the editor: "Verification context is structural... a verification density block is appended automatically." This is a compliance footnote, not a differentiating feature.

**Design intent (PERCEPTUAL-BRIDGE.md):** "Email is an invitation to verified action, not a broadcast." The compose UI should show the email with verification context blocks pre-inserted. The org edits surrounding text but cannot remove the verification blocks. The subject line should pre-populate with verification context: "Rent Stabilization — 248 verified, 6 districts."

**What's wrong:** The verification block is invisible until send time. The user composes a generic email, sends it, and never knows their email carried cryptographic proof. The switching cost from Mailchimp feels like zero benefit because the experience is identical.

**Violation of:** Voice guidelines — "No: campaigns, issues, community, platform, solutions, empower." The subtitle says "email blast" and "supporters" — both CRM vocabulary.

---

## Finding 9: The Embed Widget Has Zero Value Proposition

**Severity:** Medium
**File:** `src/routes/org/[slug]/campaigns/[id]/+page.svelte:456-495`

The embed section is a collapsible accordion labeled "Embed Widget" with a code snippet. The description: "Paste this code on your website to embed the campaign action form."

**What's wrong:** "Campaign action form" makes it sound like a Google Form. The embed widget is a verification-intrinsic action surface that creates verifiable supporter commitments. There's no preview of what the widget looks like. No explanation of what happens when someone fills it out. No mention that the widget produces verification-grade actions.

**Impact:** Users either ignore the embed or paste it without understanding it's fundamentally different from embedding a petition form.

---

## Finding 10: Migration Centers CRM Parity, Not New Power

**Severity:** High
**File:** `src/routes/org/[slug]/supporters/import/+page.svelte`

The import screen says "Bring your supporters from anywhere," foregrounds CSV upload, and offers Action Network sync. EveryAction and NationBuilder framed as connectors.

**What's wrong:** Centers "move your list" instead of "unlock verification for your existing supporters." The import completion should immediately show how many supporters can be district-verified — "412 of your 2,000 supporters have postal codes that resolve to districts. Start verification."

**Design intent (PERCEPTUAL-BRIDGE.md):** "The migration is a garden, not a move." The spec describes a visualization where imported dots (empty circles) fill in as supporters verify — a germination metaphor. The current implementation shows a standard import progress bar and a table.

---

## Finding 11: Campaign Creation Is a Form, Not a Mission Briefing

**Severity:** High
**File:** `src/routes/org/[slug]/campaigns/new/+page.svelte`

Four-section form: basics (title, type, description, template), geographic targeting, debate market toggle, submit.

**What's wrong:** No sense that you're assembling a cryptographic proof packet. No preview of what the decision-maker will receive. The debate market toggle says "Enable on-chain debate" with zero context about what on-chain debate means, why you'd want it, or what happens when the threshold is met.

**Design intent (CAMPAIGN-ORCHESTRATION-SPEC.md):** Campaign creation should show resolved targets in real-time as the org narrows scope — "spring-animated count shows how many decision-makers are resolved, how many are still in-flight."

---

## Finding 12: Coalition Networks Feel Like Membership Admin

**Severity:** Medium
**File:** `src/routes/org/[slug]/networks/+page.svelte`, `src/routes/org/[slug]/networks/[networkId]/+page.svelte`

Networks page: pending invitations, accept/decline, active networks. Detail page: member org tables, pending invite tables, invite-by-slug, "Generate Report" button.

**What's wrong:** Coalitions feel like membership management, not live federated proof-building. No visualization of aggregate verification power across the coalition. No sense that joining a network multiplies the weight of every member org's proof packets.

**Design intent (CAMPAIGN-ORCHESTRATION-SPEC.md section 9):** Coalition integration should surface cross-org signal — "Template total: 1,462 verified | Your campaign: 847 verified." The decision-maker should see the coalition's collective weight. The network dashboard should make that weight visible.

---

## Finding 13: Representative Workflow Is Fractured

**Severity:** High
**Files:** `src/routes/org/[slug]/representatives/+page.svelte`, `src/routes/org/[slug]/campaigns/[id]/+page.svelte`

Representative lookup lives on its own page with search/filter and postcode lookup. Campaign creation only captures country/jurisdiction. Campaign detail requires manual decision-maker target entry (name, email, title, district form).

**What's wrong:** The workflow from "who matters here?" to "deliver proof to them" is fractured across three pages. Adding a decision-maker target feels like filling out an address book entry, not establishing a cryptographic delivery channel.

**Design intent (CAMPAIGN-ORCHESTRATION-SPEC.md section 1.3):** Target resolution should be automatic — the org selects scope and office type, and the system resolves targets via the enrichment pipeline. The resolved targets render immediately as the org narrows scope.

---

## The Perceptual Bridge Gap Analysis

PERCEPTUAL-BRIDGE.md defines six things to build. Here's the status of each:

| Design Intent | What Was Built | Gap |
|---------------|---------------|-----|
| **Verification packet assembler** — "the org's primary output, always visible" | VerificationPacket component exists but is one of 7 equal-weight dashboard sections, below onboarding | Packet should dominate the screen. Currently buried in equal-weight card grid. |
| **Invitation composer** — "email that carries verification context structurally" | Email compose page identical to Mailchimp. Verification context is a small notice. | Should show email with verification blocks pre-inserted, verification-aware subject lines, proof density preview. |
| **Segment lens** — "views into protocol-level engagement data" | Standard CRM segment builder (email status, tags, source, verified/unverified toggle). | Should feel like "adjusting a telescope" into cryptographic proof of civic labor. Result panel should explain what tier segments MEAN. |
| **Report shipper** — "the moment the org directs accumulated weight at a decision-maker" | "Preview Report" button below fold, labeled like analytics export. | Should be the most prominent action in the interface. The moment of "shipping the report" should feel consequential. |
| **Migration garden** — "imported supporters germinating into verified constituents" | Standard CSV import with progress bar and table. | Should visualize dots filling in as supporters verify. Growth rate projection. Germination metaphor. |
| **Coalition endorsement** — "shared templates, shared signal, shared credibility" | Endorsement search exists on dashboard. Network pages are membership admin. | Should show aggregate coalition proof weight. Cross-org template signal. Federation visualization. |

---

## Wrong Assumptions About User Behavior

These assumptions are embedded in the current UI and are probably wrong:

1. **"Users will understand VER/POST/IMP badges."** They won't. They'll treat them as generic status indicators, like Salesforce lead scores.

2. **"Users will decode GDS/ALD/temporal entropy."** They won't. Target users measure success in "did the councilmember read our letter," not in coordination scores.

3. **"Users will explore the dashboard to discover features."** They won't. They'll go straight to Supporters and Emails because the navigation tells them that's what this product does.

4. **"Users will click 'Preview Report' to see the proof packet."** They won't. It's below the fold, labeled like an analytics export, positioned after admin controls.

5. **"Users will complete onboarding and understand verification."** They won't. The onboarding teaches CRM workflows: import contacts, send emails.

6. **"Users will experience privacy as a feature."** They won't while staring at contact tables. The interface makes privacy invisible and contact management obvious.

7. **"Adding decision-maker targets feels consequential."** It doesn't. It's a manual form with name/email/title/district fields. No sense of establishing a cryptographic delivery channel.

8. **"Users switching from AN will see the difference."** They won't. They'll see the same CRM patterns with mysterious charts bolted on. Word-of-mouth becomes "it's basically Action Network with extra charts."

---

## Competitive Positioning Failure

| Competitor | Strength | How Commons Should Beat Them | How Commons Currently Competes |
|------------|----------|------------------------------|-------------------------------|
| **Action Network** | Simple, fast (send email in 3 min) | Verification-proof advocacy that AN architecturally cannot provide | Same CRM patterns + mysterious charts |
| **EveryAction** | Enterprise CRM muscle, deep donor management | Not CRM — complement it with verification proof layer | Simpler CRM that can't match EA features |
| **NationBuilder** | Website builder + CRM | Not a website builder — infrastructure for proof delivery | No equivalent offering |
| **Mailchimp** | Best-in-class email composition | Email is a delivery mechanism for proof packets, not the product | Worse email compose UX with a "verification notice" footnote |

The differentiation — verification-intrinsic architecture, cryptographic proof packets, coordination integrity scoring — is completely invisible in the primary interaction patterns. A user comparing Commons to competitors will see: smaller feature set, same CRM workflows, mysterious charts.

---

## The Debate: Kill the Shell vs. Trojan Horse

A structured adversarial debate (3 rounds, Gemini vs. Claude) examined whether to abandon CRM patterns entirely or iterate on the existing shell.

### PRO (Kill the CRM): Key Arguments
- The CRM shell trains the wrong mental model — users will never reach "transcendence" because the interface rewards CRM behavior
- Familiar containers determine the shape of the cargo — you can't deliver revolutionary power inside a management tool
- If Commons looks like Action Network, it will be judged against AN's feature set and lose
- The primary view should be the verification packet, not a contact table

### CON (Keep the Shell): Key Arguments
- Adoption requires familiar patterns — orgs switching from AN need to be productive on day one
- Signal delivered E2E encryption inside an iMessage-looking container; ProtonMail delivered ZK encryption inside Gmail-like UI
- Progressive disclosure: Week 1 familiarity -> Week 3 verification discovery -> Month 2 proof packet delivery -> Month 6 mental model shift
- "Kill the shell" is building for a pre-educated market that doesn't exist yet

### Synthesis: Neither Position Wins Cleanly

The CON is right that familiar patterns reduce switching costs and enable adoption. The PRO is right that the current implementation doesn't work as a Trojan horse because the "soldiers" never emerge — the verification capabilities are buried too deeply to be discovered through normal use.

**The resolution:** Don't kill the shell. Fill it with proof. Every familiar interaction should produce verification-native outcomes that are immediately felt. The contact table can exist — but it shouldn't be the primary view. The email composer can exist — but it should show the proof it carries. The campaign dashboard can exist — but the verification packet should dominate, not the admin form.

The Signal analogy is instructive: Signal looks like iMessage, but when you open a conversation, you see the encryption status. The encryption is not hidden in a settings page. It's surfaced at every interaction point. Commons needs the same approach — familiar patterns that constantly surface the verification substrate.

---

## Abandonment Prediction

Users will leave Commons when:

1. They complete onboarding and think "I just set up another email tool, but worse"
2. They open the dashboard and see seven cards of data they don't understand
3. They go to Supporters and see a contact table less powerful than their current CRM
4. They compose an email and can't find the feature that justifies switching
5. They send a campaign and see coordination integrity scores they can't explain to their board
6. They never click "Preview Report" and never discover the proof packet
7. Their decision-maker ignores the campaign, and the org never knew the proof packet could have been used strategically
8. They tell peers "it's basically Action Network with some extra charts" — killing word-of-mouth

---

## Next: The Redesign Thesis

See [ORG-REDESIGN-THESIS.md](ORG-REDESIGN-THESIS.md) for the concrete redesign direction derived from these findings.
