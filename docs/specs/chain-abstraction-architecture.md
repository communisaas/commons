# Chain Abstraction Architecture

> **STATUS: PARTIAL — Path 1 live (Sepolia), Path 2 stub.** `FEATURES.WALLET = false` in production for the full wallet surface; NEP-366 meta-tx sponsorship is reachable via `/api/wallet/near/sponsor` independently.

> ⚠️ **Addendum (2026-04-23 audit)** — the existing status block is
> broadly right, but the Implementation Status matrix + Section 4/5 prose
> still present some stub items as if live. Concrete corrections:
>
> - **§4.2 Pimlico paymaster / ERC-4337 sponsorship:** presented as
>   "Live," but `PIMLICO_API_KEY` isn't configured in prod.
>   `/api/wallet/sponsor-userop/+server.ts` is a validation-only skeleton
>   with a hardcoded `MAX_GAS_PER_OP_WEI = 5M gwei` ceiling; it does not
>   actually sponsor ops. Treat Path 2 users as paying their own gas on
>   an EOA transaction.
> - **§4.4 `rotateNearPrimaryKey()`:** fully aspirational. The function
>   does not exist in the codebase; recovery-keypair generation exists in
>   `src/lib/core/chain-signatures/*` but is never invoked for rotation.
>   Move to "Open Gaps" or mark explicitly `Design (not implemented)`.
> - **§5.2 Native ETH staking:** design target. `DebateMarket` has no
>   payable methods; staking is ERC-20 (tUSDC on Scroll Sepolia,
>   `0xe70623c79E…`) with `ensureTokenApproval()` before every stake
>   (`debate-client.ts:271,349`). The "eliminate approval tx" goal is
>   Phase 2.
> - **SimpleAccount factory:** hardcoded address
>   (`src/lib/core/wallet/smart-account-provider.ts:43`) — no factory
>   deployment, `PUBLIC_ENABLE_SMART_ACCOUNTS=false`, submission path
>   uses EOA, not smart accounts. EIP-7702 `delegate()` / `isDelegated()`
>   implemented but unwired.
> - **Cost row (~$0.01 / ~2.2M gas):** unverified; code's internal
>   ceiling is 5× higher. Strike or disclaimer.
> - **Correct as-is:** Scroll mainnet chain ID (534352) referenced but
>   unused — Sepolia (534351) is the only live network.

> Canonical specification for the wallet, signing, gas, and funding layers.
> Civic identity is wallet-agnostic. Every layer below it is interchangeable.

**Status (reconciled 2026-04-23):** Mixed — see Implementation Status block below.
**Scope:** Commons frontend + voter-protocol contracts
**Depends on:** [CRYPTOGRAPHY-SPEC](../../../voter-protocol/specs/CRYPTOGRAPHY-SPEC.md), [DEBATE-MARKET-SPEC](../../../voter-protocol/specs/DEBATE-MARKET-SPEC.md)

## Implementation Status (2026-04-23)

Not every layer is shipped. The matrix below reconciles what's described in this document against what exists in the commons + voter-protocol source trees.

| Component | Doc claims | Actual state | Evidence |
|---|---|---|---|
| NEP-366 meta-tx (NEAR → Scroll via chain signatures) | Live | **Live on NEAR testnet.** Full implementation: `buildDelegateActionForFunctionCall`, `signDelegateAction`, `relayDelegateAction`. | `commons/src/lib/core/near/meta-transactions.ts`; `commons/src/routes/api/wallet/near/sponsor/+server.ts` |
| NEAR implicit account creation (Ed25519 derivation, encrypted storage) | Live | **Live.** Fire-and-forget post-signup; `deriveScrollAddress()` uses NEAR Chain Signatures MPC. | `commons/src/lib/core/near/chain-signatures.ts:198-240`; `commons/src/lib/core/wallet/near-provider.ts` |
| Scroll Sepolia chain ID (534351) | Live | **Live on Sepolia.** | `commons/src/lib/core/contracts.ts:47` |
| Scroll mainnet chain ID (534352) | Live | **Not deployed.** Referenced in code, never used. | `commons/src/lib/core/contracts.ts` |
| ERC-4337 SimpleAccount factory | Live | **Stub.** Factory address is hardcoded to the Pimlico Sepolia deployment; no factory invocation in the submission flow; feature flag OFF. | `commons/src/lib/core/wallet/smart-account-provider.ts:43`; `commons/src/lib/core/wallet/debate-client.ts:417` (TODO comment) |
| Pimlico paymaster / gas sponsorship | Live | **Not wired.** `PIMLICO_API_KEY` is commented out in `wrangler.toml`; `sponsor-userop/+server.ts` is a skeleton that calls a bundler that isn't configured. | `commons/src/routes/api/wallet/sponsor-userop/+server.ts:8-58`; `wrangler.toml` |
| Staking (native ETH, no approval) | Live | **Fabricated.** Code uses ERC-20 approval via `ensureTokenApproval()`; `STAKING_TOKEN_ADDRESS` is the zero address with a warning comment. | `commons/src/lib/core/contracts.ts:36-44`; `commons/src/lib/core/wallet/debate-client.ts:271,349` |
| EIP-7702 smart-account delegation | Live | **Skeleton only.** `delegate()` / `isDelegated()` exist for Sepolia; flag `PUBLIC_ENABLE_SMART_ACCOUNTS` is `false` by default; never wired into the submission path. | `commons/src/lib/core/wallet/smart-account-provider.ts:66-216` |
| `rotateNearPrimaryKey()` account rotation | Live | **Not implemented.** Recovery keypair is generated; rotation logic absent. | `commons/src/lib/core/near/account.ts` |
| Cost claims (~$0.01 / ~2.2M gas) | Live | **Unverified.** Hardcoded max gas cap in sponsor-userop is 5M gwei; no deployment trace or benchmark harness. | `commons/src/routes/api/wallet/sponsor-userop/+server.ts:58` |

**What a reader should take away:** Path 1 (NEAR implicit account + NEP-366 meta-tx → Scroll Sepolia via chain signatures) is real and testable. Path 2 (ERC-4337 UserOp + Pimlico paymaster) is a design contract with a stubbed implementation — it will not currently sponsor a real transaction. Scroll mainnet is aspirational until a mainnet deployment of DistrictGate + registries + factory is completed.

---

## 1. Design Thesis

A civic platform cannot require its users to understand cryptography. The system must be indistinguishable from a normal web application for someone who has never held a private key, while remaining fully sovereign for someone who has.

This produces one architectural constraint and one invariant:

**Constraint:** Every on-chain operation (stake, prove, trade, settle) must be executable without the user ever seeing a wallet, a gas token, or a chain name.

**Invariant:** Identity is never coupled to a wallet. The mDL-derived identity commitment exists in the ZK layer. The wallet is a disposable vehicle that delivers proofs and funds on-chain. A user can rotate wallets, migrate between signing paths, or lose a device without losing their civic identity.

---

## 2. Layer Architecture

Five orthogonal layers. Each layer has exactly one responsibility and makes no assumptions about the layer above or below it.

```
 Layer 4: UX Presentation
          USD display, progressive disclosure, loading states
          ─────────────────────────────────────────────────
 Layer 3: Funding
          Fiat onramp (Transak), direct transfer, exchange
          ─────────────────────────────────────────────────
 Layer 2: Gas Abstraction
          NEAR meta-tx (NEP-366), Scroll paymaster (ERC-4337)
          ─────────────────────────────────────────────────
 Layer 1: Signing
          WalletProvider interface: EVM | NEAR Chain Sig | Operator
          ─────────────────────────────────────────────────
 Layer 0: Identity
          mDL → identity commitment → ZK proofs (wallet-agnostic)
```

**Layer 0: Identity** is the ZK proof system. It knows nothing about wallets. A proof is a self-contained cryptographic artifact: `H(identitySecret, cell, ...factors) → publicInputs`. The proof doesn't contain a wallet address. The wallet address enters only when the proof is *submitted* on-chain — and any wallet can submit any proof.

**Layer 1: Signing** implements `WalletProvider` — a two-method interface (`signTypedData`, `signMessage`). Three implementations exist. They are substitutable at runtime. The contract doesn't know or care which signing path produced the ECDSA signature.

**Layer 2: Gas Abstraction** ensures the user never acquires gas tokens. Two independent mechanisms cover the two chains involved: NEP-366 DelegateActions on NEAR (server-sponsored), ERC-4337 UserOperations on Scroll (Pimlico-sponsored). These are composable — a NEAR Chain Signatures user hits both.

**Layer 3: Funding** puts staking capital into the user's Scroll address. Transak (fiat → ETH on Scroll). Native ETH staking eliminates the ERC-20 approval transaction — one fewer TX per interaction.

**Layer 4: UX Presentation** translates everything into dollars, hides latency behind loading states, and never surfaces chain names, token symbols, or gas concepts.

---

## 3. Entry Paths

Three paths, one interface. The path is selected at account creation and stored as `WalletEntryPath` on the User model.

### Path 1: Non-Crypto (NEAR Implicit Account)

The user authenticates via OAuth or passkey. The server:

1. Generates an Ed25519 keypair (`KeyPairEd25519.fromRandom()`)
2. Derives the NEAR implicit account ID (hex-encoded public key = account ID — no on-chain transaction)
3. Encrypts the private key with AES-256-GCM (`ENTROPY_ENCRYPTION_KEY`), stores in Prisma
4. Generates a recovery keypair (separate Ed25519 pair, server-held, for device loss)
5. Calls `deriveScrollAddress()` — view call to NEAR MPC signer → deterministic secp256k1 pubkey → `computeAddress()` → Scroll address
6. Stores `near_account_id`, `near_derived_scroll_address` on User

The user now has a Scroll wallet. They never saw a seed phrase.

**Signing flow:**
```
User action → compute EIP-712 hash locally → hexToBytes(digest)
  → signWithChainSignatures(nearAccountId, nearKeyPair, hashBytes)
    → NEAR MPC signer contract (8-node threshold ECDSA, 5-15s)
      → (r, s, v) → attach to Scroll transaction → broadcast
```

**Gas flow:**
```
NEAR side: NEP-366 DelegateAction → server sponsor wraps + pays NEAR gas
Scroll side: ERC-4337 UserOp → Pimlico paymaster sponsors Scroll gas
```

**Latency:** 10-30s (two sequential MPC signatures for NEAR meta-tx + Scroll signing).

### Path 2: EVM Wallet (MetaMask / WalletConnect)

The user connects an injected Ethereum wallet. The client:

1. Calls `connectInjectedWallet()` → `window.ethereum.request({ method: 'eth_requestAccounts' })`
2. Verifies chain ID is Scroll Sepolia (534351) or prompts `wallet_addEthereumChain`
3. Wraps the provider in `EVMWalletProvider`
4. Stores `wallet_address` on User

**Signing flow:**
```
User action → eth_signTypedData_v4 → MetaMask popup → (r, s, v) → broadcast
```

**Gas flow:** Direct transaction (user pays own gas) or Pimlico-sponsored UserOp.

**Latency:** 1-3s (local signing, no MPC).

### Path 3: Operator (Server-Side System Key)

Not a user path. Used for system operations: AI evaluation submission, epoch execution, governance actions. `OperatorWallet` wraps an `ethers.Wallet` loaded from `OPERATOR_PRIVATE_KEY`.

### Composability Matrix

Any identity × any signing path × any gas strategy × any funding method:

| | Path 1 (NEAR) | Path 2 (EVM) | Path 3 (Operator) |
|---|---|---|---|
| **Identity** | mDL → ZK proof | mDL → ZK proof | N/A (system) |
| **Signing** | Chain Signatures MPC | MetaMask/injected | ethers.Wallet |
| **Gas (NEAR)** | NEP-366 sponsor | N/A | N/A |
| **Gas (Scroll)** | Pimlico paymaster | Direct or Pimlico | Direct |
| **Funding** | Transak onramp | Self-funded | Treasury |
| **Latency** | 10-30s | 1-3s | <1s |
| **UX friction** | Zero (invisible) | Wallet popup | None (automated) |

---

## 4. Pattern Language

### 4.1 Signing Oracle

NEAR Chain Signatures is a **signing oracle**: given a 32-byte hash and a derivation path, it returns an ECDSA signature. The oracle is:

- **Deterministic**: same (NEAR account, path) always produces the same secp256k1 public key
- **Threshold**: 8 MPC nodes; no single node holds the full key
- **Chain-agnostic**: signs for any chain that uses secp256k1 (Ethereum, Scroll, Bitcoin, etc.)
- **Stateless**: the oracle has no memory of what it signed; replay protection is the caller's responsibility

The derivation path `"scroll"` produces the Scroll address. A different path (e.g., `"bitcoin"`) would produce a Bitcoin address from the same NEAR account. This is unused today but is the primitive that would enable multi-chain expansion without NEAR intents.

### 4.2 Gas Delegation

Two independent gas delegation mechanisms, one per chain:

**NEAR side (NEP-366 meta-transactions):**
The user signs a `DelegateAction` off-chain. The server's sponsor account wraps it in a regular NEAR transaction and broadcasts it. The NEAR runtime verifies the inner signature and executes the action. Cost: ~0.001 NEAR per relay (~$0.005).

**Scroll side (ERC-4337 UserOperations) — design, not yet wired:**
The client constructs a `UserOperation` targeting `execute(dest, value, func)` on the user's smart account. Pimlico's verifying paymaster sponsors the gas. The bundler submits the UserOp to the EntryPoint contract. Cost: Pimlico deposit (prepaid by protocol).

**Current state:** `PIMLICO_API_KEY` is commented out in `wrangler.toml`; `/api/wallet/sponsor-userop/+server.ts` is a skeleton that validates a request envelope but has no working bundler or paymaster wired behind it. The SimpleAccount factory address hardcoded in `smart-account-provider.ts:43` is a Pimlico Sepolia deployment; there is no mainnet factory and no factory-invocation step in any shipping submission path. Until the paymaster + factory are deployed and configured, Path 2 sponsors nothing — a user attempting Path 2 would pay gas directly from their own Scroll balance via an EOA transaction.

**Implication for composition:** Path 1 users (NEAR implicit + MPC chain signatures) currently pay their own Scroll gas once the signed EIP-712 envelope reaches Scroll, because the Pimlico half of the composition is stub. The NEAR-side sponsorship (~0.001 NEAR per relay) still works independently.

### 4.3 Progressive Trust Escalation

The wallet layer implements progressive trust through three mechanisms:

1. **Sponsorship budget**: Pimlico `SponsorshipPolicy` limits `maxOpsPerUserPerDay` and `maxGasPerOp`. New users get N free transactions. Power users self-fund.

2. **Tier-gated features**: Engagement tier (from reputation tree) gates access to higher-stakes debates. Tier 0 users can browse and read. Tier 1 can submit arguments with small stakes. Tier 4 users have full access. The wallet layer enforces nothing — tier gating lives in the contract.

3. **Wallet migration**: A Path 1 user who becomes crypto-native can connect an EVM wallet (Path 2) to their existing account. Both `near_account_id` and `wallet_address` coexist on the User model. The `entryPath` field determines the primary signing method.

### 4.4 Disposable Vehicle

The wallet is explicitly disposable. The identity commitment is derived from `mDL + identitySecret`, not from any wallet key. If a user's NEAR account is compromised:

1. Server detects or user reports compromise
2. `rotateNearPrimaryKey()` uses the recovery keypair to submit a batched on-chain transaction: AddKey(new) → DeleteKey(old) → AddKey(newRecovery) → DeleteKey(oldRecovery)
3. New Scroll address is derived from the same NEAR account (new key, same derivation path, same address — the MPC signer derives from account ID, not from the key)
4. Identity remains intact — ZK proofs are wallet-independent

If a user switches from Path 1 to Path 2 entirely, they simply connect a MetaMask wallet and update `entryPath`. Their civic identity, engagement tier, nullifier history, and proof capability are unaffected.

---

## 5. Contract Interface

The wallet layer produces exactly two artifacts that touch on-chain code:

### 5.1 EIP-712 Signed Proof Authorization

```
SubmitThreeTreeProof {
    proofHash:        bytes32    // keccak256(proof bytes)
    publicInputsHash: bytes32    // keccak256(abi.encode(publicInputs))
    verifierDepth:    uint8      // 18 | 20 | 22 | 24
    nonce:            uint256    // DistrictGate.nonces(signer)
    deadline:         uint256    // Unix timestamp
}
```

The signer produces this EIP-712 signature via `WalletProvider.signTypedData()`. The contract calls `ECDSA.recover(digest, signature)` and verifies the recovered address matches the `signer` parameter. Any wallet implementation that produces a valid ECDSA signature over the EIP-712 hash is accepted.

### 5.2 Staking Transfer

**Design target (not shipped):** Native ETH via `msg.value` — no approval transaction needed. The contract would receive ETH directly with each payable call (`proposeDebate`, `submitArgument`, `coSignArgument`, `appealResolution`) and return ETH via `Address.sendValue()` on settlement/withdrawal.

**Actual state (2026-04-23):** Staking is ERC-20 based, gated on `STAKING_TOKEN_ADDRESS`. The wallet client calls `ensureTokenApproval()` before each stake (`commons/src/lib/core/wallet/debate-client.ts:271,349`), meaning the approval transaction the design promised to eliminate is still required. `STAKING_TOKEN_ADDRESS` in `commons/src/lib/core/contracts.ts:36-44` is the zero address with a warning comment — i.e., no staking token is actually configured. The native-ETH payable-call pattern was a plan; migrating `DebateMarket.sol` to payable plus removing the ERC-20 approval path is Phase 2 work.

---

## 6. State Machine

A user's wallet lifecycle:

```
                    ┌──────────────┐
                    │   ANONYMOUS  │
                    │  (no wallet) │
                    └──────┬───────┘
                           │ OAuth / passkey signup
                    ┌──────▼───────┐
                    │  PROVISIONED │  NEAR implicit account created
                    │  (unfunded)  │  Scroll address derived
                    └──────┬───────┘
                           │ Transak onramp OR direct transfer
                    ┌──────▼───────┐
                    │    FUNDED    │  Balance > 0 on Scroll
                    │  (ready)     │
                    └──────┬───────┘
                           │ First submitArgument / coSignArgument
                    ┌──────▼───────┐
                    │    ACTIVE    │  Has on-chain positions
                    │              │  Tier accumulating
                    └──────┬───────┘
                           │ (optional) Connect EVM wallet
                    ┌──────▼───────┐
                    │   MIGRATED   │  Both NEAR + EVM paths available
                    │              │  entryPath updated
                    └──────────────┘
```

State is derived, not stored: `ANONYMOUS` = no `near_account_id` and no `wallet_address`. `PROVISIONED` = has address, zero balance. `FUNDED` = positive balance. `ACTIVE` = has on-chain transaction history.

---

## 7. Security Properties

### Per-Layer Guarantees

| Layer | Property | Mechanism |
|---|---|---|
| Identity | Wallet compromise does not leak identity | Identity commitment derived from mDL + secret, not wallet key |
| Identity | One person = one identity per action domain | Nullifier = H2(identityCommitment, actionDomain) |
| Signing (NEAR) | No single point of key compromise | 8-node MPC threshold (t-of-n ECDSA) |
| Signing (NEAR) | Account recoverable after device loss | Dual-key architecture (primary + recovery) |
| Signing (EVM) | User controls own keys | MetaMask/hardware wallet, no server custody |
| Gas (NEAR) | Sponsor cannot forge user actions | NEP-366: inner DelegateAction signature verified by NEAR runtime |
| Gas (Scroll) | Paymaster cannot forge user operations | ERC-4337: UserOp signature verified by EntryPoint before execution |
| Gas (Scroll) | Protocol limits sponsorship exposure | SponsorshipPolicy: per-user rate limit, per-op gas cap, target allowlist |
| Funding | Onramp KYC satisfied by existing identity | mDL verification = Transak KYC requirement |
| Funding | Protocol never custodies user funds | Funds go directly to user's Scroll address |

### Threat Model

| Threat | Mitigation | Residual Risk |
|---|---|---|
| NEAR MPC compromise (t+1 nodes) | Threshold requires majority collusion; nodes operated by independent parties | Low — equivalent to NEAR consensus security |
| Server DB breach (encrypted NEAR keys) | AES-256-GCM with `ENTROPY_ENCRYPTION_KEY`; key rotation via recovery keypair | Medium — server holds encrypted keys; defense-in-depth via key rotation |
| Pimlico paymaster drain | SponsorshipPolicy rate limits; monitoring on deposit balance | Low — capped exposure per user per day |
| Transak integration failure | Fallback to direct ETH transfer; no protocol dependency on Transak availability | Low — degraded UX, not degraded security |
| User wallet phishing (Path 2) | Standard EVM wallet security; EIP-712 domain binding prevents cross-contract replay | Standard — protocol cannot prevent MetaMask phishing |

---

## 8. Implementation Map

Code locations for each layer (not exhaustive — entry points only):

### Layer 0: Identity
- ZK circuits: `voter-protocol/circuits/` (Noir)
- Proof generation: `commons/src/lib/core/zkp/prover-client.ts`
- Identity binding: `commons/src/lib/core/identity/identity-binding.ts`

### Layer 1: Signing
- Interface: `commons/src/lib/core/wallet/types.ts` → `WalletProvider`
- EVM: `commons/src/lib/core/wallet/evm-provider.ts` → `EVMWalletProvider`
- NEAR: `commons/src/lib/core/wallet/near-provider.ts` → `NEARWalletProvider`
- Chain Sig: `commons/src/lib/core/near/chain-signatures.ts` → `signWithChainSignatures()`
- Operator: `commons/src/lib/core/wallet/operator.ts` → `OperatorWallet`
- EIP-712: `commons/src/lib/core/wallet/eip712.ts` → `buildProofAuthorizationData()`

### Layer 2: Gas Abstraction
- NEAR meta-tx: `commons/src/lib/core/near/meta-transactions.ts` → `relayDelegateAction()`
- Sponsor endpoint: `commons/src/routes/api/wallet/near/sponsor/+server.ts`
- NEAR account mgmt: `commons/src/lib/core/near/account.ts` → `createNearAccount()`
- Pimlico client: `commons/src/lib/core/gas/pimlico.ts` → `PimlicoClient`
- UserOp builder: `commons/src/lib/core/gas/user-operation.ts` → `buildUserOperation()`

### Layer 3: Funding
- Onramp widget: `commons/src/lib/components/wallet/OnrampWidget.svelte`
- Balance display: `commons/src/lib/components/wallet/BalanceDisplay.svelte`
- Balance API: `commons/src/routes/api/wallet/balance/+server.ts`

### Layer 4: UX
- Wallet connection: `commons/src/lib/components/wallet/WalletConnect.svelte`
- Wallet status: `commons/src/lib/components/wallet/WalletStatus.svelte`
- Wallet state: `commons/src/lib/stores/walletState.svelte.ts`

### Contracts
- DebateMarket: `voter-protocol/contracts/src/DebateMarket.sol`
- DistrictGate: `voter-protocol/contracts/src/DistrictGate.sol`
- Deploy script: `voter-protocol/contracts/script/DeploySepoliaV6.s.sol`

---

## 9. Staking: Native ETH (design target, not yet migrated)

> **Status:** Proposed. Current `DebateMarket.sol` + `debate-client.ts` use ERC-20 approval (`ensureTokenApproval()`) with `STAKING_TOKEN_ADDRESS` unconfigured. This section describes the Phase-2 migration that eliminates approval.

```
User → submitArgument{value: stakeAmount}(...)
        └→ require(msg.value >= minStake)
```
Target state: one transaction, no approval, no token contract dependency. Outbound transfers would use `Address.sendValue()` with `nonReentrant` + CEI pattern.

### Settlement Change
```
Current: stakingToken.transfer(winner, payout)   // ERC-20 path (present)
Target:  Address.sendValue(payable(winner), payout)  // native ETH (Phase 2)
```

### Onramp Change
```
OnrampWidget.svelte: cryptoCurrencyCode: 'USDC' → 'ETH' (pending migration)
```

### Display Change
```
Client-side: fetch ETH/USD price → display staking amounts in USD
No on-chain oracle needed — price is display-only, not settlement-critical
```

---

## 10. Open Gaps

### Smart Account Factory
ERC-4337 UserOperations require a smart account (SimpleAccount, Kernel, or Safe). The `user-operation.ts` module builds UserOps with `execute(dest, value, func)` but no smart account factory is deployed. Path 1 users currently use Chain Signatures to sign regular transactions (not UserOps). To complete the gasless pipeline, each user needs a counterfactually deployed smart account whose `owner` is their NEAR-derived Scroll address.

### NEAR Intents
Not needed for single-chain (Scroll) operations. The signing oracle + meta-transaction + paymaster stack already provides full chain abstraction. NEAR intents would add value only if the protocol expands to multiple L2s (user has assets on Arbitrum, wants to stake on Scroll). The integration point would be: replace `signScrollTransaction()` with an intent submission. The wallet abstraction layer does not need to change.

### Multi-Chain Expansion
Chain Signatures already supports multi-chain derivation — the path `"scroll"` is arbitrary. Changing to `"arbitrum"` derives an Arbitrum address from the same NEAR account. The `WalletProvider` interface and identity layer are chain-agnostic. The coupling is in the contract addresses (DistrictGate, DebateMarket) which are Scroll-specific.
