"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
// node:crypto is provided by the Convex Node runtime (this file is "use node").
// Its types aren't visible because convex/tsconfig.json is V8-default (no @types/node,
// to keep the minimal `process` shim valid in V8 files). Runtime resolution is correct.
// @ts-expect-error -- node builtin types absent from the V8-default convex tsconfig
import { createVerify, X509Certificate } from "node:crypto";
import { validateCertURL, buildSigningString } from "./_snsVerifyHelpers";

// AWS SNS Message Signature Verification.
// Verifies authenticity of SES → SNS → Convex webhooks per:
//   https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
// 1. Validate SigningCertURL is from amazonaws.com (SSRF prevention)
// 2. Fetch the X.509 cert
// 3. Reconstruct the canonical signing string per AWS SNS spec
// 4. Verify the RSA signature against the cert's public key

const certCache = new Map<string, { pem: string; fetchedAt: number }>();
const CERT_CACHE_TTL_MS = 60 * 60 * 1000;

async function fetchCert(certURL: string): Promise<string> {
  const cached = certCache.get(certURL);
  if (cached && Date.now() - cached.fetchedAt < CERT_CACHE_TTL_MS) {
    return cached.pem;
  }
  // Bound the fetch so a hung AWS network leg cannot pin the webhook action
  // for its full 10-minute execution budget. 5s covers warm AWS responses with
  // headroom; if an AWS region has structural latency that exceeds this we
  // want the operator to see "fetch failed" not silent-stall, and the cached
  // entry from the prior hour will still serve us.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let resp: Response;
  try {
    resp = await fetch(certURL, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    throw new Error(`Failed to fetch SNS signing certificate: ${resp.status}`);
  }
  const pem = await resp.text();
  try {
    new X509Certificate(pem);
  } catch {
    throw new Error("Invalid X.509 certificate from SigningCertURL");
  }
  certCache.set(certURL, { pem, fetchedAt: Date.now() });
  return pem;
}

export const verifySnsSignature = internalAction({
  args: {
    Type: v.string(),
    MessageId: v.string(),
    TopicArn: v.string(),
    Timestamp: v.string(),
    Message: v.string(),
    Signature: v.string(),
    SignatureVersion: v.string(),
    SigningCertURL: v.string(),
    Subject: v.optional(v.string()),
    SubscribeURL: v.optional(v.string()),
    Token: v.optional(v.string()),
    expectedTopicArn: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<{ valid: boolean; error?: string }> => {
    if (args.expectedTopicArn && args.TopicArn !== args.expectedTopicArn) {
      return { valid: false, error: `Unexpected TopicArn: ${args.TopicArn}` };
    }
    if (!validateCertURL(args.SigningCertURL)) {
      return { valid: false, error: `Invalid SigningCertURL: ${args.SigningCertURL}` };
    }
    if (args.SignatureVersion !== "1" && args.SignatureVersion !== "2") {
      return {
        valid: false,
        error: `Unsupported SignatureVersion: ${args.SignatureVersion}`,
      };
    }

    let pem: string;
    try {
      pem = await fetchCert(args.SigningCertURL);
    } catch (err) {
      return {
        valid: false,
        error: `Certificate fetch failed: ${(err as Error).message}`,
      };
    }

    const signingString = buildSigningString({
      Type: args.Type,
      MessageId: args.MessageId,
      TopicArn: args.TopicArn,
      Timestamp: args.Timestamp,
      Message: args.Message,
      Subject: args.Subject,
      SubscribeURL: args.SubscribeURL,
      Token: args.Token,
    });
    const algorithm = args.SignatureVersion === "2" ? "SHA256" : "SHA1";
    const verifier = createVerify(algorithm);
    verifier.update(signingString);

    const valid = verifier.verify(pem, args.Signature, "base64");
    return valid ? { valid: true } : { valid: false, error: "Signature verification failed" };
  },
});
