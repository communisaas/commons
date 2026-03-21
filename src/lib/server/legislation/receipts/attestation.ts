/**
 * Attestation Digest: SHA-256 binding of proof delivery to bill + decision-maker.
 *
 * Hot path: SHA-256 (runs on CF Workers).
 * Cold path: Poseidon2 hash computed at IPFS anchor time (Phase 4, Node.js CLI).
 *
 * Both are deterministic from the same inputs, so the binding is consistent.
 */

/**
 * Compute SHA-256 hex digest of a string input.
 * Works on CF Workers (Web Crypto API).
 */
export async function sha256Hex(input: string): Promise<string> {
	const encoded = new TextEncoder().encode(input);
	const hash = await crypto.subtle.digest('SHA-256', encoded);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Compute the attestation digest for an accountability receipt.
 *
 * Binds four facts: the proof delivered, the bill, the decision-maker, and the proof weight.
 * Format: SHA-256(packetDigest || ':' || billExternalId || ':' || decisionMakerId || ':' || scaledWeight)
 */
export async function computeAttestationDigest(
	packetDigest: string,
	billExternalId: string,
	decisionMakerId: string,
	proofWeight: number
): Promise<string> {
	const scaledWeight = Math.round(proofWeight * 10000).toString();
	const preimage = `${packetDigest}:${billExternalId}:${decisionMakerId}:${scaledWeight}`;
	return sha256Hex(preimage);
}
