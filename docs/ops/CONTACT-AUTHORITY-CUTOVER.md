# Contact authority cutover

This plane makes email and SMS consent a constant-cardinality send decision. Provider ingress writes one compact global authority row plus an idempotent fanout job before returning success. Supporter rows are an eventually converged projection; they are never the final authority for a send.

Do not cache contact admission in Cloudflare, KV, a browser, or an action. The authoritative lookup is an exact Convex index point-read and must observe the latest committed STOP, START, bounce, complaint, suppression, or local unsubscribe epoch. Public landing-page caching is independent of this safety boundary.

## Fixed envelopes

- Provider event: at most 50 contact hashes, 4 KiB compact job payload.
- Fanout page: 32 supporters, 256 KiB maximum read, 2 KiB cursor.
- Migration page: 100 supporters, 512 KiB maximum read.
- Manual bounce consensus: at most 100 report reads/writes per transaction.
- Worker retry: six attempts with bounded exponential backoff.
- Operator evidence: at most 100 append-only job events per read.

The ingress mutation never enumerates supporters. Native scheduling starts the worker in the same transaction; the essential one-minute cron is an orphan-recovery backstop. STOP authority is synchronous even if every worker is down.

## Deployment order

1. Keep email and SMS dispatch launch flags disabled.
2. Deploy the schema, authority writers, worker, essential crons, health plane, and final carrier-epoch checks together.
3. Start the self-paged audit and legacy-deny adoption:

   ```sh
   npx convex run webhooks:startContactAuthorityMigration
   ```

4. Poll `webhooks:contactFanoutReadiness` with the current Unix time in milliseconds. It must report `ready: true`, no `failureCode`, no `failedJobId`, and no overdue pending job.
5. Check `/api/health`. `launchProjectionPlanes.contactAuthority.ready` must be true. This stricter launch plane remains false while any fanout job is pending or failed.
6. Run the contact-focused tests listed below, then enable carrier dispatch only as part of the coordinated launch-gate release.

Never insert or patch the migration marker to `ready` manually. The migration fails closed when an eligible or legacy-deny row lacks the global hash needed for an exact lookup. Repair the source row, restart the migration, and let the audit reach the end itself.

## Migration truth

The audit adopts pre-cutover denial state, not merely row shape:

- complaint dominates bounce and subscribed across every organization sharing an email hash;
- bounce dominates subscribed;
- one legacy SMS `stopped` row creates a global STOP, regardless of subscribed sibling rows;
- positive/subscribed legacy rows never clear a denial;
- a repeated page or restarted migration is idempotent and does not advance the authority epoch when truth is unchanged.

## START and reply routing

STOP is global and does not need organization routing. START and ordinary replies require exactly one `orgTwilioNumbers.by_phoneNumber` match for Twilio's `To` number.

Missing, unregistered, or multiply registered destinations create a durable failed job and do not change authority. In particular, an unscoped START can never become a global opt-in. Correct the number registry—or choose an organization explicitly during the internal recovery—and retry the same job.

## Failed-job recovery

There is deliberately no “acknowledge and ignore” path. Launch/readiness stays closed until the original job completes.

1. Read the `failedJobId` from `webhooks:contactFanoutReadiness`.
2. Inspect its bounded evidence:

   ```sh
   npx convex run webhooks:listContactFanoutJobEvents '{"jobId":"<job-id>","limit":50}'
   ```

3. Repair the cause. Common codes:

   - `SMS_START_ROUTE_*` / `SMS_REPLY_ROUTE_*`: fix `orgTwilioNumbers` or provide the intended org ID.
   - `SMS_REPLY_SUPPORTER_MULTIPLICITY`: repair duplicate org-plus-phone supporter rows.
   - `CONTACT_FANOUT_ATTEMPTS_EXHAUSTED`: repair the recorded `lastError` source.
   - `CONTACT_FANOUT_PAGE_SPLIT_REQUIRED`: reduce oversized supporter documents before retrying.

4. Requeue the same job and cursor:

   ```sh
   npx convex run webhooks:retryContactFanoutJob '{"jobId":"<job-id>"}'
   ```

   For a missing/ambiguous SMS route after an operator has established the intended tenant:

   ```sh
   npx convex run webhooks:retryContactFanoutJob '{"jobId":"<job-id>","scopeOrgId":"<org-id>"}'
   ```

5. Poll readiness until the job is complete. The append-only `ingress_failed`, `worker_failed`, and `operator_retry` events remain as recovery evidence.

## Carrier-boundary epoch

Every global authority write and every local contact-eligibility transition atomically increments `contactAuthorityEpochs.global`. Bulk dispatch captures the epoch with its cohort and compares it in the final serializable mutation before the TEE, SES, or workflow carrier call. Any intervening STOP, unsubscribe, bounce, complaint, contact identity change, or supporter deletion invalidates the materialized cohort.

Provider retries with the same SES/Twilio event ID reuse the existing job and do not advance the epoch twice.

## Outbound SMS launch hold

Bulk outbound SMS is deliberately not launchable in this release. `TEXT_DISPATCH_ONE_SHOT_CLAIMS_READY` is a non-overridable compile-time tombstone, independent of the ordinary SMS feature flag and Twilio credentials.

The existing HTTP runner authorizes an entire page before up to 100 sequential Twilio calls and records results only after the loop. That creates two unacceptable windows: a STOP committed during the loop can stale-authorize later recipients, and a process failure after carrier acceptance can lose the receipt and double-send on retry. Do not lift the tombstone merely because the provider credentials or browser decryptor are available.

Activation requires a separately reviewed durable carrier plane with all of these properties:

- one one-shot dispatch identity per blast plus supporter;
- a final per-recipient Convex authority claim immediately before each Twilio POST;
- a STOP committed before that claim denies the call and leaves durable skip evidence;
- accepted, rejected, and outcome-unknown results are persisted immediately per recipient;
- a claimed or outcome-unknown identity is never automatically sent again;
- operator reconciliation can resolve ambiguous claims from Twilio evidence without erasing the audit trail;
- readiness and health fail closed on unresolved or overdue claims.

A STOP after the final claim is honestly classified as arriving after carrier authority was already in flight; Convex and Twilio cannot share one transaction. The claim timestamp and authority epoch must make that ordering auditable.

## Verification

```sh
npx vitest run convex/contact-authority-foundations.convex.test.ts --config=vitest.config.ts
npx vitest run tests/unit/convex/contact-authority-foundations.test.ts --config=vitest.config.ts
npx vitest run convex/operator-read-models.convex.test.ts --config=vitest.config.ts
npx tsc --noEmit
```

The runtime suite covers synchronous STOP admission, 32-row convergence, provider replay, all three invalid START routes, explicit recovery, cross-org legacy precedence, migration restart, reply multiplicity, and evidence-preserving retry.
