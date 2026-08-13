/**
 * Paying-reader gate on the coalition empirical readings.
 *
 * `gds / ald / temporalEntropy / cai` are empirical coordination models,
 * permitted to paying organizations only. Coalition membership does not buy
 * them: joining a network carries no plan check, so an org at the unpaid floor
 * — or a lapsed ex-Coalition org whose membership row never changed — would
 * otherwise keep reading the models forever. `getStats` therefore resolves the
 * READER org's own plan and redacts those four fields when it is not paid.
 * Redaction is layered ON TOP of the membership check, never in place of it.
 *
 * Two layers, following the `convex/v1api-plan-gate.test.ts` idiom:
 *
 *  1. Behavior — exercised against the REAL helpers from
 *     `convex/lib/coalitionReadingAccess`, so the past-due runway is the one
 *     defined in `convex/_brandingGate.ts` and never a copy of it. The
 *     predicate is clock-free: the runway is durable row state, and a row that
 *     has outlived it has already been patched to `canceled`.
 *  2. Source — reads the real handler, route and component text and pins that
 *     the gate is actually wired, that `readerOrgId` is trusted ONLY on the
 *     internal-secret branch (naming another org must never unlock a reading),
 *     and that the cross-org disclosure copy is present on both coalition
 *     seams.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	coalitionReadingsPermitted,
	redactCoalitionReadings
} from '../../../convex/lib/coalitionReadingAccess';

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

// A real past-due timestamp. Its VALUE is immaterial to the predicate — the
// row's own state is the runway — so the assertions hold at any wall time.
const PAST_DUE_SINCE = 1_750_000_000_000;

const networks = source('convex/networks.ts');
const publicStatsRoute = source('src/routes/api/v1/networks/[id]/stats/+server.ts');
const coalitionReport = source('src/lib/components/networks/CoalitionReport.svelte');
const networksPage = source('src/routes/org/[slug]/networks/+page.svelte');
const readerPrivacyModel = source('docs/design/READER-PRIVACY-MODEL.md');

const STATS = {
	memberCount: 4,
	totalSupporters: 120,
	uniqueSupporters: 110,
	verifiedSupporters: 90,
	totalCampaignActions: 200,
	verifiedCampaignActions: 180,
	stateDistribution: { US: 90 },
	gds: 0.66,
	ald: 3 / 7,
	temporalEntropy: 1.5,
	cai: 2,
	districtCount: 7,
	revision: 3
};

// The day-one shape of every coalition: member orgs with zero actions produce
// no readings at all, and `readCoalitionStats` emits them as null.
const NOTHING_COMPUTED = {
	...STATS,
	gds: null,
	ald: null,
	temporalEntropy: null,
	cai: null
};

describe('coalitionReadingsPermitted — real grace-bearing predicate, read from row state', () => {
	it('refuses a reader org with no subscription row at all (the unpaid floor)', () => {
		expect(coalitionReadingsPermitted(null)).toBe(false);
		expect(coalitionReadingsPermitted(undefined)).toBe(false);
	});

	it('refuses a canceled subscription even when its stale plan says coalition', () => {
		// This is what an exhausted runway BECOMES: `expirePastDueGrace` patches
		// the row to `canceled` at the deadline, so "past the window" is a row
		// state, never an arithmetic result computed inside the query.
		expect(coalitionReadingsPermitted({ status: 'canceled', plan: 'coalition' })).toBe(false);
	});

	it('permits a past_due subscription that still carries its runway', () => {
		expect(
			coalitionReadingsPermitted({
				status: 'past_due',
				plan: 'coalition',
				pastDueSince: PAST_DUE_SINCE
			})
		).toBe(true);
		// Any real timestamp reads the same — including the epoch, which is a
		// valid instant and not a falsy "no runway" sentinel.
		expect(
			coalitionReadingsPermitted({ status: 'past_due', plan: 'coalition', pastDueSince: 0 })
		).toBe(true);
	});

	it('fails closed on a past_due row with no runway timestamp to stand on', () => {
		expect(coalitionReadingsPermitted({ status: 'past_due', plan: 'coalition' })).toBe(false);
	});

	it('refuses an active subscription parked at the unpaid floor plan', () => {
		expect(coalitionReadingsPermitted({ status: 'active', plan: 'inactive' })).toBe(false);
	});

	it('permits active and trialing readers at any paid tier', () => {
		expect(coalitionReadingsPermitted({ status: 'active', plan: 'starter' })).toBe(true);
		expect(coalitionReadingsPermitted({ status: 'trialing', plan: 'coalition' })).toBe(true);
	});
});

describe('redactCoalitionReadings — exactly the four empirical models', () => {
	it('nulls the readings and leaves every count, roster and geography field intact', () => {
		const redacted = redactCoalitionReadings(STATS, false);
		// WITHHELD, not ABSENT. Null alone already means "never computed" on this
		// path, so the payload has to carry its own discriminator.
		expect(redacted.readingsWithheld).toBe(true);
		expect(redacted.gds).toBeNull();
		expect(redacted.ald).toBeNull();
		expect(redacted.temporalEntropy).toBeNull();
		expect(redacted.cai).toBeNull();
		expect(redacted.memberCount).toBe(STATS.memberCount);
		expect(redacted.districtCount).toBe(STATS.districtCount);
		expect(redacted.verifiedSupporters).toBe(STATS.verifiedSupporters);
		expect(redacted.totalSupporters).toBe(STATS.totalSupporters);
		expect(redacted.uniqueSupporters).toBe(STATS.uniqueSupporters);
		expect(redacted.totalCampaignActions).toBe(STATS.totalCampaignActions);
		expect(redacted.verifiedCampaignActions).toBe(STATS.verifiedCampaignActions);
		expect(redacted.stateDistribution).toEqual(STATS.stateDistribution);
		expect(redacted.revision).toBe(STATS.revision);
	});

	it('returns the readings intact for a paying reader, flagged as not withheld', () => {
		expect(redactCoalitionReadings(STATS, true)).toEqual({ ...STATS, readingsWithheld: false });
	});

	it('does not mutate the source object when redacting', () => {
		redactCoalitionReadings(STATS, false);
		expect(STATS.gds).toBe(0.66);
	});

	it('reports a day-one coalition as ABSENT, not as a paywall, to an unpaid reader', () => {
		const redacted = redactCoalitionReadings(NOTHING_COMPUTED, false);
		// Nothing was ever computed here, so there is nothing being withheld —
		// claiming otherwise sells a reading this coalition does not have.
		expect(
			redacted.readingsWithheld,
			'a never-computed coalition was reported to an unpaid reader as WITHHELD'
		).toBe(false);
		expect(redacted.gds).toBeNull();
		expect(redacted.ald).toBeNull();
		expect(redacted.temporalEntropy).toBeNull();
		expect(redacted.cai).toBeNull();
		expect(redacted.memberCount).toBe(STATS.memberCount);
		expect(redacted.stateDistribution).toEqual(STATS.stateDistribution);
	});

	it('withholds a partially computed coalition in full', () => {
		const redacted = redactCoalitionReadings({ ...NOTHING_COMPUTED, cai: 2 }, false);
		// One reading exists, so WITHHELD is the true fact — and the redaction
		// still nulls all four. The flag reports less; it never redacts less.
		expect(redacted.readingsWithheld).toBe(true);
		expect(redacted.gds).toBeNull();
		expect(redacted.ald).toBeNull();
		expect(redacted.temporalEntropy).toBeNull();
		expect(redacted.cai).toBeNull();
	});

	it('reads the same ABSENT fact for a paying reader of a never-computed coalition', () => {
		const permitted = redactCoalitionReadings(NOTHING_COMPUTED, true);
		expect(permitted.readingsWithheld).toBe(false);
		expect(permitted.gds).toBeNull();
		expect(permitted.ald).toBeNull();
		expect(permitted.temporalEntropy).toBeNull();
		expect(permitted.cai).toBeNull();
		expect(permitted).toEqual({ ...NOTHING_COMPUTED, readingsWithheld: false });
	});
});

describe('convex/networks.ts getStats — the gate is actually wired', () => {
	const stats = section(networks, 'export const getStats = query', 'export const getProofPressure');

	it('resolves the reader plan through the shared helpers', () => {
		expect(networks).toContain('coalitionReadingsPermitted');
		expect(networks).toContain('redactCoalitionReadings');
	});

	it('accepts an optional reader org id', () => {
		expect(networks).toContain("readerOrgId: v.optional(v.id('organizations'))");
	});

	it('still gates on requireNetworkAccess before reading anything', () => {
		expect(stats).toContain('await requireNetworkAccess(ctx, networkId, orgSlug, _secret);');
	});

	it('trusts readerOrgId ONLY on the internal-secret branch', () => {
		const body = stats.slice(stats.indexOf('const callerOrgId'));
		// The caller-supplied org id is consulted exactly once in the handler
		// body, and only inside the `_secret !== undefined` arm. Anywhere else
		// it would let a signed-in caller name a paying org to unlock the
		// readings.
		expect(body.split('readerOrgId').length - 1).toBe(1);
		expect(body).toContain(
			'const readerOrg = callerOrgId ?? (_secret !== undefined ? (readerOrgId ?? null) : null);'
		);
	});

	it('fails closed and skips the subscription read when no reader org resolves', () => {
		const body = stats.slice(stats.indexOf('const callerOrgId'));
		expect(body).toContain('readerOrg === null');
		expect(body).toContain('? false');
	});

	it('reads no wall clock — the runway is durable row state, not arithmetic here', () => {
		// A clock read inside a public query defeats caching and reactive
		// invalidation; `scripts/check-convex-query-efficiency.mjs` enforces it.
		expect(stats).not.toContain('Date.now(');
		expect(stats).toContain('coalitionReadingsPermitted(await readOrgSubscriptionRow(ctx, readerOrg))');
	});

	it('redacts rather than throwing, and keeps the constant-read stats source', () => {
		expect(stats).toContain('readCoalitionStats(ctx, networkId)');
		expect(stats).toContain('redactCoalitionReadings(await readCoalitionStats(ctx, networkId)');
	});

	it('reads the subscription row through the file\'s single read shape', () => {
		expect(networks).toContain('readOrgSubscriptionRow(ctx, readerOrg)');
		expect(networks).toContain("throw new Error('SUBSCRIPTION_CARDINALITY_REPAIR_REQUIRED')");
	});
});

describe('v1 stats route names the API-key org as the reader', () => {
	it('passes readerOrgId alongside the internal secret', () => {
		expect(publicStatsRoute).toContain('readerOrgId');
		expect(publicStatsRoute).toContain('_secret: getInternalSecret()');
	});
});

/** Every muted paragraph that carries the cross-org disclosure, prose only. */
function disclosureParagraphs(src: string): string[] {
	return [...src.matchAll(/<p class="text-text-tertiary[^"]*">([\s\S]*?)<\/p>/g)]
		.map((match) => match[1])
		.filter((prose) => prose.includes('every member organization'));
}

describe('coalition report separates withheld from absent', () => {
	it('branches on the payload discriminator, not on null readings alone', () => {
		expect(coalitionReport).toContain('readingsWithheld');
		expect(coalitionReport).toContain('{#if stats.readingsWithheld}');
		// The readings branch survives as the SECOND arm — a coalition whose
		// models were never computed still renders nothing at all.
		expect(coalitionReport).toContain(
			'{:else if stats.gds !== null || stats.ald !== null || stats.temporalEntropy !== null || stats.cai !== null}'
		);
	});

	it('repeats the cross-org disclosure in both arms, so a withheld reader still reads it', () => {
		expect(coalitionReport.split('every member organization').length - 1).toBeGreaterThanOrEqual(2);
		expect(disclosureParagraphs(coalitionReport)).toHaveLength(2);
	});

	it('carries no numerals, provenance whisper, or verification claim in EITHER disclosure', () => {
		const paragraphs = disclosureParagraphs(coalitionReport);
		expect(paragraphs.length).toBeGreaterThan(1);
		for (const disclosure of paragraphs) {
			// Prose only — the class attribute carries Tailwind scale digits.
			expect(disclosure).not.toMatch(/\d/);
			expect(disclosure).not.toMatch(new RegExp('cite' + '='));
			expect(disclosure).not.toMatch(/verif/i);
		}
	});

	it('paints no good state in the withheld arm either', () => {
		for (const forbidden of [
			'text-green',
			'bg-green',
			'text-emerald',
			'#34d399',
			'qualityColor',
			'organic',
			'Higher scores'
		]) {
			expect(coalitionReport).not.toContain(forbidden);
		}
	});

	it('keeps the shipped census-first structure and the last green is gone', () => {
		expect(coalitionReport).toContain('Coordination audit');
		expect(coalitionReport).toContain('<details');
		expect(coalitionReport).not.toMatch(/<details[^>]*\bopen\b/);
		expect(coalitionReport).not.toContain('text-green-400');
		expect(coalitionReport).not.toMatch(/text-emerald|bg-green-/);
	});
});

describe('invitation card discloses the pooling before the Accept button', () => {
	it('names the cross-org read and the absent per-campaign opt-in', () => {
		expect(networksPage).toContain('every member organization');
		expect(networksPage).toContain('per-campaign');
	});

	it('places the disclosure ahead of the accept handler in source order', () => {
		expect(networksPage.indexOf('every member organization')).toBeLessThan(
			networksPage.indexOf("respondToInvite(network.id, 'accept')")
		);
	});
});

describe('reader-privacy model records the partner-org reader', () => {
	it('carries the partner row and the coalition surface', () => {
		expect(readerPrivacyModel).toContain('partner');
		expect(readerPrivacyModel).toContain('/org/[slug]/networks/');
	});

	it('carries the cross-org audit item', () => {
		expect(readerPrivacyModel).toContain('aggregates across organizations');
		expect(readerPrivacyModel).toContain('every member organization can read the result');
	});
});
