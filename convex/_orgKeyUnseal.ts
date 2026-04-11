/**
 * Server-side org key seal/unseal for automated operations.
 *
 * During org encryption setup, the client exports the raw org key bytes and
 * sends them to a Convex action that wraps them with ORG_KEY_WRAPPING_KEY
 * (AES-256-GCM). The sealed blob is stored on the organization record as
 * `serverSealedOrgKey`. Automated server-side operations (campaign action
 * ingestion, email blasts, donation checkout) unseal the org key from this
 * blob to encrypt/decrypt supporter PII without needing a human passphrase.
 *
 * Wrapping key: 32-byte hex string in ORG_KEY_WRAPPING_KEY env var.
 * Sealed blob format: JSON { ciphertext: base64, iv: base64, v: "seal-1" }
 */

import { importOrgKey } from "./_orgKey";

const encoder = new TextEncoder();

interface SealedOrgKey {
  ciphertext: string; // base64
  iv: string; // base64
  v: "seal-1";
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getWrappingKey(): Uint8Array {
  const hex = process.env.ORG_KEY_WRAPPING_KEY;
  if (!hex) throw new Error("ORG_KEY_WRAPPING_KEY not configured");
  const bytes = hexToBytes(hex);
  if (bytes.length !== 32) throw new Error("ORG_KEY_WRAPPING_KEY must be 32 bytes (64 hex chars)");
  return bytes;
}

async function importWrappingKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    getWrappingKey(),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Seal raw org key bytes with the server wrapping key.
 * Called during org encryption setup from a Convex action.
 * AAD binds the sealed blob to the specific orgId.
 */
export async function sealOrgKey(rawKeyBase64: string, orgId: string): Promise<string> {
  const wrappingKey = await importWrappingKey();
  const rawKeyBytes = base64ToBytes(rawKeyBase64);

  if (rawKeyBytes.length !== 32) {
    throw new Error("Org key must be 32 bytes");
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = encoder.encode(`commons-server-sealed-org-key-v1:${orgId}`);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    wrappingKey,
    rawKeyBytes,
  );

  const sealed: SealedOrgKey = {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    v: "seal-1",
  };

  return JSON.stringify(sealed);
}

/**
 * Unseal the org key from a sealed blob.
 * Returns a CryptoKey ready for encrypt/decrypt operations.
 * AAD must match the orgId used during sealing.
 */
export async function unsealOrgKey(sealedBlob: string, orgId: string): Promise<CryptoKey> {
  const wrappingKey = await importWrappingKey();
  const sealed: SealedOrgKey = JSON.parse(sealedBlob);

  if (sealed.v !== "seal-1") {
    throw new Error(`Unknown seal version: ${sealed.v}`);
  }

  const ciphertext = base64ToBytes(sealed.ciphertext);
  const iv = base64ToBytes(sealed.iv);
  const aad = encoder.encode(`commons-server-sealed-org-key-v1:${orgId}`);

  const rawKeyBytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    wrappingKey,
    ciphertext,
  );

  return importOrgKey(rawKeyBytes);
}

/**
 * Get the unsealed org key for a given org. Returns null if org has no
 * serverSealedOrgKey configured (legacy encryption still in use).
 *
 * Use this in Convex actions that need to encrypt/decrypt supporter PII
 * without a human passphrase present.
 */
/**
 * Get the unsealed org key for a given org. Returns null if org has no
 * serverSealedOrgKey configured.
 *
 * Accepts either a db reader (query/mutation ctx.db) or an action ctx.
 * For actions: reads the org via ctx.runQuery (since actions lack ctx.db).
 */
export async function getOrgKeyForAction(
  ctx: any,
  orgId: string,
): Promise<CryptoKey | null> {
  let sealedBlob: string | undefined;

  if (ctx.db && typeof ctx.db.get === "function") {
    // Query/mutation context — direct db access
    const org = await ctx.db.get(orgId);
    if (!org) return null;
    sealedBlob = org.serverSealedOrgKey;
  } else if (typeof ctx.runQuery === "function") {
    // Action context — read via internal query
    const { internal } = await import("./_generated/api");
    const org = await ctx.runQuery(internal.organizations.getOrgById, { orgId });
    if (!org) return null;
    sealedBlob = org.serverSealedOrgKey;
  } else {
    return null;
  }

  if (!sealedBlob) return null;
  return unsealOrgKey(sealedBlob, orgId);
}
