/**
 * Phase 2 Seed Extension
 *
 * Seeds all Phase 2 models (Events, Fundraising, Automation, SMS, Geographic, Networks)
 * on top of the existing core seed. Run AFTER seed-database.ts.
 *
 * Org templates are loaded from seed-org-snapshot.json (produced by seed-org-templates.ts)
 * and inserted with orgId + linked to campaigns via templateId.
 *
 * Usage:
 *   npx tsx scripts/seed-phase2.ts
 *
 * Covers: Organization, OrgMembership, Supporter, Tag, SupporterTag, Campaign,
 *   CampaignAction, Event, EventRsvp, EventAttendance, Donation, Workflow,
 *   WorkflowExecution, WorkflowActionLog, OrgNetwork, OrgNetworkMember,
 *   InternationalRepresentative, Subscription, ApiKey, Segment, OrgTemplates
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import type { InputJsonValue } from '@prisma/client/runtime/library';
import { createHash, randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const db = new PrismaClient();

function cuid() {
	return 'c' + randomBytes(12).toString('hex').slice(0, 24);
}

function sha256(s: string) {
	return createHash('sha256').update(s).digest('hex');
}

function daysAgo(n: number) {
	return new Date(Date.now() - n * 86400000);
}

function hoursAgo(n: number) {
	return new Date(Date.now() - n * 3600000);
}

function daysFromNow(n: number) {
	return new Date(Date.now() + n * 86400000);
}

function pick<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

// ============================================================================
// IDs — stable so script is idempotent
// ============================================================================

const ORG_IDS = {
	climatAction: 'org_climate_action_now',
	voterRights: 'org_voter_rights_coalition',
	localFirst: 'org_local_first_sf',
};

const CAMPAIGN_IDS = {
	cleanEnergy: 'camp_clean_energy_2026',
	voterAccess: 'camp_voter_access_act',
	housingCrisis: 'camp_sf_housing',
	fundraiser: 'camp_spring_fundraiser',
};

const EVENT_IDS = {
	townHall: 'evt_town_hall_march',
	phoneBank: 'evt_phone_bank',
	rally: 'evt_climate_rally',
	webinar: 'evt_voter_rights_webinar',
};

const WORKFLOW_IDS = {
	welcomeNew: 'wf_welcome_new_supporter',
	donorThank: 'wf_donor_thank_you',
	eventFollowup: 'wf_event_followup',
};

const EMAIL_BLAST_IDS = {
	climateCompleted: 'eblast_climate_completed',
	voterSending: 'eblast_voter_sending',
	sfDraft: 'eblast_sf_draft',
};

const NETWORK_ID = 'net_progressive_alliance';

// ============================================================================
// ORG TEMPLATE SNAPSHOT — produced by seed-org-templates.ts
// ============================================================================

const ORG_SNAPSHOT_PATH = join(import.meta.dirname ?? '.', 'seed-org-snapshot.json');
const orgSnapshot: Record<string, Record<string, unknown>> = existsSync(ORG_SNAPSHOT_PATH)
	? JSON.parse(readFileSync(ORG_SNAPSHOT_PATH, 'utf-8'))
	: {};

// Maps org slug → campaign ID for template→campaign wiring
const ORG_CAMPAIGN_MAP: Record<string, string> = {
	'climate-action-now': CAMPAIGN_IDS.cleanEnergy,
	'voter-rights-coalition': CAMPAIGN_IDS.voterAccess,
	'local-first-sf': CAMPAIGN_IDS.housingCrisis,
};

// Maps org slug → org ID
const ORG_SLUG_TO_ID: Record<string, string> = {
	'climate-action-now': ORG_IDS.climatAction,
	'voter-rights-coalition': ORG_IDS.voterRights,
	'local-first-sf': ORG_IDS.localFirst,
};

// ============================================================================
// TEARDOWN Phase 2 tables (reverse dependency order)
// ============================================================================

async function teardownPhase2() {
	console.log('Tearing down Phase 2 data...');

	const tables = [
		{ name: 'workflow_action_log', fn: () => db.workflowActionLog.deleteMany({}) },
		{ name: 'workflow_execution', fn: () => db.workflowExecution.deleteMany({}) },
		{ name: 'workflow', fn: () => db.workflow.deleteMany({}) },
		{ name: 'patch_through_call', fn: () => db.patchThroughCall.deleteMany({}) },
		{ name: 'sms_message', fn: () => db.smsMessage.deleteMany({}) },
		{ name: 'sms_blast', fn: () => db.smsBlast.deleteMany({}) },
		{ name: 'donation', fn: () => db.donation.deleteMany({}) },
		{ name: 'event_attendance', fn: () => db.eventAttendance.deleteMany({}) },
		{ name: 'event_rsvp', fn: () => db.eventRsvp.deleteMany({}) },
		{ name: 'event', fn: () => db.event.deleteMany({}) },
		{ name: 'campaign_delivery', fn: () => db.campaignDelivery.deleteMany({}) },
		{ name: 'campaign_action', fn: () => db.campaignAction.deleteMany({}) },
		{ name: 'email_event', fn: () => db.emailEvent.deleteMany({}) },
		{ name: 'email_batch', fn: () => db.emailBatch.deleteMany({}) },
		{ name: 'email_blast', fn: () => db.emailBlast.deleteMany({}) },
		{ name: 'campaign', fn: () => db.campaign.deleteMany({}) },
		{ name: 'scope_correction', fn: () => db.scopeCorrection.deleteMany({}) },
		{ name: 'international_dm', fn: () => db.decisionMaker.deleteMany({ where: { jurisdictionLevel: 'international' } }) },
		{ name: 'org_network_member', fn: () => db.orgNetworkMember.deleteMany({}) },
		{ name: 'org_network', fn: () => db.orgNetwork.deleteMany({}) },
		{ name: 'api_key', fn: () => db.apiKey.deleteMany({}) },
		{ name: 'subscription', fn: () => db.subscription.deleteMany({}) },
		{ name: 'segment', fn: () => db.segment.deleteMany({}) },
		{ name: 'supporter_tag', fn: () => db.supporterTag.deleteMany({}) },
		{ name: 'tag', fn: () => db.tag.deleteMany({}) },
		{ name: 'supporter', fn: () => db.supporter.deleteMany({}) },
		{ name: 'template_endorsement', fn: () => db.templateEndorsement.deleteMany({}) },
		// Org-owned templates: clear scope/jurisdiction first, then delete templates with orgId
		{ name: 'org_template_jurisdiction', fn: async () => {
			const orgIds = Object.values(ORG_IDS);
			const orgTemplates = await db.template.findMany({ where: { orgId: { in: orgIds } }, select: { id: true } });
			const ids = orgTemplates.map(t => t.id);
			return ids.length ? db.templateJurisdiction.deleteMany({ where: { template_id: { in: ids } } }) : { count: 0 };
		}},
		{ name: 'org_template_scope', fn: async () => {
			const orgIds = Object.values(ORG_IDS);
			const orgTemplates = await db.template.findMany({ where: { orgId: { in: orgIds } }, select: { id: true } });
			const ids = orgTemplates.map(t => t.id);
			return ids.length ? db.templateScope.deleteMany({ where: { template_id: { in: ids } } }) : { count: 0 };
		}},
		{ name: 'org_template', fn: () => {
			const orgIds = Object.values(ORG_IDS);
			return db.template.deleteMany({ where: { orgId: { in: orgIds } } });
		}},
		{ name: 'an_sync', fn: () => db.anSync.deleteMany({}) },
		{ name: 'org_invite', fn: () => db.orgInvite.deleteMany({}) },
		{ name: 'org_resolved_contact', fn: () => db.orgResolvedContact.deleteMany({}) },
		{ name: 'org_membership', fn: () => db.orgMembership.deleteMany({}) },
		{ name: 'organization', fn: () => db.organization.deleteMany({}) },
	];

	for (const { name, fn } of tables) {
		try {
			const r = await fn();
			if (r.count > 0) console.log(`  Deleted ${r.count} ${name}`);
		} catch {
			console.log(`  Skipped ${name}`);
		}
	}
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
	console.log('\n' + '='.repeat(60));
	console.log('PHASE 2 SEED EXTENSION');
	console.log('='.repeat(60));

	// Verify core seed ran first
	const userCount = await db.user.count();
	if (userCount === 0) {
		console.error('ERROR: No users found. Run `npm run db:seed` first.');
		process.exit(1);
	}

	const users = await db.user.findMany({ take: 12, orderBy: { createdAt: 'asc' } });
	console.log(`Found ${users.length} existing users from core seed\n`);

	await teardownPhase2();

	// ── Organizations ───────────────────────────────────────────
	console.log('\nSeeding organizations...');
	const orgs = [
		{
			id: ORG_IDS.climatAction,
			name: 'Climate Action Now',
			slug: 'climate-action-now',
			description: 'A national coalition fighting for bold climate legislation and clean energy investment.',
			billing_email: 'billing@climateactionnow.org',
			max_seats: 25,
			max_templates_month: 500,
		},
		{
			id: ORG_IDS.voterRights,
			name: 'Voter Rights Coalition',
			slug: 'voter-rights-coalition',
			description: 'Nonpartisan organization ensuring every eligible citizen can exercise their right to vote.',
			billing_email: 'finance@voterrightscoalition.org',
			max_seats: 15,
			max_templates_month: 200,
		},
		{
			id: ORG_IDS.localFirst,
			name: 'Local First SF',
			slug: 'local-first-sf',
			description: 'Grassroots San Francisco advocacy for housing, transit, and neighborhood vitality.',
			billing_email: 'admin@localfirstsf.org',
			max_seats: 10,
			max_templates_month: 100,
		},
	];

	for (const org of orgs) {
		await db.organization.create({ data: org });
		console.log(`  Created org: ${org.name}`);
	}

	// ── Org Memberships ─────────────────────────────────────────
	console.log('\nSeeding org memberships...');
	const u = (i: number) => users[i % users.length].id;
	const memberships = [
		{ userId: u(0), orgId: ORG_IDS.climatAction, role: 'owner' },
		{ userId: u(1), orgId: ORG_IDS.climatAction, role: 'editor' },
		{ userId: u(2), orgId: ORG_IDS.climatAction, role: 'member' },
		{ userId: u(0), orgId: ORG_IDS.voterRights, role: 'owner' },
		{ userId: u(1), orgId: ORG_IDS.voterRights, role: 'editor' },
		{ userId: u(2), orgId: ORG_IDS.localFirst, role: 'owner' },
		{ userId: u(0), orgId: ORG_IDS.localFirst, role: 'member' },
	];

	// Add dev account (mock7ee@gmail.com) as owner on all orgs if it exists
	const devUser = await db.user.findUnique({ where: { email: 'mock7ee@gmail.com' } });
	if (devUser) {
		for (const orgId of Object.values(ORG_IDS)) {
			const exists = memberships.some(m => m.userId === devUser.id && m.orgId === orgId);
			if (!exists) {
				memberships.push({ userId: devUser.id, orgId, role: 'owner' });
			}
		}
		console.log(`  Added dev account (mock7ee@gmail.com) as owner on all orgs`);
	}

	for (const m of memberships) {
		await db.orgMembership.create({ data: m });
	}
	console.log(`  Created ${memberships.length} memberships`);

	// ── Subscriptions ───────────────────────────────────────────
	console.log('\nSeeding subscriptions...');
	await db.subscription.create({
		data: {
			orgId: ORG_IDS.climatAction,
			plan: 'org',
			plan_description: 'Organization ($75/mo)',
			price_cents: 7500,
			status: 'active',
			payment_method: 'stripe',
			stripe_subscription_id: 'sub_mock_climate_' + Date.now(),
			current_period_start: daysAgo(15),
			current_period_end: daysFromNow(15),
		},
	});
	await db.subscription.create({
		data: {
			orgId: ORG_IDS.voterRights,
			plan: 'starter',
			plan_description: 'Starter ($10/mo)',
			price_cents: 1000,
			status: 'active',
			payment_method: 'stripe',
			stripe_subscription_id: 'sub_mock_voter_' + Date.now(),
			current_period_start: daysAgo(10),
			current_period_end: daysFromNow(20),
		},
	});
	console.log('  Created 2 subscriptions');

	// ── API Keys ────────────────────────────────────────────────
	console.log('\nSeeding API keys...');
	const apiKeyPlaintext = 'ck_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
	await db.apiKey.create({
		data: {
			orgId: ORG_IDS.climatAction,
			keyHash: sha256(apiKeyPlaintext),
			keyPrefix: 'ck_live_a1b2c3d4',
			name: 'Production Key',
			scopes: ['read', 'write'],
			createdBy: users[0].id,
		},
	});
	console.log('  Created 1 API key');

	// ── Supporters ──────────────────────────────────────────────
	console.log('\nSeeding supporters...');
	const supporterNames = [
		{ name: 'Alice Chen', email: 'alice.chen@example.com', postal: '94110', phone: '+14155551001' },
		{ name: 'Bob Martinez', email: 'bob.martinez@example.com', postal: '94122', phone: '+14155551002' },
		{ name: 'Carol Washington', email: 'carol.w@example.com', postal: '10001', phone: '+12125551003' },
		{ name: 'David Kim', email: 'david.kim@example.com', postal: '78701', phone: '+15125551004' },
		{ name: 'Elena Rossi', email: 'elena.rossi@example.com', postal: '20001', phone: '+12025551005' },
		{ name: 'Frank Nguyen', email: 'frank.nguyen@example.com', postal: '97201', phone: '+15035551006' },
		{ name: 'Grace Patel', email: 'grace.patel@example.com', postal: '33101', phone: '+13055551007' },
		{ name: 'Henry Okafor', email: 'henry.o@example.com', postal: '60601', phone: '+17735551008' },
		{ name: 'Iris Tanaka', email: 'iris.tanaka@example.com', postal: '98101', phone: '+12065551009' },
		{ name: 'James Brown', email: 'james.brown@example.com', postal: '90001', phone: '+12135551010' },
		{ name: 'Karen Li', email: 'karen.li@example.com', postal: '02101', phone: '+16175551011' },
		{ name: 'Liam O\'Brien', email: 'liam.obrien@example.com', postal: '80202', phone: '+13035551012' },
		{ name: 'Maria Santos', email: 'maria.santos@example.com', postal: '85001', phone: '+16025551013' },
		{ name: 'Nathan Williams', email: 'nathan.w@example.com', postal: '30301', phone: '+14045551014' },
		{ name: 'Olivia Johnson', email: 'olivia.j@example.com', postal: '55401', phone: '+16125551015' },
		{ name: 'Paul Garcia', email: 'paul.garcia@example.com', postal: '73301', phone: '+14055551016' },
		{ name: 'Quinn Taylor', email: 'quinn.t@example.com', postal: '28202', phone: '+17045551017' },
		{ name: 'Rachel Adams', email: 'rachel.a@example.com', postal: '15201', phone: '+14125551018' },
		{ name: 'Samuel Lee', email: 'samuel.lee@example.com', postal: '48201', phone: '+13135551019' },
		{ name: 'Teresa Rivera', email: 'teresa.r@example.com', postal: '87101', phone: '+15055551020' },
	];

	const supporterIds: Record<string, string[]> = {
		[ORG_IDS.climatAction]: [],
		[ORG_IDS.voterRights]: [],
		[ORG_IDS.localFirst]: [],
	};

	const orgKeys = Object.values(ORG_IDS);

	for (let i = 0; i < supporterNames.length; i++) {
		const s = supporterNames[i];
		// Distribute: first 10 → climate, next 6 → voter, last 4 → localFirst
		const orgId = i < 10 ? orgKeys[0] : i < 16 ? orgKeys[1] : orgKeys[2];
		const sources = ['organic', 'csv', 'action_network', 'widget'];
		const id = cuid();
		await db.supporter.create({
			data: {
				id,
				orgId,
				email: s.email,
				name: s.name,
				postalCode: s.postal,
				phone: s.phone,
				verified: i % 3 !== 2, // ~67% verified
				emailStatus: i === 7 ? 'bounced' : i === 13 ? 'unsubscribed' : 'subscribed',
				source: sources[i % sources.length],
				importedAt: i % 2 === 0 ? daysAgo(30 + i) : null,
			},
		});
		supporterIds[orgId].push(id);
	}
	console.log(`  Created ${supporterNames.length} supporters across 3 orgs`);

	// ── Tags ────────────────────────────────────────────────────
	console.log('\nSeeding tags...');
	const tagDefs: { orgId: string; names: string[] }[] = [
		{ orgId: ORG_IDS.climatAction, names: ['volunteer', 'donor', 'phone-banker', 'event-attendee', 'high-value'] },
		{ orgId: ORG_IDS.voterRights, names: ['volunteer', 'donor', 'registered-voter', 'poll-worker'] },
		{ orgId: ORG_IDS.localFirst, names: ['volunteer', 'neighbor', 'business-owner'] },
	];
	const tagMap: Record<string, string> = {};

	for (const { orgId, names } of tagDefs) {
		for (const name of names) {
			const tag = await db.tag.create({ data: { orgId, name } });
			tagMap[`${orgId}:${name}`] = tag.id;
		}
	}

	// Assign tags to supporters
	for (const orgId of orgKeys) {
		const sIds = supporterIds[orgId];
		const orgTags = Object.entries(tagMap).filter(([k]) => k.startsWith(orgId));
		for (let i = 0; i < sIds.length; i++) {
			// Each supporter gets 1-3 tags
			const numTags = 1 + (i % 3);
			for (let t = 0; t < numTags && t < orgTags.length; t++) {
				await db.supporterTag.create({
					data: { supporterId: sIds[i], tagId: orgTags[t][1] },
				});
			}
		}
	}
	console.log(`  Created ${Object.keys(tagMap).length} tags with supporter assignments`);

	// ── Segments ────────────────────────────────────────────────
	console.log('\nSeeding segments...');
	await db.segment.create({
		data: {
			orgId: ORG_IDS.climatAction,
			name: 'Active Donors',
			description: 'Supporters who have donated in the last 90 days',
			filters: { logic: 'AND', conditions: [{ field: 'tags', operator: 'includes', value: 'donor' }] } as unknown as InputJsonValue,
			cachedCount: 4,
			countedAt: hoursAgo(1),
			createdBy: users[0].id,
		},
	});
	await db.segment.create({
		data: {
			orgId: ORG_IDS.climatAction,
			name: 'Verified Volunteers',
			description: 'Verified supporters tagged as volunteers',
			filters: { logic: 'AND', conditions: [{ field: 'verified', operator: 'equals', value: true }, { field: 'tags', operator: 'includes', value: 'volunteer' }] } as unknown as InputJsonValue,
			cachedCount: 6,
			countedAt: hoursAgo(2),
			createdBy: users[0].id,
		},
	});
	console.log('  Created 2 segments');

	// ── Campaigns ───────────────────────────────────────────────
	console.log('\nSeeding campaigns...');
	const campaigns = [
		{
			id: CAMPAIGN_IDS.cleanEnergy,
			orgId: ORG_IDS.climatAction,
			type: 'LETTER',
			title: 'Clean Energy Investment Act — Contact Your Rep',
			body: 'Urge your representative to support the Clean Energy Investment Act of 2026.',
			status: 'ACTIVE',
			goalAmountCents: 5000000,
			raisedAmountCents: 234500,
			donorCount: 47,
			targetCountry: 'US',
		},
		{
			id: CAMPAIGN_IDS.voterAccess,
			orgId: ORG_IDS.voterRights,
			type: 'LETTER',
			title: 'Voter Access Expansion Act',
			body: 'Support expanded mail-in voting and same-day registration nationwide.',
			status: 'ACTIVE',
			targetCountry: 'US',
		},
		{
			id: CAMPAIGN_IDS.housingCrisis,
			orgId: ORG_IDS.localFirst,
			type: 'LETTER',
			title: 'SF Housing Crisis Response',
			body: 'Demand immediate action on the San Francisco housing shortage.',
			status: 'ACTIVE',
			targetCountry: 'US',
		},
		{
			id: CAMPAIGN_IDS.fundraiser,
			orgId: ORG_IDS.climatAction,
			type: 'FORM',
			title: 'Spring 2026 Fundraiser',
			body: 'Help us fund grassroots climate organizing across 50 states.',
			status: 'ACTIVE',
			goalAmountCents: 10000000,
			raisedAmountCents: 1875000,
			donorCount: 312,
			targetCountry: 'US',
		},
	];

	for (const c of campaigns) {
		await db.campaign.create({ data: c });
		console.log(`  Created campaign: ${c.title}`);
	}

	// ── Org Templates (from snapshot) ───────────────────────────
	const snapshotKeys = Object.keys(orgSnapshot);
	if (snapshotKeys.length > 0) {
		console.log(`\nSeeding org templates from snapshot (${snapshotKeys.length})...`);
		for (const orgSlug of snapshotKeys) {
			const s = orgSnapshot[orgSlug] as Record<string, unknown>;
			const orgId = ORG_SLUG_TO_ID[orgSlug];
			const campaignId = ORG_CAMPAIGN_MAP[orgSlug];
			if (!orgId) {
				console.log(`  Skipped ${orgSlug}: no matching org`);
				continue;
			}

			const templateId = cuid();
			await db.template.create({
				data: {
					id: templateId,
					slug: s.slug as string,
					title: s.title as string,
					description: s.description as string,
					message_body: s.message_body as string,
					preview: s.preview as string,
					category: s.category as string,
					topics: s.topics as InputJsonValue,
					type: s.type as string,
					deliveryMethod: s.deliveryMethod as string,
					country_code: s.country_code as string,
					sources: s.sources as InputJsonValue,
					research_log: s.research_log as InputJsonValue,
					recipient_config: s.recipient_config as InputJsonValue,
					delivery_config: s.delivery_config as InputJsonValue,
					cwc_config: s.cwc_config as InputJsonValue,
					content_hash: s.content_hash as string,
					metrics: { sent: 0, opened: 0, clicked: 0, responded: 0, districts_covered: 0 } as InputJsonValue,
					status: 'published',
					is_public: true,
					verification_status: 'approved',
					consensus_approved: true,
					verified_sends: 0,
					unique_districts: 0,
					reputation_delta: 0,
					reputation_applied: false,
					org: { connect: { id: orgId } },
					user: { connect: { id: users[0].id } },
				},
			});

			// Scope + Jurisdiction
			const scope = s.scope as Record<string, unknown> | null;
			if (scope) {
				await db.templateScope.create({
					data: {
						template_id: templateId,
						scope_level: scope.scope_level as string,
						country_code: scope.country_code as string,
						region_code: (scope.region_code as string) || null,
						locality_code: (scope.locality_code as string) || null,
						display_text: scope.display_text as string,
						confidence: 1.0,
						extraction_method: 'gemini_inline',
					},
				});
			}
			const jurisdiction = s.jurisdiction as Record<string, unknown> | null;
			if (jurisdiction) {
				await db.templateJurisdiction.create({
					data: {
						template_id: templateId,
						jurisdiction_type: jurisdiction.jurisdiction_type as string,
						state_code: (jurisdiction.state_code as string) || null,
					},
				});
			}

			// Wire campaign → template
			if (campaignId) {
				await db.campaign.update({
					where: { id: campaignId },
					data: { templateId },
				});
			}

			console.log(`  Created org template: ${s.title} → ${orgSlug}${campaignId ? ` (linked to ${campaignId})` : ''}`);
		}
	} else {
		console.log('\nNo seed-org-snapshot.json found — skipping org templates');
	}

	// ── Campaign Actions ────────────────────────────────────────
	console.log('\nSeeding campaign actions...');
	let actionCount = 0;
	for (const sId of supporterIds[ORG_IDS.climatAction].slice(0, 7)) {
		await db.campaignAction.create({
			data: {
				campaignId: CAMPAIGN_IDS.cleanEnergy,
				supporterId: sId,
				verified: Math.random() > 0.3,
				engagementTier: Math.floor(Math.random() * 4),
				districtHash: sha256('CA-11-' + sId),
				sentAt: daysAgo(Math.floor(Math.random() * 14)),
			},
		});
		actionCount++;
	}
	console.log(`  Created ${actionCount} campaign actions`);

	// ── Campaign Deliveries ────────────────────────────────────
	console.log('\nSeeding campaign deliveries...');
	const deliveryTargets = [
		{ name: 'Rep. Maria Gonzalez', email: 'maria.gonzalez@house.gov', title: 'U.S. Representative', district: 'CA-11' },
		{ name: 'Rep. James Whitfield', email: 'james.whitfield@house.gov', title: 'U.S. Representative', district: 'CA-12' },
		{ name: 'Sen. Patricia Huang', email: 'patricia.huang@senate.gov', title: 'U.S. Senator', district: 'CA' },
		{ name: 'Rep. David Okonkwo', email: 'david.okonkwo@house.gov', title: 'U.S. Representative', district: 'NY-10' },
		{ name: 'Sen. Linda Farrow', email: 'linda.farrow@senate.gov', title: 'U.S. Senator', district: 'NY' },
		{ name: 'Rep. Carlos Medina', email: 'carlos.medina@house.gov', title: 'U.S. Representative', district: 'TX-21' },
		{ name: 'Rep. Susan Park', email: 'susan.park@house.gov', title: 'U.S. Representative', district: 'WA-07' },
		{ name: 'Sen. Robert Kessler', email: 'robert.kessler@senate.gov', title: 'U.S. Senator', district: 'OR' },
	];

	const deliveryDefs: {
		campaignId: string;
		orgId: string;
		targetIdx: number;
		supporterIdx: number;
		status: string;
		daysBack: number;
		bounceReason?: string;
	}[] = [
		// cleanEnergy — 9 deliveries
		{ campaignId: CAMPAIGN_IDS.cleanEnergy, orgId: ORG_IDS.climatAction, targetIdx: 0, supporterIdx: 0, status: 'delivered', daysBack: 10 },
		{ campaignId: CAMPAIGN_IDS.cleanEnergy, orgId: ORG_IDS.climatAction, targetIdx: 0, supporterIdx: 1, status: 'opened', daysBack: 9 },
		{ campaignId: CAMPAIGN_IDS.cleanEnergy, orgId: ORG_IDS.climatAction, targetIdx: 1, supporterIdx: 2, status: 'delivered', daysBack: 8 },
		{ campaignId: CAMPAIGN_IDS.cleanEnergy, orgId: ORG_IDS.climatAction, targetIdx: 1, supporterIdx: 3, status: 'sent', daysBack: 7 },
		{ campaignId: CAMPAIGN_IDS.cleanEnergy, orgId: ORG_IDS.climatAction, targetIdx: 2, supporterIdx: 4, status: 'opened', daysBack: 6 },
		{ campaignId: CAMPAIGN_IDS.cleanEnergy, orgId: ORG_IDS.climatAction, targetIdx: 2, supporterIdx: 5, status: 'bounced', daysBack: 5, bounceReason: 'Mailbox full — 552 5.2.2' },
		{ campaignId: CAMPAIGN_IDS.cleanEnergy, orgId: ORG_IDS.climatAction, targetIdx: 0, supporterIdx: 6, status: 'queued', daysBack: 1 },
		{ campaignId: CAMPAIGN_IDS.cleanEnergy, orgId: ORG_IDS.climatAction, targetIdx: 1, supporterIdx: 7, status: 'queued', daysBack: 0 },
		{ campaignId: CAMPAIGN_IDS.cleanEnergy, orgId: ORG_IDS.climatAction, targetIdx: 2, supporterIdx: 8, status: 'delivered', daysBack: 4 },
		// voterAccess — 8 deliveries
		{ campaignId: CAMPAIGN_IDS.voterAccess, orgId: ORG_IDS.voterRights, targetIdx: 3, supporterIdx: 0, status: 'delivered', daysBack: 12 },
		{ campaignId: CAMPAIGN_IDS.voterAccess, orgId: ORG_IDS.voterRights, targetIdx: 3, supporterIdx: 1, status: 'opened', daysBack: 11 },
		{ campaignId: CAMPAIGN_IDS.voterAccess, orgId: ORG_IDS.voterRights, targetIdx: 4, supporterIdx: 2, status: 'sent', daysBack: 6 },
		{ campaignId: CAMPAIGN_IDS.voterAccess, orgId: ORG_IDS.voterRights, targetIdx: 4, supporterIdx: 3, status: 'bounced', daysBack: 5, bounceReason: 'No such user — 550 5.1.1' },
		{ campaignId: CAMPAIGN_IDS.voterAccess, orgId: ORG_IDS.voterRights, targetIdx: 5, supporterIdx: 4, status: 'delivered', daysBack: 3 },
		{ campaignId: CAMPAIGN_IDS.voterAccess, orgId: ORG_IDS.voterRights, targetIdx: 5, supporterIdx: 5, status: 'opened', daysBack: 2 },
		{ campaignId: CAMPAIGN_IDS.voterAccess, orgId: ORG_IDS.voterRights, targetIdx: 3, supporterIdx: 0, status: 'queued', daysBack: 0 },
		{ campaignId: CAMPAIGN_IDS.voterAccess, orgId: ORG_IDS.voterRights, targetIdx: 4, supporterIdx: 1, status: 'sent', daysBack: 1 },
		// housingCrisis — 6 deliveries
		{ campaignId: CAMPAIGN_IDS.housingCrisis, orgId: ORG_IDS.localFirst, targetIdx: 6, supporterIdx: 0, status: 'delivered', daysBack: 7 },
		{ campaignId: CAMPAIGN_IDS.housingCrisis, orgId: ORG_IDS.localFirst, targetIdx: 6, supporterIdx: 1, status: 'opened', daysBack: 6 },
		{ campaignId: CAMPAIGN_IDS.housingCrisis, orgId: ORG_IDS.localFirst, targetIdx: 7, supporterIdx: 2, status: 'delivered', daysBack: 4 },
		{ campaignId: CAMPAIGN_IDS.housingCrisis, orgId: ORG_IDS.localFirst, targetIdx: 7, supporterIdx: 3, status: 'bounced', daysBack: 3, bounceReason: 'Domain not found — DNS lookup failed' },
		{ campaignId: CAMPAIGN_IDS.housingCrisis, orgId: ORG_IDS.localFirst, targetIdx: 6, supporterIdx: 0, status: 'queued', daysBack: 0 },
		{ campaignId: CAMPAIGN_IDS.housingCrisis, orgId: ORG_IDS.localFirst, targetIdx: 7, supporterIdx: 1, status: 'sent', daysBack: 1 },
	];

	for (const d of deliveryDefs) {
		const target = deliveryTargets[d.targetIdx];
		const sIds = supporterIds[d.orgId];
		const sIdx = d.supporterIdx % sIds.length;
		const createdAt = daysAgo(d.daysBack);
		const sentAt = d.status !== 'queued' ? new Date(createdAt.getTime() + 60_000) : null;

		await db.campaignDelivery.create({
			data: {
				campaignId: d.campaignId,
				targetEmail: target.email,
				targetName: target.name,
				targetTitle: target.title,
				targetDistrict: target.district,
				status: d.status,
				sentAt,
				packetSnapshot: {
					supporterId: sIds[sIdx],
					verified: true,
					engagementTier: 2,
					districtHash: sha256(target.district + '-' + sIds[sIdx]),
					sentVia: 'commons_delivery',
					...(d.bounceReason ? { bounceReason: d.bounceReason } : {}),
				} as unknown as InputJsonValue,
				createdAt,
			},
		});
	}
	console.log(`  Created ${deliveryDefs.length} campaign deliveries`);

	// ── Email Blasts ────────────────────────────────────────────
	console.log('\nSeeding email blasts...');

	await db.emailBlast.create({
		data: {
			id: EMAIL_BLAST_IDS.climateCompleted,
			orgId: ORG_IDS.climatAction,
			campaignId: CAMPAIGN_IDS.cleanEnergy,
			subject: 'Urgent: The Clean Energy Act vote is next week',
			bodyHtml: '<h1>Take Action Now</h1><p>Your representative needs to hear from you before the floor vote on the Clean Energy Investment Act. <a href="https://climateactionnow.org/act">Write your rep now</a>.</p>',
			fromName: 'Climate Action Now',
			fromEmail: 'campaigns@climateactionnow.org',
			status: 'sent',
			recipientFilter: { tags: ['volunteer', 'donor'], verified: true } as unknown as InputJsonValue,
			totalRecipients: 200,
			totalSent: 196,
			totalBounced: 4,
			totalOpened: 51,
			totalClicked: 11,
			totalComplained: 1,
			sentAt: daysAgo(5),
		},
	});

	await db.emailBlast.create({
		data: {
			id: EMAIL_BLAST_IDS.voterSending,
			orgId: ORG_IDS.voterRights,
			campaignId: CAMPAIGN_IDS.voterAccess,
			subject: 'Same-day registration is under threat in 3 states',
			bodyHtml: '<h1>Protect Voter Access</h1><p>Legislators in Georgia, Texas, and Ohio are moving to eliminate same-day voter registration. <a href="https://voterrightscoalition.org/act">Send a letter today</a>.</p>',
			fromName: 'Voter Rights Coalition',
			fromEmail: 'action@voterrightscoalition.org',
			status: 'sending',
			recipientFilter: { emailStatus: 'subscribed' } as unknown as InputJsonValue,
			totalRecipients: 120,
			totalSent: 78,
			totalBounced: 2,
			totalOpened: 18,
			totalClicked: 4,
			totalComplained: 0,
			sentAt: hoursAgo(2),
		},
	});

	await db.emailBlast.create({
		data: {
			id: EMAIL_BLAST_IDS.sfDraft,
			orgId: ORG_IDS.localFirst,
			campaignId: CAMPAIGN_IDS.housingCrisis,
			subject: 'SF Board of Supervisors hearing on Mission District rezoning',
			bodyHtml: '<h1>Show Up for Housing</h1><p>Draft — the Board votes March 28. We need 500 letters by then.</p>',
			fromName: 'Local First SF',
			fromEmail: 'team@localfirstsf.org',
			status: 'draft',
			totalRecipients: 0,
			totalSent: 0,
			totalBounced: 0,
			totalOpened: 0,
			totalClicked: 0,
			totalComplained: 0,
		},
	});
	console.log('  Created 3 email blasts (completed, sending, draft)');

	// ── Email Batches ───────────────────────────────────────────
	console.log('\nSeeding email batches...');
	const climateBatch1Id = cuid();
	const climateBatch2Id = cuid();
	const climateBatch3Id = cuid();
	const voterBatch1Id = cuid();
	const voterBatch2Id = cuid();
	const voterBatch3Id = cuid();

	const emailBatches = [
		{ id: climateBatch1Id, blastId: EMAIL_BLAST_IDS.climateCompleted, batchIndex: 0, status: 'sent', sentCount: 100, failedCount: 2, sentAt: daysAgo(5) },
		{ id: climateBatch2Id, blastId: EMAIL_BLAST_IDS.climateCompleted, batchIndex: 1, status: 'sent', sentCount: 96, failedCount: 2, sentAt: daysAgo(5) },
		{ id: climateBatch3Id, blastId: EMAIL_BLAST_IDS.climateCompleted, batchIndex: 2, status: 'failed', sentCount: 0, failedCount: 0, error: 'Rate limit exceeded — retries exhausted' },
		{ id: voterBatch1Id, blastId: EMAIL_BLAST_IDS.voterSending, batchIndex: 0, status: 'sent', sentCount: 40, failedCount: 1, sentAt: hoursAgo(2) },
		{ id: voterBatch2Id, blastId: EMAIL_BLAST_IDS.voterSending, batchIndex: 1, status: 'sent', sentCount: 38, failedCount: 1, sentAt: hoursAgo(1) },
		{ id: voterBatch3Id, blastId: EMAIL_BLAST_IDS.voterSending, batchIndex: 2, status: 'pending', sentCount: 0, failedCount: 0 },
	];

	for (const batch of emailBatches) {
		await db.emailBatch.create({ data: batch });
	}
	console.log(`  Created ${emailBatches.length} email batches`);

	// ── Email Events ────────────────────────────────────────────
	console.log('\nSeeding email events...');
	const climateSupporterEmails = supporterIds[ORG_IDS.climatAction].map(
		(_, i) => supporterNames[i].email
	);
	const voterSupporterEmails = supporterIds[ORG_IDS.voterRights].map(
		(_, i) => supporterNames[10 + i].email
	);

	const emailEvents: {
		blastId: string;
		recipientEmail: string;
		eventType: string;
		linkUrl?: string;
		linkIndex?: number;
		timestamp: Date;
	}[] = [];

	for (let i = 0; i < climateSupporterEmails.length; i++) {
		const email = climateSupporterEmails[i];
		if (i === 7) {
			emailEvents.push({ blastId: EMAIL_BLAST_IDS.climateCompleted, recipientEmail: email, eventType: 'bounce', timestamp: daysAgo(5) });
			continue;
		}
		if (i < 3) {
			emailEvents.push({ blastId: EMAIL_BLAST_IDS.climateCompleted, recipientEmail: email, eventType: 'open', timestamp: daysAgo(5) });
		}
		if (i === 0) {
			emailEvents.push({ blastId: EMAIL_BLAST_IDS.climateCompleted, recipientEmail: email, eventType: 'click', linkUrl: 'https://climateactionnow.org/act', linkIndex: 0, timestamp: daysAgo(5) });
		}
	}

	for (let i = 0; i < 12; i++) {
		const fakeEmail = `supporter${i + 100}@example.com`;
		emailEvents.push({ blastId: EMAIL_BLAST_IDS.climateCompleted, recipientEmail: fakeEmail, eventType: 'open', timestamp: daysAgo(5 - (i % 4)) });
		if (i < 2) {
			emailEvents.push({ blastId: EMAIL_BLAST_IDS.climateCompleted, recipientEmail: fakeEmail, eventType: 'click', linkUrl: 'https://climateactionnow.org/act', linkIndex: 0, timestamp: daysAgo(4) });
		}
	}

	emailEvents.push({ blastId: EMAIL_BLAST_IDS.climateCompleted, recipientEmail: 'unsubscriber42@example.com', eventType: 'complaint', timestamp: daysAgo(4) });
	emailEvents.push({ blastId: EMAIL_BLAST_IDS.climateCompleted, recipientEmail: 'invalid1@example.com', eventType: 'bounce', timestamp: daysAgo(5) });
	emailEvents.push({ blastId: EMAIL_BLAST_IDS.climateCompleted, recipientEmail: 'invalid2@example.com', eventType: 'bounce', timestamp: daysAgo(5) });
	emailEvents.push({ blastId: EMAIL_BLAST_IDS.climateCompleted, recipientEmail: 'invalid3@example.com', eventType: 'bounce', timestamp: daysAgo(5) });

	for (let i = 0; i < voterSupporterEmails.length; i++) {
		const email = voterSupporterEmails[i];
		if (i < 2) {
			emailEvents.push({ blastId: EMAIL_BLAST_IDS.voterSending, recipientEmail: email, eventType: 'open', timestamp: hoursAgo(1) });
		}
		if (i === 0) {
			emailEvents.push({ blastId: EMAIL_BLAST_IDS.voterSending, recipientEmail: email, eventType: 'click', linkUrl: 'https://voterrightscoalition.org/act', linkIndex: 0, timestamp: hoursAgo(1) });
		}
	}

	for (let i = 0; i < 5; i++) {
		const fakeEmail = `voter${i + 200}@example.com`;
		emailEvents.push({ blastId: EMAIL_BLAST_IDS.voterSending, recipientEmail: fakeEmail, eventType: 'open', timestamp: hoursAgo(1) });
		if (i === 0) {
			emailEvents.push({ blastId: EMAIL_BLAST_IDS.voterSending, recipientEmail: fakeEmail, eventType: 'click', linkUrl: 'https://voterrightscoalition.org/act', linkIndex: 0, timestamp: hoursAgo(1) });
		}
	}

	emailEvents.push({ blastId: EMAIL_BLAST_IDS.voterSending, recipientEmail: 'bad-addr1@example.com', eventType: 'bounce', timestamp: hoursAgo(2) });
	emailEvents.push({ blastId: EMAIL_BLAST_IDS.voterSending, recipientEmail: 'bad-addr2@example.com', eventType: 'bounce', timestamp: hoursAgo(1) });

	for (const ev of emailEvents) {
		await db.emailEvent.create({ data: ev });
	}
	console.log(`  Created ${emailEvents.length} email events`);

	// ── Events ──────────────────────────────────────────────────
	console.log('\nSeeding events...');
	const events = [
		{
			id: EVENT_IDS.townHall,
			orgId: ORG_IDS.climatAction,
			campaignId: CAMPAIGN_IDS.cleanEnergy,
			title: 'Climate Town Hall: Clean Energy Future',
			description: 'Join us for a community town hall discussing the Clean Energy Investment Act with local representatives.',
			eventType: 'HYBRID' as const,
			startAt: daysFromNow(7),
			endAt: daysFromNow(7.125),
			timezone: 'America/Los_Angeles',
			venue: 'SF Community Center',
			address: '1060 Howard St',
			city: 'San Francisco',
			state: 'CA',
			postalCode: '94103',
			latitude: 37.7785,
			longitude: -122.4056,
			virtualUrl: 'https://meet.example.com/town-hall-march',
			capacity: 200,
			waitlistEnabled: true,
			rsvpCount: 87,
			attendeeCount: 0,
			checkinCode: 'CLIMATE2026',
			requireVerification: true,
			status: 'PUBLISHED' as const,
		},
		{
			id: EVENT_IDS.phoneBank,
			orgId: ORG_IDS.voterRights,
			campaignId: CAMPAIGN_IDS.voterAccess,
			title: 'Voter Access Phone Bank Night',
			description: 'Call voters in key districts to spread awareness about same-day registration rights.',
			eventType: 'VIRTUAL' as const,
			startAt: daysFromNow(3),
			endAt: daysFromNow(3.083),
			timezone: 'America/New_York',
			virtualUrl: 'https://meet.example.com/phone-bank',
			capacity: 50,
			rsvpCount: 32,
			checkinCode: 'VOTE2026',
			status: 'PUBLISHED' as const,
		},
		{
			id: EVENT_IDS.rally,
			orgId: ORG_IDS.climatAction,
			title: 'March for Climate Justice',
			description: 'A city-wide march demanding bold climate legislation and environmental justice.',
			eventType: 'IN_PERSON' as const,
			startAt: daysFromNow(14),
			endAt: daysFromNow(14.167),
			timezone: 'America/Los_Angeles',
			venue: 'Civic Center Plaza',
			address: '1 Dr Carlton B Goodlett Pl',
			city: 'San Francisco',
			state: 'CA',
			postalCode: '94102',
			latitude: 37.7793,
			longitude: -122.4193,
			capacity: 5000,
			rsvpCount: 1247,
			checkinCode: 'MARCH26',
			requireVerification: false,
			status: 'PUBLISHED' as const,
		},
		{
			id: EVENT_IDS.webinar,
			orgId: ORG_IDS.voterRights,
			title: 'Know Your Voting Rights — 2026 Midterm Prep',
			description: 'Expert panel on voter rights, registration deadlines, and how to volunteer as a poll worker.',
			eventType: 'VIRTUAL' as const,
			startAt: daysAgo(3),
			endAt: daysAgo(2.917),
			timezone: 'America/New_York',
			virtualUrl: 'https://meet.example.com/voting-rights-webinar',
			capacity: 500,
			rsvpCount: 215,
			attendeeCount: 178,
			verifiedAttendees: 142,
			checkinCode: 'RIGHTS26',
			status: 'COMPLETED' as const,
		},
	];

	for (const e of events) {
		await db.event.create({ data: e });
		console.log(`  Created event: ${e.title}`);
	}

	// ── Event RSVPs ─────────────────────────────────────────────
	console.log('\nSeeding event RSVPs...');
	let rsvpCount = 0;
	const rsvpStatuses = ['GOING', 'GOING', 'GOING', 'MAYBE', 'NOT_GOING'] as const;
	// Town hall RSVPs from climate supporters
	for (let i = 0; i < 8; i++) {
		const s = supporterNames[i];
		const rsvp = await db.eventRsvp.create({
			data: {
				eventId: EVENT_IDS.townHall,
				supporterId: supporterIds[ORG_IDS.climatAction][i],
				email: s.email,
				name: s.name,
				status: rsvpStatuses[i % rsvpStatuses.length],
				guestCount: i % 3,
				districtHash: sha256('CA-11-rsvp-' + i),
				engagementTier: Math.min(i, 3),
			},
		});
		rsvpCount++;

		// Past webinar — add attendance for completed event
		if (i < 5) {
			const webRsvp = await db.eventRsvp.create({
				data: {
					eventId: EVENT_IDS.webinar,
					supporterId: i < 6 ? supporterIds[ORG_IDS.voterRights][i % supporterIds[ORG_IDS.voterRights].length] : null,
					email: s.email,
					name: s.name,
					status: 'GOING',
					engagementTier: i,
				},
			});
			rsvpCount++;

			// Attendance records for completed event
			await db.eventAttendance.create({
				data: {
					eventId: EVENT_IDS.webinar,
					rsvpId: webRsvp.id,
					verified: i < 4,
					verificationMethod: i < 4 ? pick(['passkey', 'checkin_code']) : null,
					districtHash: sha256('webinar-attend-' + i),
					checkedInAt: daysAgo(3),
				},
			});
		}
	}
	console.log(`  Created ${rsvpCount} RSVPs + attendance records`);

	// ── Donations ───────────────────────────────────────────────
	console.log('\nSeeding donations...');
	const donationAmounts = [2500, 5000, 10000, 2500, 15000, 50000, 7500, 3000, 100000, 5000, 2000, 25000];

	let donationCount = 0;
	for (let i = 0; i < donationAmounts.length; i++) {
		const orgId = i < 8 ? ORG_IDS.climatAction : ORG_IDS.voterRights;
		const campId = i < 8 ? CAMPAIGN_IDS.fundraiser : CAMPAIGN_IDS.voterAccess;
		const sIds = supporterIds[orgId];
		const s = supporterNames[i % supporterNames.length];

		await db.donation.create({
			data: {
				orgId,
				campaignId: campId,
				supporterId: sIds[i % sIds.length],
				email: s.email,
				name: s.name,
				amountCents: donationAmounts[i],
				currency: 'usd',
				recurring: i % 4 === 0,
				recurringInterval: i % 4 === 0 ? 'month' : null,
				stripeSessionId: `cs_mock_${Date.now()}_${i}`,
				stripePaymentIntentId: `pi_mock_${Date.now()}_${i}`,
				status: i === 3 ? 'pending' : 'completed',
				districtHash: sha256('donation-district-' + i),
				engagementTier: Math.min(Math.floor(donationAmounts[i] / 10000), 4),
				completedAt: i === 3 ? null : daysAgo(Math.floor(Math.random() * 30)),
			},
		});
		donationCount++;
	}
	console.log(`  Created ${donationCount} donations`);

	// ── Workflows (Automation) ──────────────────────────────────
	console.log('\nSeeding workflows...');
	const workflows = [
		{
			id: WORKFLOW_IDS.welcomeNew,
			orgId: ORG_IDS.climatAction,
			name: 'Welcome New Supporter',
			description: 'Sends a welcome email and tags new supporters as volunteers after 3 days.',
			trigger: { type: 'supporter_created' },
			steps: [
				{ action: 'send_email', config: { subject: 'Welcome to Climate Action Now!', body: 'Thank you for joining our movement.' } },
				{ action: 'delay', config: { duration: '3d' } },
				{ action: 'add_tag', config: { tag: 'volunteer' } },
			],
			enabled: true,
		},
		{
			id: WORKFLOW_IDS.donorThank,
			orgId: ORG_IDS.climatAction,
			name: 'Donor Thank You',
			description: 'Sends a personalized thank-you email when a donation is completed.',
			trigger: { type: 'donation_completed' },
			steps: [
				{ action: 'send_email', config: { subject: 'Thank you for your generous donation!', body: 'Your contribution makes a real difference.' } },
				{ action: 'add_tag', config: { tag: 'donor' } },
				{ action: 'condition', config: { field: 'amount', operator: 'gte', value: 10000 } },
				{ action: 'add_tag', config: { tag: 'high-value' } },
			],
			enabled: true,
		},
		{
			id: WORKFLOW_IDS.eventFollowup,
			orgId: ORG_IDS.voterRights,
			name: 'Event Follow-up',
			description: 'Follow up with attendees after event check-in.',
			trigger: { type: 'event_checkin' },
			steps: [
				{ action: 'delay', config: { duration: '1d' } },
				{ action: 'send_email', config: { subject: 'Thanks for attending!', body: 'We hope you enjoyed the event.' } },
				{ action: 'add_tag', config: { tag: 'event-attendee' } },
			],
			enabled: true,
		},
	];

	for (const wf of workflows) {
		await db.workflow.create({
			data: {
				id: wf.id,
				orgId: wf.orgId,
				name: wf.name,
				description: wf.description,
				trigger: wf.trigger as unknown as InputJsonValue,
				steps: wf.steps as unknown as InputJsonValue,
				enabled: wf.enabled,
			},
		});
		console.log(`  Created workflow: ${wf.name}`);
	}

	// ── Workflow Executions ─────────────────────────────────────
	console.log('\nSeeding workflow executions...');
	let execCount = 0;
	for (let i = 0; i < 5; i++) {
		const sId = supporterIds[ORG_IDS.climatAction][i];
		const exec = await db.workflowExecution.create({
			data: {
				workflowId: WORKFLOW_IDS.welcomeNew,
				supporterId: sId,
				triggerEvent: { type: 'supporter_created', entityId: sId } as unknown as InputJsonValue,
				status: i < 3 ? 'completed' : i === 3 ? 'running' : 'pending',
				currentStep: i < 3 ? 3 : i === 3 ? 1 : 0,
				completedAt: i < 3 ? daysAgo(30 - i * 5) : null,
			},
		});
		execCount++;

		// Action logs for completed executions
		if (i < 3) {
			for (let step = 0; step < 3; step++) {
				await db.workflowActionLog.create({
					data: {
						executionId: exec.id,
						stepIndex: step,
						actionType: ['send_email', 'delay', 'add_tag'][step],
						result: { success: true } as unknown as InputJsonValue,
					},
				});
			}
		}
	}
	console.log(`  Created ${execCount} workflow executions`);

	// ── Coalition Network ───────────────────────────────────────
	console.log('\nSeeding org network...');
	await db.orgNetwork.create({
		data: {
			id: NETWORK_ID,
			name: 'Progressive Alliance 2026',
			slug: 'progressive-alliance-2026',
			description: 'A coalition of progressive organizations coordinating on federal legislation.',
			ownerOrgId: ORG_IDS.climatAction,
			status: 'active',
		},
	});

	await db.orgNetworkMember.create({
		data: { networkId: NETWORK_ID, orgId: ORG_IDS.climatAction, role: 'admin', status: 'active' },
	});
	await db.orgNetworkMember.create({
		data: { networkId: NETWORK_ID, orgId: ORG_IDS.voterRights, role: 'member', status: 'active' },
	});
	await db.orgNetworkMember.create({
		data: { networkId: NETWORK_ID, orgId: ORG_IDS.localFirst, role: 'member', status: 'pending' },
	});
	console.log('  Created network: Progressive Alliance 2026 (3 members)');

	// ── Org Resolved Contacts ──────────────────────────────────
	console.log('\nSeeding org resolved contacts...');
	const resolvedContactDefs: {
		orgId: string;
		contacts: { orgKey: string; name: string; title: string; email: string; emailSource: string | null; resolvedBy: string; daysBack: number; expiresDays: number }[];
	}[] = [
		{
			orgId: ORG_IDS.climatAction,
			contacts: [
				{ orgKey: 'US:CA-11', name: 'Rep. Maria Gonzalez', title: 'U.S. Representative, CA-11', email: 'maria.gonzalez@house.gov', emailSource: 'cwc_lookup', resolvedBy: 'cwc_lookup', daysBack: 5, expiresDays: 25 },
				{ orgKey: 'US:CA-12', name: 'Rep. James Whitfield', title: 'U.S. Representative, CA-12', email: 'james.whitfield@house.gov', emailSource: 'official_website', resolvedBy: 'ai_resolved', daysBack: 12, expiresDays: 18 },
				{ orgKey: 'US:CA:senate', name: 'Sen. Patricia Huang', title: 'U.S. Senator, California', email: 'patricia.huang@senate.gov', emailSource: 'senate_directory', resolvedBy: 'manual', daysBack: 20, expiresDays: 10 },
				{ orgKey: 'US:CA:senate:2', name: 'Sen. Michael Torres', title: 'U.S. Senator, California', email: 'michael.torres@senate.gov', emailSource: 'senate_directory', resolvedBy: 'manual', daysBack: 18, expiresDays: 12 },
				{ orgKey: 'US:EPA', name: 'Dir. Sandra Fields', title: 'EPA Regional Administrator, Region 9', email: 's.fields@epa.gov', emailSource: null, resolvedBy: 'ai_resolved', daysBack: 3, expiresDays: 27 },
				{ orgKey: 'CA:SF:bos:d6', name: 'Sup. Matt Dorsey', title: 'SF Board of Supervisors, District 6', email: 'matt.dorsey@sfgov.org', emailSource: 'official_website', resolvedBy: 'ai_resolved', daysBack: 8, expiresDays: 22 },
				{ orgKey: 'CA:SF:bos:d8', name: 'Sup. Rafael Mandelman', title: 'SF Board of Supervisors, District 8', email: 'rafael.mandelman@sfgov.org', emailSource: 'official_website', resolvedBy: 'cwc_lookup', daysBack: 8, expiresDays: 22 },
				{ orgKey: 'CA:SF:mayor', name: 'Mayor London Breed', title: 'Mayor of San Francisco', email: 'mayorlondonbreed@sfgov.org', emailSource: 'official_website', resolvedBy: 'manual', daysBack: 30, expiresDays: 0 },
				{ orgKey: 'US:DOE', name: 'Sec. Jennifer Granholm', title: 'Secretary of Energy', email: 'the.secretary@hq.doe.gov', emailSource: null, resolvedBy: 'ai_resolved', daysBack: 2, expiresDays: 28 },
				{ orgKey: 'US:CA-14', name: 'Rep. Anna Kaplan', title: 'U.S. Representative, CA-14', email: 'anna.kaplan@house.gov', emailSource: 'cwc_lookup', resolvedBy: 'cwc_lookup', daysBack: 1, expiresDays: 29 },
				{ orgKey: 'US:CA:CARB', name: 'Chair Liane Randolph', title: 'Chair, CA Air Resources Board', email: 'liane.randolph@arb.ca.gov', emailSource: null, resolvedBy: 'ai_resolved', daysBack: 6, expiresDays: 24 },
				{ orgKey: 'US:CA:PUC', name: 'Pres. Alice Reynolds', title: 'President, CA Public Utilities Commission', email: 'alice.reynolds@cpuc.ca.gov', emailSource: 'official_website', resolvedBy: 'ai_resolved', daysBack: 45, expiresDays: -15 },
			],
		},
		{
			orgId: ORG_IDS.voterRights,
			contacts: [
				{ orgKey: 'US:NY-10', name: 'Rep. David Okonkwo', title: 'U.S. Representative, NY-10', email: 'david.okonkwo@house.gov', emailSource: 'cwc_lookup', resolvedBy: 'cwc_lookup', daysBack: 4, expiresDays: 26 },
				{ orgKey: 'US:NY:senate', name: 'Sen. Linda Farrow', title: 'U.S. Senator, New York', email: 'linda.farrow@senate.gov', emailSource: 'senate_directory', resolvedBy: 'manual', daysBack: 15, expiresDays: 15 },
				{ orgKey: 'US:TX-21', name: 'Rep. Carlos Medina', title: 'U.S. Representative, TX-21', email: 'carlos.medina@house.gov', emailSource: 'cwc_lookup', resolvedBy: 'cwc_lookup', daysBack: 10, expiresDays: 20 },
				{ orgKey: 'US:TX:senate', name: 'Sen. John Cornyn', title: 'U.S. Senator, Texas', email: 'john.cornyn@senate.gov', emailSource: 'senate_directory', resolvedBy: 'manual', daysBack: 22, expiresDays: 8 },
				{ orgKey: 'US:GA:sos', name: 'Brad Raffensperger', title: 'Secretary of State, Georgia', email: 'sos@sos.ga.gov', emailSource: 'official_website', resolvedBy: 'ai_resolved', daysBack: 7, expiresDays: 23 },
				{ orgKey: 'US:AZ:sos', name: 'Adrian Fontes', title: 'Secretary of State, Arizona', email: 'sos@azsos.gov', emailSource: 'official_website', resolvedBy: 'ai_resolved', daysBack: 9, expiresDays: 21 },
				{ orgKey: 'US:NY-10:state', name: 'Asm. Robert Carroll', title: 'NY State Assembly, District 44', email: 'carrollr@nyassembly.gov', emailSource: null, resolvedBy: 'ai_resolved', daysBack: 14, expiresDays: 16 },
				{ orgKey: 'US:FEC', name: 'Chair Dara Lindenbaum', title: 'Chair, Federal Election Commission', email: 'chair@fec.gov', emailSource: null, resolvedBy: 'ai_resolved', daysBack: 3, expiresDays: 27 },
				{ orgKey: 'US:MI:sos', name: 'Jocelyn Benson', title: 'Secretary of State, Michigan', email: 'sos@michigan.gov', emailSource: 'official_website', resolvedBy: 'manual', daysBack: 60, expiresDays: -30 },
				{ orgKey: 'US:PA:sos', name: 'Al Schmidt', title: 'Secretary of State, Pennsylvania', email: 'al.schmidt@pa.gov', emailSource: null, resolvedBy: 'ai_resolved', daysBack: 11, expiresDays: 19 },
				{ orgKey: 'US:WI:sos', name: 'Sarah Godlewski', title: 'Secretary of State, Wisconsin', email: 'sos@sos.wi.gov', emailSource: 'official_website', resolvedBy: 'cwc_lookup', daysBack: 5, expiresDays: 25 },
				{ orgKey: 'US:NV:sos', name: 'Cisco Aguilar', title: 'Secretary of State, Nevada', email: 'sos@nvsos.gov', emailSource: 'official_website', resolvedBy: 'ai_resolved', daysBack: 8, expiresDays: 22 },
			],
		},
		{
			orgId: ORG_IDS.localFirst,
			contacts: [
				{ orgKey: 'CA:SF:bos:d3', name: 'Sup. Aaron Peskin', title: 'SF Board of Supervisors, District 3', email: 'aaron.peskin@sfgov.org', emailSource: 'official_website', resolvedBy: 'manual', daysBack: 10, expiresDays: 20 },
				{ orgKey: 'CA:SF:bos:d5', name: 'Sup. Dean Preston', title: 'SF Board of Supervisors, District 5', email: 'dean.preston@sfgov.org', emailSource: 'official_website', resolvedBy: 'manual', daysBack: 10, expiresDays: 20 },
				{ orgKey: 'US:WA-07', name: 'Rep. Susan Park', title: 'U.S. Representative, WA-07', email: 'susan.park@house.gov', emailSource: 'cwc_lookup', resolvedBy: 'cwc_lookup', daysBack: 6, expiresDays: 24 },
				{ orgKey: 'US:OR:senate', name: 'Sen. Robert Kessler', title: 'U.S. Senator, Oregon', email: 'robert.kessler@senate.gov', emailSource: 'senate_directory', resolvedBy: 'manual', daysBack: 25, expiresDays: 5 },
				{ orgKey: 'CA:SF:planning', name: 'Dir. Rich Hillis', title: 'Director, SF Planning Department', email: 'rich.hillis@sfgov.org', emailSource: null, resolvedBy: 'ai_resolved', daysBack: 4, expiresDays: 26 },
				{ orgKey: 'CA:SF:mta', name: 'Dir. Jeffrey Tumlin', title: 'Director, SFMTA', email: 'jeffrey.tumlin@sfmta.com', emailSource: null, resolvedBy: 'ai_resolved', daysBack: 3, expiresDays: 27 },
				{ orgKey: 'CA:SF:bos:d9', name: 'Sup. Hillary Ronen', title: 'SF Board of Supervisors, District 9', email: 'hillary.ronen@sfgov.org', emailSource: 'official_website', resolvedBy: 'cwc_lookup', daysBack: 10, expiresDays: 20 },
				{ orgKey: 'CA:SF:bos:d10', name: 'Sup. Shamann Walton', title: 'SF Board of Supervisors, District 10', email: 'shamann.walton@sfgov.org', emailSource: 'official_website', resolvedBy: 'manual', daysBack: 10, expiresDays: 20 },
				{ orgKey: 'CA:SF:bos:d11', name: 'Sup. Ahsha Safai', title: 'SF Board of Supervisors, District 11', email: 'ahsha.safai@sfgov.org', emailSource: 'official_website', resolvedBy: 'ai_resolved', daysBack: 10, expiresDays: 20 },
				{ orgKey: 'CA:SF:housing', name: 'Dir. Lydia Ely', title: 'Director, SF Housing Authority', email: 'lydia.ely@sfha.org', emailSource: null, resolvedBy: 'ai_resolved', daysBack: 40, expiresDays: -10 },
				{ orgKey: 'CA:SF:mayor', name: 'Mayor London Breed', title: 'Mayor of San Francisco', email: 'mayorlondonbreed@sfgov.org', emailSource: 'official_website', resolvedBy: 'manual', daysBack: 15, expiresDays: 15 },
				{ orgKey: 'US:CA-11', name: 'Rep. Maria Gonzalez', title: 'U.S. Representative, CA-11', email: 'maria.gonzalez@house.gov', emailSource: 'cwc_lookup', resolvedBy: 'cwc_lookup', daysBack: 2, expiresDays: 28 },
				{ orgKey: 'US:HUD', name: 'Sec. Adrianne Todman', title: 'Secretary of HUD', email: 'secretary@hud.gov', emailSource: null, resolvedBy: 'ai_resolved', daysBack: 1, expiresDays: 29 },
			],
		},
	];

	let resolvedCount = 0;
	for (const { orgId, contacts } of resolvedContactDefs) {
		for (const c of contacts) {
			await db.orgResolvedContact.create({
				data: {
					orgId,
					orgKey: c.orgKey,
					name: c.name,
					title: c.title,
					email: c.email,
					emailSource: c.emailSource,
					resolvedAt: daysAgo(c.daysBack),
					expiresAt: c.expiresDays >= 0 ? daysFromNow(c.expiresDays) : daysAgo(Math.abs(c.expiresDays)),
					resolvedBy: c.resolvedBy,
				},
			});
			resolvedCount++;
		}
	}
	console.log(`  Created ${resolvedCount} org resolved contacts`);

	// ── International Decision-Makers ───────────────────────────
	console.log('\nSeeding international decision-makers...');
	const intlDMs = [
		{ jurisdiction: 'GB', constituencyId: 'E14000530', district: 'Cities of London and Westminster', name: 'Nickie Aiken', party: 'Conservative', email: 'nickie.aiken.mp@parliament.uk' },
		{ jurisdiction: 'GB', constituencyId: 'E14000639', district: 'Hackney South and Shoreditch', name: 'Meg Hillier', party: 'Labour', email: 'meg.hillier.mp@parliament.uk' },
		{ jurisdiction: 'CA', constituencyId: '24001', district: 'Papineau', name: 'Justin Trudeau', party: 'Liberal', email: 'justin.trudeau@parl.gc.ca' },
		{ jurisdiction: 'CA', constituencyId: '59034', district: 'Vancouver Centre', name: 'Hedy Fry', party: 'Liberal', email: 'hedy.fry@parl.gc.ca' },
		{ jurisdiction: 'AU', constituencyId: '197', district: 'Grayndler', name: 'Anthony Albanese', party: 'Labor', email: 'a.albanese.mp@aph.gov.au' },
		{ jurisdiction: 'AU', constituencyId: '179', district: 'Kooyong', name: 'Monique Ryan', party: 'Independent', email: 'monique.ryan.mp@aph.gov.au' },
	];

	for (const dm of intlDMs) {
		await db.decisionMaker.create({
			data: {
				type: 'legislator',
				name: dm.name,
				jurisdiction: dm.jurisdiction,
				jurisdictionLevel: 'international',
				district: dm.district,
				party: dm.party,
				email: dm.email,
				active: true,
				externalIds: {
					create: {
						system: 'constituency',
						value: dm.constituencyId
					}
				}
			}
		});
	}
	console.log(`  Created ${intlDMs.length} international decision-makers (UK, CA, AU)`);

	// ── Org Invites ─────────────────────────────────────────────
	console.log('\nSeeding org invites...');
	const invites = [
		{
			orgId: ORG_IDS.climatAction,
			email: 'jamie.foster@greenlobby.org',
			role: 'admin',
			token: randomBytes(32).toString('hex'),
			expiresAt: daysFromNow(7),
			accepted: false,
			invitedBy: u(0),
		},
		{
			orgId: ORG_IDS.voterRights,
			email: 'priya.sharma@votewise.org',
			role: 'editor',
			token: randomBytes(32).toString('hex'),
			expiresAt: daysFromNow(5),
			accepted: false,
			invitedBy: u(0),
		},
		{
			orgId: ORG_IDS.climatAction,
			email: 'marcus.lee@sunrisemvmt.org',
			role: 'editor',
			token: randomBytes(32).toString('hex'),
			expiresAt: daysAgo(1),
			accepted: true,
			invitedBy: u(0),
		},
		{
			orgId: ORG_IDS.localFirst,
			email: 'sarah.gonzalez@sfneighbors.org',
			role: 'member',
			token: randomBytes(32).toString('hex'),
			expiresAt: daysAgo(2),
			accepted: true,
			invitedBy: u(2),
		},
		{
			orgId: ORG_IDS.voterRights,
			email: 'daniel.osei@fairelections.org',
			role: 'member',
			token: randomBytes(32).toString('hex'),
			expiresAt: daysAgo(10),
			accepted: false,
			invitedBy: u(1),
		},
	];

	for (const inv of invites) {
		await db.orgInvite.create({ data: inv });
	}
	console.log(`  Created ${invites.length} org invites (2 pending, 2 accepted, 1 expired)`);

	// ── Template Endorsements ──────────────────────────────────
	console.log('\nSeeding template endorsements...');
	const personTemplates = await db.template.findMany({
		where: { orgId: null, status: 'published' },
		select: { id: true },
		orderBy: { createdAt: 'asc' },
		take: 15,
	});

	if (personTemplates.length >= 6) {
		const endorsements = [
			{ templateId: personTemplates[0].id, orgId: ORG_IDS.climatAction, endorsedAt: daysAgo(12), endorsedBy: u(0) },
			{ templateId: personTemplates[1].id, orgId: ORG_IDS.climatAction, endorsedAt: daysAgo(10), endorsedBy: u(0) },
			{ templateId: personTemplates[2].id, orgId: ORG_IDS.voterRights, endorsedAt: daysAgo(9), endorsedBy: u(1) },
			{ templateId: personTemplates[3].id, orgId: ORG_IDS.voterRights, endorsedAt: daysAgo(7), endorsedBy: u(1) },
			{ templateId: personTemplates[4].id, orgId: ORG_IDS.localFirst, endorsedAt: daysAgo(5), endorsedBy: u(2) },
			{ templateId: personTemplates[5].id, orgId: ORG_IDS.localFirst, endorsedAt: daysAgo(3), endorsedBy: u(2) },
			{ templateId: personTemplates[0].id, orgId: ORG_IDS.voterRights, endorsedAt: daysAgo(6), endorsedBy: u(1) },
			{ templateId: personTemplates[2].id, orgId: ORG_IDS.localFirst, endorsedAt: daysAgo(2), endorsedBy: u(2) },
		];

		for (const e of endorsements) {
			await db.templateEndorsement.create({ data: e });
		}
		console.log(`  Created ${endorsements.length} template endorsements across 3 orgs`);
	} else {
		console.log(`  Skipped endorsements: only ${personTemplates.length} person templates found (need ≥6)`);
	}

	// ── AN Sync Records ────────────────────────────────────────
	console.log('\nSeeding AN sync records...');
	const anSyncs = [
		{
			orgId: ORG_IDS.climatAction,
			apiKey: 'an_test_key_climate_a1b2c3d4e5f6',
			status: 'completed',
			syncType: 'full',
			totalResources: 4,
			processedResources: 4,
			currentResource: null,
			imported: 847,
			updated: 53,
			skipped: 12,
			errors: null,
			lastSyncAt: daysAgo(1),
			startedAt: daysAgo(1),
			completedAt: daysAgo(1),
		},
		{
			orgId: ORG_IDS.voterRights,
			apiKey: 'an_test_key_voter_f7g8h9i0j1k2',
			status: 'idle',
			syncType: 'incremental',
			totalResources: 0,
			processedResources: 0,
			currentResource: null,
			imported: 0,
			updated: 0,
			skipped: 0,
			errors: null,
			lastSyncAt: null,
			startedAt: null,
			completedAt: null,
		},
		{
			orgId: ORG_IDS.localFirst,
			apiKey: 'an_test_key_local_m3n4o5p6q7r8',
			status: 'failed',
			syncType: 'full',
			totalResources: 4,
			processedResources: 2,
			currentResource: 'events',
			imported: 126,
			updated: 8,
			skipped: 0,
			errors: ['API rate limit exceeded after 2 resources', 'GET /api/v2/events returned 429 Too Many Requests'] as unknown as InputJsonValue,
			lastSyncAt: daysAgo(3),
			startedAt: daysAgo(3),
			completedAt: null,
		},
	];

	for (const sync of anSyncs) {
		await db.anSync.create({ data: sync });
	}
	console.log(`  Created ${anSyncs.length} AN sync records (1 completed, 1 idle, 1 failed)`);

	// ── Summary ─────────────────────────────────────────────────
	const counts = {
		organizations: await db.organization.count(),
		memberships: await db.orgMembership.count(),
		supporters: await db.supporter.count(),
		tags: await db.tag.count(),
		segments: await db.segment.count(),
		campaigns: await db.campaign.count(),
		campaignActions: await db.campaignAction.count(),
		events: await db.event.count(),
		rsvps: await db.eventRsvp.count(),
		donations: await db.donation.count(),
		workflows: await db.workflow.count(),
		workflowExecutions: await db.workflowExecution.count(),
		networks: await db.orgNetwork.count(),
		networkMembers: await db.orgNetworkMember.count(),
		intlDMs: await db.decisionMaker.count({ where: { jurisdictionLevel: 'international' } }),
		campaignDeliveries: await db.campaignDelivery.count(),
		emailBlasts: await db.emailBlast.count(),
		emailBatches: await db.emailBatch.count(),
		emailEvents: await db.emailEvent.count(),
		resolvedContacts: await db.orgResolvedContact.count(),
		orgInvites: await db.orgInvite.count(),
		templateEndorsements: await db.templateEndorsement.count(),
		anSyncs: await db.anSync.count(),
		subscriptions: await db.subscription.count(),
		apiKeys: await db.apiKey.count(),
	};

	console.log('\n' + '='.repeat(60));
	console.log('PHASE 2 SEED COMPLETE');
	console.log('='.repeat(60));
	for (const [k, v] of Object.entries(counts)) {
		console.log(`  ${k.padEnd(22)} ${v}`);
	}
	console.log('='.repeat(60));
}

main()
	.catch((err) => {
		console.error('\nFATAL:', err);
		process.exit(1);
	})
	.finally(() => db.$disconnect());
