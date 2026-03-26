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

    // --- Stripe HMAC-SHA256 signature verification ---
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("[webhooks/stripe] STRIPE_WEBHOOK_SECRET not configured");
      return new Response("Internal server error", { status: 500 });
    }

    // Parse signature header: t=timestamp,v1=signature
    const parts = Object.fromEntries(
      signature.split(",").map((p) => {
        const [k, v] = p.split("=");
        return [k, v];
      }),
    );
    const timestamp = parts["t"];
    const sig = parts["v1"];
    if (!timestamp || !sig) {
      return new Response(
        JSON.stringify({ error: "Invalid signature format" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Compute expected signature
    const payload = `${timestamp}.${body}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(payload),
    );
    const expected = Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Constant-time comparison to prevent timing oracle
    const sigBytes = new TextEncoder().encode(sig);
    const expectedBytes = new TextEncoder().encode(expected);
    if (sigBytes.length !== expectedBytes.length) {
      return new Response("Invalid signature", { status: 400 });
    }
    let mismatch = 0;
    for (let i = 0; i < sigBytes.length; i++) {
      mismatch |= sigBytes[i] ^ expectedBytes[i];
    }
    if (mismatch !== 0) {
      return new Response("Invalid signature", { status: 400 });
    }

    // Verify timestamp is within 5 minutes (prevent replay attacks)
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
      return new Response(
        JSON.stringify({ error: "Timestamp too old" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

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
