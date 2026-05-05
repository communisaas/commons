# Architecture Decision Record: Zero-Knowledge Proof Generation

**Date**: 2025-10-24
**Status**: DECIDED - Browser-Native WASM Proving; superseded for address custody by Ground Vault PRF
**Decision Maker**: Technical Architecture Team
**Impact**: Critical - defines entire cryptographic privacy model

---

## Decision

**CHOSEN: Browser-Native WebAssembly Proving**

Zero-knowledge proofs will be generated client-side in the user's browser using
WebAssembly-compiled Noir circuits (UltraHonk backend via Barretenberg). Address
custody is now governed by the Ground Vault PRF model: the original normalized
address persists only as encrypted vault material, disclosed district/cell
metadata is stored separately, and readable address fields appear only in memory
for district resolution or government delivery requirements.

---

## Context

VOTER Protocol requires zero-knowledge proofs of congressional district
membership. Users must cryptographically prove they live in a specific district
without making their residential address part of public proof or reporting
surfaces. Official government delivery endpoints may still require readable
postal identity fields.

**Core Privacy Requirement**: plaintext addresses must not be stored at rest by
Commons. They may be processed transiently for district resolution and official
government delivery, while vault ciphertext and disclosed cell/district metadata
carry the persistent state.

---

## Architecture

### Browser-Native WASM Proving

**Client-Side Flow**:
1. User enters residential address in browser
2. Browser loads Shadow Atlas district tree from IPFS (cached in IndexedDB after first use)
3. Web Workers generate Merkle witness (4 parallel workers for Poseidon hashing)
4. Noir circuit compiled to WASM generates zero-knowledge proof (600ms-10s device-dependent)
5. Proof sent to blockchain for on-chain verification
6. **Address persists only as encrypted ground-vault material after verification**

**Proving Performance**:
- Desktop (modern CPU): 600-800ms
- Mobile (recent): 2-3s
- Mobile (budget): 5-10s

**Infrastructure**:
- Shadow Atlas: IPFS-hosted (535 district trees + 1 global tree)
- District tree size: ~8 MB per district, cached in IndexedDB
- Progressive loading: Only user's district tree downloaded
- Blockchain verification: Scroll L2 (~2.2M gas, ~$0.01-0.03 per verification)

---

## Rationale

### Why Browser-Native WASM?

**1. Proof Privacy and Bounded Address Custody**

Browser-native proving provides the strongest proof privacy guarantee:
- District proof generation does not require the plaintext address in the public proof
- Ground Vault persists the original normalized address only as ciphertext
- Disclosed H3/cell metadata is explicit product state, not hidden plaintext storage
- Delivery may handle plaintext only long enough to satisfy official endpoint requirements

TEE-based proving and cloud proving remain non-goals for the proof path. Delivery
and address custody are separate concerns handled by encrypted witnesses,
Ground Vault, and the future enclave boundary when it is actually deployed.

**2. Trustless Architecture**

Users don't need to trust:
- ❌ Server operators with plaintext address at rest
- ❌ Cloud providers (no cloud infrastructure for proving)
- ❌ TEE manufacturers (no hardware trust assumptions)
- ❌ Attestation verification (no remote attestation needed)

**Only trust requirements**:
- ✅ Open-source Noir implementation (auditable)
- ✅ Browser cryptographic primitives (WebAssembly, Web Crypto API)
- ✅ Blockchain verification contract (open-source, audited)

**3. Decentralization Alignment**

Browser-native proving aligns with web3 decentralization principles:
- No centralized proving service (single point of failure eliminated)
- No infrastructure dependencies (works offline after Shadow Atlas cached)
- Censorship-resistant (no server to block access)
- User sovereignty (full control over cryptographic materials)

**4. Regulatory Clarity**

Plaintext address collection and transmission create legal compliance complexity:
- GDPR: Address is personally identifiable information (PII)
- CCPA: California residents have data deletion rights
- State privacy laws: Growing patchwork of regulations

**Ground-vault architecture reduces the compliance surface**:
- No plaintext address storage at rest
- Encrypted vault material and disclosed cell/district metadata have explicit retention semantics
- Official government delivery disclosure is separated from public proof/reporting surfaces
- Browser-native proving still avoids a centralized proof service

**5. Long-Term Privacy Durability**

Encrypted data today may become decryptable tomorrow:
- Quantum computing threatens current encryption algorithms
- Hardware vulnerabilities discovered in TEEs (Intel SGX, AMD PSP)
- Zero-day exploits in encryption implementations

**Zero-knowledge proofs provide forward secrecy**:
- Even if proving algorithm broken in future, historical proofs reveal nothing
- No encrypted ciphertext exists to decrypt later
- Privacy guarantee survives cryptographic advances

---

## Trade-Offs Accepted

### Slower Proving on Budget Devices

**Reality**: 5-10 second proving time on budget mobile devices ($200 Android phones).

**Mitigation**:
- Progress indicator with estimated time remaining
- Educational messaging: "Generating cryptographic proof of district membership"
- Web Workers prevent UI freezing during proving
- IndexedDB caching eliminates repeated Shadow Atlas downloads

**UX Research**: Users tolerate 8-10 second waits for high-value actions (password managers, tax filing, financial transactions). Privacy-preserving congressional communication justifies the wait.

### WASM Complexity

**Challenges**:
- SharedArrayBuffer requires COOP/COEP headers
- Safari compatibility issues with SharedArrayBuffer
- WASM bundle size (~890 KB optimized, 340 KB Brotli compressed)

**Mitigation**:
- Feature detection with graceful fallback messaging
- CDN distribution for fast WASM loading (Cloudflare R2)
- Service Worker caching for repeat visits
- Comprehensive browser compatibility testing

### Shadow Atlas Distribution

**Challenge**: 4.2 GB total Shadow Atlas size (535 districts × ~8 MB each).

**Mitigation**:
- Progressive loading: Only user's district tree downloaded (~8 MB)
- IPFS distribution with Pinata pinning service
- IndexedDB persistent caching (first-load only)
- Quarterly update mechanism for redistricting

---

## Alternatives Considered

### Alternative 1: TEE-Based Proving (Rejected)

**Architecture**: Browser encrypts address with XChaCha20-Poly1305, sends to Trusted Execution Environment (AWS Nitro Enclaves), TEE decrypts and generates proof.

**Why Rejected**:
- ❌ Requires hardware trust assumptions (AMD SEV-SNP, AWS hypervisor)
- ❌ Address leaves browser (even encrypted, creates attack surface)
- ❌ Centralized infrastructure (single point of failure)
- ❌ Regulatory compliance burden (encrypted PII still regulated)
- ❌ Reduces to "trust us" model (incompatible with web3 ethos)

**Only advantage**: 2-5s consistent proving time (vs 5-10s browser WASM on budget devices). Speed improvement doesn't justify privacy reduction.

### Alternative 2: Hybrid GKR+SNARK (Rejected)

**Architecture**: Separate into garbled circuit preprocessing (fast) + SNARK composition (slow).

**Why Rejected**:
- ❌ More complex circuit design
- ❌ Larger proof size
- ❌ No significant performance improvement (still 4-6s in browser)
- ❌ Requires trusted setup (unacceptable for privacy application)

---

## Security Analysis

### Threat Model

**Attackers CANNOT**:
- ❌ Read plaintext address from Commons storage
- ❌ Decrypt the ground vault without local cache, passkey PRF unlock, or address re-entry
- ❌ Infer address from proof (zero-knowledge property)
- ❌ Reverse-engineer address from Shadow Atlas (Merkle tree reveals nothing)
- ❌ Compromise storage and recover plaintext addresses from vault ciphertext alone

**Attackers CAN** (by design):
- ✅ See which district user lives in (public output of proof)
- ✅ See when user sends messages (timing metadata)
- ✅ Monitor network traffic (all encrypted in transit via HTTPS)

**Mitigations**:
- District-level granularity acceptable (535 districts, ~730K people each)
- Timing correlation mitigated by batched blockchain submissions
- Network observers see HTTPS ciphertext only

### Browser Security Assumptions

**Trust Requirements**:
1. **Browser isolation**: JavaScript sandboxing prevents cross-origin access
2. **Web Crypto API**: Cryptographic primitives correctly implemented
3. **WebAssembly**: WASM execution doesn't leak memory to other tabs
4. **IndexedDB**: Storage quota enforced, origin-isolated

**Browser compromise scenarios**:
- Malicious browser extension: Can access all browser data (user must vet extensions)
- Browser zero-day: Theoretical but outside threat model (affects all web applications)
- Physical device access: Attacker with device access can extract data (standard threat for all applications)

**Standard web application security posture**—no additional trust assumptions beyond normal browser usage.

---

## Implementation Requirements

### Phase 1 Complete (January 2026)

**Noir Circuit Implementation (voter-protocol):**
- Noir two-tier Merkle circuit
- Shadow Atlas generation script (535 district trees + 1 global tree)
- WASM compilation pipeline (Barretenberg)
- NPM package: `@voter-protocol/crypto`

**Browser WASM Integration (Commons):**
- WASM loader with progressive enhancement
- Shadow Atlas IPFS client (district tree fetching)
- Web Workers for parallel Poseidon hashing
- IndexedDB caching layer
- Proof generation UI with progress indicator
- Browser compatibility detection

**On-Chain Verification (voter-protocol):**
- DistrictGate.sol verifier contract (Scroll L2)
- Proof verification gas optimization
- Merkle root management (quarterly Shadow Atlas updates)
- Reputation tracking integration (ERC-8004)

---

## Success Criteria

**Phase 1 Launch Requirements**:
- [ ] Proving time <10 seconds on 95th percentile devices
- [ ] WASM bundle size <500 KB Brotli compressed
- [ ] Shadow Atlas loads <2 seconds on 4G connection
- [ ] IndexedDB caching prevents repeated downloads
- [ ] Browser compatibility: Chrome, Firefox, Safari, Edge (latest 2 versions)
- [ ] Zero addresses stored in any database (verified via audit)
- [ ] Zero addresses transmitted to any server (verified via network inspection)

**User Experience**:
- [ ] Progress indicator shows proving stages
- [ ] Educational messaging explains privacy benefits
- [ ] Graceful fallback for unsupported browsers
- [ ] Error recovery for failed Shadow Atlas downloads

**Security**:
- [ ] Noir circuits audited (voter-protocol responsibility)
- [ ] WASM compilation verified bit-for-bit reproducible
- [ ] No memory leaks during proving (DevTools profiling)
- [ ] Proof verification gas costs verified on testnet

---

## Documentation Updates

**Files Updated**:
1. `README.md` - Architecture section (browser-native WASM proving)
2. `docs/frontend.md` - Client-side proving flow
3. `docs/architecture/tee-systems.md` - Clarify TEE is message delivery only

**Files Removed**:
- All references to "TEE-based proving"
- All references to "Proof Service API"
- Outdated timing claims (1-5s, 8-12s)

**New Documentation**:
- This Architecture Decision Record

---

## References

**Technical Specifications**:
- [voter-protocol/specs/ZK-PROOF-SPEC-REVISED.md](https://github.com/communisaas/voter-protocol/specs/ZK-PROOF-SPEC-REVISED.md) - Noir circuit design
- [voter-protocol/ARCHITECTURE.md](https://github.com/communisaas/voter-protocol/ARCHITECTURE.md) - Complete cryptographic architecture
- [Noir Language](https://noir-lang.org/) - Zero-knowledge DSL (UltraHonk backend)

**Privacy Frameworks**:
- GDPR Article 25: Privacy by design and by default
- NIST Privacy Framework: Minimize data processing
- W3C Privacy Principles: User control over personal data

**Browser APIs**:
- [WebAssembly Specification](https://webassembly.github.io/spec/core/) - WASM execution model
- [Web Crypto API](https://www.w3.org/TR/WebCryptoAPI/) - Browser cryptographic primitives
- [IndexedDB API](https://www.w3.org/TR/IndexedDB/) - Client-side storage

---

## Conclusion

**Browser-native WASM proving remains the correct proof architecture** for VOTER
Protocol's privacy requirements. Address custody is no longer described as
browser-only; Ground Vault PRF is the authoritative model for encrypted address
persistence, cross-device unlock where PRF is available, address re-entry
fallback, and CWC delivery disclosure.

**Privacy is not negotiable.** Speed optimizations are secondary to trustless, decentralized, censorship-resistant privacy preservation.

---

*This decision is FINAL and BINDING for Phase 1 architecture. All documentation and implementation must align with browser-native WASM proving.*

**Next Actions**:
1. Update all conflicting documentation (README.md, IMPLEMENTATION-ROADMAP.md, etc.)
2. Remove all TEE proving references
3. Standardize on "600ms-10s (device-dependent)" proving time
4. Clarify TEE is for message delivery ONLY (not proving)

**Status**: ✅ Decision documented, implementation proceeding.
