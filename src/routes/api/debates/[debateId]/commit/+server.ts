// CONVEX: Keep SvelteKit — calls blockchain (commitTrade). On-chain LMSR market operation.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import { allowChainMisconfig } from '$lib/server/debate-chain-gate';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Not found');
	}

	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}
	const user = locals.user;
	if (!user || (user.trust_tier ?? 0) < 3) {
		throw error(403, 'Tier 3+ verification required for market operations');
	}

	const { debateId } = params;
	const body = await request.json();

	const { commitHash, proof, publicInputs, verifierDepth, deadline } = body;

	if (!commitHash || !proof) {
		throw error(400, 'Missing required fields: commitHash, proof');
	}

	// Validate debate exists and is active
	const debate = await serverQuery(api.debates.get, { debateId: debateId as any });

	if (!debate) throw error(404, 'Debate not found');
	if (debate.status !== 'active') throw error(400, 'Debate is not active');

	// Submit commitTrade on-chain via DebateMarket contract
	let txHash: string | undefined;

	try {
		const { commitTrade } = await import('$lib/core/blockchain/debate-market-client');

		const onchainResult = await commitTrade({
			debateId: debate.debateIdOnchain,
			commitHash,
			proof,
			publicInputs: publicInputs ?? [],
			verifierDepth: verifierDepth ?? 20,
			deadline
		});

		if (onchainResult.success) {
			txHash = onchainResult.txHash;
		} else if (onchainResult.error?.includes('not configured')) {
			// Fails-closed in prod; fall through off-chain only in dev or via opt-in.
			allowChainMisconfig({ op: 'debates/commit' });
			console.warn('[debates/commit] Blockchain not configured, accepting off-chain only');
		} else {
			throw error(502, `On-chain commit submission failed: ${onchainResult.error}`);
		}
	} catch (err: unknown) {
		// Re-throw SvelteKit errors (our own 502 above) and the prod-gate throw.
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		// Import failure or unexpected error — treat as missing-chain in dev only.
		// In prod this is suspicious (chain should be present); fail-closed.
		allowChainMisconfig({ op: 'debates/commit' });
		console.warn('[debates/commit] Blockchain not available, accepting off-chain only:', err);
	}

	return json({
		success: true,
		debateId,
		commitHash,
		epoch: debate.currentEpoch,
		...(txHash ? { txHash } : {})
	});
};
