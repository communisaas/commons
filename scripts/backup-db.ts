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
 */

import { execSync } from 'child_process';
import { readFileSync, unlinkSync } from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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

	// pg_dump → gzip → encrypt → file
	execSync(
		`pg_dump --format=custom "${dbUrl}" | gzip | openssl enc -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_KEY -out "${tmpPath}"`,
		{ stdio: 'inherit' }
	);

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
