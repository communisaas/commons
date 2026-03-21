import { sha256Hex } from './attestation';

export interface AnchorBatch {
	root: string;
	leafCount: number;
	depth: number;
	receiptIds: string[];
}

/**
 * Build a Merkle tree from receipt attestation digests.
 * Uses SHA-256 for nodes (CF Workers compatible).
 * Pads to next power of 2 with empty hashes.
 */
export async function buildAnchorMerkleTree(
	receipts: Array<{ id: string; attestationDigest: string }>
): Promise<AnchorBatch> {
	if (receipts.length === 0) {
		return { root: '', leafCount: 0, depth: 0, receiptIds: [] };
	}

	// Pad leaves to next power of 2
	const leafCount = receipts.length;
	const paddedSize = Math.pow(2, Math.ceil(Math.log2(leafCount)));
	const emptyHash = await sha256Hex('empty');

	let currentLevel = [...receipts.map((r) => r.attestationDigest)];
	while (currentLevel.length < paddedSize) {
		currentLevel.push(emptyHash);
	}

	let depth = 0;
	while (currentLevel.length > 1) {
		const nextLevel: string[] = [];
		for (let i = 0; i < currentLevel.length; i += 2) {
			const left = currentLevel[i];
			const right = currentLevel[i + 1] ?? emptyHash;
			nextLevel.push(await sha256Hex(left + right));
		}
		currentLevel = nextLevel;
		depth++;
	}

	return {
		root: currentLevel[0],
		leafCount,
		depth,
		receiptIds: receipts.map((r) => r.id)
	};
}
