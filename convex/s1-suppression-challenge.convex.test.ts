/// <reference types="vite/client" />

/**
 * The terminal suppression write consumes a mailbox-control challenge.
 *
 * Possession of a do-not-contact link proves nothing: the link rides a message
 * the SENDER composed and sent, so the sender holds it before the recipient
 * does. The authority is therefore a one-use nonce mailed TO the address, and
 * this file proves the data layer refuses on possession alone — no row, an
 * expired row and a consumed row all leave `contactAuthorities` untouched, and
 * a live row is spent in the same transaction as the write it authorizes.
 *
 * The issuance cap is proven here too, and per CONTACT HASH rather than per
 * caller: the caller is anonymous by design, so the only thing worth rationing
 * is mail arriving at one mailbox.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import { computeGlobalEmailHash } from './_orgHash';
import { readContactAuthority } from './lib/contactAuthority';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'recipient-suppression-challenge-secret-32b';
const SLUG = 'clean-water';
const ADDRESS = 'director@agency.example.test';
const DAY_MS = 24 * 60 * 60 * 1000;

type Harness = TestConvex<typeof schema>;

beforeEach(() => {
	vi.stubEnv('INTERNAL_API_SECRET', SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

/** A 64-hex stand-in for `sha256(nonce)`. The nonce itself never reaches Convex. */
function nonceHash(seed: string): string {
	return seed.padEnd(64, '0').slice(0, 64).toLowerCase().replace(/[^0-9a-f]/g, '0');
}

async function seedChallenge(
	t: Harness,
	contactHash: string,
	overrides: { expiresAt?: number; consumedAt?: number; tokenHash?: string; issuedAt?: number } = {}
): Promise<string> {
	const tokenHash = overrides.tokenHash ?? nonceHash('ab');
	const issuedAt = overrides.issuedAt ?? Date.now();
	await t.run(async (ctx) => {
		await ctx.db.insert('recipientSuppressionChallenges', {
			contactHash,
			slug: SLUG,
			tokenHash,
			issuedAt,
			expiresAt: overrides.expiresAt ?? issuedAt + DAY_MS,
			...(overrides.consumedAt !== undefined ? { consumedAt: overrides.consumedAt } : {})
		});
	});
	return tokenHash;
}

async function suppressedState(t: Harness, contactHash: string): Promise<string | null> {
	return t.run(async (ctx) => {
		const row = await readContactAuthority(ctx, 'email', contactHash);
		return row?.state ?? null;
	});
}

describe('the terminal write refuses on possession alone', () => {
	it('writes nothing when no challenge row exists', async () => {
		const t = convexTest({ schema, modules });
		const contactHash = await computeGlobalEmailHash(ADDRESS);

		await expect(
			t.mutation(api.email.suppressRecipientByRequest, {
				_secret: SECRET,
				challengeNonceHash: nonceHash('cd')
			})
		).rejects.toThrow(/RECIPIENT_SUPPRESSION_CHALLENGE_NOT_FOUND/);

		expect(await suppressedState(t, contactHash)).toBeNull();
	});

	it('writes nothing when the challenge has expired', async () => {
		const t = convexTest({ schema, modules });
		const contactHash = await computeGlobalEmailHash(ADDRESS);
		const tokenHash = await seedChallenge(t, contactHash, {
			issuedAt: Date.now() - 2 * DAY_MS,
			expiresAt: Date.now() - DAY_MS
		});

		await expect(
			t.mutation(api.email.suppressRecipientByRequest, { _secret: SECRET, challengeNonceHash: tokenHash })
		).rejects.toThrow(/RECIPIENT_SUPPRESSION_CHALLENGE_EXPIRED/);

		expect(await suppressedState(t, contactHash)).toBeNull();
	});

	it('writes nothing when the challenge has already been consumed', async () => {
		const t = convexTest({ schema, modules });
		const contactHash = await computeGlobalEmailHash(ADDRESS);
		const tokenHash = await seedChallenge(t, contactHash, { consumedAt: Date.now() });

		await expect(
			t.mutation(api.email.suppressRecipientByRequest, { _secret: SECRET, challengeNonceHash: tokenHash })
		).rejects.toThrow(/RECIPIENT_SUPPRESSION_CHALLENGE_CONSUMED/);

		expect(await suppressedState(t, contactHash)).toBeNull();
	});

	it('refuses a caller that names a mailbox the challenge does not cover', async () => {
		const t = convexTest({ schema, modules });
		const contactHash = await computeGlobalEmailHash(ADDRESS);
		const otherHash = await computeGlobalEmailHash('someone-else@agency.example.test');
		const tokenHash = await seedChallenge(t, contactHash);

		await expect(
			t.mutation(api.email.suppressRecipientByRequest, {
				_secret: SECRET,
				challengeNonceHash: tokenHash,
				contactHash: otherHash
			})
		).rejects.toThrow(/RECIPIENT_SUPPRESSION_CHALLENGE_MISMATCH/);

		expect(await suppressedState(t, contactHash)).toBeNull();
		expect(await suppressedState(t, otherHash)).toBeNull();
	});
});

describe('a live challenge suppresses exactly once', () => {
	it('writes the authority and consumes the row in the same transaction', async () => {
		const t = convexTest({ schema, modules });
		const contactHash = await computeGlobalEmailHash(ADDRESS);
		const tokenHash = await seedChallenge(t, contactHash);

		expect(
			await t.mutation(api.email.suppressRecipientByRequest, {
				_secret: SECRET,
				challengeNonceHash: tokenHash
			})
		).toEqual({ suppressed: true });

		expect(await suppressedState(t, contactHash)).toBe('email_suppressed');
		const consumedAt = await t.run(async (ctx) => {
			const row = await ctx.db
				.query('recipientSuppressionChallenges')
				.withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
				.first();
			return row?.consumedAt ?? null;
		});
		expect(typeof consumedAt).toBe('number');
	});

	it('refuses the replay of a nonce that already fired', async () => {
		const t = convexTest({ schema, modules });
		const contactHash = await computeGlobalEmailHash(ADDRESS);
		const tokenHash = await seedChallenge(t, contactHash);

		await t.mutation(api.email.suppressRecipientByRequest, {
			_secret: SECRET,
			challengeNonceHash: tokenHash
		});
		await expect(
			t.mutation(api.email.suppressRecipientByRequest, { _secret: SECRET, challengeNonceHash: tokenHash })
		).rejects.toThrow(/RECIPIENT_SUPPRESSION_CHALLENGE_CONSUMED/);
	});
});

describe('challenge issuance is bounded per mailbox, not per caller', () => {
	it('issues three in a day and inserts nothing on the fourth', async () => {
		const t = convexTest({ schema, modules });
		const contactHash = await computeGlobalEmailHash(ADDRESS);
		const issuedAt = Date.now();

		for (let attempt = 0; attempt < 3; attempt += 1) {
			expect(
				await t.mutation(api.email.issueRecipientSuppressionChallenge, {
					_secret: SECRET,
					contactHash,
					slug: SLUG,
					tokenHash: nonceHash(`a${attempt}`),
					issuedAt,
					expiresAt: issuedAt + DAY_MS
				})
			).toEqual({ issued: true });
		}

		expect(
			await t.mutation(api.email.issueRecipientSuppressionChallenge, {
				_secret: SECRET,
				contactHash,
				slug: SLUG,
				tokenHash: nonceHash('b9'),
				issuedAt,
				expiresAt: issuedAt + DAY_MS
			})
		).toEqual({ issued: false });

		const rows = await t.run(async (ctx) =>
			ctx.db.query('recipientSuppressionChallenges').collect()
		);
		expect(rows).toHaveLength(3);
	});

	it('rations one mailbox without rationing another', async () => {
		const t = convexTest({ schema, modules });
		const contactHash = await computeGlobalEmailHash(ADDRESS);
		const otherHash = await computeGlobalEmailHash('someone-else@agency.example.test');
		const issuedAt = Date.now();

		for (let attempt = 0; attempt < 3; attempt += 1) {
			await t.mutation(api.email.issueRecipientSuppressionChallenge, {
				_secret: SECRET,
				contactHash,
				slug: SLUG,
				tokenHash: nonceHash(`c${attempt}`),
				issuedAt,
				expiresAt: issuedAt + DAY_MS
			});
		}

		expect(
			await t.mutation(api.email.issueRecipientSuppressionChallenge, {
				_secret: SECRET,
				contactHash: otherHash,
				slug: SLUG,
				tokenHash: nonceHash('d1'),
				issuedAt,
				expiresAt: issuedAt + DAY_MS
			})
		).toEqual({ issued: true });
	});

	it('lets the cap lapse once the day has rolled over', async () => {
		const t = convexTest({ schema, modules });
		const contactHash = await computeGlobalEmailHash(ADDRESS);
		const stale = Date.now() - 2 * DAY_MS;

		for (let attempt = 0; attempt < 3; attempt += 1) {
			await t.mutation(api.email.issueRecipientSuppressionChallenge, {
				_secret: SECRET,
				contactHash,
				slug: SLUG,
				tokenHash: nonceHash(`e${attempt}`),
				issuedAt: stale,
				expiresAt: stale + DAY_MS
			});
		}

		const now = Date.now();
		expect(
			await t.mutation(api.email.issueRecipientSuppressionChallenge, {
				_secret: SECRET,
				contactHash,
				slug: SLUG,
				tokenHash: nonceHash('f1'),
				issuedAt: now,
				expiresAt: now + DAY_MS
			})
		).toEqual({ issued: true });
	});

	it('refuses a slug that could forge a different URL shape', async () => {
		const t = convexTest({ schema, modules });
		const contactHash = await computeGlobalEmailHash(ADDRESS);
		const issuedAt = Date.now();

		await expect(
			t.mutation(api.email.issueRecipientSuppressionChallenge, {
				_secret: SECRET,
				contactHash,
				slug: '../evil',
				tokenHash: nonceHash('91'),
				issuedAt,
				expiresAt: issuedAt + DAY_MS
			})
		).rejects.toThrow(/RECIPIENT_SUPPRESSION_CHALLENGE_SLUG_INVALID/);
	});

	it('stays internal-only — an anonymous caller cannot issue or spend', async () => {
		const t = convexTest({ schema, modules });
		const contactHash = await computeGlobalEmailHash(ADDRESS);
		const issuedAt = Date.now();

		await expect(
			t.mutation(api.email.issueRecipientSuppressionChallenge, {
				_secret: 'not-the-internal-secret-but-long-enough',
				contactHash,
				slug: SLUG,
				tokenHash: nonceHash('a1'),
				issuedAt,
				expiresAt: issuedAt + DAY_MS
			})
		).rejects.toThrow();

		await expect(
			t.mutation(api.email.suppressRecipientByRequest, {
				_secret: 'not-the-internal-secret-but-long-enough',
				challengeNonceHash: nonceHash('a1')
			})
		).rejects.toThrow();
	});
});
