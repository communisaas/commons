# Public-template OG Queue rearm

`REPAIR_EXHAUSTED` is a terminal publication state. Ordinary refreshes must not
clear it or mint more Queue sends. A rearm is an operator recovery after the
Queue/DLQ and daily budget have been inspected; it is not a deployed HTTP
capability.

The tool performs one exact R2 checkpoint read, requires the operator's exact
ETag and coordinate digest, and accepts only an active handoff at the two-send
limit after the repair delay. `--apply` issues a single `If-Match` write and
then reads the exact key back. It changes only `enqueuedOffset`, `enqueuedAt`,
and `enqueueAttempts`. The next producer cycle must still reserve the shared
daily Queue ledger before sending. Publication readiness remains terminal until
the complete target is successfully published. Rearm also cannot reset
`publicationLag.startedAt`: the first trusted R2 acquisition that observed the
unpublished target owns the monotonic 45-minute SLA across retries and
superseding targets. A terminal code fails authenticated `/api/health`
immediately; an otherwise retryable lag fails closed after the exact 45-minute
boundary. Only successful publication clears both conditions.

1. Inspect the Queue, DLQ, daily attempt ledger, and the exact R2 checkpoint.
   Record the checkpoint ETag and `coordinateDigest`. Hash the incident evidence
   bundle with SHA-256.
2. Run the command without `--apply` and save its canonical JSON receipt.
3. Review the receipt, rerun with the same inputs plus `--apply`, and retain the
   successful canonical JSON receipt with the incident evidence.
4. Trigger the normal authenticated producer. Do not repeatedly rearm: a new
   terminal state requires a new inspection and evidence digest.

```bash
npm run ops:rearm-public-template-og -- \
  --environment production \
  --expected-etag "$EXPECTED_ETAG" \
  --coordinate-digest "$COORDINATE_DIGEST" \
  --evidence-sha256 "$EVIDENCE_SHA256"

npm run ops:rearm-public-template-og -- \
  --environment production \
  --expected-etag "$EXPECTED_ETAG" \
  --coordinate-digest "$COORDINATE_DIGEST" \
  --evidence-sha256 "$EVIDENCE_SHA256" \
  --apply
```

Required environment variables are `CLOUDFLARE_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`. The tool accepts only the fixed
production and nonproduction bucket/backend pairs, defaults to dry-run, never
lists R2, never contacts Convex, and never prints credentials.
