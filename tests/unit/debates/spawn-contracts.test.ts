/**
 * Campaign debate spawn contracts.
 *
 * Two spawn paths share one idempotence boundary:
 *   - Threshold path: a verified action crossing campaign.debateThreshold
 *     schedules `atomicSpawnIfEligible` (internal — never publicly callable),
 *     whose mutation re-checks eligibility so simultaneous crossers cannot
 *     double-spawn.
 *   - Manual path: the org-editor route calls the authenticated public action
 *     `forceSpawnDebateForCampaign`, which bypasses the threshold (the editor
 *     asked explicitly) but still re-checks debateId against the auto path.
 *
 * Pure source-contract pins — no Convex runtime.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf8');
}

/** Slice between two unique markers; asserts both exist. */
function section(src: string, start: string, end: string): string {
	const startIdx = src.indexOf(start);
	expect(startIdx, `marker not found: ${start}`).toBeGreaterThanOrEqual(0);
	const endIdx = src.indexOf(end, startIdx + start.length);
	expect(endIdx, `marker not found: ${end}`).toBeGreaterThan(startIdx);
	return src.slice(startIdx, endIdx);
}

const debates = source('convex/debates.ts');
const campaigns = source('convex/campaigns.ts');
const route = source('src/routes/api/campaigns/[id]/debate/+server.ts');

describe('spawn function visibility', () => {
	it('threshold spawn is internal-only (system-initiated, not publicly callable)', () => {
		expect(debates).toContain('export const atomicSpawnIfEligible = internalAction');
		expect(debates).toContain('export const _spawnDebateIfEligible = internalMutation');
		expect(debates).toContain('export const _spawnDebateIfEligibleForce = internalMutation');
	});

	it('manual spawn is a public action that requires authentication', () => {
		const force = section(
			debates,
			'export const forceSpawnDebateForCampaign = action',
			'export const _spawnDebateIfEligibleForce'
		);
		expect(force).toContain('ctx.auth.getUserIdentity()');
		expect(force).toContain('Not authenticated');
	});
});

describe('threshold path schedules the spawn from verified actions', () => {
	it('campaign action recording checks the +1 threshold crossing before scheduling', () => {
		expect(campaigns).toContain(
			'(campaign?.verifiedActionCount ?? 0) + 1 >= (campaign?.debateThreshold ?? 0)'
		);
		expect(campaigns).toContain('ctx.scheduler.runAfter(0, internal.debates.atomicSpawnIfEligible');
	});

	it('scheduling is gated on debateEnabled and absence of an existing debate', () => {
		// The guard condition sits immediately above the scheduler call.
		const idx = campaigns.indexOf('internal.debates.atomicSpawnIfEligible');
		expect(idx).toBeGreaterThanOrEqual(0);
		const guard = campaigns.slice(Math.max(0, idx - 400), idx);
		expect(guard).toContain('args.verified');
		expect(guard).toContain('campaign?.debateEnabled');
		expect(guard).toContain('!campaign?.debateId');
	});
});

describe('eligibility re-checks (idempotence boundary)', () => {
	it('atomicSpawnIfEligible declines with stable reasons', () => {
		const atomic = section(
			debates,
			'export const atomicSpawnIfEligible = internalAction',
			'export const forceSpawnDebateForCampaign'
		);
		for (const reason of ['no_campaign', 'already_spawned', 'disabled', 'no_template', 'below_threshold']) {
			expect(atomic).toContain(`reason: "${reason}"`);
		}
	});

	it('threshold mutation re-checks debateId and threshold at write time', () => {
		const mutation = section(
			debates,
			'export const _spawnDebateIfEligible = internalMutation',
			'ctx.db.insert'
		);
		expect(mutation).toContain('if (campaign.debateId) return');
		expect(mutation).toContain('reason: "already_spawned"');
		expect(mutation).toContain(
			'(campaign.verifiedActionCount ?? 0) < (campaign.debateThreshold ?? 0)'
		);
		expect(mutation).toContain('reason: "below_threshold"');
	});

	it('force mutation re-checks debateId but skips the threshold', () => {
		const force = section(
			debates,
			'export const _spawnDebateIfEligibleForce = internalMutation',
			'export const _getCampaignForSpawn'
		);
		expect(force).toContain('if (campaign.debateId) return');
		expect(force).toContain('reason: "already_spawned"');
		expect(force).not.toContain('below_threshold');
	});

	it('both spawn mutations link the debate back onto the campaign', () => {
		const matches = debates.match(/await ctx\.db\.patch\(args\.campaignId, \{\s*debateId,/g) ?? [];
		expect(matches.length).toBeGreaterThanOrEqual(2);
	});
});

describe('campaign debate route is live, not a stub', () => {
	it('calls the real spawn action', () => {
		expect(route).toContain('api.debates.forceSpawnDebateForCampaign');
	});

	it('carries no 501 / unavailable-helper stub', () => {
		expect(route).not.toMatch(/501|campaign_debate_helper_unavailable|not yet wired/i);
	});

	it('maps decline reasons onto HTTP statuses', () => {
		expect(route).toContain("if (reason === 'no_campaign') throw error(404");
		expect(route).toContain("if (reason === 'already_spawned') throw error(409");
		expect(route).toContain("if (reason === 'disabled') throw error(400");
		expect(route).toContain("if (reason === 'no_template') throw error(400");
	});

	it('requires editor authority before spawning', () => {
		expect(route).toContain("if (campaign.memberRole === 'member')");
		expect(route).toContain('Editor role required');
	});
});
