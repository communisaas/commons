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
| A6b | done | Align Android OpenID4VP DC API request envelope: `openid4vp-v1-unsigned`, `response_type=vp_token`, `response_mode=dc_api`, DCQL `mso_mdoc`, exact claim paths, and `intent_to_retain=false` for every mdoc claim. | `verify-mdl-start`, `mdl-protocol-policy`, `mdl-smoke-readiness`, `oid4vp-verify`. | Brutalist contexts `f519aa7e-4dcb-487b-bf68-843ca6ba9680` and `170e2dfc-cdca-4f20-a32b-17a7ea719051`; blocking protocol/filter findings fixed before commit. |
| A6c | done | Normalize Android OpenID4VP response envelopes and fail closed on encrypted `dc_api.jwt` or `mso_mdoc` DeviceResponse payloads until their verifier work exists. | `oid4vp-verify`, `mdl-mdoc`, plus focused Android mDL suites. | Brutalist contexts `c6e02348-86c4-415a-9376-2e8bc2154573` and `f1a930ae-4fec-42a9-a5f2-8eab73a8b280`; valid classifier findings fixed before commit. |
| A6d-a | done | Prepare Android OpenID4VP DC API handover foundation: persist canonical verifier origin, build final-spec SessionTranscript bytes, and protect bridge protocol-binding state under AEAD/AAD. | `oid4vp-dc-api-handover`, `verify-mdl-start`, `bridge-session`, `bridge-crypto`, plus Android mDL focused suites. | Brutalist contexts `5d0ad5d9-374a-445e-9b98-fa3042d09804` and `47662b06-2659-408d-add4-fd3a1c5be1d6`; accepted origin/AEAD findings fixed before commit. |
| A6d-b1 | done | Add the mdoc DeviceAuth `deviceSignature` verifier primitive: parse issuer-signed MSO `deviceKeyInfo.deviceKey`, verify detached COSE_Sign1 signatures over supplied `DeviceAuthenticationBytes`, harden protected-header/COSE_Key parsing, and keep `mso_mdoc` acceptance closed. | `cose-verify`, focused Android mDL suite. | Brutalist contexts `d2e7d9aa-9779-4d95-ac56-ac10a70fdcaf` and `d8bd46ab-de34-436c-810f-aea7bc41a7c9`; accepted COSE/CBOR findings fixed before commit. |
| A6d-b2 | done | Wire Android OpenID4VP `mso_mdoc` DeviceResponse parsing: reconstruct DC API `SessionTranscript`/`DeviceAuthenticationBytes` from stored origin+nonce, verify DeviceAuth with the MSO device key, then pass only verified namespaces through the privacy boundary. | Focused `oid4vp-verify`/`mdl-mdoc`/`cose-verify`/`bounded-json` suite: 128 tests; Android mDL lane: 210 tests. | Brutalist contexts `03c77325-c37a-4c13-94ef-225c672b5903` and `ed9b7171-1b35-483f-9abc-5e95a2cb675b`; accepted findings fixed before commit. |
| A6e | active | Android same-device live smoke: Chrome + Google Wallet mDL on a physical Android device. | See same-device checklist below plus `mdl-smoke-readiness`. | File launch findings before enablement. |
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
- Next tractable target is `A6e`: same-device Android live smoke on physical Chrome + Google Wallet mDL.
- Global `svelte-check` remains a separate repo-health track and is not an Android mDL launch gate unless errors touch this surface.

## Smoke Criteria

Same-device Android smoke (`A6e`) passes only when:

- Android Chrome + Google Wallet mDL accepts the `openid4vp-v1-unsigned` DC API request.
- The verifier normalizes the returned OpenID4VP authorization response and rejects unsupported or unsigned response shapes.
- `mso_mdoc` VP tokens verify through the OpenID4VP DC API DeviceAuth path and privacy boundary; raw `org-iso-mdoc` stays rejected while `MDL_MDOC=false`.
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

`A6d` shares the SessionTranscript and DeviceAuth work with raw mdoc T3, but is scoped to the
OpenID4VP DC API handover used by Android Chrome/Google Wallet.

Raw mdoc T3 unblocks only after SessionTranscript reconstruction, DeviceAuth MAC/signature verification, and sufficient IACA/VICAL coverage for target jurisdictions. iOS remains blocked until raw mdoc T3 and Apple Business Connect are both complete.
