/**
 * DistrictGate Client - On-chain ZK proof verification via Scroll
 *
 * Submits three-tree ZK proofs to the DistrictGate contract on Scroll for
 * verification. Acts as a server-side relayer: signs EIP-712 messages
 * with the relayer wallet and submits transactions on behalf of users.
 *
 * ARCHITECTURE:
 * - Server-side only (imports $env/dynamic/private for relayer key)
 * - User's identity is bound to the ZK proof, not the EIP-712 signer
 * - The relayer pays gas; the user never needs a funded wallet
 * - EIP-712 prevents front-running (proof bound to signer + deadline)
 *
 * DEPLOYED CONTRACT:
 * - Address: 0x0085DFAd6DB867e7486A460579d768BD7C37181e (Scroll Sepolia v4, bb.js keccak)
 * - Function: verifyThreeTreeProof(signer, proof, publicInputs[31], depth, deadline, sig)
 * - 31 public inputs: [0]=userRoot, [1]=cellMapRoot, [2-25]=districts, [26]=nullifier,
 *   [27]=actionDomain, [28]=authorityLevel, [29]=engagementRoot, [30]=engagementTier
 * - Features: actionDomain timelock whitelist (SA-001), root lifecycle checks (SA-004)
 *
 * @see COORDINATION-INTEGRITY-SPEC.md
 * @see DistrictGate.sol § verifyThreeTreeProof
 */

import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
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

// ═══════════════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER
// ═══════════════════════════════════════════════════════════════════════════

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_WINDOW_MS = 60_000;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

type CBState = 'closed' | 'open' | 'half_open';

interface CircuitBreakerState {
	state: CBState;
	failures: number[];
	openedAt: number | null;
	halfOpenAttemptInProgress: boolean;
}

const circuitBreaker: CircuitBreakerState = {
	state: 'closed',
	failures: [],
	openedAt: null,
	halfOpenAttemptInProgress: false
};

/** Read-only state check — does NOT transition state or consume half-open slot */
export function getCircuitBreakerState(): CBState {
	const now = Date.now();
	if (circuitBreaker.state === 'open' && circuitBreaker.openedAt &&
		now - circuitBreaker.openedAt >= CIRCUIT_BREAKER_COOLDOWN_MS) {
		return 'half_open';
	}
	return circuitBreaker.state;
}

/** Exported for retry queue to check before processing. Transitions state. */
export function isCircuitOpen(): boolean {
	const now = Date.now();

	if (circuitBreaker.state === 'open') {
		if (circuitBreaker.openedAt && now - circuitBreaker.openedAt >= CIRCUIT_BREAKER_COOLDOWN_MS) {
			// Transition to half-open
			circuitBreaker.state = 'half_open';
			circuitBreaker.halfOpenAttemptInProgress = false;
		} else {
			return true;
		}
	}

	// Only allow ONE request through in half-open state
	if (circuitBreaker.state === 'half_open') {
		if (circuitBreaker.halfOpenAttemptInProgress) {
			return true; // Block concurrent requests during half-open test
		}
		circuitBreaker.halfOpenAttemptInProgress = true;
		return false; // Allow single test request
	}

	return false;
}

export function recordRpcFailure(): void {
	const now = Date.now();

	// If half-open test fails, revert to open
	if (circuitBreaker.state === 'half_open') {
		circuitBreaker.state = 'open';
		circuitBreaker.openedAt = now;
		circuitBreaker.halfOpenAttemptInProgress = false;
		console.warn('[DistrictGateClient] Half-open test FAILED, circuit breaker re-opened');
		return;
	}

	circuitBreaker.failures = circuitBreaker.failures.filter(
		(t) => now - t < CIRCUIT_BREAKER_WINDOW_MS
	);
	circuitBreaker.failures.push(now);

	if (circuitBreaker.failures.length >= CIRCUIT_BREAKER_THRESHOLD && circuitBreaker.state === 'closed') {
		circuitBreaker.state = 'open';
		circuitBreaker.openedAt = now;
		console.warn(
			`[DistrictGateClient] Circuit breaker OPEN after ${CIRCUIT_BREAKER_THRESHOLD} failures. Cooldown: ${CIRCUIT_BREAKER_COOLDOWN_MS / 1000}s`
		);
	}
}

export function recordRpcSuccess(): void {
	circuitBreaker.state = 'closed';
	circuitBreaker.failures = [];
	circuitBreaker.halfOpenAttemptInProgress = false;
	circuitBreaker.openedAt = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// BALANCE MONITORING
// ═══════════════════════════════════════════════════════════════════════════

const BALANCE_WARNING_THRESHOLD = 50000000000000000n; // 0.05 ETH
const BALANCE_CRITICAL_THRESHOLD = 10000000000000000n; // 0.01 ETH
const BALANCE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface BalanceCache {
	balance: bigint;
	cachedAt: number;
}

let _balanceCache: BalanceCache | null = null;

async function getRelayerBalance(wallet: Wallet): Promise<bigint> {
	const now = Date.now();
	if (_balanceCache && now - _balanceCache.cachedAt < BALANCE_CACHE_TTL_MS) {
		return _balanceCache.balance;
	}

	const balance = await wallet.provider!.getBalance(wallet.address);
	_balanceCache = { balance, cachedAt: now };

	if (balance < BALANCE_WARNING_THRESHOLD) {
		console.warn(
			`[DistrictGateClient] Relayer balance LOW: ${balance} wei (${Number(balance) / 1e18} ETH)`
		);
	}

	return balance;
}

/** Relayer health info for admin monitoring */
export interface RelayerHealth {
	configured: boolean;
	/** Truncated address: 0xAbCd...1234 (no full address exposure) */
	address: string | null;
	/** Balance status category instead of exact value */
	balanceStatus: 'healthy' | 'low' | 'critical' | 'unknown';
	circuitBreakerState: CBState;
	recentFailures: number;
}

export async function getRelayerHealth(): Promise<RelayerHealth> {
	const instance = getContractInstance();
	if (!instance) {
		return {
			configured: false,
			address: null,
			balanceStatus: 'unknown',
			circuitBreakerState: getCircuitBreakerState(),
			recentFailures: circuitBreaker.failures.length
		};
	}

	// Sanitize admin response — no exact balance or full address
	const addr = instance.wallet.address;
	const truncatedAddr = `${addr.slice(0, 6)}...${addr.slice(-4)}`;

	let balanceStatus: 'healthy' | 'low' | 'critical' | 'unknown' = 'unknown';
	try {
		const balance = await getRelayerBalance(instance.wallet);
		if (balance < BALANCE_CRITICAL_THRESHOLD) {
			balanceStatus = 'critical';
		} else if (balance < BALANCE_WARNING_THRESHOLD) {
			balanceStatus = 'low';
		} else {
			balanceStatus = 'healthy';
		}
	} catch {
		balanceStatus = 'unknown';
	}

	return {
		configured: true,
		address: truncatedAddr,
		balanceStatus,
		circuitBreakerState: getCircuitBreakerState(),
		recentFailures: circuitBreaker.failures.length
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Minimal ABI — only the functions we call */
const DISTRICT_GATE_ABI = [
	// State-changing
	'function verifyThreeTreeProof(address signer, bytes proof, uint256[31] publicInputs, uint8 verifierDepth, uint256 deadline, bytes signature)',
	// View functions
	'function isNullifierUsed(bytes32 actionId, bytes32 nullifier) view returns (bool)',
	'function allowedActionDomains(bytes32) view returns (bool)',
	'function nonces(address) view returns (uint256)',
	// Events
	'event ThreeTreeProofVerified(address indexed signer, bytes32 indexed nullifier, bytes32 indexed actionDomain, uint8 verifierDepth)'
];

/** Number of public inputs expected by the three-tree circuit */
export const THREE_TREE_PUBLIC_INPUT_COUNT = 31;

/** Valid circuit depths for three-tree verifier */
const VALID_VERIFIER_DEPTHS = [18, 20, 22, 24] as const;

/** Indices into the 31-element public inputs array */
export const PUBLIC_INPUT_INDEX = {
	USER_ROOT: 0,
	CELL_MAP_ROOT: 1,
	NULLIFIER: 26,
	ACTION_DOMAIN: 27,
	AUTHORITY_LEVEL: 28,
	ENGAGEMENT_ROOT: 29,
	ENGAGEMENT_TIER: 30
} as const;

/** EIP-712 type definition for SubmitThreeTreeProof */
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

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface BlockchainConfig {
	rpcUrl: string;
	contractAddress: string;
	privateKey?: string;
}

/**
 * Parameters for three-tree proof verification.
 * Matches DistrictGate.verifyThreeTreeProof contract interface.
 */
export interface VerifyParams {
	/** Hex-encoded proof bytes from Noir/UltraHonk circuit */
	proof: string;

	/** 31 field elements as hex strings (circuit public outputs) */
	publicInputs: string[];

	/** Circuit depth used for proof generation (18 | 20 | 22 | 24) */
	verifierDepth: number;

	/** EIP-712 signature deadline (unix timestamp). Defaults to +1 hour. */
	deadline?: number;
}

/**
 * Classification of a verify attempt's outcome. Callers (anchor endpoint,
 * divergence classifier) key off `kind` rather than parsing `error` strings.
 *
 * - success               : contract verified the proof; txHash set
 * - contract_invalid_proof: verifier rejected the proof — TEE/chain disagreement
 *                           (P0 divergent alert material)
 * - contract_other_revert : contract reverted for another reason (nullifier reuse,
 *                           action domain not whitelisted, etc.) — NOT divergence
 * - rpc_transient         : network, timeout, gas, nonce — retry
 * - relayer_config        : missing env vars, no wallet, circuit-breaker open —
 *                           operational issue, not an integrity event
 */
export type VerifyResultKind =
	| 'success'
	| 'contract_invalid_proof'
	| 'contract_other_revert'
	| 'rpc_transient'
	| 'relayer_config';

export interface VerifyResult {
	success: boolean;
	kind: VerifyResultKind;
	txHash?: string;
	error?: string;
}

/**
 * Contract-level revert signals that indicate the verifier mathematically
 * rejected the proof. Sourced from UltraVerifier (bb.js-generated Solidity
 * verifier) and DistrictGate custom errors. Everything else that reverts
 * (nullifier used, action domain not allowed, depth mismatch) is NOT a
 * divergence — it's a semantic rejection of a valid proof.
 */
const CONTRACT_INVALID_PROOF_SIGNALS = [
	'invalid proof',
	'invalidproof',
	'proof verification failed',
	'proofverificationfailed',
	'pairing check',
	'pairingcheckfailed',
	'ecpairing',
	'sumcheck',
	'public input'
];

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON PROVIDER + CONTRACT
// ═══════════════════════════════════════════════════════════════════════════

let _provider: JsonRpcProvider | null = null;
let _contract: Contract | null = null;
let _wallet: Wallet | null = null;
let _nonceManager: NonceManager | null = null;

export function getConfig(): BlockchainConfig {
	return {
		rpcUrl: env.SCROLL_RPC_URL || publicEnv.PUBLIC_SCROLL_RPC_URL || 'https://sepolia-rpc.scroll.io',
		contractAddress: env.DISTRICT_GATE_ADDRESS || '',
		privateKey: env.SCROLL_PRIVATE_KEY
	};
}

/**
 * Get or create the ethers provider, wallet, and contract instances.
 * Uses NonceManager for automatic nonce tracking (prevents nonce collisions).
 * Returns null if configuration is incomplete.
 */
function getContractInstance(): { contract: Contract; wallet: Wallet } | null {
	const config = getConfig();

	if (!config.contractAddress || !config.rpcUrl || !config.privateKey) {
		return null;
	}

	if (_contract && _wallet) {
		return { contract: _contract, wallet: _wallet };
	}

	_provider = new JsonRpcProvider(config.rpcUrl);
	_wallet = new Wallet(config.privateKey, _provider);
	_nonceManager = new NonceManager(_wallet);
	_contract = new Contract(config.contractAddress, DISTRICT_GATE_ABI, _nonceManager);

	return { contract: _contract, wallet: _wallet };
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify a three-tree ZK proof on-chain via DistrictGate.
 *
 * Signs an EIP-712 message with the server relayer wallet and submits
 * the transaction to Scroll. The ZK proof itself contains the user's
 * district membership claim — the EIP-712 signer is just the relayer.
 *
 * @param params - Proof verification parameters
 * @returns Result with transaction hash on success, error message on failure
 */
export async function verifyOnChain(params: VerifyParams): Promise<VerifyResult> {
	// ───────────────────────────────────────────────────────────────────────
	// PHASE 0: Circuit breaker check
	// ───────────────────────────────────────────────────────────────────────

	if (isCircuitOpen()) {
		return {
			success: false,
			kind: 'rpc_transient',
			error: 'Circuit breaker OPEN: RPC failures exceeded threshold. Retry after cooldown.'
		};
	}

	// ───────────────────────────────────────────────────────────────────────
	// PHASE 1: Validate inputs
	// ───────────────────────────────────────────────────────────────────────

	if (params.publicInputs.length !== THREE_TREE_PUBLIC_INPUT_COUNT) {
		return {
			success: false,
			kind: 'relayer_config',
			error: `Expected ${THREE_TREE_PUBLIC_INPUT_COUNT} public inputs, got ${params.publicInputs.length}`
		};
	}

	// Validate proof is non-empty valid hex
	const proofRaw = params.proof.startsWith('0x') ? params.proof.slice(2) : params.proof;
	if (!proofRaw || proofRaw.length === 0) {
		return { success: false, kind: 'relayer_config', error: 'Proof is empty' };
	}
	if (!/^[0-9a-fA-F]+$/.test(proofRaw)) {
		return { success: false, kind: 'relayer_config', error: 'Proof contains invalid hex characters' };
	}

	// Validate verifier depth is one of the supported circuit sizes
	if (!(VALID_VERIFIER_DEPTHS as readonly number[]).includes(params.verifierDepth)) {
		return {
			success: false,
			kind: 'relayer_config',
			error: `Invalid verifierDepth ${params.verifierDepth}. Must be one of: ${VALID_VERIFIER_DEPTHS.join(', ')}`
		};
	}

	// Validate each public input is a valid field element within BN254 modulus
	for (let i = 0; i < params.publicInputs.length; i++) {
		const input = params.publicInputs[i];
		try {
			const val = BigInt(input);
			if (val < 0n || val >= BN254_MODULUS) {
				return {
					success: false,
					error: `Public input [${i}] out of BN254 field range`
				};
			}
		} catch {
			return {
				success: false,
				error: `Public input [${i}] is not a valid integer or hex string`
			};
		}
	}

	const instance = getContractInstance();
	if (!instance) {
		const config = getConfig();
		const missing = [];
		if (!config.contractAddress) missing.push('DISTRICT_GATE_ADDRESS');
		if (!config.rpcUrl) missing.push('SCROLL_RPC_URL');
		if (!config.privateKey) missing.push('SCROLL_PRIVATE_KEY');

		console.warn(
			`[DistrictGateClient] Blockchain not configured (missing: ${missing.join(', ')}). Skipping on-chain verification.`
		);
		return {
			success: false,
			error: `Blockchain not configured (set ${missing.join(', ')} env vars)`
		};
	}

	// ───────────────────────────────────────────────────────────────────────
	// PHASE 1.5: Balance check
	// ───────────────────────────────────────────────────────────────────────

	try {
		const balance = await getRelayerBalance(instance.wallet);
		if (balance < BALANCE_CRITICAL_THRESHOLD) {
			return {
				success: false,
				error: `Relayer balance critically low (${Number(balance) / 1e18} ETH). Cannot submit transaction.`
			};
		}
	} catch (balanceErr) {
		// Fail closed on balance check errors
		console.error('[DistrictGateClient] Balance check failed:', balanceErr);
		recordRpcFailure();
		return {
			success: false,
			error: 'Unable to verify relayer balance. Transaction not submitted.'
		};
	}

	const { contract, wallet } = instance;

	// ───────────────────────────────────────────────────────────────────────
	// PHASE 2: Build EIP-712 signature
	// ───────────────────────────────────────────────────────────────────────

	const deadline = params.deadline ?? Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECONDS;
	const proofBytes = params.proof.startsWith('0x') ? params.proof : '0x' + params.proof;
	const proofHash = keccak256(proofBytes);

	// Pack public inputs as uint256 array for hashing
	const publicInputsAsBigInt = params.publicInputs.map((v) => BigInt(v));
	const publicInputsPacked = solidityPacked(
		Array(THREE_TREE_PUBLIC_INPUT_COUNT).fill('uint256'),
		publicInputsAsBigInt
	);
	const publicInputsHash = keccak256(publicInputsPacked);

	// Get current nonce for the relayer signer
	const nonce = await contract.nonces(wallet.address);

	const domain = {
		name: 'DistrictGate',
		version: '1',
		chainId: (await wallet.provider!.getNetwork()).chainId,
		verifyingContract: await contract.getAddress()
	};

	const value = {
		proofHash,
		publicInputsHash,
		verifierDepth: params.verifierDepth,
		nonce,
		deadline
	};

	let signature: string;
	try {
		signature = await wallet.signTypedData(domain, EIP712_TYPES, value);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[DistrictGateClient] EIP-712 signing failed:', msg);
		return { success: false, kind: 'relayer_config', error: `EIP-712 signing failed: ${msg}` };
	}

	// ───────────────────────────────────────────────────────────────────────
	// PHASE 3: Submit transaction
	// ───────────────────────────────────────────────────────────────────────

	const nullifier = params.publicInputs[PUBLIC_INPUT_INDEX.NULLIFIER];
	const actionDomain = params.publicInputs[PUBLIC_INPUT_INDEX.ACTION_DOMAIN];

	console.debug('[DistrictGateClient] Submitting verifyThreeTreeProof:', {
		signer: wallet.address,
		verifierDepth: params.verifierDepth,
		deadline,
		nullifier: nullifier.slice(0, 12) + '...',
		actionDomain: actionDomain.slice(0, 12) + '...',
		publicInputsCount: params.publicInputs.length,
		proofLength: proofBytes.length
	});

	try {
		const tx = await contract.verifyThreeTreeProof(
			wallet.address,
			proofBytes,
			publicInputsAsBigInt,
			params.verifierDepth,
			deadline,
			signature
		);

		const receipt: TransactionReceipt = await tx.wait();

		// Record success for circuit breaker
		recordRpcSuccess();

		console.debug('[DistrictGateClient] Verification confirmed:', {
			txHash: receipt.hash,
			blockNumber: receipt.blockNumber,
			gasUsed: receipt.gasUsed.toString()
		});

		return { success: true, kind: 'success', txHash: receipt.hash };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);

		// Record failure for circuit breaker
		// Count RPC/network/infra failures, not contract reverts (which are valid responses)
		const msgLower = msg.toLowerCase();
		const rpcErrorPatterns = [
			'network', 'timeout', 'econnrefused', 'etimedout', 'enotfound',
			'econnreset', 'could not detect network', 'socket hang up',
			'429', 'too many requests', '503', 'service unavailable',
			'502', 'bad gateway', '504', 'gateway timeout',
			'insufficient funds for gas', 'nonce too low'
		];
		const isRpcError = rpcErrorPatterns.some((p) => msgLower.includes(p));
		if (isRpcError) {
			recordRpcFailure();
		}

		// Extract revert reason if available
		const revertMatch = msg.match(/reason="([^"]+)"/);
		const revertReason = revertMatch ? revertMatch[1] : msg;

		console.error('[DistrictGateClient] Transaction failed:', {
			error: revertReason,
			nullifier: nullifier.slice(0, 12) + '...',
			isRpcError
		});

		// Classify the outcome for callers. RPC errors are transient; contract
		// reverts matching verifier-invalid-proof signals are P0 divergence;
		// everything else is a non-divergent contract rejection (nullifier used,
		// action domain not allowed, etc.).
		let kind: VerifyResultKind;
		if (isRpcError) {
			kind = 'rpc_transient';
		} else {
			const reasonLower = revertReason.toLowerCase();
			const isInvalidProof = CONTRACT_INVALID_PROOF_SIGNALS.some((s) => reasonLower.includes(s));
			kind = isInvalidProof ? 'contract_invalid_proof' : 'contract_other_revert';
		}

		return { success: false, kind, error: `Transaction failed: ${revertReason}` };
	}
}

/**
 * Check if a nullifier has been used on-chain.
 *
 * STATUS: Not currently wired into the submission path. Nullifier deduplication
 * in the live flow is enforced atomically by Convex (`insertSubmission` uses
 * `by_nullifier` index + transactional guard). The on-chain nullifier record is
 * populated as a side effect of `anchorProofOnChain` after delivery succeeds.
 *
 * This helper is retained as a defense-in-depth primitive: a future revision
 * may add pre-submit chain dedup so a duplicate is rejected without reaching
 * the Convex write. If you remove this, also drop the corresponding tests.
 *
 * FAIL-OPEN: returns `false` when the contract is unconfigured or a read fails.
 * Only safe because the function is NOT in the enforcement path today; if you
 * wire it into submit, add a fail-closed variant or guard the caller.
 *
 * @param actionDomain - Action domain (bytes32 hex)
 * @param nullifier - Nullifier to check (bytes32 hex)
 * @returns true if already used, false if available (or chain unreachable)
 */
export async function isNullifierUsed(actionDomain: string, nullifier: string): Promise<boolean> {
	const instance = getContractInstance();
	if (!instance) {
		console.warn('[DistrictGateClient] Cannot check nullifier: blockchain not configured');
		return false;
	}

	try {
		return await instance.contract.isNullifierUsed(actionDomain, nullifier);
	} catch (err) {
		console.error(
			'[DistrictGateClient] Nullifier check failed:',
			err instanceof Error ? err.message : err
		);
		return false;
	}
}

/**
 * Check if an action domain is whitelisted on-chain.
 *
 * STATUS: Not currently wired into submit. Domain binding is enforced at two
 * earlier points: (1) server recomputes the canonical action domain in
 * `/api/submissions/create` and compares to the client claim, (2) the on-chain
 * verifier contract rejects non-whitelisted domains when the anchor fires
 * post-delivery. This helper is retained as defense-in-depth.
 *
 * FAIL-OPEN: same caveat as `isNullifierUsed` above.
 *
 * @param actionDomain - Action domain hash (bytes32 hex)
 * @returns true if whitelisted, false otherwise
 */
export async function isActionDomainAllowed(actionDomain: string): Promise<boolean> {
	const instance = getContractInstance();
	if (!instance) {
		console.warn(
			'[DistrictGateClient] Cannot check action domain: blockchain not configured'
		);
		return false;
	}

	try {
		return await instance.contract.allowedActionDomains(actionDomain);
	} catch (err) {
		console.error(
			'[DistrictGateClient] Action domain check failed:',
			err instanceof Error ? err.message : err
		);
		return false;
	}
}
