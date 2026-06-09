import { decryptOrgPii, type OrgEncryptedPii } from '$lib/core/crypto/org-pii-encryption';

export type EncryptedTextRecipient = {
	_id: string;
	encryptedPhone: string;
	emailHash: string;
	phoneHash?: string | null;
};

export type TextDispatchProgress = {
	total: number;
	ready: number;
	failed: number;
	status: 'decrypting' | 'sending' | 'complete' | 'error';
};

export type TextDispatchResult = {
	status: string;
	totalRecipients: number;
	sentCount: number;
	failedCount: number;
	deliveredCount?: number;
	batchSentCount?: number;
	batchFailedCount?: number;
	recordedCount?: number;
	message: string;
};

export type ClientTextDispatchOptions = {
	orgSlug: string;
	blastId: string;
	orgKey: CryptoKey;
	encryptedRecipients: EncryptedTextRecipient[];
	expectedTotalRecipients?: number;
	finalBatch?: boolean;
	onProgress?: (progress: TextDispatchProgress) => void;
};

const E164_RE = /^\+[1-9]\d{1,14}$/;

export async function sendTextBatchFromClient(
	options: ClientTextDispatchOptions
): Promise<TextDispatchResult> {
	const {
		orgSlug,
		blastId,
		orgKey,
		encryptedRecipients,
		expectedTotalRecipients,
		finalBatch,
		onProgress
	} = options;
	const total = encryptedRecipients.length;
	const failures: string[] = [];
	const decryptedRecipients: Array<{
		supporterId: string;
		phone: string;
		encryptedTo?: string;
		toHash?: string;
	}> = [];

	onProgress?.({ total, ready: 0, failed: 0, status: 'decrypting' });

	for (const recipient of encryptedRecipients) {
		try {
			const encrypted = JSON.parse(recipient.encryptedPhone) as OrgEncryptedPii;
			const phone = await decryptOrgPii(
				encrypted,
				orgKey,
				recipient.emailHash,
				`supporter:${recipient._id}`,
				'phone'
			);
			if (!E164_RE.test(phone)) {
				throw new Error('phone is not E.164');
			}
			decryptedRecipients.push({
				supporterId: recipient._id,
				phone,
				encryptedTo: recipient.encryptedPhone,
				toHash: recipient.phoneHash ?? undefined
			});
			onProgress?.({
				total,
				ready: decryptedRecipients.length,
				failed: failures.length,
				status: 'decrypting'
			});
		} catch (err) {
			failures.push(err instanceof Error ? err.message : 'phone decrypt failed');
			onProgress?.({
				total,
				ready: decryptedRecipients.length,
				failed: failures.length,
				status: 'decrypting'
			});
		}
	}

	if (failures.length > 0) {
		onProgress?.({ total, ready: decryptedRecipients.length, failed: failures.length, status: 'error' });
		throw new Error(
			`${failures.length} phone${failures.length === 1 ? '' : 's'} could not be prepared for carrier dispatch.`
		);
	}
	if (decryptedRecipients.length === 0) {
		onProgress?.({ total, ready: 0, failed: 0, status: 'error' });
		throw new Error('No subscribed encrypted phone recipients are eligible for this text draft.');
	}

	onProgress?.({ total, ready: decryptedRecipients.length, failed: 0, status: 'sending' });
	const response = await fetch(`/api/org/${orgSlug}/sms/${blastId}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			action: 'send',
			expectedTotalRecipients,
			finalBatch,
			decryptedRecipients
		})
	});

	if (!response.ok) {
		const body = await response.json().catch(() => null);
		const missing = Array.isArray(body?.missing) ? ` Missing: ${body.missing.join(', ')}.` : '';
		onProgress?.({
			total,
			ready: decryptedRecipients.length,
			failed: decryptedRecipients.length,
			status: 'error'
		});
		throw new Error(`${body?.message ?? body?.error ?? `Text dispatch failed (${response.status})`}${missing}`);
	}

	const result = (await response.json()) as TextDispatchResult;
	onProgress?.({
		total,
		ready: decryptedRecipients.length,
		failed: result.failedCount,
		status: 'complete'
	});
	return result;
}
