# Direct OpenID4VP QR Contract

Status: A6e complete contract. Direct QR is not default until A6f-A6l pass.

## Purpose

Desktop-to-phone mDL verification should use the Android/Wallet-recognized OpenID4VP
cross-device flow when it is safe to do so. The current `/verify-bridge` QR remains
the fallback because it provides a Commons-controlled confirmation page before wallet
activation.

## Primary References

- OpenID4VP 1.0 final, Section 3.2: cross-device flow renders an Authorization
  Request as a QR code, wallet fetches a Request Object via `request_uri`, and
  sends the presentation to the verifier with `direct_post`.
- OpenID4VP 1.0 final, Section 5.10.1: `request_uri_method=post` returns
  `application/oauth-authz-req+jwt` with a signed request object.
- OpenID4VP 1.0 final, Section 8.2: `direct_post` requires
  `application/x-www-form-urlencoded` response parameters and a `response_uri`.
- OpenID4VP 1.0 final, Section 9 and 13.1.2: wallet invocation can use a custom
  URL scheme such as `openid4vp:` or a domain-bound HTTPS app link.
- OpenID4VP 1.0 final, Appendix B.2.6.1 and B.2.6.2: redirect/direct-post
  mdoc responses use `OpenID4VPHandover`; DC API mdoc responses use
  `OpenID4VPDCAPIHandover`. These are distinct cryptographic handovers.
- OpenID4VP 1.0 final, Section 13.3 and 14.2: direct-post implementations need
  fresh nonce/state, transaction identifiers, response-code or polling protection,
  and explicit session-fixation defenses.
- Android digital credentials docs: Android requests use OpenID4VP, and the
  cross-device demo asks the user to scan a desktop QR with the phone.
- Google Wallet online acceptance docs: Google Wallet supports mdoc digital IDs
  over OpenID4VP 1.0 and displays the registered product name/logo on consent
  screens after RP onboarding.
- Google Wallet online acceptance docs: signed requests are required for
  cross-device flows, with an X.509 certificate registered with Google Wallet.

## QR Payload

A6h must emit a wallet-recognized authorization request, not a Commons web page URL.

Candidate shape:

```text
openid4vp://authorize?client_id=<encoded-client-id>&request_uri=<encoded-request-object-url>&request_uri_method=post
```

If Google Wallet requires an HTTPS App Link rather than `openid4vp://`, the direct
QR endpoint may switch to the wallet-supported HTTPS authorization endpoint. The
invariant is that the QR contains only an authorization endpoint, `client_id`,
`request_uri`, and `request_uri_method=post`. It must not embed the bridge secret
or any long-lived bearer secret.

## Request Object

The `request_uri` endpoint must support the OpenID4VP POST request-uri method. The
wallet POSTs `application/x-www-form-urlencoded` data, including optional
`wallet_metadata` and `wallet_nonce`, and the endpoint returns content type
`application/oauth-authz-req+jwt`.

For Google Wallet cross-device flows, the response is a signed JWT request object
using the RP certificate registered with Google Wallet. The JWS protected header
must include `typ: "oauth-authz-req+jwt"` and the registered certificate chain
needed by the wallet profile. The unsigned JSON below is the payload inside that
signed request object; it is not the HTTP response body:

```json
{
  "client_id": "redirect_uri:https://commons.email/api/identity/direct-mdl/complete",
  "response_uri": "https://commons.email/api/identity/direct-mdl/complete",
  "response_type": "vp_token",
  "response_mode": "direct_post",
  "nonce": "<base64url-16+-random-bytes>",
  "state": "<request-id>",
  "wallet_nonce": "<wallet_nonce from request_uri POST when supplied>",
  "dcql_query": {
    "credentials": [
      {
        "id": "mdl",
        "format": "mso_mdoc",
        "meta": { "doctype_value": "org.iso.18013.5.1.mDL" },
        "claims": [
          {
            "id": "resident_postal_code",
            "path": ["org.iso.18013.5.1", "resident_postal_code"],
            "intent_to_retain": false
          },
          {
            "id": "resident_city",
            "path": ["org.iso.18013.5.1", "resident_city"],
            "intent_to_retain": false
          },
          {
            "id": "resident_state",
            "path": ["org.iso.18013.5.1", "resident_state"],
            "intent_to_retain": false
          },
          {
            "id": "birth_date",
            "path": ["org.iso.18013.5.1", "birth_date"],
            "intent_to_retain": false
          },
          {
            "id": "document_number",
            "path": ["org.iso.18013.5.1", "document_number"],
            "intent_to_retain": false
          }
        ]
      }
    ]
  }
}
```

A6h must replace `client_id` with the Google Wallet registered verifier identifier
required by the selected profile. `request_uri_method=post` belongs only on the QR
authorization request because the signed request object does not contain a
`request_uri`. The session store must persist the exact `client_id`, `response_uri`,
`state`, `nonce`, `wallet_nonce`, `request_uri`, and transport so A6g/A6i can
reconstruct the correct handover and reject cross-transport replay.

## Direct mdoc Handover

Direct QR must not call the existing DC API handover builder. A6g implements a
separate `OpenID4VPHandover` builder for redirect/direct-post mdoc responses:

```text
SessionTranscript = [
  null,
  null,
  [
    "OpenID4VPHandover",
    sha256(cbor([client_id, nonce, jwkThumbprintOrNull, response_uri]))
  ]
]
```

The existing same-device and web-bridge wallet calls continue to use
`OpenID4VPDCAPIHandover`:

```text
SessionTranscript = [
  null,
  null,
  [
    "OpenID4VPDCAPIHandover",
    sha256(cbor([origin, nonce, jwkThumbprintOrNull]))
  ]
]
```

A6g exit tests must include both positive vectors and negative transport-swap tests:
DC API handover bytes must not verify a direct-post response, and direct-post
handover bytes must not verify a DC API response.

## Session Model

Direct QR uses a separate direct-session record, not the bridge session record.

Minimum fields:

- `desktopUserId`: authenticated user from the desktop session.
- `transport`: literal `direct_post`.
- `clientId`, `responseUri`, `requestUri`: exact values sent to the wallet.
- `nonce`: wallet-bound transaction nonce.
- `walletNonce`: wallet-provided request-uri nonce, if present.
- `state`: request id returned in the wallet's direct-post response.
- `transactionId`: server-only desktop completion lookup id.
- `requestFetchedAt`: set when the request object is fetched.
- `completedAt` or `failedAt`: terminal state.
- `createdAt` and `expiresAt`: short TTL matching the existing mDL session window.

The request object may tolerate one scanner prefetch followed by one wallet fetch only
if both reads return the same immutable request object and the completion endpoint still
requires unused `state`, `nonce`, and `transport`. Completion is single-use.

## Account Binding

Direct QR binds to the desktop account only on the server. The phone cannot choose a
user id, and the direct-post endpoint must finalize only `desktopUserId`.

The direct path bypasses the `/verify-bridge` phone confirmation screen. That means the
wallet/OS consent surface must show enough verifier context for a user to notice a QR-swap
attack. Google Wallet's docs say the registered product name and logo are displayed on
the consent screen after RP onboarding; that is verifier-level context, not user-specific
desktop account context.

Launch rule:

- Direct QR may be implemented behind `MDL_DIRECT_QR`.
- Direct QR may be smoked on staging only with test accounts.
- Direct QR cannot become the default desktop path unless real-device smoke confirms the
  wallet surface has acceptable verifier context and the desktop completion UI does not
  finalize silently when account-binding evidence is weak.
- If the account context is insufficient, keep `/verify-bridge` as the default and expose
  direct QR only as an explicitly reviewed fallback or internal smoke path.

## Fallback Bridge Label

The `/verify-bridge` fallback must not display client-supplied email. Its mobile account
label comes from the authenticated desktop session. If the server has no email, it uses a
generic signed-in account label and relies on the pairing code.

## A6e Exit Criteria

- Bridge fallback ignores spoofed client email labels.
- Direct QR contract is documented with separate DC API and direct-post transports.
- Direct QR contract requires Google Wallet signed requests for cross-device flows.
- The next implementation deltas are split into feature flag/session model, direct
  handover, `request_uri`, `direct_post`, UI, staging preflight, and physical smoke.
