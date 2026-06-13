/**
 * Security regression tests for the congressional attribution emit.
 *
 * The attributed-emit (submissions.emitCongressionalAction →
 * campaigns.createCampaignAction with verified:true) introduced a billing-quota
 * DoS that this test pins closed:
 *
 *   FIX 1 — congressional deliveries are PERSON-LAYER civic actions (a
 *   constituent contacts their own rep), NOT the org's metered paid usage. The
 *   emit must ATTRIBUTE (campaign verifiedActionCount + org actionTierCounts for
 *   reach/reporting) but must NOT bump the metered billing base
 *   (org.verifiedActionsLifetime). createCampaignAction gates the lifetime bump
 *   on metersOrgQuota (default true; congressional passes false).
 *
 * These invoke the registered handler directly via `_handler` with a fake ctx
 * (convex-test isn't wired in this repo), the same pattern as
 * tests/integration/congressional-delivery.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createCampaignAction } from '../../../convex/campaigns';

function handlerOf(fn: unknown): (ctx: any, args: any) => Promise<any> {
	return (fn as { _handler: (ctx: any, args: any) => Promise<any> })._handler;
}
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
