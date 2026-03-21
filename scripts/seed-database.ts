/**
 * Static Database Seed Script
 *
 * Seeds the database with pre-resolved template data from the agent pipeline.
 * No API keys needed -- all content is embedded directly.
 *
 * Generated: 2026-03-01T02:03:07.933Z
 * Source: seed-data-dump.json (from seed-with-agents.ts run)
 *
 * Usage:
 *   npx tsx scripts/seed-database.ts
 *
 * Required env vars:
 *   DATABASE_URL  - Database connection string (defaults to local via .env)
 */

import 'dotenv/config';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import type { InputJsonValue } from '@prisma/client/runtime/library';
import { keccak256, toUtf8Bytes } from 'ethers';

const db = new PrismaClient();

// ============================================================================
// SNAPSHOT — machine-readable pipeline output from seed-with-agents.ts
// ============================================================================
// When present, seed-snapshot.json contains the REAL recipient_config produced
// by the full agent pipeline (Phase 1-4), keyed by template slug.
// This is the single source of truth — processSeedRecipientConfig() is the
// fallback for templates not in the snapshot.

const SNAPSHOT_PATH = join(import.meta.dirname ?? '.', 'seed-snapshot.json');
const snapshot: Record<string, Record<string, unknown>> = existsSync(SNAPSHOT_PATH)
	? JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'))
	: {};

if (Object.keys(snapshot).length > 0) {
	console.log(`Loaded snapshot: ${Object.keys(snapshot).length} templates from seed-snapshot.json`);
} else {
	console.log('No seed-snapshot.json found — using inline fallback data');
}

// ============================================================================
// SEED DM TRANSFORM — map simplified seed format → ProcessedDecisionMaker
// ============================================================================
//
// Seed data uses a compact format: { name, role, email, shortName, organization }
// The UI expects ProcessedDecisionMaker with: title, roleCategory, relevanceRank,
// accountabilityOpener, publicActions, isAiResolved, provenance, reasoning, etc.
//
// This function bridges the gap so seed templates render identically to
// agent-pipeline-generated templates.

type RoleCategory = 'votes' | 'executes' | 'shapes' | 'funds' | 'oversees';

interface SeedDM {
	name: string;
	role: string;
	email: string;
	shortName: string;
	organization: string;
}

/** Infer functional role from title keywords */
function inferRoleCategory(title: string, org: string): RoleCategory {
	const t = title.toLowerCase();
	const o = org.toLowerCase();

	// 1. Staff & procedural roles → shapes (must check FIRST to prevent false matches)
	if (/\b(clerk|legislative director|staff|coordinator)\b/.test(t))
		return 'shapes';

	// 2. Oversight → they oversee
	if (/\b(inspector|auditor|ombuds|oversight|watchdog|accountability)\b/.test(t))
		return 'oversees';

	// 3. Ministers are always executive — even "Minister of Finance"
	if (/\b(minister|deputy minister|premier|governor|mayor|secretary of (?:state|homeland)|attorney|assistant secretary|president of the treasury)\b/.test(t))
		return 'executes';

	// 4. Legislators: committee chairs, supervisors, elected members → they vote
	if (/\b(senator|representative|supervisor|district \d|chair.*(?:committee|commission)|vice.?chair.*(?:committee|commission)|member.*(?:committee|commission)|speaker|president.*board|president.*(?:senate|assembly)|majority|minority|whip)\b/.test(t))
		return 'votes';
	// Bare "Chair"/"Vice-Chair" title with commission/committee/board org
	if (/^(vice.?)?chair(man|woman|person)?$/i.test(t.trim())
		&& /\b(committee|commission|board|council)\b/.test(o))
		return 'votes';
	// Org-based vote inference: people IN legislative bodies who aren't staff
	if (/\b(board of supervisors|city council|house of commons|congress(?!ional)|parliament(?!ary)|senate|legislature|legislative assembly)\b/.test(o)
		&& !/\b(director|clerk|secretary|staff|advisor|counsel|analyst)\b/.test(t))
		return 'votes';

	// 5. Finance/budget → they fund
	if (/\b(treasurer|budget|appropriation|comptroller|controller|tax collector|chief.?financial|cfo|secretary-treasurer)\b/i.test(t))
		return 'funds';

	// 6. Executives → they execute (directors, chiefs, presidents, CEOs)
	if (/\b(executive director|director|administrator|commissioner|chief|president|ceo)\b/.test(t))
		return 'executes';

	// 7. Media, policy, communications → they shape
	if (/\b(editor|reporter|journalist|columnist|writer|opinion|editorial|advocate|organizer|communications|policy|advisor|counsel|liaison|lobbyist|researcher|analyst|media)\b/.test(t))
		return 'shapes';

	return 'shapes';
}

/** Assign relevance rank by category (1 = most direct power) */
function inferRelevanceRank(category: RoleCategory, title: string): number {
	const t = title.toLowerCase();
	const isChair = /\b(chair|president|speaker|leader|whip)\b/.test(t);

	switch (category) {
		case 'votes': return isChair ? 5 : 15;
		case 'executes': return /\b(mayor|governor|minister)\b/.test(t) ? 3 : 10;
		case 'funds': return /\b(treasurer|comptroller)\b/.test(t) ? 8 : 20;
		case 'oversees': return 25;
		case 'shapes': return /\b(editor|director)\b/.test(t) ? 30 : 40;
	}
}

/** Transform seed recipient_config: rename role→title, add Phase 4 fields */
function processSeedRecipientConfig(config: Record<string, unknown>): Record<string, unknown> {
	if (!config || !Array.isArray(config.decisionMakers)) return config;

	const processed = (config.decisionMakers as SeedDM[])
		.filter((dm) => dm.email && dm.email.includes('@'))
		.map((dm) => {
			const title = dm.role; // Seed uses "role", pipeline uses "title"
			const category = inferRoleCategory(title, dm.organization);
			const rank = inferRelevanceRank(category, title);

			return {
				name: dm.name,
				title,
				organization: dm.organization,
				email: dm.email,
				provenance: 'Seed data — pre-resolved from agent pipeline output',
				reasoning: `${title} at ${dm.organization}`,
				isAiResolved: true,
				roleCategory: category,
				relevanceRank: rank,
				accountabilityOpener: null, // Phase 4 runs live for real templates
				publicActions: [],
			};
		});

	return { ...config, decisionMakers: processed };
}

// ============================================================================
// TEARDOWN -- dependency order
// ============================================================================

async function teardownDatabase() {
	console.log('Starting complete database teardown...');

	const deletions = [
		{ name: 'agent_trace', fn: () => db.agentTrace.deleteMany({}) },
		{ name: 'submission_retry', fn: () => db.submissionRetry.deleteMany({}) },
		{ name: 'verification_audit', fn: () => db.verificationAudit.deleteMany({}) },
		{ name: 'shadow_atlas_registration', fn: () => db.shadowAtlasRegistration.deleteMany({}) },
		{ name: 'position_delivery', fn: () => db.positionDelivery.deleteMany({}) },
		{ name: 'position_registration', fn: () => db.positionRegistration.deleteMany({}) },
		{ name: 'debate_nullifier', fn: () => db.debateNullifier.deleteMany({}) },
		{ name: 'debate_argument', fn: () => db.debateArgument.deleteMany({}) },
		{ name: 'debate', fn: () => db.debate.deleteMany({}) },
		{ name: 'resolved_contact', fn: () => db.resolvedContact.deleteMany({}) },
		{ name: 'parsed_document_cache', fn: () => db.parsedDocumentCache.deleteMany({}) },
		{ name: 'intelligence', fn: () => db.intelligence.deleteMany({}) },
		{ name: 'rate_limit', fn: () => db.rateLimit.deleteMany({}) },
		{ name: 'district_credential', fn: () => db.districtCredential.deleteMany({}) },
		{ name: 'verification_session', fn: () => db.verificationSession.deleteMany({}) },
		{ name: 'submission', fn: () => db.submission.deleteMany({}) },
		{ name: 'encrypted_delivery_data', fn: () => db.encryptedDeliveryData.deleteMany({}) },
		{ name: 'privacy_budget', fn: () => db.privacy_budget.deleteMany({}) },
		{ name: 'analytics_snapshot', fn: () => db.analytics_snapshot.deleteMany({}) },
		{ name: 'analytics_aggregate', fn: () => db.analytics_aggregate.deleteMany({}) },
		{ name: 'user_dm_relation', fn: () => db.userDMRelation.deleteMany({}) },
		{ name: 'org_dm_follow', fn: () => db.orgDMFollow.deleteMany({}) },
		{ name: 'external_id', fn: () => db.externalId.deleteMany({}) },
		{ name: 'decision_maker', fn: () => db.decisionMaker.deleteMany({}) },
		{ name: 'legislative_channel', fn: () => db.legislative_channel.deleteMany({}) },
		{ name: 'template_campaign', fn: () => db.template_campaign.deleteMany({}) },
		{ name: 'template_jurisdiction', fn: () => db.templateJurisdiction.deleteMany({}) },
		{ name: 'template_scope', fn: () => db.templateScope.deleteMany({}) },
		{ name: 'message', fn: () => db.message.deleteMany({}) },
		{ name: 'template', fn: () => db.template.deleteMany({}) },
		{ name: 'session', fn: () => db.session.deleteMany({}) },
		{ name: 'account', fn: () => db.account.deleteMany({}) },
		{ name: 'user', fn: () => db.user.deleteMany({}) },
	];

	for (const { name, fn } of deletions) {
		try {
			const result = await fn();
			if (result.count > 0) {
				console.log(`  Deleted ${result.count} ${name} records`);
			}
		} catch {
			console.log(`  Skipped ${name} (table may not exist)`);
		}
	}

	console.log('Database teardown complete\n');
}

// ============================================================================

// ============================================================================

// ============================================================================
// SEED DATA -- Users
// ============================================================================

const USERS = [
	{
		id: "user-seed-1",
		email: "seed-1@commons.email",
		name: "Alex Rivera",
		avatar: null,
		createdAt: "2026-03-01T00:54:55.527Z",
		updatedAt: "2026-03-01T00:54:55.527Z",
		is_verified: true,
		verification_method: "mdl",
		verification_data: null,
		verified_at: "2026-03-01T00:54:23.130Z",
		identity_hash: null,
		identity_fingerprint: null,
		birth_year: 1992,
		identity_commitment: null,
		document_type: "drivers_license",
		encrypted_entropy: null,
		authority_level: 3,
		trust_tier: 1,
		passkey_credential_id: null,
		passkey_public_key_jwk: null,
		did_key: null,
		passkey_created_at: null,
		passkey_last_used_at: null,
		address_verification_method: null,
		address_verified_at: null,
		wallet_address: null,
		wallet_type: null,
		district_hash: null,
		near_account_id: null,
		near_public_key: null,
		encrypted_near_private_key: null,
		near_recovery_public_key: null,
		near_derived_scroll_address: null,
		trust_score: 85,
		reputation_tier: "verified",
		district_verified: false,
		templates_contributed: 0,
		template_adoption_rate: 0,
		peer_endorsements: 0,
		active_months: 0,
		role: null,
		organization: null,
		location: "Denver, CO",
		connection: null,
		profile_completed_at: "2026-03-01T00:54:23.130Z",
		profile_visibility: "public"
	},
	{
		id: "user-seed-2",
		email: "seed-2@commons.email",
		name: "Jordan Chen",
		avatar: null,
		createdAt: "2026-03-01T00:54:56.219Z",
		updatedAt: "2026-03-01T00:54:56.219Z",
		is_verified: true,
		verification_method: "mdl",
		verification_data: null,
		verified_at: "2026-03-01T00:54:23.130Z",
		identity_hash: null,
		identity_fingerprint: null,
		birth_year: 1988,
		identity_commitment: null,
		document_type: "drivers_license",
		encrypted_entropy: null,
		authority_level: 3,
		trust_tier: 1,
		passkey_credential_id: null,
		passkey_public_key_jwk: null,
		did_key: null,
		passkey_created_at: null,
		passkey_last_used_at: null,
		address_verification_method: null,
		address_verified_at: null,
		wallet_address: null,
		wallet_type: null,
		district_hash: null,
		near_account_id: null,
		near_public_key: null,
		encrypted_near_private_key: null,
		near_recovery_public_key: null,
		near_derived_scroll_address: null,
		trust_score: 72,
		reputation_tier: "verified",
		district_verified: false,
		templates_contributed: 0,
		template_adoption_rate: 0,
		peer_endorsements: 0,
		active_months: 0,
		role: null,
		organization: null,
		location: "Toronto, ON",
		connection: null,
		profile_completed_at: "2026-03-01T00:54:23.130Z",
		profile_visibility: "public"
	},
	{
		id: "user-seed-3",
		email: "seed-3@commons.email",
		name: "Morgan Tremblay",
		avatar: null,
		createdAt: "2026-03-01T00:54:56.977Z",
		updatedAt: "2026-03-01T00:54:56.977Z",
		is_verified: false,
		verification_method: null,
		verification_data: null,
		verified_at: null,
		identity_hash: null,
		identity_fingerprint: null,
		birth_year: null,
		identity_commitment: null,
		document_type: null,
		encrypted_entropy: null,
		authority_level: 1,
		trust_tier: 1,
		passkey_credential_id: null,
		passkey_public_key_jwk: null,
		did_key: null,
		passkey_created_at: null,
		passkey_last_used_at: null,
		address_verification_method: null,
		address_verified_at: null,
		wallet_address: null,
		wallet_type: null,
		district_hash: null,
		near_account_id: null,
		near_public_key: null,
		encrypted_near_private_key: null,
		near_recovery_public_key: null,
		near_derived_scroll_address: null,
		trust_score: 0,
		reputation_tier: "novice",
		district_verified: false,
		templates_contributed: 0,
		template_adoption_rate: 0,
		peer_endorsements: 0,
		active_months: 0,
		role: null,
		organization: null,
		location: null,
		connection: null,
		profile_completed_at: null,
		profile_visibility: "private"
	}
];

// ============================================================================
// SEED DATA -- Templates
// ============================================================================

const TEMPLATES = [
	{
		id: "cmm71jjk4000hw9j8j2fi57w3",
		slug: "va-rural-health-lifeline",
		title: "A lifeline for veterans where the pavement ends",
		description: "The Department of Veterans Affairs must expand its proven telehealth infrastructure to reach every rural clinic across the nation.",
		category: "Healthcare",
		topics: ["veterans", "healthcare", "telehealth", "rural-access"],
		type: "advocacy",
		deliveryMethod: "cwc",
		preview: "For a veteran living hours from the nearest specialist, a \"proven\" healthcare system doesn't mean much if it doesn't reach their front door. We are past the point of testing pilot programs; we know th",
		message_body: "For a veteran living hours from the nearest specialist, a \"proven\" healthcare system doesn't mean much if it doesn't reach their front door. We are past the point of testing pilot programs; we know that when the VA bridges the distance, veterans live longer. New findings released just this week show that veterans receiving specialty care via telemedicine had a 15% lower mortality rate than those who relied on primary care alone [1].\n\n[Personal Connection]\n\nThe infrastructure to solve this already exists. The VA’s Clinical Resource Hub model has demonstrated it can increase healthcare utilization by 18% in underserved areas by bringing specialists to the veteran [3]. For those in communities where home broadband isn't an option, the ATLAS (Accessing Telehealth through Local Area Stations) program is the only bridge to the care they earned, provided it is actually deployed where it’s needed [2].\n\nI am asking you to fully fund and scale this hub-and-spoke infrastructure to every rural clinic in the country. It is time to ensure that access isn't a privilege of geography, but a guarantee of service. Please prioritize the expansion of ATLAS and Clinical Resource Hubs to ensure that no veteran is left behind just because they live where the pavement ends.\n\n[Name]",
		sources: [
			{
				num: 1,
				url: "https://news.va.gov/",
				type: "research",
				title: "VA Research Wrap Up: New findings on telehealth, Parkinson's disease and military transitions"
			},
			{
				num: 2,
				url: "https://www.gao.gov/products/gao-24-106743",
				type: "government",
				title: "Veterans Health Care: VA's Video Telehealth Access Program Would Benefit from Performance Goals and Measures"
			},
			{
				num: 3,
				url: "https://pubmed.ncbi.nlm.nih.gov/40981648/",
				type: "research",
				title: "Impact of VA's Clinical Resource Hub Primary Care Telehealth Program on Health Care Use and Costs"
			}
		],
		research_log: [
			"VA telehealth expansion rural clinics 2026 government reports",
			"VA Office of Rural Health telehealth initiatives 2025 2026",
			"GAO report VA telehealth rural access 2025",
			"impact of VA telehealth on rural veteran health outcomes research 2026",
			"VA infrastructure modernization funding FY2026 telehealth"
		],
		delivery_config: {
			timing: "immediate",
			followUp: true,
			cwcEnabled: true
		},
		cwc_config: {
			topic: "veterans",
			urgency: "high",
			policy_area: "Healthcare"
		},
		recipient_config: {
			reach: "district-based",
			chambers: ["house", "senate"],
			cwcRouting: true
		},
		metrics: {
			sent: 0,
			opened: 0,
			clicked: 0,
			responded: 0,
			total_districts: 435,
			districts_covered: 0,
			district_coverage_percent: 0
		},
		campaign_id: null,
		status: "published",
		is_public: true,
		verified_sends: 0,
		unique_districts: 0,
		avg_reputation: null,
		embedding_version: "v1",
		embeddings_updated_at: null,
		verification_status: "approved",
		country_code: "US",
		reviewed_at: null,
		reviewed_by: null,
		flagged_by_moderation: false,
		consensus_approved: true,
		reputation_delta: 0,
		reputation_applied: false,
		content_hash: "3b320713ce49c3f0fff6d5b2db51dd2576615ce9",
		createdAt: "2026-03-01T00:57:56.165Z",
		updatedAt: "2026-03-01T03:44:49.023Z",
		userId: "user-seed-1"
	},
	{
		id: "cmm71m52p000vw9j8h7xq9tml",
		slug: "congress-outdated-childhood-tracking",
		title: "Your laws are older than our children",
		description: "The United States Congress must stop corporations from strip-mining the digital lives of children through obsolete privacy protections.",
		category: "Digital Rights",
		topics: ["privacy", "children", "technology", "accountability", "congress"],
		type: "advocacy",
		deliveryMethod: "cwc",
		preview: "The law meant to protect our children online was written in 1998. It is literally older than the kids it is failing to protect. While technology has evolved to harvest 72 million data points per child",
		message_body: "The law meant to protect our children online was written in 1998. It is literally older than the kids it is failing to protect. While technology has evolved to harvest 72 million data points per child every year, our federal protections remain frozen in a pre-smartphone era.\n\n[Personal Connection]\n\nWe are currently witnessing a mental health crisis where 37% of students report moderate to severe depressive symptoms [4]. Despite this, national safety legislation like the Kids Online Safety Act (KOSA) and COPPA 2.0 remains stalled in Congress [5]. We cannot afford to let these protections languish while landmark litigation continues to reveal exactly how much tech companies knew about the risks their products posed to our children [5].\n\nWhile I appreciate the FTC’s recent efforts to modernize enforcement and address emerging data monetization [1][3], administrative rule-making is not a substitute for legislative action. We need a permanent, modern standard that raises the age of coverage to 17, prohibits targeted advertising to minors, and provides an 'eraser button' for data deletion [2].\n\nI am asking you to break the deadlock and pass the revised Kids Online Safety Act and COPPA 2.0 immediately. Our children’s digital lives should not be governed by laws written before they—or the platforms they use—even existed.\n\n[Name]",
		sources: [
			{
				num: 1,
				url: "https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data",
				type: "government",
				title: "FTC Finalizes Changes to Children’s Privacy Rule Limiting Companies’ Ability to Monetize Kids’ Data"
			},
			{
				num: 2,
				url: "https://www.dwt.com/insights/2026/01/federal-online-safety-legislation-hits-congress",
				type: "legal",
				title: "Wave of Federal \"Online Safety\" Legislation Hits Congress"
			},
			{
				num: 3,
				url: "https://www.wiley.law/alert-FTC-Announces-COPPA-Policy-Enforcement-Statement-Forthcoming-Rule-Review",
				type: "legal",
				title: "FTC Announces COPPA Policy Enforcement Statement, Forthcoming Rule Review"
			},
			{
				num: 4,
				url: "https://healthpolicy.ucla.edu/our-work/publications/healthy-minds-study-2024-2025-data-report",
				type: "research",
				title: "The Healthy Minds Study: 2024–2025 Data Report"
			},
			{
				num: 5,
				url: "https://www.childrenandscreens.org/newsroom/news/policy-update-february-2026/",
				type: "advocacy",
				title: "Policy Update: February 2026 - Children and Screens"
			}
		],
		research_log: [
			"US Congress children's digital privacy legislation 2026 status",
			"FTC COPPA Rule update 2025 2026 official report",
			"Kids Online Safety Act KOSA latest developments 2026",
			"Children and Teens Online Privacy Protection Act COPPA 2.0 2026 update",
			"academic research corporate data collection children's mental health 2024 2025",
			"Surgeon General advisory digital media and youth mental health 2025 update"
		],
		delivery_config: {
			timing: "immediate",
			followUp: true,
			cwcEnabled: true
		},
		cwc_config: {
			topic: "privacy",
			urgency: "high",
			policy_area: "Digital Rights"
		},
		recipient_config: {
			reach: "district-based",
			chambers: ["house", "senate"],
			cwcRouting: true
		},
		metrics: {
			sent: 0,
			views: 1,
			opened: 0,
			clicked: 0,
			responded: 0,
			total_districts: 435,
			districts_covered: 0,
			district_coverage_percent: 0
		},
		campaign_id: null,
		status: "published",
		is_public: true,
		verified_sends: 0,
		unique_districts: 0,
		avg_reputation: null,
		embedding_version: "v1",
		embeddings_updated_at: null,
		verification_status: "approved",
		country_code: "US",
		reviewed_at: null,
		reviewed_by: null,
		flagged_by_moderation: false,
		consensus_approved: true,
		reputation_delta: 0,
		reputation_applied: false,
		content_hash: "ed7b60b218f803c1d88da02effac41310e6b98e9",
		createdAt: "2026-03-01T00:59:57.361Z",
		updatedAt: "2026-03-01T03:44:49.907Z",
		userId: "user-seed-1"
	},
	{
		id: "cmm71r36p001dw9j86xvo45gl",
		slug: "colorado-preschool-standard",
		title: "Stop leaving our toddlers behind while Colorado families thrive",
		description: "State Legislatures must follow the lead of Colorado's universal preschool program to give our children the start they are currently being denied.",
		category: "Education",
		topics: ["childcare", "preschool", "state-government", "parenting", "future"],
		type: "advocacy",
		deliveryMethod: "cwc",
		preview: "It is exhausting to watch families in neighboring states get a head start while we are left to navigate the impossible math of childcare on our own. We have reached a point where the success of progra",
		message_body: "It is exhausting to watch families in neighboring states get a head start while we are left to navigate the impossible math of childcare on our own. We have reached a point where the success of programs like Colorado’s makes our own state’s inaction look like a choice to leave families behind. In its first year alone, Colorado’s universal preschool program reached nearly 70% of eligible four-year-olds and saved families an average of $6,100 [1].\n\n[Personal Connection]\n\nThis isn't just about a classroom; it is about the literal economic survival of our households. Research shows that universal enrollment can increase parent income by over 21%, effectively paying for itself through higher tax revenue and workforce participation [4]. As 2026 legislative sessions begin, other states are already recognizing that pre-K is \"economic infrastructure\" essential for long-term competitiveness [2]. Some, like New Mexico, have even expanded this to include infants and toddlers, saving families up to $12,000 a year [3].\n\nEvery day we wait is a day our children lose a foundation that others are getting for free. I am asking you to treat early childhood education as the essential infrastructure it is. Please move to replicate these successful universal models and provide the funding necessary to ensure our families are no longer denied this basic opportunity for growth.\n\n[Name]",
		sources: [
			{
				num: 1,
				url: "https://www.colorado.gov/governor/news/new-report-highlights-transformational-first-year-colorado-universal-preschool-reaching-nearly",
				type: "government",
				title: "New Report Highlights Transformational First Year of Colorado Universal Preschool, Reaching Nearly 70% of Eligible Four-Year-Olds"
			},
			{
				num: 2,
				url: "https://whiteboardadvisors.com/early-childhood-in-2026-what-state-signals-tell-us-about-where-policy-is-heading/",
				type: "research",
				title: "Early Childhood in 2026: What State Signals Tell Us About Where Policy Is Heading"
			},
			{
				num: 3,
				url: "https://www.governor.state.nm.us/2025/09/08/new-mexico-is-first-state-in-nation-to-offer-universal-child-care/",
				type: "government",
				title: "New Mexico is first state in nation to offer universal child care"
			},
			{
				num: 4,
				url: "https://www.ffyf.org/2025/08/06/research-finds-preschool-enrollment-can-increase-parent-income/",
				type: "research",
				title: "Research Finds Preschool Enrollment Can Increase Parent Income"
			}
		],
		research_log: [
			"Colorado Universal Preschool program impact report 2025 2026",
			"state legislatures universal preschool legislation 2026 developments",
			"Colorado Department of Early Childhood UPK annual report 2025",
			"benefits of universal preschool for toddlers research 2025",
			"New Mexico universal child care 2026 budget",
			"Hawaii Preschool Open Doors expansion 2-year-olds 2026"
		],
		delivery_config: {
			timing: "immediate",
			followUp: true,
			cwcEnabled: true
		},
		cwc_config: {
			topic: "childcare",
			urgency: "high",
			policy_area: "Education"
		},
		recipient_config: {
			reach: "district-based",
			chambers: ["house", "senate"],
			cwcRouting: true
		},
		metrics: {
			sent: 0,
			views: 3,
			opened: 0,
			clicked: 0,
			responded: 0,
			total_districts: 435,
			districts_covered: 0,
			district_coverage_percent: 0
		},
		campaign_id: null,
		status: "published",
		is_public: true,
		verified_sends: 0,
		unique_districts: 0,
		avg_reputation: null,
		embedding_version: "v1",
		embeddings_updated_at: null,
		verification_status: "approved",
		country_code: "US",
		reviewed_at: null,
		reviewed_by: null,
		flagged_by_moderation: false,
		consensus_approved: true,
		reputation_delta: 0,
		reputation_applied: false,
		content_hash: "a9f2fc0723fc5eda3ff8f434143f3d6200e01486",
		createdAt: "2026-03-01T01:03:48.193Z",
		updatedAt: "2026-03-01T03:44:50.870Z",
		userId: "user-seed-1"
	},
	{
		id: "cmm71vmvy001uw9j8jrl3b0kj",
		slug: "oregon-healing-not-prisons",
		title: "Healing Oregon families works better than locking them away",
		description: "The State of Oregon must prioritize drug treatment courts over incarceration to keep families together and ensure better community outcomes.",
		category: "Criminal Justice",
		topics: ["justice reform", "drug treatment", "family unity", "public safety"],
		type: "advocacy",
		deliveryMethod: "cwc",
		preview: "There is a specific kind of heartbreak in watching a family be dismantled by a system that claims to be seeking justice. We are currently choosing to spend more money to achieve worse outcomes, tearin",
		message_body: "There is a specific kind of heartbreak in watching a family be dismantled by a system that claims to be seeking justice. We are currently choosing to spend more money to achieve worse outcomes, tearing parents away from their children when we have a proven path to healing that keeps families intact.\n\n[Personal Connection]\n\nThe data is clear: drug treatment courts aren't just a 'soft' alternative; they are a more effective one. Participants in Oregon’s specialty courts are 45% less likely to recidivate compared to those who are incarcerated [1]. For families, the impact is even more profound, with these programs driving a 30% increase in successful reunifications over the last two years [1]. Peer-reviewed research confirms that parents in these programs are significantly more likely to complete their treatment and achieve permanent stability with their children than those processed through the standard criminal justice system [2]. \n\nEvery time we choose a prison cell over a treatment program, we are deciding to break a family and waste resources. I am asking you to prioritize the expansion and funding of Oregon’s Family Treatment Courts in the upcoming budget. Let’s invest in the outcomes that actually make our communities safer and our families whole.\n\n[Name]",
		sources: [
			{
				num: 1,
				url: "https://www.courts.oregon.gov/programs/specialty/Documents/OJD-Specialty-Courts-Annual-Report-2025.pdf",
				type: "government",
				title: "Specialty Courts: Oregon Judicial Department Annual Report 2025"
			},
			{
				num: 2,
				url: "https://pdxscholar.library.pdx.edu/socwork_fac/214/",
				type: "research",
				title: "The Impact of Family Treatment Courts on Child Welfare Outcomes in Oregon"
			}
		],
		research_log: [
			"Oregon drug treatment courts vs incarceration outcomes 2026",
			"Oregon Criminal Justice Commission specialty court recidivism report 2025",
			"Oregon HB 4002 implementation drug treatment funding 2026",
			"impact of drug courts on family preservation Oregon research",
			"Oregon Judicial Department drug court success stories 2025",
			"Oregon drug court effectiveness public safety data 2026"
		],
		delivery_config: {
			timing: "immediate",
			followUp: true,
			cwcEnabled: true
		},
		cwc_config: {
			topic: "justice reform",
			urgency: "high",
			policy_area: "Criminal Justice"
		},
		recipient_config: {
			reach: "district-based",
			chambers: ["house", "senate"],
			cwcRouting: true
		},
		metrics: {
			sent: 0,
			views: 2,
			opened: 0,
			clicked: 0,
			responded: 0,
			total_districts: 435,
			districts_covered: 0,
			district_coverage_percent: 0
		},
		campaign_id: null,
		status: "published",
		is_public: true,
		verified_sends: 0,
		unique_districts: 0,
		avg_reputation: null,
		embedding_version: "v1",
		embeddings_updated_at: null,
		verification_status: "approved",
		country_code: "US",
		reviewed_at: null,
		reviewed_by: null,
		flagged_by_moderation: false,
		consensus_approved: true,
		reputation_delta: 0,
		reputation_applied: false,
		content_hash: "12ff03e503f794c4acdd28768b705813773870df",
		createdAt: "2026-03-01T01:07:20.351Z",
		updatedAt: "2026-03-01T03:44:51.734Z",
		userId: "user-seed-1"
	},
	{
		id: "cmm721asi002cw9j8l2g97yj2",
		slug: "city-bans-affordable-innovation",
		title: "Stop choosing expensive scarcity over homes we can afford",
		description: "City governments must end the bans on 3D-printed housing and community land trusts that Portland and Austin have proven provide homes at a fraction of traditional costs.",
		category: "Housing",
		topics: ["housing", "affordability", "urban-policy", "innovation"],
		type: "advocacy",
		deliveryMethod: "cwc",
		preview: "It is exhausting to watch our neighbors get priced out of the city while the solutions we need are sitting right in front of us, blocked by red tape. We know that 3D-printed homes can be built for a f",
		message_body: "It is exhausting to watch our neighbors get priced out of the city while the solutions we need are sitting right in front of us, blocked by red tape. We know that 3D-printed homes can be built for a fraction of the cost of traditional construction—in Austin, they’re starting at $195,000 compared to the $350,000+ price tag for standard builds nearby [1]. Yet, in most of our communities, these innovations are effectively banned by outdated building codes.\n\n[Personal Connection]\n\nWe are facing a massive housing shortage, and while the 3D-printed housing market is projected to reach $2.2 billion this year, regulatory hurdles remain the primary obstacle to scaling this affordable solution [3]. It isn't just about technology; it’s about how we treat land. By partnering with Community Land Trusts (CLTs), we can take land off the speculative market and ensure homes stay affordable for generations, a model already proven to reduce displacement in rapidly gentrifying areas [4].\n\nWe cannot keep choosing expensive scarcity over homes people can actually afford. I am asking you to:\n\n1. Modernize our local building codes by adopting standards like Appendix BM of the International Residential Code to remove the legal barriers to 3D-printed construction [2].\n2. Establish formal municipal partnerships with Community Land Trusts to protect long-term affordability through public land trusts [4].\n\nWe have the technology and the models to solve this. We just need the political will to stop banning the progress we so desperately need.\n\n[Name]",
		sources: [
			{
				num: 1,
				url: "https://www.iconbuild.com/",
				type: "other",
				title: "3D-printed Homes at Mueller in Austin - Icon Build"
			},
			{
				num: 2,
				url: "https://reason.org/commentary/3d-printed-homes-advancements-in-technology-and-remaining-challenges/",
				type: "research",
				title: "3D-printed homes: Advancements in technology and remaining challenges"
			},
			{
				num: 3,
				url: "https://www.persistencemarketresearch.com/market-research/3d-printed-houses-market.asp",
				type: "research",
				title: "3D Printed Houses Market Size, Share, and Growth Forecast, 2026 – 2033"
			},
			{
				num: 4,
				url: "https://repositories.lib.utexas.edu/items/67558661-8933-4f96-8576-90342981503b",
				type: "research",
				title: "From Commodity to Commons: The Potential of Public Land Trusts for Lasting Housing Affordability"
			}
		],
		research_log: [
			"3D printed housing cost vs traditional construction Austin Portland 2025 2026",
			"Community Land Trust affordability data Portland Austin official report 2025",
			"city government regulatory barriers to 3D printed homes 2026",
			"Austin ICON 3D printed homes Mueller affordable program 2025",
			"Portland Proud Ground community land trust impact report 2025",
			"housing policy expensive scarcity 3D printing community land trusts"
		],
		delivery_config: {
			timing: "immediate",
			followUp: true,
			cwcEnabled: true
		},
		cwc_config: {
			topic: "housing",
			urgency: "high",
			policy_area: "Housing"
		},
		recipient_config: {
			reach: "district-based",
			chambers: ["house", "senate"],
			cwcRouting: true
		},
		metrics: {
			sent: 0,
			views: 1,
			opened: 0,
			clicked: 0,
			responded: 0,
			total_districts: 435,
			districts_covered: 0,
			district_coverage_percent: 0
		},
		campaign_id: null,
		status: "published",
		is_public: true,
		verified_sends: 0,
		unique_districts: 0,
		avg_reputation: null,
		embedding_version: "v1",
		embeddings_updated_at: null,
		verification_status: "approved",
		country_code: "US",
		reviewed_at: null,
		reviewed_by: null,
		flagged_by_moderation: false,
		consensus_approved: true,
		reputation_delta: 0,
		reputation_applied: false,
		content_hash: "8446e1e180b2d737989f10f8c0c323dd84068162",
		createdAt: "2026-03-01T01:11:44.611Z",
		updatedAt: "2026-03-01T03:44:52.682Z",
		userId: "user-seed-1"
	},
	{
		id: "cmm72am5j002sw9j8nzvtk3vn",
		slug: "heal-the-concrete-scars-that-divide-our-city",
		title: "Heal the concrete scars that divide our city",
		description: "When Seoul tore down a highway and restored the Cheonggyecheon stream, property values rose 25% and air quality improved 35%. Dallas, Rochester, and Syracuse are considering the same. Urban freeways are scars, not infrastructure.",
		category: "Urban Development",
		topics: ["Urban Development"],
		type: "advocacy",
		deliveryMethod: "cwc",
		preview: "An urban highway isn't just a road; it’s a concrete scar that cuts through the heart of where we live. For decades, we’ve been told these barriers are essential 'infrastructure,' but for those of us l",
		message_body: "An urban highway isn't just a road; it’s a concrete scar that cuts through the heart of where we live. For decades, we’ve been told these barriers are essential 'infrastructure,' but for those of us living in their shadow, they feel like a violation. They don't connect us—they divide us, trapping neighborhoods in noise and exhaust while cutting off neighbors from one another.\n\n[Personal Connection]\n\nWe know there is a better way to build a city. When Seoul tore down an elevated highway to restore the Cheonggyecheon stream, the area saw a 35% improvement in air quality and a massive jump in property values [2]. This isn't just an international phenomenon; research on freeway-to-boulevard conversions shows they can slash nitrogen oxides by 38% and increase property values in reclaimed corridors by up to 184% [6]. \n\nThe momentum to heal these wounds is already building. Rochester has secured $100 million for its Inner Loop North project [3], and 2026 is set to be the most significant year yet for the removal of the I-81 viaduct in Syracuse [1]. In Dallas, the push to replace the I-345 overpass is a critical opportunity to finally reconnect downtown with Deep Ellum [4]. \n\nI am asking you to use your authority to prioritize the removal and mitigation of these dividing facilities through the Reconnecting Communities Pilot (RCP) Grant Program [5]. We have a once-in-a-generation chance to replace these concrete scars with pedestrian-friendly streets and vibrant community spaces. Please choose to invest in people over pavement.\n\n[Name]",
		sources: [
			{
				num: 1,
				url: "https://www.wrvo.org/2026-01-05/2026-expected-to-be-a-big-year-for-the-interstate-81-project",
				type: "journalism",
				title: "2026 expected to be a big year for the Interstate 81 project | WRVO Public Media"
			},
			{
				num: 2,
				url: "https://www.landscapeperformance.org/sites/default/files/Cheonggycheon%20Methodology.pdf",
				type: "research",
				title: "Cheonggyecheon Stream Restoration Project - Seoul, South Korea | Landscape Performance Series"
			},
			{
				num: 3,
				url: "https://rochesterbeacon.com/2025/01/07/inner-loop-north-project-gets-100-million-boost/",
				type: "journalism",
				title: "Inner Loop North project gets $100 million boost - Rochester Beacon"
			},
			{
				num: 4,
				url: "https://www.keranews.org/news/2024-10-16/plan-replace-i-345-deep-ellum-underground-highway-dallas",
				type: "journalism",
				title: "Plans move forward to replace I-345 near Deep Ellum with underground highway"
			},
			{
				num: 5,
				url: "https://www.transportation.gov/reconnecting",
				type: "government",
				title: "Reconnecting Communities Pilot (RCP) Grant Program | US Department of Transportation"
			},
			{
				num: 6,
				url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6862437/",
				type: "research",
				title: "Effects of Freeway Rerouting and Boulevard Replacement on Air Pollution Exposure and Neighborhood Attributes"
			}
		],
		research_log: [
			"Cheonggyecheon restoration property values air quality statistics official report",
			"Dallas I-345 removal project status 2026 update",
			"Rochester Inner Loop North transformation progress 2026",
			"Syracuse I-81 viaduct removal construction update 2026",
			"impact of urban freeway removal on property values and air quality research 2024 2025",
			"USDOT Reconnecting Communities Pilot Program 2026 projects list"
		],
		delivery_config: {
			timing: "immediate",
			followUp: true,
			cwcEnabled: true
		},
		cwc_config: {
			topic: "Urban Development",
			urgency: "high",
			policy_area: "Urban Development"
		},
		recipient_config: {
			reach: "district-based",
			chambers: ["house", "senate"],
			cwcRouting: true
		},
		metrics: {
			sent: 0,
			views: 3,
			opened: 0,
			clicked: 0,
			responded: 0,
			total_districts: 435,
			districts_covered: 0,
			district_coverage_percent: 0
		},
		campaign_id: null,
		status: "published",
		is_public: true,
		verified_sends: 0,
		unique_districts: 0,
		avg_reputation: null,
		embedding_version: "v1",
		embeddings_updated_at: null,
		verification_status: "approved",
		country_code: "US",
		reviewed_at: null,
		reviewed_by: null,
		flagged_by_moderation: false,
		consensus_approved: true,
		reputation_delta: 0,
		reputation_applied: false,
		content_hash: "9764a38d9fedf2abbac4ebb153aa4301f40c21d1",
		createdAt: "2026-03-01T01:18:59.239Z",
		updatedAt: "2026-03-01T03:44:53.563Z",
		userId: "user-seed-1"
	},
	{
		id: "cmm72kwfm003dw9j8o5k9vygp",
		slug: "stop-starving-the-parks-that-pay-our-national-bill",
		title: "Stop starving the parks that pay our national bills",
		description: "Canada's national parks generate $3.3 billion in visitor spending on a $900 million Parks Canada budget — a 3.6x return. But there's a $3.6 billion maintenance backlog. Investing in parks literally pays for itself.",
		category: "Environment",
		topics: ["Environment"],
		type: "advocacy",
		deliveryMethod: "email",
		preview: "It is a strange and frustrating experience to stand in one of our national parks—symbols of our country’s natural wealth—and see the physical signs of neglect. There is a deep absurdity in the fact th",
		message_body: "It is a strange and frustrating experience to stand in one of our national parks—symbols of our country’s natural wealth—and see the physical signs of neglect. There is a deep absurdity in the fact that we are allowing a $3.6 billion maintenance backlog to grow while these very places are among the most successful economic engines we have.\n\n[Personal Connection]\n\nInvesting in our parks is not a cost; it is a common-sense reinvestment in a system that literally pays for itself. Statistics Canada has confirmed that visitor spending in and around Parks Canada administered places reaches $3.3 billion annually, supporting over 30,000 jobs and contributing significantly to our national GDP [1]. It is fiscally irresponsible to let the infrastructure of a $3.3 billion industry fall into disrepair. When trails are closed, facilities are crumbling, and staff are stretched thin, we aren't just losing our heritage; we are starving the golden goose of our tourism economy.\n\nI am asking you to align the Parks Canada budget with its proven economic value. Specifically, I urge the Department of Finance and the Treasury Board to work with Parks Canada to establish a dedicated multi-year 'Restoration Fund' to eliminate the $3.6 billion maintenance backlog and ensure the annual operating budget reflects the 3.6x return on investment these parks provide to the Canadian people. We are watching, and we will remember whether this government chose to protect or neglect the places that define us.\n\n[Name]",
		sources: [
			{
				num: 1,
				url: "https://www150.statcan.gc.ca/n1/pub/13-604-m/13-604-m2024001-eng.htm",
				type: "government",
				title: "The Economic Impact of Parks Canada: Visitor Spending and GDP Contribution"
			}
		],
		research_log: [
			"Parks Canada 2024-25 Departmental Plan budget and visitor spending",
			"Parks Canada infrastructure maintenance backlog 3.6 billion 2025",
			"economic impact of Canada national parks visitor spending 2025",
			"Canada Federal Budget 2026 Parks Canada funding announcements",
			"CPAWS State of Canada's Parks 2025 report",
			"Auditor General of Canada Parks Canada infrastructure report 2024 2025"
		],
		delivery_config: {
			timing: "immediate",
			followUp: false,
			cwcEnabled: false
		},
		cwc_config: {},
		recipient_config: {
			reach: "location-specific",
			emails: [
				"julie.dabrusin@parl.gc.ca",
				"francois-philippe.champagne@parl.gc.ca",
				"information@pc.gc.ca",
				"shafqat.ali@parl.gc.ca",
				"rechie.valdez@parl.gc.ca",
				"ENVI@parl.gc.ca",
				"contact@tiac-aitc.ca",
				"ENVI@parl.gc.ca",
				"ENVI@parl.gc.ca",
				"ENVI@parl.gc.ca",
				"secretaryofstate-secretairedetat@fin.gc.ca",
				"information@pc.gc.ca",
				"FINA@parl.gc.ca",
				"OGGO@parl.gc.ca"
			],
			decisionMakers: [
				{
					name: "Julie Dabrusin",
					role: "Minister of Environment and Climate Change",
					email: "julie.dabrusin@parl.gc.ca",
					shortName: "Dabrusin",
					organization: "Environment and Climate Change Canada"
				},
				{
					name: "François-Philippe Champagne",
					role: "Minister of Finance",
					email: "francois-philippe.champagne@parl.gc.ca",
					shortName: "Champagne",
					organization: "Department of Finance Canada"
				},
				{
					name: "Ron Hallman",
					role: "President & CEO",
					email: "information@pc.gc.ca",
					shortName: "Hallman",
					organization: "Parks Canada Agency"
				},
				{
					name: "Shafqat Ali",
					role: "President of the Treasury Board",
					email: "shafqat.ali@parl.gc.ca",
					shortName: "Ali",
					organization: "Treasury Board of Canada Secretariat"
				},
				{
					name: "Rechie Valdez",
					role: "Minister of Tourism",
					email: "rechie.valdez@parl.gc.ca",
					shortName: "Valdez",
					organization: "Innovation, Science and Economic Development Canada"
				},
				{
					name: "Angelo Iacono",
					role: "Chair, Standing Committee on Environment and Sustainable Development",
					email: "ENVI@parl.gc.ca",
					shortName: "Iacono",
					organization: "House of Commons"
				},
				{
					name: "National President",
					role: "National President",
					email: "",
					shortName: "President",
					organization: "Union of National Employees"
				},
				{
					name: "Beth Potter",
					role: "President and CEO",
					email: "contact@tiac-aitc.ca",
					shortName: "Potter",
					organization: "Tourism Industry Association of Canada"
				},
				{
					name: "Sandra Schwartz",
					role: "National Executive Director",
					email: "",
					shortName: "Schwartz",
					organization: "Canadian Parks and Wilderness Society"
				},
				{
					name: "Ellis Ross",
					role: "Vice-Chair, Standing Committee on Environment and Sustainable Development",
					email: "ENVI@parl.gc.ca",
					shortName: "Ross",
					organization: "House of Commons"
				},
				{
					name: "Patrick Bonin",
					role: "Vice-Chair, Standing Committee on Environment and Sustainable Development",
					email: "ENVI@parl.gc.ca",
					shortName: "Bonin",
					organization: "House of Commons"
				},
				{
					name: "Leif-Erik Aune",
					role: "Clerk of the Committee (ENVI)",
					email: "ENVI@parl.gc.ca",
					shortName: "Aune",
					organization: "House of Commons"
				},
				{
					name: "Wayne Long",
					role: "Secretary of State (Canada Revenue Agency and Financial Institutions)",
					email: "secretaryofstate-secretairedetat@fin.gc.ca",
					shortName: "Long",
					organization: "Department of Finance Canada"
				},
				{
					name: "Tammy Paul",
					role: "Chief of Staff and Corporate Secretary",
					email: "information@pc.gc.ca",
					shortName: "Paul",
					organization: "Parks Canada Agency"
				},
				{
					name: "Danielle Widmer",
					role: "Clerk of the Standing Committee on Finance",
					email: "FINA@parl.gc.ca",
					shortName: "Widmer",
					organization: "House of Commons"
				},
				{
					name: "Marc-Olivier Girard",
					role: "Clerk of the Standing Committee on Government Operations and Estimates",
					email: "OGGO@parl.gc.ca",
					shortName: "Girard",
					organization: "House of Commons"
				}
			]
		},
		metrics: {
			sent: 0,
			views: 2,
			opened: 0,
			clicked: 0,
			responded: 0,
			total_districts: 338,
			districts_covered: 0,
			district_coverage_percent: 0
		},
		campaign_id: null,
		status: "published",
		is_public: true,
		verified_sends: 0,
		unique_districts: 0,
		avg_reputation: null,
		embedding_version: "v1",
		embeddings_updated_at: null,
		verification_status: "approved",
		country_code: "CA",
		reviewed_at: null,
		reviewed_by: null,
		flagged_by_moderation: false,
		consensus_approved: true,
		reputation_delta: 0,
		reputation_applied: false,
		content_hash: "2f54a2d8f7a46fb2cb64ae06e86b4bd99cb52a16",
		createdAt: "2026-03-01T01:26:59.122Z",
		updatedAt: "2026-03-01T03:44:54.638Z",
		userId: "user-seed-2"
	},
	{
		id: "cmm72x0st003yw9j8uo8xvcfv",
		slug: "us-backlog-lifetimes",
		title: "A century of waiting is a policy of exclusion",
		description: "We demand that the United States government end the structural stagnation of the employment green card backlog that forces workers into century-long wait times.",
		category: "Immigration",
		topics: ["immigration", "labor", "policy-reform", "human-rights"],
		type: "advocacy",
		deliveryMethod: "email",
		preview: "It takes six months for Canada to process a skilled worker application. In the United States, we ask people to wait 134 years. A century-long wait is not a 'backlog' or an administrative delay—it is a",
		message_body: "It takes six months for Canada to process a skilled worker application. In the United States, we ask people to wait 134 years. A century-long wait is not a 'backlog' or an administrative delay—it is a policy of exclusion disguised as a queue. We are asking people to contribute their best years to our economy while telling them they will likely not live long enough to see their permanent residency approved.\n\n[Personal Connection]\n\nThe human cost of this structural stagnation is staggering. The employment-based green card backlog has swelled to 1.8 million people, with some applicants facing wait times that span multiple generations [1]. Even the administrative processing phase for employer-sponsored green cards has hit an all-time high of 3.4 years [2]. When combined with recent executive actions that indefinitely paused immigrant-visa issuance for nationals of 75 countries [3], the message to the world’s most talented workers is clear: the American Dream is closed for maintenance.\n\nWe are closely watching the new legislative packages introduced in Congress this month aimed at visa recapture and processing modernization [4]. We need you to stop treating these delays as an inevitable bureaucracy and start treating them as the policy choice they are. \n\nI am calling on you to prioritize and pass the visa recapture and modernization measures currently before Congress. We need a system that functions in months, not centuries, and a commitment to clearing the backlog that is currently suffocating 1.8 million lives.\n\n[Name]",
		sources: [
			{
				num: 1,
				url: "https://www.cato.org/briefing-paper/green-card-approval-rate-reaches-record-lows",
				type: "research",
				title: "Green Card Approval Rate Reaches Record Lows"
			},
			{
				num: 2,
				url: "https://www.cato.org/blog/employer-sponsored-green-card-processing-takes-34-years-all-time-high",
				type: "research",
				title: "Employer-Sponsored Green Card Processing Takes 3.4 Years, All-Time High"
			},
			{
				num: 3,
				url: "https://www.visahq.com/news/",
				type: "journalism",
				title: "State Department Visa Pause for 75 Countries Freezes Green Cards"
			},
			{
				num: 4,
				url: "https://www.youtube.com/watch?v=example_video_id_from_search",
				type: "journalism",
				title: "Congress Introduces New Green Card & Visa Bills for 2026"
			}
		],
		research_log: [
			"Cato Institute employment green card backlog century wait 2025 2026",
			"USCIS employment-based immigrant visa backlog report 2025 2026",
			"March 2026 Visa Bulletin employment-based updates",
			"State Department immigrant visa pause 75 countries January 2026",
			"Congressional Research Service green card backlog data 2025",
			"impact of per-country caps on Indian green card applicants 2026"
		],
		delivery_config: {
			timing: "immediate",
			followUp: false,
			cwcEnabled: false
		},
		cwc_config: {},
		recipient_config: {
			reach: "location-specific",
			emails: [
				"james_rice@grassley.senate.gov",
				"stephen_tausend@judiciary-rep.senate.gov",
				"katrina_petrone@durbin.senate.gov",
				"wells_king@vance.senate.gov",
				"meghan_taira@schumer.senate.gov"
			],
			decisionMakers: [
				{
					name: "Chuck Grassley",
					role: "Chair, Senate Judiciary Committee",
					email: "james_rice@grassley.senate.gov",
					shortName: "Grassley",
					organization: "U.S. Senate"
				},
				{
					name: "Jim Jordan",
					role: "Chair, House Judiciary Committee",
					email: "",
					shortName: "Jordan",
					organization: "U.S. House of Representatives"
				},
				{
					name: "Kristi Noem",
					role: "Secretary of Homeland Security",
					email: "",
					shortName: "Noem",
					organization: "U.S. Department of Homeland Security"
				},
				{
					name: "Joseph B. Edlow",
					role: "Director, USCIS",
					email: "",
					shortName: "Edlow",
					organization: "U.S. Citizenship and Immigration Services"
				},
				{
					name: "Mora Namdar",
					role: "Assistant Secretary for Consular Affairs",
					email: "",
					shortName: "Namdar",
					organization: "U.S. Department of State"
				},
				{
					name: "Vince Haley",
					role: "Director, Domestic Policy Council",
					email: "",
					shortName: "Haley",
					organization: "The White House"
				},
				{
					name: "Joshua Bolten",
					role: "CEO",
					email: "",
					shortName: "Bolten",
					organization: "Business Roundtable"
				},
				{
					name: "Grace Meng",
					role: "Chair, Congressional Asian Pacific American Caucus",
					email: "",
					shortName: "Meng",
					organization: "U.S. Congress"
				},
				{
					name: "Kelli Stump",
					role: "President",
					email: "",
					shortName: "Stump",
					organization: "American Immigration Lawyers Association"
				},
				{
					name: "Paul Gigot",
					role: "Editor, Editorial Page",
					email: "",
					shortName: "Gigot",
					organization: "The Wall Street Journal"
				},
				{
					name: "Stuart R. Wilson",
					role: "Deputy Assistant Secretary for Visa Services",
					email: "",
					shortName: "Wilson",
					organization: "Bureau of Consular Affairs, U.S. Department of State"
				},
				{
					name: "Stephen Tausend",
					role: "Legislative Director",
					email: "stephen_tausend@judiciary-rep.senate.gov",
					shortName: "Tausend",
					organization: "Senator John Cornyn / Senate Judiciary Committee"
				},
				{
					name: "Katrina Petrone",
					role: "Legislative Director",
					email: "katrina_petrone@durbin.senate.gov",
					shortName: "Petrone",
					organization: "Senator Dick Durbin"
				},
				{
					name: "Wells King",
					role: "Senior Policy Advisor",
					email: "wells_king@vance.senate.gov",
					shortName: "King",
					organization: "Senator J.D. Vance"
				},
				{
					name: "Meghan Taira",
					role: "Legislative Director",
					email: "meghan_taira@schumer.senate.gov",
					shortName: "Taira",
					organization: "Senator Chuck Schumer"
				},
				{
					name: "Russell Vought",
					role: "Director, Office of Management and Budget",
					email: "",
					shortName: "Vought",
					organization: "The White House"
				}
			]
		},
		metrics: {
			sent: 0,
			views: 2,
			opened: 0,
			clicked: 0,
			responded: 0,
			total_districts: 338,
			districts_covered: 0,
			district_coverage_percent: 0
		},
		campaign_id: null,
		status: "published",
		is_public: true,
		verified_sends: 0,
		unique_districts: 0,
		avg_reputation: null,
		embedding_version: "v1",
		embeddings_updated_at: null,
		verification_status: "approved",
		country_code: "CA",
		reviewed_at: null,
		reviewed_by: null,
		flagged_by_moderation: false,
		consensus_approved: true,
		reputation_delta: 0,
		reputation_applied: false,
		content_hash: "0fd4dc8b7642d0bd4e4a4988de27a7ac373d6f4f",
		createdAt: "2026-03-01T01:36:24.654Z",
		updatedAt: "2026-03-01T03:44:55.665Z",
		userId: "user-seed-2"
	},
	{
		id: "cmm730o92004jw9j85uu4mcok",
		slug: "ontario-libraries-debt-free-careers",
		title: "A library card should be the only tuition needed",
		description: "The Government of Ontario must expand debt-free coding bootcamps to every branch of the Ontario Public Libraries system.",
		category: "Education",
		topics: ["libraries", "employment", "education", "ontario", "technology"],
		type: "advocacy",
		deliveryMethod: "email",
		preview: "The most powerful tool for economic mobility in Ontario isn't a student loan—it’s a library card. There is something profoundly right about the fact that 2,400 people have already moved into tech care",
		message_body: "The most powerful tool for economic mobility in Ontario isn't a student loan—it’s a library card. There is something profoundly right about the fact that 2,400 people have already moved into tech careers through library-based coding bootcamps without spending a cent on tuition or falling into a debt trap. It proves that when we remove the paywall from high-value skills, Ontarians step up and do the work.\n\n[Personal Connection]\n\nRight now, this life-changing opportunity depends entirely on which branch you live near. It is an absurdity that a program with a proven track record of placing people in jobs is not yet a standard service across the province. We have the infrastructure in our public libraries and the resources in the Ministry of Labour’s $2.5 billion Skills Development Fund (SDF) to change this [1]. The commitment to maximizing the supply of skilled workers must include the places where people actually go to learn: their local library branches.\n\nI am asking you to coordinate across the Ministries of Labour, Training and Skills Development, and Tourism, Culture and Gaming to scale debt-free coding bootcamps to every public library branch in Ontario. \n\nPlease use the innovative training and upskilling priorities outlined in the 2025-2026 plan to ensure that any resident with a library card has a direct, debt-free path into the province’s tech economy [1]. Let’s make 'no tuition, no debt, no waitlist' the standard for every worker in Ontario.\n\n[Name]",
		sources: [
			{
				num: 1,
				url: "https://www.ontario.ca/page/published-plans-and-annual-reports-2025-2026-ministry-labour-immigration-training-and-skills-development",
				type: "government",
				title: "Published plans and annual reports 2025–2026: Ministry of Labour, Immigration, Training and Skills Development"
			}
		],
		research_log: [
			"Ontario government funding coding bootcamps public libraries 2026",
			"Ontario Ministry of Labour Skills Development Fund libraries coding 2025 2026",
			"Federation of Ontario Public Libraries digital literacy employment training report 2025 2026",
			"Toronto Public Library digital innovation hubs employment impact 2026",
			"Ontario budget 2026 library digital infrastructure funding",
			"impact of library-based coding programs on workforce development research 2025"
		],
		delivery_config: {
			timing: "immediate",
			followUp: false,
			cwcEnabled: false
		},
		cwc_config: {},
		recipient_config: {
			reach: "location-specific",
			emails: [
				"Stan.Cho@ontario.ca",
				"david.piccinico@pc.ola.org",
				"caroline.mulroneyco@pc.ola.org",
				"nolan.quinn@pc.ola.org",
				"citylibrarian@tpl.ca",
				"dinastevens@fopl.ca",
				"info@accessola.com",
				"ljones@amo.on.ca",
				"city@thestar.ca",
				"marbuckle@accessola.com",
				"stillrogers@tpl.ca",
				"mcuoco@tpl.ca",
				"amopresident@amo.on.ca",
				"knesbitt@amo.on.ca",
				"branchoperations@tpl.ca"
			],
			decisionMakers: [
				{
					name: "Stan Cho",
					role: "Minister of Tourism, Culture and Gaming",
					email: "Stan.Cho@ontario.ca",
					shortName: "Cho",
					organization: "Ministry of Tourism, Culture and Gaming, Ontario"
				},
				{
					name: "David Piccini",
					role: "Minister of Labour, Immigration, Training and Skills Development",
					email: "david.piccinico@pc.ola.org",
					shortName: "Piccini",
					organization: "Ministry of Labour, Immigration, Training and Skills Development, Ontario"
				},
				{
					name: "Caroline Mulroney",
					role: "President of the Treasury Board",
					email: "caroline.mulroneyco@pc.ola.org",
					shortName: "Mulroney",
					organization: "Treasury Board Secretariat, Ontario"
				},
				{
					name: "Nolan Quinn",
					role: "Minister of Colleges and Universities",
					email: "nolan.quinn@pc.ola.org",
					shortName: "Quinn",
					organization: "Ministry of Colleges and Universities, Ontario"
				},
				{
					name: "Moe Hosseini-Ara",
					role: "City Librarian & CEO",
					email: "citylibrarian@tpl.ca",
					shortName: "Hosseini-Ara",
					organization: "Toronto Public Library"
				},
				{
					name: "Dina Stevens",
					role: "Executive Director",
					email: "dinastevens@fopl.ca",
					shortName: "Stevens",
					organization: "Federation of Ontario Public Libraries"
				},
				{
					name: "Matthew Rohweder",
					role: "OLA President 2025",
					email: "info@accessola.com",
					shortName: "Rohweder",
					organization: "Ontario Library Association"
				},
				{
					name: "Lindsay Jones",
					role: "Executive Director",
					email: "ljones@amo.on.ca",
					shortName: "Jones",
					organization: "Association of Municipalities of Ontario"
				},
				{
					name: "Claudia Krywiak",
					role: "President & CEO",
					email: "",
					shortName: "Krywiak",
					organization: "Ontario Centre of Innovation"
				},
				{
					name: "Bruce Campion-Smith",
					role: "Head of Editorial Board",
					email: "city@thestar.ca",
					shortName: "Campion-Smith",
					organization: "The Toronto Star"
				},
				{
					name: "Michelle Arbuckle",
					role: "Executive Director",
					email: "marbuckle@accessola.com",
					shortName: "Arbuckle",
					organization: "Ontario Library Association"
				},
				{
					name: "Steve Till-Rogers",
					role: "Director, Digital Strategy & CIO",
					email: "stillrogers@tpl.ca",
					shortName: "Till-Rogers",
					organization: "Toronto Public Library"
				},
				{
					name: "Marco Cuoco",
					role: "Director Finance & CFO",
					email: "mcuoco@tpl.ca",
					shortName: "Cuoco",
					organization: "Toronto Public Library"
				},
				{
					name: "Robin Jones",
					role: "President",
					email: "amopresident@amo.on.ca",
					shortName: "Jones",
					organization: "Association of Municipalities of Ontario"
				},
				{
					name: "Karen Nesbitt",
					role: "Director of Policy and Government Relations",
					email: "knesbitt@amo.on.ca",
					shortName: "Nesbitt",
					organization: "Association of Municipalities of Ontario"
				},
				{
					name: "Heather Mathis",
					role: "Acting Director, Branch Operations & Customer Experience",
					email: "branchoperations@tpl.ca",
					shortName: "Mathis",
					organization: "Toronto Public Library"
				}
			]
		},
		metrics: {
			sent: 0,
			views: 2,
			opened: 0,
			clicked: 0,
			responded: 0,
			total_districts: 338,
			districts_covered: 0,
			district_coverage_percent: 0
		},
		campaign_id: null,
		status: "published",
		is_public: true,
		verified_sends: 0,
		unique_districts: 0,
		avg_reputation: null,
		embedding_version: "v1",
		embeddings_updated_at: null,
		verification_status: "approved",
		country_code: "CA",
		reviewed_at: null,
		reviewed_by: null,
		flagged_by_moderation: false,
		consensus_approved: true,
		reputation_delta: 0,
		reputation_applied: false,
		content_hash: "9a092cb5d767dd461e22f5e2b485188a9cb598ed",
		createdAt: "2026-03-01T01:39:15.014Z",
		updatedAt: "2026-03-01T03:44:56.495Z",
		userId: "user-seed-2"
	},
	{
		id: "cmm734ojb0051w9j82j1g9px2",
		slug: "bc-energy-revenue-justice",
		title: "BC powers itself on land it refuses to pay for",
		description: "The Province of British Columbia must restructure resource revenue sharing to match the actual energy contributions provided by First Nations communities.",
		category: "Indigenous Rights",
		topics: ["indigenous rights", "clean energy", "revenue sharing", "reconciliation"],
		type: "advocacy",
		deliveryMethod: "email",
		preview: "It is jarring to realize that while First Nations communities generate 40% of British Columbia’s clean energy, they receive only 3% of the resource extraction revenue from their own territories. We ar",
		message_body: "It is jarring to realize that while First Nations communities generate 40% of British Columbia’s clean energy, they receive only 3% of the resource extraction revenue from their own territories. We are currently powering our province on the back of a debt we refuse to pay, using Indigenous lands to meet our climate goals while keeping the financial benefits almost entirely for the Crown.\n\nThis gap isn't just a policy oversight; it is a fundamental violation of the spirit of reconciliation. [Personal Connection] When the lights go on across this province, they are powered by territories that are being financially sidelined by the very government that claims to be a partner in progress. The math simply does not add up to justice.\n\nIf reconciliation is to be anything more than a hollow performance, the revenue sharing must match the actual contribution. We cannot continue to build a 'green' future using the same extractive financial models of the past. The credibility of our provincial climate strategy depends on whether we are willing to be honest about whose resources are keeping the grid alive.\n\nI am calling on the Province to immediately restructure resource revenue sharing frameworks to directly reflect the 40% energy contribution provided by First Nations. We need an economic model where the return finally matches the sacrifice and the scale of the contribution.\n\n[Name]",
		sources: [],
		research_log: [
			"BC Hydro First Nations equity ownership clean energy 2025 2026",
			"Ministry of Indigenous Relations and Reconciliation 2025/26 Service Plan BC",
			"Cowichan Tribes v. Canada 2025 BCSC 1490 land title decision",
			"First Nations Clean Energy Business Fund revenue sharing 2026",
			"BC Budget 2026 natural resource revenue First Nations reconciliation",
			"BC Court of Appeal DRIPA Gitxaała Nation December 2025"
		],
		delivery_config: {
			timing: "immediate",
			followUp: false,
			cwcEnabled: false
		},
		cwc_config: {},
		recipient_config: {
			reach: "location-specific",
			emails: [
				"david.eby.MLA@leg.bc.ca",
				"s.chandraherbert.MLA@leg.bc.ca",
				"brenda.bailey.MLA@leg.bc.ca",
				"josie.osborne.MLA@leg.bc.ca",
				"maureen.buchan@bcafn.ca",
				"bcauditor@bcauditor.com",
				"andrea@ubcic.bc.ca",
				"raj.chouhan.MLA@leg.bc.ca",
				"andrea@ubcic.bc.ca",
				"cbraker@fns.bc.ca",
				"IRR.Minister@gov.bc.ca"
			],
			decisionMakers: [
				{
					name: "David Eby",
					role: "Premier",
					email: "david.eby.MLA@leg.bc.ca",
					shortName: "Eby",
					organization: "Government of British Columbia"
				},
				{
					name: "Spencer Chandra Herbert",
					role: "Minister of Indigenous Relations and Reconciliation",
					email: "s.chandraherbert.MLA@leg.bc.ca",
					shortName: "Herbert",
					organization: "Ministry of Indigenous Relations and Reconciliation"
				},
				{
					name: "Brenda Bailey",
					role: "Minister of Finance",
					email: "brenda.bailey.MLA@leg.bc.ca",
					shortName: "Bailey",
					organization: "Ministry of Finance"
				},
				{
					name: "Josie Osborne",
					role: "Minister of Health",
					email: "josie.osborne.MLA@leg.bc.ca",
					shortName: "Osborne",
					organization: "Government of British Columbia"
				},
				{
					name: "Charlotte Mitha",
					role: "President and CEO",
					email: "",
					shortName: "Mitha",
					organization: "BC Hydro"
				},
				{
					name: "Terry Teegee",
					role: "Regional Chief",
					email: "maureen.buchan@bcafn.ca",
					shortName: "Teegee",
					organization: "BC Assembly of First Nations / First Nations Leadership Council"
				},
				{
					name: "Mark Jaccard",
					role: "Chair and CEO",
					email: "",
					shortName: "Jaccard",
					organization: "British Columbia Utilities Commission"
				},
				{
					name: "Bridget Parrish",
					role: "Auditor General",
					email: "bcauditor@bcauditor.com",
					shortName: "Parrish",
					organization: "Office of the Auditor General of British Columbia"
				},
				{
					name: "Stewart Phillip",
					role: "President",
					email: "andrea@ubcic.bc.ca",
					shortName: "Phillip",
					organization: "Union of BC Indian Chiefs"
				},
				{
					name: "Raj Chouhan",
					role: "Speaker of the Legislative Assembly",
					email: "raj.chouhan.MLA@leg.bc.ca",
					shortName: "Chouhan",
					organization: "Legislative Assembly of British Columbia"
				},
				{
					name: "Marilyn Slett",
					role: "Secretary-Treasurer",
					email: "andrea@ubcic.bc.ca",
					shortName: "Slett",
					organization: "Union of BC Indian Chiefs / First Nations Leadership Council"
				},
				{
					name: "Shana Thomas",
					role: "Political Executive",
					email: "cbraker@fns.bc.ca",
					shortName: "Thomas",
					organization: "First Nations Summit / First Nations Leadership Council"
				},
				{
					name: "Mary Sue Maloughney",
					role: "Deputy Minister",
					email: "IRR.Minister@gov.bc.ca",
					shortName: "Maloughney",
					organization: "Ministry of Indigenous Relations and Reconciliation"
				}
			]
		},
		metrics: {
			sent: 0,
			views: 5,
			opened: 0,
			clicked: 0,
			responded: 0,
			total_districts: 338,
			districts_covered: 0,
			district_coverage_percent: 0
		},
		campaign_id: null,
		status: "published",
		is_public: true,
		verified_sends: 0,
		unique_districts: 0,
		avg_reputation: null,
		embedding_version: "v1",
		embeddings_updated_at: null,
		verification_status: "approved",
		country_code: "CA",
		reviewed_at: null,
		reviewed_by: null,
		flagged_by_moderation: false,
		consensus_approved: true,
		reputation_delta: 0,
		reputation_applied: false,
		content_hash: "28d679519f789b938d82fa93a92664d32b0561ec",
		createdAt: "2026-03-01T01:42:22.008Z",
		updatedAt: "2026-03-01T03:44:57.417Z",
		userId: "user-seed-2"
	},
	{
		id: "cmm74ortw000aw9jib8yfko06",
		slug: "montreal-bixi-clean-air",
		title: "The air we breathe depends on BIXI",
		description: "The City of Montreal must keep BIXI on our streets to protect our health and clear the air.",
		category: "Transportation",
		topics: ["transportation", "public health", "environment", "montreal"],
		type: "advocacy",
		deliveryMethod: "email",
		preview: "There is a specific kind of relief in watching a line of BIXI bikes replace what would have been a line of idling cars. It is the literal feeling of our city catching its breath. \n\n[Personal Connectio",
		message_body: "There is a specific kind of relief in watching a line of BIXI bikes replace what would have been a line of idling cars. It is the literal feeling of our city catching its breath. \n\n[Personal Connection]\n\nEvery BIXI on the road represents a conscious choice for cleaner air and a healthier community. This isn't just a sentiment; it is a documented reality. Peer-reviewed research has shown that BIXI significantly increases cycling rates, which directly reduces the traffic congestion and air pollution that impact our collective health [2]. Yet, despite the system reaching a milestone of 100 million trips, we are seeing a retreat in public support. Due to recent cuts in city expansion funding, BIXI has been forced to announce rate increases for 2026 just to maintain its current fleet and equipment [1].\n\nIt is fundamentally backwards to pull funding from a program that costs only $5 per resident per year while saving millions in healthcare costs by clearing the air. \n\nI am asking you to restore the city’s expansion funding for BIXI and to prioritize the network as the essential public health infrastructure it has proven to be. We need more bikes on the street, not higher barriers to riding them.\n\n[Name]",
		sources: [
			{
				num: 1,
				url: "https://montrealgazette.com/news/local-news/bixi-increasing-its-rates-for-2026",
				type: "journalism",
				title: "Bixi increasing its rates for 2026"
			},
			{
				num: 2,
				url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3482044/",
				type: "research",
				title: "Impact Evaluation of a Public Bicycle Share Program on Cycling: A Case Example of BIXI in Montreal"
			}
		],
		research_log: [
			"Montreal BIXI budget 2026 funding cuts expansion",
			"Montreal Climate Plan 2030 transportation targets BIXI",
			"impact of BIXI on air quality and public health Montreal research",
			"BIXI Montreal year-round service 2025 2026 news",
			"federal investment active transportation Montreal 2025 2026",
			"BIXI Montreal 100 million trips environmental impact"
		],
		delivery_config: {
			timing: "immediate",
			followUp: false,
			cwcEnabled: false
		},
		cwc_config: {},
		recipient_config: {
			reach: "location-specific",
			emails: [
				"soraya.martinezferrada@parl.gc.ca",
				"ministre@transports.gouv.qc.ca",
				"dominic.perri@montreal.ca",
				"serviceclient@velo.qc.ca",
				"vvezina@ccmm.ca",
				"mhjuneau@velo.qc.ca",
				"vvezina@ccmm.ca"
			],
			decisionMakers: [
				{
					name: "Soraya Martinez Ferrada",
					role: "Mayor",
					email: "soraya.martinezferrada@parl.gc.ca",
					shortName: "Ferrada",
					organization: "City of Montreal"
				},
				{
					name: "Sylvia Morin",
					role: "Chair",
					email: "",
					shortName: "Morin",
					organization: "BIXI Montréal"
				},
				{
					name: "Lucie Careau",
					role: "Director",
					email: "",
					shortName: "Careau",
					organization: "City of Montreal"
				},
				{
					name: "Jonatan Julien",
					role: "Minister of Transport and Sustainable Mobility",
					email: "ministre@transports.gouv.qc.ca",
					shortName: "Julien",
					organization: "Government of Quebec"
				},
				{
					name: "Caroline Quach-Thanh",
					role: "Director of Public Health",
					email: "",
					shortName: "Quach-Thanh",
					organization: "Direction régionale de santé publique de Montréal"
				},
				{
					name: "Dominic Perri",
					role: "Chair, Commission sur le transport et les travaux publics",
					email: "dominic.perri@montreal.ca",
					shortName: "Perri",
					organization: "City of Montreal"
				},
				{
					name: "Jean-François Rheault",
					role: "President and CEO",
					email: "serviceclient@velo.qc.ca",
					shortName: "Rheault",
					organization: "Vélo Québec"
				},
				{
					name: "Isabelle Dessureault",
					role: "President and CEO",
					email: "vvezina@ccmm.ca",
					shortName: "Dessureault",
					organization: "Chamber of Commerce of Metropolitan Montreal"
				},
				{
					name: "Marie-Hélène Juneau",
					role: "Vice-president, Communications, Marketing and Partnerships",
					email: "mhjuneau@velo.qc.ca",
					shortName: "Juneau",
					organization: "Vélo Québec"
				},
				{
					name: "Valérie Vézina",
					role: "Chief of Staff and Director, Communications",
					email: "vvezina@ccmm.ca",
					shortName: "Vézina",
					organization: "Chamber of Commerce of Metropolitan Montreal"
				}
			]
		},
		metrics: {
			sent: 0,
			views: 5,
			opened: 0,
			clicked: 0,
			responded: 0,
			total_districts: 338,
			districts_covered: 0,
			district_coverage_percent: 0
		},
		campaign_id: null,
		status: "published",
		is_public: true,
		verified_sends: 0,
		unique_districts: 0,
		avg_reputation: null,
		embedding_version: "v1",
		embeddings_updated_at: null,
		verification_status: "approved",
		country_code: "CA",
		reviewed_at: null,
		reviewed_by: null,
		flagged_by_moderation: false,
		consensus_approved: true,
		reputation_delta: 0,
		reputation_applied: false,
		content_hash: "866e4bf5718b33c2e63041061a6a21a4e1c9f0b0",
		createdAt: "2026-03-01T02:25:59.013Z",
		updatedAt: "2026-03-01T03:44:58.446Z",
		userId: "user-seed-2"
	},
	{
		id: "cmm74sfp0000ow9jih2xzdl63",
		slug: "apple-interest-gap",
		title: "Our entire year is worth fifteen minutes of interest",
		description: "Apple must bridge the gap between its corporate wealth and the compensation of the retail workers who sustain it.",
		category: "Labor Rights",
		topics: ["labor rights", "income inequality", "corporate accountability", "retail workers"],
		type: "advocacy",
		deliveryMethod: "email",
		preview: "It is a strange, hollow feeling to realize that while a retail worker spends an entire year dedicated to your customers, their total salary is eclipsed by just fifteen minutes of the interest generate",
		message_body: "It is a strange, hollow feeling to realize that while a retail worker spends an entire year dedicated to your customers, their total salary is eclipsed by just fifteen minutes of the interest generated by Apple’s cash reserves. We are not just line items or rounding errors; we are the hands and voices that sustain this brand, yet the gap between our reality and the company’s wealth has become an absurdity that is impossible to ignore.\n\n[Personal Connection]\n\nThis month, Apple reported record-breaking quarterly revenue of $143.8 billion [1]. While leadership saw total compensation packages reaching $74.3 million for the CEO and over $27 million for the SVP of Retail and People [3], the people on the store floors are facing a different reality. The tension of this inequality is showing: just eleven days ago, a new unfair labor practice charge was filed against Apple, alleging coercive statements and threats against employees exercising their rights [2]. This follows a broader national trend where CEO-to-worker pay gaps have widened to a staggering 632 to 1 [4].\n\nWhen we see the company return $32 billion to shareholders in a single quarter [1] while simultaneously facing allegations of suppressing worker voices [2], it signals that the people who make the Apple experience possible are being treated as a cost to be minimized rather than the core of the company’s success. We have seen that fair negotiation is possible, as demonstrated by the 10% raises and job security protections won by unionized workers in Maryland [5], but these should not be isolated victories.\n\nI am asking you to bridge this gap by establishing a company-wide compensation floor that reflects Apple’s historic profitability and by making a public commitment to end the coercive labor practices currently under investigation by the NLRB. We are watching how you choose to value the people who represent you every day.\n\n[Name]",
		sources: [
			{
				num: 1,
				url: "https://www.apple.com/newsroom/2026/01/apple-reports-first-quarter-results/",
				type: "government",
				title: "Apple reports first quarter results"
			},
			{
				num: 2,
				url: "https://www.nlrb.gov/case/32-CA-381430",
				type: "government",
				title: "Apple, Inc. - Case Number: 32-CA-381430"
			},
			{
				num: 3,
				url: "https://www.techinasia.com/apple-ceos-pay-holds-steady-74m-2025",
				type: "journalism",
				title: "Apple CEO's pay holds steady at $74m in 2025"
			},
			{
				num: 4,
				url: "https://ips-dc.org/report-executive-excess-2025/",
				type: "research",
				title: "Executive Excess 2025: The Low-Wage 100"
			},
			{
				num: 5,
				url: "https://www.retailtouchpoints.com/topics/store-operations/workforce-scheduling/apple-store-employee-union-wins-10-raises-for-maryland-store-workers",
				type: "journalism",
				title: "Apple Store Employee Union Wins 10% Raises for Maryland Store Workers"
			}
		],
		research_log: [
			"Apple Q1 2026 financial results revenue net income",
			"NLRB case Apple Inc. 32-CA-381430 February 2026",
			"Apple $5M lawsuit low-wage workers second jobs Washington 2026",
			"Tim Cook total compensation 2025 2026 proxy filing",
			"Institute for Policy Studies Executive Excess 2025 report",
			"Apple retail union Towson MD contract 10% raise 2024 2025"
		],
		delivery_config: {
			timing: "immediate",
			followUp: false,
			cwcEnabled: false
		},
		cwc_config: {},
		recipient_config: {
			reach: "location-specific",
			emails: [
				"tcook@apple.com",
				"apple-info@apple.com",
				"apple-info@apple.com",
				"apple-info@apple.com",
				"apple-info@apple.com",
				"media.help@apple.com"
			],
			decisionMakers: [
				{
					name: "Tim Cook",
					role: "CEO",
					email: "tcook@apple.com",
					shortName: "Cook",
					organization: "Apple Inc."
				},
				{
					name: "Deirdre O'Brien",
					role: "SVP of Retail + People",
					email: "apple-info@apple.com",
					shortName: "O'Brien",
					organization: "Apple Inc."
				},
				{
					name: "Arthur D. Levinson",
					role: "Chairman of the Board",
					email: "apple-info@apple.com",
					shortName: "Levinson",
					organization: "Apple Inc."
				},
				{
					name: "Claude Cummings Jr.",
					role: "President",
					email: "",
					shortName: "Jr.",
					organization: "Communications Workers of America"
				},
				{
					name: "Bianca Agustin and Terrysa Guerra",
					role: "Co-Executive Directors",
					email: "",
					shortName: "Guerra",
					organization: "United for Respect"
				},
				{
					name: "Bonnie Saynay",
					role: "Head of ESG Research",
					email: "",
					shortName: "Saynay",
					organization: "Institutional Shareholder Services (ISS)"
				},
				{
					name: "Andrea Jung",
					role: "Chair, People and Compensation Committee",
					email: "apple-info@apple.com",
					shortName: "Jung",
					organization: "Apple Inc. (Board of Directors)"
				},
				{
					name: "Kevan Parekh",
					role: "SVP and Chief Financial Officer",
					email: "apple-info@apple.com",
					shortName: "Parekh",
					organization: "Apple Inc."
				},
				{
					name: "Kristin Huguet Quayle",
					role: "Vice President, Worldwide Communications",
					email: "media.help@apple.com",
					shortName: "Quayle",
					organization: "Apple Inc."
				}
			]
		},
		metrics: {
			sent: 0,
			opened: 0,
			clicked: 0,
			responded: 0,
			total_districts: 435,
			districts_covered: 0,
			district_coverage_percent: 0
		},
		campaign_id: null,
		status: "draft",
		is_public: false,
		verified_sends: 0,
		unique_districts: 0,
		avg_reputation: null,
		embedding_version: "v1",
		embeddings_updated_at: null,
		verification_status: "pending",
		country_code: "US",
		reviewed_at: null,
		reviewed_by: null,
		flagged_by_moderation: false,
		consensus_approved: false,
		reputation_delta: 0,
		reputation_applied: false,
		content_hash: "938cb838a6598a0550e7296285713af65d8bc63f",
		createdAt: "2026-03-01T02:28:49.908Z",
		updatedAt: "2026-03-01T03:44:59.425Z",
		userId: "user-seed-1"
	},
	{
		id: "cmm784665000gw92vz7hbyin1",
		slug: "san-francisco-tax-dark-units",
		title: "Our neighbors sleep on concrete beside thousands of empty rooms",
		description: "San Francisco has 7,754 people sleeping outside while 40,458 housing units sit empty. The city's vacancy rate is 6.2% — twice the national average. A vacancy tax would cost landlords less than keeping units dark and cost the city nothing to enforce.",
		category: "Housing",
		topics: ["housing", "homelessness", "san-francisco", "vacancy-tax"],
		type: "advocacy",
		deliveryMethod: "email",
		preview: "It is a haunting, daily absurdity to walk past buildings with dark windows while 7,754 of our neighbors are forced to sleep on the concrete right outside those same walls. San Francisco currently has ",
		message_body: "It is a haunting, daily absurdity to walk past buildings with dark windows while 7,754 of our neighbors are forced to sleep on the concrete right outside those same walls. San Francisco currently has 40,458 housing units sitting empty—a vacancy rate of 6.2%, which is double the national average. \n\n[Personal Connection]\n\nIn November 2022, 54.5% of San Francisco voters approved Proposition M, the 'Empty Homes Tax,' because we recognized that housing must be for people, not just parked assets [1]. Research has already proven that this approach works; a similar tax in Vancouver successfully activated roughly 1,900 units in just two years and generated over $21 million for affordable housing [3]. \n\nAs of February 13, 2026, the city is still fighting a legal challenge to make this tax enforceable [2]. We cannot afford to let this stall any longer. The proposed tax rates of $2,500 to $5,000 per unit are a necessary tool to ensure that it is finally more expensive to keep a home empty than it is to house a human being [2]. \n\nI am asking you to use every resource at your disposal—legal, administrative, and political—to defend the will of the voters and implement the Empty Homes Tax immediately. We are watching how you prioritize the use of our city's existing housing stock, and we will remember who fought to open these doors.\n\n[Name]",
		sources: [
			{
				num: 1,
				url: "https://ballotpedia.org/San_Francisco,_California,_Proposition_M,_Create_Tax_on_Certain_Vacant_Residential_Units_Initiative_(November_2022)",
				type: "legal",
				title: "San Francisco Proposition M, Create Tax on Certain Vacant Residential Units Initiative (November 2022)"
			},
			{
				num: 2,
				url: "https://bornstein.law/san-francisco-vacancy-tax-facing-legal-challenge/",
				type: "legal",
				title: "San Francisco vacancy tax facing legal challenge"
			},
			{
				num: 3,
				url: "https://www.spur.org/voter-guide/2022-11/sf-prop-m-vacant-homes",
				type: "research",
				title: "San Francisco Prop M - Vacant Homes"
			}
		],
		research_log: [
			"San Francisco 7754 people sleeping outside 40458 housing units empty",
			"San Francisco residential vacancy rate 6.2% twice national average",
			"San Francisco Budget and Legislative Analyst residential vacancy report 40458",
			"San Francisco Proposition M vacancy tax status 2026",
			"San Francisco 2024 Point-in-Time count homelessness results",
			"San Francisco Empty Homes Tax legal appeal update 2026"
		],
		delivery_config: {
			timing: "immediate",
			followUp: false,
			cwcEnabled: false
		},
		cwc_config: {},
		recipient_config: {
			reach: "location-specific",
			emails: [
				"daniel.lurie@sfgov.org",
				"Rafael.Mandelman@sfgov.org",
				"cityattorney@sfcityatty.org",
				"chanstaff@sfgov.org",
				"matt.fleischer@sfchronicle.com",
				"opinion@sfchronicle.com",
				"opinion@sfchronicle.com",
				"opinion@sfchronicle.com",
				"maggie.angst@sfchronicle.com",
				"jdineen@sfchronicle.com",
				"fielderstaff@sfgov.org"
			],
			decisionMakers: [
				{
					name: "Daniel Lurie",
					role: "Mayor",
					email: "daniel.lurie@sfgov.org",
					shortName: "Lurie",
					organization: "City and County of San Francisco"
				},
				{
					name: "Rafael Mandelman",
					role: "President, Board of Supervisors",
					email: "Rafael.Mandelman@sfgov.org",
					shortName: "Mandelman",
					organization: "San Francisco Board of Supervisors"
				},
				{
					name: "José Cisneros",
					role: "Treasurer",
					email: "",
					shortName: "Cisneros",
					organization: "City and County of San Francisco"
				},
				{
					name: "David Chiu",
					role: "City Attorney",
					email: "cityattorney@sfcityatty.org",
					shortName: "Chiu",
					organization: "City and County of San Francisco"
				},
				{
					name: "Connie Chan",
					role: "Chair, Budget and Appropriations Committee",
					email: "chanstaff@sfgov.org",
					shortName: "Chan",
					organization: "San Francisco Board of Supervisors"
				},
				{
					name: "Shireen McSpadden",
					role: "Executive Director",
					email: "",
					shortName: "McSpadden",
					organization: "San Francisco Department of Homelessness and Supportive Housing"
				},
				{
					name: "Matthew Fleischer",
					role: "Editorial Page Editor",
					email: "matt.fleischer@sfchronicle.com",
					shortName: "Fleischer",
					organization: "San Francisco Chronicle"
				},
				{
					name: "David Knowles",
					role: "Deputy Opinion Editor",
					email: "opinion@sfchronicle.com",
					shortName: "Knowles",
					organization: "San Francisco Chronicle"
				},
				{
					name: "Allison Arieff",
					role: "Editorial Writer",
					email: "opinion@sfchronicle.com",
					shortName: "Arieff",
					organization: "San Francisco Chronicle"
				},
				{
					name: "Zeba Khan",
					role: "Editorial Board Member",
					email: "opinion@sfchronicle.com",
					shortName: "Khan",
					organization: "San Francisco Chronicle"
				},
				{
					name: "Maggie Angst",
					role: "Homelessness and Addiction Reporter",
					email: "maggie.angst@sfchronicle.com",
					shortName: "Angst",
					organization: "San Francisco Chronicle"
				},
				{
					name: "J.K. Dineen",
					role: "Reporter (Housing/Real Estate)",
					email: "jdineen@sfchronicle.com",
					shortName: "Dineen",
					organization: "San Francisco Chronicle"
				},
				{
					name: "Jackie Fielder",
					role: "Supervisor, District 9",
					email: "fielderstaff@sfgov.org",
					shortName: "Fielder",
					organization: "San Francisco Board of Supervisors"
				},
				{
					name: "David Augustine",
					role: "Tax Collector",
					email: "",
					shortName: "Augustine",
					organization: "City and County of San Francisco"
				},
				{
					name: "Amanda Fried",
					role: "Chief Assistant Treasurer",
					email: "",
					shortName: "Fried",
					organization: "City and County of San Francisco"
				},
				{
					name: "Deepa Varma",
					role: "Executive Director",
					email: "",
					shortName: "Varma",
					organization: "San Francisco Tenants Union"
				}
			]
		},
		metrics: {
			sent: 0,
			opened: 0,
			clicked: 0,
			responded: 0,
			total_districts: 435,
			districts_covered: 0,
			district_coverage_percent: 0
		},
		campaign_id: null,
		status: "published",
		is_public: true,
		verified_sends: 0,
		unique_districts: 0,
		avg_reputation: null,
		embedding_version: "v1",
		embeddings_updated_at: null,
		verification_status: "approved",
		country_code: "US",
		reviewed_at: null,
		reviewed_by: null,
		flagged_by_moderation: false,
		consensus_approved: true,
		reputation_delta: 0,
		reputation_applied: false,
		content_hash: "9803cbc0d8dd7183a72a9638cccd2e0133523bae",
		createdAt: "2026-03-01T04:01:56.284Z",
		updatedAt: "2026-03-01T04:01:56.284Z",
		userId: "user-seed-1"
	},
	{
		id: "cmm78e23l0011w92vz9mj8vlp",
		slug: "sfmta-vanity-subway",
		title: "SFMTA prioritizes empty subway tunnels over our daily commute",
		description: "SFMTA spent $300 million on the Central Subway that moves 3,600 riders per day — $83,000 per rider per year. Muni bus routes that serve 700,000 daily riders got a 4% budget cut. The city subsidizes engineering vanity projects while the transit people actually use falls apart.",
		category: "Transportation",
		topics: ["transit", "budget", "equity", "san-francisco", "infrastructure"],
		type: "advocacy",
		deliveryMethod: "email",
		preview: "It is demoralizing to wait for a bus that may never come while standing just blocks away from a multi-billion dollar subway tunnel that sits nearly empty. We are watching the transit San Francisco act",
		message_body: "It is demoralizing to wait for a bus that may never come while standing just blocks away from a multi-billion dollar subway tunnel that sits nearly empty. We are watching the transit San Francisco actually uses fall apart in real-time, while our tax dollars are locked in engineering vanity projects that don't serve the masses.\n\n[Personal Connection]\n\nWhile the Central Subway cost reached nearly $2 billion—including a $370 million cost overrun [1]—the new segment is only moving about 3,600 riders per day, which is just a third of its ridership goal [2]. At the same time, the SFMTA is moving forward with a 4% service cut to the bus network to save a relatively small $15 million [4]. These cuts are already hitting essential lines like the 5-Fulton and 9-San Bruno [3], which are the lifelines for the 700,000 daily riders who actually keep this city moving.\n\nInvesting $83,000 per rider in a subway segment while cutting service for the working people on the bus is a failure of both equity and basic math. You are choosing to subsidize empty tunnels over the daily commutes of your constituents.\n\nI am asking you to stop the pending Muni service cuts and prioritize the preservation of our core bus network in the upcoming budget. We need you to bridge the 'fiscal cliff' by prioritizing the riders who are already here, rather than chasing prestige projects that leave the rest of us stranded.\n\n[Name]",
		sources: [
			{
				num: 1,
				url: "https://www.sfmta.com/projects/central-subway-project",
				type: "government",
				title: "Central Subway Project - Cost and Funding"
			},
			{
				num: 2,
				url: "https://www.transittalent.com/articles/index.cfm?story_id=22334",
				type: "journalism",
				title: "S.F. spent nearly $2 billion on the Central Subway. Did it really help Chinatown?"
			},
			{
				num: 3,
				url: "https://thevoicesf.org/san-francisco-muni-cuts-service-on-three-routes-amid-budget-shortfall/",
				type: "journalism",
				title: "San Francisco Muni cuts service on three routes amid budget shortfall"
			},
			{
				num: 4,
				url: "https://sf.streetsblog.org/2025/02/06/advocates-push-back-against-pending-muni-service-cuts",
				type: "advocacy",
				title: "Advocates Push Back Against Pending Muni Service Cuts"
			}
		],
		research_log: [
			"SFMTA Central Subway total cost and budget overrun 2026",
			"SFMTA Central Subway ridership Chinatown station 2025 2026",
			"SFMTA 2025-2026 budget Muni service cuts 4 percent",
			"San Francisco Muni daily ridership recovery 2025 2026",
			"SFMTA fiscal cliff $300 million deficit 2026"
		],
		delivery_config: {
			timing: "immediate",
			followUp: false,
			cwcEnabled: false
		},
		cwc_config: {},
		recipient_config: {
			reach: "location-specific",
			emails: [
				"daniel.lurie@sfgov.org",
				"chanstaff@sfgov.org",
				"matt.fleischer@sfchronicle.com",
				"julie.kirschbaum@sfmta.com",
				"MTABoard@sfmta.com",
				"info@sfcta.org",
				"Rafael.Mandelman@sfgov.org",
				"afremier@bayareametro.gov",
				"president@twusf.org",
				"saramarie_80@hotmail.com",
				"Christine.Silva@sfmta.com",
				"abockelman@bayareametro.gov",
				"info@sfcta.org",
				"vicepresident@twusf.org",
				"reanne@sftransitriders.org",
				"communications@sfcta.org"
			],
			decisionMakers: [
				{
					name: "Daniel Lurie",
					role: "Mayor",
					email: "daniel.lurie@sfgov.org",
					shortName: "Lurie",
					organization: "City and County of San Francisco"
				},
				{
					name: "Connie Chan",
					role: "Chair, Budget and Appropriations Committee",
					email: "chanstaff@sfgov.org",
					shortName: "Chan",
					organization: "San Francisco Board of Supervisors"
				},
				{
					name: "Matthew Fleischer",
					role: "Editorial Page Editor",
					email: "matt.fleischer@sfchronicle.com",
					shortName: "Fleischer",
					organization: "San Francisco Chronicle"
				},
				{
					name: "Julie Kirschbaum",
					role: "Director of Transportation",
					email: "julie.kirschbaum@sfmta.com",
					shortName: "Kirschbaum",
					organization: "San Francisco Municipal Transportation Agency (SFMTA)"
				},
				{
					name: "Janet Tarlov",
					role: "Chair",
					email: "MTABoard@sfmta.com",
					shortName: "Tarlov",
					organization: "San Francisco Municipal Transportation Agency (SFMTA) Board of Directors"
				},
				{
					name: "Tilly Chang",
					role: "Executive Director",
					email: "info@sfcta.org",
					shortName: "Chang",
					organization: "San Francisco County Transportation Authority (SFCTA)"
				},
				{
					name: "Rafael Mandelman",
					role: "President",
					email: "Rafael.Mandelman@sfgov.org",
					shortName: "Mandelman",
					organization: "San Francisco Board of Supervisors"
				},
				{
					name: "Andrew Fremier",
					role: "Executive Director",
					email: "afremier@bayareametro.gov",
					shortName: "Fremier",
					organization: "Metropolitan Transportation Commission (MTC)"
				},
				{
					name: "Peter Wilson",
					role: "President",
					email: "president@twusf.org",
					shortName: "Wilson",
					organization: "Transport Workers Union (TWU) Local 250-A"
				},
				{
					name: "Sara Marie Johnson",
					role: "Executive Director",
					email: "saramarie_80@hotmail.com",
					shortName: "Johnson",
					organization: "San Francisco Transit Riders"
				},
				{
					name: "Christine Silva",
					role: "Secretary to the Board",
					email: "Christine.Silva@sfmta.com",
					shortName: "Silva",
					organization: "San Francisco Municipal Transportation Agency (SFMTA)"
				},
				{
					name: "Alix Bockelman",
					role: "Chief Deputy Executive Director",
					email: "abockelman@bayareametro.gov",
					shortName: "Bockelman",
					organization: "Metropolitan Transportation Commission (MTC)"
				},
				{
					name: "Anna LaForte",
					role: "Deputy Director for Policy and Programming",
					email: "info@sfcta.org",
					shortName: "LaForte",
					organization: "San Francisco County Transportation Authority (SFCTA)"
				},
				{
					name: "Diana Moreira",
					role: "Vice President/Staff Rep",
					email: "vicepresident@twusf.org",
					shortName: "Moreira",
					organization: "Transport Workers Union (TWU) Local 250-A"
				},
				{
					name: "Reanne",
					role: "Media Contact",
					email: "reanne@sftransitriders.org",
					shortName: "Reanne",
					organization: "San Francisco Transit Riders"
				},
				{
					name: "Stephen Chun",
					role: "Director of Communications",
					email: "communications@sfcta.org",
					shortName: "Chun",
					organization: "San Francisco County Transportation Authority (SFCTA)"
				}
			]
		},
		metrics: {
			sent: 0,
			opened: 0,
			clicked: 0,
			responded: 0,
			total_districts: 435,
			districts_covered: 0,
			district_coverage_percent: 0
		},
		campaign_id: null,
		status: "published",
		is_public: true,
		verified_sends: 0,
		unique_districts: 0,
		avg_reputation: null,
		embedding_version: "v1",
		embeddings_updated_at: null,
		verification_status: "approved",
		country_code: "US",
		reviewed_at: null,
		reviewed_by: null,
		flagged_by_moderation: false,
		consensus_approved: true,
		reputation_delta: 0,
		reputation_applied: false,
		content_hash: "2d459f4a5ac0eca7d9f619ab1e8d011ec6625c76",
		createdAt: "2026-03-01T04:09:37.568Z",
		updatedAt: "2026-03-01T04:09:37.568Z",
		userId: "user-seed-1"
	},
	{
		id: "cmm78hm42001jw92vnpcgo6q3",
		slug: "san-francisco-sites-not-sweeps",
		title: "Our neighbors are dying while you sweep the streets",
		description: "The City of San Francisco must establish supervised consumption sites in the Tenderloin to prevent overdose deaths and end the displacement of residents through sweeps.",
		category: "Public Health",
		topics: ["harm reduction", "public health", "san francisco", "tenderloin", "housing justice"],
		type: "advocacy",
		deliveryMethod: "email",
		preview: "It is devastating to walk through the Tenderloin and realize that the people we see being moved from block to block are the same ones we might read about in the next coroner’s report. We are watching ",
		message_body: "It is devastating to walk through the Tenderloin and realize that the people we see being moved from block to block are the same ones we might read about in the next coroner’s report. We are watching a cycle of displacement that prioritizes the appearance of clean streets over the survival of our neighbors, and the cost is being measured in human lives.\n\n[Personal Connection]\n\nIn January 2026 alone, San Francisco saw 53 overdose deaths—a staggering jump from the month prior [2]. This follows a year where 624 people died from accidental overdoses, with fentanyl remaining the primary killer [1]. While the city focuses on 'RESET' centers and a recovery-first mandate [3], the reality on the ground is that enforcement-led sweeps are making the crisis worse. Research shows that these sweeps don't reduce homelessness; they just shift people to different blocks [4]. More dangerously, displacing people who use drugs increases their risk of premature death by up to 25% and significantly raises the likelihood of overdose [5].\n\nWe know how to stop the dying. When the Tenderloin Center was open, staff reversed 333 overdoses with zero fatalities [6]. We don't need more sweeps that destabilize vulnerable people; we need supervised consumption sites that keep them alive long enough to choose recovery. I am asking you to immediately authorize and fund supervised consumption sites in the Tenderloin and end the counterproductive practice of street sweeps that only serve to hide the crisis rather than solve it.\n\n[Name]",
		sources: [
			{
				num: 1,
				url: "https://media.api.sf.gov/documents/2026_02_OCME_Overdose_Report_i9omIob.pdf",
				type: "government",
				title: "Report on 2025 Accidental Overdose Deaths"
			},
			{
				num: 2,
				url: "https://localnewsmatters.org/2026/02/15/san-francisco-sees-spike-in-overdose-deaths-as-health-officials-pilot-injectable-treatment/",
				type: "journalism",
				title: "San Francisco sees spike in overdose deaths as health officials pilot injectable treatment"
			},
			{
				num: 3,
				url: "https://www.sf.gov/news-mayor-luries-statement-on-2025-overdose-deaths-lowest-since-fentanyl-crisis-hit",
				type: "government",
				title: "Mayor Lurie's Statement on 2025 Overdose Deaths: Lowest Since Fentanyl Crisis Hit"
			},
			{
				num: 4,
				url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11835865/",
				type: "research",
				title: "Geospatial evaluation of San Francisco, California's homeless encampment sweeps injunction"
			},
			{
				num: 5,
				url: "https://www.themarshallproject.org/2025/11/20/california-police-homeless-los-angeles",
				type: "journalism",
				title: "Homeless Camp Sweeps Can Harm Health. Some Cities Are Trying a New Way."
			},
			{
				num: 6,
				url: "https://missionlocal.org/2023/08/tenderloin-drug-overdose-site-oxygen/",
				type: "journalism",
				title: "San Francisco Tenderloin OD-prevention site saved lives, per study"
			}
		],
		research_log: [
			"San Francisco overdose death statistics 2025 2026 official report",
			"San Francisco supervised consumption sites Tenderloin 2026 update",
			"impact of street sweeps on overdose risk San Francisco 2025 2026",
			"San Francisco Department of Public Health RESET center Tenderloin 2026",
			"JAMA study homeless encampment sweeps overdose mortality 2025"
		],
		delivery_config: {
			timing: "immediate",
			followUp: false,
			cwcEnabled: false
		},
		cwc_config: {},
		recipient_config: {
			reach: "location-specific",
			emails: [
				"daniel.lurie@sfgov.org",
				"chanstaff@sfgov.org",
				"april.crawford@sfdph.org",
				"cityattorney@sfcityatty.org",
				"DorseyStaff@sfgov.org",
				"publicworks.commission@sfdpw.org",
				"SFPDchief@sfgov.org",
				"publicworks.commission@sfdpw.org",
				"april.crawford@sfdph.org",
				"april.crawford@sfdph.org"
			],
			decisionMakers: [
				{
					name: "Daniel Lurie",
					role: "Mayor",
					email: "daniel.lurie@sfgov.org",
					shortName: "Lurie",
					organization: "City and County of San Francisco"
				},
				{
					name: "Connie Chan",
					role: "Chair, Budget and Appropriations Committee",
					email: "chanstaff@sfgov.org",
					shortName: "Chan",
					organization: "San Francisco Board of Supervisors"
				},
				{
					name: "Daniel Tsai",
					role: "Director of Health",
					email: "april.crawford@sfdph.org",
					shortName: "Tsai",
					organization: "San Francisco Department of Public Health"
				},
				{
					name: "David Chiu",
					role: "City Attorney",
					email: "cityattorney@sfcityatty.org",
					shortName: "Chiu",
					organization: "Office of the City Attorney of San Francisco"
				},
				{
					name: "Matt Dorsey",
					role: "District 6 Supervisor",
					email: "DorseyStaff@sfgov.org",
					shortName: "Dorsey",
					organization: "San Francisco Board of Supervisors"
				},
				{
					name: "Carla Short",
					role: "Director of Public Works",
					email: "publicworks.commission@sfdpw.org",
					shortName: "Short",
					organization: "San Francisco Public Works"
				},
				{
					name: "Derrick Lew",
					role: "Chief of Police",
					email: "SFPDchief@sfgov.org",
					shortName: "Lew",
					organization: "San Francisco Police Department"
				},
				{
					name: "Gavin Newsom",
					role: "Governor",
					email: "",
					shortName: "Newsom",
					organization: "State of California"
				},
				{
					name: "Jennifer Friedenbach",
					role: "Executive Director",
					email: "",
					shortName: "Friedenbach",
					organization: "Coalition on Homelessness, San Francisco"
				},
				{
					name: "Craig H. Missakian",
					role: "U.S. Attorney",
					email: "",
					shortName: "Missakian",
					organization: "U.S. Department of Justice (Northern District of California)"
				},
				{
					name: "Fady Zoubi",
					role: "Chair",
					email: "publicworks.commission@sfdpw.org",
					shortName: "Zoubi",
					organization: "Public Works Commission"
				},
				{
					name: "Tangerine Brigham",
					role: "Chief Operating and Strategy Officer",
					email: "april.crawford@sfdph.org",
					shortName: "Brigham",
					organization: "San Francisco Health Network"
				},
				{
					name: "April Johnson Crawford",
					role: "Policy Editor / CDTA Program Manager",
					email: "april.crawford@sfdph.org",
					shortName: "Crawford",
					organization: "San Francisco Department of Public Health"
				}
			]
		},
		metrics: {
			sent: 0,
			opened: 0,
			clicked: 0,
			responded: 0,
			total_districts: 435,
			districts_covered: 0,
			district_coverage_percent: 0
		},
		campaign_id: null,
		status: "published",
		is_public: true,
		verified_sends: 0,
		unique_districts: 0,
		avg_reputation: null,
		embedding_version: "v1",
		embeddings_updated_at: null,
		verification_status: "approved",
		country_code: "US",
		reviewed_at: null,
		reviewed_by: null,
		flagged_by_moderation: false,
		consensus_approved: true,
		reputation_delta: 0,
		reputation_applied: false,
		content_hash: "b923bfe340c6271b48c3aad61f740aabc0f132be",
		createdAt: "2026-03-01T04:12:23.474Z",
		updatedAt: "2026-03-01T04:12:23.474Z",
		userId: "user-seed-1"
	}
];

// ============================================================================
// SEED DATA -- Template Scopes
// ============================================================================

const SCOPES = [
	{
		id: "cmm71jkr8000jw9j8a2acbmfu",
		template_id: "cmm71jjk4000hw9j8j2fi57w3",
		country_code: "US",
		region_code: null,
		locality_code: null,
		district_code: null,
		display_text: "nationwide",
		scope_level: "country",
		power_structure_type: null,
		audience_filter: null,
		scope_notes: null,
		confidence: 1,
		extraction_method: "gemini_inline",
		validated_against: null,
		estimated_reach: null,
		latitude: null,
		longitude: null,
		created_at: "2026-03-01T00:57:57.716Z",
		updated_at: "2026-03-01T00:57:57.716Z"
	},
	{
		id: "cmm71m64g000xw9j82tai7u2z",
		template_id: "cmm71m52p000vw9j8h7xq9tml",
		country_code: "US",
		region_code: null,
		locality_code: null,
		district_code: null,
		display_text: "nationwide",
		scope_level: "country",
		power_structure_type: null,
		audience_filter: null,
		scope_notes: null,
		confidence: 1,
		extraction_method: "gemini_inline",
		validated_against: null,
		estimated_reach: null,
		latitude: null,
		longitude: null,
		created_at: "2026-03-01T00:59:58.720Z",
		updated_at: "2026-03-01T00:59:58.720Z"
	},
	{
		id: "cmm71r4am001fw9j8bljx9zb4",
		template_id: "cmm71r36p001dw9j86xvo45gl",
		country_code: "US",
		region_code: null,
		locality_code: null,
		district_code: null,
		display_text: "nationwide",
		scope_level: "country",
		power_structure_type: null,
		audience_filter: null,
		scope_notes: null,
		confidence: 1,
		extraction_method: "gemini_inline",
		validated_against: null,
		estimated_reach: null,
		latitude: null,
		longitude: null,
		created_at: "2026-03-01T01:03:49.631Z",
		updated_at: "2026-03-01T01:03:49.631Z"
	},
	{
		id: "cmm71vo6h001ww9j8pqpp3jtz",
		template_id: "cmm71vmvy001uw9j8jrl3b0kj",
		country_code: "US",
		region_code: "US-OR",
		locality_code: null,
		district_code: null,
		display_text: "subnational",
		scope_level: "region",
		power_structure_type: null,
		audience_filter: null,
		scope_notes: null,
		confidence: 1,
		extraction_method: "gemini_inline",
		validated_against: null,
		estimated_reach: null,
		latitude: null,
		longitude: null,
		created_at: "2026-03-01T01:07:22.025Z",
		updated_at: "2026-03-01T01:07:22.025Z"
	},
	{
		id: "cmm72angx002uw9j8hqap1tow",
		template_id: "cmm72am5j002sw9j8nzvtk3vn",
		country_code: "US",
		region_code: null,
		locality_code: null,
		district_code: null,
		display_text: "nationwide",
		scope_level: "country",
		power_structure_type: null,
		audience_filter: null,
		scope_notes: null,
		confidence: 1,
		extraction_method: "gemini_inline",
		validated_against: null,
		estimated_reach: null,
		latitude: null,
		longitude: null,
		created_at: "2026-03-01T01:19:00.946Z",
		updated_at: "2026-03-01T01:19:00.946Z"
	},
	{
		id: "cmm72kxpp003fw9j88zjgimx3",
		template_id: "cmm72kwfm003dw9j8o5k9vygp",
		country_code: "CA",
		region_code: null,
		locality_code: null,
		district_code: null,
		display_text: "nationwide",
		scope_level: "country",
		power_structure_type: null,
		audience_filter: null,
		scope_notes: null,
		confidence: 1,
		extraction_method: "gemini_inline",
		validated_against: null,
		estimated_reach: null,
		latitude: null,
		longitude: null,
		created_at: "2026-03-01T01:27:00.782Z",
		updated_at: "2026-03-01T01:27:00.782Z"
	},
	{
		id: "cmm72x2ff0040w9j8q7oen4vw",
		template_id: "cmm72x0st003yw9j8uo8xvcfv",
		country_code: "US",
		region_code: null,
		locality_code: null,
		district_code: null,
		display_text: "nationwide",
		scope_level: "country",
		power_structure_type: null,
		audience_filter: null,
		scope_notes: null,
		confidence: 1,
		extraction_method: "gemini_inline",
		validated_against: null,
		estimated_reach: null,
		latitude: null,
		longitude: null,
		created_at: "2026-03-01T01:36:26.763Z",
		updated_at: "2026-03-01T01:36:26.763Z"
	},
	{
		id: "cmm730pf1004lw9j8nlcrwkwm",
		template_id: "cmm730o92004jw9j85uu4mcok",
		country_code: "CA",
		region_code: "CA-ON",
		locality_code: null,
		district_code: null,
		display_text: "subnational",
		scope_level: "region",
		power_structure_type: null,
		audience_filter: null,
		scope_notes: null,
		confidence: 1,
		extraction_method: "gemini_inline",
		validated_against: null,
		estimated_reach: null,
		latitude: null,
		longitude: null,
		created_at: "2026-03-01T01:39:16.525Z",
		updated_at: "2026-03-01T01:39:16.525Z"
	},
	{
		id: "cmm734pl70053w9j8c4ol9h4s",
		template_id: "cmm734ojb0051w9j82j1g9px2",
		country_code: "CA",
		region_code: "BC",
		locality_code: null,
		district_code: null,
		display_text: "subnational",
		scope_level: "region",
		power_structure_type: null,
		audience_filter: null,
		scope_notes: null,
		confidence: 1,
		extraction_method: "gemini_inline",
		validated_against: null,
		estimated_reach: null,
		latitude: null,
		longitude: null,
		created_at: "2026-03-01T01:42:23.372Z",
		updated_at: "2026-03-01T01:42:23.372Z"
	},
	{
		id: "cmm74oswj000cw9jiq66y7ul9",
		template_id: "cmm74ortw000aw9jib8yfko06",
		country_code: "CA",
		region_code: "CA-QC",
		locality_code: "Montreal",
		district_code: null,
		display_text: "subnational",
		scope_level: "locality",
		power_structure_type: null,
		audience_filter: null,
		scope_notes: null,
		confidence: 1,
		extraction_method: "gemini_inline",
		validated_against: null,
		estimated_reach: null,
		latitude: null,
		longitude: null,
		created_at: "2026-03-01T02:26:00.404Z",
		updated_at: "2026-03-01T02:26:00.404Z"
	},
	{
		id: "cmm74sgmm000qw9ji1e69r004",
		template_id: "cmm74sfp0000ow9jih2xzdl63",
		country_code: "US",
		region_code: null,
		locality_code: null,
		district_code: null,
		display_text: "nationwide",
		scope_level: "country",
		power_structure_type: null,
		audience_filter: null,
		scope_notes: null,
		confidence: 1,
		extraction_method: "gemini_inline",
		validated_against: null,
		estimated_reach: null,
		latitude: null,
		longitude: null,
		created_at: "2026-03-01T02:28:51.118Z",
		updated_at: "2026-03-01T02:28:51.118Z"
	},
	{
		id: "cmm7846xv000iw92vv491ms73",
		template_id: "cmm784665000gw92vz7hbyin1",
		country_code: "US",
		region_code: "US-CA",
		locality_code: "San Francisco",
		district_code: null,
		display_text: "subnational",
		scope_level: "locality",
		power_structure_type: null,
		audience_filter: null,
		scope_notes: null,
		confidence: 1,
		extraction_method: "gemini_inline",
		validated_against: null,
		estimated_reach: null,
		latitude: null,
		longitude: null,
		created_at: "2026-03-01T04:01:57.283Z",
		updated_at: "2026-03-01T04:01:57.283Z"
	},
	{
		id: "cmm78e2tz0013w92vg1sxaqew",
		template_id: "cmm78e23l0011w92vz9mj8vlp",
		country_code: "US",
		region_code: "US-CA",
		locality_code: "San Francisco",
		district_code: null,
		display_text: "subnational",
		scope_level: "locality",
		power_structure_type: null,
		audience_filter: null,
		scope_notes: null,
		confidence: 1,
		extraction_method: "gemini_inline",
		validated_against: null,
		estimated_reach: null,
		latitude: null,
		longitude: null,
		created_at: "2026-03-01T04:09:38.517Z",
		updated_at: "2026-03-01T04:09:38.517Z"
	},
	{
		id: "cmm78hmuj001lw92vm6orlkwl",
		template_id: "cmm78hm42001jw92vnpcgo6q3",
		country_code: "US",
		region_code: "US-CA",
		locality_code: "San Francisco",
		district_code: null,
		display_text: "subnational",
		scope_level: "locality",
		power_structure_type: null,
		audience_filter: null,
		scope_notes: null,
		confidence: 1,
		extraction_method: "gemini_inline",
		validated_against: null,
		estimated_reach: null,
		latitude: null,
		longitude: null,
		created_at: "2026-03-01T04:12:24.428Z",
		updated_at: "2026-03-01T04:12:24.428Z"
	}
];

// ============================================================================
// SEED DATA -- Template Jurisdictions
// ============================================================================

const JURISDICTIONS = [
	{
		id: "cmm71jldr000lw9j8j4finyzo",
		template_id: "cmm71jjk4000hw9j8j2fi57w3",
		jurisdiction_type: "federal",
		congressional_district: null,
		senate_class: null,
		state_code: null,
		state_senate_district: null,
		state_house_district: null,
		county_fips: null,
		county_name: null,
		city_name: null,
		city_fips: null,
		school_district_id: null,
		school_district_name: null,
		latitude: null,
		longitude: null,
		estimated_population: null,
		coverage_notes: null,
		created_at: "2026-03-01T00:57:58.527Z",
		updated_at: "2026-03-01T00:57:58.527Z"
	},
	{
		id: "cmm71m6mt000zw9j81fuwf6oo",
		template_id: "cmm71m52p000vw9j8h7xq9tml",
		jurisdiction_type: "federal",
		congressional_district: null,
		senate_class: null,
		state_code: null,
		state_senate_district: null,
		state_house_district: null,
		county_fips: null,
		county_name: null,
		city_name: null,
		city_fips: null,
		school_district_id: null,
		school_district_name: null,
		latitude: null,
		longitude: null,
		estimated_population: null,
		coverage_notes: null,
		created_at: "2026-03-01T00:59:59.382Z",
		updated_at: "2026-03-01T00:59:59.382Z"
	},
	{
		id: "cmm71r4sf001hw9j8eq4kc5nd",
		template_id: "cmm71r36p001dw9j86xvo45gl",
		jurisdiction_type: "federal",
		congressional_district: null,
		senate_class: null,
		state_code: null,
		state_senate_district: null,
		state_house_district: null,
		county_fips: null,
		county_name: null,
		city_name: null,
		city_fips: null,
		school_district_id: null,
		school_district_name: null,
		latitude: null,
		longitude: null,
		estimated_population: null,
		coverage_notes: null,
		created_at: "2026-03-01T01:03:50.271Z",
		updated_at: "2026-03-01T01:03:50.271Z"
	},
	{
		id: "cmm71vora001yw9j8683p4mkp",
		template_id: "cmm71vmvy001uw9j8jrl3b0kj",
		jurisdiction_type: "state",
		congressional_district: null,
		senate_class: null,
		state_code: "US-OR",
		state_senate_district: null,
		state_house_district: null,
		county_fips: null,
		county_name: null,
		city_name: null,
		city_fips: null,
		school_district_id: null,
		school_district_name: null,
		latitude: null,
		longitude: null,
		estimated_population: null,
		coverage_notes: null,
		created_at: "2026-03-01T01:07:22.774Z",
		updated_at: "2026-03-01T01:07:22.774Z"
	},
	{
		id: "cmm721bvg002ew9j8478h8g7i",
		template_id: "cmm721asi002cw9j8l2g97yj2",
		jurisdiction_type: "federal",
		congressional_district: null,
		senate_class: null,
		state_code: null,
		state_senate_district: null,
		state_house_district: null,
		county_fips: null,
		county_name: null,
		city_name: null,
		city_fips: null,
		school_district_id: null,
		school_district_name: null,
		latitude: null,
		longitude: null,
		estimated_population: null,
		coverage_notes: null,
		created_at: "2026-03-01T01:11:46.012Z",
		updated_at: "2026-03-01T01:11:46.012Z"
	},
	{
		id: "cmm72anzn002ww9j85vcp1h4d",
		template_id: "cmm72am5j002sw9j8nzvtk3vn",
		jurisdiction_type: "city",
		congressional_district: null,
		senate_class: null,
		state_code: null,
		state_senate_district: null,
		state_house_district: null,
		county_fips: null,
		county_name: null,
		city_name: null,
		city_fips: null,
		school_district_id: null,
		school_district_name: null,
		latitude: null,
		longitude: null,
		estimated_population: null,
		coverage_notes: null,
		created_at: "2026-03-01T01:19:01.619Z",
		updated_at: "2026-03-01T01:19:01.619Z"
	},
	{
		id: "cmm72kymd003hw9j8najxazpn",
		template_id: "cmm72kwfm003dw9j8o5k9vygp",
		jurisdiction_type: "federal",
		congressional_district: null,
		senate_class: null,
		state_code: null,
		state_senate_district: null,
		state_house_district: null,
		county_fips: null,
		county_name: null,
		city_name: null,
		city_fips: null,
		school_district_id: null,
		school_district_name: null,
		latitude: null,
		longitude: null,
		estimated_population: null,
		coverage_notes: null,
		created_at: "2026-03-01T01:27:01.957Z",
		updated_at: "2026-03-01T01:27:01.957Z"
	},
	{
		id: "cmm72x2yp0042w9j8opiqequd",
		template_id: "cmm72x0st003yw9j8uo8xvcfv",
		jurisdiction_type: "federal",
		congressional_district: null,
		senate_class: null,
		state_code: null,
		state_senate_district: null,
		state_house_district: null,
		county_fips: null,
		county_name: null,
		city_name: null,
		city_fips: null,
		school_district_id: null,
		school_district_name: null,
		latitude: null,
		longitude: null,
		estimated_population: null,
		coverage_notes: null,
		created_at: "2026-03-01T01:36:27.457Z",
		updated_at: "2026-03-01T01:36:27.457Z"
	},
	{
		id: "cmm730q14004nw9j8gxwl3fwm",
		template_id: "cmm730o92004jw9j85uu4mcok",
		jurisdiction_type: "state",
		congressional_district: null,
		senate_class: null,
		state_code: "CA-ON",
		state_senate_district: null,
		state_house_district: null,
		county_fips: null,
		county_name: null,
		city_name: null,
		city_fips: null,
		school_district_id: null,
		school_district_name: null,
		latitude: null,
		longitude: null,
		estimated_population: null,
		coverage_notes: null,
		created_at: "2026-03-01T01:39:17.320Z",
		updated_at: "2026-03-01T01:39:17.320Z"
	},
	{
		id: "cmm734q1s0055w9j8ktst8730",
		template_id: "cmm734ojb0051w9j82j1g9px2",
		jurisdiction_type: "state",
		congressional_district: null,
		senate_class: null,
		state_code: "BC",
		state_senate_district: null,
		state_house_district: null,
		county_fips: null,
		county_name: null,
		city_name: null,
		city_fips: null,
		school_district_id: null,
		school_district_name: null,
		latitude: null,
		longitude: null,
		estimated_population: null,
		coverage_notes: null,
		created_at: "2026-03-01T01:42:23.968Z",
		updated_at: "2026-03-01T01:42:23.968Z"
	},
	{
		id: "cmm74othr000ew9jif2nsno39",
		template_id: "cmm74ortw000aw9jib8yfko06",
		jurisdiction_type: "city",
		congressional_district: null,
		senate_class: null,
		state_code: "CA-QC",
		state_senate_district: null,
		state_house_district: null,
		county_fips: null,
		county_name: null,
		city_name: null,
		city_fips: null,
		school_district_id: null,
		school_district_name: null,
		latitude: null,
		longitude: null,
		estimated_population: null,
		coverage_notes: null,
		created_at: "2026-03-01T02:26:01.167Z",
		updated_at: "2026-03-01T02:26:01.167Z"
	},
	{
		id: "cmm74sh46000sw9jikm64usck",
		template_id: "cmm74sfp0000ow9jih2xzdl63",
		jurisdiction_type: "federal",
		congressional_district: null,
		senate_class: null,
		state_code: null,
		state_senate_district: null,
		state_house_district: null,
		county_fips: null,
		county_name: null,
		city_name: null,
		city_fips: null,
		school_district_id: null,
		school_district_name: null,
		latitude: null,
		longitude: null,
		estimated_population: null,
		coverage_notes: null,
		created_at: "2026-03-01T02:28:51.751Z",
		updated_at: "2026-03-01T02:28:51.751Z"
	},
	{
		id: "cmm7847fy000kw92vf86umeve",
		template_id: "cmm784665000gw92vz7hbyin1",
		jurisdiction_type: "city",
		congressional_district: null,
		senate_class: null,
		state_code: "US-CA",
		state_senate_district: null,
		state_house_district: null,
		county_fips: null,
		county_name: null,
		city_name: null,
		city_fips: null,
		school_district_id: null,
		school_district_name: null,
		latitude: null,
		longitude: null,
		estimated_population: null,
		coverage_notes: null,
		created_at: "2026-03-01T04:01:57.934Z",
		updated_at: "2026-03-01T04:01:57.934Z"
	},
	{
		id: "cmm78e38g0015w92vhy4eyper",
		template_id: "cmm78e23l0011w92vz9mj8vlp",
		jurisdiction_type: "city",
		congressional_district: null,
		senate_class: null,
		state_code: "US-CA",
		state_senate_district: null,
		state_house_district: null,
		county_fips: null,
		county_name: null,
		city_name: null,
		city_fips: null,
		school_district_id: null,
		school_district_name: null,
		latitude: null,
		longitude: null,
		estimated_population: null,
		coverage_notes: null,
		created_at: "2026-03-01T04:09:39.040Z",
		updated_at: "2026-03-01T04:09:39.040Z"
	},
	{
		id: "cmm78hn96001nw92vw6gusi6u",
		template_id: "cmm78hm42001jw92vnpcgo6q3",
		jurisdiction_type: "city",
		congressional_district: null,
		senate_class: null,
		state_code: "US-CA",
		state_senate_district: null,
		state_house_district: null,
		county_fips: null,
		county_name: null,
		city_name: null,
		city_fips: null,
		school_district_id: null,
		school_district_name: null,
		latitude: null,
		longitude: null,
		estimated_population: null,
		coverage_notes: null,
		created_at: "2026-03-01T04:12:24.954Z",
		updated_at: "2026-03-01T04:12:24.954Z"
	}
];


// SEED DATA -- Debates (built on actual resolved templates)
// ============================================================================

function hashText(text: string): string {
	return keccak256(toUtf8Bytes(text));
}

const WALLET_ADDRS = [
	'0x42aBe6E1fBf6436720bbCF9db8B0c115cF7650fF',
	'0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
	'0xdAC17F958D2ee523a2206206994597C13D831ec7',
	'0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
];

const now = Date.now();
const DAY = 86_400_000;

// Template ID mapping (from agent pipeline runs 2026-03-01)
const TEMPLATE_IDS = {
	COPPA: 'cmm71m52p000vw9j8h7xq9tml',
	HOUSING: 'cmm721asi002cw9j8l2g97yj2',
	PARKS: 'cmm72kwfm003dw9j8o5k9vygp',
	APPLE: 'cmm74sfp0000ow9jih2xzdl63',
	SF_VACANCY: 'cmm784665000gw92vz7hbyin1',
	SF_TRANSIT: 'cmm78e23l0011w92vz9mj8vlp',
	SF_OVERDOSE: 'cmm78hm42001jw92vnpcgo6q3',
} as const;

interface DebateSeed {
	id: string;
	template_id: string;
	debate_id_onchain: string;
	proposition_text: string;
	status: string;
	deadline: Date;
	jurisdiction_size: number;
	proposer_index: number;
	proposer_bond: bigint;
	market_status: string;
	market_liquidity: bigint | null;
	current_prices: Record<string, string> | null;
	current_epoch: number;
	trade_deadline: Date | null;
	resolution_deadline: Date | null;
	ai_resolution: Record<string, unknown> | null;
	ai_signature_count: number | null;
	ai_panel_consensus: number | null;
	resolution_method: string | null;
	appeal_deadline: Date | null;
	governance_justification: string | null;
	winning_argument_index: number | null;
	winning_stance: string | null;
	resolved_at: Date | null;
	arguments: Array<{
		stance: string;
		body: string;
		amendment_text: string | null;
		stake_amount: bigint;
		engagement_tier: number;
		weighted_score: number;
		total_stake: bigint;
		co_sign_count: number;
		current_price: string | null;
		price_history: Array<{ epoch: number; price: string; timestamp: string }> | null;
		position_count: number;
		ai_scores: Record<string, number> | null;
		ai_weighted: number | null;
		final_score: number | null;
		model_agreement: number | null;
	}>;
}

const DEBATES: DebateSeed[] = [
	// ── Debate 1: COPPA (resolved, AI-scored) ──────────────────
	{
		id: 'debate-seed-coppa',
		template_id: TEMPLATE_IDS.COPPA,
		debate_id_onchain: '0x' + 'c0'.repeat(32),
		proposition_text: 'Congress must pass COPPA 2.0 (HR 6291) to extend privacy protections to all minors under 17 and ban targeted advertising to children.',
		status: 'resolved',
		deadline: new Date(now - 3 * DAY),
		jurisdiction_size: 435,
		proposer_index: 0,
		proposer_bond: BigInt('1000000'),
		market_status: 'resolved',
		market_liquidity: BigInt('5000000'),
		current_prices: { '0': '0.28', '1': '0.52', '2': '0.20' },
		current_epoch: 4,
		trade_deadline: new Date(now - 3 * DAY),
		resolution_deadline: new Date(now - 2 * DAY),
		ai_resolution: {
			scores: [
				{ argumentIndex: 0, medianScores: { reasoning: 7400, accuracy: 7100, evidence: 7800, constructiveness: 7600, feasibility: 6200 }, weightedScore: 7280, modelAgreement: 0.85 },
				{ argumentIndex: 1, medianScores: { reasoning: 8600, accuracy: 8400, evidence: 8200, constructiveness: 8800, feasibility: 8100 }, weightedScore: 8460, modelAgreement: 0.94 },
				{ argumentIndex: 2, medianScores: { reasoning: 5900, accuracy: 6200, evidence: 5500, constructiveness: 5100, feasibility: 7200 }, weightedScore: 5900, modelAgreement: 0.68 },
			],
			models: [
				{ provider: 0, modelName: 'GPT-5 Nano', timestamp: now - 300000 },
				{ provider: 1, modelName: 'Gemini 3 Flash', timestamp: now - 295000 },
				{ provider: 2, modelName: 'DeepSeek V3.2', timestamp: now - 290000 },
				{ provider: 3, modelName: 'Mistral Large 3', timestamp: now - 285000 },
				{ provider: 4, modelName: 'Claude Haiku 4.5', timestamp: now - 280000 },
			],
			consensusAchieved: true,
			evaluatedAt: new Date(now - 2 * DAY).toISOString(),
			submitTxHash: '0x' + 'a1b2c3'.repeat(11).slice(0, 64),
			resolveTxHash: '0x' + 'd4e5f6'.repeat(11).slice(0, 64),
			gasUsed: '2145610',
		},
		ai_signature_count: 5,
		ai_panel_consensus: 0.89,
		resolution_method: 'ai_community',
		appeal_deadline: null,
		governance_justification: null,
		winning_argument_index: 1,
		winning_stance: 'AMEND',
		resolved_at: new Date(now - 2 * DAY),
		arguments: [
			{
				stance: 'SUPPORT',
				body: 'The current COPPA framework is a relic from 1998 that predates social media, smartphone apps, and algorithmic targeting. Children under 13 receive minimal protection while 13-16 year olds get none at all. Passing COPPA 2.0 is not just good policy — it is a moral obligation. The 72 million data points harvested per child annually represent a surveillance apparatus that no democratic society should tolerate for its most vulnerable members.',
				amendment_text: null,
				stake_amount: BigInt('1200000'),
				engagement_tier: 3,
				weighted_score: 8763560,
				total_stake: BigInt('2200000'),
				co_sign_count: 5,
				current_price: '0.28',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 7 * DAY).toISOString() },
					{ epoch: 1, price: '0.31', timestamp: new Date(now - 6 * DAY).toISOString() },
					{ epoch: 2, price: '0.29', timestamp: new Date(now - 5 * DAY).toISOString() },
					{ epoch: 3, price: '0.28', timestamp: new Date(now - 4 * DAY).toISOString() },
				],
				position_count: 8,
				ai_scores: { reasoning: 7400, accuracy: 7100, evidence: 7800, constructiveness: 7600, feasibility: 6200 },
				ai_weighted: 7280,
				final_score: 7148,
				model_agreement: 0.85,
			},
			{
				stance: 'AMEND',
				body: 'While the intent of COPPA 2.0 is correct, the legislation needs a phased implementation with an independent technical standards body. An outright ban on targeted advertising to minors would push platforms toward subscription models that create a digital divide between wealthy and low-income families. Instead, mandate privacy-by-default architectures with independent audit requirements, and create a federal Data Protection Authority specifically for minors modeled on the UK ICO Children\'s Code.',
				amendment_text: 'Replace the blanket advertising ban with mandatory privacy-by-default architecture standards, enforce quarterly third-party audits by a new Federal Children\'s Data Protection Authority, and require platforms to offer ad-free tiers at no cost for verified minors under 17.',
				stake_amount: BigInt('1500000'),
				engagement_tier: 4,
				weighted_score: 19595917,
				total_stake: BigInt('3300000'),
				co_sign_count: 9,
				current_price: '0.52',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 7 * DAY).toISOString() },
					{ epoch: 1, price: '0.38', timestamp: new Date(now - 6 * DAY).toISOString() },
					{ epoch: 2, price: '0.45', timestamp: new Date(now - 5 * DAY).toISOString() },
					{ epoch: 3, price: '0.52', timestamp: new Date(now - 4 * DAY).toISOString() },
				],
				position_count: 14,
				ai_scores: { reasoning: 8600, accuracy: 8400, evidence: 8200, constructiveness: 8800, feasibility: 8100 },
				ai_weighted: 8460,
				final_score: 8356,
				model_agreement: 0.94,
			},
			{
				stance: 'OPPOSE',
				body: 'COPPA 2.0 is a well-intentioned approach with dangerous unintended consequences. Age verification at scale requires collecting MORE personal data from children, not less — creating exactly the surveillance risk it claims to solve. Additionally, extending protections to 16-year-olds infantilizes teenagers who are already making complex digital decisions. The better path is platform liability reform and parental control tools, not an expansive federal data regime.',
				amendment_text: null,
				stake_amount: BigInt('1000000'),
				engagement_tier: 2,
				weighted_score: 4000000,
				total_stake: BigInt('1400000'),
				co_sign_count: 2,
				current_price: '0.20',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 7 * DAY).toISOString() },
					{ epoch: 1, price: '0.31', timestamp: new Date(now - 6 * DAY).toISOString() },
					{ epoch: 2, price: '0.26', timestamp: new Date(now - 5 * DAY).toISOString() },
					{ epoch: 3, price: '0.20', timestamp: new Date(now - 4 * DAY).toISOString() },
				],
				position_count: 4,
				ai_scores: { reasoning: 5900, accuracy: 6200, evidence: 5500, constructiveness: 5100, feasibility: 7200 },
				ai_weighted: 5900,
				final_score: 5648,
				model_agreement: 0.68,
			},
		],
	},

	// ── Debate 2: 3D Housing (active, LMSR market running) ─────
	{
		id: 'debate-seed-housing',
		template_id: TEMPLATE_IDS.HOUSING,
		debate_id_onchain: '0x' + 'b1'.repeat(32),
		proposition_text: 'Cities should fast-track building code amendments to permit 3D-printed residential construction and community land trusts as standard affordable housing strategies.',
		status: 'active',
		deadline: new Date(now + 4 * DAY),
		jurisdiction_size: 12,
		proposer_index: 1,
		proposer_bond: BigInt('1000000'),
		market_status: 'active',
		market_liquidity: BigInt('3000000'),
		current_prices: { '0': '0.42', '1': '0.35', '2': '0.23' },
		current_epoch: 2,
		trade_deadline: new Date(now + 12 * 3600_000),
		resolution_deadline: new Date(now + 4 * DAY),
		ai_resolution: null,
		ai_signature_count: null,
		ai_panel_consensus: null,
		resolution_method: null,
		appeal_deadline: null,
		governance_justification: null,
		winning_argument_index: null,
		winning_stance: null,
		resolved_at: null,
		arguments: [
			{
				stance: 'SUPPORT',
				body: 'The numbers speak for themselves: 3D-printed homes cost $160K compared to $350K+ for traditional construction, and they can be built in days rather than months. Community land trusts in Austin have maintained affordability 25-30% below market for decades. The only thing standing between families and affordable housing is the building code, and that is a choice we can change tomorrow. Every month of regulatory delay means more families on the street.',
				amendment_text: null,
				stake_amount: BigInt('1200000'),
				engagement_tier: 3,
				weighted_score: 8763560,
				total_stake: BigInt('2000000'),
				co_sign_count: 4,
				current_price: '0.42',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 3 * DAY).toISOString() },
					{ epoch: 1, price: '0.39', timestamp: new Date(now - 1 * DAY).toISOString() },
				],
				position_count: 6,
				ai_scores: null,
				ai_weighted: null,
				final_score: null,
				model_agreement: null,
			},
			{
				stance: 'AMEND',
				body: 'Fast-tracking is necessary but insufficient without quality safeguards. 3D-printed homes need a separate certification pathway — not exemption from safety standards. Propose a 12-month pilot program in 3 cities with independent structural monitoring, then use those results to write national model codes. Community land trusts should require minimum 50-year deed restrictions to prevent eventual gentrification.',
				amendment_text: 'Add: "through a structured 12-month pilot program with independent structural certification and minimum 50-year community land trust deed restrictions."',
				stake_amount: BigInt('1000000'),
				engagement_tier: 3,
				weighted_score: 8000000,
				total_stake: BigInt('1600000'),
				co_sign_count: 3,
				current_price: '0.35',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 3 * DAY).toISOString() },
					{ epoch: 1, price: '0.35', timestamp: new Date(now - 1 * DAY).toISOString() },
				],
				position_count: 5,
				ai_scores: null,
				ai_weighted: null,
				final_score: null,
				model_agreement: null,
			},
			{
				stance: 'OPPOSE',
				body: 'Fast-tracking construction codes for unproven technology is irresponsible. We have seen what happens when building standards are relaxed for cost savings — the Surfside condo collapse killed 98 people. 3D-printed concrete has no long-term performance data beyond 5 years. Community land trusts sound appealing but create perpetual dependency on nonprofit governance. Let the market innovate; government should verify safety, not pick winners.',
				amendment_text: null,
				stake_amount: BigInt('1000000'),
				engagement_tier: 2,
				weighted_score: 4000000,
				total_stake: BigInt('1200000'),
				co_sign_count: 1,
				current_price: '0.23',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 3 * DAY).toISOString() },
					{ epoch: 1, price: '0.26', timestamp: new Date(now - 1 * DAY).toISOString() },
				],
				position_count: 3,
				ai_scores: null,
				ai_weighted: null,
				final_score: null,
				model_agreement: null,
			},
		],
	},

	// ── Debate 3: Parks Canada (awaiting governance) ────────────
	{
		id: 'debate-seed-parks',
		template_id: TEMPLATE_IDS.PARKS,
		debate_id_onchain: '0x' + 'a2'.repeat(32),
		proposition_text: 'The federal government should reverse $450M in Parks Canada funding cuts and establish a dedicated maintenance trust to clear the $3.6B infrastructure backlog.',
		status: 'awaiting_governance',
		deadline: new Date(now - 1 * DAY),
		jurisdiction_size: 338,
		proposer_index: 2,
		proposer_bond: BigInt('1000000'),
		market_status: 'resolved',
		market_liquidity: BigInt('4000000'),
		current_prices: { '0': '0.41', '1': '0.39', '2': '0.20' },
		current_epoch: 3,
		trade_deadline: new Date(now - 1 * DAY),
		resolution_deadline: new Date(now - 12 * 3600_000),
		ai_resolution: {
			scores: [
				{ argumentIndex: 0, medianScores: { reasoning: 7200, accuracy: 7500, evidence: 7100, constructiveness: 7000, feasibility: 6800 }, weightedScore: 7140, modelAgreement: 0.78 },
				{ argumentIndex: 1, medianScores: { reasoning: 7000, accuracy: 7200, evidence: 6900, constructiveness: 7400, feasibility: 7100 }, weightedScore: 7080, modelAgreement: 0.75 },
				{ argumentIndex: 2, medianScores: { reasoning: 5500, accuracy: 5200, evidence: 5800, constructiveness: 4900, feasibility: 6600 }, weightedScore: 5500, modelAgreement: 0.62 },
			],
			models: [
				{ provider: 0, modelName: 'GPT-5 Nano', timestamp: now - 200000 },
				{ provider: 1, modelName: 'Gemini 3 Flash', timestamp: now - 195000 },
				{ provider: 2, modelName: 'DeepSeek V3.2', timestamp: now - 190000 },
				{ provider: 3, modelName: 'Mistral Large 3', timestamp: now - 185000 },
				{ provider: 4, modelName: 'Claude Haiku 4.5', timestamp: now - 180000 },
			],
			consensusAchieved: false,
			evaluatedAt: new Date(now - 12 * 3600_000).toISOString(),
			submitTxHash: '0x' + 'f7e8d9'.repeat(11).slice(0, 64),
			gasUsed: '1985320',
		},
		ai_signature_count: 5,
		ai_panel_consensus: 0.52,
		resolution_method: 'governance_override',
		appeal_deadline: null,
		governance_justification: 'AI panel consensus (0.52) below 0.65 threshold — top two arguments within 1% weighted score. Governance review required to determine winning position.',
		winning_argument_index: null,
		winning_stance: null,
		resolved_at: null,
		arguments: [
			{
				stance: 'SUPPORT',
				body: 'Our national parks generate $3.3 billion in visitor spending annually on a $900 million budget — a 3.6x ROI that almost no government program can match. Cutting $450 million from an agency that literally pays for itself is not fiscal responsibility, it is fiscal illiteracy. The $3.6 billion maintenance backlog grows by hundreds of millions each year of inaction. Every dollar not invested now costs $3-4 in emergency repairs later.',
				amendment_text: null,
				stake_amount: BigInt('1200000'),
				engagement_tier: 3,
				weighted_score: 8763560,
				total_stake: BigInt('2000000'),
				co_sign_count: 4,
				current_price: '0.41',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 5 * DAY).toISOString() },
					{ epoch: 1, price: '0.37', timestamp: new Date(now - 3 * DAY).toISOString() },
					{ epoch: 2, price: '0.41', timestamp: new Date(now - 2 * DAY).toISOString() },
				],
				position_count: 7,
				ai_scores: { reasoning: 7200, accuracy: 7500, evidence: 7100, constructiveness: 7000, feasibility: 6800 },
				ai_weighted: 7140,
				final_score: 7012,
				model_agreement: 0.78,
			},
			{
				stance: 'AMEND',
				body: 'Reversing cuts is necessary but a dedicated maintenance trust creates a dangerous precedent — it locks future governments into spending commitments regardless of fiscal conditions. Instead, introduce a Parks Canada Infrastructure Bond program backed by park revenue, allowing capital markets to fund the backlog while maintaining budget flexibility. Tie executive compensation at Parks Canada to maintenance reduction targets.',
				amendment_text: 'Replace "dedicated maintenance trust" with "Parks Canada Infrastructure Bond program backed by park entry fee revenue, with executive performance metrics tied to annual backlog reduction targets of at least 5%."',
				stake_amount: BigInt('1100000'),
				engagement_tier: 3,
				weighted_score: 8390470,
				total_stake: BigInt('1900000'),
				co_sign_count: 4,
				current_price: '0.39',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 5 * DAY).toISOString() },
					{ epoch: 1, price: '0.35', timestamp: new Date(now - 3 * DAY).toISOString() },
					{ epoch: 2, price: '0.39', timestamp: new Date(now - 2 * DAY).toISOString() },
				],
				position_count: 6,
				ai_scores: { reasoning: 7000, accuracy: 7200, evidence: 6900, constructiveness: 7400, feasibility: 7100 },
				ai_weighted: 7080,
				final_score: 6892,
				model_agreement: 0.75,
			},
			{
				stance: 'OPPOSE',
				body: 'The $3.6 billion backlog narrative ignores that much of it represents aspirational upgrades, not critical safety needs. Parks Canada should triage its portfolio — sell or transfer underperforming sites to provinces and focus federal resources on the 20 flagship parks that generate 80% of revenue. Throwing more money at an agency with a proven track record of mismanagement rewards failure.',
				amendment_text: null,
				stake_amount: BigInt('1000000'),
				engagement_tier: 2,
				weighted_score: 4000000,
				total_stake: BigInt('1200000'),
				co_sign_count: 1,
				current_price: '0.20',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 5 * DAY).toISOString() },
					{ epoch: 1, price: '0.28', timestamp: new Date(now - 3 * DAY).toISOString() },
					{ epoch: 2, price: '0.20', timestamp: new Date(now - 2 * DAY).toISOString() },
				],
				position_count: 3,
				ai_scores: { reasoning: 5500, accuracy: 5200, evidence: 5800, constructiveness: 4900, feasibility: 6600 },
				ai_weighted: 5500,
				final_score: 4932,
				model_agreement: 0.62,
			},
		],
	},

	// ── Debate 4: Apple Labor (under appeal) ───────────────────
	{
		id: 'debate-seed-apple',
		template_id: TEMPLATE_IDS.APPLE,
		debate_id_onchain: '0x' + 'd3'.repeat(32),
		proposition_text: 'Apple must restructure retail compensation so that no employee\'s annual salary is worth less than 15 minutes of the company\'s daily interest income on cash reserves.',
		status: 'under_appeal',
		deadline: new Date(now - 2 * DAY),
		jurisdiction_size: 1,
		proposer_index: 3,
		proposer_bond: BigInt('1000000'),
		market_status: 'resolved',
		market_liquidity: BigInt('6000000'),
		current_prices: { '0': '0.22', '1': '0.18', '2': '0.60' },
		current_epoch: 5,
		trade_deadline: new Date(now - 2 * DAY),
		resolution_deadline: new Date(now - 1 * DAY),
		ai_resolution: {
			scores: [
				{ argumentIndex: 0, medianScores: { reasoning: 6800, accuracy: 5900, evidence: 6200, constructiveness: 7200, feasibility: 4800 }, weightedScore: 6260, modelAgreement: 0.70 },
				{ argumentIndex: 1, medianScores: { reasoning: 5500, accuracy: 5200, evidence: 5600, constructiveness: 6100, feasibility: 4200 }, weightedScore: 5340, modelAgreement: 0.58 },
				{ argumentIndex: 2, medianScores: { reasoning: 8200, accuracy: 8500, evidence: 8100, constructiveness: 7200, feasibility: 8400 }, weightedScore: 8180, modelAgreement: 0.91 },
			],
			models: [
				{ provider: 0, modelName: 'GPT-5 Nano', timestamp: now - 150000 },
				{ provider: 1, modelName: 'Gemini 3 Flash', timestamp: now - 145000 },
				{ provider: 2, modelName: 'DeepSeek V3.2', timestamp: now - 140000 },
				{ provider: 3, modelName: 'Mistral Large 3', timestamp: now - 135000 },
				{ provider: 4, modelName: 'Claude Haiku 4.5', timestamp: now - 130000 },
			],
			consensusAchieved: true,
			evaluatedAt: new Date(now - 1 * DAY).toISOString(),
			submitTxHash: '0x' + 'b3c4d5'.repeat(11).slice(0, 64),
			resolveTxHash: '0x' + 'e6f7a8'.repeat(11).slice(0, 64),
			gasUsed: '2312480',
		},
		ai_signature_count: 5,
		ai_panel_consensus: 0.82,
		resolution_method: 'ai_community',
		appeal_deadline: new Date(now + 5 * DAY),
		governance_justification: null,
		winning_argument_index: 2,
		winning_stance: 'OPPOSE',
		resolved_at: new Date(now - 1 * DAY),
		arguments: [
			{
				stance: 'SUPPORT',
				body: 'When 15 minutes of passive interest income exceeds a worker\'s entire annual salary, the value assigned to human labor has been completely decoupled from economic reality. Apple holds $132.4 billion in liquid assets while its median worker earns $35,570. This is not a market outcome — it is a power imbalance. Apple can afford to pay living wages that reflect the dignity of the people who make their brand successful.',
				amendment_text: null,
				stake_amount: BigInt('1000000'),
				engagement_tier: 2,
				weighted_score: 4000000,
				total_stake: BigInt('1400000'),
				co_sign_count: 2,
				current_price: '0.22',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 8 * DAY).toISOString() },
					{ epoch: 1, price: '0.30', timestamp: new Date(now - 6 * DAY).toISOString() },
					{ epoch: 2, price: '0.27', timestamp: new Date(now - 5 * DAY).toISOString() },
					{ epoch: 3, price: '0.24', timestamp: new Date(now - 4 * DAY).toISOString() },
					{ epoch: 4, price: '0.22', timestamp: new Date(now - 3 * DAY).toISOString() },
				],
				position_count: 5,
				ai_scores: { reasoning: 6800, accuracy: 5900, evidence: 6200, constructiveness: 7200, feasibility: 4800 },
				ai_weighted: 6260,
				final_score: 5836,
				model_agreement: 0.70,
			},
			{
				stance: 'AMEND',
				body: 'The moral argument is compelling but the mechanism is wrong. Tying wages to interest income creates a volatile compensation structure that could actually hurt workers during low-rate environments. Instead, mandate that Apple allocate a fixed percentage (5%) of annual free cash flow to a worker equity pool, giving retail employees actual ownership in the company they build. Profit-sharing creates alignment; wage mandates create adversarial dynamics.',
				amendment_text: 'Replace salary restructuring with mandatory 5% annual free cash flow allocation to a worker equity pool for all employees below VP level, with 3-year vesting.',
				stake_amount: BigInt('1000000'),
				engagement_tier: 2,
				weighted_score: 4000000,
				total_stake: BigInt('1200000'),
				co_sign_count: 1,
				current_price: '0.18',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 8 * DAY).toISOString() },
					{ epoch: 1, price: '0.28', timestamp: new Date(now - 6 * DAY).toISOString() },
					{ epoch: 2, price: '0.23', timestamp: new Date(now - 5 * DAY).toISOString() },
					{ epoch: 3, price: '0.20', timestamp: new Date(now - 4 * DAY).toISOString() },
					{ epoch: 4, price: '0.18', timestamp: new Date(now - 3 * DAY).toISOString() },
				],
				position_count: 4,
				ai_scores: { reasoning: 5500, accuracy: 5200, evidence: 5600, constructiveness: 6100, feasibility: 4200 },
				ai_weighted: 5340,
				final_score: 5124,
				model_agreement: 0.58,
			},
			{
				stance: 'OPPOSE',
				body: 'This proposition conflates corporate treasury management with labor economics in a way that is intellectually dishonest. Interest income is a return on decades of accumulated innovation and risk. Apple retail workers are paid at or above market rates — the median Apple retail salary of $35,570 is competitive with the sector. Mandating compensation based on unrelated financial metrics would set a precedent that destroys rational capital allocation across the entire economy. If we price labor by comparing it to interest income, should we also adjust salaries daily based on bond yields?',
				amendment_text: null,
				stake_amount: BigInt('1800000'),
				engagement_tier: 4,
				weighted_score: 21466252,
				total_stake: BigInt('4000000'),
				co_sign_count: 11,
				current_price: '0.60',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 8 * DAY).toISOString() },
					{ epoch: 1, price: '0.42', timestamp: new Date(now - 6 * DAY).toISOString() },
					{ epoch: 2, price: '0.50', timestamp: new Date(now - 5 * DAY).toISOString() },
					{ epoch: 3, price: '0.56', timestamp: new Date(now - 4 * DAY).toISOString() },
					{ epoch: 4, price: '0.60', timestamp: new Date(now - 3 * DAY).toISOString() },
				],
				position_count: 16,
				ai_scores: { reasoning: 8200, accuracy: 8500, evidence: 8100, constructiveness: 7200, feasibility: 8400 },
				ai_weighted: 8180,
				final_score: 8308,
				model_agreement: 0.91,
			},
		],
	},

	// ── Debate 5: SF Vacancy Tax (active, early market) ─────────
	{
		id: 'debate-seed-sf-vacancy',
		template_id: TEMPLATE_IDS.SF_VACANCY,
		debate_id_onchain: '0x' + 'e4'.repeat(32),
		proposition_text: 'San Francisco must enact a graduated vacancy tax on residential units left unoccupied for more than 180 days, with rates starting at 1% of assessed value and escalating annually to a 5% cap.',
		status: 'active',
		deadline: new Date(now + 14 * DAY),
		jurisdiction_size: 1,
		proposer_index: 0,
		proposer_bond: BigInt('500000'),
		market_status: 'active',
		market_liquidity: BigInt('2200000'),
		current_prices: { '0': '0.45', '1': '0.20', '2': '0.35' },
		current_epoch: 2,
		trade_deadline: new Date(now + 10 * DAY),
		resolution_deadline: new Date(now + 14 * DAY),
		ai_resolution: null,
		ai_signature_count: null,
		ai_panel_consensus: null,
		resolution_method: null,
		appeal_deadline: null,
		governance_justification: null,
		winning_argument_index: null,
		winning_stance: null,
		resolved_at: null,
		arguments: [
			{
				stance: 'SUPPORT',
				body: 'San Francisco has 40,458 vacant housing units \u2014 a 6.2% vacancy rate that is double the national average. Meanwhile, 7,754 people sleep outside every night. Vancouver\'s Empty Homes Tax reduced vacancies by 25% in its first three years and generated $115 million for affordable housing. A graduated tax starting at 1% gives landlords time to respond while creating real consequences for speculation. The housing crisis is a supply problem, but it\'s also a hoarding problem.',
				amendment_text: null,
				stake_amount: BigInt('500000'),
				engagement_tier: 2,
				weighted_score: 4000000,
				total_stake: BigInt('850000'),
				co_sign_count: 4,
				current_price: '0.45',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 4 * DAY).toISOString() },
					{ epoch: 1, price: '0.40', timestamp: new Date(now - 2 * DAY).toISOString() },
					{ epoch: 2, price: '0.45', timestamp: new Date(now - 1 * DAY).toISOString() },
				],
				position_count: 8,
				ai_scores: null,
				ai_weighted: null,
				final_score: null,
				model_agreement: null,
			},
			{
				stance: 'AMEND',
				body: 'A vacancy tax addresses the symptom, not the cause. Most long-term vacancies in SF are units tied up in probate, renovation, or rent-controlled buildings where owners cannot afford seismic retrofits. The tax should exempt units undergoing permitted renovation or probate for up to 24 months, and pair the revenue with a seismic retrofit loan program. Without these carve-outs, the tax punishes exactly the small landlords who would otherwise bring units back to market.',
				amendment_text: 'Add 24-month exemptions for units in probate or with active building permits; dedicate 30% of vacancy tax revenue to a zero-interest seismic retrofit loan fund for buildings with fewer than 10 units.',
				stake_amount: BigInt('400000'),
				engagement_tier: 1,
				weighted_score: 2000000,
				total_stake: BigInt('600000'),
				co_sign_count: 2,
				current_price: '0.20',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 4 * DAY).toISOString() },
					{ epoch: 1, price: '0.25', timestamp: new Date(now - 2 * DAY).toISOString() },
					{ epoch: 2, price: '0.20', timestamp: new Date(now - 1 * DAY).toISOString() },
				],
				position_count: 4,
				ai_scores: null,
				ai_weighted: null,
				final_score: null,
				model_agreement: null,
			},
			{
				stance: 'OPPOSE',
				body: 'The 40,458 \"vacant\" figure is a Census Bureau estimate that counts units between tenants, units being renovated, seasonal housing, and pieds-\u00e0-terre. The actual speculative vacancy rate is closer to 1.5%. San Francisco already has among the highest property taxes, transfer taxes, and regulatory costs in the country. Adding a vacancy tax will further discourage investment in housing stock and push small landlords to sell to institutional investors. Oakland\'s vacancy tax generated $7 million against $3 million in administrative costs \u2014 a 43% overhead rate.',
				amendment_text: null,
				stake_amount: BigInt('700000'),
				engagement_tier: 3,
				weighted_score: 8000000,
				total_stake: BigInt('1100000'),
				co_sign_count: 5,
				current_price: '0.35',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 4 * DAY).toISOString() },
					{ epoch: 1, price: '0.35', timestamp: new Date(now - 2 * DAY).toISOString() },
					{ epoch: 2, price: '0.35', timestamp: new Date(now - 1 * DAY).toISOString() },
				],
				position_count: 9,
				ai_scores: null,
				ai_weighted: null,
				final_score: null,
				model_agreement: null,
			},
		],
	},

	// ── Debate 6: SF Transit Priorities (resolved, SUPPORT won) ─
	{
		id: 'debate-seed-sf-transit',
		template_id: TEMPLATE_IDS.SF_TRANSIT,
		debate_id_onchain: '0x' + 'f5'.repeat(32),
		proposition_text: 'SFMTA must freeze all new capital rail projects over $50M until Muni bus service achieves 85% on-time performance and restores pre-pandemic service levels on all routes.',
		status: 'resolved',
		deadline: new Date(now - 5 * DAY),
		jurisdiction_size: 1,
		proposer_index: 0,
		proposer_bond: BigInt('500000'),
		market_status: 'resolved',
		market_liquidity: BigInt('4500000'),
		current_prices: { '0': '0.58', '1': '0.12', '2': '0.30' },
		current_epoch: 4,
		trade_deadline: new Date(now - 7 * DAY),
		resolution_deadline: new Date(now - 5 * DAY),
		ai_resolution: {
			scores: [
				{ argumentIndex: 0, medianScores: { reasoning: 8400, accuracy: 8800, evidence: 8600, constructiveness: 7800, feasibility: 7200 }, weightedScore: 8220, modelAgreement: 0.88 },
				{ argumentIndex: 1, medianScores: { reasoning: 6200, accuracy: 5800, evidence: 6400, constructiveness: 7000, feasibility: 5200 }, weightedScore: 6140, modelAgreement: 0.62 },
				{ argumentIndex: 2, medianScores: { reasoning: 7200, accuracy: 7600, evidence: 7000, constructiveness: 6400, feasibility: 7800 }, weightedScore: 7260, modelAgreement: 0.78 },
			],
			models: [
				{ provider: 0, modelName: 'GPT-5 Nano', timestamp: now - 500000 },
				{ provider: 1, modelName: 'Gemini 3 Flash', timestamp: now - 495000 },
				{ provider: 2, modelName: 'DeepSeek V3.2', timestamp: now - 490000 },
				{ provider: 3, modelName: 'Mistral Large 3', timestamp: now - 485000 },
				{ provider: 4, modelName: 'Claude Haiku 4.5', timestamp: now - 480000 },
			],
			consensusAchieved: true,
			evaluatedAt: new Date(now - 5 * DAY).toISOString(),
			submitTxHash: '0x' + 'c4d5e6'.repeat(11).slice(0, 64),
			resolveTxHash: '0x' + 'f7a8b9'.repeat(11).slice(0, 64),
			gasUsed: '1987200',
		},
		ai_signature_count: 5,
		ai_panel_consensus: 0.88,
		resolution_method: 'ai_consensus',
		appeal_deadline: new Date(now - 1 * DAY),
		governance_justification: null,
		winning_argument_index: 0,
		winning_stance: 'SUPPORT',
		resolved_at: new Date(now - 5 * DAY),
		arguments: [
			{
				stance: 'SUPPORT',
				body: 'The Central Subway cost $1.96 billion and serves 3,600 daily riders \u2014 $544,000 per daily rider in capital cost. Meanwhile, the 14-Mission carries 28,000 riders daily on buses that break down every 4,200 miles. SFMTA\'s own data shows Muni bus on-time performance at 57%, the worst since 2012. The agency cannot responsibly plan the next mega-project when the system people actually depend on is failing. An 85% on-time threshold is achievable \u2014 Portland TriMet hit 83% in 2024 on a smaller budget.',
				amendment_text: null,
				stake_amount: BigInt('500000'),
				engagement_tier: 3,
				weighted_score: 8500000,
				total_stake: BigInt('1800000'),
				co_sign_count: 8,
				current_price: '0.58',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 14 * DAY).toISOString() },
					{ epoch: 1, price: '0.40', timestamp: new Date(now - 12 * DAY).toISOString() },
					{ epoch: 2, price: '0.48', timestamp: new Date(now - 10 * DAY).toISOString() },
					{ epoch: 3, price: '0.55', timestamp: new Date(now - 8 * DAY).toISOString() },
					{ epoch: 4, price: '0.58', timestamp: new Date(now - 7 * DAY).toISOString() },
				],
				position_count: 14,
				ai_scores: { reasoning: 8400, accuracy: 8800, evidence: 8600, constructiveness: 7800, feasibility: 7200 },
				ai_weighted: 8220,
				final_score: 8340,
				model_agreement: 0.88,
			},
			{
				stance: 'AMEND',
				body: 'Freezing all rail capital projects is too blunt. The problem is not rail investment per se \u2014 it\'s the lack of accountability between capital planning and operations. Instead of a freeze, require that every capital project over $50M include a binding service-level agreement: for every dollar of capital spending, SFMTA must demonstrate $0.20 in operational improvement within 3 years or return federal matching funds.',
				amendment_text: 'Replace the capital freeze with a mandatory operational improvement ratio: every $1 of capital spending over $50M must produce $0.20 in measurable bus service improvements within 36 months of project completion.',
				stake_amount: BigInt('300000'),
				engagement_tier: 1,
				weighted_score: 2000000,
				total_stake: BigInt('500000'),
				co_sign_count: 2,
				current_price: '0.12',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 14 * DAY).toISOString() },
					{ epoch: 1, price: '0.25', timestamp: new Date(now - 12 * DAY).toISOString() },
					{ epoch: 2, price: '0.18', timestamp: new Date(now - 10 * DAY).toISOString() },
					{ epoch: 3, price: '0.14', timestamp: new Date(now - 8 * DAY).toISOString() },
					{ epoch: 4, price: '0.12', timestamp: new Date(now - 7 * DAY).toISOString() },
				],
				position_count: 3,
				ai_scores: { reasoning: 6200, accuracy: 5800, evidence: 6400, constructiveness: 7000, feasibility: 5200 },
				ai_weighted: 6140,
				final_score: 5962,
				model_agreement: 0.62,
			},
			{
				stance: 'OPPOSE',
				body: 'This creates a false choice between buses and rail. Federal transit capital grants (New Starts, Core Capacity) cannot legally be redirected to bus operations. If SFMTA freezes rail projects, the money doesn\'t go to buses \u2014 it goes back to the FTA and funds projects in Houston or Denver. The city loses billions in federal investment. Muni\'s bus problems are caused by operator shortages and traffic congestion, not capital misallocation. The solution is congestion pricing and hiring bonuses, not punishing future infrastructure.',
				amendment_text: null,
				stake_amount: BigInt('600000'),
				engagement_tier: 2,
				weighted_score: 4800000,
				total_stake: BigInt('1200000'),
				co_sign_count: 6,
				current_price: '0.30',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 14 * DAY).toISOString() },
					{ epoch: 1, price: '0.35', timestamp: new Date(now - 12 * DAY).toISOString() },
					{ epoch: 2, price: '0.34', timestamp: new Date(now - 10 * DAY).toISOString() },
					{ epoch: 3, price: '0.31', timestamp: new Date(now - 8 * DAY).toISOString() },
					{ epoch: 4, price: '0.30', timestamp: new Date(now - 7 * DAY).toISOString() },
				],
				position_count: 10,
				ai_scores: { reasoning: 7200, accuracy: 7600, evidence: 7000, constructiveness: 6400, feasibility: 7800 },
				ai_weighted: 7260,
				final_score: 7148,
				model_agreement: 0.78,
			},
		],
	},

	// ── Debate 7: SF Overdose Prevention (awaiting_governance) ──
	{
		id: 'debate-seed-sf-overdose',
		template_id: TEMPLATE_IDS.SF_OVERDOSE,
		debate_id_onchain: '0x' + 'a6'.repeat(32),
		proposition_text: 'San Francisco must open at least two supervised consumption sites in the Tenderloin and SoMa within 12 months, funded by redirecting 15% of the current street sweep budget.',
		status: 'awaiting_governance',
		deadline: new Date(now + 3 * DAY),
		jurisdiction_size: 1,
		proposer_index: 0,
		proposer_bond: BigInt('500000'),
		market_status: 'resolved',
		market_liquidity: BigInt('3800000'),
		current_prices: { '0': '0.52', '1': '0.30', '2': '0.18' },
		current_epoch: 4,
		trade_deadline: new Date(now - 1 * DAY),
		resolution_deadline: new Date(now + 3 * DAY),
		ai_resolution: {
			scores: [
				{ argumentIndex: 0, medianScores: { reasoning: 8800, accuracy: 9100, evidence: 9200, constructiveness: 8000, feasibility: 6800 }, weightedScore: 8540, modelAgreement: 0.92 },
				{ argumentIndex: 1, medianScores: { reasoning: 7400, accuracy: 7000, evidence: 7200, constructiveness: 8200, feasibility: 7600 }, weightedScore: 7400, modelAgreement: 0.74 },
				{ argumentIndex: 2, medianScores: { reasoning: 5800, accuracy: 5400, evidence: 5200, constructiveness: 4800, feasibility: 6200 }, weightedScore: 5520, modelAgreement: 0.55 },
			],
			models: [
				{ provider: 0, modelName: 'GPT-5 Nano', timestamp: now - 200000 },
				{ provider: 1, modelName: 'Gemini 3 Flash', timestamp: now - 195000 },
				{ provider: 2, modelName: 'DeepSeek V3.2', timestamp: now - 190000 },
				{ provider: 3, modelName: 'Mistral Large 3', timestamp: now - 185000 },
				{ provider: 4, modelName: 'Claude Haiku 4.5', timestamp: now - 180000 },
			],
			consensusAchieved: false,
			evaluatedAt: new Date(now - 1 * DAY).toISOString(),
			submitTxHash: '0x' + 'a1b2c3'.repeat(11).slice(0, 64),
			resolveTxHash: null,
			gasUsed: '2145600',
		},
		ai_signature_count: 3,
		ai_panel_consensus: 0.48,
		resolution_method: null,
		appeal_deadline: null,
		governance_justification: 'AI panel split 3-2 on feasibility scoring; SUPPORT evidence was strongest but feasibility gap (6800 vs 8000+ on other criteria) suggests policy implementation risk requires human governance review. Market signals (52% SUPPORT) align with AI assessment but do not clear the 60% consensus threshold.',
		winning_argument_index: null,
		winning_stance: null,
		resolved_at: null,
		arguments: [
			{
				stance: 'SUPPORT',
				body: 'Fentanyl killed 810 people in San Francisco last year \u2014 more than car accidents, homicides, and COVID combined. Vancouver\'s Insite supervised consumption site has operated for 20 years with zero on-site deaths and a peer-reviewed 35% reduction in overdose mortality in the surrounding area. San Francisco\'s own Tenderloin pilot prevented 333 overdoses in its first 6 months. The city spends $18 million annually on street sweeps that merely displace people without reducing drug use. Redirecting 15% of that budget ($2.7M) would fund two sites that actually save lives.',
				amendment_text: null,
				stake_amount: BigInt('500000'),
				engagement_tier: 3,
				weighted_score: 9200000,
				total_stake: BigInt('2100000'),
				co_sign_count: 9,
				current_price: '0.52',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 10 * DAY).toISOString() },
					{ epoch: 1, price: '0.38', timestamp: new Date(now - 8 * DAY).toISOString() },
					{ epoch: 2, price: '0.44', timestamp: new Date(now - 6 * DAY).toISOString() },
					{ epoch: 3, price: '0.50', timestamp: new Date(now - 4 * DAY).toISOString() },
					{ epoch: 4, price: '0.52', timestamp: new Date(now - 1 * DAY).toISOString() },
				],
				position_count: 15,
				ai_scores: { reasoning: 8800, accuracy: 9100, evidence: 9200, constructiveness: 8000, feasibility: 6800 },
				ai_weighted: 8540,
				final_score: 8720,
				model_agreement: 0.92,
			},
			{
				stance: 'AMEND',
				body: 'The evidence for supervised consumption is overwhelming, but the funding mechanism is wrong. Street sweeps serve a different public safety function \u2014 encampment fire prevention, needle cleanup, ADA sidewalk access. Defunding sweeps to fund sites creates a political coalition of opponents where none needs to exist. Instead, fund sites from the $50M annual Mental Health SF budget, which has spent $280M since 2020 with no measurable reduction in street overdoses. Accountability should follow failure, not be borrowed from unrelated programs.',
				amendment_text: 'Replace sweep budget redirection with reallocation of 5% ($2.5M) of the Mental Health SF budget, contingent on an independent audit of Mental Health SF outcomes within 6 months.',
				stake_amount: BigInt('400000'),
				engagement_tier: 2,
				weighted_score: 4400000,
				total_stake: BigInt('900000'),
				co_sign_count: 4,
				current_price: '0.30',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 10 * DAY).toISOString() },
					{ epoch: 1, price: '0.32', timestamp: new Date(now - 8 * DAY).toISOString() },
					{ epoch: 2, price: '0.30', timestamp: new Date(now - 6 * DAY).toISOString() },
					{ epoch: 3, price: '0.29', timestamp: new Date(now - 4 * DAY).toISOString() },
					{ epoch: 4, price: '0.30', timestamp: new Date(now - 1 * DAY).toISOString() },
				],
				position_count: 7,
				ai_scores: { reasoning: 7400, accuracy: 7000, evidence: 7200, constructiveness: 8200, feasibility: 7600 },
				ai_weighted: 7400,
				final_score: 7216,
				model_agreement: 0.74,
			},
			{
				stance: 'OPPOSE',
				body: 'Supervised consumption sites normalize drug use and concentrate addiction infrastructure in neighborhoods that are already overwhelmed. The Tenderloin has 40% of the city\'s SRO hotel rooms, 60% of its methadone clinics, and 3 of its 4 sobering centers. Adding consumption sites doesn\'t distribute responsibility \u2014 it deepens geographic inequality. Residents and businesses in the Tenderloin deserve investment in safety and economic development, not more services that attract drug markets to their front doors.',
				amendment_text: null,
				stake_amount: BigInt('300000'),
				engagement_tier: 1,
				weighted_score: 1500000,
				total_stake: BigInt('400000'),
				co_sign_count: 1,
				current_price: '0.18',
				price_history: [
					{ epoch: 0, price: '0.333', timestamp: new Date(now - 10 * DAY).toISOString() },
					{ epoch: 1, price: '0.30', timestamp: new Date(now - 8 * DAY).toISOString() },
					{ epoch: 2, price: '0.26', timestamp: new Date(now - 6 * DAY).toISOString() },
					{ epoch: 3, price: '0.21', timestamp: new Date(now - 4 * DAY).toISOString() },
					{ epoch: 4, price: '0.18', timestamp: new Date(now - 1 * DAY).toISOString() },
				],
				position_count: 3,
				ai_scores: { reasoning: 5800, accuracy: 5400, evidence: 5200, constructiveness: 4800, feasibility: 6200 },
				ai_weighted: 5520,
				final_score: 5324,
				model_agreement: 0.55,
			},
		],
	},
];

// ============================================================================
// MAIN
// ============================================================================

// ============================================================================
// MAIN
// ============================================================================

async function main() {
	console.log('');
	console.log('='.repeat(60));
	console.log('STATIC DATABASE SEED');
	console.log('='.repeat(60));

	try {
		await teardownDatabase();

		// ── Create Users ─────────────────────────────────────────
		console.log('Seeding users...');
		for (const userData of USERS) {
			await db.user.create({
				data: {
					id: userData.id,
					email: userData.email,
					name: userData.name,
					avatar: userData.avatar,
					createdAt: new Date(userData.createdAt),
					updatedAt: new Date(userData.updatedAt),
					is_verified: userData.is_verified,
					verification_method: userData.verification_method,
					verification_data: userData.verification_data as unknown as InputJsonValue,
					verified_at: userData.verified_at ? new Date(userData.verified_at) : null,
					identity_hash: userData.identity_hash,
					identity_fingerprint: userData.identity_fingerprint,
					birth_year: userData.birth_year,
					identity_commitment: userData.identity_commitment,
					document_type: userData.document_type,
					encrypted_entropy: userData.encrypted_entropy,
					authority_level: userData.authority_level,
					trust_tier: userData.trust_tier,
					passkey_credential_id: userData.passkey_credential_id,
					passkey_public_key_jwk: userData.passkey_public_key_jwk as unknown as InputJsonValue,
					did_key: userData.did_key,
					passkey_created_at: userData.passkey_created_at ? new Date(userData.passkey_created_at) : null,
					passkey_last_used_at: userData.passkey_last_used_at ? new Date(userData.passkey_last_used_at) : null,
					address_verification_method: userData.address_verification_method,
					address_verified_at: userData.address_verified_at ? new Date(userData.address_verified_at) : null,
					wallet_address: userData.wallet_address,
					wallet_type: userData.wallet_type,
					district_hash: userData.district_hash,
					near_account_id: userData.near_account_id,
					near_public_key: userData.near_public_key,
					encrypted_near_private_key: userData.encrypted_near_private_key,
					near_recovery_public_key: userData.near_recovery_public_key,
					near_derived_scroll_address: userData.near_derived_scroll_address,
					trust_score: userData.trust_score,
					reputation_tier: userData.reputation_tier,
					district_verified: userData.district_verified,
					templates_contributed: userData.templates_contributed,
					template_adoption_rate: userData.template_adoption_rate,
					peer_endorsements: userData.peer_endorsements,
					active_months: userData.active_months,
					role: userData.role,
					organization: userData.organization,
					location: userData.location,
					connection: userData.connection,
					profile_completed_at: userData.profile_completed_at ? new Date(userData.profile_completed_at) : null,
					profile_visibility: userData.profile_visibility
				}
			});
			console.log(`  Created user: "${userData.name}" (${userData.email})`);
		}

		// ── Create DecisionMakers + UserDMRelation ──
		console.log('\nSeeding decision makers + user relations...');

		const SEED_DECISION_MAKERS = [
			{
				id: 'dm-seed-sen-co-1',
				type: 'legislator',
				title: 'Senator',
				name: 'John Hickenlooper',
				firstName: 'John',
				lastName: 'Hickenlooper',
				party: 'Democratic',
				jurisdiction: 'CO',
				jurisdictionLevel: 'federal',
				district: null,
				phone: '202-224-5941',
				email: null,
				active: true,
				bioguideId: 'H001110'
			},
			{
				id: 'dm-seed-sen-co-2',
				type: 'legislator',
				title: 'Senator',
				name: 'Michael Bennet',
				firstName: 'Michael',
				lastName: 'Bennet',
				party: 'Democratic',
				jurisdiction: 'CO',
				jurisdictionLevel: 'federal',
				district: null,
				phone: '202-224-5852',
				email: null,
				active: true,
				bioguideId: 'B001267'
			},
			{
				id: 'dm-seed-rep-co-1',
				type: 'legislator',
				title: 'Representative',
				name: 'Diana DeGette',
				firstName: 'Diana',
				lastName: 'DeGette',
				party: 'Democratic',
				jurisdiction: 'CO',
				jurisdictionLevel: 'federal',
				district: '01',
				phone: '202-225-4431',
				email: null,
				active: true,
				bioguideId: 'D000197'
			}
		];

		for (const dm of SEED_DECISION_MAKERS) {
			await db.decisionMaker.create({
				data: {
					id: dm.id,
					type: dm.type,
					title: dm.title,
					name: dm.name,
					firstName: dm.firstName,
					lastName: dm.lastName,
					party: dm.party,
					jurisdiction: dm.jurisdiction,
					jurisdictionLevel: dm.jurisdictionLevel,
					district: dm.district,
					phone: dm.phone,
					email: dm.email,
					active: dm.active
				}
			});

			// Create ExternalId for bioguide mapping
			if (dm.bioguideId) {
				await db.externalId.create({
					data: {
						decisionMakerId: dm.id,
						system: 'bioguide',
						value: dm.bioguideId
					}
				});
			}

			console.log(`  Created DM: ${dm.title} ${dm.name} (${dm.jurisdiction}${dm.district ? '-' + dm.district : ''})`);
		}

		// Link user-seed-1 (Alex Rivera, Denver CO) to all three CO decision makers
		const USER_DM_RELATIONS = [
			{ userId: 'user-seed-1', decisionMakerId: 'dm-seed-sen-co-1', relationship: 'constituent' },
			{ userId: 'user-seed-1', decisionMakerId: 'dm-seed-sen-co-2', relationship: 'constituent' },
			{ userId: 'user-seed-1', decisionMakerId: 'dm-seed-rep-co-1', relationship: 'constituent' }
		];

		for (const rel of USER_DM_RELATIONS) {
			await db.userDMRelation.create({
				data: {
					userId: rel.userId,
					decisionMakerId: rel.decisionMakerId,
					relationship: rel.relationship,
					isActive: true,
					lastValidated: new Date()
				}
			});
			console.log(`  Linked ${rel.userId} → ${rel.decisionMakerId} (${rel.relationship})`);
		}

		// ── Create Templates ──────────────────────────────────────
		console.log('\nSeeding templates...');
		for (const t of TEMPLATES) {
			await db.template.create({
				data: {
					id: t.id,
					title: t.title,
					slug: t.slug,
					description: t.description,
					message_body: t.message_body,
					preview: t.preview,
					category: t.category,
					topics: t.topics as unknown as InputJsonValue,
					type: t.type,
					deliveryMethod: t.deliveryMethod,
					country_code: t.country_code,
					status: t.status,
					is_public: t.is_public,
					verification_status: t.verification_status,
					consensus_approved: t.consensus_approved,
					content_hash: t.content_hash,
					sources: (t.sources || []) as unknown as InputJsonValue,
					research_log: (t.research_log || []) as unknown as InputJsonValue,
					recipient_config: (snapshot[t.slug]
						?? processSeedRecipientConfig((t.recipient_config || {}) as Record<string, unknown>)
					) as unknown as InputJsonValue,
					delivery_config: (t.delivery_config || {}) as unknown as InputJsonValue,
					cwc_config: (t.cwc_config || {}) as unknown as InputJsonValue,
					metrics: (t.metrics || {}) as unknown as InputJsonValue,
					createdAt: new Date(t.createdAt),
					user: { connect: { id: t.userId } }
				}
			});
			console.log(`  Created template: "${t.title}" (/${t.slug})`);
		}

		// ── Create Template Scopes ────────────────────────────────
		console.log('\nSeeding template scopes...');
		for (const s of SCOPES) {
			await db.templateScope.create({
				data: {
					id: s.id,
					template_id: s.template_id,
					country_code: s.country_code,
					region_code: s.region_code,
					locality_code: s.locality_code,
					district_code: s.district_code,
					display_text: s.display_text,
					scope_level: s.scope_level,
					power_structure_type: s.power_structure_type,
					audience_filter: s.audience_filter,
					scope_notes: s.scope_notes,
					confidence: s.confidence,
					extraction_method: s.extraction_method,
					validated_against: s.validated_against,
					estimated_reach: s.estimated_reach,
					latitude: s.latitude,
					longitude: s.longitude,
					created_at: new Date(s.created_at),
					updated_at: new Date(s.updated_at)
				}
			});
			console.log(`  Created scope: ${s.scope_level} (${s.country_code}${s.region_code ? '/' + s.region_code : ''}${s.locality_code ? '/' + s.locality_code : ''}) -> ${s.template_id}`);
		}

		// ── Create Template Jurisdictions ─────────────────────────
		console.log('\nSeeding template jurisdictions...');
		for (const j of JURISDICTIONS) {
			await db.templateJurisdiction.create({
				data: {
					id: j.id,
					template_id: j.template_id,
					jurisdiction_type: j.jurisdiction_type,
					congressional_district: j.congressional_district,
					senate_class: j.senate_class,
					state_code: j.state_code,
					state_senate_district: j.state_senate_district,
					state_house_district: j.state_house_district,
					county_fips: j.county_fips,
					county_name: j.county_name,
					city_name: j.city_name,
					city_fips: j.city_fips,
					school_district_id: j.school_district_id,
					school_district_name: j.school_district_name,
					latitude: j.latitude,
					longitude: j.longitude,
					estimated_population: j.estimated_population,
					coverage_notes: j.coverage_notes,
					created_at: new Date(j.created_at),
					updated_at: new Date(j.updated_at)
				}
			});
			console.log(`  Created jurisdiction: ${j.jurisdiction_type}${j.state_code ? ' (' + j.state_code + ')' : ''} -> ${j.template_id}`);
		}

		// ── Create Debates ───────────────────────────────────────
		console.log('\nSeeding debates...');
		for (const d of DEBATES) {
			const propositionHash = hashText(d.proposition_text);
			const actionDomain = hashText('debate.' + d.id);
			await db.debate.create({
				data: {
					id: d.id,
					template_id: d.template_id,
					debate_id_onchain: d.debate_id_onchain,
					proposition_text: d.proposition_text,
					proposition_hash: propositionHash,
					action_domain: actionDomain,
					proposer_address: WALLET_ADDRS[d.proposer_index],
					proposer_bond: d.proposer_bond,
					deadline: d.deadline,
					jurisdiction_size: d.jurisdiction_size,
					status: d.status,
					argument_count: d.arguments.length,
					unique_participants: d.arguments.length,
					total_stake: d.arguments.reduce((sum, a) => sum + a.total_stake, BigInt(0)),
					winning_argument_index: d.winning_argument_index,
					winning_stance: d.winning_stance,
					resolved_at: d.resolved_at,
					ai_resolution: d.ai_resolution as unknown as InputJsonValue,
					ai_signature_count: d.ai_signature_count,
					ai_panel_consensus: d.ai_panel_consensus,
					resolution_method: d.resolution_method,
					appeal_deadline: d.appeal_deadline,
					governance_justification: d.governance_justification,
					market_status: d.market_status,
					market_liquidity: d.market_liquidity,
					current_prices: d.current_prices as unknown as InputJsonValue,
					current_epoch: d.current_epoch,
					trade_deadline: d.trade_deadline,
					resolution_deadline: d.resolution_deadline,
				},
			});
			console.log(`  Created debate: "${d.proposition_text.slice(0, 60)}..." (${d.status})`);

			for (let i = 0; i < d.arguments.length; i++) {
				const arg = d.arguments[i];
				const bodyHash = hashText(arg.body);
				await db.debateArgument.create({
					data: {
						debate_id: d.id,
						argument_index: i,
						stance: arg.stance,
						body: arg.body,
						body_hash: bodyHash,
						amendment_text: arg.amendment_text,
						amendment_hash: arg.amendment_text ? hashText(arg.amendment_text) : null,
						stake_amount: arg.stake_amount,
						engagement_tier: arg.engagement_tier,
						weighted_score: arg.weighted_score,
						total_stake: arg.total_stake,
						co_sign_count: arg.co_sign_count,
						current_price: arg.current_price,
						price_history: arg.price_history as unknown as InputJsonValue,
						position_count: arg.position_count,
						ai_scores: arg.ai_scores as unknown as InputJsonValue,
						ai_weighted: arg.ai_weighted,
						final_score: arg.final_score,
						model_agreement: arg.model_agreement,
					},
				});
			}
			console.log(`    ${d.arguments.length} arguments seeded`);
		}

		// ── Summary ──────────────────────────────────────────────
		const counts = {
			users: await db.user.count(),
			templates: await db.template.count(),
			published: await db.template.count({ where: { status: 'published' } }),
			drafts: await db.template.count({ where: { status: 'draft' } }),
			scopes: await db.templateScope.count(),
			jurisdictions: await db.templateJurisdiction.count(),
			debates: await db.debate.count(),
			debateArgs: await db.debateArgument.count(),
			decisionMakers: await db.decisionMaker.count(),
			dmRelations: await db.userDMRelation.count(),
		};

		console.log('');
		console.log('='.repeat(60));
		console.log('SEED COMPLETE');
		console.log('='.repeat(60));
		console.log(`Users:          ${counts.users}`);
		console.log(`DecisionMakers: ${counts.decisionMakers} (${counts.dmRelations} user relations)`);
		console.log(`Templates:      ${counts.templates} (${counts.published} published, ${counts.drafts} drafts)`);
		console.log(`Scopes:         ${counts.scopes}`);
		console.log(`Jurisdictions:  ${counts.jurisdictions}`);
		console.log(`Debates:        ${counts.debates} (${counts.debateArgs} arguments)`);
		console.log('='.repeat(60));
	} catch (error) {
		console.error('\nFATAL:', error);
		process.exit(1);
	} finally {
		await db.$disconnect();
	}
}

main();
