// CONVEX: Keep SvelteKit — POST uses blockchain (submitArgument), solidityPackedKeccak256, tx-verifier
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { solidityPackedKeccak256 } from 'ethers';
import { FEATURES } from '$lib/config/features';

/** Returns true for a valid Ethereum address (0x-prefixed, 42 hex chars). */
function isValidEthAddress(addr: unknown): addr is string {
	return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr);
}

/**
 * GET /api/debates/[debateId]/arguments
 *
 * List arguments for a debate, sorted by weighted score.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Not found');
	}
	const { debateId } = params;

	const stance = url.searchParams.get('stance');
	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 100);
	const offset = parseInt(url.searchParams.get('offset') ?? '0');

	const result = await serverQuery(api.debates.listArguments, {
		debateId: debateId as any,
		stance: stance ?? undefined,
		limit,
		offset
	});
	return json(result);
};

/**
 * POST /api/debates/[debateId]/arguments
 *
 * Submit a new argument to a debate. Requires Tier 3+ and ZK proof.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
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
		throw error(403, 'Tier 3+ verification required to submit arguments');
	}

	const debate = await serverQuery(api.debates.get, { debateId: debateId as any });
	if (!debate) {
		throw error(404, 'Debate not found');
	}
	if (debate.status !== 'active') {
		throw error(400, 'Debate is not active');
	}
	if (new Date() > new Date(debate.deadline)) {
		throw error(400, 'Debate deadline has passed');
	}

	const body = await request.json();
	const { stance, body: argumentBody, amendmentText, stakeAmount, proofHex, publicInputs, nullifierHex, walletAddress } = body;

	const stakeNum = Number(stakeAmount);
	if (!stakeAmount || isNaN(stakeNum) || stakeNum <= 0 || stakeNum > 100_000_000_000) {
		throw error(400, 'stakeAmount must be a positive number up to 100 billion (micro-units)');
	}

	if (!['SUPPORT', 'OPPOSE', 'AMEND'].includes(stance)) {
		throw error(400, 'stance must be SUPPORT, OPPOSE, or AMEND');
	}
	if (!argumentBody || typeof argumentBody !== 'string' || argumentBody.length < 20) {
		throw error(400, 'Argument body must be at least 20 characters');
	}
	if (stance === 'AMEND' && (!amendmentText || amendmentText.length < 5)) {
		throw error(400, 'Amendment text is required for AMEND stance');
	}
	if (!proofHex || !publicInputs || !nullifierHex) {
		throw error(400, 'ZK proof data is required');
	}

	// Nullifier dedup
	if (nullifierHex) {
		const existingNullifier = await serverQuery(api.debates.findNullifier, {
			debateId: debateId as any,
			nullifierHash: nullifierHex
		});
		if (existingNullifier) {
			throw error(409, 'You have already submitted an argument to this debate');
		}
	}

	if (walletAddress !== undefined && walletAddress !== null && !isValidEthAddress(walletAddress)) {
		throw error(400, 'walletAddress must be a valid Ethereum address (0x-prefixed, 42 chars)');
	}
	const beneficiary: string | undefined = isValidEthAddress(walletAddress) ? walletAddress : undefined;

	// Compute content hashes
	const bodyHash = solidityPackedKeccak256(['string'], [argumentBody]);
	const amendmentHash = amendmentText
		? solidityPackedKeccak256(['string'], [amendmentText])
		: undefined;

	// ── On-chain submission ──────────────────────────────────────────
	let txHash: string | undefined;
	let serverVerified = false;

	const clientTxHash = body.txHash;
	if (clientTxHash && typeof clientTxHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(clientTxHash)) {
		txHash = clientTxHash;
	} else {
		try {
			const { submitArgument } = await import('$lib/core/blockchain/debate-market-client');

			const onchainResult = await submitArgument({
				debateId: debate.debateIdOnchain,
				stance: { SUPPORT: 0, OPPOSE: 1, AMEND: 2 }[stance as string]!,
				bodyHash,
				amendmentHash: amendmentHash ?? '0x' + '0'.repeat(64),
				stakeAmount: BigInt(stakeAmount),
				proof: proofHex,
				publicInputs,
				verifierDepth: body.verifierDepth ?? 20,
				beneficiary
			});

			if (onchainResult.success) {
				txHash = onchainResult.txHash;
				serverVerified = true;
			} else if (onchainResult.error?.includes('not configured')) {
				console.warn('[debates/arguments] Blockchain not configured, creating off-chain only');
				serverVerified = true;
			} else {
				throw error(502, `On-chain argument submission failed: ${onchainResult.error}`);
			}
		} catch (err: unknown) {
			if (err && typeof err === 'object' && 'status' in err) {
				throw err;
			}
			console.warn('[debates/arguments] Blockchain not available, creating off-chain only:', err);
			serverVerified = true;
		}
	}

	// ── Convex DB write (atomic) ─────────────────────────────────────
	const argId = await serverMutation(api.debates.createArgument, {
		debateId: debateId as any,
		stance,
		body: argumentBody,
		bodyHash,
		amendmentText: amendmentText || undefined,
		amendmentHash: amendmentHash || undefined,
		nullifierHash: nullifierHex || undefined,
		stakeAmount: stakeNum,
		txHash: txHash
	});

	// Fire-and-forget: verify client-submitted tx
	if (clientTxHash && txHash) {
		verifyTransactionAsync(txHash, {
			debateId,
			type: 'argument',
			argumentId: argId,
			userId: session.userId
		});
	}

	return json({
		argumentId: argId,
		verificationStatus: serverVerified ? 'verified' : 'pending',
		...(txHash ? { txHash } : {})
	});
};
