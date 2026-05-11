/**
 * Org-scoped deterministic hashing for dedup — NO server-held keys.
 *
 * Convex-compatible mirror of src/lib/core/crypto/org-scoped-hash.ts.
 * Byte-identical behavior. Imports nothing from src/.
 *
 * SHA-256(orgId + ":" + normalize(value)) — deterministic, no secret key.
 * Scoped per-org so the same email in two orgs produces different hashes,
 * preventing cross-org correlation.
 */

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Normalize phone for consistent hashing.
 * Requires E.164-ish format: leading '+', digits only, 7-15 digits.
 * "+1 (555) 123-4567" → "+15551234567"
 *
 * Throws on invalid input to prevent silent hash divergence.
 */
export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed.startsWith("+")) {
    throw new Error(
      `Phone must start with '+' country code for consistent hashing: got "${trimmed.slice(0, 4)}..."`,
    );
  }
  // Strip everything except digits after the leading '+'
  const digits = trimmed.slice(1).replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    throw new Error(
      `Phone has ${digits.length} digits after '+' — expected 7-15 for E.164`,
    );
  }
  return "+" + digits;
}

/**
 * Org-scoped deterministic email hash for dedup lookups.
 * SHA-256(orgId + ":email:" + normalize(email))
 */
export async function computeOrgScopedEmailHash(
  orgId: string,
  email: string,
): Promise<string> {
  const normalized = normalizeEmail(email);
  const data = encoder.encode(orgId + ":email:" + normalized);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(hash));
}

/**
 * Org-scoped deterministic phone hash for dedup lookups.
 * SHA-256(orgId + ":phone:" + normalize(phone))
 * Domain-separated from email hashes via the ":phone:" infix.
 */
export async function computeOrgScopedPhoneHash(
  orgId: string,
  phone: string,
): Promise<string> {
  const normalized = normalizePhone(phone);
  const data = encoder.encode(orgId + ":phone:" + normalized);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(hash));
}

/**
 * Global (cross-org) email hash for inbound webhook lookup.
 *
 * The supporter row's `emailHash` is `computeOrgScopedEmailHash` — different
 * for the same address in two orgs (cross-org correlation defence). But
 * inbound webhooks (SES bounce/complaint) only know the recipient email,
 * not which org it belongs to — they have to find ALL supporters across
 * orgs. The supporter row carries a parallel `globalEmailHash` field for
 * that lookup; this helper computes it.
 *
 * Same normalization as org-scoped variant (`normalizeEmail`) so the two
 * derive from byte-identical inputs. Domain prefix `"email:"` keeps it
 * separated from phone hashes; no orgId in the preimage by design.
 */
export async function computeGlobalEmailHash(email: string): Promise<string> {
  const normalized = normalizeEmail(email);
  const data = encoder.encode("email:" + normalized);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(hash));
}

/**
 * Global (cross-org) phone hash for inbound webhook lookup.
 *
 * The supporter row's `phoneHash` is `computeOrgScopedPhoneHash` — different
 * across orgs. Inbound Twilio webhook (TCPA STOP/START) only knows the
 * `From` phone, not the org, so it has to find ALL supporters across orgs.
 * Schema carries `globalPhoneHash` + `by_globalPhoneHash` for that lookup.
 *
 * Same normalization as org-scoped variant (`normalizePhone` requires
 * leading '+' and 7-15 digits — TCPA opt-outs from a poorly-normalized
 * phone must NOT silently produce a different hash and therefore fail
 * to find the supporter). Throws on invalid input.
 */
export async function computeGlobalPhoneHash(phone: string): Promise<string> {
  const normalized = normalizePhone(phone);
  const data = encoder.encode("phone:" + normalized);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(hash));
}

/**
 * Shared PII-triple coherence helper for ALL supporter writers.
 *
 * The supporter row's PII coherence depends on three legs per channel:
 *   email:  encryptedEmail  ↔ emailHash  ↔ globalEmailHash
 *   phone:  encryptedPhone  ↔ phoneHash  ↔ globalPhoneHash
 *
 * If any one leg drifts (ciphertext rotated without hash update, or
 * org-scoped hash present without global pair), the row is reachable
 * from one webhook path but not the others — split-brain on identity.
 * Centralizing the invariant in this helper means the table boundary,
 * not individual mutations, owns the contract.
 *
 * Semantics: an "active" PII leg requires the full triple. An "inactive"
 * leg (caller chose not to set this channel) requires all three legs
 * to be absent. The empty-string ciphertext (`""`) used by legacy
 * two-phase write paths (insert placeholder, encrypt with post-insert
 * id, patch) is admitted only when `allowPlaceholder: true` — public
 * mutations stay strict so a direct caller can't mint an undecryptable
 * row + populated hashes that webhooks would still find. The stranded
 * placeholder sweep cron cleans up two-phase rows where the follow-up
 * patch never landed.
 *
 * Throws `EMAIL_PII_TRIPLE_REQUIRED` / `PHONE_PII_TRIPLE_REQUIRED` on
 * mismatch — same error names as `supporters.update` so consumers can
 * handle them uniformly.
 */
export function assertPiiTripleCreate(args: {
  encryptedEmail?: string;
  emailHash?: string;
  globalEmailHash?: string;
  encryptedPhone?: string;
  phoneHash?: string;
  globalPhoneHash?: string;
  // Scope flag: public/external-callable paths (`supporters.create`,
  // `v1api.createSupporter`) pass `false` (or omit) and reject `""`;
  // only the two-phase callers (`findOrCreateSupporter`, `importBatch`)
  // pass `true`. Prevents a direct caller from minting placeholder
  // rows with populated hashes — undecryptable but webhook-reachable.
  allowPlaceholder?: boolean;
}): void {
  // Three states per channel:
  //   ABSENT      — `encryptedX === undefined`. The caller chose not
  //                 to set this channel. Hashes MUST also be absent —
  //                 orphaned hashes with no ciphertext to decrypt are
  //                 unreachable from any consumer path.
  //   PLACEHOLDER — `encryptedX === ""`. Two-phase create in flight:
  //                 row inserted with hashes so webhooks can find it
  //                 by `globalHashX` immediately, follow-up patch
  //                 lands the real ciphertext. Admitted only with
  //                 `allowPlaceholder: true`. Stranded rows whose
  //                 follow-up never lands are deleted by the
  //                 placeholder sweep cron.
  //   ACTIVE      — `encryptedX` is a non-empty string. Real ciphertext;
  //                 both hashes MUST be present (otherwise the row is
  //                 invisible to either the org-scoped index or the
  //                 cross-org webhook lookup — split-brain on identity).
  const allowPlaceholder = args.allowPlaceholder === true;
  const ciphertextEmail = args.encryptedEmail;
  const hasEmailHash = !!args.emailHash;
  const hasGlobalEmail = !!args.globalEmailHash;
  if (ciphertextEmail === undefined) {
    if (hasEmailHash || hasGlobalEmail) {
      throw new Error("EMAIL_PII_TRIPLE_REQUIRED");
    }
  } else if (ciphertextEmail === "") {
    if (!allowPlaceholder) {
      throw new Error("EMAIL_PII_TRIPLE_REQUIRED");
    }
    // PLACEHOLDER admitted — hashes may be present or absent.
  } else {
    if (!hasEmailHash || !hasGlobalEmail) {
      throw new Error("EMAIL_PII_TRIPLE_REQUIRED");
    }
  }

  const ciphertextPhone = args.encryptedPhone;
  const hasPhoneHash = !!args.phoneHash;
  const hasGlobalPhone = !!args.globalPhoneHash;
  if (ciphertextPhone === undefined) {
    if (hasPhoneHash || hasGlobalPhone) {
      throw new Error("PHONE_PII_TRIPLE_REQUIRED");
    }
  } else if (ciphertextPhone === "") {
    if (!allowPlaceholder) {
      throw new Error("PHONE_PII_TRIPLE_REQUIRED");
    }
  } else {
    if (!hasPhoneHash || !hasGlobalPhone) {
      throw new Error("PHONE_PII_TRIPLE_REQUIRED");
    }
  }
}

/**
 * Hash an invite token for at-rest storage.
 * SHA-256("invite-token:" + token) — domain-separated from other hashes.
 * The raw token is returned to the admin in the invite URL but never persisted.
 */
export async function hashInviteToken(token: string): Promise<string> {
  const data = encoder.encode("invite-token:" + token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(hash));
}
