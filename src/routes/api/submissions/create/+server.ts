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
import { buildActionDomain } from '$lib/core/zkp/action-domain-builder';

/**
 * Server-held session constant. The client's submitted sessionId must match
 * this exactly — otherwise they could forge a new `actionDomain` per-send by
 * varying the session component (defeating per-template sybil resistance).
 *
 * Rotate on each Congressional session transition.
 */
const CURRENT_SESSION_ID = '119th-congress';

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
			idempotencyKey,
			sessionId,
			recipientSubdivision
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

		// Canonical action-domain binding (closes the self-referential gap).
		// Without this, publicInputs.actionDomain was attacker-chosen and only
		// compared to itself downstream. Here the server enforces that the
		// client's action domain is the deterministic hash of (constants +
		// templateId + user-submitted context). Any free parameters the client
		// uses (recipientSubdivision) are included in the hash so nullifiers
		// are still per-recipient distinct, but the server rebinds sessionId
		// to a held constant so cross-session spoofing fails.
		if (typeof sessionId !== 'string' || sessionId !== CURRENT_SESSION_ID) {
			throw error(400, `sessionId must be "${CURRENT_SESSION_ID}"`);
		}
		if (typeof recipientSubdivision !== 'string' || recipientSubdivision.length === 0) {
			throw error(400, 'recipientSubdivision is required');
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

		// Cross-check: publicInputs.actionDomain (named field) must match the
		// canonical array position [27]. Without this, a client could ship
		// different values in the two places and the TEE resolver's domain-binding
		// check becomes meaningless.
		const namedActionDomain = (publicInputs as Record<string, unknown> | null | undefined)?.actionDomain;
		if (typeof namedActionDomain !== 'string') {
			throw error(400, 'publicInputs.actionDomain missing or not a string');
		}
		try {
			if (BigInt(namedActionDomain) !== BigInt(rawInputsArray[27] as string | number | bigint)) {
				throw error(400, 'publicInputs.actionDomain does not match publicInputs[27]');
			}
		} catch (e) {
			if (e && typeof e === 'object' && 'status' in e) throw e;
			throw error(400, 'publicInputs.actionDomain is not a valid field element');
		}

		// Canonical binding: server recomputes the action domain and compares
		// to the client-submitted one. sessionId is server-held (enforced above);
		// templateId is server-authoritative from the POST body; country + juris-
		// dictionType are hardcoded for CWC (US federal). Only recipientSubdivision
		// is client-chosen, which is acceptable because each distinct subdivision
		// produces a distinct nullifier — user can message different reps, but
		// cannot forge new domains for the same (template, subdivision) pair.
		const canonicalActionDomain = buildActionDomain({
			country: 'US',
			jurisdictionType: 'federal',
			recipientSubdivision,
			templateId,
			sessionId: CURRENT_SESSION_ID
		});
		try {
			if (BigInt(namedActionDomain) !== BigInt(canonicalActionDomain)) {
				throw error(400, 'publicInputs.actionDomain does not match canonical derivation');
			}
		} catch (e) {
			if (e && typeof e === 'object' && 'status' in e) throw e;
			throw error(400, 'Invalid action domain binding');
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
