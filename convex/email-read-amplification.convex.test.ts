/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import schema from './schema';
import { syncEmailAbWinnerCandidate } from './lib/emailAbWinnerCandidate';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
type Harness = TestConvex<typeof schema>;
const NOW = Date.parse('2026-07-19T12:00:00.000Z');

async function seedOrg(t: Harness): Promise<Id<'organizations'>> {
	return await t.run((ctx) =>
		ctx.db.insert('organizations', {
			name: 'Email projection proof',
			slug: 'email-projection-proof',
			maxSeats: 5,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 7,
			countryCode: 'US',
			isPublic: false,
			updatedAt: NOW
		})
	);
}

async function seedBlast(
	t: Harness,
	orgId: Id<'organizations'>,
	overrides: Record<string, unknown> = {}
) {
	return await t.run((ctx) =>
		ctx.db.insert('emailBlasts', {
			orgId,
			subject: 'Projection proof',
			bodyHtml: '<p>large source body is deliberately absent from the projection</p>',
			fromName: 'Commons',
			fromEmail: 'commons@example.test',
			status: 'sending',
			totalRecipients: 10_000,
			receiptCount: 0,
			totalSent: 0,
			totalBounced: 0,
			totalOpened: 0,
			totalClicked: 0,
			totalComplained: 0,
			updatedAt: NOW,
			sendMode: 'server',
			isAbTest: false,
			...overrides
		})
	);
}

describe('email compact launch projections', () => {
	it('keeps receipt inserts and retries exact without a cohort count scan', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t);
		const blastId = await seedBlast(t, orgId);
		const receipt = {
			recipientEmailHash: 'hash-1',
			sesMessageId: 'ses-1',
			status: 'sent' as const,
			sentAt: NOW
		};

		await expect(
			t.mutation(internal.blasts.recordBlastReceiptsInternal, {
				blastId,
				receipts: [receipt]
			})
		).resolves.toMatchObject({ written: 1, updated: 0 });
		await expect(
			t.mutation(internal.blasts.recordBlastReceiptsInternal, {
				blastId,
				receipts: [receipt]
			})
		).resolves.toMatchObject({ written: 0, updated: 1 });

		const state = await t.run(async (ctx) => ({
			blast: await ctx.db.get(blastId),
			receipts: await ctx.db
				.query('emailDeliveryReceipts')
				.withIndex('by_blastId', (q) => q.eq('blastId', blastId))
				.collect()
		}));
		expect(state.blast?.receiptCount).toBe(1);
		expect(state.receipts).toHaveLength(1);
	});

	it('fails closed before receipt reads for corrupt or legacy count authority', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t);
		const blastId = await seedBlast(t, orgId);
		const args = {
			blastId,
			receipts: [
				{
					recipientEmailHash: 'hash-2',
					status: 'failed' as const,
					sentAt: NOW
				}
			]
		};

		await t.run((ctx) => ctx.db.patch(blastId, { totalRecipients: 10_001 }));
		await expect(t.mutation(internal.blasts.recordBlastReceiptsInternal, args)).rejects.toThrow(
			'EMAIL_BLAST_RECIPIENT_COUNT_REPAIR_REQUIRED'
		);
		await t.run((ctx) => ctx.db.patch(blastId, { totalRecipients: 1, receiptCount: undefined }));
		await expect(t.mutation(internal.blasts.recordBlastReceiptsInternal, args)).rejects.toThrow(
			'EMAIL_RECEIPT_COUNT_PROJECTION_NOT_READY'
		);
		expect(await t.run((ctx) => ctx.db.query('emailDeliveryReceipts').collect())).toHaveLength(0);
	});

	it('projects only scalar A/B winner inputs and removes them once resolved', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t);
		const blastId = await seedBlast(t, orgId, {
			status: 'sent',
			sendMode: 'client-direct',
			isAbTest: true,
			abParentId: 'group-1',
			abVariant: 'A',
			abTestConfig: { winnerMetric: 'open', testDurationMs: 60_000 },
			totalRecipients: 10,
			totalSent: 10,
			totalOpened: 4,
			sentAt: NOW
		});

		await t.run((ctx) =>
			syncEmailAbWinnerCandidate(ctx as unknown as MutationCtx, {
				blastId,
				orgId,
				status: 'sent',
				isAbTest: true,
				abParentId: 'group-1',
				abVariant: 'A',
				abTestConfig: { winnerMetric: 'open', testDurationMs: 60_000 },
				totalSent: 10,
				totalOpened: 4,
				totalClicked: 0,
				sentAt: NOW
			})
		);

		const candidates = await t.query(internal.email._findAbCandidates, {});
		expect(candidates).toEqual([
			expect.objectContaining({
				_id: blastId,
				orgId,
				abParentId: 'group-1',
				totalSent: 10,
				totalOpened: 4,
				winnerMetric: 'open'
			})
		]);
		expect(candidates[0]).not.toHaveProperty('bodyHtml');

		await t.mutation(internal.email._markAbWinner, {
			blastIds: [blastId],
			winnerId: blastId,
			pickedAt: NOW + 1
		});
		expect(await t.query(internal.email._findAbCandidates, {})).toEqual([]);
	});
});
