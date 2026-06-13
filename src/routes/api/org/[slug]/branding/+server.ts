/**
 * Branding editor endpoints — Coalition-gated (D-08 / D-10).
 *
 * POST  → mint a Convex storage upload URL for a logo (the client PUTs bytes
 *         to it, then sends the returned storageId back via PATCH).
 * PATCH → write accent color, uploaded logo, and/or the outbound white-label
 *         flag via organizations.setBranding. The Coalition-tier gate lives in
 *         the Convex mutation; this endpoint only shapes input + relays errors.
 */

import { json, error } from '@sveltejs/kit';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

// Surfaces the Convex "requires Coalition tier" gate as a 403 so the editor can
// render the upgrade affordance; everything else is a 400.
function relayMutationError(e: unknown): never {
	const message = e instanceof Error ? e.message : 'Failed to update branding';
	if (/Coalition tier/i.test(message)) throw error(403, message);
	throw error(400, message);
}

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');
	try {
		const uploadUrl = await serverMutation(api.organizations.generateBrandingUploadUrl, {
			slug: params.slug
		});
		return json({ uploadUrl });
	} catch (e) {
		relayMutationError(e);
	}
};

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const body = (await request.json()) as {
		brandingAccent?: string | null;
		logoStorageId?: string | null;
		whiteLabel?: boolean;
	};

	const args: {
		slug: string;
		brandingAccent?: string | null;
		logoStorageId?: Id<'_storage'> | null;
		whiteLabel?: boolean;
	} = { slug: params.slug };

	if (body.brandingAccent !== undefined) {
		if (body.brandingAccent === null || body.brandingAccent === '') {
			args.brandingAccent = null;
		} else if (typeof body.brandingAccent === 'string') {
			// Mirror the Convex hex validation early for a friendlier message;
			// the mutation re-validates as the authoritative gate.
			if (!/^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(body.brandingAccent)) {
				throw error(400, 'Accent must be a valid hex color (e.g. #0d9488)');
			}
			args.brandingAccent = body.brandingAccent;
		}
	}

	if (body.logoStorageId !== undefined) {
		args.logoStorageId =
			body.logoStorageId === null ? null : (body.logoStorageId as Id<'_storage'>);
	}

	if (typeof body.whiteLabel === 'boolean') {
		args.whiteLabel = body.whiteLabel;
	}

	if (
		args.brandingAccent === undefined &&
		args.logoStorageId === undefined &&
		args.whiteLabel === undefined
	) {
		throw error(400, 'No branding fields to update');
	}

	try {
		await serverMutation(api.organizations.setBranding, args);
	} catch (e) {
		relayMutationError(e);
	}

	return json({ ok: true });
};
