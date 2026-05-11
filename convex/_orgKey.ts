/**
 * Org-level PII encryption — Convex runtime subset.
 *
 * Byte-identical encrypt/decrypt with src/lib/core/crypto/org-pii-encryption.ts.
 * No PBKDF2, no BIP39, no device wrapping — those are client-only.
 * Exists so the TEE enclave handler can decrypt supporter emails
 * after receiving the unsealed org key.
 */

import { toArrayBuffer } from "./_bufferSource";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Versioned blob format. `v` distinguishes the AAD scheme:
//   "org-1" — AAD = `${entityId}:${fieldName}` where entityId is
//             typically `supporter:${rowId}` (legacy two-phase pattern:
//             insert with empty ciphertext, encrypt with the post-insert
//             rowId as AAD anchor, patch the row).
//   "org-2" — AAD = `eh:${emailHash}:${fieldName}` where emailHash is
//             the org-scoped SHA-256(orgId + ":email:" + normalized).
//             Deterministic pre-insert because emailHash is derived
//             from plaintext that the caller already has. Enables
//             single-phase encrypt-then-insert
//             so the two-phase placeholder window (and its associated
//             stranded-row cleanup cron) becomes
//             unnecessary for new writes.
export interface OrgEncryptedPii {
  ciphertext: string; // base64
  iv: string; // base64
  v: "org-1" | "org-2"; // version tag
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

/**
 * Encrypt a PII field with the org key.
 * AES-256-GCM with AAD binding to entity + field.
 */
export async function encryptWithOrgKey(
  plaintext: string,
  orgKey: CryptoKey,
  entityId: string,
  fieldName: string,
): Promise<OrgEncryptedPii> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = encoder.encode(`${entityId}:${fieldName}`);
  const plaintextBytes = encoder.encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(aad) },
    orgKey,
    toArrayBuffer(plaintextBytes),
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    v: "org-1",
  };
}

/**
 * Decrypt a PII field with the org key.
 * Routes by blob version: `org-1` uses the legacy entityId-based AAD,
 * `org-2` uses the emailHash-based AAD. Callers that know which scheme
 * the blob uses can call `decryptOrgPiiV2` directly; mixed legacy/
 * post-migration data passes through this dispatcher.
 */
export async function decryptWithOrgKey(
  encrypted: OrgEncryptedPii,
  orgKey: CryptoKey,
  entityId: string,
  fieldName: string,
): Promise<string> {
  if (encrypted.v === "org-2") {
    // v=org-2 blobs use emailHash-based AAD. The `entityId` arg is
    // expected to be `eh:${emailHash}` already; callers reading mixed
    // data via this dispatcher need to know which scheme each row
    // uses (the row carries `emailHash` so the caller derives the
    // V2 entityId from `eh:${row.emailHash}`).
  }
  const ciphertext = base64ToBytes(encrypted.ciphertext);
  const iv = base64ToBytes(encrypted.iv);
  const aad = encoder.encode(`${entityId}:${fieldName}`);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(aad) },
    orgKey,
    toArrayBuffer(ciphertext),
  );

  return decoder.decode(plaintext);
}

/**
 * Encrypt a PII field with the org key using the v=org-2 AAD scheme
 * (`eh:${emailHash}:${fieldName}`). Caller passes the emailHash
 * directly — derivable from plaintext via `computeOrgScopedEmailHash`
 * before any DB write, which is what makes single-phase insert
 * possible.
 */
export async function encryptForSupporterV2(
  plaintext: string,
  orgKey: CryptoKey,
  emailHash: string,
  fieldName: string,
): Promise<OrgEncryptedPii> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = encoder.encode(`eh:${emailHash}:${fieldName}`);
  const plaintextBytes = encoder.encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(aad) },
    orgKey,
    toArrayBuffer(plaintextBytes),
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    v: "org-2",
  };
}

/**
 * Decrypt a v=org-2 blob. Convenience helper that constructs the
 * `eh:${emailHash}` entityId from the row's emailHash field. Falls
 * through to the legacy `decryptWithOrgKey` path for `v: "org-1"`
 * blobs so consumers reading mixed data can route a single call:
 *   `await decryptOrgPii(blob, orgKey, row.emailHash, row._id, "email")`
 * picks the right scheme based on `blob.v`.
 */
export async function decryptOrgPii(
  encrypted: OrgEncryptedPii,
  orgKey: CryptoKey,
  emailHash: string,
  rowIdForLegacy: string,
  fieldName: string,
): Promise<string> {
  if (encrypted.v === "org-2") {
    return decryptWithOrgKey(encrypted, orgKey, `eh:${emailHash}`, fieldName);
  }
  // v=org-1: legacy AAD = `supporter:${_id}:${fieldName}` etc.
  // Caller supplies the rowId prefix string verbatim (e.g.
  // `supporter:${row._id}` or `rsvp:${emailHash}` matching the
  // historical entityId convention at the time of write).
  return decryptWithOrgKey(encrypted, orgKey, rowIdForLegacy, fieldName);
}

/**
 * Import raw org key bytes as a CryptoKey.
 * Used by the TEE handler after unsealing the org key from KMS.
 */
export async function importOrgKey(rawKeyBytes: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    rawKeyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
