/**
 * Individual (person-layer) AI-authoring cap — the L2 metered surface.
 *
 * "Individuals free forever" is refined to: free forever to ACT (send, sign,
 * personalize-and-deliver existing messages), bounded on AI GENERATION. The
 * expensive person-layer path is authoring a NEW template (subject + grounded
 * decision-maker resolution + grounded message, ~$0.12–0.22 each), so an
 * un-orged individual may AI-author up to their plan's authored-per-month limit:
 * free floor 3, Voice 20, Advocate 75.
 *
 * The cap is enforced in `convex/templates.ts:createTemplate` (the individual
 * create fence), in the `else` (no-org) branch — org members are governed by
 * their plan's `maxTemplatesMonth`. It counts the user's own templates created
 * month-to-date via the `templates.by_userId` index (query-time aggregation
 * from `_creationTime`, NOT a denormalized counter), resolves the limit from the
 * user's individual subscription plan, then delegates the allow/deny decision to
 * the pure helpers pinned here.
 *
 * ACTING on / SENDING an existing template never touches `createTemplate`
 * (campaign-action / submit paths), so it is intentionally never gated by this
 * cap — there is no `createTemplate` call to reach the cap on the action path.
 */

import { describe, it, expect } from 'vitest';
import {
	FREE_INDIVIDUAL_TEMPLATES_PER_MONTH,
	INDIVIDUAL_AUTHORED_PER_MONTH,
	authoredLimitForPlan,
	startOfMonthUTC,
	nextMonthResetDate,
	decideIndividualAuthoring
} from '../../../convex/_individualAuthoringCap';

const JAN_15 = Date.UTC(2026, 0, 15, 12, 0, 0); // mid-January 2026
const DEC_20 = Date.UTC(2026, 11, 20, 12, 0, 0); // mid-December (year-rollover case)

describe('FREE_INDIVIDUAL_TEMPLATES_PER_MONTH', () => {
	it('is 3 (the free floor)', () => {
		expect(FREE_INDIVIDUAL_TEMPLATES_PER_MONTH).toBe(3);
	});
});

describe('INDIVIDUAL_AUTHORED_PER_MONTH (the dynamic limit map)', () => {
	it('Voice = 20, Advocate = 75', () => {
		expect(INDIVIDUAL_AUTHORED_PER_MONTH.voice).toBe(20);
		expect(INDIVIDUAL_AUTHORED_PER_MONTH.advocate).toBe(75);
	});

	it('holds ONLY individual slugs — no org slug leaks in', () => {
		const slugs = Object.keys(INDIVIDUAL_AUTHORED_PER_MONTH).sort();
		expect(slugs).toEqual(['advocate', 'voice']);
		// Org plan slugs must be absent so the individual cap can never honor them.
		for (const org of ['inactive', 'starter', 'organization', 'coalition']) {
			expect(INDIVIDUAL_AUTHORED_PER_MONTH[org]).toBeUndefined();
		}
	});
});

describe('authoredLimitForPlan (resolves the effective monthly limit)', () => {
	it('free floor (3) for no plan', () => {
		expect(authoredLimitForPlan(null)).toBe(3);
		expect(authoredLimitForPlan(undefined)).toBe(3);
	});

	it('Voice → 20, Advocate → 75', () => {
		expect(authoredLimitForPlan('voice')).toBe(20);
		expect(authoredLimitForPlan('advocate')).toBe(75);
	});

	it('an ORG plan slug NEVER unlocks org volume — resolves to the free floor', () => {
		// Cross-contamination guard (issue 6): the individual cap must never honor
		// an org plan. starter/organization/coalition all resolve to floor 3.
		expect(authoredLimitForPlan('starter')).toBe(3);
		expect(authoredLimitForPlan('organization')).toBe(3);
		expect(authoredLimitForPlan('coalition')).toBe(3);
		expect(authoredLimitForPlan('inactive')).toBe(3);
	});

	it('an unknown slug never grants MORE than the floor', () => {
		expect(authoredLimitForPlan('enterprise')).toBe(3);
		expect(authoredLimitForPlan('')).toBe(3);
	});
});

describe('startOfMonthUTC', () => {
	it('floors to the first instant of the calendar month (UTC)', () => {
		expect(startOfMonthUTC(JAN_15)).toBe(Date.UTC(2026, 0, 1));
		expect(startOfMonthUTC(DEC_20)).toBe(Date.UTC(2026, 11, 1));
	});
});

describe('nextMonthResetDate', () => {
	it('returns the first day of next month as an ISO date', () => {
		expect(nextMonthResetDate(JAN_15)).toBe('2026-02-01');
	});
	it('rolls the year over from December', () => {
		expect(nextMonthResetDate(DEC_20)).toBe('2027-01-01');
	});
});

describe('decideIndividualAuthoring — FREE FLOOR (limit defaults to 3)', () => {
	it('ALLOWS the 1st, 2nd, and 3rd template in a month', () => {
		expect(decideIndividualAuthoring(0, JAN_15).ok).toBe(true);
		expect(decideIndividualAuthoring(1, JAN_15).ok).toBe(true);
		expect(decideIndividualAuthoring(2, JAN_15).ok).toBe(true);
	});

	it('BLOCKS the 4th creation in the same month (3 already authored)', () => {
		const d = decideIndividualAuthoring(3, JAN_15);
		expect(d.ok).toBe(false);
		if (!d.ok) {
			expect(d.message).toContain('3 free messages this month');
			expect(d.message).toContain('resets 2026-02-01');
			// Free-floor copy invites the L2 upgrade.
			expect(d.message).toContain('Upgrade to Voice or Advocate');
		}
	});

	it('stays blocked beyond the cap', () => {
		expect(decideIndividualAuthoring(4, JAN_15).ok).toBe(false);
		expect(decideIndividualAuthoring(99, JAN_15).ok).toBe(false);
	});
});

describe('decideIndividualAuthoring — VOICE (limit 20)', () => {
	const VOICE = authoredLimitForPlan('voice'); // 20

	it('ALLOWS up to the 20th template', () => {
		expect(decideIndividualAuthoring(0, JAN_15, VOICE).ok).toBe(true);
		expect(decideIndividualAuthoring(19, JAN_15, VOICE).ok).toBe(true);
	});

	it('BLOCKS the 21st (20 already authored) with the paid-tier message (no upgrade ask)', () => {
		const d = decideIndividualAuthoring(20, JAN_15, VOICE);
		expect(d.ok).toBe(false);
		if (!d.ok) {
			expect(d.message).toContain('20 messages for this billing period');
			expect(d.message).toContain('resets 2026-02-01');
			expect(d.message).not.toContain('Upgrade to Voice');
		}
	});
});

describe('decideIndividualAuthoring — ADVOCATE (limit 75)', () => {
	const ADVOCATE = authoredLimitForPlan('advocate'); // 75

	it('ALLOWS up to the 75th template', () => {
		expect(decideIndividualAuthoring(0, JAN_15, ADVOCATE).ok).toBe(true);
		expect(decideIndividualAuthoring(74, JAN_15, ADVOCATE).ok).toBe(true);
	});

	it('BLOCKS the 76th (75 already authored)', () => {
		const d = decideIndividualAuthoring(75, JAN_15, ADVOCATE);
		expect(d.ok).toBe(false);
		if (!d.ok) {
			expect(d.message).toContain('75 messages for this billing period');
		}
	});
});
