# Android mDL Rollout Graph

This graph tracks the Android-first mDL rollout as implementation -> review -> commit cycles.
Android OpenID4VP is the functional lane; raw mdoc, iOS, and Apple Business Connect remain
separate gates and are not prerequisites for Android device rollout.

There are two Android OpenID4VP transports from here:

1. Same-device mobile browser: `navigator.credentials.get({ digital })` with
   `response_mode=dc_api`.
2. Desktop-to-phone direct QR: wallet-recognized OpenID4VP authorization request
   using `request_uri` and `direct_post`, so Android Camera can hand off directly
   to the OS/wallet instead of first opening `/verify-bridge`.

The existing `/verify-bridge` web flow remains the fallback and security reference path.

## Status Legend

- `done`: implemented, tested, reviewed, committed
- `impl-done`: implemented in the working tree; review/commit still pending
- `review-blocked`: implemented and tested, but the required review gate could not complete
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
| A6b | done | Align Android OpenID4VP DC API request envelope: `openid4vp-v1-unsigned`, `response_type=vp_token`, `response_mode=dc_api`, DCQL `mso_mdoc`, exact claim paths, and `intent_to_retain=false` for every mdoc claim. | `verify-mdl-start`, `mdl-protocol-policy`, `mdl-smoke-readiness`, `oid4vp-verify`. | Brutalist contexts `f519aa7e-4dcb-487b-bf68-843ca6ba9680` and `170e2dfc-cdca-4f20-a32b-17a7ea719051`; blocking protocol/filter findings fixed before commit. |
| A6c | done | Normalize Android OpenID4VP response envelopes and fail closed on encrypted `dc_api.jwt` or `mso_mdoc` DeviceResponse payloads until their verifier work exists. | `oid4vp-verify`, `mdl-mdoc`, plus focused Android mDL suites. | Brutalist contexts `c6e02348-86c4-415a-9376-2e8bc2154573` and `f1a930ae-4fec-42a9-a5f2-8eab73a8b280`; valid classifier findings fixed before commit. |
| A6d-a | done | Prepare Android OpenID4VP DC API handover foundation: persist canonical verifier origin, build final-spec SessionTranscript bytes, and protect bridge protocol-binding state under AEAD/AAD. | `oid4vp-dc-api-handover`, `verify-mdl-start`, `bridge-session`, `bridge-crypto`, plus Android mDL focused suites. | Brutalist contexts `5d0ad5d9-374a-445e-9b98-fa3042d09804` and `47662b06-2659-408d-add4-fd3a1c5be1d6`; accepted origin/AEAD findings fixed before commit. |
| A6d-b1 | done | Add the mdoc DeviceAuth `deviceSignature` verifier primitive: parse issuer-signed MSO `deviceKeyInfo.deviceKey`, verify detached COSE_Sign1 signatures over supplied `DeviceAuthenticationBytes`, harden protected-header/COSE_Key parsing, and keep `mso_mdoc` acceptance closed. | `cose-verify`, focused Android mDL suite. | Brutalist contexts `d2e7d9aa-9779-4d95-ac56-ac10a70fdcaf` and `d8bd46ab-de34-436c-810f-aea7bc41a7c9`; accepted COSE/CBOR findings fixed before commit. |
| A6d-b2 | done | Wire Android OpenID4VP `mso_mdoc` DeviceResponse parsing: reconstruct DC API `SessionTranscript`/`DeviceAuthenticationBytes` from stored origin+nonce, verify DeviceAuth with the MSO device key, then pass only verified namespaces through the privacy boundary. | Focused `oid4vp-verify`/`mdl-mdoc`/`cose-verify`/`bounded-json` suite: 128 tests; Android mDL lane: 210 tests. | Brutalist contexts `03c77325-c37a-4c13-94ef-225c672b5903` and `ed9b7171-1b35-483f-9abc-5e95a2cb675b`; accepted findings fixed before commit. |
| A6e | done | Direct QR contract, QR payload, and account-binding decision: confirm the Google Wallet/Android Camera-recognized payload shape, define the phishing posture, and fix the fallback bridge account label so it is server-derived or pairing-code-only. | Direct QR contract doc plus bridge-start spoofing tests. | Brutalist contexts `28311067-1668-40eb-bac9-6b4867c4385e`, `2bbc2238-755d-4a38-b9fc-e77d79805643`, and `1a9bbc2d-231a-4145-9249-1cb3443e7c71`; accepted findings fixed before commit. |
| A6f | done | Direct QR feature flag and session model: add `MDL_DIRECT_QR`, a direct-session store separate from bridge sessions, explicit `transport=response_mode=direct_post`, TTL, nonce/state, request fetch state, completion state, and rollback isolation. | Unit tests for flag gating, session lifecycle, stale/duplicate transitions, and transport mismatch. | Brutalist context `3c8a55b1-4699-4618-ab0b-fde805b783f9`; no blocking findings, accepted hardening folded in before commit. |
| A6g | done | Cross-device OpenID4VP mdoc handover: implement a direct-post SessionTranscript/DeviceAuth path separate from `OpenID4VPDCAPIHandover`, with vectors that prove DC API bytes cannot be reused. | Golden cross-device SessionTranscript vector, negative DC API/direct transport swap tests, `oid4vp-verify`, `mdl-mdoc`, and `cose-verify`. | Brutalist context `36f10345-efb3-4f66-a9f7-2977edd25513`; false-positive 3-element handover claim checked against final spec, accepted exact-string preservation before commit. |
| A6h | done | Direct `request_uri` endpoint and request object: emit the wallet-recognized OpenID4VP request, no embedded QR secret, strict client metadata, state/nonce binding, scanner-prefetch tolerance, and fetch replay behavior. | `direct-mdl-request`, `direct-mdl-request-object`, `direct-mdl-session`, focused direct/DC handover and verifier regression suites. | Brutalist contexts `ae6a6cc4-03ad-4b32-adf9-5f12224f7179` and `71892146-4dc8-44f2-82c1-8d0e753a8c1c`; accepted findings fixed before commit. |
| A6i | done | Direct `direct_post` completion endpoint: parse OpenID4VP response parameters strictly, require state/session/transport match, verify mDL through the direct handover, finalize only the bound desktop user, and update the desktop completion channel. | Route tests for valid completion, stale/duplicate/mismatched state, malformed forms/JSON, extension params, wallet errors, finalizer binding, credential-hash reuse, and session-nonce reuse. | Brutalist context `c378146a-f523-47c6-afde-12748454c3d8`; accepted OpenID4VP response-param compatibility fixed before commit. |
| A6j | done | Direct OpenID4VP QR desktop UI and account-binding posture: render the wallet-recognized QR as the primary desktop Android path only after first-valid-presenter risk is explicitly accepted or mitigated, show desktop account/pairing context where meaningful, and keep `/verify-bridge` as fallback. | Touched-file Svelte check, component/source smoke, QR payload inspection confirming it is not a Commons web URL, direct cancel/retry tests, and product/security evidence for the account-context decision. | Brutalist contexts `ea401916-65cf-489c-9014-e5eca16d328e`, `bf7b07bc-abb5-4042-9545-2688ad6dce91`, and `78b8339c-c05d-4aa3-82d5-5ac5ae537020`; accepted recovery/copy/signer findings fixed before commit. |
| A6k | active | Staging preflight for real-device smoke: branches aligned, CI/deploy green, immutable Pages health green, external custom-domain health green, direct/bridge KV and encryption bindings verified, direct request fetch plus direct completion/finalizer atomicity reviewed, direct flag state verified, and test-account isolation/cleanup ready. | Branch/CI/deploy checklist below, `mdl-smoke-readiness`, `/api/internal/identity/mdl-readiness`, direct-session readiness checks, and real-wallet request_uri header/body capture. | Brutalist launch-readiness gate; no device smoke until findings are resolved or explicitly accepted. |
| A6l | queued | Physical Android smoke: same-device Chrome + Google Wallet mDL, then desktop direct OpenID4VP QR scanned by Android Camera with immediate OS/wallet presentation affordance. | Real device checklist below; record phone/browser/wallet versions and wallet UI observations. | File launch findings before enablement; direct QR cannot become default if account-context/phishing signal is missing without explicit review acceptance. |
| A7 | queued | `/verify-bridge` fallback live smoke after direct QR is working. | See bridge fallback checklist below. | File fallback findings before enablement. |
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
- `A6b` request-envelope alignment committed as `aa76a5d9` (`Align Android OpenID4VP request envelope`) with follow-up `c301e4c0` (`Restore mdoc retention flags`): same-device and bridge start routes now emit the versioned unsigned OpenID4VP DC API request shape, protocol probes distinguish versioned OpenID4VP from legacy aliases, feature gates still keep raw `org-iso-mdoc` closed, focused tests lock the DCQL claim paths plus versioned verifier dispatch, and every requested mdoc claim carries `intent_to_retain=false`.
- Brutalist review contexts `4472a180-0d49-47a7-8c4b-ac4e51490628` and `f519aa7e-4dcb-487b-bf68-843ca6ba9680` surfaced the request-shape/protocol drift and exact-protocol filtering issues; accepted findings were fixed before `aa76a5d9`.
- `A6c` response-envelope normalization committed as `4de4239a` (`Fail closed on Android OpenID4VP mdoc responses`): JWT/SD-JWT OpenID4VP fixtures still require signature verification, DigitalCredential envelopes are protocol-bound, encrypted `dc_api.jwt` response markers fail closed, `mso_mdoc` VP token arrays fail closed with a DeviceAuth gate, and mixed or ambiguous envelopes are rejected before address lookup.
- `A6d-a` handover foundation committed as `41c26bc7` (`Prepare OpenID4VP DC API handover`): the same-device start route now persists a canonical verifier origin, bridge sessions normalize the verifier origin, bridge origin/nonce/requests/secret/private key are AEAD-protected with public session metadata as AAD, encrypted bridge records cannot be downgraded to plaintext outside dev, and a final OpenID4VP DC API CBOR vector locks SessionTranscript byte construction.
- Brutalist review contexts `5d0ad5d9-374a-445e-9b98-fa3042d09804` and `47662b06-2659-408d-add4-fd3a1c5be1d6` were fully paginated without `resume=true`; accepted findings were canonical origin alignment, bridge-origin AEAD coverage, bridge session metadata AAD, and localhost-production origin rejection.
- `A6d-b1` DeviceAuth primitive committed as `ee0786c6` (`Add mdoc DeviceAuth signature verifier`): issuerAuth Sig_structure encoding now uses plain CBOR byte strings instead of `cbor-web` typed-array tags, protected COSE headers reject duplicate/text-keyed alg labels before decode normalization, present-but-invalid MSO `deviceKeyInfo` fails closed, COSE EC2 device keys require integer labels with matching optional `alg`/`key_ops`, detached DeviceSignatures verify over caller-supplied `DeviceAuthenticationBytes`, and wrong-key/replay/non-detached cases are covered in `cose-verify`.
- Brutalist contexts `d2e7d9aa-9779-4d95-ac56-ac10a70fdcaf` and `d8bd46ab-de34-436c-810f-aea7bc41a7c9` reviewed `A6d-b1`; accepted findings were the shared byte-string Sig_structure encoder, duplicate protected-label rejection, strict COSE_Key labels, present-malformed deviceKeyInfo failure, cbor-web default import handling, bounded protected-header scan recursion, and wrong-key/text-label tests.
- `A6d-b2` Android OpenID4VP `mso_mdoc` acceptance is complete in this delta: versioned DC API sessions now reject JWT/SD-JWT fallback tokens, decode exactly one mDL DeviceResponse/document, verify issuerAuth against IACA/VICAL roots, enforce signed MSO docType and validity, fail closed on unsigned/duplicate namespace elements, rebuild the DC API SessionTranscript from stored origin+nonce, verify DeviceAuth.deviceSignature with the MSO device key, and keep DeviceMac/raw mdoc closed.
- Brutalist context `03c77325-c37a-4c13-94ef-225c672b5903` found unsigned item injection, missing MSO validity/docType checks, unbounded same-device data, plaintext bridge commitment result storage, and protocol binding gaps; all accepted findings were patched.
- Brutalist context `ed9b7171-1b35-483f-9abc-5e95a2cb675b` found the versioned JWT fallback lane, parse-before-cap body handling, duplicate signed element identifiers, identity-commitment log prefix leakage, and COSE alg/curve defense-in-depth gaps; accepted findings were patched before commit.
- Brutalist security review context `28311067-1668-40eb-bac9-6b4867c4385e` was fully paginated without `resume=true`; accepted graph findings were direct-specific SessionTranscript work, a separate feature flag/session model, request_uri/direct_post split, explicit account-binding/phishing gates, fallback bridge label repair, and stronger production-backed staging preflight.
- `A6e` direct QR contract and fallback bridge label repair are complete in this delta: `/api/identity/bridge/start` now derives the phone-facing account label from the authenticated desktop server session, ignores spoofed client email bodies, and rejects mismatched `locals.user`/session bindings; the direct QR contract requires a signed Google Wallet cross-device OpenID4VP request object fetched with `request_uri_method=post`, `direct_post` completion, no embedded Commons bridge secret, and a separate `OpenID4VPHandover` path from DC API.
- Brutalist implementation review context `2bbc2238-755d-4a38-b9fc-e77d79805643` found the unsigned request-object drift and handover ambiguity; both findings were patched before commit.
- Brutalist final gate context `1a9bbc2d-231a-4145-9249-1cb3443e7c71` found one remaining contract ambiguity: `request_uri_method=post` must appear only on the QR authorization request, not inside the signed request-object payload. The sample was corrected before commit.
- `A6f` direct QR flag and session model are complete in this delta: `MDL_DIRECT_QR` remains default-off, `requireMdlDirectQrEnabled()` is available for future routes, direct sessions use a separate `direct-mdl:` KV namespace with `DIRECT_MDL_SESSION_KV` typing, and lifecycle transitions bind `direct_post`, TTL, state, wallet nonce, and terminal state.
- Brutalist backend/security context `3c8a55b1-4699-4618-ab0b-fde805b783f9` found no commit blocker. Accepted hardening was added before commit: direct failure messages are bounded/normalized, `DIRECT_MDL_SESSION_KV` is typed on `App.Platform`, and A6g must handle KV read-modify-write race risk plus ensure future endpoints never pass client-controlled nonce/state/transaction IDs.
- `A6g` direct-post handover is complete in this delta: direct OpenID4VP mdoc verification now rebuilds `OpenID4VPHandover` from stored `client_id`, `nonce`, optional JWK thumbprint/null, and `response_uri`; the existing DC API path continues to rebuild `OpenID4VPDCAPIHandover` only from the stored verifier origin; missing or ambiguous handover context fails closed; transport-swap tests prove DC API DeviceAuth bytes cannot satisfy direct verification and direct DeviceAuth bytes cannot satisfy DC API verification.
- Brutalist protocol/crypto context `36f10345-efb3-4f66-a9f7-2977edd25513` raised a 3-element direct handover claim that was rejected after checking the OpenID4VP 1.0 final text, which defines `OpenID4VPHandoverInfo = [clientId, nonce, jwkThumbprint, responseUri]`. The valid hardening finding was patched: direct handover validation now preserves the exact signed-request `client_id` and `response_uri` strings instead of serializing them through `URL.toString()`.
- `A6h` request_uri/request-object implementation is complete in this delta: the route is hidden behind `MDL_DIRECT_QR`, accepts only OpenID4VP POST request-uri form fetches with explicit `Accept: application/oauth-authz-req+jwt` and a valid `wallet_nonce`, validates current request_uri/session binding, pins `response_uri` to the direct completion endpoint, signs `application/oauth-authz-req+jwt` request objects with registered x5c key material, uses signed-compatible `x509_san_dns:` client identifiers, includes `iss`/`aud`, server-bound nonce/state/client_id/response_uri, optional wallet_nonce, and DCQL mso_mdoc claims, stores the immutable JWT on first sequential fetch, and returns the exact same object for idempotent refetches with the same wallet nonce.
- Brutalist A6h contexts `ae6a6cc4-03ad-4b32-adf9-5f12224f7179` and `71892146-4dc8-44f2-82c1-8d0e753a8c1c` found valid request-surface issues; accepted fixes were signed-compatible client IDs instead of `redirect_uri:`, response_uri pinning, stricter Accept/wallet_nonce/body handling, `iss`/`aud` in the Request Object, and pre-sign wallet_nonce validation. Remaining finding: Cloudflare KV cannot provide cross-colo atomic first-fetch semantics, so direct QR must remain default-off and A6k must either move direct sessions/request-object fetches to an atomic primitive (Durable Object/D1 conditional write) or explicitly accept the race only for constrained smoke.
- `A6i` direct completion is complete in this delta: the direct_post route is feature-gated, form-bounded, state-indexed, verifier-bound to the session nonce/client_id/response_uri, and finalizes only `session.desktopUserId` through `internal.users.finalizeMdlVerification`; the finalizer ledger now rejects active session nonce reuse so two different valid credentials cannot both complete the same nonce at the durable Convex boundary; OpenID4VP extension response parameters are ignored while wallet error responses are handled without making the session terminal.
- Brutalist context `c378146a-f523-47c6-afde-12748454c3d8` reviewed `A6i`. Accepted finding fixed before commit: direct_post response parsing must ignore unrecognized response parameters such as `presentation_submission` instead of failing compliant wallets. Residual pre-flag-on findings remain in `A6j`/`A6k`: first-valid-presenter QR account-binding posture and KV/finalizer repairability under infrastructure failure.
- `A6j` direct QR desktop UI is complete in this delta: `/api/identity/direct-mdl/start` creates authenticated desktop direct sessions and emits an `openid4vp://authorize` QR payload after signer preflight; `/api/identity/direct-mdl/stream/{sessionId}` carries request-fetched/completed/failed/expired events back to the desktop; `/api/identity/direct-mdl/cancel` invalidates abandoned direct QR sessions; the desktop component shows requested mDL fields plus the server-derived account label, validates `credentialHash` and `identityCommitmentBound`, fails closed on invalid completions, cancels old direct sessions on retry/fallback/back/destroy, and keeps the guided `/verify-bridge` path available.
- Brutalist contexts `ea401916-65cf-489c-9014-e5eca16d328e`, `bf7b07bc-abb5-4042-9545-2688ad6dce91`, and `78b8339c-c05d-4aa3-82d5-5ac5ae537020` reviewed `A6j`. Accepted findings fixed before commit: old direct sessions must be cancelled on retry/fallback, wallet/verifier failures must reach the desktop stream, signer config must fail before a QR is shown, direct copy must disclose birth date/document number and raw-field non-storage, direct QR rendering failures must not spin forever, and direct completion must propagate `requireReauth`. Residual pre-flag-on findings move to `A6k`/`A6l`: first-valid-presenter account binding, actual Google Wallet `request_uri` `Accept`/`wallet_nonce` behavior, and whether 300s direct TTL is acceptable on real devices.
- Next tractable target after the `A6j` gate is `A6k`: staging preflight for real-device smoke.
- `A6k` implementation is in progress: staging branch deploys compile direct QR on with
  `VITE_MDL_DIRECT_QR=1` plus `VITE_MDL_DIRECT_QR_ORIGIN=https://staging.commons.email`,
  production/main keep it off, runtime direct routes reject non-staging `PUBLIC_APP_URL`, and
  `/api/internal/identity/mdl-readiness` reports feature state, direct signer usability,
  `PUBLIC_APP_URL` origin matching, KV bindings, bridge encryption, request-object contract,
  and same-device protocol state behind `X-Internal-Secret`.
- Brutalist A6k contexts `44feeded-fbb4-407c-a4a0-cb27b8d22d41` and
  `aaabf1b7-c50f-436f-a057-b50b4a9af28e` reviewed the preflight delta. Accepted findings
  fixed before commit: staging direct QR needs a hardcoded build-time allowed origin, live direct
  routes must enforce that runtime `PUBLIC_APP_URL` matches the staging origin, and those routes
  must also reject requests served from any non-staging origin. Residual staging-smoke warnings:
  readiness proves signer import/signing but not external verifier-certificate registration or
  Google Wallet trust, and shared `DC_SESSION_KV` fallback remains acceptable only for controlled
  test-account smoke until dedicated bridge/direct namespaces are provisioned.
- Global `svelte-check` remains a separate repo-health track and is not an Android mDL launch gate unless errors touch this surface.

## Direct OpenID4VP QR Decision

The desktop QR should not be a Commons web URL when Android can handle a wallet-recognized
OpenID4VP request directly. The current bridge QR points at `/verify-bridge/{sessionId}#secret`,
so Android Camera treats it as a web link and the OS wallet affordance appears only after the
mobile page calls the Digital Credentials API. The direct lane restores the initial behavior:
scan desktop QR -> Android recognizes the credential request -> user presents ID from the wallet.

The direct lane must still preserve the security properties that made the web bridge safe:

- The session is created only by an authenticated desktop user.
- The wallet response finalizes only that server-bound desktop user; the phone cannot choose
  or override the user ID.
- `request_uri` and `direct_post` are single-use, TTL-bound, nonce-bound, and replay-checked.
- The request object contains a user-visible account or pairing signal where the wallet/OS
  profile can surface it. If physical smoke shows no meaningful account context, direct QR
  stays behind the fallback bridge until a Brutalist-reviewed mitigation is accepted.
- The fallback bridge cannot display a client-supplied email as the trust label unless the
  server verifies it belongs to the authenticated desktop user.
- `/verify-bridge` remains available for unsupported devices, QR scanners that do not route
  OpenID4VP, or any wallet that mishandles direct requests.

Protocol split:

- Same-device Android browser keeps `openid4vp-v1-unsigned` over DC API with
  `response_mode=dc_api`.
- Desktop direct QR uses the OpenID4VP cross-device shape: a compact authorization request
  containing a `request_uri`; the wallet retrieves the request object and returns the VP token
  with `direct_post`.

## Smoke Criteria

Staging real-device smoke (`A6k`/`A6l`) passes only when:

- `main`, `staging`, and `production` point at the same reviewed commit, with CI and
  Cloudflare immutable Pages deploy health green for that commit.
- The `Configure Cloudflare Branch Alias` workflow has verified or updated
  `staging.commons.email` as a proxied CNAME to `staging.communique-site.pages.dev` and
  passed the internal mDL readiness probe.
- External custom-domain health checks return JSON `status: "ok"` before device testing:

  ```bash
  curl --fail-with-body -sS https://staging.commons.email/api/health | jq -e '.status == "ok"'
  curl --fail-with-body -sS https://commons.email/api/health | jq -e '.status == "ok"'
  ```

- Android Chrome + Google Wallet mDL accepts the `openid4vp-v1-unsigned` DC API request.
- The verifier normalizes the returned OpenID4VP authorization response and rejects unsupported or unsigned response shapes.
- `mso_mdoc` VP tokens verify through the OpenID4VP DC API DeviceAuth path and privacy boundary; raw `org-iso-mdoc` stays rejected while `MDL_MDOC=false`.
- `/api/identity/verify-mdl/start` returns no `org-iso-mdoc` request while `MDL_MDOC=false`.
- `/api/identity/verify-mdl/verify` upgrades the canonical user through the internal finalizer.
- A forged or unsupported `org-iso-mdoc` verify request is rejected while `MDL_MDOC=false`.
- Desktop direct QR is wallet-recognized by Android Camera/OS and does not scan as a plain
  Commons web URL.
- The direct request object's nonce/session maps to exactly one authenticated desktop user.
- The wallet direct-post response upgrades that desktop user through the internal finalizer
  and updates the desktop completion channel.
- Stale, duplicate, mismatched, and unsupported direct-post responses fail without completing
  or mutating the session.
- Direct-session readiness verifies KV bindings, direct feature flag state, request/response
  endpoint availability, and bridge encryption configuration; `/api/health` alone is not enough.
- Internal direct-session readiness is checked with:

  ```bash
  curl --fail-with-body -sS \
    -H "X-Internal-Secret: $INTERNAL_API_SECRET" \
    https://staging.commons.email/api/internal/identity/mdl-readiness | jq
  ```

- If staging still shares production Convex/KV, use dedicated test accounts and record cleanup
  for mDL credential-use rows and identity state touched by the smoke.
- iOS Safari remains unavailable while `MDL_IOS=false`.

Bridge fallback smoke (`A7`) passes only when:

- Desktop starts a bridge session and phone claim binds to the displayed pairing code.
- Phone completion verifies the credential and SSE/status polling reaches the desktop.
- Duplicate or stale completion attempts fail without changing the completed session.
- KV bridge sessions expire naturally within the configured TTL.

## Rollback

Android rollback is a redeploy with `MDL_ANDROID_OID4VP=false`, `MDL_DIRECT_QR=false`,
and `MDL_BRIDGE=false`.
Raw mdoc and iOS stay false throughout this lane. In-flight verification and bridge sessions expire from KV within roughly five minutes; no user tier downgrade is automatic.

## Dependency Notes

Android mDL rollout is independent of the V2 proof-generation cutover. Users verified during the V1 proof era remain subject to the V2 credential cutover runbook when `V2_PROOF_GENERATION` is enabled.

`A6d` shares the SessionTranscript and DeviceAuth work with raw mdoc T3, but is scoped to the
OpenID4VP DC API handover used by Android Chrome/Google Wallet.

`A6g` adds the cross-device OpenID4VP request-uri/direct-post handover. That transport has a
different handover from `response_mode=dc_api`, so direct QR verifier tests must not reuse the
DC API SessionTranscript assumptions without an explicit protocol check.

Raw mdoc T3 unblocks only after SessionTranscript reconstruction, DeviceAuth MAC/signature verification, and sufficient IACA/VICAL coverage for target jurisdictions. iOS remains blocked until raw mdoc T3 and Apple Business Connect are both complete.
