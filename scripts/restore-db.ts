/**
 * Database Restore Script
 *
 * Downloads an encrypted backup from S3, decrypts, decompresses,
 * and restores into the target PostgreSQL database.
 *
 * Usage: npx tsx scripts/restore-db.ts <s3-key> <target-db-url>
 *
 * Example:
 *   npx tsx scripts/restore-db.ts daily/commons-backup-2026-03-23.dump.gz.enc postgresql://user:pass@localhost:5432/commons_test
 *
 * Required env vars:
 *   BACKUP_ENCRYPTION_KEY  - Passphrase used during backup encryption
 *   S3_BACKUP_BUCKET       - S3 bucket name (default: commons-backups)
 *   AWS_REGION             - AWS region (default: us-east-1)
 *   AWS_ACCESS_KEY_ID      - AWS credentials
 *   AWS_SECRET_ACCESS_KEY  - AWS credentials
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

async function restoreDatabase() {
	const backupKey = process.argv[2]; // S3 key like "daily/commons-backup-2026-03-23.dump.gz.enc"
	const targetDb = process.argv[3]; // target database URL

	if (!backupKey || !targetDb) {
		console.error('Usage: npx tsx scripts/restore-db.ts <s3-key> <target-db-url>');
		console.error(
			'Example: npx tsx scripts/restore-db.ts daily/commons-backup-2026-03-23.dump.gz.enc postgresql://user:pass@localhost:5432/commons_test'
		);
		process.exit(1);
	}

	const encKey = process.env.BACKUP_ENCRYPTION_KEY;
	if (!encKey) throw new Error('BACKUP_ENCRYPTION_KEY required');

	const bucket = process.env.S3_BACKUP_BUCKET || 'commons-backups';
	const region = process.env.AWS_REGION || 'us-east-1';
	const tmpPath = `/tmp/restore-${Date.now()}.dump.gz.enc`;

	console.log(`[restore] Downloading ${backupKey}...`);

	const s3 = new S3Client({ region });
	const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: backupKey }));
	const body = await response.Body?.transformToByteArray();
	if (!body) throw new Error('Empty backup file');

	writeFileSync(tmpPath, body);

	console.log(`[restore] Decrypting and restoring to ${targetDb.replace(/:[^:@]*@/, ':***@')}...`);

	execSync(
		`openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_KEY -in "${tmpPath}" | gunzip | pg_restore --format=custom --clean --if-exists -d "${targetDb}"`,
		{ stdio: 'inherit' }
	);

	unlinkSync(tmpPath);
	console.log('[restore] Complete. Run integration tests to validate.');
}

restoreDatabase().catch((err) => {
	console.error('[restore] FAILED:', err);
	process.exit(1);
});
