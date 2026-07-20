import { makeFunctionReference, type FunctionReference } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireInternalSecret } from './_internalAuth';
import {
	ACCOUNTABILITY_READ_MODEL_MIGRATION_KEY,
	ACCOUNTABILITY_USER_RECEIPT_MAX_BYTES,
	accountabilityProjectionWithBytes,
	isAccountabilityReadModelReady,
	normalizeAccountabilityIdentityCommitment,
	normalizeAccountabilityCursor
} from './lib/accountabilityReadModel';
import {
	getAccountabilityReadModelMigration,
	syncAccountabilityOrgDmFollowProjection,
	syncAccountabilityReceiptProjection,
	syncAccountabilityScorecardProjection
} from './lib/accountabilityReadModelDb';

const MIGRATION_PAGE_SIZE = 8;
const MIGRATION_MAX_BYTES = 4 * 1024 * 1024;
const IDENTITY_REPROJECT_PAGE_SIZE = 32;
const IDENTITY_REPROJECT_MAX_BYTES = 256 * 1024;

const migrateRef = makeFunctionReference<'mutation'>(
	'accountabilityReadModel:migrate'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{
		runToken?: string;
		retryBlocked?: boolean;
		scheduleContinuation?: boolean;
	},
	unknown
>;

const reprojectSupporterIdentityReceiptsRef = makeFunctionReference<'mutation'>(
	'accountabilityReadModel:reprojectSupporterIdentityReceipts'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{
		supporterId: Id<'supporters'>;
		orgId?: Id<'organizations'>;
		cursor?: string;
	},
	unknown
>;

type MigrationPhase = 'receipts' | 'follows' | 'scorecards' | 'complete';

function nextPhase(phase: MigrationPhase): MigrationPhase {
	if (phase === 'receipts') return 'follows';
	if (phase === 'follows') return 'scorecards';
	return 'complete';
}

function failureText(error: unknown): string {
	const value = error instanceof Error ? error.message : String(error);
	return value.slice(0, 512);
}

export const migrationStatus = internalQuery({
	args: {},
	handler: async (ctx) => {
		const row = await getAccountabilityReadModelMigration(ctx);
		return row
			? {
					status: row.status,
					phase: row.phase,
					runToken: row.runToken,
					cursor: row.cursor ?? null,
					scanComplete: row.scanComplete,
					scanned: row.scanned,
					projected: row.projected,
					userProjected: row.userProjected,
					failureCode: row.failureCode ?? null,
					failureSourceId: row.failureSourceId ?? null,
					failurePhase: row.failurePhase ?? null,
					startedAt: row.startedAt,
					completedAt: row.completedAt ?? null
				}
			: { status: 'not-started' as const };
	}
});

/** Secret-gated deployment verifier. No public query can silently use legacy rows. */
export const readiness = query({
	args: { _secret: v.string() },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const row = await getAccountabilityReadModelMigration(ctx);
		return {
			ready: isAccountabilityReadModelReady(row),
			status: row?.status ?? ('not-started' as const),
			phase: row?.phase ?? null,
			cursor: row?.cursor ?? null,
			scanComplete: row?.scanComplete ?? false,
			scanned: row?.scanned ?? 0,
			projected: row?.projected ?? 0,
			userProjected: row?.userProjected ?? 0,
			failureCode: row?.failureCode ?? null,
			failureSourceId: row?.failureSourceId ?? null,
			failurePhase: row?.failurePhase ?? null
		};
	}
});

/**
 * Self-paging, source-order migration. A poison row commits a durable failure
 * source/phase and retains the pre-page cursor. `retryBlocked` replays that
 * same page after operators repair the source; idempotent receipt deltas make
 * already-processed rows safe to replay.
 */
export const migrate = internalMutation({
	args: {
		runToken: v.optional(v.string()),
		retryBlocked: v.optional(v.boolean()),
		scheduleContinuation: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		let migration = await getAccountabilityReadModelMigration(ctx);
		let runToken: string;
		let phase: MigrationPhase;
		let cursor: string | undefined;
		let scanned: number;
		let projected: number;
		let userProjected: number;

		if (args.runToken !== undefined) {
			if (!migration || migration.runToken !== args.runToken) {
				return { status: 'superseded' as const, runToken: args.runToken };
			}
			if (migration.status === 'blocked' && args.retryBlocked) {
				await ctx.db.patch(migration._id, {
					status: 'running',
					failureCode: undefined,
					failureSourceId: undefined,
					failurePhase: undefined,
					updatedAt: Date.now()
				});
				migration = { ...migration, status: 'running' };
			}
			if (migration.status !== 'running') {
				return {
					status: migration.status,
					runToken: migration.runToken,
					failureCode: migration.failureCode ?? null,
					failureSourceId: migration.failureSourceId ?? null
				};
			}
			runToken = migration.runToken;
			phase = migration.phase;
			cursor = migration.cursor;
			scanned = migration.scanned;
			projected = migration.projected;
			userProjected = migration.userProjected;
		} else if (migration) {
			return {
				status: migration.status,
				runToken: migration.runToken,
				phase: migration.phase,
				failureCode: migration.failureCode ?? null,
				failureSourceId: migration.failureSourceId ?? null
			};
		} else {
			runToken = crypto.randomUUID();
			phase = 'receipts';
			cursor = undefined;
			scanned = 0;
			projected = 0;
			userProjected = 0;
			const now = Date.now();
			await ctx.db.insert('accountabilityReadModelMigrations', {
				key: ACCOUNTABILITY_READ_MODEL_MIGRATION_KEY,
				status: 'running',
				runToken,
				phase,
				cursor: undefined,
				scanComplete: false,
				scanned,
				projected,
				userProjected,
				failureCode: undefined,
				failureSourceId: undefined,
				failurePhase: undefined,
				startedAt: now,
				completedAt: undefined,
				updatedAt: now
			});
			migration = await getAccountabilityReadModelMigration(ctx);
		}

		if (!migration || migration.runToken !== runToken) {
			throw new Error('ACCOUNTABILITY_MIGRATION_STATE_MISSING');
		}
		if (phase === 'complete') {
			return { status: 'migrated' as const, runToken, scanned, projected, userProjected };
		}

		const pagination = {
			cursor: cursor ?? null,
			numItems: MIGRATION_PAGE_SIZE,
			maximumRowsRead: MIGRATION_PAGE_SIZE + 1,
			maximumBytesRead: MIGRATION_MAX_BYTES
		};
		const page =
			phase === 'receipts'
				? await ctx.db.query('accountabilityReceipts').order('asc').paginate(pagination)
				: phase === 'follows'
					? await ctx.db.query('orgDmFollows').order('asc').paginate(pagination)
					: await ctx.db.query('scorecardSnapshots').order('asc').paginate(pagination);

		if (page.pageStatus === 'SplitRequired') {
			const failureCode = 'ACCOUNTABILITY_MIGRATION_PAGE_SPLIT_REQUIRED';
			await ctx.db.patch(migration._id, {
				status: 'blocked',
				failureCode,
				failurePhase: phase,
				updatedAt: Date.now()
			});
			return { status: 'blocked' as const, runToken, failureCode, failurePhase: phase };
		}

		for (const source of page.page) {
			try {
				if (phase === 'receipts') {
					const result = await syncAccountabilityReceiptProjection(
						ctx,
						source._id as Id<'accountabilityReceipts'>
					);
					if (result.userProjected) userProjected++;
				} else if (phase === 'follows') {
					const follow = source as Doc<'orgDmFollows'>;
					await syncAccountabilityOrgDmFollowProjection(ctx, follow.orgId, follow.decisionMakerId);
				} else {
					await syncAccountabilityScorecardProjection(ctx, source._id as Id<'scorecardSnapshots'>);
				}
				scanned++;
				projected++;
			} catch (error) {
				const failureCode = failureText(error);
				const failureSourceId = String(source._id).slice(0, 256);
				await ctx.db.patch(migration._id, {
					status: 'blocked',
					failureCode,
					failureSourceId,
					failurePhase: phase,
					scanned,
					projected,
					userProjected,
					updatedAt: Date.now()
				});
				return {
					status: 'blocked' as const,
					runToken,
					failureCode,
					failureSourceId,
					failurePhase: phase
				};
			}
		}

		const completedPhase = page.isDone;
		const followingPhase = completedPhase ? nextPhase(phase) : phase;
		const migrated = followingPhase === 'complete';
		const now = Date.now();
		await ctx.db.patch(migration._id, {
			status: migrated ? 'migrated' : 'running',
			phase: followingPhase,
			cursor: completedPhase ? undefined : page.continueCursor,
			scanComplete: migrated,
			scanned,
			projected,
			userProjected,
			failureCode: undefined,
			failureSourceId: undefined,
			failurePhase: undefined,
			completedAt: migrated ? now : undefined,
			updatedAt: now
		});

		if (!migrated && args.scheduleContinuation !== false) {
			await ctx.scheduler.runAfter(0, migrateRef, { runToken });
		}
		return {
			status: migrated ? ('migrated' as const) : ('running' as const),
			runToken,
			phase: followingPhase,
			scanned,
			projected,
			userProjected,
			continueCursor: migrated || completedPhase ? null : page.continueCursor
		};
	}
});

/** Separate operator step: migration completion never silently activates reads. */
export const activate = internalMutation({
	args: {},
	handler: async (ctx) => {
		const migration = await getAccountabilityReadModelMigration(ctx);
		if (isAccountabilityReadModelReady(migration)) return { status: 'ready' as const };
		if (
			!migration ||
			migration.status !== 'migrated' ||
			migration.phase !== 'complete' ||
			!migration.scanComplete ||
			migration.scanned !== migration.projected ||
			migration.cursor !== undefined ||
			migration.failureCode !== undefined ||
			migration.failureSourceId !== undefined ||
			migration.failurePhase !== undefined
		) {
			throw new ConvexError({
				code: 'ACCOUNTABILITY_MIGRATION_INCOMPLETE',
				status: migration?.status ?? 'not-started',
				phase: migration?.phase ?? null,
				failureCode: migration?.failureCode ?? null,
				failureSourceId: migration?.failureSourceId ?? null
			});
		}
		await ctx.db.patch(migration._id, { status: 'ready', updatedAt: Date.now() });
		return {
			status: 'ready' as const,
			scanned: migration.scanned,
			projected: migration.projected,
			userProjected: migration.userProjected
		};
	}
});

/**
 * Bounded repair for supporter identity binding/removal. K-safe receipt
 * sidecars retain supporterId even before identity binding, so this repair
 * touches only compact rows and never walks actions, deliveries, or raw
 * receipts. The supporter is reloaded on every page so concurrent changes
 * converge to the latest identity.
 */
export const reprojectSupporterIdentityReceipts = internalMutation({
	args: {
		supporterId: v.id('supporters'),
		orgId: v.optional(v.id('organizations')),
		cursor: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const supporter = await ctx.db.get(args.supporterId);
		const orgId = supporter?.orgId ?? args.orgId;
		if (!orgId) throw new Error('ACCOUNTABILITY_SUPPORTER_REPROJECT_ORG_REQUIRED');
		if (supporter && args.orgId && supporter.orgId !== args.orgId) {
			throw new Error('ACCOUNTABILITY_SUPPORTER_REPROJECT_ORG_MISMATCH');
		}
		const identityCommitment = normalizeAccountabilityIdentityCommitment(
			supporter?.identityCommitment
		);
		const page = await ctx.db
			.query('accountabilityUserReceiptProjections')
			.withIndex('by_supporterId_proofDeliveredAt', (q) => q.eq('supporterId', args.supporterId))
			.order('asc')
			.paginate({
				cursor: normalizeAccountabilityCursor(args.cursor),
				numItems: IDENTITY_REPROJECT_PAGE_SIZE,
				maximumRowsRead: IDENTITY_REPROJECT_PAGE_SIZE + 1,
				maximumBytesRead: IDENTITY_REPROJECT_MAX_BYTES
			});
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('ACCOUNTABILITY_SUPPORTER_RECEIPT_PAGE_SPLIT_REQUIRED');
		}

		const updatedAt = Date.now();
		for (const row of page.page) {
			const { _id, _creationTime: _ignoredCreationTime, ...projection } = row;
			const next = accountabilityProjectionWithBytes(
				{ ...projection, identityCommitment, updatedAt },
				ACCOUNTABILITY_USER_RECEIPT_MAX_BYTES
			);
			await ctx.db.patch(_id, next);
		}

		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, reprojectSupporterIdentityReceiptsRef, {
				supporterId: args.supporterId,
				orgId,
				cursor: page.continueCursor
			});
			return {
				status: 'running' as const,
				projected: page.page.length,
				continueCursor: page.continueCursor
			};
		}
		return { status: 'complete' as const, projected: page.page.length };
	}
});
