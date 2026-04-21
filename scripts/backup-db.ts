/**
 * Database Backup Script
 *
 * Dumps PostgreSQL database, compresses with gzip, encrypts with AES-256-CBC,
 * and uploads to S3. Designed for daily cron via GitHub Actions.
 *
 * Usage: npx tsx scripts/backup-db.ts
 *
 * Required env vars:
 *   DATABASE_URL           - PostgreSQL connection string
 *   BACKUP_ENCRYPTION_KEY  - Passphrase for AES-256-CBC encryption
 *   S3_BACKUP_BUCKET       - S3 bucket name (default: commons-backups)
 *   AWS_REGION             - AWS region (default: us-east-1)
 *   AWS_ACCESS_KEY_ID      - AWS credentials
 *   AWS_SECRET_ACCESS_KEY  - AWS credentials
 *
 * RETENTION / LIFECYCLE — NOT MANAGED HERE
 * -----------------------------------------
 * This script only uploads. Retention lives in the S3 bucket's lifecycle
 * configuration, not in code. Without one, daily objects accumulate forever
 * and storage cost grows linearly. Expected policy (applied via
 * `aws s3api put-bucket-lifecycle-configuration` on the target bucket):
 *
 *   daily/ prefix:
 *     - Transition to GLACIER_IR after 30 days (≈5× cheaper, ms retrieval)
 *     - Expire current version after 365 days
 *     - Expire noncurrent versions after 30 days (versioning is on for
 *       accidental-delete recovery; don't keep orphans forever)
 *
 * IAM — the uploading principal only needs `s3:PutObject` on
 * `arn:aws:s3:::<bucket>/daily/*`. Restore reads go through a separate
 * principal (operator-initiated, not automated).
 *
 * Key custody — BACKUP_ENCRYPTION_KEY is the sole decryption secret. If
 * you rotate it you lose the ability to restore backups encrypted under
 * the previous value; keep old keys in a password manager alongside the
 * new one.
 */

import { spawn } from 'child_process';
import { createWriteStream, readFileSync, unlinkSync } from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * Strip Prisma/PgBouncer-specific query params from a connection string.
 * pg_dump uses libpq, which rejects any URI query parameter outside the
 * documented libpq keyword set ("invalid URI query parameter"). Prisma
 * connection strings commonly carry `schema`, `pgbouncer`, `connection_limit`,
 * `pool_timeout`, `statement_cache_size`, etc. — none of which are libpq
 * options.
 *
 * Operates on the raw string rather than `new URL()` because production
 * DATABASE_URLs routinely contain unescaped special characters in the
 * password that WHATWG URL rejects ("TypeError: Invalid URL"). The libpq
 * allowlist is the source of truth:
 * https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-PARAMKEYWORDS.
 * Anything outside the allowlist is dropped; everything else — credentials,
 * host, port, dbname, TLS options — is left byte-for-byte unchanged.
 */
function sanitizeForPgDump(rawUrl: string): string {
	// Some env sources paste the URL with surrounding quotes (copied from a
	// .env line like `DATABASE_URL="postgresql://..."`). Strip matched
	// single or double quote pairs, but leave internal quotes alone.
	let url = rawUrl.trim();
	if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
		url = url.slice(1, -1);
	}
	rawUrl = url;

	const libpqAllowlist = new Set([
		'host', 'hostaddr', 'port', 'dbname', 'user', 'password',
		'connect_timeout', 'client_encoding', 'options', 'application_name',
		'fallback_application_name', 'keepalives', 'keepalives_idle',
		'keepalives_interval', 'keepalives_count', 'tcp_user_timeout',
		'replication', 'gssencmode', 'sslmode', 'requiressl', 'sslcompression',
		'sslcert', 'sslkey', 'sslpassword', 'sslrootcert', 'sslcrl',
		'requirepeer', 'krbsrvname', 'gsslib', 'service', 'target_session_attrs',
		'load_balance_hosts', 'channel_binding', 'passfile',
	]);

	const qIndex = rawUrl.indexOf('?');
	if (qIndex === -1) return rawUrl;

	const base = rawUrl.slice(0, qIndex);
	const query = rawUrl.slice(qIndex + 1);
	const stripped: string[] = [];
	const kept: string[] = [];
	for (const pair of query.split('&')) {
		if (!pair) continue;
		const eq = pair.indexOf('=');
		const key = eq === -1 ? pair : pair.slice(0, eq);
		if (libpqAllowlist.has(key)) {
			kept.push(pair);
		} else {
			stripped.push(key);
		}
	}
	if (stripped.length > 0) {
		console.log(`[backup] Stripped non-libpq params from DATABASE_URL: ${stripped.join(', ')}`);
	}
	return kept.length > 0 ? `${base}?${kept.join('&')}` : base;
}

/**
 * Run `pg_dump | gzip | openssl enc > file` as a shell-free pipeline.
 *
 * Each stage exit code is checked independently — pg_dump failing after
 * emitting zero bytes would otherwise produce an apparently-successful
 * encrypted-of-nothing archive. Any non-zero exit, spawn error, or
 * truncated output rejects the promise.
 */
function runPipeline(pgUrl: string, outPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const pgDump = spawn('pg_dump', ['--format=custom', pgUrl], {
			stdio: ['ignore', 'pipe', 'inherit'],
		});
		const gzipProc = spawn('gzip', [], {
			stdio: ['pipe', 'pipe', 'inherit'],
		});
		const openssl = spawn(
			'openssl',
			['enc', '-aes-256-cbc', '-pbkdf2', '-pass', 'env:BACKUP_ENCRYPTION_KEY'],
			{ stdio: ['pipe', 'pipe', 'inherit'] },
		);

		pgDump.stdout.pipe(gzipProc.stdin);
		gzipProc.stdout.pipe(openssl.stdin);
		openssl.stdout.pipe(createWriteStream(outPath));

		const errors: string[] = [];
		const stages: [string, ReturnType<typeof spawn>][] = [
			['pg_dump', pgDump],
			['gzip', gzipProc],
			['openssl', openssl],
		];
		let remaining = stages.length;

		for (const [name, proc] of stages) {
			proc.on('error', (e) => errors.push(`${name}: ${e.message}`));
			proc.on('close', (code) => {
				if (code !== 0) errors.push(`${name} exited ${code}`);
				if (--remaining === 0) {
					if (errors.length > 0) reject(new Error(errors.join('; ')));
					else resolve();
				}
			});
		}
	});
}

async function backupDatabase() {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const filename = `commons-backup-${timestamp}.dump.gz.enc`;
	const tmpPath = `/tmp/${filename}`;

	const dbUrl = process.env.DATABASE_URL;
	const backupKey = process.env.BACKUP_ENCRYPTION_KEY;
	const bucket = process.env.S3_BACKUP_BUCKET || 'commons-backups';
	const region = process.env.AWS_REGION || 'us-east-1';

	if (!dbUrl) throw new Error('DATABASE_URL required');
	if (!backupKey) throw new Error('BACKUP_ENCRYPTION_KEY required');

	console.log('[backup] Starting database backup...');

	const pgUrl = sanitizeForPgDump(dbUrl);

	// Shape diagnostics — value stays secret; only structure is logged.
	// Byte codes of the first 16 chars reveal BOMs, unicode, or odd prefixes
	// without exposing secret content. Printable ASCII passes through as-is;
	// anything else is reported as a hex code point.
	const firstBytes = [...pgUrl.slice(0, 16)]
		.map((c) => {
			const cp = c.codePointAt(0) ?? 0;
			return cp >= 0x20 && cp < 0x7f ? c : `<U+${cp.toString(16).padStart(4, '0')}>`;
		})
		.join('');
	const shape = {
		rawLen: dbUrl.length,
		cleanLen: pgUrl.length,
		leadingWhitespace: dbUrl !== dbUrl.trimStart(),
		trailingWhitespace: dbUrl !== dbUrl.trimEnd(),
		schemeMatch: /^[a-z][a-z0-9+.-]*:\/\//i.exec(pgUrl)?.[0] ?? '(no scheme)',
		keywordValue: /^\s*[a-z_]+\s*=/i.test(pgUrl),
		hasQuery: pgUrl.includes('?'),
		firstChar: pgUrl.length > 0 ? `${pgUrl[0]}=U+${pgUrl.codePointAt(0)!.toString(16)}` : '(empty)',
		first16: firstBytes,
	};
	console.log('[backup] DATABASE_URL shape:', JSON.stringify(shape));

	// pg_dump → gzip → openssl → file
	//
	// Spawn each process directly (no shell) so the connection string — which
	// regularly contains shell-special chars ($, ", ', space, !) in the
	// password — can never break quoting. pg_dump receives the URL as a single
	// argv element; the pipeline is wired in-process via stdio streams.
	await runPipeline(pgUrl, tmpPath);

	// Upload to S3
	const s3 = new S3Client({ region });
	const body = readFileSync(tmpPath);

	await s3.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: `daily/${filename}`,
			Body: body,
			ServerSideEncryption: 'AES256'
		})
	);

	console.log(
		`[backup] Uploaded to s3://${bucket}/daily/${filename} (${(body.length / 1024 / 1024).toFixed(1)} MB)`
	);

	// Cleanup
	unlinkSync(tmpPath);
	console.log('[backup] Complete');
}

backupDatabase().catch((err) => {
	console.error('[backup] FAILED:', err);
	process.exit(1);
});
