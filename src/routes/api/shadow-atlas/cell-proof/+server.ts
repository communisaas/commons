/**
 * Shadow Atlas Cell Proof Endpoint
 *
 * Proxies Tree 2 (Cell-District Map) proof requests to Shadow Atlas.
 * Returns SMT proof + 24 district IDs for a given cell_id.
 *
 * PRIVACY NOTE: cell_id is neighborhood-level (~600-3000 people).
 * The Shadow Atlas operator learns which cell the user is in,
 * but not their specific address. Accepted tradeoff for Phase 1.
 * Phase 2 TEE can provide PIR-like privacy.
 *
 * SPEC REFERENCE: WAVE-17-19-IMPLEMENTATION-PLAN.md Section 17b
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCellProof } from '$lib/core/shadow-atlas/client';

export const GET: RequestHandler = async ({ url }) => {
	// B-4: Sessionless endpoint — cell→district mapping is public geographic data.
	// No auth check so the server cannot correlate cell_id to a user identity.
	const cellId = url.searchParams.get('cell_id');

	if (!cellId) {
		return json(
			{ error: 'Missing required parameter: cell_id' },
			{ status: 400 }
		);
	}

	// Validate cell_id format (numeric FIPS or hex)
	if (!/^(0x)?[0-9a-fA-F]+$|^\d+$/.test(cellId)) {
		return json(
			{ error: 'Invalid cell_id format' },
			{ status: 400 }
		);
	}

	try {
		const result = await getCellProof(cellId);
		return json(result);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error('[Shadow Atlas] Cell proof failed:', msg);

		// 29M-006: Return generic error for all failure modes to prevent
		// cell ID existence oracle (attacker could enumerate valid cells
		// by distinguishing 404 from 503). Log the real error internally.
		return json(
			{ error: 'Cell proof unavailable' },
			{ status: 503 }
		);
	}
};
