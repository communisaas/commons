# ADR 007: Identity Verification Schema Migration

## Status
Accepted (Partially superseded — see Legacy Note below)

## Date
2026-01-23

## Context

The identity verification system is fully implemented in code (`src/lib/core/server/identity-hash.ts`, `src/routes/api/identity/verify/+server.ts`, and the current mDL path under `src/routes/api/identity/verify-mdl/*`) but the underlying schema needed to grow to support it.

> **Legacy Note (Cycle 15, audited 2026-04-23):**
> - **Provider state:** self.xyz and Didit.me are removed. mDL via the Digital Credentials API is the sole active provider. References to self.xyz / Didit below are historical.
> - **Stack:** Canonical schema is `convex/schema.ts`. Schema DDL below is illustrative.
> - **Sybil field:** The live anti-sybil identifier is `identityCommitment` (set inside the mDL privacy boundary, `src/lib/core/identity/mdl-verification.ts:~1010`; duplicate-check at `convex/users.ts:~820`). `identityHash` exists on `users` but is **indexed non-uniquely** (`.index("by_identityHash", ...)`). Uniqueness-based sybil resistance is enforced via `identityCommitment`.
> - **Aspirational fields:** `verificationAttempts` / `verificationCooldownUntil` described below are not in the Convex schema; no rate-limit enforcement uses them. `identityFingerprint` exists but is never written or read in production code.
> - **VerificationAudit scope:** The real `verificationAudit` table stores `{userId, verificationMethod, result, errorCode?, ipHash?}`; the broader "age/duplicate/proof reason + SDK metadata" capture described below is not implemented.

### The Problem

Both self.xyz and Didit verification flows require storing (now legacy — mDL flow uses the same fields):
1. **identity_hash** - For Sybil resistance (duplicate detection)
2. **identity_fingerprint** - For audit-safe logging
3. **birth_year** - For age verification without storing full DOB

The code was attempting to:
- Query `user.identity_hash` for duplicate detection
- Update users with these fields after verification
- Create VerificationAudit records with identity data

But the schema only had basic verification fields (`is_verified`, `verification_method`, `verified_at`, `verification_data`).

## Decision

Add the following fields and tables to `convex/schema.ts`:

### `users` table additions

```ts
// === SYBIL RESISTANCE FIELDS (Phase 1A Identity Verification) ===
identityHash: v.optional(v.string()),        // indexed (not unique)
identityFingerprint: v.optional(v.string()),
birthYear: v.optional(v.number()),
identityCommitment: v.optional(v.string()),  // unique — canonical sybil field

// === VERIFICATION RATE LIMITING (Phase 1A — aspirational) ===
verificationAttempts: v.optional(v.number()),
verificationCooldownUntil: v.optional(v.number()),
```

With indexes:
```ts
.index("by_identityHash", ["identityHash"])
.index("by_identityCommitment", ["identityCommitment"])
```

### New tables

```ts
verificationAudit: defineTable({
  // Tracks all verification attempts for fraud detection and compliance
  userId: v.id("users"),
  verificationMethod: v.string(),
  result: v.string(),
  errorCode: v.optional(v.string()),
  ipHash: v.optional(v.string()),
  createdAt: v.number(),
}).index("by_userId", ["userId"])

verificationSessions: defineTable({
  // Ephemeral sessions for verification flows (mDL)
  userId: v.id("users"),
  state: v.string(),
  nonce: v.string(),
  expiresAt: v.number(),
}).index("by_userId", ["userId"]).index("by_state", ["state"])
```

## Privacy-Preserving Design

### Identity Hash (Sybil Resistance)

The `identity_hash` field stores a SHA-256 hash computed from:
- Passport/document number (normalized: uppercase, no spaces/hyphens)
- Nationality (ISO 3166-1 alpha-2)
- Birth year
- Document type
- Platform salt (environment variable)

**Security Properties:**
- **Deterministic:** Same identity always produces the same hash
- **Collision-resistant:** SHA-256 provides cryptographic security
- **One-way:** Cannot reverse-engineer document number from hash
- **Salted:** Platform secret prevents rainbow table attacks

**Privacy Guarantee:** We never store plaintext passport numbers or full dates of birth. Only the hash is stored, which is useless without the platform salt.

### Identity Fingerprint (Audit Logging)

The `identity_fingerprint` is the first 16 characters of the identity hash. This provides:
- Sufficient uniqueness for audit log correlation
- Safe for logging (not enough entropy to reverse lookup)
- Useful for support debugging without exposing full hash

### Birth Year (Age Verification)

Storing only the birth year (not full date of birth) provides:
- Sufficient data for 18+ age verification
- Minimal PII exposure (year-only granularity)
- GDPR/CCPA compliant data minimization

## Uniqueness Index

The `identity_hash` field has a `@unique` constraint, which:
1. Prevents the same person from verifying multiple accounts
2. Enables efficient duplicate detection queries
3. Enforces Sybil resistance at the database level

## Migration Strategy

### For Existing Users

All new fields are **nullable** (optional):
- `identity_hash String?` - NULL until user completes verification
- `identity_fingerprint String?` - NULL until user completes verification
- `birth_year Int?` - NULL until user completes verification

This allows:
- Existing users to continue using the platform
- Gradual migration as users verify their identity
- No forced verification for existing accounts

### New Users

New users can optionally complete identity verification, which will:
1. Complete mDL verification flow (previously self.xyz or Didit — those providers removed in Cycle 15)
2. Generate identity hash from verified document
3. Check for duplicates against existing hashes
4. Store hash, fingerprint, and birth year
5. Update `is_verified = true`

## Rate Limiting

To prevent verification abuse:
- `verification_attempts` tracks failed attempts
- `verification_cooldown_until` enforces cooldown after multiple failures

Default behavior:
- 3 failed attempts trigger 24-hour cooldown
- Configurable via environment variables

## Audit Trail

`VerificationAudit` provides complete audit trail:
- All verification attempts (success/failure)
- Failure reasons (age, duplicate, invalid proof)
- IP address hash (fraud detection)
- SDK metadata (sanitized, no PII)

## Consequences

### Positive

1. **Sybil Resistance:** One identity per account enforcement
2. **Privacy Preserved:** No PII stored, only cryptographic derivatives
3. **Audit Compliance:** Complete verification audit trail
4. **Backward Compatible:** Existing users unaffected

### Negative

1. **Database Size:** Additional columns and indexes
2. **Query Overhead:** Unique index on identity_hash
3. **Environment Dependency:** Requires IDENTITY_HASH_SALT secret

### Risks

1. **Salt Rotation:** Changing the salt invalidates all existing hashes
   - Mitigation: Never rotate salt without a migration plan
2. **Hash Collisions:** Theoretically possible but cryptographically negligible
   - Mitigation: SHA-256 provides 2^256 possible outputs

## References

- `src/lib/core/server/identity-hash.ts` - Hash generation implementation
- ~~`src/lib/core/server/selfxyz-verifier.ts`~~ - self.xyz SDK integration (removed — Cycle 15)
- ~~`src/routes/api/identity/verify/+server.ts`~~ - self.xyz verification endpoint (removed — Cycle 15)
- ~~`src/routes/api/identity/didit/webhook/+server.ts`~~ - Didit webhook handler (removed — Cycle 15)
- `src/routes/api/identity/verify-mdl/start/+server.ts` - mDL session start (active)
- `src/routes/api/identity/verify-mdl/verify/+server.ts` - mDL credential verification (active)
- `convex/schema.ts` - canonical schema
