/**
 * Local Constituent Resolver (MVP)
 *
 * Decrypts witness in-process using the server's X25519 private key.
 * This is a bounded-memory processing path, not a hardware isolation boundary:
 * JavaScript strings cannot be reliably zeroed. Keep plaintext out of logs,
 * databases, and response errors; replace with NitroEnclaveResolver when the
 * enclave boundary is actually deployed.
 *
 * Crypto: X25519 ECDH → BLAKE2b KDF → XChaCha20-Poly1305
 * (mirrors client-side encryption in witness-encryption.ts)
 *
 * Replace with NitroEnclaveResolver when TEE infrastructure is ready.
 * The swap is a single-line change in index.ts.
 */

import { decryptWitness } from '$lib/server/witness-decryption';
import type { ConstituentResolver, ResolveRequest, ResolverResult } from './constituent-resolver';
import { verifyProofGate, reconcileCellGate } from './resolver-gates';

export class LocalConstituentResolver implements ConstituentResolver {
	async resolve(request: ResolveRequest): Promise<ResolverResult> {
		// GATE 1: Decrypt the witness.
		let witness: Awaited<ReturnType<typeof decryptWitness>>;
		try {
			witness = await decryptWitness({
				ciphertext: request.ciphertext,
				nonce: request.nonce,
				ephemeralPublicKey: request.ephemeralPublicKey
			});
		} catch (error) {
			return {
				success: false,
				errorCode: 'DECRYPT_FAIL',
				error: error instanceof Error ? error.message : 'Witness decryption failed'
			};
		}

		// NOTE: the witness wire format may include a `congressional_district` field,
		// but we intentionally do NOT type it here — reading it would invite a
		// regression where that user-controlled value is used for routing. The
		// authoritative district comes from reconcileCellGate (atlas-derived).
		const addr = witness.deliveryAddress as
			| {
					name?: string;
					email: string;
					street: string;
					city: string;
					state: string;
					zip: string;
					phone?: string;
			  }
			| undefined;

		if (!addr) {
			return { success: false, errorCode: 'MISSING_FIELDS', error: 'No delivery address in decrypted witness' };
		}

		if (!addr.street || !addr.city || !addr.state || !addr.zip) {
			return {
				success: false,
				errorCode: 'MISSING_FIELDS',
				error: 'Incomplete delivery address: missing street, city, state, or zip'
			};
		}

		// GATE 2: Verify the ZK proof and domain binding (AR.2b).
		const verifyResult = await verifyProofGate({
			proof: request.proof,
			publicInputs: request.publicInputs,
			expected: request.expected,
			witness
		});
		if (!verifyResult.success) {
			return { success: false, errorCode: verifyResult.errorCode, error: verifyResult.error };
		}

		// GATE 3: Reconcile decrypted address to the cellId committed in the witness (AR.2c + AR.2d).
		// On success, reconcileCellGate returns the atlas-derived districtCode — this is
		// the only trustworthy source for downstream CWC routing. The witness's own
		// `congressional_district` field is user-controlled and MUST NOT be trusted
		// (an attacker can provide an honest cellId+address but lie about the district
		// string, routing the message to another district's reps).
			// G7: prefer H3 encoding when present (post-G7 credentials carry both
			// h3Cell and cellId; resolveAddress returns H3, so H3-to-H3 comparison
			// is the canonical path). Pre-G7 credentials only have cellId (BN254
			// hex) — reconcileCellGate falls through with a clear error since the
			// encoding split means meaningful comparison is impossible there.
			const witnessH3Cell = typeof witness.h3Cell === 'string' ? witness.h3Cell : undefined;
			const witnessCellId = typeof witness.cellId === 'string' ? witness.cellId : undefined;
			const reconcileResult = await reconcileCellGate({
				address: { street: addr.street, city: addr.city, state: addr.state, zip: addr.zip },
				witnessH3Cell,
				witnessCellId
			});
		if (!reconcileResult.success) {
			return { success: false, errorCode: reconcileResult.errorCode, error: reconcileResult.error };
		}

		// G7 option-(c): route from witness.districts[0] (cryptographically
		// bound to cellId via the SMT inclusion proof verified in Gate 2),
		// NOT from reconcileResult.districtCode (which derives from the
		// witness-supplied h3Cell — client-controlled).
		//
		// Why: G7 added h3Cell to the witness so the resolver could compare
		// H3-to-H3 with the address-derived H3. But h3Cell is client-supplied
		// and not bound to cellId in the leaf hash. A malicious client could
		// register with cellId=X, present witness.h3Cell=Y, deliver to an
		// address in Y — H3-to-H3 reconcile passes, delivery routes to Y's
		// district even though the proof is bound to X.
		//
		// The fix: read the routing district from witness.districts[0]. That
		// array is in the proof's public inputs (Gate 2 verifies the proof's
		// cellMapRoot + Stage 2.7 verifies witness.districts hashes to the
		// expected districtCommitment, which was bound to cellId at issuance
		// time). The H3-to-H3 reconcile in Gate 3 stays as a plausibility
		// check — "the typed delivery address is in the cell you proved" —
		// but is no longer the trust root for routing.
		const witnessDistricts = (witness as { districts?: unknown[] }).districts;
		const routingHex =
			Array.isArray(witnessDistricts) && typeof witnessDistricts[0] === 'string'
				? (witnessDistricts[0] as string)
				: undefined;
		if (!routingHex) {
			return {
				success: false,
				errorCode: 'PROOF_INVALID',
				error: 'witness_missing_congressional_slot',
			};
		}
		const { decodeBN254HexToSubstrate, convertDistrictId } = await import(
			'$lib/core/shadow-atlas/district-format'
		);
		const substrateId = decodeBN254HexToSubstrate(routingHex);
		const districtCode = convertDistrictId(substrateId);
		if (!districtCode || districtCode === routingHex) {
			// H4 — fail closed. The previous fallback to reconcileResult.districtCode
			// (which derives from the witness-supplied h3Cell) recreates exactly the
			// cell-splitting attack the G7r option-(c) routing was added to close:
			// a malicious client could register with cellId=X, present
			// witness.h3Cell=Y in a boundary cell, and the decode-failure path would
			// happily route to Y. The "preserves liveness" justification was wrong —
			// liveness for the operator at the cost of the security guarantee for
			// every other constituent. With current encoding, decode-failure should
			// never happen; if it does, the credential is malformed and we want the
			// retry/incident response path, not silent re-routing.
			console.error(
				`[LocalResolver] districts[0] hex did not decode to a substrate ID; ` +
					`failing closed. Routing on a decode failure is fail-open: a client ` +
					`could present a mismatched witness cell and be silently re-routed.`,
			);
			return {
				success: false,
				errorCode: 'PROOF_INVALID',
				error: 'witness_district_decode_failed',
			};
		}
		const routedDistrict = districtCode;

		// All three gates passed — release ConstituentData.
		return {
			success: true,
			constituent: {
				name: addr.name || 'Constituent',
				email: addr.email,
				phone: addr.phone,
				address: {
					street: addr.street,
					city: addr.city,
					state: addr.state,
					zip: addr.zip
				},
				congressionalDistrict: routedDistrict
			}
		};
	}
}
