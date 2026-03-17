# Live Updates Architecture

> **Status**: P0 IMPLEMENTED (campaign SSE stream), P1-P3 design only.

---

## Current State

### What exists
- `createSSEStream()` in `src/lib/server/sse-stream.ts` — CF Pages-compatible TransformStream with typed event emitter
- `SSE_HEADERS` with anti-buffering headers for Cloudflare and reverse proxies
- Three SSE endpoints already live:
  - `/api/debates/:debateId/stream` — debate market updates
  - `/api/agents/stream-message` — AI message generation
  - `/api/agents/stream-decision-makers` — decision-maker resolution
  - `/api/agents/stream-subject` — subject line generation

### What doesn't exist
- **No SSE for campaign actions** — verification packet is recomputed from scratch on every page load
- **No SSE for supporter verification state changes** — supporter list doesn't reflect real-time verification
- **Embed widget → dashboard**: Widget sends `postMessage` on action submission, but the org dashboard doesn't listen for it

---

## Design: Campaign Action Stream

### Endpoint

```
GET /api/org/:slug/campaigns/:campaignId/stream
```

Authorization: session cookie, membership check (viewer+). `:slug` is resolved to org via `loadOrgContext()`.

**Status**: IMPLEMENTED — `src/routes/api/org/[slug]/campaigns/[campaignId]/stream/+server.ts`

### Events

| Event | Payload | When |
|-------|---------|------|
| `action` | `{ total, verified, verifiedPct, districtCount }` | New campaign action submitted |
| `packet` | Full `VerificationPacket` | Periodic recomputation (every 30s if changed) |
| `delivery` | `{ deliveryId, status, targetEmail }` | Report delivery status change |
| `heartbeat` | `{}` | Every 15s to keep connection alive |

### Server Implementation

```typescript
// src/routes/api/org/[orgId]/campaigns/[campaignId]/stream/+server.ts
import { createSSEStream, SSE_HEADERS } from '$lib/server/sse-stream';
import { computeVerificationPacket } from '$lib/server/campaigns/verification';

export async function GET({ params, locals }) {
  // Auth check
  const { stream, emitter } = createSSEStream({
    traceId: crypto.randomUUID(),
    endpoint: 'campaign-stream',
    userId: locals.user?.id
  });

  // Send initial packet
  const packet = await computeVerificationPacket(params.campaignId, orgId);
  emitter.send('packet', packet);

  // Poll for changes (CF Workers can't use pg LISTEN/NOTIFY)
  const interval = setInterval(async () => {
    const updated = await computeVerificationPacket(params.campaignId, orgId);
    emitter.send('packet', updated);
  }, 30_000);

  // Heartbeat
  const heartbeat = setInterval(() => emitter.send('heartbeat', {}), 15_000);

  // Cleanup on disconnect
  stream.cancel = () => {
    clearInterval(interval);
    clearInterval(heartbeat);
    emitter.close();
  };

  return new Response(stream, { headers: SSE_HEADERS });
}
```

### Client Consumption

```svelte
<script lang="ts">
  import { browser } from '$app/environment';

  let packet = $state(data.packet);

  $effect(() => {
    if (!browser) return;
    const es = new EventSource(`/api/org/${data.org.id}/campaigns/${data.campaign.id}/stream`);
    es.addEventListener('packet', (e) => {
      packet = JSON.parse(e.data);
    });
    return () => es.close();
  });
</script>

<VerificationPacket {packet} />
```

---

## Design: Supporter Verification Stream

### Endpoint

```
GET /api/org/:orgId/supporters/stream
```

### Events

| Event | Payload | When |
|-------|---------|------|
| `verification` | `{ supporterId, verified: boolean }` | Supporter completes identity verification |
| `summary` | `{ verified, postal, imported }` | Summary counts updated |

### Use case
The supporters list page (`/org/:slug/supporters`) currently shows verification state as a static snapshot. With this stream, the germination pipeline (○ → ◐ → ●) could animate in real time as supporters verify.

---

## Design: Embed Widget Bridge

### Current gap
The embed widget at `/embed/campaign/:id` sends `postMessage` when a user submits an action, but the org dashboard doesn't listen. This means an org member watching their campaign page won't see actions arrive from the widget in real-time.

### Solution
The campaign action SSE stream (above) solves this without postMessage. When a widget submission creates a `campaignAction` row, the polling SSE stream will pick it up on the next 30s cycle. No additional bridge needed — the SSE stream is the single source of truth.

For lower latency: the widget's API endpoint (`/api/campaigns/:id/actions`) could emit a lightweight notification that triggers an immediate SSE push rather than waiting for the next poll. This is an optimization, not a requirement.

---

## Constraints

### Cloudflare Workers
- **No WebSockets** on Pages (requires Durable Objects, which Pages doesn't support)
- **No pg LISTEN/NOTIFY** — Hyperdrive doesn't proxy notification channels
- **30s poll** is the pragmatic choice. TransformStream + SSE works within Workers' execution model.
- **Request timeout**: CF Workers have a 30s CPU limit per request, but SSE streams use I/O time (not CPU), so long-lived connections work. The stream stays open as long as the client maintains it.

### Packet computation cost
`computeVerificationPacket()` runs 6 parallel queries. At 30s intervals with multiple concurrent viewers, this could become expensive. Mitigation options:
1. **Cache in KV**: Write packet to CF KV on each campaign action write, read from KV in stream (near-zero cost)
2. **Debounce**: Only recompute if `campaignAction.count` has changed since last computation
3. **Stale-while-revalidate**: Return cached packet immediately, recompute in background

### Recommended: KV cache approach
```
On action write → computeVerificationPacket() → KV.put(`packet:${campaignId}`, JSON.stringify(packet))
On stream poll → KV.get(`packet:${campaignId}`) → emit if changed
```
This collapses N concurrent viewers from N×6 queries to 1×6 queries per action.

---

## Implementation Priority

| Priority | Feature | Effort | Status |
|----------|---------|--------|--------|
| **P0** | Campaign action SSE stream | ~100 lines server + ~20 lines client | **DONE** — `/api/org/[slug]/campaigns/[campaignId]/stream` |
| **P1** | KV packet cache | ~30 lines | Pending — needed before multi-viewer scale |
| **P2** | Supporter verification stream | ~40 lines | Pending — nice-to-have, germination animation |
| **P3** | Instant widget bridge | ~15 lines | Pending — optimization over 30s poll |
