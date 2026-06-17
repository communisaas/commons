import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import { api, internal } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { solidityPackedKeccak256 } from 'ethers';
import { proposeDebate, deriveDomain } from '$lib/core/blockchain/debate-market-client';
import { FEATURES } from '$lib/config/features';
import { allowChainMisconfig } from '$lib/server/debate-chain-gate';
// Convex equivalent: debates.spawnDebate (off-chain fallback only). Blockchain path must stay here.

/**
 * POST /api/debates/create
 *
 * Creates a new debate for a template. Requires Tier 3+ user.
 *
 * Body: { templateId, propositionText, bondAmount, duration? }
 * Returns: { debateId, debateIdOnchain, actionDomain }
 *
 * Calls DebateMarket.proposeDebate() on-chain, then stores in Convex.
 * If blockchain is not configured, production fails closed unless explicitly
 * opted into off-chain-only operation; local development can proceed off-chain.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Not found');
	}
	// Check authentication
	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const user = locals.user;
	if (!user || (user.trust_tier ?? 0) < 3) {
		throw error(403, 'Tier 3+ verification required to create debates');
	}

	const body = await request.json();
	const { templateId, propositionText, bondAmount, duration } = body;

	if (!templateId || typeof templateId !== 'string') {
		throw error(400, 'templateId is required');
	}
	if (!propositionText || typeof propositionText !== 'string' || propositionText.length < 10) {
		throw error(400, 'propositionText must be at least 10 characters');
	}
	if (propositionText.length > 4000) {
		throw error(400, 'propositionText must be 4000 characters or fewer');
	}

	// Check for existing active debate on this template
	const existingDebate = await serverQuery(api.debates.getByTemplateId, {
		templateId: templateId as Id<'templates'>
	});
	if (existingDebate) {
		throw error(409, 'An active debate already exists for this template');
	}

	// Compute proposition hash
	const propositionHash = solidityPackedKeccak256(['string'], [propositionText]);

	// On-chain contract params
	const durationSeconds = duration ?? 7 * 24 * 60 * 60;
	const bond = BigInt(bondAmount ?? 1_000_000);
	const baseDomain = '0x' + '0'.repeat(62) + '64'; // test action domain = bytes32(uint256(100))

	// ── On-chain call ────────────────────────────────────────────────────
	let debateIdOnchain: string | undefined;
	let txHash: string | undefined;
	let actionDomain: string | undefined;
	let offchainOnly = false;

	const jurisdictionHint = body.jurisdictionSizeHint ?? 100;

	const onchainResult = await proposeDebate({
		propositionHash,
		duration: durationSeconds,
		jurisdictionSizeHint: jurisdictionHint,
		baseDomain,
		bondAmount: bond
	});

	if (onchainResult.success) {
		debateIdOnchain = onchainResult.debateId;
		txHash = onchainResult.txHash;

		try {
			actionDomain = await deriveDomain(baseDomain, propositionHash);
		} catch {
			actionDomain = computeActionDomainLocally(debateIdOnchain!, propositionHash);
		}
	} else if (onchainResult.error?.includes('not configured')) {
		allowChainMisconfig({ op: 'debates/create' });
		console.warn('[debates/create] Blockchain not configured, creating off-chain only');
		offchainOnly = true;
	} else {
		throw error(502, `On-chain debate creation failed: ${onchainResult.error}`);
	}

	if (offchainOnly) {
		const timestamp = Math.floor(Date.now() / 1000);
		debateIdOnchain = solidityPackedKeccak256(
			['bytes32', 'uint256', 'address'],
			[propositionHash, timestamp, '0x0000000000000000000000000000000000000000']
		);
		actionDomain = computeActionDomainLocally(debateIdOnchain, propositionHash);
	}

	const durationMs = durationSeconds * 1000;
	const deadlineMs = Date.now() + durationMs;

	// Create debate record via Convex
	const debateId = await serverMutation(api.debates.insertDebateForCaller, {
		_secret: getInternalSecret(),
		templateId: templateId as Id<'templates'>,
		debateIdOnchain: debateIdOnchain!,
		actionDomain: actionDomain!,
		propositionHash,
		propositionText,
		deadline: deadlineMs,
		jurisdictionSize: jurisdictionHint,
		proposerAddress: '0x0000000000000000000000000000000000000000',
		proposerBond: Number(bond),
		txHash: txHash ?? undefined
	});

	return json({
		debateId,
		debateIdOnchain,
		actionDomain,
		propositionHash,
		deadline: new Date(deadlineMs).toISOString(),
		txHash: txHash ?? null,
		chainStatus: offchainOnly ? 'offchain_only' : 'onchain_proposed',
		...(offchainOnly
			? {
					claimBoundary:
						'Debate was recorded off-chain only; no on-chain proposal transaction was executed.'
				}
			: {})
	});
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const BN254_MODULUS = BigInt(
	'21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

function computeActionDomainLocally(debateIdOnchain: string, propositionHash: string): string {
	const domainRaw = BigInt(
		solidityPackedKeccak256(
			['bytes32', 'string', 'bytes32'],
			[debateIdOnchain, 'debate', propositionHash]
		)
	);
	return '0x' + (domainRaw % BN254_MODULUS).toString(16).padStart(64, '0');
}
