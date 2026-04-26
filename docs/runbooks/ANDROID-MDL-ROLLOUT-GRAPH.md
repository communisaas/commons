# Android mDL Rollout Graph

This graph tracks the Android-first mDL rollout as implementation -> review -> commit cycles.
Android OpenID4VP is the functional lane; raw mdoc, iOS, and Apple Business Connect remain
separate gates and are not prerequisites for Android device rollout.

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
| A2 | done | Commit Android OpenID4VP server gate: protocol flags, start/verify filtering, bridge filtering. | `mdl-protocol-policy` and `verify-mdl-start`. | Brutalist review included in A5 replay/finalizer pass; no blocking protocol-gate findings. |
| A3a | done | Commit OpenID4VP issuer trust hardening: reject header `jwk`, require `x5c`, anchor leaf certs to IACA roots. | `oid4vp-verify` and `cose-verify`. | Brutalist Claude pass on issuer trust. |
| A3b | done | Remove `SKIP_ISSUER_VERIFICATION` from production code paths; replace remaining synthetic-token tests with mocks/fixtures. | `oid4vp-verify` without env bypass reliance. | Brutalist Claude pass on bypass removal. |
| A3c | done | Commit SD-JWT disclosure hash binding. | `oid4vp-verify` SD-JWT disclosure tests. | Brutalist Claude pass on selective-disclosure handling. |
| A4 | done | Commit internal mDL finalizer: no public client mutation can self-upgrade to tier 5. | `mdl-finalization-internal` plus route tests. | Brutalist A5/finalizer debate found no blocking finalizer-boundary issue. |
| A5 | done | Add credential-hash reuse detection/cooldown for Android OID4VP replay defense in depth. | `mdl-finalization-internal`, `mdl-protocol-policy`, `verify-mdl-start`. | Brutalist CLI debate partial pass: Codex reviewed; Claude/CON contribution failed; no blocking finding surfaced. |
| A6a | done | Android same-device pre-smoke source readiness: bridge `credentialHash` propagation, desktop fail-closed completion, and disclosed-field copy alignment. | `mdl-smoke-readiness`. | Brutalist context `3affd4a1-34a2-4f8f-8fff-b079705347c8`; accepted findings fixed before commit. |
| A6b | done | Align Android OpenID4VP DC API request envelope: `openid4vp-v1-unsigned`, `response_type=vp_token`, `response_mode=dc_api`, DCQL `mso_mdoc`, exact claim paths. | `verify-mdl-start`, `mdl-protocol-policy`, `mdl-smoke-readiness`, `oid4vp-verify`. | Brutalist context `f519aa7e-4dcb-487b-bf68-843ca6ba9680`; blocking protocol/filter findings fixed before commit. |
| A6c | active | Implement Android OpenID4VP response handling: normalize Chrome/Wallet DC API authorization responses, handle `vp_token` containers, and route `mso_mdoc` payloads through verified mdoc processing or fail closed. | Add response-shape fixtures plus focused verifier/route tests. | Brutalist review before commit; do not claim live-smoke readiness until response handling is verified. |
| A6d | queued | Android same-device live smoke: Chrome + Google Wallet mDL on a physical Android device. | See same-device checklist below plus `mdl-smoke-readiness`. | File launch findings before enablement. |
| A7 | queued | Desktop-to-Android bridge live smoke. | See bridge checklist below. | File launch findings before enablement. |
| A8 | queued | Update Android-first docs and user-facing copy after smoke results are known. | Static/source review plus touched-file Svelte check. | Brutalist product/security copy review. |
| A9 | blocked | Raw mdoc T3: SessionTranscript reconstruction and DeviceAuth verification. | mdoc fixture tests and capture-replay regression. | Required before `MDL_MDOC=true` or iOS enablement. |
| A10 | blocked | iOS/Apple Business Connect lane. | iOS Safari wallet test. | Requires ABC plus raw mdoc T3. |

## Current Completion

- `A1` committed as `f3d4a1a4` (`Remove campaign direct mDL entrypoint`).
- `A2` committed as `5457d74e` (`Gate Android mDL protocols`).
- `A3a`/`A3b`/`A3c` committed as `8891c9df` (`Harden mDL issuer verification`).
- `A4`/`A5` committed as `5ffd93e7` (`Finalize Android mDL verification`); guard test stabilized as `db62f715`.
- `A6a` pre-smoke readiness committed as `d30811f7` (`Prepare Android mDL live smoke`): bridge completed SSE now carries `credentialHash`, desktop completion fails closed unless the hash is 64-hex and `identityCommitmentBound === true`, Android wallet copy discloses postal code/city/state/birth date/document number across live surfaces and help copy, and `mdl-smoke-readiness` guards protocol-field drift.
- Brutalist review context `3affd4a1-34a2-4f8f-8fff-b079705347c8` was fully paginated without rerun for the final assessment; valid findings folded into `d30811f7`.
- `A6b` request-envelope alignment committed as `aa76a5d9` (`Align Android OpenID4VP request envelope`): same-device and bridge start routes now emit the versioned unsigned OpenID4VP DC API request shape, protocol probes distinguish versioned OpenID4VP from legacy aliases, feature gates still keep raw `org-iso-mdoc` closed, and focused tests lock the DCQL claim paths plus versioned verifier dispatch.
- Brutalist review contexts `4472a180-0d49-47a7-8c4b-ac4e51490628` and `f519aa7e-4dcb-487b-bf68-843ca6ba9680` surfaced the request-shape/protocol drift and exact-protocol filtering issues; accepted findings were fixed before `aa76a5d9`.
- Next tractable target is `A6c`: Android OpenID4VP response handling for Chrome/Wallet DC API `vp_token`/`mso_mdoc` responses, with fail-closed tests before any physical same-device smoke.
- Global `svelte-check` remains a separate repo-health track and is not an Android mDL launch gate unless errors touch this surface.

## Smoke Criteria

Same-device Android smoke (`A6d`) passes only when:

- Android Chrome + Google Wallet mDL accepts the `openid4vp-v1-unsigned` DC API request.
- The verifier normalizes the returned OpenID4VP authorization response and rejects unsupported or unsigned response shapes.
- `mso_mdoc` VP tokens are either verified through the mdoc privacy boundary or rejected fail-closed; no raw disclosed fields leave the boundary.
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
