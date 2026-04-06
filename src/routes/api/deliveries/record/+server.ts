/**
 * Direct Delivery Recording Endpoint — Stance-Agnostic Civic Action
 *
 * POST: Record delivery events keyed on pseudonymousId + templateId, with
 * NO stance registration required. This is the first-class civic action
 * path: writing to a decision-maker is a primary event, not an overlay on
 * a public support/oppose tally.
 *
 * pseudonymousId = HMAC-SHA256(user.id, SUBMISSION_ANONYMIZATION_SALT) per
 * voter-protocol G-07. Available at tier 1+ (any authenticated user) —
 * "All civic actions are available at any tier" (REPUTATION-ARCHITECTURE-
 * SPEC.md §1.4). identity_commitment is not required; it remains for ZK
 * proofs and stance claims in DEBATE-era accountability flows.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { computePseudonymousId } from '$lib/core/privacy/pseudonymous-id';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const session = locals.session;
		if (!session?.userId) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const body = await request.json();
		const { templateId, recipients } = body;

		if (!templateId || typeof templateId !== 'string') {
			return json({ error: 'Missing required field: templateId' }, { status: 400 });
		}

		if (!Array.isArray(recipients) || recipients.length === 0) {
			return json({ error: 'recipients must be a non-empty array' }, { status: 400 });
		}

		// Validate each recipient
		const validMethods = ['cwc', 'email', 'recorded'];
		for (const r of recipients) {
			if (!r.name || typeof r.name !== 'string') {
				return json({ error: 'Each recipient must have a name' }, { status: 400 });
			}
			if (!r.deliveryMethod || !validMethods.includes(r.deliveryMethod)) {
				return json(
					{ error: `deliveryMethod must be one of: ${validMethods.join(', ')}` },
					{ status: 400 }
				);
			}
		}

		// Derive pseudonymousId from session user — tier 1+ supported.
		// computePseudonymousId throws on missing/short salt — catch and return
		// generic error to avoid leaking env var names.
		let pseudonymousId: string;
		try {
			pseudonymousId = computePseudonymousId(session.userId);
		} catch {
			return json({ error: 'Service configuration error' }, { status: 500 });
		}

		// Backfill districtCode from user's Shadow Atlas registration (best-effort).
		// Returns null for tier 0-1 users without a registration — delivery is
		// recorded without district attribution in that case.
		const atlas = await serverQuery(api.users.getShadowAtlasRegistration, {
			userId: session.userId as any
		}).catch(() => null);
		const districtCode = atlas?.congressionalDistrict ?? undefined;

		const result = await serverMutation(api.positions.recordDirectDeliveries, {
			pseudonymousId,
			templateId: templateId as any,
			districtCode,
			recipients: recipients.map((r: { name: string; email?: string; deliveryMethod: string }) => ({
				name: r.name,
				email: r.email,
				deliveryMethod: r.deliveryMethod
			}))
		});

		return json({ created: result.created });
	} catch (err) {
		console.error('[Delivery Record] Error:', err);

		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		const message = err instanceof Error ? err.message : 'Failed to record deliveries';
		throw error(500, message);
	}
};
