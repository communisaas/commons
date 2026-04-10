/**
 * PII Decrypt Adapter — client-side blob decryption for org admin display.
 *
 * Detects blob format and decrypts accordingly:
 * - `v: "org-1"` → decrypt with org key (org-pii-encryption.ts)
 * - No `v` field → legacy server-encrypted (cannot decrypt client-side, show placeholder)
 *
 * Used by org admin pages (supporters, donations, calls, SMS, settings)
 * to decrypt PII blobs returned by Convex queries.
 */

import { decryptWithOrgKey, type OrgEncryptedPii } from '$lib/core/crypto/org-pii-encryption';

/**
 * Decrypt a PII blob with the org key if possible.
 * Returns null for legacy blobs (server-encrypted, not yet migrated).
 */
export async function decryptPiiBlob(
	blob: string | null,
	orgKey: CryptoKey | null,
	entityId: string,
	fieldName: string
): Promise<string | null> {
	if (!blob) return null;

	try {
		const parsed = JSON.parse(blob);

		if (parsed.v === 'org-1' && orgKey) {
			return await decryptWithOrgKey(parsed as OrgEncryptedPii, orgKey, entityId, fieldName);
		}

		// Legacy blob (no version tag) — cannot decrypt client-side
		return null;
	} catch {
		return null;
	}
}

/**
 * Check if a blob is in the org-encrypted format.
 */
export function isOrgEncrypted(blob: string | null): boolean {
	if (!blob) return false;
	try {
		return JSON.parse(blob).v === 'org-1';
	} catch {
		return false;
	}
}

/**
 * Check if a blob is in the legacy server-encrypted format (needs migration).
 */
export function isLegacyEncrypted(blob: string | null): boolean {
	if (!blob) return false;
	try {
		const parsed = JSON.parse(blob);
		return parsed.ciphertext && !parsed.v;
	} catch {
		return false;
	}
}
