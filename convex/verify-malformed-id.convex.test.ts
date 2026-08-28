import { convexTest } from 'convex-test';
import { beforeAll, describe, expect, it } from 'vitest';

import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

const SECRET = 'verify-malformed-id-internal-secret-32b-pad';

beforeAll(() => {
	process.env.INTERNAL_API_SECRET = SECRET;
});

/**
 * Every id these queries receive arrives from a URL a stranger typed. The old
 * code cast the raw string with `as Id<...>`, which satisfies the compiler and
 * throws at runtime — so the three public verification pages answered a
 * correctly-shaped credential hash with a generic error, and one of them with a
 * server crash.
 *
 * The shapes below are the ones the product actually hands out: a 64-character
 * hex credential hash and a bare campaign slug. Neither is a database id, and
 * both must come back as "no such record" rather than an exception. The reason
 * this survived is that the existing tests only ever passed well-formed ids.
 */
const MALFORMED = [
	['64-hex credential hash', 'a'.repeat(64)],
	['32-hex digest', 'b'.repeat(32)],
	['campaign slug', 'save-the-library'],
	['empty string', ''],
	['too short', 'abc'],
	['path traversal', '../../etc/passwd'],
	['id-like but wrong table', 'kg21abcdefghijklmnopqrstuvwx']
] as const;

describe('verification queries refuse malformed ids without throwing', () => {
	for (const [label, value] of MALFORMED) {
		it(`getDelivery returns null for a ${label}`, async () => {
			const t = convexTest(schema, modules);
			await expect(
				t.query(api.verify.getDelivery, { deliveryId: value, _secret: SECRET })
			).resolves.toBeNull();
		});

		it(`getCampaignForVerify returns null for a ${label}`, async () => {
			const t = convexTest(schema, modules);
			await expect(
				t.query(api.verify.getCampaignForVerify, { campaignId: value, _secret: SECRET })
			).resolves.toBeNull();
		});

		it(`getReceipt returns null for a ${label}`, async () => {
			const t = convexTest(schema, modules);
			await expect(
				t.query(api.verify.getReceipt, { receiptId: value, _secret: SECRET })
			).resolves.toBeNull();
		});
	}

	it('still resolves a real record, so the guard did not simply disable lookup', async () => {
		const t = convexTest(schema, modules);
		const now = Date.UTC(2026, 7, 1);
		const campaignId = await t.run(async (ctx) => {
			const orgId = await ctx.db.insert('organizations', {
				name: 'Library Friends',
				slug: 'library-friends',
				maxSeats: 5,
				maxTemplatesMonth: 10,
				dmCacheTtlDays: 30,
				countryCode: 'US',
				isPublic: false,
				memberCount: 1,
				verifiedActionsLifetime: 0,
				verifiedActionsPeriodBaseline: 0,
				verifiedActionsPeriodBaselineAt: now,
				sentEmailCount: 0,
				sentEmailPeriodBaseline: 0,
				sentEmailPeriodBaselineAt: now,
				emailReservedCount: 0,
				emailReservationPeriodStart: now,
				emailReservationState: 'ready',
				smsSentCount: 0,
				smsSentPeriodBaseline: 0,
				smsSentPeriodBaselineAt: now,
				updatedAt: now
			});
			return ctx.db.insert('campaigns', {
				orgId,
				type: 'LETTER',
				title: 'Keep the library open',
				status: 'ACTIVE',
				targets: [],
				debateEnabled: false,
				debateThreshold: 50,
				raisedAmountCents: 0,
				donorCount: 0,
				targetCountry: 'US',
				actionCount: 0,
				verifiedActionCount: 0,
				updatedAt: now
			});
		});

		await expect(
			t.query(api.verify.getCampaignForVerify, { campaignId, _secret: SECRET })
		).resolves.toMatchObject({ title: 'Keep the library open' });
	});
});
