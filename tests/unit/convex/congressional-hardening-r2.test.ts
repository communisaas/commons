/**
 * Follow-up hardening pins for the congressional attribution emit (round 2 of
 * the security review). The first round closed the billing-quota DoS on the
 * lifetime counter and the cross-org attribution leak; the re-review found the
 * billing exclusion was applied to only ONE of the two billing-read paths, and
 * that the unbounded recipientSubdivision multiplier could force-spawn a debate.
 *
 *   - Self-heal billing path: congressional rows MUST be excluded from the
 *     stale-baseline range scan too (inactive/unsubscribed orgs always hit this path), or
 *     congressional traffic leaks back into the org's metered usage.
 *   - Debate auto-spawn: a congressional emit MUST NOT count toward the debate
 *     threshold (until the recipientSubdivision multiplier is bounded), or an
 *     attacker could force-spawn a debate on a victim's congressional campaign.
 *
 * Source pins (convex-test isn't wired in this repo) — they fail if the
 * channel-exclusion guards are removed from either site.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), 'utf8');

describe('congressional billing projection excludes congressional rows', () => {
	const src = read('convex/planUsage.ts');
	const migration = src.slice(
		src.indexOf('async function scanSourcePage'),
		src.indexOf('async function subscriptionForOrg')
	);
	const repair = src.slice(
		src.indexOf('async function scanRepairPage'),
		src.indexOf('export const enqueueForOrg')
	);

	it.each([
		['launch migration', migration, 'PLAN_USAGE_INVALID:verifiedActions'],
		['per-org repair', repair, 'PLAN_USAGE_REPAIR_ACTION_COUNT_INVALID']
	])('%s filters congressional rows before adding exact verified usage', (_name, body, code) => {
		expect(body).toContain("query('campaignActions')");
		expect(body).toContain("withIndex('by_orgId_verified_sentAt'");
		expect(body).toContain('.paginate(options)');
		expect(body).toMatch(
			/page\.page\.filter\(\(row\) => row\.channel !== ['"]congressional['"]\)\.length/
		);
		expect(body).toContain('checkedAdd(');
		expect(body).toContain(code);
	});
});

describe('debate auto-spawn ignores congressional emits', () => {
	const src = read('convex/campaigns.ts');
	const from = src.indexOf('atomicSpawnIfEligible');
	// Window back to the guarding if-condition.
	const guard = src.slice(src.lastIndexOf('if (', from), from);

	it('the threshold-crossing guard excludes channel "congressional"', () => {
		expect(guard).toContain('args.verified');
		expect(guard).toMatch(/args\.channel !== ['"]congressional['"]/);
		expect(guard).toContain('debateThreshold');
	});
});
