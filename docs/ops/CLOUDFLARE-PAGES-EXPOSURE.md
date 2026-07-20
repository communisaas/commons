# Cloudflare Pages immutable-deployment exposure

Cloudflare Pages deployment URLs are permanent public execution surfaces, not
ephemeral build artifacts. By default, a request to an old
`<hash>.communique-site.pages.dev` URL executes that deployment's Pages
Functions even after a newer branch or production deployment exists. That
means a historical Commons build can preserve a removed Convex cost bug unless
the account edge closes the complete `pages.dev` namespace.

## Launch invariant

Before the Convex production team is reactivated, all of the following must be
true:

1. The account `http_request_redirect` entry point has the exact first rule in
   `config/cloudflare-pages-dev-origin-closure.json`. Its dedicated Bulk
   Redirect list covers `communique-site.pages.dev`, every subdomain, every
   path, and every query. There are **no probe, branch, hash, root, liveness, or
   internal-path bypasses**. A read-only pre-Environment verifier proves the
   list, its single item, and the first rule before a normal production release.
2. The application host-authority hook is first, before Convex initialization,
   authentication, R2, Cache API, Sentry, or routes. Full application execution
   is allowed only on exact `commons.email`; `staging.commons.email` is restricted
   to liveness and authenticated release/control probes. Direct Pages aliases are
   subject to the same probe-only policy and otherwise fail with 421 before data
   I/O if the external redirect ever drifts. This app hook is the sole data-I/O
   boundary until the external rule is installed; only the external rule prevents
   a Pages invocation.
3. The canonical production Pages deployment is the exact reviewed containment
   SHA and proves zero Convex/Atlas/R2 calls for application interception while
   the backend is suspended. Its trusted config declares no KV, R2, Durable
   Object, service, or storage binding, and authenticated readiness reports
   `bindingsAbsent:true`, `r2Bound:false`, and `refreshGateBound:false`.
4. Cloudflare native Git production uploads are disabled and
   `preview_deployment_setting` is `none`. The SHA-gated GitHub workflow is the
   only publisher.
5. The settled Pages deployment inventory contains only canonical production.
   A staging candidate alias may exist only inside its serialized qualification
   transaction and is pruned after production promotion. Reconciliation reports
   `preserved=0`, and a manual-redirect request
   proves the predecessor immutable URL is either terminally blocked or receives
   the exact pre-Function 301 to `https://commons.email` with its path preserved.
   No unaliased immutable deployment and no other branch alias may remain.
6. Pages publication and reconciliation share one repository-wide workflow
   mutex. The scheduled protected exposure guard runs reconciliation daily.
   Publication reconciles only after all mode-specific probes; containment
   failure forward-deploys its proven preflight rather than restoring the old
   cost bomb, while normal failure may roll back only to a previously proven
   containment canonical.

These checks happen before quota reactivation because a server-side secret or
421 can stop database reads but cannot make a historical Pages Function
invocation free.

## Reconcile and prove

The Environment-only protected token needs Cloudflare Pages Write for the project. The script never logs
the token, preserves the active canonical deployment, and uses the Pages API's
forced deletion only for noncanonical or unapproved deployments. An allowed
branch is retained only when the deployment owns the exact
`https://<branch>.communique-site.pages.dev` alias; branch metadata plus an
unrelated custom alias is not retention authority. Inventory pagination is
read twice to a stable ID/alias fingerprint, API throttling is retried with a
bounded backoff, and the production SHA is checked again after deletion.

```bash
export CLOUDFLARE_ACCOUNT_ID=019d1184e655db74b7589794a2a2a533
export CF_PAGES_PROJECT=communique-site
export CF_PAGES_ALLOWED_ALIAS_BRANCHES=production

npm run ops:reconcile-pages-exposure

# At production reactivation, also prove the canonical artifact is the release.
node scripts/reconcile-cloudflare-pages-exposure.mjs \
  --expected-production-sha "$RELEASE_SHA"
```

The second command is a read-only proof and exits nonzero if any stale
deployment remains, native Git publication is enabled, or the canonical SHA
does not match.

The deployment metadata proof is necessary but not sufficient: prove that the
custom domain is actually serving that artifact, not an older healthy one.
`/api/health` is secret-gated and the Worker bundle inlines the source-verified
workflow SHA through build-only `VITE_RELEASE_SHA`:

```bash
curl --fail-with-body -sS \
  -H "X-Internal-Secret: $INTERNAL_API_SECRET" \
  https://commons.email/api/health | \
  jq -e --arg sha "$RELEASE_SHA" \
    '.status == "ok" and .release.sha == $sha and .publicDiscoveryCache.r2Bound == true and .sessionCookieAuthority.keysIsolated == true'
```

Do not infer custom-domain promotion from canonical deployment metadata alone.
Both proofs must name the same exact lowercase 40-character SHA. Direct
`pages.dev` HTTP probes are deliberately forbidden once closure is installed.
Containment preflight and `main` uploads use exact, stable Pages API deployment
metadata plus the locally verified artifact and binding proof. A normal staging
release proves its own artifact through `https://staging.commons.email`, but it
does not qualify a production build merely because the Git SHA matches. For a
production release, the consensus-digested production tree is uploaded unchanged
to the release-only staging authority; the client realm is supplied dynamically
by preview bindings, and a trusted scan has already rejected the production
Convex origin from all client-visible files. The workflow re-verifies its digest,
production release metadata, preview deployment metadata, health, and graph,
then re-digests and uploads that same directory to production before proving
`https://commons.email`. Nonproduction is not allowed an exception: its Convex
deployment consumes the same team quota.

The Bulk Redirect is a launch requirement, not optional defense in depth. Its
reviewed state is machine-pinned and read without mutation:

```sh
CLOUDFLARE_API_TOKEN="$PROTECTED_CLOUDFLARE_ORIGIN_CLOSURE_READ_TOKEN" \
  node scripts/verify-cloudflare-pages-dev-origin-closure.mjs \
    --policy config/cloudflare-pages-dev-origin-closure.json
```

The repository-scope observer token is separate from the Pages publication
token and has only **Account Filter Lists Read** plus Cloudflare's read
permission for Bulk/Mass URL Redirects. The operator who installs or changes
the state needs the corresponding Edit permissions, but the release workflow
does not. Missing permission, pagination, an extra list item, a non-first rule,
a bypass expression, or any redirect drift blocks production before an
Environment job can expose publication credentials.

References:

- [Cloudflare Pages: delete preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/#delete-preview-deployments)
- [Cloudflare Pages REST API: deleting old deployments](https://developers.cloudflare.com/pages/configuration/api/#deleting-old-deployments-after-a-week)
- [Cloudflare Pages: redirect `pages.dev` to a custom domain](https://developers.cloudflare.com/pages/how-to/redirect-to-custom-domain/)
- [Cloudflare Bulk Redirect list parameters](https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/reference/json-objects/)

## 2026-07-19 remediation record

The live project contained **1,066** deployments across 69 historical branch
names. Native preview deployment had drifted to `all`, despite the repository
workflow requiring `none`. During quota suspension we:

- changed the live project to `preview_deployment_setting=none` while retaining
  `production_deployments_enabled=false`;
- forcibly removed every aliased preview deployment; and
- deleted all 1,065 noncanonical deployments, leaving exactly the active
  canonical production artifact (`total=1`, `stale=0`).

The remaining canonical production artifact is not a safe rollback target: it
contains the retired cost behavior. Convex production must remain disabled
until PD-05 replaces it with the reviewed containment artifact, reconciliation
reports `preserved=0` and `stale=0`, and the old immutable URL returns a blocked
status or the exact approved pre-Function canonical redirect. Never preserve or
roll back to that predecessor merely because it was canonical.
