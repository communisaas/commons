/**
 * PII Encryption/Decryption for Convex Functions
 *
 * Standalone port of src/lib/core/crypto/user-pii-encryption.ts
 * Uses Web Crypto API (available in Convex runtime).
 *
 * Key derivation: HKDF(PII_ENCRYPTION_KEY, entityId, "commons-pii-encryption-v1")
 * Email lookup:   HMAC-SHA256(normalize(email), EMAIL_LOOKUP_KEY)
 *
 * IMPORTANT: Byte-identical with the SvelteKit implementation so existing
 * ciphertexts from Prisma can be decrypted in Convex during migration.
 */

/** Encrypted PII field stored as JSON string in the database */
export interface EncryptedPii {
  ciphertext: string; // base64
  iv: string; // base64
  aad?: boolean; // true if encrypted with AAD binding
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// =============================================================================
// ENV KEY ACCESS
// =============================================================================

function getPiiEncryptionKey(): string | null {
  try {
    return process.env.PII_ENCRYPTION_KEY || null;
  } catch {
    return null;
  }
}

function getEmailLookupKey(): string | null {
  try {
    return process.env.EMAIL_LOOKUP_KEY || null;
  } catch {
    return null;
  }
}

// =============================================================================
// BYTE UTILITIES (no Node.js Buffer — Web Crypto compatible)
// =============================================================================

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("Invalid hex string: odd length");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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

// =============================================================================
// EMAIL HASH (deterministic — same email = same hash for lookups)
// =============================================================================

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Compute a deterministic email hash for database lookups.
 * HMAC-SHA256(normalize(email), EMAIL_LOOKUP_KEY)
 *
 * Returns null if EMAIL_LOOKUP_KEY is not configured.
 */
export async function computeEmailHash(
  email: string,
): Promise<string | null> {
  const keyHex = getEmailLookupKey();
  if (!keyHex) {
    console.warn(
      "[PII] EMAIL_LOOKUP_KEY not set — email_hash not computed. " +
        "Generate with: openssl rand -hex 32",
    );
    return null;
  }

  const keyBytes = hexToBytes(keyHex);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const normalized = normalizeEmail(email);
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(normalized),
  );
  return bytesToHex(new Uint8Array(sig));
}

// =============================================================================
// PII ENCRYPTION (per-entity key — different entities, different ciphertexts)
// =============================================================================

async function importPiiMasterKey(hexKey: string): Promise<CryptoKey> {
  const keyBytes = hexToBytes(hexKey);
  if (keyBytes.length !== 32) {
    throw new Error(
      "PII_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)",
    );
  }
  return crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );
}

async function derivePiiKey(
  masterKey: CryptoKey,
  entityId: string,
): Promise<CryptoKey> {
  const info = encoder.encode(entityId);
  const salt = encoder.encode("commons-pii-encryption-v1");

  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Decrypt a PII field from database storage.
 * Supports both legacy (no AAD) and new (AAD-bound) ciphertexts.
 *
 * Deterministic — safe in queries and mutations.
 */
export async function decryptPii(
  encrypted: EncryptedPii,
  entityId: string,
  fieldName: string = "email",
): Promise<string> {
  const masterKeyHex = getPiiEncryptionKey();
  if (!masterKeyHex) {
    console.error("[PII] PII_ENCRYPTION_KEY not set — cannot decrypt PII");
    throw new Error("Encryption service not available");
  }

  const masterKey = await importPiiMasterKey(masterKeyHex);
  const entityKey = await derivePiiKey(masterKey, entityId);

  const ciphertext = base64ToBytes(encrypted.ciphertext);
  const iv = base64ToBytes(encrypted.iv);

  const params: AesGcmParams = { name: "AES-GCM", iv };
  if (encrypted.aad) {
    params.additionalData = encoder.encode(`${entityId}:${fieldName}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plaintextBuf = await (crypto.subtle.decrypt as any)(
    params,
    entityKey,
    ciphertext,
  );
  return decoder.decode(plaintextBuf);
}

/**
 * Try to decrypt a PII field, returning null on failure.
 *
 * Deterministic — safe in queries and mutations.
 */
export async function tryDecryptPii(
  encrypted: EncryptedPii | null | undefined,
  entityId: string,
  fieldName: string = "email",
): Promise<string | null> {
  if (!encrypted?.ciphertext || !encrypted?.iv) return null;
  try {
    return await decryptPii(encrypted, entityId, fieldName);
  } catch {
    return null;
  }
}

/**
 * Encrypt a PII field for database storage.
 * Uses AES-256-GCM with AAD binding to entity+field.
 *
 * Non-deterministic (random IV) — use only in Actions.
 */
export async function encryptPii(
  plaintext: string,
  entityId: string,
  fieldName: string = "email",
): Promise<EncryptedPii> {
  const masterKeyHex = getPiiEncryptionKey();
  if (!masterKeyHex) {
    console.error("[PII] PII_ENCRYPTION_KEY not set — cannot encrypt PII");
    throw new Error("Encryption service not available");
  }

  const masterKey = await importPiiMasterKey(masterKeyHex);
  const entityKey = await derivePiiKey(masterKey, entityId);

  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM
  const aad = encoder.encode(`${entityId}:${fieldName}`);
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    entityKey,
    encoder.encode(plaintext),
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuf)),
    iv: bytesToBase64(iv),
    aad: true,
  };
}

// =============================================================================
// CONVENIENCE: Supporter email helpers
// =============================================================================

/**
 * Encrypt a supporter's email and compute the email hash.
 * Info string for supporter key derivation is "supporter:{supporterId}".
 *
 * Non-deterministic — use only in Actions.
 */
export async function encryptSupporterEmail(
  email: string,
  supporterId: string,
): Promise<{ encryptedEmail: string; emailHash: string }> {
  const [enc, hash] = await Promise.all([
    encryptPii(email, "supporter:" + supporterId, "email"),
    computeEmailHash(email),
  ]);

  if (!hash) {
    console.error("[PII] EMAIL_LOOKUP_KEY not set — cannot compute email hash for supporter");
    throw new Error("Encryption service not available");
  }

  return {
    encryptedEmail: JSON.stringify(enc),
    emailHash: hash,
  };
}

/**
 * Decrypt a supporter's encrypted email.
 * Info string for supporter key derivation is "supporter:{supporterId}".
 *
 * Deterministic — safe in queries and mutations.
 */
export async function decryptSupporterEmail(supporter: {
  _id: string;
  encryptedEmail: string;
}): Promise<string> {
  if (!supporter.encryptedEmail || supporter.encryptedEmail === "") {
    throw new Error(
      `[PII] Supporter ${supporter._id} has empty encryptedEmail`,
    );
  }
  const enc: EncryptedPii = JSON.parse(supporter.encryptedEmail);
  return await decryptPii(enc, "supporter:" + supporter._id, "email");
}
