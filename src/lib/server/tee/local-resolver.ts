/**
 * Local Constituent Resolver (MVP)
 *
 * Decrypts witness in-process using the server's X25519 private key.
 * PII exists only in function-scoped variables and is garbage-collected
 * after the delivery completes.
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

		const addr = witness.deliveryAddress as
			| {
					name?: string;
					email: string;
					street: string;
					city: string;
					state: string;
					zip: string;
					phone?: string;
					congressional_district?: string;
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
		const reconcileResult = await reconcileCellGate({
			address: { street: addr.street, city: addr.city, state: addr.state, zip: addr.zip },
			witnessCellId: witness.cellId
		});
		if (!reconcileResult.success) {
			return { success: false, errorCode: reconcileResult.errorCode, error: reconcileResult.error };
		}

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
				congressionalDistrict: addr.congressional_district
			}
		};
	}
}
