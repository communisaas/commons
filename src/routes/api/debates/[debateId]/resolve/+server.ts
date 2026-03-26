// CONVEX: Keep SvelteKit — calls blockchain (resolveDebateOnChain, readChainResolution).
// Chain is authoritative for winner determination. Cannot move to Convex.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/core/db';
import { resolveDebate as resolveDebateOnChain, readChainResolution } from '$lib/core/blockchain/debate-market-client';
import { FEATURES } from '$lib/config/features';

/**
 * POST /api/debates/[debateId]/resolve
 *
 * Resolve a debate after its deadline has passed.
 * Determines the winning argument by highest weighted_score.
 *
 * NOTE: In production, calls DebateMarket.resolveDebate() on-chain.
 * Currently resolves off-chain only for frontend development.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Not found');
	}
	const { debateId } = params;

	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}
	const user = locals.user;
	if (!user || (user.trust_tier ?? 0) < 3) {
		throw error(403, 'Tier 3+ verification required to resolve debates');
	}

	const debate = await prisma.debate.findUnique({
		where: { id: debateId },
		select: {
			id: true,
			status: true,
			deadline: true,
			debate_id_onchain: true,
			resolution_method: true,
			ai_resolution: true,
			arguments: {
				where: { verification_status: 'verified' },
				orderBy: { weighted_score: 'desc' }
			}
		}
	});

	if (!debate) {
		throw error(404, 'Debate not found');
	}
	if (debate.status !== 'active') {
		throw error(400, 'Debate is already resolved');
	}
	if (new Date() <= debate.deadline) {
		throw error(400, 'Debate deadline has not passed yet');
	}
	// If AI evaluation is in progress or complete, resolution must go through /evaluate
	if (debate.resolution_method || debate.ai_resolution) {
		throw error(409, 'This debate has AI evaluation data. Use the /evaluate endpoint for AI-augmented resolution.');
	}

	if (debate.arguments.length === 0) {
		throw error(400, 'Cannot resolve a debate with no verified arguments');
	}

	// Winner from DB: verified argument with highest weighted_score (fallback)
	const dbWinner = debate.arguments[0];

	// Resolve on-chain if this debate has an on-chain ID
	let txHash: string | undefined;
	let resolvedFromChain = false;
	let winningIndex = dbWinner.argument_index;
	let winningStance = dbWinner.stance;

	if (debate.debate_id_onchain) {
		const onchainResult = await resolveDebateOnChain(debate.debate_id_onchain);

		if (onchainResult.success) {
			txHash = onchainResult.txHash;

			// Defense in depth: read the authoritative winner from chain
			// The on-chain state only contains arguments that passed verifyThreeTreeProof()
			const chainState = await readChainResolution(debate.debate_id_onchain);
			if (chainState.success && chainState.winningArgumentIndex !== undefined) {
				winningIndex = chainState.winningArgumentIndex;
				// Map on-chain stance enum to string
				const stanceMap: Record<number, string> = { 0: 'SUPPORT', 1: 'OPPOSE', 2: 'AMEND' };
				winningStance = stanceMap[chainState.winningStance ?? 0] ?? dbWinner.stance;
				resolvedFromChain = true;

				if (winningIndex !== dbWinner.argument_index) {
					console.warn('[debates/resolve] Chain winner differs from DB winner!', {
						chainWinner: winningIndex,
						dbWinner: dbWinner.argument_index,
						debateId
					});
				}
			} else {
				console.warn('[debates/resolve] Chain read failed, using DB winner:', chainState.error);
			}
		} else if (onchainResult.error?.includes('not configured')) {
			console.warn('[debates/resolve] Blockchain not configured, resolving off-chain only');
		} else {
			throw error(502, `On-chain debate resolution failed: ${onchainResult.error}`);
		}
	}

	try {
		const resolved = await prisma.debate.update({
			where: { id: debateId, status: 'active' },
			data: {
				status: 'resolved',
				winning_argument_index: winningIndex,
				winning_stance: winningStance,
				resolved_at: new Date(),
				resolution_method: 'community_only',
				resolved_from_chain: resolvedFromChain,
			}
		});

		return json({
			debateId: resolved.id,
			status: 'resolved',
			winningArgumentIndex: resolved.winning_argument_index,
			winningStance: resolved.winning_stance,
			resolvedAt: resolved.resolved_at?.toISOString(),
			resolvedFromChain,
			...(txHash && { txHash })
		});
	} catch (err: unknown) {
		// P2025: Record not found (status already changed by concurrent request)
		if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2025') {
			throw error(409, 'Debate has already been resolved or status changed');
		}
		throw err;
	}
};
