/**
 * Convex HTTP router — public API v1 endpoints + all webhooks.
 *
 * Maps external HTTP requests to Convex queries/mutations/actions.
 * API key authentication is handled inline in each httpAction.
 *
 * Webhook routes:
 * - POST /webhooks/stripe — Stripe subscription + donation events
 * - POST /webhooks/ses — AWS SES bounce/complaint/open/click via SNS
 * - POST /webhooks/twilio/sms — Twilio SMS delivery status
 * - POST /webhooks/twilio/inbound — Twilio inbound SMS (STOP/START)
 * - POST /webhooks/twilio/call-status — Twilio call status updates
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

    let event: { type: string; data: { object: Record<string, unknown> } };
    try {
      event = JSON.parse(body);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const eventData = event.data.object as Record<string, unknown>;

    // Handle donation checkouts and refunds via webhooks module
    // Donations use upsert-by-paymentIntentId, so retries are safe (idempotent).
    try {
      if (event.type === "checkout.session.completed") {
        const metadata = eventData.metadata as Record<string, string> | undefined;
        if (metadata?.type === "donation" && metadata.donationId) {
          await ctx.runMutation(internal.webhooks.completeDonation, {
            donationId: metadata.donationId,
            campaignId: metadata.campaignId,
            stripePaymentIntentId:
              typeof eventData.payment_intent === "string"
                ? eventData.payment_intent
                : undefined,
            stripeSubscriptionId:
              typeof eventData.subscription === "string"
                ? eventData.subscription
                : undefined,
          });
        }
      }

      if (event.type === "charge.refunded") {
        const paymentIntentId =
          typeof eventData.payment_intent === "string"
            ? eventData.payment_intent
            : null;
        if (paymentIntentId) {
          await ctx.runMutation(internal.webhooks.refundDonation, {
            stripePaymentIntentId: paymentIntentId,
          });
        }
      }
    } catch (err) {
      console.error("[webhooks/stripe] Donation processing failed:", err);
      return new Response("donation processing error", { status: 500 });
    }

    // Handle subscription events via subscriptions module.
    // Return 500 on failure so Stripe retries with exponential backoff (up to 72h).
    try {
      await ctx.runAction(internal.subscriptions.processStripeWebhook, {
        eventType: event.type,
        data: eventData,
      });
    } catch (err) {
      console.error("[webhooks/stripe] Subscription processing failed:", err);
      return new Response("subscription processing error", { status: 500 });
    }

    return new Response("ok", { status: 200 });
  }),
});

// =============================================================================
// SES BOUNCE/COMPLAINT WEBHOOK (via AWS SNS)
// =============================================================================

http.route({
  path: "/webhooks/ses",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: Record<string, unknown>;

    try {
      // SNS sends Content-Type: text/plain, so parse raw text as JSON
      const raw = await request.text();
      body = JSON.parse(raw);
    } catch {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid JSON" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Reject messages from unexpected SNS topics
    const allowedTopic = process.env.SES_SNS_TOPIC_ARN;
    if (!allowedTopic) {
      console.error("[ses-webhook] SES_SNS_TOPIC_ARN not configured");
      return new Response(
        JSON.stringify({ ok: false, error: "webhook not configured" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }
    if (body.TopicArn !== allowedTopic) {
      console.error("[ses-webhook] Unexpected TopicArn:", body.TopicArn);
      return new Response(
        JSON.stringify({ ok: false, error: "topic not allowed" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    // SNS signature verification
    // Validate SigningCertURL is from amazonaws.com (SSRF prevention)
    const certURL = body.SigningCertURL as string | undefined;
    if (certURL) {
      try {
        const url = new URL(certURL);
        const validCert =
          url.protocol === "https:" &&
          url.pathname.endsWith(".pem") &&
          /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname);
        if (!validCert) {
          return new Response(
            JSON.stringify({ ok: false, error: "invalid SigningCertURL" }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        }
      } catch {
        return new Response(
          JSON.stringify({ ok: false, error: "invalid SigningCertURL" }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    // Parse the inner SES message for Notification type
    let message: Record<string, unknown> | undefined;
    if (body.Type === "Notification" && typeof body.Message === "string") {
      try {
        message = JSON.parse(body.Message);
      } catch {
        return new Response(
          JSON.stringify({ ok: false, error: "invalid Message JSON" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    try {
      await ctx.runAction(internal.webhooks.processSesWebhook, {
        snsType: body.Type as string,
        subscribeURL: body.SubscribeURL as string | undefined,
        message,
      });
    } catch (err) {
      console.error("[webhooks/ses] Processing failed:", err);
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }),
});

// =============================================================================
// TWILIO SMS DELIVERY STATUS WEBHOOK
// =============================================================================

/**
 * Validate Twilio request signature (HMAC-SHA1).
 * Inline implementation to avoid importing SvelteKit server code.
 */
async function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;

  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const keyData = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    keyData,
    new TextEncoder().encode(data),
  );

  // Base64 encode
  const computed = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // Constant-time comparison
  if (computed.length !== signature.length) return false;
  const a = new TextEncoder().encode(computed);
  const b = new TextEncoder().encode(signature);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Parse Twilio form-encoded body into a Record.
 */
function parseTwilioFormBody(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of body.split("&")) {
    const [key, value] = pair.split("=");
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(value ?? "");
    }
  }
  return params;
}

http.route({
  path: "/webhooks/twilio/sms",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const params = parseTwilioFormBody(rawBody);

    // Validate Twilio signature
    const signature = request.headers.get("X-Twilio-Signature") || "";
    const valid = await validateTwilioSignature(
      signature,
      request.url,
      params,
    );
    if (!valid) {
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    const messageSid = params.MessageSid;
    const messageStatus = params.MessageStatus;
    const errorCode = params.ErrorCode;

    if (!messageSid || !messageStatus) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      await ctx.runMutation(internal.webhooks.updateSmsStatus, {
        twilioSid: messageSid,
        status: messageStatus,
        errorCode: errorCode || undefined,
      });
    } catch (err) {
      console.error("[webhooks/twilio/sms] Processing failed:", err);
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }),
});

// =============================================================================
// TWILIO INBOUND SMS WEBHOOK (STOP/START for TCPA compliance)
// =============================================================================

http.route({
  path: "/webhooks/twilio/inbound",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const params = parseTwilioFormBody(rawBody);

    // Validate Twilio signature
    const signature = request.headers.get("X-Twilio-Signature") || "";
    const valid = await validateTwilioSignature(
      signature,
      request.url,
      params,
    );
    if (!valid) {
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    const from = params.From;
    const body = (params.Body || "").trim();

    if (!from) {
      return new Response(
        JSON.stringify({ error: "Missing From number" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      await ctx.runMutation(internal.webhooks.handleInboundSms, {
        from,
        body,
      });
    } catch (err) {
      console.error("[webhooks/twilio/inbound] Processing failed:", err);
    }

    // Return empty TwiML (no auto-reply — Twilio handles STOP/START responses)
    return new Response("<Response></Response>", {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }),
});

// =============================================================================
// TWILIO CALL STATUS WEBHOOK
// =============================================================================

http.route({
  path: "/webhooks/twilio/call-status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const params = parseTwilioFormBody(rawBody);

    // Validate Twilio signature
    const signature = request.headers.get("X-Twilio-Signature") || "";
    const valid = await validateTwilioSignature(
      signature,
      request.url,
      params,
    );
    if (!valid) {
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    const callSid = params.CallSid;
    const callStatus = params.CallStatus;
    const duration = params.CallDuration ? parseInt(params.CallDuration, 10) : undefined;

    if (!callSid || !callStatus) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Map Twilio status to our status names
    const statusMap: Record<string, string> = {
      initiated: "initiated",
      ringing: "ringing",
      "in-progress": "in-progress",
      completed: "completed",
      failed: "failed",
      busy: "busy",
      "no-answer": "no-answer",
    };

    const mappedStatus = statusMap[callStatus];
    if (!mappedStatus) {
      console.warn(`[call-status] Unknown Twilio status: ${callStatus}`);
      return new Response(
        JSON.stringify({ ok: true }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const isTerminal = ["completed", "failed", "busy", "no-answer"].includes(mappedStatus);

    try {
      await ctx.runMutation(internal.webhooks.updateCallStatus, {
        callSid,
        status: mappedStatus,
        duration,
        isTerminal,
      });
    } catch (err) {
      console.error("[webhooks/twilio/call-status] Processing failed:", err);
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }),
});

export default http;
