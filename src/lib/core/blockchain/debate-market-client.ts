/**
 * DebateMarket Client - Staked debate protocol on Scroll
 *
 * Submits staked debate transactions to the DebateMarket contract on Scroll.
 * Uses the same server-side relayer wallet as DistrictGateClient for gas payment.
 * DebateMarket composes with DistrictGate for ZK proof verification — the EIP-712
 * signature domain is DistrictGate, not DebateMarket.
 *
 * ARCHITECTURE:
 * - Server-side only (imports $env/dynamic/private for relayer key)
 * - Reuses the DistrictGate circuit breaker and balance monitoring (same RPC)
 * - EIP-712 signatures target DistrictGate (proof verification delegation)
 *
 * DEPLOYED CONTRACTS (V11 — hardened):
 * - DebateMarket: 0xA07D6F620FEc31A163E1F888956e4c98D522B906 (Scroll Sepolia)
 *
 * @see STAKED-DEBATE-PROTOCOL-SPEC.md
 * @see DebateMarket.sol
 */

import { env } from '$env/dynamic/private';
import {
	Contract,
	JsonRpcProvider,
	NonceManager,
	Wallet,
	keccak256,
	solidityPacked,
	type TransactionReceipt
} from 'ethers';
import { BN254_MODULUS } from '$lib/core/crypto/bn254';
import { STAKING_TOKEN_ADDRESS } from '$lib/core/contracts';
import { isCircuitOpen, getConfig, recordRpcFailure, recordRpcSuccess } from './district-gate-client';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Minimal DebateMarket ABI — only the functions we call */
const DEBATE_MARKET_ABI = [
	// State-changing
	'function proposeDebate(bytes32 propositionHash, uint256 duration, uint256 jurisdictionSizeHint, bytes32 baseDomain, uint256 bondAmount) returns (bytes32)',
	'function submitArgument(bytes32 debateId, uint8 stance, bytes32 bodyHash, bytes32 amendmentHash, uint256 stakeAmount, address signer, bytes proof, uint256[31] publicInputs, uint8 verifierDepth, uint256 deadline, bytes signature, address beneficiary)',
	'function coSignArgument(bytes32 debateId, uint256 argumentIndex, uint256 stakeAmount, address signer, bytes proof, uint256[31] publicInputs, uint8 verifierDepth, uint256 deadline, bytes signature, address beneficiary)',
	'function resolveDebate(bytes32 debateId)',
	'function claimSettlement(bytes32 debateId, bytes32 nullifier)',
	'function settlePrivatePosition(bytes32 debateId, bytes calldata positionProof, bytes32[5] calldata positionPublicInputs)',
	// LMSR commit/reveal trading
	'function commitTrade(bytes32 debateId, bytes32 commitHash, address signer, bytes proof, uint256[31] publicInputs, uint8 verifierDepth, uint256 deadline, bytes signature)',
	'function revealTrade(bytes32 debateId, uint256 epoch, uint256 commitIndex, uint256 argumentIndex, uint8 direction, bytes32 nonce, bytes debateWeightProof, bytes32[2] debateWeightPublicInputs)',
	'function executeEpoch(bytes32 debateId, uint256 epoch)',
	// AI Resolution (Phase 3)
	'function submitAIEvaluation(bytes32 debateId, uint256[] packedScores, uint256 deadline, bytes[] signatures)',
	'function resolveDebateWithAI(bytes32 debateId)',
	'function escalateToGovernance(bytes32 debateId)',
	'function submitGovernanceResolution(bytes32 debateId, uint256 winningIndex, bytes32 justification)',
	'function appealResolution(bytes32 debateId)',
	'function finalizeAppeal(bytes32 debateId)',
	// View / pure
	'function getDebateState(bytes32 debateId) view returns (uint8 status, uint256 deadline_, uint256 argumentCount, uint256 totalStake, uint256 uniqueParticipants)',
	'function debates(bytes32 debateId) view returns (uint256 winningArgumentIndex, uint8 winningStance, uint8 status, uint8 resolutionMethod)',
	'function arguments(bytes32 debateId, uint256 index) view returns (uint8 stance, bytes32 bodyHash, uint256 weightedScore)',
	'function deriveDomain(bytes32 baseDomain, bytes32 propositionHash) pure returns (bytes32)',
	'function aiArgumentScores(bytes32 debateId, uint256 argumentIndex) view returns (uint256)',
	'function aiSignatureCount(bytes32 debateId) view returns (uint256)',
	'function aiEvalNonce(bytes32 debateId) view returns (uint256)',
	// Events
	'event DebateProposed(bytes32 indexed debateId, bytes32 indexed actionDomain, bytes32 propositionHash, uint256 deadline, bytes32 baseDomain)',
	'event AIEvaluationSubmitted(bytes32 indexed debateId, uint256 signatureCount, uint256 nonce)',
	'event DebateResolvedWithAI(bytes32 indexed debateId, uint256 winningArgumentIndex, uint256 aiScore, uint256 communityScore, uint256 finalScore, uint8 resolutionMethod)'
];

/** Minimal DistrictGate ABI for nonce lookups */
const DISTRICT_GATE_NONCES_ABI = [
	'function nonces(address) view returns (uint256)'
];

/** Number of public inputs expected by the three-tree circuit */
const THREE_TREE_PUBLIC_INPUT_COUNT = 31;

/** Valid circuit depths for three-tree verifier */
const VALID_VERIFIER_DEPTHS = [18, 20, 22, 24] as const;

/** EIP-712 type definition for SubmitThreeTreeProof (DistrictGate domain) */
const EIP712_TYPES = {
	SubmitThreeTreeProof: [
		{ name: 'proofHash', type: 'bytes32' },
		{ name: 'publicInputsHash', type: 'bytes32' },
		{ name: 'verifierDepth', type: 'uint8' },
		{ name: 'nonce', type: 'uint256' },
		{ name: 'deadline', type: 'uint256' }
	]
};

/** Default deadline: 1 hour from now */
const DEFAULT_DEADLINE_SECONDS = 3600;

/** Ethereum zero address — used as beneficiary sentinel for backward compatibility */
const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000';

/** ERC-20 ABI for token approval (server-side relayer). */
const ERC20_APPROVE_ABI = [
	'function allowance(address owner, address spender) view returns (uint256)',
	'function approve(address spender, uint256 amount) returns (bool)'
];

/**
 * Ensure the DebateMarket contract has sufficient ERC-20 allowance from the
 * relayer wallet. If current allowance is below `amount`, approves max uint256.
 * Idempotent: no-op if already approved.
 *
 * @param signer - NonceManager-wrapped relayer wallet
 * @param tokenAddress - ERC-20 token contract address (STAKING_TOKEN_ADDRESS)
 * @param spender - Contract address to approve (DebateMarket)
 * @param amount - Minimum required allowance
 */
async function approveStakingToken(
	signer: NonceManager,
	tokenAddress: string,
	spender: string,
	amount: bigint
): Promise<void> {
	const signerAddress = await signer.getAddress();
	const token = new Contract(tokenAddress, ERC20_APPROVE_ABI, signer);
	const currentAllowance: bigint = await token.allowance(signerAddress, spender);
	if (currentAllowance >= amount) return;

	const maxUint256 = (1n << 256n) - 1n;
	const tx = await token.approve(spender, maxUint256);
	await tx.wait();
}

/**
 * Returns true for a valid Ethereum address (0x-prefixed, 42 chars, hex).
 * Accepts both checksummed and lowercase forms.
 */
function isValidAddress(addr: string): boolean {
	return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ProposeDebateParams {
	propositionHash: string;
	duration: number;
	jurisdictionSizeHint: number;
	baseDomain: string;
	bondAmount: bigint;
}

export interface DebateResult {
	success: boolean;
	debateId?: string;
	txHash?: string;
	error?: string;
}

export interface SubmitArgumentParams {
	debateId: string;
	stance: number;
	bodyHash: string;
	amendmentHash: string;
	stakeAmount: bigint;
	proof: string;
	publicInputs: string[];
	verifierDepth: number;
	deadline?: number;
	/**
	 * Address that will receive settlement tokens when claimSettlement() is called.
	 * Separate from the EIP-712 signer (the relayer wallet authorizing the proof).
	 * Defaults to address(0) for backward compatibility — contract should interpret
	 * address(0) as "pay to msg.sender (the relayer)".
	 */
	beneficiary?: string;
}

export interface CoSignArgumentParams {
	debateId: string;
	argumentIndex: number;
	stakeAmount: bigint;
	proof: string;
	publicInputs: string[];
	verifierDepth: number;
	deadline?: number;
	/**
	 * Address that will receive settlement tokens when claimSettlement() is called.
	 * Separate from the EIP-712 signer (the relayer wallet authorizing the proof).
	 * Defaults to address(0) for backward compatibility — contract should interpret
	 * address(0) as "pay to msg.sender (the relayer)".
	 */
	beneficiary?: string;
}

export interface CommitTradeParams {
	debateId: string;
	commitHash: string;
	proof: string;
	publicInputs: string[];
	verifierDepth: number;
	deadline?: number;
}

export interface RevealTradeParams {
	debateId: string;
	epoch: number;
	commitIndex: number;
	argumentIndex: number;
	direction: number; // 0=BUY, 1=SELL
	nonce: string; // bytes32
	debateWeightProof: string;
	debateWeightPublicInputs: [string, string]; // [weightedAmount, noteCommitment]
}

export interface TxResult {
	success: boolean;
	txHash?: string;
	error?: string;
}

export interface DebateStateResult {
	success: boolean;
	status?: number;
	argumentCount?: number;
	totalStake?: bigint;
	deadline?: number;
	resolvedAt?: number;
	uniqueParticipants?: number;
	error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// AI RESOLUTION TYPES (Phase 3)
// ═══════════════════════════════════════════════════════════════════════════

export interface SubmitAIEvaluationParams {
	debateId: string;
	packedScores: bigint[];
	deadline: number;
	signatures: string[];
}

export interface AIScoreResult {
	success: boolean;
	packedScore?: bigint;
	error?: string;
}

export interface AIEvalNonceResult {
	success: boolean;
	nonce?: bigint;
	error?: string;
}

export interface SubmitGovernanceResolutionParams {
	debateId: string;
	winningIndex: number;
	justification: string; // bytes32 — a keccak256 hash of the justification text
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON PROVIDER + CONTRACTS
// ═══════════════════════════════════════════════════════════════════════════

let _provider: JsonRpcProvider | null = null;
let _wallet: Wallet | null = null;
let _nonceManager: NonceManager | null = null;
let _debateMarket: Contract | null = null;
let _districtGateForNonces: Contract | null = null;

interface DebateMarketInstance {
	debateMarket: Contract;
	districtGateForNonces: Contract;
	wallet: Wallet;
	nonceManager: NonceManager;
}

function getDebateMarketInstance(): DebateMarketInstance | null {
	const config = getConfig();
	const debateMarketAddress = env.DEBATE_MARKET_ADDRESS || '';
	const districtGateAddress = config.contractAddress;

	if (
		!debateMarketAddress ||
		!districtGateAddress ||
		!config.rpcUrl ||
		!config.privateKey
	) {
		return null;
	}

	if (_debateMarket && _districtGateForNonces && _wallet && _nonceManager) {
		return {
			debateMarket: _debateMarket,
			districtGateForNonces: _districtGateForNonces,
			wallet: _wallet,
			nonceManager: _nonceManager
		};
	}

	_provider = new JsonRpcProvider(config.rpcUrl);
	_wallet = new Wallet(config.privateKey, _provider);
	_nonceManager = new NonceManager(_wallet);
	_debateMarket = new Contract(debateMarketAddress, DEBATE_MARKET_ABI, _nonceManager);
	_districtGateForNonces = new Contract(districtGateAddress, DISTRICT_GATE_NONCES_ABI, _nonceManager);

	return {
		debateMarket: _debateMarket,
		districtGateForNonces: _districtGateForNonces,
		wallet: _wallet,
		nonceManager: _nonceManager
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Build EIP-712 signature for DistrictGate proof verification */
async function buildEIP712Signature(
	wallet: Wallet,
	districtGateForNonces: Contract,
	proofBytes: string,
	publicInputsAsBigInt: bigint[],
	verifierDepth: number,
	deadline: number
): Promise<string> {
	const proofHash = keccak256(proofBytes);

	const publicInputsPacked = solidityPacked(
		Array(THREE_TREE_PUBLIC_INPUT_COUNT).fill('uint256'),
		publicInputsAsBigInt
	);
	const publicInputsHash = keccak256(publicInputsPacked);

	const nonce = await districtGateForNonces.nonces(wallet.address);

	const districtGateAddress = await districtGateForNonces.getAddress();
	const domain = {
		name: 'DistrictGate',
		version: '1',
		chainId: (await wallet.provider!.getNetwork()).chainId,
		verifyingContract: districtGateAddress
	};

	const value = {
		proofHash,
		publicInputsHash,
		verifierDepth,
		nonce,
		deadline
	};

	return wallet.signTypedData(domain, EIP712_TYPES, value);
}

/** Validate ZK proof inputs shared by submitArgument and coSignArgument */
function validateProofInputs(
	proof: string,
	publicInputs: string[],
	verifierDepth: number
): string | null {
	if (publicInputs.length !== THREE_TREE_PUBLIC_INPUT_COUNT) {
		return `Expected ${THREE_TREE_PUBLIC_INPUT_COUNT} public inputs, got ${publicInputs.length}`;
	}

	const proofRaw = proof.startsWith('0x') ? proof.slice(2) : proof;
	if (!proofRaw || proofRaw.length === 0) {
		return 'Proof is empty';
	}
	if (!/^[0-9a-fA-F]+$/.test(proofRaw)) {
		return 'Proof contains invalid hex characters';
	}

	if (!(VALID_VERIFIER_DEPTHS as readonly number[]).includes(verifierDepth)) {
		return `Invalid verifierDepth ${verifierDepth}. Must be one of: ${VALID_VERIFIER_DEPTHS.join(', ')}`;
	}

	for (let i = 0; i < publicInputs.length; i++) {
		try {
			const val = BigInt(publicInputs[i]);
			if (val < 0n || val >= BN254_MODULUS) {
				return `Public input [${i}] out of BN254 field range`;
			}
		} catch {
			return `Public input [${i}] is not a valid integer or hex string`;
		}
	}

	return null;
}

/** Check configuration and circuit breaker, returning an error string or null */
function preflight(): { instance: DebateMarketInstance } | { error: string } {
	if (isCircuitOpen()) {
		return { error: 'Circuit breaker OPEN: RPC failures exceeded threshold. Retry after cooldown.' };
	}

	const instance = getDebateMarketInstance();
	if (!instance) {
		const config = getConfig();
		const missing = [];
		if (!env.DEBATE_MARKET_ADDRESS) missing.push('DEBATE_MARKET_ADDRESS');
		if (!config.contractAddress) missing.push('DISTRICT_GATE_ADDRESS');
		if (!config.rpcUrl) missing.push('SCROLL_RPC_URL');
		if (!config.privateKey) missing.push('SCROLL_PRIVATE_KEY');
		return { error: `Blockchain not configured (set ${missing.join(', ')} env vars)` };
	}

	return { instance };
}

/** Classify error as RPC-level (circuit breaker) vs. contract revert (valid response) */
function isRpcError(msg: string): boolean {
	const msgLower = msg.toLowerCase();
	const rpcErrorPatterns = [
		'network', 'timeout', 'econnrefused', 'etimedout', 'enotfound',
		'econnreset', 'could not detect network', 'socket hang up',
		'429', 'too many requests', '503', 'service unavailable',
		'502', 'bad gateway', '504', 'gateway timeout',
		'insufficient funds for gas', 'nonce too low'
	];
	return rpcErrorPatterns.some((p) => msgLower.includes(p));
}

/** Extract revert reason from ethers error message */
function extractRevertReason(msg: string): string {
	const revertMatch = msg.match(/reason="([^"]+)"/);
	return revertMatch ? revertMatch[1] : msg;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTED FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Propose a new debate by posting a proposition hash and staking a bond.
 * Approves staking token spend, then calls DebateMarket.proposeDebate.
 */
export async function proposeDebate(params: ProposeDebateParams): Promise<DebateResult> {
	const check = preflight();
	if ('error' in check) return { success: false, error: check.error };
	const { debateMarket, wallet, nonceManager } = check.instance;

	console.debug('[DebateMarketClient] Proposing debate:', {
		propositionHash: params.propositionHash.slice(0, 12) + '...',
		duration: params.duration,
		bondAmount: params.bondAmount.toString()
	});

	try {
		// Ensure ERC-20 token approval for bond amount
		const debateMarketAddress = await debateMarket.getAddress();
		await approveStakingToken(nonceManager, STAKING_TOKEN_ADDRESS, debateMarketAddress, params.bondAmount);

		const tx = await debateMarket.proposeDebate(
			params.propositionHash,
			params.duration,
			params.jurisdictionSizeHint,
			params.baseDomain,
			params.bondAmount
		);

		const receipt: TransactionReceipt = await tx.wait();

		// Parse the debateId from the return value via logs
		// proposeDebate returns bytes32 debateId — extract from DebateProposed event topic
		const debateProposedTopic = debateMarket.interface.getEvent('DebateProposed');
		let debateId: string | undefined;
		if (debateProposedTopic) {
			for (const log of receipt.logs) {
				try {
					const parsed = debateMarket.interface.parseLog({
						topics: log.topics as string[],
						data: log.data
					});
					if (parsed && parsed.name === 'DebateProposed') {
						debateId = parsed.args[0]; // first indexed arg is debateId
						break;
					}
				} catch {
					// Not our event, skip
				}
			}
		}

		recordRpcSuccess();

		console.debug('[DebateMarketClient] Debate proposed:', {
			debateId: debateId?.slice(0, 12) + '...',
			txHash: receipt.hash,
			gasUsed: receipt.gasUsed.toString()
		});

		return { success: true, debateId, txHash: receipt.hash };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);

		if (isRpcError(msg)) {
			recordRpcFailure();
			console.warn('[DebateMarketClient] RPC error in proposeDebate:', msg);
		}

		console.error('[DebateMarketClient] proposeDebate failed:', {
			error: extractRevertReason(msg),
			proposer: wallet.address.slice(0, 10) + '...'
		});

		return { success: false, error: `Transaction failed: ${extractRevertReason(msg)}` };
	}
}

/**
 * Submit a new argument to an active debate.
 * Approves staking token, builds EIP-712 signature for DistrictGate, then submits.
 *
 * The `beneficiary` param (R-01 fix) is the address that receives settlement tokens
 * when claimSettlement() is called. It is distinct from the EIP-712 signer (the
 * relayer wallet). When omitted, defaults to address(0) — the contract interprets
 * this as "pay to msg.sender (the relayer)" for backward compatibility.
 */
export async function submitArgument(params: SubmitArgumentParams): Promise<TxResult> {
	const check = preflight();
	if ('error' in check) return { success: false, error: check.error };
	const { debateMarket, districtGateForNonces, wallet, nonceManager } = check.instance;

	const validationError = validateProofInputs(params.proof, params.publicInputs, params.verifierDepth);
	if (validationError) return { success: false, error: validationError };

	// Resolve beneficiary: use provided address if valid, else fall back to address(0)
	const beneficiary =
		params.beneficiary && isValidAddress(params.beneficiary)
			? params.beneficiary
			: ADDRESS_ZERO;

	const deadline = params.deadline ?? Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECONDS;
	const proofBytes = params.proof.startsWith('0x') ? params.proof : '0x' + params.proof;
	const publicInputsAsBigInt = params.publicInputs.map((v) => BigInt(v));

	console.debug('[DebateMarketClient] Submitting argument:', {
		debateId: params.debateId.slice(0, 12) + '...',
		stance: params.stance,
		stakeAmount: params.stakeAmount.toString(),
		verifierDepth: params.verifierDepth,
		beneficiary: beneficiary === ADDRESS_ZERO ? 'address(0) — relayer fallback' : beneficiary.slice(0, 10) + '...'
	});

	try {
		let signature: string;
		try {
			signature = await buildEIP712Signature(
				wallet, districtGateForNonces, proofBytes, publicInputsAsBigInt,
				params.verifierDepth, deadline
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error('[DebateMarketClient] EIP-712 signing failed:', msg);
			return { success: false, error: `EIP-712 signing failed: ${msg}` };
		}

		// Ensure ERC-20 token approval for stake amount
		const debateMarketAddress = await debateMarket.getAddress();
		await approveStakingToken(nonceManager, STAKING_TOKEN_ADDRESS, debateMarketAddress, params.stakeAmount);

		const tx = await debateMarket.submitArgument(
			params.debateId,
			params.stance,
			params.bodyHash,
			params.amendmentHash,
			params.stakeAmount,  // uint256 stakeAmount
			wallet.address,  // signer — authorizes the EIP-712 proof delegation
			proofBytes,
			publicInputsAsBigInt,
			params.verifierDepth,
			deadline,
			signature,
			beneficiary      // settlement recipient (may differ from signer)
		);

		const receipt: TransactionReceipt = await tx.wait();

		recordRpcSuccess();

		console.debug('[DebateMarketClient] Argument submitted:', {
			txHash: receipt.hash,
			gasUsed: receipt.gasUsed.toString()
		});

		return { success: true, txHash: receipt.hash };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);

		if (isRpcError(msg)) {
			recordRpcFailure();
			console.warn('[DebateMarketClient] RPC error in submitArgument:', msg);
		}

		console.error('[DebateMarketClient] submitArgument failed:', {
			error: extractRevertReason(msg),
			debateId: params.debateId.slice(0, 12) + '...'
		});

		return { success: false, error: `Transaction failed: ${extractRevertReason(msg)}` };
	}
}

/**
 * Co-sign an existing argument in an active debate.
 * Approves staking token, builds EIP-712 signature for DistrictGate, then submits.
 *
 * The `beneficiary` param (R-01 fix) is the address that receives settlement tokens
 * when claimSettlement() is called. It is distinct from the EIP-712 signer (the
 * relayer wallet). When omitted, defaults to address(0) — the contract interprets
 * this as "pay to msg.sender (the relayer)" for backward compatibility.
 */
export async function coSignArgument(params: CoSignArgumentParams): Promise<TxResult> {
	const check = preflight();
	if ('error' in check) return { success: false, error: check.error };
	const { debateMarket, districtGateForNonces, wallet, nonceManager } = check.instance;

	const validationError = validateProofInputs(params.proof, params.publicInputs, params.verifierDepth);
	if (validationError) return { success: false, error: validationError };

	// Resolve beneficiary: use provided address if valid, else fall back to address(0)
	const beneficiary =
		params.beneficiary && isValidAddress(params.beneficiary)
			? params.beneficiary
			: ADDRESS_ZERO;

	const deadline = params.deadline ?? Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECONDS;
	const proofBytes = params.proof.startsWith('0x') ? params.proof : '0x' + params.proof;
	const publicInputsAsBigInt = params.publicInputs.map((v) => BigInt(v));

	console.debug('[DebateMarketClient] Co-signing argument:', {
		debateId: params.debateId.slice(0, 12) + '...',
		argumentIndex: params.argumentIndex,
		stakeAmount: params.stakeAmount.toString(),
		verifierDepth: params.verifierDepth,
		beneficiary: beneficiary === ADDRESS_ZERO ? 'address(0) — relayer fallback' : beneficiary.slice(0, 10) + '...'
	});

	try {
		let signature: string;
		try {
			signature = await buildEIP712Signature(
				wallet, districtGateForNonces, proofBytes, publicInputsAsBigInt,
				params.verifierDepth, deadline
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error('[DebateMarketClient] EIP-712 signing failed:', msg);
			return { success: false, error: `EIP-712 signing failed: ${msg}` };
		}

		// Ensure ERC-20 token approval for stake amount
		const debateMarketAddress = await debateMarket.getAddress();
		await approveStakingToken(nonceManager, STAKING_TOKEN_ADDRESS, debateMarketAddress, params.stakeAmount);

		const tx = await debateMarket.coSignArgument(
			params.debateId,
			params.argumentIndex,
			params.stakeAmount,  // uint256 stakeAmount
			wallet.address,  // signer — authorizes the EIP-712 proof delegation
			proofBytes,
			publicInputsAsBigInt,
			params.verifierDepth,
			deadline,
			signature,
			beneficiary      // settlement recipient (may differ from signer)
		);

		const receipt: TransactionReceipt = await tx.wait();

		recordRpcSuccess();

		console.debug('[DebateMarketClient] Co-sign submitted:', {
			txHash: receipt.hash,
			gasUsed: receipt.gasUsed.toString()
		});

		return { success: true, txHash: receipt.hash };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);

		if (isRpcError(msg)) {
			recordRpcFailure();
			console.warn('[DebateMarketClient] RPC error in coSignArgument:', msg);
		}

		console.error('[DebateMarketClient] coSignArgument failed:', {
			error: extractRevertReason(msg),
			debateId: params.debateId.slice(0, 12) + '...'
		});

		return { success: false, error: `Transaction failed: ${extractRevertReason(msg)}` };
	}
}

/**
 * Resolve a debate after its deadline has passed.
 * No token approval or ZK proof needed.
 */
export async function resolveDebate(debateId: string): Promise<TxResult> {
	const check = preflight();
	if ('error' in check) return { success: false, error: check.error };
	const { debateMarket } = check.instance;

	console.debug('[DebateMarketClient] Resolving debate:', {
		debateId: debateId.slice(0, 12) + '...'
	});

	try {
		const tx = await debateMarket.resolveDebate(debateId);
		const receipt: TransactionReceipt = await tx.wait();

		recordRpcSuccess();

		console.debug('[DebateMarketClient] Debate resolved:', {
			txHash: receipt.hash,
			gasUsed: receipt.gasUsed.toString()
		});

		return { success: true, txHash: receipt.hash };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);

		if (isRpcError(msg)) {
			recordRpcFailure();
			console.warn('[DebateMarketClient] RPC error in resolveDebate:', msg);
		}

		console.error('[DebateMarketClient] resolveDebate failed:', {
			error: extractRevertReason(msg),
			debateId: debateId.slice(0, 12) + '...'
		});

		return { success: false, error: `Transaction failed: ${extractRevertReason(msg)}` };
	}
}

/**
 * Claim settlement payout for a resolved debate.
 *
 * TRUST MODEL (post R-01):
 * The contract now stores record.beneficiary set at submission time.
 * claimSettlement() transfers tokens to record.beneficiary rather than msg.sender.
 * This means:
 *
 * 1. Users who provided their wallet address as `beneficiary` at argument submission
 *    time receive tokens directly, without the relayer holding them in escrow.
 * 2. If beneficiary was address(0) at submission, the contract falls back to
 *    record.submitter (this relayer wallet) — preserving backward compatibility.
 * 3. The relayer still pays gas; users still never need funded Scroll wallets.
 *
 * The contract uses dual authorization: either record.submitter (relayer) OR
 * record.beneficiary (user wallet) can call claimSettlement(). Tokens flow
 * to record.beneficiary if set, otherwise to record.submitter.
 *
 * No token approval needed — the contract transfers winnings from its own balance.
 */
export async function claimSettlement(debateId: string, nullifier: string): Promise<TxResult> {
	const check = preflight();
	if ('error' in check) return { success: false, error: check.error };
	const { debateMarket } = check.instance;

	console.debug('[DebateMarketClient] Claiming settlement:', {
		debateId: debateId.slice(0, 12) + '...',
		nullifier: nullifier.slice(0, 12) + '...'
	});

	try {
		const tx = await debateMarket.claimSettlement(debateId, nullifier);
		const receipt: TransactionReceipt = await tx.wait();

		recordRpcSuccess();

		console.debug('[DebateMarketClient] Settlement claimed:', {
			txHash: receipt.hash,
			gasUsed: receipt.gasUsed.toString()
		});

		return { success: true, txHash: receipt.hash };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);

		if (isRpcError(msg)) {
			recordRpcFailure();
			console.warn('[DebateMarketClient] RPC error in claimSettlement:', msg);
		}

		console.error('[DebateMarketClient] claimSettlement failed:', {
			error: extractRevertReason(msg),
			debateId: debateId.slice(0, 12) + '...'
		});

		return { success: false, error: `Transaction failed: ${extractRevertReason(msg)}` };
	}
}

/**
 * Settle a private position using a ZK position_note proof (Phase 2).
 *
 * This path is used when a trader holds a private position commitment
 * (committed via commitTrade + revealTrade) and wants to claim their
 * settlement payout without revealing which argument they backed.
 *
 * The positionPublicInputs are the 5 public inputs exposed by the
 * position_note Noir circuit:
 *   [0] position_root           — Merkle root of the position tree
 *   [1] nullifier               — H_PNL(nullifierKey, commitment, debateId)
 *   [2] debate_id               — Domain separation (matches on-chain debateId)
 *   [3] winning_argument_index  — Resolution outcome (contract-controlled)
 *   [4] claimed_weighted_amount — Payout weight for settlement math
 *
 * @param debateId               - bytes32 debate identifier (0x-prefixed hex)
 * @param positionProof          - Raw proof bytes from position_note prover (0x-prefixed hex)
 * @param positionPublicInputs   - 5-element bytes32 array (0x-prefixed hex strings)
 */
export async function settlePrivatePosition(
	debateId: string,
	positionProof: string,
	positionPublicInputs: [string, string, string, string, string]
): Promise<TxResult> {
	const check = preflight();
	if ('error' in check) return { success: false, error: check.error };
	const { debateMarket } = check.instance;

	if (positionPublicInputs.length !== 5) {
		return { success: false, error: 'positionPublicInputs must have exactly 5 elements' };
	}

	const proofBytes = positionProof.startsWith('0x') ? positionProof : '0x' + positionProof;

	console.debug('[DebateMarketClient] Settling private position:', {
		debateId: debateId.slice(0, 12) + '...',
		proofLength: proofBytes.length,
		positionRoot: positionPublicInputs[0].slice(0, 12) + '...'
	});

	try {
		const tx = await debateMarket.settlePrivatePosition(
			debateId,
			proofBytes,
			positionPublicInputs
		);
		const receipt: TransactionReceipt = await tx.wait();

		recordRpcSuccess();

		console.debug('[DebateMarketClient] Private position settled:', {
			txHash: receipt.hash,
			gasUsed: receipt.gasUsed.toString()
		});

		return { success: true, txHash: receipt.hash };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);

		if (isRpcError(msg)) {
			recordRpcFailure();
			console.warn('[DebateMarketClient] RPC error in settlePrivatePosition:', msg);
		}

		console.error('[DebateMarketClient] settlePrivatePosition failed:', {
			error: extractRevertReason(msg),
			debateId: debateId.slice(0, 12) + '...'
		});

		return { success: false, error: `Transaction failed: ${extractRevertReason(msg)}` };
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// LMSR COMMIT/REVEAL TRADING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Commit a trade to an active debate via the LMSR commit/reveal mechanism.
 * Requires a three-tree ZK proof (same as submitArgument). The commit hash
 * encodes the trader's intended direction and amount; reveal happens later.
 *
 * NOTE: Token staking does NOT happen at commit time — the commitHash mechanism
 * defers the actual token transfer to the reveal phase.
 *
 * NOTE: The contract stores record.submitter = msg.sender (this relayer wallet).
 * Same trust model as submitArgument — see claimSettlement() for documentation.
 */
export async function commitTrade(params: CommitTradeParams): Promise<TxResult> {
	const check = preflight();
	if ('error' in check) return { success: false, error: check.error };
	const { debateMarket, districtGateForNonces, wallet } = check.instance;

	const validationError = validateProofInputs(params.proof, params.publicInputs, params.verifierDepth);
	if (validationError) return { success: false, error: validationError };

	const deadline = params.deadline ?? Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECONDS;
	const proofBytes = params.proof.startsWith('0x') ? params.proof : '0x' + params.proof;
	const publicInputsAsBigInt = params.publicInputs.map((v) => BigInt(v));

	console.debug('[DebateMarketClient] Committing trade:', {
		debateId: params.debateId.slice(0, 12) + '...',
		commitHash: params.commitHash.slice(0, 12) + '...',
		verifierDepth: params.verifierDepth
	});

	try {
		let signature: string;
		try {
			signature = await buildEIP712Signature(
				wallet, districtGateForNonces, proofBytes, publicInputsAsBigInt,
				params.verifierDepth, deadline
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error('[DebateMarketClient] EIP-712 signing failed:', msg);
			return { success: false, error: `EIP-712 signing failed: ${msg}` };
		}

		const tx = await debateMarket.commitTrade(
			params.debateId,
			params.commitHash,
			wallet.address,
			proofBytes,
			publicInputsAsBigInt,
			params.verifierDepth,
			deadline,
			signature
		);

		const receipt: TransactionReceipt = await tx.wait();

		recordRpcSuccess();

		console.debug('[DebateMarketClient] Trade committed:', {
			txHash: receipt.hash,
			gasUsed: receipt.gasUsed.toString()
		});

		return { success: true, txHash: receipt.hash };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);

		if (isRpcError(msg)) {
			recordRpcFailure();
			console.warn('[DebateMarketClient] RPC error in commitTrade:', msg);
		}

		console.error('[DebateMarketClient] commitTrade failed:', {
			error: extractRevertReason(msg),
			debateId: params.debateId.slice(0, 12) + '...'
		});

		return { success: false, error: `Transaction failed: ${extractRevertReason(msg)}` };
	}
}

/**
 * Reveal a previously committed trade. Requires the debate_weight ZK proof
 * (2 public inputs: weightedAmount and noteCommitment) — NOT the three-tree proof.
 *
 * No EIP-712 signature needed — the reveal references the commit's identity proof.
 * No token approval needed — staking is handled by the contract at reveal time.
 */
export async function revealTrade(params: RevealTradeParams): Promise<TxResult> {
	const check = preflight();
	if ('error' in check) return { success: false, error: check.error };
	const { debateMarket } = check.instance;

	const debateWeightProofBytes = params.debateWeightProof.startsWith('0x')
		? params.debateWeightProof
		: '0x' + params.debateWeightProof;

	console.debug('[DebateMarketClient] Revealing trade:', {
		debateId: params.debateId.slice(0, 12) + '...',
		epoch: params.epoch,
		commitIndex: params.commitIndex,
		argumentIndex: params.argumentIndex,
		direction: params.direction
	});

	try {
		const tx = await debateMarket.revealTrade(
			params.debateId,
			params.epoch,
			params.commitIndex,
			params.argumentIndex,
			params.direction,
			params.nonce,
			debateWeightProofBytes,
			params.debateWeightPublicInputs
		);

		const receipt: TransactionReceipt = await tx.wait();

		recordRpcSuccess();

		console.debug('[DebateMarketClient] Trade revealed:', {
			txHash: receipt.hash,
			gasUsed: receipt.gasUsed.toString()
		});

		return { success: true, txHash: receipt.hash };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);

		if (isRpcError(msg)) {
			recordRpcFailure();
			console.warn('[DebateMarketClient] RPC error in revealTrade:', msg);
		}

		console.error('[DebateMarketClient] revealTrade failed:', {
			error: extractRevertReason(msg),
			debateId: params.debateId.slice(0, 12) + '...'
		});

		return { success: false, error: `Transaction failed: ${extractRevertReason(msg)}` };
	}
}

/**
 * Execute an epoch's LMSR price recalculation for a debate.
 * This is permissionless — anyone can call it to trigger settlement of
 * all revealed trades in the given epoch.
 *
 * No proof, signature, or token approval needed.
 */
export async function executeEpoch(debateId: string, epoch: number): Promise<TxResult> {
	const check = preflight();
	if ('error' in check) return { success: false, error: check.error };
	const { debateMarket } = check.instance;

	console.debug('[DebateMarketClient] Executing epoch:', {
		debateId: debateId.slice(0, 12) + '...',
		epoch
	});

	try {
		const tx = await debateMarket.executeEpoch(debateId, epoch);
		const receipt: TransactionReceipt = await tx.wait();

		recordRpcSuccess();

		console.debug('[DebateMarketClient] Epoch executed:', {
			txHash: receipt.hash,
			gasUsed: receipt.gasUsed.toString()
		});

		return { success: true, txHash: receipt.hash };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);

		if (isRpcError(msg)) {
			recordRpcFailure();
			console.warn('[DebateMarketClient] RPC error in executeEpoch:', msg);
		}

		console.error('[DebateMarketClient] executeEpoch failed:', {
			error: extractRevertReason(msg),
			debateId: debateId.slice(0, 12) + '...'
		});

		return { success: false, error: `Transaction failed: ${extractRevertReason(msg)}` };
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// VIEW / PURE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the current state of a debate (view function, no tx).
 */
export async function getDebateState(debateId: string): Promise<DebateStateResult> {
	const instance = getDebateMarketInstance();
	if (!instance) {
		return { success: false, error: 'Blockchain not configured' };
	}

	try {
		const [status, deadline, argumentCount, totalStake, uniqueParticipants] =
			await instance.debateMarket.getDebateState(debateId);

		return {
			success: true,
			status: Number(status),
			deadline: Number(deadline),
			argumentCount: Number(argumentCount),
			totalStake: BigInt(totalStake),
			uniqueParticipants: Number(uniqueParticipants)
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[DebateMarketClient] getDebateState failed:', {
			error: msg,
			debateId: debateId.slice(0, 12) + '...'
		});
		return { success: false, error: msg };
	}
}

/** Result of reading the on-chain resolution state for a debate. */
export interface ChainResolutionResult {
	success: boolean;
	winningArgumentIndex?: number;
	winningStance?: number;
	status?: number;
	resolutionMethod?: number;
	error?: string;
}

/**
 * Read the authoritative resolution state from the on-chain DebateMarket.
 *
 * Uses the debates() public getter which returns the full struct including
 * winningArgumentIndex and winningStance — set atomically by resolveDebate()
 * or resolveDebateWithAI() on-chain.
 *
 * Call this AFTER a resolution tx confirms to get the chain-authoritative winner.
 * The on-chain state is the single source of truth — it only contains arguments
 * that passed verifyThreeTreeProof() atomically.
 *
 * @param debateId - On-chain debate ID (bytes32 hex)
 * @returns Chain resolution state, or error if unavailable
 */
export async function readChainResolution(debateId: string): Promise<ChainResolutionResult> {
	const instance = getDebateMarketInstance();
	if (!instance) {
		return { success: false, error: 'Blockchain not configured' };
	}

	try {
		const [winningArgumentIndex, winningStance, status, resolutionMethod] =
			await instance.debateMarket.debates(debateId);

		return {
			success: true,
			winningArgumentIndex: Number(winningArgumentIndex),
			winningStance: Number(winningStance),
			status: Number(status),
			resolutionMethod: Number(resolutionMethod),
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[DebateMarketClient] readChainResolution failed:', {
			error: msg,
			debateId: debateId.slice(0, 12) + '...'
		});
		return { success: false, error: msg };
	}
}

/**
 * Derive a debate-scoped action domain from a base domain and proposition hash (pure function, no tx).
 */
export async function deriveDomain(baseDomain: string, propositionHash: string): Promise<string> {
	const instance = getDebateMarketInstance();
	if (!instance) {
		throw new Error('[DebateMarketClient] Blockchain not configured for deriveDomain');
	}

	return instance.debateMarket.deriveDomain(baseDomain, propositionHash);
}

// ═══════════════════════════════════════════════════════════════════════════
// AI RESOLUTION FUNCTIONS (Phase 3)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Submit AI evaluation with M-of-N EIP-712 signatures.
 * Called after the ai-evaluator service generates scores and collects attestations.
 */
export async function submitAIEvaluation(params: SubmitAIEvaluationParams): Promise<TxResult> {
	const check = preflight();
	if ('error' in check) return { success: false, error: check.error };
	const { debateMarket } = check.instance;

	console.debug('[DebateMarketClient] Submitting AI evaluation:', {
		debateId: params.debateId.slice(0, 12) + '...',
		argumentCount: params.packedScores.length,
		signatureCount: params.signatures.length
	});

	try {
		const tx = await debateMarket.submitAIEvaluation(
			params.debateId,
			params.packedScores,
			params.deadline,
			params.signatures
		);

		const receipt: TransactionReceipt = await tx.wait();

		recordRpcSuccess();

		console.debug('[DebateMarketClient] AI evaluation submitted:', {
			txHash: receipt.hash,
			gasUsed: receipt.gasUsed.toString()
		});

		return { success: true, txHash: receipt.hash };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);

		if (isRpcError(msg)) {
			recordRpcFailure();
			console.warn('[DebateMarketClient] RPC error in submitAIEvaluation:', msg);
		}

		console.error('[DebateMarketClient] submitAIEvaluation failed:', {
			error: extractRevertReason(msg),
			debateId: params.debateId.slice(0, 12) + '...'
		});

		return { success: false, error: `Transaction failed: ${extractRevertReason(msg)}` };
	}
}

/**
 * Resolve debate using AI scores + community signal (α-blending).
 * Must be called after submitAIEvaluation (status == RESOLVING).
 */
export async function resolveDebateWithAI(debateId: string): Promise<TxResult> {
	const check = preflight();
	if ('error' in check) return { success: false, error: check.error };
	const { debateMarket } = check.instance;

	console.debug('[DebateMarketClient] Resolving with AI:', {
		debateId: debateId.slice(0, 12) + '...'
	});

	try {
		const tx = await debateMarket.resolveDebateWithAI(debateId);
		const receipt: TransactionReceipt = await tx.wait();

		recordRpcSuccess();

		console.debug('[DebateMarketClient] Debate resolved with AI:', {
			txHash: receipt.hash,
			gasUsed: receipt.gasUsed.toString()
		});

		return { success: true, txHash: receipt.hash };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);

		if (isRpcError(msg)) {
			recordRpcFailure();
			console.warn('[DebateMarketClient] RPC error in resolveDebateWithAI:', msg);
		}

		console.error('[DebateMarketClient] resolveDebateWithAI failed:', {
			error: extractRevertReason(msg),
			debateId: debateId.slice(0, 12) + '...'
		});

		return { success: false, error: `Transaction failed: ${extractRevertReason(msg)}` };
	}
}

/**
 * Escalate to governance when AI consensus fails.
 * Transitions debate from ACTIVE (past deadline) to AWAITING_GOVERNANCE.
 */
export async function escalateToGovernance(debateId: string): Promise<TxResult> {
	const check = preflight();
	if ('error' in check) return { success: false, error: check.error };
	const { debateMarket } = check.instance;

	console.debug('[DebateMarketClient] Escalating to governance:', {
		debateId: debateId.slice(0, 12) + '...'
	});

	try {
		const tx = await debateMarket.escalateToGovernance(debateId);
		const receipt: TransactionReceipt = await tx.wait();

		recordRpcSuccess();

		console.debug('[DebateMarketClient] Escalated to governance:', {
			txHash: receipt.hash,
			gasUsed: receipt.gasUsed.toString()
		});

		return { success: true, txHash: receipt.hash };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);

		if (isRpcError(msg)) {
			recordRpcFailure();
			console.warn('[DebateMarketClient] RPC error in escalateToGovernance:', msg);
		}

		console.error('[DebateMarketClient] escalateToGovernance failed:', {
			error: extractRevertReason(msg),
			debateId: debateId.slice(0, 12) + '...'
		});

		return { success: false, error: `Transaction failed: ${extractRevertReason(msg)}` };
	}
}

/**
 * Submit a governance resolution for a debate in AWAITING_GOVERNANCE status.
 * Only callable by the governance multisig / operator.
 */
export async function submitGovernanceResolution(params: SubmitGovernanceResolutionParams): Promise<TxResult> {
	const check = preflight();
	if ('error' in check) return { success: false, error: check.error };
	const { debateMarket } = check.instance;

	console.debug('[DebateMarketClient] Submitting governance resolution:', {
		debateId: params.debateId.slice(0, 12) + '...',
		winningIndex: params.winningIndex,
		justification: params.justification.slice(0, 12) + '...'
	});

	try {
		const tx = await debateMarket.submitGovernanceResolution(
			params.debateId,
			params.winningIndex,
			params.justification
		);
		const receipt: TransactionReceipt = await tx.wait();

		recordRpcSuccess();

		console.debug('[DebateMarketClient] Governance resolution submitted:', {
			txHash: receipt.hash,
			gasUsed: receipt.gasUsed.toString()
		});

		return { success: true, txHash: receipt.hash };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);

		if (isRpcError(msg)) {
			recordRpcFailure();
			console.warn('[DebateMarketClient] RPC error in submitGovernanceResolution:', msg);
		}

		console.error('[DebateMarketClient] submitGovernanceResolution failed:', {
			error: extractRevertReason(msg),
			debateId: params.debateId.slice(0, 12) + '...'
		});

		return { success: false, error: `Transaction failed: ${extractRevertReason(msg)}` };
	}
}

/**
 * Appeal a governance resolution during the appeal window.
 * Transitions debate from RESOLVED to APPEALED status.
 */
export async function appealResolution(debateId: string): Promise<TxResult> {
	const check = preflight();
	if ('error' in check) return { success: false, error: check.error };
	const { debateMarket } = check.instance;

	console.debug('[DebateMarketClient] Appealing resolution:', {
		debateId: debateId.slice(0, 12) + '...'
	});

	try {
		const tx = await debateMarket.appealResolution(debateId);
		const receipt: TransactionReceipt = await tx.wait();

		recordRpcSuccess();

		console.debug('[DebateMarketClient] Resolution appealed:', {
			txHash: receipt.hash,
			gasUsed: receipt.gasUsed.toString()
		});

		return { success: true, txHash: receipt.hash };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);

		if (isRpcError(msg)) {
			recordRpcFailure();
			console.warn('[DebateMarketClient] RPC error in appealResolution:', msg);
		}

		console.error('[DebateMarketClient] appealResolution failed:', {
			error: extractRevertReason(msg),
			debateId: debateId.slice(0, 12) + '...'
		});

		return { success: false, error: `Transaction failed: ${extractRevertReason(msg)}` };
	}
}

/**
 * Finalize an appeal after the appeal period has elapsed.
 * Transitions debate from APPEALED to final RESOLVED status.
 */
export async function finalizeAppeal(debateId: string): Promise<TxResult> {
	const check = preflight();
	if ('error' in check) return { success: false, error: check.error };
	const { debateMarket } = check.instance;

	console.debug('[DebateMarketClient] Finalizing appeal:', {
		debateId: debateId.slice(0, 12) + '...'
	});

	try {
		const tx = await debateMarket.finalizeAppeal(debateId);
		const receipt: TransactionReceipt = await tx.wait();

		recordRpcSuccess();

		console.debug('[DebateMarketClient] Appeal finalized:', {
			txHash: receipt.hash,
			gasUsed: receipt.gasUsed.toString()
		});

		return { success: true, txHash: receipt.hash };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);

		if (isRpcError(msg)) {
			recordRpcFailure();
			console.warn('[DebateMarketClient] RPC error in finalizeAppeal:', msg);
		}

		console.error('[DebateMarketClient] finalizeAppeal failed:', {
			error: extractRevertReason(msg),
			debateId: debateId.slice(0, 12) + '...'
		});

		return { success: false, error: `Transaction failed: ${extractRevertReason(msg)}` };
	}
}

/**
 * Get the AI evaluation nonce for a debate (view function).
 * Used by the ai-evaluator service to construct the EIP-712 typed data.
 */
export async function getAIEvalNonce(debateId: string): Promise<AIEvalNonceResult> {
	const instance = getDebateMarketInstance();
	if (!instance) {
		return { success: false, error: 'Blockchain not configured' };
	}

	try {
		const nonce = await instance.debateMarket.aiEvalNonce(debateId);
		return { success: true, nonce: BigInt(nonce) };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[DebateMarketClient] getAIEvalNonce failed:', { error: msg });
		return { success: false, error: msg };
	}
}

/**
 * Get packed AI scores for a specific argument (view function).
 * Returns the raw uint256 packed score from the contract.
 */
export async function getAIArgumentScore(debateId: string, argumentIndex: number): Promise<AIScoreResult> {
	const instance = getDebateMarketInstance();
	if (!instance) {
		return { success: false, error: 'Blockchain not configured' };
	}

	try {
		const packed = await instance.debateMarket.aiArgumentScores(debateId, argumentIndex);
		return { success: true, packedScore: BigInt(packed) };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[DebateMarketClient] getAIArgumentScore failed:', { error: msg });
		return { success: false, error: msg };
	}
}
