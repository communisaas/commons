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
| DC-3a | done | Align Google Wallet browser-mediated cross-device OpenID4VP with current docs: signed DC API request objects, `expected_origins`, response encryption JWK, encrypted `dc_api.jwt` response handling, and deploy gates pointed at the browser-mediated route. | Focused OpenID4VP/start/readiness tests pass; `npm run build` passes. Chrome desktop real-device QR smoke moves to DC-6. | Brutalist contexts `b82e7d92-6e1e-42e7-9958-e918a7b5579c`, `cf82797a-9543-4e81-9afa-82d9142ebfcc`, and `4bf7624a-1b0d-4f0b-8ac7-8873aa4435bb`; accepted findings fixed: stale deploy flag/probes, JWE `kid`, signer cache key, production session KV. |
| DC-3b | done | Remove stale user-facing fallback surface now that browser-mediated QR is the only launch lane: help copy, modal copy, Business Connect deferrals, browser tables that imply unsupported Apple/Safari production support, platform comments, and Android-shaped smoke wording. | Source inventory shows no Android-only or Business Connect copy in the mDL user flow; focused component/source tests pass; `npm run build` passes. | Brutalist context `4a1704a5-6a6d-461e-b5a6-4eb39fa14a41`; accepted copy/comment/smoke findings fixed. |
| DC-3c | done | Fix verification/recovery routing and proof authority: tier-5 users with missing or under-authorized local proof credentials enter recovery; mDL completion, error retry, and address completion re-enter a single guarded CWC proof flow; CWC proof submission requires verified address commitment, matching local proof district, Tier 4+ local proof authority, and server-side Tier 4+ authority checks. | Focused mDL gate/recovery/submission tests pass (26 tests); `git diff --check` passes; `npm run build` passes with pre-existing project warnings. | Brutalist contexts `7c2d6810-915a-4524-8c27-4144b8d3b9c8`, `544bf300-6669-41e0-b888-63e6a0262ddc`, `69e19cce-7010-4fcb-8c7a-b38b3566e4bc`, `7c64ea41-862d-4c83-9c34-1d6d97bd0b11`, and `ecfa1f0d-684e-48fd-b4e1-ab6a6bd2d00e`; accepted findings fixed. |
| DC-4 | done | Delete the custom `/api/identity/direct-mdl/*` implementation rather than keeping it as a hidden fallback: routes, `MDL_DIRECT_QR`, direct-session KV, direct request-object signer, SSE/cancel endpoints, tests, docs, wrangler binding, and env examples. Remove unsigned/direct-post OpenID4VP parsing from the verifier. | Runtime source/config inventory returns no custom direct QR route/helper/flag/protocol matches; readiness exercises browser-mediated signer import/signing, encrypted `dc_api.jwt` envelope extraction, and `DC_SESSION_KV` write/read/delete; focused verifier/readiness/protocol tests and `npm run build` pass. | Brutalist contexts `bd4ae775-82b1-4365-bde7-25390c6880c0`, `dffa65c2-ac67-4ed1-91eb-5b7b172367af`, `f1c76453-9e85-47d4-8113-3883a8294077`, and `c34eb58a-3d5b-455b-a50c-d1f730866197`; accepted findings fixed: readiness encrypted-response probe, fail-closed deleted parser shapes, required JWK thumbprint, stale security docs/e2e QR spec, KV lifecycle probe, stale direct-QR design/UI/operator docs, stale Didit webhook exemption, and removed issuer-bypass env heading. |
| DC-5 | blocked | Enable Apple/Safari `org-iso-mdoc`: ReaderAuth, Apple verifier certificate/domain validation path, HPKE response handling, SessionTranscript/DeviceAuth verification, and issuer trust coverage. | Raw mdoc fixture suite, capture-replay regression, iOS/Safari real-device smoke. | Brutalist mdoc/Apple security review. |
| DC-6a | active | Sync deployed branches to the current browser-mediated-only state. `origin/main`, `origin/staging`, and `origin/production` are currently at `dd6024e5`, while local `main` has the deleted bridge/direct commits; deployed readiness still reports `MDL_BRIDGE` and `MDL_DIRECT_QR`. | Push the current graph/code commit to all three branches, wait for each Pages deployment to succeed, then verify Pages reports the new commit and readiness no longer has bridge/direct feature flags, bindings, or checks. If any deployment fails, stop here and use the Pages rollback/retry path before continuing. | Brutalist deployment-parity gate. |
| DC-6b | queued | Remove deleted-flow ops residue from Cloudflare after deploy parity: bridge/direct secrets and any deleted direct-session binding aliases. These secrets do not keep runtime code alive, but they violate the no-dead-implementation rule. | `wrangler pages secret list --project-name communique-site --env-file .env` shows no `BRIDGE_*`, `MDL_DIRECT_QR_*`, or `DIRECT_MDL_*` secrets; exact stale names are tracked in `docs/development/production-secrets-checklist.md`; readiness remains green after removal. | Brutalist ops-residue gate. |
| DC-6c | queued | Staging readiness smoke on the deployed browser-mediated path before real devices. Localhost is not a meaningful Google Wallet acceptance target; `expected_origins` must be the exact deployed HTTPS origin. Staging can only close if its Pages runtime exposes `PUBLIC_APP_URL=https://staging.commons.email`; if the project cannot isolate this per branch, staging is a code-readiness gate only and real Wallet acceptance must move to the registered production origin. | `https://staging.commons.email/api/health`, internal mDL readiness with `x-readiness-origin: https://staging.commons.email`, decoded request fingerprint notes, and no bridge/direct warnings. | Brutalist staging-readiness gate. |
| DC-6d | queued | Staging real-device smoke with an actual Google Wallet mDL from a Google-supported mDL issuer and a Google-registered verifier certificate/origin. The Google sandbox test credential is an ID pass (`com.google.wallet.idcard.1`) and is not evidence for our mDL-only product query (`org.iso.18013.5.1.mDL`). | Browser/wallet/device versions, verifier origin shown in OS prompt, credential availability or exact wallet error, `/verify` finalizer result if Wallet returns a credential, screenshots/notes. If no operator has a Google-supported mDL, record `blocked: no_credential_available`; verifier infrastructure may proceed to DC-7, but public mDL launch remains blocked. | Brutalist real-device evidence gate. |
| DC-7 | queued | Production readiness after staging smoke: branch parity, Cloudflare env cleanup, production probes, and controlled test-account verification. | Main/staging/production at same commit; production internal readiness green; no bridge/direct fallback warnings; Google verifier certificate/origin registration recorded. | Brutalist production gate. |

## Current Hard Gates

- iOS/Apple Wallet is not enabled until `org-iso-mdoc` verification is complete.
- Google Wallet cross-device uses signed OpenID4VP DC API requests with encrypted
  `dc_api.jwt` responses. Unsigned OpenID4VP, `direct_post`, raw compact JWE,
  `identityToken`, and string `vp_token` response shapes are rejected.
- Google Wallet signed cross-device requests require the deployed verifier origin
  in `expected_origins` and a public certificate registered with Google Wallet.
  Localhost QR association is useful only for browser/API plumbing; it is not a
  Wallet acceptance smoke target.
- Google's sandbox test-ID flow provisions an ID pass (`com.google.wallet.idcard.1`).
  Our product request intentionally asks only for an mDL
  (`org.iso.18013.5.1.mDL`) because the verifier derives district and identity
  commitment from mDL address and license fields.
- CWC proof submission is Tier 4+ at both client and server boundaries. Local
  proof credentials must be `digital-credentials-api` issued, authority-bearing,
  district-bound, and current for the delivery address.
- Firefox is not a production target until the browser exposes the Digital
  Credentials API and required protocols without flags.
- Internal readiness validates the configured request signer can import, sign,
  and pass local certificate/key/date checks. Wallet acceptance of the verifier
  certificate chain and domain binding is proven only by DC-6 real-device smoke.
- Deployed readiness must be on the current source graph before device errors
  are interpreted. A readiness payload containing `MDL_BRIDGE`, `MDL_DIRECT_QR`,
  bridge session KV, or direct request signer checks means the deployment is old.

## Active Execution Graph

1. **DC-6a branch/deploy parity**: push current `main` to `origin/main`,
   `origin/staging`, and `origin/production`; wait for each Cloudflare Pages
   deployment to succeed; verify the readiness payload shape is the current
   browser-mediated one. If any deployment fails, stop and roll back/retry before
   deleting secrets or interpreting wallet results.
2. **DC-6b ops residue cleanup**: remove deleted bridge/direct Cloudflare secrets
   and confirm no deleted-flow names remain in production secret inventory.
3. **DC-6c staging readiness**: run health and internal readiness from an
   operator shell using the exact staging origin. This requires staging runtime
   `PUBLIC_APP_URL` to equal `https://staging.commons.email`; otherwise staging
   cannot prove wallet origin binding.
4. **DC-6d real-device evidence**: test a real Google Wallet mDL, not the sandbox
   ID pass, against the registered staging/prod verifier origin and certificate.
5. **DC-7 production gate**: repeat readiness on `https://commons.email`, then
   run a controlled production verification only after DC-6d evidence is clean.

## Current Evidence Snapshot

- `22a24898` is the local browser-mediated-only source state.
- `origin/main`, `origin/staging`, and `origin/production` were still at
  `dd6024e5` during the 2026-04-30 review.
- `https://staging.commons.email/api/internal/identity/mdl-readiness` and
  `https://commons.email/api/internal/identity/mdl-readiness` still reported
  `MDL_BRIDGE`, `MDL_DIRECT_QR`, `direct_request_signer`, and bridge/direct KV
  surfaces before DC-6a.
- Local `.env` has `PUBLIC_APP_URL=https://commons.email`, but local Vite dev
  does not provide `platform.env.PUBLIC_APP_URL`; the server therefore signs
  local requests with the actual localhost origin. Do not interpret
  `https://localhost:5173` Wallet errors as deployed-origin evidence.
- This graph split was reviewed with Brutalist context
  `7a770d47-e04c-41dc-bf47-c08abf63ac39`; accepted findings were folded into
  DC-6a/DC-6c/DC-6d.

## Inventory Gates

Run these before closing any deletion delta. Runtime source/config inventory must
return no matches for deleted routes, flags, bindings, helper names, and legacy
protocol identifiers. Tests and docs may retain only explicit absence guards and
rollout-history references.

```bash
rg -n "verify-bridge|/api/identity/bridge|MDL_BRIDGE|isMdlBridgeEnabled|bridge-session|bridge-crypto" src tests docs .github wrangler.toml .env.example
rg -n "VITE_MDL_DIRECT_QR|DIRECT_MDL_SESSION_KV|MDL_DIRECT_QR|direct-mdl|directMdl|DirectMdl|direct QR|Direct QR|custom QR|direct_post|directPost|oid4vp-direct|UNSIGNED_OPENID4VP|LEGACY_OPENID4VP|openid4vp-v1-unsigned" src .github wrangler.toml .env.example package.json
rg -n "VITE_MDL_DIRECT_QR|DIRECT_MDL_SESSION_KV|MDL_DIRECT_QR|direct-mdl|directMdl|DirectMdl|direct QR|Direct QR|custom QR|direct_post|directPost|oid4vp-direct|UNSIGNED_OPENID4VP|LEGACY_OPENID4VP|openid4vp-v1-unsigned" tests docs --glob '!docs/archive/**'
```

The bridge command must return only explicit absence guards after `DC-1`. The
direct/legacy runtime command must return no matches after `DC-4`; the
tests/docs command must return only explicit absence guards or this rollout
graph.
