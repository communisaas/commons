import { json, error } from '@sveltejs/kit';
// CONVEX: Keep SvelteKit
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation, serverAction } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { computePseudonymousId } from '$lib/core/privacy/pseudonymous-id';
import { processSubmissionDelivery } from '$lib/server/delivery-worker';

/**
 * Submission Retry Endpoint
 *
 * Re-triggers the delivery worker for a failed submission.
 * Resets delivery_status to 'pending' and kicks off background delivery.
 */
export const POST: RequestHandler = async ({ locals, params, platform }) => {
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const { id } = params;
	if (!id) {
		throw error(400, 'Submission ID is required');
	}

	// Verify submission exists and caller owns it
	const submission = await serverQuery(api.submissions.getById, {
		where: { id },
		select: {
			id: true,
			pseudonymous_id: true
		}
	});

	if (!submission) {
		throw error(404, 'Submission not found');
	}

	const callerPseudoId = computePseudonymousId(locals.user.id);
	if (submission.pseudonymous_id !== callerPseudoId) {
		return json({ error: 'Access denied' }, { status: 403 });
	}

	// Atomic conditional update: only reset if still 'failed' (prevents TOCTOU race
	// where concurrent retry or active delivery worker could cause duplicate CWC submissions)
	const updated = await prisma.submission.updateMany({
		where: { id, delivery_status: 'failed' },
		data: {
			delivery_status: 'pending',
			delivery_error: null
		}
	});

	if (updated.count === 0) {
		return json({ error: 'Submission is not in a retryable state' }, { status: 409 });
	}

	// Re-trigger delivery
	// Capture the concrete PrismaClient before response (ALS may not persist in waitUntil)
	const db = getRequestClient();
	const deliveryPromise = processSubmissionDelivery(submission.id, db).catch((err) =>
		console.error('[Retry] Background delivery failed:', err)
	);

	if (platform?.context?.waitUntil) {
		platform.context.waitUntil(deliveryPromise);
	}

	return json({ status: 'retrying' });
};
