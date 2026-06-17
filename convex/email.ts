import {
	query,
	mutation,
	internalMutation,
	internalAction,
	internalQuery
} from './_generated/server';
import { internal } from './_generated/api';
import { makeFunctionReference } from 'convex/server';
import type { FunctionReference } from 'convex/server';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { v } from 'convex/values';
import { recipientFilterValidator } from './_validators';
import { requireOrgRole, requireAuth } from './_authHelpers';
import { requireInternalSecret } from './_internalAuth';
import { getOrgKeyForAction } from './_orgKeyUnseal';
import { decryptOrgPii } from './_orgKey';
import { computeOrgScopedEmailHash } from './_orgHash';
import {
	collectFilteredRecipients,
	countFilteredRecipients,
	pageFilteredRecipients,
	RECIPIENT_COHORT_CAP
} from './_emailRecipientFilter';
import { applyEmailMergeFields, buildEmailTierContext } from './_emailMergeFields';
import { applySupporterStatsDelta, type CountableSupporter } from './_supporterStats';

declare const process: { env: Record<string, string | undefined> };

const emailEncoder = new TextEncoder();
const MIN_UNSUBSCRIBE_SECRET_BYTES = 32;
const HEADER_CONTROL_CHARS = /[\r\n\x00-\x1f\x7f]/g;

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function safeHeaderUrl(url: string): string {
	const cleaned = url.replace(HEADER_CONTROL_CHARS, '');
	const parsed = new URL(cleaned);
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		throw new Error('UNSUBSCRIBE_URL_PROTOCOL_INVALID');
	}
	return parsed.toString();
}

function publicBaseUrl(): string {
	const base = (process.env.PUBLIC_BASE_URL || 'https://commons.email')
		.replace(HEADER_CONTROL_CHARS, '')
		.replace(/\/+$/, '');
	const parsed = new URL(base);
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		throw new Error('PUBLIC_BASE_URL_PROTOCOL_INVALID');
	}
	return parsed.toString().replace(/\/+$/, '');
}

function unsubscribeSecret(): string {
	const secret = process.env.UNSUBSCRIBE_SECRET;
	if (!secret) throw new Error('UNSUBSCRIBE_SECRET env var is required');
	if (emailEncoder.encode(secret).byteLength < MIN_UNSUBSCRIBE_SECRET_BYTES) {
		throw new Error(`UNSUBSCRIBE_SECRET must be >= ${MIN_UNSUBSCRIBE_SECRET_BYTES} bytes`);
	}
	return secret;
}

function assertUnsubscribeHeaderConfig(): void {
	unsubscribeSecret();
	publicBaseUrl();
}

async function generateUnsubscribeTokenForConvex(
	supporterId: string,
	orgId: string
): Promise<string> {
	const secret = unsubscribeSecret();
	const key = await crypto.subtle.importKey(
		'raw',
		emailEncoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign(
		'HMAC',
		key,
		emailEncoder.encode(`${supporterId}:${orgId}`)
	);
	return bytesToHex(new Uint8Array(signature));
}

async function buildConvexUnsubscribeUrl(supporterId: string, orgId: string): Promise<string> {
	const token = await generateUnsubscribeTokenForConvex(supporterId, orgId);
	return safeHeaderUrl(`${publicBaseUrl()}/unsubscribe/${supporterId}/${orgId}/${token}`);
}

const getBlastByIdRef = makeFunctionReference<'query'>(
	'email:getBlastById'
) as unknown as FunctionReference<'query', 'internal'>;
const getBlastRecipientsRef = makeFunctionReference<'query'>(
	'email:getBlastRecipients'
) as unknown as FunctionReference<'query', 'internal'>;
const countBlastRecipientsRef = makeFunctionReference<'query'>(
	'email:countBlastRecipients'
) as unknown as FunctionReference<'query', 'internal'>;
const updateBlastStatusRef = makeFunctionReference<'mutation'>(
	'email:updateBlastStatus'
) as unknown as FunctionReference<'mutation', 'internal'>;
const incrementBlastCountersRef = makeFunctionReference<'mutation'>(
	'email:incrementBlastCounters'
) as unknown as FunctionReference<'mutation', 'internal'>;
const sendBlastRef = makeFunctionReference<'action'>(
	'email:sendBlast'
) as unknown as FunctionReference<'action', 'internal'>;
const sendBlastBatchRef = makeFunctionReference<'action'>(
	'email:sendBlastBatch'
) as unknown as FunctionReference<'action', 'internal'>;
const getStaleBounceReportsRef = makeFunctionReference<'query'>(
	'email:getStaleBounceReports'
) as unknown as FunctionReference<'query', 'internal'>;
const getPendingBounceReportsRef = makeFunctionReference<'query'>(
	'email:getPendingBounceReports'
) as unknown as FunctionReference<'query', 'internal'>;
const resolveBounceReportRef = makeFunctionReference<'mutation'>(
	'email:resolveBounceReport'
) as unknown as FunctionReference<'mutation', 'internal'>;
const suppressReportedBounceRef = makeFunctionReference<'mutation'>(
	'email:suppressReportedBounce'
) as unknown as FunctionReference<'mutation', 'internal'>;

const EMAIL_HASH_RE = /^[a-f0-9]{64}$/;
const MAX_HASH_FILTER_ITEMS = 10_000;
const MAX_AB_COHORT_RECIPIENTS = 10_000;
const USER_BOUNCE_REPORT_THRESHOLD = 2;
const USER_BOUNCE_REPORT_SCAN_LIMIT = 500;
const USER_BOUNCE_SUPPRESSION_MS = 30 * 24 * 60 * 60 * 1000;

type RecipientFilterShape = {
	tagIds?: Id<'tags'>[];
	segmentIds?: Id<'segments'>[];
	verified?: 'any' | 'verified' | 'unverified';
	includeEmailHashes?: string[];
	excludeEmailHashes?: string[];
};

function cleanStringArray(
	value: unknown,
	predicate: (value: string) => boolean,
	limit = MAX_HASH_FILTER_ITEMS
): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const cleaned = Array.from(
		new Set(value.filter((item): item is string => typeof item === 'string' && predicate(item)))
	).slice(0, limit);
	return cleaned.length > 0 ? cleaned : undefined;
}

function readSafeRecipientFilter(raw: unknown): RecipientFilterShape {
	if (!raw || typeof raw !== 'object') return {};
	const candidate = raw as Record<string, unknown>;
	const safeFilter: RecipientFilterShape = {};
	const tagIds = cleanStringArray(
		candidate.tagIds,
		(tagId) => tagId.length > 0 && tagId.length <= 64
	);
	if (tagIds) safeFilter.tagIds = tagIds as Id<'tags'>[];
	const segmentIds = cleanStringArray(
		candidate.segmentIds,
		(segmentId) => segmentId.length > 0 && segmentId.length <= 64
	);
	if (segmentIds) safeFilter.segmentIds = segmentIds as Id<'segments'>[];
	if (
		candidate.verified === 'any' ||
		candidate.verified === 'verified' ||
		candidate.verified === 'unverified'
	) {
		safeFilter.verified = candidate.verified;
	}
	const includeEmailHashes = cleanStringArray(candidate.includeEmailHashes, (hash) =>
		EMAIL_HASH_RE.test(hash)
	);
	if (includeEmailHashes) safeFilter.includeEmailHashes = includeEmailHashes;
	const excludeEmailHashes = cleanStringArray(candidate.excludeEmailHashes, (hash) =>
		EMAIL_HASH_RE.test(hash)
	);
	if (excludeEmailHashes) safeFilter.excludeEmailHashes = excludeEmailHashes;
	return safeFilter;
}

function withIncludedHashes(
	_filter: RecipientFilterShape,
	includeEmailHashes: string[]
): RecipientFilterShape {
	return { includeEmailHashes };
}

function sameHashSnapshot(a: string[] | undefined, b: string[]): boolean {
	const left = Array.from(new Set(a ?? [])).sort();
	const right = Array.from(new Set(b)).sort();
	if (left.length !== right.length) return false;
	return left.every((hash, index) => hash === right[index]);
}

function assertExactHashSnapshot(
	filter: RecipientFilterShape,
	expectedEmailHashes: string[],
	label: string
): void {
	if (!sameHashSnapshot(filter.includeEmailHashes, expectedEmailHashes)) {
		throw new Error(`${label} no longer matches the stored A/B cohort snapshot`);
	}
	if (
		(filter.tagIds?.length ?? 0) > 0 ||
		(filter.segmentIds?.length ?? 0) > 0 ||
		(filter.excludeEmailHashes?.length ?? 0) > 0 ||
		filter.verified !== undefined
	) {
		throw new Error(`${label} must dispatch from an exact immutable hash snapshot`);
	}
}

function readSupportedAbWinnerMetric(value: unknown): 'open' | 'click' | null {
	return value === 'open' || value === 'click' ? value : null;
}

function scoreAbVariant(
	variant: { totalSent?: number; totalOpened?: number; totalClicked?: number; abVariant?: string },
	metric: 'open' | 'click'
): number {
	const sent = variant.totalSent || 1;
	if (metric === 'click') return (variant.totalClicked ?? 0) / sent;
	return (variant.totalOpened ?? 0) / sent;
}

async function materializeAbRemainderDraft(
	ctx: MutationCtx,
	orgId: Id<'organizations'>,
	winnerBlastId: Id<'emailBlasts'>
): Promise<{ blastId: Id<'emailBlasts'>; created: boolean; totalRecipients: number }> {
	const winnerCandidate = await ctx.db.get(winnerBlastId);
	if (!winnerCandidate || winnerCandidate.orgId !== orgId || !winnerCandidate.isAbTest) {
		throw new Error('A/B winner variant not found');
	}
	if (!winnerCandidate.abParentId) {
		throw new Error('A/B group is missing a parent id');
	}
	if (!winnerCandidate.abWinnerPickedAt) {
		throw new Error('A/B winner has not been recorded yet');
	}

	const variants = (
		await ctx.db
			.query('emailBlasts')
			.withIndex('by_abParentId', (qb) => qb.eq('abParentId', winnerCandidate.abParentId!))
			.collect()
	)
		.filter((blast) => blast.orgId === orgId && blast.isAbTest)
		.sort((a, b) => {
			if (a.abVariant === 'A' && b.abVariant !== 'A') return -1;
			if (b.abVariant === 'A' && a.abVariant !== 'A') return 1;
			return a._creationTime - b._creationTime;
		});
	if (variants.length < 2) {
		throw new Error('A/B group needs two sent variants before a remainder draft can be created');
	}

	const rawConfig = winnerCandidate.abTestConfig as Record<string, unknown> | undefined;
	const rawWinnerMetric = rawConfig?.winnerMetric;
	const metric =
		readSupportedAbWinnerMetric(rawWinnerMetric) ?? (rawWinnerMetric === undefined ? 'open' : null);
	if (!metric) {
		throw new Error('A/B winner metric is not supported by the current picker');
	}
	if (typeof rawConfig?.winnerBlastId === 'string') {
		if (rawConfig.winnerBlastId !== String(winnerCandidate._id)) {
			throw new Error('Selected variant is not the recorded winner');
		}
	} else {
		const computedWinner = variants.slice().sort((a, b) => {
			const diff = scoreAbVariant(b, metric) - scoreAbVariant(a, metric);
			if (diff !== 0) return diff;
			if (a.abVariant === 'A') return -1;
			if (b.abVariant === 'A') return 1;
			return a._creationTime - b._creationTime;
		})[0];
		if (computedWinner._id !== winnerCandidate._id) {
			throw new Error('Selected variant is not the current winner');
		}
	}

	const cohort = await ctx.db
		.query('emailAbTestCohorts')
		.withIndex('by_org_abParentId', (qb) =>
			qb.eq('orgId', orgId).eq('abParentId', winnerCandidate.abParentId!)
		)
		.first();
	if (!cohort) {
		throw new Error('A/B cohort snapshot not found');
	}
	if (cohort.remainderEmailHashes.length === 0) {
		throw new Error('A/B cohort has no held-back remainder');
	}
	if (cohort.remainderBlastId) {
		const existing = await ctx.db.get(cohort.remainderBlastId);
		if (existing && existing.orgId === orgId) {
			return { blastId: existing._id, created: false, totalRecipients: existing.totalRecipients };
		}
	}

	const now = Date.now();
	const blastId = await ctx.db.insert('emailBlasts', {
		orgId,
		campaignId: winnerCandidate.campaignId,
		subject: winnerCandidate.subject,
		bodyHtml: winnerCandidate.bodyHtml,
		fromName: winnerCandidate.fromName,
		fromEmail: winnerCandidate.fromEmail,
		status: 'draft',
		recipientFilter: { includeEmailHashes: cohort.remainderEmailHashes },
		totalRecipients: cohort.remainderEmailHashes.length,
		verificationContext: undefined,
		totalSent: 0,
		totalBounced: 0,
		totalOpened: 0,
		totalClicked: 0,
		totalComplained: 0,
		sentAt: undefined,
		updatedAt: now,
		sendMode: 'client-direct',
		isAbTest: false,
		abTestConfig: {
			source: 'ab-remainder',
			sourceAbParentId: winnerCandidate.abParentId,
			sourceWinnerId: String(winnerCandidate._id)
		},
		abVariant: 'remainder',
		abParentId: winnerCandidate.abParentId,
		abWinnerPickedAt: undefined,
		batches: undefined
	});
	await ctx.db.patch(cohort._id, {
		remainderBlastId: blastId,
		updatedAt: now
	});

	return { blastId, created: true, totalRecipients: cohort.remainderEmailHashes.length };
}

async function queueExactServerDispatch(
	ctx: MutationCtx,
	args: {
		orgSlug: string;
		orgId: Id<'organizations'>;
		blastId: Id<'emailBlasts'>;
		expectedEmailHashes: string[];
		label: string;
	}
): Promise<{
	blastId: Id<'emailBlasts'>;
	status: string;
	queued: boolean;
	totalRecipients: number;
}> {
	const blast = await ctx.db.get(args.blastId);
	if (!blast || blast.orgId !== args.orgId) {
		throw new Error(`${args.label} blast not found in this organization`);
	}
	assertExactHashSnapshot(
		readSafeRecipientFilter(blast.recipientFilter),
		args.expectedEmailHashes,
		args.label
	);
	if (blast.status === 'failed') {
		throw new Error(`${args.label} is failed; create a new A/B continuation before retrying`);
	}
	if (blast.status !== 'draft') {
		return {
			blastId: args.blastId,
			status: blast.status,
			queued: false,
			totalRecipients: blast.totalRecipients
		};
	}

	// Sub-class (A) must-enumerate: resolve the still-subscribed subset of the
	// stored cohort via a bounded paginated scan keyed by the exact hash set
	// (≤ MAX_AB_COHORT_RECIPIENTS hashes, so the cohort is itself bounded).
	// Replaces a .collect() of the whole supporter roster passed in by the
	// caller — that scan threw past the per-read doc cap on a large org.
	const { recipients } = await collectFilteredRecipients(
		ctx,
		args.orgId,
		{ includeEmailHashes: args.expectedEmailHashes },
		MAX_AB_COHORT_RECIPIENTS
	);
	if (recipients.length === 0) {
		throw new Error(`${args.label} has no currently subscribed recipients`);
	}

	await ctx.db.patch(args.blastId, {
		status: 'scheduled',
		sendMode: 'server',
		totalRecipients: recipients.length,
		updatedAt: Date.now()
	});

	await ctx.scheduler.runAfter(0, sendBlastRef, {
		orgSlug: args.orgSlug,
		blastId: args.blastId
	});

	return {
		blastId: args.blastId,
		status: 'scheduled',
		queued: true,
		totalRecipients: recipients.length
	};
}

// =============================================================================
// EMAIL BLASTS — Queries, Mutations, Actions
// =============================================================================

/**
 * List email blasts for an org.
 */
export const listBlasts = query({
	args: {
		orgSlug: v.string(),
		status: v.optional(v.string()),
		paginationOpts: v.object({
			numItems: v.number(),
			cursor: v.union(v.string(), v.null())
		})
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');

		// Always use by_orgId index to enforce org scoping; filter status post-query
		const q = ctx.db.query('emailBlasts').withIndex('by_orgId', (qb) => qb.eq('orgId', org._id));

		const results = await q.order('desc').paginate({
			numItems: Math.min(args.paginationOpts.numItems, 50),
			cursor: args.paginationOpts.cursor ?? null
		});

		// Post-filter by status if specified (index only covers orgId)
		if (args.status) {
			return {
				...results,
				page: results.page.filter((b) => b.status === args.status)
			};
		}

		return results;
	}
});

/**
 * Get a single email blast by ID.
 */
export const getBlast = query({
	args: {
		orgSlug: v.string(),
		blastId: v.id('emailBlasts')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');
		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.orgId !== org._id) return null;
		return blast;
	}
});

/**
 * Get the sibling records for an A/B test group.
 *
 * This is an evidence surface, not a remainder-send primitive: it makes the
 * linked variants and winner marker inspectable without implying that the
 * held-back cohort has been dispatched.
 */
export const getAbTestGroup = query({
	args: {
		orgSlug: v.string(),
		blastId: v.id('emailBlasts')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');
		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.orgId !== org._id || !blast.isAbTest) return null;

		const groupId =
			typeof blast.abParentId === 'string' && blast.abParentId.length > 0
				? blast.abParentId
				: String(blast._id);

		const siblings = await ctx.db
			.query('emailBlasts')
			.withIndex('by_abParentId', (qb) => qb.eq('abParentId', groupId))
			.collect();

		const variantsById = new Map([[String(blast._id), blast]]);
		for (const sibling of siblings) {
			if (sibling.orgId === org._id && sibling.isAbTest) {
				variantsById.set(String(sibling._id), sibling);
			}
		}

		const variantOrder = (variant: { abVariant?: string }) => {
			if (variant.abVariant === 'A') return 0;
			if (variant.abVariant === 'B') return 1;
			return 2;
		};

		const cohort = await ctx.db
			.query('emailAbTestCohorts')
			.withIndex('by_org_abParentId', (qb) => qb.eq('orgId', org._id).eq('abParentId', groupId))
			.first();
		const remainderDraft = cohort?.remainderBlastId
			? await ctx.db.get(cohort.remainderBlastId)
			: null;

		return {
			groupId,
			variants: Array.from(variantsById.values()).sort((a, b) => {
				const order = variantOrder(a) - variantOrder(b);
				if (order !== 0) return order;
				return a._creationTime - b._creationTime;
			}),
			cohort: cohort
				? {
						totalCount: cohort.totalCount,
						testCount: cohort.testCount,
						remainderCount: cohort.remainderCount,
						variantACount: cohort.variantAEmailHashes.length,
						variantBCount: cohort.variantBEmailHashes.length,
						remainderBlastId: cohort.remainderBlastId ?? null
					}
				: null,
			remainderDraft:
				remainderDraft && remainderDraft.orgId === org._id
					? {
							_id: remainderDraft._id,
							subject: remainderDraft.subject,
							status: remainderDraft.status,
							totalRecipients: remainderDraft.totalRecipients,
							totalSent: remainderDraft.totalSent,
							sentAt: remainderDraft.sentAt,
							_creationTime: remainderDraft._creationTime
						}
					: null
		};
	}
});

/**
 * Resolve the current subscribed recipient hashes for a proposed filter.
 * Editor-only because hashes are stable org-scoped identifiers. Used to
 * create A/B cohort snapshots before variant drafts are written.
 */
export const resolveRecipientHashesForFilter = query({
	args: {
		orgSlug: v.string(),
		recipientFilter: v.optional(recipientFilterValidator)
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');
		const filter = readSafeRecipientFilter(args.recipientFilter);

		// Sub-class (A) must-enumerate: the A/B cohort snapshot needs the actual
		// matching hashes. Paginated bounded scan — never an unbounded .collect()
		// over the supporter roster (throws past the per-read doc cap once an org
		// passes ~16K supporters). Cohort is capped at MAX_AB_COHORT_RECIPIENTS;
		// `limited` surfaces a saturated floor.
		const { recipients: filtered, truncated } = await collectFilteredRecipients(
			ctx,
			org._id,
			filter,
			MAX_AB_COHORT_RECIPIENTS
		);

		const emailHashes = filtered
			.map((s) => s.emailHash)
			.filter((hash) => EMAIL_HASH_RE.test(hash))
			.sort();

		return {
			emailHashes,
			totalCount: emailHashes.length,
			limited: truncated,
			maxSupported: MAX_AB_COHORT_RECIPIENTS
		};
	}
});

/**
 * Count the current subscribed recipient cohort for a proposed filter without
 * returning the stable email hashes. Used by the composer count/preflight path.
 */
export const countRecipientsForFilter = query({
	args: {
		orgSlug: v.string(),
		recipientFilter: v.optional(recipientFilterValidator)
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');
		const filter = readSafeRecipientFilter(args.recipientFilter);

		// Sub-class (B) pure count + per-source breakdown. The unfiltered org
		// counter (supporterStats.emailSubscribed) gives only the total, and its
		// sourceCounts tally ALL email statuses — not the subscribed-only source
		// breakdown the composer renders. So a bounded paginated count is used:
		// it returns both the total and the subscribed source breakdown without
		// ever a single unbounded .collect() (which throws past the per-read doc
		// cap on a large roster). Count saturates at RECIPIENT_COHORT_CAP.
		const { totalCount, sourceCounts, truncated } = await countFilteredRecipients(
			ctx,
			org._id,
			filter,
			RECIPIENT_COHORT_CAP
		);
		return {
			totalCount,
			sourceCounts,
			truncated
		};
	}
});

/**
 * Editor-only blast lookup — returns just the (orgId, blastId) tuple after
 * verifying the caller is an editor of the blast's owning org. Used by
 * privileged endpoints that need to mint per-recipient artifacts on behalf
 * of the blast (unsubscribe URLs, dispatch claims) where member-level
 * access on `getBlast` would let lower-role users mint valid tokens that
 * change supporter state. cure shipped.
 */
export const getBlastForEditor = query({
	args: {
		orgSlug: v.string(),
		blastId: v.id('emailBlasts')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');
		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.orgId !== org._id) return null;
		return { orgId: blast.orgId, blastId: blast._id };
	}
});

/**
 * Get email events (opens, clicks, bounces) for a blast.
 */
export const getBlastEvents = query({
	args: {
		orgSlug: v.string(),
		blastId: v.id('emailBlasts'),
		eventType: v.optional(v.string()),
		paginationOpts: v.object({
			numItems: v.number(),
			cursor: v.union(v.string(), v.null())
		})
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');

		// Verify blast belongs to this org — prevents cross-tenant event leakage
		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.orgId !== org._id) throw new Error('Blast not found in this organization');

		let q;
		if (args.eventType) {
			q = ctx.db
				.query('emailEvents')
				.withIndex('by_blastId_eventType', (qb) =>
					qb.eq('blastId', args.blastId).eq('eventType', args.eventType!)
				);
		} else {
			q = ctx.db
				.query('emailEvents')
				.withIndex('by_blastId', (qb) => qb.eq('blastId', args.blastId));
		}

		return await q.order('desc').paginate({
			numItems: Math.min(args.paginationOpts.numItems, 100),
			cursor: args.paginationOpts.cursor ?? null
		});
	}
});

/**
 * Apply an unsubscribe by (blastId + plaintext email). Resolves the blast to
 * org, hashes the email under the org's namespace, looks up the supporter,
 * patches `emailStatus`. Internal-only — called from the SvelteKit
 * `/unsubscribe` form action; the email is supplied by the recipient. This
 * is the per-blast form-based unsubscribe fallback. Per-recipient HMAC
 * one-click headers are built by the Lambda and Convex sender paths when
 * dispatch is armed and `UNSUBSCRIBE_SECRET` is configured.
 */
export const applyUnsubscribeByBlastEmail = mutation({
	args: {
		_secret: v.string(),
		blastId: v.id('emailBlasts'),
		email: v.string()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const blast = await ctx.db.get(args.blastId);
		if (!blast) {
			return { applied: false, reason: 'blast-not-found' as const };
		}
		const emailHash = await computeOrgScopedEmailHash(blast.orgId, args.email);
		const supporter = await ctx.db
			.query('supporters')
			.withIndex('by_orgId_emailHash', (idx) =>
				idx.eq('orgId', blast.orgId).eq('emailHash', emailHash)
			)
			.first();
		if (!supporter) {
			// Don't reveal whether the address is on file — the form succeeds
			// either way to avoid being a probe oracle.
			return { applied: false, reason: 'not-on-list' as const };
		}
		if (supporter.emailStatus === 'unsubscribed' || supporter.emailStatus === 'complained') {
			return { applied: true, reason: 'already-unsubscribed' as const };
		}
		await ctx.db.patch(supporter._id, {
			emailStatus: 'unsubscribed',
			updatedAt: Date.now()
		});
		// emailStatus transition → update the org's breakdown counters.
		await applySupporterStatsDelta(ctx, supporter.orgId, supporter as CountableSupporter, {
			...(supporter as CountableSupporter),
			emailStatus: 'unsubscribed'
		});
		return { applied: true, reason: 'ok' as const };
	}
});

/**
 * Public org-scoped read for per-recipient send receipts. emailEvents records
 * post-delivery activity (open/click/bounce/complaint); this returns the
 * underlying delivery receipts — what was attempted, with which SES messageId,
 * and the immediate outcome.
 */
export const listReceiptsForBlast = query({
	args: {
		orgSlug: v.string(),
		blastId: v.id('emailBlasts'),
		paginationOpts: v.object({
			numItems: v.number(),
			cursor: v.union(v.string(), v.null())
		})
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');

		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.orgId !== org._id) {
			throw new Error('Blast not found in this organization');
		}

		return await ctx.db
			.query('emailDeliveryReceipts')
			.withIndex('by_blastId', (qb) => qb.eq('blastId', args.blastId))
			.order('desc')
			.paginate({
				numItems: Math.min(args.paginationOpts.numItems, 100),
				cursor: args.paginationOpts.cursor ?? null
			});
	}
});

/**
 * Create an email blast (draft).
 */
export const createBlast = mutation({
	args: {
		orgSlug: v.string(),
		subject: v.string(),
		bodyHtml: v.string(),
		fromName: v.string(),
		fromEmail: v.string(),
		recipientFilter: v.optional(recipientFilterValidator),
		campaignId: v.optional(v.id('campaigns')),
		sendMode: v.optional(v.string()),
		isAbTest: v.optional(v.boolean()),
		abTestConfig: v.optional(v.any()),
		abVariant: v.optional(v.string()),
		abParentId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		const id = await ctx.db.insert('emailBlasts', {
			orgId: org._id,
			campaignId: args.campaignId,
			subject: args.subject,
			bodyHtml: args.bodyHtml,
			fromName: args.fromName,
			fromEmail: args.fromEmail,
			status: 'draft',
			recipientFilter: args.recipientFilter,
			totalRecipients: 0,
			verificationContext: undefined,
			totalSent: 0,
			totalBounced: 0,
			totalOpened: 0,
			totalClicked: 0,
			totalComplained: 0,
			sentAt: undefined,
			updatedAt: Date.now(),
			sendMode: args.sendMode,
			isAbTest: args.isAbTest ?? false,
			abTestConfig: args.abTestConfig,
			abVariant: args.abVariant,
			abParentId: args.abParentId,
			abWinnerPickedAt: undefined,
			batches: undefined
		});

		return { id };
	}
});

/**
 * Create linked A/B draft variants and the cohort snapshot in one mutation.
 * The variant rows carry exact includeEmailHashes filters, while the separate
 * cohort row stores the held-back remainder for a later winning-content draft.
 */
export const createAbTestDrafts = mutation({
	args: {
		orgSlug: v.string(),
		subjectA: v.string(),
		subjectB: v.string(),
		bodyHtmlA: v.string(),
		bodyHtmlB: v.string(),
		fromName: v.string(),
		fromEmail: v.string(),
		recipientFilter: recipientFilterValidator,
		campaignId: v.optional(v.id('campaigns')),
		abParentId: v.string(),
		abTestConfig: v.any(),
		variantAEmailHashes: v.array(v.string()),
		variantBEmailHashes: v.array(v.string()),
		remainderEmailHashes: v.array(v.string())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');
		const baseFilter = readSafeRecipientFilter(args.recipientFilter);
		const variantAEmailHashes =
			cleanStringArray(args.variantAEmailHashes, (hash) => EMAIL_HASH_RE.test(hash)) ?? [];
		const variantBEmailHashes =
			cleanStringArray(args.variantBEmailHashes, (hash) => EMAIL_HASH_RE.test(hash)) ?? [];
		const remainderEmailHashes =
			cleanStringArray(args.remainderEmailHashes, (hash) => EMAIL_HASH_RE.test(hash)) ?? [];
		if (variantAEmailHashes.length === 0 || variantBEmailHashes.length === 0) {
			throw new Error('A/B variants require at least one recipient each');
		}
		const now = Date.now();

		const existing = await ctx.db
			.query('emailAbTestCohorts')
			.withIndex('by_org_abParentId', (qb) =>
				qb.eq('orgId', org._id).eq('abParentId', args.abParentId)
			)
			.first();
		if (existing) {
			throw new Error('A/B cohort already exists');
		}

		await ctx.db.insert('emailAbTestCohorts', {
			orgId: org._id,
			abParentId: args.abParentId,
			baseFilter,
			variantAEmailHashes,
			variantBEmailHashes,
			remainderEmailHashes,
			totalCount:
				variantAEmailHashes.length + variantBEmailHashes.length + remainderEmailHashes.length,
			testCount: variantAEmailHashes.length + variantBEmailHashes.length,
			remainderCount: remainderEmailHashes.length,
			remainderBlastId: undefined,
			createdAt: now,
			updatedAt: now
		});

		const variantAId = await ctx.db.insert('emailBlasts', {
			orgId: org._id,
			campaignId: args.campaignId,
			subject: args.subjectA,
			bodyHtml: args.bodyHtmlA,
			fromName: args.fromName,
			fromEmail: args.fromEmail,
			status: 'draft',
			recipientFilter: withIncludedHashes(baseFilter, variantAEmailHashes),
			totalRecipients: variantAEmailHashes.length,
			verificationContext: undefined,
			totalSent: 0,
			totalBounced: 0,
			totalOpened: 0,
			totalClicked: 0,
			totalComplained: 0,
			sentAt: undefined,
			updatedAt: now,
			sendMode: 'client-direct',
			isAbTest: true,
			abTestConfig: args.abTestConfig,
			abVariant: 'A',
			abParentId: args.abParentId,
			abWinnerPickedAt: undefined,
			batches: undefined
		});
		const variantBId = await ctx.db.insert('emailBlasts', {
			orgId: org._id,
			campaignId: args.campaignId,
			subject: args.subjectB,
			bodyHtml: args.bodyHtmlB,
			fromName: args.fromName,
			fromEmail: args.fromEmail,
			status: 'draft',
			recipientFilter: withIncludedHashes(baseFilter, variantBEmailHashes),
			totalRecipients: variantBEmailHashes.length,
			verificationContext: undefined,
			totalSent: 0,
			totalBounced: 0,
			totalOpened: 0,
			totalClicked: 0,
			totalComplained: 0,
			sentAt: undefined,
			updatedAt: now,
			sendMode: 'client-direct',
			isAbTest: true,
			abTestConfig: args.abTestConfig,
			abVariant: 'B',
			abParentId: args.abParentId,
			abWinnerPickedAt: undefined,
			batches: undefined
		});

		return { variantAId, variantBId };
	}
});

/**
 * Update an email blast (draft only).
 */
export const updateBlast = mutation({
	args: {
		orgSlug: v.string(),
		blastId: v.id('emailBlasts'),
		subject: v.optional(v.string()),
		bodyHtml: v.optional(v.string()),
		fromName: v.optional(v.string()),
		fromEmail: v.optional(v.string()),
		recipientFilter: v.optional(recipientFilterValidator),
		status: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.orgId !== org._id) {
			throw new Error('Blast not found');
		}

		if (blast.status !== 'draft' && args.status !== 'draft') {
			throw new Error('Can only update draft blasts');
		}

		const patch: Record<string, unknown> = { updatedAt: Date.now() };
		if (args.subject !== undefined) patch.subject = args.subject;
		if (args.bodyHtml !== undefined) patch.bodyHtml = args.bodyHtml;
		if (args.fromName !== undefined) patch.fromName = args.fromName;
		if (args.fromEmail !== undefined) patch.fromEmail = args.fromEmail;
		if (args.recipientFilter !== undefined) patch.recipientFilter = args.recipientFilter;
		if (args.status !== undefined) patch.status = args.status;

		await ctx.db.patch(args.blastId, patch);
	}
});

/**
 * Role-checked server-dispatch enqueue boundary for the org composer.
 *
 * The actual sender remains the internal batch worker below. This public
 * mutation is the product boundary: it proves editor authority, verifies the
 * blast belongs to the org, atomically claims a draft as scheduled, and then
 * schedules the internal sender. UI still gates calls behind
 * FEATURES.EMAIL_SERVER_DISPATCH.
 */
export const enqueueServerDispatch = mutation({
	args: {
		orgSlug: v.string(),
		blastId: v.id('emailBlasts')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');
		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.orgId !== org._id) {
			throw new Error('Blast not found in this organization');
		}
		if (blast.status !== 'draft') {
			throw new Error('Only draft blasts can be queued for server dispatch');
		}

		// Sub-class (A) must-enumerate: bounded paginated scan resolves the
		// matching cohort to set totalRecipients. The actual per-recipient send
		// re-resolves the cohort page-by-page in sendBlastBatch (cursor-paged),
		// so this read only needs the count + non-empty guard. Capped so it never
		// hits the per-read doc cap the prior .collect() would on a large roster.
		const { recipients, truncated } = await collectFilteredRecipients(
			ctx,
			org._id,
			readSafeRecipientFilter(blast.recipientFilter),
			RECIPIENT_COHORT_CAP
		);
		if (recipients.length === 0) {
			throw new Error('No subscribed recipients match this blast filter');
		}

		await ctx.db.patch(args.blastId, {
			status: 'scheduled',
			sendMode: 'server',
			totalRecipients: recipients.length,
			updatedAt: Date.now()
		});

		await ctx.scheduler.runAfter(0, sendBlastRef, {
			orgSlug: args.orgSlug,
			blastId: args.blastId
		});

		return { scheduled: true, totalRecipients: recipients.length, truncated };
	}
});

/**
 * Queue both stored A/B test cohorts through the server-dispatch boundary.
 *
 * This does not re-evaluate the original tags or saved segments. Each variant
 * must still carry its exact immutable includeEmailHashes snapshot, and retrying
 * the mutation will not schedule already scheduled/sending/sent variants again.
 */
export const enqueueAbTestDispatch = mutation({
	args: {
		orgSlug: v.string(),
		blastId: v.id('emailBlasts')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');
		const seedBlast = await ctx.db.get(args.blastId);
		if (!seedBlast || seedBlast.orgId !== org._id || !seedBlast.isAbTest) {
			throw new Error('A/B test group not found in this organization');
		}
		const groupId =
			typeof seedBlast.abParentId === 'string' && seedBlast.abParentId.length > 0
				? seedBlast.abParentId
				: String(seedBlast._id);
		const cohort = await ctx.db
			.query('emailAbTestCohorts')
			.withIndex('by_org_abParentId', (qb) => qb.eq('orgId', org._id).eq('abParentId', groupId))
			.first();
		if (!cohort) {
			throw new Error('A/B cohort snapshot not found');
		}

		const variants = (
			await ctx.db
				.query('emailBlasts')
				.withIndex('by_abParentId', (qb) => qb.eq('abParentId', groupId))
				.collect()
		).filter((blast) => blast.orgId === org._id && blast.isAbTest);
		const variantA = variants.find((blast) => blast.abVariant === 'A');
		const variantB = variants.find((blast) => blast.abVariant === 'B');
		if (!variantA || !variantB) {
			throw new Error('A/B test needs both stored variants before dispatch');
		}

		// queueExactServerDispatch now resolves each variant's still-subscribed
		// cohort via its own bounded paginated scan keyed by the stored hash set,
		// so no whole-roster .collect() is needed (or passed) here.
		const results = [];
		results.push(
			await queueExactServerDispatch(ctx, {
				orgSlug: args.orgSlug,
				orgId: org._id,
				blastId: variantA._id,
				expectedEmailHashes: cohort.variantAEmailHashes,
				label: 'A/B variant A'
			})
		);
		results.push(
			await queueExactServerDispatch(ctx, {
				orgSlug: args.orgSlug,
				orgId: org._id,
				blastId: variantB._id,
				expectedEmailHashes: cohort.variantBEmailHashes,
				label: 'A/B variant B'
			})
		);

		return {
			groupId,
			queued: results.filter((result) => result.queued).length,
			variants: results
		};
	}
});

/**
 * Materialize the held-back A/B remainder as a client-direct draft using the
 * winning variant's subject/body and the exact stored remainder hash set.
 */
export const createAbRemainderDraft = mutation({
	args: {
		orgSlug: v.string(),
		winnerBlastId: v.id('emailBlasts')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');
		return await materializeAbRemainderDraft(ctx, org._id, args.winnerBlastId);
	}
});

/**
 * Materialize and queue the winning held-back remainder through the same
 * server-dispatch boundary as normal blasts. Idempotent across operator retries:
 * an existing scheduled/sending/sent remainder is returned, not re-scheduled.
 */
export const enqueueAbRemainderDispatch = mutation({
	args: {
		orgSlug: v.string(),
		winnerBlastId: v.id('emailBlasts')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');
		const remainder = await materializeAbRemainderDraft(ctx, org._id, args.winnerBlastId);
		const remainderBlast = await ctx.db.get(remainder.blastId);
		if (!remainderBlast?.abParentId) {
			throw new Error('A/B remainder draft is missing its source group');
		}
		const cohort = await ctx.db
			.query('emailAbTestCohorts')
			.withIndex('by_org_abParentId', (qb) =>
				qb.eq('orgId', org._id).eq('abParentId', remainderBlast.abParentId!)
			)
			.first();
		if (!cohort) {
			throw new Error('A/B cohort snapshot not found');
		}

		// queueExactServerDispatch resolves the still-subscribed remainder cohort
		// via its own bounded paginated scan keyed by the stored hash set.
		const dispatch = await queueExactServerDispatch(ctx, {
			orgSlug: args.orgSlug,
			orgId: org._id,
			blastId: remainder.blastId,
			expectedEmailHashes: cohort.remainderEmailHashes,
			label: 'A/B remainder'
		});

		return {
			...remainder,
			...dispatch
		};
	}
});

// =============================================================================
// INTERNAL: Batch send helpers
// =============================================================================

/**
 * Internal: Update blast status and counters.
 */
export const updateBlastStatus = internalMutation({
	args: {
		blastId: v.id('emailBlasts'),
		status: v.string(),
		totalSent: v.optional(v.number()),
		totalBounced: v.optional(v.number()),
		totalRecipients: v.optional(v.number()),
		sentAt: v.optional(v.number()),
		verificationContext: v.optional(v.any()),
		batches: v.optional(v.any())
	},
	handler: async (ctx, args) => {
		const blast = await ctx.db.get(args.blastId);
		if (!blast) return;

		const patch: Record<string, unknown> = {
			status: args.status,
			updatedAt: Date.now()
		};
		if (args.totalSent !== undefined) patch.totalSent = args.totalSent;
		if (args.totalBounced !== undefined) patch.totalBounced = args.totalBounced;
		if (args.totalRecipients !== undefined) patch.totalRecipients = args.totalRecipients;
		if (args.sentAt !== undefined) patch.sentAt = args.sentAt;
		if (args.verificationContext !== undefined)
			patch.verificationContext = args.verificationContext;
		if (args.batches !== undefined) patch.batches = args.batches;

		await ctx.db.patch(args.blastId, patch);

		// When blast transitions to "sent", increment org-level email counter.
		// Idempotent: only increment on actual status transition (not re-finalization).
		// Note: org.sentEmailCount is a convenience counter for onboarding state;
		// billing enforcement uses period-scoped aggregation from emailBlasts table.
		if (args.status === 'sent' && blast.status !== 'sent' && blast.orgId) {
			const org = await ctx.db.get(blast.orgId);
			if (org) {
				const currentCount = org.sentEmailCount ?? 0;
				const blastSent = args.totalSent ?? blast.totalSent ?? 0;
				await ctx.db.patch(blast.orgId, {
					sentEmailCount: currentCount + blastSent,
					updatedAt: Date.now()
				});
			}
		}
	}
});

/**
 * Internal query: Get supporters for a blast (paginated by org + filter).
 */
export const getBlastRecipients = internalQuery({
	args: {
		orgId: v.id('organizations'),
		limit: v.number(),
		cursor: v.optional(v.union(v.string(), v.null())),
		blastId: v.optional(v.id('emailBlasts'))
	},
	handler: async (ctx, args) => {
		// Server-side mirror of the blast recipientFilter shape validation.
		// When a blastId is supplied, the persisted recipientFilter is
		// enforced here at recipient-load. Without blastId the entire
		// subscribed cohort returns — matches legacy caller behavior so
		// wiring this in does not regress them.
		//
		// An unchecked `as typeof filter` cast lets a malformed write (e.g.
		// `tagIds: "abc"` instead of `["abc"]`) poison recipient resolution.
		// The shape check below must match the equivalent guard in `blasts.ts`
		// — this is the server-driven send path's mirror.
		let filter: RecipientFilterShape = {};
		if (args.blastId) {
			const blast = await ctx.db.get(args.blastId);
			if (!blast || blast.orgId !== args.orgId) {
				throw new Error('Blast not found in this organization');
			}
			filter = readSafeRecipientFilter(blast.recipientFilter);
		}
		// Sub-class (A) must-enumerate: ONE bounded page of matching recipients
		// plus a continuation cursor. The send loop (sendBlastBatch) carries the
		// cursor batch-to-batch so the FULL cohort is enumerated across pages —
		// no recipient is dropped past a fixed ceiling, and the supporter table
		// is never .collect()ed in a single read (which throws past the per-read
		// doc cap once an org passes ~16K supporters). `recipients` is at most
		// `limit` rows; `continueCursor` is null when the scan is exhausted.
		const { recipients, continueCursor, isDone } = await pageFilteredRecipients(
			ctx,
			args.orgId,
			filter,
			args.cursor ?? null,
			args.limit
		);
		return { recipients, continueCursor, isDone };
	}
});

/**
 * Bounded count of a blast's matching recipients for the pre-send
 * totalRecipients display. Sub-class (B): a count, served by the same bounded
 * paginated scan as the send enumerator — never an unbounded .collect(). The
 * count saturates at RECIPIENT_COHORT_CAP and surfaces `truncated` as a floor.
 */
export const countBlastRecipients = internalQuery({
	args: {
		orgId: v.id('organizations'),
		blastId: v.optional(v.id('emailBlasts'))
	},
	handler: async (ctx, args) => {
		let filter: RecipientFilterShape = {};
		if (args.blastId) {
			const blast = await ctx.db.get(args.blastId);
			if (!blast || blast.orgId !== args.orgId) {
				throw new Error('Blast not found in this organization');
			}
			filter = readSafeRecipientFilter(blast.recipientFilter);
		}
		const { totalCount, truncated } = await countFilteredRecipients(
			ctx,
			args.orgId,
			filter,
			RECIPIENT_COHORT_CAP
		);
		return { totalCount, truncated };
	}
});

/**
 * Send an email blast.
 *
 * Auth boundary: This is an internalAction — callers (SvelteKit UI layer,
 * other internal functions) must validate the user's session and org
 * membership before invoking. The blast's orgId is verified against the
 * resolved org to prevent cross-tenant sends.
 *
 * Pipeline:
 *   1. Transition draft → sending (atomic)
 *   2. Count recipients, update blast
 *   3. Schedule first batch via sendBlastBatch
 *
 * Each batch processes up to 100 recipients then schedules the next batch,
 * avoiding action timeouts for large recipient lists.
 */
export const sendBlast = internalAction({
	args: {
		orgSlug: v.string(),
		blastId: v.id('emailBlasts')
	},
	handler: async (ctx, args) => {
		// Defense-in-depth: check email quota before sending
		const blastForQuota = await ctx.runQuery(getBlastByIdRef, {
			blastId: args.blastId
		});
		if (blastForQuota?.orgId) {
			const limits = await ctx.runQuery(internal.subscriptions.checkPlanLimitsByOrgId, {
				orgId: blastForQuota.orgId
			});
			if (limits && limits.current.emailsSent >= limits.limits.maxEmails) {
				await ctx.runMutation(updateBlastStatusRef, {
					blastId: args.blastId,
					status: 'failed'
				});
				throw new Error('EMAIL_QUOTA_EXCEEDED');
			}
		}

		// Transition to sending (the mutation enforces draft → sending)
		await ctx.runMutation(updateBlastStatusRef, {
			blastId: args.blastId,
			status: 'sending'
		});

		// Load blast
		const blast = await ctx.runQuery(getBlastByIdRef, {
			blastId: args.blastId
		});
		if (!blast) throw new Error('Blast not found');

		// Bounded count for totalRecipients — pass blastId so the persisted
		// recipientFilter is enforced at load. Counts via the paginated scan,
		// never a .collect() (cured).
		const { totalCount } = await ctx.runQuery(countBlastRecipientsRef, {
			orgId: blast.orgId,
			blastId: args.blastId
		});

		await ctx.runMutation(updateBlastStatusRef, {
			blastId: args.blastId,
			status: 'sending',
			totalRecipients: totalCount
		});

		if (totalCount === 0) {
			await ctx.runMutation(updateBlastStatusRef, {
				blastId: args.blastId,
				status: 'sent',
				totalSent: 0,
				sentAt: Date.now()
			});
			return { sent: 0 };
		}

		// Schedule the first batch (cursor null → first page).
		await ctx.scheduler.runAfter(0, sendBlastBatchRef, {
			blastId: args.blastId,
			cursor: null
		});

		return { scheduled: true, totalRecipients: totalCount };
	}
});

/**
 * Internal action: Process one batch of email blast recipients,
 * then schedule the next batch if more remain.
 */
export const sendBlastBatch = internalAction({
	args: {
		blastId: v.id('emailBlasts'),
		// Continuation cursor into the paginated recipient scan. null = first
		// page. Carried batch-to-batch so the FULL cohort is enumerated across
		// pages — no recipient is dropped past a fixed offset ceiling, and each
		// batch reads only its own page (not a re-scan of the entire roster).
		cursor: v.union(v.string(), v.null())
	},
	handler: async (ctx, args) => {
		const BATCH_SIZE = 100;

		// Load blast
		const blast = await ctx.runQuery(getBlastByIdRef, {
			blastId: args.blastId
		});
		if (!blast) {
			console.error(`[sendBlastBatch] Blast not found: ${args.blastId}`);
			return;
		}
		if (blast.status !== 'sending') {
			console.warn(`[sendBlastBatch] Blast ${args.blastId} status is ${blast.status}, skipping`);
			return;
		}

		// SES credentials
		const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
		const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
		const awsRegion = process.env.AWS_REGION || 'us-east-1';

		if (!awsAccessKeyId || !awsSecretAccessKey) {
			await ctx.runMutation(updateBlastStatusRef, {
				blastId: args.blastId,
				status: 'failed'
			});
			throw new Error('AWS SES credentials not configured');
		}

		try {
			// Fetch ONE supporter-page of recipients for this batch — pass blastId
			// so the persisted recipientFilter is enforced at load (cured).
			// BATCH_SIZE bounds the SUPPORTERS scanned per page; the matching
			// subset (`batch`) is at most that many. `continueCursor` resumes the
			// next batch exactly where this one stopped (clean page boundary — no
			// skips, no re-scan of the whole roster).
			const {
				recipients: batch,
				continueCursor,
				isDone
			} = await ctx.runQuery(getBlastRecipientsRef, {
				orgId: blast.orgId,
				limit: BATCH_SIZE,
				cursor: args.cursor,
				blastId: args.blastId
			});

			// A page can match zero recipients (all filtered out) yet NOT be the
			// last page. Only finalize when the scan is exhausted; otherwise resume
			// from the cursor so later pages are not skipped.
			if (batch.length === 0) {
				if (!isDone && continueCursor !== null) {
					await ctx.scheduler.runAfter(0, sendBlastBatchRef, {
						blastId: args.blastId,
						cursor: continueCursor
					});
				} else {
					await ctx.runMutation(updateBlastStatusRef, {
						blastId: args.blastId,
						status: 'sent',
						sentAt: Date.now()
					});
				}
				return;
			}

			// Unseal org key once per batch (not per recipient)
			const orgKey = await getOrgKeyForAction(ctx, blast.orgId);
			if (!orgKey)
				throw new Error('Organization encryption not configured — cannot decrypt emails');
			assertUnsubscribeHeaderConfig();

			let batchSent = 0;
			let batchFailed = 0;
			// Per-recipient receipts — fed to the SAME writer + invariants (upsert,
			// never-downgrade-sent, messageId-only-on-sent, cohort cap) the
			// client-direct/Lambda paths use, instead of only aggregate counters.
			const receipts: Array<{
				recipientEmailHash: string;
				sesMessageId?: string;
				status: 'sent' | 'failed';
				sentAt: number;
				error?: string;
			}> = [];

			for (const recipient of batch) {
				const recipientEmailHash = recipient.emailHash;
				try {
					const parsed = JSON.parse(recipient.encryptedEmail);
					// Version-aware decrypt dispatch (v=org-1 legacy AAD vs
					// v=org-2 emailHash AAD from the single-phase writes). The
					// recipient row carries the emailHash so the dispatcher can
					// route either way.
					const email = await decryptOrgPii(
						parsed,
						orgKey,
						recipient.emailHash,
						`supporter:${recipient._id}`,
						'email'
					);
					// Optional name decrypt — gracefully degrade to empty if absent.
					let firstName = '';
					let lastName = '';
					if (recipient.encryptedName) {
						try {
							const nameParsed = JSON.parse(recipient.encryptedName);
							const full = await decryptOrgPii(
								nameParsed,
								orgKey,
								recipient.emailHash,
								`supporter:${recipient._id}`,
								'name'
							);
							const trimmed = full.trim();
							const sp = trimmed.indexOf(' ');
							if (sp === -1) {
								firstName = trimmed;
							} else {
								firstName = trimmed.slice(0, sp);
								lastName = trimmed.slice(sp + 1).trim();
							}
						} catch {
							// Name decrypt failure shouldn't block delivery — fall through
							// with empty firstName/lastName so the message still ships.
						}
					}
					const verificationStatus: 'verified' | 'postal-resolved' | 'imported' = recipient.verified
						? 'verified'
						: recipient.postalCode
							? 'postal-resolved'
							: 'imported';
					// Engagement tier is not loaded per-recipient on this path:
					// {{tierLabel}} renders its fallback (or collapses) and
					// tierContext derives from verification status alone.
					const mergeContext = {
						firstName,
						lastName,
						email,
						postalCode: recipient.postalCode ?? null,
						verificationStatus,
						tierLabel: '',
						tierContext: buildEmailTierContext(verificationStatus)
					};
					const personalizedBody = applyEmailMergeFields(blast.bodyHtml, mergeContext);
					// Subject is an email header: resolve in 'header' mode so merge
					// values have CR/LF stripped (header-injection guard) and are NOT
					// HTML-escaped. The body stays in default 'html' mode above.
					const personalizedSubject = applyEmailMergeFields(blast.subject, mergeContext, 'header');
					const unsubscribeUrl = await buildConvexUnsubscribeUrl(
						String(recipient._id),
						String(blast.orgId)
					);
					const result = await sendViaSesWithResult(
						email,
						blast.fromEmail,
						blast.fromName,
						personalizedSubject,
						personalizedBody,
						awsAccessKeyId,
						awsSecretAccessKey,
						awsRegion,
						unsubscribeUrl
					);
					receipts.push({
						recipientEmailHash,
						sesMessageId: result.ok ? result.messageId : undefined,
						status: result.ok ? 'sent' : 'failed',
						sentAt: Date.now(),
						error: result.ok ? undefined : result.error
					});
					if (result.ok) {
						batchSent++;
					} else {
						batchFailed++;
					}
				} catch (err) {
					// Threw BEFORE SES was reached (decrypt/merge) — the case a
					// receipt matters most, and the case the old `catch {}` recorded
					// nothing. No sesMessageId; only the (already-truncated) reason.
					batchFailed++;
					receipts.push({
						recipientEmailHash,
						sesMessageId: undefined,
						status: 'failed',
						sentAt: Date.now(),
						error: err instanceof Error ? err.message.slice(0, 500) : 'send_failed'
					});
				}
			}

			// Persist per-recipient receipts FIRST (the forensic rows) via the shared
			// internal writer — upsert on (blastId, recipientEmailHash) so a
			// scheduler retry of this page never double-inserts and never downgrades
			// a confirmed 'sent'. Then the aggregate counters.
			if (receipts.length > 0) {
				await ctx.runMutation(internal.blasts.recordBlastReceiptsInternal, {
					blastId: args.blastId,
					receipts
				});
			}

			// Update running counters
			await ctx.runMutation(incrementBlastCountersRef, {
				blastId: args.blastId,
				sentDelta: batchSent,
				bouncedDelta: batchFailed
			});

			// Schedule next batch if the scan isn't exhausted. `isDone` (cursor
			// null) means this was the final page — finalize. Otherwise resume
			// from `continueCursor` so the next batch picks up exactly where this
			// one stopped.
			if (!isDone && continueCursor !== null) {
				await ctx.scheduler.runAfter(0, sendBlastBatchRef, {
					blastId: args.blastId,
					cursor: continueCursor
				});
			} else {
				// All done — finalize
				await ctx.runMutation(updateBlastStatusRef, {
					blastId: args.blastId,
					status: 'sent',
					sentAt: Date.now()
				});
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			console.error(
				`[sendBlastBatch] Blast ${args.blastId} batch (cursor ${args.cursor ?? 'start'}) failed:`,
				message
			);

			await ctx.runMutation(updateBlastStatusRef, {
				blastId: args.blastId,
				status: 'failed'
			});
		}
	}
});

/**
 * Internal mutation: Increment running sent/bounced counters for a blast batch.
 */
export const incrementBlastCounters = internalMutation({
	args: {
		blastId: v.id('emailBlasts'),
		sentDelta: v.number(),
		bouncedDelta: v.number()
	},
	handler: async (ctx, args) => {
		const blast = await ctx.db.get(args.blastId);
		if (!blast) return;

		await ctx.db.patch(args.blastId, {
			totalSent: (blast.totalSent || 0) + args.sentDelta,
			totalBounced: (blast.totalBounced || 0) + args.bouncedDelta,
			updatedAt: Date.now()
		});
	}
});

/**
 * Internal query: Get blast by ID.
 */
export const getBlastById = internalQuery({
	args: { blastId: v.id('emailBlasts') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.blastId);
	}
});

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Send email via SES v2 using raw HTTP (no AWS SDK dependency in Convex).
 * Uses the SES v2 SendEmail API with Signature V4 auth.
 */
/**
 * Inline html → plain-text fallback. Trades fidelity for size: strips tags,
 * collapses whitespace, decodes common entities. Good enough for the text/plain
 * part of a multipart/alternative email — the HTML part is always preferred
 * by Gmail/Outlook/Apple Mail, this just shows in clients that don't render
 * HTML (and quiets spam filters that flag HTML-only sends).
 */
function htmlToPlainText(html: string): string {
	return html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/ /g, ' ')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n[ \t]+/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export type SesSendResult = {
	ok: boolean;
	messageId?: string;
	status?: number;
	error?: string;
};

export async function sendViaSesWithResult(
	to: string,
	from: string,
	fromName: string,
	subject: string,
	htmlBody: string,
	accessKeyId: string,
	secretAccessKey: string,
	region: string,
	unsubscribeUrl?: string
): Promise<SesSendResult> {
	// SES v2 SendEmail via raw HTTP
	const endpoint = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
	const safeFromName = fromName.replace(/[\r\n\x00-\x1f\x7f]/g, '');
	const safeSubject = subject.replace(/[\r\n\x00-\x1f\x7f]/g, '');

	const textBody = htmlToPlainText(htmlBody);
	const safeUnsubscribeUrl = unsubscribeUrl ? safeHeaderUrl(unsubscribeUrl) : null;
	const headers = safeUnsubscribeUrl
		? [
				{ Name: 'List-Unsubscribe', Value: `<${safeUnsubscribeUrl}>` },
				{ Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }
			]
		: undefined;
	const body = JSON.stringify({
		Content: {
			Simple: {
				Subject: { Data: safeSubject, Charset: 'UTF-8' },
				Body: {
					Html: { Data: htmlBody, Charset: 'UTF-8' },
					// multipart/alternative — most email clients prefer HTML; spam
					// filters use the presence of a plain part as an authenticity
					// signal and (Gmail in particular) penalize HTML-only sends.
					Text: { Data: textBody, Charset: 'UTF-8' }
				},
				Headers: headers
			}
		},
		Destination: { ToAddresses: [to] },
		FromEmailAddress: `${safeFromName} <${from}>`
	});

	// AWS Signature V4
	const now = new Date();
	const dateStamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 8);
	const amzDate = now
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');
	const credentialScope = `${dateStamp}/${region}/ses/aws4_request`;

	const encoder = new TextEncoder();

	async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
		const cryptoKey = await crypto.subtle.importKey(
			'raw',
			key as BufferSource,
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
		return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
	}

	async function sha256Hex(data: string): Promise<string> {
		const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
		return Array.from(new Uint8Array(hash))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}

	const payloadHash = await sha256Hex(body);
	const canonicalHeaders = `content-type:application/json\nhost:email.${region}.amazonaws.com\nx-amz-date:${amzDate}\n`;
	const signedHeaders = 'content-type;host;x-amz-date';
	const canonicalRequest = `POST\n/v2/email/outbound-emails\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
	const canonicalRequestHash = await sha256Hex(canonicalRequest);

	const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

	const kDate = await hmacSha256(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
	const kRegion = await hmacSha256(kDate, region);
	const kService = await hmacSha256(kRegion, 'ses');
	const kSigning = await hmacSha256(kService, 'aws4_request');
	const signature = Array.from(new Uint8Array(await hmacSha256(kSigning, stringToSign)))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

	const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

	try {
		// 30s SES timeout — typical SendEmail responds in <1s; a hung fetch here
		// burns Convex action budget per stuck request. SES throttling/5xx
		// surfaces as `response.ok === false`; transport hangs surface as the
		// catch below returning `false`.
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Amz-Date': amzDate,
				Authorization: authHeader
			},
			body,
			signal: AbortSignal.timeout(30_000)
		});

		if (!response.ok) {
			// Structured logging on SES failure so operators can distinguish
			// throttling (429), credential rejection (403), 5xx, and address
			// rejection (400) — bare boolean masks all of these. PII guard:
			// log the response status + truncated AWS error type/code, never
			// the recipient address.
			const errBody = await response.text().catch(() => '');
			const truncated = errBody.slice(0, 300);
			console.warn(`[sendViaSes] SES rejected: status=${response.status} body=${truncated}`);
			return {
				ok: false,
				status: response.status,
				error: truncated || `status_${response.status}`
			};
		}
		const payload = (await response.json().catch(() => null)) as { MessageId?: unknown } | null;
		const messageId = typeof payload?.MessageId === 'string' ? payload.MessageId : undefined;
		return { ok: true, status: response.status, messageId };
	} catch (err) {
		// Transport failure (timeout, DNS, network) — distinct from SES-rejected.
		// Same PII guard.
		console.warn(
			`[sendViaSes] transport error: ${err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200)}`
		);
		return {
			ok: false,
			error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200)
		};
	}
}

export async function sendViaSes(
	to: string,
	from: string,
	fromName: string,
	subject: string,
	htmlBody: string,
	accessKeyId: string,
	secretAccessKey: string,
	region: string,
	unsubscribeUrl?: string
): Promise<boolean> {
	const result = await sendViaSesWithResult(
		to,
		from,
		fromName,
		subject,
		htmlBody,
		accessKeyId,
		secretAccessKey,
		region,
		unsubscribeUrl
	);
	return result.ok;
}

// =============================================================================
// CRON ACTIONS — internal actions called by convex/crons.ts
// =============================================================================

/**
 * Process pending bounce reports: consensus suppression + auto-resolve stale reports.
 * Called every 5 minutes by cron.
 */
export const processBounceReports = internalAction({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const staleThreshold = now - USER_BOUNCE_SUPPRESSION_MS;

		const pending = await ctx.runQuery(getPendingBounceReportsRef, {
			limit: USER_BOUNCE_REPORT_SCAN_LIMIT
		});
		const reportGroups = new Map<
			string,
			Array<{
				_id: Id<'bounceReports'>;
				emailHash?: string;
				domain: string;
				reportedBy: string;
			}>
		>();

		for (const report of pending) {
			if (!report.emailHash) continue;
			const group = reportGroups.get(report.emailHash) ?? [];
			group.push(report);
			reportGroups.set(report.emailHash, group);
		}

		let processed = 0;
		let suppressed = 0;
		for (const [emailHash, reports] of reportGroups) {
			const reporterCount = new Set(reports.map((report) => report.reportedBy)).size;
			if (reporterCount < USER_BOUNCE_REPORT_THRESHOLD) continue;

			const result = (await ctx.runMutation(suppressReportedBounceRef, {
				emailHash,
				domain: reports.find((report) => report.domain.trim())?.domain ?? 'unknown',
				reportIds: reports.map((report) => report._id),
				reporterCount
			})) as { reportsResolved: number };
			processed += result.reportsResolved;
			suppressed++;
		}

		// Find unresolved bounce reports older than 30 days and auto-resolve
		const stale = await ctx.runQuery(getStaleBounceReportsRef, {
			threshold: staleThreshold
		});

		let staleResolved = 0;
		for (const report of stale) {
			await ctx.runMutation(resolveBounceReportRef, {
				reportId: report._id,
				resolution: 'auto_resolved_stale'
			});
			staleResolved++;
		}

		console.log(
			`[process-bounces] checked=${reportGroups.size} suppressed=${suppressed} resolved=${processed} stale=${staleResolved}`
		);

		return { processed, suppressed, staleResolved, groupsChecked: reportGroups.size };
	}
});

/** Internal query: find recent unresolved bounce reports for consensus grouping. */
export const getPendingBounceReports = internalQuery({
	args: { limit: v.number() },
	handler: async (ctx, { limit }) => {
		return await ctx.db
			.query('bounceReports')
			.withIndex('by_resolved', (q) => q.eq('resolved', false))
			.take(Math.min(Math.max(limit, 1), USER_BOUNCE_REPORT_SCAN_LIMIT));
	}
});

/** Internal query: find stale unresolved bounce reports. */
export const getStaleBounceReports = internalQuery({
	args: { threshold: v.number() },
	handler: async (ctx, { threshold }) => {
		return await ctx.db
			.query('bounceReports')
			.withIndex('by_resolved', (q) => q.eq('resolved', false))
			.filter((q) => q.lt(q.field('_creationTime'), threshold))
			.take(100);
	}
});

/** Internal mutation: resolve a bounce report. */
export const resolveBounceReport = internalMutation({
	args: {
		reportId: v.id('bounceReports'),
		resolution: v.string()
	},
	handler: async (ctx, { reportId, resolution }) => {
		await ctx.db.patch(reportId, { resolved: true, probeResult: resolution });
	}
});

/** Internal mutation: suppress a consensus-confirmed manual bounce report group. */
export const suppressReportedBounce = internalMutation({
	args: {
		emailHash: v.string(),
		domain: v.string(),
		reportIds: v.array(v.id('bounceReports')),
		reporterCount: v.number()
	},
	handler: async (ctx, { emailHash, domain, reportIds, reporterCount }) => {
		const now = Date.now();
		const expiresAt = now + USER_BOUNCE_SUPPRESSION_MS;
		const activeSuppression = await ctx.db
			.query('suppressedEmails')
			.withIndex('by_emailHash', (q) => q.eq('emailHash', emailHash))
			.filter((q) => q.gt(q.field('expiresAt'), now))
			.first();

		if (!activeSuppression) {
			await ctx.db.insert('suppressedEmails', {
				emailHash,
				domain: domain || 'unknown',
				reason: 'bounce_report',
				source: 'user_report',
				reacherData: {
					reportCount: reportIds.length,
					reporterCount,
					suppressedBy: 'verified_user_report_consensus',
					suppressedAt: now
				},
				expiresAt
			});
		}

		const supporters = await ctx.db
			.query('supporters')
			.withIndex('by_globalEmailHash', (q) => q.eq('globalEmailHash', emailHash))
			.collect();
		let supportersUpdated = 0;
		for (const supporter of supporters) {
			if (supporter.emailStatus === 'complained') continue;
			await ctx.db.patch(supporter._id, {
				emailStatus: 'bounced',
				softBounceCount: Math.max(supporter.softBounceCount ?? 0, USER_BOUNCE_REPORT_THRESHOLD),
				updatedAt: now
			});
			// emailStatus → bounced is a counted transition (no-op if it was
			// already bounced, since the buckets net to zero). Cross-org lookup,
			// so each row updates its own org's breakdown.
			if (supporter.emailStatus !== 'bounced') {
				await applySupporterStatsDelta(ctx, supporter.orgId, supporter as CountableSupporter, {
					...(supporter as CountableSupporter),
					emailStatus: 'bounced'
				});
			}
			supportersUpdated++;
		}

		let reportsResolved = 0;
		for (const reportId of reportIds) {
			const report = await ctx.db.get(reportId);
			if (!report || report.resolved || report.emailHash !== emailHash) continue;
			await ctx.db.patch(reportId, {
				resolved: true,
				probeResult: 'suppressed_by_consensus'
			});
			reportsResolved++;
		}

		return {
			insertedSuppression: !activeSuppression,
			supportersUpdated,
			reportsResolved
		};
	}
});

/**
 * Send weekly alert digest emails.
 * Called Monday 14:00 UTC by cron.
 */
export const sendAlertDigests = internalAction({
	args: {},
	handler: async (ctx) => {
		// Find orgs with pending alerts, group by urgency, send via SES
		console.log('[alert-digest] Digest sending not yet implemented in Convex');
		return { totalSent: 0, totalFailed: 0, results: [] };
	}
});

/**
 * Find unresolved A/B test groups for the winner picker. Returns sibling
 * blasts (sharing abParentId) where neither has abWinnerPickedAt set and both
 * are in 'sent' status. Bounded scan (status='sent' is an indexed filter).
 */
export const _findAbCandidates = internalQuery({
	args: {},
	handler: async (ctx) => {
		const sentBlasts = await ctx.db
			.query('emailBlasts')
			.withIndex('by_status', (q) => q.eq('status', 'sent'))
			.order('desc')
			.take(500);
		return sentBlasts
			.filter((b) => b.isAbTest && !b.abWinnerPickedAt && (b.abParentId || b._id))
			.map((b) => ({
				_id: b._id,
				orgId: b.orgId,
				campaignId: b.campaignId ?? null,
				abParentId: b.abParentId ?? null,
				abVariant: b.abVariant ?? null,
				subject: b.subject,
				bodyHtml: b.bodyHtml,
				totalSent: b.totalSent,
				totalOpened: b.totalOpened,
				totalClicked: b.totalClicked,
				sentAt: b.sentAt ?? null,
				abTestConfig: b.abTestConfig ?? null
			}));
	}
});

/**
 * Mark sibling A/B blasts with abWinnerPickedAt + a winnerVariantId on the
 * losers so downstream surfaces know which one to render as the chosen
 * variant in reports/dashboards. Idempotent — re-running on already-marked
 * rows is a no-op.
 */
export const _markAbWinner = internalMutation({
	args: {
		blastIds: v.array(v.id('emailBlasts')),
		winnerId: v.id('emailBlasts'),
		pickedAt: v.number()
	},
	handler: async (ctx, args) => {
		for (const id of args.blastIds) {
			const blast = await ctx.db.get(id);
			if (!blast || blast.abWinnerPickedAt) continue;
			const rawConfig =
				blast.abTestConfig && typeof blast.abTestConfig === 'object'
					? (blast.abTestConfig as Record<string, unknown>)
					: {};
			await ctx.db.patch(id, {
				abWinnerPickedAt: args.pickedAt,
				abTestConfig: {
					...rawConfig,
					winnerBlastId: String(args.winnerId)
				},
				updatedAt: args.pickedAt
			});
		}
		return { winnerId: args.winnerId };
	}
});

/**
 * A/B winner picker (T1-6). Walks unresolved A/B test groups, computes a
 * two-proportion Z-test on open rates, picks a winner when p < 0.05
 * (|z| ≥ 1.96) or the 48h timeout has elapsed. Cron-driven every 15 min.
 *
 * Remainder-cohort send: documented as next-step. The winner is marked here
 * so dashboards/reports show the chosen variant. The held-back cohort is now
 * stored in `emailAbTestCohorts`, and the email detail route can materialize
 * it as an exact client-direct draft through `createAbRemainderDraft`.
 * This action deliberately does not send the remainder; automated dispatch
 * stays behind the T1-6b runner gate.
 */
export const pickAbWinners = internalAction({
	args: {},
	handler: async (ctx) => {
		const candidates = await ctx.runQuery(internal.email._findAbCandidates, {});

		// Group by abParentId (or self if it's the parent of its own group).
		const groups = new Map<string, typeof candidates>();
		for (const b of candidates) {
			const key = b.abParentId ?? String(b._id);
			const arr = groups.get(key) ?? [];
			arr.push(b);
			groups.set(key, arr);
		}

		const DEFAULT_TIMEOUT_MS = 48 * 60 * 60 * 1000;
		const Z_CRITICAL = 1.96; // two-tailed p<0.05
		let checked = 0;
		let picked = 0;

		for (const group of groups.values()) {
			if (group.length < 2) continue;
			checked++;

			// Take first two siblings — multi-variant beyond 2 deferred to later.
			const a = group[0];
			const b = group[1];
			const rawConfig =
				(a.abTestConfig && typeof a.abTestConfig === 'object'
					? (a.abTestConfig as Record<string, unknown>)
					: null) ??
				(b.abTestConfig && typeof b.abTestConfig === 'object'
					? (b.abTestConfig as Record<string, unknown>)
					: null);
			const rawWinnerMetric = rawConfig?.winnerMetric;
			const winnerMetric =
				readSupportedAbWinnerMetric(rawWinnerMetric) ??
				(rawWinnerMetric === undefined ? 'open' : null);
			if (!winnerMetric) continue;
			const timeoutMs =
				typeof rawConfig?.testDurationMs === 'number' &&
				Number.isFinite(rawConfig.testDurationMs) &&
				rawConfig.testDurationMs > 0
					? rawConfig.testDurationMs
					: DEFAULT_TIMEOUT_MS;
			const n1 = a.totalSent || 1;
			const n2 = b.totalSent || 1;
			const successesA = winnerMetric === 'click' ? a.totalClicked : a.totalOpened;
			const successesB = winnerMetric === 'click' ? b.totalClicked : b.totalOpened;
			const p1 = successesA / n1;
			const p2 = successesB / n2;
			const pooled = (successesA + successesB) / (n1 + n2);
			const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
			const z = se > 0 ? Math.abs(p1 - p2) / se : 0;
			const significant = z >= Z_CRITICAL;

			const latestSent = Math.max(a.sentAt ?? 0, b.sentAt ?? 0);
			const elapsed = Date.now() - latestSent;
			if (!significant && elapsed < timeoutMs) continue;

			const winner = p1 >= p2 ? a : b;
			await ctx.runMutation(internal.email._markAbWinner, {
				blastIds: group.map((g) => g._id),
				winnerId: winner._id,
				pickedAt: Date.now()
			});
			picked++;
		}

		return { checked, picked };
	}
});

/**
 * Count unresolved bounce reports for a user (per-user cap). Only the user
 * themselves can query their own count — anonymous callers can't poll random
 * userIds to learn who has filed bounce reports.
 */
export const countActiveReports = query({
	args: { userId: v.string() },
	handler: async (ctx, { userId }) => {
		const { userId: callerId } = await requireAuth(ctx);
		if (callerId !== (userId as Id<'users'>)) {
			throw new Error("Cannot query another user's report count");
		}
		const reports = await ctx.db
			.query('bounceReports')
			.filter((q) => q.and(q.eq(q.field('reportedBy'), userId), q.eq(q.field('resolved'), false)))
			.collect();
		return reports.length;
	}
});

/**
 * Find unresolved bounce report for same user + email (dedup). Internal-only:
 * caller-supplied (userId, emailHash) makes this a probe oracle otherwise
 * (`did user X report email Y?`). SvelteKit's /api/emails/report-bounce is
 * the legitimate caller and passes the internal secret.
 */
export const findUnresolvedReport = query({
	args: { _secret: v.string(), userId: v.string(), emailHash: v.string() },
	handler: async (ctx, { _secret, userId, emailHash }) => {
		requireInternalSecret(_secret);
		const report = await ctx.db
			.query('bounceReports')
			.withIndex('by_emailHash_resolved', (q) => q.eq('emailHash', emailHash).eq('resolved', false))
			.filter((q) => q.eq(q.field('reportedBy'), userId))
			.first();
		return report ? { _id: report._id } : null;
	}
});

/**
 * Create a bounce report. Internal-only: caller-supplied `reportedBy` would
 * otherwise let an anonymous caller impersonate any user as the reporter and
 * inject pollution rows. SvelteKit's /api/emails/report-bounce checks session
 * + trust-tier + per-user cap before invoking.
 */
export const createBounceReport = mutation({
	args: {
		_secret: v.string(),
		emailHash: v.string(),
		domain: v.string(),
		reportedBy: v.string()
	},
	handler: async (ctx, { _secret, emailHash, domain, reportedBy }) => {
		requireInternalSecret(_secret);
		const id = await ctx.db.insert('bounceReports', {
			emailHash,
			domain,
			reportedBy,
			resolved: false
		});

		return { id };
	}
});
