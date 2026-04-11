/**
 * Client-side email blast sender.
 *
 * Decrypts supporter emails with the org key in the browser,
 * batches them to the Lambda proxy with STS credentials,
 * and reports progress back to Convex.
 *
 * Used for blasts with <500 recipients where the admin is online.
 */

import { decryptWithOrgKey, type OrgEncryptedPii } from '$lib/core/crypto/org-pii-encryption';

export interface BlastSendOptions {
	orgSlug: string;
	orgId: string;
	blastId: string;
	orgKey: CryptoKey;
	subject: string;
	bodyHtml: string;
	fromEmail: string;
	fromName: string;
	lambdaUrl: string;
	encryptedSupporters: Array<{
		_id: string;
		encryptedEmail: string;
		emailHash: string;
	}>;
	onProgress?: (progress: BlastProgress) => void;
}

export interface BlastProgress {
	total: number;
	sent: number;
	failed: number;
	currentBatch: number;
	totalBatches: number;
	status: 'fetching-credentials' | 'decrypting' | 'sending' | 'complete' | 'error';
}

export interface BlastResult {
	total: number;
	sent: number;
	failed: number;
	errors: Array<{ emailHash: string; error: string }>;
}

const BATCH_SIZE = 50;

interface STSCredentials {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken: string;
	expiration: string;
}

interface LambdaResult {
	email: string;
	status: 'sent' | 'failed';
	messageId?: string;
	error?: string;
}

interface LambdaResponse {
	total: number;
	sent: number;
	failed: number;
	results: LambdaResult[];
}

export async function sendBlastFromClient(options: BlastSendOptions): Promise<BlastResult> {
	const {
		orgSlug,
		orgId,
		blastId,
		orgKey,
		subject,
		bodyHtml,
		fromEmail,
		fromName,
		lambdaUrl,
		encryptedSupporters,
		onProgress
	} = options;

	const total = encryptedSupporters.length;
	const totalBatches = Math.ceil(total / BATCH_SIZE);
	let sent = 0;
	let failed = 0;
	const errors: Array<{ emailHash: string; error: string }> = [];
	const sentHashes = new Set<string>();

	const report = (
		status: BlastProgress['status'],
		currentBatch: number
	) => {
		onProgress?.({ total, sent, failed, currentBatch, totalBatches, status });
	};

	// 1. Fetch STS credentials
	report('fetching-credentials', 0);
	const stsResponse = await fetch(`/api/org/${orgSlug}/ses-token`, { method: 'POST' });
	if (!stsResponse.ok) {
		const text = await stsResponse.text();
		throw new Error(`Failed to get SES credentials: ${stsResponse.status} ${text}`);
	}
	const credentials: STSCredentials = await stsResponse.json();

	// 2. Decrypt all supporter emails
	report('decrypting', 0);
	const decrypted: Array<{ email: string; emailHash: string }> = [];

	for (const supporter of encryptedSupporters) {
		// Skip already-sent hashes (dedup on retry)
		if (sentHashes.has(supporter.emailHash)) continue;

		try {
			const blob: OrgEncryptedPii = JSON.parse(supporter.encryptedEmail);
			const email = await decryptWithOrgKey(blob, orgKey, `supporter:${supporter._id}`, 'email');
			decrypted.push({ email, emailHash: supporter.emailHash });
		} catch (err) {
			failed++;
			errors.push({
				emailHash: supporter.emailHash,
				error: `Decryption failed: ${err instanceof Error ? err.message : 'Unknown'}`
			});
		}
	}

	// 3. Batch and send via Lambda proxy
	const batches: Array<typeof decrypted> = [];
	for (let i = 0; i < decrypted.length; i += BATCH_SIZE) {
		batches.push(decrypted.slice(i, i + BATCH_SIZE));
	}

	const batchRecords: Array<{
		batchIndex: number;
		status: string;
		sentCount: number;
		failedCount: number;
		error?: string;
		sentAt?: number;
	}> = [];

	for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
		const batch = batches[batchIdx];
		report('sending', batchIdx + 1);

		const recipients = batch.map((s) => s.email);

		try {
			const response = await fetch(lambdaUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					credentials,
					recipients,
					subject,
					bodyHtml,
					fromEmail,
					fromName,
					blastId
				})
			});

			if (!response.ok) {
				const text = await response.text();
				const batchFailed = batch.length;
				failed += batchFailed;
				for (const s of batch) {
					errors.push({ emailHash: s.emailHash, error: `Lambda ${response.status}: ${text}` });
				}
				batchRecords.push({
					batchIndex: batchIdx,
					status: 'failed',
					sentCount: 0,
					failedCount: batchFailed,
					error: `Lambda ${response.status}`
				});
				continue;
			}

			const result: LambdaResponse = await response.json();
			sent += result.sent;
			failed += result.failed;

			// Track sent hashes for dedup and collect errors
			for (const r of result.results) {
				const supporter = batch.find((s) => s.email === r.email);
				if (r.status === 'sent' && supporter) {
					sentHashes.add(supporter.emailHash);
				} else if (r.status === 'failed' && supporter) {
					errors.push({
						emailHash: supporter.emailHash,
						error: r.error || 'SES send failed'
					});
				}
			}

			batchRecords.push({
				batchIndex: batchIdx,
				status: result.failed > 0 ? 'failed' : 'sent',
				sentCount: result.sent,
				failedCount: result.failed,
				sentAt: Date.now()
			});
		} catch (err) {
			// Network error for this batch — don't abort remaining batches
			const batchFailed = batch.length;
			failed += batchFailed;
			const errMsg = err instanceof Error ? err.message : 'Network error';
			for (const s of batch) {
				errors.push({ emailHash: s.emailHash, error: errMsg });
			}
			batchRecords.push({
				batchIndex: batchIdx,
				status: 'failed',
				sentCount: 0,
				failedCount: batchFailed,
				error: errMsg
			});
		}
	}

	report('complete', totalBatches);

	return { total, sent, failed, errors };
}
