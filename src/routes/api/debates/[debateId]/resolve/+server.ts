// Chain is authoritative for winner determination. Cannot move to Convex.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { resolveDebate as resolveDebateOnChain, readChainResolution } from '$lib/core/blockchain/debate-market-client';
import { FEATURES } from '$lib/config/features';

/**
 * POST /api/debates/[debateId]/resolve
 *
 * Resolve a debate after its deadline has passed.
 * Determines the winning argument by highest weightedScore.
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

	await serverQuery(api.debates.get, { debateId: debateId as any });

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
	if (debate.resolutionMethod || debate.aiResolution) {
		throw error(409, 'This debate has AI evaluation data. Use the /evaluate endpoint for AI-augmented resolution.');
	}

	if (debate.arguments.length === 0) {
		throw error(400, 'Cannot resolve a debate with no verified arguments');
	}

	// Winner from DB: verified argument with highest weightedScore (fallback)
	const dbWinner = debate.arguments[0];

	// Resolve on-chain if this debate has an on-chain ID
	let txHash: string | undefined;
	let resolvedFromChain = false;
	let winningIndex = dbWinner.argumentIndex;
	let winningStance = dbWinner.stance;

	if (debate.debateIdOnchain) {
		const onchainResult = await resolveDebateOnChain(debate.debateIdOnchain);

		if (onchainResult.success) {
			txHash = onchainResult.txHash;

			// Defense in depth: read the authoritative winner from chain
			// The on-chain state only contains arguments that passed verifyThreeTreeProof()
			const chainState = await readChainResolution(debate.debateIdOnchain);
			if (chainState.success && chainState.winningArgumentIndex !== undefined) {
				winningIndex = chainState.winningArgumentIndex;
				// Map on-chain stance enum to string
				const stanceMap: Record<number, string> = { 0: 'SUPPORT', 1: 'OPPOSE', 2: 'AMEND' };
				winningStance = stanceMap[chainState.winningStance ?? 0] ?? dbWinner.stance;
				resolvedFromChain = true;

				if (winningIndex !== dbWinner.argumentIndex) {
					console.warn('[debates/resolve] Chain winner differs from DB winner!', {
						chainWinner: winningIndex,
						dbWinner: dbWinner.argumentIndex,
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
		const resolved = await serverMutation(api.debates.updateStatus, {
			where: { id: debateId, status: 'active' },
			data: {
				status: 'resolved',
				winningArgumentIndex: winningIndex,
				winningStance: winningStance,
				resolvedAt: new Date(),
				resolutionMethod: 'community_only',
				resolvedFromChain: resolvedFromChain,
			}
		});

		return json({
			debateId: resolved.id,
			status: 'resolved',
			winningArgumentIndex: resolved.winningArgumentIndex,
			winningStance: resolved.winningStance,
			resolvedAt: resolved.resolvedAt?.toISOString(),
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
