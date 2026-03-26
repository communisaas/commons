/**
 * Seed action for bootstrapping a fresh Convex database.
 *
 * Creates the minimum data needed for the app to be functional:
 * - 3 users (2 verified, 1 unverified)
 * - 3 organizations
 * - Org memberships linking users to orgs
 * - 3 templates (one per user)
 * - 3 campaigns (one per org)
 * - 30 supporters (10 per org)
 *
 * Run via the Convex dashboard or CLI:
 *   npx convex run seed:seedAll
 *
 * PII fields use empty-string placeholders. The app handles plaintext email
 * during development; encrypted PII is only enforced in production.
 */

import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// =============================================================================
// SEED DATA DEFINITIONS
// =============================================================================

const SEED_USERS = [
  {
    email: "seed-1@commons.email",
    name: "Alex Rivera",
    isVerified: true,
    verificationMethod: "mdl",
    trustTier: 1,
    tokenIdentifier: "seed|seed-1@commons.email",
  },
  {
    email: "seed-2@commons.email",
    name: "Jordan Chen",
    isVerified: true,
    verificationMethod: "mdl",
    trustTier: 1,
    tokenIdentifier: "seed|seed-2@commons.email",
  },
  {
    email: "seed-3@commons.email",
    name: "Morgan Tremblay",
    isVerified: false,
    verificationMethod: undefined,
    trustTier: 0,
    tokenIdentifier: "seed|seed-3@commons.email",
  },
] as const;

const SEED_ORGS = [
  {
    name: "Climate Action Now",
    slug: "climate-action-now",
    description: "Grassroots climate advocacy for evidence-based policy.",
    billingEmail: "billing@climateactionnow.org",
  },
  {
    name: "Voter Rights Coalition",
    slug: "voter-rights-coalition",
    description: "Protecting and expanding access to the ballot box.",
    billingEmail: "billing@voterrightscoalition.org",
  },
  {
    name: "Local First SF",
    slug: "local-first-sf",
    description: "Strengthening San Francisco neighborhoods through local policy.",
    billingEmail: "billing@localfirstsf.org",
  },
] as const;

const SEED_TEMPLATES = [
  {
    slug: "clean-energy-investment",
    title: "Support Clean Energy Investment Act",
    description:
      "Urge your representative to co-sponsor the Clean Energy Investment Act, which would fund solar and wind infrastructure in underserved communities.",
    category: "environment",
    type: "letter",
    messageBody:
      "Dear [Representative],\n\nI am writing as a constituent to express my strong support for the Clean Energy Investment Act. This legislation would bring critical solar and wind infrastructure to underserved communities while creating thousands of good-paying jobs.\n\nPlease co-sponsor this bill and champion clean energy for all Americans.\n\nSincerely,\n[Your Name]",
    preview:
      "I am writing as a constituent to express my strong support for the Clean Energy Investment Act...",
  },
  {
    slug: "voter-registration-access",
    title: "Expand Voter Registration Access",
    description:
      "Call on state legislators to pass automatic voter registration and same-day registration reforms.",
    category: "democracy",
    type: "letter",
    messageBody:
      "Dear [Legislator],\n\nEvery eligible citizen deserves frictionless access to voter registration. I urge you to support automatic voter registration and same-day registration reforms that have proven effective in other states.\n\nThese common-sense measures increase participation without compromising election integrity.\n\nThank you,\n[Your Name]",
    preview:
      "Every eligible citizen deserves frictionless access to voter registration...",
  },
  {
    slug: "community-safety-funding",
    title: "Fund Community Safety Programs",
    description:
      "Advocate for increased funding for community-based safety programs including mental health responders and youth intervention.",
    category: "safety",
    type: "letter",
    messageBody:
      "Dear [Official],\n\nOur community needs investment in evidence-based safety programs. I ask you to allocate funding for mental health crisis responders, youth intervention programs, and community mediation services.\n\nThese programs have been shown to reduce violence while strengthening neighborhoods.\n\nRespectfully,\n[Your Name]",
    preview:
      "Our community needs investment in evidence-based safety programs...",
  },
] as const;

// Supporter first/last name pools for realistic data
const FIRST_NAMES = [
  "Ava", "Liam", "Sophia", "Noah", "Isabella",
  "Ethan", "Mia", "Lucas", "Charlotte", "Oliver",
  "Amelia", "James", "Harper", "Benjamin", "Evelyn",
  "Mason", "Luna", "Logan", "Ella", "Aiden",
  "Chloe", "Jackson", "Aria", "Sebastian", "Scarlett",
  "Mateo", "Grace", "Henry", "Lily", "Owen",
];

const LAST_NAMES = [
  "Garcia", "Kim", "Patel", "O'Brien", "Nakamura",
  "Johansson", "Chen", "Okafor", "Müller", "Santos",
  "Leblanc", "Gupta", "Nguyen", "Williams", "Rodriguez",
  "Thompson", "Lee", "Martinez", "Anderson", "Taylor",
  "Wilson", "Moore", "Brown", "Davis", "Miller",
  "Hernandez", "Lopez", "Gonzalez", "Clark", "Walker",
];

const POSTAL_CODES = [
  "94110", "94102", "94114", "10001", "10003",
  "60601", "60614", "20001", "20005", "98101",
];

// =============================================================================
// TOP-LEVEL SEED ACTION
// =============================================================================

export const seedAll = internalAction({
  args: {},
  handler: async (ctx) => {
    // Guard: skip if data already exists
    const existing = await ctx.runQuery(internal.seed.checkSeeded);
    if (existing) {
      console.log("Database already seeded — skipping.");
      return;
    }

    console.log("[seed] Phase 1: Inserting users...");
    const userIds = await ctx.runMutation(internal.seed.insertUsers);

    console.log("[seed] Phase 2: Inserting organizations...");
    const orgIds = await ctx.runMutation(internal.seed.insertOrgs);

    console.log("[seed] Phase 3: Inserting memberships...");
    await ctx.runMutation(internal.seed.insertMemberships, { userIds, orgIds });

    console.log("[seed] Phase 4: Inserting templates...");
    await ctx.runMutation(internal.seed.insertTemplates, { userIds, orgIds });

    console.log("[seed] Phase 5: Inserting campaigns...");
    await ctx.runMutation(internal.seed.insertCampaigns, { orgIds });

    console.log("[seed] Phase 6: Inserting supporters...");
    await ctx.runMutation(internal.seed.insertSupporters, { orgIds });

    console.log(
      "[seed] Complete! Created 3 users, 3 orgs, 6 memberships, 3 templates, 3 campaigns, 30 supporters.",
    );
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
// INSERT USERS
// =============================================================================

export const insertUsers = internalMutation({
  args: {},
  handler: async (ctx): Promise<Id<"users">[]> => {
    const now = Date.now();
    const ids: Id<"users">[] = [];

    for (const u of SEED_USERS) {
      const id = await ctx.db.insert("users", {
        tokenIdentifier: u.tokenIdentifier,
        email: u.email,
        name: u.name,
        updatedAt: now,

        // Verification
        isVerified: u.isVerified,
        verificationMethod: u.verificationMethod,
        verifiedAt: u.isVerified ? now : undefined,

        // Trust & authority
        trustTier: u.trustTier,
        authorityLevel: u.isVerified ? 2 : 1,
        trustScore: u.isVerified ? 50 : 0,
        reputationTier: u.isVerified ? "established" : "newcomer",

        // ZK / district
        districtVerified: false,

        // Reputation counters
        templatesContributed: 0,
        templateAdoptionRate: 0,
        peerEndorsements: 0,
        activeMonths: 0,

        // Profile
        profileVisibility: "private",

        // PII placeholders (plaintext email used for dev)
        encryptedEmail: "",
        emailHash: "",
      });
      ids.push(id);
    }

    return ids;
  },
});

// =============================================================================
// INSERT ORGANIZATIONS
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
        billingEmail: o.billingEmail,
        maxSeats: 10,
        maxTemplatesMonth: 50,
        dmCacheTtlDays: 30,
        countryCode: "US",
        isPublic: true,
        supporterCount: 0,
        campaignCount: 0,
        memberCount: 0,
        updatedAt: now,
      });
      ids.push(id);
    }

    return ids;
  },
});

// =============================================================================
// INSERT ORG MEMBERSHIPS
// =============================================================================

export const insertMemberships = internalMutation({
  args: {
    userIds: v.array(v.id("users")),
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { userIds, orgIds }) => {
    const now = Date.now();
    const [alex, jordan, morgan] = userIds;
    const [climate, voterRights, localFirst] = orgIds;

    // Alex: owner of Climate Action Now, owner of Voter Rights Coalition
    await ctx.db.insert("orgMemberships", {
      userId: alex,
      orgId: climate,
      role: "owner",
      joinedAt: now,
    });
    await ctx.db.insert("orgMemberships", {
      userId: alex,
      orgId: voterRights,
      role: "owner",
      joinedAt: now,
    });

    // Jordan: editor of Climate, editor of Voter Rights
    await ctx.db.insert("orgMemberships", {
      userId: jordan,
      orgId: climate,
      role: "editor",
      joinedAt: now,
    });
    await ctx.db.insert("orgMemberships", {
      userId: jordan,
      orgId: voterRights,
      role: "editor",
      joinedAt: now,
    });

    // Morgan: owner of Local First SF, member of Climate
    await ctx.db.insert("orgMemberships", {
      userId: morgan,
      orgId: localFirst,
      role: "owner",
      joinedAt: now,
    });
    await ctx.db.insert("orgMemberships", {
      userId: morgan,
      orgId: climate,
      role: "member",
      joinedAt: now,
    });

    // Update memberCount on orgs
    await ctx.db.patch(climate, { memberCount: 3 });
    await ctx.db.patch(voterRights, { memberCount: 2 });
    await ctx.db.patch(localFirst, { memberCount: 1 });
  },
});

// =============================================================================
// INSERT TEMPLATES
// =============================================================================

export const insertTemplates = internalMutation({
  args: {
    userIds: v.array(v.id("users")),
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { userIds, orgIds }) => {
    const now = Date.now();

    for (let i = 0; i < SEED_TEMPLATES.length; i++) {
      const t = SEED_TEMPLATES[i];
      await ctx.db.insert("templates", {
        slug: t.slug,
        title: t.title,
        description: t.description,
        category: t.category,
        type: t.type,
        deliveryMethod: "email",
        preview: t.preview,
        messageBody: t.messageBody,
        deliveryConfig: {},
        recipientConfig: {},
        metrics: { sends: 0, opens: 0, clicks: 0 },
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
        userId: userIds[i],
        orgId: orgIds[i],

        updatedAt: now,
      });
    }
  },
});

// =============================================================================
// INSERT CAMPAIGNS
// =============================================================================

export const insertCampaigns = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { orgIds }): Promise<Id<"campaigns">[]> => {
    const now = Date.now();
    const ids: Id<"campaigns">[] = [];

    const campaignDefs = [
      {
        title: "Clean Energy Push — Spring 2026",
        body: "Mobilize supporters to contact reps about the Clean Energy Investment Act before the committee vote.",
      },
      {
        title: "Voter Registration Drive — Q2",
        body: "Coordinate outreach for automatic voter registration legislation in targeted states.",
      },
      {
        title: "SF Community Safety Initiative",
        body: "Rally neighborhood support for community-based safety funding in the city budget.",
      },
    ];

    for (let i = 0; i < orgIds.length; i++) {
      const id = await ctx.db.insert("campaigns", {
        orgId: orgIds[i],
        type: "LETTER",
        title: campaignDefs[i].title,
        body: campaignDefs[i].body,
        status: "ACTIVE",

        // Debate
        debateEnabled: false,
        debateThreshold: 100,

        // Fundraising
        raisedAmountCents: 0,
        donorCount: 0,

        // Geographic
        targetCountry: "US",

        // Counters
        actionCount: 0,
        verifiedActionCount: 0,

        updatedAt: now,
      });
      ids.push(id);
    }

    // Update campaignCount on orgs
    for (const orgId of orgIds) {
      await ctx.db.patch(orgId, { campaignCount: 1 });
    }

    return ids;
  },
});

// =============================================================================
// INSERT SUPPORTERS
// =============================================================================

export const insertSupporters = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { orgIds }) => {
    const now = Date.now();

    for (let orgIdx = 0; orgIdx < orgIds.length; orgIdx++) {
      const orgId = orgIds[orgIdx];

      for (let i = 0; i < 10; i++) {
        const idx = orgIdx * 10 + i;
        const firstName = FIRST_NAMES[idx % FIRST_NAMES.length];
        const lastName = LAST_NAMES[idx % LAST_NAMES.length];
        const postalCode = POSTAL_CODES[idx % POSTAL_CODES.length];

        await ctx.db.insert("supporters", {
          orgId,
          name: `${firstName} ${lastName}`,
          postalCode,
          country: "US",

          // PII placeholders
          encryptedEmail: "",
          emailHash: "",

          // Status
          verified: i < 7, // 70% verified
          emailStatus: "subscribed",
          smsStatus: "none",
          source: "organic",

          updatedAt: now,
        });
      }

      // Update supporterCount
      await ctx.db.patch(orgId, { supporterCount: 10 });
    }
  },
});
