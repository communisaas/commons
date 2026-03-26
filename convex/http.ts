/**
 * Convex HTTP router — public API v1 endpoints + Stripe webhooks.
 *
 * Maps external HTTP requests to Convex queries/mutations/actions.
 * API key authentication is handled inline in each httpAction.
 */

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

// =============================================================================
// PUBLIC API v1 — SUPPORTERS
// =============================================================================

http.route({
  path: "/api/v1/supporters",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    // API key auth will be wired when key hashing is migrated
    return new Response(
      JSON.stringify({
        error: "Public API v1 is being migrated to Convex. Use the SvelteKit API for now.",
        migration: "in_progress",
      }),
      { status: 501, headers: { "Content-Type": "application/json" } },
    );
  }),
});

http.route({
  path: "/api/v1/supporters",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    return new Response(
      JSON.stringify({
        error: "Public API v1 is being migrated to Convex. Use the SvelteKit API for now.",
        migration: "in_progress",
      }),
      { status: 501, headers: { "Content-Type": "application/json" } },
    );
  }),
});

// =============================================================================
// PUBLIC API v1 — CAMPAIGNS
// =============================================================================

http.route({
  path: "/api/v1/campaigns",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    return new Response(
      JSON.stringify({
        error: "Public API v1 is being migrated to Convex. Use the SvelteKit API for now.",
        migration: "in_progress",
      }),
      { status: 501, headers: { "Content-Type": "application/json" } },
    );
  }),
});

// =============================================================================
// STRIPE WEBHOOK
// =============================================================================

http.route({
  path: "/webhooks/stripe",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return new Response(
        JSON.stringify({ error: "Missing stripe-signature header" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Read raw body for signature verification
    const body = await request.text();

    // Stripe signature verification requires the STRIPE_WEBHOOK_SECRET env var.
    // In the Convex runtime, we verify using the Stripe library in an action.
    // For now, we parse the event and delegate to the subscription action.
    //
    // IMPORTANT: In production, signature verification MUST happen before
    // processing. This is a scaffold — the actual Stripe SDK verification
    // will be added when the Stripe npm package is bundled into Convex.

    let event: { type: string; data: { object: unknown } };
    try {
      event = JSON.parse(body);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      await ctx.runAction(internal.subscriptions.processStripeWebhook, {
        eventType: event.type,
        data: event.data.object,
      });
    } catch (err) {
      console.error("[webhooks/stripe] Processing failed:", err);
      // Always return 200 to acknowledge receipt — Stripe retries on non-2xx
    }

    return new Response("ok", { status: 200 });
  }),
});

export default http;
