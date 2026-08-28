/**
 * Queries for the template detail page (s/[slug]).
 *
 * These queries support the Power Landscape view which shows message delivery
 * stats, user district info, and coordination data.
 *
 * Used by: src/routes/s/[slug]/+page.server.ts
 */

import { makeFunctionReference } from 'convex/server';
import type { FunctionReference } from 'convex/server';
import { internalMutation, internalQuery, query } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { requireInternalSecret } from './_internalAuth';
import {
	RECIPIENT_METRICS_MIGRATION_KEY,
	RECIPIENT_METRICS_PRIVACY_FLOOR,
	RECIPIENT_METRICS_VERSION,
	applyDeliveredMessageMetric,
	applyPositionRegistrationMetric,
	readMessageDistrictMetrics
} from './lib/recipientMetrics';

const MESSAGE_METRICS_MIGRATION_PAGE_SIZE = 4;
const MESSAGE_METRICS_MIGRATION_MAX_BYTES = 5 * 1024 * 1024;
const POSITION_METRICS_MIGRATION_PAGE_SIZE = 32;
const POSITION_METRICS_MIGRATION_MAX_BYTES = 2 * 1024 * 1024;
const migrateRecipientMetricsRef = makeFunctionReference<'mutation'>(
	'templatePage:migrateRecipientMetrics'
) as unknown as FunctionReference<'mutation', 'internal', { runToken: string }, unknown>;

/**
 * Get message delivery counts grouped by district hash for a template.
 * K-floor at 5 (districts with <5 deliveries are dropped). Above the floor
 * counts are exact: per-district coverage is the staffer-facing signal that
 * makes a template page useful. `totalDistricts` reflects the visible count.
 */
export const getMessageDistrictCounts = query({
	args: {
		_secret: v.string(),
		templateId: v.id('templates'),
		viewerDistrictHash: v.optional(v.string())
	},
	handler: async (ctx, { _secret, templateId, viewerDistrictHash }) => {
		requireInternalSecret(_secret);
		return await readMessageDistrictMetrics(ctx, {
			templateId,
			viewerDistrictHash
		});
	}
});

/** Viewer-only overlay; the shared anonymous base already comes from R2. */
export const getViewerMessageDistrictCount = query({
	args: {
		_secret: v.string(),
		templateId: v.id('templates'),
		viewerDistrictHash: v.string()
	},
	handler: async (ctx, { _secret, templateId, viewerDistrictHash }) => {
		requireInternalSecret(_secret);
		if (viewerDistrictHash.length === 0 || viewerDistrictHash.length > 200) {
			throw new Error('VIEWER_DISTRICT_HASH_INVALID');
		}
		const row = await ctx.db
			.query('templateMessageDistrictMetrics')
			.withIndex('by_templateId_districtHash', (q) =>
				q.eq('templateId', templateId).eq('districtHash', viewerDistrictHash.trim())
			)
			.unique();
		return row && row.deliveredCount >= RECIPIENT_METRICS_PRIVACY_FLOOR ? row.deliveredCount : 0;
	}
});

/**
 * Count total active states (distinct jurisdictions from federal legislators).
 */
export const getTotalStates = query({
	args: { _secret: v.string() },
	handler: async (_ctx, { _secret }) => {
		requireInternalSecret(_secret);
		// The recipient experience is currently US-only. The old implementation
		// scanned every active decision maker but its caller expected `{count}` and
		// discarded the returned number, always falling back to this same value.
		return { count: 50 };
	}
});

/**
 * Durable, idempotent migration from the two legacy event tables. Each raw row
 * is marked in the same transaction as its compact contribution, so restarts
 * and concurrent new writers cannot double-count it. Large message bodies are
 * limited to four rows / 5 MiB per transaction; position rows use a separate
 * small-row phase. Reader cutover remains closed until explicit activation.
 */
export const migrateRecipientMetrics = internalMutation({
	args: {
		runToken: v.optional(v.string()),
		restart: v.optional(v.boolean()),
		scheduleContinuation: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		if (args.runToken !== undefined && args.restart) {
			throw new Error('RECIPIENT_METRICS_MIGRATION_INVALID_CONTROL');
		}

		let migration = await ctx.db
			.query('recipientMetricsMigrations')
			.withIndex('by_key', (q) => q.eq('key', RECIPIENT_METRICS_MIGRATION_KEY))
			.unique();

		let runToken: string;
		if (args.runToken !== undefined) {
			if (!migration || migration.status !== 'running' || migration.runToken !== args.runToken) {
				return { status: 'superseded' as const, runToken: args.runToken };
			}
			runToken = args.runToken;
		} else if (!args.restart && migration?.status === 'ready') {
			return {
				status: 'already-ready' as const,
				runToken: migration.runToken,
				scannedMessages: migration.scannedMessages,
				projectedMessages: migration.projectedMessages,
				scannedPositions: migration.scannedPositions,
				projectedPositions: migration.projectedPositions
			};
		} else if (!args.restart && migration?.status === 'migrated') {
			return {
				status: 'already-migrated' as const,
				runToken: migration.runToken,
				scannedMessages: migration.scannedMessages,
				projectedMessages: migration.projectedMessages,
				scannedPositions: migration.scannedPositions,
				projectedPositions: migration.projectedPositions
			};
		} else if (!args.restart && migration?.status === 'running') {
			return {
				status: 'already-running' as const,
				runToken: migration.runToken,
				phase: migration.phase,
				scannedMessages: migration.scannedMessages,
				projectedMessages: migration.projectedMessages,
				scannedPositions: migration.scannedPositions,
				projectedPositions: migration.projectedPositions
			};
		} else if (!args.restart && migration?.status === 'blocked') {
			return {
				status: 'blocked' as const,
				runToken: migration.runToken,
				phase: migration.phase,
				failureCode: migration.failureCode ?? null
			};
		} else {
			runToken = crypto.randomUUID();
			const initial = {
				key: RECIPIENT_METRICS_MIGRATION_KEY,
				status: 'running' as const,
				runToken,
				phase: 'messages' as const,
				cursor: undefined,
				scannedMessages: 0,
				projectedMessages: 0,
				scannedPositions: 0,
				projectedPositions: 0,
				failureCode: undefined,
				failureSourceId: undefined,
				startedAt: Date.now(),
				completedAt: undefined,
				updatedAt: Date.now()
			};
			if (migration) await ctx.db.patch(migration._id, initial);
			else await ctx.db.insert('recipientMetricsMigrations', initial);
			migration = await ctx.db
				.query('recipientMetricsMigrations')
				.withIndex('by_key', (q) => q.eq('key', RECIPIENT_METRICS_MIGRATION_KEY))
				.unique();
		}

		if (!migration || migration.runToken !== runToken || migration.status !== 'running') {
			throw new Error('RECIPIENT_METRICS_MIGRATION_STATE_MISSING');
		}

		const block = async (failureCode: string, failureSourceId?: string) => {
			await ctx.db.patch(migration!._id, {
				status: 'blocked',
				failureCode: failureCode.slice(0, 500),
				failureSourceId,
				updatedAt: Date.now()
			});
			return {
				status: 'blocked' as const,
				runToken,
				phase: migration!.phase,
				failureCode,
				failureSourceId: failureSourceId ?? null
			};
		};

		if (migration.phase === 'messages') {
			const page = await ctx.db
				.query('messages')
				.order('asc')
				.paginate({
					cursor: migration.cursor ?? null,
					numItems: MESSAGE_METRICS_MIGRATION_PAGE_SIZE,
					maximumRowsRead: MESSAGE_METRICS_MIGRATION_PAGE_SIZE + 1,
					maximumBytesRead: MESSAGE_METRICS_MIGRATION_MAX_BYTES
				});
			if (page.pageStatus === 'SplitRequired') {
				return await block('RECIPIENT_MESSAGE_METRICS_MIGRATION_PAGE_SPLIT_REQUIRED');
			}

			let projectedMessages = migration.projectedMessages;
			for (const message of page.page) {
				if (message.recipientMetricsVersion === RECIPIENT_METRICS_VERSION) {
					projectedMessages += 1;
					continue;
				}
				try {
					if (message.deliveryStatus === 'delivered') {
						await applyDeliveredMessageMetric(ctx, {
							templateId: message.templateId,
							districtHash: message.districtHash
						});
					}
					await ctx.db.patch(message._id, {
						recipientMetricsVersion: RECIPIENT_METRICS_VERSION
					});
					projectedMessages += 1;
				} catch (error) {
					return await block(
						error instanceof Error ? error.message : String(error),
						String(message._id)
					);
				}
			}

			const scannedMessages = migration.scannedMessages + page.page.length;
			await ctx.db.patch(migration._id, {
				phase: page.isDone ? 'positions' : 'messages',
				cursor: page.isDone ? undefined : page.continueCursor,
				scannedMessages,
				projectedMessages,
				failureCode: undefined,
				failureSourceId: undefined,
				updatedAt: Date.now()
			});
			if (args.scheduleContinuation !== false) {
				await ctx.scheduler.runAfter(0, migrateRecipientMetricsRef, { runToken });
			}
			return {
				status: 'running' as const,
				runToken,
				phase: page.isDone ? ('positions' as const) : ('messages' as const),
				pageScanned: page.page.length,
				scannedMessages,
				projectedMessages,
				scannedPositions: migration.scannedPositions,
				projectedPositions: migration.projectedPositions
			};
		}

		if (migration.phase !== 'positions') {
			return await block('RECIPIENT_METRICS_MIGRATION_PHASE_INVALID');
		}

		const page = await ctx.db
			.query('positionRegistrations')
			.order('asc')
			.paginate({
				cursor: migration.cursor ?? null,
				numItems: POSITION_METRICS_MIGRATION_PAGE_SIZE,
				maximumRowsRead: POSITION_METRICS_MIGRATION_PAGE_SIZE + 1,
				maximumBytesRead: POSITION_METRICS_MIGRATION_MAX_BYTES
			});
		if (page.pageStatus === 'SplitRequired') {
			return await block('RECIPIENT_POSITION_METRICS_MIGRATION_PAGE_SPLIT_REQUIRED');
		}

		let projectedPositions = migration.projectedPositions;
		for (const registration of page.page) {
			if (registration.recipientMetricsVersion === RECIPIENT_METRICS_VERSION) {
				projectedPositions += 1;
				continue;
			}
			try {
				await applyPositionRegistrationMetric(ctx, {
					templateId: registration.templateId,
					stance: registration.stance,
					districtCode: registration.districtCode
				});
				await ctx.db.patch(registration._id, {
					recipientMetricsVersion: RECIPIENT_METRICS_VERSION
				});
				projectedPositions += 1;
			} catch (error) {
				return await block(
					error instanceof Error ? error.message : String(error),
					String(registration._id)
				);
			}
		}

		const scannedPositions = migration.scannedPositions + page.page.length;
		const completedAt = page.isDone ? Date.now() : undefined;
		await ctx.db.patch(migration._id, {
			status: page.isDone ? 'migrated' : 'running',
			phase: page.isDone ? 'complete' : 'positions',
			cursor: page.isDone ? undefined : page.continueCursor,
			scannedPositions,
			projectedPositions,
			completedAt,
			failureCode: undefined,
			failureSourceId: undefined,
			updatedAt: Date.now()
		});
		if (!page.isDone && args.scheduleContinuation !== false) {
			await ctx.scheduler.runAfter(0, migrateRecipientMetricsRef, { runToken });
		}
		return {
			status: page.isDone ? ('migrated' as const) : ('running' as const),
			runToken,
			phase: page.isDone ? ('complete' as const) : ('positions' as const),
			pageScanned: page.page.length,
			scannedMessages: migration.scannedMessages,
			projectedMessages: migration.projectedMessages,
			scannedPositions,
			projectedPositions,
			completedAt: completedAt ?? null
		};
	}
});

/** Explicit cutover after both durable migration phases reached EOF. */
export const activateRecipientMetrics = internalMutation({
	args: {},
	handler: async (ctx) => {
		const migration = await ctx.db
			.query('recipientMetricsMigrations')
			.withIndex('by_key', (q) => q.eq('key', RECIPIENT_METRICS_MIGRATION_KEY))
			.unique();
		if (migration?.status === 'ready') {
			return { status: 'ready' as const, runToken: migration.runToken };
		}
		if (!migration || migration.status !== 'migrated' || migration.phase !== 'complete') {
			throw new Error('RECIPIENT_METRICS_MIGRATION_INCOMPLETE');
		}
		if (
			migration.scannedMessages !== migration.projectedMessages ||
			migration.scannedPositions !== migration.projectedPositions
		) {
			throw new Error('RECIPIENT_METRICS_MIGRATION_INEXACT');
		}
		await ctx.db.patch(migration._id, { status: 'ready', updatedAt: Date.now() });
		return {
			status: 'ready' as const,
			runToken: migration.runToken,
			scannedMessages: migration.scannedMessages,
			projectedMessages: migration.projectedMessages,
			scannedPositions: migration.scannedPositions,
			projectedPositions: migration.projectedPositions
		};
	}
});

/** Secret-gated release/readiness proof; rejects before its first database read. */
export const recipientMetricsStatus = query({
	args: { _secret: v.string() },
	handler: async (ctx, { _secret }) => {
		requireInternalSecret(_secret);
		const migration = await ctx.db
			.query('recipientMetricsMigrations')
			.withIndex('by_key', (q) => q.eq('key', RECIPIENT_METRICS_MIGRATION_KEY))
			.unique();
		return migration
			? {
					status: migration.status,
					phase: migration.phase,
					runToken: migration.runToken,
					scannedMessages: migration.scannedMessages,
					projectedMessages: migration.projectedMessages,
					scannedPositions: migration.scannedPositions,
					projectedPositions: migration.projectedPositions,
					failureCode: migration.failureCode ?? null,
					failureSourceId: migration.failureSourceId ?? null,
					startedAt: migration.startedAt,
					completedAt: migration.completedAt ?? null
				}
			: { status: 'not-started' as const, phase: null };
	}
});

/** Operator CLI status without exposing a browser-callable unauthenticated read. */
export const recipientMetricsMigrationStatus = internalQuery({
	args: {},
	handler: async (ctx) => {
		const migration = await ctx.db
			.query('recipientMetricsMigrations')
			.withIndex('by_key', (q) => q.eq('key', RECIPIENT_METRICS_MIGRATION_KEY))
			.unique();
		return migration
			? {
					status: migration.status,
					phase: migration.phase,
					runToken: migration.runToken,
					scannedMessages: migration.scannedMessages,
					projectedMessages: migration.projectedMessages,
					scannedPositions: migration.scannedPositions,
					projectedPositions: migration.projectedPositions,
					failureCode: migration.failureCode ?? null,
					failureSourceId: migration.failureSourceId ?? null,
					startedAt: migration.startedAt,
					completedAt: migration.completedAt ?? null
				}
			: { status: 'not-started' as const, phase: null };
	}
});

/**
 * Get the user's active DM relation (for district code lookup).
 */
export const getUserDmRelation = query({
	args: { userId: v.id('users'), _secret: v.optional(v.string()) },
	handler: async (ctx, { userId, _secret }) => {
		// Server-only: callable solely from trusted SvelteKit server code, never a
		// browser. Closes the userId-enumeration vector for district codes
		// (internalQuery isn't reachable via the public HTTP client serverQuery uses).
		requireInternalSecret(_secret);
		const active = await ctx.db
			.query('userDmRelations')
			.withIndex('by_userId_isActive_decisionMakerId', (idx) =>
				idx.eq('userId', userId).eq('isActive', true)
			)
			.first();
		if (!active) return null;

		const dm = await ctx.db.get(active.decisionMakerId);
		if (!dm) return null;

		const districtCode =
			dm.jurisdiction && dm.district ? `${dm.jurisdiction}-${dm.district}` : null;

		return { districtCode };
	}
});

/**
 * Resolve the viewer-vs-author relation for the recipient page WITHOUT ever
 * returning the author's identity or district across the boundary. Guarded by
 * the shared internal secret, so it is callable only from trusted SvelteKit
 * server code (browsers cannot reach it). Returns only two non-identifying
 * facts:
 *   - viewerIsAuthor: the viewer authored this template
 *   - baseRateRelation: coarse same/diff/unknown of the viewer's vs the
 *     author's district, compared in-place and discarded — only the enum leaves.
 */
export const getViewerAuthorRelation = query({
	args: {
		slug: v.string(),
		viewerUserId: v.optional(v.id('users')),
		_secret: v.optional(v.string())
	},
	handler: async (ctx, { slug, viewerUserId, _secret }) => {
		requireInternalSecret(_secret);

		// Anonymous viewers can't be the author and have no district to compare, so the
		// result is always (false, "unknown"). Short-circuit before any DB work — most
		// recipient-page traffic is logged out, and this is a hot path.
		if (!viewerUserId) {
			return { viewerIsAuthor: false, baseRateRelation: 'unknown' as const };
		}

		const template = await ctx.db
			.query('templates')
			.withIndex('by_slug', (idx) => idx.eq('slug', slug))
			.first();
		if (!template || !template.userId) {
			return { viewerIsAuthor: false, baseRateRelation: 'unknown' as const };
		}

		const viewerIsAuthor = viewerUserId != null && viewerUserId === template.userId;
		// An author viewing their own template is not a recipient — exclude from the
		// base-rate signal (skips a redundant lookup and avoids inflating 'same').
		if (viewerIsAuthor) {
			return { viewerIsAuthor: true, baseRateRelation: 'unknown' as const };
		}

		const districtFor = async (uid: Id<'users'>): Promise<string | null> => {
			const rel = await ctx.db
				.query('userDmRelations')
				.withIndex('by_userId_isActive_decisionMakerId', (idx) =>
					idx.eq('userId', uid).eq('isActive', true)
				)
				.first();
			if (!rel) return null;
			const dm = await ctx.db.get(rel.decisionMakerId);
			return dm && dm.jurisdiction && dm.district ? `${dm.jurisdiction}-${dm.district}` : null;
		};

		const [authorDistrict, viewerDistrict] = await Promise.all([
			districtFor(template.userId),
			viewerUserId ? districtFor(viewerUserId) : Promise.resolve(null)
		]);

		let baseRateRelation: 'same' | 'diff' | 'unknown' = 'unknown';
		if (viewerDistrict != null && authorDistrict != null) {
			baseRateRelation = viewerDistrict === authorDistrict ? 'same' : 'diff';
		}

		return { viewerIsAuthor: false, baseRateRelation };
	}
});
