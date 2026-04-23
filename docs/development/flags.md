# Feature Flags

Compile-time boolean/string constants that gate unreleased features. Svelte's dead-code elimination strips gated UI from the production bundle when a flag is `false` or unused.

**Source file:** `src/lib/config/features.ts`

## Current Flags

Reflects `src/lib/config/features.ts` as of 2026-04-23.

| Flag | Type | Default | What it gates |
|------|------|---------|---------------|
| `DEBATE` | `boolean` | `false` | Deliberation surfaces, argument submission, LMSR market, resolution/appeal |
| `CONGRESSIONAL` | `boolean` | `false` | CWC delivery, district officials lookup, congressional template routing |
| `ADDRESS_SPECIFICITY` | `AddressSpecificity` | `'district'` | `'off'` = no location features; `'region'` = state/city inference + template filtering; `'district'` = full street-address collection + congressional district credential issuance |
| `STANCE_POSITIONS` | `boolean` | `true` | Stance registration (support/oppose), inline proof footer, verified positions |
| `WALLET` | `boolean` | `true` | Wallet connect, balance display, on-chain identity |
| `ANALYTICS_EXPANDED` | `boolean` | `true` | Enhanced campaign analytics: delivery metrics, timelines, coordination-integrity overlay |
| `AB_TESTING` | `boolean` | `true` | Email A/B testing: two-variant split, winner selection, results comparison |
| `PUBLIC_API` | `boolean` | `true` | Public REST API at `/api/v1/` with API-key auth |
| `EVENTS` | `boolean` | `true` | Events: RSVP, verified attendance, event management |
| `FUNDRAISING` | `boolean` | `true` | Fundraising: Stripe donations, 0% platform fee, public donate pages |
| `AUTOMATION` | `boolean` | `true` | Automation: event-driven engagement ladders, workflow builder |
| `SMS` | `boolean` | `true` | SMS campaigns + patch-through calling (Twilio) |
| `NETWORKS` | `boolean` | `true` | Multi-org coalition networks: parent/child orgs, shared supporter pools |
| `LEGISLATION` | `boolean` | `true` | Legislative intelligence loop: bill monitoring, alerts, scorecards |
| `ACCOUNTABILITY` | `boolean` | `true` | Accountability receipts: proof-weighted decision-maker tracking |
| `SHADOW_ATLAS_VERIFICATION` | `boolean` | `true` | Client-side district verification (no plaintext address to server) |
| `DELEGATION` | `boolean` | `false` | Agentic delegation: AI proxy civic actions under user-defined policy (Tier 3+) |
| `ENGAGEMENT_METRICS` | `boolean` | `false` | Send/engagement counters ("X acted on this"), district coverage, open/click |
| `PASSKEY` | `boolean` | `false` | Passkey (WebAuthn) sign-in option on the login screen |

## Where Flags Are Checked

For current call-sites, search the codebase directly — maintaining a list here drifts. Primary consumer: `src/routes/s/[slug]/+page.svelte` (template detail page). Server-side filtering: `src/routes/browse/+page.server.ts`, `src/routes/+page.server.ts`. Modals: `src/lib/components/modals/ModalRegistry.svelte`.

```bash
rg "FEATURES\.<FLAG_NAME>" src/
```

## Usage

Import the `FEATURES` object and check the flag directly:

```typescript
import { FEATURES } from '$lib/config/features';

// Boolean flags
if (FEATURES.DEBATE) {
  // render debate UI
}

// String flags
if (FEATURES.ADDRESS_SPECIFICITY === 'district') {
  // render address collection form
}
```

In Svelte templates:

```svelte
{#if FEATURES.CONGRESSIONAL}
  <CwcDeliveryPanel />
{/if}
```

On the server (loaders and API routes), use the same import to exclude data before it reaches the client:

```typescript
// +page.server.ts
where: {
  ...(!FEATURES.CONGRESSIONAL ? { deliveryMethod: { not: 'cwc' } } : {}),
}
```

## Adding a New Flag

1. Add the flag to the `FEATURES` object in `src/lib/config/features.ts`:

```typescript
export const FEATURES = {
  // ...existing flags
  MY_FEATURE: false,
} as const;
```

2. Gate UI and server logic behind `FEATURES.MY_FEATURE`.
3. When the feature ships, flip to `true`. After it has been `true` for a full release cycle, remove the flag and its conditionals.

## Enabling a Flag for Local Development

Edit `src/lib/config/features.ts` directly and set the flag to `true` (or the desired string value). These are compile-time constants -- there is no env-var override mechanism. Do not commit the change.

```typescript
DEBATE: true,  // temporarily enable for local testing
```

## Key Files

- `src/lib/config/features.ts` -- flag definitions and `AddressSpecificity` type
- `src/lib/components/modals/ModalRegistry.svelte` -- gates debate, wallet, and address modals
- `src/routes/s/[slug]/+page.svelte` -- primary consumer; checks all five flags
- `src/routes/browse/+page.server.ts`, `src/routes/+page.server.ts` -- server-side CWC filtering
