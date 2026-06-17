/**
 * Plan-limit invariants (D4).
 *
 * The verified-action usage query clamps `Math.min(metered.length, CAP)`. That
 * saturation clamp only fail-safes (clamp-to-BLOCK, never under-count) while
 * VERIFIED_ACTION_PERIOD_SCAN_CAP stays STRICTLY above every plan's
 * maxVerifiedActions — if a plan limit ever reached the cap, an over-cap org
 * would read as under-cap and never be blocked. This was a prose comment
 * (subscriptions.ts:72-79); here it is a CI gate that goes RED on violation.
 *
 * Source-scanned (not imported) because convex/subscriptions.ts pulls in the
 * Convex server runtime, which vitest cannot import.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const n = (s: string) => Number(s.replace(/_/g, ''));

function maxVerifiedActions(src: string): number {
	const vals = [...src.matchAll(/maxVerifiedActions:\s*([0-9_]+)/g)].map((m) => n(m[1]));
	expect(vals.length, 'expected maxVerifiedActions literals in source').toBeGreaterThan(0);
	return Math.max(...vals);
}

describe('plan-limit invariants', () => {
	const subsSrc = readFileSync(join(process.cwd(), 'convex/subscriptions.ts'), 'utf8');
	const plansSrc = readFileSync(join(process.cwd(), 'src/lib/server/billing/plans.ts'), 'utf8');
	const cap = n(subsSrc.match(/VERIFIED_ACTION_PERIOD_SCAN_CAP\s*=\s*([0-9_]+)/)![1]);

	it('the scan cap strictly exceeds every plan limit (convex PLANS clamp source)', () => {
		expect(cap).toBeGreaterThan(maxVerifiedActions(subsSrc));
	});

	it('the scan cap strictly exceeds every plan limit (canonical plans.ts mirror)', () => {
		expect(cap).toBeGreaterThan(maxVerifiedActions(plansSrc));
	});
});
