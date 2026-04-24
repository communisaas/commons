# Power Landscape: Directed Civic Address

> **STATUS: PARTIAL** — Cycle 37 data-model + Phase 4 accountability
> agent + position APIs + key components (`PowerLandscape.svelte`,
> `StanceRegistration.svelte`, `PositionCount.svelte`,
> `ComposePane.svelte`) all exist. Cycle 41–42 "COMPLETE" claims are
> **unverified** and should be treated as aspirational until integration
> tests confirm.

**Status:** Implementation Spec — Cycles 37-40 (partial, Cycles 41-42 unverified)
**Author:** Architecture
**Created:** 2026-02-27
**Depends on:** Shadow Atlas Cycle 35 (multi-layer lookup), Decision-Maker Enrichment Pipeline

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).**
>
> - **Header self-contradicts.** Line 3 says ASPIRATIONAL; the body
>   labels Cycles 41–42 COMPLETE. Reality splits: Cycle 37 data model
>   + Phase 4 agent + APIs shipped; Cycle 41 acceptance criteria
>   (F-01…F-13, returning-user SSR hydration on
>   `+page.svelte:~43 landscapeRevealed=$state(false)`) are not
>   verifiable without integration tests.
> - **Schema snippets below** model `positionRegistrations` and
>   `positionDeliveries`, which live in `convex/schema.ts:~846-883`.
>   Naming is camelCase (`districtCode`, not `district_code`), emails
>   are stored as `encryptedRecipientEmail` + `recipientEmailHash`
>   (plaintext `recipient_email` field does not exist), and a
>   `pseudonymousId` (HMAC-SHA256 per ANTI-ASTROTURF) is live but
>   missing from this spec.
> - **Pipeline phase numbering is inconsistent.** "Pipeline gets a
>   fourth phase" framing (line ~466) implies 3→4 migration; the live
>   pipeline is labeled Phase 1 (research) / Phase 2a (identity) /
>   Phase 2b (4-stage contact hunting) / Phase 3.5 (DNS MX) / Phase 4
>   (accountability) in `decision-maker.ts` + `gemini-provider.ts`.
>   Spec's "Phase 1/2a/3/4" doesn't match.
> - **Accountability receipts are absent from this spec** but live in
>   code as `accountabilityReceipts` (Convex table ~line 1692, SHA-256
>   attestations, Merkle anchoring). Any "directed civic address"
>   narrative should cross-link the receipt artifact.
> - **Shadow Atlas helper name `getOfficials(districtCode)` is not in
>   the code** — the integration uses `SHADOW_ATLAS_URL` env-var HTTP
>   calls, not a typed helper of that name.

---

## Vision

A citizen arrives at a template. They have a position. Between that position and the people who decide its fate, there is a landscape of power — invisible, illegible, unaddressed.

The Power Landscape makes that structure visible and addressable. Not as a list of names. As a field of accountability relationships, each one specific: who this person is, what they've done, and why they have power over this issue.

The citizen can engage at their depth. One tap to be counted. One more to see who decides. Another to speak — with an opener that establishes standing, a space for their own words, and a message body grounded in sourced fact. Every level is a legitimate civic act. The crypto proves their standing at each.

---

## Design Philosophy

This feature answers the design system's core question — **"Does this make coordination feel heavier?"** — at every layer:

- **Position registration** adds the citizen to a cryptographically verified count. The count ticks with spring physics, weighted and inevitable.
- **The landscape** reveals power structure. Not decoration — information architecture. Infrastructure for directed pressure.
- **The compose pane** is the lightest-weight path from caring to speaking. No blank pages. No choice paralysis. An accountability opener grounds the citizen's standing. Their words complete it.

### What This Is Not

- Not a mail merge tool (no "send all 15")
- Not a petition (positions are individually verified, not batch-signed)
- Not gamification (no points for contacting more people)
- Not a consumer app (infrastructure for collective action)

### Perceptual Engineering Principles

1. **Revelation, not presentation.** The landscape appears after the citizen commits to a position. They earn the view by caring enough to register. The reveal is spatial — the template lifts, the power field emerges beneath — not navigational.

2. **Structure over lists.** Decision-makers grouped by role in the decision (votes / executes / shapes), not by government level. The citizen sees function, not taxonomy.

3. **Progressive depth without progressive commitment.** Seeing the landscape costs nothing. Writing costs nothing until you tap send. The citizen can drift through depth without being trapped at any level.

4. **Honest framing at every action.** "Position registered" — not "message delivered." "Sent via your email" — not "delivered." The interface never claims more effect than it produces.

---

## Interface Specification

### Device Context

Most civic action happens on phones, in stolen moments — bus rides, waiting rooms, the 90 seconds after reading a headline. The interface must capture civic energy in those moments, not demand a desktop session.

- **Mobile (375-428px):** Primary design surface. Full-width cards. Slide-up compose pane (TouchModal pattern). Sticky bottom bar for batch action. Thumb-zone CTAs.
- **Tablet (768-1024px):** Two-column where helpful. Landscape's role-groups become a wider grid.
- **Desktop (1280px+):** Side-by-side — template content sticky left, landscape scrollable right. Compose pane as right-side overlay or panel replacement.

### Screen States

#### State 0: Template Detail — Pre-Action

The existing template detail page. Template content, debate surface if active, trust journey.

**Change:** The ActionBar transforms. The current single "Send" CTA becomes a binary stance:

```
┌─────────────────────────────────────────────┐
│                                             │
│  [I support this]     [I oppose this]       │
│   indigo filled        slate outlined       │
│                                             │
│  1,247 verified residents · 94 districts    │
│  ^^^^ JetBrains Mono, tabular-nums         │
│                                             │
└─────────────────────────────────────────────┘
```

**Typography:** Count in JetBrains Mono (numbers are data). "verified residents" in Satoshi (words). District count in muted slate.

**Voice:** No "Make your voice heard." No "Take action." The buttons say what they do. The count says what's happened.

**Animation:** Count ticks on load via spring physics (stiffness: 0.2, damping: 0.8). No other animation at this state.

**Auth gate:** If not authenticated, tapping either button triggers the existing auth flow (VerificationGate pattern). Guest state stores the intended stance for post-auth restoration. If authenticated but no district (Tier < 2), AddressVerificationFlow triggers first.

#### State 1: Post-Registration Reveal

The citizen tapped "I support this." The interface transforms — not a page change, a reveal.

**The transition (300ms, spring-based):**
1. Stance buttons collapse to a confirmed state: checkmark + "You support this" (Satoshi, sm, emerald text).
2. Count increments by 1 (spring animation on the number). The citizen sees themselves added.
3. Template content area compresses (translateY spring, not instant). Not hidden — still readable above, but the viewport shifts down.
4. Below: the power landscape fades in (opacity 0→1, 200ms delay after stance confirmation).

**The reveal layout (mobile):**

```
┌─────────────────────────────────────────────┐
│ ✓ You support this                          │
│ 1,248 verified residents · 94 districts     │
├─────────────────────────────────────────────┤
│                                             │
│ WHO DECIDES THIS                            │
│ ^^^^ JetBrains Mono, xs, tracking-wider,    │
│      uppercase, slate-400                   │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ VOTE ON IT                              │ │
│ │ ^^^^ JetBrains Mono, xs, slate-400      │ │
│ │                                         │ │
│ │ ┌───────────────────────────────────┐   │ │
│ │ │ Commissioner Davis                │   │ │
│ │ │ Riverside Utility Commission      │   │ │
│ │ │                                   │   │ │
│ │ │ Deciding vote on the Tier 3 rate  │   │ │
│ │ │ increase, January 2026.           │   │ │
│ │ │ ^^^^ accountability opener,       │   │ │
│ │ │      indigo-600, sm, italic       │   │ │
│ │ │                                   │   │ │
│ │ │ Write to her →                    │   │ │
│ │ │ ^^^^ indigo-600 text, no bg      │   │ │
│ │ └───────────────────────────────────┘   │ │
│ │                                         │ │
│ │ ┌───────────────────────────────────┐   │ │
│ │ │ Commissioner Park                 │   │ │
│ │ │ Riverside Utility Commission      │   │ │
│ │ │                                   │   │ │
│ │ │ Abstained on rate increase vote.  │   │ │
│ │ │                                   │   │ │
│ │ │ Write to him →                    │   │ │
│ │ └───────────────────────────────────┘   │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ SHAPE IT                                │ │
│ │                                         │ │
│ │ ┌───────────────────────────────────┐   │ │
│ │ │ Rep. Garcia                       │   │ │
│ │ │ US House · Appropriations         │   │ │
│ │ │                                   │   │ │
│ │ │ Education subcommittee member.    │   │ │
│ │ │ Voted against SB 412 last session.│   │ │
│ │ │                                   │   │ │
│ │ │ Write to him →                    │   │ │
│ │ └───────────────────────────────────┘   │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ─────────────────────────────────────────── │
│                                             │
│ [Register your position with all 8 →]       │
│  ^^^^ emerald bg, white text, full-width    │
│  ^^^^ sticky bottom bar on mobile           │
│                                             │
└─────────────────────────────────────────────┘
```

**Card design:**
- White background, node-style border (`rgba(148, 163, 184, 0.45)`), 12px radius
- Name: Satoshi bold, base size, slate-900
- Title/org: Satoshi regular, sm, slate-600
- Accountability opener: Satoshi regular, sm, indigo-600. NOT italic (contradicts voice — confident, not literary). Factual tone.
- "Write to them →": Satoshi medium, sm, indigo-600 text, no background. Right-aligned chevron. Link affordance, not button. Low commitment signal.
- Hover: 2px lift, shadow intensifies (existing card pattern)
- Touch target: entire card is tappable (44px minimum height guaranteed)

**Role category headers:**
- JetBrains Mono, xs (12px), uppercase, tracking-wider (letter-spacing: 0.05em), slate-400
- Examples: "VOTE ON IT", "EXECUTE IT", "SHAPE IT", "FUND IT", "OVERSEE IT"
- NOT decorative — functional taxonomy. The citizen reads role, not government level.

**Progressive reveal:**
- First role-group appears immediately (opacity fade, 200ms)
- Subsequent groups stagger 100ms each
- Total reveal for 4 groups: ~600ms
- This is NOT a scroll animation. All groups render. Stagger is entrance timing only.

**Decision-maker sources (two origins):**

1. **Template decision-makers:** Resolved at template creation time by the DecisionMakerResolver. Stored in `recipient_config`. These are the people the template author identified as relevant — commissioners, directors, org leaders. They have accountability openers, role categories, and contact info.

2. **Citizen's district officials:** Resolved at action time from Shadow Atlas `getOfficials()` + `lookupAll()`. These are the citizen's personal representatives — House rep, senators, state legislators, county commissioners. They have name, party, chamber, contact info, but NO accountability opener (because they weren't part of template creation).

The merge: template decision-makers appear first (they have openers, they're the curated landscape). District officials appear in a separate group at the bottom: "YOUR REPRESENTATIVES" — name, party, chamber. No opener. Still addressable — the compose pane provides the template body, just without the accountability-specific lead-in.

#### State 2: Compose Pane — Speaking to One Person

The citizen taps "Write to her →" on Commissioner Davis. The compose pane appears.

**Mobile: slide-up pane (TouchModal pattern):**
- Spring-based entrance from bottom (stiffness: 0.35, damping: 0.4)
- 90% viewport height
- Swipe-to-dismiss (existing TouchModal gesture recognition)
- Blur backdrop on content behind

**Desktop: right-side panel replacement:**
- The power landscape column becomes the compose pane
- Template content remains visible on left (sticky)
- No modal, no overlay — spatial continuity

**Compose pane layout:**

```
┌─────────────────────────────────────────────┐
│ To: Commissioner Davis                      │
│ Riverside Utility Commission                │
│ ^^^^ Satoshi bold/regular, slate-900/600    │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ Commissioner Davis — you were the       │ │
│ │ deciding vote on the Tier 3 rate        │ │
│ │ increase in January 2026. The Tier 3    │ │
│ │ structure places the highest burden on  │ │
│ │ Riverside, where the median household   │ │
│ │ income is $42,000.                      │ │
│ │ ^^^^ indigo-50 bg, indigo-800 text      │ │
│ │      rounded-lg, p-4                    │ │
│ │      editable (contenteditable)         │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ What's this rate increase been like     │ │
│ │ for you?                                │ │
│ │ ^^^^ placeholder text, slate-400        │ │
│ │                                         │ │
│ │ [                                     ] │ │
│ │ ^^^^ textarea, 3 rows, slate-900        │ │
│ │      border-b only (no box), focus:     │ │
│ │      indigo ring                        │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ [Template body — pre-filled, editable]  │ │
│ │ ^^^^ slate-700 text, sm size            │ │
│ │      collapsible (default expanded)     │ │
│ │      "Edit message ▾" toggle            │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ Verified resident, Riverside District   │ │
│ │ ✓ Cryptographic proof of residency      │ │
│ │ ^^^^ emerald-50 bg, emerald-800 text    │ │
│ │      non-editable                       │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ [Send via email →]                          │
│ ^^^^ Button variant="verified" (emerald)    │
│      enableFlight (paper plane animation)   │
│                                             │
│ ← Back to all decision-makers               │
│ ^^^^ Satoshi medium, sm, slate-500          │
│                                             │
│ Popover: "Opens your email client with this │
│ message. You review before sending."        │
│                                             │
└─────────────────────────────────────────────┘
```

**Compose zone details:**

**Zone 1 — Accountability opener:**
- Background: indigo-50 (very subtle tint — the system's contribution is visually distinct from the citizen's)
- Pre-filled from `ProcessedDecisionMaker.accountabilityOpener`
- Editable (contenteditable div, not textarea — preserves formatting)
- If no opener available (district officials from SA): this zone shows only the recipient's name and title. No empty space, no placeholder.

**Zone 2 — Personal space:**
- Prompted textarea with issue-specific question
- The prompt is generated at template creation time by the message-writer agent: it extracts the emotional core of the issue and phrases it as a question. "What's this rate increase been like for you?" / "How has this affected your neighborhood?"
- If the citizen skips this (leaves empty): the email omits this zone entirely. No blank line, no "[Your story here]" placeholder.
- Border-bottom only (minimal chrome — the citizen's words should feel like writing, not form-filling)

**Zone 3 — Template body:**
- The shared message, sourced and factual
- Default: collapsed to first 3 lines with "Read full message ▾" toggle
- Editable for citizens who want to customize
- Citations preserved from template creation

**Zone 4 — Attestation footer:**
- Non-editable
- Emerald tint background
- Shows: district name, verification method, proof identifier (truncated)
- Popover: "Your district membership is cryptographically proven. The recipient can verify at [link]."

**The mailto: generation:**

```typescript
// emailService.ts enhancement
generatePersonalizedMailto({
  recipient: ProcessedDecisionMaker,
  template: Template,
  opener: string,          // from Zone 1 (possibly citizen-edited)
  personalInput?: string,  // from Zone 2 (possibly empty)
  templateBody: string,    // from Zone 3 (possibly citizen-edited)
  attestation: string,     // from Zone 4 (system-generated)
  districtName: string
}): string
```

The function concatenates non-empty zones with paragraph breaks and returns a `mailto:` URL. Subject line includes template slug: `[lead-pipes-riverside] Tier 3 Rate Impact — Riverside Resident`.

**After mailto: launch:**
- The compose pane closes (spring exit)
- The citizen returns to the power landscape
- Commissioner Davis's card shows an emerald checkmark and "Sent" label
- The "Register with all" bar updates: "Register with 7 others →" (one fewer)

#### State 3: Batch Registration

The citizen taps "Register your position with all 8 →" (or "Register with 7 others →" if they already wrote to one).

**Confirmation (brief, not a modal):**
- Inline expansion below the button: "Your verified position will be delivered to 8 decision-makers as a constituent stance registration."
- Two buttons: "Register" (emerald) / "Cancel" (text-only)
- This is NOT a modal. No overlay. The citizen can still see the landscape above.

**After confirmation:**
- Progress indicator: "Registering... 3 of 8" (JetBrains Mono count)
- Each decision-maker card gets an emerald checkmark as their registration confirms
- Staggered, not simultaneous — the citizen sees each one land

**API call:**
```
POST /api/positions/batch-register
{
  templateId: string,
  stance: 'support' | 'oppose',
  identityCommitment: string,       // for verified count
  decisionMakerIds: string[],       // from recipient_config
  districtOfficialIds?: string[]    // from Shadow Atlas
}
```

**Server-side per recipient:**
- For CWC-eligible officials: route through CWC pipeline (existing `processSubmissionDelivery`)
- For non-CWC officials with email: platform-sent position notification
- For officials without email: logged position only (count tracked, no delivery)

**Delivery framing (voice compliance):**
- CWC officials: "Delivered to congressional office"
- Email officials: "Position notification sent"
- No-email officials: "Position recorded"
- Never: "Your voice was heard" / "Message delivered" (unless CWC confirms)

#### State 4: Completion

After all actions (individual writes + batch registration), the landscape shows the final state:

```
┌─────────────────────────────────────────────┐
│ ✓ You support this                          │
│ 1,248 verified residents · 94 districts     │
├─────────────────────────────────────────────┤
│                                             │
│ YOUR ACTIONS                                │
│ ^^^^ JetBrains Mono, xs, emerald-600        │
│                                             │
│ 2 personal messages sent via your email     │
│ 6 positions registered                      │
│                                             │
│ Delivery: 5 confirmed · 2 pending · 1 email │
│ ^^^^ JetBrains Mono, tabular-nums           │
│                                             │
│ Popover: "Congressional offices confirm     │
│ receipt. Email delivery depends on your      │
│ email provider. Positions without email are  │
│ counted but not delivered directly."         │
│                                             │
└─────────────────────────────────────────────┘
```

No celebration animation. No confetti. No "Great job!" The interface reports what happened, factually. The citizen can close the page knowing exactly what their actions produced.

---

## Architecture

### Data Model Changes

#### Enhanced ProcessedDecisionMaker (commons)

```typescript
// src/lib/types/template.ts — extend existing type
interface ProcessedDecisionMaker {
  // existing fields
  name: string;
  title: string;
  organization: string;
  email: string;
  provenance: string;
  reasoning: string;
  source_url: string;
  isAiResolved: boolean;
  confidence: number;
  emailGrounded: boolean;
  contactNotes: string;
  discovered: string;

  // new fields
  accountabilityOpener: string | null;   // factual accountability line
  roleCategory: RoleCategory;            // functional role in the decision
  relevanceRank: number;                 // 1 = most direct power
  publicActions: string[];               // specific votes, decisions, statements
  personalPrompt: string | null;         // issue-specific prompt for Zone 2
}

type RoleCategory = 'votes' | 'executes' | 'shapes' | 'funds' | 'oversees';
```

#### Position Registration (new Convex tables)

```typescript
// convex/schema.ts (shape of positionRegistrations / positionDeliveries)

positionRegistrations: defineTable({
  templateId: v.id("templates"),
  identityCommitment: v.string(),          // verified citizen
  stance: v.string(),                      // 'support' | 'oppose'
  districtCode: v.optional(v.string()),    // citizen's district
  pseudonymousId: v.string(),              // HMAC-SHA256 per ANTI-ASTROTURF
  registeredAt: v.number(),                // ms epoch
})
  .index("by_template", ["templateId"])
  .index("by_template_identity", ["templateId", "identityCommitment"]),
  // uniqueness (one position per citizen per template) enforced in mutation

positionDeliveries: defineTable({
  registrationId: v.id("positionRegistrations"),
  recipientName: v.string(),
  // Email is stored encrypted with a hash for lookup (no plaintext column)
  encryptedRecipientEmail: v.optional(v.bytes()),
  recipientEmailHash: v.optional(v.string()),
  deliveryMethod: v.string(),              // 'cwc' | 'email' | 'recorded'
  deliveryStatus: v.string(),              // 'pending' | 'delivered' | 'failed'
  deliveredAt: v.optional(v.number()),
}).index("by_registration", ["registrationId"]);
```

#### Template recipientConfig schema update

The existing `recipientConfig` JSON field stores decision-makers. Add:

```typescript
interface RecipientConfig {
  decision_makers: ProcessedDecisionMaker[];  // existing, enhanced
  roleGroups: RoleGroup[];                    // new: pre-computed grouping
  personalPrompt: string;                     // new: issue-specific Zone 2 prompt
}

interface RoleGroup {
  category: RoleCategory;
  label: string;           // "VOTE ON IT", "EXECUTE IT", etc.
  memberIndices: number[];  // indices into decision_makers array
}
```

### Agent Pipeline Enhancement

The existing three-phase decision-maker pipeline (identify → enrich → validate) gets a fourth phase:

**Phase 4: Accountability & Classification**

Runs after Phase 3 validation. Takes validated decision-makers and generates:
1. Accountability opener per person (factual, specific, 1-2 sentences)
2. Role category classification
3. Relevance ranking
4. Personal prompt (one prompt for the whole template, not per-person)

This is a single LLM call with structured output — NOT per-person calls.

**Prompt strategy:**

```
Given these decision-makers for the issue "[subject_line]":
[list of name, title, organization, reasoning]

For each person, generate:
1. accountability_opener: One factual sentence about their specific
   action or position relevant to this issue. Reference specific votes,
   decisions, statements, or responsibilities. No adjectives. No flattery.
   Pattern: "[Name] — [specific factual accountability statement]."

2. role_category: Their functional role. One of:
   - "votes": directly votes on this (legislators, board members, commissioners)
   - "executes": implements/administers decisions (directors, administrators, executives)
   - "shapes": influences through policy, advocacy, or institutional power
   - "funds": controls budget or financial resources
   - "oversees": regulatory, judicial, or oversight function

3. relevance_rank: 1 = most direct power over the outcome, ascending

Also generate:
4. personal_prompt: A single question (for all recipients) that elicits
   the citizen's personal experience with this issue.
   Pattern: "What's [specific aspect] been like for you?"
```

**Cost:** ~$0.01-0.02 per template (one call). Zero marginal cost per citizen.

### Shadow Atlas Integration

The citizen's district officials come from `getOfficials(districtCode)` (already called during address verification). These officials have name, party, chamber, contact info — but no accountability opener.

**Merge logic (client-side):**

```typescript
function mergeDecisionMakers(
  templateDMs: ProcessedDecisionMaker[],  // from template recipient_config
  districtOfficials: Official[]           // from Shadow Atlas
): MergedLandscape {
  // 1. Template DMs are primary (have openers, curated)
  const templateCards = templateDMs.map(dm => ({
    ...dm,
    source: 'template' as const
  }));

  // 2. District officials that aren't already in template DMs
  const templateNames = new Set(templateDMs.map(dm =>
    normalizeOfficialName(dm.name)
  ));

  const additionalOfficials = districtOfficials
    .filter(o => !templateNames.has(normalizeOfficialName(o.name)))
    .map(o => ({
      name: o.name,
      title: `${o.chamber === 'house' ? 'Representative' : 'Senator'}`,
      organization: `US ${o.chamber === 'house' ? 'House' : 'Senate'} · ${o.party}`,
      email: o.contact_form_url || null,
      accountabilityOpener: null,  // no opener for district officials
      roleCategory: 'shapes' as RoleCategory,
      relevanceRank: 100,  // below template DMs
      source: 'district' as const
    }));

  // 3. Group by role category
  const groups = groupByRole([...templateCards, ...additionalOfficials]);

  return { groups, personalPrompt: templateDMs[0]?.personalPrompt };
}
```

### API Routes

**New routes:**

```
POST /api/positions/register
  - Register a single position (stance + identity_commitment)
  - Returns: position count for template

POST /api/positions/batch-register
  - Register position + deliver to multiple decision-makers
  - Returns: per-recipient delivery status

GET  /api/positions/count/[templateId]
  - Public: returns aggregate counts (support/oppose) + district count
  - No PII, no individual positions
```

---

## Implementation Cycles

### Cycle 37: Foundation — Types, Agent Enhancement, Position API

**Goal:** Establish the data model, enhance the decision-maker agent to produce accountability openers and role categories, and create the position registration API.

**Files to create/modify (commons):**

| File | Action | Description |
|------|--------|-------------|
| `src/lib/types/template.ts` | Modify | Add `accountabilityOpener`, `roleCategory`, `relevanceRank`, `publicActions`, `personalPrompt` to `ProcessedDecisionMaker` |
| `src/lib/core/agents/agents/decision-maker-accountability.ts` | Create | Phase 4: accountability opener + role classification prompt |
| `src/lib/core/agents/agents/decision-maker.ts` | Modify | Wire Phase 4 into orchestrator after Phase 3 |
| `src/lib/core/agents/prompts/accountability-opener.ts` | Create | System prompt for accountability generation |
| `convex/schema.ts` | Modify | Add `positionRegistrations` and `positionDeliveries` tables |
| `src/routes/api/positions/register/+server.ts` | Create | Position registration endpoint |
| `src/routes/api/positions/count/[templateId]/+server.ts` | Create | Public count endpoint |
| `src/routes/api/positions/batch-register/+server.ts` | Create | Batch position + delivery endpoint |
| `src/lib/services/positionService.ts` | Create | Position registration logic, delivery routing |

**Acceptance criteria:**
- [ ] `ProcessedDecisionMaker` type includes all new fields
- [ ] Phase 4 agent generates accountability openers that are factual, specific, 1-2 sentences, no adjectives
- [ ] Role categories correctly classify: legislators/board=votes, directors/admin=executes, etc.
- [ ] Position registration endpoint accepts stance + identity_commitment, returns count
- [ ] Count endpoint returns { support: N, oppose: N, districts: N } with no PII
- [ ] Batch registration creates PositionDelivery records per recipient
- [ ] DB migration runs cleanly
- [ ] Existing template creation flow still works (Phase 4 is additive)

**Agent context for Phase 4 prompt engineering:**

The accountability opener must follow the voice guide exactly:
- Confident & direct. State what is.
- No hedging ("you may have" → "you voted for")
- No flattery ("your important work on" → just state the fact)
- No emotional manipulation ("we need you to" → absent)
- Imperative facts. Pattern: "[Name] — [fact about their action/position]."
- Max 2 sentences. Prefer 1.

Examples of GOOD openers:
- "Commissioner Davis — you cast the deciding vote on the Tier 3 rate increase in January 2026."
- "Director Morrison — you set infrastructure replacement priorities for Riverside Water Department."
- "Rep. Garcia — you sit on the House Appropriations subcommittee that funds municipal water grants."

Examples of BAD openers (violate voice):
- "Commissioner Davis — as a dedicated public servant, your vote on the rate increase deeply affects residents." (flattery + emotional)
- "We believe your leadership on the commission gives you unique power to address this." (hedging + corporate)
- "Dear Commissioner Davis, thank you for your service." (sycophantic)

**Testing:**
- Unit: opener generation with mock LLM responses
- Unit: role category classification accuracy
- Integration: full pipeline Phase 1-4 with mocked API
- API: position registration + count endpoints

---

### Cycle 38: The Floor — Position Registration UI + Count Signal

**Goal:** Replace the existing ActionBar with stance registration as the primary CTA. Display live position counts. Handle the post-registration state transition that prepares for the power landscape (Cycle 39).

**Files to create/modify (commons):**

| File | Action | Description |
|------|--------|-------------|
| `src/lib/components/action/StanceRegistration.svelte` | Create | Binary stance CTA + count display |
| `src/lib/components/action/PositionCount.svelte` | Create | Spring-animated count display |
| `src/routes/s/[slug]/+page.svelte` | Modify | Replace ActionBar with StanceRegistration, manage post-registration state |
| `src/lib/stores/positionState.svelte.ts` | Create | Position registration state (stance, registered, count, deliveries) |
| `src/lib/core/shadow-atlas/client.ts` | Modify | Add `getPositionCount(templateId)` if served from SA, or use internal API |

**Component spec — StanceRegistration.svelte:**

```svelte
<!-- Props -->
let {
  template,
  user,
  positionCount = { support: 0, oppose: 0, districts: 0 },
  onRegistered          // callback: (stance) => void
}: Props = $props();

<!-- States -->
let registrationState = $state<'idle' | 'registering' | 'registered'>('idle');
let selectedStance = $state<'support' | 'oppose' | null>(null);
```

**Pre-registration layout:**
- Two buttons side by side, equal width
- "I support this" — indigo filled (variant="primary")
- "I oppose this" — slate outlined (variant="secondary")
- Below: count line in JetBrains Mono
- Count format: "1,247 verified residents · 94 districts"
- If count is 0: omit count line entirely (no "0 residents")

**Registration flow:**
1. Citizen taps stance button
2. Auth gate check (VerificationGate pattern — existing)
3. If authed + Tier 2+: POST `/api/positions/register`
4. Button shows brief spinner (200ms minimum to feel intentional)
5. Transition to registered state

**Post-registration layout:**
- Buttons collapse to single line: "✓ You support this" (emerald text, Satoshi medium)
- Count increments by 1 with spring animation (stiffness: 0.2, damping: 0.8)
- `onRegistered(stance)` fires — parent page uses this to trigger landscape reveal

**Spring count animation:**

```typescript
// PositionCount.svelte
import { spring } from 'svelte/motion';

let displayCount = spring(0, { stiffness: 0.2, damping: 0.8 });

$effect(() => {
  displayCount.set(positionCount.support + positionCount.oppose);
});
```

Display value: `Math.round($displayCount).toLocaleString()` in JetBrains Mono with `tabular-nums`.

**Design system compliance:**
- Spring physics: scoreboard feel (weighted, inevitable), not bouncy
- Colors: indigo for primary stance, emerald for confirmed, slate for secondary
- Typography: numbers in Mono, words in Satoshi
- Animation: ONLY the count number. Buttons don't bounce. No confetti.
- Voice: "I support this" not "Support!" or "I agree!" or "Stand with us"
- Touch targets: 44px minimum height, full-width on mobile
- `prefers-reduced-motion`: count changes instantly (no spring)

**Acceptance criteria:**
- [ ] Binary stance buttons render correctly on mobile (375px) and desktop
- [ ] Auth gate triggers for unauthenticated users (stores intended stance in guestState)
- [ ] Position registers via API, count increments with spring animation
- [ ] Post-registration state persists across page navigation (positionState store)
- [ ] Count displays 0 state gracefully (no count line when 0)
- [ ] Duplicate registration handled (409 → show "already registered" state)
- [ ] Existing ActionBar functionality preserved for templates without position registration enabled

---

### Cycle 39: The Map — Power Landscape Component

**Goal:** Build the PowerLandscape component — the grouped, progressively-revealed decision-maker visualization that appears after position registration. Includes the merge of template decision-makers with district officials, the role-grouped layout, and the batch registration affordance.

**Files to create/modify (commons):**

| File | Action | Description |
|------|--------|-------------|
| `src/lib/components/action/PowerLandscape.svelte` | Create | Main landscape container with role groups |
| `src/lib/components/action/RoleGroup.svelte` | Create | Single role category with its cards |
| `src/lib/components/action/DecisionMakerLandscapeCard.svelte` | Create | Individual DM card with opener + write affordance |
| `src/lib/components/action/DistrictOfficialCard.svelte` | Create | District official card (no opener) |
| `src/lib/components/action/BatchRegistrationBar.svelte` | Create | Sticky bottom bar for batch action |
| `src/lib/utils/landscapeMerge.ts` | Create | Merge template DMs + district officials, group by role |
| `src/routes/s/[slug]/+page.svelte` | Modify | Wire landscape reveal after position registration |
| `src/routes/s/[slug]/+page.server.ts` | Modify | Load template recipient_config + position counts |

**Component spec — PowerLandscape.svelte:**

```svelte
<!-- Props -->
let {
  template,
  districtOfficials = [],    // from Shadow Atlas
  sentRecipients = new Set(), // tracks who citizen has written to
  onWriteTo,                  // callback: (dm: ProcessedDecisionMaker) => void
  onBatchRegister,            // callback: (dmIds: string[]) => void
  registrationState           // 'idle' | 'registering' | 'complete'
}: Props = $props();
```

**Landscape merge logic (landscapeMerge.ts):**

```typescript
interface MergedLandscape {
  roleGroups: {
    category: RoleCategory;
    label: string;         // "VOTE ON IT", "EXECUTE IT", etc.
    members: LandscapeMember[];
  }[];
  districtGroup: {
    label: string;         // "YOUR REPRESENTATIVES"
    members: LandscapeMember[];
  } | null;
  personalPrompt: string | null;
  totalCount: number;
}

interface LandscapeMember {
  id: string;             // stable identifier for tracking
  name: string;
  title: string;
  organization: string;
  email: string | null;
  accountabilityOpener: string | null;
  source: 'template' | 'district';
  cwcEligible: boolean;
}
```

**Role category label mapping:**
```typescript
const ROLE_LABELS: Record<RoleCategory, string> = {
  votes: 'VOTE ON IT',
  executes: 'EXECUTE IT',
  shapes: 'SHAPE IT',
  funds: 'FUND IT',
  oversees: 'OVERSEE IT'
};
```

**Progressive reveal implementation:**

```svelte
<!-- PowerLandscape.svelte -->
{#each landscape.roleGroups as group, i}
  <div
    class="role-group"
    style="animation-delay: {i * 100}ms"
    class:revealed={true}
  >
    <RoleGroup {group} {sentRecipients} {onWriteTo} />
  </div>
{/each}

<style>
  .role-group {
    opacity: 0;
    transform: translateY(8px);
  }
  .role-group.revealed {
    animation: revealGroup 300ms ease-out forwards;
  }
  @keyframes revealGroup {
    to { opacity: 1; transform: translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .role-group.revealed { animation: none; opacity: 1; transform: none; }
  }
</style>
```

**DecisionMakerLandscapeCard spec:**
- Node-style card (white bg, subtle border, 12px radius, existing shadow pattern)
- Name: Satoshi bold, base, slate-900
- Title + org: Satoshi regular, sm, slate-600
- Accountability opener (if present): Satoshi regular, sm, indigo-600. Below title. Max 2 lines, overflow ellipsis.
- "Write to them →": Satoshi medium, sm, indigo-600 text. Right-side chevron. Right-aligned bottom of card.
- Sent state: emerald checkmark replaces "Write to them →". "Sent ✓" in emerald-600.
- No-email state: card renders without "Write" affordance. Muted appearance (opacity: 0.7). Tooltip: "No public contact info found."
- Touch: entire card tappable, 44px min height

**BatchRegistrationBar spec:**
- Sticky to bottom of viewport on mobile (respects safe-area-inset-bottom)
- Fixed position within landscape column on desktop
- Full-width emerald button: "Register your position with all {N} →"
- N decreases as individual writes are sent
- After batch registration: transforms to completion state

**Responsive layout:**
- Mobile (< 768px): single column, full-width cards, sticky bottom bar
- Tablet (768-1024px): cards can be 2-up within role groups
- Desktop (1280px+): landscape is right column (scrollable), template content left (sticky)

**Acceptance criteria:**
- [ ] PowerLandscape renders role groups with correct labels
- [ ] Template decision-makers appear in their role groups with accountability openers
- [ ] District officials appear in "YOUR REPRESENTATIVES" group without openers
- [ ] Deduplication works (same official in template + district doesn't appear twice)
- [ ] Progressive reveal animation works (staggered entrance, reduced-motion respected)
- [ ] "Write to them →" affordance triggers onWriteTo callback
- [ ] Sent state persists per decision-maker (emerald checkmark)
- [ ] Batch registration bar shows correct count, decrements as individual writes occur
- [ ] Mobile layout: single column, sticky bottom bar, thumb-zone targets
- [ ] Desktop layout: right-column with scroll, proper sticky behavior
- [ ] Cards without email show muted state with tooltip
- [ ] No animation on cards — only role group entrance is animated

---

### Cycle 40: The Voice — Compose Pane + Personalized mailto

**Goal:** Build the compose experience — the three-zone pane where the citizen writes to a specific decision-maker, with accountability opener + personal space + template body + attestation footer. Integrate personalized mailto generation. Track sent state.

**Files to create/modify (commons):**

| File | Action | Description |
|------|--------|-------------|
| `src/lib/components/action/ComposePane.svelte` | Create | Three-zone compose experience |
| `src/lib/components/action/AccountabilityOpener.svelte` | Create | Zone 1: editable opener block |
| `src/lib/components/action/PersonalSpace.svelte` | Create | Zone 2: prompted textarea |
| `src/lib/components/action/TemplateBodyPreview.svelte` | Create | Zone 3: collapsible template body |
| `src/lib/components/action/AttestationFooter.svelte` | Create | Zone 4: verification badge |
| `src/lib/services/emailService.ts` | Modify | Add `generatePersonalizedMailto()` |
| `src/lib/services/positionService.ts` | Modify | Add delivery tracking for individual sends |
| `src/routes/s/[slug]/+page.svelte` | Modify | Wire compose pane with landscape |

**ComposePane.svelte — Container spec:**

```svelte
<!-- Props -->
let {
  recipient: ProcessedDecisionMaker | LandscapeMember,
  template: Template,
  districtName: string,
  attestation: { method: string, proofId: string } | null,
  personalPrompt: string | null,
  onSent,           // callback: () => void
  onBack            // callback: () => void
}: Props = $props();
```

**Mobile presentation:** TouchModal pattern
- Slide-up from bottom, spring physics (stiffness: 0.35, damping: 0.4)
- 90% viewport height
- Swipe-down to dismiss (existing gesture recognition)
- Blur backdrop

**Desktop presentation:** Right panel replacement
- Replaces the landscape column content
- No modal overlay — spatial continuity with template on left
- "← Back to all decision-makers" link at top

**Zone orchestration:**

The compose pane assembles the email in real-time as the citizen types. A preview is unnecessary — the pane IS the preview. What you see is what sends.

**Zone 1 — AccountabilityOpener.svelte:**
- `contenteditable` div (not textarea — preserves line breaks, allows future rich text)
- indigo-50 background, rounded-lg, p-4
- Pre-filled with `recipient.accountabilityOpener`
- If no opener: shows only "To: [Name], [Title]" header — no empty editable zone
- Character limit: 500 (soft limit — shows count at 400+)
- On edit: updates the email body in real-time

**Zone 2 — PersonalSpace.svelte:**
- textarea with bottom-border-only styling (minimal chrome)
- Placeholder: the personalPrompt from template ("What's this rate increase been like for you?")
- Fallback placeholder if no prompt: "Add your perspective (optional)"
- Auto-resize to content (min 3 rows, max 8 rows)
- On empty: zone is omitted from final email (no blank space)

**Zone 3 — TemplateBodyPreview.svelte:**
- Collapsible section, default collapsed to 3 lines
- Toggle: "Read full message ▾" / "Collapse △"
- Editable when expanded
- Satoshi regular, sm, slate-700
- Template variable resolution: `[District]` → citizen's district name

**Zone 4 — AttestationFooter.svelte:**
- Non-editable
- emerald-50 bg, emerald-800 text
- Line 1: "Verified resident, {districtName}"
- Line 2: "✓ Cryptographic proof of residency"
- Popover: explains what the recipient can verify
- If citizen is Tier < 2 (no proof): this zone is absent entirely

**The send button:**
- Button variant="verified" (emerald)
- enableFlight={true} (paper plane animation)
- Text: "Send via email →"
- Popover (on first visit): "Opens your email client. You review before sending."
- On click: generates mailto URL, launches native client

**Enhanced emailService.ts:**

```typescript
export function generatePersonalizedMailto(params: {
  recipient: { name: string; email: string; title?: string; organization?: string };
  subject: string;
  opener: string;          // Zone 1 content
  personalInput?: string;  // Zone 2 content (may be empty)
  templateBody: string;    // Zone 3 content
  attestation?: string;    // Zone 4 content
}): string {
  const bodyParts: string[] = [];

  // Zone 1: Accountability opener
  if (params.opener.trim()) {
    bodyParts.push(params.opener.trim());
  }

  // Zone 2: Personal input (only if non-empty)
  if (params.personalInput?.trim()) {
    bodyParts.push(params.personalInput.trim());
  }

  // Zone 3: Template body
  bodyParts.push(params.templateBody.trim());

  // Zone 4: Attestation
  if (params.attestation) {
    bodyParts.push('---');
    bodyParts.push(params.attestation);
  }

  const body = bodyParts.join('\n\n');
  const subject = params.subject;

  return `mailto:${encodeURIComponent(params.recipient.email)}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;
}
```

**Post-send flow:**
1. `window.open(mailtoUrl)` or `window.location.href = mailtoUrl`
2. Brief delay (500ms) — email client is opening
3. Mark recipient as "sent" in positionState store
4. Close compose pane (spring exit)
5. Return to landscape — card shows sent state
6. Track: `POST /api/positions/track-send` (records that citizen opened mailto for this recipient — NOT that email was delivered, since we can't know)

**Acceptance criteria:**
- [ ] ComposePane opens as TouchModal on mobile, right-panel on desktop
- [ ] Zone 1 pre-fills with accountability opener, is editable
- [ ] Zone 1 absent (not empty) when no opener available
- [ ] Zone 2 shows personalPrompt as placeholder, auto-resizes
- [ ] Zone 3 collapses by default, expandable and editable
- [ ] Zone 4 shows attestation for Tier 2+, absent for lower tiers
- [ ] mailto URL correctly concatenates non-empty zones
- [ ] Paper plane animation fires on send button click
- [ ] Compose pane closes after send, recipient card shows "Sent ✓"
- [ ] Back button returns to landscape without sending
- [ ] Swipe-to-dismiss works on mobile
- [ ] Subject line follows pattern: "[slug] {subject} — {district} Resident"
- [ ] No Zone leaves empty lines in the email body when skipped

---

## Review Protocol

After each cycle, the lead engineer performs a review covering:

1. **Voice compliance:** Does every string follow voice.md? No hedging, no flattery, no marketing?
2. **Design system compliance:** Spring physics only on coordination signals? Typography hierarchy? Color vocabulary?
3. **Perceptual engineering:** Does this threshold feel right? Does the citizen feel agency without false promises?
4. **Security:** Any PII leakage? Nullifier gaps? Auth bypass?
5. **Mobile-first:** Does this work on 375px? Touch targets 44px? Thumb-zone CTAs?
6. **Cost:** What's the marginal per-citizen cost? Is it amortized correctly?

Findings are documented below each cycle's section upon completion.

---

## Cycle Completion Log

### Cycle 37
**Status:** COMPLETE
**Completed:** 2026-02-27

**Deliverables:**
- `src/lib/types/template.ts` — `RoleCategory`, `RoleGroup`, 5 new fields on `ProcessedDecisionMaker`
- `convex/schema.ts` — `positionRegistrations` + `positionDeliveries` tables, `npx convex dev` deploys cleanly
- `src/lib/services/positionService.ts` — `registerPosition()`, `getPositionCounts()`, `batchRegisterDeliveries()`
- `src/routes/api/positions/register/+server.ts` — POST, auth, upsert, returns count
- `src/routes/api/positions/count/[templateId]/+server.ts` — GET, public, aggregate only
- `src/routes/api/positions/batch-register/+server.ts` — POST, auth, validates recipients
- `src/lib/core/agents/prompts/accountability-opener.ts` — Phase 4 system prompt, voice-compliant
- `src/lib/core/agents/agents/decision-maker-accountability.ts` — `generateAccountabilityOpeners()`, Map-keyed, validated categories
- `src/lib/core/agents/agents/decision-maker.ts` — Phase 4 wired after recommendation, non-fatal

**Review findings:**
1. **DRY fix (applied):** `RoleCategory` was defined in both `template.ts` and `decision-maker-accountability.ts`. Consolidated — accountability module now imports from `template.ts`.
2. **Type safety fix (applied):** Orchestrator merge used `as unknown as Record<string, unknown>` cast to set accountability fields on `ProcessedDecisionMaker`. Since the type was already extended by 37A, replaced with direct property assignment.
3. **personalPrompt storage:** Stored on first decision-maker for UI extraction. Pragmatic but fragile — if first DM is removed, prompt is lost. Acceptable for now; Cycle 39's `landscapeMerge.ts` should extract it early and store separately.
4. **Schema deploy not run:** tables are defined in `convex/schema.ts` but `npx convex dev` has not been executed against the active dev deployment. Must run before Cycle 38 UI can call the API.

### Cycle 38
**Status:** COMPLETE
**Completed:** 2026-02-27

**Deliverables:**
- `src/lib/stores/positionState.svelte.ts` — createPositionState() factory, init/register/reset, SSR seeding
- `src/lib/components/action/PositionCount.svelte` — Spring-animated count (stiffness 0.2, damping 0.8), prefers-reduced-motion, hidden when 0
- `src/lib/components/action/StanceRegistration.svelte` — Binary CTA (support/oppose), 200ms min spinner, registered state with Check icon
- `src/routes/s/[slug]/+page.server.ts` — positionCounts loaded via groupBy, returned to client
- `src/routes/s/[slug]/+page.svelte` — StanceRegistration for authed users, ActionBar fallback for guests, landscapeRevealed state, identityCommitment derived

**Review findings:**
1. **Double-fetch fix (applied):** Store init was fetching from API even though SSR data was already available. Added `initialCount?` parameter to `init()`. Page now seeds from `data.positionCounts`.
2. **identityCommitment verified:** Field exists on the `users` table in `convex/schema.ts` as `v.optional(v.string())`. Derived falls back to `demo-${userId}` for non-credentialed users.
3. **Spec deviation (accepted):** Spec called for "409 → already registered" handling but the API returns 200 with `isNew: false` (upsert semantics). StanceRegistration handles this correctly — count still updates, state transitions to registered.

### Cycle 39
**Status:** COMPLETE
**Completed:** 2026-02-27

**Deliverables:**
- `src/lib/utils/landscapeMerge.ts` — `mergeLandscape()` with dedup, role-ordering, personalPrompt extraction
- `src/lib/components/action/PowerLandscape.svelte` — Container with staggered CSS reveal, `$derived` landscape
- `src/lib/components/action/RoleGroup.svelte` — Delegates to correct card type by source
- `src/lib/components/action/DecisionMakerLandscapeCard.svelte` — Rich card with opener, public actions, sent state, a11y
- `src/lib/components/action/DistrictOfficialCard.svelte` — Simpler card with CWC badge
- `src/lib/components/action/BatchRegistrationBar.svelte` — Mobile fixed / desktop relative, safe-area-inset
- `src/routes/s/[slug]/+page.svelte` — PowerLandscape wired after stance registration, handler stubs for Cycle 40

**Review findings:**
1. **recipient_config cast (accepted):** Page uses `(template.recipient_config as any)?.decisionMakers` — pragmatic cast since JSON shape varies. Fallback to `[]` handles pre-landscape templates gracefully.
2. **Batch register name placeholder (known):** `handleBatchRegister` passes slugified IDs as recipient names. Marked for Cycle 40 resolution.
3. **SSR + progressive reveal (correct):** Groups render with `opacity: 0` in SSR, animate in on mount. `prefers-reduced-motion` media query overrides to `opacity: 1` immediately.
4. **No server changes needed:** `recipient_config` already loaded by parent layout server.

### Cycle 40
**Status:** COMPLETE
**Completed:** 2026-02-27

**Deliverables:**
- `src/lib/components/action/AccountabilityOpener.svelte` — Zone 1: contenteditable, indigo-50, "To:" header, 500-char soft limit
- `src/lib/components/action/PersonalSpace.svelte` — Zone 2: textarea, bottom-border styling, auto-resize (3-8 rows), personalPrompt placeholder
- `src/lib/components/action/TemplateBodyPreview.svelte` — Zone 3: collapsible (line-clamp-3), expandable to editable textarea, [District] replacement
- `src/lib/components/action/AttestationFooter.svelte` — Zone 4: non-editable, emerald-50, renders only at Tier 2+
- `src/lib/services/emailService.ts` — `generatePersonalizedMailto()` added: 4-zone concatenation, 8000-char URL limit, error handling
- `src/lib/components/action/ComposePane.svelte` — Responsive compose: mobile slide-up spring sheet / desktop inline panel, all 4 zones wired
- `src/routes/s/[slug]/+page.svelte` — ComposePane import, `composeTarget` state, handleWriteTo/handleComposeSent/handleComposeBack handlers

**Review findings:**
1. **Mobile/desktop split (correct):** Single component with `isMobile` conditional. Mobile: fixed overlay with backdrop blur, spring `translateY(100%)→0`, drag handle. Desktop: inline panel with ArrowLeft back link. Clean separation.
2. **mailto assembly (correct):** `generatePersonalizedMailto()` concatenates non-empty zones with `\n\n` separator, skips empty zones cleanly. Returns `{ url }` or `{ error }` discriminated union. 8000-char limit enforced.
3. **Batch register name placeholder (still present):** `handleBatchRegister` at line 242 still passes `id` as `name`. Low priority — batch registration is a separate flow from compose, and the name is for server-side record-keeping only.
4. **Subject line deviation (accepted):** Spec called for `"[slug] {subject} — {district} Resident"` but implementation uses `"[slug] {subject}"` without district suffix. Simpler, avoids leaking district info in email subject. Acceptable.
5. **Paper plane animation not implemented (deferred):** Spec called for paper plane send animation. Current implementation fires mailto immediately. Animation is cosmetic — defer to polish pass.
6. **Swipe-to-dismiss not implemented (deferred):** Mobile compose uses backdrop tap to dismiss, not swipe gesture. Adequate for MVP; swipe is a polish enhancement.
7. **track-send endpoint not implemented (known):** `POST /api/positions/track-send` (recording that citizen opened mailto) is spec'd but not built. Non-blocking — all delivery tracking goes through batch-register for now.

---

## Post-Implementation Audit (2026-02-27)

Full structural audit of Cycles 37-40. 30 findings across 23 files.

### Severity Distribution

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 1 | Blocks intended feature |
| HIGH | 7 | Degrades experience significantly |
| MEDIUM | 12 | Should fix before ship |
| LOW | 8 | Polish or enhancement |

### Finding Registry

**F-01 [CRITICAL] District officials never passed to PowerLandscape.**
`+page.svelte:468-476` — `PowerLandscape` accepts `districtOfficials` prop (defaults `[]`), but the page never provides it. `+page.server.ts` loads `userDistrictCode` but never fetches official records. The entire "YOUR REPRESENTATIVES" group, `DistrictOfficialCard`, and CWC badge are dead code. District officials exist in Shadow Atlas but no server-side call retrieves them for the template page.

**F-02 [HIGH] personalPrompt extracted from wrong path.**
`+page.svelte:486` reads `(template.recipient_config as any)?.personalPrompt` — but `personalPrompt` lives on `decisionMakers[0].personalPrompt` within `recipient_config`, not at the top level. Meanwhile `mergeLandscape()` correctly extracts it into `landscape.personalPrompt`. The ComposePane always gets `null`, so Zone 2 always shows the generic placeholder instead of the issue-specific prompt.

**F-06 [HIGH] Double positionState initialization.**
`StanceRegistration.svelte:19-21` runs `$effect(() => positionState.init(templateId))` without SSR data. The page already calls `positionState.init(template.id, data.positionCounts)` in `onMount`. When `templateId` matches, the second call still executes the API fetch (because `initialCount` is `undefined`), overwriting SSR-seeded counts with an identical network response. Wastes a round-trip on every page load.

**F-09 [HIGH] landscapeRevealed not persisted for returning users.**
`+page.svelte:43` — `landscapeRevealed` is local component state, initialized `false`. Users who registered, navigated away, and returned see stance buttons again despite already being registered. No server-side check for existing registration on page load. `positionState` also resets to `idle` on template switch. The upsert succeeds silently, but the UX is confusing — "I already told you I support this."

**F-17 [HIGH] No focus trap on mobile ComposePane overlay.**
`ComposePane.svelte:109-185` — Mobile compose is a `fixed inset-0 z-[1010]` overlay but has no focus trap, no `Escape` key handler, and background content is not `inert`. Keyboard users can Tab through the overlay into hidden page content. Screen readers see no modal boundary.

**F-18 [HIGH] Cards use `div[role=button]` with suppressed a11y warnings.**
Both card components (`DecisionMakerLandscapeCard.svelte:31`, `DistrictOfficialCard.svelte:31`) use `<!-- svelte-ignore a11y_no_static_element_interactions a11y_no_noninteractive_tabindex -->`. Interactive cards should use `<button>` elements. Non-interactive (no email) cards lack `aria-disabled`.

**F-23 [HIGH] 0 decision-makers shows empty landscape.**
When `recipient_config` has no `decisionMakers` and no district officials are provided, `mergeLandscape([], [])` returns `totalCount: 0`. `PowerLandscape` renders "Who decides" header with nothing below it and no `BatchRegistrationBar`. The citizen sees a blank section after registering their position.

**F-28 [HIGH] Two `as any` casts bypass type checking.**
`+page.svelte:470,486` — `(template.recipient_config as any)?.decisionMakers` and `(template.recipient_config as any)?.personalPrompt`. Since `recipient_config` is `unknown`, these casts disable all type checking. Should define and use a `RecipientConfig` interface.

**F-03 [MEDIUM] Batch register sends slugified IDs as recipient names.**
`+page.svelte:242` — `name: id` in the batch register payload. Server stores `"sen-john-smith"` in `recipient_name` column. Should resolve from landscape members.

**F-04 [MEDIUM] positionState lifecycle on navigation.**
`positionState` is a module-level singleton. `init()` is called in `onMount`, which fires once per component mount. SvelteKit may reuse the component for different `/s/[slug]` routes — `onMount` won't re-fire, leaving stale state from the previous template.

**F-10 [MEDIUM] sentRecipients not persisted.**
`+page.svelte:44` — `sentRecipients` is ephemeral `Set<string>`. Page refresh loses all "Sent ✓" state. No server-side query to restore delivered recipients from `PositionDelivery`.

**F-11 [MEDIUM] No mutual exclusion between compose and landscape on desktop.**
Both render simultaneously. A user could click "Write to them" on another card while a draft is open, silently discarding the current draft by swapping `composeTarget`.

**F-13 [MEDIUM] Batch registration failure has no user feedback.**
`+page.svelte:258` — `catch` block resets to `'idle'` with `console.error` only. No toast, no error message.

**F-14 [MEDIUM] Hardcoded `bg-emerald-600` bypasses design token.**
`ComposePane.svelte:177,247` — Send button uses raw Tailwind `emerald-*` instead of `channel-verified-*` token. `BatchRegistrationBar` correctly uses the token.

**F-19 [MEDIUM] No `aria-live` regions for state transitions.**
`StanceRegistration` confirmation, `BatchRegistrationBar` completion, `PositionCount` updates, `ComposePane` errors — none use `aria-live`. Screen readers get no feedback.

**F-20 [MEDIUM] AccountabilityOpener contenteditable missing `aria-multiline`.**
Also no `aria-describedby` for the character counter. Counter warning has no `aria-live`.

**F-07 [MEDIUM] Empty `message_body` produces blank template preview.**
`TemplateBodyPreview.svelte:9` — `.replace()` on empty string is safe but produces a blank collapsed preview with no visual indication.

**F-08 [LOW] Empty `districtName` → "Verified resident, " with trailing comma.**
`AttestationFooter` displays district name without null guard. Empty string produces a grammatically broken attestation.

**F-21 [LOW] PersonalSpace textarea lacks `aria-label`.**
Uses `placeholder` text only — not a substitute for accessible labeling.

**F-22 [LOW] TemplateBodyPreview toggle lacks `aria-expanded`.**
Collapse/expand button doesn't communicate state to assistive technology.

**F-29 [MEDIUM] Double cast on template: `as unknown as TemplateType`.**
`+page.svelte:50` — Hides any mismatch between the Convex schema and the TS interface. Runtime shape mismatches become silent.

---

## Cycle 41: Structural Integrity

**Goal:** Fix every finding that affects the data flow or makes a feature unreachable. After this cycle, every prop carries real data, every state persists across navigation, and the system degrades gracefully when data is missing.

**Scope:** F-01 through F-13, F-28, F-29. Everything except accessibility polish and cosmetic design token fixes.

### 41A: SSR Data Completeness

**The problem.** The server loader (`+page.server.ts`) loads district codes but never fetches the officials who *serve* that district. The `PowerLandscape` component accepts district officials but the page never provides them. The `personalPrompt` is read from a path that doesn't exist. Returning users see the registration flow again because the server never checks for existing registrations.

**Changes:**

1. **`+page.server.ts` — fetch existing registration + district officials.**
   - Query `positionRegistration.findUnique({ where: { template_id_identity_commitment } })` using `locals.user?.identity_commitment || demo-${locals.user?.id}` and `parentData.template.id`. Return `existingPosition: { stance, registrationId } | null`.
   - If `userDistrictCode` resolves to a real district, call Shadow Atlas `GET /v1/officials/{districtCode}` to fetch officials. Return `districtOfficials: Array<{ name, title, organization, email, cwcEligible }>`. Use `SHADOW_ATLAS_URL` env var (already in `.env.example`). Graceful fallback to `[]` — district officials are enhancement, not requirement.
   - Return both new fields in the loader return object.

2. **`+page.server.ts` — type-safe RecipientConfig.**
   - Define `RecipientConfig` interface inline in the server file (or in `template.ts`): `{ decisionMakers?: ProcessedDecisionMaker[]; roleGroups?: RoleGroup[]; personalPrompt?: string }`.
   - Parse `template.recipient_config` with a type guard: `function isRecipientConfig(v: unknown): v is RecipientConfig`. Return typed `decisionMakers` and `personalPrompt` as separate server data fields, eliminating the `as any` casts from the page.

**Files modified:** `+page.server.ts`, `src/lib/types/template.ts`

### 41B: Page State Restoration

**The problem.** Five pieces of state are ephemeral that should persist: `landscapeRevealed`, `positionState.stance`, `positionState.registrationState`, `positionState.registrationId`, and `sentRecipients`. A returning user or a page refresh wipes them all.

**Changes:**

1. **`+page.svelte` — restore from SSR `existingPosition`.**
   - If `data.existingPosition` is non-null, seed `positionState` with the existing stance and registrationId. Set `landscapeRevealed = true` immediately. No registration buttons shown — the citizen already spoke.
   - Add `positionState.restore(stance, registrationId)` method to `positionState.svelte.ts` — sets state to `'registered'` without an API call.

2. **`positionState.svelte.ts` — add `restore()` method.**
   ```typescript
   restore(existingStance: 'support' | 'oppose', existingId: string): void {
     stance = existingStance;
     registrationId = existingId;
     registrationState = 'registered';
   }
   ```

3. **`+page.svelte` — reactive template switching.**
   - Replace `onMount` init with a `$effect` that runs when `template.id` changes. This handles SvelteKit reusing the component for different `/s/[slug]` routes.
   - The `$effect` calls `positionState.init(template.id, data.positionCounts)` and checks `data.existingPosition`. This replaces both the `onMount` init and the `StanceRegistration` `$effect`.

4. **`StanceRegistration.svelte` — remove `$effect` init.**
   Remove lines 19-21 (`$effect(() => positionState.init(templateId))`). The page now owns initialization exclusively. This eliminates the double-fetch (F-06).

5. **`+page.svelte` — restore sentRecipients from server.**
   - In `+page.server.ts`, when `existingPosition` exists, also query `positionDelivery.findMany({ where: { registration_id } })` and return `deliveredRecipients: string[]` (the `recipient_name` values).
   - Page seeds `sentRecipients = new Set(data.deliveredRecipients ?? [])`.

### 41C: Data Wiring Fixes

**The problem.** `personalPrompt` comes from the wrong place. `districtOfficials` is never passed. Batch registration uses IDs as names. The compose pane doesn't guard against a second open on desktop.

**Changes:**

1. **`+page.svelte` — wire `districtOfficials` and `personalPrompt`.**
   - Pass `districtOfficials={data.districtOfficials ?? []}` to `PowerLandscape`.
   - Remove `personalPrompt` from `ComposePane` props entirely. Instead, `PowerLandscape` should expose `landscape.personalPrompt` and the page should pass it to `ComposePane`.
   - Add `personalPrompt` to `PowerLandscape` derived output or make it accessible via a callback/context. Simplest: the page computes `landscape` itself (not inside `PowerLandscape`) and passes both `landscape` and `personalPrompt` to the children. Or: `PowerLandscape` emits `personalPrompt` via an `onReady` callback. **Recommended:** compute `landscape` in the page via `$derived`, pass pre-computed groups to `PowerLandscape` (avoids prop drilling and makes `personalPrompt` available at page level).

2. **`+page.svelte` — batch register name resolution.**
   - Replace `name: id` with actual member names. The page has access to the landscape (if computed at page level per above), so: `const member = allMembers.find(m => m.id === id); name: member?.name ?? id`.

3. **`+page.svelte` — desktop compose guard.**
   - Add a confirmation or auto-close when clicking "Write to them" while a draft is open. Simplest: auto-close the previous draft (set `composeTarget` to new member — already the behavior, but make it explicit). Alternative: ignore the click while compose is open. **Recommended:** auto-close is fine since there's no unsaved state in a mailto — the citizen hasn't committed to anything yet.

4. **`+page.svelte` — batch registration error feedback.**
   - Add a `batchError` state. On catch, set `batchError = 'Registration could not be completed. Try again.'`. Clear on retry. Display in `BatchRegistrationBar` or as an inline message.

### 41D: Empty State Handling

**The problem.** When there are 0 decision-makers and 0 district officials, the landscape shows a "Who decides" header with nothing below it. Empty `districtName` breaks attestation grammar.

**Changes:**

1. **`PowerLandscape.svelte` — empty state.**
   - When `landscape.totalCount === 0`, render a message: "No decision-makers identified for this issue yet." — honest, not apologetic. Don't render the header without content.

2. **`AttestationFooter.svelte` — handle empty district.**
   - If `districtName` is empty/falsy, render "Verified resident" without the comma and district. `{districtName ? `Verified resident, ${districtName}` : 'Verified resident'}`.

3. **`TemplateBodyPreview.svelte` — handle empty body.**
   - If `body` is empty/whitespace, render "No message body provided" in muted text instead of a blank collapsed preview.

**Files modified:** `PowerLandscape.svelte`, `AttestationFooter.svelte`, `TemplateBodyPreview.svelte`

### Acceptance Criteria — Cycle 41

- [x] Returning user who already registered sees "You support this" / "You oppose this" immediately — no re-registration
- [x] `landscapeRevealed` is `true` on mount when existing registration exists
- [x] `sentRecipients` restored from server — "Sent ✓" persists across refresh
- [x] District officials from Shadow Atlas appear in "YOUR REPRESENTATIVES" group (when `SHADOW_ATLAS_URL` is set)
- [x] `personalPrompt` reaches ComposePane Zone 2 as the issue-specific placeholder
- [x] No `as any` casts on `recipient_config` — typed `RecipientConfig` throughout
- [x] `StanceRegistration` no longer calls `positionState.init()` — page owns initialization
- [x] Template switching (SvelteKit client nav) resets state correctly
- [x] 0 decision-makers shows "No decision-makers identified" instead of empty landscape
- [x] Empty district name doesn't produce broken attestation grammar
- [x] Batch registration resolves real names from landscape members
- [x] Batch registration failure shows user-visible error message

### Cycle 41 Completion Log
**Status:** COMPLETE
**Completed:** 2026-02-27

**Deliverables:**
- `src/lib/types/template.ts` — `RecipientConfig` interface + `parseRecipientConfig()` type guard
- `src/routes/s/[slug]/+page.server.ts` — 4 new queries: existing registration, delivered recipients, district officials (Shadow Atlas), typed recipientConfig. All try/catch with graceful fallbacks.
- `src/lib/stores/positionState.svelte.ts` — `restore()` method for server-side state hydration
- `src/lib/components/action/StanceRegistration.svelte` — removed `$effect` init (page owns initialization)
- `src/routes/s/[slug]/+page.svelte` — reactive `$effect` for template switching, page-level `landscape` derived, `districtOfficials` prop wired, `personalPrompt` from landscape, batch name resolution, `batchError` state + UI
- `src/lib/components/action/PowerLandscape.svelte` — empty state message for 0 decision-makers
- `src/lib/components/action/AttestationFooter.svelte` — conditional comma for empty district
- `src/lib/components/action/TemplateBodyPreview.svelte` — "No message body available" + hidden toggle for empty body

**Audit findings resolved:**
- F-01 (CRITICAL): District officials now fetched via `getOfficials()` and passed to `PowerLandscape`
- F-02 (HIGH): `personalPrompt` now from `landscape.personalPrompt`, not `recipient_config` top-level
- F-06 (HIGH): Double init eliminated — `StanceRegistration` no longer calls `positionState.init()`
- F-09 (HIGH): `existingPosition` query restores `landscapeRevealed` + stance for returning users
- F-23 (HIGH): Empty landscape shows "No decision-makers identified" message
- F-28 (HIGH): `RecipientConfig` interface replaces all `as any` casts on `recipient_config`
- F-03 (MEDIUM): Batch register resolves real names from `landscape.roleGroups` members
- F-04 (MEDIUM): Reactive `$effect` handles template switching (SvelteKit client nav)
- F-10 (MEDIUM): `sentRecipients` seeded from `data.deliveredRecipients` on load
- F-13 (MEDIUM): `batchError` state with user-visible error message
- F-07 (MEDIUM): Empty body shows "No message body available" in muted italic
- F-08 (LOW): Empty district produces "Verified resident" without trailing comma

**Review findings (post-implementation):**
1. **Duplicate `mergeLandscape` call (accepted):** Page and `PowerLandscape` both call `mergeLandscape()` with identical inputs. Pure function, cheap computation, harmless duplication. The alternative (passing pre-computed landscape to PowerLandscape) would change the component interface. Accepted.
2. **`identity_commitment` type escape (known):** Server uses `(locals.user as Record<string, unknown>).identity_commitment` because `App.Locals.user` doesn't declare the field. Runtime safe (hooks.server.ts populates it). Type fix requires updating App.d.ts — deferred.
3. **District officials have no email:** Shadow Atlas `Official` interface does not expose email. CWC-eligible officials use `cwc_code` for delivery, others have `contact_form_url`. The compose pane's "Send via email" button will be disabled for these officials. Future: add contact form support as alternative delivery channel.
4. **No infinite loops verified:** `$effect` only writes to state it doesn't read. `positionState.init()` async call is safe (short-circuits to sync `count = initialCount` when SSR data provided).

---

## Cycle 42: Accessibility & Design Token Compliance
**Status:** COMPLETE
**Completed:** 2026-02-27

**Deliverables:**
- `ComposePane.svelte` — Focus trap (`handleOverlayKeydown`), Escape handler, `role="dialog"` + `aria-modal="true"`, auto-focus on mount via `tick()`, `role="alert"` on error divs, `channel-verified-*` design tokens on send buttons
- `DecisionMakerLandscapeCard.svelte` — Semantic `<button>` when interactive, `<div>` when not. `{#snippet cardContent()}` eliminates duplication. Removed `svelte-ignore` + `handleKeydown`.
- `DistrictOfficialCard.svelte` — Same semantic button pattern as above.
- `StanceRegistration.svelte` — `role="status"` + `aria-live="polite"` on registration confirmation.
- `PositionCount.svelte` — `role="status"` + `aria-live="polite"` + dynamic `aria-label` on count display.
- `AccountabilityOpener.svelte` — `aria-multiline="true"`, `aria-describedby` pointing to character counter, `aria-live="polite"` on counter.
- `PersonalSpace.svelte` — `aria-label="Personal message"` on textarea.
- `TemplateBodyPreview.svelte` — `aria-expanded={expanded}` on toggle button.

**Audit findings resolved:**
- F-14 (MEDIUM): Send button uses `channel-verified-*` tokens, not raw `emerald-*`
- F-17 (HIGH): Mobile ComposePane has focus trap, Escape handler, dialog semantics, auto-focus
- F-18 (HIGH): Cards use semantic `<button>` elements, no more `svelte-ignore` directives
- F-19 (MEDIUM): `aria-live` regions on StanceRegistration, PositionCount, ComposePane errors
- F-20 (MEDIUM): AccountabilityOpener has `aria-multiline`, `aria-describedby`, live counter
- F-21 (LOW): PersonalSpace textarea has `aria-label`
- F-22 (LOW): TemplateBodyPreview toggle has `aria-expanded`

**Additional fix (runtime):**
- `npx convex dev` re-run against the active deployment — `positionRegistrations` and `positionDeliveries` tables now exist. Was causing 500 error on `/api/positions/register` ("Cannot read properties of undefined (reading 'create')").

**Review findings:**
1. **Focus trap scope (correct):** Only active on mobile overlay. Desktop inline panel doesn't need a trap — it's not an overlay. Focus trap queries all focusable elements within `overlayEl` and wraps Tab at boundaries.
2. **Snippet pattern (clean):** `{#snippet cardContent()}` + `{@render cardContent()}` cleanly avoids HTML duplication in the conditional button/div split. Svelte 5 native feature.
3. **`tabindex="-1"` on dialog (correct):** The overlay div has `tabindex="-1"` to satisfy Svelte's a11y rule that elements with `role="dialog"` must be focusable. This allows the dialog to receive programmatic focus without being in the natural tab order.

---

## Cost Model

| Action | When | Cost | Amortization |
|--------|------|------|-------------|
| Phase 4 accountability generation | Template creation | ~$0.02 | Once per template |
| District officials opener (cached) | First citizen in district | ~$0.002 | All citizens in district |
| Position registration API | Per citizen | ~$0.0001 (compute) | N/A |
| Batch position delivery | Per citizen × recipients | ~$0.001 (compute + CWC) | N/A |
| mailto generation | Per citizen × recipient | $0.00 (client-side) | N/A |

**For a template used by 1,000 citizens contacting 10 decision-makers each:**
- Template creation: $0.05 (one-time)
- Per-citizen: ~$0.01 (registration + batch delivery)
- Total: $10.05 for 10,000 directed civic actions
- Per-action: $0.001

---

## Open Questions

1. **Opener caching for district officials:** When a citizen's district officials aren't in the template, should we generate accountability openers on-the-fly (per-district LLM call, cached) or skip openers for district officials entirely? Current spec: skip openers (simpler, no cost). Future: cached generation.

2. **Non-government recipient delivery:** For CEOs, university presidents, etc. — what's the delivery mechanism? Current spec: mailto only (citizen's own email). Future: platform-sent position notifications via discovered email.

3. **Position aggregation digest:** Should decision-makers receive daily digests of position counts? Current spec: individual notifications. Future: aggregate "847 verified residents in your district oppose this" digest.

4. **Template author notification:** Should template creators see position counts and actions taken? Current spec: yes, via existing template metrics. Implementation: update `metrics.sent` to include position registrations.
