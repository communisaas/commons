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
import { serverQuery, serverMutation } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '$lib/server/bounded-json-request';

const CONFIRM_SEND_REQUEST_MAX_BYTES = 1024;
const CONFIRM_SEND_TEMPLATE_ID_MAX_CHARS = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!FEATURES.STANCE_POSITIONS) throw error(404, 'Not found');

	try {
		const session = locals.session;
		if (!session?.userId) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		let body: unknown;
		try {
			body = await readBoundedJsonRequest(request, CONFIRM_SEND_REQUEST_MAX_BYTES, {
				maxArrayItems: 0,
				maxDepth: 1,
				maxNodes: 2,
				maxObjectKeys: 1,
				maxStringBytes: CONFIRM_SEND_TEMPLATE_ID_MAX_CHARS
			});
		} catch (cause) {
			if (cause instanceof BoundedJsonRequestError) {
				return json({ error: cause.message }, { status: cause.status });
			}
			return json({ error: 'Invalid request body' }, { status: 400 });
		}
		if (!isRecord(body) || Object.keys(body).some((key) => key !== 'templateId')) {
			return json({ error: 'Request body may contain only templateId' }, { status: 400 });
		}
		const { templateId } = body;

		if (
			typeof templateId !== 'string' ||
			templateId.length === 0 ||
			templateId.length > CONFIRM_SEND_TEMPLATE_ID_MAX_CHARS
		) {
			return json({ error: 'Missing or invalid templateId' }, { status: 400 });
		}

		// Derive identity_commitment from DB — require real verification
		const identityCommitment = locals.user?.identity_commitment;
		if (!identityCommitment) {
			return json({ error: 'Identity verification required to confirm send' }, { status: 403 });
		}

		// Auto-fill district_code from ShadowAtlasRegistration
		const atlas = await serverQuery(api.users.getShadowAtlasRegistration, {
			userId: session.userId as Id<'users'>
		});
		const districtCode = atlas?.congressionalDistrict ?? undefined;

		const result = await serverMutation(api.positions.confirmMailtoSend, {
			_secret: getInternalSecret(),
			templateId: templateId as Id<'templates'>,
			identityCommitment,
			districtCode
		});

		return json({
			registrationId: result.registrationId,
			isNewPosition: result.isNewPosition,
			deliveryCreated: result.created,
			deliveryExisting: result.existing,
			confirmed: true
		});
	} catch (err) {
		console.error('[Confirm Send] Error:', err);

		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		const message = err instanceof Error ? err.message : 'Failed to confirm send';
		if (message.includes('POSITION_DELIVERY_RATE_LIMITED')) {
			return json(
				{ error: 'Too many delivery confirmation requests. Please retry in one minute.' },
				{ status: 429, headers: { 'Retry-After': '60' } }
			);
		}
		if (
			message.includes('POSITION_DELIVERY_REGISTRATION_CAP_EXCEEDED') ||
			message.includes('POSITION_DELIVERY_CARDINALITY_REPAIR_REQUIRED') ||
			message.includes('POSITION_DELIVERY_IDENTITY_MULTIPLICITY')
		) {
			return json({ error: 'Position delivery history requires review' }, { status: 409 });
		}
		throw error(500, message);
	}
};
