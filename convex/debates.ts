/**
 * Debate CRUD — queries, mutations, and actions.
 *
 * Debates are on-chain (DebateMarket on Scroll) with off-chain mirrors in Convex.
 * The spawnDebate action calls the blockchain, then writes to Convex via internal mutation.
 */

import {
	query,
	mutation,
	action,
	internalMutation,
	internalAction,
	internalQuery
} from './_generated/server';
import { internal } from './_generated/api';
import { makeFunctionReference } from 'convex/server';
import type { FunctionReference } from 'convex/server';
import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { ConvexError, v } from 'convex/values';
import { debateStatus as debateStatusV } from './_validators';
import { requireAuth } from './_authHelpers';
import { requireInternalSecret } from './_internalAuth';
import { hashTextToBytes32, offchainDebateId, offchainActionDomain } from './_actionDomain';
import {
	DEBATE_READ_MODEL_MIGRATION_KEY,
	requireDebateReadModelReady,
	syncDebateReadModel
} from './lib/debateReadModel';

declare const process: { env: Record<string, string | undefined> };

const insertDebateRef = makeFunctionReference<'mutation'>(
	'debates:insertDebate'
) as unknown as FunctionReference<'mutation', 'internal'>;
const getCallerTrustTierRef = makeFunctionReference<'query'>(
	'debates:_getCallerTrustTier'
) as unknown as FunctionReference<'query', 'internal', { tokenIdentifier: string }, number>;
const getCampaignEditorRoleRef = makeFunctionReference<'query'>(
	'debates:_getCampaignEditorRoleForCaller'
) as unknown as FunctionReference<
	'query',
	'internal',
	{ campaignId: Id<'campaigns'> },
	'owner' | 'editor' | 'member' | null
>;
// Re-imported here so the listPublic args validator can reference the
// closed union — declared inline because debates.ts already manages
// many makeFunctionReference helpers and centralizing imports keeps
// the top of file consistent.
const getExpiredDebatesRef = makeFunctionReference<'query'>(
	'debates:getExpiredDebates'
) as unknown as FunctionReference<
	'query',
	'internal',
	{ now: number; cursor?: string | null },
	{ data: Array<Doc<'debates'>>; cursor: string | null }
>;
const rateLimitCheckRef = makeFunctionReference<'mutation'>(
	'_rateLimit:check'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ key: string; windowMs: number; maxRequests: number },
	{ allowed: boolean }
>;

const DEBATE_ARGUMENT_PAGE_DEFAULT = 25;
const DEBATE_ARGUMENT_PAGE_MAX = 50;
export const PUBLIC_TEMPLATE_PAGE_DEBATE_BATCH_MAX = 4;
export const PUBLIC_TEMPLATE_PAGE_DEBATE_ARGUMENT_CAP = 25;
const DEBATE_ARGUMENT_BODY_MAX = 8_000;
const DEBATE_AMENDMENT_BODY_MAX = 4_000;
const DEBATE_STATUS_JUSTIFICATION_MAX = 2_000;
const DEBATE_AI_RESOLUTION_MAX_BYTES = 256 * 1024;

type DebateStatus = 'active' | 'resolving' | 'resolved' | 'awaiting_governance' | 'under_appeal';

const DEBATE_STATUS_TRANSITIONS: Record<DebateStatus, readonly DebateStatus[]> = {
	active: ['resolving', 'resolved', 'awaiting_governance'],
	resolving: ['resolved', 'awaiting_governance', 'under_appeal'],
	resolved: ['under_appeal'],
	awaiting_governance: ['resolved'],
	under_appeal: ['resolved']
};

type DebateArgumentStance = 'SUPPORT' | 'OPPOSE' | 'AMEND';

function argumentPageSize(limit: number | undefined): number {
	return Math.min(
		Math.max(Math.trunc(limit ?? DEBATE_ARGUMENT_PAGE_DEFAULT), 1),
		DEBATE_ARGUMENT_PAGE_MAX
	);
}

async function readArgumentPage(
	ctx: QueryCtx,
	debateId: Id<'debates'>,
	options: { stance?: DebateArgumentStance; cursor?: string | null; limit?: number }
) {
	if (options.cursor && options.cursor.length > 2_048) {
		throw new Error('DEBATE_CURSOR_INVALID');
	}
	if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1)) {
		throw new Error('DEBATE_PAGE_SIZE_INVALID');
	}
	const query = options.stance
		? ctx.db
				.query('debateArguments')
				.withIndex('by_debateId_stance_weightedScore', (q) =>
					q.eq('debateId', debateId).eq('stance', options.stance!)
				)
		: ctx.db
				.query('debateArguments')
				.withIndex('by_debateId_weightedScore', (q) => q.eq('debateId', debateId));
	return await query.order('desc').paginate({
		cursor: options.cursor ?? null,
		numItems: argumentPageSize(options.limit),
		maximumRowsRead: DEBATE_ARGUMENT_PAGE_MAX + 1,
		maximumBytesRead: 512 * 1024
	});
}

function publicArgument(arg: Awaited<ReturnType<typeof readArgumentPage>>['page'][number]) {
	return {
		_id: arg._id,
		_creationTime: arg._creationTime,
		argumentIndex: arg.argumentIndex,
		stance: arg.stance,
		body: arg.body,
		amendmentText: arg.amendmentText ?? null,
		stakeAmount: arg.stakeAmount,
		engagementTier: arg.engagementTier,
		weightedScore: arg.weightedScore,
		totalStake: arg.totalStake,
		coSignCount: arg.coSignCount < 5 ? null : arg.coSignCount,
		verificationStatus: arg.verificationStatus,
		currentPrice: arg.currentPrice ?? null,
		priceHistory: arg.priceHistory ?? null,
		positionCount: arg.positionCount < 5 ? null : arg.positionCount,
		aiScores: arg.aiScores ?? null,
		aiWeighted: arg.aiWeighted ?? null,
		finalScore: arg.finalScore ?? null,
		modelAgreement: arg.modelAgreement ?? null
	};
}

function publicTemplatePageArgument(
	arg: Awaited<ReturnType<typeof readArgumentPage>>['page'][number]
) {
	return {
		_id: arg._id,
		_creationTime: arg._creationTime,
		argumentIndex: arg.argumentIndex,
		stance: arg.stance,
		body: arg.body,
		amendmentText: arg.amendmentText ?? null,
		stakeAmount: arg.stakeAmount,
		engagementTier: arg.engagementTier,
		weightedScore: arg.weightedScore,
		totalStake: arg.totalStake,
		coSignCount: arg.coSignCount < 5 ? null : arg.coSignCount,
		aiScores: arg.aiScores ?? null,
		aiWeighted: arg.aiWeighted ?? null,
		finalScore: arg.finalScore ?? null,
		modelAgreement: arg.modelAgreement ?? null
	};
}

/**
 * Exhaustive public projection for the legacy `v.any()` resolution blob.
 * The materialization query must not transport model identities, scores,
 * transaction hashes, or provider diagnostics to the Pages producer merely
 * for the Worker to discard them afterward.
 */
function publicTemplatePageAiResolution(value: unknown) {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_AI_RESOLUTION_INVALID');
	}
	const raw = value as Record<string, unknown>;
	if (
		(raw.source !== undefined && (typeof raw.source !== 'string' || raw.source.length > 128)) ||
		(raw.evaluatedAt !== undefined &&
			(typeof raw.evaluatedAt !== 'string' || raw.evaluatedAt.length > 128)) ||
		(raw.minerCount !== undefined &&
			(!Number.isSafeInteger(raw.minerCount) || (raw.minerCount as number) < 0))
	) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_AI_RESOLUTION_INVALID');
	}
	const modelCount = Array.isArray(raw.models) ? Math.min(raw.models.length, 16) : undefined;
	const minerCount =
		raw.minerCount === undefined ? modelCount : (raw.minerCount as number | undefined);
	return {
		...(raw.source === undefined ? {} : { source: raw.source as string }),
		...(minerCount === undefined ? {} : { minerCount }),
		...(raw.evaluatedAt === undefined ? {} : { evaluatedAt: raw.evaluatedAt as string })
	};
}

async function readPublicTemplatePageDebateAfterReadiness(
	ctx: QueryCtx,
	templateId: Id<'templates'>
) {
	const model = await ctx.db
		.query('debateReadModels')
		.withIndex('by_templateId', (idx) => idx.eq('templateId', templateId))
		.order('desc')
		.first();
	const debate = model ? await ctx.db.get(model.debateId) : null;
	if (!debate) return null;
	const page = await readArgumentPage(ctx, debate._id, {
		limit: PUBLIC_TEMPLATE_PAGE_DEBATE_ARGUMENT_CAP
	});
	return {
		_id: debate._id,
		_creationTime: debate._creationTime,
		templateId: debate.templateId,
		debateIdOnchain: debate.debateIdOnchain,
		actionDomain: debate.actionDomain,
		propositionText: debate.propositionText,
		propositionHash: debate.propositionHash,
		deadline: debate.deadline,
		jurisdictionSize: debate.jurisdictionSize,
		status: debate.status,
		argumentCount: debate.argumentCount < 5 ? null : debate.argumentCount,
		uniqueParticipants: debate.uniqueParticipants < 5 ? null : debate.uniqueParticipants,
		totalStake: debate.totalStake,
		winningStance: debate.winningStance ?? null,
		winningArgumentIndex: debate.winningArgumentIndex ?? null,
		resolvedAt: debate.resolvedAt ?? null,
		resolutionMethod: debate.resolutionMethod ?? null,
		aiResolution: publicTemplatePageAiResolution(debate.aiResolution),
		aiSignatureCount: debate.aiSignatureCount ?? null,
		appealDeadline: debate.appealDeadline ?? null,
		governanceJustification: debate.governanceJustification ?? null,
		arguments: page.page.map(publicTemplatePageArgument)
	};
}

/**
 * Producer-only bounded join for anonymous page artifacts. A single migration
 * readiness read covers the whole four-template inventory page; every debate
 * then costs one exact read-model lookup, one document get, and at most 25
 * indexed argument rows.
 */
export async function readPublicTemplatePageDebatesBatch(
	ctx: QueryCtx,
	templateIds: readonly Id<'templates'>[]
) {
	if (templateIds.length > PUBLIC_TEMPLATE_PAGE_DEBATE_BATCH_MAX) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_DEBATE_BATCH_TOO_LARGE');
	}
	await requireDebateReadModelReady(ctx);
	return await Promise.all(
		templateIds.map((templateId) => readPublicTemplatePageDebateAfterReadiness(ctx, templateId))
	);
}

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Get the active debate for a template.
 */
export const getByTemplateId = query({
	args: {
		_secret: v.string(),
		templateId: v.id('templates')
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const debate = await ctx.db
			.query('debates')
			.withIndex('by_templateId_status', (idx) =>
				idx.eq('templateId', args.templateId).eq('status', 'active')
			)
			.unique();

		if (!debate) return null;

		return {
			_id: debate._id,
			_creationTime: debate._creationTime,
			templateId: debate.templateId,
			debateIdOnchain: debate.debateIdOnchain,
			actionDomain: debate.actionDomain,
			propositionText: debate.propositionText,
			propositionHash: debate.propositionHash,
			deadline: debate.deadline,
			jurisdictionSize: debate.jurisdictionSize,
			status: debate.status,
			argumentCount: debate.argumentCount < 5 ? null : debate.argumentCount,
			uniqueParticipants: debate.uniqueParticipants < 5 ? null : debate.uniqueParticipants,
			totalStake: debate.totalStake,
			winningStance: debate.winningStance ?? null,
			winningArgumentIndex: debate.winningArgumentIndex ?? null,
			resolvedAt: debate.resolvedAt ?? null,
			resolutionMethod: debate.resolutionMethod ?? null,
			aiPanelConsensus: debate.aiPanelConsensus ?? null,
			marketStatus: debate.marketStatus,
			currentPrices: debate.currentPrices ?? null,
			currentEpoch: debate.currentEpoch,
			updatedAt: debate.updatedAt
		};
	}
});

/**
 * Get a single debate by ID.
 */
export const get = query({
	args: {
		_secret: v.string(),
		debateId: v.id('debates')
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const debate = await ctx.db.get(args.debateId);
		if (!debate) throw new Error('Debate not found');

		return {
			_id: debate._id,
			_creationTime: debate._creationTime,
			templateId: debate.templateId,
			debateIdOnchain: debate.debateIdOnchain,
			actionDomain: debate.actionDomain,
			propositionText: debate.propositionText,
			propositionHash: debate.propositionHash,
			deadline: debate.deadline,
			jurisdictionSize: debate.jurisdictionSize,
			status: debate.status,
			argumentCount: debate.argumentCount < 5 ? null : debate.argumentCount,
			uniqueParticipants: debate.uniqueParticipants < 5 ? null : debate.uniqueParticipants,
			totalStake: debate.totalStake,
			winningStance: debate.winningStance ?? null,
			winningArgumentIndex: debate.winningArgumentIndex ?? null,
			resolvedAt: debate.resolvedAt ?? null,
			resolvedFromChain: debate.resolvedFromChain,
			resolutionMethod: debate.resolutionMethod ?? null,
			aiResolution: debate.aiResolution ?? null,
			aiSignatureCount: debate.aiSignatureCount ?? null,
			aiPanelConsensus: debate.aiPanelConsensus ?? null,
			appealDeadline: debate.appealDeadline ?? null,
			governanceJustification: debate.governanceJustification ?? null,
			proposerAddress: debate.proposerAddress,
			proposerBond: debate.proposerBond,
			txHash: debate.txHash ?? null,
			marketStatus: debate.marketStatus,
			marketLiquidity: debate.marketLiquidity ?? null,
			currentPrices: debate.currentPrices ?? null,
			currentEpoch: debate.currentEpoch,
			tradeDeadline: debate.tradeDeadline ?? null,
			resolutionDeadline: debate.resolutionDeadline ?? null,
			updatedAt: debate.updatedAt
		};
	}
});

/**
 * List arguments for a debate, sorted by weighted score descending.
 */
export const listArguments = query({
	args: {
		_secret: v.string(),
		debateId: v.id('debates'),
		stance: v.optional(v.union(v.literal('SUPPORT'), v.literal('OPPOSE'), v.literal('AMEND'))),
		limit: v.optional(v.number()),
		cursor: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		await requireDebateReadModelReady(ctx);
		const debate = await ctx.db.get(args.debateId);
		if (!debate) throw new Error('Debate not found');

		const page = await readArgumentPage(ctx, args.debateId, {
			stance: args.stance,
			cursor: args.cursor,
			limit: args.limit
		});

		return {
			proposition: debate.propositionText,
			arguments: page.page.map(publicArgument),
			cursor: page.isDone ? null : page.continueCursor,
			hasMore: !page.isDone
		};
	}
});

/** Exact one-row lookup for trusted resolution flows; never enumerate pages. */
export const getArgumentByIndexForSsr = query({
	args: {
		_secret: v.string(),
		debateId: v.id('debates'),
		argumentIndex: v.number()
	},
	handler: async (ctx, { _secret, debateId, argumentIndex }) => {
		requireInternalSecret(_secret);
		if (!Number.isSafeInteger(argumentIndex) || argumentIndex < 0) return null;
		const argument = await ctx.db
			.query('debateArguments')
			.withIndex('by_debateId_argumentIndex', (q) =>
				q.eq('debateId', debateId).eq('argumentIndex', argumentIndex)
			)
			.unique();
		return argument ? publicArgument(argument) : null;
	}
});

/**
 * Public debate detail by ID with arguments. No auth required.
 * Returns debate fields + arguments sorted by weightedScore desc.
 * Strips internal fields (proposerAddress, proposerBond, txHash, market internals).
 * Used by: src/routes/s/[slug]/debate/[debateId]/+page.server.ts
 */
export const getPublicDetail = query({
	args: {
		_secret: v.string(),
		identifier: v.string(),
		cursor: v.optional(v.union(v.string(), v.null())),
		limit: v.optional(v.number())
	},
	handler: async (ctx, { _secret, identifier, cursor, limit }) => {
		requireInternalSecret(_secret);
		if (identifier.length === 0 || identifier.length > 256) return null;
		if (cursor && cursor.length > 2_048) throw new Error('DEBATE_CURSOR_INVALID');
		await requireDebateReadModelReady(ctx);

		// Forward lookup by `debateIdOnchain` first; falls back to direct Convex
		// doc id. The canonical public form is `debateIdOnchain` for both real
		// on-chain debates (bytes32) and off-chain placeholders (`offchain-*`),
		// since both are stable identifiers external to storage.
		const projection = await ctx.db
			.query('debateReadModels')
			.withIndex('by_debateIdOnchain', (idx) => idx.eq('debateIdOnchain', identifier))
			.first();
		let debate = projection ? await ctx.db.get(projection.debateId) : null;
		if (!debate) {
			try {
				debate = await ctx.db.get(identifier as Id<'debates'>);
			} catch {
				debate = null;
			}
		}
		if (!debate) return null;
		const debateId = debate._id;
		const canonicalDebateId = debate.debateIdOnchain;

		const page = await readArgumentPage(ctx, debateId, { cursor, limit });

		return {
			_id: debate._id,
			_creationTime: debate._creationTime,
			canonicalDebateId,
			templateId: debate.templateId,
			debateIdOnchain: debate.debateIdOnchain,
			actionDomain: debate.actionDomain,
			propositionText: debate.propositionText,
			propositionHash: debate.propositionHash,
			deadline: debate.deadline,
			jurisdictionSize: debate.jurisdictionSize,
			status: debate.status,
			argumentCount: debate.argumentCount < 5 ? null : debate.argumentCount,
			uniqueParticipants: debate.uniqueParticipants < 5 ? null : debate.uniqueParticipants,
			totalStake: debate.totalStake,
			winningStance: debate.winningStance ?? null,
			winningArgumentIndex: debate.winningArgumentIndex ?? null,
			resolvedAt: debate.resolvedAt ?? null,
			resolutionMethod: debate.resolutionMethod ?? null,
			aiResolution: debate.aiResolution ?? null,
			aiSignatureCount: debate.aiSignatureCount ?? null,
			aiPanelConsensus: debate.aiPanelConsensus ?? null,
			appealDeadline: debate.appealDeadline ?? null,
			governanceJustification: debate.governanceJustification ?? null,
			updatedAt: debate.updatedAt,
			arguments: page.page.map(publicArgument),
			argumentCursor: page.isDone ? null : page.continueCursor,
			hasMoreArguments: !page.isDone
		};
	}
});

/**
 * Public deliberation index — paginates debates by status with the
 * accompanying template handle. Active sorts soonest-deadline-first; resolved
 * sorts latest-deadline-first via the `by_status_deadline` index. Sorting
 * resolved debates by `resolvedAt` would be more accurate (a debate that
 * lapses past its deadline before resolving belongs at the top of the
 * resolved list, not buried by deadline order) and is a follow-up dependent
 * on a `by_status_resolvedAt` index.
 */
export const listPublic = query({
	args: {
		_secret: v.string(),
		status: v.optional(debateStatusV),
		cursor: v.optional(v.union(v.string(), v.null())),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const status = args.status ?? 'active';
		if (args.cursor && args.cursor.length > 2_048) {
			throw new Error('DEBATE_CURSOR_INVALID');
		}
		if (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || args.limit < 1)) {
			throw new Error('DEBATE_PAGE_SIZE_INVALID');
		}
		const limit = Math.min(args.limit ?? 20, 50);

		const orderDir: 'asc' | 'desc' = status === 'active' ? 'asc' : 'desc';
		const page = await ctx.db
			.query('debates')
			.withIndex('by_status_deadline', (idx) => idx.eq('status', status))
			.order(orderDir)
			.paginate({
				numItems: limit,
				cursor: args.cursor ?? null,
				maximumRowsRead: limit + 1,
				maximumBytesRead: 2 * 1024 * 1024
			});

		const enriched = await Promise.all(
			page.page.map(async (debate) => {
				const template = await ctx.db.get(debate.templateId);
				return {
					_id: debate._id,
					debateIdOnchain: debate.debateIdOnchain,
					propositionText: debate.propositionText,
					propositionHash: debate.propositionHash,
					status: debate.status,
					deadline: debate.deadline,
					argumentCount: debate.argumentCount < 5 ? null : debate.argumentCount,
					uniqueParticipants: debate.uniqueParticipants < 5 ? null : debate.uniqueParticipants,
					totalStake: debate.totalStake,
					winningStance: debate.winningStance ?? null,
					resolvedAt: debate.resolvedAt ?? null,
					resolutionMethod: debate.resolutionMethod ?? null,
					updatedAt: debate.updatedAt,
					template: template
						? {
								_id: template._id,
								slug: template.slug,
								title: template.title
							}
						: null
				};
			})
		);

		return {
			data: enriched,
			cursor: page.continueCursor,
			hasMore: !page.isDone
		};
	}
});

/**
 * Get the full debate (with arguments) for a template.
 * Used by s/[slug]/+page.server.ts — returns debate + arguments sorted by weightedScore desc.
 * Unlike getByTemplateId which returns debate only, this includes the full argument list.
 */
export const getFullByTemplateId = query({
	args: {
		_secret: v.string(),
		templateId: v.id('templates'),
		cursor: v.optional(v.union(v.string(), v.null())),
		limit: v.optional(v.number())
	},
	handler: async (ctx, { _secret, templateId, cursor, limit }) => {
		requireInternalSecret(_secret);
		if (cursor && cursor.length > 2_048) throw new Error('DEBATE_CURSOR_INVALID');
		await requireDebateReadModelReady(ctx);
		const model = await ctx.db
			.query('debateReadModels')
			.withIndex('by_templateId', (idx) => idx.eq('templateId', templateId))
			.order('desc')
			.first();
		const debate = model ? await ctx.db.get(model.debateId) : null;
		if (!debate) return null;
		const page = await readArgumentPage(ctx, debate._id, { cursor, limit });

		return {
			_id: debate._id,
			_creationTime: debate._creationTime,
			templateId: debate.templateId,
			debateIdOnchain: debate.debateIdOnchain,
			actionDomain: debate.actionDomain,
			propositionText: debate.propositionText,
			propositionHash: debate.propositionHash,
			deadline: debate.deadline,
			jurisdictionSize: debate.jurisdictionSize,
			status: debate.status,
			argumentCount: debate.argumentCount < 5 ? null : debate.argumentCount,
			uniqueParticipants: debate.uniqueParticipants < 5 ? null : debate.uniqueParticipants,
			totalStake: debate.totalStake,
			winningStance: debate.winningStance ?? null,
			winningArgumentIndex: debate.winningArgumentIndex ?? null,
			resolvedAt: debate.resolvedAt ?? null,
			resolutionMethod: debate.resolutionMethod ?? null,
			aiResolution: debate.aiResolution ?? null,
			aiSignatureCount: debate.aiSignatureCount ?? null,
			aiPanelConsensus: debate.aiPanelConsensus ?? null,
			appealDeadline: debate.appealDeadline ?? null,
			governanceJustification: debate.governanceJustification ?? null,
			updatedAt: debate.updatedAt,
			arguments: page.page.map(publicArgument),
			argumentCursor: page.isDone ? null : page.continueCursor,
			hasMoreArguments: !page.isDone
		};
	}
});

/** Secret-gated SSR composite; one debate singleton plus one bounded argument page. */
export const getFullByTemplateIdForSsr = query({
	args: {
		_secret: v.string(),
		templateId: v.id('templates'),
		cursor: v.optional(v.union(v.string(), v.null())),
		limit: v.optional(v.number())
	},
	handler: async (ctx, { _secret, templateId, cursor, limit }) => {
		requireInternalSecret(_secret);
		if (cursor && cursor.length > 2_048) throw new Error('DEBATE_CURSOR_INVALID');
		await requireDebateReadModelReady(ctx);
		const model = await ctx.db
			.query('debateReadModels')
			.withIndex('by_templateId', (idx) => idx.eq('templateId', templateId))
			.order('desc')
			.first();
		const debate = model ? await ctx.db.get(model.debateId) : null;
		if (!debate) return null;
		const page = await readArgumentPage(ctx, debate._id, { cursor, limit });
		return {
			_id: debate._id,
			_creationTime: debate._creationTime,
			templateId: debate.templateId,
			debateIdOnchain: debate.debateIdOnchain,
			actionDomain: debate.actionDomain,
			propositionText: debate.propositionText,
			propositionHash: debate.propositionHash,
			deadline: debate.deadline,
			jurisdictionSize: debate.jurisdictionSize,
			status: debate.status,
			argumentCount: debate.argumentCount < 5 ? null : debate.argumentCount,
			uniqueParticipants: debate.uniqueParticipants < 5 ? null : debate.uniqueParticipants,
			totalStake: debate.totalStake,
			winningStance: debate.winningStance ?? null,
			winningArgumentIndex: debate.winningArgumentIndex ?? null,
			resolvedAt: debate.resolvedAt ?? null,
			resolutionMethod: debate.resolutionMethod ?? null,
			aiResolution: debate.aiResolution ?? null,
			aiSignatureCount: debate.aiSignatureCount ?? null,
			aiPanelConsensus: debate.aiPanelConsensus ?? null,
			appealDeadline: debate.appealDeadline ?? null,
			governanceJustification: debate.governanceJustification ?? null,
			updatedAt: debate.updatedAt,
			arguments: page.page.map(publicArgument),
			argumentCursor: page.isDone ? null : page.continueCursor,
			hasMoreArguments: !page.isDone
		};
	}
});

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Submit a new argument to an active debate.
 */
export const createArgument = mutation({
	args: {
		_secret: v.string(),
		debateId: v.id('debates'),
		stance: v.union(v.literal('SUPPORT'), v.literal('OPPOSE'), v.literal('AMEND')),
		body: v.string(),
		bodyHash: v.string(),
		amendmentText: v.optional(v.string()),
		amendmentHash: v.optional(v.string()),
		nullifierHash: v.optional(v.string()),
		stakeAmount: v.number(),
		txHash: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const { userId } = await requireAuth(ctx);

		const debate = await ctx.db.get(args.debateId);
		if (!debate) throw new Error('Debate not found');
		if (debate.status !== 'active') throw new Error('Debate is not active');
		if (Date.now() > debate.deadline) throw new Error('Debate deadline has passed');

		if (!['SUPPORT', 'OPPOSE', 'AMEND'].includes(args.stance)) {
			throw new Error('stance must be SUPPORT, OPPOSE, or AMEND');
		}
		if (args.body.length < 20) {
			throw new Error('Argument body must be at least 20 characters');
		}
		if (args.body.length > DEBATE_ARGUMENT_BODY_MAX) {
			throw new Error('Argument body is too large');
		}
		if (args.amendmentText !== undefined && args.amendmentText.length > DEBATE_AMENDMENT_BODY_MAX) {
			throw new Error('Amendment text is too large');
		}
		if (args.stance === 'AMEND' && (args.amendmentText?.length ?? 0) < 5) {
			throw new Error('Amendment text is required for AMEND stance');
		}
		if (args.bodyHash.length > 128 || (args.amendmentHash?.length ?? 0) > 128) {
			throw new Error('Argument hash is invalid');
		}
		if (
			!args.nullifierHash ||
			args.nullifierHash.length > 256 ||
			(args.txHash?.length ?? 0) > 128
		) {
			throw new Error('Argument proof reference is invalid');
		}
		if (!Number.isFinite(args.stakeAmount) || args.stakeAmount <= 0) {
			throw new Error('Stake amount is invalid');
		}

		// Nullifier dedup
		if (args.nullifierHash) {
			const existing = await ctx.db
				.query('debateNullifiers')
				.withIndex('by_debateId_nullifierHash', (idx) =>
					idx.eq('debateId', args.debateId).eq('nullifierHash', args.nullifierHash!)
				)
				.first();
			if (existing) {
				throw new Error('You have already submitted an argument to this debate');
			}
		}

		// Server-side: look up user's trust tier (never trust client-provided tier)
		const user = await ctx.db.get(userId);
		const engagementTier = user?.trustTier ?? 0;
		if (engagementTier < 3) throw new Error('Tier 3+ verification required');

		// TODO: on-chain stake verification not yet wired; cap client-provided stakeAmount for now.
		const MAX_STAKE = 1_000_000; // $1 in micro-units
		const stakeAmount = Math.min(Math.max(0, args.stakeAmount), MAX_STAKE);

		// Compute weighted score: sqrt(stake/1e6) * 2^tier * 1e6
		const stakeInDollars = stakeAmount / 1e6;
		const tier = Math.max(0, Math.min(engagementTier, 4));
		const weightedScore = Math.floor(Math.sqrt(stakeInDollars) * Math.pow(2, tier) * 1e6);

		const argumentIndex = debate.argumentCount;

		const argId = await ctx.db.insert('debateArguments', {
			debateId: args.debateId,
			argumentIndex,
			stance: args.stance,
			body: args.body,
			bodyHash: args.bodyHash,
			amendmentText: args.amendmentText,
			amendmentHash: args.amendmentHash,
			nullifierHash: args.nullifierHash,
			stakeAmount,
			engagementTier: tier,
			weightedScore,
			totalStake: stakeAmount,
			coSignCount: 0,
			positionCount: 0,
			verificationStatus: 'pending'
		});

		// Record nullifier
		if (args.nullifierHash) {
			await ctx.db.insert('debateNullifiers', {
				debateId: args.debateId,
				nullifierHash: args.nullifierHash,
				actionType: 'argument',
				verificationStatus: 'pending',
				argumentId: argId,
				txHash: args.txHash
			});
		}

		// Update debate counters
		await ctx.db.patch(args.debateId, {
			argumentCount: debate.argumentCount + 1,
			uniqueParticipants: debate.uniqueParticipants + 1,
			totalStake: debate.totalStake + stakeAmount,
			updatedAt: Date.now()
		});
		await syncDebateReadModel(ctx, args.debateId, Date.now(), 'aggregate');

		return argId;
	}
});

/**
 * Co-sign an existing argument.
 */
export const cosign = mutation({
	args: {
		_secret: v.string(),
		debateId: v.id('debates'),
		argumentIndex: v.number(),
		stakeAmount: v.number(),
		nullifierHash: v.string(),
		txHash: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const { userId } = await requireAuth(ctx);

		const debate = await ctx.db.get(args.debateId);
		if (!debate) throw new Error('Debate not found');
		if (debate.status !== 'active') throw new Error('Debate is not active');
		if (Date.now() > debate.deadline) throw new Error('Debate deadline has passed');
		if (!Number.isSafeInteger(args.argumentIndex) || args.argumentIndex < 0) {
			throw new Error('Argument index is invalid');
		}
		if (
			!Number.isFinite(args.stakeAmount) ||
			args.stakeAmount <= 0 ||
			args.nullifierHash.length === 0 ||
			args.nullifierHash.length > 256 ||
			(args.txHash?.length ?? 0) > 128
		) {
			throw new Error('Co-sign proof reference is invalid');
		}

		// Nullifier dedup — cross-action (arguments + cosigns)
		const existingNullifier = await ctx.db
			.query('debateNullifiers')
			.withIndex('by_debateId_nullifierHash', (idx) =>
				idx.eq('debateId', args.debateId).eq('nullifierHash', args.nullifierHash)
			)
			.first();
		if (existingNullifier) {
			throw new Error('You have already participated in this debate');
		}

		// Find the argument
		const argument = await ctx.db
			.query('debateArguments')
			.withIndex('by_debateId_argumentIndex', (idx) =>
				idx.eq('debateId', args.debateId).eq('argumentIndex', args.argumentIndex)
			)
			.first();
		if (!argument) throw new Error('Argument not found');

		// Server-side: look up user's trust tier (never trust client-provided tier)
		const user = await ctx.db.get(userId);
		const engagementTier = user?.trustTier ?? 0;
		if (engagementTier < 3) throw new Error('Tier 3+ verification required');

		// TODO: on-chain stake verification not yet wired; cap client-provided stakeAmount for now.
		const MAX_STAKE = 1_000_000; // $1 in micro-units
		const stakeAmount = Math.min(Math.max(0, args.stakeAmount), MAX_STAKE);

		const tier = Math.max(0, Math.min(engagementTier, 4));
		const cosignWeight = Math.floor(Math.sqrt(stakeAmount / 1e6) * Math.pow(2, tier) * 1e6);

		// Update argument
		await ctx.db.patch(argument._id, {
			coSignCount: argument.coSignCount + 1,
			totalStake: argument.totalStake + stakeAmount,
			weightedScore: argument.weightedScore + cosignWeight
		});

		// Record nullifier
		await ctx.db.insert('debateNullifiers', {
			debateId: args.debateId,
			nullifierHash: args.nullifierHash,
			actionType: 'cosign',
			verificationStatus: 'pending',
			cosignWeight: cosignWeight,
			argumentId: argument._id,
			txHash: args.txHash
		});

		// Update debate counters
		await ctx.db.patch(args.debateId, {
			uniqueParticipants: debate.uniqueParticipants + 1,
			totalStake: debate.totalStake + stakeAmount,
			updatedAt: Date.now()
		});
		await syncDebateReadModel(ctx, args.debateId, Date.now(), 'aggregate');

		return { success: true };
	}
});

/**
 * Update debate status (resolution, governance, appeal transitions).
 */
export const updateStatus = mutation({
	args: {
		_secret: v.string(),
		debateId: v.id('debates'),
		/** Exact state observed by the caller; makes every transition a CAS. */
		expectedStatus: debateStatusV,
		status: debateStatusV,
		winningStance: v.optional(v.string()),
		winningArgumentIndex: v.optional(v.number()),
		resolutionMethod: v.optional(v.string()),
		aiResolution: v.optional(v.any()),
		aiSignatureCount: v.optional(v.number()),
		aiPanelConsensus: v.optional(v.float64()),
		governanceJustification: v.optional(v.string()),
		appealDeadline: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);

		const debate = await ctx.db.get(args.debateId);
		if (!debate) throw new Error('Debate not found');
		if (debate.status !== args.expectedStatus) {
			throw new ConvexError({
				code: 'DEBATE_STATUS_CONFLICT',
				expectedStatus: args.expectedStatus,
				actualStatus: debate.status
			});
		}
		if (!DEBATE_STATUS_TRANSITIONS[args.expectedStatus].includes(args.status)) {
			throw new ConvexError({
				code: 'DEBATE_STATUS_TRANSITION_INVALID',
				from: args.expectedStatus,
				to: args.status
			});
		}

		// Defense-in-depth for org-tied debates: when the caller carries a user
		// identity (the resolve/settle user-session routes) require org
		// editor/owner. The operator CRON routes carry no identity and are gated
		// by CRON_SECRET plus the internal secret above.
		if (debate.templateId) {
			const template = await ctx.db.get(debate.templateId);
			const templateOrgId = template?.orgId;
			if (templateOrgId) {
				const identity = await ctx.auth.getUserIdentity();
				if (identity) {
					const { userId } = await requireAuth(ctx);
					const membership = await ctx.db
						.query('orgMemberships')
						.withIndex('by_userId_orgId', (q) => q.eq('userId', userId).eq('orgId', templateOrgId))
						.unique();
					if (!membership || (membership.role !== 'owner' && membership.role !== 'editor')) {
						throw new Error('Only org editors/owners can change debate status');
					}
				}
			}
		}

		if (
			args.winningStance !== undefined &&
			!['SUPPORT', 'OPPOSE', 'AMEND'].includes(args.winningStance)
		) {
			throw new Error('DEBATE_WINNING_STANCE_INVALID');
		}
		if (
			args.winningArgumentIndex !== undefined &&
			(!Number.isSafeInteger(args.winningArgumentIndex) || args.winningArgumentIndex < 0)
		) {
			throw new Error('DEBATE_WINNING_ARGUMENT_INDEX_INVALID');
		}
		if (args.resolutionMethod !== undefined && args.resolutionMethod.length > 64) {
			throw new Error('DEBATE_RESOLUTION_METHOD_TOO_LARGE');
		}
		if (
			args.governanceJustification !== undefined &&
			(args.governanceJustification.length > DEBATE_STATUS_JUSTIFICATION_MAX ||
				!args.governanceJustification.trim())
		) {
			throw new Error('DEBATE_GOVERNANCE_JUSTIFICATION_INVALID');
		}
		if (
			args.aiSignatureCount !== undefined &&
			(!Number.isSafeInteger(args.aiSignatureCount) ||
				args.aiSignatureCount < 0 ||
				args.aiSignatureCount > 100)
		) {
			throw new Error('DEBATE_AI_SIGNATURE_COUNT_INVALID');
		}
		if (
			args.aiPanelConsensus !== undefined &&
			(!Number.isFinite(args.aiPanelConsensus) ||
				args.aiPanelConsensus < 0 ||
				args.aiPanelConsensus > 1)
		) {
			throw new Error('DEBATE_AI_PANEL_CONSENSUS_INVALID');
		}
		if (
			args.appealDeadline !== undefined &&
			(!Number.isSafeInteger(args.appealDeadline) || args.appealDeadline < 0)
		) {
			throw new Error('DEBATE_APPEAL_DEADLINE_INVALID');
		}
		if (args.aiResolution !== undefined) {
			let encoded: string;
			try {
				encoded = JSON.stringify(args.aiResolution);
			} catch {
				throw new Error('DEBATE_AI_RESOLUTION_INVALID');
			}
			if (new TextEncoder().encode(encoded).byteLength > DEBATE_AI_RESOLUTION_MAX_BYTES) {
				throw new Error('DEBATE_AI_RESOLUTION_TOO_LARGE');
			}
		}

		const patch: Record<string, unknown> = {
			status: args.status,
			updatedAt: Date.now()
		};

		if (args.status === 'resolved') {
			patch.resolvedAt = Date.now();
		}
		if (args.winningStance !== undefined) patch.winningStance = args.winningStance;
		if (args.winningArgumentIndex !== undefined)
			patch.winningArgumentIndex = args.winningArgumentIndex;
		if (args.resolutionMethod !== undefined) patch.resolutionMethod = args.resolutionMethod;
		if (args.aiResolution !== undefined) patch.aiResolution = args.aiResolution;
		if (args.aiSignatureCount !== undefined) patch.aiSignatureCount = args.aiSignatureCount;
		if (args.aiPanelConsensus !== undefined) patch.aiPanelConsensus = args.aiPanelConsensus;
		if (args.governanceJustification !== undefined)
			patch.governanceJustification = args.governanceJustification;
		if (args.appealDeadline !== undefined) patch.appealDeadline = args.appealDeadline;

		await ctx.db.patch(args.debateId, patch);
		await syncDebateReadModel(ctx, args.debateId, Date.now(), 'discreteStatus');
		return { success: true };
	}
});

// =============================================================================
// ACTIONS (external blockchain calls)
// =============================================================================

/**
 * Create a new debate — calls blockchain, then writes to Convex.
 * In local dev without blockchain config, falls back to off-chain-only mode.
 */
export const spawnDebate = action({
	args: {
		templateId: v.id('templates'),
		propositionText: v.string(),
		bondAmount: v.optional(v.number()),
		duration: v.optional(v.number()),
		jurisdictionSizeHint: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error('Not authenticated');

		// Mirror the tier-3 gate that the SvelteKit route enforces at
		// src/routes/api/debates/create/+server.ts:34. Pre-fix, this public
		// action accepted authenticated-only callers — any client wired
		// directly to Convex (e.g., the JS SDK) could spawn debates while
		// bypassing the HTTP-route gate. Both entry points now have the
		// same authorization posture: tier-3+ (mDL or higher) required.
		// identity.tokenIdentifier is non-optional in Convex's UserIdentity
		// type. The pre-existing `?? identity.subject` fallback was dead AND
		// misleading — users.tokenIdentifier is stored as `${ISSUER}|${userId}`
		// (authOps.ts:167,266), not the bare JWT sub. Drop the fallback so the
		// code reads as honestly as it executes.
		const callerTier = await ctx.runQuery(getCallerTrustTierRef, {
			tokenIdentifier: identity.tokenIdentifier
		});
		if (callerTier < 3) {
			throw new Error('DEBATE_SPAWN_REQUIRES_TIER_3');
		}

		if (!args.propositionText || args.propositionText.length < 10) {
			throw new Error('propositionText must be at least 10 characters');
		}
		if (args.propositionText.length > 4000) {
			throw new Error('propositionText must be 4000 characters or fewer');
		}

		// Rate-limit per-user to 5 debate spawns per hour. The canonical
		// product flow has an ON-CHAIN bond + deriveDomain step (see
		// comment below); off-chain placeholder mode currently has no
		// bond, so an authenticated user could spawn unlimited debates on
		// any template — debate-list spam + reputation pollution. The rate
		// limit is the pre-on-chain-wiring stopgap; when proposeDebate()
		// moves on-chain the bond becomes the natural rate limiter and this
		// gate can be relaxed. Key includes identity.subject so spammers
		// can't rotate templates to amplify; max 5 per hour is generous
		// for legitimate use (one debate per major topic per day) but
		// caps spam at one digit.
		const rlKey = `debates.spawnDebate:${identity.subject}`;
		const rl = await ctx.runMutation(rateLimitCheckRef, {
			key: rlKey,
			windowMs: 60 * 60 * 1000,
			maxRequests: 5
		});
		if (!rl.allowed) {
			throw new Error('Debate spawn rate limit exceeded — try again in an hour');
		}

		// In this action we would call the on-chain proposeDebate() and deriveDomain().
		// For now, generate off-chain IDs (blockchain integration is wired separately).
		const durationSeconds = args.duration ?? 7 * 24 * 60 * 60;
		const bond = args.bondAmount ?? 1_000_000;
		const jurisdictionSize = args.jurisdictionSizeHint ?? 100;

		// Off-chain identifiers must conform to the same 0x-prefixed
		// 32-byte format the downstream ZK proof pipeline validates
		// (`isValidActionDomain` at src/lib/core/zkp/action-domain-builder.ts:372,
		// `buildDebateActionDomain` propositionHash regex at :311). The
		// previous human-readable strings (`offchain-...`, `domain-...`,
		// `hash-...`) crashed any consumer that ran proof generation
		// against an off-chain debate. The helpers in `./_actionDomain`
		// use Web Crypto SHA-256 (Convex V8 lacks keccak) to produce
		// format-valid placeholders; values are not on-chain-verifiable
		// and the contract verifier will reject them — by design for the
		// off-chain branch.
		const timestamp = Math.floor(Date.now() / 1000);
		const propositionHash = await hashTextToBytes32(args.propositionText);
		const debateIdOnchain = await offchainDebateId(propositionHash, timestamp);
		const actionDomain = await offchainActionDomain(debateIdOnchain, propositionHash);

		const deadline = Date.now() + durationSeconds * 1000;

		const debateId = await ctx.runMutation(insertDebateRef, {
			templateId: args.templateId,
			debateIdOnchain,
			actionDomain,
			propositionHash,
			propositionText: args.propositionText,
			deadline,
			jurisdictionSize,
			proposerAddress: '0x0000000000000000000000000000000000000000',
			proposerBond: bond
		});

		return {
			debateId,
			debateIdOnchain,
			actionDomain,
			propositionHash,
			deadline
		};
	}
});

// Resolve the caller's trust tier from token identifier. Used by
// spawnDebate to enforce the tier-3 gate that mirrors the SvelteKit
// /api/debates/create:34 enforcement. Defined here (not in users.ts)
// so the action's runQuery call sites stay local to the feature.
export const _getCallerTrustTier = internalQuery({
	args: { tokenIdentifier: v.string() },
	handler: async (ctx, { tokenIdentifier }): Promise<number> => {
		const user = await ctx.db
			.query('users')
			.withIndex('by_tokenIdentifier', (q) => q.eq('tokenIdentifier', tokenIdentifier))
			.first();
		return user?.trustTier ?? 0;
	}
});

// =============================================================================
// INTERNAL MUTATIONS
// =============================================================================

/**
 * Insert a debate record (called from spawnDebate action).
 */
export const insertDebate = internalMutation({
	args: {
		templateId: v.id('templates'),
		debateIdOnchain: v.string(),
		actionDomain: v.string(),
		propositionHash: v.string(),
		propositionText: v.string(),
		deadline: v.number(),
		jurisdictionSize: v.number(),
		proposerAddress: v.string(),
		proposerBond: v.number(),
		txHash: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		// Verify template exists
		const template = await ctx.db.get(args.templateId);
		if (!template) throw new Error('Template not found');

		// Check for existing active debate
		const existing = await ctx.db
			.query('debates')
			.withIndex('by_templateId_status', (idx) =>
				idx.eq('templateId', args.templateId).eq('status', 'active')
			)
			.unique();

		if (existing) {
			throw new Error('An active debate already exists for this template');
		}

		const now = Date.now();

		const debateId = await ctx.db.insert('debates', {
			templateId: args.templateId,
			debateIdOnchain: args.debateIdOnchain,
			actionDomain: args.actionDomain,
			propositionHash: args.propositionHash,
			propositionText: args.propositionText,
			deadline: args.deadline,
			jurisdictionSize: args.jurisdictionSize,
			status: 'active',
			argumentCount: 0,
			uniqueParticipants: 0,
			totalStake: 0,
			resolvedFromChain: false,
			proposerAddress: args.proposerAddress,
			proposerBond: args.proposerBond,
			txHash: args.txHash,
			marketStatus: 'pre_market',
			currentEpoch: 0,
			updatedAt: now
		});
		await syncDebateReadModel(ctx, debateId, now, 'visibility');
		return debateId;
	}
});

/**
 * Public-API wrapper for `insertDebate`. SvelteKit `/api/debates/create` calls
 * this via the HTTP API; the internal version stays in place for the in-Convex
 * caller (`spawnDebate` action at line 722) which already holds full trust.
 */
export const insertDebateForCaller = mutation({
	args: {
		_secret: v.string(),
		templateId: v.id('templates'),
		debateIdOnchain: v.string(),
		actionDomain: v.string(),
		propositionHash: v.string(),
		propositionText: v.string(),
		deadline: v.number(),
		jurisdictionSize: v.number(),
		proposerAddress: v.string(),
		proposerBond: v.number(),
		txHash: v.optional(v.string())
	},
	handler: async (ctx, args): Promise<Id<'debates'>> => {
		requireInternalSecret(args._secret);
		const { _secret, ...rest } = args;
		return await ctx.runMutation(internal.debates.insertDebate, rest);
	}
});

const DEBATE_READ_MODEL_MIGRATION_PAGE = 24;

/** Bounded, self-paging adoption of legacy debates. Activation is separate. */
export const migrateDebateReadModels = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, { cursor }) => {
		const now = Date.now();
		let migration = await ctx.db
			.query('debateReadModelMigrations')
			.withIndex('by_key', (q) => q.eq('key', DEBATE_READ_MODEL_MIGRATION_KEY))
			.unique();
		if (!migration) {
			const id = await ctx.db.insert('debateReadModelMigrations', {
				key: DEBATE_READ_MODEL_MIGRATION_KEY,
				status: 'running',
				scanned: 0,
				projected: 0,
				updatedAt: now
			});
			migration = await ctx.db.get(id);
		}
		if (!migration) throw new Error('DEBATE_READ_MODEL_MIGRATION_STATE_MISSING');
		if (migration.status === 'ready' || migration.status === 'migrated') return migration;
		if (migration.status === 'blocked') {
			throw new Error(migration.failureCode ?? 'DEBATE_READ_MODEL_MIGRATION_BLOCKED');
		}
		const expectedCursor = migration.cursor ?? null;
		if ((cursor ?? null) !== expectedCursor) {
			throw new Error('DEBATE_READ_MODEL_MIGRATION_CURSOR_MISMATCH');
		}
		const page = await ctx.db.query('debates').paginate({
			cursor: expectedCursor,
			numItems: DEBATE_READ_MODEL_MIGRATION_PAGE,
			maximumRowsRead: DEBATE_READ_MODEL_MIGRATION_PAGE + 1,
			maximumBytesRead: 2 * 1024 * 1024
		});
		let projected = 0;
		try {
			for (const debate of page.page) {
				await syncDebateReadModel(ctx, debate._id, now, 'aggregate');
				projected += 1;
			}
		} catch (error) {
			const failureCode =
				error instanceof Error
					? error.message.slice(0, 200)
					: 'DEBATE_READ_MODEL_PROJECTION_FAILED';
			await ctx.db.patch(migration._id, { status: 'blocked', failureCode, updatedAt: now });
			return { ...migration, status: 'blocked' as const, failureCode };
		}
		const patch = {
			status: page.isDone ? ('migrated' as const) : ('running' as const),
			cursor: page.isDone ? undefined : page.continueCursor,
			scanned: migration.scanned + page.page.length,
			projected: migration.projected + projected,
			updatedAt: now
		};
		await ctx.db.patch(migration._id, patch);
		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, internal.debates.migrateDebateReadModels, {
				cursor: page.continueCursor
			});
		}
		return { ...migration, ...patch };
	}
});

export const activateDebateReadModels = internalMutation({
	args: {},
	handler: async (ctx) => {
		const migration = await ctx.db
			.query('debateReadModelMigrations')
			.withIndex('by_key', (q) => q.eq('key', DEBATE_READ_MODEL_MIGRATION_KEY))
			.unique();
		if (migration?.status === 'ready') return migration;
		if (!migration || migration.status !== 'migrated') {
			throw new Error('DEBATE_READ_MODEL_MIGRATION_INCOMPLETE');
		}
		await ctx.db.patch(migration._id, { status: 'ready', updatedAt: Date.now() });
		return { ...migration, status: 'ready' as const };
	}
});

export const getDebateReadModelReadiness = query({
	args: { _secret: v.string() },
	handler: async (ctx, { _secret }) => {
		requireInternalSecret(_secret);
		const migration = await ctx.db
			.query('debateReadModelMigrations')
			.withIndex('by_key', (q) => q.eq('key', DEBATE_READ_MODEL_MIGRATION_KEY))
			.unique();
		return migration
			? {
					status: migration.status,
					ready: migration.status === 'ready',
					scanned: migration.scanned,
					projected: migration.projected,
					failureCode: migration.failureCode ?? null,
					updatedAt: migration.updatedAt
				}
			: {
					status: 'missing',
					ready: false,
					scanned: 0,
					projected: 0,
					failureCode: null,
					updatedAt: null
				};
	}
});

// =============================================================================
// CRON STUBS — internal actions called by convex/crons.ts
// =============================================================================

/**
 * Resolve expired debates: find active debates past deadline, trigger AI evaluation.
 * Called daily at 02:00 UTC by cron.
 *
 * The AI evaluator + blockchain calls live in SvelteKit (voter-protocol monorepo
 * dependency, env-gated blockchain relayer). This action dispatches each expired
 * debate to `POST /api/debates/[id]/evaluate` which owns rate limiting, debounce,
 * and on-chain settlement. Convex only orchestrates the list + fan-out.
 *
 * Env requirements:
 *   COMMONS_INTERNAL_URL — base URL for the internal evaluate endpoint
 *   CRON_SECRET          — bearer secret validated by verifyCronSecret
 *
 * Missing either env skips the run with an explicit log (ops-visible) rather
 * than silently no-op'ing.
 */
export const resolveExpiredDebates = internalAction({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, { cursor }) => {
		const now = Date.now();

		const baseUrl = process.env.COMMONS_INTERNAL_URL;
		const cronSecret = process.env.CRON_SECRET;
		if (!baseUrl || !cronSecret) {
			const missing = [!baseUrl ? 'COMMONS_INTERNAL_URL' : null, !cronSecret ? 'CRON_SECRET' : null]
				.filter(Boolean)
				.join(',');
			console.error(
				`[debate-resolution] Skipping run — env missing: ${missing}. No evaluation dispatched.`
			);
			return { total: 0, triggered: 0, skipped: 0, failed: 0, envMissing: true };
		}

		const expiredPage = await ctx.runQuery(getExpiredDebatesRef, { now, cursor: cursor ?? null });
		const expired = expiredPage.data;

		let triggered = 0;
		let skipped = 0;
		const errors: string[] = [];

		for (const debate of expired) {
			// Skip if already resolved, has no arguments, or has no on-chain ID
			// (evaluate endpoint rejects those; avoid the round-trip).
			if (debate.aiResolution || debate.argumentCount === 0 || !debate.debateIdOnchain) {
				skipped++;
				continue;
			}

			try {
				const response = await fetch(`${baseUrl}/api/debates/${debate._id}/evaluate`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${cronSecret}`
					}
				});

				if (response.ok) {
					triggered++;
				} else if (response.status === 404 || response.status === 429) {
					// 404 = FEATURES.DEBATE disabled or debate not found (already moved).
					// 429 = rate-limited (recently evaluated); both are benign for a cron.
					skipped++;
				} else {
					const body = await response.text().catch(() => '');
					errors.push(`${debate._id}: HTTP ${response.status} ${body.slice(0, 120)}`);
				}
			} catch (err) {
				errors.push(`${debate._id}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		console.log(
			`[debate-resolution] ${expired.length} expired: ${triggered} triggered, ${skipped} skipped, ${errors.length} errors`
		);
		if (errors.length > 0) {
			console.error(`[debate-resolution] errors: ${errors.join(' | ')}`);
		}
		if (expiredPage.cursor) {
			await ctx.scheduler.runAfter(0, internal.debates.resolveExpiredDebates, {
				cursor: expiredPage.cursor
			});
		}

		return {
			total: expired.length,
			triggered,
			skipped,
			failed: errors.length,
			envMissing: false
		};
	}
});

/** Internal query: find active debates past their deadline. */
export const getExpiredDebates = internalQuery({
	args: { now: v.number(), cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, { now, cursor }) => {
		const page = await ctx.db
			.query('debates')
			.withIndex('by_status_deadline', (q) => q.eq('status', 'active').lt('deadline', now))
			.order('asc')
			.paginate({
				cursor: cursor ?? null,
				numItems: 25,
				maximumRowsRead: 26,
				maximumBytesRead: 512 * 1024
			});
		return {
			data: page.page,
			cursor: page.isDone ? null : page.continueCursor
		};
	}
});

/**
 * Find a nullifier by debateId + nullifierHash. Used for dedup checks from SvelteKit routes.
 */
export const findNullifier = query({
	args: {
		_secret: v.string(),
		debateId: v.id('debates'),
		nullifierHash: v.string()
	},
	handler: async (ctx, { _secret, debateId, nullifierHash }) => {
		requireInternalSecret(_secret);
		const existing = await ctx.db
			.query('debateNullifiers')
			.withIndex('by_debateId_nullifierHash', (idx) =>
				idx.eq('debateId', debateId).eq('nullifierHash', nullifierHash)
			)
			.first();
		return existing ? { _id: existing._id } : null;
	}
});

/**
 * Update per-argument AI evaluation scores (after AI panel resolution).
 */
export const updateArgumentScores = mutation({
	args: {
		_secret: v.string(),
		debateId: v.id('debates'),
		scores: v.array(
			v.object({
				argumentIndex: v.number(),
				aiScores: v.any(),
				aiWeighted: v.float64(),
				finalScore: v.float64(),
				modelAgreement: v.float64()
			})
		)
	},
	handler: async (ctx, { _secret, debateId, scores }) => {
		requireInternalSecret(_secret);
		for (const score of scores) {
			const arg = await ctx.db
				.query('debateArguments')
				.withIndex('by_debateId_argumentIndex', (idx) =>
					idx.eq('debateId', debateId).eq('argumentIndex', score.argumentIndex)
				)
				.first();
			if (arg) {
				await ctx.db.patch(arg._id, {
					aiScores: score.aiScores,
					aiWeighted: score.aiWeighted,
					finalScore: score.finalScore,
					modelAgreement: score.modelAgreement
				});
			}
		}
		await syncDebateReadModel(ctx, debateId, Date.now(), 'aggregate');
		return { success: true };
	}
});

/**
 * Minimal debate snapshot for SSE stream change detection.
 */
export const getSnapshot = query({
	args: { _secret: v.string(), debateId: v.id('debates') },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const debate = await ctx.db.get(args.debateId);
		if (!debate) return null;
		return {
			id: debate._id,
			status: debate.status,
			argumentCount: debate.argumentCount < 5 ? null : debate.argumentCount,
			uniqueParticipants: debate.uniqueParticipants < 5 ? null : debate.uniqueParticipants,
			winningStance: debate.winningStance ?? null,
			aiPanelConsensus: debate.aiPanelConsensus ?? null
		};
	}
});

/**
 * Get campaign + org membership for debate creation flow.
 */
export const getCampaignForDebate = query({
	args: { campaignId: v.id('campaigns') },
	handler: async (ctx, { campaignId }) => {
		const { userId } = await requireAuth(ctx);
		const campaign = await ctx.db.get(campaignId);
		if (!campaign) return null;

		// Look up org membership
		const membership = await ctx.db
			.query('orgMemberships')
			.withIndex('by_userId_orgId', (q) => q.eq('userId', userId).eq('orgId', campaign.orgId))
			.first();

		if (!membership) return null;

		// Get org slug
		const org = await ctx.db.get(campaign.orgId);

		return {
			_id: campaign._id,
			orgId: campaign.orgId,
			orgSlug: org?.slug ?? '',
			templateId: campaign.templateId ?? null,
			debateEnabled: campaign.debateEnabled,
			debateId: campaign.debateId ?? null,
			memberRole: membership.role
		};
	}
});

/**
 * List debates awaiting governance review — with arguments and template info.
 */
export const listAwaitingGovernance = query({
	args: {
		cursor: v.optional(v.union(v.string(), v.null())),
		limit: v.optional(v.number())
	},
	handler: async (ctx, { cursor, limit }) => {
		// Deliberately community-visible (any authenticated user), NOT operator-only:
		// this is the participatory-governance queue. Safe because the return below is
		// an explicit allowlist projection (no userId/PII/internal fields) and
		// participation counts (argumentCount, uniqueParticipants) are K-floored to null
		// below 5. The debate propositions, arguments, and AI resolutions are public
		// deliberative content by design.
		await requireAuth(ctx);
		if (cursor && cursor.length > 2_048) throw new Error('DEBATE_CURSOR_INVALID');
		const pageSize = Math.min(Math.max(Math.trunc(limit ?? 10), 1), 10);
		const page = await ctx.db
			.query('debates')
			.withIndex('by_status_updatedAt', (q) => q.eq('status', 'awaiting_governance'))
			.order('desc')
			.paginate({
				cursor: cursor ?? null,
				numItems: pageSize,
				maximumRowsRead: pageSize + 1,
				maximumBytesRead: 512 * 1024
			});

		const data = await Promise.all(
			page.page.map(async (d) => {
				const argumentPage = await readArgumentPage(ctx, d._id, { limit: 25 });

				let templateTitle = 'Unknown Template';
				let templateSlug = '';
				if (d.templateId) {
					const t = await ctx.db.get(d.templateId);
					if (t) {
						templateTitle = t.title;
						templateSlug = t.slug ?? '';
					}
				}

				return {
					_id: d._id,
					debateIdOnchain: d.debateIdOnchain,
					templateId: d.templateId,
					templateTitle,
					templateSlug,
					propositionText: d.propositionText,
					actionDomain: d.actionDomain,
					deadline: d.deadline,
					totalStake: d.totalStake?.toString() ?? '0',
					argumentCount: d.argumentCount < 5 ? null : d.argumentCount,
					uniqueParticipants: d.uniqueParticipants < 5 ? null : d.uniqueParticipants,
					aiPanelConsensus: d.aiPanelConsensus ?? null,
					updatedAt: d.updatedAt,
					aiResolution: d.aiResolution ?? null,
					aiSignatureCount: d.aiSignatureCount ?? null,
					arguments: argumentPage.page.map((a) => ({
						argumentIndex: a.argumentIndex,
						stance: a.stance,
						body: a.body,
						amendmentText: a.amendmentText ?? null,
						stakeAmount: a.stakeAmount?.toString() ?? '0',
						weightedScore: a.weightedScore?.toString() ?? '0',
						coSignCount: a.coSignCount,
						aiScores: a.aiScores ?? null,
						aiWeighted: a.aiWeighted ?? null,
						finalScore: a.finalScore ?? null,
						modelAgreement: a.modelAgreement ?? null
					})),
					hasMoreArguments: !argumentPage.isDone
				};
			})
		);
		return {
			data,
			cursor: page.isDone ? null : page.continueCursor,
			hasMore: !page.isDone
		};
	}
});

// =============================================================================
// AUTO-SPAWN FROM CAMPAIGN THRESHOLD (T5-1)
// =============================================================================

/**
 * Atomic "spawn debate iff campaign crossed the threshold AND no debate yet
 * exists" — run via scheduler.runAfter from createCampaignAction. Race
 * concerns: two simultaneous threshold-crossing actions could each schedule a
 * spawn. The eligibility re-check inside the insert mutation makes this
 * idempotent: whichever fires first wins; the second sees campaign.debateId
 * already set and exits.
 *
 * Authorization: this is a SYSTEM-initiated spawn driven by a metric the org
 * editor already authorized when they set campaign.debateEnabled + threshold.
 * No tier-3 gate applies — the editor's act of configuring the campaign IS
 * the authorization.
 */
export const atomicSpawnIfEligible = internalAction({
	args: { campaignId: v.id('campaigns') },
	handler: async (
		ctx,
		{ campaignId }
	): Promise<{ spawned: false; reason: string } | { spawned: true; debateId: Id<'debates'> }> => {
		const campaign: {
			_id: Id<'campaigns'>;
			title: string;
			templateId: Id<'templates'> | null;
			debateEnabled: boolean;
			debateThreshold: number;
			debateId: Id<'debates'> | null;
			verifiedActionCount: number;
		} | null = await ctx.runQuery(internal.debates._getCampaignForSpawn, {
			campaignId
		});
		if (!campaign) return { spawned: false as const, reason: 'no_campaign' };
		if (campaign.debateId) return { spawned: false as const, reason: 'already_spawned' };
		if (!campaign.debateEnabled) return { spawned: false as const, reason: 'disabled' };
		if (!campaign.templateId) return { spawned: false as const, reason: 'no_template' };
		if ((campaign.verifiedActionCount ?? 0) < (campaign.debateThreshold ?? 0)) {
			return { spawned: false as const, reason: 'below_threshold' };
		}

		// Derive action-domain values the same way spawnDebate does.
		const propositionText =
			campaign.title.length >= 10
				? campaign.title
				: `${campaign.title} — auto-spawned from threshold crossing`;
		const timestamp = Math.floor(Date.now() / 1000);
		const propositionHash = await hashTextToBytes32(propositionText);
		const debateIdOnchain = await offchainDebateId(propositionHash, timestamp);
		const actionDomain = await offchainActionDomain(debateIdOnchain, propositionHash);

		const result = await ctx.runMutation(internal.debates._spawnDebateIfEligible, {
			campaignId,
			templateId: campaign.templateId as Id<'templates'>,
			debateIdOnchain,
			actionDomain,
			propositionHash,
			propositionText,
			durationSeconds: 7 * 24 * 60 * 60,
			jurisdictionSize: campaign.debateThreshold ?? 100
		});
		return result;
	}
});

/**
 * Manual force-spawn — for the /api/campaigns/[id]/debate route. Bypasses
 * the threshold check (org editor explicitly asked for it via the API) but
 * still re-checks debateId so the manual path is idempotent against the
 * auto-spawn path. Takes optional propositionText so editors can override
 * the title-derived default.
 */
export const forceSpawnDebateForCampaign = action({
	args: {
		campaignId: v.id('campaigns'),
		propositionText: v.optional(v.string()),
		duration: v.optional(v.number()),
		jurisdictionSizeHint: v.optional(v.number())
	},
	handler: async (
		ctx,
		args
	): Promise<{ spawned: false; reason: string } | { spawned: true; debateId: Id<'debates'> }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error('Not authenticated');

		const memberRole = await ctx.runQuery(getCampaignEditorRoleRef, {
			campaignId: args.campaignId
		});
		if (memberRole !== 'owner' && memberRole !== 'editor') {
			throw new Error('Only org editors/owners can spawn debates for a campaign');
		}

		const campaign: {
			_id: Id<'campaigns'>;
			title: string;
			templateId: Id<'templates'> | null;
			debateEnabled: boolean;
			debateThreshold: number;
			debateId: Id<'debates'> | null;
			verifiedActionCount: number;
		} | null = await ctx.runQuery(internal.debates._getCampaignForSpawn, {
			campaignId: args.campaignId
		});
		if (!campaign) return { spawned: false as const, reason: 'no_campaign' };
		if (campaign.debateId) return { spawned: false as const, reason: 'already_spawned' };
		if (!campaign.debateEnabled) return { spawned: false as const, reason: 'disabled' };
		if (!campaign.templateId) return { spawned: false as const, reason: 'no_template' };

		const fallbackText = `${campaign.title} — debate spawned manually`;
		const propositionText =
			args.propositionText && args.propositionText.length >= 10
				? args.propositionText
				: fallbackText;
		const timestamp = Math.floor(Date.now() / 1000);
		const propositionHash = await hashTextToBytes32(propositionText);
		const debateIdOnchain = await offchainDebateId(propositionHash, timestamp);
		const actionDomain = await offchainActionDomain(debateIdOnchain, propositionHash);
		const durationSeconds = args.duration ?? 7 * 24 * 60 * 60;

		const result: { spawned: false; reason: string } | { spawned: true; debateId: Id<'debates'> } =
			await ctx.runMutation(internal.debates._spawnDebateIfEligibleForce, {
				campaignId: args.campaignId,
				templateId: campaign.templateId as Id<'templates'>,
				debateIdOnchain,
				actionDomain,
				propositionHash,
				propositionText,
				durationSeconds,
				jurisdictionSize: args.jurisdictionSizeHint ?? campaign.debateThreshold ?? 100
			});
		return result;
	}
});

export const _spawnDebateIfEligibleForce = internalMutation({
	args: {
		campaignId: v.id('campaigns'),
		templateId: v.id('templates'),
		debateIdOnchain: v.string(),
		actionDomain: v.string(),
		propositionHash: v.string(),
		propositionText: v.string(),
		durationSeconds: v.number(),
		jurisdictionSize: v.number()
	},
	handler: async (ctx, args) => {
		const campaign = await ctx.db.get(args.campaignId);
		if (!campaign) return { spawned: false as const, reason: 'no_campaign' };
		if (campaign.debateId) return { spawned: false as const, reason: 'already_spawned' };

		const now = Date.now();
		const debateId = await ctx.db.insert('debates', {
			templateId: args.templateId,
			debateIdOnchain: args.debateIdOnchain,
			actionDomain: args.actionDomain,
			propositionHash: args.propositionHash,
			propositionText: args.propositionText,
			deadline: now + args.durationSeconds * 1000,
			jurisdictionSize: args.jurisdictionSize,
			status: 'active',
			argumentCount: 0,
			uniqueParticipants: 0,
			totalStake: 0,
			resolvedFromChain: false,
			proposerAddress: '0x0000000000000000000000000000000000000000',
			proposerBond: 0,
			marketStatus: 'pre_market',
			currentEpoch: 0,
			updatedAt: now
		});
		await ctx.db.patch(args.campaignId, {
			debateId,
			updatedAt: now
		});
		await syncDebateReadModel(ctx, debateId, now, 'visibility');
		return { spawned: true as const, debateId };
	}
});

export const _getCampaignForSpawn = internalQuery({
	args: { campaignId: v.id('campaigns') },
	handler: async (ctx, { campaignId }) => {
		const c = await ctx.db.get(campaignId);
		if (!c) return null;
		return {
			_id: c._id,
			title: c.title,
			templateId: c.templateId ?? null,
			debateEnabled: c.debateEnabled,
			debateThreshold: c.debateThreshold ?? 0,
			debateId: c.debateId ?? null,
			verifiedActionCount: c.verifiedActionCount ?? 0
		};
	}
});

export const _getCampaignEditorRoleForCaller = internalQuery({
	args: { campaignId: v.id('campaigns') },
	handler: async (ctx, { campaignId }) => {
		const { userId } = await requireAuth(ctx);
		const campaign = await ctx.db.get(campaignId);
		if (!campaign) return null;
		const membership = await ctx.db
			.query('orgMemberships')
			.withIndex('by_userId_orgId', (q) => q.eq('userId', userId).eq('orgId', campaign.orgId))
			.first();
		return membership?.role ?? null;
	}
});

export const _spawnDebateIfEligible = internalMutation({
	args: {
		campaignId: v.id('campaigns'),
		templateId: v.id('templates'),
		debateIdOnchain: v.string(),
		actionDomain: v.string(),
		propositionHash: v.string(),
		propositionText: v.string(),
		durationSeconds: v.number(),
		jurisdictionSize: v.number()
	},
	handler: async (ctx, args) => {
		const campaign = await ctx.db.get(args.campaignId);
		if (!campaign) return { spawned: false as const, reason: 'no_campaign' };
		if (campaign.debateId) return { spawned: false as const, reason: 'already_spawned' };
		if ((campaign.verifiedActionCount ?? 0) < (campaign.debateThreshold ?? 0)) {
			return { spawned: false as const, reason: 'below_threshold' };
		}

		const now = Date.now();
		const debateId = await ctx.db.insert('debates', {
			templateId: args.templateId,
			debateIdOnchain: args.debateIdOnchain,
			actionDomain: args.actionDomain,
			propositionHash: args.propositionHash,
			propositionText: args.propositionText,
			deadline: now + args.durationSeconds * 1000,
			jurisdictionSize: args.jurisdictionSize,
			status: 'active',
			argumentCount: 0,
			uniqueParticipants: 0,
			totalStake: 0,
			resolvedFromChain: false,
			proposerAddress: '0x0000000000000000000000000000000000000000',
			proposerBond: 0,
			marketStatus: 'pre_market',
			currentEpoch: 0,
			updatedAt: now
		});
		await ctx.db.patch(args.campaignId, {
			debateId,
			updatedAt: now
		});
		await syncDebateReadModel(ctx, debateId, now, 'visibility');
		return { spawned: true as const, debateId };
	}
});
