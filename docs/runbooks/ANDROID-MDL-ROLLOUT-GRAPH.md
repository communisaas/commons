# Android mDL Rollout Graph

This graph tracks the Android-first mDL rollout as implementation -> review -> commit cycles.
Android OpenID4VP is the functional lane; raw mdoc and iOS remain separate gates.

## Status Legend

- `done`: implemented, tested, reviewed, committed
- `impl-done`: implemented in the working tree; review/commit still pending
- `active`: next implementation target
- `blocked`: waiting on dependency outside this delta
- `queued`: defined, not started

## Deltas

| ID | Status | Delta | Verification | Review Gate |
| --- | --- | --- | --- | --- |
| A1 | done | Remove the stale public campaign direct-wallet mDL entrypoint. | `npx vitest --run tests/unit/identity/campaign-mdl-entrypoint.test.ts --config=vitest.config.ts` | Brutalist Claude pass; Codex/Gemini unavailable due quota/rate limits. |
| A2 | impl-done | Commit Android OpenID4VP server gate: protocol flags, start/verify filtering, bridge filtering. | Focused mDL route and protocol-policy tests. | Brutalist security review on mDL endpoints and feature policy. |
| A3a | done | Commit OpenID4VP issuer trust hardening: reject header `jwk`, require `x5c`, anchor leaf certs to IACA roots. | `oid4vp-verify` and `cose-verify`. | Brutalist Claude pass on issuer trust. |
| A3b | done | Remove `SKIP_ISSUER_VERIFICATION` from production code paths; replace remaining synthetic-token tests with mocks/fixtures. | `oid4vp-verify` without env bypass reliance. | Brutalist Claude pass on bypass removal. |
| A3c | done | Commit SD-JWT disclosure hash binding. | `oid4vp-verify` SD-JWT disclosure tests. | Brutalist Claude pass on selective-disclosure handling. |
| A4 | impl-done | Commit internal mDL finalizer: no public client mutation can self-upgrade to tier 5. | `mdl-finalization-internal` plus route tests. | Brutalist review on Convex mutation trust boundary. |
| A5 | active | Add credential-hash reuse detection/cooldown for Android OID4VP replay defense in depth. | Unit test duplicate credential hash handling across users/sessions. | Brutalist security review on replay window. |
| A6 | queued | Android same-device live smoke: Chrome + Google Wallet mDL. | See same-device checklist below. | File launch findings before enablement. |
| A7 | queued | Desktop-to-Android bridge live smoke. | See bridge checklist below. | File launch findings before enablement. |
| A8 | queued | Update Android-first docs and user-facing copy after smoke results are known. | Static/source review plus touched-file Svelte check. | Brutalist product/security copy review. |
| A9 | blocked | Raw mdoc T3: SessionTranscript reconstruction and DeviceAuth verification. | mdoc fixture tests and capture-replay regression. | Required before `MDL_MDOC=true` or iOS enablement. |
| A10 | blocked | iOS/Apple Business Connect lane. | iOS Safari wallet test. | Requires ABC plus raw mdoc T3. |

## Current Completion

- `A1` committed as `f3d4a1a4` (`Remove campaign direct mDL entrypoint`).
- `A3a`/`A3b`/`A3c` committed as `8891c9df` (`Harden mDL issuer verification`).
- Next tractable implementation target is `A5`; `A2` and `A4` remain implemented-but-uncommitted because their files are mixed with broader worktree changes and should be isolated before commit.
- Global `svelte-check` remains a separate repo-health track and is not an Android mDL launch gate unless errors touch this surface.

## Smoke Criteria

Same-device Android smoke (`A6`) passes only when:

- Android Chrome + Google Wallet mDL returns an OpenID4VP response.
- `/api/identity/verify-mdl/start` returns no `org-iso-mdoc` request while `MDL_MDOC=false`.
- `/api/identity/verify-mdl/verify` upgrades the canonical user through the internal finalizer.
- A forged or unsupported `org-iso-mdoc` verify request is rejected while `MDL_MDOC=false`.
- iOS Safari remains unavailable while `MDL_IOS=false`.

Bridge smoke (`A7`) passes only when:

- Desktop starts a bridge session and phone claim binds to the displayed pairing code.
- Phone completion verifies the credential and SSE/status polling reaches the desktop.
- Duplicate or stale completion attempts fail without changing the completed session.
- KV bridge sessions expire naturally within the configured TTL.

## Rollback

Android rollback is a redeploy with `MDL_ANDROID_OID4VP=false` and `MDL_BRIDGE=false`.
Raw mdoc and iOS stay false throughout this lane. In-flight verification and bridge sessions expire from KV within roughly five minutes; no user tier downgrade is automatic.

## Dependency Notes

Android mDL rollout is independent of the V2 proof-generation cutover. Users verified during the V1 proof era remain subject to the V2 credential cutover runbook when `V2_PROOF_GENERATION` is enabled.

Raw mdoc T3 unblocks only after SessionTranscript reconstruction, DeviceAuth MAC/signature verification, and sufficient IACA/VICAL coverage for target jurisdictions. iOS remains blocked until raw mdoc T3 and Apple Business Connect are both complete.
