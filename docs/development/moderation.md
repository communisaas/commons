# Content Moderation

**Status**: Automated Two-Layer Pipeline (via Groq).

**Fully automated, permissive moderation optimized for civic speech. No manual review, no admin dashboard, no appeals process — by design.** The pipeline is fail-open: Groq errors, missing `GROQ_API_KEY`, or rate-limit exhaustion all return `safe: true` / sentinel `-1` scores. No `reviewed_at` / `reviewed_by` / `consensus_approved` fields exist in the Convex schema.

## Overview

Two-layer pipeline runs at template creation time and before AI agent calls:

1. **Layer 0 — Prompt Injection Detection** (required): Llama Prompt Guard 2 86M via Groq
2. **Layer 1 — Content Safety** (optional, permissive): `openai/gpt-oss-safeguard-20b` via Groq

Both layers are free on Groq's tier (14,400 req/day). Latency target: < 1 second total.

---

## Layer 0: Prompt Injection Detection

**Model**: `llama-prompt-guard-2-86m` via Groq

Protects AI agents from jailbreak and manipulation attacks.

| Parameter | Value |
|---|---|
| Default threshold | 0.5 (50% probability) |
| Input limit | 512 tokens (~2,000 chars, truncated) |
| Performance | 99.8% AUC, 97.5% recall at 1% FPR |
| Behavior | BLOCKS content scoring above threshold |

**Calibration** (tested):
- Safe civic speech: 0.001-0.002 (0.1-0.2%)
- "Ignore instructions" attacks: 0.59-0.999
- `[SYSTEM]` override attempts: 0.999

---

## Layer 1: Content Safety

**Model**: `openai/gpt-oss-safeguard-20b` via Groq (see `src/lib/core/server/moderation/llama-guard.ts`).

MLCommons S1-S14 hazard taxonomy with a permissive policy designed for political speech.

### Blocking Hazards (content rejected)

| Code | Category | Rationale |
|---|---|---|
| S1 | Violent Crimes | Threats against officials |
| S4 | Child Sexual Exploitation | CSAM — zero tolerance |

### Non-Blocking Hazards (logged, allowed)

| Code | Category | Why Allowed |
|---|---|---|
| S2-S3 | Non-violent/sex-related crimes | Civil matters |
| S5 | Defamation | Political speech protection |
| S6-S9 | Specialized advice, privacy, IP, weapons | Civic discourse scope |
| S10 | Hate speech | Edgy political speech allowed |
| S11-S12 | Suicide/self-harm, sexual content | Rare in civic context |
| S13 | Elections | Electoral opinions protected |
| S14 | Code interpreter abuse | N/A in this context |

**Design principle**: Platform serves ANY decision-maker (Congress, corporations, HOAs). Political speech, defamation claims, and controversial opinions are civic expression.

---

## Integration Points

### Template Creation (`POST /api/templates`)

Both layers run before template creation. If either blocks, creation fails with HTTP 400:

```json
{
  "success": false,
  "error": {
    "field": "message_body",
    "code": "CONTENT_FLAGGED",
    "message": "Blocked: Violent Crimes"
  }
}
```

### Agent Streams

Prompt injection detection runs before each agent call:

| Agent Route | Threshold | Rationale |
|---|---|---|
| `/api/agents/stream-subject` | 0.5 (default) | Raw user input, most exposed — call site passes no threshold, falls through to the 0.5 default (`src/routes/api/agents/stream-subject/+server.ts:77`) |
| `/api/agents/stream-message` | 0.8 | AI-refined input |
| `/api/agents/stream-decision-makers` | 0.8 | AI-refined input |

### Personalization Text (`POST /api/moderation/personalization`)

Checks user-added personal messages at send time. Both layers run. Target: < 500ms.

### Testing Endpoint (`POST /api/moderation/check`)

Public endpoint (no auth required) for testing content before template creation. Returns moderation assessment without creating a template.

---

## What Doesn't Exist

These are **intentional omissions**, not missing features:

- **No admin review dashboard** — all moderation is automated
- **No approval queue** — templates pass or fail instantly
- **No appeals process** — users modify content and resubmit as new template
- **No moderation audit log** — results logged to console only, not persisted
- **No manual override** — no mechanism to approve blocked content

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Groq API down/rate-limited | Returns `score=-1` (sentinel), content passes (fail-open) |
| Safety check blocks | HTTP 400 with `CONTENT_FLAGGED` and summary |
| `GROQ_API_KEY` not set | Both checks skip, content passes |

**Rationale**: Availability > safety blocking. Users should never be blocked due to third-party outages.

---

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `GROQ_API_KEY` | Yes | Llama Prompt Guard 2 + `openai/gpt-oss-safeguard-20b` |

No other configuration needed. Thresholds are hardcoded per integration point.

---

## Key Files

| File | Purpose |
|---|---|
| `src/lib/core/server/moderation/index.ts` | Pipeline orchestration |
| `src/lib/core/server/moderation/prompt-guard.ts` | Prompt injection detection |
| `src/lib/core/server/moderation/llama-guard.ts` | Content safety classification |
| `src/lib/core/server/moderation/types.ts` | Type definitions, blocking hazard list |
| `src/routes/api/templates/+server.ts` | Template creation with moderation |
| `src/routes/api/moderation/check/+server.ts` | Testing endpoint |
| `src/routes/api/moderation/personalization/+server.ts` | Send-time personalization check |
| `docs/adr/006-groq-moderation-decision.md` | Architecture decision record |
| `tests/unit/moderation/moderation-pipeline.test.ts` | Unit tests |
