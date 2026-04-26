/**
 * Wave 5 — FU-3.3 Startup EMPTY_TREE_ROOT assertion.
 *
 * Endpoint the deploy pipeline hits AFTER deploying RevocationRegistry to
 * confirm the contract's `EMPTY_TREE_ROOT()` immutable agrees with what
 * SvelteKit's Poseidon2-based `getEmptyTreeRoot()` computes. Without this
 * synchronous gate, a fresh deploy with a wrong constructor argument
 * produces broken proofs for up to 1 hour until the `reconcileSMTRoot`
 * cron fires and flags drift.
 *
 * Deploy integration (V2-PROVER-CUTOVER.md):
 *   - CI step calls GET /api/internal/health/empty-tree-root
 *   - 200 with `{ status: 'ok' }` → proceed
 *   - 200 with `{ status: 'config_missing' }` → contract not deployed yet,
 *     proceed (the cron will catch later config errors)
 *   - 500 with `{ status: 'mismatch' }` → ABORT deploy
 *   - 502 → transient RPC failure, retry
 *
 * Auth: shared INTERNAL_API_SECRET, same scheme as anchor-proof.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import {
	getRevocationRegistryAddress,
	getRevocationRegistryEmptyTreeRoot
} from '$lib/core/blockchain/district-gate-client';
import { getEmptyTreeRoot } from '$lib/server/smt/revocation-smt';

export const GET: RequestHandler = async ({ request, url }) => {
	const expected = env.INTERNAL_API_SECRET;
	if (!expected) {
		throw error(503, 'INTERNAL_API_SECRET not configured');
	}
	const provided = request.headers.get('x-internal-secret');
	if (!provided || provided !== expected) {
		throw error(403, 'Invalid internal secret');
	}

	// REVIEW 5-1 fix — fail-CLOSED on missing config in production. The original
	// 200/`status:"config_missing"` response combined with `curl -fsS` made
	// "REVOCATION_REGISTRY_ADDRESS unset" look like a passing deploy gate.
	// Operators who forget the env var would see green and proceed, then hit
	// broken revocations in production.
	//
	// Staging / pre-deploy intentionally without the contract address can pass
	// `?allow_missing=1` to opt into the soft-skip behavior. Production deploy
	// gates MUST NOT pass this flag.
	if (!getRevocationRegistryAddress()) {
		const allowMissing = url.searchParams.get('allow_missing') === '1';
		const isProd = (env.NODE_ENV ?? 'development') === 'production';
		if (isProd && !allowMissing) {
			throw error(
				503,
				'REVOCATION_REGISTRY_ADDRESS not set in production. Set the env var or pass ?allow_missing=1 (staging only).'
			);
		}
		return json({
			status: 'config_missing',
			message: 'REVOCATION_REGISTRY_ADDRESS not set; check skipped (non-prod or allow_missing=1)'
		});
	}

	let onChainEmpty: string | null;
	try {
		onChainEmpty = await getRevocationRegistryEmptyTreeRoot();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[health/empty-tree-root] on-chain read failed:', msg);
		// Transient — let the deploy pipeline retry.
		throw error(502, 'on-chain EMPTY_TREE_ROOT read failed');
	}

	if (onChainEmpty === null) {
		throw error(502, 'on-chain EMPTY_TREE_ROOT returned null');
	}

	let computedEmpty: string;
	try {
		computedEmpty = await getEmptyTreeRoot();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[health/empty-tree-root] computed read failed:', msg);
		throw error(500, `computed EMPTY_TREE_ROOT failed: ${msg}`);
	}

	if (onChainEmpty.toLowerCase() !== computedEmpty.toLowerCase()) {
		// HARD-FAIL the deploy. The contract was deployed with a constructor
		// argument that disagrees with the SvelteKit Poseidon2 image — every
		// future emit will produce roots the genesis-anchored proof chain
		// rejects. Operator must redeploy the contract with the correct
		// EMPTY_TREE_ROOT before traffic is allowed.
		console.error(
			'[health/empty-tree-root] CRITICAL: on-chain != computed empty tree root',
			{ onChainEmpty, computedEmpty }
		);
		return json(
			{
				status: 'mismatch',
				onChainEmpty,
				computedEmpty,
				message:
					'RevocationRegistry was deployed with the wrong EMPTY_TREE_ROOT constructor arg. ' +
					'Redeploy the contract with the value reported in `computedEmpty`.'
			},
			{ status: 500 }
		);
	}

	return json({
		status: 'ok',
		emptyTreeRoot: onChainEmpty
	});
};
