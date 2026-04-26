/**
 * Browser-callable endpoint that fetches the V2 prover's non-membership
 * witness for a given revocation_nullifier.
 *
 * Wave 3 — wires the V2 client glue path. The browser cannot directly call
 * the Convex `internal.revocations.getRevocationNonMembershipPath` query
 * (auth scope mismatch), so this thin SvelteKit endpoint runs the query
 * server-side and returns the path + bits + currentRoot.
 *
 * Auth: requires an authenticated session. The witness data itself is not
 * sensitive (the SMT root is already public on-chain), but rate-limiting
 * the endpoint prevents random callers from amplifying Convex read load
 * during a hot proof-generation phase.
 *
 * Failure semantics:
 *   - 401 if no session
 *   - 200 with `{ path, pathBits, currentRoot, computedEmptyRoot }` on success
 *
 * `path` may contain `null` entries for sibling slots that don't exist in the
 * SMT (the depth-d empty-subtree value is the canonical fill). The endpoint
 * also returns `computedEmptyRoot` so the client doesn't need bb.js — but
 * the client SHOULD still substitute per-depth empty values, not the root.
 * For full nulls-to-zero substitution, the client must compute ZERO_HASHES[d]
 * locally via Poseidon2 (or the endpoint could pre-fill them, but that
 * couples the server to Poseidon2 here too — kept simple by returning raw
 * nulls and letting the caller fill).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery } from 'convex-sveltekit';
import { internal } from '$lib/convex';
import { getEmptyTreeRoot } from '$lib/server/smt/revocation-smt';

export const POST: RequestHandler = async ({ request, locals }) => {
	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		throw error(400, 'Missing request body');
	}

	const revocationNullifier = (body as { revocationNullifier?: unknown }).revocationNullifier;
	if (typeof revocationNullifier !== 'string') {
		throw error(400, 'revocationNullifier must be a string');
	}
	if (!/^(0x)?[0-9a-fA-F]+$/.test(revocationNullifier)) {
		throw error(400, 'revocationNullifier must be hex');
	}

	const result = await serverQuery(
		internal.revocations.getRevocationNonMembershipPath,
		{ revocationNullifier } as unknown as never
	);

	const computedEmptyRoot = await getEmptyTreeRoot();

	return json({
		path: result.path,
		pathBits: result.pathBits,
		currentRoot: result.currentRoot,
		sequenceNumber: result.sequenceNumber,
		computedEmptyRoot
	});
};
