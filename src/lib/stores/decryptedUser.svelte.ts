/**
 * Reactive user PII store — passes through plaintext email/name from server.
 *
 * Previously handled client-side AES-256-GCM decryption of device-encrypted
 * PII blobs. Email/name are now stored plaintext — the threat model doesn't
 * justify client-side encryption for communication channel identifiers.
 *
 * Credential encryption (identity secrets, session state, constituent address)
 * remains in credential-encryption.ts with device-held keys.
 */

interface LayoutUser {
	id: string;
	email: string | null;
	name: string | null;
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
 * Update user PII state from layout data.
 * Call this reactively from the root layout's $effect.
 */
export function syncDecryptedUser(user: LayoutUser | null): void {
	if (!user) {
		state.email = null;
		state.name = null;
		state.decrypting = false;
		lastUserId = null;
		return;
	}

	if (user.id === lastUserId && state.email !== null) {
		return;
	}

	lastUserId = user.id;
	state.email = user.email;
	state.name = user.name;
	state.decrypting = false;
}

export const decryptedUser = {
	get email() { return state.email; },
	get name() { return state.name; },
	get decrypting() { return state.decrypting; },
};
