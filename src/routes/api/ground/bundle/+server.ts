import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { persistGroundBundle } from '$lib/server/ground/ground-service';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		throw error(400, 'Request body must be a JSON object');
	}

	const { vault, cell, wrapper } = body as Record<string, unknown>;
	if (!vault || !cell) {
		throw error(400, 'vault and cell are required');
	}

	// bound serialized JSON blob sizes. Encrypted vault + cell
	// metadata are typically a few KB; 64KB is generous defense-in-depth.
	for (const [field, value] of [
		['vault', vault],
		['cell', cell],
		['wrapper', wrapper]
	] as const) {
		if (value !== undefined && value !== null) {
			const serialized = JSON.stringify(value);
			if (serialized.length > 65_536) {
				throw error(400, `${field} payload must be ≤64KB serialized`);
			}
		}
	}

	return json(await persistGroundBundle({ vault, cell, wrapper }));
};
