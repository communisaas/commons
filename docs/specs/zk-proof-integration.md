# Phase 1: Browser-Native Zero-Knowledge Proof Integration

> **⚠️ PARTIALLY STALE — AUDITED 2026-04-23.** This spec was written for a two-tree / single-tree branch of the ZK system and an earlier set of routes. Several concrete claims below no longer match the code. Treat anything not in this notice as aspirational until verified against source.
>
> **Canonical crypto spec:** [`voter-protocol/specs/CRYPTOGRAPHY-SPEC.md`](https://github.com/communisaas/voter-protocol/blob/main/specs/CRYPTOGRAPHY-SPEC.md)
>
> **Known divergences from implementation (verified 2026-04-23 against `main`):**
> - **Circuit:** current canonical circuit is `three_tree_membership` (user + cell-map + engagement), not single-tree district membership. Public input shape differs; use `prover-client.ts` + CRYPTOGRAPHY-SPEC §5 as the source of truth.
> - **Endpoints:** `/api/congressional/submit` does NOT exist. The real submission route is `/api/submissions/create` (Convex-backed). `/api/tee/pubkey` does not exist — it is `/api/tee/public-key/`, and nothing in the submission path calls it yet.
> - **Files claimed "Created":** `src/lib/core/zkp/witness-builder.ts` and `src/lib/stores/proof-generation.svelte.ts` do not exist. Witness construction lives in `prover-client.ts` and `*-client.ts` per-circuit builders.
> - **Feature gates:** `FEATURES.CONGRESSIONAL` is `false` and `FEATURES.DEBATE` is `false` in production (`src/lib/config/features.ts`). The flow described here is not reachable end-to-end today.
> - **TEE delivery:** `sendToTEE()` does not exist. Submissions validate a proof but do not hand the ciphertext to a TEE. AWS Nitro Enclave integration is in `docs/implementation-status.md` as "Planned."
> - **Gas / cost:** "~2.2M gas" and "~$0.01 per verification" appear throughout without a backing benchmark; `contracts/test/` has no UltraHonk verifier gas harness that produces these numbers. Treat as unverified estimates, not measured values.

> **Updated 2026-02-02**: Reflects Wave 2.3 browser prover integration completion.

**Status**: FEATURE-GATED — browser prover shipped; downstream wiring blocked on `FEATURES.CONGRESSIONAL` / TEE work.
**Architecture**: Browser-native Noir/UltraHonk proving (no server-side proving, cypherpunk-compliant)
**Performance (unverified estimates)**: 600ms-10s browser proving | ~50-100ms verification | ~2.2M gas on-chain (Scroll L2) — no UltraHonk gas benchmark in `voter-protocol/contracts/test/` produces this figure; do not cite until a harness exists.

## Wave 2.3 Implementation Summary

**Files Created:**
- `src/lib/core/zkp/prover-client.ts` - Low-level prover wrapper ✅ exists
- `src/lib/core/zkp/witness-builder.ts` - Circuit witness construction ❌ not created (witness construction lives in `prover-client.ts` and per-circuit `*-client.ts` builders)
- `src/lib/stores/proof-generation.svelte.ts` - Svelte 5 reactive store ❌ not created (proof state managed in prover-client)
- `src/lib/core/zkp/README.md` - Integration documentation

**Key Features:**
- Singleton prover management (cached after first init)
- BN254 field element validation
- Progress tracking with UI callbacks
- Concurrency protection (one proof at a time)
- SA-006 fix: Clear cache on init failure

---

## Executive Summary

**What This Solves**: Anonymous, verifiable Congressional advocacy without revealing identity to offices or platform.

**How It Works**:
1. **Identity Verification**: User proves personhood via mDL (Digital Credentials API) (FREE, 30s-2min). self.xyz and Didit.me were removed in Cycle 15.
2. **Shadow Atlas Registration**: Identity commitment added to district Merkle tree (tree size depends on depth: 260K-16M)
3. **Zero-Knowledge Proof**: Browser generates Noir/UltraHonk proof of district membership **without revealing identity**
4. **Witness Encryption**: Message content encrypted to TEE public key (XChaCha20-Poly1305 AEAD)
5. **Encrypted Delivery**: TEE decrypts message, delivers via CWC API to congressional office
6. **Reputation Update**: On-chain ERC-8004 reputation increase (domain: 'congressional-advocacy')

**Privacy Guarantees**:
- Congressional offices: See message, NOT identity (anonymous constituent)
- Commons platform: See encrypted blob, NOT message or identity
- TEE (AWS Nitro Enclave): Sees message + address only during delivery (ephemeral, no logging)
- Blockchain: Sees nullifier (prevents double-voting), NOT identity or message

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ USER BROWSER (SvelteKit 5 + TypeScript)                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ STEP 1: Identity Verification                                       │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ mDL via Digital Credentials API (sole provider)                ││
│ │ • 30 seconds - 2 minutes, FREE                                ││
│ │ • Mobile driver's license verification                        ││
│ │ • Returns identity_commitment                                 ││
│ │ • (self.xyz and Didit.me removed in Cycle 15)                ││
│ └─────────────────────────────────────────────────────────────────┘│
│           ↓                                                          │
│ STEP 2: Shadow Atlas Registration                                   │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ POST /api/shadow-atlas/register                                 ││
│ │ { identity_commitment, congressional_district, proof }          ││
│ │                                                                  ││
│ │ Backend adds commitment to district Merkle tree                 ││
│ │ Returns: { leaf_index, merkle_path, district_root }             ││
│ └─────────────────────────────────────────────────────────────────┘│
│           ↓                                                          │
│ STEP 3: Load WASM Prover (@voter-protocol/noir-prover)              │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ import { NoirProver } from '@voter-protocol/noir-prover';       ││
│ │                                                                  ││
│ │ const prover = await NoirProver.create({ depth: 20 });          ││
│ │ // depth=20 supports ~1M leaves (state/large municipal)         ││
│ └─────────────────────────────────────────────────────────────────┘│
│           ↓                                                          │
│ STEP 4: Generate Zero-Knowledge Proof (600ms-10s)                   │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ const { proof, publicInputs } = await prover.prove({            ││
│ │   // PUBLIC inputs (contract-controlled)                        ││
│ │   merkleRoot,           // Current tree root from contract      ││
│ │   actionDomain,         // Action identifier (e.g., "vote-123") ││
│ │                                                                  ││
│ │   // PRIVATE inputs (user secrets)                              ││
│ │   userSecret,           // User's secret key                    ││
│ │   districtId,           // District identifier                  ││
│ │   authorityLevel: 1,    // Authority tier (1-5)                 ││
│ │   registrationSalt,     // Registration salt                    ││
│ │                                                                  ││
│ │   // Merkle proof                                                ││
│ │   merklePath,           // Path siblings (depth=20 → 20 hashes) ││
│ │   leafIndex             // Position in tree                     ││
│ │ });                                                              ││
│ │                                                                  ││
│ │ // Circuit COMPUTES internally:                                  ││
│ │ // - leaf = hash(userSecret, districtId, authorityLevel, salt)  ││
│ │ // - nullifier = hash(userSecret, actionDomain)                 ││
│ │                                                                  ││
│ │ // Public outputs (visible on-chain):                           ││
│ │ // - merkleRoot, nullifier, authorityLevel, actionDomain,       ││
│ │ //   districtId                                                  ││
│ └─────────────────────────────────────────────────────────────────┘│
│           ↓                                                          │
│ STEP 5: Witness Encryption (XChaCha20-Poly1305 AEAD)                │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ const encryptedWitness = encrypt(                               ││
│ │   witnessData: {                                                 ││
│ │     street: "1600 Pennsylvania Ave NW",                          ││
│ │     city: "Washington",                                          ││
│ │     state: "DC",                                                 ││
│ │     zip: "20500",                                                ││
│ │     congressional_district: "DC-00"                              ││
│ │   },                                                             ││
│ │   teePublicKey,  // TEE's public key (from /api/tee/pubkey)     ││
│ │   algorithm: 'XChaCha20-Poly1305'                                ││
│ │ );                                                               ││
│ │                                                                  ││
│ │ // Only TEE can decrypt this - not Commons, not blockchain   ││
│ └─────────────────────────────────────────────────────────────────┘│
│           ↓                                                          │
│ STEP 6: Submit to Commons Backend                                │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ POST /api/congressional/submit                                   ││
│ │ {                                                                ││
│ │   proof: Uint8Array(~7300 bytes),  // ZK proof (keccak mode)     ││
│ │   publicOutputs: {                                               ││
│ │     district_root: "0x1a52...",                                  ││
│ │     nullifier: "0x8f3d...",                                      ││
│ │     action_id: "42"                                              ││
│ │   },                                                             ││
│ │   encryptedWitness: Uint8Array,  // Encrypted address           ││
│ │   encryptedMessage: Uint8Array,  // Encrypted message content   ││
│ │   templateId: "template-123",                                    ││
│ │   customizations: { ... }                                        ││
│ │ }                                                                ││
│ └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────────┐
│ COMMONS BACKEND (SvelteKit API Routes)                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ STEP 7: Store Encrypted Blobs (Postgres via Prisma)                 │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ model Submission {                                              ││
│ │   id                   String   @id @default(cuid())            ││
│ │   proof_bytes          Bytes    // ZK proof (~7.3KB keccak)     ││
│ │   district_root        String   // Public output 1              ││
│ │   nullifier            String   // Public output 2 (indexed)    ││
│ │   action_id            String   // Public output 3              ││
│ │   encrypted_witness    Bytes    // Address (TEE-encrypted)      ││
│ │   encrypted_message    Bytes    // Message (TEE-encrypted)      ││
│ │   template_id          String                                   ││
│ │   status               String   // pending | verified | ...     ││
│ │                                                                  ││
│ │   @@unique([nullifier, action_id]) // Prevent double-action     ││
│ │ }                                                                ││
│ │                                                                  ││
│ │ // Commons CANNOT read encrypted data - only TEE can         ││
│ └─────────────────────────────────────────────────────────────────┘│
│           ↓                                                          │
│ STEP 8: Submit ZK Proof to Scroll L2                                │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ import { voterBlockchainClient } from '$lib/core/blockchain';   ││
│ │                                                                  ││
│ │ const txHash = await voterBlockchainClient.submitProof({        ││
│ │   proof: submission.proof_bytes,                                ││
│ │   publicOutputs: [district_root, nullifier, action_id]          ││
│ │ });                                                              ││
│ │                                                                  ││
│ │ // Smart contract verifies proof on-chain                       ││
│ │ // Rejects if: invalid proof, nullifier reused, wrong root      ││
│ └─────────────────────────────────────────────────────────────────┘│
│           ↓                                                          │
│ STEP 9: Send to TEE for Delivery                                    │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ POST https://<tee-endpoint>/decrypt-and-deliver                 ││
│ │ {                                                                ││
│ │   encrypted_witness,  // Address (only TEE can decrypt)         ││
│ │   encrypted_message,  // Message content                        ││
│ │   submission_id,      // For tracking                           ││
│ │   representative_ids  // Target congressional offices           ││
│ │ }                                                                ││
│ │                                                                  ││
│ │ // TEE decrypts, delivers via CWC API, destroys plaintext       ││
│ └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────────┐
│ AWS NITRO ENCLAVE (ARM Graviton, hypervisor-isolated TEE)           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ STEP 10: Decrypt Witness (ephemeral, no logging)                    │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ const witnessData = decrypt(                                    ││
│ │   encrypted_witness,                                             ││
│ │   teePrivateKey  // Never leaves enclave                         ││
│ │ );                                                               ││
│ │                                                                  ││
│ │ // Now TEE knows: "1600 Pennsylvania Ave NW, DC-00"             ││
│ │ // Address exists ONLY in enclave memory during delivery        ││
│ └─────────────────────────────────────────────────────────────────┘│
│           ↓                                                          │
│ STEP 11: Call CWC API (Congressional Offices)                       │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ POST https://soapbox.senate.gov/api/v2/message                  ││
│ │ {                                                                ││
│ │   recipient: "senator-office-id",                                ││
│ │   constituent: {                                                 ││
│ │     address: witnessData.street,  // Verified in district       ││
│ │     city: witnessData.city,                                      ││
│ │     state: witnessData.state,                                    ││
│ │     zip: witnessData.zip                                         ││
│ │   },                                                             ││
│ │   message: decryptedMessage,                                     ││
│ │   subject: template.title                                        ││
│ │ }                                                                ││
│ │                                                                  ││
│ │ // Congressional office receives message from "Anonymous        ││
│ │ // Constituent in DC-00" - identity NOT revealed                ││
│ └─────────────────────────────────────────────────────────────────┘│
│           ↓                                                          │
│ STEP 12: Destroy Plaintext (cryptographic erasure)                  │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ // Enclave terminates after delivery                            ││
│ │ // Address + message exist ONLY in volatile memory              ││
│ │ // No disk writes, no logging, hypervisor-isolated              ││
│ └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────────┐
│ SCROLL zkEVM (Ethereum L2, On-Chain Verification)                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ STEP 13: Verify ZK Proof (Solidity Verifier Contract)               │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ function verify(                                                 ││
│ │   bytes calldata proof,                                          ││
│ │   bytes32 district_root,                                         ││
│ │   bytes32 nullifier,                                             ││
│ │   uint256 action_id                                              ││
│ │ ) public returns (bool) {                                        ││
│ │   // 1. Check nullifier not already used                        ││
│ │   require(!usedNullifiers[nullifier], "Action already taken");  ││
│ │                                                                  ││
│ │   // 2. Verify UltraHonk proof (~2.2M gas)                      ││
│ │   require(verifyProof(proof, [district_root, nullifier, ...]),  ││
│ │          "Invalid ZK proof");                                    ││
│ │                                                                  ││
│ │   // 3. Mark nullifier as used                                  ││
│ │   usedNullifiers[nullifier] = true;                             ││
│ │                                                                  ││
│ │   // 4. Update reputation (ERC-8004)                            ││
│ │   reputationRegistry.increaseReputation(                         ││
│ │     nullifier,  // User identifier (anonymous)                   ││
│ │     "congressional-advocacy",  // Domain                         ││
│ │     1  // +1 reputation point                                    ││
│ │   );                                                             ││
│ │                                                                  ││
│ │   return true;                                                   ││
│ │ }                                                                ││
│ └─────────────────────────────────────────────────────────────────┘│
│           ↓                                                          │
│ STEP 14: Reputation Update (ERC-8004 Registry)                      │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ event ReputationIncreased(                                       ││
│ │   bytes32 indexed account,     // nullifier (anonymous)          ││
│ │   string indexed domain,       // "congressional-advocacy"       ││
│ │   uint256 amount,              // +1 point                       ││
│ │   uint256 newTotal             // Updated reputation score       ││
│ │ );                                                               ││
│ │                                                                  ││
│ │ // User can now query their reputation:                         ││
│ │ // voterBlockchainClient.getReputation(nullifier, domain)       ││
│ └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation

### 1. WASM Prover Integration (Commons Frontend)

**Location**: `src/lib/core/zkp/prover-client.ts`

```typescript
/**
 * Browser-Native Zero-Knowledge Proof Generation
 *
 * Uses @voter-protocol/noir-prover for Noir/UltraHonk proving
 * Performance: 600ms-10s depending on device (mobile slower)
 */

import { NoirProver, type CircuitInputs, type ProofResult, type CircuitDepth } from '@voter-protocol/noir-prover';

let proverInstance: NoirProver | null = null;

/**
 * Initialize WASM prover (call once at app startup)
 * First call takes 2-5 seconds to load circuit and initialize
 * Subsequent proofs reuse cached instance
 *
 * @param depth - Merkle tree depth (18/20/22/24). Default: 20 (~1M leaves)
 */
export async function initializeProver(depth: CircuitDepth = 20): Promise<void> {
	if (proverInstance) return;

	try {
		// Initialize Noir prover with specified depth
		// depth=18: ~260K leaves (small municipal)
		// depth=20: ~1M leaves (state/large municipal)
		// depth=22: ~4M leaves (federal)
		// depth=24: ~16M leaves (national)
		proverInstance = await NoirProver.create({ depth });

		console.log(`ZK prover initialized (depth=${depth})`);
	} catch (error) {
		console.error('Failed to initialize ZK prover:', error);
		throw new Error('ZK prover initialization failed');
	}
}

/**
 * Generate zero-knowledge proof of district membership
 *
 * Circuit computes internally:
 * - leaf = hash(userSecret, districtId, authorityLevel, registrationSalt)
 * - nullifier = hash(userSecret, actionDomain)
 *
 * @param inputs - Circuit inputs (public + private + merkle proof)
 * @returns ZK proof bytes + public outputs
 */
export async function generateDistrictMembershipProof(
	inputs: CircuitInputs
): Promise<ProofResult> {
	if (!proverInstance) {
		throw new Error('Prover not initialized - call initializeProver() first');
	}

	try {
		// Generate UltraHonk proof
		const result = await proverInstance.prove(inputs);

		// Public outputs from circuit:
		// - merkleRoot: Tree root the proof verifies against
		// - nullifier: hash(userSecret, actionDomain) - prevents double-action
		// - authorityLevel: User's permission tier (1-5)
		// - actionDomain: Action this proof is bound to
		// - districtId: District the user proved membership in
		return result;
	} catch (error) {
		console.error('Proof generation failed:', error);
		throw new Error('Failed to generate ZK proof');
	}
}

/**
 * Verify proof locally before submitting (optional sanity check)
 * Fast: ~50-100ms in browser
 */
export async function verifyProofLocally(
	proof: Uint8Array,
	publicInputs: ProofResult['publicInputs']
): Promise<boolean> {
	if (!proverInstance) {
		throw new Error('Prover not initialized');
	}

	try {
		return await proverInstance.verify(proof, publicInputs);
	} catch (error) {
		console.error('Local verification failed:', error);
		return false;
	}
}
```

**Usage in Svelte Component**:

```svelte
<script lang="ts">
	import { initializeProver, generateDistrictMembershipProof } from '$lib/core/zkp/prover-client';
	import type { CircuitInputs } from '@voter-protocol/noir-prover';
	import { onMount } from 'svelte';

	let isProverReady = $state(false);
	let isGenerating = $state(false);
	let proofProgress = $state<string>('');

	onMount(async () => {
		// Initialize prover on component mount (depth=20 for ~1M leaves)
		proofProgress = 'Loading ZK prover...';
		await initializeProver(20);
		isProverReady = true;
		proofProgress = 'Prover ready';
	});

	async function submitMessage() {
		if (!isProverReady) {
			alert('ZK prover not ready yet - please wait');
			return;
		}

		isGenerating = true;
		proofProgress = 'Generating zero-knowledge proof...';

		try {
			// Get Shadow Atlas data from API
			const atlasData = await fetch('/api/shadow-atlas/user-data').then(r => r.json());

			// Build circuit inputs
			const inputs: CircuitInputs = {
				// PUBLIC inputs (contract-controlled)
				merkleRoot: atlasData.merkle_root,
				actionDomain: actionDomain,  // e.g., "congressional-message-2026-01"

				// PRIVATE inputs (user secrets)
				userSecret: atlasData.user_secret,
				districtId: atlasData.district_id,
				authorityLevel: 1,  // Basic voter
				registrationSalt: atlasData.registration_salt,

				// Merkle proof
				merklePath: atlasData.merkle_path,  // 20 hashes for depth=20
				leafIndex: atlasData.leaf_index
			};

			// Generate UltraHonk proof (8-15 seconds on mobile)
			// Circuit computes: leaf = hash(userSecret, districtId, authorityLevel, salt)
			//                   nullifier = hash(userSecret, actionDomain)
			const { proof, publicInputs } = await generateDistrictMembershipProof(inputs);

			proofProgress = 'Proof generated! Encrypting message...';

			// Encrypt witness data (address)
			const encryptedWitness = await encryptWitness(userAddress, teePublicKey);

			// Encrypt message content
			const encryptedMessage = await encryptMessage(messageContent, teePublicKey);

			// Submit to backend
			const response = await fetch('/api/congressional/submit', {
				method: 'POST',
				body: JSON.stringify({
					proof: Array.from(proof),  // Uint8Array → number[]
					publicInputs,
					encryptedWitness: Array.from(encryptedWitness),
					encryptedMessage: Array.from(encryptedMessage),
					templateId,
					customizations
				})
			});

			if (response.ok) {
				proofProgress = 'Message submitted anonymously!';
			} else {
				throw new Error('Submission failed');
			}
		} catch (error) {
			proofProgress = 'Failed to generate proof';
			console.error(error);
		} finally {
			isGenerating = false;
		}
	}
</script>

{#if !isProverReady}
	<p>{proofProgress}</p>
{:else}
	<button onclick={submitMessage} disabled={isGenerating}>
		{isGenerating ? proofProgress : 'Send Anonymous Message'}
	</button>
{/if}
```

### 2. Shadow Atlas Data Storage (Commons Backend)

**Location**: `src/routes/api/shadow-atlas/register/+server.ts`

```typescript
/**
 * Shadow Atlas Registration API
 *
 * After identity verification, user's identity_commitment is added to
 * their congressional district's Merkle tree.
 *
 * Returns merkle_path needed for ZK proof generation.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/core/db';
import { hash_pair } from '@voter-protocol/noir-prover';  // Poseidon hash

export const POST: RequestHandler = async ({ request, locals }) => {
	const { identity_commitment, congressional_district, identity_proof } = await request.json();

	// Verify user is authenticated
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	// Verify identity proof (mDL via Digital Credentials API)
	const isValid = await verifyIdentityProof(identity_proof);
	if (!isValid) {
		return json({ error: 'Invalid identity proof' }, { status: 400 });
	}

	// Get or create district Merkle tree
	let tree = await db.shadowAtlasTree.findUnique({
		where: { congressional_district }
	});

	if (!tree) {
		// Initialize empty tree
		tree = await db.shadowAtlasTree.create({
			data: {
				congressional_district,
				leaf_count: 0,
				merkle_root: EMPTY_TREE_ROOT_K14,
				leaves: []
			}
		});
	}

	// Check tree capacity (depends on circuit depth: 18→260K, 20→1M, 22→4M, 24→16M)
	if (tree.leaf_count >= 4096) {
		return json({ error: 'District tree full - contact support' }, { status: 503 });
	}

	// Add identity_commitment to next available leaf
	const leaf_index = tree.leaf_count;
	const updated_leaves = [...tree.leaves, identity_commitment];

	// Recompute Merkle root using Poseidon hash (same as circuit)
	const merkle_root = computeMerkleRoot(updated_leaves);

	// Update tree in database
	await db.shadowAtlasTree.update({
		where: { id: tree.id },
		data: {
			leaf_count: tree.leaf_count + 1,
			leaves: updated_leaves,
			merkle_root
		}
	});

	// Store user's registration
	await db.user.update({
		where: { id: locals.user.id },
		data: {
			identity_verified: true,
			verification_method: identity_proof.method,  // 'mdl' (legacy records may contain 'self.xyz' | 'didit')
			identity_commitment,
			shadow_atlas_leaf_index: leaf_index,
			congressional_district
		}
	});

	// Generate merkle_path for this leaf (path length = circuit depth)
	const merkle_path = generateMerklePath(updated_leaves, leaf_index);

	return json({
		success: true,
		data: {
			leaf_index,
			merkle_path,  // User needs this for ZK proof generation
			merkle_root,
			district_size: tree.leaf_count + 1
		}
	});
};

/**
 * Compute Merkle root using Poseidon hash (MUST match circuit)
 * Uses @voter-protocol/noir-prover's hash_pair to ensure consistency
 *
 * @param leaves - Array of leaf hashes
 * @param depth - Circuit depth (18/20/22/24)
 */
function computeMerkleRoot(leaves: string[], depth: number): string {
	const maxLeaves = 2 ** depth;

	// Pad to max leaves with zeros
	const paddedLeaves = [...leaves];
	while (paddedLeaves.length < maxLeaves) {
		paddedLeaves.push(ZERO_HASH);
	}

	// Build tree bottom-up using Poseidon hash
	let currentLevel = paddedLeaves;
	for (let level = 0; level < depth; level++) {
		const nextLevel = [];
		for (let i = 0; i < currentLevel.length; i += 2) {
			const left = currentLevel[i];
			const right = currentLevel[i + 1];
			const parent = hash_pair(left, right);  // Poseidon hash from WASM
			nextLevel.push(parent);
		}
		currentLevel = nextLevel;
	}

	return currentLevel[0];  // Root
}

/**
 * Generate merkle_path for leaf at given index
 * Returns sibling hashes needed for circuit verification (length = depth)
 *
 * @param leaves - Array of leaf hashes
 * @param leafIndex - Position of target leaf
 * @param depth - Circuit depth (18/20/22/24)
 */
function generateMerklePath(leaves: string[], leafIndex: number, depth: number): string[] {
	const maxLeaves = 2 ** depth;

	const paddedLeaves = [...leaves];
	while (paddedLeaves.length < maxLeaves) {
		paddedLeaves.push(ZERO_HASH);
	}

	const path: string[] = [];
	let currentIndex = leafIndex;
	let currentLevel = paddedLeaves;

	for (let level = 0; level < depth; level++) {
		const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
		path.push(currentLevel[siblingIndex]);

		// Move to parent level
		const nextLevel = [];
		for (let i = 0; i < currentLevel.length; i += 2) {
			const parent = hash_pair(currentLevel[i], currentLevel[i + 1]);
			nextLevel.push(parent);
		}

		currentLevel = nextLevel;
		currentIndex = Math.floor(currentIndex / 2);
	}

	return path;
}
```

### 3. Submission Endpoint (Commons Backend)

**Location**: `src/routes/api/congressional/submit/+server.ts`

```typescript
/**
 * Congressional Message Submission with ZK Proof
 *
 * Receives:
 * - ZK proof of district membership
 * - Encrypted witness (address, only TEE can decrypt)
 * - Encrypted message (content)
 *
 * Stores encrypted blobs, submits proof to blockchain, sends to TEE
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/core/db';
import { voterBlockchainClient } from '$lib/core/blockchain/voter-client';

export const POST: RequestHandler = async ({ request, locals }) => {
	const {
		proof,              // Uint8Array as number[]
		publicOutputs,      // { district_root, nullifier, action_id }
		encryptedWitness,   // Encrypted address
		encryptedMessage,   // Encrypted message content
		templateId,
		customizations
	} = await request.json();

	// Convert number[] back to Uint8Array
	const proofBytes = new Uint8Array(proof);
	const witnessBytes = new Uint8Array(encryptedWitness);
	const messageBytes = new Uint8Array(encryptedMessage);

	// Check nullifier not already used (prevent double-submission)
	const existingSubmission = await db.submission.findUnique({
		where: {
			nullifier_action_id: {
				nullifier: publicOutputs.nullifier,
				action_id: publicOutputs.action_id
			}
		}
	});

	if (existingSubmission) {
		return json({
			success: false,
			error: 'This action has already been taken (nullifier reused)'
		}, { status: 409 });
	}

	// Store submission in database (encrypted blobs)
	const submission = await db.submission.create({
		data: {
			proof_bytes: proofBytes,
			district_root: publicOutputs.district_root,
			nullifier: publicOutputs.nullifier,
			action_id: publicOutputs.action_id,
			encrypted_witness: witnessBytes,
			encrypted_message: messageBytes,
			template_id: templateId,
			customizations,
			status: 'pending'
		}
	});

	// Submit ZK proof to blockchain (async, don't block)
	voterBlockchainClient.submitProof({
		proof: proofBytes,
		publicOutputs: [
			publicOutputs.district_root,
			publicOutputs.nullifier,
			publicOutputs.action_id
		]
	}).then(txHash => {
		// Update submission with blockchain confirmation
		db.submission.update({
			where: { id: submission.id },
			data: {
				blockchain_tx_hash: txHash,
				status: 'verified'
			}
		});
	}).catch(error => {
		console.error('Blockchain verification failed:', error);
		db.submission.update({
			where: { id: submission.id },
			data: { status: 'verification_failed' }
		});
	});

	// Send to TEE for delivery (async)
	sendToTEE({
		submission_id: submission.id,
		encrypted_witness: witnessBytes,
		encrypted_message: messageBytes,
		template_id: templateId
	}).catch(error => {
		console.error('TEE delivery failed:', error);
	});

	return json({
		success: true,
		data: {
			submission_id: submission.id,
			status: 'pending',
			message: 'ZK proof submitted - delivery in progress'
		}
	});
};
```

### 4. Database Schema Updates

**Location**: `prisma/schema.prisma`

```prisma
// Shadow Atlas: District Merkle Trees (size depends on circuit depth)
model ShadowAtlasTree {
  id                     String   @id @default(cuid())
  congressional_district String   @unique  // "CA-12", "NY-15", etc.

  // Merkle tree state
  leaf_count             Int      @default(0)  // Current size
  merkle_root            String   // Poseidon hash root
  leaves                 String[] // identity_commitments

  // Metadata
  created_at             DateTime @default(now())
  updated_at             DateTime @updatedAt
}

// User Shadow Atlas Registration
model User {
  // ... existing fields ...

  // Identity verification (mDL via Digital Credentials API; self.xyz and Didit.me removed in Cycle 15)
  identity_verified      Boolean  @default(false)
  verification_method    String?  // 'mdl' (legacy records may contain 'self.xyz' | 'didit')
  identity_commitment    String?  // Poseidon hash of identity secret

  // Shadow Atlas position
  shadow_atlas_leaf_index Int?    // Position in district tree (0-4095)
  congressional_district  String? // "CA-12", "NY-15", etc.
}

// Anonymous Submissions (ZK-proven messages)
model Submission {
  id                   String   @id @default(cuid())

  // ZK proof data
  proof_bytes          Bytes    // UltraHonk proof (~7.3KB keccak)
  district_root        String   // Public output 1
  nullifier            String   // Public output 2 (prevents double-action)
  action_id            String   // Public output 3 (identifies action type)

  // Encrypted data (only TEE can decrypt)
  encrypted_witness    Bytes    // Address + district (XChaCha20-Poly1305)
  encrypted_message    Bytes    // Message content

  // Metadata
  template_id          String
  customizations       Json?
  status               String   // pending | verified | delivered | failed
  blockchain_tx_hash   String?  // Scroll L2 transaction hash

  // Timestamps
  created_at           DateTime @default(now())
  delivered_at         DateTime?

  // Prevent nullifier reuse (double-action protection)
  @@unique([nullifier, action_id])
  @@index([status])
  @@index([blockchain_tx_hash])
}
```

---

## Performance Characteristics

### Browser-Native Proving (WASM)

| Device | First Init | Proof Generation | Verification |
|--------|------------|------------------|--------------|
| **Desktop (M1/M2)** | 5-7s | 600ms-1.5s | 50-80ms |
| **Desktop (Intel i7)** | 8-10s | 1-2s | 80-100ms |
| **Mobile (High-end)** | 10-15s | 3-5s | 100-150ms |
| **Mobile (Mid-range)** | 15-20s | 8-15s | 150-200ms |

**Memory Usage**: ~800MB peak (WASM module + KZG params)
**Proof Size**: ~7.3KB (UltraHonk keccak mode)
**Circuit Depths**: 18/20/22/24 (260K/1M/4M/16M leaves respectively)

### On-Chain Verification (Scroll L2)

| Operation | Gas Cost | Cost @ 0.1 gwei | Time |
|-----------|----------|-----------------|------|
| **Proof Verification** | ~2.2M gas | $0.01-0.03 | ~2-3s |
| **Reputation Update** | 50-80k gas | $0.003-0.005 | <1s |
| **Total** | ~2.3M gas | $0.013-0.035 | ~3-4s |

**Platform Coverage**: Commons pays all gas fees (user-side gas-free)

---

## Security Guarantees

### Privacy Properties

1. **Identity Privacy**:
   - Congressional offices: See encrypted message + district, NOT identity
   - Commons platform: See encrypted blobs, NOT message or identity
   - TEE: Sees address + message only during delivery (ephemeral, no logging)
   - Blockchain: Sees nullifier (anonymous identifier), NOT identity

2. **Message Privacy**:
   - Encrypted with XChaCha20-Poly1305 AEAD to TEE public key
   - Only TEE (AWS Nitro Enclave) can decrypt
   - Commons backend stores encrypted blobs (cannot read plaintext)

3. **Double-Action Prevention**:
   - Nullifier = hash(userSecret, actionDomain)
   - Smart contract rejects reused nullifiers
   - Same person cannot submit same action twice within an action domain

4. **Membership Privacy**:
   - ZK proof proves: "I am ONE OF the registered district residents"
   - Does NOT reveal: Which resident, which address, which leaf
   - Anonymity set: All registered residents in district tree

### Cryptographic Assumptions

1. **Noir/UltraHonk Security**: Relies on Aztec's UltraHonk proving system with efficient recursion
2. **Poseidon Hash**: Collision-resistant hash function optimized for ZK circuits
3. **XChaCha20-Poly1305**: AEAD cipher (standardized, widely audited)
4. **TEE Isolation**: AWS Nitro Enclaves hypervisor isolation (AMD SEV-SNP or ARM TrustZone)

### Threat Model

**Protects Against**:
- ✅ Platform surveillance (Commons cannot read messages/identities)
- ✅ Congressional office profiling (cannot link messages to specific constituents)
- ✅ Double-voting (nullifier prevents action reuse)
- ✅ Non-residents (ZK proof verifies district membership)

**Does NOT Protect Against**:
- ❌ TEE compromise (if Nitro Enclave is fully compromised, ephemeral data could leak)
- ❌ Side-channel attacks (timing analysis of delivery patterns)
- ❌ Coordinated identity linkage (if congressional offices collude with identity providers)

**Mitigation**: Phase 2 will add fully client-side decryption via homomorphic encryption (no TEE dependency)

---

## Implementation Checklist

### Phase 1.1: WASM Prover Integration (COMPLETE - Wave 2.3)

- [x] Install `@voter-protocol/noir-prover` package in Commons
- [x] Create `src/lib/core/zkp/prover-client.ts`
- [x] Add prover initialization to app layout
- [x] Build UI progress indicators for proof generation (8-15s)
- [x] Create `src/lib/stores/proof-generation.svelte.ts` (Svelte 5 runes)
- [ ] Test on various devices (desktop, mobile, tablets) - Ongoing

### Phase 1.2: Shadow Atlas Backend (COMPLETE - Wave 1.2)

- [x] Add `ShadowAtlasTree` model to Prisma schema
- [x] Create `/api/shadow-atlas/register` endpoint
- [x] Implement Poseidon hash Merkle tree building
- [x] Add `generateMerklePath()` utility
- [x] Create `/api/shadow-atlas/user-data` endpoint (returns merkle_path)
- [x] SHA-256 → Poseidon2 hash unification

### Phase 1.3: Identity Verification Integration (COMPLETE - Wave 2.2)

- [x] ~~self.xyz NFC passport~~ Removed in Cycle 15
- [x] ~~Didit.me identity verification~~ Removed in Cycle 15; replaced by mDL via Digital Credentials API
- [x] Build identity verification UI flow
- [x] Extract identity_commitment from verification proofs
- [x] Link verification to Shadow Atlas registration
- [x] Three-layer identity binding (Sybil + cross-provider + ZK)

### Phase 1.4: Submission Flow (COMPLETE - Wave 2.4)

- [x] Update `Submission` model in Prisma schema
- [x] Create XChaCha20-Poly1305 encryption utilities
- [x] Build `/api/congressional/submit` endpoint
- [x] Implement nullifier-enforced submission
- [x] Implement proof → blockchain submission (async)
- [ ] Implement encrypted blob → TEE delivery (Deferred to Phase 2)

### Phase 1.5: Testing & Optimization (COMPLETE - Wave 3.4)

- [x] E2E test: Identity verification → Shadow Atlas → Proof → Delivery
- [x] Contract tests: 164 passing
- [x] Security tests: 84 passing (validator + rate limiter)
- [x] Prover tests: 7 passing
- [x] Crypto tests: 30 passing
- [x] Depth-24 proof generation test (BA-017)
- [ ] Load testing: 1000 concurrent proof generations - Ongoing
- [ ] Mobile optimization: Reduce WASM memory footprint - Ongoing

---

## Success Metrics

### Cryptographic Performance

- **Target**: 90% of users complete proof generation <10s
- **Target**: 0% proof verification failures (excluding malicious attempts)
- **Target**: <1% TEE delivery failures

### Privacy Metrics

- **Target**: 0 plaintext leaks from Commons database
- **Target**: 0 identity linkages in congressional office deliveries
- **Target**: 100% nullifier enforcement (no double-actions)

### User Experience

- **Target**: 80% of users complete identity verification <2 minutes
- **Target**: 100% mDL via Digital Credentials API (sole provider; self.xyz and Didit.me removed)
- **Target**: <5% drop-off during ZK proof generation

---

## References

- **voter-protocol Noir Prover**: `voter-protocol/packages/noir-prover/src/` (sibling repo)
- **Circuit Types**: `voter-protocol/packages/noir-prover/src/types.ts` (sibling repo)
- **Progressive Verification**: `docs/architecture/graduated-trust.md`
- **Architecture**: `docs/architecture.md`
- **Reputation System**: `docs/specs/universal-credibility.md`

---

**Implementation Status**: Browser prover integrated (`prover-client.ts`). Witness builder and reactive store not yet created.
**Timeline**: 10 weeks (identity verification + WASM integration + Shadow Atlas + submission flow + testing)
**Cost Savings**: $0 (no server-side proving infrastructure needed - browser-native only)
