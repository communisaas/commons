// CONVEX: Keep SvelteKit — POST uses blockchain (coSignArgument), tx-verifier
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { FEATURES } from '$lib/config/features';
import { allowChainMisconfig } from '$lib/server/debate-chain-gate';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { readBoundedJson } from '$lib/server/bounded-json';

const DEBATE_COSIGN_REQUEST_MAX_BYTES = 128 * 1024;

function verifyTransactionAsync(_txHash: string, _context: Record<string, unknown>): void {
	// Transaction verification worker is not wired in this API boundary yet.
}

/** Returns true for a valid Ethereum address (0x-prefixed, 42 hex chars). */
function isValidEthAddress(addr: unknown): addr is string {
	return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr);
}

/**
 * POST /api/debates/[debateId]/cosign
 *
 * Co-sign an existing argument. Requires Tier 3+ and ZK proof.
 */
export const POST: RequestHandler = async ({ params, request, locals, getClientAddress }) => {
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
		throw error(403, 'Tier 3+ verification required to co-sign arguments');
	}
	const rate = await getRateLimiter().check(`ratelimit:debate-cosign:${getClientAddress()}`, {
		maxRequests: 20,
		windowMs: 60_000
	});
	if (!rate.allowed) return json({ error: 'Too many requests' }, { status: 429 });

	const debate = await serverQuery(api.debates.get, {
		_secret: getInternalSecret(),
		debateId: debateId as Id<'debates'>
	});
	if (!debate) {
		throw error(404, 'Debate not found');
	}
	if (debate.status !== 'active') {
		throw error(400, 'Debate is not active');
	}
	if (new Date() > new Date(debate.deadline)) {
		throw error(400, 'Debate deadline has passed');
	}

	const parsed = await readBoundedJson(request, DEBATE_COSIGN_REQUEST_MAX_BYTES);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw error(400, 'Invalid co-sign request');
	}
	const body = parsed as Record<string, any>;
	const { argumentIndex, stakeAmount, proofHex, publicInputs, nullifierHex, walletAddress } = body;

	const stakeNum = Number(stakeAmount);
	if (!stakeAmount || isNaN(stakeNum) || stakeNum <= 0 || stakeNum > 100_000_000_000) {
		throw error(400, 'stakeAmount must be a positive number up to 100 billion (micro-units)');
	}

	if (!Number.isSafeInteger(argumentIndex) || argumentIndex < 0) {
		throw error(400, 'argumentIndex is required');
	}
	if (
		!stakeAmount ||
		typeof proofHex !== 'string' ||
		proofHex.length > 64 * 1024 ||
		!Array.isArray(publicInputs) ||
		publicInputs.length !== 31 ||
		typeof nullifierHex !== 'string' ||
		nullifierHex.length === 0 ||
		nullifierHex.length > 256
	) {
		throw error(400, 'stakeAmount, proof data are required');
	}

	// Nullifier dedup
	if (nullifierHex) {
		const existingNullifier = await serverQuery(api.debates.findNullifier, {
			_secret: getInternalSecret(),
			debateId: debateId as Id<'debates'>,
			nullifierHash: nullifierHex
		});
		if (existingNullifier) {
			throw error(409, 'You have already participated in this debate');
		}
	}

	if (walletAddress !== undefined && walletAddress !== null && !isValidEthAddress(walletAddress)) {
		throw error(400, 'walletAddress must be a valid Ethereum address (0x-prefixed, 42 chars)');
	}
	const beneficiary: string | undefined = isValidEthAddress(walletAddress)
		? walletAddress
		: undefined;

	// ── On-chain co-sign via DebateMarket ──────────────────────────────
	let txHash: string | undefined;
	let serverVerified = false;

	const clientTxHash = body.txHash;
	if (
		clientTxHash &&
		typeof clientTxHash === 'string' &&
		/^0x[0-9a-fA-F]{64}$/.test(clientTxHash)
	) {
		txHash = clientTxHash;
	} else {
		try {
			const { coSignArgument } = await import('$lib/core/blockchain/debate-market-client');

			const onchainResult = await coSignArgument({
				debateId: debate.debateIdOnchain!,
				argumentIndex,
				stakeAmount: BigInt(stakeAmount),
				proof: proofHex,
				publicInputs,
				verifierDepth: body.verifierDepth ?? 20,
				deadline: body.deadline,
				beneficiary
			});

			if (onchainResult.success) {
				txHash = onchainResult.txHash;
				serverVerified = true;
			} else if (onchainResult.error?.includes('not configured')) {
				// Fails-closed in prod; fall through off-chain only in dev or via opt-in.
				allowChainMisconfig({ op: 'debates/cosign' });
				console.warn('[debates/cosign] Blockchain not configured, updating off-chain only');
				serverVerified = true;
			} else {
				throw error(502, `On-chain co-sign failed: ${onchainResult.error}`);
			}
		} catch (err: unknown) {
			// Re-throw SvelteKit errors (our 502) and the prod-gate throw.
			if (err && typeof err === 'object' && 'status' in err) {
				throw err;
			}
			// Module import or unexpected failure — fails-closed in prod.
			allowChainMisconfig({ op: 'debates/cosign' });
			console.warn('[debates/cosign] Blockchain module unavailable, updating off-chain only:', err);
			serverVerified = true;
		}
	}

	// ── Convex DB write (atomic) ─────────────────────────────────────
	await serverMutation(api.debates.cosign, {
		_secret: getInternalSecret(),
		debateId: debateId as Id<'debates'>,
		argumentIndex,
		stakeAmount: stakeNum,
		nullifierHash: nullifierHex,
		txHash: txHash
	});

	// Fire-and-forget: verify client-submitted tx
	if (clientTxHash && txHash) {
		void verifyTransactionAsync(txHash, {
			debateId,
			type: 'cosign',
			userId: session.userId
		});
	}

	return json({ success: true, ...(txHash ? { txHash } : {}) });
};
