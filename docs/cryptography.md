# Cryptographic Requirements (Commons Integration View)

> **Canonical cryptographic specification:** [`voter-protocol/specs/CRYPTOGRAPHY-SPEC.md`](../../voter-protocol/specs/CRYPTOGRAPHY-SPEC.md) — circuits, Poseidon2 construction, domain separation, nullifier scheme (NUL-001), Aztec trusted-setup provenance, threat model.
>
> This document covers **Commons-side integration** only: where the Commons SvelteKit app touches the crypto boundary, what it validates, and which of its imports resolve into the voter-protocol crypto package.

**Last Updated:** 2026-04-21

---

## Integration Points

### 1. Identity Commitment Derivation

Produced during identity verification via the W3C Digital Credentials API (mDL). The identity commitment is the **stable** field element that feeds the nullifier and the Tree 3 engagement leaf.

```ts
import { computeIdentityCommitmentInBoundary } from '$lib/core/identity/mdl-verification';

const identityCommitment = await computeIdentityCommitmentInBoundary(/* ... */);
// Returned by the mDL verification flow.
```

Stable across re-registrations: same verified person always produces the same `identity_commitment`, even with new `user_secret` / `registration_salt` / cell. This is the Sybil-resistance anchor (NUL-001).

### 2. Tree 1 Registration

The browser computes the leaf locally and sends **only** the leaf hash to the Commons server:

```ts
import { registerThreeTree } from '$lib/core/identity/shadow-atlas-handler';

const result = await registerThreeTree({
  userId,
  leaf,              // H4(user_secret, cell_id, registration_salt, authority_level)
  cellId,            // BN254 field element, resolved from IPFS cell chunk
  tree2: { ... },    // SMT proof data
  userSecret,        // stored client-side only, NEVER sent to server
  registrationSalt,  // stored client-side only, NEVER sent to server
  verificationMethod: 'digital-credentials-api'
});
```

Privacy invariant: the Commons server sees only the leaf hash, never `user_secret`, `cell_id`, `registration_salt`, or `identity_commitment` as witness values. The server returns a **canonical** `identityCommitment` bound to the verified identity, which the browser uses for Tree 3 queries and nullifier generation. (This closes the historical NUL-001 wiring gap.)

### 3. Prover Client

```ts
import { generateThreeTreeProof } from '$lib/core/zkp/prover-client';

const { proof, publicInputs, nullifier } = await generateThreeTreeProof({
  userSecret,
  cellId,
  registrationSalt,
  identityCommitment,   // validated non-zero: NUL-001
  userRoot,
  userPath,
  userIndex,
  cellMapRoot,
  cellMapPath,
  cellMapPathBits,
  districts,
  engagementRoot,
  engagementPath,
  engagementIndex,
  engagementTier,
  actionCount,
  diversityScore,
  authorityLevel,
  actionDomain
});
```

All inputs are validated against `BN254_MODULUS` before proof generation. `identity_commitment` non-zero assertion enforced client-side (mirrors the in-circuit assertion).

### 4. Field Element Validation

```ts
import { BN254_MODULUS } from '$lib/core/crypto/bn254';
import { validateFieldElement } from '$lib/core/zkp/prover-client';

validateFieldElement(userSecret, 'userSecret');   // throws if >= BN254_MODULUS
```

```
BN254_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
```

### 5. Hasher Usage (Server-Side Utilities)

Where server-side code needs to hash field elements (e.g., deriving action domains, receipt attestation):

```ts
import { Poseidon2Hasher } from '@voter-protocol/crypto';

const hasher = await Poseidon2Hasher.getInstance();
const h = await hasher.hashPair(left, right);           // H2
const h3 = await hasher.hash3(a, b, c);                 // H3
const root = await hasher.poseidon2Sponge(twentyFour);  // 24-element sponge
```

The hasher executes the Noir `fixtures` / `sponge_helper` circuits internally, so TypeScript and Noir cannot diverge on the hash itself. See CRYPTOGRAPHY-SPEC §9.

---

## Crypto-Adjacent Files (Commons)

| Path | Purpose |
|---|---|
| `src/lib/core/crypto/bn254.ts` | BN254 modulus constant, field validation helpers |
| `src/lib/core/crypto/poseidon.ts` | Browser Poseidon2 via `@aztec/bb.js` BarretenbergSync — full wrapper, not a re-export. Provides `poseidon2Hash{1,2,3,4}`, `poseidon2Sponge24`, `computeNullifier`, `computeMerkleRoot`, and the `DOMAIN_HASH{1..4}` / `DOMAIN_SPONGE_24` constants. |
| `src/lib/core/crypto/noir-prover-shim.ts` | Browser prover shim, witness validation |
| `src/lib/core/identity/mdl-verification.ts` | mDL flow, identity commitment derivation |
| `src/lib/core/identity/shadow-atlas-handler.ts` | Tree 1 registration, Tree 3 engagement fetch |
| `src/lib/core/zkp/prover-client.ts` | Three-tree proof generation |
| `src/lib/core/zkp/community-field-client.ts` | Bubble membership proof (Phase 2) |
| `src/lib/core/proof/witness-encryption.ts` | X25519 + XChaCha20 witness encryption |

---

## Commons-Specific Domain Strings (Frozen Post-Launch)

These strings are used by Commons, not by the circuits. They have no effect on ZK proof verification but must remain stable to preserve Commons-encrypted credentials across releases.

| String | Use |
|---|---|
| `commons-identity-v1` | Identity commitment domain prefix (SHA-256 mod BN254, used during pre-circuit derivation) |
| `commons-credential-v2` | HKDF salt for per-user AES-256-GCM credential encryption (IndexedDB at-rest) |
| `commons-witness-encryption-v1` | BLAKE2b **keyed-hash** key (passed as the 3rd arg to libsodium `crypto_generichash`, `src/lib/core/proof/witness-encryption.ts:~202`) deriving the X25519 → XChaCha20 witness-encryption key |

---

## What NOT to Use

- **SHA-256, Keccak, BLAKE3** for Merkle or nullifier derivation. Only Poseidon2 with the domain tags defined in CRYPTOGRAPHY-SPEC §3.
- **Untagged Poseidon2** (i.e., `poseidon2([a, b, 0, 0])` without a domain tag). Every Poseidon2 invocation must carry a domain tag to prevent cross-arity collisions.
- **Custom hash reimplementations.** Always go through `@voter-protocol/crypto`'s `Poseidon2Hasher`, which wraps the Noir circuit.

---

## References

- **Canonical:** [`voter-protocol/specs/CRYPTOGRAPHY-SPEC.md`](../../voter-protocol/specs/CRYPTOGRAPHY-SPEC.md)
- **Engagement tier derivation:** [`voter-protocol/specs/REPUTATION-ARCHITECTURE-SPEC.md`](../../voter-protocol/specs/REPUTATION-ARCHITECTURE-SPEC.md)
- **Threat model:** [`voter-protocol/specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md`](../../voter-protocol/specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md)
- **String encoding:** [`voter-protocol/specs/STRING-ENCODING-SPEC.md`](../../voter-protocol/specs/STRING-ENCODING-SPEC.md)
