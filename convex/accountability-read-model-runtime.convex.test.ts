/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import { makeFunctionReference, type FunctionReference } from 'convex/server';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import {
	ACCOUNTABILITY_AGGREGATE_MAX_BYTES,
	accountabilityProjectionWithBytes,
	projectAccountabilityReceipt,
	projectUserAccountabilityReceipt
} from './lib/accountabilityReadModel';
import {
	syncAccountabilityReceiptProjection,
	syncSupporterIdentityReceiptProjections
} from './lib/accountabilityReadModelDb';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const SECRET = 'test-internal-secret-0123456789abcdef-pad';
type Harness = TestConvex<typeof schema>;

type MigrationResult = {
	status: 'running' | 'migrated' | 'ready' | 'blocked' | 'superseded';
	runToken: string;
	phase?: string;
	failureCode?: string | null;
	failureSourceId?: string | null;
};

const migrateRef = makeFunctionReference<'mutation'>(
	'accountabilityReadModel:migrate'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ runToken?: string; retryBlocked?: boolean; scheduleContinuation?: boolean },
	MigrationResult
>;
const activateRef = makeFunctionReference<'mutation'>(
	'accountabilityReadModel:activate'
) as unknown as FunctionReference<'mutation', 'internal', Record<string, never>, unknown>;
const readinessRef = makeFunctionReference<'query'>(
	'accountabilityReadModel:readiness'
) as unknown as FunctionReference<'query', 'public', { _secret: string }, unknown>;
const listScorecardDmsRef = makeFunctionReference<'query'>(
	'legislation:listDmsWithReceiptsSince'
) as unknown as FunctionReference<
	'query',
	'internal',
	{ since: number; cursor?: string },
	{ items: Id<'decisionMakers'>[]; continueCursor: string | null; isDone: boolean }
>;
const aggregateScorecardReceiptsRef = makeFunctionReference<'query'>(
	'legislation:aggregateReceiptsForDm'
) as unknown as FunctionReference<
	'query',
	'internal',
	{
		decisionMakerId: Id<'decisionMakers'>;
		periodStart: number;
		periodEnd: number;
		cursor?: string;
	},
	{
		fold: {
			deliveriesSent: number;
			deliveriesOpened: number;
			deliveriesVerified: number;
			repliesReceived: number;
			alignedVotes: number;
			totalScoredVotes: number;
			alignmentNumerator: number;
		};
		continueCursor: string | null;
		isDone: boolean;
	}
>;
async function migrateToCompletion(t: Harness, retry?: MigrationResult): Promise<MigrationResult> {
	let result = retry
		? await t.mutation(migrateRef, {
				runToken: retry.runToken,
				retryBlocked: true,
				scheduleContinuation: false
			})
		: await t.mutation(migrateRef, { scheduleContinuation: false });
	for (let page = 0; result.status === 'running' && page < 20; page++) {
		result = await t.mutation(migrateRef, {
			runToken: result.runToken,
			scheduleContinuation: false
		});
	}
	expect(result.status).toBe('migrated');
	await t.mutation(activateRef, {});
	return result;
}

async function seedFixture(t: Harness, options: { poisonName?: boolean } = {}) {
	return t.run(async (ctx) => {
		const tokenIdentifier = 'https://issuer.example|accountability-user';
		const userId = await ctx.db.insert('users', {
			tokenIdentifier,
			email: 'accountability@example.test',
			identityCommitment: 'identity-accountability-1',
			updatedAt: NOW,
			isVerified: true,
			authorityLevel: 5,
			trustTier: 5,
			trustScore: 100,
			reputationTier: 'active',
			districtVerified: true,
			templatesContributed: 0,
			templateAdoptionRate: 0,
			peerEndorsements: 0,
			activeMonths: 1,
			profileVisibility: 'private'
		});
		const orgId = await ctx.db.insert('organizations', {
			name: 'Accountability Org',
			slug: 'accountability-org',
			description: 'Accountability projection fixture',
			mission: 'Prove bounded receipt reads',
			maxSeats: 5,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: false,
			memberCount: 1,
			updatedAt: NOW
		});
		await ctx.db.insert('orgMemberships', {
			userId,
			orgId,
			role: 'owner',
			joinedAt: NOW
		});
		const decisionMakerId = await ctx.db.insert('decisionMakers', {
			type: 'legislator',
			name: 'Representative Bounded',
			lastName: 'Bounded',
			party: 'Independent',
			jurisdiction: 'US',
			district: 'CA-01',
			active: true,
			updatedAt: NOW
		});
		const billId = await ctx.db.insert('bills', {
			externalId: 'hr-1-119',
			jurisdiction: 'us-federal',
			jurisdictionLevel: 'federal',
			chamber: 'house',
			title: 'Bounded Accountability Act',
			status: 'introduced',
			statusDate: NOW,
			committees: [],
			sourceUrl: 'https://example.test/bill',
			topics: [],
			entities: [],
			updatedAt: NOW
		});
		const campaignId = await ctx.db.insert('campaigns', {
			orgId,
			type: 'LETTER',
			title: 'Bounded campaign',
			status: 'ACTIVE',
			debateEnabled: false,
			debateThreshold: 0,
			raisedAmountCents: 0,
			donorCount: 0,
			targetCountry: 'US',
			billId,
			updatedAt: NOW
		});
		const supporterId = await ctx.db.insert('supporters', {
			orgId,
			encryptedEmail: 'ciphertext',
			emailHash: 'org-email-hash',
			identityCommitment: 'identity-accountability-1',
			verified: true,
			emailStatus: 'subscribed',
			smsStatus: 'none',
			updatedAt: NOW
		});
		const actionId = await ctx.db.insert('campaignActions', {
			campaignId,
			orgId,
			supporterId,
			verified: true,
			engagementTier: 4,
			trustTier: 5,
			delegated: false,
			sentAt: NOW
		});
		const deliveryId = await ctx.db.insert('campaignDeliveries', {
			campaignId,
			actionId,
			decisionMakerId,
			billId,
			targetEmail: 'office@example.test',
			targetName: 'Representative Bounded',
			targetTitle: 'Representative',
			status: 'delivered',
			createdAt: NOW
		});
		const receiptId = await ctx.db.insert('accountabilityReceipts', {
			decisionMakerId,
			dmName: options.poisonName ? 'x'.repeat(513) : 'Representative Bounded',
			billId,
			orgId,
			deliveryId,
			verifiedCount: 5,
			totalCount: 5,
			districtCount: 3,
			attestationDigest: 'attestation-k-safe',
			packetDigest: 'packet-k-safe',
			proofDeliveredAt: NOW,
			causalityClass: 'strong',
			alignment: 0.75,
			status: 'pending_response',
			updatedAt: NOW
		});
		const subKDeliveryId = await ctx.db.insert('campaignDeliveries', {
			campaignId,
			actionId,
			decisionMakerId,
			billId,
			targetEmail: 'office@example.test',
			targetName: 'Representative Bounded',
			targetTitle: 'Representative',
			status: 'delivered',
			createdAt: NOW + 1
		});
		const subKReceiptId = await ctx.db.insert('accountabilityReceipts', {
			decisionMakerId,
			dmName: 'Representative Bounded',
			billId,
			orgId,
			deliveryId: subKDeliveryId,
			verifiedCount: 4,
			totalCount: 4,
			districtCount: 2,
			attestationDigest: 'attestation-sub-k',
			packetDigest: 'packet-sub-k',
			proofDeliveredAt: NOW + 1,
			causalityClass: 'pending',
			alignment: 0,
			status: 'pending_response',
			updatedAt: NOW + 1
		});
		await ctx.db.insert('orgDmFollows', {
			orgId,
			decisionMakerId,
			reason: 'manual',
			alertsEnabled: true,
			followedBy: userId,
			followedAt: NOW
		});
		await ctx.db.insert('scorecardSnapshots', {
			decisionMakerId,
			periodStart: NOW - 86_400_000,
			periodEnd: NOW,
			responsiveness: 0.5,
			alignment: 0.75,
			composite: 0.625,
			deliveriesSent: 2,
			deliveriesOpened: 1,
			deliveriesVerified: 1,
			repliesReceived: 0,
			alignedVotes: 1,
			totalScoredVotes: 1,
			methodologyVersion: 2,
			snapshotHash: 'scorecard-hash'
		});
		return {
			tokenIdentifier,
			userId,
			orgId,
			decisionMakerId,
			billId,
			campaignId,
			supporterId,
			actionId,
			receiptId,
			subKReceiptId
		};
	});
}

function authenticated(t: Harness, tokenIdentifier: string) {
	return t.withIdentity({
		subject: 'accountability-user',
		issuer: 'https://issuer.example',
		tokenIdentifier,
		email: 'accountability@example.test'
	});
}

describe('accountability read-model runtime', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		vi.stubEnv('INTERNAL_API_SECRET', SECRET);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
	});

	it('fails reads closed, then serves exact cursor pages and K-floored identity/public rows', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seedFixture(t);
		const auth = authenticated(t, fixture.tokenIdentifier);

		await expect(
			auth.query(api.legislation.listReceiptsByOrg, {
				slug: 'accountability-org',
				limit: 1
			})
		).rejects.toThrow('ACCOUNTABILITY_READ_MODEL_NOT_READY');
		await migrateToCompletion(t);

		const first = await auth.query(api.legislation.listReceiptsByOrg, {
			slug: 'accountability-org',
			limit: 1
		});
		expect(first.items).toHaveLength(1);
		expect(first.nextCursor).toEqual(expect.any(String));
		const second = await auth.query(api.legislation.listReceiptsByOrg, {
			slug: 'accountability-org',
			limit: 1,
			cursor: first.nextCursor ?? undefined
		});
		expect(second.items).toHaveLength(1);
		expect(second.nextCursor).toBeNull();
		expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(2);

		const mine = await auth.query(api.legislation.listMyReceipts, { limit: 20 });
		expect(mine.items.map((row) => row.receiptId)).toEqual([fixture.receiptId]);
		expect(mine.total).toBeNull();

		const publicProfile = await t.query(api.legislation.getDmPublicProfile, {
			_secret: SECRET,
			identifier: fixture.decisionMakerId,
			limit: 20
		});
		expect(publicProfile?.summary).toMatchObject({ totalReceipts: 1, uniqueBills: 1 });
		expect(publicProfile?.bills.flatMap((bill) => bill.receipts)).toHaveLength(1);
		expect(JSON.stringify(publicProfile)).not.toContain('attestation-sub-k');

		const scorecards = await auth.query(api.legislation.listOrgScorecards, {
			slug: 'accountability-org',
			limit: 20,
			minReports: 1
		});
		expect(scorecards.scorecards).toHaveLength(1);
		expect(scorecards.scorecards[0]).toMatchObject({ receiptCount: 2 });

		await expect(t.query(readinessRef, { _secret: SECRET })).resolves.toMatchObject({
			ready: true,
			status: 'ready',
			failureCode: null
		});
	});

	it('keeps receipt retries idempotent and applies response transition deltas once', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seedFixture(t);
		await migrateToCompletion(t);

		await t.run(async (ctx) => {
			await syncAccountabilityReceiptProjection(ctx as unknown as MutationCtx, fixture.receiptId);
			await syncAccountabilityReceiptProjection(ctx as unknown as MutationCtx, fixture.receiptId);
			await ctx.db.patch(fixture.receiptId, {
				responses: [{ type: 'replied', confidence: 'observed', occurredAt: NOW + 2 }],
				status: 'responded',
				updatedAt: NOW + 2
			});
			await syncAccountabilityReceiptProjection(ctx as unknown as MutationCtx, fixture.receiptId);
			await syncAccountabilityReceiptProjection(ctx as unknown as MutationCtx, fixture.receiptId);
		});

		await expect(
			t.run(async (ctx) => {
				const org = await ctx.db
					.query('accountabilityOrganizationAggregates')
					.withIndex('by_orgId', (q) => q.eq('orgId', fixture.orgId))
					.unique();
				const orgDm = await ctx.db
					.query('accountabilityOrgDmProjections')
					.withIndex('by_orgId_decisionMakerId', (q) =>
						q.eq('orgId', fixture.orgId).eq('decisionMakerId', fixture.decisionMakerId)
					)
					.unique();
				return { org, orgDm };
			})
		).resolves.toMatchObject({
			org: { receiptCount: 2, responseLoggedCount: 1, pendingCount: 1 },
			orgDm: { receiptCount: 2, responseLoggedCount: 1, pendingCount: 1 }
		});
	});

	it('withdraws and restores every identity/public row when a receipt crosses the K floor', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seedFixture(t);
		const auth = authenticated(t, fixture.tokenIdentifier);
		await migrateToCompletion(t);

		await t.run(async (ctx) => {
			await ctx.db.patch(fixture.receiptId, {
				verifiedCount: 4,
				totalCount: 4,
				updatedAt: NOW + 3
			});
			await syncAccountabilityReceiptProjection(ctx as unknown as MutationCtx, fixture.receiptId);
			await syncAccountabilityReceiptProjection(ctx as unknown as MutationCtx, fixture.receiptId);
		});

		await expect(auth.query(api.legislation.listMyReceipts, { limit: 20 })).resolves.toMatchObject({
			items: []
		});
		await expect(
			t.query(api.legislation.getDmPublicProfile, {
				_secret: SECRET,
				identifier: fixture.decisionMakerId,
				limit: 20
			})
		).resolves.toMatchObject({
			summary: { totalReceipts: 0, uniqueBills: 0 },
			bills: []
		});
		await expect(
			t.run(async (ctx) => {
				const aggregate = await ctx.db
					.query('accountabilityDecisionMakerAggregates')
					.withIndex('by_decisionMakerId', (q) => q.eq('decisionMakerId', fixture.decisionMakerId))
					.unique();
				const bill = await ctx.db
					.query('accountabilityDecisionMakerBillProjections')
					.withIndex('by_decisionMakerId_billId', (q) =>
						q.eq('decisionMakerId', fixture.decisionMakerId).eq('billId', fixture.billId)
					)
					.unique();
				return { aggregate, bill };
			})
		).resolves.toMatchObject({
			aggregate: {
				publicReceiptCount: 0,
				publicVerifiedCount: 0,
				publicCausalReceiptCount: 0,
				uniquePublicBillCount: 0
			},
			bill: null
		});

		await t.run(async (ctx) => {
			await ctx.db.patch(fixture.receiptId, {
				verifiedCount: 5,
				totalCount: 5,
				updatedAt: NOW + 4
			});
			await syncAccountabilityReceiptProjection(ctx as unknown as MutationCtx, fixture.receiptId);
			await syncAccountabilityReceiptProjection(ctx as unknown as MutationCtx, fixture.receiptId);
		});
		await expect(auth.query(api.legislation.listMyReceipts, { limit: 20 })).resolves.toMatchObject({
			items: [{ receiptId: fixture.receiptId }]
		});
		await expect(
			t.query(api.legislation.getDmPublicProfile, {
				_secret: SECRET,
				identifier: fixture.decisionMakerId,
				limit: 20
			})
		).resolves.toMatchObject({
			summary: { totalReceipts: 1, uniqueBills: 1 }
		});
	});

	it('durably blocks on poison evidence and replays the same cursor after repair', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seedFixture(t, { poisonName: true });
		const blocked = await t.mutation(migrateRef, { scheduleContinuation: false });
		expect(blocked).toMatchObject({
			status: 'blocked',
			failureCode: 'ACCOUNTABILITY_PROJECTION_INVALID:dmName:bytes',
			failureSourceId: fixture.receiptId
		});
		await expect(t.mutation(activateRef, {})).rejects.toThrow(
			'ACCOUNTABILITY_MIGRATION_INCOMPLETE'
		);

		await t.run(async (ctx) => {
			await ctx.db.patch(fixture.receiptId, { dmName: 'Representative Repaired' });
		});
		await migrateToCompletion(t, blocked);
		await expect(t.query(readinessRef, { _secret: SECRET })).resolves.toMatchObject({
			ready: true,
			failureCode: null,
			failureSourceId: null
		});
	});

	it('reprojects a newly bound identity in bounded pages and invalidates it after supporter deletion', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seedFixture(t);
		await t.run((ctx) =>
			ctx.db.patch(fixture.supporterId, {
				identityCommitment: undefined,
				updatedAt: NOW + 5
			})
		);
		await migrateToCompletion(t);
		await expect(
			t.run(async (ctx) => {
				const row = await ctx.db
					.query('accountabilityUserReceiptProjections')
					.withIndex('by_receiptId', (q) => q.eq('receiptId', fixture.receiptId))
					.unique();
				return row
					? { supporterId: row.supporterId, identityCommitment: row.identityCommitment ?? null }
					: null;
			})
		).resolves.toEqual({ supporterId: fixture.supporterId, identityCommitment: null });

		await t.run(async (ctx) => {
			await ctx.db.patch(fixture.supporterId, {
				identityCommitment: 'identity-accountability-2',
				updatedAt: NOW + 10
			});
			await syncSupporterIdentityReceiptProjections(
				ctx as unknown as MutationCtx,
				fixture.supporterId
			);
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		await expect(
			t.run(async (ctx) => {
				const rows = await ctx.db
					.query('accountabilityUserReceiptProjections')
					.withIndex('by_receiptId', (q) => q.eq('receiptId', fixture.receiptId))
					.take(2);
				const subKRows = await ctx.db
					.query('accountabilityUserReceiptProjections')
					.withIndex('by_receiptId', (q) => q.eq('receiptId', fixture.subKReceiptId))
					.take(2);
				return { rows, subKRows };
			})
		).resolves.toMatchObject({
			rows: [{ identityCommitment: 'identity-accountability-2' }],
			subKRows: []
		});

		await t.run(async (ctx) => {
			await ctx.db.delete(fixture.supporterId);
			await syncSupporterIdentityReceiptProjections(
				ctx as unknown as MutationCtx,
				fixture.supporterId,
				fixture.orgId
			);
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		await expect(
			t.run(async (ctx) => {
				const rows = await ctx.db
					.query('accountabilityUserReceiptProjections')
					.withIndex('by_receiptId', (q) => q.eq('receiptId', fixture.receiptId))
					.take(2);
				return rows.map((row) => ({
					supporterId: row.supporterId,
					identityCommitment: row.identityCommitment ?? null
				}));
			})
		).resolves.toEqual([{ supporterId: fixture.supporterId, identityCommitment: null }]);
	});

	it('rejects duplicate delivery receipts instead of making identity attribution ambiguous', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seedFixture(t);
		await migrateToCompletion(t);
		const duplicateReceiptId = await t.run(async (ctx) => {
			const source = await ctx.db.get(fixture.receiptId);
			if (!source) throw new Error('fixture receipt missing');
			return ctx.db.insert('accountabilityReceipts', {
				decisionMakerId: source.decisionMakerId,
				dmName: source.dmName,
				billId: source.billId,
				orgId: source.orgId,
				deliveryId: source.deliveryId,
				verifiedCount: source.verifiedCount,
				totalCount: source.totalCount,
				districtCount: source.districtCount,
				attestationDigest: 'duplicate-delivery',
				packetDigest: 'duplicate-delivery-packet',
				proofDeliveredAt: NOW + 20,
				causalityClass: 'pending',
				alignment: 0,
				status: 'pending_response',
				updatedAt: NOW + 20
			});
		});
		await expect(
			t.run((ctx) =>
				syncAccountabilityReceiptProjection(ctx as unknown as MutationCtx, duplicateReceiptId)
			)
		).rejects.toThrow('ACCOUNTABILITY_RECEIPT_DUPLICATE_DELIVERY');
	});

	it('requires the complete cursor-free and failure-free readiness state', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seedFixture(t);
		const auth = authenticated(t, fixture.tokenIdentifier);
		await migrateToCompletion(t);

		await t.run(async (ctx) => {
			const migration = await ctx.db
				.query('accountabilityReadModelMigrations')
				.withIndex('by_key', (q) => q.eq('key', 'v1'))
				.unique();
			if (!migration) throw new Error('migration missing');
			await ctx.db.patch(migration._id, { cursor: 'stale-cursor' });
		});
		await expect(t.query(readinessRef, { _secret: SECRET })).resolves.toMatchObject({
			ready: false,
			status: 'ready',
			cursor: 'stale-cursor'
		});
		await expect(auth.query(api.legislation.listMyReceipts, { limit: 20 })).rejects.toThrow(
			'ACCOUNTABILITY_READ_MODEL_NOT_READY'
		);
		await expect(t.mutation(activateRef, {})).rejects.toThrow(
			'ACCOUNTABILITY_MIGRATION_INCOMPLETE'
		);
	});

	it('keeps user, receipt, public-DM, scorecard, and export reads page-bounded beyond every envelope', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seedFixture(t);
		const auth = authenticated(t, fixture.tokenIdentifier);
		await migrateToCompletion(t);

		await t.run(async (ctx) => {
			const bill = await ctx.db.get(fixture.billId);
			if (!bill) throw new Error('fixture bill missing');
			for (let index = 0; index < 105; index++) {
				const proofDeliveredAt = NOW + 1_000 + index;
				const sourceFields = {
					decisionMakerId: fixture.decisionMakerId,
					dmName: 'Representative Bounded',
					billId: fixture.billId,
					orgId: fixture.orgId,
					verifiedCount: 5,
					totalCount: 5,
					districtCount: 3,
					attestationDigest: `attestation-page-${index}`,
					packetDigest: `packet-page-${index}`,
					proofDeliveredAt,
					causalityClass: 'pending' as const,
					alignment: 0,
					status: 'pending_response',
					updatedAt: proofDeliveredAt
				};
				const receiptId = await ctx.db.insert('accountabilityReceipts', sourceFields);
				const source = {
					_id: receiptId,
					_creationTime: proofDeliveredAt,
					...sourceFields
				} as Doc<'accountabilityReceipts'>;
				await ctx.db.insert(
					'accountabilityReceiptProjections',
					projectAccountabilityReceipt(source, { bill })
				);
				const userProjection = projectUserAccountabilityReceipt(
					source,
					fixture.supporterId,
					'identity-accountability-1'
				);
				if (!userProjection) throw new Error('expected K-safe user projection');
				await ctx.db.insert('accountabilityUserReceiptProjections', userProjection);
			}

			const dmAggregate = await ctx.db
				.query('accountabilityDecisionMakerAggregates')
				.withIndex('by_decisionMakerId', (q) => q.eq('decisionMakerId', fixture.decisionMakerId))
				.unique();
			if (!dmAggregate) throw new Error('fixture DM aggregate missing');
			await ctx.db.patch(dmAggregate._id, {
				publicReceiptCount: 106,
				publicVerifiedCount: 530,
				publicCausalReceiptCount: 1,
				uniquePublicBillCount: 1,
				latestProofDeliveredAt: NOW + 1_104,
				updatedAt: NOW + 1_104
			});

			for (let index = 0; index < 105; index++) {
				const decisionMakerId = await ctx.db.insert('decisionMakers', {
					type: 'legislator',
					name: `Paged decision maker ${String(index).padStart(3, '0')}`,
					lastName: `Paged-${index}`,
					active: true,
					updatedAt: NOW + index
				});
				await ctx.db.insert(
					'accountabilityOrgDmProjections',
					accountabilityProjectionWithBytes(
						{
							orgId: fixture.orgId,
							decisionMakerId,
							name: `Paged decision maker ${String(index).padStart(3, '0')}`,
							type: 'legislator',
							followed: true,
							alertsEnabled: true,
							followedAt: NOW + index,
							receiptCount: 1,
							alignedCount: 0,
							opposedCount: 0,
							pendingCount: 1,
							responseLoggedCount: 0,
							anchorFieldCount: 0,
							latestProofDeliveredAt: NOW + index,
							version: 1,
							updatedAt: NOW + index
						},
						ACCOUNTABILITY_AGGREGATE_MAX_BYTES
					)
				);
				await ctx.db.insert(
					'accountabilityDecisionMakerAggregates',
					accountabilityProjectionWithBytes(
						{
							decisionMakerId,
							publicReceiptCount: 0,
							publicVerifiedCount: 0,
							publicCausalReceiptCount: 0,
							uniquePublicBillCount: 0,
							latestProofDeliveredAt: NOW + index,
							version: 1,
							updatedAt: NOW + index
						},
						ACCOUNTABILITY_AGGREGATE_MAX_BYTES
					)
				);
			}
		});

		const scorecardDmFirst = await t.query(listScorecardDmsRef, { since: NOW - 1 });
		const scorecardDmSecond = await t.query(listScorecardDmsRef, {
			since: NOW - 1,
			cursor: scorecardDmFirst.continueCursor ?? undefined
		});
		expect([scorecardDmFirst.items.length, scorecardDmSecond.items.length]).toEqual([100, 6]);
		expect(scorecardDmFirst.isDone).toBe(false);
		expect(scorecardDmSecond.isDone).toBe(true);

		const scorecardReceiptFirst = await t.query(aggregateScorecardReceiptsRef, {
			decisionMakerId: fixture.decisionMakerId,
			periodStart: NOW - 1,
			periodEnd: NOW + 5_000
		});
		const scorecardReceiptSecond = await t.query(aggregateScorecardReceiptsRef, {
			decisionMakerId: fixture.decisionMakerId,
			periodStart: NOW - 1,
			periodEnd: NOW + 5_000,
			cursor: scorecardReceiptFirst.continueCursor ?? undefined
		});
		expect([
			scorecardReceiptFirst.fold.deliveriesSent,
			scorecardReceiptSecond.fold.deliveriesSent
		]).toEqual([100, 7]);
		expect(
			scorecardReceiptFirst.fold.totalScoredVotes + scorecardReceiptSecond.fold.totalScoredVotes
		).toBe(1);
		expect(scorecardReceiptFirst.isDone).toBe(false);
		expect(scorecardReceiptSecond.isDone).toBe(true);

		const myFirst = await auth.query(api.legislation.listMyReceipts, { limit: 50 });
		const mySecond = await auth.query(api.legislation.listMyReceipts, {
			limit: 50,
			cursor: myFirst.nextCursor ?? undefined
		});
		const myThird = await auth.query(api.legislation.listMyReceipts, {
			limit: 50,
			cursor: mySecond.nextCursor ?? undefined
		});
		expect([myFirst.items.length, mySecond.items.length, myThird.items.length]).toEqual([
			50, 50, 6
		]);
		expect(
			new Set([...myFirst.items, ...mySecond.items, ...myThird.items].map((row) => row.receiptId))
				.size
		).toBe(106);
		expect(myThird.nextCursor).toBeNull();

		const orgFirst = await auth.query(api.legislation.listReceiptsByOrg, {
			slug: 'accountability-org',
			limit: 50
		});
		const orgSecond = await auth.query(api.legislation.listReceiptsByOrg, {
			slug: 'accountability-org',
			limit: 50,
			cursor: orgFirst.nextCursor ?? undefined
		});
		const orgThird = await auth.query(api.legislation.listReceiptsByOrg, {
			slug: 'accountability-org',
			limit: 50,
			cursor: orgSecond.nextCursor ?? undefined
		});
		expect([orgFirst.items.length, orgSecond.items.length, orgThird.items.length]).toEqual([
			50, 50, 7
		]);
		expect(
			new Set([...orgFirst.items, ...orgSecond.items, ...orgThird.items].map((row) => row.id)).size
		).toBe(107);

		const publicFirst = await t.query(api.legislation.getDmPublicProfile, {
			_secret: SECRET,
			identifier: fixture.decisionMakerId,
			limit: 50
		});
		const publicSecond = await t.query(api.legislation.getDmPublicProfile, {
			_secret: SECRET,
			identifier: fixture.decisionMakerId,
			limit: 50,
			cursor: publicFirst?.nextCursor ?? undefined
		});
		const publicThird = await t.query(api.legislation.getDmPublicProfile, {
			_secret: SECRET,
			identifier: fixture.decisionMakerId,
			limit: 50,
			cursor: publicSecond?.nextCursor ?? undefined
		});
		expect(publicFirst?.summary.totalReceipts).toBe(106);
		expect([
			publicFirst?.bills.flatMap((entry) => entry.receipts).length,
			publicSecond?.bills.flatMap((entry) => entry.receipts).length,
			publicThird?.bills.flatMap((entry) => entry.receipts).length
		]).toEqual([50, 50, 6]);

		const scorecardFirst = await auth.query(api.legislation.listOrgScorecards, {
			slug: 'accountability-org',
			limit: 50,
			minReports: 1
		});
		const scorecardSecond = await auth.query(api.legislation.listOrgScorecards, {
			slug: 'accountability-org',
			limit: 50,
			minReports: 1,
			cursor: scorecardFirst.meta.nextCursor ?? undefined
		});
		const scorecardThird = await auth.query(api.legislation.listOrgScorecards, {
			slug: 'accountability-org',
			limit: 50,
			minReports: 1,
			cursor: scorecardSecond.meta.nextCursor ?? undefined
		});
		expect([
			scorecardFirst.scorecards.length,
			scorecardSecond.scorecards.length,
			scorecardThird.scorecards.length
		]).toEqual([50, 50, 6]);

		const exportFirst = await auth.query(api.legislation.exportScorecards, {
			slug: 'accountability-org',
			limit: 100
		});
		const exportSecond = await auth.query(api.legislation.exportScorecards, {
			slug: 'accountability-org',
			limit: 100,
			cursor: exportFirst.meta.nextCursor ?? undefined
		});
		expect([exportFirst.scorecards.length, exportSecond.scorecards.length]).toEqual([100, 6]);
		expect(exportSecond.meta.nextCursor).toBeNull();

		await t.run(async (ctx) => {
			await ctx.db.patch(fixture.supporterId, {
				identityCommitment: 'identity-accountability-paged',
				updatedAt: NOW + 2_000
			});
			await syncSupporterIdentityReceiptProjections(
				ctx as unknown as MutationCtx,
				fixture.supporterId,
				fixture.orgId
			);
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		await expect(
			t.run(async (ctx) => {
				const moved = await ctx.db
					.query('accountabilityUserReceiptProjections')
					.withIndex('by_identityCommitment_proofDeliveredAt', (q) =>
						q.eq('identityCommitment', 'identity-accountability-paged')
					)
					.take(200);
				const stale = await ctx.db
					.query('accountabilityUserReceiptProjections')
					.withIndex('by_identityCommitment_proofDeliveredAt', (q) =>
						q.eq('identityCommitment', 'identity-accountability-1')
					)
					.take(1);
				return { moved: moved.length, stale: stale.length };
			})
		).resolves.toEqual({ moved: 106, stale: 0 });
	});

	it('enforces auth, page/cardinality and cursor byte boundaries before source traversal', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seedFixture(t);
		await migrateToCompletion(t);
		await expect(
			t.query(api.legislation.listReceiptsByOrg, {
				slug: 'accountability-org',
				limit: 20
			})
		).rejects.toThrow();
		const auth = authenticated(t, fixture.tokenIdentifier);
		await expect(
			auth.query(api.legislation.listReceiptsByOrg, {
				slug: 'accountability-org',
				limit: 51
			})
		).rejects.toThrow('ACCOUNTABILITY_PAGE_SIZE_INVALID:browse');
		await expect(
			auth.query(api.legislation.listReceiptsByOrg, {
				slug: 'accountability-org',
				limit: 20,
				cursor: 'x'.repeat(2_049)
			})
		).rejects.toThrow('ACCOUNTABILITY_CURSOR_INVALID:bytes');
	});
});
