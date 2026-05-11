/**
 * Client-side Debate Market Client — browser wallet submits directly to Scroll.
 *
 * Replaces the server relayer for user operations (submitArgument, coSignArgument).
 * The user's own wallet signs the EIP-712 authorization AND submits the transaction,
 * so the user pays gas and the user's address is both `signer` and `beneficiary`.
 *
 * BROWSER ONLY: No $env/dynamic/private, no server-only dependencies.
 * Errors propagate naturally — the calling Svelte component handles UI feedback.
 *
 * Flow (submitArgument / coSignArgument):
 *   1. Validate proof inputs (field range, hex format, depth)
 *   2. Read nonce from DistrictGate.nonces(wallet.address)
 *   3. Build EIP-712 typed data via buildProofAuthorizationData
 *   4. Sign with wallet.signTypedData (MetaMask popup)
 *   5. Ensure ERC-20 token approval for stake amount
 *   6. Submit tx via Contract connected to user's Signer
 *   7. Wait for receipt, return { txHash }
 *
 * Gasless flow for NEAR-path users (gaslessSubmitArgument / gaslessCoSignArgument):
 *   1. Validate proof inputs
 *   2. Read nonce from DistrictGate via public JsonRpcProvider (no wallet provider needed)
 *   3. Build EIP-712 typed data and sign via wallet.signTypedData (works for NEAR + EVM)
 *   4. Build UserOp via buildSubmitArgumentUserOp / buildCoSignArgumentUserOp
 *   5. Serialize UserOp fields as hex strings and POST to /api/wallet/sponsor-userop
 *   6. Server sponsors gas via Pimlico, submits to bundler, returns txHash
 *
 * @see eip712.ts                      — pure EIP-712 typed data construction
 * @see token.ts                       — ERC-20 balance / allowance / approve helpers
 * @see evm-provider.ts                — EVMWalletProvider wrapping MetaMask
 * @see gas/user-operation.ts          — ERC-4337 UserOp builders
 * @see routes/api/wallet/sponsor-userop — server-side Pimlico sponsorship endpoint
 * @see debate-market-client.ts (blockchain/) — legacy server relayer (being replaced)
 */

import { Contract, JsonRpcProvider, keccak256, solidityPacked, type BrowserProvider, type Provider } from 'ethers';
import type { EVMWalletProvider } from './evm-provider';
import type { WalletProvider } from './types';
import {
	validateProofInputs,
	buildProofAuthorizationData,
	defaultDeadline,
	publicInputsToBigInt
} from './eip712';
import {
	DEBATE_MARKET_ADDRESS,
	STAKING_TOKEN_ADDRESS,
	ensureTokenApproval
} from './token';
import {
	buildSubmitArgumentUserOp,
	buildCoSignArgumentUserOp
} from '$lib/core/gas/user-operation';
import { env } from '$env/dynamic/public';

// ═══════════════════════════════════════════════════════════════════════════
// CONTRACT ABIs
// ═══════════════════════════════════════════════════════════════════════════

/** Minimal DebateMarket ABI — only the functions called from the browser. */
const DEBATE_MARKET_ABI = [
	'function submitArgument(bytes32 debateId, uint8 stance, bytes32 bodyHash, bytes32 amendmentHash, uint256 stakeAmount, address signer, bytes proof, uint256[31] publicInputs, uint8 verifierDepth, uint256 deadline, bytes signature, address beneficiary)',
	'function coSignArgument(bytes32 debateId, uint256 argumentIndex, uint256 stakeAmount, address signer, bytes proof, uint256[31] publicInputs, uint8 verifierDepth, uint256 deadline, bytes signature, address beneficiary)',
	'function getDebateState(bytes32 debateId) view returns (uint8 status, uint256 deadline_, uint256 argumentCount, uint256 totalStake, uint256 uniqueParticipants)',
	// LMSR commit/reveal trading
	'function commitTrade(bytes32 debateId, bytes32 commitHash, address signer, bytes proof, uint256[31] publicInputs, uint8 verifierDepth, uint256 deadline, bytes signature)',
	'function revealTrade(bytes32 debateId, uint256 epoch, uint256 commitIndex, uint256 argumentIndex, uint8 direction, bytes32 nonce, bytes debateWeightProof, bytes32[2] debateWeightPublicInputs)',
	// View: epoch state
	'function currentEpoch(bytes32 debateId) view returns (uint256)',
	'function epochStartTime(bytes32 debateId) view returns (uint256)'
];

/** Minimal DistrictGate ABI — nonce lookup for EIP-712 signing. */
const DISTRICT_GATE_ABI = [
	'function nonces(address) view returns (uint256)'
];

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Parameters for submitting a new argument from the browser. */
export interface ClientSubmitArgumentParams {
	/** Debate identifier (bytes32, 0x-prefixed). */
	debateId: string;

	/** Argument stance: 0=SUPPORT, 1=OPPOSE, 2=AMEND. */
	stance: number;

	/** keccak256 of the argument body text (bytes32). */
	bodyHash: string;

	/** keccak256 of the amendment text, or 0x000...0 if no amendment (bytes32). */
	amendmentHash: string;

	/** Stake amount in smallest token unit (e.g. 6 decimals for USDC). */
	stakeAmount: bigint;

	/** Hex-encoded ZK proof bytes. */
	proof: string;

	/** 31 field elements as decimal or hex strings. */
	publicInputs: string[];

	/** Circuit depth: 18 | 20 | 22 | 24. */
	verifierDepth: number;

	/** DistrictGate contract address (verifyingContract in EIP-712 domain). */
	districtGateAddress: string;

	/** Chain ID (534351 for Scroll Sepolia). */
	chainId: number;
}

/** Parameters for co-signing an existing argument from the browser. */
export interface ClientCoSignArgumentParams {
	/** Debate identifier (bytes32, 0x-prefixed). */
	debateId: string;

	/** Index of the argument to co-sign (0-based). */
	argumentIndex: number;

	/** Stake amount in smallest token unit (e.g. 6 decimals for USDC). */
	stakeAmount: bigint;

	/** Hex-encoded ZK proof bytes. */
	proof: string;

	/** 31 field elements as decimal or hex strings. */
	publicInputs: string[];

	/** Circuit depth: 18 | 20 | 22 | 24. */
	verifierDepth: number;

	/** DistrictGate contract address (verifyingContract in EIP-712 domain). */
	districtGateAddress: string;

	/** Chain ID (534351 for Scroll Sepolia). */
	chainId: number;
}

/** Parsed on-chain debate state from getDebateState(). */
export interface DebateStateView {
	/** Debate status enum: 0=Proposed, 1=Active, 2=Resolved, 3=Cancelled. */
	status: number;

	/** Unix timestamp when the debate closes for new arguments. */
	deadline: number;

	/** Number of arguments submitted so far. */
	argumentCount: number;

	/** Total tokens staked across all arguments. */
	totalStake: bigint;

	/** Number of unique participant addresses. */
	uniqueParticipants: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// READ-ONLY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Read the current on-chain state of a debate.
 *
 * Uses a read-only Provider (no signer needed). Suitable for polling
 * debate status from the UI without requiring wallet connection.
 *
 * @param provider - ethers v6 Provider (BrowserProvider or JsonRpcProvider)
 * @param debateId - bytes32 debate identifier
 * @returns Parsed debate state
 */
export async function readDebateState(
	provider: Provider,
	debateId: string
): Promise<DebateStateView> {
	const debateMarket = new Contract(DEBATE_MARKET_ADDRESS, DEBATE_MARKET_ABI, provider);

	const [status, deadline, argumentCount, totalStake, uniqueParticipants] =
		await debateMarket.getDebateState(debateId);

	return {
		status: Number(status),
		deadline: Number(deadline),
		argumentCount: Number(argumentCount),
		totalStake: BigInt(totalStake),
		uniqueParticipants: Number(uniqueParticipants)
	};
}

/**
 * Read the current EIP-712 nonce for a signer from the DistrictGate contract.
 *
 * The nonce is auto-incremented by the contract after each proof verification.
 * Used to construct the EIP-712 typed data for signing.
 *
 * @param provider - ethers v6 Provider (read-only)
 * @param districtGateAddress - DistrictGate contract address
 * @param signerAddress - Address to read the nonce for
 * @returns Current nonce as bigint
 */
export async function readNonce(
	provider: Provider,
	districtGateAddress: string,
	signerAddress: string
): Promise<bigint> {
	const districtGate = new Contract(districtGateAddress, DISTRICT_GATE_ABI, provider);
	return BigInt(await districtGate.nonces(signerAddress));
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE-CHANGING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Submit a new argument to a debate, signed and submitted by the user's wallet.
 *
 * Full client-side flow:
 *   1. Validate proof inputs (count, hex format, field range, depth)
 *   2. Read nonce from DistrictGate.nonces(wallet.address)
 *   3. Build EIP-712 typed data for proof authorization
 *   4. Sign with wallet.signTypedData (triggers MetaMask popup)
 *   5. Send ETH with the transaction
 *   6. Call DebateMarket.submitArgument with all parameters
 *   7. Wait for on-chain confirmation
 *   8. Return the transaction hash
 *
 * The user's wallet address serves as BOTH the `signer` parameter (EIP-712
 * proof authorizer) and the `beneficiary` parameter (settlement recipient).
 *
 * @param wallet - Connected EVMWalletProvider (MetaMask/injected)
 * @param params - Argument submission parameters
 * @returns Transaction hash of the confirmed submission
 * @throws On validation failure, user rejection, insufficient gas/tokens, or revert
 */
export async function clientSubmitArgument(
	wallet: EVMWalletProvider,
	params: ClientSubmitArgumentParams
): Promise<{ txHash: string }> {
	// 1. Validate proof inputs
	const validationError = validateProofInputs(params.proof, params.publicInputs, params.verifierDepth);
	if (validationError) {
		throw new Error(`Proof validation failed: ${validationError}`);
	}

	const provider: BrowserProvider = wallet.ethersProvider;

	// 2. Read nonce from DistrictGate
	const nonce = await readNonce(provider, params.districtGateAddress, wallet.address);

	// 3. Build EIP-712 typed data
	const deadline = defaultDeadline();
	const { domain, types, value } = buildProofAuthorizationData({
		proof: params.proof,
		publicInputs: params.publicInputs,
		verifierDepth: params.verifierDepth,
		deadline,
		districtGateAddress: params.districtGateAddress,
		chainId: params.chainId,
		nonce
	});

	// 4. Sign with wallet (MetaMask popup)
	const signature = await wallet.signTypedData(domain, types, value);

	// 5. Get signer for tx submission
	const signer = await provider.getSigner(wallet.address);

	// 5b. Ensure ERC-20 token approval for stake amount
	await ensureTokenApproval(signer, STAKING_TOKEN_ADDRESS, DEBATE_MARKET_ADDRESS, params.stakeAmount);

	// 6. Build contract call
	const debateMarket = new Contract(DEBATE_MARKET_ADDRESS, DEBATE_MARKET_ABI, signer);

	const proofBytes = params.proof.startsWith('0x') ? params.proof : '0x' + params.proof;
	const publicInputsAsBigInt = publicInputsToBigInt(params.publicInputs);

	// 7. Submit transaction
	const tx = await debateMarket.submitArgument(
		params.debateId,           // bytes32 debateId
		params.stance,             // uint8 stance
		params.bodyHash,           // bytes32 bodyHash
		params.amendmentHash,      // bytes32 amendmentHash
		params.stakeAmount,        // uint256 stakeAmount
		wallet.address,            // address signer
		proofBytes,                // bytes proof
		publicInputsAsBigInt,      // uint256[31] publicInputs
		params.verifierDepth,      // uint8 verifierDepth
		deadline,                  // uint256 deadline
		signature,                 // bytes signature
		wallet.address             // address beneficiary
	);

	// 8. Wait for receipt
	const receipt = await tx.wait();

	return { txHash: receipt.hash };
}

/**
 * Co-sign an existing argument in a debate, signed and submitted by the user's wallet.
 *
 * Same flow as clientSubmitArgument but calls DebateMarket.coSignArgument with
 * an argumentIndex instead of stance/bodyHash/amendmentHash.
 *
 * The user's wallet address serves as BOTH the `signer` parameter (EIP-712
 * proof authorizer) and the `beneficiary` parameter (settlement recipient).
 *
 * @param wallet - Connected EVMWalletProvider (MetaMask/injected)
 * @param params - Co-sign parameters
 * @returns Transaction hash of the confirmed co-sign
 * @throws On validation failure, user rejection, insufficient gas/tokens, or revert
 */
export async function clientCoSignArgument(
	wallet: EVMWalletProvider,
	params: ClientCoSignArgumentParams
): Promise<{ txHash: string }> {
	// 1. Validate proof inputs
	const validationError = validateProofInputs(params.proof, params.publicInputs, params.verifierDepth);
	if (validationError) {
		throw new Error(`Proof validation failed: ${validationError}`);
	}

	const provider: BrowserProvider = wallet.ethersProvider;

	// 2. Read nonce from DistrictGate
	const nonce = await readNonce(provider, params.districtGateAddress, wallet.address);

	// 3. Build EIP-712 typed data
	const deadline = defaultDeadline();
	const { domain, types, value } = buildProofAuthorizationData({
		proof: params.proof,
		publicInputs: params.publicInputs,
		verifierDepth: params.verifierDepth,
		deadline,
		districtGateAddress: params.districtGateAddress,
		chainId: params.chainId,
		nonce
	});

	// 4. Sign with wallet (MetaMask popup)
	const signature = await wallet.signTypedData(domain, types, value);

	// 5. Get signer for tx submission
	const signer = await provider.getSigner(wallet.address);

	// 5b. Ensure ERC-20 token approval for stake amount
	await ensureTokenApproval(signer, STAKING_TOKEN_ADDRESS, DEBATE_MARKET_ADDRESS, params.stakeAmount);

	// 6. Build contract call
	const debateMarket = new Contract(DEBATE_MARKET_ADDRESS, DEBATE_MARKET_ABI, signer);

	const proofBytes = params.proof.startsWith('0x') ? params.proof : '0x' + params.proof;
	const publicInputsAsBigInt = publicInputsToBigInt(params.publicInputs);

	// 7. Submit transaction
	const tx = await debateMarket.coSignArgument(
		params.debateId,           // bytes32 debateId
		params.argumentIndex,      // uint256 argumentIndex
		params.stakeAmount,        // uint256 stakeAmount
		wallet.address,            // address signer
		proofBytes,                // bytes proof
		publicInputsAsBigInt,      // uint256[31] publicInputs
		params.verifierDepth,      // uint8 verifierDepth
		deadline,                  // uint256 deadline
		signature,                 // bytes signature
		wallet.address             // address beneficiary
	);

	// 8. Wait for receipt
	const receipt = await tx.wait();

	return { txHash: receipt.hash };
}

// ═══════════════════════════════════════════════════════════════════════════
// GASLESS SUBMISSION (ERC-4337 — NEAR-path users)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Scroll Sepolia public RPC URL — used to read on-chain nonces when the caller
 * has no BrowserProvider (e.g. NEAR-path users who cannot provide an ethers Signer).
 * Reads PUBLIC_SCROLL_RPC_URL from the environment with a safe fallback.
 */
const SCROLL_PUBLIC_RPC =
	env.PUBLIC_SCROLL_RPC_URL ?? 'https://sepolia-rpc.scroll.io';

/**
 * Serialize a bigint to a 0x-prefixed hex string.
 * Used to convert UserOp numeric fields for JSON transport.
 */
function toHexString(value: bigint): string {
	if (value === 0n) return '0x0';
	return '0x' + value.toString(16);
}

/**
 * Submit a new argument to a debate via ERC-4337 gasless sponsorship.
 *
 * For NEAR-path users who cannot sign Scroll transactions directly.
 * The wallet signs only the EIP-712 typed data (works via MPC for NEAR);
 * actual transaction submission is handled server-side via the Pimlico bundler.
 *
 * Flow:
 *   1. Validate proof inputs
 *   2. Read EIP-712 nonce from DistrictGate via public JsonRpcProvider
 *   3. Build EIP-712 typed data and sign via wallet.signTypedData (MPC or MetaMask)
 *   4. Build UserOp wrapping submitArgument in execute()
 *   5. POST {userOp, signature} to /api/wallet/sponsor-userop
 *   6. Server sponsors gas, submits to bundler, waits for receipt
 *   7. Return { txHash }
 *
 * Prerequisites (not enforced here):
 *   - The sender address must have a deployed SimpleAccount with wallet.address as owner
 *   - The smart account must have approved DebateMarket to spend stakeAmount of USDC
 *     (TODO: batch approve + submitArgument in a single multi-call UserOp)
 *
 * @param wallet - Any WalletProvider (NEAR or EVM) — only signTypedData is called
 * @param params - Argument submission parameters (same as clientSubmitArgument)
 * @returns Transaction hash of the confirmed on-chain submission
 * @throws On validation failure, MPC signing error, or server-side sponsorship failure
 */
export async function gaslessSubmitArgument(
	wallet: WalletProvider,
	params: ClientSubmitArgumentParams
): Promise<{ txHash: string }> {
	// 1. Validate proof inputs
	const validationError = validateProofInputs(params.proof, params.publicInputs, params.verifierDepth);
	if (validationError) {
		throw new Error(`Proof validation failed: ${validationError}`);
	}

	// 2. Read EIP-712 nonce via a public read-only provider
	// NEAR wallets have no BrowserProvider, so we construct a JsonRpcProvider here.
	// This read is chain-state-only (view call) — no signing, no gas.
	const readProvider = new JsonRpcProvider(SCROLL_PUBLIC_RPC);
	const nonce = await readNonce(readProvider, params.districtGateAddress, wallet.address);

	// 3. Build EIP-712 typed data
	const deadline = defaultDeadline();
	const { domain, types, value } = buildProofAuthorizationData({
		proof: params.proof,
		publicInputs: params.publicInputs,
		verifierDepth: params.verifierDepth,
		deadline,
		districtGateAddress: params.districtGateAddress,
		chainId: params.chainId,
		nonce
	});

	// 4. Sign with wallet — works for both NEAR (MPC, 5-15s) and EVM (MetaMask popup)
	const signature = await wallet.signTypedData(domain, types, value);

	// 5. Build the UserOp wrapping DebateMarket.submitArgument in execute()
	//
	// The sender is wallet.address (the NEAR-derived Scroll EOA or EVM EOA).
	// In production this must be the SimpleAccount address, which for first-time
	// users may be a counterfactual address (not yet deployed). The factory/factoryData
	// fields are NOT populated here — SimpleAccount factory deployment is a separate step.
	//
	// ERC-4337 account nonce is initialized to 0n. Pimlico's estimation step validates
	// the account's actual on-chain nonce and will reject if mismatched.
	const publicInputsAsBigInt = publicInputsToBigInt(params.publicInputs);
	const userOp = buildSubmitArgumentUserOp({
		sender: wallet.address,
		debateId: params.debateId,
		stance: params.stance,
		bodyHash: params.bodyHash,
		amendmentHash: params.amendmentHash,
		stakeAmount: params.stakeAmount,
		signerAddress: wallet.address,
		proof: params.proof,
		publicInputs: publicInputsAsBigInt,
		verifierDepth: params.verifierDepth,
		deadline,
		signature,        // EIP-712 proof-authorization sig (also the UserOp sig for SimpleAccount)
		beneficiary: wallet.address
	});

	// 6. Serialize UserOp — bigint fields must be transmitted as hex strings (JSON cannot encode bigint)
	const wireUserOp = {
		sender: userOp.sender,
		nonce: toHexString(userOp.nonce ?? 0n),
		callData: userOp.callData,
		callGasLimit: toHexString(userOp.callGasLimit ?? 0n),
		verificationGasLimit: toHexString(userOp.verificationGasLimit ?? 0n),
		preVerificationGas: toHexString(userOp.preVerificationGas ?? 0n),
		maxFeePerGas: toHexString(userOp.maxFeePerGas ?? 0n),
		maxPriorityFeePerGas: toHexString(userOp.maxPriorityFeePerGas ?? 0n)
	};

	// 7. POST to the sponsorship endpoint
	const response = await fetch('/api/wallet/sponsor-userop', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ userOp: wireUserOp, signature })
	});

	const result = await response.json() as {
		success: boolean;
		txHash?: string;
		userOpHash?: string;
		error?: string;
		reason?: string;
	};

	if (!result.success) {
		const detail = result.reason ? ` (${result.reason})` : '';
		throw new Error(`Gasless submission failed: ${result.error}${detail}`);
	}

	if (!result.txHash) {
		throw new Error('Gasless submission: server returned success but no txHash');
	}

	return { txHash: result.txHash };
}

/**
 * Co-sign an existing argument via ERC-4337 gasless sponsorship.
 *
 * Identical flow to gaslessSubmitArgument but wraps coSignArgument instead.
 * See that function's JSDoc for full architecture notes.
 *
 * Prerequisites (not enforced here):
 *   - The sender address must have a deployed SimpleAccount with wallet.address as owner
 *   - The smart account must have approved DebateMarket to spend stakeAmount of USDC
 *     (TODO: batch approve + coSignArgument in a single multi-call UserOp)
 *
 * @param wallet - Any WalletProvider (NEAR or EVM) — only signTypedData is called
 * @param params - Co-sign parameters (same as clientCoSignArgument)
 * @returns Transaction hash of the confirmed on-chain co-sign
 * @throws On validation failure, MPC signing error, or server-side sponsorship failure
 */
export async function gaslessCoSignArgument(
	wallet: WalletProvider,
	params: ClientCoSignArgumentParams
): Promise<{ txHash: string }> {
	// 1. Validate proof inputs
	const validationError = validateProofInputs(params.proof, params.publicInputs, params.verifierDepth);
	if (validationError) {
		throw new Error(`Proof validation failed: ${validationError}`);
	}

	// 2. Read EIP-712 nonce via a public read-only provider
	const readProvider = new JsonRpcProvider(SCROLL_PUBLIC_RPC);
	const nonce = await readNonce(readProvider, params.districtGateAddress, wallet.address);

	// 3. Build EIP-712 typed data
	const deadline = defaultDeadline();
	const { domain, types, value } = buildProofAuthorizationData({
		proof: params.proof,
		publicInputs: params.publicInputs,
		verifierDepth: params.verifierDepth,
		deadline,
		districtGateAddress: params.districtGateAddress,
		chainId: params.chainId,
		nonce
	});

	// 4. Sign with wallet
	const signature = await wallet.signTypedData(domain, types, value);

	// 5. Build the UserOp wrapping DebateMarket.coSignArgument in execute()
	const publicInputsAsBigInt = publicInputsToBigInt(params.publicInputs);
	const userOp = buildCoSignArgumentUserOp({
		sender: wallet.address,
		debateId: params.debateId,
		argumentIndex: params.argumentIndex,
		stakeAmount: params.stakeAmount,
		signerAddress: wallet.address,
		proof: params.proof,
		publicInputs: publicInputsAsBigInt,
		verifierDepth: params.verifierDepth,
		deadline,
		signature,
		beneficiary: wallet.address
	});

	// 6. Serialize UserOp for JSON transport
	const wireUserOp = {
		sender: userOp.sender,
		nonce: toHexString(userOp.nonce ?? 0n),
		callData: userOp.callData,
		callGasLimit: toHexString(userOp.callGasLimit ?? 0n),
		verificationGasLimit: toHexString(userOp.verificationGasLimit ?? 0n),
		preVerificationGas: toHexString(userOp.preVerificationGas ?? 0n),
		maxFeePerGas: toHexString(userOp.maxFeePerGas ?? 0n),
		maxPriorityFeePerGas: toHexString(userOp.maxPriorityFeePerGas ?? 0n)
	};

	// 7. POST to the sponsorship endpoint
	const response = await fetch('/api/wallet/sponsor-userop', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ userOp: wireUserOp, signature })
	});

	const result = await response.json() as {
		success: boolean;
		txHash?: string;
		userOpHash?: string;
		error?: string;
		reason?: string;
	};

	if (!result.success) {
		const detail = result.reason ? ` (${result.reason})` : '';
		throw new Error(`Gasless co-sign failed: ${result.error}${detail}`);
	}

	if (!result.txHash) {
		throw new Error('Gasless co-sign: server returned success but no txHash');
	}

	return { txHash: result.txHash };
}

// ═══════════════════════════════════════════════════════════════════════════
// LMSR TRADE FUNCTIONS (commit-reveal)
// ═══════════════════════════════════════════════════════════════════════════

import {
	storePreimage,
	getPreimage,
	clearPreimage,
	type TradePreimage,
	type TradeDirection
} from './trade-preimage-store';

// Re-export types for convenience
export type { TradePreimage, TradeDirection };

/** Parameters for committing a trade from the browser. */
export interface ClientCommitTradeParams {
	/** Debate identifier (bytes32, 0x-prefixed). */
	debateId: string;

	/** Index of the argument to trade on. */
	argumentIndex: number;

	/** Trade direction: 0=BUY, 1=SELL. */
	direction: TradeDirection;

	/** Weighted amount from debate-weight ZK proof. Decimal string. */
	weightedAmount: string;

	/** Note commitment from debate-weight ZK proof. bytes32, 0x-prefixed. */
	noteCommitment: string;

	/** Hex-encoded three-tree ZK proof bytes. */
	proof: string;

	/** 31 field elements as decimal or hex strings (three-tree circuit). */
	publicInputs: string[];

	/** Circuit depth: 18 | 20 | 22 | 24. */
	verifierDepth: number;

	/** DistrictGate contract address (verifyingContract in EIP-712 domain). */
	districtGateAddress: string;

	/** Chain ID (534351 for Scroll Sepolia). */
	chainId: number;
}

/** Parameters for revealing a trade from the browser. */
export interface ClientRevealTradeParams {
	/** Debate identifier (bytes32, 0x-prefixed). */
	debateId: string;

	/** Epoch the commitment was made in. */
	epoch: number;

	/** Hex-encoded debate-weight ZK proof bytes. */
	debateWeightProof: string;

	/** [weightedAmount, noteCommitment] — 2 public inputs from debate-weight proof. */
	debateWeightPublicInputs: [string, string];
}

/**
 * Read the current epoch number for a debate.
 *
 * @param provider - ethers v6 Provider (read-only)
 * @param debateId - bytes32 debate identifier
 * @returns Current epoch number
 */
export async function readCurrentEpoch(
	provider: Provider,
	debateId: string
): Promise<number> {
	const debateMarket = new Contract(DEBATE_MARKET_ADDRESS, DEBATE_MARKET_ABI, provider);
	return Number(await debateMarket.currentEpoch(debateId));
}

/**
 * Commit a trade to a debate's LMSR market, signed and submitted by the user's wallet.
 *
 * Full client-side flow:
 *   1. Validate three-tree proof inputs
 *   2. Read current epoch from contract
 *   3. Generate random nonce for commitment
 *   4. Compute commitment hash: keccak256(argumentIndex, direction, weightedAmount, noteCommitment, epoch, nonce)
 *   5. Read EIP-712 nonce from DistrictGate
 *   6. Build EIP-712 typed data and sign (MetaMask popup)
 *   7. Submit commitTrade transaction
 *   8. Extract commitIndex from TradeCommitted event
 *   9. Persist preimage in IndexedDB for reveal phase
 *   10. Return txHash + commitIndex
 *
 * IMPORTANT: If step 9 fails (IndexedDB write), the trade is still committed on-chain
 * but the preimage may be lost. The function still returns success with a warning.
 *
 * @param wallet - Connected EVMWalletProvider (MetaMask/injected)
 * @param params - Trade commitment parameters
 * @returns Transaction hash and commit index
 * @throws On validation failure, user rejection, or contract revert
 */
export async function clientCommitTrade(
	wallet: EVMWalletProvider,
	params: ClientCommitTradeParams
): Promise<{ txHash: string; commitIndex: number }> {
	// 1. Validate proof inputs
	const validationError = validateProofInputs(params.proof, params.publicInputs, params.verifierDepth);
	if (validationError) {
		throw new Error(`Proof validation failed: ${validationError}`);
	}

	const provider: BrowserProvider = wallet.ethersProvider;
	const debateMarket = new Contract(DEBATE_MARKET_ADDRESS, DEBATE_MARKET_ABI, provider);

	// 2. Read current epoch
	const epoch = Number(await debateMarket.currentEpoch(params.debateId));

	// 3. Generate random nonce (32 bytes)
	const nonceBytes = new Uint8Array(32);
	crypto.getRandomValues(nonceBytes);
	const nonce = '0x' + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('');

	// 4. Compute commitment hash
	// Format: keccak256(abi.encodePacked(argumentIndex, direction, weightedAmount, noteCommitment, epoch, nonce))
	const commitHash = keccak256(
		solidityPacked(
			['uint256', 'uint8', 'uint256', 'bytes32', 'uint256', 'bytes32'],
			[params.argumentIndex, params.direction, BigInt(params.weightedAmount), params.noteCommitment, epoch, nonce]
		)
	);

	// 5. Read EIP-712 nonce from DistrictGate
	const eip712Nonce = await readNonce(provider, params.districtGateAddress, wallet.address);

	// 6. Build EIP-712 typed data and sign
	const deadline = defaultDeadline();
	const { domain, types, value } = buildProofAuthorizationData({
		proof: params.proof,
		publicInputs: params.publicInputs,
		verifierDepth: params.verifierDepth,
		deadline,
		districtGateAddress: params.districtGateAddress,
		chainId: params.chainId,
		nonce: eip712Nonce
	});

	const signature = await wallet.signTypedData(domain, types, value);

	// 7. Submit commitTrade transaction
	const signer = await provider.getSigner(wallet.address);
	const debateMarketSigner = new Contract(DEBATE_MARKET_ADDRESS, DEBATE_MARKET_ABI, signer);

	const proofBytes = params.proof.startsWith('0x') ? params.proof : '0x' + params.proof;
	const publicInputsAsBigInt = publicInputsToBigInt(params.publicInputs);

	const tx = await debateMarketSigner.commitTrade(
		params.debateId,        // bytes32 debateId
		commitHash,             // bytes32 commitHash
		wallet.address,         // address signer
		proofBytes,             // bytes proof
		publicInputsAsBigInt,   // uint256[31] publicInputs
		params.verifierDepth,   // uint8 verifierDepth
		deadline,               // uint256 deadline
		signature               // bytes signature
	);

	const receipt = await tx.wait();

	// 8. Extract commitIndex from TradeCommitted event
	// Event: TradeCommitted(bytes32 indexed debateId, uint256 epoch, bytes32 commitHash, uint256 commitIndex)
	let commitIndex = 0;
	for (const log of receipt.logs) {
		try {
			const parsed = debateMarketSigner.interface.parseLog({
				topics: log.topics as string[],
				data: log.data
			});
			if (parsed && parsed.name === 'TradeCommitted') {
				commitIndex = Number(parsed.args[3]); // 4th arg is commitIndex
				break;
			}
		} catch {
			// Not our event, skip
		}
	}

	// 9. Persist preimage in IndexedDB (per-user keyed via wallet.address)
	try {
		await storePreimage({
			userAddress: wallet.address.toLowerCase(),
			debateId: params.debateId,
			epoch,
			commitIndex,
			argumentIndex: params.argumentIndex,
			direction: params.direction,
			weightedAmount: params.weightedAmount,
			noteCommitment: params.noteCommitment,
			nonce,
			commitHash,
			commitTxHash: receipt.hash,
			storedAt: new Date().toISOString()
		});
	} catch (idbError) {
		// Critical but non-fatal: the on-chain commit succeeded.
		// Log prominently so the user can attempt manual recovery.
		console.error(
			'[debate-client] CRITICAL: Failed to persist trade preimage in IndexedDB.',
			'The trade is committed on-chain but the preimage may be lost.',
			'Preimage data for manual recovery:',
			{ debateId: params.debateId, epoch, commitIndex, nonce, commitHash },
			idbError
		);
	}

	return { txHash: receipt.hash, commitIndex };
}

/**
 * Reveal a previously committed trade, using the stored preimage.
 *
 * Full client-side flow:
 *   1. Retrieve preimage from IndexedDB
 *   2. Submit revealTrade with debate-weight ZK proof
 *   3. Clear preimage from IndexedDB
 *   4. Return txHash
 *
 * No EIP-712 signature is needed for reveal — the contract verifies the caller
 * is the original committer (msg.sender == commitment.committer).
 *
 * @param wallet - Connected EVMWalletProvider (MetaMask/injected)
 * @param params - Reveal parameters + debate-weight ZK proof
 * @returns Transaction hash
 * @throws On missing preimage, user rejection, or contract revert
 */
export async function clientRevealTrade(
	wallet: EVMWalletProvider,
	params: ClientRevealTradeParams
): Promise<{ txHash: string }> {
	// 1. Retrieve preimage (V2 lookup keyed by wallet, falls back to V1 legacy)
	const preimage = await getPreimage(params.debateId, params.epoch, wallet.address);
	if (!preimage) {
		throw new Error(
			`No stored preimage for debate ${params.debateId.slice(0, 12)}... epoch ${params.epoch}. ` +
			'The trade preimage may have been lost. This trade is forfeit.'
		);
	}

	const provider: BrowserProvider = wallet.ethersProvider;
	const signer = await provider.getSigner(wallet.address);
	const debateMarket = new Contract(DEBATE_MARKET_ADDRESS, DEBATE_MARKET_ABI, signer);

	const debateWeightProofBytes = params.debateWeightProof.startsWith('0x')
		? params.debateWeightProof
		: '0x' + params.debateWeightProof;

	// 2. Submit revealTrade
	const tx = await debateMarket.revealTrade(
		params.debateId,                     // bytes32 debateId
		params.epoch,                        // uint256 epoch
		preimage.commitIndex,                // uint256 commitIndex
		preimage.argumentIndex,              // uint256 argumentIndex
		preimage.direction,                  // uint8 direction
		preimage.nonce,                      // bytes32 nonce
		debateWeightProofBytes,              // bytes debateWeightProof
		params.debateWeightPublicInputs      // bytes32[2] debateWeightPublicInputs
	);

	const receipt = await tx.wait();

	// 3. Clear preimage (trade is revealed, no longer needed)
	try {
		await clearPreimage(params.debateId, params.epoch, wallet.address);
	} catch {
		// Non-critical — preimage is just stale data at this point
		console.warn('[debate-client] Failed to clear preimage from IndexedDB (non-critical)');
	}

	return { txHash: receipt.hash };
}
