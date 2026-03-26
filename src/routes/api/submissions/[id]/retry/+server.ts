import { json, error } from '@sveltejs/kit';
// CONVEX: Keep SvelteKit
import type { RequestHandler } from './$types';
import { serverAction } from 'convex-sveltekit';
import { api } from '$lib/convex';

/**
 * Submission Retry Endpoint
 *
 * Re-triggers the delivery worker for a failed submission.
 * Resets delivery_status to 'pending' and kicks off background delivery.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const { id } = params;
	if (!id) {
		throw error(400, 'Submission ID is required');
	}

	try {
		const result = await serverAction(api.submissions.retryDelivery, {
			submissionId: id as any
		});

		return json({ status: result.status });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes('not found')) {
			throw error(404, 'Submission not found');
		}
		if (message.includes('Access denied')) {
			return json({ error: 'Access denied' }, { status: 403 });
		}
		if (message.includes('not in a retryable state')) {
			return json({ error: 'Submission is not in a retryable state' }, { status: 409 });
		}
		throw error(500, message);
	}
};
