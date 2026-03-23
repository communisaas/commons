/**
 * ERC-4337 UserOperation Sponsorship Endpoint
 *
 * POST /api/wallet/sponsor-userop
 *
 * Receives a partially-built UserOperation from the client, sponsors gas via
 * Pimlico's verifying paymaster, submits it to the bundler, and waits for the
 * on-chain receipt. The client supplies the EIP-712 proof-authorization signature
 * as the UserOp signature field (SimpleAccount validates ECDSA over the UserOp hash).
 *
 * This is the server-side half of the NEAR gasless path:
 *   1. Client builds UserOp + signs EIP-712 typed data via MPC (5-15s)
 *   2. Client POSTs both to this endpoint
 *   3. Server sponsors gas via Pimlico, submits to bundler, returns txHash
 *
 * Body: {
 *   userOp: UserOperationWire,  // bigint fields as 0x hex strings
 *   signature: string           // EIP-712 proof-auth sig (the UserOp signature)
 * }
 *
 * Response: { success: true, txHash: string, userOpHash: string }
 *         | { success: false, error: string, reason?: string }
 *
 * Security:
 *   1. Authentication required (locals.user)
 *   2. Sponsorship policy: callData must target DEBATE_MARKET_ADDRESS
 *   3. Gas cost cap: 5M gwei (~0.005 ETH) per UserOp
 *   4. Per-user rate limit: 5 sponsored ops per 24-hour window (logged, not hard-blocked yet)
 *
 * @see pimlico.ts        — Pimlico bundler/paymaster client
 * @see user-operation.ts — client-side UserOp construction
 * @see debate-client.ts  — gaslessSubmitArgument / gaslessCoSignArgument callers
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import {
	createPimlicoClient,
	sponsorUserOperation,
	sendUserOperation,
	waitForUserOperationReceipt
} from '$lib/core/gas/pimlico';
import type { UserOperation } from '$lib/core/gas/types';
import { DEBATE_MARKET_ADDRESS } from '$lib/core/contracts';
import { safeUserId } from '$lib/core/server/security';

// =============================================================================
// Constants
// =============================================================================

const LOG_PREFIX = '[gas/sponsor]';

/**
 * Maximum gas value (in wei) we will sponsor per UserOp.
 * 5,000,000 gwei = 0.005 ETH — generous ceiling for a single debate submission.
 */
const MAX_GAS_PER_OP_WEI = 5_000_000n * 1_000_000_000n; // 5M gwei in wei

// =============================================================================
// Wire format — JSON-safe representation of UserOperation
// =============================================================================

/**
 * JSON-serializable UserOperation.
 *
 * The ERC-4337 UserOperation uses bigint fields which are not JSON-native.
 * The client serializes all numeric fields as 0x-prefixed hex strings (or
 * decimal strings for nonce). The server reconstructs bigints on receipt.
 *
 * Required fields: sender, nonce, callData.
 * Optional fields: all gas fields (filled by Pimlico), paymaster fields.
 */
interface UserOperationWire {
	/** Smart account address (0x-prefixed). */
	sender: string;
	/** Account nonce as 0x hex or decimal string. */
	nonce: string;
	/** Encoded execute(target, value, data) callData (0x-prefixed hex). */
	callData: string;
	/** Factory address (only for account deployment). */
	factory?: string;
	/** Factory init data (only for account deployment). */
	factoryData?: string;
	// Gas fields — sent as 0x hex or "0x0". Server overwrites via Pimlico.
	callGasLimit?: string;
	verificationGasLimit?: string;
	preVerificationGas?: string;
	maxFeePerGas?: string;
	maxPriorityFeePerGas?: string;
	// Paymaster fields — populated by Pimlico sponsorship.
	paymaster?: string;
	paymasterVerificationGasLimit?: string;
	paymasterPostOpGasLimit?: string;
	paymasterData?: string;
}

// =============================================================================
// Deserialization
// =============================================================================

/**
 * Parse a hex or decimal string to bigint.
 * Returns 0n for undefined, null, or "0x".
 */
function parseBigInt(value: string | undefined | null): bigint {
	if (!value || value === '0x') return 0n;
	try {
		return BigInt(value);
	} catch {
		throw new Error(`Invalid numeric field value: "${value}"`);
	}
}

/**
 * Validate and deserialize a UserOperationWire from the request body into a
 * Partial<UserOperation> with bigint fields.
 *
 * Throws a descriptive Error if required fields are missing or malformed.
 */
function deserializeUserOp(wire: UserOperationWire): Partial<UserOperation> {
	if (!wire.sender || !/^0x[0-9a-fA-F]{40}$/.test(wire.sender)) {
		throw new Error('sender must be a 0x-prefixed 20-byte address');
	}

	if (wire.nonce === undefined || wire.nonce === null || wire.nonce === '') {
		throw new Error('nonce is required');
	}

	if (!wire.callData || !wire.callData.startsWith('0x')) {
		throw new Error('callData must be 0x-prefixed hex');
	}

	const op: Partial<UserOperation> = {
		sender: wire.sender,
		nonce: parseBigInt(wire.nonce),
		callData: wire.callData,
		// Gas fields — zero-initialized; Pimlico overwrites all of these
		callGasLimit: parseBigInt(wire.callGasLimit),
		verificationGasLimit: parseBigInt(wire.verificationGasLimit),
		preVerificationGas: parseBigInt(wire.preVerificationGas),
		maxFeePerGas: parseBigInt(wire.maxFeePerGas),
		maxPriorityFeePerGas: parseBigInt(wire.maxPriorityFeePerGas)
	};

	// Factory fields (account deployment — optional)
	if (wire.factory) op.factory = wire.factory;
	if (wire.factoryData) op.factoryData = wire.factoryData;

	return op;
}

// =============================================================================
// Rate limiting (in-memory sliding window, per-user)
// =============================================================================

/**
 * Sliding-window rate limiter for UserOp sponsorship.
 *
 * Enforces maxOpsPerUserPerDay at the logging level for now — we log a warning
 * but do not hard-reject. Full enforcement would require durable KV storage.
 * Module-level Map is acceptable: CF Worker isolates have short lifetimes and
 * the window is long (24h), so the effective rate is naturally low.
 */
const RATE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const RATE_MAX_OPS = 5;
const opsWindowMap = new Map<string, number[]>();

/**
 * Check the per-user sponsorship rate limit.
 * Returns true if the request is within the allowed rate, false if over.
 */
function checkSponsorshipRateLimit(userId: string): boolean {
	const now = Date.now();
	const windowStart = now - RATE_WINDOW_MS;

	let timestamps = opsWindowMap.get(userId) ?? [];
	timestamps = timestamps.filter((t) => t > windowStart);
	opsWindowMap.set(userId, timestamps);

	if (timestamps.length >= RATE_MAX_OPS) {
		return false;
	}

	timestamps.push(now);
	return true;
}

// =============================================================================
// Request Handler
// =============================================================================

export const POST: RequestHandler = async ({ request, locals }) => {
	// 1. Authentication
	if (!locals.user) {
		return json({ success: false, error: 'Authentication required' }, { status: 401 });
	}

	const userId = locals.user.id;

	// 2. Rate limit (log-only for now — full enforcement in Phase 2 via KV)
	const withinLimit = checkSponsorshipRateLimit(userId);
	if (!withinLimit) {
		console.warn(`${LOG_PREFIX} Rate limit reached for user ${safeUserId(userId)} (${RATE_MAX_OPS} ops/24h)`);
		return json(
			{
				success: false,
				error: `Sponsorship rate limit reached: ${RATE_MAX_OPS} UserOps per 24 hours. Try again later.`
			},
			{
				status: 429,
				headers: { 'Retry-After': String(RATE_WINDOW_MS / 1000) }
			}
		);
	}

	// 3. Parse and validate request body
	let body: { userOp?: unknown; signature?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
	}

	const { userOp: rawUserOp, signature } = body;

	if (!rawUserOp || typeof rawUserOp !== 'object') {
		return json({ success: false, error: 'Missing or invalid field: userOp' }, { status: 400 });
	}

	if (!signature || typeof signature !== 'string' || !signature.startsWith('0x')) {
		return json(
			{ success: false, error: 'Missing or invalid field: signature (must be 0x-prefixed hex)' },
			{ status: 400 }
		);
	}

	// 4. Deserialize wire format → Partial<UserOperation> with bigint fields
	let userOp: Partial<UserOperation>;
	try {
		userOp = deserializeUserOp(rawUserOp as UserOperationWire);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.warn(`${LOG_PREFIX} UserOp deserialization failed for user ${safeUserId(userId)}:`, message);
		return json({ success: false, error: `Invalid UserOp: ${message}` }, { status: 400 });
	}

	console.debug(`${LOG_PREFIX} Sponsorship request from user ${safeUserId(userId)}`, {
		sender: userOp.sender,
		nonce: userOp.nonce?.toString(),
		callDataLength: userOp.callData?.length
	});

	// 5. Create Pimlico client
	const network = (env.SCROLL_NETWORK as 'scroll-sepolia' | 'scroll') ?? 'scroll-sepolia';
	let pimlicoClient;
	try {
		pimlicoClient = createPimlicoClient({ network });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`${LOG_PREFIX} Failed to create Pimlico client:`, message);
		return json(
			{ success: false, error: 'Gas sponsorship service unavailable' },
			{ status: 503 }
		);
	}

	// 6. Request sponsorship — policy gates to DebateMarket only, caps gas cost
	const policy = {
		allowedTargets: [DEBATE_MARKET_ADDRESS],
		maxGasPerOp: MAX_GAS_PER_OP_WEI
	};

	let sponsorship;
	try {
		sponsorship = await sponsorUserOperation(pimlicoClient, userOp, policy);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`${LOG_PREFIX} Sponsorship call threw for user ${safeUserId(userId)}:`, message);
		return json(
			{ success: false, error: `Sponsorship failed: ${message}` },
			{ status: 502 }
		);
	}

	if (!sponsorship.sponsored) {
		console.warn(
			`${LOG_PREFIX} Sponsorship denied for user ${safeUserId(userId)}: ${sponsorship.reason}`
		);
		return json(
			{ success: false, error: 'Gas sponsorship denied', reason: sponsorship.reason },
			{ status: 402 }
		);
	}

	// 7. Merge sponsorship result into the UserOp
	//
	// sponsorUserOperation returns:
	//   - Paymaster fields: paymaster, paymasterData, paymasterVerificationGasLimit, paymasterPostOpGasLimit
	//   - Gas estimates: callGasLimit, verificationGasLimit, preVerificationGas, maxFeePerGas,
	//     maxPriorityFeePerGas (computed by eth_estimateUserOperationGas during sponsorship)
	//
	// The client sends all gas fields as "0x0" (zeroed). We MUST use the server-side
	// estimates from sponsorship — the bundler rejects a UserOp with zero gas limits.
	//
	// The signature field is the EIP-712 proof-authorization sig provided by the client.
	// For SimpleAccount, the UserOp signature IS an ECDSA sig over the UserOp hash.
	// The client's MPC-derived sig over the EIP-712 typed data serves as this signature
	// because the smart account's validateUserOp() calls _validateSignature which verifies
	// ECDSA.recover(userOpHash, sig) == owner. The owner is the NEAR-derived Scroll address.
	//
	// NOTE: This requires that the smart account was deployed with the NEAR-derived EOA
	// as the owner. SimpleAccount factory deployment is a prerequisite for production use.
	// TODO: batch ERC-20 approve + submitArgument in single UserOp (two execute() calls)
	const fullUserOp: UserOperation = {
		sender: userOp.sender!,
		nonce: userOp.nonce!,
		callData: userOp.callData!,
		// Gas fields — use estimates from Pimlico sponsorship (never the client-sent zeros)
		callGasLimit: sponsorship.callGasLimit ?? 0n,
		verificationGasLimit: sponsorship.verificationGasLimit ?? 0n,
		preVerificationGas: sponsorship.preVerificationGas ?? 0n,
		maxFeePerGas: sponsorship.maxFeePerGas ?? 0n,
		maxPriorityFeePerGas: sponsorship.maxPriorityFeePerGas ?? 0n,
		// Paymaster fields from Pimlico
		paymaster: sponsorship.paymaster,
		paymasterData: sponsorship.paymasterData,
		paymasterVerificationGasLimit: sponsorship.paymasterVerificationGasLimit,
		paymasterPostOpGasLimit: sponsorship.paymasterPostOpGasLimit,
		// Client-supplied EIP-712 proof-authorization signature
		signature
	};

	// Carry through factory fields if present (account deployment path)
	if (userOp.factory) fullUserOp.factory = userOp.factory;
	if (userOp.factoryData) fullUserOp.factoryData = userOp.factoryData;

	// 8. Submit to bundler
	let userOpHash: string;
	try {
		userOpHash = await sendUserOperation(pimlicoClient, fullUserOp);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`${LOG_PREFIX} sendUserOperation failed for user ${safeUserId(userId)}:`, message);
		return json(
			{ success: false, error: `Bundler submission failed: ${message}` },
			{ status: 502 }
		);
	}

	// 9. Wait for on-chain inclusion
	let receipt: { txHash: string; success: boolean };
	try {
		receipt = await waitForUserOperationReceipt(pimlicoClient, userOpHash);
	} catch (err) {
		// Timeout or polling failure — the UserOp may still be pending.
		// Return the userOpHash so the client can poll independently.
		const message = err instanceof Error ? err.message : String(err);
		console.warn(`${LOG_PREFIX} Receipt polling failed/timeout for ${userOpHash}:`, message);
		return json(
			{
				success: false,
				error: `UserOp submitted but receipt not confirmed: ${message}`,
				userOpHash
			},
			{ status: 202 }
		);
	}

	if (!receipt.success) {
		// UserOp was included but reverted on-chain
		console.warn(
			`${LOG_PREFIX} UserOp reverted on-chain for user ${userId}:`,
			{ userOpHash, txHash: receipt.txHash }
		);
		return json(
			{
				success: false,
				error: 'Transaction reverted on-chain. The contract call failed.',
				txHash: receipt.txHash,
				userOpHash
			},
			{ status: 422 }
		);
	}

	console.debug(
		`${LOG_PREFIX} UserOp confirmed for user ${userId}:`,
		{ userOpHash, txHash: receipt.txHash }
	);

	return json({
		success: true,
		txHash: receipt.txHash,
		userOpHash
	});
};
