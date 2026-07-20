/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
type Harness = TestConvex<typeof schema>;

async function insertOrganization(t: Harness): Promise<Id<'organizations'>> {
	return await t.run((ctx) =>
		ctx.db.insert('organizations', {
			name: 'Supervisor fixture',
			slug: 'supervisor-fixture',
			maxSeats: 1,
			maxTemplatesMonth: 1,
			dmCacheTtlDays: 7,
			countryCode: 'US',
			isPublic: false,
			supporterCount: 0,
			campaignCount: 0,
			memberCount: 1,
			sentEmailCount: 0,
			smsSentCount: 0,
			updatedAt: Date.now()
		})
	);
}

async function insertBlast(
	t: Harness,
	orgId: Id<'organizations'>,
	index: number,
	value: {
		status: 'scheduled' | 'sending';
		updatedAt: number;
		scheduledAt?: number;
		sendMode?: string;
		sealedOrgKey?: string;
	}
): Promise<Id<'emailBlasts'>> {
	return await t.run((ctx) =>
		ctx.db.insert('emailBlasts', {
			orgId,
			subject: `Blast ${index}`,
			bodyHtml: '<p>bounded</p>',
			fromName: 'Commons',
			fromEmail: 'hello@example.org',
			totalRecipients: 1,
			totalSent: 0,
			totalBounced: 0,
			totalOpened: 0,
			totalClicked: 0,
			totalComplained: 0,
			isAbTest: false,
			...value
		})
	);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-07-19T00:00:00.000Z'));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('bounded essential supervisors', () => {
	it('drains an expired contact backlog through fixed self-paged transactions', async () => {
		const t = convexTest({ schema, modules });
		const now = Date.now();
		await t.run(async (ctx) => {
			for (let index = 0; index < 251; index += 1) {
				await ctx.db.insert('resolvedContacts', {
					orgKey: `expired-${index}`,
					resolvedAt: 1,
					expiresAt: now - 1
				});
			}
			for (let index = 0; index < 20; index += 1) {
				await ctx.db.insert('resolvedContacts', {
					orgKey: `future-${index}`,
					resolvedAt: 1,
					expiresAt: now + 60_000
				});
			}
		});

		await expect(
			t.mutation(internal.resolvedContacts.cleanupExpired, {
				before: now,
				limit: 100
			})
		).resolves.toEqual({ deleted: 100, hasMore: true, before: now });

		await t.finishAllScheduledFunctions(vi.runAllTimers);
		await t.run(async (ctx) => {
			const rows = await ctx.db.query('resolvedContacts').collect();
			expect(rows).toHaveLength(20);
			expect(rows.every((row) => row.expiresAt > now)).toBe(true);
		});
	});

	it('pages both stale sealed-key statuses without touching fresh or keyless rows', async () => {
		const t = convexTest({ schema, modules });
		const orgId = await insertOrganization(t);
		const now = Date.now();
		const cutoff = now - 24 * 60 * 60 * 1000;
		const staleIds: Array<Id<'emailBlasts'>> = [];
		const keylessIds: Array<Id<'emailBlasts'>> = [];
		const freshIds: Array<Id<'emailBlasts'>> = [];

		for (let index = 0; index < 130; index += 1) {
			staleIds.push(
				await insertBlast(t, orgId, index, {
					status: index % 2 === 0 ? 'scheduled' : 'sending',
					updatedAt: cutoff - index - 1,
					sealedOrgKey: `sealed-${index}`,
					sendMode: 'tee-sealed',
					scheduledAt: now - 60_000
				})
			);
		}
		for (let index = 0; index < 8; index += 1) {
			keylessIds.push(
				await insertBlast(t, orgId, 1_000 + index, {
					status: index % 2 === 0 ? 'scheduled' : 'sending',
					updatedAt: cutoff - index - 1,
					sendMode: 'tee-sealed',
					scheduledAt: now - 60_000
				})
			);
			freshIds.push(
				await insertBlast(t, orgId, 2_000 + index, {
					status: index % 2 === 0 ? 'scheduled' : 'sending',
					updatedAt: cutoff + 1,
					sealedOrgKey: `fresh-${index}`,
					sendMode: 'tee-sealed',
					scheduledAt: now - 60_000
				})
			);
		}

		const first = await t.mutation(internal.blastCleanup.cleanupStaleSealedKeys, {
			cutoff,
			limit: 25
		});
		expect(first).toMatchObject({ cleaned: 25, hasMore: true, cutoff });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		await t.run(async (ctx) => {
			for (const [index, id] of staleIds.entries()) {
				const row = await ctx.db.get(id);
				expect(row?.status).toBe(index % 2 === 0 ? 'failed' : 'outcome_unknown');
				expect(row).not.toHaveProperty('sealedOrgKey');
			}
			for (const id of keylessIds) {
				expect(await ctx.db.get(id)).not.toHaveProperty('sealedOrgKey');
			}
			for (const id of freshIds) {
				await expect(ctx.db.get(id)).resolves.toMatchObject({
					sealedOrgKey: expect.stringMatching(/^fresh-/)
				});
			}
		});
	});

	it('caps due and stuck blast discovery by composite time indexes', async () => {
		const t = convexTest({ schema, modules });
		const orgId = await insertOrganization(t);
		const now = Date.now();
		for (let index = 0; index < 80; index += 1) {
			await insertBlast(t, orgId, index, {
				status: 'scheduled',
				updatedAt: now - 1,
				sealedOrgKey: `due-${index}`,
				sendMode: 'tee-sealed',
				scheduledAt: now - index - 1
			});
			await insertBlast(t, orgId, 1_000 + index, {
				status: 'sending',
				updatedAt: now - 60_000 - index,
				sealedOrgKey: `stuck-${index}`,
				sendMode: 'tee-sealed',
				scheduledAt: now - 120_000
			});
		}
		for (let index = 0; index < 10; index += 1) {
			await insertBlast(t, orgId, 2_000 + index, {
				status: 'scheduled',
				updatedAt: now,
				sealedOrgKey: `future-${index}`,
				sendMode: 'tee-sealed',
				scheduledAt: now + 60_000
			});
			await insertBlast(t, orgId, 3_000 + index, {
				status: 'scheduled',
				updatedAt: now,
				sendMode: 'client-direct',
				scheduledAt: now - 60_000
			});
		}

		const ready = await t.query(internal.blasts.getReadyBlasts, { limit: 25 });
		expect(ready.blasts).toHaveLength(25);
		expect(ready.blasts.every((row) => row.status === 'scheduled')).toBe(true);

		const stuck = await t.query(internal.blasts.getStuckSendingBlasts, {
			stuckBeforeMs: now - 30_000,
			limit: 25
		});
		expect(stuck.blasts).toHaveLength(25);
		expect(stuck.hasMore).toBe(true);
		expect(stuck.blasts.every((row) => row.status === 'sending')).toBe(true);

		await expect(t.query(internal.blasts.getReadyBlasts, { limit: 0 })).rejects.toThrow(
			'BLAST_RECOVERY_LIMIT_INVALID'
		);
	});
});
