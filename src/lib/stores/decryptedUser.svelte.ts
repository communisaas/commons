/**
 * Reactive decrypted user store — transparently handles PII custody modes.
 *
 * When custodyMode is "client": decrypts email/name from encrypted blobs
 * using the device-held key in IndexedDB.
 *
 * When custodyMode is "server" (or unset): uses plaintext from server response.
 *
 * Components read `decryptedUser.email` / `decryptedUser.name` — they never
 * need to know which custody mode is active.
 */

import { browser } from '$app/environment';

interface LayoutUser {
	id: string;
	email: string | null;
	name: string | null;
	custodyMode?: string;
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
let lastCustodyMode: string | null = null;

/**
 * Update the decrypted user state from layout data.
 * Call this reactively from the root layout's $effect.
 */
export function syncDecryptedUser(user: LayoutUser | null): void {
	if (!user) {
		state.email = null;
		state.name = null;
		state.decrypting = false;
		lastUserId = null;
		lastCustodyMode = null;
		return;
	}

	// Server custody — plaintext already available
	if (user.custodyMode !== 'client') {
		state.email = user.email;
		state.name = user.name;
		state.decrypting = false;
		lastUserId = user.id;
		lastCustodyMode = user.custodyMode ?? 'server';
		return;
	}

	// Client custody — need to decrypt
	// Skip if already decrypted for this user
	if (user.id === lastUserId && lastCustodyMode === 'client' && state.email !== null) {
		return;
	}

	if (!browser) {
		// SSR — can't decrypt, return nulls (client will hydrate)
		state.email = null;
		state.name = null;
		state.decrypting = true;
		return;
	}

	state.decrypting = true;
	lastUserId = user.id;
	lastCustodyMode = 'client';

	// Async decrypt — updates state when done
	(async () => {
		const { decryptUserPiiClient, isClientPiiAvailable } = await import('$lib/core/crypto/client-pii');

		if (!isClientPiiAvailable()) {
			state.email = user.email; // fallback to whatever server sent
			state.name = user.name;
			state.decrypting = false;
			return;
		}

		const { email, name } = await decryptUserPiiClient(
			user.encryptedEmail ?? null,
			user.encryptedName ?? null,
			user.id
		);

		state.email = email;
		state.name = name;
		state.decrypting = false;
	})().catch(() => {
		state.email = user.email;
		state.name = user.name;
		state.decrypting = false;
	});
}

export const decryptedUser = {
	get email() { return state.email; },
	get name() { return state.name; },
	get decrypting() { return state.decrypting; },
};
