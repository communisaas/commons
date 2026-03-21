/**
 * Store Encrypted Identity Blob
 *
 * Stores XChaCha20-Poly1305 encrypted identity data in Postgres.
 * Platform CANNOT decrypt (only AWS Nitro Enclave has private key).
 *
 * Phase 1: Postgres storage
 * Phase 2: IPFS + on-chain pointer
 */

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/core/db';

const StoreBlobSchema = z.object({
	blob: z.object({
		ciphertext: z.string().min(1).max(1_000_000),
		nonce: z.string().min(1).max(256),
		publicKey: z.string().min(1).max(256),
		version: z.string().optional()
	})
});

export const POST: RequestHandler = async ({ locals, request }) => {
	// Authentication check
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	// Use authenticated user's ID
	const userId = locals.user.id;

	try {
		let input;
		try {
			input = StoreBlobSchema.parse(await request.json());
		} catch (e) {
			if (e instanceof z.ZodError) throw error(400, `Invalid blob: ${e.errors[0]?.message ?? 'validation failed'}`);
			throw error(400, 'Invalid request body');
		}
		const { blob } = input;

		// Store or update encrypted blob
		const encryptedData = await prisma.encryptedDeliveryData.upsert({
			where: { user_id: userId },
			create: {
				user_id: userId,
				ciphertext: blob.ciphertext,
				nonce: blob.nonce,
				ephemeral_public_key: blob.publicKey,
				tee_key_id: 'phase1-v1', // Phase 1: Static key ID
				encryption_version: blob.version
			},
			update: {
				ciphertext: blob.ciphertext,
				nonce: blob.nonce,
				ephemeral_public_key: blob.publicKey,
				tee_key_id: 'phase1-v1',
				encryption_version: blob.version,
				updated_at: new Date()
			}
		});

		return json({
			success: true,
			blobId: encryptedData.id,
			message: 'Encrypted blob stored successfully'
		});
	} catch (error) {
		console.error('Error storing encrypted blob:', error);
		return json(
			{
				error: 'Failed to store encrypted blob',
				details: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
