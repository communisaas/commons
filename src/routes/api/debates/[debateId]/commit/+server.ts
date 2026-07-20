// CONVEX: Keep SvelteKit — calls blockchain (commitTrade). On-chain LMSR market operation.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { FEATURES } from '$lib/config/features';
import { allowChainMisconfig } from '$lib/server/debate-chain-gate';
import { readBoundedJson } from '$lib/server/bounded-json';
import {
	isBoundedHexBytes,
	isBytes32,
	isRecord,
	isSafeUint,
	isThreeTreePublicInputs,
	VALID_THREE_TREE_DEPTHS
} from '$lib/server/debate-input-validation';
import { getInternalSecret } from '$lib/server/internal/secret-auth';

const DEBATE_COMMIT_REQUEST_MAX_BYTES = 96 * 1024;

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
	const parsed = await readBoundedJson(request, DEBATE_COMMIT_REQUEST_MAX_BYTES);
	if (!isRecord(parsed)) throw error(400, 'Invalid trade commitment request');
	const body = parsed;

	const { commitHash, proof, publicInputs, verifierDepth, deadline } = body;

	if (!isBytes32(commitHash)) {
		throw error(400, 'commitHash must be a 0x-prefixed 32-byte hex string');
	}
	if (!isBoundedHexBytes(proof) || !isThreeTreePublicInputs(publicInputs)) {
		throw error(400, 'proof and exactly 31 bounded publicInputs are required');
	}
	const normalizedVerifierDepth = verifierDepth ?? 20;
	if (
		!isSafeUint(normalizedVerifierDepth) ||
		!(VALID_THREE_TREE_DEPTHS as readonly number[]).includes(normalizedVerifierDepth)
	) {
		throw error(400, 'verifierDepth must be one of 18, 20, 22, or 24');
	}
	if (deadline !== undefined) {
		const nowSeconds = Math.floor(Date.now() / 1000);
		if (!isSafeUint(deadline) || deadline < nowSeconds - 60 || deadline > nowSeconds + 3600) {
			throw error(400, 'deadline must be within one hour of the current time');
		}
	}

	// Validate debate exists and is active
	const debate = await serverQuery(api.debates.get, {
		_secret: getInternalSecret(),
		debateId: debateId as Id<'debates'>
	});

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
			publicInputs,
			verifierDepth: normalizedVerifierDepth,
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
