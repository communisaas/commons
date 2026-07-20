import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export const SMS_REPLY_SUMMARY_VERSION = 1;
export const SMS_REPLY_SUMMARY_MIGRATION_KEY = 'sms-reply-summary-v1' as const;

export type SmsReplySummarySource = {
	orgId: Id<'organizations'>;
	supporterId?: Id<'supporters'>;
	blastId?: Id<'smsBlasts'>;
	receivedAt: number;
};

export async function getSmsReplySummaryMigration(ctx: QueryCtx | MutationCtx) {
	return await ctx.db
		.query('smsReplySummaryMigrations')
		.withIndex('by_key', (q) => q.eq('key', SMS_REPLY_SUMMARY_MIGRATION_KEY))
		.unique();
}

export async function recordSmsReply(
	ctx: MutationCtx,
	reply: SmsReplySummarySource,
	now: number
): Promise<void> {
	const current = await ctx.db
		.query('smsReplySummaries')
		.withIndex('by_orgId', (q) => q.eq('orgId', reply.orgId))
		.unique();
	if (current) {
		for (const count of [
			current.replyCount,
			current.matchedSupporterCount,
			current.linkedBlastCount
		]) {
			if (!Number.isSafeInteger(count) || count < 0 || count === Number.MAX_SAFE_INTEGER) {
				throw new Error('SMS_REPLY_SUMMARY_COUNT_INVARIANT');
			}
		}
		await ctx.db.patch(current._id, {
			replyCount: current.replyCount + 1,
			matchedSupporterCount: current.matchedSupporterCount + (reply.supporterId ? 1 : 0),
			linkedBlastCount: current.linkedBlastCount + (reply.blastId ? 1 : 0),
			latestReceivedAt: Math.max(current.latestReceivedAt ?? 0, reply.receivedAt),
			version: SMS_REPLY_SUMMARY_VERSION,
			updatedAt: now
		});
		return;
	}
	await ctx.db.insert('smsReplySummaries', {
		orgId: reply.orgId,
		replyCount: 1,
		matchedSupporterCount: reply.supporterId ? 1 : 0,
		linkedBlastCount: reply.blastId ? 1 : 0,
		latestReceivedAt: reply.receivedAt,
		version: SMS_REPLY_SUMMARY_VERSION,
		updatedAt: now
	});
}
