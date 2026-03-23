/**
 * Backfill: Encrypt existing Supporter emails at rest.
 *
 * Processes supporters where encrypted_email IS NULL AND email IS NOT NULL.
 * Uses AES-256-GCM with HKDF-derived per-supporter keys.
 * Info string: "supporter:{supporterId}" (matches dual-write path).
 *
 * Idempotent — skips rows that already have encrypted_email.
 * Batch size: 100, cursor pagination.
 *
 * Required env:
 *   PII_ENCRYPTION_KEY — 32-byte hex (openssl rand -hex 32)
 *   EMAIL_LOOKUP_KEY   — 32-byte hex (openssl rand -hex 32)
 *   DATABASE_URL       — Postgres connection string
 *
 * Usage: npx tsx scripts/backfill-encrypt-supporters.ts
 */

import { PrismaClient } from '@prisma/client';

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

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

async function computeEmailHash(email: string, keyHex: string): Promise<string> {
	const keyBytes = hexToBytes(keyHex);
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		keyBytes as BufferSource,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const normalized = email.trim().toLowerCase();
	const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(normalized));
	return bytesToHex(new Uint8Array(sig));
}

async function encryptPii(
	plaintext: string,
	infoString: string,
	masterKeyHex: string
): Promise<string> {
	const masterKey = await crypto.subtle.importKey(
		'raw',
		hexToBytes(masterKeyHex) as BufferSource,
		'HKDF',
		false,
		['deriveKey']
	);

	const derivedKey = await crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: encoder.encode('commons-pii-encryption-v1'),
			info: encoder.encode(infoString)
		},
		masterKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt']
	);

	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertextBuf = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		derivedKey,
		encoder.encode(plaintext)
	);

	return JSON.stringify({
		ciphertext: bytesToBase64(new Uint8Array(ciphertextBuf)),
		iv: bytesToBase64(iv)
	});
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
	const piiKey = requireEnv('PII_ENCRYPTION_KEY');
	const emailKey = requireEnv('EMAIL_LOOKUP_KEY');

	console.log('[backfill] Starting supporter email encryption backfill...');

	let totalProcessed = 0;
	let totalEncrypted = 0;
	let totalErrors = 0;
	let cursor: string | undefined;

	// eslint-disable-next-line no-constant-condition
	while (true) {
		// Use raw query because plaintext email column is no longer in the Prisma schema
		const supporters: { id: string; email: string }[] = cursor
			? await db.$queryRaw`SELECT id, email FROM "supporter" WHERE encrypted_email IS NULL AND email IS NOT NULL AND email != '' AND id > ${cursor} ORDER BY id ASC LIMIT ${BATCH_SIZE}`
			: await db.$queryRaw`SELECT id, email FROM "supporter" WHERE encrypted_email IS NULL AND email IS NOT NULL AND email != '' ORDER BY id ASC LIMIT ${BATCH_SIZE}`;

		if (supporters.length === 0) break;

		for (const supporter of supporters) {
			try {
				const emailHash = await computeEmailHash(supporter.email, emailKey);
				const encryptedEmail = await encryptPii(
					supporter.email,
					'supporter:' + supporter.id,
					piiKey
				);

				await db.supporter.update({
					where: { id: supporter.id },
					data: {
						email_hash: emailHash,
						encrypted_email: encryptedEmail
					}
				});

				totalEncrypted++;
			} catch (error) {
				totalErrors++;
				const msg = error instanceof Error ? error.message : String(error);
				console.error(`[backfill]   Error encrypting supporter ${supporter.id}: ${msg}`);
			}
		}

		totalProcessed += supporters.length;
		cursor = supporters[supporters.length - 1].id;
		console.log(`[backfill]   Processed ${totalProcessed} supporters (${totalEncrypted} encrypted, ${totalErrors} errors)`);
	}

	console.log('[backfill] Done.');
	console.log(`[backfill] Summary: ${totalProcessed} supporters scanned, ${totalEncrypted} encrypted, ${totalErrors} errors`);

	await db.$disconnect();
}

main().catch((err) => {
	console.error('[backfill] Fatal error:', err);
	process.exit(1);
});
