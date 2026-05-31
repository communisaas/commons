/**
 * Off-chain action-domain derivation for Convex V8 runtime.
 *
 * Production on-chain debates derive actionDomain via the
 * DebateMarket contract's deriveDomain() (mirrored by
 * computeActionDomainLocally in src/routes/api/debates/create/+server.ts
 * and buildDebateActionDomain in src/lib/core/zkp/action-domain-builder.ts),
 * which uses solidityPackedKeccak256 reduced mod BN254. The Convex V8
 * sandbox does not ship keccak; ethers is too heavy to bundle for an
 * off-chain placeholder path and would force this caller into a Node
 * runtime (`"use node"`). Substituting Web Crypto SHA-256 produces a
 * bytes32 value with the same FORMAT (0x + 64 hex, < BN254 modulus)
 * that downstream `isValidActionDomain` validators accept — but NOT
 * the same VALUE as an on-chain keccak derivation. That divergence is
 * by design: this path emits action domains for off-chain debates the
 * contract verifier never sees. The day blockchain integration lands,
 * the off-chain branch should be removed in favor of the contract's
 * canonical derivation, not refactored to match it.
 *
 * Load-bearing invariant: DebateProofGenerator.svelte:130 calls
 * buildDebateActionDomain(baseDomain=debate.actionDomain, propositionHash)
 * which RE-keccaks the stored value as an opaque seed. The proof
 * circuit's `actionDomain` is therefore the client-side keccak result,
 * not the stored SHA-256 value — which is what makes the substitute
 * architecturally safe. If a future code path ever consumes
 * `stored_actionDomain` directly (without the re-derivation), this
 * helper must be replaced with a real keccak before that lands or
 * proof verification will break.
 */

const encoder = new TextEncoder();

// BN254 scalar field modulus (snark-friendly curve used by the
// downstream ZK circuits). Any field element must be strictly less
// than this value.
const BN254_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBigInt(hex: string): bigint {
  return BigInt(hex.startsWith("0x") ? hex : "0x" + hex);
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return new Uint8Array(buf);
}

/**
 * Hash arbitrary text to a 32-byte hex string (0x-prefixed, 64 hex
 * chars). Used to derive a proposition hash from proposition text in
 * the off-chain placeholder path. On-chain debates carry the actual
 * keccak proposition hash from the contract event; this is the
 * placeholder until that wiring lands.
 */
export async function hashTextToBytes32(text: string): Promise<string> {
  const bytes = await sha256Bytes(text);
  return "0x" + bytesToHex(bytes);
}

/**
 * Derive an off-chain debate id from propositionHash + timestamp +
 * actor. Mirrors the structural intent of
 * `src/routes/api/debates/create/+server.ts:99-105` (which uses
 * keccak of [propositionHash, timestamp, address]); SHA-256 substitute
 * keeps the format but not the on-chain value.
 */
export async function offchainDebateId(
  propositionHash: string,
  timestamp: number,
): Promise<string> {
  const bytes = await sha256Bytes(`${propositionHash}|${timestamp}|0x0000000000000000000000000000000000000000`);
  return "0x" + bytesToHex(bytes);
}

/**
 * Derive an actionDomain from (debateIdOnchain, propositionHash).
 * Mirrors the SHAPE of computeActionDomainLocally in
 * `src/routes/api/debates/create/+server.ts:143-151`:
 *   actionDomain = keccak256(packed[debateIdOnchain, "debate",
 *                  propositionHash]) mod BN254
 * Substitutes SHA-256 because Convex V8 lacks keccak. Output is a
 * 0x-prefixed 64-hex string that passes `isValidActionDomain`
 * (`src/lib/core/zkp/action-domain-builder.ts:372`).
 */
export async function offchainActionDomain(
  debateIdOnchain: string,
  propositionHash: string,
): Promise<string> {
  const bytes = await sha256Bytes(`${debateIdOnchain}|debate|${propositionHash}`);
  const raw = hexToBigInt(bytesToHex(bytes));
  const reduced = raw % BN254_MODULUS;
  return "0x" + reduced.toString(16).padStart(64, "0");
}
