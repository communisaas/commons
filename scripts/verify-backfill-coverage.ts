/**
 * Verify: Check that all PII/token backfill encryption is complete.
 *
 * Runs COUNT queries against each table to find rows that still have
 * plaintext data without corresponding encrypted columns.
 *
 * Exits with code 0 if all rows are encrypted, code 1 if gaps remain.
 *
 * Required env:
 *   DATABASE_URL — Postgres connection string
 *
 * Usage: npx tsx scripts/verify-backfill-coverage.ts
 */

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

interface CoverageCheck {
	label: string;
	unencrypted: number;
	total: number;
}

async function main() {
	console.log('[verify] Checking backfill encryption coverage...\n');

	const checks: CoverageCheck[] = [];

	// Users: email encryption
	const [usersUnencrypted] = await db.$queryRaw<[{ count: bigint }]>`
		SELECT COUNT(*) as count FROM "user"
		WHERE encrypted_email IS NULL AND email IS NOT NULL AND email != ''
	`;
	const [usersTotal] = await db.$queryRaw<[{ count: bigint }]>`
		SELECT COUNT(*) as count FROM "user"
		WHERE email IS NOT NULL AND email != ''
	`;
	checks.push({
		label: 'Users (email)',
		unencrypted: Number(usersUnencrypted.count),
		total: Number(usersTotal.count)
	});

	// Supporters: email encryption
	const [supportersUnencrypted] = await db.$queryRaw<[{ count: bigint }]>`
		SELECT COUNT(*) as count FROM supporter
		WHERE encrypted_email IS NULL AND email IS NOT NULL AND email != ''
	`;
	const [supportersTotal] = await db.$queryRaw<[{ count: bigint }]>`
		SELECT COUNT(*) as count FROM supporter
		WHERE email IS NOT NULL AND email != ''
	`;
	checks.push({
		label: 'Supporters (email)',
		unencrypted: Number(supportersUnencrypted.count),
		total: Number(supportersTotal.count)
	});

	// OrgInvites: email encryption
	const [invitesUnencrypted] = await db.$queryRaw<[{ count: bigint }]>`
		SELECT COUNT(*) as count FROM org_invite
		WHERE encrypted_email IS NULL AND email IS NOT NULL AND email != ''
	`;
	const [invitesTotal] = await db.$queryRaw<[{ count: bigint }]>`
		SELECT COUNT(*) as count FROM org_invite
		WHERE email IS NOT NULL AND email != ''
	`;
	checks.push({
		label: 'OrgInvites (email)',
		unencrypted: Number(invitesUnencrypted.count),
		total: Number(invitesTotal.count)
	});

	// Accounts: OAuth token encryption
	const [accountsUnencrypted] = await db.$queryRaw<[{ count: bigint }]>`
		SELECT COUNT(*) as count FROM account
		WHERE access_token IS NOT NULL AND encrypted_access_token IS NULL
	`;
	const [accountsTotal] = await db.$queryRaw<[{ count: bigint }]>`
		SELECT COUNT(*) as count FROM account
		WHERE access_token IS NOT NULL
	`;
	checks.push({
		label: 'Accounts (OAuth tokens)',
		unencrypted: Number(accountsUnencrypted.count),
		total: Number(accountsTotal.count)
	});

	// Print results
	let hasGaps = false;
	for (const check of checks) {
		const encrypted = check.total - check.unencrypted;
		const pct = check.total > 0 ? ((encrypted / check.total) * 100).toFixed(1) : '100.0';
		const status = check.unencrypted === 0 ? 'OK' : 'INCOMPLETE';

		if (check.unencrypted > 0) hasGaps = true;

		console.log(
			`  ${status.padEnd(12)} ${check.label.padEnd(25)} ${encrypted}/${check.total} encrypted (${pct}%)` +
				(check.unencrypted > 0 ? ` — ${check.unencrypted} remaining` : '')
		);
	}

	console.log('');

	await db.$disconnect();

	if (hasGaps) {
		console.log('[verify] FAILED — some rows still need encryption. Run the backfill scripts.');
		process.exit(1);
	} else {
		console.log('[verify] PASSED — all rows encrypted.');
		process.exit(0);
	}
}

main().catch((err) => {
	console.error('[verify] Fatal error:', err);
	process.exit(1);
});
