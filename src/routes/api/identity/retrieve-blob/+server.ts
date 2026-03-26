/**
// CONVEX: Keep SvelteKit
 * Retrieve Encrypted Identity Blob
 *
 * Fetches encrypted blob from Postgres.
 * Returns encrypted data only (platform cannot decrypt).
 *
 * Phase 1: Postgres lookup
 * Phase 2: IPFS CID retrieval + on-chain pointer
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/core/db';
import type { EncryptedBlob } from '$lib/core/identity/blob-encryption';

export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		// SECURITY FIX: Require authenticated session
		if (!locals.user) {
			throw error(401, 'Authentication required');
		}

		const userId = url.searchParams.get('userId');

		if (!userId) {
			return json({ error: 'Missing userId parameter' }, { status: 400 });
		}

		// SECURITY FIX: Verify user can only access their own blob
		if (userId !== locals.user.id) {
			throw error(403, 'Access denied: Cannot retrieve another user\'s encrypted data');
		}

		// Fetch encrypted blob
		const encryptedData = await prisma.encryptedDeliveryData.findUnique({
			where: { user_id: userId }
		});

		if (!encryptedData) {
			return json({ error: 'No encrypted blob found for user' }, { status: 404 });
		}

		// Convert to EncryptedBlob format
		const blob: EncryptedBlob = {
			ciphertext: encryptedData.ciphertext,
			nonce: encryptedData.nonce,
			publicKey: encryptedData.ephemeral_public_key,
			version: encryptedData.encryption_version,
			timestamp: encryptedData.created_at.getTime()
		};

		return json({
			success: true,
			blob,
			metadata: {
				created_at: encryptedData.created_at,
				updated_at: encryptedData.updated_at,
				last_used_at: encryptedData.last_used_at,
				tee_key_id: encryptedData.tee_key_id
			}
		});
	} catch (err) {
		// Re-throw SvelteKit HttpErrors (401, 403, etc.)
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		console.error('Error retrieving encrypted blob:', err);
		return json(
			{
				error: 'Failed to retrieve encrypted blob',
				details: err instanceof Error ? err.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
