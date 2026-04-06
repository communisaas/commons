# Cross-Device Verification Bridge

## Purpose

When the user's desktop browser doesn't support the W3C Digital Credentials API (Firefox, older browsers, embedded webviews), verification must happen on a phone that does. The bridge mediates this cross-device flow.

**For Chrome 141+ and Safari 26+, the bridge is not needed** — the DC-API handles cross-device via built-in CTAP2 hybrid transport.

## Architecture

```
Desktop (no DC-API)              Server (KV + SSE)           Phone (has DC-API)
───────────────────              ─────────────────           ──────────────────
POST /bridge/start ────────►  Create bridge session
  ◄── {sessionId, qrUrl,       in KV (5-min TTL)
       pairingCode}

Show QR + pairing code
Open SSE /bridge/stream/{id}
  ◄── heartbeat (15s)                                       User scans QR
                                                             Page loads (GET)
                                                             User clicks "Continue"
  ◄── claimed ◄─────────────  status → claimed ◄──────────  POST /bridge/claim (HMAC)
                                                             User confirms email + code
                                                             Wallet responds
                                                             POST /bridge/complete (HMAC)
  ◄── completed ◄───────────  processCredentialResponse()    Privacy boundary
    {district, state,           Stores derived facts
     cellId, committed}         Clears secret + key

Desktop shows success          Session deleted (TTL)         Phone shows "return to desktop"
```

## Security Model

- **QR = shared secret** — URL fragment contains 256-bit secret (never hits server)
- **HMAC proof of possession** — /claim and /complete verify via HMAC without receiving the secret
- **Email hash anti-phishing** — server verifies client-supplied email hashes to stored emailHash
- **Pairing code** — 3-word phrase displayed on both devices for visual confirmation
- **One-way state transitions** — pending → claimed → completed (irreversible)
- **Encrypted-at-rest** — sensitive KV fields encrypted with AES-256-GCM + HKDF
- **Explicit user gesture** — page load doesn't auto-claim (prevents link-preview DoS)
- **Canonical origin** — QR URL uses PUBLIC_APP_URL (fail-closed in production)

## Files

| File | Purpose |
|------|---------|
| src/lib/server/bridge-session.ts | Session model + KV lifecycle |
| src/lib/server/bridge-crypto.ts | AES-256-GCM encryption for KV fields |
| src/routes/api/identity/bridge/start/ | Create bridge session |
| src/routes/api/identity/bridge/claim/ | HMAC-authenticated claim |
| src/routes/api/identity/bridge/complete/ | Process credential + bind identity |
| src/routes/api/identity/bridge/stream/ | SSE notification to desktop |
| src/routes/verify-bridge/[sessionId]/ | Mobile verification page |
| src/lib/components/auth/GovernmentCredentialVerification.svelte | Desktop component |

## Phase 2: Durable Objects

When bridge traffic justifies the cost, migrate from KV to Durable Objects for true atomic state transitions. See docs/security/KNOWN-LIMITATIONS.md.
