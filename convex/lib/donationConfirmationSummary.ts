import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export const DONATION_CONFIRMATION_SUMMARY_VERSION = 1;
export const DONATION_CONFIRMATION_SUMMARY_MIGRATION_KEY =
	'donation-confirmation-summary-v1' as const;

export type DonationConfirmationCounts = {
	completed: number;
	sent: number;
	sending: number;
	skipped: number;
	failed: number;
	notRecorded: number;
	providerAccepted: number;
};

export type DonationSummarySource = Pick<
	Doc<'donations'>,
	| 'orgId'
	| 'campaignId'
	| 'status'
	| 'confirmationEmailStatus'
	| 'confirmationEmailProviderMessageId'
	| 'confirmationSummaryVersion'
>;

const COUNT_KEYS = [
	'completed',
	'sent',
	'sending',
	'skipped',
	'failed',
	'notRecorded',
	'providerAccepted'
] as const;

export function emptyDonationConfirmationCounts(): DonationConfirmationCounts {
	return {
		completed: 0,
		sent: 0,
		sending: 0,
		skipped: 0,
		failed: 0,
		notRecorded: 0,
		providerAccepted: 0
	};
}

export function donationConfirmationContribution(
	donation: DonationSummarySource
): DonationConfirmationCounts {
	const counts = emptyDonationConfirmationCounts();
	if (donation.status !== 'completed') return counts;
	counts.completed = 1;
	if (donation.confirmationEmailProviderMessageId) counts.providerAccepted = 1;
	switch (donation.confirmationEmailStatus) {
		case 'sent':
			counts.sent = 1;
			break;
		case 'sending':
			counts.sending = 1;
			break;
		case 'skipped':
			counts.skipped = 1;
			break;
		case 'failed':
			counts.failed = 1;
			break;
		default:
			counts.notRecorded = 1;
	}
	return counts;
}

export function donationConfirmationScopeKey(scope: {
	orgId: Id<'organizations'>;
	campaignId?: Id<'campaigns'>;
}): string {
	return scope.campaignId ? `campaign:${scope.campaignId}` : `org:${scope.orgId}`;
}

export async function getDonationConfirmationSummaryMigration(ctx: QueryCtx | MutationCtx) {
	return await ctx.db
		.query('donationConfirmationSummaryMigrations')
		.withIndex('by_key', (q) => q.eq('key', DONATION_CONFIRMATION_SUMMARY_MIGRATION_KEY))
		.unique();
}

async function applyScopeDelta(
	ctx: MutationCtx,
	scope: { orgId: Id<'organizations'>; campaignId?: Id<'campaigns'> },
	delta: DonationConfirmationCounts,
	now: number
): Promise<void> {
	if (COUNT_KEYS.every((key) => delta[key] === 0)) return;
	const scopeKey = donationConfirmationScopeKey(scope);
	const current = await ctx.db
		.query('donationConfirmationSummaries')
		.withIndex('by_scopeKey', (q) => q.eq('scopeKey', scopeKey))
		.unique();
	const next = emptyDonationConfirmationCounts();
	for (const key of COUNT_KEYS) {
		next[key] = (current?.[key] ?? 0) + delta[key];
		if (!Number.isSafeInteger(next[key]) || next[key] < 0) {
			throw new Error(`DONATION_CONFIRMATION_SUMMARY_INVARIANT:${scopeKey}:${key}`);
		}
	}
	if (current) {
		await ctx.db.patch(current._id, {
			...next,
			version: DONATION_CONFIRMATION_SUMMARY_VERSION,
			updatedAt: now
		});
		return;
	}
	await ctx.db.insert('donationConfirmationSummaries', {
		scopeKey,
		orgId: scope.orgId,
		campaignId: scope.campaignId,
		...next,
		version: DONATION_CONFIRMATION_SUMMARY_VERSION,
		updatedAt: now
	});
}

/**
 * Apply one donation's before/after contribution to both its organization and
 * campaign summaries. An unmarked legacy `before` contributes zero: the writer
 * adopts the row's complete post-transition state and marks it atomically, so
 * the later migration skips it without double counting.
 */
export async function applyDonationConfirmationTransition(
	ctx: MutationCtx,
	before: DonationSummarySource | null,
	after: DonationSummarySource | null,
	now: number
): Promise<void> {
	const deltas = new Map<
		string,
		{
			scope: { orgId: Id<'organizations'>; campaignId?: Id<'campaigns'> };
			counts: DonationConfirmationCounts;
		}
	>();
	const add = (
		source: DonationSummarySource,
		counts: DonationConfirmationCounts,
		multiplier: 1 | -1
	) => {
		const scopes: Array<{
			orgId: Id<'organizations'>;
			campaignId?: Id<'campaigns'>;
		}> = [{ orgId: source.orgId }];
		if (source.campaignId) scopes.push({ orgId: source.orgId, campaignId: source.campaignId });
		for (const scope of scopes) {
			const key = donationConfirmationScopeKey(scope);
			const entry = deltas.get(key) ?? { scope, counts: emptyDonationConfirmationCounts() };
			for (const countKey of COUNT_KEYS) entry.counts[countKey] += counts[countKey] * multiplier;
			deltas.set(key, entry);
		}
	};

	if (before?.confirmationSummaryVersion === DONATION_CONFIRMATION_SUMMARY_VERSION) {
		add(before, donationConfirmationContribution(before), -1);
	}
	if (after) add(after, donationConfirmationContribution(after), 1);
	for (const { scope, counts } of deltas.values()) await applyScopeDelta(ctx, scope, counts, now);
}
