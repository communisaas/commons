/**
 * Async transaction receipt verification with DB rollback.
 *
 * When clients submit a txHash directly (bypass path), this module
 * verifies the transaction actually succeeded on-chain. Runs as a
 * fire-and-forget background check — does NOT block the API response.
 *
 * On success: marks argument/cosign as 'verified'.
 * On failure: marks as 'rejected' and rolls back weighted_score for cosigns.
 *
 * SERVER-ONLY: Uses $env/dynamic/private for RPC URL.
 */

import { env } from '$env/dynamic/private';
import { JsonRpcProvider } from 'ethers';
import { prisma } from '$lib/core/db';
import { captureWithContext } from '$lib/server/monitoring/sentry';

/** Public fallback RPC for Scroll Sepolia when env var is not set. */
const SCROLL_SEPOLIA_PUBLIC_RPC = 'https://sepolia-rpc.scroll.io';

export interface VerificationContext {
	debateId: string;
	type: 'argument' | 'cosign';
	argumentId?: string;
	nullifierId?: string;
	userId?: string;
}

/**
 * Fire-and-forget transaction receipt verification.
 *
 * Checks whether the given txHash was mined and succeeded on-chain.
 * Retries once after 5 s if the receipt is not yet available (tx may
 * still be propagating / indexing).
 *
 * On verified: sets verification_status → 'verified' + verified_at.
 * On rejected: sets verification_status → 'rejected' + rolls back cosign weight.
 * On not found: leaves as 'pending' for periodic cleanup.
 *
 * This function NEVER throws — all errors are caught and logged so
 * callers can safely invoke it without `await`.
 */
export function verifyTransactionAsync(txHash: string, context: VerificationContext): void {
	// Launch the async work without awaiting — truly fire-and-forget.
	_verify(txHash, context).catch(() => {
		// Belt-and-suspenders: _verify already has its own try/catch,
		// but guard against any unforeseen rejection escaping.
	});
}

async function _verify(txHash: string, context: VerificationContext): Promise<void> {
	try {
		const rpcUrl = env.SCROLL_RPC_URL || SCROLL_SEPOLIA_PUBLIC_RPC;
		const provider = new JsonRpcProvider(rpcUrl);

		let receipt = await provider.getTransactionReceipt(txHash);

		// Retry once after 5 s — the tx may not be indexed yet.
		if (receipt === null) {
			await new Promise((r) => setTimeout(r, 5_000));
			receipt = await provider.getTransactionReceipt(txHash);
		}

		if (receipt === null) {
			console.warn(
				`[tx-verifier] NOT FOUND: ${txHash} not on-chain after timeout for ${context.type} in debate ${context.debateId}`
			);
			// Leave as 'pending' — periodic cleanup will handle stale entries.
			return;
		}

		if (receipt.status === 1) {
			await _markVerified(context);
			console.log(
				`[tx-verifier] Verified: ${txHash} for ${context.type} in debate ${context.debateId}`
			);
		} else {
			await _markRejected(context);
			console.warn(
				`[tx-verifier] FAILED: ${txHash} reverted on-chain for ${context.type} in debate ${context.debateId} — rolled back`
			);
		}
	} catch (err) {
		// Fire-and-forget: never propagate errors.
		console.warn(
			`[tx-verifier] Error checking ${txHash} for ${context.type} in debate ${context.debateId}:`,
			err
		);
		captureWithContext(err, { action: 'tx-verify', orgId: context.debateId });
	}
}

/**
 * Mark argument/cosign as verified in the database.
 */
async function _markVerified(ctx: VerificationContext): Promise<void> {
	await prisma.$transaction(async (tx) => {
		if (ctx.type === 'argument' && ctx.argumentId) {
			await tx.debateArgument.update({
				where: { id: ctx.argumentId },
				data: { verification_status: 'verified', verified_at: new Date() }
			});
		}

		if (ctx.nullifierId) {
			await tx.debateNullifier.update({
				where: { id: ctx.nullifierId },
				data: { verification_status: 'verified' }
			});
		}
	});
}

/**
 * Mark argument/cosign as rejected and roll back weighted_score for cosigns.
 */
async function _markRejected(ctx: VerificationContext): Promise<void> {
	if (ctx.type === 'argument' && ctx.argumentId) {
		await prisma.$transaction(async (tx) => {
			await tx.debateArgument.update({
				where: { id: ctx.argumentId! },
				data: { verification_status: 'rejected' }
			});

			if (ctx.nullifierId) {
				await tx.debateNullifier.update({
					where: { id: ctx.nullifierId! },
					data: { verification_status: 'rejected' }
				});
			}
		});
	} else if (ctx.type === 'cosign' && ctx.nullifierId) {
		// Reject the cosign and roll back its weight contribution.
		const nullifier = await prisma.debateNullifier.findUnique({
			where: { id: ctx.nullifierId },
			select: { cosign_weight: true, argument_id: true }
		});

		if (nullifier?.cosign_weight && nullifier.argument_id) {
			await prisma.$transaction(async (tx) => {
				await tx.debateNullifier.update({
					where: { id: ctx.nullifierId! },
					data: { verification_status: 'rejected' }
				});
				await tx.debateArgument.update({
					where: { id: nullifier.argument_id! },
					data: {
						weighted_score: { decrement: nullifier.cosign_weight! },
						co_sign_count: { decrement: 1 },
						total_stake: { decrement: nullifier.cosign_weight! }
					}
				});
			});
		} else {
			await prisma.debateNullifier.update({
				where: { id: ctx.nullifierId },
				data: { verification_status: 'rejected' }
			});
		}
	}
}
