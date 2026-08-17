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
> - **Availability behavior (superseded for launch):** both Groq layers
>   originally failed open in some cases. The launch boundary now holds content
>   on provider errors, rate limits, missing configuration, or malformed output
>   and surfaces an availability error.
> - **Schema refs:** `reviewed_at`, `reviewed_by`, `consensus_approved`
>   described as persistence fields do not exist on `convex/schema.ts`.

> ⚠️ **POLICY AMENDMENT (audience-conditional blocking).** The S1/S4-only
> permissive set applies only when a server-derived **audience verdict**
> (`src/lib/core/server/moderation/audience.ts`) establishes an `institutional`
> recipient. S5 (Defamation), S7 (Privacy), and S10 (Hate) block for a
> `person-form` audience and for every audience that could not be evaluated. No
> client-asserted title, class, form, or recipient list grants this policy. Two
> caller inputs are accepted and neither is an assertion: a template slug the
> server dereferences into an artifact it already holds and re-classifies
> itself, and a `recipients` addressed set used only to bind the request to
> mailboxes that artifact publishes.
>
> **The addressed set binds the verdict to the artifact that publishes it.** A
> slug alone was a policy selector: a sender could address a private mailbox
> while naming a clean institutional template and take the permissive set on
> evidence about somebody else. Every addressed mailbox must therefore appear in
> the named slug's published roster; one absent or malformed entry refuses the
> whole set. But intersection alone is not monotonic: a caller could omit a
> published natural person and move a mixed roster from strict `person-form` to
> permissive `institutional`. The server now classifies the **full published
> roster first** and keeps every `person-form` or `unevaluable` result as a strict
> policy floor. Only an already-institutional artifact may report its addressed
> subset, and that subset uses domain evidence from the full roster, so addressing
> `board@` does not erase the published `press@` that attests a switchboard.
> Caller-controlled removal can therefore preserve or tighten a verdict; it can
> never move strict to permissive. Normalization is trim + lowercase with a
> 256-character cap, the twin of
> `src/routes/api/do-not-contact/links/+server.ts:57-61`.
>
> **The reach cost, stated plainly.** A lane that cannot name its addressed set
> now moderates under the strict S1/S4/S5/S7/S10 set. That is the template-modal
> lane, which resolves its recipients downstream, and the congressional lane,
> which names no mailbox at all — so a certified lane fact is no longer a
> `basis` anywhere: the empty-roster grant is deleted from `deriveAudience`, and
> an unmeasured roster refuses in the fold as it already refused at the endpoint.
> Those lanes still send; they send under the strict policy.
> A mixed artifact also pays a deliberate reach cost: even a send addressed only
> to one of its office mailboxes remains strict when the artifact publishes a
> natural person or an unevaluable route elsewhere. The body is not semantically
> bound to the addressed subset, so allowing that omission to relax policy would
> recreate the exploit.
> Certified templates with published mailboxes re-earn the permissive set only
> by inspecting a roster the server has actually read and binding it to the
> addressed set, never by admitting a lane fact as evidence about a recipient.
>
> **The government-registry discriminator is RETIRED as a gate.** It survives
> only as one of two bases for `institutional`, alongside `seat-lexicon` (a hit
> in the closed seat lexicon at `src/lib/core/agents/seat-route.ts`). The
> certified-delivery lane is not a third basis and classifies nothing on its own;
> its one surviving role is to corroborate a registry grant against the
> published-name veto, so a named officeholder reached at an office intake keeps
> that grant. All three shipped congressional templates publish addressable
> mailboxes, 20 of them, straight onto the same page, and earn their verdict from
> those routes. The axis is now **institutional role vs natural person**,
> measured by `SeatRouteVerdict.form` — because a `.gov` domain never
> established that a mailbox belongs to an office, and a non-government office
> mailbox was never a private person.
>
> **What this amendment's original concern preserves.** A private employee at a
> hospital, university, utility, or county contractor reaches the classifier as
> `person-form` — a name-token match on the local part — and keeps the full
> S1/S4/S5/S7/S10 set. ADR-006's own rationales ("Political speech protection",
> "Edgy political speech allowed") still do not extend to that person. Absence
> is still never a verdict: an empty roster, an indeterminate address, an
> oversized roster, a missing slug, or an unavailable artifact all resolve to
> `unevaluable` and the strict set.
> - **Published-name evidence is required for a private-domain seat.** The
>   `emails` and `decisionMakers` lanes are joined by normalized address, and a
>   route with no non-blank name beside it is `indeterminate`, never a seat. This
>   rule does not by itself decide the sole-proprietor case where a human name is
>   published but does not match `office@` (the domain-attestation discriminator
>   owns that decision), and it deliberately keeps the registry exception: a
>   nameless mailbox in a registration-restricted `.gov`/`.mil` namespace may
>   still earn the `government-registry` basis.
> - **Composition with the domain-attestation rule costs the private-domain seat
>   lane.** The artifact reader requires every published address to have a named
>   `decisionMakers` twin, while the domain-attestation discriminator treats any
>   published name on a private domain as a veto. Together those safety rules
>   leave no producer-valid path to `seat-lexicon` on a private domain. The
>   surviving reach proof is a named registry-office route; the accepted
>   residual remains a nameless registry mailbox, while the sole-proprietor case
>   remains strict. This is an explicit reach cost, not evidence to weaken either
>   natural-person protection. The following “What stopped being protected”
>   paragraph records the earlier audience relaxation in isolation; this
>   composition note supersedes its non-government reach claim on the current
>   producer path.
> - **Composition correction — domain attestation is consulted before name
>   absence.** A solitary nameless role mailbox remains `indeterminate`, but a
>   private domain that publishes at least two distinct closed-lexicon seats and
>   no human independently attests a switchboard, so those nameless routes may
>   retain the `seat-lexicon` basis. A published human name still vetoes that
>   promotion, and a named but unattested role mailbox remains strict under the
>   separately countable `seat-lexicon-unattested` reason. This reconciliation
>   closes the nameless-lane exploit without erasing the measured office reach;
>   it supersedes the two name-evidence composition bullets immediately above.
>
> **What stopped being protected, stated plainly.** S5, S7, and S10 content can
> now reach a published NON-government office mailbox — `board@`, `press@`,
> `ombuds@`, `generalcounsel@`, `cityclerk@` at a hospital, university, utility,
> or company — including claims that name a natural person inside that
> institution. Institutional reputational protection at the moderation layer is
> given up here and is **not replaced** by another control. The floor that
> remains is S1 and S4, unconditionally, in every branch. The classifier still
> LABELS S5/S7/S10 in `SafetyResult.hazards` wherever it does not block them, so
> the §Risk Mitigation audit trail is unchanged.
>
> Blocking S7 for a person-form audience still enforces the delivery rule that
> resolution addresses an OFFICE, never a dossier on a person. Agent-drafted
> message bodies still cross an additional Groq safety call before encrypted
> persistence or client delivery. That request may fall within Groq's free tier,
> but it is a real incremental provider call and is not described as free.

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
- Allows borderline scores below the reviewed threshold

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
