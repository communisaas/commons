/**
 * Reactive decrypted user store — client-side PII decryption.
 *
 * PII is always encrypted with the user's device key. The server returns
 * opaque blobs. This store decrypts them locally and exposes plaintext
 * reactively to components via `decryptedUser.email` / `decryptedUser.name`.
 */

import { browser } from '$app/environment';

interface LayoutUser {
	id: string;
	email: string | null;
	name: string | null;
	encryptedEmail?: string | null;
	encryptedName?: string | null;
	[key: string]: unknown;
}

interface DecryptedUserState {
	email: string | null;
	name: string | null;
	decrypting: boolean;
}

let state = $state<DecryptedUserState>({
	email: null,
	name: null,
	decrypting: false,
});

let lastUserId: string | null = null;

/**
 * Update the decrypted user state from layout data.
 * Call this reactively from the root layout's $effect.
 */
export function syncDecryptedUser(user: LayoutUser | null): void {
	console.log('[decryptedUser] called, user:', user ? user.id : 'NULL');
	if (!user) {
		state.email = null;
		state.name = null;
		state.decrypting = false;
		lastUserId = null;
		return;
	}

	// Skip if already decrypted for this user
	if (user.id === lastUserId && state.email !== null) {
		console.log('[decryptedUser] skip — already decrypted for', user.id);
		return;
	}

	if (!browser) {
		state.email = null;
		state.name = null;
		state.decrypting = true;
		return;
	}

	console.log('[decryptedUser] decrypting for', user.id, 'encEmail:', user.encryptedEmail?.slice(0, 30) ?? 'NULL');
	state.decrypting = true;
	const capturedId = user.id;
	lastUserId = user.id;

	(async () => {
		const { decryptUserPiiClient, isClientPiiAvailable } = await import('$lib/core/crypto/client-pii');

		if (capturedId !== lastUserId) return;

		if (!isClientPiiAvailable()) {
			console.log('[decryptedUser] client PII not available');
			state.email = null;
			state.name = null;
			state.decrypting = false;
			return;
		}

		const { email, name } = await decryptUserPiiClient(
			user.encryptedEmail ?? null,
			user.encryptedName ?? null,
			user.id
		);

		console.log('[decryptedUser] result:', { email: email ? 'OK' : 'NULL', name: name ? 'OK' : 'NULL' });
		if (capturedId !== lastUserId) return;
		state.email = email;
		state.name = name;
		state.decrypting = false;
	})().catch((err) => {
		console.error('[decryptedUser] decrypt error:', err);
		if (capturedId !== lastUserId) return;
		state.email = null;
		state.name = null;
		state.decrypting = false;
	});
}

export const decryptedUser = state;
