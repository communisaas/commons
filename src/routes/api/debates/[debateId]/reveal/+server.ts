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
	isSafeUint
} from '$lib/server/debate-input-validation';
import { getInternalSecret } from '$lib/server/internal/secret-auth';

const DEBATE_REVEAL_REQUEST_MAX_BYTES = 96 * 1024;

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
	const parsed = await readBoundedJson(request, DEBATE_REVEAL_REQUEST_MAX_BYTES);
	if (!isRecord(parsed)) throw error(400, 'Invalid trade reveal request');
	const body = parsed;

	const {
		epoch,
		commitIndex,
		argumentIndex,
		direction,
		nonce,
		debateWeightProof,
		debateWeightPublicInputs
	} = body;

	if (!isSafeUint(epoch) || !isSafeUint(commitIndex) || !isSafeUint(argumentIndex)) {
		throw error(400, 'epoch, commitIndex, and argumentIndex must be non-negative safe integers');
	}

	if (!isBytes32(nonce)) {
		throw error(400, 'nonce must be a 0x-prefixed 32-byte hex string');
	}

	if (!isBoundedHexBytes(debateWeightProof)) {
		throw error(400, 'debateWeightProof must be bounded hex bytes');
	}

	if (
		!Array.isArray(debateWeightPublicInputs) ||
		debateWeightPublicInputs.length !== 2 ||
		!debateWeightPublicInputs.every(isBytes32)
	) {
		throw error(400, 'debateWeightPublicInputs must contain exactly 2 bytes32 values');
	}

	// Validate direction is 0 (BUY) or 1 (SELL)
	if (direction !== 0 && direction !== 1) {
		throw error(400, 'direction must be 0 (BUY) or 1 (SELL)');
	}

	// Validate debate exists and is active
	const debate = await serverQuery(api.debates.get, {
		_secret: getInternalSecret(),
		debateId: debateId as Id<'debates'>
	});

	if (!debate) throw error(404, 'Debate not found');
	if (debate.status !== 'active') throw error(400, 'Debate is not active');

	// Submit revealTrade on-chain via DebateMarket contract
	let txHash: string | undefined;

	try {
		const { revealTrade } = await import('$lib/core/blockchain/debate-market-client');

		const onchainResult = await revealTrade({
			debateId: debate.debateIdOnchain,
			epoch,
			commitIndex,
			argumentIndex,
			direction,
			nonce,
			debateWeightProof,
			debateWeightPublicInputs: debateWeightPublicInputs as [string, string]
		});

		if (onchainResult.success) {
			txHash = onchainResult.txHash;
		} else if (onchainResult.error?.includes('not configured')) {
			// Fails-closed in prod; fall through off-chain only in dev or via opt-in.
			allowChainMisconfig({ op: 'debates/reveal' });
			console.warn('[debates/reveal] Blockchain not configured, accepting off-chain only');
		} else {
			throw error(502, `On-chain reveal submission failed: ${onchainResult.error}`);
		}
	} catch (err: unknown) {
		// Re-throw SvelteKit errors (our own 502 above) and the prod-gate throw.
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		// Import failure or unexpected error — treat as missing-chain in dev only.
		allowChainMisconfig({ op: 'debates/reveal' });
		console.warn('[debates/reveal] Blockchain not available, accepting off-chain only:', err);
	}

	return json({
		success: true,
		debateId,
		epoch,
		argumentIndex,
		direction,
		...(txHash ? { txHash } : {})
	});
};
