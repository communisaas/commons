import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma, getRequestClient } from '$lib/core/db';
import {
	isCredentialValidForAction,
	formatValidationError,
	type SessionCredentialForPolicy
} from '$lib/core/identity/credential-policy';
import { computePseudonymousId } from '$lib/core/privacy/pseudonymous-id';
import { processSubmissionDelivery } from '$lib/server/delivery-worker';
import { registerEngagement } from '$lib/core/shadow-atlas/client';
import { verifyOnChain } from '$lib/core/blockchain/district-gate-client';
import { queueForRetry } from '$lib/core/blockchain/submission-retry-queue';
import { safeUserId } from '$lib/core/server/security';

/**
 * Submission Creation Endpoint
 *
 * Receives ZK proof + encrypted witness from browser.
 * Stores in database; TEE decrypts witness and handles congressional delivery.
 *
 * Flow:
 * 1. Validate authentication
 * 2. Enforce credential TTL for constituent_message action (ISSUE-005)
 * 3. Verify proof format
 * 4. Check nullifier uniqueness (prevent double-actions)
 * 5. Store in Submission table
 * 6. TEE processes encrypted witness → CWC delivery (async)
 *
 * Security:
 * - Action-based TTL (ISSUE-005): constituent_message requires verification within 90 days
 * - Chain = source of truth: verification_status set only after on-chain confirmation (BR5-003)
 * - User PII is in encrypted witness, never in plaintext request fields
 */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	try {
		// Check authentication
		const session = locals.session;
		if (!session?.userId) {
			throw error(401, 'Authentication required');
		}

		const userId = session.userId;

		// ISSUE-005: Enforce action-based TTL for constituent messages
		// This endpoint handles congressional delivery, requiring fresh verification
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

		// Build credential object for TTL validation
		const credential: SessionCredentialForPolicy = {
			userId: locals.user.id,
			createdAt: locals.user.verified_at,
			congressionalDistrict: locals.user.district_hash ?? undefined
		};

		// Validate credential age for constituent_message action
		const validation = isCredentialValidForAction(credential, 'constituent_message');

		if (!validation.valid) {
			console.log('[Submission] Credential TTL exceeded:', {
				userId,
				action: 'constituent_message',
				daysOld: Math.floor(validation.age / (24 * 60 * 60 * 1000)),
				maxDays: Math.floor(validation.maxAge / (24 * 60 * 60 * 1000))
			});

			return json(formatValidationError(validation), { status: 403 });
		}

		// Parse request body
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
			// Idempotency key for preventing duplicate submissions from retries
			idempotencyKey
		} = body;

		// Validate required fields
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

		// Validate template exists
		const template = await prisma.template.findUnique({
			where: { id: templateId },
			select: { id: true }
		});

		if (!template) {
			throw error(404, 'Template not found');
		}

		// Create submission with atomic idempotency and nullifier checks
		// Transaction ensures no race conditions on duplicate submissions
		const submission = await prisma.$transaction(async (tx) => {
			// Check idempotency key first (client retry protection)
			if (idempotencyKey) {
				const existingByIdempotency = await tx.submission.findUnique({
					where: { idempotency_key: idempotencyKey }
				});

				if (existingByIdempotency) {
					// Return existing submission for idempotent retry
					return existingByIdempotency;
				}
			}

			// Check nullifier uniqueness (prevent double-actions)
			// This check is now atomic with creation due to unique constraint + transaction
			const existingByNullifier = await tx.submission.findUnique({
				where: { nullifier }
			});

			if (existingByNullifier) {
				// Same user retrying after a failed response → return existing (idempotent)
				const pseudonymousId = computePseudonymousId(userId);
				if (existingByNullifier.pseudonymous_id === pseudonymousId) {
					return existingByNullifier;
				}
				// Different user with same nullifier → genuine double-spend attempt
				throw error(409, 'This action has already been submitted (duplicate nullifier)');
			}

			// Compute pseudonymous ID via HMAC-SHA256(salt, userId)
			// Breaks the link between authenticated identity and on-chain proof submission
			const pseudonymousId = computePseudonymousId(userId);

			// Create submission atomically
			// Extract action_id from ZK public inputs when available (three-tree proofs)
			const publicInputsTyped = publicInputs as Record<string, unknown> | undefined;
			// Witness data expires after 30 days (data minimization)
			const WITNESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

			return await tx.submission.create({
				data: {
					pseudonymous_id: pseudonymousId,
					template_id: templateId,
					action_id: (publicInputsTyped?.actionDomain as string) ?? templateId,
					proof_hex: proof,
					public_inputs: publicInputs,
					nullifier,
					encrypted_witness: encryptedWitness,
					witness_nonce: witnessNonce,
					ephemeral_public_key: ephemeralPublicKey,
					tee_key_id: teeKeyId,
					idempotency_key: idempotencyKey,
					delivery_status: 'pending',
					verification_status: 'pending',
					witness_expires_at: new Date(Date.now() + WITNESS_TTL_MS)
				}
			});
		});

		console.log('[Submission] Created:', {
			submissionId: submission.id,
			pseudonymousId: submission.pseudonymous_id.slice(0, 12) + '...',
			templateId,
			nullifier: nullifier.slice(0, 10) + '...'
		});

		// Capture the concrete PrismaClient NOW (while still in request context).
		// After response is sent, waitUntil runs outside ALS scope — the proxy
		// would throw "No request-scoped PrismaClient found".
		const db = getRequestClient();

		// Promote user to Tier 2 (address-attested) if currently lower.
		// ZKP submission proves district membership → Tier 2, not Tier 3.
		// Tier 3 (identity-verified) requires identity_commitment via a separate flow.
		// Fire-and-forget: uses captured client, registered with waitUntil
		const promotionPromise = db.user
			.updateMany({
				where: { id: userId, trust_tier: { lt: 2 } },
				data: { trust_tier: 2 }
			})
			.then((result: { count: number }) => {
				if (result.count > 0) {
					console.log('[Submission] User promoted to trust_tier 2:', safeUserId(userId));
				}
			})
			.catch((err: unknown) => {
				console.error('[Submission] Trust tier promotion failed:', err);
			});

		// Auto-register for engagement tracking (Tree 3) on first proof submission.
		// The signer→identityCommitment mapping already exists server-side (both fields
		// are on the User row). This just sends it to Shadow Atlas for Tree 3 insertion.
		// Idempotent: registerEngagement returns { alreadyRegistered: true } for duplicates.
		// Non-fatal: entire block is fire-and-forget to avoid blocking the response.
		const engagementPromise = (async () => {
			try {
				const engagementUser = await db.user.findUnique({
					where: { id: userId },
					select: { wallet_address: true, identity_commitment: true },
				});
				const signerAddress = engagementUser?.wallet_address;
				const identityCommitment = engagementUser?.identity_commitment;
				if (signerAddress && identityCommitment) {
					const result = await registerEngagement(signerAddress, identityCommitment);
					if (!('alreadyRegistered' in result)) {
						console.log('[Submission] Engagement auto-registered:', {
							userId,
							leafIndex: result.leafIndex,
						});
					}
				}
			} catch (err) {
				console.error('[Submission] Engagement auto-registration failed:', err);
			}
		})();

		// Trigger background CWC delivery
		// Decrypts witness, looks up representatives, submits to CWC API
		// delivery_status transitions: pending → processing → delivered | failed | partial
		const deliveryPromise = processSubmissionDelivery(submission.id, db).catch((err) =>
			console.error('[Submission] Background delivery failed:', err)
		);

		// On-chain ZK proof verification via DistrictGate on Scroll Sepolia
		// Extracts the flat publicInputsArray (31 elements) from the structured object
		// and submits to the verifier contract. Falls back to retry queue on failure.
		const publicInputsArray = (publicInputs as Record<string, unknown>)
			?.publicInputsArray as string[] | undefined;
		const verifierDepth = 20; // Default circuit depth for US

		const blockchainPromise = publicInputsArray?.length === 31
			? (async () => {
				try {
					await db.submission.update({
						where: { id: submission.id },
						data: { verification_status: 'queued' }
					});

					const result = await verifyOnChain({
						proof,
						publicInputs: publicInputsArray,
						verifierDepth
					});

					if (result.success && result.txHash) {
						await db.submission.update({
							where: { id: submission.id },
							data: {
								verification_status: 'verified',
								verification_tx_hash: result.txHash,
								verified_at: new Date()
							}
						});
						console.log('[Submission] On-chain verification succeeded:', {
							submissionId: submission.id,
							txHash: result.txHash
						});
					} else {
						console.warn('[Submission] On-chain verification failed, queuing retry:', result.error);
						await queueForRetry(submission.id, proof, publicInputsArray, verifierDepth);
					}
				} catch (err) {
					console.error('[Submission] Blockchain verification error:', err);
					await queueForRetry(submission.id, proof, publicInputsArray, verifierDepth)
						.catch((e) => console.error('[Submission] Retry queue failed:', e));
				}
			})()
			: Promise.resolve();

		if (platform?.context?.waitUntil) {
			// Cloudflare Workers: keep isolate alive until delivery + promotion + engagement + blockchain complete
			platform.context.waitUntil(deliveryPromise);
			platform.context.waitUntil(promotionPromise);
			platform.context.waitUntil(engagementPromise);
			platform.context.waitUntil(blockchainPromise);
		}
		// Non-CF environments (dev): promises run fire-and-forget

		return json({
			success: true,
			submissionId: submission.id,
			status: 'pending',
			message: 'Submission created. Processing will begin shortly.'
		});
	} catch (err) {
		console.error('[Submission Creation] Error:', err);

		// Re-throw SvelteKit errors (already have proper status + message)
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		// Surface actual error message so ProofGenerator can display it
		const message = err instanceof Error ? err.message : 'Failed to create submission';
		throw error(500, message);
	}
};
