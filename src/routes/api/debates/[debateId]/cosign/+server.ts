import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/core/db';
import { verifyTransactionAsync } from '$lib/core/blockchain/tx-verifier';

/** Returns true for a valid Ethereum address (0x-prefixed, 42 hex chars). */
function isValidEthAddress(addr: unknown): addr is string {
	return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr);
}

/**
 * POST /api/debates/[debateId]/cosign
 *
 * Co-sign an existing argument. Requires Tier 3+ and ZK proof.
 *
 * Body: {
 *   argumentIndex, stakeAmount, proofHex, publicInputs, nullifierHex, verifierDepth?,
 *   walletAddress?  — the co-signer's Ethereum wallet address; stored as beneficiary
 *                     in the on-chain StakeRecord so settlement tokens flow directly
 *                     to the user rather than the relayer. Optional — defaults to
 *                     address(0) (relayer fallback) if omitted or invalid.
 * }
 *
 * Calls DebateMarket.coSignArgument() on-chain when blockchain is configured,
 * then updates Prisma. Falls back to off-chain-only mode when blockchain env
 * vars are not set.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { debateId } = params;

	// Check authentication
	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const user = locals.user;
	if (!user || (user.trust_tier ?? 0) < 3) {
		throw error(403, 'Tier 3+ verification required to co-sign arguments');
	}

	const debate = await prisma.debate.findUnique({
		where: { id: debateId },
		select: { id: true, status: true, deadline: true, debate_id_onchain: true }
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
	const { argumentIndex, stakeAmount, proofHex, publicInputs, nullifierHex, walletAddress } = body;

	// Validate stake amount: must be a positive number within bounds
	const stakeNum = Number(stakeAmount);
	if (!stakeAmount || isNaN(stakeNum) || stakeNum <= 0 || stakeNum > 100_000_000_000) {
		throw error(400, 'stakeAmount must be a positive number up to 100 billion (micro-units)');
	}

	if (argumentIndex === undefined || typeof argumentIndex !== 'number') {
		throw error(400, 'argumentIndex is required');
	}
	if (!stakeAmount || !proofHex || !publicInputs || !nullifierHex) {
		throw error(400, 'stakeAmount, proof data are required');
	}

	// Nullifier dedup — one co-sign per identity per debate.
	// Checks the unified DebateNullifier table, so this also prevents
	// co-signing if you already submitted an argument (and vice versa).
	if (nullifierHex) {
		const existingNullifier = await prisma.debateNullifier.findFirst({
			where: {
				debate_id: debateId,
				nullifier_hash: nullifierHex
			},
			select: { id: true }
		});
		if (existingNullifier) {
			throw error(409, 'You have already participated in this debate');
		}
	}

	// Validate beneficiary wallet address when provided.
	// walletAddress is optional — if absent or invalid we pass undefined and the
	// client defaults to address(0), which the contract treats as "pay relayer".
	if (walletAddress !== undefined && walletAddress !== null && !isValidEthAddress(walletAddress)) {
		throw error(400, 'walletAddress must be a valid Ethereum address (0x-prefixed, 42 chars)');
	}
	const beneficiary: string | undefined = isValidEthAddress(walletAddress) ? walletAddress : undefined;

	// Find the argument
	const argument = await prisma.debateArgument.findUnique({
		where: {
			debate_id_argument_index: {
				debate_id: debateId,
				argument_index: argumentIndex
			}
		}
	});

	if (!argument) {
		throw error(404, 'Argument not found');
	}

	// ── On-chain co-sign via DebateMarket ──────────────────────────────
	let txHash: string | undefined;
	let serverVerified = false;

	// Accept client-submitted tx hash (from connected EVM wallet).
	// If present and valid, skip the server-side on-chain submission.
	const clientTxHash = body.txHash;
	if (clientTxHash && typeof clientTxHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(clientTxHash)) {
		// Client already submitted the transaction via their wallet.
		// No server-side on-chain submission needed.
		txHash = clientTxHash;
		console.debug('[debates/cosign] Client-submitted tx:', {
			txHash: txHash.slice(0, 12) + '...',
			userId: session.userId
		});
	} else {
		// Legacy path: server relayer submits on-chain
		try {
			const { coSignArgument } = await import('$lib/core/blockchain/debate-market-client');

			const onchainResult = await coSignArgument({
				debateId: debate.debate_id_onchain!,
				argumentIndex,
				stakeAmount: BigInt(stakeAmount),
				proof: proofHex,
				publicInputs,
				verifierDepth: body.verifierDepth ?? 20,
				deadline: body.deadline,
				beneficiary  // user's wallet — receives settlement tokens directly (R-01)
			});

			if (onchainResult.success) {
				txHash = onchainResult.txHash;
				serverVerified = true;
			} else if (onchainResult.error?.includes('not configured')) {
				console.warn('[debates/cosign] Blockchain not configured, updating off-chain only');
				serverVerified = true;
			} else {
				throw error(502, `On-chain co-sign failed: ${onchainResult.error}`);
			}
		} catch (err: unknown) {
			// Re-throw SvelteKit HttpErrors (our own 502 above) as-is
			if (err && typeof err === 'object' && 'status' in err) {
				throw err;
			}
			// Unexpected import/runtime errors — treat as blockchain-not-configured
			console.warn('[debates/cosign] Blockchain module unavailable, updating off-chain only:', err);
			serverVerified = true;
		}
	}

	const initialStatus = serverVerified ? 'verified' : 'pending';

	// ── Prisma off-chain update ────────────────────────────────────────
	// Extract co-signer's engagement tier with server-side enforcement.
	// In off-chain mode the ZK proof isn't verified, so we clamp to the
	// server-known trust tier to prevent client-side tier inflation.
	const serverTier = user.trust_tier ?? 0;
	const claimedTier = Number(publicInputs[30]);
	if (!Number.isInteger(claimedTier) || claimedTier < 0 || claimedTier > 7) {
		throw error(400, 'Invalid engagement tier in public inputs');
	}
	const coSignerTier = Math.min(claimedTier, Math.min(serverTier, 4));
	if (claimedTier > serverTier) {
		console.warn(`[debates/cosign] Tier inflation attempt: claimed=${claimedTier}, actual=${serverTier}, user=${session.userId}`);
	}

	// Compute the co-signer's individual weight contribution
	// Mirrors on-chain: sqrt(stake) * 2^tier
	const coSignerWeight = BigInt(
		Math.floor(
			Math.sqrt(Number(BigInt(stakeAmount)) / 1e6) *
				Math.pow(2, coSignerTier) *
				1e6
		)
	);

	// Update argument with co-sign data, record nullifier, and update debate totals atomically.
	// unique_participants only increments when a new nullifier is recorded
	// (the dedup check above already threw 409 if the nullifier was seen before).
	const updateArg = prisma.debateArgument.update({
		where: { id: argument.id },
		data: {
			co_sign_count: { increment: 1 },
			total_stake: { increment: BigInt(stakeAmount) },
			// Increment weighted_score by the co-signer's individual contribution
			// Each co-signer contributes sqrt(their_stake) * 2^(their_tier)
			weighted_score: { increment: coSignerWeight }
		}
	});

	const updateDebate = prisma.debate.update({
		where: { id: debateId },
		data: {
			unique_participants: { increment: 1 },
			total_stake: { increment: BigInt(stakeAmount) }
		}
	});

	// Record the nullifier for cross-action dedup (arguments + co-signs).
	// Store cosign_weight and argument_id for verification rollback (Q1 integrity fix).
	// If nullifierHex is present, include it in the transaction.
	let nullifier: { id: string } | null = null;
	if (nullifierHex) {
		const txResult = await prisma.$transaction([
			updateArg,
			updateDebate,
			prisma.debateNullifier.create({
				data: {
					debate_id: debateId,
					nullifier_hash: nullifierHex,
					action_type: 'cosign',
					verification_status: initialStatus,
					cosign_weight: coSignerWeight,
					argument_id: argument.id,
					tx_hash: txHash ?? null
				}
			})
		]);
		nullifier = txResult[2];
	} else {
		await prisma.$transaction([updateArg, updateDebate]);
	}

	// Fire-and-forget: verify client-submitted tx actually succeeded on-chain.
	// Passes nullifierId so the verifier can rollback cosign weight on failure.
	if (clientTxHash && txHash) {
		verifyTransactionAsync(txHash, {
			debateId,
			type: 'cosign',
			nullifierId: nullifier?.id,
			userId: session.userId
		});
	}

	return json({ success: true, ...(txHash ? { txHash } : {}) });
};
