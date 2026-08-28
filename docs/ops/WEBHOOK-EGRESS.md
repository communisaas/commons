# Webhook egress policy

Outbound organization webhooks fail closed unless their exact HTTPS origin is
listed in the Convex environment variable `WEBHOOK_EGRESS_TRUSTED_ORIGINS`.
The value is a comma-separated list of origins, with no paths, queries, user
credentials, or fragments:

```text
https://hooks.example.net,https://receiver.example.org:8443
```

Creation, update, and delivery all apply the same policy. HTTP, loopback,
private, link-local, reserved, credential-bearing, and fragment-bearing URLs
are rejected. Delivery uses `redirect: "manual"`, so an allowed origin cannot
redirect the worker to a different destination.

## DNS limitation

The Convex action runtime does not provide a DNS-resolution primitive that lets
application code inspect every address immediately before `fetch`. Consequently,
Commons cannot safely accept arbitrary customer-controlled hostnames and then
prove that the runtime did not resolve one to a private address. Exact origin
allowlisting is the explicit fail-closed substitute.

Only add origins controlled by the operator or a reviewed egress gateway. Do
not allowlist customer-controlled DNS names directly: an allowlisted hostname
can still change its DNS answer after review. To support arbitrary destinations,
route deliveries through a dedicated Cloudflare egress gateway that resolves
and validates the destination on every request, rejects private/reserved address
ranges and redirects, and pins the validated address through connection setup.
Until that gateway exists, absence of the Convex allowlist intentionally disables
webhook creation and delivery.

Changes to the allowlist take effect at delivery time as well as configuration
time. Removing an origin therefore stops already queued deliveries before any
network request is made.
