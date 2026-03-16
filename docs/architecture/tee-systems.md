# TEE Systems Overview

**VOTER Protocol uses TEE for two purposes: message delivery and debate evaluation. ZK proof generation remains in-browser.**

---

## TEE Use Case 1: Message Delivery ✅

**Purpose**: Decrypt congressional messages for CWC API delivery

**Why TEE is Required**:
- Congressional offices receive messages via CWC API (plaintext required)
- End-to-end encryption requires trusted intermediary
- TEE provides hardware-isolated decryption environment

**Implementation**: Week 13 Complete (October 22, 2025)
- Files: `tee-workload/` - Universal TEE container
- Cloud provider: AWS Nitro Enclaves (current target, mock/Phase 2)
- Cost: ~$350-400/month (always-on)

**Flow**:
1. Browser encrypts message with XChaCha20-Poly1305
2. TEE decrypts message in hardware-isolated memory
3. TEE forwards plaintext to CWC API
4. Plaintext cleared from memory after delivery

---

## TEE Use Case 2: Debate Evaluation ⏳

**Purpose**: Verifiable, tamper-proof AI evaluation of debate arguments

**Why TEE for Evaluation**:
- Debate resolution determines financial outcomes (USDC stakes). The evaluator must be provably honest.
- Running open-weight models (Llama 8B, Mistral 7B) inside a Nitro Enclave means nobody — not even the operator — can see or manipulate intermediate computation.
- The enclave produces an attestation document (PCR measurements) proving exactly what code ran, what model weights were loaded, and what scores were produced.
- Attestation hash posted on-chain (Scroll) for public audit.

**Architecture Decision — Why TEE, Not Bittensor Subnet**:
- Bittensor mainnet subnet creation requires ~100 TAO lock (~$28K at current prices) plus ~1000 TAO validator stake (~$280K). Prohibitive for early-stage.
- Bittensor testnet faucet is unreliable (50 TAO cap, gateway timeouts). Not viable for demo.
- TEE gives you **one provably honest evaluator** (cryptographic attestation) instead of N miners you hope are honest (economic incentives). Cheaper, simpler, verifiable.
- The evaluation pipeline (multi-model scoring, BTS aggregation, source retrieval, anti-gaming) is identical — only the trust model changes (hardware attestation vs. token economics).

**Target Implementation**:
- Instance: c7g.2xlarge (8 vCPU, 16GB RAM, Graviton3) with Nitro Enclave
- Model: Llama 8B Q4 quantized via llama.cpp (ARM Neon optimized for Graviton)
- Cost: ~$0.12 per debate evaluation (spin up, evaluate, shut down — not always-on)
- Source retrieval: Exa neural search (~$0.06/debate for claim grounding)
- Trigger: EventBridge cron or Lambda on debate deadline

**Flow**:
1. Debate deadline passes → cron triggers evaluation
2. Nitro Enclave instance spins up with pre-baked EIF image (model weights + evaluation code)
3. Enclave fetches arguments from Commons API
4. Runs multi-model evaluation with source retrieval (Exa)
5. Aggregates scores (median, BTS, anti-gaming checks)
6. Produces attestation document (PCR measurements bind code + weights + I/O)
7. POSTs results + attestation to `POST /api/debates/{id}/subnet-evaluate`
8. Attestation hash posted on-chain (Scroll Sepolia)
9. Instance terminates. Total wall time: ~20 min.

**Fallback**: The existing centralized 5-model AI panel (`POST /api/debates/{id}/evaluate`) remains operational as the Phase 1 path. TEE evaluation is the Phase 2 upgrade — same scoring dimensions, same alpha blend, but with cryptographic proof of honest computation.

---

## What TEE IS NOT Used For: ZK Proof Generation ❌

**Zero-knowledge proofs are generated entirely in browser** using WebAssembly-compiled Noir circuits (UltraHonk backend via Barretenberg).

**Why Browser WASM, Not TEE**:
- ✅ **Absolute Privacy**: Address never leaves browser (not even encrypted)
- ✅ **Trustless**: No hardware trust assumptions required
- ✅ **Decentralized**: No centralized proving service
- ✅ **Regulatory Clarity**: No address transmission = no PII compliance burden

**Implementation**: Week 9-10 (Browser WASM Integration)
- Shadow Atlas loaded from IPFS (progressive loading, IndexedDB caching)
- Web Workers for parallel Poseidon hashing
- Noir proof generation in browser (600ms-10s device-dependent)
- Address never sent to any server

**See**: `docs/architecture/ARCHITECTURE-DECISION-RECORD.md` for detailed rationale.

---

## Infrastructure Summary

| System | Purpose | Status | Cost |
|--------|---------|--------|------|
| **Message Delivery TEE** | Decrypt messages for CWC delivery | ✅ Implemented | $350-400/month (always-on) |
| **Debate Evaluation TEE** | Verifiable AI scoring of debate arguments | ⏳ Planned | ~$0.12/debate (on-demand) |
| **ZK Proving (Browser WASM)** | Generate district membership proofs | ✅ Implemented | $0/month |

**Total Monthly Cost**: $350-400 (message delivery) + ~$3/month at 25 debates/day (evaluation)

---

*Three systems, three purposes. TEE for message delivery, TEE for verifiable evaluation, browser WASM for privacy-preserving ZK proofs.*
