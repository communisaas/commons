/**
 * Backfill: Encrypt existing OAuth tokens (access, refresh, id) at rest.
 *
 * Processes accounts where access_token IS NOT NULL AND encrypted_access_token IS NULL.
 * Uses AES-256-GCM with HKDF-derived per-account keys.
 * Info string: "commons-oauth-token-v1:{provider}:{providerAccountId}" (matches dual-write path).
 *
 * Idempotent — skips rows that already have encrypted_access_token.
 * Batch size: 100, cursor pagination.
 *
 * Required env:
 *   OAUTH_ENCRYPTION_KEY — 32-byte hex (openssl rand -hex 32)
 *   DATABASE_URL         — Postgres connection string
 *
 * Usage: npx tsx scripts/backfill-encrypt-oauth-tokens.ts
 */

import { Prisma, PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const BATCH_SIZE = 100;

const encoder = new TextEncoder();

// =============================================================================
// ENV VALIDATION
// =============================================================================

function requireEnv(name: string): string {
	const val = process.env[name];
	if (!val) {
		console.error(`[backfill] ERROR: ${name} is required. Generate with: openssl rand -hex 32`);
		process.exit(1);
	}
	return val;
}

// =============================================================================
// CRYPTO UTILITIES
// =============================================================================

function hexToBytes(hex: string): Uint8Array {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	if (clean.length % 2 !== 0) throw new Error('Invalid hex string: odd length');
	const bytes = new Uint8Array(clean.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

interface EncryptedToken {
	ciphertext: string;
	iv: string;
}

async function encryptOAuthToken(
	plaintext: string,
	provider: string,
	providerAccountId: string,
	masterKeyHex: string
): Promise<EncryptedToken> {
	const masterKey = await crypto.subtle.importKey(
		'raw',
		hexToBytes(masterKeyHex) as BufferSource,
		'HKDF',
		false,
		['deriveKey']
	);

	const info = encoder.encode(`commons-oauth-token-v1:${provider}:${providerAccountId}`);
	const salt = encoder.encode('commons-oauth-encryption-v1');

	const accountKey = await crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt, info },
		masterKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt']
	);

	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertextBuf = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		accountKey,
		encoder.encode(plaintext)
	);

	return {
		ciphertext: bytesToBase64(new Uint8Array(ciphertextBuf)),
		iv: bytesToBase64(iv)
	};
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
	const oauthKey = requireEnv('OAUTH_ENCRYPTION_KEY');

	console.log('[backfill] Starting OAuth token encryption backfill...');

	let totalProcessed = 0;
	let totalEncrypted = 0;
	let totalErrors = 0;
	let cursor: string | undefined;

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const accounts = await db.account.findMany({
			where: {
				access_token: { not: null },
				encrypted_access_token: { equals: Prisma.DbNull }
			},
			select: {
				id: true,
				provider: true,
				provider_account_id: true,
				access_token: true,
				refresh_token: true,
				id_token: true
			},
			take: BATCH_SIZE,
			orderBy: { id: 'asc' },
			...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
		});

		if (accounts.length === 0) break;

		for (const acct of accounts) {
			try {
				const encAccessToken = acct.access_token
					? await encryptOAuthToken(acct.access_token, acct.provider, acct.provider_account_id, oauthKey)
					: null;

				const encRefreshToken = acct.refresh_token
					? await encryptOAuthToken(acct.refresh_token, acct.provider, acct.provider_account_id, oauthKey)
					: null;

				const encIdToken = acct.id_token
					? await encryptOAuthToken(acct.id_token, acct.provider, acct.provider_account_id, oauthKey)
					: null;

				const updateData: Record<string, unknown> = {};
				if (encAccessToken) updateData.encrypted_access_token = encAccessToken;
				if (encRefreshToken) updateData.encrypted_refresh_token = encRefreshToken;
				if (encIdToken) updateData.encrypted_id_token = encIdToken;

				await db.account.update({
					where: { id: acct.id },
					data: updateData
				});

				totalEncrypted++;
			} catch (error) {
				totalErrors++;
				const msg = error instanceof Error ? error.message : String(error);
				console.error(`[backfill]   Error encrypting account ${acct.id} (${acct.provider}): ${msg}`);
			}
		}

		totalProcessed += accounts.length;
		cursor = accounts[accounts.length - 1].id;
		console.log(`[backfill]   Processed ${totalProcessed} accounts (${totalEncrypted} encrypted, ${totalErrors} errors)`);
	}

	console.log('[backfill] Done.');
	console.log(`[backfill] Summary: ${totalProcessed} accounts scanned, ${totalEncrypted} encrypted, ${totalErrors} errors`);

	await db.$disconnect();
}

main().catch((err) => {
	console.error('[backfill] Fatal error:', err);
	process.exit(1);
});
