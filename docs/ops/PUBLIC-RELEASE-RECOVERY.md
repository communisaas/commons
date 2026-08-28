# Public release fresh-runner recovery

The public-template OG release is recovered from a private, append-only R2
journal. GitHub artifacts and the failed runner are not recovery authority.
`.github/workflows/public-template-og-release-recovery.yml` runs after every
completed `Deploy to Cloudflare Pages` attempt and can also be dispatched for
one exact run id, run attempt, and realm.

## Launch prerequisites

Provision the dedicated private Standard bucket
`commons-release-recovery-private` in the default jurisdiction. It must have no
r2.dev URL or custom domain and exactly these two rules:

- lifecycle `commons-release-recovery-expiry-v1`: enabled, prefix
  `transactions/v1/`, delete objects at age 604800 seconds;
- lock `commons-release-recovery-append-only-v1`: enabled, the same prefix, age
  retention 604800 seconds.

Do not reuse `commons-public-discovery-cache`. Recovery custody must not be
reachable by the application, discovery readers, or public Worker bindings.
The workflow verifies the live bucket, lifecycle, lock, and exposure settings
before reading or mutating release state.

Configure both protected GitHub Environments (`Staging` and `Production`) with:

- `PROTECTED_CLOUDFLARE_API_TOKEN`;
- `PROTECTED_RELEASE_RECOVERY_R2_ACCESS_KEY_ID`;
- `PROTECTED_RELEASE_RECOVERY_R2_SECRET_ACCESS_KEY`;
- the matching `PROTECTED_RELEASE_CONTROL_SECRET_PREVIEW` or
  `PROTECTED_RELEASE_CONTROL_SECRET_PRODUCTION`.

Production recovery additionally requires the already-separated
`PROTECTED_CLOUDFLARE_ZONE_ID`,
`PROTECTED_RELEASE_ORIGIN_PROOF_SECRET_PRODUCTION`, and
`PROTECTED_INTERNAL_API_SECRET_PRODUCTION`. They prove a restored Pages/T pair;
they are not stored in the journal or recovery kit.

The R2 key pair must be restricted to this recovery bucket. The Cloudflare API
token needs only the control-plane reads and release mutations already required
by the protected release. Never place these values in Pages, Convex, repository
secrets without Environment protection, logs, or workflow outputs.

## Recovery authority

The immutable identity is repository `communisaas/commons`, repository id
`599295397`, source run and attempt, transaction `<run-id>-<run-attempt>`, and
realm. Objects live below:

```text
transactions/v1/repositories/599295397/communisaas/commons/
  runs/<run>/attempts/<attempt>/realms/<realm>/
```

The normal runner writes the release kit and schema-v4 baseline before its first
external mutation. The production Queue baseline is the dormant post-bootstrap
topology: exact captured primary consumer ID and work budget, no producer, zero
primary and DLQ backlog, active/unpaused source and DLQ, zero delivery delay,
and exact 24-hour retention. The first owned production Queue mutation
pauses/normalizes that topology; preview's baseline and preparation remain
paused. Production also seals the exact active
manifest-cron version and the exact active trusted-edge version, SHA, and
transaction. Both must match the captured canonical Pages tuple; a normal
release is ineligible without a retained trusted-edge rollback pair. Every later
Pages activation therefore happens only after the retained pair has answered the
valid capability proof and rejected missing and incorrect capabilities. The
pre-Q check after candidate activation revalidates only the sealed edge version,
transaction binding, tag, and route inventory; it does not try to route the old
Pages tuple through the new canonical deployment.
Every later Queue/Pages mutation has a hash-linked intent and result. A
predecessor claim uses conditional create, so normal and recovery runners cannot
create sibling histories. Recovery performs fixed-key reads only; it never LISTs
the bucket or accepts an artifact from a different run.

Protected Environment receipt secrets are one-shot admission transport, not
recovery authority. Schema-2 requires two observations after production
preflight; schema-1 production requires two new observations after the common
bootstrap handoff. Stale values fail before mutation and must be replaced by the
operator at those two approval seams. Recovery uses only the admitted journaled
baseline and never stretches or refreshes either receipt.

The temporary production bootstrap has separate custody because it can precede
the schema-v4 baseline. Its fixed path is:

```text
transactions/v1/repositories/599295397/runs/<run>/attempts/<attempt>/
  bootstrap-production/
```

Before creating `commons-public-discovery-bootstrap` or its one exact
hidden-origin route, the trusted job proves both absent and conditionally writes
the immutable `intent` stage. It records the exact active version after deploy
when possible and records `cleaned` only after both resources are absent.
Cancellation after intent remains recoverable even if neither the main journal
nor the deployed-version stage exists. Recovery admits only the journal source
SHA, transaction annotation/binding, committed bootstrap configuration, and—if
recorded—the exact version id. Drift is a zero-mutation supersession. An owned
bootstrap is contained route first and script second, with terminal absence
proofs. When both custody chains exist, Pages/T/cron recovery is ordered before
this terminal bootstrap cleanup.

Schema-2 bootstrap admission first converges the existing consumer itself to the
exact release SHA and transaction while preserving its captured Queue identity,
settings, active/unpaused delivery, producerless state, and zero backlog. Warm
and cold paths share that dormant terminal oracle; only cold attaches the
temporary producer. A failed run may therefore leave an exact newer dormant
consumer after temporary resources are contained. That is a safe retry state,
not a commit: the next attempt overwrites and reproves the consumer for its own
tuple before attaching any producer.

The authority state is decisive:

- committed is terminal for the release-authority, Queue, OG, and manifest-gate
  state machines. Independent coordination recovery first proves the exact
  candidate Pages/T tuple; if that proof is unavailable it may restore only the
  exact retained Pages/T pair already admitted by the bounded committed ledger,
  Pages first and T second. It never rewinds gate storage;
- a newer or mismatched authority, Pages deployment, Queue consumer, or gate is
  superseded and receives zero release mutation;
- a still-owned pre-commit attempt is forward-contained, Queue delivery is
  paused, and owned prior state is restored in journaled order. Consumer restore
  targets the exact captured consumer ID; recovery neither accepts a provider-
  assigned replacement ID nor declares body-only equivalence;
- the manifest gate remains forward-only and default-deny. Recovery never rolls
  it back to an older schema.

After core recovery settles, the same fresh runner classifies canonical Pages,
the trusted edge, and manifest cron as either the immutable baseline, this exact
source SHA plus transaction, or superseded. Only the first two classifications
grant mutation authority. It restores the scheduler from its exact version (or
exact absence), reconciles all undeclared Pages URLs, and requires the uncached
origin, readiness, and anonymous cache proofs before success. Same-SHA reruns do
not own manifest cron: the Worker message also carries the exact transaction.

## Operator use

Prefer the automatic `workflow_run` recovery. For a manual audit or retry,
dispatch `Public template OG release recovery` with the exact source run id,
attempt, and either one realm or `all`. An absent immutable chain is a safe
no-op. A malformed, forked, crossed, stale, or partially unverifiable chain
fails closed.

Do not substitute direct invocations of the Queue, Worker, Pages, or gate
manager scripts. Those bypass source-attempt validation, protected Environment
approval, append-only custody, and the transaction ownership oracle.
