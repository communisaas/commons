import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/core/db';
import { solidityPackedKeccak256 } from 'ethers';
import { proposeDebate, deriveDomain } from '$lib/core/blockchain/debate-market-client';
import { FEATURES } from '$lib/config/features';

/**
 * POST /api/debates/create
 *
 * Creates a new debate for a template. Requires Tier 3+ user.
 *
 * Body: { templateId, propositionText, bondAmount, duration? }
 * Returns: { debateId, debateIdOnchain, actionDomain }
 *
 * Calls DebateMarket.proposeDebate() on-chain, then stores in Prisma.
 * If blockchain is not configured (local dev), falls back to off-chain-only mode.
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

	// Verify template exists
	const template = await prisma.template.findUnique({
		where: { id: templateId },
		select: { id: true, slug: true }
	});
	if (!template) {
		throw error(404, 'Template not found');
	}

	// Check for existing active debate
	const existingDebate = await prisma.debate.findFirst({
		where: { template_id: templateId, status: 'active' },
		select: { id: true }
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
	// Call DebateMarket.proposeDebate() on Scroll. If blockchain env vars
	// are missing, fall back to off-chain-only mode for local development.
	let debateIdOnchain: string | undefined;
	let txHash: string | undefined;
	let actionDomain: string | undefined;
	let offchainOnly = false;

	// jurisdictionSizeHint drives LMSR liquidity: b = hint * baseLiquidityPerMember.
	// Must be > 0. Default 100 for testnet; real value comes from district registry.
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

		// Derive the action domain on-chain (pure function, no gas)
		try {
			actionDomain = await deriveDomain(baseDomain, propositionHash);
		} catch {
			// deriveDomain failed — compute locally as fallback
			actionDomain = computeActionDomainLocally(debateIdOnchain!, propositionHash);
		}
	} else if (onchainResult.error?.includes('not configured')) {
		// Blockchain env vars missing — local dev fallback
		console.warn('[debates/create] Blockchain not configured, creating off-chain only');
		offchainOnly = true;
	} else {
		// Genuine on-chain failure — do NOT write to DB
		throw error(502, `On-chain debate creation failed: ${onchainResult.error}`);
	}

	// ── Off-chain fallback IDs (local dev only) ──────────────────────────
	if (offchainOnly) {
		const timestamp = Math.floor(Date.now() / 1000);
		debateIdOnchain = solidityPackedKeccak256(
			['bytes32', 'uint256', 'address'],
			[propositionHash, timestamp, '0x0000000000000000000000000000000000000000']
		);
		actionDomain = computeActionDomainLocally(debateIdOnchain, propositionHash);
	}

	// Default deadline
	const durationMs = durationSeconds * 1000;
	const deadline = new Date(Date.now() + durationMs);

	// Create debate record
	const debate = await prisma.debate.create({
		data: {
			template_id: templateId,
			debate_id_onchain: debateIdOnchain!,
			action_domain: actionDomain!,
			proposition_hash: propositionHash,
			proposition_text: propositionText,
			deadline,
			jurisdiction_size: jurisdictionHint,
			status: 'active',
			proposer_address: '0x0000000000000000000000000000000000000000',
			proposer_bond: bond,
			tx_hash: txHash ?? null
		}
	});

	return json({
		debateId: debate.id,
		debateIdOnchain: debate.debate_id_onchain,
		actionDomain: debate.action_domain,
		propositionHash: debate.proposition_hash,
		deadline: debate.deadline.toISOString(),
		txHash: txHash ?? null
	});
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const BN254_MODULUS = BigInt(
	'21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

/**
 * Local action-domain computation — mirrors the on-chain deriveDomain() logic
 * for off-chain-only mode (local dev without a funded wallet).
 */
function computeActionDomainLocally(debateIdOnchain: string, propositionHash: string): string {
	const domainRaw = BigInt(
		solidityPackedKeccak256(
			['bytes32', 'string', 'bytes32'],
			[debateIdOnchain, 'debate', propositionHash]
		)
	);
	return '0x' + (domainRaw % BN254_MODULUS).toString(16).padStart(64, '0');
}
