import { makeFunctionReference, type FunctionReference } from 'convex/server';
import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { blockEmailReservation } from './lib/planUsageReservations';

const SEALED_KEY_RETENTION_MS = 24 * 60 * 60 * 1000;
const CLEANUP_BATCH = 100;
type CleanupStatus = 'scheduled' | 'sending';

const cleanupStaleSealedKeysRef = makeFunctionReference<'mutation'>(
	'blastCleanup:cleanupStaleSealedKeys'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{
		cutoff?: number;
		status?: CleanupStatus;
		cursor?: string | null;
		limit?: number;
	},
	{
		cleaned: number;
		hasMore: boolean;
		cutoff: number;
		status: CleanupStatus;
	}
>;

/**
 * Clear one bounded page of TEE keys older than 24 hours, then continue from
 * the durable scheduler. The fixed cutoff is propagated to every page so a
 * large backlog drains to completion without chasing newly aging rows.
 */
export const cleanupStaleSealedKeys = internalMutation({
	args: {
		cutoff: v.optional(v.number()),
		status: v.optional(v.union(v.literal('scheduled'), v.literal('sending'))),
		cursor: v.optional(v.union(v.string(), v.null())),
		limit: v.optional(v.number())
	},
	returns: v.object({
		cleaned: v.number(),
		hasMore: v.boolean(),
		cutoff: v.number(),
		status: v.union(v.literal('scheduled'), v.literal('sending'))
	}),
	handler: async (ctx, args) => {
		const cutoff = args.cutoff ?? Date.now() - SEALED_KEY_RETENTION_MS;
		if (!Number.isFinite(cutoff)) {
			throw new Error('SEALED_KEY_CLEANUP_CUTOFF_INVALID');
		}
		const requestedLimit = args.limit ?? CLEANUP_BATCH;
		if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
			throw new Error('SEALED_KEY_CLEANUP_LIMIT_INVALID');
		}
		const limit = Math.min(requestedLimit, CLEANUP_BATCH);
		const status: CleanupStatus = args.status ?? 'scheduled';

		const page = await ctx.db
			.query('emailBlasts')
			.withIndex('by_status_updatedAt', (q) => q.eq('status', status).lt('updatedAt', cutoff))
			.paginate({ numItems: limit, cursor: args.cursor ?? null });

		const updatedAt = Date.now();
		let cleaned = 0;
		for (const blast of page.page) {
			if (!blast.sealedOrgKey) continue;
			if (status === 'sending') {
				if (blast.planUsageReservationId) {
					await blockEmailReservation(
						ctx,
						blast.planUsageReservationId,
						'TEE_OUTCOME_AMBIGUOUS_STALE_SEALED_KEY'
					);
				} else {
					await ctx.db.patch(blast.orgId, {
						emailReservationState: 'blocked',
						emailReservationFailureCode: 'TEE_LEGACY_OUTCOME_AMBIGUOUS',
						updatedAt
					});
				}
			}
			await ctx.db.patch(blast._id, {
				sealedOrgKey: undefined,
				status: status === 'sending' ? 'outcome_unknown' : 'failed',
				updatedAt
			});
			cleaned += 1;
		}

		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, cleanupStaleSealedKeysRef, {
				cutoff,
				status,
				cursor: page.continueCursor,
				limit
			});
		} else if (status === 'scheduled') {
			await ctx.scheduler.runAfter(0, cleanupStaleSealedKeysRef, {
				cutoff,
				status: 'sending',
				cursor: null,
				limit
			});
		}

		if (cleaned > 0) {
			console.log(`[cleanup-sealed-keys] Cleared ${cleaned} stale ${status} sealed keys`);
		}
		return {
			cleaned,
			hasMore: !page.isDone || status === 'scheduled',
			cutoff,
			status
		};
	}
});
