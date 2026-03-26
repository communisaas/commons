/**
 * Delete Encrypted Identity Blob
 *
 * Removes encrypted blob from storage (user requested deletion).
 *
 * Phase 1: Delete from Postgres
 * Phase 2: Unpin from IPFS (garbage collection)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const DELETE: RequestHandler = async ({ locals }) => {
	// Authentication check
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	// Use authenticated user's ID
	const userId = locals.user.id;

	try {
		// Delete encrypted blob via Convex
		await serverMutation(api.users.deleteEncryptedBlob, {
			userId: userId as any,
		});

		return json({
			success: true,
			message: 'Encrypted blob deleted successfully'
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('NOT_FOUND')) {
			return json({ error: 'No encrypted blob found for user' }, { status: 404 });
		}

		console.error('Error deleting encrypted blob:', error);
		return json(
			{
				error: 'Failed to delete encrypted blob',
				details: message
			},
			{ status: 500 }
		);
	}
};
