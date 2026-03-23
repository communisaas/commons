import { db } from '$lib/core/db';
import { sendEmail } from './ses';
import {
	compileEmail,
	buildTierContext,
	type MergeContext,
	type VerificationBlock
} from './compiler';
import { buildUnsubscribeUrl } from './unsubscribe';
import { computeVerificationPacket, computeOrgVerificationPacket } from '$lib/server/campaigns/verification';
import { tryDecryptSupporterEmail } from '$lib/core/crypto/user-pii-encryption';

const BATCH_SIZE = 100;
const SES_CONCURRENCY = 10;

const TIER_LABELS: Record<number, string> = {
	0: 'New',
	1: 'Active',
	2: 'Established',
	3: 'Veteran',
	4: 'Pillar'
};

export interface RecipientFilter {
	tagIds?: string[];
	verified?: 'any' | 'verified' | 'unverified';
	tierMinimum?: number;
	emailStatus?: string;
	testRecipientIds?: string[];  // A/B test: only send to these IDs
	excludeIds?: string[];        // A/B test: exclude these IDs (already in test group)
}

type Recipient = {
	id: string;
	email: string;
	name: string | null;
	postalCode: string | null;
	verified: boolean;
	identityCommitment: string | null;
	encrypted_email: string | null;
};

const RECIPIENT_SELECT = {
	id: true,
	email: true,
	name: true,
	postalCode: true,
	verified: true,
	identityCommitment: true,
	encrypted_email: true
} as const;

// ---------------------------------------------------------------------------
// Part 1: Shared filter builder (eliminates duplication between resolve/count)
// ---------------------------------------------------------------------------

function buildFilterWhere(
	orgId: string,
	filter: RecipientFilter | null
): Record<string, unknown> {
	const where: Record<string, unknown> = {
		orgId,
		emailStatus: 'subscribed'
	};

	if (filter) {
		if (filter.verified === 'verified') {
			where.verified = true;
			where.identityCommitment = { not: null };
		} else if (filter.verified === 'unverified') {
			where.OR = [{ verified: false }, { identityCommitment: null }];
		}

		if (filter.tagIds && filter.tagIds.length > 0) {
			where.tags = { some: { tagId: { in: filter.tagIds } } };
		}

		// A/B testing: only include specific recipient IDs (test group)
		if (filter.testRecipientIds && filter.testRecipientIds.length > 0) {
			where.id = { in: filter.testRecipientIds };
		}

		// A/B testing: exclude IDs already sent to in test groups
		if (filter.excludeIds && filter.excludeIds.length > 0) {
			if (where.id) {
				// Combine with existing ID filter using AND
				where.AND = [
					{ id: where.id },
					{ id: { notIn: filter.excludeIds } }
				];
				delete where.id;
			} else {
				where.id = { notIn: filter.excludeIds };
			}
		}
	}

	return where;
}

// ---------------------------------------------------------------------------
// Part 2: Cursor-paginated recipient streaming
// ---------------------------------------------------------------------------

/**
 * Yield supporters in cursor-paginated batches.
 * Each yield is an array of up to `batchSize` recipients.
 * Memory usage stays proportional to one batch, not the full result set.
 */
async function* streamRecipients(
	orgId: string,
	filter: RecipientFilter | null,
	batchSize = BATCH_SIZE
): AsyncGenerator<Recipient[], void, undefined> {
	const where = buildFilterWhere(orgId, filter);
	let cursor: string | undefined;

	while (true) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const batch: Recipient[] = await db.supporter.findMany({
			where: where as any,
			select: RECIPIENT_SELECT,
			orderBy: { id: 'asc' },
			take: batchSize,
			...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
		});

		if (batch.length === 0) break;
		yield batch;
		cursor = batch[batch.length - 1].id;
	}
}

/**
 * Query supporters matching the filter criteria.
 * Only includes supporters with emailStatus === 'subscribed'.
 *
 * Backward-compatible convenience wrapper — collects all pages into a single
 * array. For large result sets, prefer `streamRecipients` directly.
 */
export async function resolveRecipients(
	orgId: string,
	filter: RecipientFilter | null
): Promise<Recipient[]> {
	const all: Recipient[] = [];
	for await (const batch of streamRecipients(orgId, filter)) {
		all.push(...batch);
	}
	return all;
}

/**
 * Count supporters matching filter criteria (for real-time preview).
 */
export async function countRecipients(
	orgId: string,
	filter: RecipientFilter | null
): Promise<number> {
	const where = buildFilterWhere(orgId, filter);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return db.supporter.count({ where: where as any });
}

// ---------------------------------------------------------------------------
// Part 3: Inline concurrency limiter (no external dependency)
// ---------------------------------------------------------------------------

function pLimit(concurrency: number) {
	let active = 0;
	const queue: Array<() => void> = [];

	return <T>(fn: () => Promise<T>): Promise<T> => {
		return new Promise<T>((resolve, reject) => {
			const run = () => {
				active++;
				fn().then(resolve, reject).finally(() => {
					active--;
					if (queue.length > 0) queue.shift()!();
				});
			};
			if (active < concurrency) run();
			else queue.push(run);
		});
	};
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Build the verification block from a packet.
 */
function buildVerificationBlock(
	packet: { total: number; verified: number; verifiedPct: number; districtCount: number; tiers: Array<{ tier: number; label: string; count: number }> },
	totalRecipients: number
): VerificationBlock {
	const tierParts = [...packet.tiers]
		.filter((t) => t.count > 0)
		.sort((a, b) => b.tier - a.tier)
		.map((t) => `${t.count} ${t.label}`);

	return {
		totalRecipients,
		verifiedCount: packet.verified,
		verifiedPct: packet.verifiedPct,
		districtCount: packet.districtCount,
		tierSummary: tierParts.join(', ')
	};
}

/**
 * Derive verification status from supporter fields.
 */
function deriveVerificationStatus(
	verified: boolean,
	identityCommitment: string | null,
	postalCode: string | null
): 'verified' | 'postal-resolved' | 'imported' {
	if (verified && identityCommitment) return 'verified';
	if (postalCode) return 'postal-resolved';
	return 'imported';
}

/**
 * Split a name string into first/last parts.
 */
function splitName(name: string | null): { firstName: string; lastName: string } {
	if (!name) return { firstName: 'Supporter', lastName: '' };
	const parts = name.trim().split(/\s+/);
	if (parts.length === 1) return { firstName: parts[0], lastName: '' };
	return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * Compile and send a single email to one recipient.
 * Returns { success, error? } consistent with SES send result.
 */
async function compileAndSendToRecipient(
	recipient: Recipient,
	blast: { fromEmail: string; fromName: string; subject: string; bodyHtml: string; orgId: string },
	verificationBlock: VerificationBlock
): Promise<{ success: boolean; error?: string }> {
	const decryptedEmail = await tryDecryptSupporterEmail(recipient);
	const { firstName, lastName } = splitName(recipient.name);
	const verificationStatus = deriveVerificationStatus(
		recipient.verified,
		recipient.identityCommitment,
		recipient.postalCode
	);

	const merge: MergeContext = {
		firstName,
		lastName,
		email: decryptedEmail,
		postalCode: recipient.postalCode,
		verificationStatus,
		tierLabel: null,
		tierContext: buildTierContext(verificationStatus)
	};

	const unsubscribeUrl = buildUnsubscribeUrl(recipient.id, blast.orgId);
	const htmlBody = compileEmail(blast.bodyHtml, merge, verificationBlock, unsubscribeUrl);
	return sendEmail(
		decryptedEmail,
		blast.fromEmail,
		blast.fromName,
		blast.subject,
		htmlBody,
		unsubscribeUrl
	);
}

// ---------------------------------------------------------------------------
// Part 4: Streaming sendBlast with parallel SES sends
// ---------------------------------------------------------------------------

/**
 * Send an email blast: stream recipients in cursor-paginated batches,
 * compile per-recipient emails, send via SES with controlled parallelism.
 */
export async function sendBlast(blastId: string): Promise<void> {
	// Atomic: only proceed if we're the one who transitions draft → sending
	const { count } = await db.emailBlast.updateMany({
		where: { id: blastId, status: 'draft' },
		data: { status: 'sending' }
	});
	if (count === 0) return; // Already sending/sent or doesn't exist

	// Load the blast (now guaranteed status='sending' by us)
	const blast = await db.emailBlast.findUnique({ where: { id: blastId } });
	if (!blast) return;

	try {
		const filter = blast.recipientFilter as RecipientFilter | null;

		// 2. Get total count up-front (cheap COUNT query, no OOM risk)
		const totalRecipients = await countRecipients(blast.orgId, filter);

		await db.emailBlast.update({
			where: { id: blastId },
			data: { totalRecipients }
		});

		if (totalRecipients === 0) {
			await db.emailBlast.update({
				where: { id: blastId },
				data: { status: 'sent', sentAt: new Date(), totalSent: 0 }
			});
			return;
		}

		// 3. Compute verification context
		let packet;
		if (blast.campaignId) {
			packet = await computeVerificationPacket(blast.campaignId, blast.orgId);
		} else {
			packet = await computeOrgVerificationPacket(blast.orgId);
		}

		const verificationBlock = buildVerificationBlock(packet, totalRecipients);

		// Store verification context on blast
		await db.emailBlast.update({
			where: { id: blastId },
			data: {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			verificationContext: verificationBlock as any
			}
		});

		// 4. Stream recipients and process batches with parallel sends
		const limit = pLimit(SES_CONCURRENCY);
		let totalSent = 0;
		let totalBounced = 0;
		let batchIndex = 0;

		for await (const batch of streamRecipients(blast.orgId, filter)) {
			// Create batch record on-the-fly
			const batchRecord = await db.emailBatch.create({
				data: {
					blastId,
					batchIndex,
					status: 'sending'
				}
			});

			// Batch recheck email status (1 query per batch, not per recipient)
			const statuses = await db.supporter.findMany({
				where: { id: { in: batch.map((r) => r.id) } },
				select: { id: true, emailStatus: true }
			});
			const statusMap = new Map(statuses.map((s) => [s.id, s.emailStatus]));
			const activeBatch = batch.filter((r) => statusMap.get(r.id) === 'subscribed');

			// Parallel sends within this batch
			const results = await Promise.allSettled(
				activeBatch.map((recipient) =>
					limit(() => compileAndSendToRecipient(recipient, blast, verificationBlock))
				)
			);

			let batchSent = 0;
			let batchFailed = 0;
			let lastError: string | null = null;

			for (const result of results) {
				if (result.status === 'fulfilled' && result.value.success) {
					batchSent++;
				} else {
					batchFailed++;
					if (result.status === 'fulfilled') {
						lastError = result.value.error ?? 'Unknown error';
					} else {
						lastError = result.reason instanceof Error
							? result.reason.message
							: 'Unknown error';
					}
				}
			}

			await db.emailBatch.update({
				where: { id: batchRecord.id },
				data: {
					status: batchFailed === batch.length ? 'failed' : 'sent',
					sentCount: batchSent,
					failedCount: batchFailed,
					error: lastError,
					sentAt: new Date()
				}
			});

			totalSent += batchSent;
			totalBounced += batchFailed;
			batchIndex++;
		}

		// 5. Finalize blast
		await db.emailBlast.update({
			where: { id: blastId },
			data: {
				status: 'sent',
				totalSent,
				totalBounced,
				sentAt: new Date()
			}
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		await db.emailBlast.update({
			where: { id: blastId },
			data: { status: 'failed' }
		});
		console.error(`[email-engine] Blast ${blastId} failed:`, message);
	}
}
