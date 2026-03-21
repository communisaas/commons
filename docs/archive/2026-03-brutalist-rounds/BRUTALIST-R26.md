# Brutalist Assessment Round 26 — Client-Side + Regression + Untracked

> **Status**: COMPLETE
> **Date**: 2026-03-19
> **Source**: 3 manual audit agents (client-side Svelte, R24/R25 regression, untracked/modified files)
> **Prior rounds**: R1-R25 (180+ findings addressed)

## Methodology

Shifted focus to client-side Svelte components (under-audited vs server-side), regression check on R24/R25 changes, and untracked/modified working tree files. ~25 raw findings across 3 agents, 1 validated.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| {@html} QR code XSS | REJECTED — QR library encodes self-controlled URL as data squares; no user content in SVG |
| OAuth returnTo open redirect | REJECTED — server validates via `validateReturnTo()` on all 5 OAuth endpoints |
| Campaign SSE stream org scoping | REJECTED — campaign.id fixed from initial org-scoped query; debateId only set by server spawn |
| OG image campaign enumeration | ACCEPTED — public by design (social sharing crawlers); same data as public /c/ page |
| localStorage draft poisoning | ACCEPTED — Tiptap editor sanitizes HTML; try-catch + 7-day TTL |
| Cookie JSON.parse validation | ACCEPTED — try-catch returns null on error; no security impact |
| Embed hex length DoS | REJECTED — `clean.length === 3 \|\| clean.length === 6` already rejects non-standard lengths |
| URL searchParams length | ACCEPTED — client-side only; server queries are parameterized |
| goto(template.slug) traversal | REJECTED — SvelteKit routing prevents traversal; slug validated server-side |
| Report fromName CRLF | REJECTED — regex `\x00-\x1f` includes CR (0x0D) and LF (0x0A) |
| sessionStorage template data | ACCEPTED — same-origin only; 30-minute TTL |
| Embed postMessage origin=* | ACCEPTED — parent responsibility; commons sends, parent validates |
| localStorage onboarding flag | ACCEPTED — UI-only; no security boundary crossed |

---

## Regression Audit (R24/R25)

**0 regressions found** across all 8 modified files:
- ses.ts CRLF sanitization: correct regex, no double-encoding
- engine.ts batch recheck: activeBatch filter correct, metrics accurate
- trigger.ts batch dedup: handles empty matching + null supporterId
- c/[slug] env migration: import correct, validation before DB writes
- V1 campaigns/tags/supporters/keys: limits consistent POST↔PATCH
- calls page: no code depends on removed supporter.email

---

## Validated Findings

### P2 — Medium (1)

#### F-R26-01: postMessage origin check uses substring matching

**File**: `src/lib/components/wallet/OnrampWidget.svelte:106`
**What**: `.includes('transak.com')` allows `evil-transak.com` or `transak.com.evil.com` to pass the origin check. Attacker can send fake `TRANSAK_ORDER_SUCCESSFUL` events.

**Impact**: UI-only — fake order success callback fires, but server never receives payment. No funds at risk.

**Solution**: Exact origin allowlist:
```ts
const TRANSAK_ORIGINS = ['https://global.transak.com', 'https://global-stg.transak.com'];
if (!TRANSAK_ORIGINS.includes(event.origin)) return;
```

---

## Task Graph

| Task | Finding | File |
|------|---------|------|
| T-R26-01 | F-R26-01 | OnrampWidget.svelte |

**Review Gate G-R26-01**: Verify fix.

---

## Completion Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-R26-01 | DONE | Exact origin allowlist replaces .includes() |
| G-R26-01 | PASS | Verified |

---

## Assessment

After 26 rounds (180+ findings), the codebase shows strong hardening:
- **Server-side**: Comprehensive — auth, billing, automation, email, crypto, identity, org scoping all audited
- **Client-side**: Well-structured — minimal {@html}, proper sanitization, server-side validation on all sensitive params
- **Regression**: Zero regressions from R24/R25 fixes

Remaining surface is thin: defense-in-depth, supply-chain dependencies, and speculative future-role concerns. Recommend shifting from continuous security auditing to **integration testing** and **real-world deployment validation**.
