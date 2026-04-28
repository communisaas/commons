# Digital Credentials Rollout Graph

This graph replaces the Android-first rollout plan. The primary user flow is the
browser-mediated W3C Digital Credentials API on every browser/OS combination that
supports one of our enabled protocols. Platform copy, Android-only gates, and
web-bridge fallbacks are treated as cleanup targets, not launch scaffolding.

## Operating Rules

- Use capability detection: `DigitalCredential` plus
  `DigitalCredential.userAgentAllowsProtocol(...)`.
- Prefer browser/OS-mediated cross-device QR over verifier-rendered QR. The
  browser-mediated path carries origin binding and CTAP proximity properties.
- Do not keep deprecated user paths as hidden fallbacks. A deleted flow should
  have no route, feature flag, readiness check, test fixture, or active runbook.
- Run every implementation delta through focused tests and a Brutalist review gate
  before commit.

## Status Legend

- `done`: implemented, tested, reviewed, committed
- `impl-done`: implemented locally; review/commit pending
- `active`: current implementation target
- `queued`: defined, not started
- `blocked`: waiting on external onboarding, real-device evidence, or verifier crypto

## Remaining Deltas

| ID | Status | Delta | Verification | Review Gate |
| --- | --- | --- | --- | --- |
| DC-1 | done | Delete the legacy `/verify-bridge` web bridge: routes, mobile page, bridge session/crypto helpers, `MDL_BRIDGE`, readiness checks, tests, secrets/docs. | Source inventory shows no bridge route/helpers/flags outside absence guards; focused mDL readiness/protocol tests pass; `npm run build` passes. | Brutalist contexts `3322dc66-6f36-46dd-ba88-d01707841955` and `373b2304-605f-4335-b69a-d2b20b028895`; accepted stale-reference findings fixed. |
| DC-2 | done | Make the visible mDL flow device-agnostic: remove Android-required copy, remove platform as the offer gate, and let browser protocol support decide whether to call `navigator.credentials.get`. | Source guards show no direct-QR or Android-only path in the verifier; capability-gate tests cover OpenID4VP support, missing protocol probing, and legacy protocol rejection; focused mDL tests and `npm run build` pass. | Brutalist context `08d3170f-87c0-4e80-9044-061112da7583`; accepted TemplateModal copy/capability-gate and `sessionChannel` findings fixed. |
| DC-3a | done | Align Google Wallet browser-mediated cross-device OpenID4VP with current docs: signed DC API request objects, `expected_origins`, response encryption JWK, encrypted `dc_api.jwt` response handling, deploy gates pointed at the browser-mediated route, and direct QR disabled in deploys. | Focused OpenID4VP/start/readiness tests pass; `npm run build` passes. Chrome desktop real-device QR smoke moves to DC-6. | Brutalist contexts `b82e7d92-6e1e-42e7-9958-e918a7b5579c`, `cf82797a-9543-4e81-9afa-82d9142ebfcc`, and `4bf7624a-1b0d-4f0b-8ac7-8873aa4435bb`; accepted findings fixed: direct deploy flag/probes, JWE `kid`, signer cache key, production session KV. |
| DC-3b | done | Remove stale user-facing fallback surface now that browser-mediated QR is the only launch lane: help copy, modal copy, Business Connect deferrals, browser tables that imply unsupported Apple/Safari production support, platform comments, and Android-shaped smoke wording. | Source inventory shows no Android-only, Business Connect, direct-QR, or custom QR copy in the mDL user flow; focused component/source tests pass; `npm run build` passes. | Brutalist context `4a1704a5-6a6d-461e-b5a6-4eb39fa14a41`; accepted copy/comment/smoke findings fixed. |
| DC-3c | active | Fix verification/recovery routing so users with cleared local proof credentials are sent into recovery even when server trust tier is high, and so successful mDL verification does not fall through to stale lower-tier email routing before client state refresh. | Focused TemplateModal/VerificationGate/ProofGenerator behavior tests; no stale-trust-tier routing after mDL completion. | Brutalist user-flow review focused on recovery and stale client trust. |
| DC-4 | queued | Delete the custom `/api/identity/direct-mdl/*` implementation rather than keeping it as a hidden fallback: routes, `MDL_DIRECT_QR`, direct-session KV, direct request-object signer, SSE/cancel endpoints, tests, docs, wrangler binding, and env examples. | Source inventory must show no direct QR routes/helpers/flags outside explicit absence guards; readiness must not mention direct QR. | Brutalist deletion review focused on rollback risk and orphaned references. |
| DC-5 | blocked | Enable Apple/Safari `org-iso-mdoc`: ReaderAuth, Apple verifier certificate/domain validation path, HPKE response handling, SessionTranscript/DeviceAuth verification, and issuer trust coverage. | Raw mdoc fixture suite, capture-replay regression, iOS/Safari real-device smoke. | Brutalist mdoc/Apple security review. |
| DC-6 | queued | Staging smoke on real devices up to the first verified browser-mediated QR presentation: desktop Chrome QR to Android Wallet, desktop Chrome QR to iPhone Wallet where protocol-compatible, and same-device mobile browser flows. | `https://staging.commons.email/api/health`, internal mDL readiness, browser/wallet versions, screenshots/notes of OS affordance, credential finalizer result. | Brutalist staging-smoke readiness gate. |
| DC-7 | queued | Production readiness after staging smoke: branch sync, Cloudflare env cleanup, removal of stale secrets, production probes, and controlled test-account verification. | Main/staging/production at same commit; production internal readiness green; no bridge/direct fallback warnings. | Brutalist production gate. |

## Current Hard Gates

- iOS/Apple Wallet is not enabled until `org-iso-mdoc` verification is complete.
- Google Wallet cross-device uses signed OpenID4VP DC API requests with encrypted
  `dc_api.jwt` responses. Unsigned OpenID4VP parsing is compatibility code for
  historical direct-post sessions only until DC-4 deletes that stack.
- Firefox is not a production target until the browser exposes the Digital
  Credentials API and required protocols without flags.

## Inventory Gates

Run these before closing any deletion delta:

```bash
rg -n "verify-bridge|/api/identity/bridge|MDL_BRIDGE|isMdlBridgeEnabled|bridge-session|bridge-crypto" src tests docs .github wrangler.toml .env.example
rg -n "/api/identity/direct-mdl|MDL_DIRECT_QR|DIRECT_MDL_SESSION_KV|direct-mdl" src tests docs .github wrangler.toml .env.example
```

The first command must return only explicit absence guards after `DC-1`. The
second command must return only explicit absence guards after `DC-4`.
