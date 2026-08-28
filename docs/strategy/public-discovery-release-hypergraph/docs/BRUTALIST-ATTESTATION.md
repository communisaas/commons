# Brutalist launch attestation v3

This diagnostic records a full-repository agy, Claude, and Codex review without
putting an approval commit on the pull-request branch. The ceremony has four
separate trust transitions: disposable capture, offline signing, deterministic
proof-object finalization, and protected-base verification.

Do not run a real launch review until a dedicated operator principal and a new
Ed25519 public key have been explicitly approved and enrolled. Existing
personal SSH keys are outside this trust domain.

## Git object model

Let `S` be the exact PR/source head and `A` be its detached proof commit:

```text
PR branch ──> S  (complete reviewed source; no proof paths)
              \
               A  (one parent S; tree contains only four 100644 proof blobs)

refs/heads/brutalist-attestations/<S> ──> A
```

`S` must equal the reviewed head and current PR head. Its source fingerprint
covers every path, mode, and blob in its committed tree. None of these four
paths may exist in `S`:

- `docs/strategy/public-discovery-release-hypergraph/proof/brutalist-launch-review.json`
- `docs/strategy/public-discovery-release-hypergraph/proof/brutalist-launch-review.md`
- `docs/strategy/public-discovery-release-hypergraph/proof/brutalist-launch-review.raw.json`
- `docs/strategy/public-discovery-release-hypergraph/proof/brutalist-launch-review.raw.json.sig`

`A` has exactly one parent, `S`. Its root tree contains exactly those four
paths as mode-`100644` blobs plus only their necessary directory trees. It is
not a source checkout and must never become the PR head. Extra paths, missing
paths, executable modes, symlinks, gitlinks, merge parents, or a different
parent fail verification.

## One-time signer bootstrap

Key generation is a separate, deliberate operator action. Use a new key path
outside every repository and reviewer environment:

```sh
ssh-keygen -t ed25519 -f /secure/operator/commons-brutalist-ed25519 \
  -C commons-brutalist-launch-v1
ssh-keygen -lf /secure/operator/commons-brutalist-ed25519.pub -E sha256
```

After reviewing the principal and printed fingerprint, enroll only the public
key in protected-base `.github/brutalist-allowed-signers` using OpenSSH's
allowed-signers format:

```text
<principal> namespaces="commons-brutalist-launch-v1" ssh-ed25519 <public-key>
```

The private key must never enter the repository, capture process, reviewer
account, CI, or candidate-visible environment. Rotation is an explicit
protected change. Attestations record both principal and key fingerprint.

## 1. Capture in a disposable security boundary

First commit the complete reviewable source as `S`. The capture must run under
a dedicated operating-system UID in a disposable VM (or a stronger equivalent
isolation boundary), using spend-capped, short-lived reviewer accounts.

The capture VM/UID must not mount or expose any of the following:

- the operator's normal home or SSH agent;
- the dedicated signing private key or its parent filesystem;
- the protected trusted-base checkout (stage only a hash-verified copy of the
  minimal gate scripts/runtime needed to launch capture);
- Cloudflare, Convex, GitHub, deployment, or other control-plane credentials;
- Docker, SSH-agent, browser-session, host IPC, credential-helper, or parent
  Codex-session sockets.

Keep the signing key physically offline and unmounted for the entire capture.
The candidate source checkout and reviewer credentials belong only to the
disposable environment. Network egress must be limited to the three configured
model providers and bounded by expendable account quotas.

`BRUTALIST_REVIEW_HOME` is configuration hygiene for the child CLIs. A changed
`HOME` value is **not containment**: it does not change the UID, mount namespace,
open file descriptors, sockets, process visibility, or network authority. Never
run capture on the strength of HOME isolation alone.

From the source checkout at `S`, invoke the hash-verified gate copy:

```sh
BRUTALIST_BASE_SHA=<40-character-pr-base-sha> \
BRUTALIST_OPERATOR_PRINCIPAL=<approved-principal> \
BRUTALIST_REPOSITORY_ID=<immutable-github-repository-id> \
BRUTALIST_REPOSITORY_SLUG=communisaas/commons \
BRUTALIST_REVIEW_HOME=/ephemeral/reviewer-home \
node /verified-gate/run-brutalist-launch-review.mjs
```

Before any critic starts, the trusted builder:

- requires a clean, committed source HEAD and proves it has no proof paths;
- fingerprints the entire source Git tree and rejects symlinks/gitlinks;
- reads exact committed blobs through `git cat-file --batch`, so candidate
  `.gitattributes` cannot apply `export-subst` or `export-ignore` mutations;
- materializes a detached read-only snapshot, uses it for MCP `cwd` and target,
  watches it for mutations, and hashes it again after review;
- passes a strict child-environment allowlist; and
- journals raw pages under Git metadata so an interrupted capture does not
  fabricate completed evidence.

The builder pins `@brutalist/mcp@1.18.8` by npm integrity, package/entrypoint
digests, SDK version, and the complete 2,476-file runtime-tree digest. It emits
canonical raw JSON and prints `evidence_sha256=<64 hex>`. Record that digest on
an independent operator channel before transferring the evidence.

For this launch, all three critics must explicitly review `FND-35D` and its
edges: two separate trusted Workers and exact runtime dates/ordered flags;
complete overlapping Access app/policy/token and stale-alias inventory;
distinct custom-header Service Auth-only Access applications/tokens;
late-transform credential removal; hidden-origin and pages.dev closure;
Access-safe public-URL reconstruction before SvelteKit; the exact staging
token-absence/cache-unavailability proof; Q → T → terminal-C ordering followed
by exact uncached `/api/release-origin` using its distinct production-only
proof capability, which T strips before origin forwarding; independent
pending/active/newest-eight-retained authority state; Pages-first then
trusted-edge retained-C rollback, with pre-Q and pre-T missing/wrong/current
capability proof and the normal exact-origin or metadata-bound deterministic
containment response repeated; purge remaining best-effort only; and single-owner
anonymous exact-root cache eligibility, cold-miss coalescing, and zero-secret
60/300/360 outer-entry freshness plus strict less-than-420-second
manifest-publication convergence. `Cache-Tag: public-discovery` is future
optional acceleration, not launch or rollback authority. A source-level proof must not be
accepted as evidence that external Cloudflare configuration, protected secrets,
live denial/cache/post-C/rollback behavior, or production Convex quota
reactivation exists. Those facts remain open launch blockers until operator
evidence is attached.

The critics must also review the `FND-35` and `FND-40B` closure added for this
launch: immutable-T identity for every SvelteKit route/hook/config and transitive
server/provider execution path plus alternate-entry absence; a preview config
containing only public build-safe vars and no application capability bindings;
one fixed cross-realm atomic paid-provider authority with exact operation,
actor, public, and platform pools; the 250/day and 600/month operator reserve
remaining inside the 1,000/day and 2,400/month hard cap; the retry-aware
150-call decision-maker scalar envelope plus its 72-search/24-text-content/
24-Firecrawl/13-Gemini/1-Groq/18-MX element-wise bounds; authenticated bounded
preflights before provider admission; recoverable message replay before
readiness/admission/provider work; and byte-identical Prompt Guard
classification of the complete bounded indirect-source JSON before Gemini.
Source evidence cannot self-attest the live budget Worker/binding, operator
allowlist posture, provider credentials, exact production-key Free-plan plus
billing-disabled/no-PAYG posture, provider reset interval/current balance/sibling consumption,
signed Free receipts, or Convex reactivation; those remain external launch
blockers.

The critics must additionally test the residual foundation chain `FND-51`
through `FND-55`, not infer it from older cache work: submission creation must
reject a direct Convex caller before any context work and accept only the
256-KiB-bounded server path; segment/import/rescore actions must be secret-first,
maximum-class, and fixed at four 100-row pages, 100 import rows, and ten unique
bills respectively; both batch and mailto position-delivery writers must share
one 64-KiB/20-recipient/lifetime-cap admission and composite idempotency
primitive under concurrent replay; template search must be compact-index,
keyword-only, and absent from the nine-operation provider policy while the
recursive Convex scanner reports zero provider capabilities; and Shadow Atlas
must use one durable identity-scoped lease with fresh-cache/coalesced followers,
metrics-before-POST, a persisted write reservation before the at-most-once
registration attempt, registered/leaf persistence before path lookup, bounded
transport, cooldown-backed failure state, and an internal-only 15-minute
expired-lease/no-leaf/no-snapshot exact-CAS repair with bounded evidence and a
single generation increment. Any missing cross-writer,
concurrency, ambiguous-response, direct-call, or capability-resurrection proof
is a launch finding, even if the ordinary UI happy path passes. Source tests do
not prove live Atlas availability, deployed rate rules, protected Cloudflare
configuration, or production activation; those facts remain operator evidence.

When capture ends, destroy the capture VM and reviewer home, revoke every
reviewer credential, and close the spend-capped accounts or sessions. Complete
those actions before reconnecting the signing key.

## 2. Sign offline against the recorded digest

Move only the canonical evidence into a clean signing environment. Disconnect
network access before mounting the dedicated signing key. Compare the evidence
digest with the independently recorded capture value, then run:

```sh
BRUTALIST_EXPECTED_EVIDENCE_SHA256=<capture-printed-64-hex> \
BRUTALIST_OPERATOR_PRINCIPAL=<approved-principal> \
BRUTALIST_SIGNING_KEY=/secure/operator/commons-brutalist-ed25519 \
node /trusted/commons-base/scripts/sign-brutalist-evidence.mjs
```

The signer refuses a missing or different evidence digest, requires Ed25519,
requires the evidence principal/namespace to match, verifies its new signature
against the protected allowed-signers file, and writes only the detached
signature. It needs no network access.

## 3. Finalize a detached proof commit

Keep using the same approved evidence digest:

```sh
BRUTALIST_EXPECTED_BASE_SHA=<40-character-pr-base-sha> \
BRUTALIST_EXPECTED_EVIDENCE_SHA256=<capture-printed-64-hex> \
BRUTALIST_EXPECTED_REPOSITORY_ID=<immutable-github-repository-id> \
BRUTALIST_EXPECTED_REPOSITORY_SLUG=communisaas/commons \
node /trusted/commons-base/scripts/finalize-brutalist-launch-review.mjs
```

The finalizer verifies the digest and signature, recomputes `S`, derives all
reviewer/finding totals, and renders the sole accepted Markdown report from the
signed evidence. It uses an empty temporary Git index, writes the four blobs
and directory trees through Git object plumbing, and creates `A` with
`git commit-tree -p S`. It verifies `A`, updates only the deterministic local
`refs/heads/brutalist-attestations/<S>` ref, removes worktree proof files, and
proves that source `HEAD` never moved.

Inspect the printed source SHA, proof SHA, and ref. Push the ref without checking
it out:

```sh
SOURCE_SHA="$(git rev-parse HEAD)"
PROOF_REF="refs/heads/brutalist-attestations/$SOURCE_SHA"
git show --no-patch --format=fuller "$PROOF_REF"
git ls-tree -r "$PROOF_REF"
git push origin "$PROOF_REF:$PROOF_REF"
```

A non-fast-forward replacement intentionally fails. Replacing an existing
attestation requires an explicit, reviewed `--force-with-lease` against its
previous immutable OID. Never merge `A`, switch to it, or move the PR branch to
it.

## Structured evidence rules

Every native reviewer appears exactly once between the package's canonical
begin/end markers. Its final non-empty line contains exactly one
`BRUTALIST_LAUNCH_VERDICT_V2` JSON record. Findings have exactly:

```json
{
	"severity": "P0|P1|P2|P3",
	"status": "open",
	"path": "repo/relative",
	"invariant": "specific failing invariant"
}
```

Standalone severity tokens are forbidden in prose. `pass` is derived only when
the structured array contains no open P0/P1. Reviewer identity, model,
execution success, output/findings digests, severity totals, and verdict are
reconstructed from signed raw pages. Pagination context, totals, offsets, and
the exact overlap are also reconstructed.

## Diagnostic workflow and authority

`.github/workflows/brutalist-review.yml` is a protected-base
`pull_request_target` diagnostic. It checks out only the exact base gate, fetches
the PR source into a new bare object database, and fetches exactly
`refs/heads/brutalist-attestations/<PR-head-SHA>`. It resolves that fetched ref
once to immutable `A`, passes only the full OID to the verifier, and never checks
out, imports, installs, or executes source or proof bytes.

There is no fallback to the PR branch for proofs. Missing proof refs fail. A ref
race cannot retarget the already-resolved local OID, and `A` still must have
exactly one parent equal to the event's exact source SHA.

This workflow becomes base-owned only after merging it to the default branch.
It is not an authoritative required gate: repository workflows share the
GitHub Actions App identity, so candidate Actions can spoof a same-named status.
Do not use this diagnostic Actions context alone as launch approval.

## Independent launch authority

Production release additionally runs
`scripts/verify-brutalist-review-authority.mjs` from immutable trusted gate T.
The verifier consumes only trusted policy files and inert, size-bounded GitHub
API JSON. It refuses launch unless all of these facts are simultaneously true:

- `config/brutalist-review-authority.json` is explicitly `enrolled`, pins one
  non-Actions GitHub App id/slug/owner, one organization CODEOWNER team and its
  complete bounded member-id set, and one offline signer principal, GitHub user
  id, and Ed25519 fingerprint;
- protected main is strict, applies to administrators, requires CODEOWNER
  approval, dismisses stale approvals, requires approval after the latest push,
  has no pull-request or dismissal bypass actors, and requires both `test` from
  GitHub Actions App 15368 and `Commons Brutalist Launch Authority` from the
  pinned distinct App id;
- the final exact CODEOWNERS rules cover the complete review workflow, signer
  root, authority policy/verifiers, capture/sign/finalize scripts, and this
  ceremony document with only the enrolled independent team; live team evidence
  proves it is visible and has exact write-only (never maintain/admin) access to
  this repository, so GitHub can actually enforce its ownership;
- `.github/brutalist-allowed-signers` contains exactly the enrolled principal,
  namespace, Ed25519 key, and fingerprint; the signer GitHub identity is absent
  from the reviewer team and does not own the authority App;
- `brutalist-attestations/<S>` still resolves to exact proof commit A and its
  effective protection applies to administrators and disables force-push and
  deletion; and
- the exact source S has one latest successful check from the pinned App. Its
  authenticated external id and canonical output bind repository id, S, A,
  signer principal/fingerprint, and CODEOWNER team id after the signed review.

The committed configuration deliberately remains
`pending-independent-enrollment` with null App/team/signer fields. This is a
launch interlock, not a placeholder identity. It must be changed only after the
independent team, least-privilege App, and dedicated offline key actually exist,
in a separately reviewed protected-base change. Append the generated exact
CODEOWNERS suffix, enroll only the public key, configure the main and proof-ref
protections, install the protected token with repository Actions/Checks/
Metadata/Administration read and organization Members read (no write scope),
and then capture the live verifier output. Never copy a personal key, nominate
the source author as the reviewer/signer, or set an invented App/team id just to
make tests pass.

The App implementation is an external trust boundary. It must independently
verify the exact detached proof and GitHub review state before emitting protocol
`commons-brutalist-authority-v1`; its private key and check-write credential must
never enter this repository, Actions, the capture VM, or the offline signing
environment. The production verifier checks the App's exact least-privilege
permission/event inventory and rejects a same-name check from App 15368.

## Residual risk

The OpenSSH signature authenticates the operator's canonical capture, not the
model providers. Brutalist returns decoded critic text rather than
provider-signed responses or complete native CLI tool transcripts. Its native
agents retain shell/web capabilities. Read-only blob materialization, prompt
instructions, a child environment allowlist, and a separate HOME do not form an
OS or network sandbox. The disposable UID/VM, restricted egress, expendable
reviewer identities, immediate revocation, offline key, exact Git binding, and
detached proof ref are therefore load-bearing parts of the ceremony.
