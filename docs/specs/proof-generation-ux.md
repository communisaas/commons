> ## ⚠️ SUPERSEDED (2026-02-20)
>
> This document is a **pre-implementation design sketch** kept for historical
> context. Browser-native ZK proof generation shipped in Phase 1; the shipped
> design is materially different from what this document describes.
>
> **Do not treat any code, timing, memory, or API claim below as authoritative.**
> Specifically, the following are known to be stale or fabricated relative to
> the shipped implementation:
>
> - Package `voter-district-circuit` → real package is `@voter-protocol/noir-prover`.
> - Circuit depth K=14 → real default depth is 20 (`prover-client.ts:35`).
> - 3-input proof flow (districtRoot, nullifier, actionId) → real three-tree flow
>   has 31 public inputs (`prover-client.ts:183-225`).
> - Timing estimates (2-5s desktop / 8-15s mobile) → no benchmark harness exists;
>   treat as rough guidance only. Measure in your environment.
> - Memory budget (600-800MB WASM) → unmeasured.
> - Proof size (~4.6KB) → unvalidated.
> - Integration roadmap checklist at the bottom of this doc → all items
>   shipped; leave the boxes as-is as an artifact.
>
> **Canonical references for the shipped system:**
> - Protocol: [`voter-protocol/specs/CRYPTOGRAPHY-SPEC.md`](../../../voter-protocol/specs/CRYPTOGRAPHY-SPEC.md)
> - Client: `commons/src/lib/core/zkp/prover-client.ts` (three-tree), `community-field-client.ts` (bubble), `debate-weight-client.ts`, `position-note-client.ts`
> - UX entry point: `commons/src/lib/components/template/ProofGenerator.svelte`
> - Public /spec page: [`commons/src/routes/spec/+page.svelte`](../../src/routes/spec/+page.svelte)

# Proof Generation UX: Browser-Native Zero-Knowledge Proving

## Who We're Building For

**Constituents who want to contact Congress.**

They care about three things:
1. **Privacy** - "I don't want this platform knowing my exact address"
2. **Authenticity** - "I want my representative to know I'm really from their district"
3. **Impact** - "I want my voice to matter more than bot spam"

They don't need to know it's "zero-knowledge proofs" or "UltraHonk verifiers." They need to **feel** that their privacy is protected while their authenticity is guaranteed.

## The Cypherpunk Philosophy (Subtle, Not Overt)

**Surface-level messaging:**
> "Verify you're a constituent without sharing your exact address"

**What's actually happening beneath:**
- XChaCha20-Poly1305 encryption to TEE public key
- Noir zero-knowledge proof generation in browser
- Poseidon-based Merkle tree witness
- BN254 elliptic curve cryptography
- AWS Nitro Enclaves (ARM Graviton, no Intel ME/AMD PSP)
- On-chain reputation tracking via ERC-8004

The user should **intuit** that this is different. They should feel empowered. They should understand that the platform **cannot** decrypt their data even if compelled.

## Current Flow (Phase 1: Identity Verification)

### Step 1: Identity Verification (30 seconds)

**User Experience:**
1. Click "Send Message" on congressional template
2. See VerificationGate modal: "Verify to Send"
3. Choose verification method:
   - **mDL via Digital Credentials API** (sole provider; self.xyz and Didit.me removed in Cycle 15)
4. Complete verification (30 seconds average)
5. Return to template submission

**What happens under the hood:**

```typescript
// verification-handler.ts:84-145
export async function handleVerificationComplete(
  userId: string,
  verificationResult: VerificationResult
): Promise<VerificationHandlerResult> {
  // 1. Fetch TEE public key from AWS Nitro Enclave
  const teePublicKey = await fetchTEEPublicKey();

  // 2. Build identity blob (address + verification credential)
  const identityBlob: IdentityBlob = {
    address: {
      street: verificationResult.address.street,
      city: verificationResult.address.city,
      state: verificationResult.address.state,
      zip: verificationResult.address.zip
    },
    verificationCredential: verificationResult.providerData,
    district: verificationResult.district
  };

  // 3. Encrypt blob in browser (XChaCha20-Poly1305 to TEE public key)
  const encryptedBlob = await encryptIdentityBlob(identityBlob, teePublicKey);

  // 4. Store encrypted blob in Postgres
  // Platform CANNOT decrypt this - only TEE can
  const blobId = await blobStorage.store(userId, encryptedBlob);

  // 5. Cache session credential in IndexedDB
  // No PII - just verification status + district + blob pointer
  await storeSessionCredential({
    userId,
    isVerified: true,
    verificationMethod: verificationResult.method,
    congressionalDistrict: verificationResult.district?.congressional,
    blobId,
    expiresAt: calculateExpirationDate() // 6 months
  });
}
```

**Privacy guarantee achieved:**
- ✅ Address encrypted in browser before transmission
- ✅ Platform stores only encrypted blob (cannot decrypt)
- ✅ Session credential has NO address data (just district + blob ID)
- ✅ 6-month session means verification once every 6 months

### Step 2: Progressive Verification (Instant Send)

**User Experience:**
1. User returns after 30 days
2. Clicks "Send Message" on template
3. **Instant send** - no verification modal (session cached)
4. Message delivered to Congress

**What happens under the hood:**

```typescript
// VerificationGate.svelte:42-51
export async function checkVerification(): Promise<boolean> {
  try {
    const isVerified = await hasValidSession(userId);
    console.log('[Verification Gate] Session check:', { userId, isVerified });
    return isVerified;
  } catch (error) {
    console.error('[Verification Gate] Session check failed:', error);
    return false;
  }
}
```

**Privacy guarantee maintained:**
- ✅ No server round-trip for verification check (IndexedDB only)
- ✅ Platform still cannot decrypt address blob
- ✅ User skips re-verification for 6 months

---

## Phase 2: Browser-Native ZK Proof Generation (Where WASM Prover Fits)

**This is the missing piece.** Right now, users trust that the TEE won't leak their address. In Phase 2, they prove they're in a district **without the TEE ever seeing their address.**

### The Problem We're Solving

**Current Phase 1 trust model:**
- User encrypts address to TEE public key
- TEE decrypts address during message delivery
- TEE looks up congressional district
- TEE sends message to congressional office
- TEE deletes address from memory

**Trust requirement:** User must trust AWS Nitro Enclaves won't log/leak address

**Phase 2 zero-knowledge trust model:**
- User proves they're in a district WITHOUT revealing address
- TEE never sees exact address (only ZK proof)
- Congressional office gets cryptographic proof of district membership
- Proof is publicly verifiable on-chain

**Trust requirement:** User trusts math (UltraHonk soundness = 2^-128)

### Where WASM Prover Fits in User Journey

**NEW Step 1.5: Generate ZK Proof (2-5 seconds desktop, 8-15s mobile)**

**User Experience:**

After identity verification completes:
1. User clicks "Send Message"
2. Modal shows: "Proving you're a constituent..." (2-5s loading)
3. Progress bar with educational messaging:
   - "Generating cryptographic proof..."
   - "This proves you're in [District] without revealing your exact address"
   - "Your message will be prioritized by congressional staff"
4. Proof completes → message sends
5. **No address** sent to TEE - only ZK proof

**What happens under the hood:**

```typescript
// NEW: proof-generation.ts (to be implemented)
import { Prover, hash_pair } from 'voter-district-circuit'; // WASM package

export async function generateDistrictProof(
  sessionCredential: SessionCredential
): Promise<DistrictProof> {
  // 1. Initialize WASM prover (5-10s first time, cached afterward)
  const prover = new Prover(14); // K=14 circuit

  // 2. Fetch Shadow Atlas (district Merkle tree)
  const shadowAtlas = await fetchShadowAtlas(sessionCredential.congressionalDistrict);

  // 3. Get user's address from session (decrypted client-side from IndexedDB)
  // NOTE: Address never leaves browser, never sent to server
  const address = await getDecryptedAddress(sessionCredential.blobId);

  // 4. Compute Poseidon hash of address
  const addressHash = await computeAddressHash(address);

  // 5. Build Merkle proof (address exists in district tree)
  const merkleProof = shadowAtlas.getMerklePath(addressHash);

  // 6. Generate identity commitment (nullifier seed)
  const identityCommitment = await generateIdentityCommitment(sessionCredential);

  // 7. Generate ZK proof (2-5s desktop, 8-15s mobile)
  const proof = await prover.prove(
    identityCommitment,
    actionId, // Template submission ID
    merkleProof.leafIndex,
    merkleProof.path
  );

  // 8. Return proof + public inputs (district root, nullifier, action ID)
  return {
    proof: proof, // ~4.6KB
    publicInputs: {
      districtRoot: shadowAtlas.root,
      nullifier: computeNullifier(identityCommitment, actionId),
      actionId
    },
    district: sessionCredential.congressionalDistrict
  };
}
```

**Privacy guarantees:**
- ✅ Address hashed with Poseidon (ZK-friendly)
- ✅ Merkle proof proves address ∈ district tree
- ✅ Proof reveals ZERO information about exact address
- ✅ Nullifier prevents double-voting
- ✅ Congressional office verifies proof on-chain

### Performance Considerations

**Desktop (2024+ Intel/Apple Silicon):**
- First proof: ~5-10 seconds (keygen + prove)
- Subsequent proofs: ~1-2 seconds (cached keys)
- Memory usage: 600-800MB WASM

**Mobile (2022+ Android/iOS):**
- First proof: ~12-18 seconds (keygen + prove)
- Subsequent proofs: ~8-15 seconds (cached keys)
- Memory usage: 600-800MB WASM

**UX Mitigation:**
1. **First-time initialization**: Show one-time "Setting up cryptography..." (5-10s)
2. **Proof generation**: Show "Proving you're a constituent..." (2-5s desktop, 8-15s mobile)
3. **Educational messaging**: Use loading time to explain why this matters
4. **Caching**: Store prover keys in IndexedDB (skip keygen on return visits)

### Educational Messaging During Proof Generation

**Loading screen copy (cycles every 3 seconds):**

> **Generating cryptographic proof...**
> This proves you're in [CA-12] without revealing your exact address.

> **Why this matters**
> Congressional staff prioritize verified constituents. Your voice counts more.

> **Your privacy is protected**
> The platform never sees your address. Only you and the cryptography.

> **Building your civic reputation**
> Each verified action strengthens your voice in democracy.

**Visual treatment:**
- Animated progress bar (proof circuit gate progress)
- Lock icon → unlocking animation
- District map highlight (subtle visual of their district)

---

## Perceptual Engineering: Making Computation Tangible

### Philosophy: "Pragmatic Cypherpunk"

High-tech privacy should feel like a physical tool, not a math problem. We are not "generating a proof" - we are **sealing an envelope**.

**The Core Metaphor: "The Secure Envelope"**
- **The Message:** The letter inside
- **The Encryption:** The lead lining (only recipient can open it)
- **The ZK Proof:** The wax seal on outside (proves authenticity without revealing sender)

### Three Perceptual Stages (600ms - 10s)

The process takes time. We fill this time with *meaning*, not just a spinner.

#### Stage 1: The "Hum" (Proof Generation)
**Technical:** WASM Prover running in Web Worker (high CPU usage)

**Visual:** The "Send" button expands into a status bar. A complex, organic pattern (Voronoi diagram or noise field) iterates and resolves. It looks like "computation" or "thinking," not "loading."

**Haptic (Mobile):** Low-frequency, steady vibration (if supported) or rhythmic visual pulse

**Copy progression:**
- "Checking eligibility..."
- "Anonymizing identity..."
- "Verifying district..."

**Why:** Tells the user "Your device is doing work to protect you."

#### Stage 2: The "Snap" (Encryption)
**Technical:** XChaCha20-Poly1305 encryption (<100ms)

**Visual:** The organic pattern "crystallizes" or "locks" into a solid, geometric shape (shield or closed lock). Sharp, satisfying animation.

**Sound (Optional):** Subtle "click" or "snap" sound

**Copy:** "Message sealed."

**Why:** Visually confirms content is now unreadable to anyone but recipient

#### Stage 3: The "Slide" (Transmission)
**Technical:** HTTP POST to backend

**Visual:** The sealed geometric shape slides off-screen (upwards/right), leaving clean "Sent" state

**Copy:** "Delivered to [Representative Name]."

### Technical Implementation: The "Shadow Worker"

To keep UI at 60fps while CPU crunches ZK proof, we **MUST** use a Web Worker.

**Thread separation:**
- **Main Thread:** Animations, UI updates, "Fluid Fill" effects
- **Worker Thread:** WASM loading, witness computation, proof generation

**Communication protocol:**
```typescript
// Main → Worker
START_PROOF { inputs }

// Worker → Main (progress updates)
PROGRESS { step: 'witness', percent: 20 }
PROGRESS { step: 'proving', percent: 60 }
COMPLETE { proof, publicSignals }
```

**Sequence:**
1. User clicks Send
2. UI starts "Hum" animation
3. Worker starts proof generation (heavy)
4. Worker encrypts message (light, parallel)
5. Worker finishes proof
6. UI triggers "Snap" (encryption visualization)
7. Network sends payload

### Copy Dictionary (Jargon → Intuition)

| Web3 / Tech Jargon | Our UI Copy |
| :--- | :--- |
| **Zero-Knowledge Proof** | **Anonymous Verification** |
| **Generate Witness** | **Checking Eligibility** |
| **Circuit Constraint** | **Security Check** |
| **Merkle Root** | **District Registry** |
| **Gas / Transaction** | **Delivery** |
| **Wallet / Signer** | **Your Device** |
| **Hash** | **Digital Fingerprint** |
| **Encrypt** | **Seal** |

### Error Handling: The "Jam"

If proof fails (invalid inputs) or times out:

**Visual:** Organic pattern turns "dissonant" (red/orange tint, jagged edges) and fades out

**Copy:** "Could not seal message."

**Action:** "Retry" button appears (*never* show raw stack trace)

### Accessibility

**Screen readers:** Announce status changes:
- "Anonymizing identity..."
- "Message sealed"
- "Delivered to Representative Smith"

---

## Integration Roadmap

### Week 1-2: NPM Package + Infrastructure
- [ ] Publish `voter-district-circuit` to NPM
- [ ] Add WASM loader to Vite config
- [ ] Create `proof-generation.ts` service
- [ ] Implement proof caching in IndexedDB

### Week 3-4: Shadow Atlas Data
- [ ] Generate district Merkle trees (4,096 addresses each)
- [ ] Deploy Shadow Atlas API (`/api/shadow-atlas/:district`)
- [ ] Implement client-side Atlas caching
- [ ] Build Atlas update mechanism (monthly refresh)

### Week 5-6: UX Integration
- [ ] Add proof generation step to VerificationGate
- [ ] Design loading states (educational messaging)
- [ ] Implement mobile optimization (reduce memory pressure)
- [ ] Add error handling (proof generation failures)

### Week 7-8: Testing + Optimization
- [ ] Load testing (100 concurrent proof generations)
- [ ] Mobile testing (2020-2024 devices)
- [ ] Proof size optimization (<4KB target)
- [ ] Browser compatibility testing (Chrome, Safari, Firefox)

### Week 9-10: Production Launch
- [ ] Deploy Shadow Atlas to CDN
- [ ] Enable proof generation feature flag
- [ ] Monitor proof generation metrics
- [ ] A/B test messaging variations

---

## Why This Matters (The Cypherpunk Angle)

**Surface-level value proposition:**
> "Send verified messages to Congress without sharing your exact address"

**Deep cypherpunk philosophy:**

1. **Mathematics > Trust**
   - Phase 1: Trust AWS Nitro Enclaves (hardware TEE)
   - Phase 2: Trust UltraHonk/Noir soundness (math proof)
   - ZK proofs are cryptographic guarantees, not promises

2. **Privacy = Power**
   - Platforms that see your data control you
   - Platforms that can't see your data serve you
   - Zero-knowledge = zero leverage

3. **Decentralized Verification**
   - Phase 1: TEE verifies you're in district (centralized)
   - Phase 2: Anyone can verify proof on-chain (decentralized)
   - Public verifiability = no trusted third party

4. **Civic Action = Reputation**
   - On-chain ERC-8004 reputation (soulbound)
   - Build credibility through verified actions
   - Reputation follows you across platforms

5. **Open Infrastructure**
   - Noir circuit is open-source (audit trail)
   - Shadow Atlas is reproducible (Census Bureau data)
   - Verifier contract is on-chain (immutable logic)

**The user doesn't need to understand Poseidon hashes or SHPLONK commitments. They just need to feel:**
- "This platform can't see my address even if they wanted to"
- "My representative knows I'm really from their district"
- "My voice matters more because I'm verified"

That's the cypherpunk UX - empowerment through cryptography, subtly communicated through progressive enhancement.

---

## Next Steps

1. **Publish WASM package to NPM** (`voter-district-circuit`)
2. **Design proof generation UI mockups** (Figma)
3. **Build Shadow Atlas data pipeline** (Census Bureau → Merkle trees)
4. **Integrate prover into VerificationGate** (Phase 2 feature flag)
5. **Test on real mobile devices** (performance validation)

**The WASM prover is technically ready. Now we need to make it invisible.**
