/**
 * Shadow Atlas Registration Endpoint (Three-Tree Architecture)
 *
 * Registers a user's precomputed leaf hash with Shadow Atlas Tree 1.
 * The leaf is Poseidon2_H4(user_secret, cell_id, registration_salt, authority_level),
 * computed entirely in the browser. This endpoint sees ONLY the leaf hash.
 *
 * FLOW:
 * 1. Receive precomputed leaf hash from browser
 * 2. Validate OAuth session
 * 3. Look up User.identity_commitment (NUL-001: required for nullifier binding)
 * 4. Call voter-protocol Shadow Atlas POST /v1/register with { leaf }
 * 5. Store registration metadata in Postgres (identity commitment, leafIndex, proof)
 * 6. Return Tree 1 Merkle proof + identity commitment to client
 *
 * PRIVACY: This endpoint does NOT receive or store:
 * - user_secret (private key material)
 * - cell_id (Census tract FIPS code)
 * - registration_salt (random value)
 * - address data (stored only in browser IndexedDB)
 *
 * SPEC REFERENCE: WAVE-17-19-IMPLEMENTATION-PLAN.md Section 17c
 * SPEC REFERENCE: COMMONS-INTEGRATION-SPEC.md Section 2.1
 */

import { json } from '@sveltejs/kit';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler, RequestEvent } from './$types';
import { registerLeaf, replaceLeaf, type RegistrationResult } from '$lib/core/shadow-atlas/client';
import { BN254_MODULUS } from '$lib/core/crypto/bn254';

/**
 * Queue a failed Postgres write for retry via KV.
 * Called when Shadow Atlas tree mutation succeeds but Postgres write fails.
 * The reconciliation endpoint processes these entries.
 */
async function queueRegistrationRetry(
	event: RequestEvent,
	data: {
		userId: string;
		identityCommitment: string;
		verificationMethod: string;
		atlasResult: RegistrationResult;
		isReplace?: boolean;
	}
): Promise<void> {
	try {
		const kv = event.platform?.env?.REGISTRATION_RETRY_KV;
		if (!kv) {
			console.error('[Registration Retry] REGISTRATION_RETRY_KV not available — cannot queue retry');
			return;
		}
		const key = `retry:${data.userId}:${Date.now()}`;
		await kv.put(key, JSON.stringify({
			...data,
			queuedAt: new Date().toISOString(),
		}), {
			expirationTtl: 3600, // 1 hour TTL — auto-cleanup
		});
		console.warn('[Registration Retry] Queued for retry in KV', {
			key,
			userId: data.userId,
			leafIndex: data.atlasResult.leafIndex,
		});
	} catch (kvError) {
		// KV also failed — log for manual operator intervention.
		// The reconciliation job is the last safety net.
		console.error('[CRITICAL] KV queue also failed — manual intervention required', {
			userId: data.userId,
			leafIndex: data.atlasResult.leafIndex,
			kvError,
		});
	}
}

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	try {
		const session = locals.session;

		if (!session) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		// NUL-001: Look up canonical identity commitment (set during verification).
		// Required for nullifier binding — prevents Sybil via re-registration.
		const user = await prisma.user.findUnique({
			where: { id: session.userId },
			select: { identity_commitment: true, verification_method: true, authority_level: true },
		});

		if (!user?.identity_commitment) {
			return json(
				{ error: 'Identity verification required before Shadow Atlas registration' },
				{ status: 403 }
			);
		}

		const identityCommitment = user.identity_commitment;

		const body = await request.json();
		const { leaf, replace: isReplace } = body;

		// Validate leaf is present and hex-formatted
		if (!leaf || typeof leaf !== 'string') {
			return json(
				{ error: 'Missing required field: leaf (hex-encoded field element)' },
				{ status: 400 }
			);
		}

		if (!/^(0x)?[0-9a-fA-F]+$/.test(leaf)) {
			return json(
				{ error: 'Invalid leaf format: must be hex-encoded' },
				{ status: 400 }
			);
		}

		// Validate leaf is within BN254 field
		try {
			const leafBigint = BigInt(leaf.startsWith('0x') ? leaf : '0x' + leaf);
			if (leafBigint === 0n) {
				return json({ error: 'Zero leaf not allowed' }, { status: 400 });
			}
			if (leafBigint >= BN254_MODULUS) {
				return json({ error: 'Leaf exceeds BN254 field modulus' }, { status: 400 });
			}
		} catch {
			return json({ error: 'Invalid leaf value' }, { status: 400 });
		}

		// Check if user is already registered
		const existingRegistration = await prisma.shadowAtlasRegistration.findUnique({
			where: { user_id: session.userId },
		});

		if (existingRegistration) {
			// Recovery mode: replace leaf with fresh credential
			if (isReplace === true) {
				const replaceIdempotencyKey = crypto.randomUUID();
				let replacementResult;
				try {
					replacementResult = await replaceLeaf(leaf, existingRegistration.leaf_index, { idempotencyKey: replaceIdempotencyKey });
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					console.error('[Shadow Atlas] Registration service failed:', msg);
					return json(
						{ error: 'Registration service unavailable' },
						{ status: 503 }
					);
				}

				// Update Postgres record with new leaf data
				// NOTE: pathIndices not stored — derived from leaf_index on read
				try {
					await prisma.shadowAtlasRegistration.update({
						where: { user_id: session.userId },
						data: {
							identity_commitment: identityCommitment,
							leaf_index: replacementResult.leafIndex,
							merkle_root: replacementResult.userRoot,
							merkle_path: replacementResult.userPath,
						},
					});
				} catch (dbError) {
					// CRITICAL: Shadow Atlas tree was mutated but Postgres failed.
					// Queue for retry via KV — reconciliation job will repair.
					console.error('[CRITICAL] Postgres update failed after Shadow Atlas replacement', {
						userId: session.userId,
						oldIndex: existingRegistration.leaf_index,
						newIndex: replacementResult.leafIndex,
						idempotencyKey: replaceIdempotencyKey,
						error: dbError,
					});
					await queueRegistrationRetry(event, {
						userId: session.userId,
						identityCommitment,
						verificationMethod: user.verification_method || 'unknown',
						atlasResult: replacementResult,
						isReplace: true,
					});
					return json(
						{ error: 'Registration service unavailable' },
						{ status: 503 }
					);
				}

				return json({
					leafIndex: replacementResult.leafIndex,
					userRoot: replacementResult.userRoot,
					userPath: replacementResult.userPath,
					pathIndices: replacementResult.pathIndices,
					identityCommitment,
					authorityLevel: user.authority_level ?? 1,
				});
			}

			// Normal already-registered: return cached proof
			const depth = (existingRegistration.merkle_path as string[]).length;
			const pathIndices = Array.from({ length: depth }, (_, i) =>
				(existingRegistration.leaf_index >> i) & 1,
			);

			return json({
				leafIndex: existingRegistration.leaf_index,
				userRoot: existingRegistration.merkle_root,
				userPath: existingRegistration.merkle_path as string[],
				pathIndices,
				alreadyRegistered: true,
				identityCommitment,
				authorityLevel: user.authority_level ?? 1,
			});
		}

		// Use identity_commitment as attestation hash.
		// This binds the tree insertion to a real identity verification event.
		// If the operator fabricates registrations, they won't have valid attestation hashes.
		const attestationHash = identityCommitment;

		// Generate idempotency key — safe to retry the same atlas call on failure.
		// Shadow Atlas caches by this key (1hr TTL), returning the same result
		// without re-mutating the tree.
		const idempotencyKey = crypto.randomUUID();

		// Call Shadow Atlas registration API
		let registrationResult;
		try {
			registrationResult = await registerLeaf(leaf, { attestationHash, idempotencyKey });
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.error('[Shadow Atlas] Registration service failed:', msg);
			return json(
				{ error: 'Registration service unavailable' },
				{ status: 503 }
			);
		}

		// Store registration metadata in Postgres
		// NOTE: We store the leaf hash (not private inputs) and the Merkle proof
		try {
			await prisma.shadowAtlasRegistration.create({
				data: {
					user_id: session.userId,
					congressional_district: 'three-tree', // District comes from Tree 2, not registration
					identity_commitment: identityCommitment, // NUL-001: canonical commitment from verification
					leaf_index: registrationResult.leafIndex,
					merkle_root: registrationResult.userRoot,
					merkle_path: registrationResult.userPath,
					credential_type: 'three-tree',
					cell_id: null, // PRIVACY: cell_id never sent to this endpoint
					verification_method: user.verification_method || 'unknown', // BR6-005: use actual method, not hardcoded
					verification_id: session.userId, // Link to auth session
					verification_timestamp: new Date(),
					registration_status: 'registered',
					expires_at: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000), // 6 months
				},
			});
		} catch (dbError) {
			// CRITICAL: Shadow Atlas tree was mutated but Postgres write failed.
			// Queue the atlas response in KV for retry — the idempotency key
			// means the client can safely retry, but we also need to persist the
			// atlas response so the reconciliation job can repair the mismatch.
			console.error('[CRITICAL] Postgres create failed after Shadow Atlas registration', {
				userId: session.userId,
				leafIndex: registrationResult.leafIndex,
				idempotencyKey,
				error: dbError,
			});
			await queueRegistrationRetry(event, {
				userId: session.userId,
				identityCommitment,
				verificationMethod: user.verification_method || 'unknown',
				atlasResult: registrationResult,
			});
			return json(
				{ error: 'Registration service unavailable' },
				{ status: 503 }
			);
		}

		return json({
			leafIndex: registrationResult.leafIndex,
			userRoot: registrationResult.userRoot,
			userPath: registrationResult.userPath,
			pathIndices: registrationResult.pathIndices,
			identityCommitment,
			authorityLevel: user.authority_level ?? 1,
			receipt: registrationResult.receipt, // Signed registration receipt
		});
	} catch (error) {
		console.error('[Shadow Atlas] Registration error:', error);
		return json(
			{ error: 'Internal server error' },
			{ status: 500 }
		);
	}
};
