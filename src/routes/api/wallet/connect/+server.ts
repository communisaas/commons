/**
 * Wallet Connection Verification Endpoint
 *
 * Verifies an EIP-191 personal_sign signature against a previously-issued nonce,
 * then binds the recovered EVM address to the authenticated user's account.
 *
 * POST /api/wallet/connect
 * Requires: authenticated session (locals.user)
 * Body: { address: string, signature: string, nonce: string }
 * Returns: { success: true, address: string }
 *
 * Security:
 * - Nonce is consumed (deleted) immediately, preventing replay attacks
 * - Nonce is scoped to the userId that requested it
 * - Signature recovery must match the claimed address (checksummed)
 * - Unique constraint on wallet_address prevents binding to multiple accounts
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyMessage, getAddress, isAddress } from 'ethers';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { nonceStore, cleanupExpiredNonces } from '../_nonce-store';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	// Housekeeping: purge expired nonces
	cleanupExpiredNonces();

	// Parse and validate request body
	let body: { address?: string; signature?: string; nonce?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const { address, signature, nonce } = body;

	if (!address || typeof address !== 'string') {
		return json({ error: 'Missing or invalid field: address' }, { status: 400 });
	}
	if (!signature || typeof signature !== 'string') {
		return json({ error: 'Missing or invalid field: signature' }, { status: 400 });
	}
	if (!nonce || typeof nonce !== 'string') {
		return json({ error: 'Missing or invalid field: nonce' }, { status: 400 });
	}

	// Validate Ethereum address format
	if (!isAddress(address)) {
		return json({ error: 'Invalid Ethereum address' }, { status: 400 });
	}

	// Normalize to checksummed address (throws on invalid)
	let checksummedAddress: string;
	try {
		checksummedAddress = getAddress(address);
	} catch {
		return json({ error: 'Invalid Ethereum address checksum' }, { status: 400 });
	}

	// Look up and consume nonce atomically (delete before any async work)
	const nonceEntry = nonceStore.get(nonce);
	if (!nonceEntry) {
		return json({ error: 'Invalid or expired nonce' }, { status: 400 });
	}

	// Delete immediately — nonce is single-use regardless of outcome
	nonceStore.delete(nonce);

	// Verify nonce belongs to this user
	if (nonceEntry.userId !== locals.user.id) {
		return json({ error: 'Nonce was not issued to this account' }, { status: 400 });
	}

	// Verify nonce hasn't expired
	if (nonceEntry.expiresAt <= Date.now()) {
		return json({ error: 'Nonce has expired' }, { status: 400 });
	}

	// Recover signer address from EIP-191 signature
	let recoveredAddress: string;
	try {
		recoveredAddress = verifyMessage(nonceEntry.message, signature);
	} catch {
		return json({ error: 'Invalid signature' }, { status: 400 });
	}

	// Compare recovered address to claimed address (both checksummed)
	if (getAddress(recoveredAddress) !== checksummedAddress) {
		return json({ error: 'Signature does not match the provided address' }, { status: 400 });
	}

	// Bind wallet via Convex mutation (handles uniqueness check)
	try {
		const result = await serverMutation(api.users.connectWallet, {
			address: checksummedAddress,
			walletType: 'evm',
		});

		return json({
			success: true,
			address: checksummedAddress
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes('already connected')) {
			return json(
				{ error: 'This wallet is already connected to another account' },
				{ status: 409 }
			);
		}

		console.error('[Wallet Connect] Database error:', err);
		return json({ error: 'Failed to connect wallet' }, { status: 500 });
	}
};
