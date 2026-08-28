/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import type { TransactionMetrics } from 'convex/server';

import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';
import { syncSessionAuthority } from './lib/sessionAuthority';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'session-authority-test-secret-32-byte-floor';
type Harness = TestConvex<typeof schema>;

function userValue(index: number): Omit<Doc<'users'>, '_id' | '_creationTime'> {
	return {
		email: `person-${index}@example.org`,
		name: `Person ${index}`,
		tokenIdentifier: `https://commons.email|user-${index}`,
		updatedAt: index + 1,
		isVerified: index % 2 === 0,
		authorityLevel: 1,
		trustTier: 0,
		trustScore: index,
		reputationTier: 'new',
		districtVerified: false,
		templatesContributed: 0,
		templateAdoptionRate: 0,
		peerEndorsements: 0,
		activeMonths: 0,
		profileVisibility: 'private'
	};
}

async function finishMigration(t: Harness): Promise<void> {
	let result = (await t.mutation(internal.sessionAuthority.migrateSessionAuthorities, {
		scheduleContinuation: false
	})) as { status: string; runToken: string };
	for (let attempt = 0; result.status === 'running' && attempt < 100; attempt += 1) {
		result = (await t.mutation(internal.sessionAuthority.migrateSessionAuthorities, {
			runToken: result.runToken,
			scheduleContinuation: false
		})) as { status: string; runToken: string };
	}
	expect(result.status).toBe('migrated');
	await expect(
		t.mutation(internal.sessionAuthority.activateSessionAuthorities, {})
	).resolves.toMatchObject({ status: 'ready' });
}

function transactionMetrics(ctx: unknown): Promise<TransactionMetrics> {
	return (
		ctx as {
			meta: { getTransactionMetrics: () => Promise<TransactionMetrics> };
		}
	).meta.getTransactionMetrics();
}

beforeEach(() => {
	vi.stubEnv('INTERNAL_API_SECRET', SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
});

afterEach(() => vi.unstubAllEnvs());

describe('compact session authority plane', () => {
	it('fails a legacy session transiently until bounded migration is activated', async () => {
		const t = convexTest({ schema, modules });
		const sessionId = await t.run(async (ctx) => {
			const userId = await ctx.db.insert('users', userValue(0));
			return await ctx.db.insert('sessions', {
				userId,
				expiresAt: Date.now() + 86_400_000
			});
		});

		await expect(
			t.query(api.sessionAuthority.get, { _secret: SECRET, sessionId })
		).resolves.toEqual({ status: 'not_ready', reason: 'SESSION_AUTHORITY_MISSING' });

		await finishMigration(t);
		await expect(
			t.query(api.sessionAuthority.readiness, { _secret: SECRET })
		).resolves.toMatchObject({ ready: true, status: 'ready', scanned: 1, written: 1 });
		await expect(
			t.query(api.sessionAuthority.get, { _secret: SECRET, sessionId })
		).resolves.toMatchObject({
			status: 'ok',
			authority: { email: 'person-0@example.org', version: 1 }
		});
	});

	it('defers an email-less user without minting a partial row', async () => {
		// CONTRACT CHANGED. This case used to demand the whole plane block, which
		// was the only way to guarantee no partial row got minted. Deferral is a
		// third option that keeps that guarantee and does not halt the plane, and
		// it is the honest one: authOps repairs an email-less user at the next
		// sign-in, so the row is pre-heal, not corrupt, and it has no session to
		// authorize in the meantime. Blocking on one stopped production at 17/20
		// over a client-custody account and three stale seed rows.
		//
		// The invariant the original case actually protected -- never mint a
		// partial authority row -- is asserted unchanged at the end.
		const t = convexTest({ schema, modules });
		await t.run(async (ctx) => {
			const { email: _unused, ...emailless } = userValue(0);
			const insertedUserId = await ctx.db.insert('users', emailless);
			await ctx.db.insert('sessions', {
				userId: insertedUserId,
				expiresAt: Date.now() + 86_400_000
			});
			return insertedUserId;
		});

		await expect(
			t.mutation(internal.sessionAuthority.migrateSessionAuthorities, {
				scheduleContinuation: false
			})
		).resolves.toMatchObject({ status: 'migrated', scanned: 1, written: 0, deferred: 1 });

		// Deferred rows are counted, so the plane can still reach ready without
		// pretending the user was written.
		await expect(
			t.mutation(internal.sessionAuthority.activateSessionAuthorities, {})
		).resolves.toMatchObject({ status: 'ready', scanned: 1, written: 0, deferred: 1 });

		await t.run(async (ctx) => {
			expect(await ctx.db.query('userSessionAuthorities').collect()).toEqual([]);
		});
	});

	it('still blocks the plane on a user that is invalid rather than incomplete', async () => {
		// Deferral must not become a way to walk past a real corruption. Only an
		// absent email defers; every other projection failure is still terminal.
		const t = convexTest({ schema, modules });
		const userId = await t.run(async (ctx) =>
			ctx.db.insert('users', { ...userValue(0), email: `${'e'.repeat(400)}@example.org` })
		);

		await expect(
			t.mutation(internal.sessionAuthority.migrateSessionAuthorities, {
				scheduleContinuation: false
			})
		).resolves.toMatchObject({
			status: 'blocked',
			failureCode: 'SESSION_AUTHORITY_INVALID:email:bytes',
			failureUserId: userId
		});

		await t.run(async (ctx) => {
			expect(await ctx.db.query('userSessionAuthorities').collect()).toEqual([]);
		});
	});

	it('holds the request hot path at exactly one session and one compact authority row', async () => {
		const t = convexTest({ schema, modules });
		const sessionId = await t.run(async (ctx) => {
			let selectedUserId: Id<'users'> | null = null;
			for (let index = 0; index < 500; index += 1) {
				const userId = await ctx.db.insert('users', userValue(index));
				await syncSessionAuthority(ctx, userId);
				if (index === 337) selectedUserId = userId;
			}
			if (!selectedUserId) throw new Error('fixture user missing');
			return await ctx.db.insert('sessions', {
				userId: selectedUserId,
				expiresAt: Date.now() + 86_400_000
			});
		});

		const observed = await t.query(async (ctx) => {
			const value = await ctx.runQuery(api.sessionAuthority.get, {
				_secret: SECRET,
				sessionId
			});
			return { value, metrics: await transactionMetrics(ctx) };
		});

		expect(observed.value).toMatchObject({ status: 'ok' });
		expect(observed.metrics.documentsRead.used).toBe(2);
		expect(observed.metrics.databaseQueries.used).toBe(2);
		expect(observed.metrics.bytesRead.used).toBeLessThan(20_000);
	});

	it('revokes immediately and removes a stale projection during the canonical delete sync', async () => {
		const t = convexTest({ schema, modules });
		const { userId, sessionId } = await t.run(async (ctx) => {
			const userId = await ctx.db.insert('users', userValue(0));
			await syncSessionAuthority(ctx, userId);
			const sessionId = await ctx.db.insert('sessions', {
				userId,
				expiresAt: Date.now() + 86_400_000
			});
			return { userId, sessionId };
		});

		await t.run(async (ctx) => {
			await ctx.db.delete(sessionId);
		});
		await expect(
			t.query(api.sessionAuthority.get, { _secret: SECRET, sessionId })
		).resolves.toEqual({ status: 'invalid' });

		await t.run(async (ctx) => {
			await ctx.db.delete(userId);
			await syncSessionAuthority(ctx, userId);
			expect(await ctx.db.query('userSessionAuthorities').collect()).toEqual([]);
		});
	});
});
