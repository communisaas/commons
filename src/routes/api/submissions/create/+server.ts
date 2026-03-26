// CONVEX: Keep SvelteKit — credential TTL validation, blockchain verification (verifyOnChain)
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverAction } from 'convex-sveltekit';
import { api } from '$lib/convex';
import {
	isCredentialValidForAction,
	formatValidationError,
	type SessionCredentialForPolicy
} from '$lib/core/identity/credential-policy';

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

		// Use Convex action — handles atomic insert, idempotency, nullifier dedup,
		// and schedules background tasks (delivery, engagement, tier promotion)
		const result = await serverAction(api.submissions.create, {
			templateId,
			proof,
			publicInputs,
			nullifier,
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
