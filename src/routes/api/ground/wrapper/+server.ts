import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverMutation } from 'convex-sveltekit';
import type { FunctionArgs } from 'convex/server';
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
	// bound caller-supplied id + JSON-stringified blob sizes.
	// Convex doc id ≤64; vault + wrapper are encrypted blobs ~few KB each but
	// downstream Convex args validators enforce schema; cap at 64KB defensive.
	if (groundVaultId.length > 64) {
		throw error(400, 'groundVaultId must be ≤64 characters');
	}
	for (const [field, value] of [
		['vault', vault],
		['wrapper', wrapper]
	] as const) {
		const serialized = JSON.stringify(value);
		if (serialized.length > 65_536) {
			throw error(400, `${field} payload must be ≤64KB serialized`);
		}
	}

	// Convex validates the structured args at runtime via `v.object({...})`.
	// The cast asserts our `unknown`-typed blob will satisfy that validator;
	// any mismatch surfaces as a Convex 400 with the offending field path.
	return json(
		await serverMutation(
			api.ground.addPasskeyWrapperToActiveVault,
			{ groundVaultId, vault, wrapper } as FunctionArgs<
				typeof api.ground.addPasskeyWrapperToActiveVault
			>
		)
	);
};
