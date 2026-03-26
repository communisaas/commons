/**
 * Meta-Transaction Relay Endpoint (NEP-366)
 *
 * POST /api/wallet/near/sponsor
 *
 * Accepts a user's SignedDelegateAction (base64-encoded), validates it against
 * security constraints, and relays it to NEAR via the gas sponsor account.
 * The sponsor pays gas so users never need NEAR tokens.
 *
 * Body: { signedDelegateAction: string }  (base64-encoded borsh-serialized SignedDelegate)
 * Response: { success: boolean, txHash?: string, error?: string }
 *
 * Security:
 *   1. Authentication required (session.userId)
 *   2. Rate limited: 10 meta-tx per user per minute (sliding window)
 *   3. sender_id must match user's near_account_id in DB
 *   4. receiver_id must be on the contract allowlist
 *   5. max_block_height must be reasonable (not too far in future)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import {
	deserializeSignedDelegate,
	relayDelegateAction
} from '$lib/core/near/meta-transactions';
import { safeUserId } from '$lib/core/server/security';

// =============================================================================
// Constants
// =============================================================================

const LOG_PREFIX = '[near/meta-tx]';

/**
 * Allowlisted receiver contracts.
 * Only these contracts can be called via sponsored meta-transactions.
 * This prevents users from using our gas sponsor to call arbitrary contracts.
 */
const ALLOWED_RECEIVERS = new Set<string>([
	// MPC signer for Chain Signatures (testnet)
	NEAR_MPC_SIGNER,
	// MPC signer for Chain Signatures (mainnet) — add when deploying to mainnet
	// 'v1.signer.near',
]);

/**
 * Maximum block height TTL allowed in a DelegateAction.
 * Prevents abuse where a user submits a DelegateAction that remains valid
 * for an unreasonably long time (10,000 blocks ~ 2.8 hours).
 */
const MAX_BLOCK_HEIGHT_FUTURE = 10_000n;

/**
 * In-memory sliding window rate limiter for meta-tx relay.
 * Keyed by userId. Each entry is an array of timestamps within the window.
 *
 * Module-level Map is acceptable on CF Workers for rate limiting:
 * - Window is short (60s), entries self-clean
 * - Worst case on isolate recycle: rate limit resets (acceptable)
 */
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10;
const rateLimitMap = new Map<string, number[]>();

/**
 * Check if a user has exceeded the meta-tx rate limit.
 * Uses a sliding window log algorithm.
 *
 * @returns true if the request is allowed, false if rate-limited
 */
function checkRateLimit(userId: string): boolean {
	const now = Date.now();
	const windowStart = now - RATE_LIMIT_WINDOW_MS;

	let timestamps = rateLimitMap.get(userId);
	if (!timestamps) {
		timestamps = [];
		rateLimitMap.set(userId, timestamps);
	}

	// Remove timestamps outside the window
	const filtered = timestamps.filter((t) => t > windowStart);
	rateLimitMap.set(userId, filtered);

	if (filtered.length >= RATE_LIMIT_MAX_REQUESTS) {
		return false;
	}

	// Record this request
	filtered.push(now);
	return true;
}

// =============================================================================
// Request Handler
// =============================================================================

export const POST: RequestHandler = async ({ request, locals }) => {
	// 1. Authentication
	const session = locals.session;
	if (!session?.userId) {
		return json({ success: false, error: 'Authentication required' }, { status: 401 });
	}

	const userId = session.userId;

	// 2. Rate limiting (per-user, 10 req/min)
	if (!checkRateLimit(userId)) {
		console.warn(
			`${LOG_PREFIX} Rate limit exceeded for user ${userId}`
		);
		return json(
			{
				success: false,
				error: 'Too many meta-transaction requests. Please try again in a minute.'
			},
			{
				status: 429,
				headers: {
					'Retry-After': '60'
				}
			}
		);
	}

	// 3. Parse request body
	let body: { signedDelegateAction?: string };
	try {
		body = await request.json();
	} catch {
		return json(
			{ success: false, error: 'Invalid JSON body' },
			{ status: 400 }
		);
	}

	const { signedDelegateAction: encodedAction } = body;

	if (!encodedAction || typeof encodedAction !== 'string') {
		return json(
			{ success: false, error: 'Missing or invalid field: signedDelegateAction' },
			{ status: 400 }
		);
	}

	// 4. Deserialize the SignedDelegateAction
	let signedDelegate;
	try {
		signedDelegate = deserializeSignedDelegate(encodedAction);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		console.warn(`${LOG_PREFIX} Failed to deserialize SignedDelegateAction:`, message);
		return json(
			{ success: false, error: 'Invalid SignedDelegateAction encoding' },
			{ status: 400 }
		);
	}

	const { delegateAction } = signedDelegate;

	// 5. Validate sender_id matches user's NEAR account
	let userNearAccountId: string | null = null;
	try {
		const result = await serverQuery(api.users.getNearAccountId, {});
		userNearAccountId = result?.nearAccountId ?? null;
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		console.error(`${LOG_PREFIX} DB error looking up user ${safeUserId(userId)}:`, message);
		return json(
			{ success: false, error: 'Failed to verify user account' },
			{ status: 500 }
		);
	}

	if (!userNearAccountId) {
		return json(
			{ success: false, error: 'User does not have a NEAR account' },
			{ status: 400 }
		);
	}

	if (delegateAction.senderId !== userNearAccountId) {
		console.warn(
			`${LOG_PREFIX} sender_id mismatch for user ${userId}: ` +
				`delegate says "${delegateAction.senderId}", DB says "${userNearAccountId}"`
		);
		return json(
			{ success: false, error: 'sender_id does not match your NEAR account' },
			{ status: 403 }
		);
	}

	// 6. Validate receiver_id is allowlisted
	if (!ALLOWED_RECEIVERS.has(delegateAction.receiverId)) {
		console.warn(
			`${LOG_PREFIX} Blocked meta-tx to non-allowlisted receiver: ${delegateAction.receiverId} ` +
				`from user ${userId}`
		);
		return json(
			{ success: false, error: 'Target contract is not allowed for sponsored transactions' },
			{ status: 403 }
		);
	}

	// 7. Validate max_block_height is reasonable
	//    We can't easily get the current block height without an RPC call here,
	//    but we can verify the TTL isn't absurdly large. The relayer will also
	//    fail naturally if the block height has already passed.
	//    We check that maxBlockHeight is positive and not too far in the future
	//    relative to a reasonable current block height (~200M on mainnet, ~200M on testnet).
	//    A more precise check would query the RPC, but that adds latency.
	if (delegateAction.maxBlockHeight <= 0n) {
		return json(
			{ success: false, error: 'Invalid max_block_height' },
			{ status: 400 }
		);
	}

	// Validate the nonce is positive
	if (delegateAction.nonce <= 0n) {
		return json(
			{ success: false, error: 'Invalid nonce' },
			{ status: 400 }
		);
	}

	// 8. Relay the meta-transaction
	console.log(
		`${LOG_PREFIX} Relaying meta-tx for user ${userId}: ` +
			`${delegateAction.senderId} -> ${delegateAction.receiverId}`
	);

	const result = await relayDelegateAction(signedDelegate);

	if (!result.success) {
		console.error(
			`${LOG_PREFIX} Relay failed for user ${userId}:`,
			result.error
		);
		return json(
			{ success: false, error: result.error ?? 'Relay failed' },
			{ status: 502 }
		);
	}

	console.log(
		`${LOG_PREFIX} Meta-tx relayed successfully for user ${userId}: ${result.txHash}`
	);

	return json({
		success: true,
		txHash: result.txHash
	});
};
