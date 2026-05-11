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
import { serverInternalMutation } from '$lib/server/convex-internal';
import { internal } from '$lib/convex';

export const GET: RequestHandler = async ({ params }) => {
	const token = params.token;

	if (!token) {
		throw error(400, 'Missing confirmation token');
	}

	// cap token length before HMAC parse cycles. Real tokens
	// are base64url(payload).base64url(hmac) where payload is `${id}:${timestamp}`
	// — typically ~80-90 chars. 256 is generous slack while bounding work on
	// adversarial megabyte URL inputs that Cloudflare wouldn't have already
	// rejected (CF caps URL at 16 KiB).
	if (token.length > 256) {
		throw error(400, 'Invalid confirmation token');
	}

	const id = validateConfirmationToken(token);
	if (!id) {
		throw error(400, 'Invalid or expired confirmation token');
	}

	const result = await serverInternalMutation(internal.v1api.confirmEmailDelivery, { submissionId: id });
	return json(result);
};
