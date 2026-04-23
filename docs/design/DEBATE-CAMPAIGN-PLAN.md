# Debate Market / Campaign Integration — Design Plan

**Status**: Mostly shipped behind `FEATURES.DEBATE=false` — see audit banner
**Date**: 2026-03-17
**Depends on**: Debate infrastructure (~85% built), Campaign verification pipeline (complete)

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** `FEATURES.DEBATE=false`
> in `src/lib/config/features.ts:21` — the code for most items below
> exists but is **inaccessible at runtime**. This plan reads like a
> roadmap; it's closer to a completion checklist. Specific corrections:
>
> - **Inline campaign debate display (§2) is already shipped.**
>   `src/routes/org/[slug]/campaigns/[id]/+page.svelte:~306-389`
>   renders proposition, arguments, status, time-remaining, AI-panel
>   consensus when resolved, threshold progress when not spawned,
>   and `DebateSettlement.svelte` for admins. SSE listeners wired
>   for `debate:argument`, `debate:position`, `debate:settled`
>   (~44-99). Plan treats this as work-to-do; it's done.
> - **Daily resolution cron is a stub, not "Complete."**
>   `convex/debates.ts:~720` logs `[debate-resolution] Would
>   evaluate debate ${id} (...)` and returns. No AI evaluation
>   pipeline wired. Deferred to Phase 6.
> - **Layer 2 Gemini 3 Flash quality assessment was never built.**
>   Per ADR-006 banner: live moderation pipeline is 2 layers
>   (Prompt Guard + `openai/gpt-oss-safeguard-20b`). Layer 1 model
>   migrated off `llama-guard-4-12b` (free tier deprecated). Any
>   reasoning in this plan that assumes Gemini 3 Flash quality
>   scoring is a prerequisite is moot.
> - **Staking is ERC-20 tUSDC with approval**, not native ETH.
>   `PUBLIC_STAKING_TOKEN_ADDRESS=0x0` default + Scroll Sepolia
>   tUSDC (`0xe70623c79E…`). `ensureTokenApproval()` is called
>   before every stake (`debate-client.ts:~271,349`). Native-ETH
>   migration is §5.2 of chain-abstraction, Phase 2.
> - **Pimlico paymaster is a skeleton.** `sponsor-userop` route is
>   validation-only; `PIMLICO_API_KEY` unconfigured in prod. Path 2
>   users effectively pay their own gas on an EOA.
> - **TEE debate cost (~$0.12/debate) is notional.** Unmeasured —
>   nothing evaluates on-enclave yet. Phase 6 will enable real
>   measurement. Bittensor path is deprecated.
> - **Report-email debate section (§3) is the only truly
>   unwritten code path** — `renderReportHtml()` in
>   `report-template.ts` has no debate block.

---

## Current State

### What exists

| Layer | Status | Key files |
|-------|--------|-----------|
| Schema | Complete | `Campaign.debateEnabled`, `debateThreshold` (default 50), `debateId` FK → `Debate` |
| Create endpoint | Complete | `POST /api/campaigns/[id]/debate` — manual creation by editor+, on-chain proposal + off-chain fallback |
| Debate API | 15 endpoints | arguments, commit/reveal, evaluate, resolve, claim, appeal, governance-resolve, ai-resolution, stream, position-proof, cosign |
| UI components | 26 components | `src/lib/components/debate/` — DebateMarketCard, ResolutionPanel, TradePanel, ArgumentCard, etc. |
| Cron resolution | Complete | `GET /api/cron/debate-resolution` — daily 02:00 UTC, finds expired active debates, triggers AI evaluation |
| Claim/settlement | Complete | `POST /api/debates/[debateId]/claim` — simple claim + private position settlement, ZK proof required |
| Campaign detail UI | Partial | Toggle + threshold input in settings; `showDebate` prop passed to VerificationPacket but **unused** — no debate data displayed |
| Report renderer | No integration | `renderReportHtml()` has no debate section |

### What is missing

1. **Auto-spawn**: No code checks `debateThreshold` against action count to auto-create a debate
2. **Campaign UI debate display**: `showDebate` prop is accepted but nothing renders — no proposition, arguments, market price, or resolution status shown inline
3. **Proof report debate section**: `renderReportHtml()` includes verification packet + coordination integrity but zero debate data
4. **Settlement UX from campaign context**: Claim flow exists at `/api/debates/[debateId]/claim` but there is no UI path from campaign detail → claim
5. **SSE debate updates**: Campaign SSE stream (`/api/org/[slug]/campaigns/[campaignId]/stream`) emits `packet` events but no debate events

---

## 1. Auto-Spawn on Threshold

### Decision: Inline check after `campaign_action` (not cron)

**Why inline over cron**:
- Threshold crossing is an event, not a scheduled state check
- Supporters should see the debate spawn immediately after hitting the threshold — latency matters for the "your voice triggered something" moment
- Cron would add up to 24h delay and require scanning all campaigns

**Implementation approach**:

After a `CampaignAction` is created (the existing `campaign_action` trigger dispatch in `src/lib/server/automation/trigger.ts`), add a post-action hook:

```
1. Count verified actions for this campaign
2. If count >= campaign.debateThreshold AND campaign.debateEnabled AND !campaign.debateId:
   a. Call the same logic as POST /api/campaigns/[id]/debate (extract to shared function)
   b. Default proposition: "Should we support: \"{campaign.title}\"?"
   c. Default duration: 7 days
   d. Link debate to campaign
3. Fire-and-forget (IIFE) — do not block the action response
```

**Where to hook**: The action creation happens in the campaign action `+server.ts` form handler or the embed action endpoint. The cleanest place is a shared `checkDebateThreshold(campaignId)` function called after action insert, wrapped in a fire-and-forget IIFE so it does not slow down the user-facing response.

**Edge cases**:
- Race condition: two actions cross threshold simultaneously → the existing `campaign.debateId` check in the create flow (line 99-101 of `+server.ts`) prevents duplicates; use a DB transaction or optimistic unique constraint
- Threshold lowered after debate exists → no-op (debate already linked)
- Threshold raised after debate exists → no-op (don't unlink)

**Effort**: ~0.5 day — extract create logic to shared function, add threshold check, write tests

---

## 2. Campaign UI: Inline Debate Display

### What to show

The campaign detail page (`/org/[slug]/campaigns/[id]/+page.svelte`) should show debate data **between the VerificationPacket hero and the Decision-Maker Targets section** — this is the natural "what's the deliberation status" position.

**When `debateEnabled && debate exists`**, render a section containing:

| Element | Source | Component to reuse |
|---------|--------|--------------------|
| Proposition text | `debate.proposition_text` | `PropositionDisplay` (exists) |
| Status badge (active/resolving/resolved) | `debate.status` | Inline — same pattern as campaign status badges |
| Time remaining / deadline | `debate.deadline` | Logic exists in `DebateMarketCard` |
| Argument count + participant count | `debate.argument_count`, `debate.unique_participants` | Stats row from `DebateMarketCard` |
| LMSR price bar (support/oppose/amend %) | Fetched from debate stream or `/api/debates/[debateId]` | `MarketPriceBar` (exists) |
| Link to full debate view | `/s/{orgSlug}/debate/{debateId}` | Simple anchor |

**When resolved**, additionally show:
| Element | Source | Component |
|---------|--------|-----------|
| Winning stance + argument excerpt | `debate.winning_stance`, winning argument body | Condensed version of `ResolutionPanel` winner block |
| AI panel consensus | `debate.ai_panel_consensus` | `ModelAgreementDots` (exists) |

**When `debateEnabled && !debate`** (threshold not yet reached):
- Show progress toward threshold: "{actionCount} of {debateThreshold} actions — debate spawns at threshold"
- Subtle, not dominant — this is anticipation, not the main event

### Data loading

The campaign detail `+page.server.ts` already loads `campaign.debateEnabled`, `debateThreshold`, `debateId`. Extend the load to include:

```typescript
if (campaign.debateId) {
  const debate = await db.debate.findUnique({
    where: { id: campaign.debateId },
    select: {
      id: true,
      proposition_text: true,
      status: true,
      deadline: true,
      argument_count: true,
      unique_participants: true,
      total_stake: true,
      winning_stance: true,
      winning_argument_index: true,
      ai_panel_consensus: true,
      resolved_at: true,
      arguments: {
        where: { argumentIndex: debate.winning_argument_index },
        select: { body: true, stance: true },
        take: 1
      }
    }
  });
}
```

### SSE updates

Extend the campaign SSE stream to emit `debate` events when the debate is active. The debate already has its own stream endpoint (`/api/debates/[debateId]/stream`). Rather than duplicating, the campaign page can open a second EventSource to the debate stream when `debateId` is present. This avoids coupling the two SSE pipelines.

**Effort**: ~1.5 days — server data loading, new `CampaignDebatePanel` component (composing existing sub-components), SSE wiring, threshold progress bar

---

## 3. Proof Report: Debate in Verification Packet

### Design

The proof report email (`renderReportHtml()` in `src/lib/server/campaigns/report.ts`) is what decision-makers receive. If a debate has resolved, its outcome materially strengthens the proof: it shows that the community not only acted but also adversarially stress-tested the proposition.

**Add a new section between "Coordination Integrity" and "Verify This Report":**

```
┌─────────────────────────────────────────────┐
│ ADVERSARIAL DELIBERATION                    │
│                                             │
│ Proposition: "Should we support: ..."       │
│                                             │
│ Outcome: SUPPORT (73.2% consensus)          │
│ ── strongest argument excerpt (2-3 lines) ──│
│                                             │
│ 47 participants · 12 arguments · 3 stances  │
│ AI panel: 4/5 models agreed                 │
│ Resolution: ai_community                    │
│ Settled on-chain: 0xabc...def               │
│                                             │
│ [What does this mean?] → /about/integrity   │
└─────────────────────────────────────────────┘
```

**When debate is active (not yet resolved)**: Show a lighter version:
```
Adversarial deliberation in progress — 23 participants, 8 arguments.
Deadline: March 24, 2026.
```

**When no debate**: Omit the section entirely (no "N/A" noise).

### Data flow

`loadReportPreview()` already loads the campaign. Extend it to join through `campaign.debateId`:

```typescript
const debate = campaign.debateId
  ? await db.debate.findUnique({
      where: { id: campaign.debateId },
      select: { /* proposition_text, status, winning_stance, ai_panel_consensus, argument_count, unique_participants, resolved_at, winning_argument_index */ },
      include: { arguments: { where: { argumentIndex: ... }, take: 1 } }
    })
  : null;
```

Pass `debate` to `renderReportHtml()` and conditionally render the section.

**Effort**: ~1 day — data loading, HTML section rendering, interpretation text, test coverage

---

## 4. Settlement UX

### Current state

The claim endpoint (`POST /api/debates/[debateId]/claim`) is complete and supports both simple claim and private position settlement. However, there is **no UI** that guides a user through the claim flow from a campaign context.

### Design

Settlement is a **person-layer** action (the supporter claims their winnings), not an org-layer action. The natural UX path is:

1. **Campaign page** (org layer): Shows debate resolved, winning stance. Includes link: "View full debate"
2. **Debate page** (`/s/[slug]/debate/[debateId]`) (person layer): Shows ResolutionPanel with full scores. If user participated and is on the winning side, shows "Claim Settlement" button
3. **Claim flow**: Button triggers ZK proof generation (existing `DebateProofGenerator` component), then calls `/api/debates/[debateId]/claim`
4. **Confirmation**: Shows tx hash, settlement path, winning stance

The settlement UI components mostly exist:
- `ResolutionPanel` — shows winner, scores, appeal status
- `DebateProofGenerator` — generates ZK proof for claim
- `TradePanel` — handles position management

**What's missing**: A `SettlementClaimPanel` component that:
1. Checks if the user participated (via nullifier check against local storage / wallet)
2. Shows eligibility status
3. Triggers proof generation
4. Calls claim endpoint
5. Displays result (tx hash or off-chain confirmation)

**Effort**: ~1.5 days — new `SettlementClaimPanel` component, integration into debate page, eligibility check logic, success/failure states

---

## 5. Sequencing (Build Order)

```
Phase A: Foundation (can ship independently)
├── A1. Extract debate creation to shared function        [0.5 day]
├── A2. Auto-spawn threshold check (fire-and-forget)      [0.5 day]  (depends on A1)
└── A3. Campaign page: debate data loading + display      [1.5 days]

Phase B: Proof Integration
└── B1. Report HTML: debate section                       [1 day]    (depends on A1)

Phase C: Settlement (can defer)
└── C1. SettlementClaimPanel + debate page integration    [1.5 days]
```

**Total estimated effort**: ~5 days

### What to defer further

These items are **not** in scope for this integration pass:

| Item | Why defer |
|------|-----------|
| Debate market billing enforcement | No real USDC staking yet (`PUBLIC_STAKING_TOKEN_ADDRESS = 0x0`) |
| Cross-campaign debate linking | Same template can already share a debate (existing logic at lines 104-114 of create endpoint) — UI for this is a separate feature |
| Debate notifications (email/push) | Automation system exists but debate triggers not wired — separate task |
| On-chain event indexer for real-time metrics | Currently using DB-stored aggregate metrics which are sufficient |
| Market maker / liquidity provisioning | Phase 3 territory — requires real token economics |

---

## 6. Effort Summary

| Item | Effort | Priority | Dependencies |
|------|--------|----------|--------------|
| A1. Shared debate creation function | 0.5 day | P0 | None |
| A2. Auto-spawn threshold check | 0.5 day | P0 | A1 |
| A3. Campaign debate display | 1.5 days | P0 | A1 (for data) |
| B1. Report debate section | 1.0 day | P1 | A1 |
| C1. Settlement claim UI | 1.5 days | P2 | None (debate page exists) |
| **Total** | **5.0 days** | | |

P0 items (auto-spawn + display) are the minimum viable integration — without them, the debate toggle in campaign settings is a dead switch. P1 (report integration) is what makes debate outcomes visible to decision-makers. P2 (settlement UI) can ship later since users can technically claim via the standalone debate page.

---

## Open Questions

1. **Default proposition text**: Currently `"Should we support: \"{title}\"?"` — should orgs be able to customize this before auto-spawn, or is post-spawn editing sufficient?
2. **Threshold display**: Should the threshold progress be visible to supporters (motivation to hit it) or only to org editors (internal metric)?
3. **Report timing**: If a debate is still active when the org sends a report, should the report include a "deliberation in progress" note, or omit the debate section entirely until resolution?
