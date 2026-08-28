/**
 * Cross-runtime anonymization of geographic identifiers.
 *
 * One module owns exactly one decision: how a district code or postal code
 * becomes an anonymized storage key. Normalization, domain separation, key
 * sourcing, and hex encoding live here and nowhere else, so the SvelteKit HTTP
 * boundary and the Convex mutation/action boundary write byte-identical
 * `districtHash` values into the same columns.
 *
 * Deliberately uses only web-standard APIs — no Node-only crypto module — so
 * both runtimes can import it, and imports nothing from `src/` so the Convex
 * runtime stays independent of the SvelteKit tree.
 *
 * Scheme: HMAC-SHA256(DISTRICT_HASH_KEY, "<domain>:<normalized>").
 *
 * The keyed construction is load-bearing, not decorative. The space of US
 * congressional districts is ~435 codes and the space of postal codes is small
 * enough to enumerate exhaustively; an unkeyed digest — salted or not, since a
 * hardcoded salt is public — is trivially inverted by hashing every candidate
 * and matching. Only a secret key defeats that enumeration.
 *
 * There is therefore NO unkeyed fallback anywhere in this file. Absent
 * `DISTRICT_HASH_KEY` these functions throw, which is a hard failure of
 * campaign action submission, donations, and event RSVP rather than a silent
 * downgrade to a forgeable digest. Configure the key in every runtime, and
 * mirror the identical value into the Convex deployment env.
 */

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Canonical form of a district code prior to hashing.
 * "  ca-12 " → "CA-12"
 */
export function normalizeDistrictCode(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Canonical form of a postal code prior to hashing.
 * Uppercased for parity with alphanumeric non-US postal formats.
 * "  k1a 0b1 " → "K1A 0B1"
 */
export function normalizePostalCode(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Read the HMAC key at call time.
 *
 * `process.env` is empty at module scope on Cloudflare Workers, so this must
 * never be hoisted to a module-level const.
 */
function requireHashKey(): string {
  const key = process.env.DISTRICT_HASH_KEY;
  if (!key) {
    throw new Error("DISTRICT_HASH_KEY not configured");
  }
  return key;
}

async function hmacHex(preimage: string): Promise<string> {
  const key = requireHashKey();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(preimage));
  return bytesToHex(new Uint8Array(sig));
}

/**
 * Anonymized storage key for a district code.
 * HMAC-SHA256(key, "district:" + normalizeDistrictCode(code)) as 64 lowercase hex chars.
 *
 * Deterministic across users and runtimes so aggregate counts still group.
 * Throws when the key is absent.
 */
export async function hashDistrictCode(code: string): Promise<string> {
  return hmacHex(`district:${normalizeDistrictCode(code)}`);
}

/**
 * Anonymized storage key for a postal code.
 * HMAC-SHA256(key, "postal:" + normalizePostalCode(postal)) as 64 lowercase hex chars.
 *
 * The "postal:" infix domain-separates these from district hashes, so a postal
 * code that happens to look like a district code cannot collide with one.
 * Throws when the key is absent.
 */
export async function hashPostalCode(postal: string): Promise<string> {
  return hmacHex(`postal:${normalizePostalCode(postal)}`);
}
