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
 * 5. Commit registration metadata to Convex with exact operation coordinates
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
import { serverMutation } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler, RequestEvent } from './$types';
import { registerLeaf, replaceLeaf, type RegistrationResult } from '$lib/core/shadow-atlas/client';
import { BN254_MODULUS } from '$lib/core/crypto/bn254';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '$lib/server/bounded-json-request';
import {
	SHADOW_ATLAS_REGISTRATION_RETRY_TTL_SECONDS,
	encodeShadowAtlasRegistrationRetry,
	shadowAtlasRegistrationRetryKey,
	type ShadowAtlasRegistrationRetry
} from '$lib/server/shadow-atlas-registration-retry';

const REGISTER_REQUEST_MAX_BYTES = 1024;
const REGISTER_LEAF_MAX_CHARS = 80;

type ReservedOperation = {
	identityCommitment: string;
	operation: 'register' | 'replace';
	generation: number;
	leafDigest: string;
	idempotencyKey: string;
	priorLeafIndex?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalTree1Leaf(value: string): string | null {
	if (!/^(?:0x)?[0-9a-fA-F]{1,64}$/u.test(value)) return null;
	try {
		const field = BigInt(value.startsWith('0x') ? value : `0x${value}`);
		if (field === 0n || field >= BN254_MODULUS) return null;
		return `0x${field.toString(16).padStart(64, '0')}`;
	} catch {
		return null;
	}
}

async function tree1LeafDigest(leaf: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(leaf));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function operationCoordinates(userId: Id<'users'>, reservation: ReservedOperation) {
	return {
		userId,
		identityCommitment: reservation.identityCommitment,
		operation: reservation.operation,
		generation: reservation.generation,
		leafDigest: reservation.leafDigest,
		idempotencyKey: reservation.idempotencyKey,
		...(reservation.priorLeafIndex === undefined
			? {}
			: { priorLeafIndex: reservation.priorLeafIndex })
	};
}

function pathIndices(leafIndex: number, depth: number): number[] {
	return Array.from({ length: depth }, (_, index) => Math.floor(leafIndex / 2 ** index) % 2);
}

/**
 * Queue a failed Convex commit for retry via KV.
 * Called when Shadow Atlas tree mutation succeeds but the Convex commit fails.
 * The reconciliation endpoint processes these entries.
 */
async function queueRegistrationRetry(
	event: RequestEvent,
	data: Omit<ShadowAtlasRegistrationRetry, 'version' | 'queuedAt'>
): Promise<void> {
	try {
		const kv = event.platform?.env?.REGISTRATION_RETRY_KV;
		if (!kv) {
			console.error(
				'[Registration Retry] REGISTRATION_RETRY_KV not available — cannot queue retry'
			);
			return;
		}
		const retry: ShadowAtlasRegistrationRetry = {
			version: 2,
			...data,
			queuedAt: Date.now()
		};
		const key = shadowAtlasRegistrationRetryKey(retry);
		await kv.put(
			key,
			encodeShadowAtlasRegistrationRetry(retry),
			{
				expirationTtl: SHADOW_ATLAS_REGISTRATION_RETRY_TTL_SECONDS
			}
		);
		console.warn('[Registration Retry] Queued for retry in KV', {
			key,
			userId: data.userId,
			leafIndex: data.atlasResult.leafIndex,
			generation: data.generation,
			operation: data.operation
		});
	} catch (kvError) {
		// KV also failed — log for manual operator intervention.
		// The reconciliation job is the last safety net.
		console.error('[CRITICAL] KV queue also failed — manual intervention required', {
			userId: data.userId,
			leafIndex: data.atlasResult.leafIndex,
			kvError
		});
	}
}

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	try {
		const session = locals.session;

		if (!session?.userId) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		let body: unknown;
		try {
			body = await readBoundedJsonRequest(request, REGISTER_REQUEST_MAX_BYTES, {
				maxArrayItems: 0,
				maxDepth: 1,
				maxNodes: 3,
				maxObjectKeys: 2,
				maxStringBytes: REGISTER_LEAF_MAX_CHARS
			});
		} catch (cause) {
			if (cause instanceof BoundedJsonRequestError) {
				return json({ error: cause.message }, { status: cause.status });
			}
			return json({ error: 'Invalid request body' }, { status: 400 });
		}
		if (
			!isRecord(body) ||
			Object.keys(body).some((key) => key !== 'leaf' && key !== 'replace') ||
			typeof body.leaf !== 'string' ||
			body.leaf.length > REGISTER_LEAF_MAX_CHARS ||
			(body.replace !== undefined && typeof body.replace !== 'boolean')
		) {
			return json({ error: 'Expected only leaf and optional boolean replace' }, { status: 400 });
		}
		const leaf = canonicalTree1Leaf(body.leaf);
		if (!leaf) {
			return json({ error: 'Invalid BN254 leaf' }, { status: 400 });
		}

		const userId = session.userId as Id<'users'>;
		const leafDigest = await tree1LeafDigest(leaf);
		const reservation = await serverMutation(api.users.reserveShadowAtlasRegistrationOperation, {
			_secret: getInternalSecret(),
			userId,
			leafDigest,
			requestedReplace: body.replace === true,
			idempotencyKey: crypto.randomUUID()
		});

		if (reservation.kind === 'cached') {
			const proof = reservation.registration;
			return json({
				leafIndex: proof.leafIndex,
				userRoot: proof.merkleRoot,
				userPath: proof.merklePath,
				pathIndices: pathIndices(proof.leafIndex, proof.merklePath.length),
				alreadyRegistered: true,
				identityCommitment: reservation.identityCommitment,
				authorityLevel: reservation.authorityLevel
			});
		}
		if (reservation.kind === 'in_flight') {
			return json(
				{
					error: 'Registration operation already reserved',
					code:
						reservation.status === 'ambiguous'
							? 'SHADOW_ATLAS_TREE1_OUTCOME_AMBIGUOUS'
							: 'SHADOW_ATLAS_TREE1_OPERATION_IN_FLIGHT',
					retry: false
				},
				{ status: 409 }
			);
		}

		const coordinates = operationCoordinates(userId, reservation);
		const dispatch = await serverMutation(api.users.beginShadowAtlasRegistrationDispatch, {
			_secret: getInternalSecret(),
			...coordinates
		});
		if (!dispatch.started) {
			return json(
				{
					error: 'Registration dispatch already claimed',
					code: 'SHADOW_ATLAS_TREE1_OPERATION_IN_FLIGHT',
					retry: false
				},
				{ status: 409 }
			);
		}
		let atlasResult: RegistrationResult;
		try {
			atlasResult =
				reservation.operation === 'replace'
					? await replaceLeaf(leaf, reservation.priorLeafIndex!, {
							idempotencyKey: reservation.idempotencyKey
						})
					: await registerLeaf(leaf, {
							attestationHash: reservation.identityCommitment,
							idempotencyKey: reservation.idempotencyKey
						});
		} catch (externalError) {
			console.error('[Shadow Atlas] Tree-1 external outcome is ambiguous', {
				userId: session.userId,
				operation: reservation.operation,
				generation: reservation.generation,
				error: externalError instanceof Error ? externalError.message : String(externalError)
			});
			try {
				await serverMutation(api.users.markShadowAtlasRegistrationOperationAmbiguous, {
					_secret: getInternalSecret(),
					...coordinates,
					failureCode: 'SHADOW_ATLAS_EXTERNAL_OUTCOME_UNKNOWN'
				});
			} catch (markError) {
				console.error('[CRITICAL] Failed to mark Tree-1 reservation ambiguous', markError);
			}
			return json({ error: 'Registration service unavailable', retry: false }, { status: 503 });
		}

		try {
			await serverMutation(api.users.commitShadowAtlasRegistrationOperation, {
				_secret: getInternalSecret(),
				...coordinates,
				leafIndex: atlasResult.leafIndex,
				merkleRoot: atlasResult.userRoot,
				merklePath: atlasResult.userPath
			});
		} catch (dbError) {
			console.error('[CRITICAL] Convex commit failed after Tree-1 external success', {
				userId: session.userId,
				operation: reservation.operation,
				generation: reservation.generation,
				leafIndex: atlasResult.leafIndex,
				error: dbError
			});
			await queueRegistrationRetry(event, {
				userId: session.userId,
				identityCommitment: reservation.identityCommitment,
				operation: reservation.operation,
				generation: reservation.generation,
				leafDigest: reservation.leafDigest,
				idempotencyKey: reservation.idempotencyKey,
				...(reservation.priorLeafIndex === undefined
					? {}
					: { priorLeafIndex: reservation.priorLeafIndex }),
				atlasResult: {
					leafIndex: atlasResult.leafIndex,
					userRoot: atlasResult.userRoot,
					userPath: atlasResult.userPath
				}
			});
			return json({ error: 'Registration service unavailable', retry: false }, { status: 503 });
		}

		return json({
			leafIndex: atlasResult.leafIndex,
			userRoot: atlasResult.userRoot,
			userPath: atlasResult.userPath,
			pathIndices: atlasResult.pathIndices,
			identityCommitment: reservation.identityCommitment,
			authorityLevel: reservation.authorityLevel,
			...(atlasResult.receipt ? { receipt: atlasResult.receipt } : {})
		});
	} catch (error) {
		console.error('[Shadow Atlas] Registration error:', error);
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('SHADOW_ATLAS_TREE1_IDENTITY_REQUIRED')) {
			return json(
				{ error: 'Identity verification required before Shadow Atlas registration' },
				{ status: 403 }
			);
		}
		if (
			message.includes('SHADOW_ATLAS_TREE1_OPERATION_CONFLICT') ||
			message.includes('SHADOW_ATLAS_TREE1_REGISTRATION_MULTIPLICITY') ||
			message.includes('SHADOW_ATLAS_TREE1_COMMITTED_STATE_CORRUPT') ||
			message.includes('SHADOW_ATLAS_TREE1_IDENTITY_REPLACEMENT_REQUIRED')
		) {
			return json({ error: 'Registration state requires review', retry: false }, { status: 409 });
		}
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
