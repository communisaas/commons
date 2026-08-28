# Email quota reservation recovery

Email sends cross a non-transactional carrier boundary. A timeout, malformed
response, action eviction, or incomplete TEE result is therefore **unknown**,
not zero. Commons blocks the reservation and its organization capacity until an
operator supplies complete SES evidence and the bounded plan-usage repair
re-establishes exact parity.

## Invariants

- Never resend an `outcome_unknown` or blocked source.
- Never patch organization counters, reservation partitions, source status, or
  `emailReservationState` by hand.
- Never infer zero sends from a timeout, non-2xx response, missing MessageId,
  deleted source row, or crashed action.
- One reservation admits one immutable carrier-evidence row. The evidence must
  partition the entire `requestedCount`; the number of unique SES MessageIds
  must equal `absoluteSentCount`.
- Reconciliation accepts no caller-provided count. It derives the result from
  the append-only evidence row, then schedules an exact source-paged repair.

## Recovery procedure

Set the IDs from the incident ticket without placing secrets in the command:

```bash
RESERVATION_ID='<Convex planUsageReservations id>'
ORG_ID='<Convex organizations id>'
```

1. Inspect the reservation, source parity, organization block, and existing
   evidence. Stop if `partitionValid` is false or evidence cardinality is not
   valid.

```bash
npx convex run planUsage:reservationStatus \
  "$(jq -cn --arg reservationId "$RESERVATION_ID" '{reservationId:$reservationId}')" \
  --env-file .env.production
```

2. Obtain the terminal result from authoritative SES delivery/export evidence.
   Record every accepted SES MessageId. Account for the complete requested
   partition as `absoluteSentCount + absoluteFailedCount = requestedCount`.
   A partial carrier export is not admissible; leave the reservation blocked.

3. Ingest exactly one append-only observation. `evidenceIdentity` is a stable,
   incident-specific idempotency key; `operatorRef` is the incident/change
   ticket. `observedAt` is the carrier observation time in epoch milliseconds.

```bash
npx convex run planUsage:ingestCarrierEvidence \
  "$(jq -cn \
    --arg reservationId "$RESERVATION_ID" \
    --arg evidenceIdentity 'ses-incident-YYYYMMDD-NNN' \
    --arg operatorRef 'INC-NNN' \
    --argjson carrierMessageIds '["SES_MESSAGE_ID"]' \
    --argjson absoluteSentCount 1 \
    --argjson absoluteFailedCount 0 \
    --argjson observedAt 0 \
    '{reservationId:$reservationId,evidenceIdentity:$evidenceIdentity,operatorRef:$operatorRef,carrierMessageIds:$carrierMessageIds,absoluteSentCount:$absoluteSentCount,absoluteFailedCount:$absoluteFailedCount,observedAt:$observedAt}')" \
  --env-file .env.production
```

4. Re-read `reservationStatus` and have a second operator compare the source
   identity, requested partition, MessageIds, SES evidence, and incident ticket.
   Then reconcile from the audited row:

```bash
npx convex run planUsage:reconcileBlockedReservation \
  "$(jq -cn --arg reservationId "$RESERVATION_ID" '{reservationId:$reservationId}')" \
  --env-file .env.production
```

5. Reconciliation deliberately does not clear the organization block. Poll the
   exact repair until it is ready and the aggregate plane has no pending,
   running, or blocked repair. Re-read the reservation and require its terminal
   sent/released partition to match the evidence.

```bash
npx convex run planUsage:repairStatus \
  "$(jq -cn --arg orgId "$ORG_ID" '{orgId:$orgId}')" \
  --env-file .env.production
npx convex run planUsage:repairPlaneStatus '{}' --env-file .env.production
npx convex run planUsage:reservationStatus \
  "$(jq -cn --arg reservationId "$RESERVATION_ID" '{reservationId:$reservationId}')" \
  --env-file .env.production
```

If evidence is unavailable or incomplete, the correct terminal state is still
blocked. Escalate the carrier investigation; do not clear capacity or resend.
