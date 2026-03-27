/**
 * Comprehensive seed for bootstrapping a fresh Convex database.
 *
 * Creates realistic data across every org-layer table:
 * - 3 users (2 verified, 1 unverified)
 * - 3 organizations with full onboarding
 * - 7 org memberships
 * - 12 templates (3 inline fallback + 9 additional)
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
 * Dev account integration: if a user with email 'mock7ee@gmail.com' exists,
 * they are granted owner on all seeded orgs.
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
    mission: "Building a movement for climate justice through verified civic action.",
    websiteUrl: "https://climateactionnow.org",
  },
  {
    name: "Voter Rights Coalition",
    slug: "voter-rights-coalition",
    description: "Protecting and expanding access to the ballot box.",
    billingEmail: "billing@voterrightscoalition.org",
    mission: "Every eligible citizen deserves frictionless access to the ballot.",
    websiteUrl: "https://voterrightscoalition.org",
  },
  {
    name: "Local First SF",
    slug: "local-first-sf",
    description: "Strengthening San Francisco neighborhoods through local policy.",
    billingEmail: "billing@localfirstsf.org",
    mission: "Empowering neighborhood voices in city governance.",
    websiteUrl: "https://localfirstsf.org",
  },
] as const;

// ---------------------------------------------------------------------------
// Inline template content — regenerate via scripts/seed-with-agents.ts
// ---------------------------------------------------------------------------
const SEED_TEMPLATES = [
  // ── Original 3 (inline fallback) ──
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
    deliveryMethod: "email",
    countryCode: "US",
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
    deliveryMethod: "email",
    countryCode: "US",
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
    deliveryMethod: "email",
    countryCode: "US",
  },
  // ── Additional 9 templates ──
  {
    slug: "protect-public-lands",
    title: "Protect Public Lands from Development",
    description:
      "Oppose the transfer or sale of federal public lands to private developers and ensure conservation protections remain in place.",
    category: "environment",
    type: "letter",
    messageBody:
      "Dear [Representative],\n\nI am writing to urge you to oppose any legislation that would transfer, sell, or reduce protections on our federal public lands. These lands belong to all Americans and provide critical ecosystem services, recreational opportunities, and wildlife habitat.\n\nPlease stand firm against proposals that would hand public land to private developers.\n\nSincerely,\n[Your Name]",
    preview:
      "I am writing to urge you to oppose any legislation that would transfer, sell, or reduce protections on our federal public lands...",
    deliveryMethod: "email",
    countryCode: "US",
  },
  {
    slug: "ban-partisan-gerrymandering",
    title: "End Partisan Gerrymandering",
    description:
      "Support independent redistricting commissions to ensure fair electoral maps that represent all voters.",
    category: "democracy",
    type: "letter",
    messageBody:
      "Dear [Legislator],\n\nPartisan gerrymandering undermines the foundation of representative democracy. I urge you to support legislation establishing independent redistricting commissions that draw fair maps based on population and community boundaries, not political advantage.\n\nVoters should choose their representatives — not the other way around.\n\nThank you,\n[Your Name]",
    preview:
      "Partisan gerrymandering undermines the foundation of representative democracy...",
    deliveryMethod: "email",
    countryCode: "US",
  },
  {
    slug: "affordable-housing-bond",
    title: "Support the Affordable Housing Bond",
    description:
      "Urge city council to approve the $500M affordable housing bond measure for the November ballot.",
    category: "housing",
    type: "letter",
    messageBody:
      "Dear [Council Member],\n\nSan Francisco's housing crisis demands bold action. I urge you to place the $500 million affordable housing bond on the November ballot. This investment would fund thousands of new affordable units, preserve existing affordable housing, and prevent displacement of longtime residents.\n\nPlease vote yes when this measure comes before the council.\n\nRespectfully,\n[Your Name]",
    preview:
      "San Francisco's housing crisis demands bold action. I urge you to place the $500 million affordable housing bond on the November ballot...",
    deliveryMethod: "email",
    countryCode: "US",
  },
  {
    slug: "ev-charging-infrastructure",
    title: "Fund EV Charging Infrastructure",
    description:
      "Support federal funding for electric vehicle charging stations in rural and underserved communities.",
    category: "environment",
    type: "letter",
    messageBody:
      "Dear [Representative],\n\nThe transition to electric vehicles cannot leave rural and underserved communities behind. I urge you to support full funding for EV charging infrastructure in areas that currently lack access.\n\nThis investment creates jobs, reduces transportation costs, and cuts carbon emissions where the impact is greatest.\n\nSincerely,\n[Your Name]",
    preview:
      "The transition to electric vehicles cannot leave rural and underserved communities behind...",
    deliveryMethod: "email",
    countryCode: "US",
  },
  {
    slug: "election-day-holiday",
    title: "Make Election Day a National Holiday",
    description:
      "Support designating Election Day as a federal holiday so every worker can vote without choosing between their paycheck and their ballot.",
    category: "democracy",
    type: "letter",
    messageBody:
      "Dear [Legislator],\n\nNo American should have to choose between going to work and exercising their right to vote. I urge you to co-sponsor legislation making Election Day a federal holiday.\n\nCountries around the world hold elections on holidays or weekends. It is time the United States caught up.\n\nThank you,\n[Your Name]",
    preview:
      "No American should have to choose between going to work and exercising their right to vote...",
    deliveryMethod: "email",
    countryCode: "US",
  },
  {
    slug: "tenant-protection-ordinance",
    title: "Strengthen Tenant Protections",
    description:
      "Call on the Board of Supervisors to pass the tenant anti-harassment ordinance and cap rent increases.",
    category: "housing",
    type: "letter",
    messageBody:
      "Dear Supervisor,\n\nTenants across our city face rising rents and aggressive displacement tactics. I urge you to support the proposed tenant anti-harassment ordinance and strengthen rent increase caps.\n\nProtecting renters is essential to maintaining the diverse, vibrant neighborhoods that make our city great.\n\nRespectfully,\n[Your Name]",
    preview:
      "Tenants across our city face rising rents and aggressive displacement tactics...",
    deliveryMethod: "email",
    countryCode: "US",
  },
  {
    slug: "school-mental-health",
    title: "Fund School Mental Health Counselors",
    description:
      "Advocate for state funding to ensure every public school has at least one licensed mental health counselor.",
    category: "education",
    type: "letter",
    messageBody:
      "Dear [Legislator],\n\nOur students are in crisis. The youth mental health emergency demands a concrete response: at least one licensed mental health counselor in every public school.\n\nI urge you to support full funding for school-based mental health services in the upcoming budget. This investment will save lives and improve educational outcomes.\n\nThank you,\n[Your Name]",
    preview:
      "Our students are in crisis. The youth mental health emergency demands a concrete response...",
    deliveryMethod: "email",
    countryCode: "US",
  },
  {
    slug: "water-infrastructure-modernization",
    title: "Modernize Aging Water Infrastructure",
    description:
      "Support federal investment in replacing lead pipes and upgrading water treatment facilities nationwide.",
    category: "infrastructure",
    type: "letter",
    messageBody:
      "Dear [Representative],\n\nMillions of Americans still drink water that flows through lead pipes. I urge you to support full funding for water infrastructure modernization, including lead pipe replacement, treatment facility upgrades, and stormwater management improvements.\n\nClean water is not a luxury — it is a right.\n\nSincerely,\n[Your Name]",
    preview:
      "Millions of Americans still drink water that flows through lead pipes...",
    deliveryMethod: "email",
    countryCode: "US",
  },
  {
    slug: "police-body-camera-mandate",
    title: "Mandate Body Cameras for All Officers",
    description:
      "Require body-worn cameras with strict retention policies for all law enforcement officers in the state.",
    category: "safety",
    type: "letter",
    messageBody:
      "Dear [Legislator],\n\nTransparency and accountability are essential to public trust in law enforcement. I urge you to support legislation mandating body-worn cameras for all officers, with clear retention policies, public access provisions, and consequences for non-compliance.\n\nThis is a common-sense reform that protects both officers and the public.\n\nThank you,\n[Your Name]",
    preview:
      "Transparency and accountability are essential to public trust in law enforcement...",
    deliveryMethod: "email",
    countryCode: "US",
  },
] as const;

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
    // Guard: skip if data already exists
    const existing = await ctx.runQuery(internal.seed.checkSeeded);
    if (existing) {
      console.log("Database already seeded — skipping.");
      return;
    }

    console.log("[seed] Phase 1: Inserting users...");
    const userIds = await ctx.runMutation(internal.seed.insertUsers);

    console.log("[seed] Phase 2: Inserting organizations + memberships...");
    const orgIds = await ctx.runMutation(internal.seed.insertOrgs);
    await ctx.runMutation(internal.seed.insertMemberships, { userIds, orgIds });

    console.log("[seed] Phase 3: Inserting templates...");
    const templateIds = await ctx.runMutation(internal.seed.insertTemplates, { userIds, orgIds });

    console.log("[seed] Phase 4: Inserting campaigns...");
    const campaignIds = await ctx.runMutation(internal.seed.insertCampaigns, { orgIds, templateIds });

    console.log("[seed] Phase 5: Inserting supporters + tags...");
    const supporterIds = await ctx.runMutation(internal.seed.insertSupporters, { orgIds });
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

    console.log(
      "[seed] Complete! Created 3 users, 3 orgs, 12 templates, 4 campaigns, 20 supporters, " +
      "4 events, 12 donations, 3 workflows, 3 email blasts, 1 network, ~36 contacts, " +
      "5 invites, 4 debates, 12 arguments.",
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
// PHASE 1: INSERT USERS
// =============================================================================

export const insertUsers = internalMutation({
  args: {},
  handler: async (ctx): Promise<Id<"users">[]> => {
    const now = Date.now();
    const ids: Id<"users">[] = [];

    for (let i = 0; i < SEED_USERS.length; i++) {
      const u = SEED_USERS[i];
      const id = await ctx.db.insert("users", {
        tokenIdentifier: u.tokenIdentifier,
        email: u.email,
        name: u.name,
        updatedAt: now,

        // Verification
        isVerified: u.isVerified,
        verificationMethod: u.verificationMethod,
        verifiedAt: u.isVerified ? daysAgo(30) : undefined,

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
        activeMonths: u.isVerified ? 3 : 0,

        // Profile
        profileVisibility: "private",

        // PII placeholders
        encryptedEmail: "",
        emailHash: `seed-user-${i}`,
      });
      ids.push(id);
    }

    return ids;
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
        billingEmail: o.billingEmail,
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

    // Update member counts
    await ctx.db.patch(climate, { memberCount: 3 });
    await ctx.db.patch(voterRights, { memberCount: 2 });
    await ctx.db.patch(localFirst, { memberCount: 2 });
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
        category: t.category,
        type: t.type,
        deliveryMethod: t.deliveryMethod,
        preview: t.preview,
        messageBody: t.messageBody,
        countryCode: t.countryCode,
        deliveryConfig: {},
        recipientConfig: {},
        metrics: { sends: Math.floor(Math.random() * 200), opens: Math.floor(Math.random() * 100), clicks: Math.floor(Math.random() * 50) },
        status: "published",
        isPublic: true,

        // Community metrics
        verifiedSends: Math.floor(Math.random() * 50),
        uniqueDistricts: Math.floor(Math.random() * 15) + 1,

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
        templateId: c.templateIdx >= 0 ? (templateIds[c.templateIdx] as string) : undefined,
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

    // Update campaignCount on orgs (org 0 has 2, others have 1)
    await ctx.db.patch(orgIds[0], { campaignCount: 2 });
    await ctx.db.patch(orgIds[1], { campaignCount: 1 });
    await ctx.db.patch(orgIds[2], { campaignCount: 1 });

    return ids;
  },
});

// =============================================================================
// PHASE 5a: INSERT SUPPORTERS
// =============================================================================

export const insertSupporters = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { orgIds }): Promise<Id<"supporters">[]> => {
    const ids: Id<"supporters">[] = [];

    // Distribute 20 supporters: 8 for org 0, 7 for org 1, 5 for org 2
    const distribution = [8, 7, 5];
    let globalIdx = 0;

    for (let orgIdx = 0; orgIdx < orgIds.length; orgIdx++) {
      const orgId = orgIds[orgIdx];
      const count = distribution[orgIdx];

      for (let i = 0; i < count; i++) {
        const name = SUPPORTER_NAMES[globalIdx % SUPPORTER_NAMES.length];
        const postalCode = POSTAL_CODES[globalIdx % POSTAL_CODES.length];

        const smsStatuses: Array<"none" | "subscribed"> = ["none", "subscribed"];
        const hasSms = globalIdx % 3 === 0;

        const id = await ctx.db.insert("supporters", {
          orgId,
          name,
          postalCode,
          country: "US",
          phone: hasSms ? `+1555${String(globalIdx).padStart(7, "0")}` : undefined,
          encryptedEmail: "",
          emailHash: `seed-supporter-${globalIdx}`,
          verified: globalIdx % 4 !== 3, // 75% verified
          emailStatus: "subscribed",
          smsStatus: hasSms ? smsStatuses[1] : smsStatuses[0],
          source: globalIdx % 5 === 0 ? "csv" : "organic",
          updatedAt: daysAgo(globalIdx + 1),
        });
        ids.push(id);
        globalIdx++;
      }

      await ctx.db.patch(orgId, {
        supporterCount: count,
        onboardingState: {
          hasDescription: true,
          hasIssueDomains: false,
          hasSupporters: true,
          hasCampaigns: true,
          hasTeam: true,
          hasSentEmail: orgIdx === 0, // org 0 has a completed email blast
        },
      });
    }

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
      cachedCount: 5,
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
      cachedCount: 4,
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
        rsvpCount: 42,
        attendeeCount: 0,
        verifiedAttendees: 0,
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
        rsvpCount: 18,
        attendeeCount: 0,
        verifiedAttendees: 0,
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
        rsvpCount: 85,
        attendeeCount: 0,
        verifiedAttendees: 0,
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
        rsvpCount: 67,
        attendeeCount: 51,
        verifiedAttendees: 38,
      },
    ];

    for (const e of eventDefs) {
      const id = await ctx.db.insert("events", {
        orgId: orgIds[e.orgIdx],
        campaignId: campaignIds[e.campaignIdx],
        title: e.title,
        description: e.description,
        eventType: e.eventType,
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
        rsvpCount: e.rsvpCount,
        attendeeCount: e.attendeeCount,
        verifiedAttendees: e.verifiedAttendees,
        checkinCode: `CHK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        requireVerification: false,
        status: e.status,
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

    // RSVPs for the completed webinar (event 3) — with attendance data
    const completedEventId = eventIds[3];
    for (let i = 0; i < 6; i++) {
      const supporterId = supporterIds[i % supporterIds.length];
      const isCheckedIn = i < 4;
      await ctx.db.insert("eventRsvps", {
        eventId: completedEventId,
        supporterId,
        encryptedEmail: "",
        emailHash: `seed-rsvp-completed-${i}`,
        name: SUPPORTER_NAMES[i % SUPPORTER_NAMES.length],
        status: "GOING",
        guestCount: 1,
        engagementTier: i < 3 ? 2 : 1,
        updatedAt: daysAgo(4),
        // Attendance data for completed event
        checkedInAt: isCheckedIn ? daysAgo(3) : undefined,
        attendanceVerified: isCheckedIn ? i < 3 : undefined,
        attendanceVerificationMethod: isCheckedIn && i < 3 ? "checkin_code" : undefined,
      });
    }

    // RSVPs for future events
    for (let eIdx = 0; eIdx < 3; eIdx++) {
      const eventId = eventIds[eIdx];
      const rsvpCount = [5, 4, 6][eIdx];
      for (let i = 0; i < rsvpCount; i++) {
        const sIdx = (eIdx * 5 + i) % supporterIds.length;
        await ctx.db.insert("eventRsvps", {
          eventId,
          supporterId: supporterIds[sIdx],
          encryptedEmail: "",
          emailHash: `seed-rsvp-${eIdx}-${i}`,
          name: SUPPORTER_NAMES[sIdx % SUPPORTER_NAMES.length],
          status: statuses[i % statuses.length],
          guestCount: i % 3 === 0 ? 2 : 1,
          engagementTier: i < 2 ? 2 : 1,
          updatedAt: now,
        });
      }
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
      { orgIdx: 0, campaignIdx: 3, sIdx: 0, amount: 5000, recurring: false, status: "completed", daysAgoN: 10 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 1, amount: 2500, recurring: true, status: "completed", daysAgoN: 8 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 2, amount: 10000, recurring: false, status: "completed", daysAgoN: 7 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 3, amount: 25000, recurring: false, status: "completed", daysAgoN: 5 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 4, amount: 7500, recurring: true, status: "completed", daysAgoN: 3 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 5, amount: 50000, recurring: false, status: "completed", daysAgoN: 2 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 6, amount: 15000, recurring: false, status: "completed", daysAgoN: 1 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 7, amount: 10000, recurring: false, status: "completed", daysAgoN: 1 },
      // Pending / failed
      { orgIdx: 0, campaignIdx: 3, sIdx: 0, amount: 3000, recurring: false, status: "pending", daysAgoN: 0 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 1, amount: 1500, recurring: false, status: "failed", daysAgoN: 6 },
      // Other orgs (via their letter campaigns)
      { orgIdx: 1, campaignIdx: 1, sIdx: 9, amount: 2000, recurring: false, status: "completed", daysAgoN: 12 },
      { orgIdx: 2, campaignIdx: 2, sIdx: 16, amount: 5000, recurring: true, status: "completed", daysAgoN: 9 },
    ];

    for (const d of donationDefs) {
      const supporterId = supporterIds[d.sIdx % supporterIds.length];
      const supporterName = SUPPORTER_NAMES[d.sIdx % SUPPORTER_NAMES.length];

      await ctx.db.insert("donations", {
        orgId: orgIds[d.orgIdx],
        campaignId: campaignIds[d.campaignIdx],
        supporterId,
        email: `${supporterName.toLowerCase().replace(/[^a-z]/g, "")}@example.com`,
        name: supporterName,
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
      { wfIdx: 0, sIdx: 0, status: "completed", currentStep: 2, completedDaysAgo: 5 },
      { wfIdx: 0, sIdx: 1, status: "completed", currentStep: 2, completedDaysAgo: 3 },
      { wfIdx: 0, sIdx: 2, status: "running", currentStep: 1, completedDaysAgo: null },
      // Donor Thank You — 1 completed
      { wfIdx: 1, sIdx: 3, status: "completed", currentStep: 1, completedDaysAgo: 2 },
      // Event Follow-up — 1 pending
      { wfIdx: 2, sIdx: 8, status: "pending", currentStep: 0, completedDaysAgo: null },
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
      campaignId: campaignIds[0] as unknown as string,
      subject: "Urgent: Clean Energy Act Needs Your Voice This Week",
      bodyHtml: `<h1>The Clean Energy Investment Act</h1><p>Dear supporter,</p><p>The committee vote on the Clean Energy Investment Act is scheduled for next week. We need every voice counted. <a href="https://commons.email/act/clean-energy">Take action now</a>.</p><p>Together we can make a difference.</p><p>— Climate Action Now</p>`,
      fromName: "Climate Action Now",
      fromEmail: "action@climateactionnow.org",
      status: "sent",
      recipientFilter: { tags: ["volunteer", "donor"], emailStatus: "subscribed" },
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
      campaignId: campaignIds[1] as unknown as string,
      subject: "Registration Deadline Approaching — Spread the Word",
      bodyHtml: `<h1>Voter Registration Deadline</h1><p>Time is running out. Help us reach every eligible voter before the registration deadline closes. <a href="https://commons.email/act/voter-reg">Share our campaign</a>.</p><p>— Voter Rights Coalition</p>`,
      fromName: "Voter Rights Coalition",
      fromEmail: "outreach@voterrightscoalition.org",
      status: "sending",
      recipientFilter: { emailStatus: "subscribed" },
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

    for (const inv of inviteDefs) {
      await ctx.db.insert("orgInvites", {
        orgId: orgIds[inv.orgIdx],
        role: inv.role,
        token: inv.token,
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

    for (const lc of letterCampaigns) {
      let actionCountTotal = 0;
      let verifiedCountTotal = 0;

      for (let i = 0; i < lc.supporterCount; i++) {
        const sIdx = (lc.supporterStart + i) % supporterIds.length;
        const isVerified = i % 4 !== 3; // 75% verified

        const actionId = await ctx.db.insert("campaignActions", {
          campaignId: campaignIds[lc.campaignIdx],
          supporterId: supporterIds[sIdx],
          verified: isVerified,
          engagementTier: isVerified ? 2 : 1,
          districtHash: `district-hash-${sIdx}`,
          delegated: false,
          sentAt: daysAgo(i + 1),
        });
        actionCountTotal++;
        if (isVerified) verifiedCountTotal++;

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

    const debateDefs = [
      {
        templateIdx: 0,
        status: "resolved",
        deadline: daysAgo(7),
        argumentCount: 4,
        uniqueParticipants: 4,
        totalStake: 400,
        winningStance: "SUPPORT",
        winningArgumentIndex: 0,
        resolvedAt: daysAgo(7),
        marketStatus: "resolved",
      },
      {
        templateIdx: 1,
        status: "active",
        deadline: daysFromNow(14),
        argumentCount: 3,
        uniqueParticipants: 3,
        totalStake: 250,
        winningStance: undefined,
        winningArgumentIndex: undefined,
        resolvedAt: undefined,
        marketStatus: "active",
      },
      {
        templateIdx: 3,
        status: "awaiting_governance",
        deadline: daysAgo(1),
        argumentCount: 3,
        uniqueParticipants: 3,
        totalStake: 300,
        winningStance: undefined,
        winningArgumentIndex: undefined,
        resolvedAt: undefined,
        marketStatus: "active",
      },
      {
        templateIdx: 4,
        status: "under_appeal",
        deadline: daysAgo(3),
        argumentCount: 2,
        uniqueParticipants: 2,
        totalStake: 200,
        winningStance: "OPPOSE",
        winningArgumentIndex: 1,
        resolvedAt: daysAgo(3),
        marketStatus: "resolved",
      },
    ];

    for (let dIdx = 0; dIdx < debateDefs.length; dIdx++) {
      const d = debateDefs[dIdx];
      const debateId = await ctx.db.insert("debates", {
        templateId: templateIds[d.templateIdx],
        debateIdOnchain: `debate-onchain-${dIdx}`,
        actionDomain: "commons-debate-v1",
        propositionHash: `prop-hash-${dIdx}`,
        propositionText: `Should the ${SEED_TEMPLATES[d.templateIdx].title} be adopted as a community priority?`,
        deadline: d.deadline,
        jurisdictionSize: 50000,
        status: d.status,
        argumentCount: d.argumentCount,
        uniqueParticipants: d.uniqueParticipants,
        totalStake: d.totalStake,
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

      // Insert arguments for each debate
      const argumentDefs = [
        { stance: "SUPPORT", body: "This proposal addresses a critical need and has broad community backing. The evidence supports immediate action.", stakeAmount: 100 },
        { stance: "OPPOSE", body: "While the intent is good, the implementation details are insufficient. We need more specific language before committing resources.", stakeAmount: 80 },
        { stance: "AMEND", body: "The core proposal is sound but should include sunset provisions and measurable benchmarks for success.", stakeAmount: 60 },
        { stance: "SUPPORT", body: "Strong precedent from other jurisdictions shows this approach works. We should move forward decisively.", stakeAmount: 50 },
      ];

      const argCount = d.argumentCount;
      for (let aIdx = 0; aIdx < argCount; aIdx++) {
        const a = argumentDefs[aIdx % argumentDefs.length];
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
    }
  },
});

// =============================================================================
// PHASE 16: GRANT DEV ACCOUNT ACCESS
// =============================================================================

export const grantDevAccount = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { orgIds }) => {
    // Check if dev account exists
    const devUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "mock7ee@gmail.com"))
      .first();

    if (!devUser) {
      console.log("[seed] Dev account mock7ee@gmail.com not found — skipping dev grants.");
      return;
    }

    console.log("[seed] Found dev account — granting owner on all seeded orgs.");
    const now = Date.now();

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
// NOTE: Onboarding state is set in insertSupporters (hasSentEmail: true for
// org[0] which has a completed email blast). The insertSupporters mutation
// runs before insertEmailBlasts in the seedAll orchestrator.
// =============================================================================

// =============================================================================
// CLEAR SEED — wipe all seeded data so seedAll can re-run
// =============================================================================

const SEED_TABLES = [
  "debateArguments", "debates", "campaignDeliveries", "campaignActions",
  "orgInvites", "orgResolvedContacts", "orgNetworkMembers", "orgNetworks",
  "emailEvents", "emailBlasts", "workflowActionLogs", "workflowExecutions",
  "workflows", "donations", "eventRsvps", "events", "segments",
  "supporterTags", "tags", "supporters", "campaigns", "templateEndorsements",
  "templates", "orgMemberships", "organizations", "sessions", "accounts", "users",
] as const;

export const clearSeed = internalAction({
  args: {},
  handler: async (ctx) => {
    for (const table of SEED_TABLES) {
      await ctx.runMutation(internal.seed.clearTable, { table });
    }
    console.log("[seed] All seed data cleared.");
  },
});

export const clearTable = internalMutation({
  args: { table: v.string() },
  handler: async (ctx, { table }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docs = await (ctx.db as any).query(table).collect();
    let count = 0;
    for (const doc of docs) {
      await ctx.db.delete(doc._id);
      count++;
    }
    if (count > 0) console.log(`  Cleared ${count} ${table}`);
  },
});
