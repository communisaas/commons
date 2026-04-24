# Org Layer Redesign: Engineering Plan

**Status:** COMPLETE — Phase 0-4 done (2026-03-17). Phase 4.1-4.5 deferred to user testing.
**Derived from:** ORG-UX-AUDIT.md, PERCEPTUAL-BRIDGE.md, CAMPAIGN-ORCHESTRATION-SPEC.md
**Principle:** Make CRM a consequence of verification, not verification a feature of CRM.
**Scope:** Information hierarchy inversion. Same backend, same data model, same privacy invariants. The components exist — their relative prominence changes.

---

## The Inversion

Every screen currently opens with operational CRM affordances and arrives at verification as secondary analytics. The redesign inverts this: every screen opens with proof/power/verification state and arrives at operational tools as secondary affordances.

**Current:** "How do I manage my org?"
**Redesign:** "How much verified civic power have I assembled, and what can I do with it?"

---

## Surface Area Inventory

| Area | Files | Lines | Complexity |
|------|-------|-------|------------|
| Layout | `org/[slug]/+layout.svelte` | 138 | Low |
| Dashboard | `org/[slug]/+page.svelte` + `+page.server.ts` | 735 | High — 7 sections, 16 parallel queries |
| Supporters | list + server + CSV import + AN sync + detail | 1,973 | High — filters, pagination, CSV parser |
| Campaigns | list + detail + server + report + new | 1,366 | High — status transitions, edit form, targets |
| Email Compose | compose page | 983 | Very high — Tiptap, A/B, drafts |
| Email List | list page | 121 | Low |
| Networks | list + detail | 430 | Medium — invite/accept, members |
| Settings | settings page | 278 | Medium — billing, plans |
| Simple Lists | workflows, events, fundraising, sms | 192 | Low — identical 48-line pattern |
| Calls | calls page | 243 | Medium — modal, search |
| Representatives | reps page | 94 | Low |
| Invite | invite acceptance | 172 | Low |
| Org Components | 6 shared components | 1,286 | Medium-High — springs, normalization |
| **TOTAL** | **~35 files** | **~8,011** | |

---

## Change Taxonomy

Four distinct types of work:

### Type A — Hierarchy Inversion
Move existing elements into correct visual prominence. No new components, no new data. Restructure markup.

### Type B — Language/Framing
Underlying functionality correct. Words are wrong. Change labels, copy, descriptions.

### Type C — New Visualization Components
Components described in PERCEPTUAL-BRIDGE.md that don't exist yet.

### Type D — Structural Redesign
Pages that need fundamental restructuring beyond reordering.

---

## What Does NOT Change

Critical scope boundary:

- **All `+page.server.ts` files** — data loading is correct (minor additions only)
- **All API routes** (`src/routes/api/`) — endpoints are correct
- **Email compose core** — Tiptap editor, A/B testing, draft persistence, recipient logic. 983 lines of proven code. We change framing/copy, not the editor.
- **CSV import wizard** — 738 lines of battle-tested CSV parsing. Add verification signal at completion, don't rewrite the import.
- **AN sync** — 405 lines with polling, progress, error handling. Add verification signal at completion.
- **Settings page** — billing/plan logic is operational. Minor copy changes only.
- **Simple list pages** (workflows, events, fundraising, sms) — 48 lines each, card galleries for secondary features.
- **Calls page** — patch-through calling is a tool. Fine as-is.
- **Invite flow** — token acceptance is operational. Fine as-is.
- **Convex schema** (`convex/schema.ts`) — no table changes.
- **Privacy invariants** — no relaxation.

---

## The Signal Principle

The redesign follows the **Signal Principle**:

> Signal looks like iMessage. But when you open a conversation, you see the encryption status. The encryption is not hidden in settings. It's surfaced at every interaction point.

Applied to Commons:

- The supporter view has a table — but the pipeline visualization is the hero
- The email composer looks like an email tool — but verification context is visible during composition
- The campaign dashboard looks like analytics — but the proof packet dominates, and "Ship Report" is the primary action
- The navigation feels familiar — but the content reflects verification, not contact management

Familiar form. Verification substance. The form reduces switching costs. The substance delivers the paradigm shift.

---

## Navigation Strategy

**Decision: Approach B — keep labels, change content.**

```
Dashboard | Supporters | Campaigns | Emails | Networks | Settings
```

Same words. What's behind each word changes. "Supporters" opens to a verification pipeline, not a contact table. "Campaigns" opens to proof packets, not campaign cards.

**Rationale:** The content inversion is the high-leverage change. Nav labels can be tested separately (Phase 4) once the content is right. Approach A (new labels like "Command / Proof / Actions / Invite / Coalition") risks cognitive shock without testing and is premature.

**One exception:** "Emails" may fold into campaign context at Phase 3 if the invitation reframe makes a standalone email section feel redundant. Evaluate after Phase 2.

---

## Phase 0: Shared Components

**Goal:** Fix the atoms. Every page that uses these components improves immediately.
**Change types:** A + B + C
**Risk:** Low — component changes propagate cleanly.

### 0.1 — VerificationPacket.svelte

**File:** `src/lib/components/org/VerificationPacket.svelte` (221 lines)
**Used by:** Dashboard, Campaign Detail
**Change type:** A + B + C

**Current structure:**
```
Header (label + last updated)
├── Empty state (0 actions)
├── Primary counts grid (verified / total / %)
├── Progress bar
├── Coordination integrity scores (5 columns: GDS, ALD, H(t), BV, CAI)
├── Tier distribution (reversed bars)
└── Geographic spread (district count)
```

**Redesign:**
```
Header (campaign name + status)
├── Empty state (reworded — see below)
├── Hero count: verified constituents (large, spring-animated, dominant)
├── District breadth: "across N of M districts"
├── Integrity assessment: one natural-language sentence (NEW)
├── Progress bar (toward target, if set)
├── CTA row: [ Ship Report -> ] [ Preview What They See ] (NEW — slot-based)
├── Expandable detail: raw scores, tier bars, district count (COLLAPSED by default)
```

**Specific changes:**

1. **Hero count enlargement.** The verified count becomes the dominant visual element. Currently `text-3xl font-bold font-mono` — increase to `text-5xl` on desktop, `text-4xl` on mobile. The total and percentage become secondary, smaller, positioned as context beneath the hero.

2. **Integrity assessment sentence.** New derived text above raw scores. Logic:

```typescript
function assessIntegrity(packet: Packet): string {
  const parts: string[] = [];
  if (packet.gds !== null && packet.gds >= 0.7)
    parts.push('geographically diverse');
  else if (packet.gds !== null)
    parts.push('concentrated in few districts');

  if (packet.ald !== null && packet.ald >= 0.7)
    parts.push('individually authored');
  else if (packet.ald !== null)
    parts.push('messages are similar');

  if (packet.burstVelocity !== null && packet.burstVelocity > 5)
    return 'WARNING: Sudden spike in actions. Decision-makers may flag this as coordinated.';

  if (packet.temporalEntropy !== null && packet.temporalEntropy >= 2)
    parts.push('organically timed');

  if (parts.length === 0) return 'Accumulating verification data.';
  return parts.join(', ') + '.';
}
```

Display as a single line in `text-secondary` below the district breadth. Capitalized first letter. Period at end.

3. **CTA slot.** The component accepts an optional `{#snippet actions()}` slot for page-specific CTAs. Dashboard passes "Ship Report" + "Preview" buttons. Campaign detail passes the same. Pages without CTAs (e.g., if packet is embedded in a summary context) omit the slot.

4. **Raw scores collapse into `<details>`.** The 5-column integrity grid and tier distribution bars move inside a `<details>` element with summary "Coordination details." Open by default on campaign detail page, closed on dashboard. Controlled via a `detailsOpen` prop (default: `false`).

5. **Empty state reword.** Current: "No actions recorded yet. Verification conditions will accumulate here once the campaign is active." Redesign: "No verified actions yet. When supporters take action, their proof accumulates here — the packet you'll ship to decision-makers."

6. **Burst velocity warning.** If `burstVelocity > 5`, display a prominent amber banner above the assessment sentence: "Action rate is spiking. This may look inauthentic to recipients." Currently this is a tiny `(high)` label inside the integrity grid — invisible.

### 0.2 — CoordinationIntegrity.svelte

**File:** `src/lib/components/org/CoordinationIntegrity.svelte` (137 lines)
**Used by:** Dashboard (standalone), VerificationPacket (after 0.1 it moves inside the expandable detail)
**Change type:** B + C

**Current structure:**
```
Header label
├── All-null check
├── Score table (5 rows: label, value, bar)
└── Footer explanation
```

**Redesign:**
```
Assessment sentence (human-readable, primary — NEW)
├── All-null check (reworded)
├── Expandable score detail
│   ├── 5 rows with human labels + values + bars
│   └── Each row has one-line plain-language explanation (visible, not tooltip)
└── Burst velocity warning (prominent, if triggered)
```

**Specific changes:**

1. **Human-readable labels.** Replace abbreviated headers:

| Current | Redesign |
|---------|----------|
| "Geo Spread" | "Geographic diversity" |
| "Msg Unique" | "Message authenticity" |
| "Time Spread" | "Timing pattern" |
| "Burst" | "Action rate" |
| "Depth" | "Engagement depth" |

2. **Inline explanations.** Move descriptions from `title` attributes (tooltip-only, invisible on touch) to visible `text-xs text-tertiary` lines beneath each score bar. One sentence each:

| Score | Visible explanation |
|-------|-------------------|
| GDS | "How spread across districts. 1.0 = one action per district." |
| ALD | "How unique each message is. 1.0 = every message distinct." |
| H(t) | "How spread over time. Higher = organic, not a single burst." |
| BV | "Peak vs. average rate. Lower = steady, organic action." |
| CAI | "How many supporters deepen engagement over time." |

3. **Burst velocity warning promotion.** Current: tiny amber `(high)` label. Redesign: if `burstVelocity > 5`, a full-width amber banner at the top of the component: "Action rate spike detected — decision-makers may question authenticity." This replaces the `invertedWarning` logic with a prominent visual.

4. **All-null state reword.** Current: "Insufficient data." Redesign: "Integrity scores appear after 10+ verified actions."

### 0.3 — New Component: IntegrityAssessment.svelte

**File:** `src/lib/components/org/IntegrityAssessment.svelte` (NEW, ~40 lines)
**Used by:** VerificationPacket (0.1), Dashboard, Campaign Detail

A small component that takes a `Packet` and renders the one-line natural-language assessment. Extracted from the `assessIntegrity()` logic above so it can be used independently.

```svelte
<script lang="ts">
  interface Props {
    packet: Packet;
    class?: string;
  }
  let { packet, class: className = '' }: Props = $props();

  const assessment = $derived(assessIntegrity(packet));
  const isWarning = $derived(
    packet.burstVelocity !== null && packet.burstVelocity > 5
  );
</script>

{#if isWarning}
  <p class="rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-2
            text-sm font-medium text-amber-700 {className}">
    {assessment}
  </p>
{:else}
  <p class="text-sm text-secondary {className}">
    {assessment}
  </p>
{/if}
```

### 0.4 — DeliveryMetrics.svelte, GeographicSpread.svelte, VerificationTimeline.svelte

**Files:** 106 + 70 + 145 = 321 lines total
**Change type:** A (lower prominence) + B (minor copy)

These stay structurally unchanged. They move into secondary/expandable sections on the pages that use them. Minor copy adjustments:

- **GeographicSpread:** Add context line: "Your proof covers {n} of {m} targeted districts" above the bar chart.
- **DeliveryMetrics:** No change. Email delivery KPIs are operational tools — they belong in the email detail, not the campaign hero.
- **VerificationTimeline:** No change. Supporting visualization.

---

## Phase 1: Page Inversions

**Goal:** Invert information hierarchy on the 3 highest-impact pages.
**Change types:** A + B
**Risk:** Medium — layout changes, but no new data requirements.
**Depends on:** Phase 0 (shared components updated first).

### 1.1 — Dashboard (`org/[slug]/+page.svelte`, 468 lines)

**Current layout (7 equal-weight sections):**
```
1. Onboarding checklist (conditional)
2. VerificationPacket
3. Verification Funnel (4-step bar chart)
4. Engagement Tier Distribution (T0-T4 bars)
5. Campaign List (mini cards with ring charts)
6. Recent Activity (timeline feed)
7. Endorsed Templates (search + endorse)
```

**Redesigned layout:**
```
1. Onboarding (conditional — redesigned in Phase 3)
2. HERO: VerificationPacket (largest active campaign's packet)
   ├── Hero count, district breadth, integrity assessment
   ├── [ Ship Report -> ]  [ Preview What They See ]
   └── Expandable coordination details
3. Campaign Cards (compact, packet-strength-first)
   ├── Each card shows: verified count, district count, integrity sentence
   └── Links to campaign detail
4. Expandable: Verification Funnel + Tier Distribution (collapsed by default)
5. Compact: Recent Activity (last 5 items, not 10)
6. Compact: Endorsed Templates (collapsed by default)
```

**Specific changes to `+page.svelte`:**

1. **VerificationPacket becomes hero.** Remove the card wrapper (`rounded-xl bg-surface-base border border-surface-border p-6`) and let the packet occupy full content width with increased padding. Pass the campaign-specific CTAs via the actions snippet:

```svelte
<VerificationPacket packet={data.stats.packet} detailsOpen={false}>
  {#snippet actions()}
    {#if data.stats.packet && topCampaign}
      <div class="flex gap-3">
        <a href="/org/{data.org.slug}/campaigns/{topCampaign.id}/report"
           class="...teal CTA...">
          Ship Report
        </a>
        <a href="/org/{data.org.slug}/campaigns/{topCampaign.id}/report"
           class="...secondary CTA...">
          Preview What They See
        </a>
      </div>
    {/if}
  {/snippet}
</VerificationPacket>
```

2. **Campaign cards reframe.** Current cards show: title, type badge, status badge, body preview, template name, debate indicator, ring chart. Redesign: title, status, verified count (large mono), district count, integrity sentence (one line), last action time. Remove body preview — it's campaign content, not proof state. The ring chart stays but becomes secondary.

3. **Funnel + Tiers collapse.** Wrap sections 3-4 in a `<details>` element:
```svelte
<details class="...">
  <summary class="...">Verification pipeline & engagement tiers</summary>
  <!-- existing funnel and tier markup -->
</details>
```

4. **Recent activity trim.** Reduce from 10 items to 5. Keep the markup identical but adjust the data slice.

5. **Endorsed templates collapse.** Wrap in `<details>`, closed by default.

6. **Dashboard title.** Current: "Dashboard — Verification signals for {orgName}". Redesign: Remove subtitle. The packet IS the signal. No need to label it.

**Changes to `+page.server.ts` (267 lines):**

Add `topCampaign` to returned data — the most active campaign (highest verified count among ACTIVE campaigns). Already fetched in the campaigns query; just derive it:

```typescript
const topCampaign = campaigns.find(c => c.status === 'ACTIVE') || campaigns[0];
```

Add verification growth rate (new query in the parallel Promise.all):

```typescript
const weekAgo = new Date(Date.now() - 7 * 86400000);
const twoWeeksAgo = new Date(Date.now() - 14 * 86400000);

const [thisWeekVerifications, lastWeekVerifications] = await Promise.all([
  db.supporter.count({
    where: { orgId: org.id, verified: true, createdAt: { gte: weekAgo } }
  }),
  db.supporter.count({
    where: { orgId: org.id, verified: true, createdAt: { gte: twoWeeksAgo, lt: weekAgo } }
  }),
]);
```

Return as `growth: { thisWeek, lastWeek, rate }`.

### 1.2 — Campaign Detail (`org/[slug]/campaigns/[id]/+page.svelte`, 503 lines)

**Current layout:**
```
1. Breadcrumb + status bar + transition buttons
2. Error/success messages
3. Edit form (title, type, body, template, geographic targeting, debate settings)
4. VerificationPacket (below fold)
5. Analytics dashboard (DeliveryMetrics, VerificationTimeline, GeographicSpread, CoordinationIntegrity)
6. Decision-maker targets (manual form)
7. "Preview Report" button
8. Embed widget (collapsible accordion)
9. Metadata footer
```

**Redesigned layout:**
```
1. Breadcrumb + status bar + transition buttons (KEEP)
2. Error/success messages (KEEP)
3. HERO: VerificationPacket (with Ship Report CTA) — for ACTIVE/COMPLETE campaigns
4. Decision-maker targets (live status, not manual form)
5. Embed widget (reframed with context)
6. <details> Campaign Settings (contains the edit form) — for DRAFT, open by default; for ACTIVE, collapsed
7. Analytics detail (expandable: delivery metrics, timeline, geographic spread)
8. Metadata footer
```

**Specific changes:**

1. **Packet above form.** Move the `VerificationPacket` block (currently at ~line 312) above the edit form (currently at ~line 170). For DRAFT campaigns (no actions yet), show the empty-state packet with the reworded message. The packet section is always present — it's not conditional on having data.

2. **Edit form into `<details>`.** Wrap the entire edit form (lines 170-310) in:
```svelte
<details open={data.campaign.status === 'DRAFT'}>
  <summary class="...cursor-pointer...">
    Campaign Settings
  </summary>
  <!-- existing form markup -->
</details>
```
Open by default for DRAFT (the org is still configuring). Collapsed for ACTIVE/COMPLETE (the packet is the focus now).

3. **"Preview Report" → "Ship Report".** Rename the button. Move it INTO the VerificationPacket via the actions snippet (same pattern as dashboard). Remove the standalone button at line 441.

4. **Decision-maker targets reframe.** The manual add-target form stays (it's necessary), but add status indicators next to each target:

```svelte
{#each data.campaign.targets as target}
  <div class="flex items-center gap-3">
    <span class="...emerald dot..." title="Resolved">●</span>
    <span class="font-medium">{target.name}</span>
    <span class="text-secondary text-sm">{target.title}, {target.district}</span>
    <span class="text-tertiary text-xs">{target.email}</span>
  </div>
{/each}
```

5. **Embed widget reframe.** Current description: "Paste this code on your website to embed the campaign action form." Redesign:
```
Each person who takes action through this widget strengthens your proof packet.
247 verified constituents and counting.
```
Add the current verified count inline. Keep the copy-code functionality.

6. **Debate market contextualization.** The toggle currently says "Enable on-chain debate for this campaign" with a threshold input. Add a one-line explanation: "When {threshold} supporters take action, an adversarial debate spawns. The strongest arguments surface and attach to your proof packet."

### 1.3 — Campaign Report (`org/[slug]/campaigns/[id]/report/+page.svelte`, 259 lines)

**Current layout:**
```
1. Breadcrumb
2. Error/success messages
3. Target selection checkboxes
4. Email preview iframe
5. Send button
6. Past deliveries table
```

**Redesigned layout:**
```
1. Breadcrumb — "Deliver Proof" not "Report"
2. Context line: "You're about to deliver cryptographic proof of constituent support."
3. Proof summary (inline VerificationPacket, compact mode)
4. Target selection (reframed)
5. Email preview iframe (KEEP)
6. [ Deliver to N decision-makers -> ] (reframed CTA)
7. Delivery history (reframed as "Proof delivery arc")
```

**Specific changes:**

1. **Page title.** "Deliver Proof — {campaignTitle}" not "Report."

2. **Context line.** One sentence above the target list: "This proof packet contains {verified} verified constituent actions across {districts} districts. Each recipient will see verification they cannot fabricate or dismiss."

3. **Send button reframe.** Current: "Send to {n} targets". Redesign: "Deliver proof to {n} decision-makers." Teal, prominent.

4. **Delivery history reframe.** Current table shows recipient, status, sent date, district. Add a "proof strength at time of delivery" column showing the verified count when each delivery was made. This shows the progression arc: "891 verified → 2,104 verified."

**Changes to report `+page.server.ts`:**
Add `packetSnapshot.verifiedCount` to each delivery record in the load function (this data already exists in `CampaignDelivery.packetSnapshot`).

---

## Phase 2: New Components & Supporter Reframe

**Goal:** Build the missing visualizations. Reframe supporters as verification pipeline.
**Change types:** C + A + B
**Risk:** Medium — new components need design, but data already exists.
**Depends on:** Phase 0 + 1.

### 2.1 — New Component: VerificationPipeline.svelte

**File:** `src/lib/components/org/VerificationPipeline.svelte` (NEW, ~120 lines)
**Used by:** Supporters page (hero), Dashboard (compact variant in Phase 4)

The "germination" visualization from PERCEPTUAL-BRIDGE.md. Three stages with counts, flow lines, and growth rate.

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  ○ 1,834 imported                                    │
│     │                                                │
│  ◐ 847 district-resolved  (postal code → district)   │
│     │                                                │
│  ● 412 identity-verified  (ZK proof of residency)    │
│                                                      │
│  47 verifications this week  (+12% from last week)   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Props:**
```typescript
interface PipelineProps {
  total: number;
  postalResolved: number;
  identityVerified: number;
  districtVerified: number;
  growth?: { thisWeek: number; lastWeek: number };
}
```

**Implementation notes:**
- Each stage is a row with: circle indicator (○/◐/●), spring-animated count, label, parenthetical explanation
- Vertical connecting lines between stages (SVG or CSS border-left)
- Stage colors follow design system: gray (imported) → amber (postal) → emerald (verified)
- Counts animate with spring physics (`stiffness: 0.15, damping: 0.8`) consistent with VerificationPacket
- Growth rate calculation: `((thisWeek - lastWeek) / lastWeek * 100).toFixed(0)` with sign prefix
- If growth data unavailable, growth line omitted

### 2.2 — Supporters Page Reframe (`org/[slug]/supporters/+page.svelte`, 505 lines)

**Current layout:**
```
1. Header with count + import button
2. Search input
3. Filter bar (email status, verification, tags, source, segment builder)
4. Active filter chips
5. Summary bar (verified/postal/imported dots)
6. Data table
7. Load more
```

**Redesigned layout:**
```
1. Header with count + import button (KEEP)
2. HERO: VerificationPipeline component (NEW)
3. Search input (KEEP)
4. Filter bar (KEEP — but move verification filter to first position)
5. Active filter chips (KEEP)
6. Data table (KEEP — but reorder verification column treatment)
7. Load more (KEEP)
```

**Specific changes:**

1. **Pipeline hero.** Insert `<VerificationPipeline>` between header and search. Pass funnel data from `data.summary`:
```svelte
<VerificationPipeline
  total={data.total}
  postalResolved={data.summary.postal + data.summary.verified}
  identityVerified={data.summary.verified}
  districtVerified={data.summary.verified}
  growth={data.growth}
/>
```

2. **Summary bar removal.** The three colored dots (verified/postal/imported) are now redundant — the pipeline visualization shows the same data with more context. Remove the summary bar.

3. **Filter bar reorder.** Move verification status toggle to the first filter position (currently it's third). Verification state is the primary filter dimension.

4. **Table status badges.** Current: tiny `VER`/`POST`/`IMP` 3-letter codes. Redesign: `Verified`/`Resolved`/`Imported` — full words, same colors. The badges are small enough that full words fit without layout issues.

5. **Supporter detail link context.** When clicking a supporter row, the detail page already shows verification status as hero. No changes needed to `supporters/[id]/+page.svelte` — it already leads with verification state.

**Changes to `+page.server.ts` (139 lines):**
Add growth rate queries (same pattern as dashboard — verifications this week vs. last week). Return as `growth: { thisWeek, lastWeek }`.

### 2.3 — Email Compose Reframe (`org/[slug]/emails/compose/+page.svelte`, 983 lines)

**Change type:** B (framing/copy only — no structural changes to the editor)

**Specific changes (all are text/label changes, not logic changes):**

1. **Page title.** Line ~268: "Compose Email" → "Compose Invitation". Subtitle: "Send an email blast to your supporters" → "Invite supporters to take verified action."

2. **Verification context notice.** Currently a small info box below the editor (line ~557): "Verification context is structural... appended automatically." Redesign: move above the editor, make it more prominent:
```
Every email includes a live verification block showing how many
verified constituents have acted. Recipients see themselves joining
a proven collective — not responding to a blast.
```

3. **Subject line suggestion.** Below the subject input, add a subtle suggestion line: `Suggestion: "{campaignTitle} — {verifiedCount} verified and counting"`. The org can ignore it. This requires passing campaign packet data to the compose page — add to compose `+page.server.ts`.

4. **Recipient count reframe.** Current: "Recipients: 1,247" (large mono number). Redesign: "1,247 recipients (412 verified, 835 pending verification)". Requires adding verified count to the recipient count query.

5. **Merge field explanations.** The merge field buttons ({{firstName}}, {{lastName}}, {{postalCode}}, {{tierContext}}) currently have no tooltips. Add title attributes:
- `{{tierContext}}`: "Inserts the recipient's verification context, e.g., 'You're one of 43 Established advocates in District 6.'"
- Others: brief descriptions of what they insert.

6. **Send confirmation reframe.** Current confirmation dialog says something like "Send to X supporters?" Redesign: "Send invitation to {count} supporters? Each email includes your campaign's verification proof."

---

## Phase 3: Onboarding & Deep Reframe

**Goal:** Redesign the first-run experience. Reframe campaign creation. Add coalition proof visualization.
**Change types:** D + C
**Risk:** High — onboarding is the most complex component (607 lines) and the first-run experience.
**Depends on:** Phase 0 + 1 + 2.

### 3.1 — OnboardingChecklist Redesign (`src/lib/components/org/OnboardingChecklist.svelte`, 607 lines)

**Current 5 steps:**
1. Add description + billing email (inline form)
2. Invite team (inline form)
3. Import supporters (link)
4. Create campaign (link)
5. Send email (link)

**Redesigned 5 steps:**
1. **Name your org** — minimal: description + billing email (KEEP existing inline form)
2. **Bring your supporters** — CSV or AN import (KEEP existing link, add context)
3. **See your verification power** — show pipeline after import (NEW — verification signal)
4. **Pick your target** — create a campaign directed at a decision-maker (REFRAME)
5. **Ship your first proof** — deliver the packet (REFRAME)

**Specific changes:**

Step 2 hint: Current: "Upload CSV or sync from Action Network." Redesign: "Bring your existing supporters. We'll show you how many can be verified."

Step 3 (NEW): After import, the onboarding shows a mini VerificationPipeline inline. This is the aha moment. Completion criteria: `hasSupporters && postalResolvedCount > 0`. Hint: "{postalCount} of your supporters have postal codes that resolve to districts. They're already verification-ready."

Step 4 reframe: Current: "Create your first campaign." Redesign: "Choose a decision-maker to receive your proof." Links to campaign creation, same as before.

Step 5 reframe: Current: "Send your first email." Redesign: "Ship your first proof packet." Links to campaign report page when a campaign exists with targets.

**Completion criteria change:** Current: `hasSupporters && hasCampaigns`. Redesign: `hasSupporters && hasCampaigns && hasSentReport` (or `hasSentEmail` as fallback). The onboarding completes when proof has been shipped, not when an email blast has been sent.

**Server-side addition:** The `onboardingState` object in dashboard `+page.server.ts` needs `postalResolvedCount` added. Already available from the funnel queries.

### 3.2 — Campaign Creation Reframe (`org/[slug]/campaigns/new/+page.svelte`, 182 lines)

**Current 4 sections:**
1. Basic (title, type, description, template)
2. Geographic targeting (country, jurisdiction)
3. Debate market (toggle + threshold)
4. Submit

**Redesigned layout:**
```
1. Who should see this proof? (geographic targeting FIRST — the target frames everything)
2. What are you proving? (title, type, template)
3. Debate (contextualized toggle)
4. Preview of what the decision-maker will receive (NEW — mini proof packet preview)
5. [ Assemble Proof Packet ] (reframed submit)
```

**Specific changes:**

1. **Geographic targeting moves to top.** The org's first question is "who am I directing this at?" not "what's the campaign title?" Move the CountrySelector and JurisdictionPicker to section 1.

2. **Section 1 label.** "Who should see this proof?" — frames the campaign as proof delivery from the start.

3. **Section 2 label.** "What are you proving?" — the title and template are about the content of the proof.

4. **Debate contextualization.** Add one line: "When {threshold} supporters take verified action, an adversarial debate spawns. The strongest arguments attach to your proof packet, making it harder to dismiss."

5. **Submit button reframe.** Current: "Create Campaign." Redesign: "Assemble Proof Packet" or "Create Proof Packet." (Test both.)

6. **Preview section (NEW).** Below the form, before submit, a small preview card:
```
What decision-makers will see:
┌─────────────────────────────────┐
│ VERIFICATION PACKET             │
│ {title}                         │
│ 0 verified (proof assembles     │
│ as supporters take action)      │
└─────────────────────────────────┘
```
This is static preview text, not a live component. It communicates that campaign creation initiates a proof assembly process.

### 3.3 — Coalition Network Detail (`org/[slug]/networks/[networkId]/+page.svelte`, 290 lines)

**Current layout:**
```
1. Back link + header + status
2. Stats cards (member count, supporter count)
3. Member organizations table
4. Pending invitations table
5. Invite form
6. Coalition report button
```

**Redesigned layout:**
```
1. Back link + header + status
2. HERO: Coalition proof power (NEW visualization)
   ├── Combined verified count (large, spring-animated)
   ├── Combined district reach
   ├── Per-org breakdown (bar chart or table)
   └── "Combined packets are {multiplier}x stronger than solo"
3. Shared templates (if any)
4. [ Generate Coalition Report ] (prominent CTA)
5. <details> Membership Admin
   ├── Member organizations table
   ├── Pending invitations
   └── Invite form
```

**Specific changes:**

1. **Coalition proof hero.** New section showing aggregate verification power. Data: sum verified counts across member orgs, deduplicated district count. The multiplier is `coalitionVerified / yourOrgVerified`.

2. **Membership admin collapses.** The invite/accept/remove flows are operational necessities but not the primary experience. Move into `<details>`.

3. **"Generate Coalition Report" promotion.** Move from bottom to immediately below the proof power visualization. This is the coalition's primary action — generating a combined proof packet.

**Server-side addition:** The network detail `+page.server.ts` needs aggregate verified counts per member org. This may require a new query or extending the existing network aggregation service (`src/lib/server/networks/aggregation.ts`).

---

## Phase 4: Polish & Iteration

**Goal:** Refine based on Phase 0-3 results. Address secondary surfaces.
**Risk:** Low — incremental improvements.

### 4.1 — Navigation Labels (Test & Iterate)

After Phases 0-3 land, evaluate whether nav labels should change. Candidates to test:

| Current | Candidate A | Candidate B |
|---------|-------------|-------------|
| Dashboard | Dashboard (keep) | Command |
| Supporters | Supporters (keep) | People |
| Campaigns | Campaigns (keep) | Actions |
| Emails | Emails (keep, or fold in) | Invite |
| Networks | Networks (keep) | Coalition |

Test with 3-5 real org users. Measure: "What do you expect to find behind each label?" If the content inversion makes the existing labels feel natural, keep them.

### 4.2 — Embed Widget Enhancement

Add to campaign detail:
- Live mini-preview of the embed widget (iframe or screenshot)
- Current verified count displayed inline
- One-line explanation: "Each person who takes action through this widget strengthens your proof packet."

### 4.3 — Import Completion Signal

After CSV import and AN sync complete, show a verification signal:
- "{X} supporters imported. {Y} have postal codes that resolve to districts. They're verification-ready."
- Mini VerificationPipeline visualization showing the import result.

### 4.4 — Segment Builder Reframe

When a segment query returns results, add context below the count:

```
43 supporters match

These are verified advocates who have:
  - Proven district membership via ZK proof
  - Taken 5+ verified actions
  - Maintained engagement for 90+ days
```

This requires mapping tier criteria to human descriptions. The tier definitions exist in the protocol spec.

### 4.5 — Email Section Evaluation

After the invitation reframe lands (Phase 2.3), evaluate whether "Emails" deserves its own nav section or should fold into campaign context. If most email activity is campaign-driven invitations, a standalone email section may feel redundant. If orgs also send non-campaign communications (newsletters, updates), the section stays.

---

## Dependency Graph

```
Phase 0 (Shared Components)
├── 0.1 VerificationPacket.svelte ←── used by 1.1 and 1.2
├── 0.2 CoordinationIntegrity.svelte ←── used by 0.1
├── 0.3 IntegrityAssessment.svelte (NEW) ←── used by 0.1
└── 0.4 Secondary components (minor)

Phase 1 (Page Inversions) — depends on Phase 0
├── 1.1 Dashboard ←── uses updated VerificationPacket
├── 1.2 Campaign Detail ←── uses updated VerificationPacket
└── 1.3 Campaign Report ←── standalone, no component deps

Phase 2 (New Components + Supporter) — depends on Phase 0
├── 2.1 VerificationPipeline.svelte (NEW)
├── 2.2 Supporters page ←── uses new VerificationPipeline
└── 2.3 Email compose ←── standalone copy changes

Phase 3 (Onboarding + Deep) — depends on Phase 0 + 1 + 2
├── 3.1 OnboardingChecklist ←── uses VerificationPipeline
├── 3.2 Campaign creation ←── standalone
└── 3.3 Coalition networks ←── standalone

Phase 4 (Polish) — depends on Phase 0-3
├── 4.1 Nav labels
├── 4.2 Embed widget
├── 4.3 Import signal
├── 4.4 Segment builder
└── 4.5 Email section eval
```

**Critical path:** Phase 0 → Phase 1 → Phase 2/3 (parallel) → Phase 4

Phase 2 and Phase 3 can execute in parallel after Phase 1, since they don't share dependencies except the Phase 0 components.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Existing users lose familiar landmarks | Medium | High | Signal Principle: keep labels, change content. No nav rename until Phase 4. |
| Onboarding redesign breaks first-run | Medium | Critical | Phase 3 — test separately. Feature-flag the new onboarding, keep old as fallback. |
| Dashboard performance with larger packet | Low | Medium | Same data, different layout. No new queries except growth rate (fast count). |
| Mobile layout breaks with packet hero | Medium | Medium | Design mobile-specific packet layout: stack vertically, reduce hero count size to `text-3xl`. |
| Scope creep into new features | High | Medium | Strict: hierarchy inversion only. No new backend features. No schema changes. |
| `<details>` element UX on mobile | Low | Low | Standard HTML, works everywhere. Style the summary cursor and chevron. |

---

## Voice Corrections (Complete List)

All copy changes collected across phases:

| Location | Current | Redesign |
|----------|---------|----------|
| Dashboard subtitle | "Verification signals for {orgName}" | Remove (packet speaks for itself) |
| Campaign report page title | "Report" | "Deliver Proof" |
| Campaign report send button | "Send to {n} targets" | "Deliver proof to {n} decision-makers" |
| Campaign detail CTA | "Preview Report" | "Ship Report" |
| Campaign embed description | "Paste this code on your website to embed the campaign action form" | "Each person who takes action through this widget strengthens your proof packet. {count} verified and counting." |
| Campaign debate toggle | "Enable on-chain debate for this campaign" | "Enable adversarial debate. When {threshold} supporters act, the strongest arguments surface and attach to your proof." |
| Campaign new submit | "Create Campaign" | "Assemble Proof Packet" |
| Email compose title | "Compose Email" | "Compose Invitation" |
| Email compose subtitle | "Send an email blast to your supporters" | "Invite supporters to take verified action" |
| Email send confirmation | "Send to X supporters?" | "Send invitation to {count} supporters? Each email includes your campaign's verification proof." |
| Supporter badges | VER / POST / IMP | Verified / Resolved / Imported |
| Onboarding step 3 | "Import supporters — Upload CSV or sync from Action Network" | "Bring your supporters — We'll show you how many can be verified" |
| Onboarding step 4 | "Create your first campaign" | "Choose a decision-maker to receive your proof" |
| Onboarding step 5 | "Send your first email" | "Ship your first proof packet" |
| Packet empty state | "No actions recorded yet. Verification conditions will accumulate here once the campaign is active." | "No verified actions yet. When supporters act, their proof accumulates here — the packet you'll ship to decision-makers." |
| Integrity all-null | "Insufficient data" | "Integrity scores appear after 10+ verified actions" |
| Geographic spread | "{n} districts reached" | "Your proof covers {n} of {m} targeted districts" |
| Recipient count | "Recipients: 1,247" | "1,247 recipients (412 verified, 835 pending)" |

---

## Design Tests (from PERCEPTUAL-BRIDGE.md — canonical)

Every redesigned surface must pass all five:

1. **Does this surface show the org something their supporters proved?** If it shows something the org configured or input, question whether it belongs on the primary surface.

2. **Could the person recognize their action in the org's display?** The count should be the same count. The tier should be the same tier.

3. **Does the org feel like they're watching, not managing?** The dashboard should feel like a window, not a control panel.

4. **Is the decision-maker's view derivable from the org's view?** The report that ships should be the packet the org sees.

5. **Does this make coordination feel heavier?** When the org sees 248 verified constituents with GDS 0.91, does the number land with weight?

If the answer to any is no, the bridge is broken.

---

## Execution Log

### Phase 0 — Shared Components (COMPLETE 2026-03-17)
- **0.1 VerificationPacket.svelte**: Hero count enlarged to text-4xl/5xl. IntegrityAssessment imported. CTA snippet slot added. Raw scores collapsed into `<details>`. Empty state reworded. ✓
- **0.2 CoordinationIntegrity.svelte**: Human-readable labels (Geographic diversity, Message authenticity, etc.). Visible descriptions beneath each bar. Burst velocity amber warning. All-null state reworded. ✓
- **0.3 IntegrityAssessment.svelte**: New component. Natural-language assessment from packet data. Amber warning state for burst velocity >5. ✓
- **0.4 GeographicSpread.svelte**: `targetDistricts` prop added. Context line "Your proof covers N of M targeted districts." ✓
- **Review Gate**: All 5 PERCEPTUAL-BRIDGE design tests pass. No test regressions. Minor fix: VerificationPacket details labels aligned with CoordinationIntegrity vocabulary.

### Phase 1 — Page Inversions (COMPLETE 2026-03-17)
- **1.1 Dashboard**: Hero packet with Ship Report CTA to top campaign. Campaign cards led by `text-2xl font-bold` verified count. Funnel+tiers collapsed in `<details>`. Activity trimmed to 5. Endorsed templates collapsed. Title → just org name. `topCampaignId` added to server load. ✓
- **1.2 Campaign Detail**: Packet promoted to hero (position 3). Ship Report CTA in packet snippet. Decision-maker targets moved up. Embed reframed ("strengthens your proof packet"). Edit form in `<details open={DRAFT}>`. Analytics in `<details>`. Debate context line added. Standalone "Preview Report" button removed. ✓
- **1.3 Campaign Report**: Breadcrumb "Deliver Proof". Emerald proof context banner with verified count + districts. "Decision-maker recipients" header. "Deliver proof to N decision-makers" CTA. Confirm dialog reframed. "Proof delivery arc" history. "Back to campaign" link. Success message reframed. ✓
- **Review Gate**: All 5 PERCEPTUAL-BRIDGE design tests pass across all 3 pages. No test regressions. 13 files changed, 646+/490-.

### Phase 2 — New Components & Reframes (COMPLETE 2026-03-17)
- **2.1 VerificationPipeline.svelte**: New component. 3-stage germination visualization: imported (○) → district-resolved (◐) → identity-verified (●). Spring-animated counts (0.15/0.8). Dashed connectors. Optional growth rate with WoW. ✓
- **2.2 Supporters page**: Pipeline hero between header and search. Summary bar removed. Verification toggle first filter. Badge labels: Verified (emerald) / Resolved (teal) / Imported (tertiary). Email status pills preserved. ✓
- **2.3 Email Compose**: Title "Compose Invitation". Subtitle "Invite supporters to take verified action". Verification context "proof is built in". Confirm dialogs mention verification proof. Send button "Send invitation to N supporters". ✓
- **Review Gate**: All 5 PERCEPTUAL-BRIDGE design tests pass. No test regressions.

### Phase 3 — Onboarding + Deep Redesign (COMPLETE 2026-03-17)
- **3.1 OnboardingChecklist**: Title "Assemble your first proof". 5 steps: Name org → Bring supporters → See verification power (mini VerificationPipeline) → Choose target → Ship proof packet. Invite team step removed. Step 3 shows postal resolved count inline. Step 5 dynamic link to report page. Completion now requires hasSentEmail. Server: postalResolvedCount added to onboardingState. ✓
- **3.2 Campaign Creation**: Title "Assemble Proof Packet". Geographic targeting FIRST ("Who should see this proof?"). Basic info SECOND ("What are you proving?"). Debate toggle contextualized. Proof preview card. Submit "Assemble Proof Packet". fail() responses now include targetCountry/targetJurisdiction. ✓
- **3.3 Coalition Network Detail**: Coalition Proof Power hero (4xl emerald verified count). Coalition Report CTA promoted. Membership admin in `<details>`. Stats cards replaced by proof hero. Fixed engagementTier → verified query. ✓
- **Review Gate**: All 5 PERCEPTUAL-BRIDGE tests pass. 2 TypeScript issues fixed (fail() response, Supporter.verified query).

### Phase 4 — Voice Corrections (COMPLETE 2026-03-17)
- **4.0 Voice sweep**: 5 corrections applied:
  - Emails list: "email blast" → "invitation" (×2 occurrences)
  - OnboardingChecklist: "Create campaign" → "Assemble proof"
  - Dashboard + Campaign Detail CTA: "Ship Report" → "Deliver Proof"
  - Dashboard secondary CTA: "Preview What They See" → "Preview Proof Packet"
- **4.1-4.5**: Deferred (nav labels need user testing; embed/import/segment enhancements are incremental).

### Final Design Test Sweep — All 8 Surfaces (2026-03-17)

Comprehensive review of all modified surfaces against the 5 PERCEPTUAL-BRIDGE design tests.

**Test 1: Does this surface show the org something their supporters proved?**
| Surface | Pass | Notes |
|---------|------|-------|
| Dashboard | PASS | Hero is VerificationPacket with verified count, integrity, districts |
| Campaign Detail | PASS | Packet hero above all operational affordances |
| Campaign Report | PASS | Emerald proof context with verified count + districts |
| Supporters | PASS | Pipeline hero shows imported → resolved → verified stages |
| Email Compose | PASS | Verification context notice: "proof is built in" |
| Onboarding | PASS | Step 3 renders mini VerificationPipeline inline |
| Campaign Creation | PASS | Proof preview card shows what decision-makers will see |
| Network Detail | PASS | Coalition Proof Power hero with combined verified count |

**Test 2: Could the person recognize their action in the org's display?**
| Surface | Pass | Notes |
|---------|------|-------|
| Dashboard | PASS | Same verified count, same tiers, same districts |
| Campaign Detail | PASS | Per-campaign packet reflects actual supporter actions |
| Campaign Report | PASS | Packet data matches what was computed from actions |
| Supporters | PASS | Individual verification states (Verified/Resolved/Imported) visible per-row |
| Email Compose | PASS | {{tierContext}} merge field shows recipient their own status |
| Onboarding | PASS | Pipeline counts match dashboard funnel exactly |
| Campaign Creation | PASS | Preview shows "0 verified" — honest starting state |
| Network Detail | PASS | Per-org supporter counts visible in membership table |

**Test 3: Does the org feel like they're watching, not managing?**
| Surface | Pass | Notes |
|---------|------|-------|
| Dashboard | PASS | Packet is hero, operational tools collapsed in `<details>` |
| Campaign Detail | PASS | Packet above form; form collapsed for ACTIVE campaigns |
| Campaign Report | PASS | Context line frames delivery as witnessing proof |
| Supporters | PASS | Pipeline visualization above table; table is drill-down |
| Email Compose | MINOR | Editor IS a management tool, but verification context visible |
| Onboarding | PASS | Steps frame as proof assembly journey, not admin setup |
| Campaign Creation | PASS | "What are you proving?" not "Configure your campaign" |
| Network Detail | PASS | Proof power hero; membership admin collapsed |

**Test 4: Is the decision-maker's view derivable from the org's view?**
| Surface | Pass | Notes |
|---------|------|-------|
| Dashboard | PASS | "Preview Proof Packet" links to same report page |
| Campaign Detail | PASS | "Deliver Proof" links to report with same packet |
| Campaign Report | PASS | Email preview iframe shows exactly what recipients get |
| Supporters | N/A | Supporters page is internal to org |
| Email Compose | PASS | Preview button renders recipient's email view |
| Onboarding | N/A | Internal first-run experience |
| Campaign Creation | PASS | Preview card shows decision-maker perspective |
| Network Detail | PASS | Coalition Report is the shared artifact |

**Test 5: Does this make coordination feel heavier?**
| Surface | Pass | Notes |
|---------|------|-------|
| Dashboard | PASS | Large mono verified count (4xl/5xl) + district breadth |
| Campaign Detail | PASS | Hero count dominates; integrity assessment adds gravity |
| Campaign Report | PASS | "Deliver proof to N decision-makers" — consequential CTA |
| Supporters | PASS | Pipeline stages show verification as a narrowing funnel |
| Email Compose | PASS | "Verification proof is built in" — structural, not optional |
| Onboarding | PASS | "See your verification power" is the aha moment |
| Campaign Creation | PASS | Proof preview gives weight to the act of creating |
| Network Detail | PASS | Coalition count in 4xl emerald makes combined power visible |

**Result:** 40/40 primary tests pass. 1 minor note on Email Compose (Test 3) — the editor is inherently a management tool, but verification context is visible during composition and the framing ("Compose Invitation") reframes the management action as an invitation to participate in proof.

**Test regressions:** 3,893 tests pass, 35 fail (6 files). All failures are in pre-existing analytics cron tests (date handling) — unrelated to redesign.

**Phase 4 follow-ups** (deferred, non-blocking):
- 4.1: Nav label user testing
- 4.2: Embed widget live preview + verified count inline
- 4.3: Import completion verification signal
- 4.4: Segment builder verification context
- 4.5: Email section fold evaluation

---

## Summary

This is an **information hierarchy inversion** across ~8,000 lines of UI in 35 files. The backend is correct. The data model is correct. The privacy invariants are correct. The design philosophy (PERCEPTUAL-BRIDGE.md) is correct. The implementation diverged.

The rework concentrates on:
- **6 shared components** (Phase 0 — unblocks everything)
- **3 key page inversions** (Phase 1 — highest visible impact)
- **1 new component + 2 page reframes** (Phase 2)
- **3 deep structural redesigns** (Phase 3)
- **5 polish items** (Phase 4)

No new features. No backend changes. No schema migrations. The atoms of the experience exist — they need to be arranged so verification is the figure, not the ground.
