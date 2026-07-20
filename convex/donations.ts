import {
	query,
	mutation,
	action,
	internalAction,
	internalMutation,
	internalQuery
} from './_generated/server';
import { internal } from './_generated/api';
import { makeFunctionReference } from 'convex/server';
import type { FunctionReference } from 'convex/server';
import { v } from 'convex/values';
import { campaignStatus, donationStatus } from './_validators';
import { requireOrgRole } from './_authHelpers';
import { requireInternalSecret } from './_internalAuth';
import { computeOrgScopedEmailHash } from './_orgHash';
import { getOrgKeyForAction } from './_orgKeyUnseal';
import { decryptOrgPii, encryptForSupporterV2 } from './_orgKey';
import { sendViaSesWithResult } from './email';
import type { Doc, Id } from './_generated/dataModel';
import {
	CAMPAIGN_ACTIVE_COUNTER_VERSION,
	recordCampaignCreated,
	recordCampaignStatusTransition
} from './lib/campaignOrgCounters';
import { syncPublicOrganizationDirectory } from './lib/publicOrganizationDirectory';
import {
	applyDonationConfirmationTransition,
	donationConfirmationScopeKey,
	DONATION_CONFIRMATION_SUMMARY_MIGRATION_KEY,
	DONATION_CONFIRMATION_SUMMARY_VERSION,
	emptyDonationConfirmationCounts,
	getDonationConfirmationSummaryMigration
} from './lib/donationConfirmationSummary';

declare const process: { env: Record<string, string | undefined> };

const getCampaignRef = makeFunctionReference<'query'>(
	'donations:getCampaign'
) as unknown as FunctionReference<'query', 'internal'>;
const insertDonationRef = makeFunctionReference<'mutation'>(
	'donations:insertDonation'
) as unknown as FunctionReference<'mutation', 'internal'>;
const setStripeSessionIdRef = makeFunctionReference<'mutation'>(
	'donations:setStripeSessionId'
) as unknown as FunctionReference<'mutation', 'internal'>;
const DONATION_CONFIRMATION_MIGRATION_PAGE_SIZE = 64;

// =============================================================================
// DONATIONS — Queries, Mutations, Actions
// =============================================================================

// PII returned as encrypted blobs — client decrypts with org key

/**
 * List donations for an org.
 */
export const listByOrg = query({
	args: {
		orgSlug: v.string(),
		status: v.optional(donationStatus),
		paginationOpts: v.object({
			numItems: v.number(),
			cursor: v.union(v.string(), v.null())
		})
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');

		let q;
		if (args.status) {
			q = ctx.db.query('donations').withIndex('by_orgId', (qb) => qb.eq('orgId', org._id));
		} else {
			q = ctx.db.query('donations').withIndex('by_orgId', (qb) => qb.eq('orgId', org._id));
		}

		const results = await q.order('desc').paginate({
			numItems: Math.min(args.paginationOpts.numItems, 100),
			cursor: args.paginationOpts.cursor ?? null
		});

		// Post-filter by status if specified (index only covers orgId)
		let page = results.page;
		if (args.status) {
			page = page.filter((d) => d.status === args.status);
		}

		return { ...results, page };
	}
});

/**
 * List donations for a campaign.
 */
export const listByCampaign = query({
	args: {
		orgSlug: v.string(),
		campaignId: v.id('campaigns'),
		paginationOpts: v.object({
			numItems: v.number(),
			cursor: v.union(v.string(), v.null())
		})
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');

		// Verify campaign belongs to this org — prevents cross-tenant donation leakage
		const campaign = await ctx.db.get(args.campaignId);
		if (!campaign || campaign.orgId !== org._id)
			throw new Error('Campaign not found in this organization');

		const results = await ctx.db
			.query('donations')
			.withIndex('by_campaignId', (qb) => qb.eq('campaignId', args.campaignId))
			.order('desc')
			.paginate({
				numItems: Math.min(args.paginationOpts.numItems, 100),
				cursor: args.paginationOpts.cursor ?? null
			});

		return { ...results, page: results.page };
	}
});

/**
 * Summarize baseline donor-confirmation email outcomes. No PII is returned.
 * This is an operational confirmation register, not an accountability receipt
 * or a tax acknowledgment ledger.
 */
export const getConfirmationSummary = query({
	args: {
		orgSlug: v.string(),
		campaignId: v.optional(v.id('campaigns'))
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');
		const campaignId = args.campaignId;
		if (campaignId) {
			const campaign = await ctx.db.get(campaignId);
			if (!campaign || campaign.orgId !== org._id || campaign.type !== 'FUNDRAISER') {
				throw new Error('Fundraiser not found');
			}
		}
		const migration = await getDonationConfirmationSummaryMigration(ctx);
		if (migration?.status !== 'ready') {
			throw new Error('DONATION_CONFIRMATION_SUMMARIES_NOT_READY');
		}
		const scopeKey = donationConfirmationScopeKey({ orgId: org._id, campaignId });
		const row = await ctx.db
			.query('donationConfirmationSummaries')
			.withIndex('by_scopeKey', (q) => q.eq('scopeKey', scopeKey))
			.unique();
		if (row && row.version !== DONATION_CONFIRMATION_SUMMARY_VERSION) {
			throw new Error('DONATION_CONFIRMATION_SUMMARY_ROW_NOT_READY');
		}
		const counts = row ?? emptyDonationConfirmationCounts();
		return {
			completed: counts.completed,
			sent: counts.sent,
			sending: counts.sending,
			skipped: counts.skipped,
			failed: counts.failed,
			notRecorded: counts.notRecorded,
			providerAccepted: counts.providerAccepted,
			attempted: counts.sent + counts.sending + counts.skipped + counts.failed
		};
	}
});

export const donationConfirmationSummaryMigrationStatus = internalQuery({
	args: {},
	handler: async (ctx) => await getDonationConfirmationSummaryMigration(ctx)
});

export const migrateDonationConfirmationSummaries = internalMutation({
	args: {
		cursor: v.optional(v.union(v.string(), v.null())),
		restart: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		let migration = await getDonationConfirmationSummaryMigration(ctx);
		if (!migration) {
			const id = await ctx.db.insert('donationConfirmationSummaryMigrations', {
				key: DONATION_CONFIRMATION_SUMMARY_MIGRATION_KEY,
				status: 'running',
				scanned: 0,
				projected: 0,
				startedAt: now,
				updatedAt: now
			});
			migration = await ctx.db.get(id);
		} else if (migration.status === 'ready') {
			return migration;
		} else if (args.restart && (args.cursor ?? null) === null) {
			await ctx.db.patch(migration._id, {
				status: 'running',
				cursor: undefined,
				scanned: 0,
				projected: 0,
				failureCode: undefined,
				failureSourceId: undefined,
				completedAt: undefined,
				startedAt: now,
				updatedAt: now
			});
			migration = await ctx.db.get(migration._id);
		}
		if (!migration) throw new Error('DONATION_CONFIRMATION_MIGRATION_STATE_MISSING');
		if (migration.status === 'migrated') return migration;
		if (migration.status === 'blocked' && !args.restart) return migration;
		const expectedCursor = migration.cursor ?? null;
		if ((args.cursor ?? null) !== expectedCursor) {
			throw new Error('DONATION_CONFIRMATION_MIGRATION_CURSOR_MISMATCH');
		}
		const page = await ctx.db.query('donations').paginate({
			numItems: DONATION_CONFIRMATION_MIGRATION_PAGE_SIZE,
			cursor: expectedCursor,
			maximumRowsRead: DONATION_CONFIRMATION_MIGRATION_PAGE_SIZE + 1,
			maximumBytesRead: 4 * 1024 * 1024
		});
		let projected = 0;
		let failureSourceId: string | undefined;
		try {
			for (const donation of page.page) {
				failureSourceId = String(donation._id);
				if (donation.confirmationSummaryVersion === DONATION_CONFIRMATION_SUMMARY_VERSION) continue;
				const projectedDonation = {
					...donation,
					confirmationSummaryVersion: DONATION_CONFIRMATION_SUMMARY_VERSION
				};
				await applyDonationConfirmationTransition(ctx, null, projectedDonation, now);
				await ctx.db.patch(donation._id, {
					confirmationSummaryVersion: DONATION_CONFIRMATION_SUMMARY_VERSION
				});
				projected += 1;
			}
		} catch (error) {
			const failureCode =
				error instanceof Error ? error.message.slice(0, 200) : 'DONATION_SUMMARY_PROJECTION_FAILED';
			await ctx.db.patch(migration._id, {
				status: 'blocked',
				failureCode,
				failureSourceId,
				updatedAt: now
			});
			return { ...migration, status: 'blocked' as const, failureCode, failureSourceId };
		}
		const patch = {
			status: page.isDone ? ('migrated' as const) : ('running' as const),
			cursor: page.isDone ? undefined : page.continueCursor,
			scanned: migration.scanned + page.page.length,
			projected: migration.projected + projected,
			completedAt: page.isDone ? now : undefined,
			updatedAt: now
		};
		await ctx.db.patch(migration._id, patch);
		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, internal.donations.migrateDonationConfirmationSummaries, {
				cursor: page.continueCursor
			});
		}
		return { ...migration, ...patch };
	}
});

export const activateDonationConfirmationSummaries = internalMutation({
	args: {},
	handler: async (ctx) => {
		const migration = await getDonationConfirmationSummaryMigration(ctx);
		if (migration?.status === 'ready') return migration;
		if (
			!migration ||
			migration.status !== 'migrated' ||
			migration.cursor !== undefined ||
			migration.completedAt === undefined ||
			migration.failureCode !== undefined
		) {
			throw new Error('DONATION_CONFIRMATION_MIGRATION_INCOMPLETE');
		}
		await ctx.db.patch(migration._id, { status: 'ready', updatedAt: Date.now() });
		return { ...migration, status: 'ready' as const };
	}
});

/**
 * Retired public donor-list surface.
 *
 * No in-tree route consumes this function. Keeping the old implementation
 * direct-callable let any client repeatedly read every donation row — including
 * encrypted donor PII — before an in-memory status filter and slice. Preserve
 * the generated API symbol for an explicit compatibility error, but fail before
 * the campaign or donation tables are touched.
 */
export const listPublicByCampaign = query({
	args: {
		campaignId: v.id('campaigns'),
		limit: v.optional(v.number())
	},
	handler: async () => {
		throw new Error('PUBLIC_DONATION_LIST_RETIRED');
	}
});

/**
 * Create a donation record (typically from Stripe webhook after payment).
 * Internal-only: called from webhook processing, not exposed to clients.
 */
const DONATION_STATUS_VALIDATOR = v.union(
	v.literal('pending'),
	v.literal('completed'),
	v.literal('failed'),
	v.literal('refunded')
);

const CONFIRMATION_EMAIL_STATUS_VALIDATOR = v.union(
	v.literal('sending'),
	v.literal('sent'),
	v.literal('skipped'),
	v.literal('failed')
);

const DONATION_RECEIPT_POLICY_MODE_VALIDATOR = v.union(
	v.literal('confirmation_only'),
	v.literal('tax_acknowledgment_policy')
);

const DONATION_RECEIPT_POLICY_INPUT_VALIDATOR = v.object({
	mode: DONATION_RECEIPT_POLICY_MODE_VALIDATOR,
	legalName: v.optional(v.string()),
	acknowledgmentText: v.optional(v.string())
});

type DonationReceiptPolicyInput = {
	mode: 'confirmation_only' | 'tax_acknowledgment_policy';
	legalName?: string;
	acknowledgmentText?: string;
};

function cleanReceiptPolicy(input: DonationReceiptPolicyInput, configuredBy: Id<'users'>) {
	const legalName = input.legalName?.trim();
	const acknowledgmentText = input.acknowledgmentText?.trim();
	if (legalName && legalName.length > 200) {
		throw new Error('Receipt legal name must be 200 characters or fewer');
	}
	if (acknowledgmentText && acknowledgmentText.length > 1000) {
		throw new Error('Receipt acknowledgment text must be 1,000 characters or fewer');
	}
	return {
		mode: input.mode,
		legalName: legalName || undefined,
		acknowledgmentText: acknowledgmentText || undefined,
		configuredAt: Date.now(),
		configuredBy
	};
}

export const create = internalMutation({
	args: {
		campaignId: v.id('campaigns'),
		orgId: v.id('organizations'),
		supporterId: v.optional(v.id('supporters')),
		email: v.optional(v.string()),
		name: v.optional(v.string()),
		emailHash: v.optional(v.string()),
		encryptedEmail: v.optional(v.string()),
		encryptedName: v.optional(v.string()),
		amountCents: v.number(),
		currency: v.string(),
		recurring: v.boolean(),
		recurringInterval: v.optional(v.string()),
		stripeSessionId: v.optional(v.string()),
		stripePaymentIntentId: v.optional(v.string()),
		stripeSubscriptionId: v.optional(v.string()),
		districtHash: v.optional(v.string()),
		engagementTier: v.number(),
		status: DONATION_STATUS_VALIDATOR
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		await applyDonationConfirmationTransition(
			ctx,
			null,
			{
				orgId: args.orgId,
				campaignId: args.campaignId,
				status: args.status,
				confirmationSummaryVersion: DONATION_CONFIRMATION_SUMMARY_VERSION
			},
			now
		);
		const id = await ctx.db.insert('donations', {
			campaignId: args.campaignId,
			orgId: args.orgId,
			supporterId: args.supporterId,
			emailHash: args.emailHash,
			encryptedEmail: args.encryptedEmail,
			encryptedName: args.encryptedName,
			amountCents: args.amountCents,
			currency: args.currency,
			recurring: args.recurring,
			recurringInterval: args.recurringInterval,
			stripeSessionId: args.stripeSessionId,
			stripePaymentIntentId: args.stripePaymentIntentId,
			stripeSubscriptionId: args.stripeSubscriptionId,
			districtHash: args.districtHash,
			engagementTier: args.engagementTier,
			status: args.status,
			confirmationSummaryVersion: DONATION_CONFIRMATION_SUMMARY_VERSION,
			completedAt: undefined,
			updatedAt: now
		});

		return { id };
	}
});

/**
 * Update donation status (from Stripe webhook events).
 * Internal-only: called from webhook processing, not exposed to clients.
 */
export const updateStatus = internalMutation({
	args: {
		donationId: v.id('donations'),
		// Closed union — freeform `v.string()` would let a webhook payload
		// (or a buggy caller) write a garbage status string that downstream
		// consumers couldn't enumerate. Mirrors the tightening on
		// `workflowExecutions.status`.
		status: v.union(
			v.literal('pending'),
			v.literal('completed'),
			v.literal('failed'),
			v.literal('refunded')
		),
		stripePaymentIntentId: v.optional(v.string()),
		stripeSubscriptionId: v.optional(v.string()),
		completedAt: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const donation = await ctx.db.get(args.donationId);
		if (!donation) {
			throw new Error('Donation not found');
		}

		const patch: Record<string, unknown> = {
			status: args.status,
			confirmationSummaryVersion: DONATION_CONFIRMATION_SUMMARY_VERSION,
			updatedAt: Date.now()
		};

		if (args.stripePaymentIntentId !== undefined) {
			patch.stripePaymentIntentId = args.stripePaymentIntentId;
		}
		if (args.stripeSubscriptionId !== undefined) {
			patch.stripeSubscriptionId = args.stripeSubscriptionId;
		}
		if (args.completedAt !== undefined) {
			patch.completedAt = args.completedAt;
		}

		// On completion, update campaign fundraising totals.
		// Guard with `completedAt` (one-shot field set on first completion)
		// rather than `status !== "completed"`: a donation transitioning
		// refunded → completed (refund-and-recharge scenario) would pass a
		// `status !== "completed"` check and DOUBLE BUMP `raisedAmountCents`
		// + `donorCount`. The completedAt discriminator is set exactly once
		// and never cleared so the bump fires at most once per donation
		// lifetime.
		if (args.status === 'completed' && donation.completedAt === undefined) {
			patch.completedAt = patch.completedAt ?? Date.now();

			// Update campaign totals
			const campaign = await ctx.db.get(donation.campaignId);
			if (campaign) {
				await ctx.db.patch(donation.campaignId, {
					raisedAmountCents: campaign.raisedAmountCents + donation.amountCents,
					donorCount: campaign.donorCount + 1
				});
			}
		}

		const projectedDonation = {
			...donation,
			...patch,
			status: args.status,
			confirmationSummaryVersion: DONATION_CONFIRMATION_SUMMARY_VERSION
		} as Doc<'donations'>;
		await applyDonationConfirmationTransition(ctx, donation, projectedDonation, Date.now());
		await ctx.db.patch(args.donationId, patch);
	}
});

/**
 * Internal mutation: Insert donation with pre-encrypted PII.
 */
export const insertDonation = internalMutation({
	args: {
		campaignId: v.id('campaigns'),
		orgId: v.id('organizations'),
		supporterId: v.optional(v.id('supporters')),
		emailHash: v.string(),
		encryptedEmail: v.string(),
		encryptedName: v.optional(v.string()),
		amountCents: v.number(),
		currency: v.string(),
		recurring: v.boolean(),
		recurringInterval: v.optional(v.string()),
		districtHash: v.optional(v.string()),
		engagementTier: v.number(),
		status: DONATION_STATUS_VALIDATOR
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		await applyDonationConfirmationTransition(
			ctx,
			null,
			{
				orgId: args.orgId,
				campaignId: args.campaignId,
				status: args.status,
				confirmationSummaryVersion: DONATION_CONFIRMATION_SUMMARY_VERSION
			},
			now
		);
		const id = await ctx.db.insert('donations', {
			campaignId: args.campaignId,
			orgId: args.orgId,
			supporterId: args.supporterId,
			emailHash: args.emailHash,
			encryptedEmail: args.encryptedEmail,
			encryptedName: args.encryptedName,
			amountCents: args.amountCents,
			currency: args.currency,
			recurring: args.recurring,
			recurringInterval: args.recurringInterval,
			districtHash: args.districtHash,
			engagementTier: args.engagementTier,
			status: args.status,
			confirmationSummaryVersion: DONATION_CONFIRMATION_SUMMARY_VERSION,
			completedAt: undefined,
			updatedAt: now
		});
		return { id };
	}
});

/**
 * Internal query: Find donation by Stripe session ID.
 */
export const getByStripeSessionId = internalQuery({
	args: { sessionId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('donations')
			.withIndex('by_stripeSessionId', (q) => q.eq('stripeSessionId', args.sessionId))
			.first();
	}
});

/**
 * Action: Process a donation checkout.
 *
 * Pipeline:
 *   1. Validate campaign
 *   2. Encrypt donor PII
 *   3. Create donation record (pending)
 *   4. Create Stripe Checkout Session
 *   5. Update donation with session ID
 *   6. Return checkout URL
 */
export const processCheckout = action({
	args: {
		_secret: v.string(),
		campaignId: v.id('campaigns'),
		email: v.string(),
		name: v.string(),
		amountCents: v.number(),
		recurring: v.boolean(),
		recurringInterval: v.optional(v.string()),
		postalCode: v.optional(v.string()),
		districtCode: v.optional(v.string()),
		successUrl: v.string(),
		cancelUrl: v.string()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		// Validate amount
		if (args.amountCents < 100 || args.amountCents > 100_000_000) {
			throw new Error('Amount must be between $1.00 and $1,000,000.00');
		}

		// action-boundary length caps — parity with /api/d/[id]/checkout
		// SvelteKit boundary, so direct Convex invocations also fail-fast.
		if (args.email.length > 254) throw new Error('EMAIL_TOO_LARGE');
		if (args.name.length > 200) throw new Error('NAME_TOO_LARGE');
		if (args.postalCode !== undefined && args.postalCode.length > 16) {
			throw new Error('POSTAL_CODE_TOO_LARGE');
		}
		if (args.districtCode !== undefined && args.districtCode.length > 64) {
			throw new Error('DISTRICT_CODE_TOO_LARGE');
		}
		if (args.recurringInterval !== undefined && args.recurringInterval.length > 16) {
			throw new Error('RECURRING_INTERVAL_TOO_LARGE');
		}
		if (args.successUrl.length > 2048) throw new Error('SUCCESS_URL_TOO_LARGE');
		if (args.cancelUrl.length > 2048) throw new Error('CANCEL_URL_TOO_LARGE');

		// Validate email format
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email)) {
			throw new Error('Valid email is required');
		}

		// Load campaign
		const campaign = await ctx.runQuery(getCampaignRef, {
			campaignId: args.campaignId
		});
		if (!campaign) throw new Error('Campaign not found');
		if (campaign.status !== 'ACTIVE') throw new Error('Campaign is not accepting donations');

		// Compute district hash
		let districtHash: string | undefined;
		if (args.districtCode) {
			districtHash = await sha256Hex(args.districtCode.toLowerCase().trim());
		} else if (args.postalCode) {
			districtHash = await sha256Hex(args.postalCode.toLowerCase().trim());
		}

		const engagementTier = args.districtCode ? 2 : args.postalCode ? 1 : 0;

		const normalizedEmail = args.email.toLowerCase();

		// Unseal org key — required for PII encryption
		const orgKey = await getOrgKeyForAction(ctx, campaign.orgId);
		if (!orgKey)
			throw new Error(
				'Organization encryption not configured. An org owner must set up encryption in org settings before accepting donations.'
			);

		// Org-scoped email hash
		const emailHash = await computeOrgScopedEmailHash(campaign.orgId, normalizedEmail);

		// Rate limit: 5 checkouts per minute per campaign+donor (Stripe cost)
		const rlKey = `donations.processCheckout:${args.campaignId}:${emailHash.slice(0, 16)}`;
		const rl = await ctx.runMutation(internal._rateLimit.check, {
			key: rlKey,
			windowMs: 60_000,
			maxRequests: 5
		});
		if (!rl.allowed) throw new Error('Rate limit exceeded — please try again shortly');

		// Single-phase encrypt-then-insert via the v=org-2 AAD scheme. AAD
		// anchors on `eh:${emailHash}`, derivable from plaintext BEFORE any
		// DB write, so the donation lands in the table with real ciphertext
		// on the first insert. No follow-up patch, no placeholder window.
		// An older two-phase pattern (insert placeholder ⇒ encrypt with
		// post-insert id ⇒ patch) could strand rows on a crash between
		// steps. Legacy donations (v=org-1) keep decrypting via the post-id
		// AAD; the explicitly activated one-shot sweep drains only stranded
		// rows that predate this single-phase invariant.
		const [encEmail, encName] = await Promise.all([
			encryptForSupporterV2(normalizedEmail, orgKey, emailHash, 'email'),
			encryptForSupporterV2(args.name.trim(), orgKey, emailHash, 'name')
		]);
		const encryptedEmail = JSON.stringify(encEmail);
		const encryptedName = JSON.stringify(encName);

		const { id: donationDocId } = await ctx.runMutation(insertDonationRef, {
			campaignId: args.campaignId,
			orgId: campaign.orgId,
			emailHash,
			encryptedEmail,
			encryptedName,
			amountCents: args.amountCents,
			currency: campaign.donationCurrency || 'usd',
			recurring: args.recurring,
			recurringInterval: args.recurring ? args.recurringInterval || 'month' : undefined,
			districtHash,
			engagementTier,
			status: 'pending'
		});

		// Create Stripe Checkout Session
		const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
		if (!stripeSecretKey) {
			console.error('[donations.processCheckout] STRIPE_SECRET_KEY not configured');
			throw new Error('Service configuration error');
		}

		const mode = args.recurring ? 'subscription' : 'payment';
		const lineItem: Record<string, unknown> = {
			price_data: {
				currency: campaign.donationCurrency || 'usd',
				product_data: { name: campaign.title },
				unit_amount: args.amountCents,
				...(args.recurring ? { recurring: { interval: args.recurringInterval || 'month' } } : {})
			},
			quantity: 1
		};

		const stripeBody = new URLSearchParams();
		stripeBody.append('mode', mode);
		stripeBody.append('line_items[0][price_data][currency]', campaign.donationCurrency || 'usd');
		stripeBody.append('line_items[0][price_data][product_data][name]', campaign.title);
		stripeBody.append('line_items[0][price_data][unit_amount]', String(args.amountCents));
		if (args.recurring) {
			stripeBody.append(
				'line_items[0][price_data][recurring][interval]',
				args.recurringInterval || 'month'
			);
		}
		stripeBody.append('line_items[0][quantity]', '1');
		stripeBody.append('metadata[type]', 'donation');
		stripeBody.append('metadata[donationId]', String(donationDocId));
		stripeBody.append('metadata[orgId]', String(campaign.orgId));
		stripeBody.append('metadata[campaignId]', String(args.campaignId));
		stripeBody.append('success_url', args.successUrl);
		stripeBody.append('cancel_url', args.cancelUrl);
		stripeBody.append('customer_email', normalizedEmail);

		const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${stripeSecretKey}`,
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: stripeBody.toString()
		});

		if (!stripeResponse.ok) {
			const errText = await stripeResponse.text();
			console.error(`[donations.processCheckout] Stripe Checkout failed: ${errText}`);
			throw new Error('Payment processing failed — please try again');
		}

		const session = await stripeResponse.json();

		// Update donation with Stripe session ID
		await ctx.runMutation(setStripeSessionIdRef, {
			donationId: donationDocId,
			stripeSessionId: session.id
		});

		return { url: session.url, donationId: donationDocId };
	}
});

/**
 * Internal query: Get campaign for donation validation.
 */
export const getCampaign = internalQuery({
	args: { campaignId: v.id('campaigns') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.campaignId);
	}
});

// `patchEncryptedPii` is intentionally absent. The two-phase create
// pattern that needed it (insert placeholder ⇒ encrypt with post-insert
// id ⇒ patch) is replaced by single-phase v=org-2 encrypt-then-insert.
// If a non-checkout caller ever needs to update a donation's encrypted
// blob (e.g. operator-driven re-encryption migration), add a new helper
// that consumes a caller-supplied `eh:${emailHash}`-bound ciphertext
// rather than re-deriving AAD server-side — same invariant as the
// `email.recordEmailEvent` removal.

/**
 * Internal mutation: Set Stripe session ID on donation.
 */
export const setStripeSessionId = internalMutation({
	args: {
		donationId: v.id('donations'),
		stripeSessionId: v.string()
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.donationId, {
			stripeSessionId: args.stripeSessionId,
			updatedAt: Date.now()
		});
	}
});

// =============================================================================
// FUNDRAISING — Org-scoped fundraiser CRUD
// =============================================================================

/**
 * List fundraiser campaigns for an org, with aggregated donor counts.
 * No PII — amounts only.
 */
export const listByOrgWithDonors = query({
	args: {
		orgSlug: v.string(),
		// Filters FUNDRAISER campaigns by campaignStatus (DRAFT/ACTIVE/...),
		// NOT donations by donationStatus. The handler at line 569+ filters
		// campaigns table, not donations table.
		status: v.optional(campaignStatus),
		limit: v.optional(v.number()),
		cursor: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');
		const limit = Math.min(args.limit ?? 20, 100);
		const cursor = args.cursor ?? null;
		if (cursor !== null && cursor.length > 2_048) {
			throw new Error('FUNDRAISER_CURSOR_TOO_LARGE');
		}
		const page = args.status
			? await ctx.db
					.query('campaigns')
					.withIndex('by_orgId_type_status', (q) =>
						q.eq('orgId', org._id).eq('type', 'FUNDRAISER').eq('status', args.status!)
					)
					.order('desc')
					.paginate({
						numItems: limit,
						cursor,
						maximumRowsRead: limit + 1,
						maximumBytesRead: 512 * 1024
					})
			: await ctx.db
					.query('campaigns')
					.withIndex('by_orgId_type', (q) => q.eq('orgId', org._id).eq('type', 'FUNDRAISER'))
					.order('desc')
					.paginate({
						numItems: limit,
						cursor,
						maximumRowsRead: limit + 1,
						maximumBytesRead: 512 * 1024
					});

		return {
			data: page.page.map((c) => ({
				_id: c._id,
				title: c.title,
				description: c.body ?? null,
				status: c.status,
				goalAmountCents: c.goalAmountCents ?? null,
				raisedAmountCents: c.raisedAmountCents,
				donorCount: c.donorCount,
				donationCurrency: c.donationCurrency ?? 'usd',
				donationReceiptPolicy: c.donationReceiptPolicy ?? null,
				createdAt: new Date(c._creationTime).toISOString(),
				updatedAt: new Date(c.updatedAt).toISOString()
			})),
			meta: {
				cursor: page.isDone ? null : page.continueCursor,
				hasMore: !page.isDone
			}
		};
	}
});

/**
 * Create a fundraiser campaign. Requires editor role.
 */
export const createFundraiser = mutation({
	args: {
		orgSlug: v.string(),
		title: v.string(),
		description: v.optional(v.string()),
		goalAmountCents: v.optional(v.number()),
		currency: v.optional(v.string()),
		donationReceiptPolicy: v.optional(DONATION_RECEIPT_POLICY_INPUT_VALIDATOR)
	},
	handler: async (ctx, args) => {
		const { org, userId } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		if (!args.title || args.title.trim().length < 3) {
			throw new Error('Title is required (minimum 3 characters)');
		}

		if (args.goalAmountCents !== undefined && args.goalAmountCents !== null) {
			if (!Number.isInteger(args.goalAmountCents) || args.goalAmountCents <= 0) {
				throw new Error('Goal amount must be a positive integer (in cents)');
			}
		}

		const id = await ctx.db.insert('campaigns', {
			orgId: org._id,
			title: args.title.trim(),
			body: args.description?.trim() || undefined,
			type: 'FUNDRAISER',
			status: 'DRAFT',
			debateEnabled: false,
			debateThreshold: 100,
			goalAmountCents: args.goalAmountCents ?? undefined,
			raisedAmountCents: 0,
			donorCount: 0,
			donationCurrency: args.currency || 'usd',
			donationReceiptPolicy: args.donationReceiptPolicy
				? cleanReceiptPolicy(args.donationReceiptPolicy, userId)
				: undefined,
			targetCountry: org.countryCode,
			orgCounterVersion: CAMPAIGN_ACTIVE_COUNTER_VERSION,
			updatedAt: Date.now()
		});
		await recordCampaignCreated(ctx, org._id, 'DRAFT');
		await syncPublicOrganizationDirectory(ctx, org._id);

		return { id };
	}
});

/**
 * Update a fundraiser campaign. Requires editor role.
 */
export const updateFundraiser = mutation({
	args: {
		orgSlug: v.string(),
		campaignId: v.id('campaigns'),
		title: v.optional(v.string()),
		description: v.optional(v.string()),
		// Fundraiser is a campaign (type='FUNDRAISER') — status uses
		// campaignStatus (DRAFT/ACTIVE/PAUSED/COMPLETE), NOT donationStatus
		// (pending/completed/...). donationStatus applies to individual
		// donation rows.
		status: v.optional(campaignStatus),
		goalAmountCents: v.optional(v.number()),
		donationReceiptPolicy: v.optional(v.union(v.null(), DONATION_RECEIPT_POLICY_INPUT_VALIDATOR))
	},
	handler: async (ctx, args) => {
		const { org, userId } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		const campaign = await ctx.db.get(args.campaignId);
		if (!campaign || campaign.orgId !== org._id || campaign.type !== 'FUNDRAISER') {
			throw new Error('Fundraiser not found');
		}

		const patch: Record<string, unknown> = { updatedAt: Date.now() };

		if (args.title !== undefined) {
			if (typeof args.title !== 'string' || args.title.trim().length < 3) {
				throw new Error('Title must be at least 3 characters');
			}
			patch.title = args.title.trim();
		}

		if (args.description !== undefined) {
			patch.body = args.description?.trim() || undefined;
		}

		if (args.status !== undefined) {
			const VALID_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETE'];
			if (!VALID_STATUSES.includes(args.status)) {
				throw new Error('Status must be one of: DRAFT, ACTIVE, COMPLETE');
			}
			patch.status = args.status;
		}

		if (args.goalAmountCents !== undefined) {
			if (
				args.goalAmountCents !== null &&
				(!Number.isInteger(args.goalAmountCents) || args.goalAmountCents <= 0)
			) {
				throw new Error('Goal amount must be a positive integer (in cents)');
			}
			patch.goalAmountCents = args.goalAmountCents ?? undefined;
		}

		if (args.donationReceiptPolicy !== undefined) {
			patch.donationReceiptPolicy =
				args.donationReceiptPolicy === null
					? undefined
					: cleanReceiptPolicy(args.donationReceiptPolicy, userId);
		}

		if (args.status !== undefined && args.status !== campaign.status) {
			await recordCampaignStatusTransition(ctx, campaign, args.status);
		}
		await ctx.db.patch(args.campaignId, patch);
		if (args.status !== undefined && args.status !== campaign.status) {
			await syncPublicOrganizationDirectory(ctx, org._id);
		}

		const updated = await ctx.db.get(args.campaignId);
		return {
			_id: updated!._id,
			title: updated!.title,
			description: updated!.body ?? null,
			status: updated!.status,
			goalAmountCents: updated!.goalAmountCents ?? null,
			raisedAmountCents: updated!.raisedAmountCents,
			donorCount: updated!.donorCount,
			donationCurrency: updated!.donationCurrency ?? 'usd',
			donationReceiptPolicy: updated!.donationReceiptPolicy ?? null,
			updatedAt: new Date(updated!.updatedAt).toISOString()
		};
	}
});

/**
 * Delete (soft-delete) a fundraiser. Sets status to COMPLETE. Requires editor role.
 */
export const deleteFundraiser = mutation({
	args: {
		orgSlug: v.string(),
		campaignId: v.id('campaigns')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		const campaign = await ctx.db.get(args.campaignId);
		if (!campaign || campaign.orgId !== org._id || campaign.type !== 'FUNDRAISER') {
			throw new Error('Fundraiser not found');
		}

		await recordCampaignStatusTransition(ctx, campaign, 'COMPLETE');
		await ctx.db.patch(args.campaignId, {
			status: 'COMPLETE',
			updatedAt: Date.now()
		});
		await syncPublicOrganizationDirectory(ctx, org._id);

		return { success: true };
	}
});

/**
 * List donors for a fundraiser. No PII in public response (amounts only).
 * Editor role required for name/email access.
 */
export const listDonors = query({
	args: {
		orgSlug: v.string(),
		campaignId: v.id('campaigns'),
		limit: v.optional(v.number()),
		cursor: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		const campaign = await ctx.db.get(args.campaignId);
		if (!campaign || campaign.orgId !== org._id || campaign.type !== 'FUNDRAISER') {
			throw new Error('Fundraiser not found');
		}

		const limit = Math.min(Math.max(Math.floor(args.limit ?? 100), 1), 100);
		const cursor = args.cursor ?? null;
		if (cursor !== null && cursor.length > 2_048) throw new Error('DONOR_CURSOR_TOO_LARGE');
		const donations = await ctx.db
			.query('donations')
			.withIndex('by_campaignId_status', (q) =>
				q.eq('campaignId', args.campaignId).eq('status', 'completed')
			)
			.order('desc')
			.paginate({
				numItems: limit,
				cursor,
				maximumRowsRead: limit + 1,
				maximumBytesRead: 2 * 1024 * 1024
			});

		const data = donations.page.map((d) => ({
			_id: d._id,
			encryptedName: d.encryptedName ?? null,
			encryptedEmail: d.encryptedEmail ?? null,
			amountCents: d.amountCents,
			recurring: d.recurring,
			engagementTier: d.engagementTier,
			districtHash: d.districtHash ? d.districtHash.slice(0, 12) : null,
			completedAt: d.completedAt ? new Date(d.completedAt).toISOString() : null,
			confirmationEmailStatus: d.confirmationEmailStatus ?? null,
			confirmationEmailAttemptedAt: d.confirmationEmailAttemptedAt
				? new Date(d.confirmationEmailAttemptedAt).toISOString()
				: null,
			confirmationEmailSentAt: d.confirmationEmailSentAt
				? new Date(d.confirmationEmailSentAt).toISOString()
				: null,
			confirmationEmailFailureReason: d.confirmationEmailFailureReason ?? null,
			confirmationEmailProvider: d.confirmationEmailProvider ?? null,
			confirmationEmailProviderMessageId: d.confirmationEmailProviderMessageId ?? null
		}));

		return {
			data,
			meta: {
				cursor: donations.isDone ? null : donations.continueCursor,
				hasMore: !donations.isDone
			}
		};
	}
});

// =============================================================================
// HELPERS
// =============================================================================

async function sha256Hex(data: string): Promise<string> {
	const encoder = new TextEncoder();
	const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

// =============================================================================
// PLACEHOLDER DONATION CLEANUP (parallels supporters placeholder sweep)
// =============================================================================

const SWEEP_KEY_STRANDED_DONATIONS = 'donations.strandedPlaceholders';

/**
 * Internal query: collect one page of legacy/operator-bootstrap donations
 * whose encryptedEmail is still empty. Current checkout writers encrypt
 * before their first insert; this query exists solely for the explicitly
 * activated, versioned one-shot cleanup.
 *
 * Uses cursor-based pagination across the donations table (no order
 * assumption) so the sweep can drain even very large tables across
 * multiple cron ticks via the `sweepCheckpoints` checkpoint table.
 */
export const getStrandedDonationPlaceholders = internalQuery({
	args: {
		olderThanMs: v.number(),
		paginationCursor: v.optional(v.string()),
		limit: v.number()
	},
	handler: async (ctx, { olderThanMs, paginationCursor, limit }) => {
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
			throw new Error('STRANDED_DONATION_SWEEP_LIMIT_INVALID');
		}
		const cutoff = Date.now() - olderThanMs;
		const scanRows = limit * 10;
		const result = await ctx.db.query('donations').paginate({
			numItems: scanRows,
			cursor: paginationCursor ?? null,
			maximumRowsRead: scanRows + 1,
			maximumBytesRead: 512 * 1024
		});
		if (result.pageStatus === 'SplitRequired') {
			throw new Error('STRANDED_DONATION_SWEEP_PAGE_TOO_LARGE');
		}
		const stranded = result.page.filter(
			(d) => (d.encryptedEmail === '' || d.encryptedEmail === undefined) && d._creationTime < cutoff
		);
		return {
			items: stranded.slice(0, limit).map((d) => ({
				_id: d._id,
				orgId: d.orgId,
				campaignId: d.campaignId,
				status: d.status,
				ageMs: Date.now() - d._creationTime
			})),
			continueCursor: result.continueCursor,
			isDone: result.isDone
		};
	}
});

/**
 * Internal mutation: delete a stranded donation placeholder row.
 * OCC-guarded — re-reads inside the mutation transaction and refuses
 * if an operator repair landed concurrent with the sweep's pagination.
 * Mirrors `supporters.deleteStrandedPlaceholder`.
 */
export const deleteStrandedDonationPlaceholder = internalMutation({
	args: { donationId: v.id('donations') },
	handler: async (ctx, { donationId }) => {
		const current = await ctx.db.get(donationId);
		if (!current) return { ok: false, reason: 'not_found' } as const;
		if (current.status === 'completed') return { ok: false, reason: 'completed' } as const;
		if (current.encryptedEmail && current.encryptedEmail !== '') {
			return { ok: false, reason: 'not_placeholder' } as const;
		}
		await applyDonationConfirmationTransition(ctx, current, null, Date.now());
		await ctx.db.delete(donationId);
		return { ok: true } as const;
	}
});

/**
 * Cleanup action: sweep stranded donation placeholders.
 *
 * Current checkout writers encrypt before the first insert. This explicitly
 * activated migration removes only legacy/bootstrap rows that predate that
 * invariant and still contain empty ciphertext.
 *
 * Donation-specific preservation: rows in `pending` status that fail
 * could have a pending Stripe session in flight. We only sweep rows
 * older than 30 minutes AND not in `completed` status (a completed
 * row with empty ciphertext is forensic — the campaign counter
 * already bumped, the money already moved). Status `failed` and
 * `pending` past 30 min are safe to delete: Stripe sessions expire
 * after 24 h; the 30-minute floor also avoids racing a coordinated legacy
 * repair that is still in flight.
 */
// =============================================================================
// DONOR CONFIRMATION EMAILS
// =============================================================================

/**
 * Donation row + minimal org context needed to send a confirmation email — pulled in a
 * single query so the action doesn't N+1 across runs.
 */
export const getDonationForReceipt = internalQuery({
	args: { donationId: v.id('donations') },
	handler: async (ctx, { donationId }) => {
		const d = await ctx.db.get(donationId);
		if (!d) return null;
		if (d.status !== 'completed') return null;
		if (!d.encryptedEmail || !d.emailHash) return null;
		const org = await ctx.db.get(d.orgId);
		if (!org) return null;
		const campaign = d.campaignId ? await ctx.db.get(d.campaignId) : null;
		return {
			donation: {
				_id: d._id,
				encryptedEmail: d.encryptedEmail,
				emailHash: d.emailHash,
				encryptedName: d.encryptedName ?? null,
				amountCents: d.amountCents,
				currency: d.currency,
				recurring: d.recurring,
				completedAt: d.completedAt ?? Date.now()
			},
			org: {
				_id: org._id,
				name: org.name,
				slug: org.slug
			},
			campaign: campaign
				? {
						_id: campaign._id,
						title: campaign.title,
						donationReceiptPolicy: campaign.donationReceiptPolicy ?? null
					}
				: null
		};
	}
});

export const claimConfirmationEmailSend = internalMutation({
	args: { donationId: v.id('donations') },
	handler: async (ctx, { donationId }) => {
		const donation = await ctx.db.get(donationId);
		if (
			!donation ||
			donation.status !== 'completed' ||
			!donation.encryptedEmail ||
			!donation.emailHash
		) {
			return { claimed: false, reason: 'not_eligible' as const };
		}

		if (donation.confirmationEmailStatus === 'sent') {
			return { claimed: false, reason: 'already_sent' as const };
		}

		const now = Date.now();
		const freshClaimMs = 5 * 60 * 1000;
		if (
			donation.confirmationEmailStatus === 'sending' &&
			donation.confirmationEmailAttemptedAt !== undefined &&
			now - donation.confirmationEmailAttemptedAt < freshClaimMs
		) {
			return { claimed: false, reason: 'in_flight' as const };
		}

		const patch = {
			confirmationEmailStatus: 'sending',
			confirmationEmailAttemptedAt: now,
			confirmationEmailFailureReason: undefined,
			confirmationEmailProvider: undefined,
			confirmationEmailProviderMessageId: undefined,
			confirmationSummaryVersion: DONATION_CONFIRMATION_SUMMARY_VERSION
		} as const;
		await applyDonationConfirmationTransition(ctx, donation, { ...donation, ...patch }, now);
		await ctx.db.patch(donationId, patch);

		return { claimed: true, reason: 'claimed' as const };
	}
});

export const recordConfirmationEmailResult = internalMutation({
	args: {
		donationId: v.id('donations'),
		status: CONFIRMATION_EMAIL_STATUS_VALIDATOR,
		reason: v.optional(v.string()),
		provider: v.optional(v.string()),
		providerMessageId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const donation = await ctx.db.get(args.donationId);
		if (!donation) return { recorded: false, reason: 'not_found' as const };
		if (donation.confirmationEmailStatus === 'sent' && args.status !== 'sent') {
			return { recorded: false, reason: 'already_sent' as const };
		}

		const now = Date.now();
		const patch: Record<string, unknown> = {
			confirmationEmailStatus: args.status,
			confirmationEmailAttemptedAt: now,
			confirmationSummaryVersion: DONATION_CONFIRMATION_SUMMARY_VERSION,
			confirmationEmailFailureReason:
				args.status === 'sent' ? undefined : (args.reason ?? args.status)
		};
		if (args.status === 'sent') {
			patch.confirmationEmailSentAt = now;
			patch.confirmationEmailProvider = args.provider;
			patch.confirmationEmailProviderMessageId = args.providerMessageId;
		} else {
			patch.confirmationEmailProvider = undefined;
			patch.confirmationEmailProviderMessageId = undefined;
		}

		await applyDonationConfirmationTransition(
			ctx,
			donation,
			{ ...donation, ...patch, confirmationEmailStatus: args.status } as Doc<'donations'>,
			now
		);
		await ctx.db.patch(args.donationId, patch);
		return { recorded: true };
	}
});

/**
 * Send a baseline donor confirmation for a completed donation. Idempotent:
 * no-op when a confirmation has already been sent or a fresh attempt is in
 * flight. Scheduled from completeDonation, so delivery happens out-of-band of
 * the Stripe webhook ack — a slow SES doesn't back up the webhook handler.
 *
 * Confirmation content: org name, campaign (if any), amount, recurring cadence
 * (if any), completedAt timestamp, and the fundraiser's operator-authored
 * receipt-policy text when configured. That policy text is custody evidence
 * only: Commons does not validate EIN/tax status, legal sufficiency, or receipt
 * anchoring in this path.
 */
export const sendReceiptEmail = internalAction({
	args: { donationId: v.id('donations') },
	handler: async (ctx, { donationId }) => {
		const ctxData = await ctx.runQuery(internal.donations.getDonationForReceipt, {
			donationId
		});
		if (!ctxData) return { sent: false, reason: 'not_eligible' as const };

		const claim: { claimed: boolean; reason: string } = await ctx.runMutation(
			internal.donations.claimConfirmationEmailSend,
			{ donationId }
		);
		if (!claim.claimed) {
			return { sent: false, reason: claim.reason };
		}

		async function finish(
			status: 'sent' | 'skipped' | 'failed',
			reason: string,
			provider?: string,
			providerMessageId?: string
		): Promise<{ sent: boolean; reason: string }> {
			await ctx.runMutation(internal.donations.recordConfirmationEmailResult, {
				donationId,
				status,
				reason,
				provider,
				providerMessageId
			});
			return { sent: status === 'sent', reason };
		}

		const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
		const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
		const awsRegion = process.env.AWS_REGION || 'us-east-1';
		const fromEmail = process.env.RECEIPT_FROM_EMAIL || process.env.SES_FROM_EMAIL;
		if (!awsAccessKeyId || !awsSecretAccessKey || !fromEmail) {
			console.warn(
				'[sendReceiptEmail] SES creds or RECEIPT_FROM_EMAIL not configured — skipping donor confirmation'
			);
			return await finish('skipped', 'not_configured');
		}

		const orgKey = await getOrgKeyForAction(ctx, ctxData.org._id);
		if (!orgKey) return await finish('skipped', 'org_key_unavailable');

		let donorEmail: string;
		try {
			const parsed = JSON.parse(ctxData.donation.encryptedEmail);
			donorEmail = await decryptOrgPii(
				parsed,
				orgKey,
				ctxData.donation.emailHash,
				`donation:${ctxData.donation._id}`,
				'email'
			);
		} catch {
			return await finish('failed', 'decrypt_failed');
		}

		let donorFirstName = '';
		if (ctxData.donation.encryptedName) {
			try {
				const parsed = JSON.parse(ctxData.donation.encryptedName);
				const full = await decryptOrgPii(
					parsed,
					orgKey,
					ctxData.donation.emailHash,
					`donation:${ctxData.donation._id}`,
					'name'
				);
				donorFirstName = full.trim().split(/\s+/)[0] ?? '';
			} catch {
				// Name decrypt failure is non-fatal — receipt sends with empty greeting
			}
		}

		const amount = (ctxData.donation.amountCents / 100).toLocaleString(undefined, {
			style: 'currency',
			currency: (ctxData.donation.currency || 'USD').toUpperCase()
		});
		const greeting = donorFirstName ? `Hi ${escape(donorFirstName)},` : 'Hello,';
		const campaignLine = ctxData.campaign
			? `<p style="margin:0 0 12px 0;">Campaign: <strong>${escape(ctxData.campaign.title)}</strong></p>`
			: '';
		const recurringLine = ctxData.donation.recurring
			? '<p style="margin:0 0 12px 0;">This is a recurring contribution.</p>'
			: '';
		const policySection = renderDonationReceiptPolicySection(
			ctxData.campaign?.donationReceiptPolicy ?? null,
			ctxData.org.name
		);
		const subject = `Receipt for your donation to ${ctxData.org.name}`;
		const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;background:#09090b;color:#e4e4e7;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:20px;">
    <p style="margin:0 0 12px 0;">${greeting}</p>
    <p style="margin:0 0 12px 0;">
      Thank you for your donation to <strong>${escape(ctxData.org.name)}</strong>.
    </p>
    ${campaignLine}
    <p style="margin:0 0 12px 0;">Amount: <strong>${amount}</strong></p>
    ${recurringLine}
    ${policySection}
    <p style="margin:0 0 12px 0;font-size:12px;color:#71717a;">
      Completed at ${new Date(ctxData.donation.completedAt).toISOString()}.
    </p>
    <p style="margin:0;font-size:11px;color:#52525b;">
      Reference: ${escape(String(ctxData.donation._id))}
    </p>
  </div>
</body></html>`;

		const sendResult = await sendViaSesWithResult(
			donorEmail,
			fromEmail,
			ctxData.org.name,
			subject,
			html,
			awsAccessKeyId,
			awsSecretAccessKey,
			awsRegion
		);
		return await finish(
			sendResult.ok ? 'sent' : 'failed',
			sendResult.ok ? 'provider_accepted' : (sendResult.error ?? 'ses_failed'),
			sendResult.ok ? 'ses' : undefined,
			sendResult.messageId
		);
	}
});

function renderDonationReceiptPolicySection(
	policy:
		| {
				mode: 'confirmation_only' | 'tax_acknowledgment_policy';
				legalName?: string;
				acknowledgmentText?: string;
		  }
		| null
		| undefined,
	orgName: string
): string {
	if (!policy) return '';

	const legalNameLine = policy.legalName
		? `<p style="margin:0 0 8px 0;">Organization legal name: <strong>${escape(
				policy.legalName
			)}</strong></p>`
		: '';
	const policyText = policy.acknowledgmentText?.trim()
		? `<p style="margin:0 0 8px 0;">${escape(policy.acknowledgmentText.trim())}</p>`
		: policy.mode === 'tax_acknowledgment_policy'
			? '<p style="margin:0 0 8px 0;">This fundraiser is marked by the organization as requiring a tax acknowledgment policy, but no acknowledgment text has been configured.</p>'
			: '<p style="margin:0 0 8px 0;">This confirmation records the donation transaction. No additional acknowledgment text has been configured.</p>';
	const modeLabel =
		policy.mode === 'tax_acknowledgment_policy'
			? 'Tax acknowledgment policy'
			: 'Confirmation policy';

	return `<div style="margin:16px 0 12px 0;padding:12px;border:1px solid #3f3f46;border-radius:6px;background:#111113;">
      <p style="margin:0 0 8px 0;font-size:12px;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.08em;">${modeLabel}</p>
      ${legalNameLine}
      ${policyText}
      <p style="margin:0;font-size:11px;line-height:1.5;color:#71717a;">
        This text was configured by ${escape(orgName)}. Commons records and delivers it as fundraiser policy context; Commons has not verified tax status, legal sufficiency, or anchored receipt proof for this donation.
      </p>
    </div>`;
}

function escape(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export const sweepStrandedDonations = internalAction({
	args: {},
	handler: async (ctx) => {
		const STRANDED_THRESHOLD_MS = 30 * 60 * 1000;
		const BATCH = 50;
		const activation: { active: boolean; status: 'running' | 'complete' | 'not_activated' } =
			await ctx.runQuery(internal.supporters.strandedPlaceholderSweepActivation, {
				key: SWEEP_KEY_STRANDED_DONATIONS
			});
		if (!activation.active) {
			return {
				status: activation.status,
				deleted: 0,
				preserved: 0,
				skipped: 0,
				totalSeen: 0,
				pagesScanned: 0,
				wrapCount: 0,
				wrapped: false
			};
		}
		// Completed/refunded rows that somehow lost their ciphertext are
		// PRESERVED — the donation's financial state is real (money moved),
		// and the row carries audit data (sentAt, stripePaymentIntentId,
		// amountCents). Deleting it would erase the audit trail.
		const PRESERVE_STATUSES = new Set(['completed', 'refunded']);

		let deleted = 0;
		let preserved = 0;
		let skipped = 0;
		let totalSeen = 0;

		const checkpoint: {
			cursor?: string;
			wrapCount: number;
			cursorRevision: number;
			runToken: string;
			checkpointId: Id<'sweepCheckpoints'>;
		} = await ctx.runMutation(internal.supporters.loadSweepCheckpoint, {
			key: SWEEP_KEY_STRANDED_DONATIONS
		});
		const result: {
			items: Array<{
				_id: Id<'donations'>;
				orgId: Id<'organizations'>;
				campaignId: Id<'campaigns'>;
				status: string;
				ageMs: number;
			}>;
			continueCursor: string;
			isDone: boolean;
		} = await ctx.runQuery(internal.donations.getStrandedDonationPlaceholders, {
			olderThanMs: STRANDED_THRESHOLD_MS,
			paginationCursor: checkpoint.cursor,
			limit: BATCH
		});
		totalSeen = result.items.length;

		for (const d of result.items) {
			if (PRESERVE_STATUSES.has(d.status)) {
				console.warn(
					`[sweepStrandedDonations] PRESERVING completed/refunded donation ${d._id} (status=${d.status}, ageMs=${d.ageMs}) — financial audit trail must survive cleanup`
				);
				preserved++;
				continue;
			}
			const deleteResult: { ok: boolean; reason?: string } = await ctx.runMutation(
				internal.donations.deleteStrandedDonationPlaceholder,
				{ donationId: d._id }
			);
			if (deleteResult.ok) {
				console.warn(
					`[sweepStrandedDonations] Deleted stranded donation ${d._id} (orgId=${d.orgId}, campaignId=${d.campaignId}, status=${d.status}, ageMs=${d.ageMs}) — processCheckout crashed mid-flight`
				);
				deleted++;
			} else {
				skipped++;
			}
		}

		await ctx.runMutation(internal.supporters.saveSweepCheckpoint, {
			checkpointId: checkpoint.checkpointId,
			expectedCursor: checkpoint.cursor,
			expectedRevision: checkpoint.cursorRevision,
			runToken: checkpoint.runToken,
			cursor: result.continueCursor,
			wrapped: result.isDone
		});

		return {
			deleted,
			preserved,
			skipped,
			totalSeen,
			pagesScanned: 1,
			wrapCount: result.isDone ? checkpoint.wrapCount + 1 : checkpoint.wrapCount,
			wrapped: result.isDone
		};
	}
});
