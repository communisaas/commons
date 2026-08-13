/** A matter is a proceeding at any institution; its physical table remains `bills` pending the scheduled rename, and a set `orgId` is the discriminator for an org-minted row. */

import { v } from 'convex/values';

import { requireOrgRole } from './_authHelpers';
import { mutation } from './_generated/server';
import {
	assertHttpsSourceUrl,
	MATTER_SUMMARY_MAX,
	MATTER_TITLE_MAX,
	MATTER_TOPIC_MAX,
	MATTER_TOPICS_MAX,
	matterExternalIdDigest,
	orgAuthoredRelevanceFact,
	ORG_AUTHORED_RELEVANCE_MATCH,
	ORG_MATTER_CAP_PER_ORG,
	ORG_MATTER_EXTERNAL_ID_PREFIX
} from './lib/matterAuthority';

function requiredText(value: string, max: number, code: string): string {
	const normalized = value.trim();
	if (normalized.length === 0 || normalized.length > max) throw new Error(code);
	return normalized;
}

export const create = mutation({
	args: {
		slug: v.string(),
		title: v.string(),
		summary: v.optional(v.string()),
		institution: v.string(),
		jurisdiction: v.string(),
		jurisdictionLevel: v.string(),
		status: v.string(),
		statusDate: v.optional(v.number()),
		sourceUrl: v.string(),
		topics: v.optional(v.array(v.string()))
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');
		const title = requiredText(args.title, MATTER_TITLE_MAX, 'MATTER_TITLE_INVALID');
		if (args.summary !== undefined && args.summary.length > MATTER_SUMMARY_MAX) {
			throw new Error('MATTER_SUMMARY_INVALID');
		}
		const summary = args.summary?.trim();
		const institution = requiredText(args.institution, 128, 'MATTER_INSTITUTION_INVALID');
		const jurisdiction = requiredText(args.jurisdiction, 128, 'MATTER_JURISDICTION_INVALID');
		const jurisdictionLevel = requiredText(
			args.jurisdictionLevel,
			128,
			'MATTER_JURISDICTION_LEVEL_INVALID'
		);
		const status = requiredText(args.status, 128, 'MATTER_STATUS_INVALID');
		const topics = (args.topics ?? []).map((topic) => topic.trim());
		if (
			topics.length > MATTER_TOPICS_MAX ||
			topics.some((topic) => topic.length > MATTER_TOPIC_MAX)
		) {
			throw new Error('MATTER_TOPICS_INVALID');
		}
		const sourceUrl = assertHttpsSourceUrl(args.sourceUrl);
		const digest = await matterExternalIdDigest(`${sourceUrl}\u0000${title}`);
		const externalId = `${ORG_MATTER_EXTERNAL_ID_PREFIX}${org._id}:${digest}`;
		const existing = await ctx.db
			.query('bills')
			.withIndex('by_externalId', (q) => q.eq('externalId', externalId))
			.first();
		if (existing) {
			if (existing.orgId !== org._id) throw new Error('MATTER_EXTERNAL_ID_CONFLICT');
			const relevance = await ctx.db
				.query('orgBillRelevances')
				.withIndex('by_orgId_billId', (q) =>
					q.eq('orgId', org._id).eq('billId', existing._id)
				)
				.first();
			if (!relevance) {
				await ctx.db.insert('orgBillRelevances', {
					orgId: org._id,
					billId: existing._id,
					scoreFact: orgAuthoredRelevanceFact(),
					matchedOn: [ORG_AUTHORED_RELEVANCE_MATCH]
				});
			}
			return { _id: existing._id, created: false };
		}

		// The cap applies only to a new row. Resolve idempotency first so retrying an
		// existing matter remains safe when the organization is exactly at capacity.
		const orgMatters = await ctx.db
			.query('bills')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.take(ORG_MATTER_CAP_PER_ORG + 1);
		if (orgMatters.length >= ORG_MATTER_CAP_PER_ORG) {
			throw new Error('MATTER_CAP_EXCEEDED');
		}

		const now = Date.now();
		const billId = await ctx.db.insert('bills', {
			orgId: org._id,
			externalId,
			jurisdiction,
			jurisdictionLevel,
			chamber: undefined,
			title,
			summary: summary || undefined,
			status,
			statusDate: args.statusDate ?? now,
			sponsors: undefined,
			committees: [],
			sourceUrl,
			fullTextUrl: undefined,
			topicEmbedding: undefined,
			topics,
			entities: [institution],
			updatedAt: now
		});
		await ctx.db.insert('orgBillRelevances', {
			orgId: org._id,
			billId,
			scoreFact: orgAuthoredRelevanceFact(),
			matchedOn: [ORG_AUTHORED_RELEVANCE_MATCH]
		});
		return { _id: billId, externalId, created: true };
	}
});
