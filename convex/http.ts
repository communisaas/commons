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

import { httpRouter, makeFunctionReference } from "convex/server";
import type { FunctionReference } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Constant-time match of `presented` against any of the candidate secrets
 * (active + optional rotation-window previous). Convex's V8 isolate runtime
 * exposes Web Crypto but not `node:crypto.timingSafeEqual`, so this uses an
 * inline XOR-accumulator over equal-length byte arrays. Length mismatch
 * is rejected before the comparison loop — that leaks the secret's length
 * class, but operators set the secret format to a known length anyway.
 *
 * Exported so tests can exercise the rotation contract without setting up
 * a Convex httpAction harness.
 */
export function bearerSecretMatches(presented: string, candidates: string[]): boolean {
  const validCandidates = candidates.filter((s) => typeof s === "string" && s.length > 0);
  if (validCandidates.length === 0 || !presented) return false;
  const presentedBytes = new TextEncoder().encode(presented);
  for (const secret of validCandidates) {
    const secretBytes = new TextEncoder().encode(secret);
    if (presentedBytes.length !== secretBytes.length) continue;
    let mismatch = 0;
    for (let i = 0; i < presentedBytes.length; i++) {
      mismatch |= presentedBytes[i] ^ secretBytes[i];
    }
    if (mismatch === 0) return true;
  }
  return false;
}

const http = httpRouter();

// Manual reference for the SNS signature verifier — tracked under
// `convex/_snsVerify.ts` (node runtime). Replace with `internal._snsVerify`
// once `npx convex dev` regenerates `_generated/api.d.ts`.
const verifySnsSignatureRef = makeFunctionReference<"action">(
  "_snsVerify:verifySnsSignature",
) as unknown as FunctionReference<
  "action",
  "internal",
  {
    Type: string;
    MessageId: string;
    TopicArn: string;
    Timestamp: string;
    Message: string;
    Signature: string;
    SignatureVersion: string;
    SigningCertURL: string;
    Subject?: string;
    SubscribeURL?: string;
    Token?: string;
    expectedTopicArn?: string;
  },
  { valid: boolean; error?: string }
>;

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

    // Parse signature header: t=timestamp,v1=signature[,v1=signature...]
    //
    // Stripe explicitly permits MULTIPLE `v1=` entries in the header
    // during secret rotation. `Object.fromEntries(...)` would collapse
    // duplicate keys to the LAST value — if Stripe emitted
    // `t=...,v1=<active>,v1=<previous>` and the deployment only had the
    // active secret configured, the verifier would read the
    // previous-key signature and reject valid traffic, causing a silent
    // outage on the donation + subscription pipeline. Extract ALL `v1=`
    // candidates and try each against the computed expected signature
    // — verified if ANY constant-time-equals.
    let timestamp: string | undefined;
    const v1Candidates: string[] = [];
    for (const p of signature.split(",")) {
      const eq = p.indexOf("=");
      if (eq <= 0) continue;
      const k = p.slice(0, eq);
      const v = p.slice(eq + 1);
      if (k === "t" && !timestamp) timestamp = v;
      else if (k === "v1") v1Candidates.push(v);
    }
    if (!timestamp || v1Candidates.length === 0) {
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

    // Constant-time comparison across ALL candidates. Verified if any
    // candidate matches the expected signature for the configured secret.
    // Each comparison is constant-time over equal-length byte arrays;
    // we iterate all candidates rather than short-circuiting so the
    // wall-clock signal is uniform across "first match" / "any match"
    // / "no match" (defense-in-depth against statistical timing).
    const expectedBytes = new TextEncoder().encode(expected);
    let anyMatch = false;
    for (const sig of v1Candidates) {
      const sigBytes = new TextEncoder().encode(sig);
      if (sigBytes.length !== expectedBytes.length) continue;
      let mismatch = 0;
      for (let i = 0; i < sigBytes.length; i++) {
        mismatch |= sigBytes[i] ^ expectedBytes[i];
      }
      if (mismatch === 0) anyMatch = true;
    }
    if (!anyMatch) {
      return new Response("Invalid signature", { status: 400 });
    }

    // Verify timestamp is within 5 minutes (prevent replay attacks).
    // Number-of-seconds since epoch per Stripe's signature scheme. Validate
    // finiteness explicitly before the abs compare — without the isFinite
    // gate, a non-numeric `t` parses to NaN, and `NaN > 300` is `false`,
    // which would defeat the replay window. The HMAC verification above
    // already prevents a forged-t-with-valid-sig combination (HMAC binds t),
    // so this is hardening, not a closed exploit. (cure shipped).
    const tSeconds = Number(timestamp);
    if (!Number.isFinite(tSeconds)) {
      return new Response(
        JSON.stringify({ error: "Invalid timestamp format" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    if (Math.abs(Date.now() / 1000 - tSeconds) > 300) {
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

    // SNS signature verification — full RSA signature check via the node
    // runtime helper. Forged payloads cannot poison email-health state even
    // if the endpoint is reachable and the topic ARN is known.
    const requiredFields = [
      "Type",
      "MessageId",
      "TopicArn",
      "Timestamp",
      "Message",
      "Signature",
      "SignatureVersion",
      "SigningCertURL",
    ] as const;
    for (const field of requiredFields) {
      if (typeof body[field] !== "string") {
        return new Response(
          JSON.stringify({ ok: false, error: `missing or invalid ${field}` }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
    }
    const verification = await ctx.runAction(verifySnsSignatureRef, {
        Type: body.Type as string,
        MessageId: body.MessageId as string,
        TopicArn: body.TopicArn as string,
        Timestamp: body.Timestamp as string,
        Message: body.Message as string,
        Signature: body.Signature as string,
        SignatureVersion: body.SignatureVersion as string,
        SigningCertURL: body.SigningCertURL as string,
        Subject: typeof body.Subject === "string" ? body.Subject : undefined,
        SubscribeURL:
          typeof body.SubscribeURL === "string" ? body.SubscribeURL : undefined,
        Token: typeof body.Token === "string" ? body.Token : undefined,
        expectedTopicArn: allowedTopic,
      },
    );
    if (!verification.valid) {
      console.error("[ses-webhook] SNS signature verification failed:", verification.error);
      return new Response(
        JSON.stringify({ ok: false, error: "signature verification failed" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    // Replay-window enforcement. Without this, validating only the RSA
    // signature + TopicArn leaves the Timestamp in the signing string
    // but never compared against `Date.now()`. Captured signed
    // bounce/complaint notifications could be replayed indefinitely to
    // mark a recovered supporter back into `bounced`/`complained`
    // (one-way mark — not idempotent in the recovery direction).
    // Mirrors the Stripe-webhook freshness gate at `:213` (5-minute
    // window). SNS uses 8601 ISO timestamps; parse + abs-diff against
    // now. 10-minute window covers legitimate clock skew + SNS retry
    // latency; anything older is replay.
    const SNS_REPLAY_WINDOW_MS = 10 * 60 * 1000;
    const snsTimestampMs = Date.parse(body.Timestamp as string);
    if (!Number.isFinite(snsTimestampMs)) {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid Timestamp" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    if (Math.abs(Date.now() - snsTimestampMs) > SNS_REPLAY_WINDOW_MS) {
      console.warn(
        `[ses-webhook] Rejected SNS notification outside replay window. MessageId=${body.MessageId} age=${Date.now() - snsTimestampMs}ms`,
      );
      return new Response(
        JSON.stringify({ ok: false, error: "Timestamp outside replay window" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
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
 *
 * `application/x-www-form-urlencoded` represents space as `+` (RFC 1866
 * §8.2.1, W3C URL spec); `decodeURIComponent` alone does NOT convert `+`
 * to space — that's a URI-component decoding behavior. To match Twilio's
 * signature input (which uses form-decoded values), `+` MUST be replaced
 * with space BEFORE percent-decoding. Without this, every SMS message
 * containing a space (effectively all of them) fails signature verify
 * with a 403, silently dropping all status updates. (cure shipped).
 */
function parseTwilioFormBody(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of body.split("&")) {
    const [key, value] = pair.split("=");
    if (key) {
      const decodedKey = decodeURIComponent(key.replace(/\+/g, " "));
      const decodedValue = decodeURIComponent((value ?? "").replace(/\+/g, " "));
      params[decodedKey] = decodedValue;
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
    const to = params.To;
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
        // `To` is the Twilio destination number the user replied to.
        // Forward it to the handler so START semantics can be scoped to
        // the org that owns the number (via `orgTwilioNumbers` registry)
        // instead of resubscribing the user across every org that ever
        // sent them SMS. Optional because legacy webhooks may not have
        // populated `To` and we want the handler to remain defensible
        // without it.
        to: typeof to === "string" && to.length > 0 ? to : undefined,
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

// =============================================================================
// LAMBDA-FORWARDED BLAST RECEIPTS
// =============================================================================

// Lambda calls this after each batch with the resolved per-recipient receipts.
// Auth via shared `BLAST_RECEIPTS_SECRET` (Bearer token). The Lambda sees
// recipient outcomes that the browser may never observe (browser disconnect
// mid-blast, fetch timeouts, etc.) — making this the durable receipt path.
const recordBlastReceiptsInternalRef = makeFunctionReference<"mutation">(
  "blasts:recordBlastReceiptsInternal",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  {
    blastId: Id<"emailBlasts">;
    receipts: Array<{
      recipientEmailHash: string;
      sesMessageId?: string;
      status: "sent" | "failed";
      sentAt: number;
      error?: string;
    }>;
  },
  { written: number; updated: number }
>;

http.route({
  path: "/webhooks/blast-receipts",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const activeSecret = process.env.BLAST_RECEIPTS_SECRET;
    if (!activeSecret) {
      console.error("[blast-receipts] BLAST_RECEIPTS_SECRET not configured");
      return new Response(
        JSON.stringify({ ok: false, error: "endpoint not configured" }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    if (activeSecret.length < 32) {
      console.error(
        "[blast-receipts] BLAST_RECEIPTS_SECRET must be >= 32 bytes (operator misconfig)",
      );
      return new Response(
        JSON.stringify({ ok: false, error: "endpoint misconfigured" }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    // Dual-secret rotation: Lambda may send claims signed under the previous
    // secret while a deploy is mid-rotation. `bearerSecretMatches` does
    // constant-time XOR-accumulator comparison per candidate, but iterates
    // sequentially with early-return on match — an attacker observing
    // wall-clock could in principle distinguish "matched active" from
    // "matched previous". Acceptable because both outcomes return the same
    // 200 response and the timing leak only reveals which secret signed a
    // VALID token (not the secret itself).
    const previousSecret = process.env.BLAST_RECEIPTS_SECRET_PREVIOUS;
    const candidates = previousSecret ? [activeSecret, previousSecret] : [activeSecret];

    const auth = request.headers.get("authorization") ?? "";
    const presented = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!presented || !bearerSecretMatches(presented, candidates)) {
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    let body: { blastId?: string; receipts?: unknown };
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid JSON" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    if (!body.blastId || !Array.isArray(body.receipts)) {
      return new Response(
        JSON.stringify({ ok: false, error: "blastId and receipts[] required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // The mutation's FunctionReference (declared above) carries the typed
    // receipts shape; assert here so the runtime mutation receives the same
    // type contract its validator will enforce.
    type ReceiptsArg = Array<{
      recipientEmailHash: string;
      sesMessageId?: string;
      status: "sent" | "failed";
      sentAt: number;
      error?: string;
    }>;
    try {
      const result = await ctx.runMutation(recordBlastReceiptsInternalRef, {
        blastId: body.blastId as Id<"emailBlasts">,
        receipts: body.receipts as ReceiptsArg,
      });
      return new Response(
        JSON.stringify({ ok: true, ...result }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      console.error("[blast-receipts] mutation failed:", err);
      return new Response(
        JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : "mutation failed",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }),
});

export default http;
