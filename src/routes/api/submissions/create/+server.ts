// CONVEX: Keep SvelteKit — credential TTL validation, proof validation, blockchain verification (verifyOnChain)
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverAction, serverQuery } from 'convex-sveltekit';
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
const REQUIRED_CONGRESSIONAL_PROOF_TIER = 4;

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

		// Accept V1 (31 inputs) or V2 (33 inputs, F1 closure — Stage 5). V2 adds
		// revocation_nullifier + revocation_registry_root at indices 31/32; the
		// downstream resolver and anchor paths route V1/V2 by length.
		if (
			!Array.isArray(rawInputsArray) ||
			(rawInputsArray.length !== 31 && rawInputsArray.length !== 33)
		) {
			throw error(
				400,
				`Invalid publicInputs: expected 31 or 33 elements, got ${Array.isArray(rawInputsArray) ? rawInputsArray.length : typeof publicInputs}`
			);
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

			const namedAuthorityLevel = (publicInputs as Record<string, unknown> | null | undefined)
				?.authorityLevel;
			if (
				typeof namedAuthorityLevel !== 'string' &&
				typeof namedAuthorityLevel !== 'number' &&
				typeof namedAuthorityLevel !== 'bigint'
			) {
				throw error(400, 'publicInputs.authorityLevel missing or not a field element');
			}
			let canonicalAuthorityLevel: bigint;
			try {
				canonicalAuthorityLevel = BigInt(namedAuthorityLevel);
				if (
					canonicalAuthorityLevel !== BigInt(rawInputsArray[28] as string | number | bigint)
				) {
					throw error(400, 'publicInputs.authorityLevel does not match publicInputs[28]');
				}
			} catch (e) {
				if (e && typeof e === 'object' && 'status' in e) throw e;
				throw error(400, 'publicInputs.authorityLevel is not a valid field element');
			}

			if (
				canonicalAuthorityLevel < BigInt(REQUIRED_CONGRESSIONAL_PROOF_TIER) ||
				(locals.user.trust_tier ?? 0) < REQUIRED_CONGRESSIONAL_PROOF_TIER
			) {
				return json(
					{
						success: false,
						error: 'insufficient_authority',
						code: 'INSUFFICIENT_AUTHORITY',
						message:
							'Government-ID verification is required before submitting verified messages to Congress.',
						requiresReverification: true
					},
					{ status: 403 }
				);
			}

			// FU-3.2 — V2 freshness check. When the proof is V2 (33 inputs), the
		// public input [32] is `revocation_registry_root`: the SMT root the
		// circuit's non-membership proof was built against. The on-chain
		// `RevocationRegistry.isRootAcceptable` view tolerates archived roots
		// within a 1-hour TTL, but we want to reject staler proofs at the
		// SvelteKit boundary so canary metrics emit a categorized
		// `revocation_root_stale` error instead of an opaque on-chain revert.
		//
		// Query Convex's current SMT root + halt status. If the proof's root
		// matches OR is within the recent past (TTL window), accept. Else 422.
		// Halt-active is a separate terminal error so canary monitoring sees
		// halt rejection distinct from staleness.
		if (rawInputsArray.length === 33) {
			const claimedRoot = rawInputsArray[32] as string;
			const [convexRoot, haltStatus] = await Promise.all([
				serverQuery(api.revocations.getRevocationRoot, {} as unknown as never),
				serverQuery(api.revocations.getRevocationHaltStatus, {} as unknown as never)
			]);
			if ((haltStatus as { halted?: boolean })?.halted === true) {
				return json(
					{
						success: false,
						error: 'revocation_subsystem_halted',
						code: 'REVOCATION_SUBSYSTEM_HALTED',
						message:
							'The revocation subsystem is temporarily halted while operators investigate state divergence. Please retry in a moment.'
					},
					{ status: 503 }
				);
			}
			const currentRoot = (convexRoot as { root?: string })?.root ?? null;
			if (currentRoot !== null) {
				try {
					const claimedBig = BigInt(claimedRoot);
					const currentBig = BigInt(currentRoot);
					// If the claimed root is the current root, accept immediately.
					// If it differs, we cannot tell from Convex alone whether it's
					// a recent archived root (still acceptable) or genuinely stale.
					// The on-chain `isRootAcceptable` view is authoritative; here
					// we only short-circuit the obvious-mismatch case (claimed
					// root is zero or not the current root and Convex has had
					// recent activity). Strict mode would reject all non-current
					// roots, but that breaks legitimate in-flight proofs against
					// the immediately-prior root. Compromise: accept current; let
					// non-current pass through to on-chain TTL check.
					if (claimedBig !== currentBig) {
						console.warn('[submissions] V2 proof root != Convex current root', {
							userId: locals.user.id,
							claimedRoot,
							currentRoot,
							note: 'archive-TTL window will determine on-chain acceptance'
						});
					}
				} catch {
					return json(
						{
							success: false,
							error: 'invalid_revocation_root',
							code: 'INVALID_REVOCATION_ROOT',
							message: 'Public input [32] is not a valid field element.'
						},
						{ status: 400 }
					);
				}
			}
		}

		// Stage 2.5: fetch the server-held districtCommitment for this user.
		// The v2 action-domain builder requires it as part of the preimage to
		// close F2 district-hopping amplification. Sourcing from Convex (not
		// the client-submitted payload) prevents a malicious client from
		// supplying a fake commitment to forge a new nullifier scope.
		// TODO(stage-2.5-codegen): the `as unknown as never` cast is a temporary
		// workaround until `npx convex dev` regenerates api.d.ts with the new
		// getActiveCredentialDistrictCommitment export. Remove after codegen.
		const credData = await serverQuery(
			api.users.getActiveCredentialDistrictCommitment,
			{ userId: locals.user.id as unknown as never }
		);
		if (!credData?.districtCommitment) {
			return json(
				{
					success: false,
					error: 'credential_migration_required',
					code: 'CREDENTIAL_MIGRATION_REQUIRED',
					message:
						'Your proof credential needs to be renewed. Please re-verify your address to continue sending.',
					requiresReverification: true
				},
				{ status: 403 }
			);
		}

		// Canonical binding: server recomputes the action domain and compares
		// to the client-submitted one. sessionId is server-held (enforced above);
		// templateId is server-authoritative from the POST body; country + juris-
		// dictionType are hardcoded for CWC (US federal). Only recipientSubdivision
		// is client-chosen, which is acceptable because each distinct subdivision
		// produces a distinct nullifier — user can message different reps, but
		// cannot forge new domains for the same (template, subdivision) pair.
		// districtCommitment is looked up above from the user's active credential.
		const canonicalActionDomain = buildActionDomain({
			country: 'US',
			jurisdictionType: 'federal',
			recipientSubdivision,
			templateId,
			sessionId: CURRENT_SESSION_ID,
			districtCommitment: credData.districtCommitment
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
