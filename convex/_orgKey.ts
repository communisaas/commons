/**
 * Org-level PII encryption — Convex runtime subset.
 *
 * Byte-identical encrypt/decrypt with src/lib/core/crypto/org-pii-encryption.ts.
 * No PBKDF2, no BIP39, no device wrapping — those are client-only.
 * Exists so the TEE enclave handler can decrypt supporter emails
 * after receiving the unsealed org key.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface OrgEncryptedPii {
  ciphertext: string; // base64
  iv: string; // base64
  v: "org-1"; // version tag
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

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    orgKey,
    encoder.encode(plaintext),
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    v: "org-1",
  };
}

/**
 * Decrypt a PII field with the org key.
 */
export async function decryptWithOrgKey(
  encrypted: OrgEncryptedPii,
  orgKey: CryptoKey,
  entityId: string,
  fieldName: string,
): Promise<string> {
  const ciphertext = base64ToBytes(encrypted.ciphertext);
  const iv = base64ToBytes(encrypted.iv);
  const aad = encoder.encode(`${entityId}:${fieldName}`);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    orgKey,
    ciphertext,
  );

  return decoder.decode(plaintext);
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
