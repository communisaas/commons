/**
// CONVEX: Keep SvelteKit
 * Batch Delivery Registration Endpoint — Power Landscape (Cycle 37)
 *
 * POST: Create delivery records for a position registration.
 * Requires authentication. Associates recipients with an existing registration.
 *
 * Called after the citizen chooses which decision-makers to address.
 * Each recipient gets a PositionDelivery record tracking delivery status.
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/core/db';
import { batchRegisterDeliveries } from '$lib/services/positionService';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!FEATURES.STANCE_POSITIONS) throw error(404, 'Not found');

	try {
		const session = locals.session;
		if (!session?.userId) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const body = await request.json();
		const { registrationId, recipients } = body;

		// Validate required fields
		if (!registrationId || typeof registrationId !== 'string') {
			return json({ error: 'Missing required field: registrationId' }, { status: 400 });
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

		// Verify the registration exists and belongs to the caller
		const user = await prisma.user.findUnique({
			where: { id: session.userId },
			select: { identity_commitment: true }
		});
		if (!user?.identity_commitment) {
			return json({ error: 'Identity verification required' }, { status: 403 });
		}

		const registration = await prisma.positionRegistration.findFirst({
			where: { id: registrationId, identity_commitment: user.identity_commitment },
			select: { id: true }
		});

		if (!registration) {
			return json({ error: 'Registration not found' }, { status: 404 });
		}

		// Create delivery records
		const result = await batchRegisterDeliveries({
			registrationId,
			recipients: recipients.map((r: { name: string; email?: string; deliveryMethod: string }) => ({
				name: r.name,
				email: r.email,
				deliveryMethod: r.deliveryMethod as 'cwc' | 'email' | 'recorded'
			}))
		});

		return json({ deliveries: result.created });
	} catch (err) {
		console.error('[Batch Delivery Registration] Error:', err);

		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		const message = err instanceof Error ? err.message : 'Failed to register deliveries';
		throw error(500, message);
	}
};
