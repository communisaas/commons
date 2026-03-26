import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

/**
 * GET /api/debates/by-template/[templateId]
 *
 * Returns the most recent debate for a template (active preferred over resolved).
 * Includes arguments sorted by weighted_score descending.
 *
 * Response: { debate: DebateData | null }
 */
export const GET: RequestHandler = async ({ params }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Not found');
	}

	const { templateId } = params;

	if (!templateId) {
		throw error(400, 'templateId is required');
	}

			const result = await serverQuery(api.debates.getFullByTemplateId, {
				templateId: templateId as any
			});
			return json({ debate: result ?? null });
	}

	// Verify template exists
	const template = await prisma.template.findUnique({
		where: { id: templateId },
		select: { id: true }
	});

	if (!template) {
		throw error(404, 'Template not found');
	}

	// Prefer active debates; fall back to most recent resolved
	const debate = await prisma.debate.findFirst({
		where: { template_id: templateId },
		orderBy: [{ status: 'asc' }, { created_at: 'desc' }], // 'active' < 'resolved' alphabetically
		include: {
			arguments: {
				orderBy: { weighted_score: 'desc' }
			}
		}
	});

	if (!debate) {
		return json({ debate: null });
	}

	// Serialize BigInt fields for JSON transport
	return json({
		debate: {
			id: debate.id,
			debateIdOnchain: debate.debate_id_onchain,
			templateId: debate.template_id,
			propositionText: debate.proposition_text,
			propositionHash: debate.proposition_hash,
			actionDomain: debate.action_domain,
			deadline: debate.deadline.toISOString(),
			jurisdictionSize: debate.jurisdiction_size,
			status: debate.status,
			argumentCount: debate.argument_count,
			uniqueParticipants: debate.unique_participants,
			totalStake: debate.total_stake.toString(),
			winningArgumentIndex: debate.winning_argument_index,
			winningStance: debate.winning_stance,
			resolvedAt: debate.resolved_at?.toISOString(),
			arguments: debate.arguments.map((arg) => ({
				id: arg.id,
				argumentIndex: arg.argument_index,
				stance: arg.stance,
				body: arg.body,
				amendmentText: arg.amendment_text,
				stakeAmount: arg.stake_amount.toString(),
				engagementTier: arg.engagement_tier,
				weightedScore: arg.weighted_score.toString(),
				totalStake: arg.total_stake.toString(),
				coSignCount: arg.co_sign_count,
				createdAt: arg.created_at.toISOString()
			}))
		}
	});
};
