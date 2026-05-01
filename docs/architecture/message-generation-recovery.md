# Message Generation Recovery

**Status**: implemented
**Date**: 2026-04-30

## Problem

Message generation is a multi-step agentic flow with source discovery, source
verification, and writing. The old operational assumption was that the browser
stream was the durable control plane. That fails when the user switches tabs,
the tab hibernates, the network drops, or the SSE response is closed while the
server-side generation is still in flight.

The recovery model treats the browser stream as a view, not as the source of
truth.

## Task Graph

1. Client builds the canonical generation payload.
2. Client computes a stable SHA-256 input hash over that payload.
3. Client generates a per-job RSA-OAEP recovery key pair in IndexedDB.
4. Client sends `job_id`, `input_hash`, and the recovery public key to
   `/api/agents/stream-message`.
5. Server creates or loads the Convex `messageGenerationJobs` row for the
   authenticated user.
6. If the job already exists:
   - `completed`: stream `job-complete` and let the client decrypt.
   - `pending` or `running`: stream `job-running`; do not start a duplicate LLM
     run.
   - `failed` or `expired`: surface a terminal error.
7. If the job is new, server marks it running and executes the existing
   message-writer pipeline.
8. Phase callbacks checkpoint `sources`, `validate`, `generate`, or completion
   progress into Convex.
9. On success, server encrypts the client-visible result with AES-GCM and wraps
   the AES key with the browser recovery public key.
10. Convex stores only recovery metadata, input hash, status, phase, and the
    encrypted result envelope.
11. Client applies live SSE `complete` when available.
12. If the stream closes early or the tab resumes later, client polls
    `/api/agents/message-jobs/[jobId]`, decrypts completed envelopes locally,
    and applies the message.
13. Cron deletes expired recovery envelopes after the short retention window.

## Review Gates

- No plaintext prompt or generated message is persisted in the job ledger.
- Server logs do not include plaintext subject snippets for this path.
- The recovery private key is non-extractable and remains in browser IndexedDB.
- `job_id`, `input_hash`, and `recovery_public_key_jwk` are required together.
- Input hashes must be 64-character lowercase SHA-256 hex strings.
- Recovery public keys must be RSA JWKs with public modulus and exponent.
- Ownership is enforced on every job read and lifecycle mutation.
- An existing active job never starts a second LLM run.
- A closed SSE stream does not abort message generation.
- A write after job expiry cannot resurrect an expired recovery row.
- Legacy clients can still call `/api/agents/stream-message` without job fields.
- Recovery rows have TTL cleanup through Convex cron.

## Deprecated Path

Deprecated operational assumptions:

- Browser SSE connection as the durable job ledger.
- Plaintext subject snippets in server logs.
- Client-only "generating" state without a recoverable server handle.
- Duplicate generation on reload while the first request is still running.

The compatibility endpoint remains the same. The deprecated behavior is removed
by making recoverable job metadata optional for old clients and mandatory for
the new client flow.
