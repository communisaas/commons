/**
 * Email Delivery Confirmation Endpoint
 *
 * GET /api/email/confirm/:token
 * User clicks this link after sending their email to confirm delivery.
 * Updates Submission.delivery_status to 'user_confirmed'.
 *
 * Token is HMAC-based (opaque) — does not leak submission ID.
 * Single-use: second click returns already_confirmed.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateConfirmationToken } from '$lib/core/email/delivery-confirmation';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const GET: RequestHandler = async ({ params }) => {
	const token = params.token;

	if (!token) {
		throw error(400, 'Missing confirmation token');
	}

	const id = validateConfirmationToken(token);
	if (!id) {
		throw error(400, 'Invalid or expired confirmation token');
	}

	const result = await serverMutation(api.v1api.confirmEmailDelivery, { templateId: id });
	return json(result);
};
