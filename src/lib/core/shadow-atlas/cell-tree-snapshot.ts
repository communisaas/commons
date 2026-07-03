/**
 * Client-Side Cell Tree Path Computation (Phase A3)
 *
 * Deserializes a Sparse Merkle Tree snapshot (fetched from IPFS by ipfs-store.ts)
 * and computes Tree 2 (Cell-District Map) Merkle paths locally — no server call.
 *
 * Architecture:
 *   ipfs-store.ts  →  fetch + cache compressed blob from IPFS (bedrock)
 *   THIS MODULE    →  deserialize blob → CellTreeSnapshot → computeClientCellProof()
 *   client.ts      →  wires getCellProof() to use this instead of Shadow Atlas API
 *
 * The snapshot stores only non-zero nodes in a Sparse Merkle Tree. Empty subtrees
 * use precomputed zero hashes (Poseidon2-based, built by the snapshot publisher).
 *
 * Memory budget:
 *   IndexedDB:  compressed blob (15-25 MB) — within Safari's 50 MB cap
 *   JS heap:    deserialized Maps (~20-40 MB for ~85K cells + internal nodes)
 *   Session:    module-level cache, cleared on tab close/reload
 *
 * BN254 validation happens once at deserialization time, not per proof request.
 */

import { BN254_MODULUS } from '$lib/core/crypto/bn254';
import type { CellProofResult } from './client';

// ============================================================================
// Types
// ============================================================================

/**
 * Deserialized sparse Merkle tree, ready for path computation.
 * Layers follow the same convention as merkle-builder.ts:
 *   layers[0] = leaf level, layers[depth] would be [root] (not stored — use `root`).
 */
export interface CellTreeSnapshot {
	/** Tree depth (20 for production). */
	depth: number;
	/** Tree root as 0x-prefixed BN254 hex. */
	root: string;
	/**
	 * Precomputed empty subtree hashes per level [0..depth-1].
	 * zeroHashes[0] = zero leaf, zeroHashes[i] = Poseidon2(zh[i-1], zh[i-1]).
	 * Computed by snapshot publisher, NOT at deserialization time.
	 */
	zeroHashes: string[];
	/**
	 * Sparse layers: only non-zero nodes stored per level.
	 * layers[0] = leaf level. Map<nodeIndex, 0x-hex hash>.
	 * Missing entries → use zeroHashes[level].
	 */
	layers: Array<Map<number, string>>;
	/**
	 * Cell metadata: cellId → { leafIndex, districts }.
	 * districts is the 24 hex-encoded district IDs for the circuit.
	 */
	cellMeta: Map<string, CellMetadata>;
}

/** Metadata for a single cell in the sparse tree. */
export interface CellMetadata {
	/** Position in the leaf layer (Tree 2). */
	leafIndex: number;
	/** 24 hex-encoded district IDs (circuit private inputs). */
	districts: string[];
}

/**
 * Wire format: the JSON-serializable structure inside the IPFS blob.
 * Substrate/proof builds this quarterly; we deserialize it.
 *
 * Sorted arrays per level enable efficient binary search during
 * deserialization into Maps.
 */
export interface CellTreeSnapshotWire {
	version: number;
	depth: number;
	root: string;
	zeroHashes: string[];
	/** Sparse layers as sorted [index, hash] pairs per level. */
	layers: Array<Array<[number, string]>>;
	/** Cell metadata sorted by leafIndex. */
	cells: Array<{
		cellId: string;
		leafIndex: number;
		districts: string[];
	}>;
}

// ============================================================================
// BN254 Validation (inline to avoid importing server-only client.ts)
// ============================================================================

function validateHex(value: string, label: string): void {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) {
		throw new Error(
			`CellTreeSnapshot: Invalid ${label}: expected 0x-hex, got "${String(value).slice(0, 20)}"`
		);
	}
	const bigVal = BigInt(value);
	if (bigVal >= BN254_MODULUS) {
		throw new Error(`CellTreeSnapshot: ${label} exceeds BN254 field modulus`);
	}
}

// ============================================================================
// Deserialization
// ============================================================================

/**
 * Deserialize a cell tree snapshot from its wire format.
 *
 * Validates all field elements against BN254 modulus. This is the single
 * validation point — computeClientCellProof() trusts deserialized data.
 *
 * @param wire - Parsed wire format (JSON-decoded from IPFS blob)
 * @returns Deserialized tree ready for path computation
 * @throws Error if validation fails
 */
export function deserializeCellTreeSnapshot(wire: CellTreeSnapshotWire): CellTreeSnapshot {
	if (!wire || typeof wire !== 'object') {
		throw new Error('CellTreeSnapshot: wire data must be an object');
	}

	const { version, depth, root, zeroHashes, layers: wireLayers, cells } = wire;

	// Version check
	if (version !== 1) {
		throw new Error(`CellTreeSnapshot: unsupported version ${version}, expected 1`);
	}

	// Depth sanity
	if (typeof depth !== 'number' || depth < 1 || depth > 30) {
		throw new Error(`CellTreeSnapshot: invalid depth ${depth}`);
	}

	// Root validation
	validateHex(root, 'root');

	// Zero hashes
	if (!Array.isArray(zeroHashes) || zeroHashes.length !== depth) {
		throw new Error(
			`CellTreeSnapshot: expected ${depth} zeroHashes, got ${zeroHashes?.length}`
		);
	}
	for (let i = 0; i < depth; i++) {
		validateHex(zeroHashes[i], `zeroHashes[${i}]`);
	}

	// Layers
	if (!Array.isArray(wireLayers) || wireLayers.length !== depth) {
		throw new Error(
			`CellTreeSnapshot: expected ${depth} layers, got ${wireLayers?.length}`
		);
	}

	const layers: Array<Map<number, string>> = [];
	for (let level = 0; level < depth; level++) {
		const wireLayer = wireLayers[level];
		if (!Array.isArray(wireLayer)) {
			throw new Error(`CellTreeSnapshot: layer ${level} must be an array`);
		}

		const map = new Map<number, string>();
		for (const entry of wireLayer) {
			if (!Array.isArray(entry) || entry.length !== 2) {
				throw new Error(`CellTreeSnapshot: layer ${level} entry must be [index, hash]`);
			}
			const [index, hash] = entry;
			if (typeof index !== 'number' || index < 0) {
				throw new Error(`CellTreeSnapshot: invalid node index ${index} at layer ${level}`);
			}
			validateHex(hash, `layers[${level}][${index}]`);
			map.set(index, hash);
		}
		layers.push(map);
	}

	// Cell metadata
	if (!Array.isArray(cells)) {
		throw new Error('CellTreeSnapshot: cells must be an array');
	}

	const cellMeta = new Map<string, CellMetadata>();
	for (const cell of cells) {
		if (!cell.cellId || typeof cell.leafIndex !== 'number' || !Array.isArray(cell.districts)) {
			throw new Error(`CellTreeSnapshot: invalid cell entry for "${cell?.cellId}"`);
		}
		if (cell.districts.length !== 24) {
			throw new Error(
				`CellTreeSnapshot: cell "${cell.cellId}" has ${cell.districts.length} districts, expected 24`
			);
		}
		for (let d = 0; d < 24; d++) {
			validateHex(cell.districts[d], `cell[${cell.cellId}].districts[${d}]`);
		}
		cellMeta.set(cell.cellId, {
			leafIndex: cell.leafIndex,
			districts: cell.districts,
		});
	}

	return { depth, root, zeroHashes, layers, cellMeta };
}

// ============================================================================
// Path Computation
// ============================================================================

/**
 * Compute a Tree 2 cell proof from a deserialized snapshot.
 *
 * Produces the same CellProofResult as Shadow Atlas's GET /v1/cell-proof,
 * but computed locally from the cached snapshot. No network call.
 *
 * This is a synchronous function — pure Map lookups, no hashing.
 * All BN254 validation was done at deserialization time.
 *
 * @param tree   - Deserialized snapshot from deserializeCellTreeSnapshot()
 * @param cellId - Cell identifier (census tract FIPS or hex, must match snapshot keys)
 * @returns CellProofResult compatible with existing SessionCredential flow
 * @throws Error if cell not found in snapshot
 */
export function computeClientCellProof(
	tree: CellTreeSnapshot,
	cellId: string
): CellProofResult {
	const meta = tree.cellMeta.get(cellId);
	if (!meta) {
		throw new Error(
			`Cell "${cellId}" not found in snapshot. ` +
			`Snapshot contains ${tree.cellMeta.size} cells.`
		);
	}

	const { leafIndex, districts } = meta;
	const { depth, zeroHashes, layers } = tree;

	// Extract Merkle path: walk from leaf to root, collecting siblings.
	// Identical logic to merkle-builder.ts extractMerklePath() but with
	// sparse Map lookups + zeroHash fallback.
	const cellMapPath: string[] = [];
	const cellMapPathBits: number[] = [];
	let idx = leafIndex;

	for (let level = 0; level < depth; level++) {
		// Direction bit: 0 = leaf is left child, 1 = right child
		const bit = idx & 1;
		cellMapPathBits.push(bit);

		// Sibling index: flip the least significant bit
		const siblingIdx = bit === 0 ? idx + 1 : idx - 1;

		// Lookup sibling in sparse layer; fall back to zero hash
		const siblingHash = layers[level].get(siblingIdx) ?? zeroHashes[level];
		cellMapPath.push(siblingHash);

		// Move to parent
		idx = idx >> 1;
	}

	return {
		cellMapRoot: tree.root,
		cellMapPath,
		cellMapPathBits,
		districts,
	};
}

// ============================================================================
// Root Validation
// ============================================================================

/**
 * Validate the snapshot's root against a trusted anchor.
 *
 * Currently compares against Shadow Atlas's live root via the cell-proof
 * endpoint (fetching any cell and comparing roots). When the on-chain
 * DistrictRegistry is deployed, this will read from the contract instead.
 *
 * @param tree        - Deserialized snapshot
 * @param trustedRoot - Optional explicit trusted root (e.g., from on-chain).
 *                      If not provided, fetches one proof from Shadow Atlas
 *                      to compare roots.
 * @returns true if roots match
 */
export async function validateSnapshotRoot(
	tree: CellTreeSnapshot,
	trustedRoot?: string
): Promise<boolean> {
	if (trustedRoot) {
		return tree.root === trustedRoot;
	}

	// Fallback: fetch a live proof from Shadow Atlas and compare roots.
	// This is a lightweight validation — we only need the root, not the full proof.
	// When DistrictRegistry goes on-chain, replace this with a contract read.
	try {
		// Dynamic import to avoid circular dependency (client.ts imports us)
		// LATENT (2026-07-03): self-referential loop — this imports client.ts
		// getCellProof, whose snapshot validation calls back into THIS function,
		// and merkle-snapshot.json is not published on the live atlas (the fetch
		// 404s). Going live requires publishing merkle-snapshot.json and passing
		// an on-chain trustedRoot above instead of this fallback.
		const { getCellProof: fetchLiveProof } = await import('./client');
		// Use the first cell in our snapshot as a probe
		const firstCell = tree.cellMeta.keys().next();
		if (firstCell.done) {
			// Empty snapshot — can't validate
			return false;
		}
		const liveProof = await fetchLiveProof(firstCell.value);
		return tree.root === liveProof.cellMapRoot;
	} catch (error) {
		// Shadow Atlas unreachable — can't validate.
		// Caller decides whether to trust the snapshot or reject.
		console.warn(
			'[CellTreeSnapshot] Root validation failed (Shadow Atlas unreachable):',
			error instanceof Error ? error.message : String(error)
		);
		return false;
	}
}
