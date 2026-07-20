// CONVEX: Keep SvelteKit — POST uses blockchain (submitArgument), solidityPackedKeccak256, tx-verifier
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { solidityPackedKeccak256 } from 'ethers';
import { FEATURES } from '$lib/config/features';
import { allowChainMisconfig } from '$lib/server/debate-chain-gate';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { readBoundedJson } from '$lib/server/bounded-json';

const DEBATE_ARGUMENT_REQUEST_MAX_BYTES = 128 * 1024;
const DEBATE_ARGUMENT_BODY_MAX = 8_000;
const DEBATE_AMENDMENT_BODY_MAX = 4_000;

function verifyTransactionAsync(_txHash: string, _context: Record<string, unknown>): void {
	// Transaction verification worker is not wired in this API boundary yet.
}

/** Returns true for a valid Ethereum address (0x-prefixed, 42 hex chars). */
function isValidEthAddress(addr: unknown): addr is string {
	return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr);
}

/**
 * GET /api/debates/[debateId]/arguments
 *
 * List arguments for a debate, sorted by weighted score.
 */
export const GET: RequestHandler = async ({ params, url, getClientAddress }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Not found');
	}
	const rate = await getRateLimiter().check(`ratelimit:debate-arguments:${getClientAddress()}`, {
		maxRequests: 60,
		windowMs: 60_000
	});
	if (!rate.allowed) return json({ error: 'Too many requests' }, { status: 429 });
	const { debateId } = params;

	const stance = url.searchParams.get('stance');
	if (stance !== null && !['SUPPORT', 'OPPOSE', 'AMEND'].includes(stance)) {
		throw error(400, 'Invalid stance');
	}
	const rawLimit = Number(url.searchParams.get('limit') ?? '25');
	if (!Number.isSafeInteger(rawLimit) || rawLimit < 1) throw error(400, 'Invalid limit');
	const limit = Math.min(rawLimit, 50);
	const cursor = url.searchParams.get('cursor');
	if (cursor && cursor.length > 2_048) throw error(400, 'Invalid cursor');

	const result = await serverQuery(api.debates.listArguments, {
		_secret: getInternalSecret(),
		debateId: debateId as Id<'debates'>,
		stance: (stance ?? undefined) as 'SUPPORT' | 'OPPOSE' | 'AMEND' | undefined,
		limit,
		cursor
	});
	return json(result);
};

/**
 * POST /api/debates/[debateId]/arguments
 *
 * Submit a new argument to a debate. Requires Tier 3+ and ZK proof.
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
		throw error(403, 'Tier 3+ verification required to submit arguments');
	}
	const rate = await getRateLimiter().check(
		`ratelimit:debate-argument-submit:${getClientAddress()}`,
		{ maxRequests: 10, windowMs: 60_000 }
	);
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

	const parsed = await readBoundedJson(request, DEBATE_ARGUMENT_REQUEST_MAX_BYTES);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw error(400, 'Invalid argument request');
	}
	const body = parsed as Record<string, any>;
	const {
		stance,
		body: argumentBody,
		amendmentText,
		stakeAmount,
		proofHex,
		publicInputs,
		nullifierHex,
		walletAddress
	} = body;

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
	if (argumentBody.length > DEBATE_ARGUMENT_BODY_MAX) {
		throw error(400, `Argument body must be ${DEBATE_ARGUMENT_BODY_MAX} characters or fewer`);
	}
	if (
		amendmentText !== undefined &&
		(typeof amendmentText !== 'string' || amendmentText.length > DEBATE_AMENDMENT_BODY_MAX)
	) {
		throw error(400, `Amendment text must be ${DEBATE_AMENDMENT_BODY_MAX} characters or fewer`);
	}
	if (stance === 'AMEND' && (!amendmentText || amendmentText.length < 5)) {
		throw error(400, 'Amendment text is required for AMEND stance');
	}
	if (
		typeof proofHex !== 'string' ||
		proofHex.length > 64 * 1024 ||
		!Array.isArray(publicInputs) ||
		publicInputs.length !== 31 ||
		typeof nullifierHex !== 'string' ||
		nullifierHex.length === 0 ||
		nullifierHex.length > 256
	) {
		throw error(400, 'ZK proof data is required');
	}

	// Nullifier dedup
	if (nullifierHex) {
		const existingNullifier = await serverQuery(api.debates.findNullifier, {
			_secret: getInternalSecret(),
			debateId: debateId as Id<'debates'>,
			nullifierHash: nullifierHex
		});
		if (existingNullifier) {
			throw error(409, 'You have already submitted an argument to this debate');
		}
	}

	if (walletAddress !== undefined && walletAddress !== null && !isValidEthAddress(walletAddress)) {
		throw error(400, 'walletAddress must be a valid Ethereum address (0x-prefixed, 42 chars)');
	}
	const beneficiary: string | undefined = isValidEthAddress(walletAddress)
		? walletAddress
		: undefined;

	// Compute content hashes
	const bodyHash = solidityPackedKeccak256(['string'], [argumentBody]);
	const amendmentHash = amendmentText
		? solidityPackedKeccak256(['string'], [amendmentText])
		: undefined;

	// ── On-chain submission ──────────────────────────────────────────
	let txHash: string | undefined;
	let serverVerified = false;
	let offchainOnly = false;

	const clientTxHash = body.txHash;
	if (
		clientTxHash &&
		typeof clientTxHash === 'string' &&
		/^0x[0-9a-fA-F]{64}$/.test(clientTxHash)
	) {
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
				allowChainMisconfig({ op: 'debates/arguments' });
				console.warn('[debates/arguments] Blockchain not configured, creating off-chain only');
				offchainOnly = true;
			} else {
				throw error(502, `On-chain argument submission failed: ${onchainResult.error}`);
			}
		} catch (err: unknown) {
			if (err && typeof err === 'object' && 'status' in err) {
				throw err;
			}
			allowChainMisconfig({ op: 'debates/arguments' });
			console.warn('[debates/arguments] Blockchain not available, creating off-chain only:', err);
			offchainOnly = true;
		}
	}

	// ── Convex DB write (atomic) ─────────────────────────────────────
	const argId = await serverMutation(api.debates.createArgument, {
		_secret: getInternalSecret(),
		debateId: debateId as Id<'debates'>,
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
		void verifyTransactionAsync(txHash, {
			debateId,
			type: 'argument',
			argumentId: argId,
			userId: session.userId
		});
	}

	return json({
		argumentId: argId,
		verificationStatus: serverVerified ? 'verified' : 'pending',
		chainStatus: offchainOnly
			? 'offchain_only'
			: serverVerified
				? 'onchain_verified'
				: 'pending_client_tx',
		...(offchainOnly
			? {
					claimBoundary:
						'Argument was recorded off-chain only; no on-chain stake transaction was executed.'
				}
			: {}),
		...(txHash ? { txHash } : {})
	});
};
