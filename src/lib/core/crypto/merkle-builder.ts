/**
 * Poseidon2 Merkle Tree Builder
 *
 * Constructs a complete binary Merkle tree from leaves using Poseidon2 hashing.
 * A generic depth-N tree builder for committing to an ordered set of field
 * elements via a single Poseidon Merkle root.
 *
 * The existing `computeMerkleRoot` in poseidon.ts only verifies a path;
 * this module builds the tree from scratch and can extract paths.
 */

import { poseidon2Hash2 } from './poseidon';

/** Standard zero leaf for empty slots (sparse Merkle tree convention). */
const ZERO_LEAF = '0x' + '0'.padStart(64, '0');

export interface MerkleTree {
	/** Root hash (0x-prefixed hex). */
	root: string;
	/** All layers bottom-up: layers[0] = leaves, layers[depth] = [root]. */
	layers: string[][];
	/** Tree depth. */
	depth: number;
}

/**
 * Build a depth-d Poseidon2 Merkle tree from up to 2^d leaves.
 * Empty leaf slots are filled with the zero element.
 *
 * @param leaves - 0x-prefixed hex field elements (at most 2^depth)
 * @param depth  - Tree depth (e.g., 4 for MAX_CELLS=16)
 * @returns Tree with root, all layers, and depth
 */
export async function buildPoseidonMerkleTree(
	leaves: string[],
	depth: number
): Promise<MerkleTree> {
	const width = 1 << depth;

	if (leaves.length > width) {
		throw new Error(`Too many leaves: ${leaves.length} exceeds 2^${depth} = ${width}`);
	}

	// Pad with zero leaves to fill the tree
	const paddedLeaves = [...leaves];
	while (paddedLeaves.length < width) {
		paddedLeaves.push(ZERO_LEAF);
	}

	const layers: string[][] = [paddedLeaves];

	// Build bottom-up: each parent = Poseidon2(left_child, right_child)
	let currentLayer = paddedLeaves;
	for (let d = 0; d < depth; d++) {
		const nextLayer: string[] = [];
		for (let i = 0; i < currentLayer.length; i += 2) {
			const hash = await poseidon2Hash2(currentLayer[i], currentLayer[i + 1]);
			nextLayer.push(hash);
		}
		layers.push(nextLayer);
		currentLayer = nextLayer;
	}

	return {
		root: currentLayer[0],
		layers,
		depth
	};
}

/**
 * Extract the Merkle path (sibling hashes) for a leaf at a given index.
 * The path is ordered bottom-up (leaf level first, root level last).
 *
 * @param tree      - Tree built by buildPoseidonMerkleTree
 * @param leafIndex - Index of the leaf (0-based)
 * @returns Array of sibling hashes (length = tree.depth)
 */
export function extractMerklePath(tree: MerkleTree, leafIndex: number): string[] {
	if (leafIndex < 0 || leafIndex >= (1 << tree.depth)) {
		throw new Error(`Leaf index ${leafIndex} out of range for depth ${tree.depth}`);
	}

	const path: string[] = [];
	let idx = leafIndex;

	for (let d = 0; d < tree.depth; d++) {
		const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
		path.push(tree.layers[d][siblingIdx]);
		idx = Math.floor(idx / 2);
	}

	return path;
}

/**
 * Extract path direction bits for a leaf at a given index.
 * 0 = leaf is left child, 1 = leaf is right child.
 *
 * @param leafIndex - Index of the leaf (0-based)
 * @param depth     - Tree depth
 * @returns Array of direction bits (length = depth)
 */
export function extractPathIndices(leafIndex: number, depth: number): number[] {
	const indices: number[] = [];
	let idx = leafIndex;

	for (let d = 0; d < depth; d++) {
		indices.push(idx % 2);
		idx = Math.floor(idx / 2);
	}

	return indices;
}
