# ADR-006: Permissive Moderation Architecture

**Date**: 2026-01-23
**Status**: IMPLEMENTED (with model + layer-count drift — see banner)
**Decision Maker**: Technical Architecture Team
**Impact**: High - Complete moderation architecture redesign

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** The "permissive / civic-speech
> / S1 + S4 block, everything else permit" policy is accurate and shipped.
> Two concrete claims need correction before using this ADR as a
> reference:
>
> - **Layer 1 model migrated.** "Llama Guard 4 12B" is named throughout
>   (summary, architecture diagram, before/after table, references).
>   The live model is **`openai/gpt-oss-safeguard-20b`** on Groq —
>   Llama Guard 4 is no longer on the free tier
>   (`src/lib/core/server/moderation/llama-guard.ts:9-20`). Treat every
>   "Llama Guard 4" mention below as historical.
> - **Pipeline is 2 layers, not 3.** The "Layer 2 — Gemini 3 Flash
>   quality assessment" described in the architecture diagram and
>   implementation table was **never built**. Active pipeline is Layer 0
>   (`llama-prompt-guard-2-86m`) + Layer 1
>   (`openai/gpt-oss-safeguard-20b`) only. See
>   `src/lib/core/server/moderation/index.ts`.
> - **Thresholds vary by endpoint.** Default is 0.5; message/DM routes
>   pass 0.8 (`moderatePromptOnly(content, 0.8)`). The ADR's "universal
>   0.5" framing is oversimplified.
> - **Fail-open behavior:** prompt-guard fails open on all errors
>   (including 429). llama-guard fails open on non-429 errors but
>   **throws on 429 rate-limit**. No HTTP 503.
> - **Schema refs:** `reviewed_at`, `reviewed_by`, `consensus_approved`
>   described as persistence fields do not exist on `convex/schema.ts`.

---

## Summary

**Decision: Prioritize PROMPT INJECTION protection over content moderation.**

Commons is a multi-stakeholder civic engagement platform serving ANY decision-maker (Congress, corporations, HOAs, universities, hospitals). Political speech, strong criticism, and controversial opinions are ALLOWED.

The architecture uses:
1. **Llama Prompt Guard 2** (REQUIRED) - Protects AI agents from manipulation
2. **Llama Guard 4** (OPTIONAL, PERMISSIVE) - Only blocks S1 (threats) and S4 (CSAM)
3. **Gemini 3 Flash** (OPTIONAL) - Quality assessment

---

## Architecture

### 3-Layer Moderation Pipeline

```
User Submits Input
        |
        v
[Layer 0: Llama Prompt Guard 2 86M via GROQ] - REQUIRED
  - Prompt injection detection
  - Jailbreak attempt blocking
  - 99.8% AUC, 97.5% recall at 1% FPR
  - Threshold: 0.5 (50% probability)
        |
        | If no injection detected...
        v
[Layer 1: Llama Guard 4 12B via GROQ] - OPTIONAL
  - MLCommons S1-S14 hazard detection
  - PERMISSIVE: Only S1 (threats) and S4 (CSAM) BLOCK
  - S5, S10, S13 logged but ALLOWED (political speech)
        |
        | If no blocking hazards (S1/S4)...
        v
[Layer 2: Gemini 3 Flash] - OPTIONAL
  - Quality assessment only
  - Policy relevance, professionalism
        |
        v
Final Decision
```

### What Changed from v1

| Aspect | Before (v1) | After (v2) |
|--------|-------------|------------|
| Primary threat | Content moderation | Prompt injection |
| Blocking hazards | S1-S14 | S1, S4 only |
| S5 (Defamation) | BLOCKS | Logged only |
| S10 (Hate) | BLOCKS | Logged only |
| S13 (Elections) | BLOCKS | Logged only |
| Prompt injection | Not checked | REQUIRED check |
| Architecture | 2-layer | 3-layer |

### Design Rationale

1. **Platform serves ANY decision-maker** - Not just Congress
2. **Political speech is protected** - Even controversial opinions
3. **Section 230 covers user speech** - But NOT AI-generated content
4. **Real threat is prompt injection** - OWASP Top 10 #1 for LLMs
5. **Minimal blocking** - Only truly illegal content (threats, CSAM)

---

## Implementation Files

| File | Purpose |
|------|---------|
| `src/lib/core/server/moderation/types.ts` | Types with BLOCKING_HAZARDS, PromptGuardResult |
| `src/lib/core/server/moderation/prompt-guard.ts` | Llama Prompt Guard 2 client |
| `src/lib/core/server/moderation/llama-guard.ts` | Llama Guard 4 client (permissive) |
| `src/lib/core/server/moderation/index.ts` | 3-layer pipeline orchestration |

---

## MLCommons Hazard Policy

### BLOCKING (Content Rejected)

| Code | Category | Rationale |
|------|----------|-----------|
| S1 | Violent Crimes | Federal crime (threats against officials) |
| S4 | Child Sexual Exploitation | Federal crime (18 USC 2252) |

### NON-BLOCKING (Logged Only)

| Code | Category | Rationale |
|------|----------|-----------|
| S2 | Non-Violent Crimes | Civil matter, allow discourse |
| S3 | Sex-Related Crimes | Civil matter, allow discourse |
| S5 | Defamation | Political speech protection |
| S6 | Specialized Advice | Allow constituent opinions |
| S7 | Privacy | Civil matter, allow discourse |
| S8 | Intellectual Property | Civil matter |
| S9 | Indiscriminate Weapons | Political discussion allowed |
| S10 | Hate | Edgy political speech allowed |
| S11 | Suicide & Self-Harm | Mental health resources, not blocking |
| S12 | Sexual Content | Context-dependent |
| S13 | Elections | Electoral opinions protected |
| S14 | Code Interpreter Abuse | N/A for civic platform |

---

## Prompt Injection Detection

### Llama Prompt Guard 2 86M via GROQ

**Performance:**
- 99.8% AUC for English jailbreak detection
- 97.5% recall at 1% false positive rate
- 81.2% attack prevention rate

**Threshold Calibration (tested):**
- Safe civic speech: 0.001-0.002 (0.1-0.2%)
- "Ignore instructions" attacks: 0.59-0.999 (59-99%)
- [SYSTEM] override attempts: 0.999 (99.9%)

**Default threshold: 0.5 (50%)**
- Catches obvious attacks
- Allows borderline requests (fail-open for usability)

---

## Cost Analysis

### GROQ Free Tier (Both Models)

| Metric | Value |
|--------|-------|
| Requests/day | 14,400 |
| Requests/month | ~432,000 |
| Prompt Guard cost | $0.02/1M tokens |
| Llama Guard cost | $0.04/1M tokens |

### Projected Costs at Scale

| Monthly Volume | Prompt Guard | Llama Guard | Total |
|----------------|--------------|-------------|-------|
| 10,000 | Free | Free | $0.00 |
| 100,000 | Free | Free | $0.00 |
| 432,000 | Free | Free | $0.00 |
| 1,000,000 | ~$1.20 | ~$2.40 | ~$3.60 |

---

## Legal Considerations

### Section 230 Protection

- **User-generated content**: Protected under Section 230
- **AI-generated content**: May NOT be protected
- **Platform liability**: Varies by content source

### Risk Mitigation

1. **Prompt injection blocking** protects against AI abuse
2. **S1/S4 blocking** prevents federal crimes
3. **Logging non-blocking hazards** provides audit trail
4. **User accountability** through identity verification

---

## Environment Variables

**Required:**
- `GROQ_API_KEY` - For Prompt Guard 2 and Llama Guard 4

**Optional:**
- `GEMINI_API_KEY` - For quality assessment layer

---

## References

- [GROQ Llama Prompt Guard 2](https://console.groq.com/docs/model/meta-llama/llama-prompt-guard-2-86m)
- [GROQ Llama Guard 4](https://console.groq.com/docs/model/meta-llama/llama-guard-4-12b)
- [OWASP Top 10 for LLMs](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- [Section 230 Overview](https://www.eff.org/issues/cda230)
- [MLCommons Hazard Taxonomy](https://huggingface.co/meta-llama/Llama-Guard-4-12B)

---

*Implementation completed 2026-01-23*
