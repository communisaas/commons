/**
 * Client-side email blast sender.
 *
 * Decrypts supporter emails with the org key in the browser,
 * batches them to the Lambda proxy with STS credentials,
 * and reports progress back to Convex.
 *
 * Used for blasts at or under the client-direct threshold (500 recipients)
 * where the admin is online.
 */

import { decryptOrgPii, type OrgEncryptedPii } from '$lib/core/crypto/org-pii-encryption';
import {
	applyEmailMergeFields,
	buildEmailTierContext,
	hasEmailMergeFields,
	type VerificationStatus
} from '$lib/core/email/merge-fields';

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
		encryptedName?: string;
		postalCode?: string | null;
		verified?: boolean;
	}>;
	onProgress?: (progress: BlastProgress) => void;
	/**
	 * Optional sink for per-recipient send receipts. Invoked after each Lambda
	 * batch with the resolved {sesMessageId | error, status, sentAt} per
	 * recipient. Caller persists via `api.blasts.recordBlastReceipts` so the
	 * receipt register has a durable per-recipient row even when the browser
	 * session ends mid-blast.
	 */
	onBatchReceipts?: (
		receipts: Array<{
			recipientEmailHash: string;
			sesMessageId?: string;
			status: 'sent' | 'failed';
			sentAt: number;
			error?: string;
		}>
	) => Promise<void> | void;
	/**
	 * Optional resolver for per-recipient unsubscribe URLs. When provided,
	 * each Lambda batch is preceded by a call to fetch URLs for the batch's
	 * supporter ids; URLs flow into Lambda 1:1 with recipients and Lambda
	 * injects them as `List-Unsubscribe` MIME headers  (Lambda-side cure path,
	 * Gmail/Yahoo bulk-sender compliance). When omitted, Lambda falls back to
	 * SendEmail without the header.
	 */
	resolveUnsubscribeUrls?: (supporterIds: string[]) => Promise<string[]>;
	/**
	 * Server-signed dispatch claim. Lambda HARD-REQUIRES this — every
	 * recipient hash must be present in the claim's allowed-hash set
	 * before SES dispatch (bounds the blast-send oracle even when the
	 * browser holds 15-minute STS credentials). Caller obtains via
	 * `/api/blast/[blastId]/dispatch-claim`. Marked optional in the
	 * TypeScript interface for back-compat with older callers, but
	 * Lambda will return 403 "Dispatch claim required" if omitted —
	 * any production caller MUST supply this.
	 */
	dispatchClaim?: string;
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
		onProgress,
		onBatchReceipts,
		resolveUnsubscribeUrls,
		dispatchClaim
	} = options;

	const total = encryptedSupporters.length;
	const usesMergePersonalization = hasEmailMergeFields(subject) || hasEmailMergeFields(bodyHtml);
	const effectiveBatchSize = usesMergePersonalization ? 1 : BATCH_SIZE;
	const totalBatches = Math.ceil(total / effectiveBatchSize);
	let sent = 0;
	let failed = 0;
	const errors: Array<{ emailHash: string; error: string }> = [];
	const sentHashes = new Set<string>();

	const report = (status: BlastProgress['status'], currentBatch: number) => {
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
	const decrypted: Array<{
		email: string;
		emailHash: string;
		supporterId: string;
		firstName: string;
		lastName: string;
		postalCode: string | null;
		verificationStatus: VerificationStatus;
	}> = [];
	const decryptFailures: Array<{
		recipientEmailHash: string;
		status: 'failed';
		sentAt: number;
		error: string;
	}> = [];

	for (const supporter of encryptedSupporters) {
		// Skip already-sent hashes (dedup on retry)
		if (sentHashes.has(supporter.emailHash)) continue;

		try {
			const blob: OrgEncryptedPii = JSON.parse(supporter.encryptedEmail);
			// Version-aware dispatcher: v=org-2 (single-phase writes) uses
			// emailHash AAD; v=org-1 (legacy + pre-migration) falls back to
			// the post-insert `supporter:${_id}` AAD.
			const email = await decryptOrgPii(
				blob,
				orgKey,
				supporter.emailHash,
				`supporter:${supporter._id}`,
				'email'
			);
			let firstName = '';
			let lastName = '';
			if (supporter.encryptedName) {
				try {
					const nameBlob: OrgEncryptedPii = JSON.parse(supporter.encryptedName);
					const fullName = await decryptOrgPii(
						nameBlob,
						orgKey,
						supporter.emailHash,
						`supporter:${supporter._id}`,
						'name'
					);
					const trimmed = fullName.trim();
					const splitAt = trimmed.indexOf(' ');
					if (splitAt === -1) {
						firstName = trimmed;
					} else {
						firstName = trimmed.slice(0, splitAt);
						lastName = trimmed.slice(splitAt + 1).trim();
					}
				} catch {
					// Name is optional personalization context. Email delivery can
					// still proceed with empty first/last merge values.
				}
			}
			const verificationStatus: VerificationStatus = supporter.verified
				? 'verified'
				: supporter.postalCode
					? 'postal-resolved'
					: 'imported';
			decrypted.push({
				email,
				emailHash: supporter.emailHash,
				supporterId: supporter._id,
				firstName,
				lastName,
				postalCode: supporter.postalCode ?? null,
				verificationStatus
			});
		} catch (err) {
			failed++;
			const errMsg = `Decryption failed: ${err instanceof Error ? err.message : 'Unknown'}`;
			errors.push({ emailHash: supporter.emailHash, error: errMsg });
			decryptFailures.push({
				recipientEmailHash: supporter.emailHash,
				status: 'failed',
				sentAt: Date.now(),
				error: errMsg
			});
		}
	}

	// Persist pre-dispatch decryption failures as receipts so the durable
	// register reconciles with the in-memory `failed` counter.
	if (onBatchReceipts && decryptFailures.length > 0) {
		await onBatchReceipts(decryptFailures);
	}

	// 3. Batch and send via Lambda proxy
	const batches: Array<typeof decrypted> = [];
	for (let i = 0; i < decrypted.length; i += effectiveBatchSize) {
		batches.push(decrypted.slice(i, i + effectiveBatchSize));
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
		const batchSubject = usesMergePersonalization
			? applyEmailMergeFields(
					subject,
					{
						firstName: batch[0]?.firstName ?? '',
						lastName: batch[0]?.lastName ?? '',
						email: batch[0]?.email ?? '',
						postalCode: batch[0]?.postalCode ?? null,
						verificationStatus: batch[0]?.verificationStatus ?? 'imported',
						tierContext: buildEmailTierContext(batch[0]?.verificationStatus ?? 'imported')
					},
					'header'
				)
			: subject;
		const batchBodyHtml = usesMergePersonalization
			? applyEmailMergeFields(bodyHtml, {
					firstName: batch[0]?.firstName ?? '',
					lastName: batch[0]?.lastName ?? '',
					email: batch[0]?.email ?? '',
					postalCode: batch[0]?.postalCode ?? null,
					verificationStatus: batch[0]?.verificationStatus ?? 'imported',
					tierContext: buildEmailTierContext(batch[0]?.verificationStatus ?? 'imported')
				})
			: bodyHtml;

		// Fetch per-recipient unsubscribe URLs once per batch when a resolver
		// is wired. Lambda will inject these as `List-Unsubscribe` MIME
		// headers; absent the resolver Lambda falls back to plain SendEmail.
		let unsubscribeUrls: string[] | undefined;
		if (resolveUnsubscribeUrls) {
			try {
				unsubscribeUrls = await resolveUnsubscribeUrls(batch.map((s) => s.supporterId));
				if (unsubscribeUrls.length !== batch.length) {
					console.warn(
						`[blast] unsubscribe URL count mismatch (${unsubscribeUrls.length} vs batch ${batch.length}); dropping headers for this batch`
					);
					unsubscribeUrls = undefined;
				}
			} catch (err) {
				console.warn(
					'[blast] unsubscribe URL resolver failed; sending without List-Unsubscribe header',
					err
				);
				unsubscribeUrls = undefined;
			}
		}

		try {
			const response = await fetch(lambdaUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					credentials,
					recipients,
					recipientHashes: batch.map((s) => s.emailHash),
					subject: batchSubject,
					bodyHtml: batchBodyHtml,
					fromEmail,
					fromName,
					blastId,
					unsubscribeUrls,
					dispatchClaim
				})
			});

			if (!response.ok) {
				const text = await response.text();
				const batchFailed = batch.length;
				failed += batchFailed;
				const sentAt = Date.now();
				const lambdaError = `Lambda ${response.status}: ${text}`;
				for (const s of batch) {
					errors.push({ emailHash: s.emailHash, error: lambdaError });
				}
				batchRecords.push({
					batchIndex: batchIdx,
					status: 'failed',
					sentCount: 0,
					failedCount: batchFailed,
					error: `Lambda ${response.status}`
				});
				if (onBatchReceipts) {
					await onBatchReceipts(
						batch.map((s) => ({
							recipientEmailHash: s.emailHash,
							status: 'failed' as const,
							sentAt,
							error: lambdaError
						}))
					);
				}
				continue;
			}

			const result: LambdaResponse = await response.json();
			sent += result.sent;
			failed += result.failed;
			const sentAt = Date.now();

			// Track sent hashes for dedup and collect errors
			const receipts: Array<{
				recipientEmailHash: string;
				sesMessageId?: string;
				status: 'sent' | 'failed';
				sentAt: number;
				error?: string;
			}> = [];
			for (const r of result.results) {
				const supporter = batch.find((s) => s.email === r.email);
				if (!supporter) continue;
				if (r.status === 'sent') {
					sentHashes.add(supporter.emailHash);
					receipts.push({
						recipientEmailHash: supporter.emailHash,
						sesMessageId: r.messageId,
						status: 'sent',
						sentAt
					});
				} else {
					errors.push({
						emailHash: supporter.emailHash,
						error: r.error || 'SES send failed'
					});
					receipts.push({
						recipientEmailHash: supporter.emailHash,
						status: 'failed',
						sentAt,
						error: r.error || 'SES send failed'
					});
				}
			}

			batchRecords.push({
				batchIndex: batchIdx,
				status: result.failed > 0 ? 'failed' : 'sent',
				sentCount: result.sent,
				failedCount: result.failed,
				sentAt
			});

			if (onBatchReceipts && receipts.length > 0) {
				await onBatchReceipts(receipts);
			}
		} catch (err) {
			// Network error for this batch — don't abort remaining batches.
			// Note: this branch fires when fetch() throws (timeout, abort,
			// CORS, DNS). The Lambda may have actually delivered the message;
			// we record the receipts as 'failed' here because the browser
			// cannot confirm delivery, and a later reconciliation pass over
			// SES events will repair status if the messages did land.
			const batchFailed = batch.length;
			failed += batchFailed;
			const errMsg = err instanceof Error ? err.message : 'Network error';
			const sentAt = Date.now();
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
			if (onBatchReceipts) {
				await onBatchReceipts(
					batch.map((s) => ({
						recipientEmailHash: s.emailHash,
						status: 'failed' as const,
						sentAt,
						error: errMsg
					}))
				);
			}
		}
	}

	report('complete', totalBatches);

	return { total, sent, failed, errors };
}
