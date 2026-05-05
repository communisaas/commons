import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		throw error(400, 'Request body must be a JSON object');
	}

	const { groundVaultId, vault, wrapper } = body as Record<string, unknown>;
	if (typeof groundVaultId !== 'string' || !groundVaultId || !vault || !wrapper) {
		throw error(400, 'groundVaultId, vault, and wrapper are required');
	}

	return json(
		await serverMutation(api.ground.addPasskeyWrapperToActiveVault, {
			groundVaultId,
			vault,
			wrapper
		} as never)
	);
};
