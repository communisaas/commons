/**
 * Privacy launch gate for the analytics snapshot plane.
 *
 * Sensitivity=1 is valid only after the trusted Convex write boundary enforces
 * one bounded contribution per durable actor/cell/day identity. The current
 * HTTP route uses isolate-local IP counters, which can reset or fan out across
 * Cloudflare isolates and therefore is not contribution authority.
 *
 * Keep this false until the durable ledger, exact writer identity, migration,
 * and adversarial tests land together in a separately reviewed change.
 */
export const ANALYTICS_CONTRIBUTION_AUTHORITY_READY = false;
