// CONVEX: Keep SvelteKit — calls blockchain (claimSettlement, settlePrivatePosition).
// Settlement requires on-chain tx execution. Cannot move to Convex.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/core/db';
import { claimSettlement, settlePrivatePosition } from '$lib/core/blockchain/debate-market-client';
import { FEATURES } from '$lib/config/features';

/** Returns true for a valid Ethereum address (0x-prefixed, 42 hex chars). */
function isValidEthAddress(addr: unknown): addr is string {
	return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr);
}

/**
 * POST /api/debates/[debateId]/claim
 *
 * Claim settlement from a resolved debate. Supports two settlement paths:
 *
 * Path 1 — Simple claim (Phase 1):
 *   Calls DebateMarket.claimSettlement(debateId, nullifier).
 *   Used when the user staked via submitArgument / coSignArgument and the
 *   settlement record is stored directly in the contract.
 *   Body: { nullifierHex, proofHex, publicInputs, walletAddress? }
 *
 * Path 2 — Private position settlement (Phase 2):
 *   Calls DebateMarket.settlePrivatePosition(debateId, positionProof, positionPublicInputs).
 *   Used when the user held a private LMSR position (committed via commitTrade /
 *   revealTrade) and wants to settle without revealing their identity on-chain.
 *   Body: { nullifierHex, proofHex, publicInputs, positionProof, positionPublicInputs, walletAddress? }
 *
 * Post R-01: the contract transfers payout to record.beneficiary (set at
 * argument submission time), not to msg.sender (the relayer). The relayer
 * still initiates the transaction for gas abstraction.
 *
 * NOTE: Full claim tracking (per-nullifier settlement records) requires the
 * chain event indexer (SettlementClaimed events). Until then, claims are
 * tracked via structured server logs and on-chain transaction receipts.
 */
export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Not found');
	}

	const { debateId } = params;

	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const debate = await prisma.debate.findUnique({
		where: { id: debateId },
		select: {
			id: true,
			status: true,
			winning_argument_index: true,
			winning_stance: true,
			total_stake: true,
			debate_id_onchain: true
		}
	});

	if (!debate) {
		throw error(404, 'Debate not found');
	}
	if (debate.status !== 'resolved') {
		throw error(400, 'Debate has not been resolved yet');
	}

	const body = await request.json();
	const { nullifierHex, proofHex, publicInputs, positionProof, positionPublicInputs, walletAddress } = body;

	if (!nullifierHex || !proofHex || !publicInputs) {
		throw error(400, 'ZK proof data is required for settlement claims');
	}

	// Phase 2: private position settlement requires exactly 5 bytes32 public inputs.
	const isPrivateSettlement = positionProof !== undefined && positionProof !== null;

	if (isPrivateSettlement) {
		if (!Array.isArray(positionPublicInputs) || positionPublicInputs.length !== 5) {
			throw error(400, 'positionPublicInputs must be an array of exactly 5 bytes32 hex strings');
		}
		for (let i = 0; i < 5; i++) {
			if (typeof positionPublicInputs[i] !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(positionPublicInputs[i])) {
				throw error(400, `positionPublicInputs[${i}] must be a 0x-prefixed 32-byte hex string`);
			}
		}
		if (typeof positionProof !== 'string' || !/^(0x)?[0-9a-fA-F]+$/.test(positionProof)) {
			throw error(400, 'positionProof must be a hex-encoded byte string');
		}
	}

	// Validate walletAddress for audit logging when provided.
	// This is NOT used to gate the claim — the contract enforces the beneficiary check.
	// It exists purely so the server log records which user wallet expected to receive tokens.
	if (walletAddress !== undefined && walletAddress !== null && !isValidEthAddress(walletAddress)) {
		throw error(400, 'walletAddress must be a valid Ethereum address (0x-prefixed, 42 chars)');
	}
	const claimantWallet: string | null = isValidEthAddress(walletAddress) ? walletAddress : null;

	// Attempt on-chain settlement if the debate has been registered on-chain
	if (debate.debate_id_onchain) {
		if (isPrivateSettlement) {
			// Path 2: ZK private position settlement
			const onchainResult = await settlePrivatePosition(
				debate.debate_id_onchain,
				positionProof as string,
				positionPublicInputs as [string, string, string, string, string]
			);

			if (onchainResult.success) {
				console.info('[debates/claim] Private position settled on-chain', {
					debateId: debate.id,
					debateIdOnchain: debate.debate_id_onchain,
					positionRoot: (positionPublicInputs as string[])[0].slice(0, 16) + '...',
					txHash: onchainResult.txHash,
					winningStance: debate.winning_stance,
					...(claimantWallet ? { beneficiaryWallet: claimantWallet } : {})
				});

				return json({
					debateId: debate.id,
					status: 'settlement_claimed',
					settlementPath: 'private_position',
					txHash: onchainResult.txHash,
					winningStance: debate.winning_stance
				});
			} else if (onchainResult.error?.includes('not configured')) {
				console.warn('[debates/claim] Blockchain not configured, returning stub');
				// Fall through to off-chain stub response
			} else {
				throw error(502, `On-chain private settlement failed: ${onchainResult.error}`);
			}
		} else {
			// Path 1: Simple nullifier-based claim
			const onchainResult = await claimSettlement(debate.debate_id_onchain, nullifierHex);

			if (onchainResult.success) {
				console.info('[debates/claim] Settlement claimed on-chain', {
					debateId: debate.id,
					debateIdOnchain: debate.debate_id_onchain,
					nullifier: nullifierHex.slice(0, 16) + '...',
					txHash: onchainResult.txHash,
					winningStance: debate.winning_stance,
					...(claimantWallet ? { beneficiaryWallet: claimantWallet } : {})
				});

				return json({
					debateId: debate.id,
					status: 'settlement_claimed',
					settlementPath: 'simple_claim',
					txHash: onchainResult.txHash,
					winningStance: debate.winning_stance
				});
			} else if (onchainResult.error?.includes('not configured')) {
				console.warn('[debates/claim] Blockchain not configured, returning stub');
				// Fall through to off-chain stub response
			} else {
				throw error(502, `On-chain settlement claim failed: ${onchainResult.error}`);
			}
		}
	}

	// Fallback: blockchain not configured or debate not registered on-chain
	const settlementPath = isPrivateSettlement ? 'private_position' : 'simple_claim';
	console.info('[debates/claim] Settlement claim recorded (off-chain)', {
		debateId: debate.id,
		settlementPath,
		nullifier: nullifierHex.slice(0, 16) + '...',
		winningStance: debate.winning_stance,
		note: 'Off-chain only — no on-chain settlement executed',
		...(claimantWallet ? { beneficiaryWallet: claimantWallet } : {})
	});

	return json({
		debateId: debate.id,
		status: 'claim_recorded',
		settlementPath,
		winningStance: debate.winning_stance,
		message: 'Settlement claim recorded. On-chain execution pending contract integration.'
	});
};
