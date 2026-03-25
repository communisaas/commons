import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { FEATURES } from '$lib/config/features';

/**
 * GET /api/debates/[debateId]/position-proof?positionIndex=N
 *
 * Proxy to shadow-atlas GET /v1/debate/:debateId/position-proof/:positionIndex.
 *
 * Returns the Merkle inclusion proof for a position commitment leaf in the
 * per-debate position tree. This proof is consumed by the position_note Noir
 * circuit when a trader wants to generate a private settlement proof.
 *
 * Query parameters:
 *   positionIndex (required) — zero-based leaf index of the position to prove
 *
 * Response:
 *   {
 *     positionPath:  string[],  // sibling hashes as 0x-prefixed hex (leaf → root)
 *     positionIndex: number,    // echoed leaf index
 *     positionRoot:  string     // current position Merkle root as 0x-prefixed hex
 *   }
 *
 * Returns 400 if positionIndex is missing or not a non-negative integer.
 * Returns 404 if the debate has no position tree or the index is out of range.
 * Returns 502 if shadow-atlas is unreachable or returns an error.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Not found');
	}

	const { debateId } = params;

	const rawIndex = url.searchParams.get('positionIndex');
	if (rawIndex === null || rawIndex === '') {
		throw error(400, 'positionIndex query parameter is required');
	}

	const positionIndex = parseInt(rawIndex, 10);
	if (!Number.isFinite(positionIndex) || positionIndex < 0 || rawIndex !== String(positionIndex)) {
		throw error(400, 'positionIndex must be a non-negative integer');
	}

	const shadowAtlasUrl = env.SHADOW_ATLAS_API_URL || 'http://localhost:3000';

	const upstreamUrl = `${shadowAtlasUrl}/v1/debate/${debateId}/position-proof/${positionIndex}`;

	let response: Response;
	try {
		response = await fetch(upstreamUrl, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(10_000)
		});
	} catch (fetchErr) {
		const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
		console.error('[debates/position-proof] Shadow-atlas unreachable', {
			debateId,
			positionIndex,
			error: msg
		});
		throw error(502, 'Shadow-atlas service unreachable');
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw error(502, 'Invalid response from shadow-atlas');
	}

	if (!response.ok) {
		// Surface upstream 404 as 404 to callers; all other errors become 502
		if (response.status === 404) {
			throw error(404, 'Debate position not found — debate may have no positions yet or index is out of range');
		}
		const upstream = body as { error?: { message?: string } };
		const detail = upstream?.error?.message ?? `Shadow-atlas returned ${response.status}`;
		console.error('[debates/position-proof] Shadow-atlas error', {
			debateId,
			positionIndex,
			status: response.status,
			detail
		});
		throw error(502, `Shadow-atlas error: ${detail}`);
	}

	// Unwrap the shadow-atlas APIResponse envelope and return the payload directly
	const envelope = body as { success: boolean; data?: { positionPath: string[]; positionIndex: number; positionRoot: string } };

	if (!envelope.success || !envelope.data) {
		throw error(502, 'Unexpected response shape from shadow-atlas');
	}

	const { positionPath, positionIndex: confirmedIndex, positionRoot } = envelope.data;

	return json({
		positionPath,
		positionIndex: confirmedIndex,
		positionRoot
	});
};
