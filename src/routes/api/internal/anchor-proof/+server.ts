/**
 * Internal endpoint: on-chain anchor of verified proofs.
 *
 * Called asynchronously by Convex `anchorProofOnChain` after CWC delivery
 * succeeds. Submits the proof to the DistrictGate verifier contract for
 * independent cryptographic verification. If the chain rejects a proof that
 * the TEE accepted, that's a `divergent` event — P0 alert material.
 *
 * Authentication: shared secret via X-Internal-Secret header. This endpoint
 * must never be exposed to the internet without the header check — it has
 * access to the relayer wallet which pays gas.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { verifyOnChain } from '$lib/core/blockchain/district-gate-client';
import { enforceInternalRateLimit } from '$lib/server/internal/rate-limit';

export const POST: RequestHandler = async ({ request }) => {
	const expected = env.INTERNAL_API_SECRET;
	if (!expected) {
		throw error(503, 'INTERNAL_API_SECRET not configured');
	}
	const provided = request.headers.get('x-internal-secret');
	if (!provided || provided !== expected) {
		throw error(403, 'Invalid internal secret');
	}

	// Gas-expensive: on-chain tx per call. 60/min caps a leaked-secret attacker
	// at ~$50/hour in typical Scroll L2 gas (~$0.01/tx).
	await enforceInternalRateLimit({ endpoint: 'anchor-proof', maxRequests: 60, windowMs: 60_000 });

	const body = (await request.json().catch(() => null)) as
		| { proof?: string; publicInputs?: string[]; verifierDepth?: number; deadline?: number }
		| null;
	if (!body || typeof body.proof !== 'string' || !Array.isArray(body.publicInputs)) {
		throw error(400, 'Missing proof or publicInputs');
	}

	const verifierDepth = body.verifierDepth ?? 20;
	// Deadline default: 10 minutes from now. The contract uses this to bound
	// replay windows for the relayer's EIP-712 signature.
	const deadline = body.deadline ?? Math.floor(Date.now() / 1000) + 600;

	const result = await verifyOnChain({
		proof: body.proof,
		publicInputs: body.publicInputs,
		verifierDepth,
		deadline
	});

	if (result.success) {
		return json({
			success: true,
			kind: result.kind,
			txHash: result.txHash
		});
	}

	// The classification layer lives inside verifyOnChain (which has ethers
	// context — revert data, error codes, transaction phase). We surface only
	// the typed `kind`; callers key off that, not on string parsing.
	//
	// Only 'contract_invalid_proof' constitutes TEE/chain divergence.
	// 'contract_other_revert' (nullifier reuse, actionDomain not whitelisted)
	// is a legitimate contract rejection, not a P0 integrity incident.
	const isDivergent = result.kind === 'contract_invalid_proof';

	return json({
		success: false,
		kind: result.kind,
		divergent: isDivergent,
		error: result.error ?? 'verification_failed'
	});
};
