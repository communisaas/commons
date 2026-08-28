import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';

export const SMS_AUDIENCE_MAX_RECIPIENTS = 10_000;
export const SMS_AUDIENCE_MAX_SCANNED = 10_000;

export type SmsAudienceFilter = {
	tags?: Id<'tags'>[];
	segments?: Id<'segments'>[];
	excludeTags?: Id<'tags'>[];
};

type SmsAudiencePage = {
	pageCount: number;
	continueCursor: string | null;
	isDone: boolean;
	scannedCount: number;
	batchLimit: number;
	source: string;
};

function assertPage(
	page: SmsAudiencePage,
	cursor: string | null,
	totalScanned: number
): string | null {
	if (!Number.isSafeInteger(page.pageCount) || page.pageCount < 0) {
		throw new Error('SMS_AUDIENCE_PAGE_COUNT_INVALID');
	}
	if (!Number.isSafeInteger(page.batchLimit) || page.batchLimit < 1 || page.batchLimit > 100) {
		throw new Error('SMS_AUDIENCE_BATCH_LIMIT_INVALID');
	}
	const aggregate = page.source === 'organizations.supporterStats.smsDispatchEligible';
	if (aggregate) {
		if (
			cursor !== null ||
			page.scannedCount !== 0 ||
			!page.isDone ||
			page.continueCursor !== null
		) {
			throw new Error('SMS_AUDIENCE_AGGREGATE_BOUNDARY_INVALID');
		}
		return null;
	}
	if (page.source !== 'sms.pageSmsRecipients') {
		throw new Error('SMS_AUDIENCE_SOURCE_INVALID');
	}
	if (
		!Number.isSafeInteger(page.scannedCount) ||
		page.scannedCount < 0 ||
		page.scannedCount > 100 ||
		page.pageCount > page.scannedCount
	) {
		throw new Error('SMS_AUDIENCE_PAGE_BOUNDARY_INVALID');
	}
	if (totalScanned > SMS_AUDIENCE_MAX_SCANNED) {
		throw new Error('SMS_AUDIENCE_SCAN_LIMIT_EXCEEDED');
	}
	if (page.isDone) {
		if (page.continueCursor !== null) throw new Error('SMS_AUDIENCE_CURSOR_TERMINAL_INVALID');
		return null;
	}
	if (!page.continueCursor || page.continueCursor === cursor) {
		throw new Error('SMS_AUDIENCE_CURSOR_DID_NOT_ADVANCE');
	}
	if (totalScanned >= SMS_AUDIENCE_MAX_SCANNED) {
		throw new Error('SMS_AUDIENCE_SCAN_LIMIT_EXCEEDED');
	}
	return page.continueCursor;
}

/**
 * Exact, bounded audience count orchestrated outside Convex transactions.
 * Every Convex query reads one indexed page only; the continuation cursor is
 * carried across requests, so sparse filters never rebuild an earlier window.
 */
export async function countSmsAudience(
	slug: string,
	recipientFilter?: SmsAudienceFilter
): Promise<{
	eligibleCount: number;
	batchLimit: number;
	hasMoreThanBatchLimit: boolean;
	source: string;
}> {
	let cursor: string | null = null;
	let totalScanned = 0;
	let eligibleCount = 0;
	let batchLimit = 100;
	let source = 'sms.pageSmsRecipients';
	for (;;) {
		const page = (await serverQuery(api.sms.countEligibleRecipientsForFilter, {
			slug,
			recipientFilter,
			cursor
		})) as SmsAudiencePage;
		totalScanned += page.scannedCount;
		eligibleCount += page.pageCount;
		batchLimit = page.batchLimit;
		source = page.source;
		if (eligibleCount > SMS_AUDIENCE_MAX_RECIPIENTS) {
			throw new Error('SMS_AUDIENCE_COHORT_TOO_LARGE');
		}
		const next = assertPage(page, cursor, totalScanned);
		if (page.isDone) {
			return {
				eligibleCount,
				batchLimit,
				hasMoreThanBatchLimit: eligibleCount > batchLimit,
				source
			};
		}
		cursor = next;
	}
}
