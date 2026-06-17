/**
 * Security regression tests for the congressional attribution emit.
 *
 * The attributed-emit (submissions.emitCongressionalAction →
 * campaigns.createCampaignAction with verified:true) introduced two HIGH issues
 * that these tests pin closed:
 *
 *   FIX 1 — billing-quota DoS: congressional deliveries are PERSON-LAYER civic
 *   actions (a constituent contacts their own rep), NOT the org's metered paid
 *   usage. The emit must ATTRIBUTE (campaign verifiedActionCount + org
 *   actionTierCounts for reach/reporting) but must NOT bump the metered billing
 *   base (org.verifiedActionsLifetime). createCampaignAction gates the lifetime
 *   bump on metersOrgQuota (default true; congressional passes false).
 *
 *   FIX 2a — cross-org attribution hijack: campaigns.create/update accept a
 *   templateId. Without an ownership check, Org B could point a campaign at Org
 *   A's public template and siphon A's congressional actions (and leak A's
 *   constituents' district/tier via the campaign_action.created webhook). Both
 *   mutations now require template.orgId === caller-org._id.
 *
 * These invoke the registered handlers directly via `_handler` with a fake ctx
 * (convex-test isn't wired in this repo), the same pattern as
 * tests/integration/congressional-delivery.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// requireOrgRole chains requireAuth/loadOrg/membership/role. We stub the whole
// auth module so the tests isolate the NEW template-ownership + metering logic.
// The stubbed requireOrgRole returns a fixed org (org_1) as the caller's org.
const ORG = { _id: 'org_1', campaignCount: 0, countryCode: 'US' };
vi.mock('../../../convex/_authHelpers', () => ({
	requireOrgRole: vi.fn(async () => ({ org: ORG, membership: {}, userId: 'user_1' })),
	loadOrg: vi.fn(),
	requireAuth: vi.fn(async () => ({ userId: 'user_1' })),
	requireOrgMembership: vi.fn()
}));

import { create, update, createCampaignAction } from '../../../convex/campaigns';

function handlerOf(fn: unknown): (ctx: any, args: any) => Promise<any> {
	return (fn as { _handler: (ctx: any, args: any) => Promise<any> })._handler;
}
const runCreate = handlerOf(create);
const runUpdate = handlerOf(update);
const runCreateAction = handlerOf(createCampaignAction);

beforeEach(() => {
	vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1a — createCampaignAction metering gate
// ─────────────────────────────────────────────────────────────────────────────

describe('FIX 1a — createCampaignAction does not meter when metersOrgQuota is false', () => {
	/**
	 * Fake ctx for createCampaignAction. Seeds a campaign + org; records every
	 * patch so we can assert which counters moved.
	 */
	function makeCtx(opts: { org?: Record<string, unknown>; campaign?: Record<string, unknown> } = {}) {
		const org = {
			_id: 'org_1',
			verifiedActionsLifetime: 10,
			actionTierCounts: [0, 0, 0, 0, 0],
			...(opts.org ?? {})
		};
		const campaign = {
			_id: 'camp_1',
			orgId: 'org_1',
			actionCount: 5,
			verifiedActionCount: 3,
			tier3VerifiedActionCount: 1,
			...(opts.campaign ?? {})
		};
		const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
		const docs: Record<string, any> = { org_1: org, camp_1: campaign };

		const ctx = {
			db: {
				query: (_table: string) => ({
					withIndex: (_index: string, _builder: any) => ({
						first: async () => null // no existing action → not a dup
					})
				}),
				get: async (id: string) => docs[id] ?? null,
				insert: async (_table: string, _doc: any) => 'action_1',
				patch: async (id: string, patch: Record<string, unknown>) => {
					patches.push({ id, patch });
					docs[id] = { ...docs[id], ...patch };
				}
			},
			scheduler: { runAfter: vi.fn(async () => undefined) },
			runMutation: vi.fn(async () => undefined)
		};
		return { ctx, patches, org, campaign };
	}

	it('metersOrgQuota:false → org.verifiedActionsLifetime is NOT bumped (no billing consumption)', async () => {
		const { ctx, patches } = makeCtx();
		await runCreateAction(ctx as any, {
			campaignId: 'camp_1',
			verified: true,
			engagementTier: 2,
			channel: 'congressional',
			congressionalSubmissionId: 'sub_1',
			metersOrgQuota: false
		});

		const orgPatch = patches.find((p) => p.id === 'org_1')?.patch ?? {};
		// The metered base must NOT move.
		expect(orgPatch.verifiedActionsLifetime).toBeUndefined();
		// But attribution still lands: the engagement-tier histogram updates.
		expect(orgPatch.actionTierCounts).toEqual([0, 0, 1, 0, 0]);
	});

	it('metersOrgQuota:false → campaign verifiedActionCount STILL increments (attribution kept)', async () => {
		const { ctx, patches } = makeCtx();
		await runCreateAction(ctx as any, {
			campaignId: 'camp_1',
			verified: true,
			engagementTier: 0,
			channel: 'congressional',
			congressionalSubmissionId: 'sub_1',
			metersOrgQuota: false
		});
		const campPatch = patches.find((p) => p.id === 'camp_1')?.patch ?? {};
		expect(campPatch.actionCount).toBe(6); // 5 + 1
		expect(campPatch.verifiedActionCount).toBe(4); // 3 + 1
	});

	it('default (metersOrgQuota omitted) → org.verifiedActionsLifetime IS bumped (org-initiated path unchanged)', async () => {
		const { ctx, patches } = makeCtx();
		await runCreateAction(ctx as any, {
			campaignId: 'camp_1',
			verified: true,
			engagementTier: 1,
			channel: 'email',
			supporterId: undefined
		});
		const orgPatch = patches.find((p) => p.id === 'org_1')?.patch ?? {};
		expect(orgPatch.verifiedActionsLifetime).toBe(11); // 10 + 1
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2a — template-ownership enforcement on campaigns.create / campaigns.update
// ─────────────────────────────────────────────────────────────────────────────

describe('FIX 2a — campaigns.create / update reject a foreign templateId', () => {
	/** Fake ctx: db.get resolves templates by id; insert/patch are no-ops. */
	function makeCtx(template: Record<string, unknown> | null) {
		return {
			db: {
				get: async (id: string) => {
					if (id === 'tmpl_foreign' || id === 'tmpl_owned') return template;
					return null;
				},
				insert: async (_table: string, _doc: any) => 'camp_new',
				patch: async (_id: string, _patch: any) => undefined
			}
		};
	}

	it('create: rejects a templateId owned by a DIFFERENT org', async () => {
		const ctx = makeCtx({ _id: 'tmpl_foreign', orgId: 'org_2' });
		await expect(
			runCreate(ctx as any, {
				slug: 'my-org',
				title: 'Hijack Campaign',
				type: 'CONGRESSIONAL',
				templateId: 'tmpl_foreign'
			})
		).rejects.toThrow(/Template not found in this organization/);
	});

	it('create: accepts a templateId owned by the caller org', async () => {
		const ctx = makeCtx({ _id: 'tmpl_owned', orgId: 'org_1' });
		const id = await runCreate(ctx as any, {
			slug: 'my-org',
			title: 'Legit Campaign',
			type: 'CONGRESSIONAL',
			templateId: 'tmpl_owned'
		});
		expect(id).toBe('camp_new');
	});

	it('create: with no templateId skips the ownership check (no throw)', async () => {
		const ctx = makeCtx(null);
		const id = await runCreate(ctx as any, {
			slug: 'my-org',
			title: 'No Template',
			type: 'LETTER'
		});
		expect(id).toBe('camp_new');
	});

	it('update: rejects re-pointing the campaign at a foreign templateId', async () => {
		const ctx = {
			db: {
				get: async (id: string) => {
					if (id === 'camp_1') return { _id: 'camp_1', orgId: 'org_1' };
					if (id === 'tmpl_foreign') return { _id: 'tmpl_foreign', orgId: 'org_2' };
					return null;
				},
				patch: async () => undefined
			},
			runMutation: async () => undefined
		};
		await expect(
			runUpdate(ctx as any, {
				campaignId: 'camp_1',
				slug: 'my-org',
				templateId: 'tmpl_foreign'
			})
		).rejects.toThrow(/Template not found in this organization/);
	});

	it('update: accepts an owned templateId', async () => {
		const ctx = {
			db: {
				get: async (id: string) => {
					if (id === 'camp_1') return { _id: 'camp_1', orgId: 'org_1' };
					if (id === 'tmpl_owned') return { _id: 'tmpl_owned', orgId: 'org_1' };
					return null;
				},
				patch: async () => undefined
			},
			runMutation: async () => undefined
		};
		const ownedId = await runUpdate(ctx as any, {
			campaignId: 'camp_1',
			slug: 'my-org',
			templateId: 'tmpl_owned'
		});
		expect(ownedId).toBe('camp_1');
	});
});
