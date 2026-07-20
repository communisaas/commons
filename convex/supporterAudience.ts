import { internalMutation, internalQuery } from './_generated/server';
import { makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';
import {
	adoptSupporterAudienceActionVersion,
	SUPPORTER_AUDIENCE_ACTION_MIGRATION_KEY,
	SUPPORTER_AUDIENCE_ACTION_VERSION
} from './lib/supporterAudience';

const migratePageRef = makeFunctionReference<'mutation'>('supporterAudience:migratePage');
const MIGRATION_PAGE = 24;
const MIGRATION_MAX_BYTES = 4 * 1024 * 1024;

/** Restart-safe, cursor-per-transaction projection backfill. */
export const migratePage = internalMutation({
	args: {
		startedAt: v.optional(v.number()),
		restart: v.optional(v.boolean()),
		scheduleContinuation: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		if (args.startedAt !== undefined && args.restart) {
			throw new Error('SUPPORTER_AUDIENCE_MIGRATION_INVALID_CONTROL');
		}
		let migration = await ctx.db
			.query('supporterAudienceActionMigrations')
			.withIndex('by_key', (q) => q.eq('key', SUPPORTER_AUDIENCE_ACTION_MIGRATION_KEY))
			.unique();
		if (args.startedAt !== undefined) {
			if (!migration || migration.status !== 'running' || migration.startedAt !== args.startedAt) {
				return { status: 'superseded' as const };
			}
		} else if (!args.restart && migration?.status === 'ready') {
			return { status: 'ready' as const, scanned: migration.scanned };
		} else if (!args.restart && migration?.status === 'blocked') {
			return { status: 'blocked' as const, failureCode: migration.failureCode ?? null };
		} else if (!args.restart && migration?.status === 'running') {
			return { status: 'running' as const, startedAt: migration.startedAt };
		} else {
			const now = Date.now();
			const initial = {
				key: SUPPORTER_AUDIENCE_ACTION_MIGRATION_KEY as 'supporter-audience-actions-v2',
				status: 'running' as const,
				cursor: undefined,
				scanned: 0,
				projected: 0,
				failureCode: undefined,
				failureSourceId: undefined,
				startedAt: now,
				completedAt: undefined,
				updatedAt: now
			};
			if (migration) await ctx.db.patch(migration._id, initial);
			else await ctx.db.insert('supporterAudienceActionMigrations', initial);
			migration = await ctx.db
				.query('supporterAudienceActionMigrations')
				.withIndex('by_key', (q) => q.eq('key', SUPPORTER_AUDIENCE_ACTION_MIGRATION_KEY))
				.unique();
		}
		if (!migration || migration.status !== 'running') {
			throw new Error('SUPPORTER_AUDIENCE_MIGRATION_STATE_MISSING');
		}

		const page = await ctx.db
			.query('campaignActions')
			.order('asc')
			.paginate({
				cursor: migration.cursor ?? null,
				numItems: MIGRATION_PAGE,
				maximumRowsRead: MIGRATION_PAGE + 1,
				maximumBytesRead: MIGRATION_MAX_BYTES
			});
		if (page.pageStatus === 'SplitRequired') {
			await ctx.db.patch(migration._id, {
				status: 'blocked',
				failureCode: 'SUPPORTER_AUDIENCE_MIGRATION_PAGE_SPLIT_REQUIRED',
				updatedAt: Date.now()
			});
			return { status: 'blocked' as const };
		}

		let projectedDelta = 0;
		for (const action of page.page) {
			if (action.audienceActionProjectionVersion !== SUPPORTER_AUDIENCE_ACTION_VERSION) {
				await adoptSupporterAudienceActionVersion(ctx, action);
				await ctx.db.patch(action._id, {
					audienceActionProjectionVersion: SUPPORTER_AUDIENCE_ACTION_VERSION
				});
			}
			projectedDelta++;
		}

		const scanned = migration.scanned + page.page.length;
		const projected = migration.projected + projectedDelta;
		const done = page.isDone;
		await ctx.db.patch(migration._id, {
			status: done ? 'migrated' : 'running',
			cursor: done ? undefined : page.continueCursor,
			scanned,
			projected,
			completedAt: done ? Date.now() : undefined,
			updatedAt: Date.now()
		});
		if (!done && args.scheduleContinuation !== false) {
			await ctx.scheduler.runAfter(0, migratePageRef, { startedAt: migration.startedAt });
		}
		return {
			status: done ? ('migrated' as const) : ('running' as const),
			startedAt: migration.startedAt,
			scanned,
			projected
		};
	}
});

export const activate = internalMutation({
	args: {},
	handler: async (ctx) => {
		const migration = await ctx.db
			.query('supporterAudienceActionMigrations')
			.withIndex('by_key', (q) => q.eq('key', SUPPORTER_AUDIENCE_ACTION_MIGRATION_KEY))
			.unique();
		if (migration?.status === 'ready') return { status: 'ready' as const };
		if (!migration || migration.status !== 'migrated') {
			throw new Error('SUPPORTER_AUDIENCE_MIGRATION_INCOMPLETE');
		}
		if (
			migration.cursor !== undefined ||
			migration.failureCode !== undefined ||
			migration.scanned !== migration.projected
		) {
			throw new Error('SUPPORTER_AUDIENCE_MIGRATION_INEXACT');
		}
		await ctx.db.patch(migration._id, { status: 'ready', updatedAt: Date.now() });
		return { status: 'ready' as const, scanned: migration.scanned };
	}
});

export const status = internalQuery({
	args: {},
	handler: async (ctx) => {
		return await ctx.db
			.query('supporterAudienceActionMigrations')
			.withIndex('by_key', (q) => q.eq('key', SUPPORTER_AUDIENCE_ACTION_MIGRATION_KEY))
			.unique();
	}
});
