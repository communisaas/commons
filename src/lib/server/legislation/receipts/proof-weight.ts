/**
 * Proof Weight: quantifies how strong the cryptographic evidence was
 * that a decision-maker received verified constituent proof.
 *
 * Each component is ZK-grounded via voter-protocol three-tree proofs:
 * - verifiedCount: actions backed by three-tree ZK proofs
 * - GDS: geographic diversity (1 - HHI over district hashes)
 * - ALD: author linkage diversity (unique message hashes / total)
 * - CAI: coordination authenticity ((tier3+tier4) / tier1)
 * - temporalEntropy: Shannon entropy over hourly action bins
 */

export interface ProofWeightInput {
	verified: number;
	gds: number | null;
	ald: number | null;
	cai: number | null;
	temporalEntropy: number | null;
}

/**
 * Compute proof weight from a VerificationPacket's fields.
 * Returns [0, 1]. Zero verified actions → 0 weight.
 * Null integrity components → 0 (conservative).
 */
export function computeProofWeight(packet: ProofWeightInput): number {
	if (packet.verified === 0) return 0;

	// Log-normalize: log2(count+1) / log2(1001)
	// 1→0.10, 10→0.35, 100→0.67, 1000→1.0
	const countFactor = Math.log2(packet.verified + 1) / Math.log2(1001);

	const gds = packet.gds ?? 0;
	const ald = packet.ald ?? 0;
	const cai = Math.min(packet.cai ?? 0, 1);
	const temporalFactor = Math.min((packet.temporalEntropy ?? 0) / 3, 1);

	const integrityScore = 0.3 * gds + 0.25 * ald + 0.25 * cai + 0.2 * temporalFactor;

	return Math.min(countFactor * integrityScore, 1);
}
