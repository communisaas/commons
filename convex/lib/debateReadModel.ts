import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { bumpPublicTemplatePageArtifactAggregateRevision } from './publicTemplateDiscoverySource';
import type { PublicDiscoveryListFreshnessClass } from './publicDiscovery';

export const DEBATE_READ_MODEL_VERSION = 1;
export const DEBATE_READ_MODEL_MIGRATION_KEY = 'v1';
export const DEBATE_ARGUMENT_BODY_PREVIEW_CHARS = 400;

function bodyPreview(body: string): string {
	return body.length <= DEBATE_ARGUMENT_BODY_PREVIEW_CHARS
		? body
		: `${body.slice(0, DEBATE_ARGUMENT_BODY_PREVIEW_CHARS - 1)}…`;
}

/** Refresh one bounded singleton after a debate or argument mutation. */
export async function syncDebateReadModel(
	ctx: MutationCtx,
	debateId: Id<'debates'>,
	now = Date.now(),
	freshnessClass: PublicDiscoveryListFreshnessClass = 'aggregate'
) {
	const debate = await ctx.db.get(debateId);
	if (!debate) throw new Error('DEBATE_NOT_FOUND');
	const [existing, top] = await Promise.all([
		ctx.db
			.query('debateReadModels')
			.withIndex('by_debateId', (q) => q.eq('debateId', debateId))
			.unique(),
		ctx.db
			.query('debateArguments')
			.withIndex('by_debateId_weightedScore', (q) => q.eq('debateId', debateId))
			.order('desc')
			.first()
	]);
	const projection = {
		debateId,
		templateId: debate.templateId,
		debateIdOnchain: debate.debateIdOnchain,
		version: DEBATE_READ_MODEL_VERSION,
		revision: (existing?.revision ?? 0) + 1,
		status: debate.status,
		argumentCount: debate.argumentCount,
		uniqueParticipants: debate.uniqueParticipants,
		totalStake: debate.totalStake,
		topArgument: top
			? {
					argumentId: top._id,
					argumentIndex: top.argumentIndex,
					stance: top.stance,
					bodyPreview: bodyPreview(top.body),
					weightedScore: top.weightedScore,
					totalStake: top.totalStake,
					coSignCount: top.coSignCount
				}
			: undefined,
		updatedAt: now
	};
	if (existing) await ctx.db.replace(existing._id, projection);
	else await ctx.db.insert('debateReadModels', projection);
	await bumpPublicTemplatePageArtifactAggregateRevision(
		ctx,
		debate.templateId,
		now,
		freshnessClass
	);
	return projection;
}

export async function requireDebateReadModelReady(ctx: QueryCtx): Promise<void> {
	const migration = await ctx.db
		.query('debateReadModelMigrations')
		.withIndex('by_key', (q) => q.eq('key', DEBATE_READ_MODEL_MIGRATION_KEY))
		.unique();
	if (migration?.status !== 'ready') {
		throw new Error(migration?.failureCode ?? 'DEBATE_READ_MODEL_NOT_READY');
	}
}
