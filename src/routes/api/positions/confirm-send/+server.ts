/**
// CONVEX: Keep SvelteKit
 * Mailto Send Confirmation Endpoint — Tier 2 Delivery Tracking
 *
 * POST: Record that user confirmed sending a mailto message.
 * Requires authentication. Server derives identity_commitment from session.
 *
 * Creates:
 *   - PositionRegistration (upsert, stance: 'support') → feeds community field counters
 *   - PositionDelivery (delivery_method: 'mailto_confirmed') → tracks confirmed send
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!FEATURES.STANCE_POSITIONS) throw error(404, 'Not found');

	try {
		const session = locals.session;
		if (!session?.userId) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const body = await request.json();
		const { templateId } = body;

		if (!templateId || typeof templateId !== 'string') {
			return json({ error: 'Missing required field: templateId' }, { status: 400 });
		}

		// Derive identity_commitment from DB — require real verification
		const user = await serverQuery(api.users.getById, { id: session.userId as any });
		if (!user?.identity_commitment) {
			return json({ error: 'Identity verification required to confirm send' }, { status: 403 });
		}
		const identityCommitment = user.identity_commitment;

		// Auto-fill district_code from ShadowAtlasRegistration
		const atlas = await serverQuery(api.users.getShadowAtlasRegistration, {
			identityCommitment
		});
		const districtCode = atlas?.congressionalDistrict ?? undefined;

		// Get template title for delivery record
		const template = await serverQuery(api.templates.getBySlug, { slug: templateId });
		const templateTitle = template?.title;

		const result = await serverMutation(api.positions.confirmMailtoSend, {
			templateId: templateId as any,
			identityCommitment,
			districtCode,
			templateTitle
		});

		return json({
			registrationId: result.registrationId,
			isNewPosition: result.isNewPosition,
			confirmed: true
		});
	} catch (err) {
		console.error('[Confirm Send] Error:', err);

		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		const message = err instanceof Error ? err.message : 'Failed to confirm send';
		throw error(500, message);
	}
};
