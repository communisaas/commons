/**
 * Internal endpoint: read the current on-chain RevocationRegistry root.
 *
 * Wave 2 (KG-2 closure) — consumed by the `reconcileSMTRoot` Convex cron.
 * The Convex runtime cannot directly call ethers/RPC, so we keep the chain
 * read on the SvelteKit side (where the relayer wallet + provider already
 * live).
 *
 * Authentication: shared INTERNAL_API_SECRET, same scheme as anchor-proof
 * and emit-revocation. Read-only — no chain writes here, no relayer cost.
 *
 * Response shape:
 *   {
 *     root:    "0x..." | null    — null if RevocationRegistry isn't deployed
 *     source:  "rpc" | "config_missing"
 *   }
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import {
	getRevocationRegistryAddress,
	getRevocationRegistryEmptyTreeRoot,
	getRevocationRegistryRoot
} from '$lib/core/blockchain/district-gate-client';
import { getEmptyTreeRoot as getComputedEmptyTreeRoot } from '$lib/server/smt/revocation-smt';

export const GET: RequestHandler = async ({ request }) => {
	const expected = env.INTERNAL_API_SECRET;
	if (!expected) {
		throw error(503, 'INTERNAL_API_SECRET not configured');
	}
	const provided = request.headers.get('x-internal-secret');
	if (!provided || provided !== expected) {
		throw error(403, 'Invalid internal secret');
	}

	// computedEmptyRoot is independent of chain state — return even when the
	// contract isn't deployed so the cron can still detect deploy-time drift
	// (contract's EMPTY_TREE_ROOT immutable !== SvelteKit's Poseidon2 image).
	let computedEmptyRoot: string | null = null;
	try {
		computedEmptyRoot = await getComputedEmptyTreeRoot();
	} catch (err) {
		console.error(
			'[revocation-root] computed empty root failed:',
			err instanceof Error ? err.message : String(err)
		);
	}

	if (!getRevocationRegistryAddress()) {
		return json({
			root: null,
			emptyTreeRoot: null,
			computedEmptyRoot,
			source: 'config_missing'
		});
	}

	try {
		// Read both in parallel. The cron uses emptyTreeRoot to distinguish
		// "healthy genesis" from "real drift" when the local SMT is empty.
		// `getRevocationRegistryRoot` now THROWS on RPC failure (REVIEW 1 fix —
		// previously it returned `0x0...0` indistinguishably from a transport
		// error). The catch below relays a 502 so the cron classifies as
		// transient.
		const [root, emptyTreeRoot] = await Promise.all([
			getRevocationRegistryRoot(),
			getRevocationRegistryEmptyTreeRoot()
		]);
		return json({ root, emptyTreeRoot, computedEmptyRoot, source: 'rpc' });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[revocation-root] read failed:', msg);
		throw error(502, 'currentRoot read failed');
	}
};
