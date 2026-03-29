// CONVEX: Keep SvelteKit — credential TTL validation, proof validation, blockchain verification (verifyOnChain)
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverAction } from 'convex-sveltekit';
import { api } from '$lib/convex';
import {
	isCredentialValidForAction,
	formatValidationError,
	type SessionCredentialForPolicy
} from '$lib/core/identity/credential-policy';
import { BN254_MODULUS } from '$lib/core/crypto/bn254';

/**
 * Submission Creation Endpoint
 *
 * Receives ZK proof + encrypted witness from browser.
 * Stores in Convex; background tasks handle CWC delivery + engagement registration.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const session = locals.session;
		if (!session?.userId) {
			throw error(401, 'Authentication required');
		}

		// ISSUE-005: Enforce action-based TTL for constituent messages
		if (!locals.user?.verified_at) {
			return json(
				{
					error: 'verification_required',
					code: 'NOT_VERIFIED',
					message: 'You must verify your address before submitting to Congress.',
					requiresReverification: true
				},
				{ status: 403 }
			);
		}

		const credential: SessionCredentialForPolicy = {
			userId: locals.user.id,
			createdAt: locals.user.verified_at,
			congressionalDistrict: locals.user.district_hash ?? undefined
		};

		const validation = isCredentialValidForAction(credential, 'constituent_message');

		if (!validation.valid) {
			return json(formatValidationError(validation), { status: 403 });
		}

		const body = await request.json();
		const {
			templateId,
			proof,
			publicInputs,
			nullifier,
			encryptedWitness,
			witnessNonce,
			ephemeralPublicKey,
			teeKeyId,
			idempotencyKey
		} = body;

		if (
			!templateId ||
			!proof ||
			!publicInputs ||
			!nullifier ||
			!encryptedWitness ||
			!witnessNonce ||
			!ephemeralPublicKey ||
			!teeKeyId
		) {
			throw error(400, 'Missing required fields');
		}

		// ── S2: Structural proof validation (ZKP-INTEGRITY-TASK-GRAPH.md § S2) ──
		// Blocks garbage proofs at the door. Does NOT verify ZK math (Cycle 2).

		// Proof must be non-empty valid hex
		if (typeof proof !== 'string' || !/^(0x)?[0-9a-fA-F]+$/.test(proof)) {
			throw error(400, 'Invalid proof: must be hex-encoded');
		}
		const proofHex = proof.startsWith('0x') ? proof.slice(2) : proof;
		if (proofHex.length < 2048 || proofHex.length > 131072) {
			throw error(400, 'Invalid proof: unexpected length');
		}

		// Extract publicInputsArray from payload.
		// ProofGenerator sends publicInputs as an object with named fields + publicInputsArray.
		// We validate the raw array (31 BN254 field elements).
		const rawInputsArray: unknown[] | undefined =
			Array.isArray(publicInputs) ? publicInputs :
			(publicInputs && typeof publicInputs === 'object' && 'publicInputsArray' in publicInputs)
				? (publicInputs as Record<string, unknown>).publicInputsArray as unknown[]
				: undefined;

		if (!Array.isArray(rawInputsArray) || rawInputsArray.length !== 31) {
			throw error(400, `Invalid publicInputs: expected 31 elements, got ${Array.isArray(rawInputsArray) ? rawInputsArray.length : typeof publicInputs}`);
		}
		for (let i = 0; i < rawInputsArray.length; i++) {
			try {
				const val = BigInt(rawInputsArray[i] as string | number | bigint);
				if (val < 0n || val >= BN254_MODULUS) {
					throw error(400, `publicInputs[${i}] out of BN254 field range`);
				}
			} catch (e) {
				if (e && typeof e === 'object' && 'status' in e) throw e;
				throw error(400, `publicInputs[${i}] is not a valid field element`);
			}
		}

		// Nullifier must be a valid BN254 field element.
		// Canonicalize to decimal string to prevent "0xFF" vs "255" dedup bypass.
		let canonicalNullifier: string;
		try {
			const nullVal = BigInt(nullifier);
			if (nullVal < 0n || nullVal >= BN254_MODULUS) {
				throw error(400, 'Nullifier out of BN254 field range');
			}
			canonicalNullifier = nullVal.toString(10);
		} catch (e) {
			if (e && typeof e === 'object' && 'status' in e) throw e;
			throw error(400, 'Nullifier is not a valid field element');
		}

		// Cross-check: nullifier in body must match publicInputsArray[26]
		if (BigInt(nullifier) !== BigInt(rawInputsArray[26] as string | number | bigint)) {
			throw error(400, 'Nullifier does not match publicInputs[26]');
		}

		// Use Convex action — handles atomic insert, idempotency, nullifier dedup,
		// and schedules background tasks (delivery, engagement)
		const result = await serverAction(api.submissions.create, {
			templateId,
			proof,
			publicInputs,
			nullifier: canonicalNullifier,
			encryptedWitness,
			witnessNonce,
			ephemeralPublicKey,
			teeKeyId,
			idempotencyKey
		});

		return json({
			success: true,
			submissionId: result.submissionId,
			status: result.status,
			message: 'Submission created. Processing will begin shortly.'
		});
	} catch (err) {
		console.error('[Submission Creation] Error:', err);

		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		const message = err instanceof Error ? err.message : 'Failed to create submission';
		throw error(500, message);
	}
};
