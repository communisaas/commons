/**
 * A/B test winner selection and winner blast dispatch.
 *
 * After the test duration elapses, picks the winning variant by the configured
 * metric (open rate, click rate, or verified action rate) and sends the winner
 * to the remaining (non-test) recipients.
 */

import { db } from '$lib/core/db';
import { sendBlast } from './engine';
import { getOrgUsage, isOverLimit } from '$lib/server/billing/usage';

export interface AbTestConfig {
	splitPct: number;          // % of test group going to variant A (rest to B)
	winnerMetric: 'open' | 'click' | 'verified_action';
	testDurationMs: number;    // ms to wait before picking winner
	testGroupPct: number;      // % of total recipients used for test (rest get winner)
}

/**
 * Pick the winning variant based on configured metric.
 * Returns 'A' or 'B'. Ties go to A.
 */
export async function pickAbWinner(parentId: string): Promise<'A' | 'B'> {
	const blasts = await db.emailBlast.findMany({
		where: { abParentId: parentId, abVariant: { in: ['A', 'B'] } }
	});

	const a = blasts.find((b) => b.abVariant === 'A');
	const b = blasts.find((b) => b.abVariant === 'B');

	if (!a || !b) throw new Error(`A/B test ${parentId}: missing variant blast`);

	const config = a.abTestConfig as unknown as AbTestConfig;

	// Edge case: if neither variant got any sends, default to A
	if (a.totalSent === 0 && b.totalSent === 0) return 'A';

	const scoreA = await computeScore(a, config.winnerMetric);
	const scoreB = await computeScore(b, config.winnerMetric);

	// Edge case: if both scores are 0 (no opens/clicks/actions), pick the one
	// with more sends (better deliverability). Ties go to A.
	if (scoreA === 0 && scoreB === 0) {
		return a.totalSent >= b.totalSent ? 'A' : 'B';
	}

	return scoreA >= scoreB ? 'A' : 'B';
}

async function computeScore(
	blast: { id: string; totalSent: number; totalOpened: number; totalClicked: number; campaignId: string | null },
	metric: string
): Promise<number> {
	const sent = blast.totalSent || 1; // avoid division by zero
	switch (metric) {
		case 'open':
			return blast.totalOpened / sent;
		case 'click':
			return blast.totalClicked / sent;
		case 'verified_action': {
			if (!blast.campaignId) return 0;
			// Count verified actions that came in after this blast was sent
			const blastRecord = await db.emailBlast.findUnique({
				where: { id: blast.id },
				select: { sentAt: true }
			});
			if (!blastRecord?.sentAt) return 0;
			const count = await db.campaignAction.count({
				where: {
					campaignId: blast.campaignId,
					verified: true,
					createdAt: { gte: blastRecord.sentAt }
				}
			});
			return count / sent;
		}
		default:
			return blast.totalOpened / sent;
	}
}

/**
 * Send the winning variant to the remaining (non-test) recipients.
 * Creates a new EmailBlast record with abVariant=null.
 */
export async function sendWinnerBlast(parentId: string, winner: 'A' | 'B'): Promise<void> {
	const winnerBlast = await db.emailBlast.findFirst({
		where: { abParentId: parentId, abVariant: winner }
	});

	if (!winnerBlast) throw new Error(`A/B test ${parentId}: winner blast not found`);

	// Check if winner already sent
	const existing = await db.emailBlast.findFirst({
		where: { abParentId: parentId, abVariant: null, status: { not: 'failed' } }
	});
	if (existing) return; // already dispatched

	// Mark winner picked on both variant blasts
	await db.emailBlast.updateMany({
		where: { abParentId: parentId, abVariant: { in: ['A', 'B'] } },
		data: { abWinnerPickedAt: new Date() }
	});

	// Get all recipient IDs already sent to in test groups
	const testBlasts = await db.emailBlast.findMany({
		where: { abParentId: parentId, abVariant: { in: ['A', 'B'] } },
		select: { recipientFilter: true }
	});

	// Collect test recipient IDs from recipientFilter.testRecipientIds
	const excludeIds: string[] = [];
	for (const tb of testBlasts) {
		const filter = tb.recipientFilter as Record<string, unknown> | null;
		if (filter && Array.isArray(filter.testRecipientIds)) {
			excludeIds.push(...(filter.testRecipientIds as string[]));
		}
	}

	// Create the winner blast targeting remaining recipients
	const remainderBlast = await db.emailBlast.create({
		data: {
			orgId: winnerBlast.orgId,
			campaignId: winnerBlast.campaignId,
			subject: winnerBlast.subject,
			bodyHtml: winnerBlast.bodyHtml,
			fromName: winnerBlast.fromName,
			fromEmail: winnerBlast.fromEmail,
			status: 'draft',
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			recipientFilter: {
				...((winnerBlast.recipientFilter as Record<string, unknown> | null) ?? {}),
				excludeIds
			} as any,
			totalRecipients: 0,
			isAbTest: true,
			abParentId: parentId,
			abVariant: null,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			abTestConfig: winnerBlast.abTestConfig as any
		}
	});

	// Billing usage check — skip send if org has exceeded email limits
	const usage = await getOrgUsage(winnerBlast.orgId);
	if (isOverLimit(usage).emails) {
		await db.emailBlast.update({
			where: { id: remainderBlast.id },
			data: { status: 'failed' }
		});
		console.warn(`[ab-winner] Remainder blast ${remainderBlast.id} skipped: org ${winnerBlast.orgId} over email limit`);
		return;
	}

	// Send asynchronously
	await sendBlast(remainderBlast.id);
}
