import { db } from '$lib/core/db';
import { solidityPackedKeccak256 } from 'ethers';
import { proposeDebate, deriveDomain } from '$lib/core/blockchain/debate-market-client';

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

/**
 * Spawn a debate for a campaign if eligible.
 *
 * Returns the new debate ID on success, or null if:
 * - Campaign not found
 * - Debate not enabled on campaign
 * - Campaign already has a linked debate
 * - Campaign has no templateId
 *
 * Structured in 3 phases to avoid holding a DB connection during
 * blockchain round-trips:
 * 1. Short read transaction — eligibility check
 * 2. Open code — on-chain call (3-30s) outside any transaction
 * 3. Short write transaction — create Debate row + link campaign
 *    with SELECT FOR UPDATE race guard
 */
export async function spawnDebateForCampaign(
	campaignId: string,
	opts?: {
		proposition?: string;
		durationDays?: number;
		jurisdictionSizeHint?: number;
	}
): Promise<{ debateId: string } | null> {
	// ── Phase 1: Short read transaction — eligibility + existing debate check ──
	const readResult = await db.$transaction(async (tx) => {
		const campaign = await tx.campaign.findUnique({
			where: { id: campaignId },
			select: {
				id: true,
				title: true,
				templateId: true,
				debateEnabled: true,
				debateId: true,
				debateThreshold: true
			}
		});

		if (!campaign || !campaign.debateEnabled || campaign.debateId) return null;
		if (!campaign.templateId) return null;

		// Check for existing active debate on the same template — link it instead
		const existingDebate = await tx.debate.findFirst({
			where: { template_id: campaign.templateId, status: 'active' },
			select: { id: true }
		});
		if (existingDebate) {
			await tx.campaign.update({
				where: { id: campaignId },
				data: { debateId: existingDebate.id }
			});
			return { linked: true as const, debateId: existingDebate.id };
		}

		return {
			linked: false as const,
			title: campaign.title,
			templateId: campaign.templateId
		};
	});

	if (!readResult) return null;
	if (readResult.linked) return { debateId: readResult.debateId };

	const { title, templateId } = readResult;

	// ── Phase 2: On-chain call OUTSIDE any transaction ──
	const propositionText =
		opts?.proposition ?? `Should we support: "${title}"?`;
	const durationDays = opts?.durationDays ?? 7;
	const durationSeconds = durationDays * 24 * 60 * 60;
	const jurisdictionHint = opts?.jurisdictionSizeHint ?? 100;
	const bond = BigInt(1_000_000);

	const propositionHash = solidityPackedKeccak256(['string'], [propositionText]);
	const baseDomain = '0x' + '0'.repeat(62) + '64';

	let debateIdOnchain: string;
	let txHash: string | undefined;
	let actionDomain: string;

	const onchainResult = await proposeDebate({
		propositionHash,
		duration: durationSeconds,
		jurisdictionSizeHint: jurisdictionHint,
		baseDomain,
		bondAmount: bond
	});

	if (onchainResult.success) {
		debateIdOnchain = onchainResult.debateId!;
		txHash = onchainResult.txHash;
		try {
			actionDomain = await deriveDomain(baseDomain, propositionHash);
		} catch {
			actionDomain = computeActionDomainLocally(debateIdOnchain, propositionHash);
		}
	} else if (onchainResult.error?.includes('not configured')) {
		const timestamp = Math.floor(Date.now() / 1000);
		debateIdOnchain = solidityPackedKeccak256(
			['bytes32', 'uint256', 'address'],
			[propositionHash, timestamp, '0x0000000000000000000000000000000000000000']
		);
		actionDomain = computeActionDomainLocally(debateIdOnchain, propositionHash);
	} else {
		console.error('[spawnDebateForCampaign] On-chain failed:', onchainResult.error);
		return null;
	}

	const deadline = new Date(Date.now() + durationSeconds * 1000);

	// ── Phase 3: Short write transaction with retry for orphan prevention ──
	const MAX_RETRIES = 3;
	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		try {
			return await db.$transaction(async (tx) => {
				// Lock the campaign row to prevent concurrent spawns from both writing
				const [locked] = await tx.$queryRaw<Array<{ debate_id: string | null }>>`
					SELECT debate_id FROM "campaign" WHERE id = ${campaignId} FOR UPDATE
				`;
				if (locked?.debate_id) return null; // Another spawn won the race

				const debate = await tx.debate.create({
					data: {
						template_id: templateId,
						debate_id_onchain: debateIdOnchain,
						action_domain: actionDomain,
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

				await tx.campaign.update({
					where: { id: campaignId },
					data: { debateId: debate.id }
				});

				return { debateId: debate.id };
			});
		} catch (err) {
			if (attempt === MAX_RETRIES) {
				console.error('[spawnDebateForCampaign] ORPHAN: Phase 3 failed after on-chain success', {
					campaignId,
					debateIdOnchain,
					txHash,
					error: err instanceof Error ? err.message : String(err)
				});
				return null;
			}
			// Exponential backoff: 500ms, 1000ms
			await new Promise((r) => setTimeout(r, 500 * attempt));
		}
	}
	return null; // TypeScript exhaustiveness
}
