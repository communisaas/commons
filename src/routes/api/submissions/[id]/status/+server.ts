import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { computePseudonymousId } from '$lib/core/privacy/pseudonymous-id';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

/**
 * Submission Status Endpoint
 *
 * Returns the delivery status of a submission.
 * Used by SubmissionStatus.svelte to poll for progress updates.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const { id } = params;
	if (!id) {
		throw error(400, 'Submission ID is required');
	}

	const callerPseudoId = computePseudonymousId(locals.user.id);
	const result = await serverQuery(api.v1api.getSubmissionStatus, {
		submissionId: id,
		pseudonymousId: callerPseudoId
	});

	if (!result) {
		throw error(404, 'Submission not found');
	}

	if (result.forbidden) {
		return json({ error: 'Access denied' }, { status: 403 });
	}

	return json({
		status: result.status,
		deliveryCount: result.deliveryCount,
		deliveredAt: result.deliveredAt,
		error: result.error
	});
};
