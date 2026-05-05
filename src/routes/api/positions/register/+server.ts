/**
// CONVEX: Keep SvelteKit
 * Position Registration Endpoint — Power Landscape (Cycle 37)
 *
 * POST: Register a support/oppose position on a template.
 * Requires authentication. Returns aggregate counts (no PII).
 *
 * Duplicate registrations return 200 with existing count (not 409).
 * Privacy: keyed on identity_commitment, not user_id.
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!FEATURES.STANCE_POSITIONS) throw error(404, 'Not found');

	try {
		const session = locals.session;
		if (!session?.userId) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const body = await request.json();
		const { templateId, stance } = body;

		// Validate required fields
		if (!templateId || typeof templateId !== 'string') {
			return json({ error: 'Missing required field: templateId' }, { status: 400 });
		}

		if (!stance || (stance !== 'support' && stance !== 'oppose')) {
			return json({ error: "stance must be 'support' or 'oppose'" }, { status: 400 });
		}

		// Derive identity commitment server-side — never trust client input
		const identityCommitment = locals.user?.identity_commitment;
		if (!identityCommitment) {
			return json({ error: 'Identity verification required to register positions' }, { status: 403 });
		}

		// Derive district_code from ShadowAtlasRegistration using server-derived commitment
		const atlas = await serverQuery(api.users.getShadowAtlasRegistration, {
			userId: session.userId as Id<'users'>
		});
		const resolvedDistrictCode = atlas?.congressionalDistrict ?? undefined;

		// Register position (upsert — duplicates return existing)
		const registration = await serverMutation(api.positions.register, {
			templateId: templateId as Id<'templates'>,
			identityCommitment,
			stance,
			districtCode: resolvedDistrictCode
		});

		// Always return fresh counts
		const count = await serverQuery(api.positions.getCounts, {
			templateId: templateId as Id<'templates'>
		});

		return json({
			registrationId: registration._id,
			isNew: registration.isNew,
			count
		});
	} catch (err) {
		console.error('[Position Registration] Error:', err);

		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		const message = err instanceof Error ? err.message : 'Failed to register position';
		throw error(500, message);
	}
};
