# Agentic Delegation — Design Plan

> **Status**: DESIGN — schema + UI shipped, execution pipeline unbuilt (reconciled 2026-04-23)
> **Date**: 2026-03-23
> **Depends on**: Trust tiers (complete), Debate markets (design phase), Accountability receipts (complete)
> **Phase**: 3 — requires debate markets and scorecards before meaningful implementation

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** `FEATURES.DELEGATION=false`
> (`src/lib/config/features.ts:73`). UI + schema + API routes exist but
> are inaccessible at runtime; the execution pipeline is unbuilt.
>
> **Shipped:**
>
> - Convex schema: `delegationGrants`, `delegatedActions`,
>   `delegationReviews`, and the `CampaignAction.delegated` +
>   `delegationGrantId` extensions match §4.
> - Settings UI: `src/routes/settings/delegation/+page.svelte` (TrustTierGate,
>   ActiveGrants, creation flow with NL policy parsing, ReviewQueue,
>   ActionHistory — §6).
> - API routes: `POST/GET /api/delegation`,
>   `PATCH/DELETE /api/delegation/[id]`,
>   `POST /api/delegation/parse-policy`,
>   `PATCH /api/delegation/review/[reviewId]`.
> - Trust-tier gate: API + page server both check `trust_tier < 3`.
> - `revokeGrant` mutation sets `revokedAt` + `status='revoked'`.
>
> **Not shipped (§5 "Agent Execution Engine" is aspirational):**
>
> - **Discovery pipeline:** no campaign scan, no issue embedding filter,
>   no relevance score, no auto-execution logic.
> - **Cron `src/routes/api/cron/delegation-execute/+server.ts`
>   does not exist.** Convex crons (15 jobs) make no delegation calls.
> - **`internal.delegation.discover()` / auto-action callers do not
>   exist.** `recordAction` internalMutation (`delegation.ts:~339`)
>   is dormant — no caller invokes it.
> - **No integration with existing agents** (`gemini-provider.ts`,
>   message-writer, etc.) — delegation has no hooks in the live
>   agent stack.
>
> **Corrections:**
>
> - **§2.1 "Tier 3 = address-verified"** is imprecise. Trust tier 3+
>   requires **ID or mDL verification**; post-Cycle-15 the active
>   intake is mDL via W3C Digital Credentials API. Legacy
>   `self.xyz` / `Didit` enum values remain for backward compat only.
> - **§7.1 "Policy text encrypted at rest" is false.** `policyText`
>   is stored plaintext in the Convex schema (see inline code comment
>   at `delegation.ts:~17`). Issue and org filters are also
>   plaintext arrays. The design justification is that it's the
>   user's own policy text, not third-party PII — but the doc
>   should reflect reality.

---

## 1. Problem

Civic engagement has a participation bottleneck: most people care about outcomes but lack time to research bills, evaluate arguments, or take action on every issue. The current model requires manual action for every campaign — read, evaluate, sign, repeat.

Agentic delegation lets verified users authorize an AI agent to take civic actions on their behalf within policy constraints. The agent acts as a **civic proxy**: researching issues, evaluating debate arguments, and casting weighted positions — all under explicit, revocable, auditable delegation grants.

This is NOT automated voting in elections. This is delegation of platform-specific civic actions: signing campaigns, taking debate positions, generating personalized messages to decision-makers.

---

## 2. Trust Requirements

### 2.1 Delegator Requirements

Only users at **Trust Tier 3+** (address-verified) can create delegation grants. Rationale:
- Tier 0-1: Unverified identity — delegation would amplify unverified influence
- Tier 2: Email-verified only — insufficient identity binding for proxy actions
- Tier 3: Address-verified — geographic constituency is proven, delegation is meaningful
- Tier 4-5: Enhanced verification — additional weight in delegated actions

### 2.2 Agent Identity

Delegated agents are **not independent identities**. They are extensions of the delegator's identity:
- Actions taken by an agent use the delegator's trust tier and engagement tier
- Actions count toward the delegator's rate limits
- The nullifier system prevents the delegator from also acting manually on the same campaign (double-counting prevention)
- Agent actions carry a `delegated: true` flag in `CampaignAction` for transparency

### 2.3 Anti-Sybil

One person, one delegation set. The nullifier system already prevents duplicate actions per campaign. Delegation doesn't change this — the agent uses the delegator's identity commitment, so the nullifier is the same whether the person acts manually or through delegation.

---

## 3. Delegation Model

### 3.1 Grant Structure

```typescript
interface DelegationGrant {
  id: string;
  userId: string;              // the delegator

  // Scope
  scope: DelegationScope;      // what the agent can do

  // Constraints
  issueFilter: string[];       // optional: only act on these issue domains
  orgFilter: string[];         // optional: only act within these orgs
  stanceProfile: string;       // reference to user's stance profile for alignment
  maxActionsPerDay: number;    // rate limit (default: 5)
  requireReviewAbove: number;  // proof weight threshold for human review (default: 10)

  // Lifecycle
  expiresAt: Date | null;      // null = indefinite until revoked
  revokedAt: Date | null;      // instant revocation
  status: 'active' | 'paused' | 'revoked' | 'expired';

  // Audit
  createdAt: Date;
  lastActionAt: Date | null;
  totalActions: number;
}

type DelegationScope =
  | 'campaign_sign'        // sign campaigns (take CampaignAction)
  | 'debate_position'      // take positions in debate markets
  | 'message_generate'     // generate personalized messages to DMs
  | 'full'                 // all of the above
```

### 3.2 Policy Language

Users express delegation intent in natural language, which is structured into constraints:

| User says | Structured as |
|-----------|--------------|
| "Sign climate petitions in my district" | `scope: 'campaign_sign', issueFilter: ['climate'], orgFilter: []` |
| "Take debate positions that match my stances" | `scope: 'debate_position', stanceProfile: ref` |
| "Do everything but limit to 3 actions per day" | `scope: 'full', maxActionsPerDay: 3` |
| "Only act on bills my org is tracking" | `scope: 'campaign_sign', orgFilter: ['org-123']` |

The structured policy is derived from natural language input via the Gemini API (existing AI infrastructure). The user reviews and confirms the structured version before activation.

---

## 4. Schema

### 4.1 New Models

```prisma
model DelegationGrant {
  id                  String    @id @default(cuid())
  userId              String    @map("user_id")

  // Scope
  scope               String    // 'campaign_sign' | 'debate_position' | 'message_generate' | 'full'

  // Constraints (JSON for flexibility)
  issueFilter         String[]  @default([])
  orgFilter           String[]  @default([])
  stanceProfileId     String?   @map("stance_profile_id")
  maxActionsPerDay    Int       @default(5) @map("max_actions_per_day")
  requireReviewAbove  Float     @default(10) @map("require_review_above")

  // Natural language policy (for display)
  policyText          String    @map("policy_text")

  // Lifecycle
  expiresAt           DateTime? @map("expires_at")
  revokedAt           DateTime? @map("revoked_at")
  status              String    @default("active") // 'active' | 'paused' | 'revoked' | 'expired'

  // Audit
  lastActionAt        DateTime? @map("last_action_at")
  totalActions        Int       @default(0) @map("total_actions")

  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @updatedAt @map("updated_at")

  user                User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  actions             DelegatedAction[]
  reviewQueue         DelegationReview[]

  @@index([userId])
  @@index([status])
  @@map("delegation_grant")
}

model DelegatedAction {
  id                String   @id @default(cuid())
  grantId           String   @map("grant_id")

  // What was done
  actionType        String   @map("action_type") // 'campaign_sign' | 'debate_position' | 'message_generate'
  targetId          String   @map("target_id")   // campaignId or debateId
  targetTitle       String   @map("target_title")

  // Decision reasoning
  reasoning         String   // agent's reasoning for this action
  relevanceScore    Float    @map("relevance_score") // how well this matched the policy (0-1)
  stanceAlignment   Float?   @map("stance_alignment") // alignment with user's stance profile (0-1)

  // Result
  resultId          String?  @map("result_id")   // CampaignAction.id or DebateArgument.id
  status            String   @default("completed") // 'completed' | 'reviewed' | 'rejected' | 'failed'

  createdAt         DateTime @default(now()) @map("created_at")

  grant             DelegationGrant @relation(fields: [grantId], references: [id], onDelete: Cascade)

  @@index([grantId])
  @@index([createdAt])
  @@map("delegated_action")
}

model DelegationReview {
  id                String   @id @default(cuid())
  grantId           String   @map("grant_id")
  actionId          String?  @map("action_id")

  // What needs review
  targetId          String   @map("target_id")
  targetTitle       String   @map("target_title")
  reasoning         String
  proofWeight       Float    @map("proof_weight")

  // User decision
  decision          String?  // 'approve' | 'reject' | null (pending)
  decidedAt         DateTime? @map("decided_at")

  createdAt         DateTime @default(now()) @map("created_at")

  grant             DelegationGrant @relation(fields: [grantId], references: [id], onDelete: Cascade)

  @@index([grantId])
  @@index([decision])
  @@map("delegation_review")
}
```

### 4.2 CampaignAction Extension

```prisma
model CampaignAction {
  // ... existing fields ...
  delegated         Boolean  @default(false)
  delegationGrantId String?  @map("delegation_grant_id")
}
```

---

## 5. Agent Execution Engine

### 5.1 Discovery Pipeline

The agent periodically scans for actionable campaigns matching the delegation policy:

```
1. Query active campaigns within orgFilter (or all orgs if empty)
2. Filter by issue domain using embedding similarity to issueFilter
3. Check nullifier: has this user already acted on this campaign?
4. Score relevance: issue alignment × stance alignment × proof weight
5. If relevance > threshold AND daily limit not exceeded:
   a. If proof weight < requireReviewAbove → execute immediately
   b. If proof weight >= requireReviewAbove → queue for human review
```

### 5.2 Execution

**Campaign signing:**
1. Agent reads campaign objective and template messages
2. Agent generates a personalized message using the user's district context
3. Agent creates `CampaignAction` with `delegated: true` and `delegationGrantId`
4. Nullifier is computed from the user's identity commitment (not the agent's)

**Debate positioning:**
1. Agent reads debate proposition and existing arguments
2. Agent evaluates against user's stance profile
3. Agent submits a position with reasoning
4. Position is attributed to the user (with delegation flag)

### 5.3 Cron Schedule

**File:** `src/routes/api/cron/delegation-execute/+server.ts`

Runs every 6 hours. For each active delegation grant:
1. Check daily action count against `maxActionsPerDay`
2. Run discovery pipeline
3. Execute or queue actions
4. Update `lastActionAt` and `totalActions`

---

## 6. User Interface

### 6.1 Delegation Settings Page

**Route:** `src/routes/settings/delegation/+page.svelte`

```
DelegationSettingsPage
├── TrustTierGate (requires Tier 3+)
├── ActiveGrants
│   ├── GrantCard (per grant)
│   │   ├── Policy text (natural language)
│   │   ├── Scope badges
│   │   ├── Stats: {totalActions} actions since {createdAt}
│   │   ├── Status indicator (active/paused)
│   │   └── Actions: [Pause] [Edit] [Revoke]
│   └── [+ Create Delegation] button
├── ReviewQueue
│   ├── ReviewCard (per pending review)
│   │   ├── Campaign/debate title
│   │   ├── Agent reasoning
│   │   ├── Relevance + alignment scores
│   │   └── [Approve] [Reject]
│   └── Empty state: "No actions pending review"
└── ActionHistory
    ├── ActionRow (per delegated action)
    │   ├── What was done (campaign signed, position taken)
    │   ├── When
    │   ├── Reasoning excerpt
    │   └── Status (completed/reviewed/rejected)
    └── Pagination
```

### 6.2 Grant Creation Flow

```
Step 1: Natural Language Policy
  "Describe what you'd like your agent to do"
  [textarea]
  [Parse Policy →]

Step 2: Review Structured Policy
  Scope: [campaign_sign ▼]
  Issues: [climate ✕] [housing ✕] [+ add]
  Orgs: [all orgs] or [select specific]
  Daily limit: [5]
  Review threshold: [10] proof weight
  Expires: [30 days ▼] or [never]
  [Confirm & Activate]
```

### 6.3 Campaign Action Attribution

In campaign action feeds and verification packets, delegated actions show:
- "Signed via delegation" badge
- Delegator's trust tier (not a separate agent tier)
- Same district hash as delegator

---

## 7. Privacy

### 7.1 Delegation Grants Are Private

The `DelegationGrant` is encrypted at rest using the existing PII encryption pattern:
- `policyText` is encrypted (reveals user intent)
- `issueFilter` and `orgFilter` are stored as hashed references (not plaintext)
- The existence of a delegation grant is itself private

### 7.2 Action Attribution

Delegated actions in the `CampaignAction` table have `delegated: true` but do NOT reveal who delegated. The action is attributed to the user's pseudonymous campaign identity (existing `campaignPseudonym` pattern).

The verification packet includes delegated action count as metadata but does not distinguish individual delegated vs manual actions.

---

## 8. Abuse Prevention

### 8.1 Rate Limiting

- Per-grant: `maxActionsPerDay` (user-configured, default 5, max 20)
- Per-user: Maximum 3 active delegation grants
- Global: Agent execution cron has a per-run cap (100 actions total across all grants)

### 8.2 Quality Gate

The agent's `relevanceScore` must exceed 0.5 for automatic execution. Below that, the action is either:
- Queued for review (if between 0.3 and 0.5)
- Dropped silently (if below 0.3)

### 8.3 Revocation

Instant revocation: setting `revokedAt` immediately stops all future agent actions. In-flight actions (queued but not executed) are cancelled. Completed actions remain in the record (immutable audit trail).

---

## 9. Sequencing

```
Phase A: Foundation
├── A1. Schema migration (3 new models + CampaignAction extension)     [1 day]
├── A2. Grant CRUD API + settings page                                  [2 days]
└── A3. Natural language → structured policy (Gemini integration)       [1 day]

Phase B: Execution (depends on debate markets)
├── B1. Discovery pipeline (campaign matching, nullifier check)         [2 days]
├── B2. Campaign signing execution                                      [1.5 days]
├── B3. Debate positioning execution                                    [1.5 days]
└── B4. Cron job + daily limit enforcement                              [1 day]

Phase C: Review + Audit
├── C1. Review queue UI + approve/reject flow                           [1.5 days]
├── C2. Action history + attribution in campaign feeds                  [1 day]
└── C3. Privacy: encrypt grant data, pseudonymous attribution           [1 day]
```

**Total: ~13.5 days**

**Dependencies:**
- Phase A can start independently (schema + UI)
- Phase B requires debate markets for positioning (B3)
- Phase C can partially overlap with Phase B

---

## 10. Open Questions

1. **Debate participation:** Should agents be allowed to submit full arguments in debates, or only cast positions (support/oppose)? Recommend positions-only initially — agent-generated arguments could undermine deliberation quality.

2. **Message generation quality:** When an agent generates a message for a campaign, how to ensure quality? Recommend: use the existing template + Gemini personalization, but flag as "generated by civic proxy" in the message metadata.

3. **Delegation visibility to orgs:** Should orgs see what percentage of their campaign actions are delegated? Recommend yes — it's a signal about engagement depth vs breadth.

4. **Cross-org delegation:** Can a delegation grant span multiple orgs? Yes (orgFilter empty = all orgs). But the agent can only act on campaigns the user would have access to.

5. **Delegation chains:** Can a user delegate to another user who has their own delegation? No — delegation is person-to-agent only, no transitive delegation. This prevents delegation amplification.

6. **Stance profile format:** The `stanceProfile` reference needs a structured format. Propose: user's existing stance positions (`UserStance` model) + weighted issue priorities. The agent computes alignment as cosine similarity between campaign stance and user profile.

7. **TEE execution:** Should delegation execution happen in a TEE? For v1, no — the agent runs in the standard CF Workers environment. The user's identity commitment is the trust anchor, not the execution environment. TEE execution is a future enhancement for higher-assurance delegation.
