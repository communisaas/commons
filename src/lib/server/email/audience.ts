import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';

export const EMAIL_AUDIENCE_MAX_RECIPIENTS = 10_000;
export const EMAIL_AUDIENCE_MAX_SCANNED = 10_000;

export type EmailAudienceFilter = {
	tagIds?: Id<'tags'>[];
	segmentIds?: Id<'segments'>[];
	verified?: 'any' | 'verified' | 'unverified';
	includeEmailHashes?: string[];
	excludeEmailHashes?: string[];
};

type AudiencePageBase = {
	continueCursor: string | null;
	isDone: boolean;
	scannedCount: number;
};

function assertProgress(
	page: AudiencePageBase,
	cursor: string | null,
	scanned: number
): string | null {
	if (
		!Number.isSafeInteger(page.scannedCount) ||
		page.scannedCount < 0 ||
		page.scannedCount > 100
	) {
		throw new Error('EMAIL_AUDIENCE_PAGE_BOUNDARY_INVALID');
	}
	if (scanned > EMAIL_AUDIENCE_MAX_SCANNED) {
		throw new Error('EMAIL_AUDIENCE_SCAN_LIMIT_EXCEEDED');
	}
	if (page.isDone) {
		if (page.continueCursor !== null) throw new Error('EMAIL_AUDIENCE_CURSOR_TERMINAL_INVALID');
		return null;
	}
	if (!page.continueCursor || page.continueCursor === cursor) {
		throw new Error('EMAIL_AUDIENCE_CURSOR_DID_NOT_ADVANCE');
	}
	if (scanned >= EMAIL_AUDIENCE_MAX_SCANNED) {
		throw new Error('EMAIL_AUDIENCE_SCAN_LIMIT_EXCEEDED');
	}
	return page.continueCursor;
}

export async function countEmailAudience(
	orgSlug: string,
	recipientFilter: EmailAudienceFilter
): Promise<{ totalCount: number; sourceCounts: Record<string, number> }> {
	let cursor: string | null = null;
	let scanned = 0;
	let totalCount = 0;
	const sourceCounts: Record<string, number> = {};
	for (;;) {
		const page = (await serverQuery(api.email.countRecipientsForFilter, {
			orgSlug,
			recipientFilter,
			cursor
		})) as AudiencePageBase & { pageCount: number; sourceCounts: Record<string, number> };
		if (!Number.isSafeInteger(page.pageCount) || page.pageCount < 0 || page.pageCount > 100) {
			throw new Error('EMAIL_AUDIENCE_PAGE_COUNT_INVALID');
		}
		scanned += page.scannedCount;
		totalCount += page.pageCount;
		if (totalCount > EMAIL_AUDIENCE_MAX_RECIPIENTS) {
			throw new Error('EMAIL_AUDIENCE_COHORT_TOO_LARGE');
		}
		for (const [source, count] of Object.entries(page.sourceCounts ?? {})) {
			if (!Number.isSafeInteger(count) || count < 0 || count > page.pageCount) {
				throw new Error('EMAIL_AUDIENCE_SOURCE_COUNT_INVALID');
			}
			sourceCounts[source] = (sourceCounts[source] ?? 0) + count;
		}
		const next = assertProgress(page, cursor, scanned);
		if (page.isDone) return { totalCount, sourceCounts };
		cursor = next;
	}
}

export async function resolveEmailAudienceHashes(
	orgSlug: string,
	recipientFilter: EmailAudienceFilter
): Promise<string[]> {
	let cursor: string | null = null;
	let scanned = 0;
	const hashes: string[] = [];
	for (;;) {
		const page = (await serverQuery(api.email.resolveRecipientHashesForFilter, {
			orgSlug,
			recipientFilter,
			cursor
		})) as AudiencePageBase & { emailHashes: string[]; pageCount: number };
		if (!Array.isArray(page.emailHashes) || page.emailHashes.length !== page.pageCount) {
			throw new Error('EMAIL_AUDIENCE_HASH_PAGE_INVALID');
		}
		scanned += page.scannedCount;
		hashes.push(...page.emailHashes);
		if (hashes.length > EMAIL_AUDIENCE_MAX_RECIPIENTS) {
			throw new Error('EMAIL_AUDIENCE_COHORT_TOO_LARGE');
		}
		const next = assertProgress(page, cursor, scanned);
		if (page.isDone) return hashes.sort();
		cursor = next;
	}
}
