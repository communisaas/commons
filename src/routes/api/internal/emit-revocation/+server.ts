/**
 * Internal endpoint: on-chain revocation emit (Stage 5 F1 closure).
 *
 * Called asynchronously by the Convex `emitOnChainRevocation` internalAction
 * whenever a credential is revoked via `verifyAddress` (Stage 1 server gate)
 * or the one-shot `cutover-v1-credentials.ts` script. Submits the credential's
 * revocation nullifier to `RevocationRegistry.emitRevocation` on Scroll L2.
 *
 * The Convex worker passes `districtCommitment` (not the nullifier) so the
 * server-side Poseidon2 wrapper derives the nullifier here — this keeps the
 * domain constant (`REVOCATION_DOMAIN`) co-located with the primary crypto
 * primitives (`src/lib/core/crypto/poseidon.ts`) and ensures any future
 * change to the derivation is a single-file edit.
 *
 * Classification of outcomes (the Convex worker keys off `kind`):
 *   - success         → revocationStatus='confirmed', txHash persisted
 *   - rpc_transient   → retry with exponential backoff
 *   - contract_revert → terminal (AlreadyRevoked, UnauthorizedRelayer) — NO retry
 *   - config          → terminal (missing env vars) — operator alert
 *
 * Authentication: shared INTERNAL_API_SECRET header (same auth class as
 * anchor-proof). The endpoint has access to the relayer wallet so a leaked
 * secret is a gas-drain vector — see `enforceInternalRateLimit` below.
 *
 * @see REVOCATION-NULLIFIER-SPEC-001 §2.1 (derivation) and §2.3 (write path)
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { enforceInternalRateLimit } from '$lib/server/internal/rate-limit';
import { computeRevocationNullifier } from '$lib/core/crypto/poseidon';
import {
	emitOnChainRevocation,
	getRevocationRegistryAddress
} from '$lib/core/blockchain/district-gate-client';
import { insertRevocationNullifier } from '$lib/server/smt/revocation-smt';

interface EmitRevocationRequestBody {
	/** Convex Id of the credential being revoked (opaque string, used for
	 *  correlation in logs/alerts; not verified cryptographically). */
	credentialId?: string;
	/** 0x-prefixed 32-byte Poseidon2 sponge-24 output. The endpoint derives
	 *  revocationNullifier = H2(districtCommitment, REVOCATION_DOMAIN). This
	 *  field is REQUIRED — the caller-supplied-nullifier branch was removed
	 *  (F-1.5) so the server is the only authority on the derivation. */
	districtCommitment?: string;
}

export const POST: RequestHandler = async ({ request }) => {
	const expected = env.INTERNAL_API_SECRET;
	if (!expected) {
		throw error(503, 'INTERNAL_API_SECRET not configured');
	}
	const provided = request.headers.get('x-internal-secret');
	if (!provided || provided !== expected) {
		throw error(403, 'Invalid internal secret');
	}

	// Gas-expensive: every accepted call is a chain write via the relayer
	// wallet. 60/min matches anchor-proof's posture — enough burst headroom
	// for the cutover script (1K credentials = ~16 min @ 60 req/min), hard
	// cap on a leaked-secret gas-drain attack. Uses its own bucket so a
	// cutover surge does not starve the anchor-proof path.
	await enforceInternalRateLimit({
		endpoint: 'emit-revocation',
		maxRequests: 60,
		windowMs: 60_000
	});

	const body = (await request.json().catch(() => null)) as EmitRevocationRequestBody | null;
	if (!body || typeof body !== 'object') {
		throw error(400, 'Missing request body');
	}

	// Shape validation — credentialId is optional for correlation but must be
	// a string when present. `districtCommitment` is REQUIRED (F-1.5: the
	// pre-computed-nullifier alternative was removed).
	if (body.credentialId !== undefined && typeof body.credentialId !== 'string') {
		throw error(400, 'credentialId must be a string when provided');
	}

	// Resolve the revocation nullifier. F-1.5 (2026-04-25): the only accepted
	// input is `districtCommitment` — the server derives the nullifier via the
	// canonical Poseidon2 wrapper (`computeRevocationNullifier`). Removing the
	// alternative caller-supplied-nullifier branch makes the server the single
	// source of truth for `REVOCATION_DOMAIN`, eliminates a body-injection
	// vector where a leaked secret could submit arbitrary nullifiers, and keeps
	// any future change to the derivation a single-file edit.
	if (typeof body.districtCommitment !== 'string' || body.districtCommitment.length === 0) {
		throw error(400, 'districtCommitment is required (0x-prefixed 32-byte hex)');
	}
	if (!/^0x[0-9a-fA-F]{64}$/.test(body.districtCommitment)) {
		throw error(400, 'districtCommitment must be 0x-prefixed 32-byte hex');
	}
	let revocationNullifier: string;
	try {
		revocationNullifier = await computeRevocationNullifier(body.districtCommitment);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[emit-revocation] Poseidon2 derivation failed:', msg);
		throw error(500, 'Failed to derive revocation nullifier');
	}

	// Early config guard — if the registry address is not set we surface a
	// classified `config` error immediately instead of waiting for the
	// contract layer to report it. Convex treats this as terminal (no retry).
	if (!getRevocationRegistryAddress()) {
		console.warn('[emit-revocation] REVOCATION_REGISTRY_ADDRESS not set');
		return json(
			{
				success: false,
				kind: 'config',
				error: 'REVOCATION_REGISTRY_ADDRESS not configured'
			},
			{ status: 500 }
		);
	}

	// Compute the new SMT root the contract will commit. Wave 2 (KG-2 closure):
	// the canonical Poseidon2 sparse Merkle tree is persisted in Convex and
	// updated atomically here. Optimistic concurrency: if a parallel emit
	// landed between read and write, `insertRevocationNullifier` retries with
	// jittered exponential backoff up to 6 times before throwing.
	//
	// Idempotency: when the leaf is already in Convex (e.g., a prior chain
	// write failed and the worker is retrying), the helper returns the
	// EXISTING root with `isFresh=false` — we still proceed to the chain emit
	// so a stuck "Convex ahead of chain" state can recover. The chain itself
	// reverts AlreadyRevoked if the nullifier is already on-chain, which
	// downstream callers treat as terminal-OK.
	let newRoot: string;
	let isFresh: boolean;
	try {
		const result = await insertRevocationNullifier(revocationNullifier);
		newRoot = result.newRoot;
		isFresh = result.isFresh;
		if (!isFresh) {
			console.warn('[emit-revocation] SMT leaf already present; retrying chain emit', {
				credentialId: body.credentialId?.slice(0, 8),
				leafCount: result.leafCount
			});
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg === 'REVOCATION_EMITS_HALTED') {
			// Wave 5 / FU-2.1 — drift kill-switch active. Terminal `config`
			// error so the Convex worker stops retrying and alerts ops.
			console.error('[emit-revocation] kill-switch active — emit refused', {
				credentialId: body.credentialId?.slice(0, 8)
			});
			return json(
				{ success: false, kind: 'config', error: 'revocation_emits_halted' },
				{ status: 500 }
			);
		}
		if (msg === 'SMT_SEQUENCE_CONFLICT_EXHAUSTED') {
			// 6 retries with backoff failed — likely a sustained concurrent-
			// emit storm. Convex worker requeues with its own outer backoff.
			console.warn('[emit-revocation] SMT seq conflict exhausted', {
				credentialId: body.credentialId?.slice(0, 8)
			});
			return json(
				{ success: false, kind: 'rpc_transient', error: 'smt_concurrency_conflict' },
				{ status: 502 }
			);
		}
		console.error('[emit-revocation] SMT insert failed:', msg);
		return json(
			{ success: false, kind: 'config', error: 'smt_insert_failed' },
			{ status: 500 }
		);
	}

	// Submit via the shared client. Circuit breaker is unified with the
	// verify path, so a failing Scroll RPC halts both.
	const result = await emitOnChainRevocation({
		revocationNullifier,
		newRoot
	});

	if (result.success) {
		console.debug('[emit-revocation] confirmed', {
			credentialId: body.credentialId?.slice(0, 8),
			txHash: result.txHash,
			blockNumber: result.blockNumber
		});
		return json({
			success: true,
			txHash: result.txHash,
			blockNumber: result.blockNumber
		});
	}

	// REVIEW 2 fix: idempotent retry + chain AlreadyRevoked = success.
	//
	// When `isFresh=false` (Convex SMT already had the leaf) AND the chain
	// reverts with AlreadyRevoked, both layers agree: this credential is
	// revoked. The first emit's chain tx must have landed; the worker just
	// lost the response. Returning `success: false, kind: 'contract_revert'`
	// here would (incorrectly) flip `revocationStatus='failed'` in Convex
	// even though the on-chain state is exactly what we wanted. Surface as
	// success so the worker marks `revocationStatus='confirmed'`.
	const isAlreadyRevoked =
		result.kind === 'contract_revert' &&
		typeof result.error === 'string' &&
		result.error.includes('AlreadyRevoked');
	if (!isFresh && isAlreadyRevoked) {
		console.debug('[emit-revocation] idempotent recovery: chain AlreadyRevoked', {
			credentialId: body.credentialId?.slice(0, 8)
		});
		return json({
			success: true,
			txHash: undefined, // no fresh tx — original tx is what landed
			recoveredFromIdempotentRetry: true
		});
	}

	// Map the client's EmitRevocationKind to an HTTP status the Convex worker
	// can meaningfully condition on:
	//   rpc_transient   → 502 (retry)
	//   contract_revert → 502 (but kind='contract_revert' signals terminal)
	//   config          → 500 (terminal, operator-visible)
	const status = result.kind === 'config' ? 500 : 502;
	return json(
		{
			success: false,
			kind: result.kind,
			error: result.error ?? 'emit_revocation_failed'
		},
		{ status }
	);
};
