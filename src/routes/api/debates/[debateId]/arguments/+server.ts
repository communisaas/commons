import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/core/db';
import { solidityPackedKeccak256 } from 'ethers';
import { verifyTransactionAsync } from '$lib/core/blockchain/tx-verifier';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
// CONVEX: POST is Keep SvelteKit — calls blockchain (submitArgument), solidityPackedKeccak256, tx-verifier.
// GET is dual-stacked below → debates.listArguments

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
	}

	const debate = await prisma.debate.findUnique({
		where: { id: debateId },
		select: { id: true, proposition_text: true }
	});

	if (!debate) {
		throw error(404, 'Debate not found');
	}

	const where: Record<string, unknown> = { debate_id: debateId };
	if (stance && ['SUPPORT', 'OPPOSE', 'AMEND'].includes(stance)) {
		where.stance = stance;
	}

	const arguments_ = await prisma.debateArgument.findMany({
		where,
		orderBy: { weighted_score: 'desc' },
		take: limit,
		skip: offset
	});

	return json({
		proposition: debate.proposition_text,
		arguments: arguments_.map((arg) => ({
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
			createdAt: arg.created_at.toISOString(),
			verificationStatus: arg.verification_status,
			// LMSR pricing (optional)
			currentPrice: arg.current_price ?? undefined,
			priceHistory: arg.price_history ?? undefined,
			positionCount: arg.position_count ?? undefined,
			// AI evaluation (optional, populated after resolution)
			aiScore: arg.ai_scores as Record<string, number> | undefined,
			weightedAIScore: arg.ai_weighted ?? undefined,
			finalScore: arg.final_score ?? undefined,
			modelAgreement: arg.model_agreement ?? undefined,
		}))
	});
};

/**
 * POST /api/debates/[debateId]/arguments
 *
 * Submit a new argument to a debate. Requires Tier 3+ and ZK proof.
 *
 * Body: {
 *   stance, body, amendmentText?, stakeAmount, proofHex, publicInputs, nullifierHex,
 *   walletAddress?  — the user's Ethereum wallet address; stored as beneficiary in
 *                     the on-chain StakeRecord so settlement tokens flow directly to
 *                     the user rather than the relayer. Optional — defaults to address(0)
 *                     (relayer fallback) if omitted or invalid.
 * }
 *
 * NOTE: In production, calls DebateMarket.submitArgument() on-chain.
 * Currently stores off-chain only for frontend development.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Not found');
	}

	const { debateId } = params;

	// Check authentication
	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const user = locals.user;
	if (!user || (user.trust_tier ?? 0) < 3) {
		throw error(403, 'Tier 3+ verification required to submit arguments');
	}

	const debate = await prisma.debate.findUnique({
		where: { id: debateId },
		select: { id: true, status: true, argument_count: true, deadline: true, debate_id_onchain: true }
	});

	if (!debate) {
		throw error(404, 'Debate not found');
	}
	if (debate.status !== 'active') {
		throw error(400, 'Debate is not active');
	}
	if (new Date() > debate.deadline) {
		throw error(400, 'Debate deadline has passed');
	}

	const body = await request.json();
	const { stance, body: argumentBody, amendmentText, stakeAmount, proofHex, publicInputs, nullifierHex, walletAddress } = body;

	// Validate stake amount: must be a positive number within bounds
	const stakeNum = Number(stakeAmount);
	if (!stakeAmount || isNaN(stakeNum) || stakeNum <= 0 || stakeNum > 100_000_000_000) {
		throw error(400, 'stakeAmount must be a positive number up to 100 billion (micro-units)');
	}

	// Validate stance
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

	// Check for nullifier dedup — same identity can't submit twice to the same debate
	if (nullifierHex) {
		const existingNullifier = await prisma.debateNullifier.findFirst({
			where: {
				debate_id: debateId,
				nullifier_hash: nullifierHex
			},
			select: { id: true }
		});
		if (existingNullifier) {
			throw error(409, 'You have already submitted an argument to this debate');
		}
	}

	// Validate beneficiary wallet address when provided.
	// walletAddress is optional — if absent or invalid we pass undefined and the
	// client defaults to address(0), which the contract treats as "pay relayer".
	if (walletAddress !== undefined && walletAddress !== null && !isValidEthAddress(walletAddress)) {
		throw error(400, 'walletAddress must be a valid Ethereum address (0x-prefixed, 42 chars)');
	}
	const beneficiary: string | undefined = isValidEthAddress(walletAddress) ? walletAddress : undefined;

	// Compute content hashes
	const bodyHash = solidityPackedKeccak256(['string'], [argumentBody]);
	const amendmentHash = amendmentText
		? solidityPackedKeccak256(['string'], [amendmentText])
		: null;

	// Compute weighted score: sqrt(stake) * 2^engagementTier
	// Engagement tier (civic participation, 0-4) comes from the ZK circuit's publicInputs[30],
	// NOT trust tier (identity verification, 0-5). The circuit proves the tier against the
	// engagement Merkle tree, so it's cryptographically verified and can't be inflated.
	const stakeInDollars = Number(stakeAmount) / 1e6;
	let engagementTier = 0;
	if (publicInputs && Array.isArray(publicInputs) && publicInputs.length > 30) {
		const provenTier = Number(publicInputs[30]);
		if (Number.isInteger(provenTier) && provenTier >= 0 && provenTier <= 4) {
			engagementTier = provenTier;
		}
	}

	const weightedScore = Math.floor(Math.sqrt(stakeInDollars) * Math.pow(2, engagementTier) * 1e6);

	const argumentIndex = debate.argument_count;

	// Submit argument on-chain via DebateMarket contract
	const STANCE_MAP: Record<string, number> = { SUPPORT: 0, OPPOSE: 1, AMEND: 2 };
	let txHash: string | undefined;
	// Track whether the server already confirmed the tx receipt (relayer path).
	// Client-submitted txs need async verification; server-relayed txs are already confirmed.
	let serverVerified = false;

	// Accept client-submitted tx hash (from connected EVM wallet).
	// If present and valid, skip the server-side on-chain submission.
	const clientTxHash = body.txHash;
	if (clientTxHash && typeof clientTxHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(clientTxHash)) {
		// Client already submitted the transaction via their wallet.
		// No server-side on-chain submission needed.
		txHash = clientTxHash;
		console.debug('[debates/arguments] Client-submitted tx:', {
			txHash: txHash.slice(0, 12) + '...',
			userId: session.userId
		});
	} else {
		// Legacy path: server relayer submits on-chain
			const { submitArgument } = await import('$lib/core/blockchain/debate-market-client');

			const onchainResult = await submitArgument({
				debateId: debate.debate_id_onchain,
				stance: STANCE_MAP[stance],
				bodyHash,
				amendmentHash: amendmentHash ?? '0x' + '0'.repeat(64),
				stakeAmount: BigInt(stakeAmount),
				proof: proofHex,
				publicInputs,
				verifierDepth: body.verifierDepth ?? 20,
				beneficiary  // user's wallet — receives settlement tokens directly (R-01)
			});

			if (onchainResult.success) {
				txHash = onchainResult.txHash;
				serverVerified = true; // Receipt already confirmed by server relayer
			} else if (onchainResult.error?.includes('not configured')) {
				console.warn('[debates/arguments] Blockchain not configured, creating off-chain only');
				serverVerified = true; // No chain to verify against — treat as verified
			} else {
				throw error(502, `On-chain argument submission failed: ${onchainResult.error}`);
			}
		} catch (err: unknown) {
			// Re-throw SvelteKit errors (our own 502 above)
			if (err && typeof err === 'object' && 'status' in err) {
				throw err;
			}
			// Import failure or unexpected error — treat as blockchain not configured
			console.warn('[debates/arguments] Blockchain not available, creating off-chain only:', err);
			serverVerified = true; // No chain — treat as verified
		}
	}

	// Determine initial verification status:
	// - Server relayer path: already confirmed by receipt → 'verified'
	// - Client-submitted tx: needs async verification → 'pending'
	const initialStatus = serverVerified ? 'verified' : 'pending';

	// Create argument, record nullifier, and update debate counts atomically.
	// unique_participants only increments when a new nullifier is recorded
	// (the dedup check above already threw 409 if the nullifier was seen before).
	const createArg = prisma.debateArgument.create({
		data: {
			debate_id: debateId,
			argument_index: argumentIndex,
			stance,
			body: argumentBody,
			body_hash: bodyHash,
			amendment_text: amendmentText || null,
			amendment_hash: amendmentHash,
			nullifier_hash: nullifierHex || null,
			stake_amount: BigInt(stakeAmount),
			engagement_tier: engagementTier,
			weighted_score: BigInt(weightedScore),
			total_stake: BigInt(stakeAmount),
			verification_status: initialStatus,
			...(serverVerified && { verified_at: new Date() })
		}
	});

	const updateDebate = prisma.debate.update({
		where: { id: debateId },
		data: {
			argument_count: { increment: 1 },
			unique_participants: { increment: 1 },
			total_stake: { increment: BigInt(stakeAmount) }
		}
	});

	// Record the nullifier for cross-action dedup (arguments + co-signs).
	// If nullifierHex is present, include it in the transaction.
	const txResult = nullifierHex
		? await prisma.$transaction([
				createArg,
				updateDebate,
				prisma.debateNullifier.create({
					data: {
						debate_id: debateId,
						nullifier_hash: nullifierHex,
						action_type: 'argument',
						verification_status: initialStatus,
						tx_hash: txHash ?? null
					}
				})
			])
		: await prisma.$transaction([createArg, updateDebate]);

	const argument = txResult[0];
	const nullifier = nullifierHex ? txResult[2] : null;

	// Fire-and-forget: verify client-submitted tx actually succeeded on-chain.
	// Passes argumentId + nullifierId so the verifier can update verification_status
	// and rollback on failure.
	if (clientTxHash && txHash) {
		verifyTransactionAsync(txHash, {
			debateId,
			type: 'argument',
			argumentId: argument.id,
			nullifierId: (nullifier as { id: string } | null)?.id,
			userId: session.userId
		});
	}

	return json({
		argumentId: argument.id,
		argumentIndex: argument.argument_index,
		weightedScore: argument.weighted_score.toString(),
		verificationStatus: argument.verification_status,
		...(txHash ? { txHash } : {})
	});
};
