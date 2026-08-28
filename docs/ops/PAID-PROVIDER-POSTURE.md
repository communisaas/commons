# Paid-provider bounded billing posture

## Authority boundary

Commons' 2,400-unit UTC-month public budget is capacity planning; paid-org
resolves use a separate, revenue-backed balance. Normal production release
therefore requires one canonical
`commons-paid-provider-posture-v1` receipt countersigned with exactly one
independently enrolled Ed25519 key.

The receipt binds all of the following to the exact release SHA:

- domain-separated SHA-256 fingerprints of the four exact GitHub protected
  credential values and four opaque provider account IDs;
- the exact `communique-site` production Pages secret names and primary
  consumer, with a complete, empty sibling-consumer inventory;
- billing and pay-as-you-go enabled for Exa and Firecrawl, bound to Commons'
  exact 100,000,000-microusd and 6,000-credit monthly technical ceilings;
- exact Free plans with billing and pay-as-you-go disabled for Gemini and Groq;
- each provider's observed usage, reviewed window limit, remaining balance,
  current reset window, and observation time; and
- the exact associated merged-PR source-author GitHub user ID, a distinct
  operator GitHub user ID/principal, and an independent witness, plus the
  explicit limitations of manual console and Cloudflare secret-custody assertions.

The cost boundary is mixed by design. Exa and Firecrawl may bill only after a
settled subscription mints the paying org's balance, and the work-budget
Durable Object fails closed at 100,000,000 microusd of Exa draw or 6,000
Firecrawl credits in a UTC month. Gemini and Groq remain provider-enforced
Free/no-PAYG accounts. A spend alert or delayed provider report is not a
substitute for either control. The Exa/Firecrawl window arithmetic and the
Gemini 16-request / Groq 9-request remaining thresholds are observation-time
signals; provider reporting can lag, so the admitting Durable Object remains
the technical spend authority.

The verifier does not claim a provider billing API capture. Provider console
facts, exhaustive sibling inventory, exact account identity, and the assertion
that the protected inputs are the currently intended production credentials
are manual operator facts countersigned by the independent witness. Cloudflare
does not return encrypted secret values, so post-write value equality cannot be
read back.

## Deliberate launch interlocks

The checked-in state is intentionally inoperable:

- `config/paid-provider-account-authority.json` is
  `pending-independent-signer` with null signer identity/fingerprint;
- `.github/paid-provider-posture-allowed-signers` has no active key;
- the required protected receipt, signature, account IDs, and exact provider
  credentials are not enrolled; and
- no live project/deployment evidence has been captured; and
- the Convex provider-egress allowlist must remain empty and its full executable
  source scan must remain at zero findings; reintroducing a Convex provider
  credential, SDK, or endpoint invalidates the empty sibling inventory.

Do not insert a personal key, invent account evidence, or copy a provider
credential into a receipt. Enrollment requires a protected-main change owned by
the independent CODEOWNER team. That change sets one signer principal, GitHub
user ID, and Ed25519 fingerprint in the authority config and adds exactly the
same principal/key under namespace `commons-paid-provider-posture-v1` to the
allowed-signers file. The signer GitHub identity must differ from the pinned
launch source author. The receipt operator may be the source author, but its
GitHub user ID must differ from the enrolled signer's ID.

## Operator capture and signing

Use a clean operator host. Put the exact values that the same release will
write to Pages in these process-local variables; do not persist or print them:

```sh
export PROVIDER_POSTURE_EXA_CREDENTIAL='...'
export PROVIDER_POSTURE_EXA_ACCOUNT_ID='...'
export PROVIDER_POSTURE_FIRECRAWL_CREDENTIAL='...'
export PROVIDER_POSTURE_FIRECRAWL_ACCOUNT_ID='...'
export PROVIDER_POSTURE_GEMINI_CREDENTIAL='...'
export PROVIDER_POSTURE_GEMINI_ACCOUNT_ID='...'
export PROVIDER_POSTURE_GROQ_CREDENTIAL='...'
export PROVIDER_POSTURE_GROQ_ACCOUNT_ID='...'
```

Record the four provider consoles in one capture session. For Exa and
Firecrawl, verify billing and PAYG are enabled, record the current monthly
usage, and bind the respective 100,000,000-microusd / 6,000-credit Commons
technical ceiling. For Gemini and Groq, verify the exact Free plan with billing
and PAYG disabled. For all four, record reset windows, current/window/remaining
arithmetic, and the full account/key consumer inventory. Bind the exact
associated merged-PR source-author GitHub user ID in the schema-1 receipt. Use
`fingerprintProviderPostureBinding` for its credential/account fingerprints and
`canonicalProviderAccountPostureBytes` for its final bytes. Keep raw screenshots
and account identifiers outside the repository. The canonical receipt contains
only opaque fingerprints and assertions.

The independent witness repeats those checks, confirms the release SHA and
protected-secret custody, and signs the mixed account state: Exa/Firecrawl
PAYG enabled under the exact Commons monthly ceilings, Gemini/Groq
Free/no-PAYG, exact usage windows, account/credential bindings, and empty
sibling consumption. The witness then signs locally:

```sh
node scripts/sign-paid-provider-account-posture.mjs \
  --authority config/paid-provider-account-authority.json \
  --receipt /secure/paid-provider-posture.json \
  --signature /secure/paid-provider-posture.sig \
  --signing-key /secure/paid-provider-posture-ed25519 \
  --allowed-signers .github/paid-provider-posture-allowed-signers \
  --source-sha "$RELEASE_SHA"
```

The helper rejects noncanonical bytes, stale/overlong evidence, a non-Ed25519
key, a key/fingerprint outside the one enrolled trust root, wrong protected
inputs, a missing or unapproved source author, missing providers, nonempty
siblings, disabled PAYG on Exa/Firecrawl, enabled billing or PAYG on
Gemini/Groq, technical-ceiling drift, usage arithmetic drift, or insufficient
observation-time balance. Disconnect and remove the private key before
returning the canonical receipt/signature to the release operator.

Base64 the two public evidence files into
`PROTECTED_PAID_PROVIDER_POSTURE_RECEIPT_B64` and
`PROTECTED_PAID_PROVIDER_POSTURE_SIGNATURE_B64`. Store the same raw values used
during signing as `PROTECTED_EXA_API_KEY`, `PROTECTED_FIRECRAWL_API_KEY`,
`PROTECTED_GEMINI_API_KEY`, and `PROTECTED_GROQ_API_KEY`; store the four opaque
account IDs as `PROTECTED_<PROVIDER>_ACCOUNT_ID`. Never create separate
"posture-only" credential copies.

## Release sequencing and proof

Production source verification queries the exact release commit's associated
pull requests, requires exactly one merged PR into the protected base, and binds
that PR author's numeric GitHub ID to the receipt and approved source-author
set. Preflight verifies the signed receipt against the exact protected values
and requires its operator GitHub user ID to equal the immutable workflow
dispatcher `${{ github.actor_id }}` before any production release mutation.
Immediately before the Pages transaction, the activation job verifies it again
with at least three hours of remaining validity.

Inside the trusted transaction, after the Pages attempt marker and mutation
authorization, all `PROVIDER_POSTURE_*` values are removed from the environment
inherited by child processes. The transaction then uses the exact in-memory
credential values in one bounded production-only Pages project PATCH and
immediately invokes the pinned immutable `wrangler pages deploy`; no unrelated
transaction action sits between staging and upload.

The staging materializer fences this mutation with five exact control-plane
reads and writes: project baseline, immutable canonical deployment baseline,
production config PATCH with the current production `wrangler_config_hash`,
project poststate, and the same canonical deployment poststate. It rejects any
preview capability, canonical-deployment change, preview drift, non-provider
production drift, or change to the previously active deployment's bindings. It
never retries an ambiguous secret write and never writes raw values to disk.

Cloudflare documents that a Pages secret must be set before a deployment that
uses it, and its deployment API exposes the environment-variable bindings
captured by each immutable deployment. See the official
[Pages bindings documentation](https://developers.cloudflare.com/pages/functions/bindings/#secrets)
and [Pages deployment API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/get/).
After the production transaction, Commons queries the exact returned deployment
ID and requires all four bindings to be `secret_text`. This proves ordered
write-before-deployment and binding capture; it does not pretend Cloudflare can
read the encrypted values back. The transaction then null-deletes all four
project defaults from both production and preview. Each environment uses the
pinned Wrangler delete shape and its own current `wrangler_config_hash`.
Ambiguous cleanup is reconciled with bounded reads and at most one idempotent
retry; every non-provider setting and the immutable canonical deployment must
remain unchanged. Cleanup runs before nested recovery, in the outer workflow
trap, in the separately dispatched recovery workflow, and before containment.
Normal completion requires a final proof that both project environments are
clean while the exact immutable production deployment retains the four secret
bindings.

Any missing enrollment/evidence/secret, wrong fingerprint/SHA/account, stale
receipt, provider posture drift, Pages config drift, unreconciled ambiguous
write or cleanup, or missing immutable-deployment binding stops normal release.
Containment remains binding-free, first proves both project environments clean,
and does not require or materialize provider credentials.
