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
| DC-2 | queued | Make the visible mDL flow device-agnostic: remove Android-required copy, remove platform as the offer gate, and let browser protocol support decide whether to call `navigator.credentials.get`. | Component source guards plus browser feature mocks for Android, desktop Chrome, Safari/WebKit, and unsupported browsers. | Brutalist product/security flow review. |
| DC-3 | queued | Align Google Wallet browser-mediated cross-device OpenID4VP with current docs: signed request support for the DC API lane, `expected_origins`, and encrypted `dc_api.jwt` response handling if required by real-device tests. | Verify-mdl start/verify tests for signed and unsigned compatibility decisions; Chrome desktop real-device QR smoke. | Brutalist OpenID4VP protocol/security review. |
| DC-4 | queued | Retire the custom `/api/identity/direct-mdl/*` QR stack once DC-3 passes cross-device smoke, including `MDL_DIRECT_QR`, direct-session KV, signer secrets, request-object code, SSE/cancel endpoints, and docs. | Source inventory must show no direct QR routes/helpers/flags outside absence guards; production/staging readiness must not mention direct QR. | Brutalist deletion review focused on rollback risk. |
| DC-5 | blocked | Enable Apple/Safari `org-iso-mdoc`: ReaderAuth, Apple verifier certificate/domain validation path, HPKE response handling, SessionTranscript/DeviceAuth verification, and issuer trust coverage. | Raw mdoc fixture suite, capture-replay regression, iOS/Safari real-device smoke. | Brutalist mdoc/Apple security review. |
| DC-6 | queued | Staging smoke on real devices up to the first verified browser-mediated QR presentation: desktop Chrome QR to Android Wallet, desktop Chrome QR to iPhone Wallet where protocol-compatible, and same-device mobile browser flows. | `https://staging.commons.email/api/health`, internal mDL readiness, browser/wallet versions, screenshots/notes of OS affordance, credential finalizer result. | Brutalist staging-smoke readiness gate. |
| DC-7 | queued | Production readiness after staging smoke: branch sync, Cloudflare env cleanup, removal of stale secrets, production probes, and controlled test-account verification. | Main/staging/production at same commit; production internal readiness green; no bridge/direct fallback warnings. | Brutalist production gate. |

## Current Hard Gates

- iOS/Apple Wallet is not enabled until `org-iso-mdoc` verification is complete.
- Google Wallet cross-device may require signed OpenID4VP DC API requests; do not
  assume the existing unsigned request is enough for production desktop QR.
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
