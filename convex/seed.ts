/**
 * Comprehensive seed for bootstrapping a fresh Convex database.
 *
 * Creates realistic data across every org-layer table:
 * - 3 users (2 verified, 1 unverified)
 * - 3 organizations with full onboarding
 * - 7 org memberships
 * - 15 templates (agent-generated, research-backed content from seed pipeline)
 * - 4 campaigns (3 LETTER + 1 FORM fundraiser)
 * - 20 supporters with realistic names
 * - 12 tags with supporter assignments
 * - 2 segments
 * - 4 events with RSVPs and attendance
 * - 12 donations
 * - 3 workflows with 5 executions and action logs
 * - 3 email blasts (completed, sending, draft)
 * - 1 org network with 3 members
 * - ~36 org resolved contacts (12 per org)
 * - 5 org invites
 * - Campaign deliveries and actions
 * - 4 debates with 12 arguments
 *
 * Dev account integration: 'mock7ee@gmail.com' is always granted owner on all
 * seeded orgs. A stub user is created if the account doesn't exist yet (it's
 * normally minted via Google OAuth); login later dedups onto the same row by
 * email. Re-running `npm run seed` re-ensures ownership even on a seeded DB.
 *
 * Run via the Convex dashboard or CLI:
 *   npx convex run seed:seedAll
 *
 * Inline template content can be regenerated via scripts/seed-with-agents.ts
 */

import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { sealOrgKey, getOrgKeyForAction } from "./_orgKeyUnseal";
import { encryptWithOrgKey, importOrgKey } from "./_orgKey";
import { computeOrgScopedEmailHash, computeGlobalEmailHash } from "./_orgHash";
import { computeSupporterStats, emptySupporterStats } from "./_supporterStats";
// Org encryption configured during seed — supporters encrypted with org key, hashes org-scoped.

// =============================================================================
// TIME HELPERS
// =============================================================================

function daysAgo(n: number): number {
  return Date.now() - n * 86_400_000;
}

function hoursAgo(n: number): number {
  return Date.now() - n * 3_600_000;
}

function daysFromNow(n: number): number {
  return Date.now() + n * 86_400_000;
}

// SHA-256(email.toLowerCase().trim()) — the canonical emailHash pattern used by
// waitlist (src/routes/api/waitlist/+server.ts:18) and the email-sybil throttle
// (convex/users.ts). Shared by insertUsers and grantDevAccount.
async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// =============================================================================
// SEED DATA DEFINITIONS
// =============================================================================

// Tier↔method coherence per canonical mapping:
//   tier 0 = unverified
//   tier 1 = emailOnly
//   tier 2 = addressVerified (addressVerificationMethod ∈
//            ADDRESS_VERIFICATION_METHODS)
//   tier 3+ = govId (verificationMethod = 'mdl' → tier 5 per
//            convex/users.ts:529-538 mDL flow)
// See src/lib/server/verification-packet.ts:241-248 and
// convex/users.ts for canonical refs. The previous seed paired
// verificationMethod='mdl' with trustTier=1 — internally
// contradictory; verification-packet's identityBreakdown counted
// these as emailOnly while the user record claimed mDL.
// Seed user shapes mirror production state-machine writes:
//   - convex/users.ts:529-540 mDL finalize writes verificationMethod='mdl'
//     AND addressVerificationMethod=<paired-address-method> AND
//     addressVerifiedAt in one patch — the seed must therefore pair the
//     mDL user with a concrete address-resolution method (shadow_atlas).
//   - convex/users.ts:838-845 verifyAddress writes BOTH user.verificationMethod
//     AND user.addressVerificationMethod to the same value (one of the
//     ADDRESS_VERIFICATION_METHODS allowlist). The seed mirrors that
//     overload for the T2 user to stay production-reachable.
// See [[brutalist_audit_2026_05_25]] C3 review for the full trace.
const SEED_USERS = [
  {
    email: "seed-1@commons.email",
    name: "Alex Rivera",
    isVerified: true,
    verificationMethod: "mdl" as string | undefined,
    addressVerificationMethod: "shadow_atlas" as string | undefined,
    trustTier: 5,
    authorityLevel: 3,
    reputationTier: "established",
    tokenIdentifier: "seed|seed-1@commons.email",
  },
  {
    email: "seed-2@commons.email",
    name: "Jordan Chen",
    isVerified: true,
    verificationMethod: "shadow_atlas" as string | undefined,
    addressVerificationMethod: "shadow_atlas" as string | undefined,
    trustTier: 2,
    authorityLevel: 2,
    reputationTier: "established",
    tokenIdentifier: "seed|seed-2@commons.email",
  },
  {
    email: "seed-3@commons.email",
    name: "Morgan Tremblay",
    isVerified: false,
    verificationMethod: undefined as string | undefined,
    addressVerificationMethod: undefined as string | undefined,
    trustTier: 0,
    authorityLevel: 1,
    reputationTier: "newcomer",
    tokenIdentifier: "seed|seed-3@commons.email",
  },
] as const;

const SEED_ORGS = [
  {
    name: "Climate Action Now",
    slug: "climate-action-now",
    description: "Grassroots climate advocacy for evidence-based policy.",
    mission: "Building a movement for climate justice through verified civic action.",
    websiteUrl: "https://climateactionnow.org",
  },
  {
    name: "Voter Rights Coalition",
    slug: "voter-rights-coalition",
    description: "Protecting and expanding access to the ballot box.",
    mission: "Every eligible citizen deserves frictionless access to the ballot.",
    websiteUrl: "https://voterrightscoalition.org",
  },
  {
    name: "Local First SF",
    slug: "local-first-sf",
    description: "Strengthening San Francisco neighborhoods through local policy.",
    mission: "Empowering neighborhood voices in city governance.",
    websiteUrl: "https://localfirstsf.org",
  },
] as const;

// ---------------------------------------------------------------------------
// Template content — loaded from seedData.ts (generated by seed pipeline)
// ---------------------------------------------------------------------------
import { SEED_TEMPLATES } from "./seedData";
import type { SeedTemplate } from "./seedData";

// Note: SEED_TEMPLATES is imported from ./seedData above.
// To regenerate, run: npx tsx scripts/seed-with-agents.ts

// ---------------------------------------------------------------------------
// Supporter name pools
// ---------------------------------------------------------------------------
const SUPPORTER_NAMES = [
  "Ava Garcia", "Liam Kim", "Sophia Patel", "Noah O'Brien", "Isabella Nakamura",
  "Ethan Johansson", "Mia Chen", "Lucas Okafor", "Charlotte Mueller", "Oliver Santos",
  "Amelia Leblanc", "James Gupta", "Harper Nguyen", "Benjamin Williams", "Evelyn Rodriguez",
  "Mason Thompson", "Luna Lee", "Logan Martinez", "Ella Anderson", "Aiden Taylor",
] as const;

const POSTAL_CODES = [
  "94110", "94102", "94114", "10001", "10003",
  "60601", "60614", "20001", "20005", "98101",
  "94107", "94103", "94116", "10011", "10013",
  "60607", "60610", "20002", "20009", "98103",
] as const;

// ---------------------------------------------------------------------------
// Tag names per org
// ---------------------------------------------------------------------------
const TAG_NAMES_BY_ORG = [
  // Climate Action Now
  ["volunteer", "donor", "phone-banker", "event-host"],
  // Voter Rights Coalition
  ["volunteer", "donor", "poll-watcher", "canvasser"],
  // Local First SF
  ["volunteer", "donor", "neighborhood-lead", "business-owner"],
] as const;

// ---------------------------------------------------------------------------
// Representative data for org resolved contacts + deliveries
// ---------------------------------------------------------------------------
const REPRESENTATIVES = [
  { name: "Sen. Maria Lopez", title: "U.S. Senator", email: "lopez@senate.gov", district: "CA" },
  { name: "Sen. James Park", title: "U.S. Senator", email: "park@senate.gov", district: "CA" },
  { name: "Rep. David Okonkwo", title: "U.S. Representative", email: "okonkwo@house.gov", district: "CA-12" },
  { name: "Rep. Sarah Kim", title: "U.S. Representative", email: "kim@house.gov", district: "CA-11" },
  { name: "Sen. Robert Huang", title: "State Senator", email: "huang@senate.ca.gov", district: "SD-11" },
  { name: "Asm. Lisa Chen", title: "State Assembly", email: "chen@assembly.ca.gov", district: "AD-17" },
  { name: "Sup. Aaron Peskin", title: "Supervisor", email: "peskin@sfgov.org", district: "D3" },
  { name: "Sup. Hillary Ronen", title: "Supervisor", email: "ronen@sfgov.org", district: "D9" },
  { name: "Sup. Dean Preston", title: "Supervisor", email: "preston@sfgov.org", district: "D5" },
  { name: "Sup. Matt Dorsey", title: "Supervisor", email: "dorsey@sfgov.org", district: "D6" },
  { name: "Rep. Nancy Pelosi", title: "U.S. Representative", email: "pelosi@house.gov", district: "CA-11" },
  { name: "Mayor London Breed", title: "Mayor", email: "mayor@sfgov.org", district: "SF" },
] as const;

// =============================================================================
// TOP-LEVEL SEED ACTION
// =============================================================================

export const seedAll = internalAction({
  args: {},
  handler: async (ctx) => {
    // Guard: skip the bulk seed if data already exists — but always (re-)ensure
    // dev account ownership so `npm run seed` reliably restores access whether
    // the DB is fresh or already seeded.
    const existing = await ctx.runQuery(internal.seed.checkSeeded);
    if (existing) {
      console.log("Database already seeded — ensuring dev account access only.");
      const orgIds = await ctx.runQuery(internal.seed.getSeedOrgIds);
      if (orgIds.length > 0) {
        await ctx.runMutation(internal.seed.grantDevAccount, { orgIds });
      }
      return;
    }

    console.log("[seed] Phase 1: Inserting users...");
    const userIds = await ctx.runMutation(internal.seed.insertUsers);

    console.log("[seed] Phase 1.5: Inserting district credentials for verified users...");
    await ctx.runMutation(internal.seed.insertCredentials, { userIds });

    console.log("[seed] Phase 2: Inserting organizations + encryption + memberships...");
    const orgIds = await ctx.runMutation(internal.seed.insertOrgs);
    await ctx.runAction(internal.seed.configureOrgEncryption, { orgIds });
    await ctx.runMutation(internal.seed.insertMemberships, { userIds, orgIds });

    console.log("[seed] Phase 3: Inserting templates...");
    const templateIds = await ctx.runMutation(internal.seed.insertTemplates, { userIds, orgIds });

    console.log("[seed] Phase 4: Inserting campaigns...");
    const campaignIds = await ctx.runMutation(internal.seed.insertCampaigns, { orgIds, templateIds });

    console.log("[seed] Phase 5: Inserting supporters + tags...");
    const supporterIds = await ctx.runAction(internal.seed.insertSupporters, { orgIds });
    const tagIds = await ctx.runMutation(internal.seed.insertTags, { orgIds });
    await ctx.runMutation(internal.seed.assignSupporterTags, { supporterIds, tagIds, orgIds });

    console.log("[seed] Phase 6: Inserting segments...");
    await ctx.runMutation(internal.seed.insertSegments, { orgIds, userIds });

    console.log("[seed] Phase 7: Inserting events + RSVPs...");
    const eventIds = await ctx.runMutation(internal.seed.insertEvents, { orgIds, campaignIds });
    await ctx.runMutation(internal.seed.insertEventRsvps, { eventIds, supporterIds, orgIds });

    console.log("[seed] Phase 8: Inserting donations...");
    await ctx.runMutation(internal.seed.insertDonations, { orgIds, campaignIds, supporterIds });

    console.log("[seed] Phase 9: Inserting workflows + executions...");
    const workflowIds = await ctx.runMutation(internal.seed.insertWorkflows, { orgIds });
    await ctx.runMutation(internal.seed.insertWorkflowExecutions, { workflowIds, supporterIds });

    console.log("[seed] Phase 10: Inserting email blasts...");
    await ctx.runMutation(internal.seed.insertEmailBlasts, { orgIds, campaignIds });

    console.log("[seed] Phase 11: Inserting org network...");
    await ctx.runMutation(internal.seed.insertNetwork, { orgIds });

    console.log("[seed] Phase 12: Inserting org resolved contacts...");
    await ctx.runMutation(internal.seed.insertOrgContacts, { orgIds });

    console.log("[seed] Phase 13: Inserting org invites...");
    await ctx.runMutation(internal.seed.insertOrgInvites, { orgIds });

    console.log("[seed] Phase 14: Inserting campaign deliveries + actions...");
    await ctx.runMutation(internal.seed.insertCampaignActions, { campaignIds, supporterIds, orgIds });

    console.log("[seed] Phase 15: Inserting debates + arguments...");
    await ctx.runMutation(internal.seed.insertDebates, { templateIds });

    console.log("[seed] Phase 16: Granting dev account access...");
    await ctx.runMutation(internal.seed.grantDevAccount, { orgIds });

    console.log("[seed] Phase 17: Encrypting seed PII (donations, RSVPs, invites)...");
    await ctx.runAction(internal.seed.encryptSeedPii, { orgIds });

    console.log("[seed] Phase 18: Inserting decision makers + user constituent relations...");
    const dmIds = await ctx.runMutation(internal.seed.insertDecisionMakers);
    await ctx.runMutation(internal.seed.insertUserDmRelations, { userIds, dmIds });

    console.log("[seed] Phase 19: Inserting org subscriptions...");
    await ctx.runMutation(internal.seed.insertSubscriptions, { orgIds });

    console.log(
      `[seed] Complete! Created ${userIds.length} users, ${orgIds.length} orgs, ` +
      `${templateIds.length} templates, ${campaignIds.length} campaigns, ` +
      `${supporterIds.length} supporters, ${eventIds.length} events.`,
    );
  },
});

// =============================================================================
// PERSON-LAYER SEED — users + templates + debates, no org data
// =============================================================================

export const seedPublic = internalAction({
  args: {},
  handler: async (ctx) => {
    // Guard: skip if seed users already exist
    const existing = await ctx.runQuery(internal.seed.checkSeeded);
    if (existing) {
      console.log("Seed users already exist — skipping.");
      return;
    }

    console.log("[seedPublic] Phase 1: Inserting users...");
    const userIds = await ctx.runMutation(internal.seed.insertUsers);

    console.log("[seedPublic] Phase 1.5: Inserting district credentials for verified users...");
    await ctx.runMutation(internal.seed.insertCredentials, { userIds });

    console.log("[seedPublic] Phase 2: Inserting templates (no org assignment)...");
    const templateIds = await ctx.runMutation(internal.seed.insertTemplatesPublic, { userIds });

    console.log("[seedPublic] Phase 3: Inserting debates + arguments...");
    await ctx.runMutation(internal.seed.insertDebates, { templateIds });

    console.log("[seedPublic] Phase 4: Inserting decision makers + constituent relations...");
    const dmIds = await ctx.runMutation(internal.seed.insertDecisionMakers);
    await ctx.runMutation(internal.seed.insertUserDmRelations, { userIds, dmIds });

    console.log(
      `[seedPublic] Complete! Created ${userIds.length} users, ${templateIds.length} templates, ${dmIds.length} decision makers (public, no org).`,
    );
  },
});

// =============================================================================
// ONE-SHOT: Zero all template send metrics
// =============================================================================

export const zeroTemplateMetrics = internalMutation({
  args: {},
  handler: async (ctx) => {
    const templates = await ctx.db.query("templates").collect();
    for (const t of templates) {
      await ctx.db.patch(t._id, {
        verifiedSends: 0,
        uniqueDistricts: 0,
        deliveredDistricts: [],
      });
    }
    console.log(`Zeroed metrics on ${templates.length} templates.`);
  },
});

// =============================================================================
// GUARD QUERY — idempotency check
// =============================================================================

export const checkSeeded = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "seed-1@commons.email"))
      .first();
    return user !== null;
  },
});

// =============================================================================
// PHASE 1: INSERT USERS
// =============================================================================

export const insertUsers = internalMutation({
  args: {},
  handler: async (ctx): Promise<Id<"users">[]> => {
    const now = Date.now();
    const ids: Id<"users">[] = [];

    // user.emailHash is the dedup key for the email-sybil throttle at
    // convex/users.ts:747-758; leaving it unset (the prior state) silently
    // bypassed the throttle. Production OAuth signup does not yet compute this
    // — see [[F37-prod-user-emailHash-writer]]. Hash helper is module-scoped.
    for (let i = 0; i < SEED_USERS.length; i++) {
      const u = SEED_USERS[i];
      const emailHash = await sha256Hex(u.email.toLowerCase().trim());
      const id = await ctx.db.insert("users", {
        tokenIdentifier: u.tokenIdentifier,
        email: u.email,
        emailHash,
        name: u.name,
        updatedAt: now,

        // Verification
        isVerified: u.isVerified,
        verificationMethod: u.verificationMethod,
        verifiedAt: u.isVerified ? daysAgo(30) : undefined,
        addressVerificationMethod: u.addressVerificationMethod,
        addressVerifiedAt: u.addressVerificationMethod ? daysAgo(28) : undefined,

        // Trust & authority — declared per-user so tier/method coherence is
        // explicit, not derived from isVerified alone (which conflates
        // identity-verification with address-verification).
        trustTier: u.trustTier,
        authorityLevel: u.authorityLevel,
        trustScore: u.isVerified ? 50 : 0,
        reputationTier: u.reputationTier,

        // ZK / district — districtVerified is true once a backing
        // districtCredential is in place (Phase 1.5 below). True here for
        // T2+ users; the credential row is asserted in insertCredentials.
        districtVerified: u.trustTier >= 2,

        // Reputation counters
        templatesContributed: 0,
        templateAdoptionRate: 0,
        peerEndorsements: 0,
        activeMonths: u.isVerified ? 3 : 0,

        // Profile
        profileVisibility: "private",
      });
      ids.push(id);
    }

    return ids;
  },
});

// =============================================================================
// PHASE 1.5: INSERT DISTRICT CREDENTIALS
// =============================================================================
// Verified users (trustTier ≥ 2) need a backing districtCredential row so
// any join from users → credential renders honest trust-context. Without
// this, isVerified=true users have nothing behind the claim — the
// tier-display SSOT helper would see undefined trust-context fields
// and render "unknown" badges for every verified seed user.
//
// Trust-context fields (trustTier, cellStraddles, cellAnchorMode,
// atlasVersion) per schema.ts:760-794: STRICTLY OPTIONAL, MUST NOT be
// backfilled for legacy rows. New seed rows are NOT legacy; populating
// them is correct and matches what the production verifyAddress / mDL
// flows would write.

const SEED_ATLAS_VERSION = "atlas-2026-Q1";

export const insertCredentials = internalMutation({
  args: {
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, { userIds }) => {
    // Deterministic 0x-prefixed 32-byte hex for districtCommitment.
    // Submission gates fail-closed when this field is missing (see
    // convex/submissions.ts:1414 'credential_commitment_missing' and
    // src/routes/api/submissions/create/+server.ts:318
    // 'CREDENTIAL_MIGRATION_REQUIRED'); seeding without it would leave
    // verified users unable to drive end-to-end submission flows.
    const seedCommitment = (slot: number): string => {
      const value = (BigInt(0xc0) << 240n) | BigInt(slot + 1);
      return "0x" + value.toString(16).padStart(64, "0");
    };

    const credentialDefs = [
      {
        userIdx: 0, // seed-1 Alex — mDL identity, shadow_atlas address, T5
        congressionalDistrict: "CA-11",
        trustTier: 5,
        // T3+ from address-resolved wallet ZIP: cellStraddles is a real
        // boundary-cell signal; cellAnchorMode is 'address-resolved'.
        // NB: substrate (groundCellMetadata) is intentionally NOT seeded
        // — see [[F30-groundCellMetadata-substrate]] for the gap. Read
        // surfaces that join credential → cell metadata return null;
        // submission flows (which need an encrypted witness derived from
        // vault contents) are not seed-exercisable. Display surfaces and
        // org-layer flows that read only the credential ARE.
        cellStraddles: false,
        cellAnchorMode: "address-resolved" as string | undefined,
        // Per H6 tier-display SSOT (src/lib/core/identity/tier-display.ts):
        // mDL users carry an address-resolution method on their credential
        // ('shadow_atlas' renders as address-resolved, not 'civic_api'
        // which renders amber "Self-Reported Constituent"). Production
        // mDL finalize pairs mDL with shadow_atlas; the seed mirrors that.
        verificationMethod: "shadow_atlas" as string,
      },
      {
        userIdx: 1, // seed-2 Jordan — shadow_atlas address-verified, T2
        congressionalDistrict: "CA-12",
        trustTier: 2,
        // T<3 paths leave cellStraddles/cellAnchorMode UNDEFINED per the
        // schema spec — the fields are meaningless without a real cellId.
        cellStraddles: undefined as boolean | undefined,
        cellAnchorMode: undefined as string | undefined,
        verificationMethod: "shadow_atlas" as string,
      },
    ];

    const now = Date.now();

    for (const c of credentialDefs) {
      const credentialId = await ctx.db.insert("districtCredentials", {
        userId: userIds[c.userIdx],
        credentialType: "three-tree",
        congressionalDistrict: c.congressionalDistrict,
        verificationMethod: c.verificationMethod,
        issuedAt: daysAgo(30 - c.userIdx * 5),
        expiresAt: daysFromNow(335),
        credentialHash: `seed-credhash-${c.userIdx}`,
        districtCommitment: seedCommitment(c.userIdx),
        slotCount: 32,
        trustTier: c.trustTier,
        cellStraddles: c.cellStraddles,
        cellAnchorMode: c.cellAnchorMode,
        atlasVersion: SEED_ATLAS_VERSION,
      });

      // Insert groundVault + groundCellMetadata so the credential's
      // cellAnchorMode='address-resolved' claim has backing substrate.
      // Without these rows, read paths that join credential → vault →
      // cell-metadata (ground.ts:405 getMyGroundState, restore flows)
      // return null for verified users — the credential lies about its
      // resolution provenance. Mirrors production write order at
      // convex/ground.ts:244-307 (vault → cell-metadata → patch vault
      // with activeGroundCellMetadataId).
      //
      // Ciphertext/nonce/AAD are seed placeholders — real values come
      // from client-side AES-GCM encryption of the address payload
      // keyed by the user's PRF-derived DEK. Seed submission flows
      // that require decrypting the witness are NOT seed-exercisable;
      // display + restore-metadata surfaces ARE.
      const slot = c.userIdx;
      // Envelope fields match the runtime constants in convex/ground.ts:7-10
      // so a future cron or backfill that runs assertVaultEnvelopeForUser
      // against stored rows does not flag every seed row as malformed.
      // Ciphertext/nonce are still placeholders (no real DEK to encrypt
      // under) — only the envelope SHAPE is production-conformant; the
      // payload semantics are not.
      const aadEnvelope = JSON.stringify({
        purpose: "commons.ground-vault",
        userId: String(userIds[c.userIdx]),
        version: 1,
        dekVersion: 1,
      });
      const groundVaultId = await ctx.db.insert("groundVaults", {
        userId: userIds[c.userIdx],
        status: "active",
        ciphertext: `seed-vault-ct-${slot}`,
        nonce: `seed-vault-nonce-${slot}`,
        schemaVersion: 1,
        encryptionVersion: "aes-256-gcm:v1",
        dekVersion: 1,
        aeadAssociatedData: aadEnvelope,
        associatedDataHash: seedCommitment(0x10 + slot),
        activeCredentialId: credentialId,
        // Production passthrough at src/lib/core/identity/ground-vault-persistence.ts:276
        // sets createdByMethod = input.verificationMethod verbatim. Mirror
        // that here so seed-2's address-verified vault carries 'shadow_atlas'
        // (matching credential.verificationMethod and cell.source for the
        // same user) instead of the previously-divergent 'address'.
        createdByMethod: c.verificationMethod,
        updatedAt: now,
      });

      const groundCellMetadataId = await ctx.db.insert("groundCellMetadata", {
        userId: userIds[c.userIdx],
        districtCredentialId: credentialId,
        groundVaultId,
        // H3 res-7 cell — neighborhood scale. Format is 15-char hex per
        // h3 spec; placeholder values keyed by slot so they're unique.
        cellId: `8a2a1072${(slot + 0xb59).toString(16).padStart(3, "0")}fff`,
        h3Cell: `872a10072${(slot + 0xffe).toString(16).padStart(4, "0")}f`,
        cellMapRoot: seedCommitment(0x20 + slot),
        cellMapVersion: SEED_ATLAS_VERSION,
        atlasRoot: seedCommitment(0x30 + slot),
        atlasVersion: SEED_ATLAS_VERSION,
        districtCommitment: seedCommitment(slot),
        slotCount: 32,
        source: c.verificationMethod,
        confidence: 0.95,
        issuedAt: daysAgo(30 - c.userIdx * 5),
        expiresAt: daysFromNow(335),
        updatedAt: now,
      });

      // Close the cyclic FK: patch vault with its active cell metadata.
      await ctx.db.patch(groundVaultId, {
        activeGroundCellMetadataId: groundCellMetadataId,
        updatedAt: now,
      });
    }
  },
});

// =============================================================================
// PHASE 2: INSERT ORGANIZATIONS
// =============================================================================

export const insertOrgs = internalMutation({
  args: {},
  handler: async (ctx): Promise<Id<"organizations">[]> => {
    const now = Date.now();
    const ids: Id<"organizations">[] = [];

    for (const o of SEED_ORGS) {
      const id = await ctx.db.insert("organizations", {
        name: o.name,
        slug: o.slug,
        description: o.description,
        mission: o.mission,
        websiteUrl: o.websiteUrl,
        maxSeats: 10,
        maxTemplatesMonth: 50,
        dmCacheTtlDays: 30,
        countryCode: "US",
        isPublic: true,
        supporterCount: 0,
        campaignCount: 0,
        memberCount: 0,
        sentEmailCount: 0,
        updatedAt: now,
      });
      ids.push(id);
    }

    return ids;
  },
});

// =============================================================================
// PHASE 2a: CONFIGURE ORG ENCRYPTION
// =============================================================================

export const configureOrgEncryption = internalAction({
  args: { orgIds: v.array(v.id("organizations")) },
  handler: async (ctx, { orgIds }) => {

    for (const orgId of orgIds) {
      // Generate random 32-byte org key
      const rawKeyBytes = crypto.getRandomValues(new Uint8Array(32));

      // Import as CryptoKey
      const orgKey = await importOrgKey(rawKeyBytes.buffer);

      // Create verifier — must match createKeyVerifier() in org-pii-encryption.ts
      const sentinel = "commons-org-key-check-v1";
      const verifierBlob = await encryptWithOrgKey(sentinel, orgKey, "verifier", "sentinel");
      const orgKeyVerifier = JSON.stringify(verifierBlob);

      // Seal for server operations
      const rawKeyBase64 = btoa(String.fromCharCode(...rawKeyBytes));
      const serverSealedOrgKey = await sealOrgKey(rawKeyBase64, orgId);

      // Patch org with encryption config
      await ctx.runMutation(internal.seed.patchOrgEncryption, {
        orgId,
        orgKeyVerifier,
        serverSealedOrgKey,
      });
    }
    console.log(`[seed] Configured encryption on ${orgIds.length} orgs`);
  },
});

export const patchOrgEncryption = internalMutation({
  args: {
    orgId: v.id("organizations"),
    orgKeyVerifier: v.string(),
    serverSealedOrgKey: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.orgId, {
      orgKeyVerifier: args.orgKeyVerifier,
      serverSealedOrgKey: args.serverSealedOrgKey,
      piiVersion: "org-1",
      updatedAt: Date.now(),
    });
  },
});

// =============================================================================
// PHASE 2b: INSERT MEMBERSHIPS
// =============================================================================

export const insertMemberships = internalMutation({
  args: {
    userIds: v.array(v.id("users")),
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { userIds, orgIds }) => {
    const [alex, jordan, morgan] = userIds;
    const [climate, voterRights, localFirst] = orgIds;

    // Alex: owner of Climate + Voter Rights
    await ctx.db.insert("orgMemberships", {
      userId: alex,
      orgId: climate,
      role: "owner",
      joinedAt: daysAgo(60),
    });
    await ctx.db.insert("orgMemberships", {
      userId: alex,
      orgId: voterRights,
      role: "owner",
      joinedAt: daysAgo(45),
    });

    // Jordan: editor of Climate + Voter Rights
    await ctx.db.insert("orgMemberships", {
      userId: jordan,
      orgId: climate,
      role: "editor",
      joinedAt: daysAgo(50),
    });
    await ctx.db.insert("orgMemberships", {
      userId: jordan,
      orgId: voterRights,
      role: "editor",
      joinedAt: daysAgo(40),
    });

    // Morgan: owner of Local First SF, member of Climate
    await ctx.db.insert("orgMemberships", {
      userId: morgan,
      orgId: localFirst,
      role: "owner",
      joinedAt: daysAgo(30),
    });
    await ctx.db.insert("orgMemberships", {
      userId: morgan,
      orgId: climate,
      role: "member",
      joinedAt: daysAgo(20),
    });

    // Jordan: member of Local First SF
    await ctx.db.insert("orgMemberships", {
      userId: jordan,
      orgId: localFirst,
      role: "member",
      joinedAt: daysAgo(15),
    });

    // Reconcile org.memberCount against actually-inserted membership
    // rows. Literal counter values were truthful when written but
    // would drift the moment a future seed-author adds/removes a
    // membership without remembering to update the patch — same
    // anti-pattern F8 cured for sentEmailCount. Iterates orgIds (not
    // the destructured triple) so adding a 4th SEED_ORGS entry
    // doesn't silently bypass reconciliation.
    for (const orgId of orgIds) {
      const memberships = await ctx.db
        .query("orgMemberships")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
      await ctx.db.patch(orgId, { memberCount: memberships.length });
    }
  },
});

// =============================================================================
// PHASE 3: INSERT TEMPLATES
// =============================================================================

export const insertTemplates = internalMutation({
  args: {
    userIds: v.array(v.id("users")),
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { userIds, orgIds }): Promise<Id<"templates">[]> => {
    const now = Date.now();
    const ids: Id<"templates">[] = [];

    // Map templates to user/org owners in a round-robin pattern
    for (let i = 0; i < SEED_TEMPLATES.length; i++) {
      const t = SEED_TEMPLATES[i];
      const userIdx = i % userIds.length;
      const orgIdx = i % orgIds.length;

      const id = await ctx.db.insert("templates", {
        slug: t.slug,
        title: t.title,
        description: t.description,
        domain: t.domain,
        topics: t.topics,
        type: t.type,
        deliveryMethod: t.deliveryMethod,
        preview: t.preview,
        messageBody: t.messageBody,
        countryCode: t.countryCode,
        sources: t.sources,
        researchLog: t.researchLog,
        deliveryConfig: t.deliveryConfig,
        cwcConfig: t.cwcConfig,
        recipientConfig: t.recipientConfig,
        contentHash: t.contentHash,
        scopes: t.scopes,
        jurisdictions: t.jurisdictions,
        status: "published",
        isPublic: true,

        // Community metrics
        verifiedSends: 0,
        uniqueDistricts: 0,

        // Embeddings
        embeddingVersion: "none",

        // Moderation
        flaggedByModeration: false,
        consensusApproved: true,

        // Reputation
        reputationDelta: 0,
        reputationApplied: false,

        // Relationships
        userId: userIds[userIdx],
        orgId: orgIds[orgIdx],

        updatedAt: now - (SEED_TEMPLATES.length - i) * 86_400_000, // stagger creation times
      });
      ids.push(id);
    }

    // Update templatesContributed counts
    const countByUser = [0, 0, 0];
    for (let i = 0; i < SEED_TEMPLATES.length; i++) {
      countByUser[i % userIds.length]++;
    }
    for (let i = 0; i < userIds.length; i++) {
      await ctx.db.patch(userIds[i], { templatesContributed: countByUser[i] });
    }

    return ids;
  },
});

// =============================================================================
// PHASE 3-ALT: INSERT TEMPLATES (PUBLIC — no org assignment)
// =============================================================================

export const insertTemplatesPublic = internalMutation({
  args: {
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, { userIds }): Promise<Id<"templates">[]> => {
    const now = Date.now();
    const ids: Id<"templates">[] = [];

    for (let i = 0; i < SEED_TEMPLATES.length; i++) {
      const t = SEED_TEMPLATES[i];
      const userIdx = i % userIds.length;

      const id = await ctx.db.insert("templates", {
        slug: t.slug,
        title: t.title,
        description: t.description,
        domain: t.domain,
        topics: t.topics,
        type: t.type,
        deliveryMethod: t.deliveryMethod,
        preview: t.preview,
        messageBody: t.messageBody,
        countryCode: t.countryCode,
        sources: t.sources,
        researchLog: t.researchLog,
        deliveryConfig: t.deliveryConfig,
        cwcConfig: t.cwcConfig,
        recipientConfig: t.recipientConfig,
        contentHash: t.contentHash,
        scopes: t.scopes,
        jurisdictions: t.jurisdictions,
        status: "published",
        isPublic: true,

        // Community metrics
        verifiedSends: 0,
        uniqueDistricts: 0,

        // Embeddings
        embeddingVersion: "none",

        // Moderation
        flaggedByModeration: false,
        consensusApproved: true,

        // Reputation
        reputationDelta: 0,
        reputationApplied: false,

        // Relationships — user only, no org
        userId: userIds[userIdx],

        updatedAt: now - (SEED_TEMPLATES.length - i) * 86_400_000,
      });
      ids.push(id);
    }

    // Update templatesContributed counts
    const countByUser = [0, 0, 0];
    for (let i = 0; i < SEED_TEMPLATES.length; i++) {
      countByUser[i % userIds.length]++;
    }
    for (let i = 0; i < userIds.length; i++) {
      await ctx.db.patch(userIds[i], { templatesContributed: countByUser[i] });
    }

    return ids;
  },
});

// =============================================================================
// PHASE 4: INSERT CAMPAIGNS
// =============================================================================

export const insertCampaigns = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
    templateIds: v.array(v.id("templates")),
  },
  handler: async (ctx, { orgIds, templateIds }): Promise<Id<"campaigns">[]> => {
    const now = Date.now();
    const ids: Id<"campaigns">[] = [];

    const campaignDefs = [
      {
        orgIdx: 0,
        templateIdx: 0,
        type: "LETTER" as const,
        title: "Clean Energy Push — Spring 2026",
        body: "Mobilize supporters to contact reps about the Clean Energy Investment Act before the committee vote.",
        status: "ACTIVE" as const,
        raisedAmountCents: 0,
        donorCount: 0,
      },
      {
        orgIdx: 1,
        templateIdx: 1,
        type: "LETTER" as const,
        title: "Voter Registration Drive — Q2",
        body: "Coordinate outreach for automatic voter registration legislation in targeted states.",
        status: "ACTIVE" as const,
        raisedAmountCents: 0,
        donorCount: 0,
      },
      {
        orgIdx: 2,
        templateIdx: 2,
        type: "LETTER" as const,
        title: "SF Community Safety Initiative",
        body: "Rally neighborhood support for community-based safety funding in the city budget.",
        status: "ACTIVE" as const,
        raisedAmountCents: 0,
        donorCount: 0,
      },
      {
        orgIdx: 0,
        templateIdx: -1, // no template — this is a fundraiser
        type: "FORM" as const,
        title: "Climate Action Emergency Fund",
        body: "Raise funds for rapid-response climate advocacy campaigns and legal challenges.",
        status: "ACTIVE" as const,
        raisedAmountCents: 125000, // $1,250.00 raised so far
        donorCount: 8,
      },
    ];

    for (const c of campaignDefs) {
      const id = await ctx.db.insert("campaigns", {
        orgId: orgIds[c.orgIdx],
        templateId: c.templateIdx >= 0 ? templateIds[c.templateIdx] : undefined,
        type: c.type,
        title: c.title,
        body: c.body,
        status: c.status,
        debateEnabled: false,
        debateThreshold: 100,
        raisedAmountCents: c.raisedAmountCents,
        donorCount: c.donorCount,
        targetCountry: "US",
        actionCount: 0,
        verifiedActionCount: 0,
        updatedAt: now,
      });
      ids.push(id);
    }

    // Reconcile org.campaignCount against actually-inserted campaign
    // rows. Same row-derived pattern as memberCount above.
    for (const orgId of orgIds) {
      const orgCampaigns = await ctx.db
        .query("campaigns")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
      await ctx.db.patch(orgId, { campaignCount: orgCampaigns.length });
    }

    return ids;
  },
});

// =============================================================================
// PHASE 5a: INSERT SUPPORTERS
// =============================================================================

/**
 * Generate a realistic seed email from a name.
 */
function seedEmail(name: string, idx: number): string {
  return `${name.toLowerCase().replace(/[^a-z]/g, '')}${idx}@example.com`;
}

export const insertSupporters = internalAction({
  args: {
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { orgIds }): Promise<Id<"supporters">[]> => {

    const ids: Id<"supporters">[] = [];
    const distribution = [8, 7, 5];
    let globalIdx = 0;

    for (let orgIdx = 0; orgIdx < orgIds.length; orgIdx++) {
      const orgId = orgIds[orgIdx];
      const count = distribution[orgIdx];

      const orgKey = await getOrgKeyForAction(ctx, orgId);
      if (!orgKey) throw new Error(`Org ${orgId} has no encryption configured`);

      // Insert supporters with placeholder encrypted fields first to get real IDs
      const plaintextBatch: Array<{
        name: string;
        email: string;
        postalCode: string;
        verified: boolean;
        hasSms: boolean;
        source: string;
        daysAgoN: number;
      }> = [];

      for (let i = 0; i < count; i++) {
        const name = SUPPORTER_NAMES[globalIdx % SUPPORTER_NAMES.length];
        const email = seedEmail(name, globalIdx);
        const postalCode = POSTAL_CODES[globalIdx % POSTAL_CODES.length];
        plaintextBatch.push({
          name,
          email,
          postalCode,
          verified: globalIdx % 4 !== 3,
          hasSms: globalIdx % 3 === 0,
          source: globalIdx % 5 === 0 ? "csv" : "organic",
          daysAgoN: globalIdx + 1,
        });
        globalIdx++;
      }

      // Insert with placeholder fields to get real Convex _ids
      const batchIds = await ctx.runMutation(internal.seed.insertSupporterBatch, {
        supporters: plaintextBatch.map((s) => ({
          orgId,
          encryptedEmail: "",
          emailHash: "",
          encryptedName: "",
          postalCode: s.postalCode,
          country: "US",
          verified: s.verified,
          emailStatus: "subscribed",
          smsStatus: s.hasSms ? "subscribed" : "none",
          source: s.source,
          updatedAt: daysAgo(s.daysAgoN),
        })),
        orgId,
        orgIdx,
      }) as Id<"supporters">[];

      // Now encrypt with real IDs as AAD (matches production decrypt path)
      for (let i = 0; i < batchIds.length; i++) {
        const supporterId = batchIds[i];
        const s = plaintextBatch[i];
        const entityId = `supporter:${supporterId}`;

        const [encEmail, encName] = await Promise.all([
          encryptWithOrgKey(s.email, orgKey, entityId, "email"),
          encryptWithOrgKey(s.name, orgKey, entityId, "name"),
        ]);
        const emailHash = await computeOrgScopedEmailHash(orgId, s.email);
        // Seed fixtures get globalEmailHash so dev-mode SES webhook
        // lookups can find these rows (consistent with prod path).
        const globalEmailHash = await computeGlobalEmailHash(s.email);

        await ctx.runMutation(internal.seed.patchSeedRecord, {
          table: "supporters",
          id: supporterId,
          patch: {
            encryptedEmail: JSON.stringify(encEmail),
            encryptedName: JSON.stringify(encName),
            emailHash,
            globalEmailHash,
          },
        });
      }

      ids.push(...batchIds);
    }

    return ids;
  },
});

export const insertSupporterBatch = internalMutation({
  args: {
    supporters: v.array(v.any()),
    orgId: v.id("organizations"),
    orgIdx: v.number(),
  },
  handler: async (ctx, { supporters, orgId, orgIdx }): Promise<Id<"supporters">[]> => {
    const ids: Id<"supporters">[] = [];
    // Fold each seeded row into the org's breakdown counters as we go so the
    // dev fixture's supporterStats matches the inserted rows (same source of
    // truth getSummaryStats reads).
    let stats = emptySupporterStats();
    for (const s of supporters) {
      // Use the validated `orgId` arg for every insert and ignore
      // `s.orgId` entirely. The supporters payload is untyped
      // (`v.array(v.any())`), so trusting `s.orgId` is a single fork
      // away from a cross-org write primitive: any future internal
      // action that wires user-derived `supporters` into this mutation
      // would inherit that hazard. The arg-level `orgId` is validated
      // as v.id("organizations") and is the only safe source.
      const id = await ctx.db.insert("supporters", {
        orgId,
        encryptedEmail: s.encryptedEmail,
        emailHash: s.emailHash,
        encryptedName: s.encryptedName,
        postalCode: s.postalCode,
        country: s.country,
        verified: s.verified,
        emailStatus: s.emailStatus,
        smsStatus: s.smsStatus,
        source: s.source,
        updatedAt: s.updatedAt,
      });
      ids.push(id);
      stats = computeSupporterStats(stats, null, {
        emailStatus: s.emailStatus,
        smsStatus: s.smsStatus,
        source: s.source,
        postalCode: s.postalCode,
        verified: s.verified,
      });
    }

    await ctx.db.patch(orgId, {
      supporterCount: supporters.length,
      supporterStats: stats,
      onboardingState: {
        hasDescription: true,
        hasIssueDomains: false,
        hasSupporters: true,
        hasCampaigns: true,
        hasTeam: true,
        hasSentEmail: orgIdx === 0,
      },
    });

    return ids;
  },
});

// =============================================================================
// PHASE 5b: INSERT TAGS
// =============================================================================

export const insertTags = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { orgIds }): Promise<Id<"tags">[]> => {
    const ids: Id<"tags">[] = [];

    for (let orgIdx = 0; orgIdx < orgIds.length; orgIdx++) {
      const orgId = orgIds[orgIdx];
      const tagNames = TAG_NAMES_BY_ORG[orgIdx];
      for (const name of tagNames) {
        const id = await ctx.db.insert("tags", { orgId, name });
        ids.push(id);
      }
    }

    return ids; // 12 total: 4 per org
  },
});

// =============================================================================
// PHASE 5c: ASSIGN SUPPORTER TAGS
// =============================================================================

export const assignSupporterTags = internalMutation({
  args: {
    supporterIds: v.array(v.id("supporters")),
    tagIds: v.array(v.id("tags")),
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { supporterIds, tagIds }) => {
    // Tags are ordered: [org0-tag0..3, org1-tag0..3, org2-tag0..3]
    // Supporters are ordered: [org0-s0..7, org1-s0..6, org2-s0..4]
    const distribution = [8, 7, 5];
    let sIdx = 0;

    for (let orgIdx = 0; orgIdx < 3; orgIdx++) {
      const orgTagStart = orgIdx * 4;
      const count = distribution[orgIdx];

      for (let i = 0; i < count; i++) {
        const supporterId = supporterIds[sIdx + i];
        // Assign 1-2 tags per supporter
        const tagOffset = orgTagStart + (i % 4);
        await ctx.db.insert("supporterTags", {
          supporterId,
          tagId: tagIds[tagOffset],
        });
        // Every other supporter gets a second tag
        if (i % 2 === 0) {
          const secondTag = orgTagStart + ((i + 1) % 4);
          await ctx.db.insert("supporterTags", {
            supporterId,
            tagId: tagIds[secondTag],
          });
        }
      }
      sIdx += count;
    }
  },
});

// =============================================================================
// PHASE 6: INSERT SEGMENTS
// =============================================================================

export const insertSegments = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, { orgIds, userIds }) => {
    const now = Date.now();

    // Cached counts are derived from the actually-inserted supporters/tags/
    // supporterTags rows. Hardcoded literals here previously over-claimed
    // (Active Donors 5 vs truth 4; Verified Volunteers 4 vs truth 2) — see
    // [[brutalist_audit_2026_05_25]] C1 review.
    const countSegment = async (
      orgId: Id<"organizations">,
      tagName: string,
    ): Promise<number> => {
      const supporters = await ctx.db
        .query("supporters")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
      const verifiedIds = new Set(
        supporters.filter((s) => s.verified).map((s) => s._id),
      );
      const tag = await ctx.db
        .query("tags")
        .withIndex("by_orgId_name", (q) => q.eq("orgId", orgId).eq("name", tagName))
        .first();
      if (!tag) return 0;
      const tagged = await ctx.db
        .query("supporterTags")
        .withIndex("by_tagId", (q) => q.eq("tagId", tag._id))
        .collect();
      return tagged.filter((st) => verifiedIds.has(st.supporterId)).length;
    };

    const activeDonorsCount = await countSegment(orgIds[0], "donor");
    const verifiedVolunteersCount = await countSegment(orgIds[1], "volunteer");

    // Active Donors — Climate Action Now
    await ctx.db.insert("segments", {
      orgId: orgIds[0],
      name: "Active Donors",
      description: "Supporters who have donated in the past 90 days.",
      filters: {
        logic: "AND",
        conditions: [
          { field: "tags", operator: "includes", value: "donor" },
          { field: "verified", operator: "eq", value: true },
        ],
      },
      cachedCount: activeDonorsCount,
      countedAt: hoursAgo(2),
      createdBy: userIds[0],
      updatedAt: now,
    });

    // Verified Volunteers — Voter Rights Coalition
    await ctx.db.insert("segments", {
      orgId: orgIds[1],
      name: "Verified Volunteers",
      description: "Verified supporters tagged as volunteers.",
      filters: {
        logic: "AND",
        conditions: [
          { field: "tags", operator: "includes", value: "volunteer" },
          { field: "verified", operator: "eq", value: true },
        ],
      },
      cachedCount: verifiedVolunteersCount,
      countedAt: hoursAgo(1),
      createdBy: userIds[0],
      updatedAt: now,
    });
  },
});

// =============================================================================
// PHASE 7a: INSERT EVENTS
// =============================================================================

export const insertEvents = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
    campaignIds: v.array(v.id("campaigns")),
  },
  handler: async (ctx, { orgIds, campaignIds }): Promise<Id<"events">[]> => {
    const now = Date.now();
    const ids: Id<"events">[] = [];

    // Aggregate counters are initialized to 0 and reconciled by
    // `insertEventRsvps` against actually-inserted rows. Inflated demo
    // numbers here would re-create the denormalization-vs-truth gap the
    // K-floor read path is designed to guard against.
    const eventDefs = [
      {
        orgIdx: 0,
        campaignIdx: 0,
        title: "Climate Policy Town Hall",
        description: "Join us for a town hall with local climate policy experts. Hear about the Clean Energy Investment Act and how you can make your voice heard.",
        eventType: "HYBRID",
        startAt: daysFromNow(14),
        endAt: daysFromNow(14) + 2 * 3_600_000,
        venue: "SF Community Center",
        address: "1060 Howard St",
        city: "San Francisco",
        state: "CA",
        postalCode: "94103",
        latitude: 37.7816,
        longitude: -122.4110,
        virtualUrl: "https://meet.commons.email/climate-town-hall",
        capacity: 150,
        status: "PUBLISHED",
      },
      {
        orgIdx: 1,
        campaignIdx: 1,
        title: "Voter Registration Phone Bank",
        description: "Help us call voters in key districts to remind them about upcoming registration deadlines.",
        eventType: "VIRTUAL",
        startAt: daysFromNow(7),
        endAt: daysFromNow(7) + 3 * 3_600_000,
        venue: undefined,
        address: undefined,
        city: undefined,
        state: undefined,
        postalCode: undefined,
        latitude: undefined,
        longitude: undefined,
        virtualUrl: "https://meet.commons.email/phone-bank",
        capacity: 50,
        status: "PUBLISHED",
      },
      {
        orgIdx: 2,
        campaignIdx: 2,
        title: "March for Community Safety",
        description: "Walk with your neighbors to show support for community-based safety programs and demand funding in the city budget.",
        eventType: "IN_PERSON",
        startAt: daysFromNow(21),
        endAt: daysFromNow(21) + 3 * 3_600_000,
        venue: "Mission Dolores Park",
        address: "Dolores St & 19th St",
        city: "San Francisco",
        state: "CA",
        postalCode: "94114",
        latitude: 37.7596,
        longitude: -122.4269,
        virtualUrl: undefined,
        capacity: 500,
        status: "PUBLISHED",
      },
      {
        orgIdx: 0,
        campaignIdx: 0,
        title: "Clean Energy 101 Webinar",
        description: "An introductory webinar on the Clean Energy Investment Act — what it does, who it helps, and how to take action.",
        eventType: "VIRTUAL",
        startAt: daysAgo(3),
        endAt: daysAgo(3) + 1.5 * 3_600_000,
        venue: undefined,
        address: undefined,
        city: undefined,
        state: undefined,
        postalCode: undefined,
        latitude: undefined,
        longitude: undefined,
        virtualUrl: "https://meet.commons.email/clean-energy-101",
        capacity: 100,
        status: "COMPLETED",
      },
    ];

    for (const e of eventDefs) {
      const id = await ctx.db.insert("events", {
        orgId: orgIds[e.orgIdx],
        campaignId: campaignIds[e.campaignIdx],
        title: e.title,
        description: e.description,
        eventType: e.eventType as "IN_PERSON" | "VIRTUAL" | "HYBRID",
        startAt: e.startAt,
        endAt: e.endAt,
        timezone: "America/Los_Angeles",
        venue: e.venue,
        address: e.address,
        city: e.city,
        state: e.state,
        postalCode: e.postalCode,
        latitude: e.latitude,
        longitude: e.longitude,
        virtualUrl: e.virtualUrl,
        capacity: e.capacity,
        waitlistEnabled: true,
        rsvpCount: 0,
        attendeeCount: 0,
        verifiedAttendees: 0,
        checkinCode: `CHK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        requireVerification: false,
        status: e.status as "DRAFT" | "PUBLISHED" | "CANCELLED" | "COMPLETED",
        updatedAt: now,
      });
      ids.push(id);
    }

    return ids;
  },
});

// =============================================================================
// PHASE 7b: INSERT EVENT RSVPS
// =============================================================================

export const insertEventRsvps = internalMutation({
  args: {
    eventIds: v.array(v.id("events")),
    supporterIds: v.array(v.id("supporters")),
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { eventIds, supporterIds }) => {
    const now = Date.now();
    const statuses = ["GOING", "MAYBE", "GOING", "GOING"] as const;

    // Classify events by their persisted status, NOT by their position
    // in eventIds. Pre-refactor, the RSVP loops used `eventIds[3]` for
    // the completed event and `for eIdx<3` for future events — coupled
    // to the eventDefs ordering at insertEvents. A reorder there would
    // silently assign attendance semantics to the wrong event. Now
    // status drives the classification; rsvp count per event drives
    // its own tally.
    const events = await Promise.all(eventIds.map((id) => ctx.db.get(id)));
    const completedEventIdx = events.findIndex((e) => e?.status === "COMPLETED");
    const futureEventIndices = events
      .map((e, i) => (e?.status === "COMPLETED" ? -1 : i))
      .filter((i) => i >= 0);

    // Per-event tallies — patched back onto events at end so denormalized
    // counters match the actual eventRsvps rows. The K-floor in
    // events.ts:118 hides counts below 5; a counter that lies past the
    // floor is still a lie.
    const tallies = eventIds.map(() => ({
      rsvpCount: 0,
      attendeeCount: 0,
      verifiedAttendees: 0,
    }));

    // RSVPs + attendance for the completed event.
    if (completedEventIdx >= 0) {
      const completedEventId = eventIds[completedEventIdx];
      for (let i = 0; i < 6; i++) {
        const supporterId = supporterIds[i % supporterIds.length];
        const isCheckedIn = i < 4;
        const isVerified = isCheckedIn && i < 3;
        await ctx.db.insert("eventRsvps", {
          eventId: completedEventId,
          supporterId,
          encryptedEmail: "",
          emailHash: `seed-rsvp-completed-${i}`,
          encryptedRsvpName: SUPPORTER_NAMES[i % SUPPORTER_NAMES.length],
          status: "GOING",
          guestCount: 1,
          engagementTier: i < 3 ? 2 : 1,
          updatedAt: daysAgo(4),
          checkedInAt: isCheckedIn ? daysAgo(3) : undefined,
          attendanceVerified: isCheckedIn ? i < 3 : undefined,
          attendanceVerificationMethod: isVerified ? "checkin_code" : undefined,
        });
        tallies[completedEventIdx].rsvpCount += 1;
        if (isCheckedIn) tallies[completedEventIdx].attendeeCount += 1;
        if (isVerified) tallies[completedEventIdx].verifiedAttendees += 1;
      }
    }

    // RSVPs for future events. Per-event RSVP count cycles through
    // [5, 4, 6, ...] so the K-floor display logic gets a mix of
    // above-and-below-threshold rows in the seed.
    const futureCounts = [5, 4, 6, 7, 5, 4];
    for (let i = 0; i < futureEventIndices.length; i++) {
      const eIdx = futureEventIndices[i];
      const eventId = eventIds[eIdx];
      const rsvpCount = futureCounts[i % futureCounts.length];
      for (let j = 0; j < rsvpCount; j++) {
        const sIdx = (i * 5 + j) % supporterIds.length;
        await ctx.db.insert("eventRsvps", {
          eventId,
          supporterId: supporterIds[sIdx],
          encryptedEmail: "",
          emailHash: `seed-rsvp-${eIdx}-${j}`,
          encryptedRsvpName: SUPPORTER_NAMES[sIdx % SUPPORTER_NAMES.length],
          status: statuses[j % statuses.length],
          guestCount: j % 3 === 0 ? 2 : 1,
          engagementTier: j < 2 ? 2 : 1,
          updatedAt: now,
        });
        tallies[eIdx].rsvpCount += 1;
      }
    }

    // Reconcile event counters against actual rows.
    for (let i = 0; i < eventIds.length; i++) {
      await ctx.db.patch(eventIds[i], {
        rsvpCount: tallies[i].rsvpCount,
        attendeeCount: tallies[i].attendeeCount,
        verifiedAttendees: tallies[i].verifiedAttendees,
        updatedAt: now,
      });
    }
  },
});

// =============================================================================
// PHASE 8: INSERT DONATIONS
// =============================================================================

export const insertDonations = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
    campaignIds: v.array(v.id("campaigns")),
    supporterIds: v.array(v.id("supporters")),
  },
  handler: async (ctx, { orgIds, campaignIds, supporterIds }) => {
    const now = Date.now();

    const donationDefs = [
      // Climate Action Now — Emergency Fund (campaign[3])
      { orgIdx: 0, campaignIdx: 3, sIdx: 0, amount: 5000, recurring: false, status: "completed" as const, daysAgoN: 10 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 1, amount: 2500, recurring: true, status: "completed" as const, daysAgoN: 8 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 2, amount: 10000, recurring: false, status: "completed" as const, daysAgoN: 7 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 3, amount: 25000, recurring: false, status: "completed" as const, daysAgoN: 5 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 4, amount: 7500, recurring: true, status: "completed" as const, daysAgoN: 3 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 5, amount: 50000, recurring: false, status: "completed" as const, daysAgoN: 2 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 6, amount: 15000, recurring: false, status: "completed" as const, daysAgoN: 1 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 7, amount: 10000, recurring: false, status: "completed" as const, daysAgoN: 1 },
      // Pending / failed
      { orgIdx: 0, campaignIdx: 3, sIdx: 0, amount: 3000, recurring: false, status: "pending" as const, daysAgoN: 0 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 1, amount: 1500, recurring: false, status: "failed" as const, daysAgoN: 6 },
      // Other orgs (via their letter campaigns)
      { orgIdx: 1, campaignIdx: 1, sIdx: 9, amount: 2000, recurring: false, status: "completed" as const, daysAgoN: 12 },
      { orgIdx: 2, campaignIdx: 2, sIdx: 16, amount: 5000, recurring: true, status: "completed" as const, daysAgoN: 9 },
    ];

    for (const d of donationDefs) {
      const supporterId = supporterIds[d.sIdx % supporterIds.length];
      const supporterName = SUPPORTER_NAMES[d.sIdx % SUPPORTER_NAMES.length];

      await ctx.db.insert("donations", {
        orgId: orgIds[d.orgIdx],
        campaignId: campaignIds[d.campaignIdx],
        supporterId,
        encryptedEmail: "",
        emailHash: `seed-donation-${d.sIdx}-${d.campaignIdx}`,
        encryptedName: supporterName,
        amountCents: d.amount,
        currency: "USD",
        recurring: d.recurring,
        recurringInterval: d.recurring ? "month" : undefined,
        status: d.status,
        engagementTier: d.status === "completed" ? 2 : 1,
        completedAt: d.status === "completed" ? daysAgo(d.daysAgoN) : undefined,
        updatedAt: daysAgo(d.daysAgoN),
      });
    }

    // Update raisedAmountCents on the fundraiser campaign
    const completedTotal = donationDefs
      .filter(d => d.campaignIdx === 3 && d.status === "completed")
      .reduce((sum, d) => sum + d.amount, 0);
    const completedCount = donationDefs
      .filter(d => d.campaignIdx === 3 && d.status === "completed")
      .length;
    await ctx.db.patch(campaignIds[3], {
      raisedAmountCents: completedTotal,
      donorCount: completedCount,
    });
  },
});

// =============================================================================
// PHASE 9a: INSERT WORKFLOWS
// =============================================================================

export const insertWorkflows = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { orgIds }): Promise<Id<"workflows">[]> => {
    const now = Date.now();
    const ids: Id<"workflows">[] = [];

    const workflowDefs = [
      {
        orgIdx: 0,
        name: "Welcome New Supporter",
        description: "Sends a welcome email when a new supporter joins, adds the 'volunteer' tag after 3 days.",
        trigger: { type: "supporter_created", conditions: {} },
        steps: [
          { type: "send_email", config: { subject: "Welcome to Climate Action Now!", templateKey: "welcome" }, delay: 0 },
          { type: "delay", config: { days: 3 }, delay: 259_200_000 },
          { type: "add_tag", config: { tagName: "volunteer" }, delay: 0 },
        ],
        enabled: true,
      },
      {
        orgIdx: 0,
        name: "Donor Thank You",
        description: "Sends a thank-you email after a completed donation.",
        trigger: { type: "donation_completed", conditions: { minAmountCents: 1000 } },
        steps: [
          { type: "send_email", config: { subject: "Thank you for your generous donation!", templateKey: "donor_thanks" }, delay: 0 },
          { type: "add_tag", config: { tagName: "donor" }, delay: 0 },
        ],
        enabled: true,
      },
      {
        orgIdx: 1,
        name: "Event Follow-up",
        description: "Sends a follow-up email 1 day after an event ends, with a link to the campaign.",
        trigger: { type: "event_completed", conditions: {} },
        steps: [
          { type: "delay", config: { days: 1 }, delay: 86_400_000 },
          { type: "send_email", config: { subject: "Thanks for attending! Here's how to keep the momentum going.", templateKey: "event_followup" }, delay: 0 },
        ],
        enabled: true,
      },
    ];

    for (const w of workflowDefs) {
      const id = await ctx.db.insert("workflows", {
        orgId: orgIds[w.orgIdx],
        name: w.name,
        description: w.description,
        trigger: w.trigger,
        steps: w.steps,
        enabled: w.enabled,
        updatedAt: now,
      });
      ids.push(id);
    }

    return ids;
  },
});

// =============================================================================
// PHASE 9b: INSERT WORKFLOW EXECUTIONS + ACTION LOGS
// =============================================================================

export const insertWorkflowExecutions = internalMutation({
  args: {
    workflowIds: v.array(v.id("workflows")),
    supporterIds: v.array(v.id("supporters")),
  },
  handler: async (ctx, { workflowIds, supporterIds }) => {
    const executionDefs = [
      // Welcome workflow — 2 completed, 1 running
      { wfIdx: 0, sIdx: 0, status: "completed" as const, currentStep: 2, completedDaysAgo: 5 },
      { wfIdx: 0, sIdx: 1, status: "completed" as const, currentStep: 2, completedDaysAgo: 3 },
      { wfIdx: 0, sIdx: 2, status: "running" as const, currentStep: 1, completedDaysAgo: null },
      // Donor Thank You — 1 completed
      { wfIdx: 1, sIdx: 3, status: "completed" as const, currentStep: 1, completedDaysAgo: 2 },
      // Event Follow-up — 1 pending
      { wfIdx: 2, sIdx: 8, status: "pending" as const, currentStep: 0, completedDaysAgo: null },
    ];

    for (const e of executionDefs) {
      const executionId = await ctx.db.insert("workflowExecutions", {
        workflowId: workflowIds[e.wfIdx],
        supporterId: supporterIds[e.sIdx % supporterIds.length],
        triggerEvent: { type: "auto", timestamp: daysAgo(e.completedDaysAgo ?? 0 + 1) },
        status: e.status,
        currentStep: e.currentStep,
        nextRunAt: e.status === "running" ? daysFromNow(2) : e.status === "pending" ? daysFromNow(1) : undefined,
        completedAt: e.completedDaysAgo !== null ? daysAgo(e.completedDaysAgo) : undefined,
      });

      // Insert action logs for completed steps
      for (let step = 0; step <= e.currentStep; step++) {
        if (e.status === "pending" && step === 0) continue; // pending hasn't started
        const actionTypes = ["send_email", "delay", "add_tag"];
        await ctx.db.insert("workflowActionLogs", {
          executionId,
          stepIndex: step,
          actionType: actionTypes[step % actionTypes.length],
          result: { success: true, message: `Step ${step} completed` },
          createdAt: daysAgo((e.completedDaysAgo ?? 1) + (e.currentStep - step)),
        });
      }
    }
  },
});

// =============================================================================
// PHASE 10: INSERT EMAIL BLASTS
// =============================================================================

export const insertEmailBlasts = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
    campaignIds: v.array(v.id("campaigns")),
  },
  handler: async (ctx, { orgIds, campaignIds }) => {
    const now = Date.now();

    // 1. Completed blast — Climate Action Now
    await ctx.db.insert("emailBlasts", {
      orgId: orgIds[0],
      campaignId: campaignIds[0],
      subject: "Urgent: Clean Energy Act Needs Your Voice This Week",
      bodyHtml: `<h1>The Clean Energy Investment Act</h1><p>Dear supporter,</p><p>The committee vote on the Clean Energy Investment Act is scheduled for next week. We need every voice counted. <a href="https://commons.email/act/clean-energy">Take action now</a>.</p><p>Together we can make a difference.</p><p>— Climate Action Now</p>`,
      fromName: "Climate Action Now",
      fromEmail: "action@climateactionnow.org",
      status: "sent",
      // Empty closed-shape filter — sends to the org's full subscribed
      // cohort. The previous `{ tags: [...], emailStatus: ... }` shape
      // did not match the canonical recipientFilterValidator and would
      // be defensively coerced to empty at email.ts:405 — equivalent
      // outcome, honest shape.
      recipientFilter: { verified: "any" as const },
      totalRecipients: 8,
      totalSent: 8,
      totalBounced: 0,
      totalOpened: 5,
      totalClicked: 3,
      totalComplained: 0,
      sentAt: daysAgo(5),
      updatedAt: daysAgo(5),
      isAbTest: false,
      batches: [
        { batchIndex: 0, status: "sent", sentCount: 8, failedCount: 0, sentAt: daysAgo(5) },
      ],
    });

    // 2. Sending blast — Voter Rights Coalition
    await ctx.db.insert("emailBlasts", {
      orgId: orgIds[1],
      campaignId: campaignIds[1],
      subject: "Registration Deadline Approaching — Spread the Word",
      bodyHtml: `<h1>Voter Registration Deadline</h1><p>Time is running out. Help us reach every eligible voter before the registration deadline closes. <a href="https://commons.email/act/voter-reg">Share our campaign</a>.</p><p>— Voter Rights Coalition</p>`,
      fromName: "Voter Rights Coalition",
      fromEmail: "outreach@voterrightscoalition.org",
      status: "sending",
      recipientFilter: { verified: "any" as const },
      totalRecipients: 7,
      totalSent: 4,
      totalBounced: 0,
      totalOpened: 0,
      totalClicked: 0,
      totalComplained: 0,
      sentAt: hoursAgo(1),
      updatedAt: now,
      isAbTest: false,
      batches: [
        { batchIndex: 0, status: "sent", sentCount: 4, failedCount: 0, sentAt: hoursAgo(1) },
        { batchIndex: 1, status: "pending", sentCount: 0, failedCount: 0 },
      ],
    });

    // 3. Draft blast — Local First SF
    await ctx.db.insert("emailBlasts", {
      orgId: orgIds[2],
      subject: "March for Community Safety — RSVP Now",
      bodyHtml: `<h1>Join the March</h1><p>This month we march together for community safety. RSVP and bring your neighbors.</p><p>— Local First SF</p>`,
      fromName: "Local First SF",
      fromEmail: "hello@localfirstsf.org",
      status: "draft",
      totalRecipients: 0,
      totalSent: 0,
      totalBounced: 0,
      totalOpened: 0,
      totalClicked: 0,
      totalComplained: 0,
      updatedAt: now,
      isAbTest: false,
    });

    // Reconcile org.sentEmailCount AND onboardingState.hasSentEmail against
    // actually-inserted blasts. Per-org totals must agree with the
    // emailBlasts rows above and with the supporters phase's onboardingState
    // (which seeds hasSentEmail=false for non-org[0]); without this merge,
    // org[1] would carry sentEmailCount=4 alongside hasSentEmail=false —
    // an internal contradiction. blastSents is the single source for each
    // per-org total; reuse it for both the blast rows above (when they're
    // refactored to read from this constant) and the org reconciliation
    // here. For now the literals match — keep them indexed by orgIdx to
    // make drift loud.
    const blastSents: Record<number, number> = { 0: 8, 1: 4, 2: 0 };
    for (let i = 0; i < orgIds.length; i++) {
      const totalSent = blastSents[i] ?? 0;
      if (totalSent <= 0) continue;
      const org = await ctx.db.get(orgIds[i]);
      if (!org) continue;
      await ctx.db.patch(orgIds[i], {
        sentEmailCount: totalSent,
        onboardingState: org.onboardingState
          ? { ...org.onboardingState, hasSentEmail: true }
          : undefined,
        updatedAt: now,
      });
    }
  },
});

// =============================================================================
// PHASE 11: INSERT ORG NETWORK
// =============================================================================

export const insertNetwork = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { orgIds }) => {
    const now = Date.now();

    // Create the network owned by Climate Action Now
    const networkId = await ctx.db.insert("orgNetworks", {
      name: "Progressive Alliance 2026",
      slug: "progressive-alliance-2026",
      description: "A coalition of progressive organizations working together on climate, voting rights, and community safety.",
      ownerOrgId: orgIds[0],
      status: "active",
      applicableCountries: ["US"],
      updatedAt: now,
    });

    // All 3 orgs are members
    await ctx.db.insert("orgNetworkMembers", {
      networkId,
      orgId: orgIds[0],
      role: "admin",
      status: "active",
      joinedAt: daysAgo(30),
    });
    await ctx.db.insert("orgNetworkMembers", {
      networkId,
      orgId: orgIds[1],
      role: "member",
      status: "active",
      joinedAt: daysAgo(25),
      invitedBy: "alex-rivera",
    });
    await ctx.db.insert("orgNetworkMembers", {
      networkId,
      orgId: orgIds[2],
      role: "member",
      status: "active",
      joinedAt: daysAgo(20),
      invitedBy: "alex-rivera",
    });
  },
});

// =============================================================================
// PHASE 12: INSERT ORG RESOLVED CONTACTS
// =============================================================================

export const insertOrgContacts = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { orgIds }) => {
    const now = Date.now();

    for (const orgId of orgIds) {
      for (const rep of REPRESENTATIVES) {
        await ctx.db.insert("orgResolvedContacts", {
          orgId,
          orgKey: rep.district,
          name: rep.name,
          title: rep.title,
          email: rep.email,
          emailSource: "civic_api",
          resolvedAt: daysAgo(7),
          expiresAt: daysFromNow(23), // 30-day cache TTL
          resolvedBy: "seed",
        });
      }
    }
  },
});

// =============================================================================
// PHASE 13: INSERT ORG INVITES
// =============================================================================

export const insertOrgInvites = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { orgIds }) => {
    const inviteDefs = [
      // 2 pending
      {
        orgIdx: 0,
        role: "editor",
        token: "inv-pending-001",
        expiresAt: daysFromNow(5),
        accepted: false,
        invitedBy: "alex-rivera",
        emailHash: "seed-invite-0",
      },
      {
        orgIdx: 1,
        role: "member",
        token: "inv-pending-002",
        expiresAt: daysFromNow(3),
        accepted: false,
        invitedBy: "alex-rivera",
        emailHash: "seed-invite-1",
      },
      // 2 accepted
      {
        orgIdx: 0,
        role: "member",
        token: "inv-accepted-001",
        expiresAt: daysFromNow(10),
        accepted: true,
        invitedBy: "alex-rivera",
        emailHash: "seed-invite-2",
      },
      {
        orgIdx: 2,
        role: "editor",
        token: "inv-accepted-002",
        expiresAt: daysFromNow(8),
        accepted: true,
        invitedBy: "morgan-tremblay",
        emailHash: "seed-invite-3",
      },
      // 1 expired
      {
        orgIdx: 1,
        role: "editor",
        token: "inv-expired-001",
        expiresAt: daysAgo(2),
        accepted: false,
        invitedBy: "alex-rivera",
        emailHash: "seed-invite-4",
      },
    ];

    const encoder = new TextEncoder();
    for (const inv of inviteDefs) {
      // Hash the token for at-rest storage (schema requires tokenHash, not plaintext token)
      const hashBuf = await crypto.subtle.digest("SHA-256", encoder.encode("invite-token:" + inv.token));
      const tokenHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

      await ctx.db.insert("orgInvites", {
        orgId: orgIds[inv.orgIdx],
        role: inv.role,
        tokenHash,
        expiresAt: inv.expiresAt,
        accepted: inv.accepted,
        invitedBy: inv.invitedBy,
        encryptedEmail: "",
        emailHash: inv.emailHash,
      });
    }
  },
});

// =============================================================================
// PHASE 14: INSERT CAMPAIGN ACTIONS + DELIVERIES
// =============================================================================

export const insertCampaignActions = internalMutation({
  args: {
    campaignIds: v.array(v.id("campaigns")),
    supporterIds: v.array(v.id("supporters")),
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { campaignIds, supporterIds, orgIds }) => {
    // Create campaign actions and deliveries for the 3 letter campaigns
    const letterCampaigns = [
      { campaignIdx: 0, orgIdx: 0, supporterStart: 0, supporterCount: 6 },
      { campaignIdx: 1, orgIdx: 1, supporterStart: 8, supporterCount: 5 },
      { campaignIdx: 2, orgIdx: 2, supporterStart: 15, supporterCount: 4 },
    ];

    // Accumulate the org-level engagement-tier histogram so dev dashboards
    // (getDashboardStats reads org.actionTierCounts) match the seeded actions.
    // Keyed by org index; each is a 5-slot [T0..T4] tally over ALL actions.
    const orgTierCounts = new Map<number, number[]>();

    for (const lc of letterCampaigns) {
      let actionCountTotal = 0;
      let verifiedCountTotal = 0;

      for (let i = 0; i < lc.supporterCount; i++) {
        const sIdx = (lc.supporterStart + i) % supporterIds.length;
        const isVerified = i % 4 !== 3; // 75% verified
        const tier = isVerified ? 2 : 1;

        const actionId = await ctx.db.insert("campaignActions", {
          campaignId: campaignIds[lc.campaignIdx],
          orgId: orgIds[lc.orgIdx],
          supporterId: supporterIds[sIdx],
          verified: isVerified,
          engagementTier: tier,
          districtHash: `district-hash-${sIdx}`,
          delegated: false,
          sentAt: daysAgo(i + 1),
        });
        actionCountTotal++;
        if (isVerified) verifiedCountTotal++;
        const counts = orgTierCounts.get(lc.orgIdx) ?? [0, 0, 0, 0, 0];
        counts[tier] += 1;
        orgTierCounts.set(lc.orgIdx, counts);

        // Create 1-2 deliveries per action
        const repCount = i % 3 === 0 ? 2 : 1;
        for (let r = 0; r < repCount; r++) {
          const rep = REPRESENTATIVES[(i + r) % REPRESENTATIVES.length];
          const deliveryStatuses = ["delivered", "sent", "opened", "delivered"] as const;
          await ctx.db.insert("campaignDeliveries", {
            campaignId: campaignIds[lc.campaignIdx],
            actionId,
            targetEmail: rep.email,
            targetName: rep.name,
            targetTitle: rep.title,
            targetDistrict: rep.district,
            status: deliveryStatuses[(i + r) % deliveryStatuses.length],
            sentAt: daysAgo(i + 1),
            proofWeight: isVerified ? 0.85 : 0.3,
            createdAt: daysAgo(i + 1),
          });
        }
      }

      // Update campaign counters
      await ctx.db.patch(campaignIds[lc.campaignIdx], {
        actionCount: actionCountTotal,
        verifiedActionCount: verifiedCountTotal,
      });
    }

    // Persist the org-level tier histograms accumulated above.
    for (const [orgIdx, counts] of orgTierCounts) {
      await ctx.db.patch(orgIds[orgIdx], { actionTierCounts: counts });
    }
  },
});

// =============================================================================
// PHASE 15: INSERT DEBATES + ARGUMENTS
// =============================================================================

export const insertDebates = internalMutation({
  args: {
    templateIds: v.array(v.id("templates")),
  },
  handler: async (ctx, { templateIds }) => {
    const now = Date.now();

    // Generate deterministic 0x-prefixed 32-byte hex strings for seed
    // cryptographic fields. Format mirrors canonical bytes32 / BN254 field
    // elements per `isValidActionDomain` in
    // src/lib/core/zkp/action-domain-builder.ts so DebateProofGenerator and
    // any consumer that runs `buildDebateActionDomain` accepts the value.
    // The strings are NOT real on-chain derivations — seed debates are
    // fixtures, not on-chain debates. Production paths derive actionDomain
    // via contract.deriveDomain() or computeActionDomainLocally
    // (src/routes/api/debates/create/+server.ts:88-105). Channel byte
    // (high 8 bits) tags the field role for debugging; remaining bits
    // encode the slot — all values stay safely < BN254 modulus.
    const seedBytes32 = (channel: number, slot: number): string => {
      const value = (BigInt(channel) << 240n) | BigInt(slot + 1);
      return "0x" + value.toString(16).padStart(64, "0");
    };

    // Argument fixtures hoisted so the debate's totalStake/uniqueParticipants
    // can be derived from what the inner loop will actually insert. Previous
    // hand-written literals overshot truth by 10-38% per debate.
    const argumentDefs = [
      { stance: "SUPPORT", body: "This proposal addresses a critical need and has broad community backing. The evidence supports immediate action.", stakeAmount: 100 },
      { stance: "OPPOSE", body: "While the intent is good, the implementation details are insufficient. We need more specific language before committing resources.", stakeAmount: 80 },
      { stance: "AMEND", body: "The core proposal is sound but should include sunset provisions and measurable benchmarks for success.", stakeAmount: 60 },
      { stance: "SUPPORT", body: "Strong precedent from other jurisdictions shows this approach works. We should move forward decisively.", stakeAmount: 50 },
    ];

    const debateDefs = [
      {
        templateIdx: 0,
        status: "resolved",
        deadline: daysAgo(7),
        argumentCount: 4,
        winningStance: "SUPPORT" as string | undefined,
        winningArgumentIndex: 0 as number | undefined,
        resolvedAt: daysAgo(7) as number | undefined,
        marketStatus: "resolved",
      },
      {
        templateIdx: 1,
        status: "active",
        deadline: daysFromNow(14),
        argumentCount: 3,
        winningStance: undefined as string | undefined,
        winningArgumentIndex: undefined as number | undefined,
        resolvedAt: undefined as number | undefined,
        marketStatus: "active",
      },
      {
        templateIdx: 3,
        status: "awaiting_governance",
        deadline: daysAgo(1),
        argumentCount: 3,
        winningStance: undefined as string | undefined,
        winningArgumentIndex: undefined as number | undefined,
        resolvedAt: undefined as number | undefined,
        marketStatus: "active",
      },
      {
        templateIdx: 4,
        status: "under_appeal",
        deadline: daysAgo(3),
        argumentCount: 2,
        winningStance: "OPPOSE" as string | undefined,
        winningArgumentIndex: 1 as number | undefined,
        resolvedAt: daysAgo(3) as number | undefined,
        marketStatus: "resolved",
      },
    ];

    for (let dIdx = 0; dIdx < debateDefs.length; dIdx++) {
      const d = debateDefs[dIdx];

      // Derive aggregate metrics from the actual arguments we will insert
      // for this debate (cycled via aIdx % argumentDefs.length below).
      // uniqueParticipants reflects this fixture's one-arg-per-participant
      // convention; production-grade truth would query distinct authors.
      const argsToInsert = Array.from(
        { length: d.argumentCount },
        (_, i) => argumentDefs[i % argumentDefs.length],
      );
      const totalStake = argsToInsert.reduce((s, a) => s + a.stakeAmount, 0);
      const uniqueParticipants = d.argumentCount;

      // debateIdOnchain, propositionHash, actionDomain all conform to the
      // 0x-prefixed 32-byte format that DebateProofGenerator and
      // buildDebateActionDomain require. The convex/debates.ts:722
      // `domain-${id}` literal that the seed previously mirrored is a
      // self-described placeholder ("In this action we would call the
      // on-chain proposeDebate() and deriveDomain(). For now, generate
      // off-chain IDs"), and would fail `isValidActionDomain` validation
      // on every downstream consumer. Fix tracked at [[F16-spawnDebate-stub]].
      const debateIdOnchain = seedBytes32(0x10, dIdx);
      const propositionHash = seedBytes32(0x20, dIdx);
      const actionDomain = seedBytes32(0x30, dIdx);
      const debateId = await ctx.db.insert("debates", {
        templateId: templateIds[d.templateIdx],
        debateIdOnchain,
        actionDomain,
        propositionHash,
        propositionText: `Should the ${SEED_TEMPLATES[d.templateIdx].title} be adopted as a community priority?`,
        deadline: d.deadline,
        jurisdictionSize: 50000,
        status: d.status as "active" | "resolving" | "resolved" | "awaiting_governance" | "under_appeal",
        argumentCount: d.argumentCount,
        uniqueParticipants,
        totalStake,
        winningArgumentIndex: d.winningArgumentIndex,
        winningStance: d.winningStance,
        resolvedAt: d.resolvedAt,
        resolvedFromChain: d.status === "resolved",
        proposerAddress: `0x${dIdx.toString(16).padStart(40, "0")}`,
        proposerBond: 50,
        marketStatus: d.marketStatus,
        marketLiquidity: 1000,
        currentPrices: { SUPPORT: "0.55", OPPOSE: "0.35", AMEND: "0.10" },
        currentEpoch: d.status === "resolved" ? 3 : 1,
        tradeDeadline: d.status === "active" ? daysFromNow(12) : d.deadline,
        resolutionDeadline: d.status === "active" ? daysFromNow(14) : d.deadline,
        txHash: d.status === "resolved" ? `0xtx${dIdx}` : undefined,
        updatedAt: now,
      });

      for (let aIdx = 0; aIdx < argsToInsert.length; aIdx++) {
        const a = argsToInsert[aIdx];
        await ctx.db.insert("debateArguments", {
          debateId,
          argumentIndex: aIdx,
          stance: a.stance,
          body: a.body,
          bodyHash: `arg-body-hash-${dIdx}-${aIdx}`,
          stakeAmount: a.stakeAmount,
          engagementTier: 2,
          weightedScore: a.stakeAmount * 1.5,
          totalStake: a.stakeAmount,
          coSignCount: Math.floor(Math.random() * 5),
          currentPrice: (0.3 + Math.random() * 0.4).toFixed(4),
          positionCount: Math.floor(Math.random() * 10) + 1,
          aiScores: {
            coherence: 0.7 + Math.random() * 0.3,
            evidence: 0.5 + Math.random() * 0.4,
            novelty: 0.4 + Math.random() * 0.5,
          },
          aiWeighted: 0.6 + Math.random() * 0.3,
          finalScore: a.stakeAmount * (0.6 + Math.random() * 0.3),
          modelAgreement: 0.7 + Math.random() * 0.25,
          verificationStatus: "verified",
          verifiedAt: daysAgo(dIdx + aIdx + 1),
        });
      }

      // FIX-V3: wire the first matching campaign to this debate so
      // computeVerificationPacketCached emits a non-null packet.debate
      // for at least one seeded campaign. Without this, the NEW-E-3
      // populator never fires in dev because no seeded campaign points
      // at a debate.
      const matchingCampaign = await ctx.db
        .query("campaigns")
        .filter((q) =>
          q.and(
            q.eq(q.field("templateId"), templateIds[d.templateIdx]),
            q.eq(q.field("debateId"), undefined),
          ),
        )
        .first();
      if (matchingCampaign) {
        await ctx.db.patch(matchingCampaign._id, {
          debateId,
          debateEnabled: true,
          updatedAt: now,
        });
      }
    }
  },
});

// =============================================================================
// PHASE 16: GRANT DEV ACCOUNT ACCESS
// =============================================================================

const DEV_ACCOUNT_EMAIL = "mock7ee@gmail.com";

export const grantDevAccount = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
    // Optional override so a dev signing in with a different Google account
    // can grant themselves owner. Defaults to DEV_ACCOUNT_EMAIL.
    email: v.optional(v.string()),
  },
  handler: async (ctx, { orgIds, email }) => {
    const devEmail = email ?? DEV_ACCOUNT_EMAIL;
    const now = Date.now();

    // Find the dev account, or create a stub so the grant always lands on a
    // fresh DB. The dev account is normally minted via Google OAuth, but on a
    // freshly-seeded backend it doesn't exist yet, so the grant used to no-op.
    // A stub with email + emailHash (and NO tokenIdentifier) is safe: at real
    // login, authOps.upsertOAuthUser dedups by email (Step 2), links the OAuth
    // account to this same row, and backfills tokenIdentifier to the canonical
    // `${ISSUER_PREFIX}|${userId}` — so the owner memberships granted here carry
    // straight through to the logged-in account.
    let devUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", devEmail))
      .first();

    if (!devUser) {
      const stubId = await ctx.db.insert("users", {
        email: devEmail,
        emailHash: await sha256Hex(devEmail.toLowerCase().trim()),
        name: "Dev Account",
        updatedAt: now,
        // New-user defaults, mirroring authOps.upsertOAuthUser Step 3.
        // tokenIdentifier intentionally omitted — login backfills it.
        isVerified: false,
        authorityLevel: 1,
        trustTier: 0,
        trustScore: 50,
        reputationTier: "new",
        districtVerified: false,
        templatesContributed: 0,
        templateAdoptionRate: 0,
        peerEndorsements: 0,
        activeMonths: 0,
        profileVisibility: "private",
      });
      devUser = await ctx.db.get(stubId);
      console.log(`[seed] Dev account ${devEmail} not found — created stub ${stubId}.`);
    }
    if (!devUser) {
      console.log(`[seed] Failed to resolve dev account ${devEmail} — skipping grants.`);
      return;
    }

    console.log(`[seed] Granting ${devEmail} owner on ${orgIds.length} seeded org(s).`);

    for (const orgId of orgIds) {
      // Check if membership already exists
      const existing = await ctx.db
        .query("orgMemberships")
        .withIndex("by_userId_orgId", (q) => q.eq("userId", devUser._id).eq("orgId", orgId))
        .first();

      if (!existing) {
        await ctx.db.insert("orgMemberships", {
          userId: devUser._id,
          orgId,
          role: "owner",
          joinedAt: now,
        });
      } else if (existing.role !== "owner") {
        await ctx.db.patch(existing._id, { role: "owner" });
      }
    }
  },
});

// =============================================================================
// STANDALONE DEV GRANT
// =============================================================================
// Resolves org IDs itself, so it works any time — independent of seedAll.
// `npm run seed` already ensures owner for the default mock7ee account on every
// run (creating a stub if needed). Use this standalone form to grant a DIFFERENT
// email (e.g. you signed in with your own Google account):
//   npx convex run seed:grantDev '{"email":"you@example.com"}'
//   npx convex run seed:grantDev                  # same as the default seed grant
// (prefix with the IPv4-first NODE_OPTIONS on this dev machine — see CLAUDE memory)
// (prefix with the IPv4-first NODE_OPTIONS on this dev machine — see CLAUDE memory)
export const grantDev = internalAction({
  args: {
    email: v.optional(v.string()),
  },
  handler: async (ctx, { email }) => {
    const orgIds = await ctx.runQuery(internal.seed.getSeedOrgIds);
    if (orgIds.length === 0) {
      console.log("[seed] No organizations found — nothing to grant. Run `npm run seed` first.");
      return;
    }
    await ctx.runMutation(internal.seed.grantDevAccount, { orgIds, email });
  },
});

// =============================================================================
// NOTE: Onboarding state is set in insertSupporters (hasSentEmail: true for
// org[0] which has a completed email blast). The insertSupporters mutation
// runs before insertEmailBlasts in the seedAll orchestrator.
// =============================================================================

// =============================================================================
// PHASE 18: INSERT DECISION MAKERS + USER DM RELATIONS
// =============================================================================
// Production verifyAddress at convex/users.ts:864-933 upserts decisionMakers
// + userDmRelations atomically when officials arrive from the resolver.
// Without seeding these, profile/templatePage joins (getMyRepresentatives,
// getUserDmRelation) return empty for verified seed users — Intelligence
// Loop UX is hollow despite the surrounding org/campaign activity.

// Per-rep structured shape used by both decisionMakers seed and
// userDmRelations lookup. Mirrors users.ts production-insert shape.
interface SeedRep {
  fullName: string;
  firstName: string;
  lastName: string;
  title: string;
  email: string;
  party?: string;
  district: string; // 'CA' (statewide) | 'CA-11' (congressional) | 'SD-11' | 'AD-17' | 'D3' | 'SF'
  jurisdiction: string; // 'CA'
  jurisdictionLevel: string; // 'federal' | 'state' | 'municipal'
  type: string; // 'legislator' | 'executive'
  chamber?: string; // 'house' | 'senate' | undefined
}

// Note: REPRESENTATIVES (above) carries duplicate CA-11 entries (Sarah Kim
// and Nancy Pelosi) for orgResolvedContacts cache fixtures. The
// decisionMakers seed deliberately deduplicates — only one House rep per
// district — so userDmRelations matches reality (one constituent
// relationship to the seated representative, not two).
const SEED_REPS: SeedRep[] = [
  { fullName: "Sen. Maria Lopez", firstName: "Maria", lastName: "Lopez", title: "U.S. Senator", email: "lopez@senate.gov", party: "D", district: "CA", jurisdiction: "CA", jurisdictionLevel: "federal", type: "legislator", chamber: "senate" },
  { fullName: "Sen. James Park", firstName: "James", lastName: "Park", title: "U.S. Senator", email: "park@senate.gov", party: "D", district: "CA", jurisdiction: "CA", jurisdictionLevel: "federal", type: "legislator", chamber: "senate" },
  { fullName: "Rep. David Okonkwo", firstName: "David", lastName: "Okonkwo", title: "U.S. Representative", email: "okonkwo@house.gov", party: "D", district: "CA-12", jurisdiction: "CA", jurisdictionLevel: "federal", type: "legislator", chamber: "house" },
  { fullName: "Rep. Nancy Pelosi", firstName: "Nancy", lastName: "Pelosi", title: "U.S. Representative", email: "pelosi@house.gov", party: "D", district: "CA-11", jurisdiction: "CA", jurisdictionLevel: "federal", type: "legislator", chamber: "house" },
  { fullName: "Sen. Robert Huang", firstName: "Robert", lastName: "Huang", title: "State Senator", email: "huang@senate.ca.gov", party: "D", district: "SD-11", jurisdiction: "CA", jurisdictionLevel: "state", type: "legislator", chamber: "senate" },
  { fullName: "Asm. Lisa Chen", firstName: "Lisa", lastName: "Chen", title: "State Assembly", email: "chen@assembly.ca.gov", party: "D", district: "AD-17", jurisdiction: "CA", jurisdictionLevel: "state", type: "legislator" },
  { fullName: "Sup. Aaron Peskin", firstName: "Aaron", lastName: "Peskin", title: "Supervisor", email: "peskin@sfgov.org", district: "D3", jurisdiction: "San Francisco", jurisdictionLevel: "municipal", type: "legislator" },
  { fullName: "Sup. Hillary Ronen", firstName: "Hillary", lastName: "Ronen", title: "Supervisor", email: "ronen@sfgov.org", district: "D9", jurisdiction: "San Francisco", jurisdictionLevel: "municipal", type: "legislator" },
  { fullName: "Sup. Dean Preston", firstName: "Dean", lastName: "Preston", title: "Supervisor", email: "preston@sfgov.org", district: "D5", jurisdiction: "San Francisco", jurisdictionLevel: "municipal", type: "legislator" },
  { fullName: "Sup. Matt Dorsey", firstName: "Matt", lastName: "Dorsey", title: "Supervisor", email: "dorsey@sfgov.org", district: "D6", jurisdiction: "San Francisco", jurisdictionLevel: "municipal", type: "legislator" },
  { fullName: "Mayor London Breed", firstName: "London", lastName: "Breed", title: "Mayor", email: "mayor@sfgov.org", district: "SF", jurisdiction: "San Francisco", jurisdictionLevel: "municipal", type: "executive" },
];

export const insertDecisionMakers = internalMutation({
  args: {},
  handler: async (ctx): Promise<Id<"decisionMakers">[]> => {
    const now = Date.now();
    const ids: Id<"decisionMakers">[] = [];
    for (let i = 0; i < SEED_REPS.length; i++) {
      const r = SEED_REPS[i];
      const id = await ctx.db.insert("decisionMakers", {
        type: r.type,
        title: r.title,
        name: r.fullName,
        firstName: r.firstName,
        lastName: r.lastName,
        party: r.party,
        jurisdiction: r.jurisdiction,
        jurisdictionLevel: r.jurisdictionLevel,
        district: r.district,
        email: r.email,
        active: true,
        lastSyncedAt: now,
        updatedAt: now,
      });
      ids.push(id);
      // Match production parity: verifyAddress at users.ts:905 always
      // writes an externalIds row keyed by bioguideId for federal
      // legislators. State/municipal seeds get a synthetic 'seed' system
      // value so the externalIds join surface remains uniform.
      const isFederal = r.jurisdictionLevel === "federal" && r.type === "legislator";
      await ctx.db.insert("externalIds", {
        decisionMakerId: id,
        system: isFederal ? "bioguide" : "seed",
        value: `SEED${(i + 1).toString().padStart(6, "0")}`,
      });
    }
    return ids;
  },
});

// Wire verified seed users to their constituent reps. Matches the
// upsert pattern in users.ts:931-933 ('constituent' relationship,
// source = the user's verificationMethod).
export const insertUserDmRelations = internalMutation({
  args: {
    userIds: v.array(v.id("users")),
    dmIds: v.array(v.id("decisionMakers")),
  },
  handler: async (ctx, { userIds, dmIds }) => {
    const now = Date.now();

    // SEED_REPS index → district lookup. Federal senators apply to all CA
    // users; congressional reps apply by district match. Local SF reps
    // are not constituent-bound to seed users (Alex/Jordan are not in
    // SF supervisor districts in this fixture).
    const findByDistrict = (district: string): number[] => {
      const idx: number[] = [];
      for (let i = 0; i < SEED_REPS.length; i++) {
        if (SEED_REPS[i].district === district) idx.push(i);
      }
      return idx;
    };

    const userDistrictMap: Array<{ userIdx: number; district: string; method: string }> = [
      { userIdx: 0, district: "CA-11", method: "shadow_atlas" }, // seed-1 Alex
      { userIdx: 1, district: "CA-12", method: "shadow_atlas" }, // seed-2 Jordan
    ];

    for (const { userIdx, district, method } of userDistrictMap) {
      // Statewide senators (district='CA') + congressional rep for the user's district.
      const repIndices = [...findByDistrict("CA"), ...findByDistrict(district)];
      for (const repIdx of repIndices) {
        await ctx.db.insert("userDmRelations", {
          userId: userIds[userIdx],
          decisionMakerId: dmIds[repIdx],
          relationship: "constituent",
          isActive: true,
          assignedAt: now,
          lastValidated: now,
          source: method,
        });
      }
    }
  },
});

// =============================================================================
// PHASE 19: INSERT SUBSCRIPTIONS
// =============================================================================
// There is no free org tier. An org with no subscription row falls to the
// gated `inactive` floor (2 templates, zero delivery). Every seeded dev/demo
// org therefore gets an explicit active subscription so none lands on the
// floor — Climate Action Now (8 supporters, $1.25K raised, sent blast) looking
// gated would be incoherent with the rest of its activity. Plans canonical at
// src/lib/server/billing/plans.ts.

export const insertSubscriptions = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { orgIds }) => {
    const now = Date.now();
    // Realistic posture: a heavy-activity org pays Organization tier; a
    // mid-activity org pays Starter; the third demos the top Coalition tier.
    // Every seeded org gets a row — none falls to the gated inactive floor.
    // priceCents mirror plans.ts exactly.
    const subscriptionDefs = [
      { orgIdx: 0, plan: "organization", priceCents: 7_500 }, // Climate Action Now
      { orgIdx: 1, plan: "starter", priceCents: 1_000 },      // Voter Rights Coalition
      { orgIdx: 2, plan: "coalition", priceCents: 20_000 },   // Local First SF (top tier demo)
    ];

    // 30-day billing cycle anchored so the seed represents an active
    // mid-period state (15 days in, 15 days remaining).
    const halfMonth = 15 * 86_400_000;
    for (const s of subscriptionDefs) {
      await ctx.db.insert("subscriptions", {
        orgId: orgIds[s.orgIdx],
        plan: s.plan as "inactive" | "starter" | "organization" | "coalition",
        priceCents: s.priceCents,
        status: "active",
        currentPeriodStart: now - halfMonth,
        currentPeriodEnd: now + halfMonth,
        paymentMethod: "stripe",
        stripeSubscriptionId: `sub_seed_${s.plan}_${s.orgIdx}`,
        updatedAt: now,
      });
      // Patch the org's stripeCustomerId so Stripe webhook handlers that
      // match by customerId can resolve to this org. organizations table
      // also carries plan-derived limits (maxSeats, maxTemplatesMonth);
      // backfillOrgLimits at convex/subscriptions.ts:707-740 is the
      // production sync path. Mirror it here so the seed's view of plan
      // limits matches what backfill would set.
      const planDef = PLANS_SEED[s.plan];
      await ctx.db.patch(orgIds[s.orgIdx], {
        stripeCustomerId: `cus_seed_${s.orgIdx}`,
        maxSeats: planDef.maxSeats,
        maxTemplatesMonth: planDef.maxTemplatesMonth,
        updatedAt: now,
      });
    }
  },
});

// Plan-limits mirror for the seed. Mirrors the canonical
// src/lib/server/billing/plans.ts PLANS — Convex functions cannot import
// from src/lib (different runtime root), so the seed duplicates the
// minimum needed (maxSeats, maxTemplatesMonth) for the slugs it
// references. If plans.ts shifts, update here too.
const PLANS_SEED: Record<string, { maxSeats: number; maxTemplatesMonth: number }> = {
  starter: { maxSeats: 5, maxTemplatesMonth: 100 },
  organization: { maxSeats: 10, maxTemplatesMonth: 500 },
  coalition: { maxSeats: 25, maxTemplatesMonth: 1_000 },
};

// =============================================================================
// PHASE 17: ENCRYPT SEED PII — backfill donations, RSVPs, invites
// =============================================================================

export const encryptSeedPii = internalAction({
  args: { orgIds: v.array(v.id("organizations")) },
  handler: async (ctx, { orgIds }) => {

    for (const orgId of orgIds) {
      const orgKey = await getOrgKeyForAction(ctx, orgId);
      if (!orgKey) continue;

      // Encrypt donations
      const donations = await ctx.runQuery(internal.seed.getOrgDonations, { orgId });
      for (const d of donations) {
        if (d.encryptedEmail && d.encryptedEmail !== "") continue; // already encrypted
        const name = d.rawName ?? "Supporter";
        const email = `${name.toLowerCase().replace(/[^a-z]/g, '')}@example.com`;
        const [encEmail, encName] = await Promise.all([
          encryptWithOrgKey(email, orgKey, `donation:${d._id}`, "email"),
          encryptWithOrgKey(name, orgKey, `donation:${d._id}`, "name"),
        ]);
        const emailHash = await computeOrgScopedEmailHash(orgId, email);
        await ctx.runMutation(internal.seed.patchSeedRecord, {
          table: "donations",
          id: d._id,
          patch: {
            encryptedEmail: JSON.stringify(encEmail),
            encryptedName: JSON.stringify(encName),
            emailHash,
          },
        });
      }

      // Encrypt invites
      const invites = await ctx.runQuery(internal.seed.getOrgInvites, { orgId });
      for (const inv of invites) {
        if (inv.encryptedEmail && inv.encryptedEmail !== "" && !inv.encryptedEmail.startsWith("seed-")) continue;
        const email = `invite-${inv.emailHash}@example.com`;
        const encEmail = await encryptWithOrgKey(email, orgKey, inv.emailHash, "email");
        const emailHash = await computeOrgScopedEmailHash(orgId, email);
        await ctx.runMutation(internal.seed.patchSeedRecord, {
          table: "orgInvites",
          id: inv._id,
          patch: {
            encryptedEmail: JSON.stringify(encEmail),
            emailHash,
          },
        });
      }
    }
    console.log(`[seed] Encrypted PII for ${orgIds.length} orgs`);
  },
});

export const getOrgDonations = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const all = await ctx.db
      .query("donations")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    return all.map((doc) => {
      const d = doc as typeof doc & { name?: string };
      return {
        _id: String(d._id),
        encryptedEmail: d.encryptedEmail,
        encryptedName: d.encryptedName,
        rawName: d.name ?? (d.encryptedName && !d.encryptedName.startsWith("{") ? d.encryptedName : null),
      };
    });
  },
});

export const getOrgInvites = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const all = await ctx.db
      .query("orgInvites")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    return all.map((i) => ({
      _id: String(i._id),
      encryptedEmail: i.encryptedEmail,
      emailHash: i.emailHash,
    }));
  },
});

/**
 * Table-scoped patch primitive. Plain `id: v.string()` + `patch: v.any()`
 * with `ctx.db.patch(id as any, patch)` would be a universal write
 * primitive. Same defense pattern as `backfill.patchRow`: require
 * `table` arg + allowlist + `normalizeId` so a malformed call can't
 * reach into sensitive tables (organizations, subscriptions,
 * identityCredentials, mDLCredentials, anchorStatus). Seed callers
 * only ever patch supporters, donations, and orgInvites.
 */
const ALLOWED_SEED_TABLES = ["supporters", "donations", "orgInvites"] as const;

export const patchSeedRecord = internalMutation({
  args: { table: v.string(), id: v.string(), patch: v.any() },
  handler: async (ctx, { table, id, patch }) => {
    if (!ALLOWED_SEED_TABLES.includes(table as typeof ALLOWED_SEED_TABLES[number])) {
      throw new Error(`PATCH_TABLE_NOT_ALLOWED: ${table}`);
    }
    const normalizedId = ctx.db.normalizeId(table as typeof ALLOWED_SEED_TABLES[number], id);
    if (!normalizedId) {
      throw new Error(`PATCH_ID_INVALID_FOR_TABLE: ${table}`);
    }
    await ctx.db.patch(normalizedId, patch);
  },
});

// =============================================================================
// CLEAR SEED — wipe all seeded data so seedAll can re-run
// =============================================================================

// Every table in the schema, ordered children-first to avoid dangling refs.
// Audited 2026-05-25 against schema.ts via [[brutalist_audit_2026_05_25]] C2;
// 17 tables that were silently skipped have been added in dependency order.
const SEED_TABLES = [
  // Leaf tables (no dependents)
  "delegationReviews", "delegatedActions", "delegationGrants",
  "scorecardSnapshots", "orgDmFollows", "orgBillWatches", "orgBillRelevances",
  "externalIds", "decisionMakers", "orgIssueDomains",
  "accountabilityReceipts", "legislativeActions", "legislativeAlerts", "bills",
  "scopeCorrections", "patchThroughCalls", "smsMessages", "smsBlasts",
  "workflowActionLogs", "workflowExecutions", "workflows",
  "donations", "eventRsvps", "events",
  // emailDeliveryReceipts + emailEvents both FK emailBlasts → clear before blasts.
  "emailDeliveryReceipts", "emailEvents", "emailBlasts",
  "campaignDeliveries", "campaignActions",
  // debateNullifiers references debateArguments via argumentId (declared
  // v.optional(v.string()) — see [[F18-debateNullifiers-argumentId-schema]]
  // — but the writer at convex/debates.ts:575 stores a real Id). Clear
  // nullifiers first so the children-first invariant holds even though
  // Convex does not enforce the FK.
  "debateNullifiers", "debateArguments", "debates",
  "positionDeliveries", "positionRegistrations", "communityFieldContributions",
  "templateEndorsements", "segments", "supporterTags", "tags", "supporters",
  "orgInvites", "orgResolvedContacts", "orgNetworkMembers", "orgNetworks",
  "apiKeys", "subscriptions",
  // orgTwilioNumbers and notifications both reference organizations
  // (notifications.orgId is optional, but children-first means clear here).
  "orgTwilioNumbers", "notifications",
  "campaigns", "templates", "messages", "userDmRelations",
  "orgMemberships", "organizations",
  // Auth + identity
  "shadowAtlasRegistrations", "verificationAudits", "submissionRetries",
  // submissionDeliveryReceipts FKs submissions → clear before submissions.
  "submissionDeliveryReceipts", "submissions",
  // Revocation tables reference credentials/submissions for audit but are
  // operationally leaf; clear before districtCredentials.
  "revocationFlags", "revocationHaltAuditLog", "revocationReconcileState",
  // Ground vault chain: passkey wrapper → groundVaults ↔ groundCellMetadata
  // → districtCredentials. Wrappers FK groundVaults; vaults and cell
  // metadata reference each other via OPTIONAL FKs (clear-order tolerant);
  // both FK districtCredentials.
  "passkeyVaultWrappers", "groundCellMetadata", "groundVaults",
  // mdlCredentialUses has no FK to districtCredentials (it stores
  // credentialHash + userId, not a credential Id) — clear here for
  // proximity to credential lifecycle.
  "mdlCredentialUses",
  "encryptedDeliveryData", "districtCredentials",
  "verificationSessions", "privacyBudgets", "analytics",
  "agentTraces", "intelligence", "parsedDocumentCache",
  "resolvedContacts", "suppressedEmails", "bounceReports", "rateLimits",
  // SMT state (sparse merkle tree for revocation). Standalone state, but
  // semantically tied to credentials — clear here for completeness.
  "smtNodes", "smtRoots",
  // Operator/queue state. Standalone; users-adjacent.
  "sweepCheckpoints", "waitlist",
  // User-scoped state cleared just before users.
  "messageGenerationJobs", "passkeyCeremonySessions",
  "sessions", "accounts", "users",
] as const;

export const clearSeed = internalAction({
  args: {},
  handler: async (ctx): Promise<{ tables: number; deleted: number; failedRows: number; failedTables: number }> => {
    let totalDeleted = 0;
    let totalFailed = 0;
    let failedTables = 0;
    for (const table of SEED_TABLES) {
      const result: { deleted: number; failed: number } = await ctx.runMutation(
        internal.seed.clearTable,
        { table },
      );
      totalDeleted += result.deleted;
      totalFailed += result.failed;
      if (result.failed > 0) failedTables++;
    }
    if (totalFailed > 0) {
      console.error(
        `[seed] Cleared ${totalDeleted} rows across ${SEED_TABLES.length} tables — ${failedTables} tables had partial failures (${totalFailed} rows). Inspect per-table logs above.`,
      );
    } else {
      console.log(`[seed] All ${totalDeleted} rows across ${SEED_TABLES.length} tables cleared.`);
    }
    return {
      tables: SEED_TABLES.length,
      deleted: totalDeleted,
      failedRows: totalFailed,
      failedTables,
    };
  },
});

export const clearTable = internalMutation({
  args: { table: v.string() },
  handler: async (ctx, { table }): Promise<{ deleted: number; failed: number }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docs = await (ctx.db as any).query(table).collect();
    let deleted = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const doc of docs) {
      try {
        await ctx.db.delete(doc._id);
        deleted++;
      } catch (err) {
        // Without per-doc try/catch the inner throw propagates to
        // clearSeed and silently skips every remaining table in
        // SEED_TABLES — operator sees a half-wiped database with no
        // aggregate status. Capture the error per-row so partial
        // failures are visible.
        failed++;
        if (errors.length < 5) {
          errors.push(`${doc._id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    if (deleted > 0 || failed > 0) {
      console.log(`  ${table}: cleared=${deleted} failed=${failed}`);
    }
    if (failed > 0) {
      console.error(`  ${table}: first ${errors.length} errors → ${errors.join("; ")}`);
    }
    return { deleted, failed };
  },
});

// =============================================================================
// BACKFILL SCOPES — patch existing templates with scope data from seed definitions
// =============================================================================

export const reseedTemplates = internalAction({
  args: {},
  handler: async (ctx) => {
    // 1. Delete debates + arguments + nullifiers. Order matches the
    // children-first invariant in SEED_TABLES — debateNullifiers
    // references debateArguments via argumentId (typed v.id() post-F18),
    // so clear nullifiers BEFORE arguments to avoid leaving dangling
    // refs if the clear is interrupted mid-action.
    await ctx.runMutation(internal.seed.clearTable, { table: "debateNullifiers" });
    await ctx.runMutation(internal.seed.clearTable, { table: "debateArguments" });
    await ctx.runMutation(internal.seed.clearTable, { table: "debates" });
    // 2. Delete campaigns + dependents
    await ctx.runMutation(internal.seed.clearTable, { table: "campaignDeliveries" });
    await ctx.runMutation(internal.seed.clearTable, { table: "campaignActions" });
    await ctx.runMutation(internal.seed.clearTable, { table: "campaigns" });
    // 3. Delete position data
    await ctx.runMutation(internal.seed.clearTable, { table: "positionDeliveries" });
    await ctx.runMutation(internal.seed.clearTable, { table: "positionRegistrations" });
    // 4. Delete other tables that FK templates so the reinsert below
    // doesn't leave orphans pointing at the old template Ids.
    await ctx.runMutation(internal.seed.clearTable, { table: "templateEndorsements" });
    // 5. Delete templates
    await ctx.runMutation(internal.seed.clearTable, { table: "templates" });

    // 5. Get existing user + org IDs to reassign templates
    const userIds = await ctx.runQuery(internal.seed.getSeedUserIds);
    const orgIds = await ctx.runQuery(internal.seed.getSeedOrgIds);

    if (userIds.length === 0) {
      console.log("[reseedTemplates] No seed users found — cannot reseed.");
      return;
    }

    // 6. Reinsert templates
    let templateIds: Id<"templates">[];
    if (orgIds.length > 0) {
      templateIds = await ctx.runMutation(internal.seed.insertTemplates, { userIds, orgIds });
    } else {
      templateIds = await ctx.runMutation(internal.seed.insertTemplatesPublic, { userIds });
    }

    // 7. Reinsert debates
    await ctx.runMutation(internal.seed.insertDebates, { templateIds });

    // 8. Reinsert campaigns (only if orgs exist)
    if (orgIds.length > 0) {
      await ctx.runMutation(internal.seed.insertCampaigns, { orgIds, templateIds });
    }

    console.log(`[reseedTemplates] Done: ${templateIds.length} templates, debates, campaigns reseeded.`);
  },
});

export const getSeedUserIds = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"users">[]> => {
    const users = await ctx.db.query("users").collect();
    return users.map((u) => u._id);
  },
});

export const getSeedOrgIds = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"organizations">[]> => {
    const orgs = await ctx.db.query("organizations").collect();
    return orgs.map((o) => o._id);
  },
});

export const backfillScopes = internalMutation({
  args: {},
  handler: async (ctx) => {
    const scopesBySlug = new Map<string, typeof SEED_TEMPLATES[number]["scopes"]>();
    for (const t of SEED_TEMPLATES) {
      if (t.scopes) scopesBySlug.set(t.slug, t.scopes);
    }

    const templates = await ctx.db.query("templates").collect();
    let patched = 0;
    for (const template of templates) {
      const scopes = scopesBySlug.get(template.slug);
      if (scopes && (!template.scopes || template.scopes.length === 0)) {
        await ctx.db.patch(template._id, { scopes });
        patched++;
      }
    }
    console.log(`[seed] Backfilled scopes on ${patched}/${templates.length} templates.`);
  },
});
