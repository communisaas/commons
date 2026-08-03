/**
 * Subscription/billing CRUD — queries, mutations, and the Stripe webhook action.
 *
 * Plan definitions come from ./lib/planLimits — the one table both this Convex
 * boundary and the SvelteKit boundary read. Nothing here restates a limit.
 */

import {
	query,
	mutation,
	internalAction,
	internalMutation,
	internalQuery
} from './_generated/server';
import { internal } from './_generated/api';
import { makeFunctionReference, type FunctionReference } from 'convex/server';
import { v } from 'convex/values';
import { subscriptionPlan, subscriptionStatus, subscriptionPaymentMethod } from './_validators';
import { requireAuth, requireOrgRole } from './_authHelpers';
import { requireInternalSecret } from './_internalAuth';
import type { Id, Doc } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import {
	enqueuePlanUsageRepair,
	isPlanUsageMigrationReady,
	PLAN_USAGE_MIGRATION_KEY,
	projectedPlanUsageForPeriod,
	snapshotPlanUsageBaselines,
	type ProjectedPlanUsage
} from './lib/planUsage';

// Plan tables — the org table and the person-layer table, both read straight
// from the shared source. They are DELIBERATELY SEPARATE: individual plans carry
// no org quotas (no maxEmails / maxSms / maxSeats / maxTemplatesMonth), so an
// individual sub never syncs org limits. The org `checkPlanLimits` path reads
// PLANS (keyed on orgId); the individual authoring cap (templates.ts) reads the
// per-plan authored limit. Neither scope can read the other's plans.
import {
	ORG_PLAN_LIMITS as PLANS,
	INDIVIDUAL_PLAN_LIMITS as INDIVIDUAL_PLANS
} from './lib/planLimits';

const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const expirePastDueGraceRef = makeFunctionReference<'mutation'>(
	'subscriptions:expirePastDueGrace'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ subscriptionId: Id<'subscriptions'>; expectedPastDueSince: number },
	unknown
>;
const continuePastDueGraceSweepRef = makeFunctionReference<'mutation'>(
	'subscriptions:sweepPastDueGrace'
) as unknown as FunctionReference<'mutation', 'internal', { cursor?: string }, unknown>;
const continueSubscriptionAuthorityAuditRef = makeFunctionReference<'mutation'>(
	'subscriptions:auditSubscriptionAuthority'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ cursor?: string; retryBlocked?: boolean },
	unknown
>;
const continueOrgLimitsBackfillRef = makeFunctionReference<'mutation'>(
	'subscriptions:backfillOrgLimits'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ cursor?: string; scanned?: number; updated?: number },
	unknown
>;
const continueCampaignActionOrgBackfillRef = makeFunctionReference<'mutation'>(
	'subscriptions:backfillCampaignActionOrgIds'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ cursor?: string; scanned?: number; updated?: number },
	unknown
>;

const SUBSCRIPTION_AUTHORITY_KEY = 'subscription-authority-v1' as const;
const SUBSCRIPTION_AUTHORITY_PAGE = 50;

export async function uniqueSubscriptionForOrg(
	ctx: { db: QueryCtx['db'] },
	orgId: Id<'organizations'>
): Promise<Doc<'subscriptions'> | null> {
	const rows = await ctx.db
		.query('subscriptions')
		.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
		.take(2);
	if (rows.length > 1) throw new Error('SUBSCRIPTION_CARDINALITY_REPAIR_REQUIRED');
	return rows[0] ?? null;
}

async function uniqueSubscriptionForUser(
	ctx: { db: QueryCtx['db'] },
	userId: Id<'users'>
): Promise<Doc<'subscriptions'> | null> {
	const rows = await ctx.db
		.query('subscriptions')
		.withIndex('by_userId', (q) => q.eq('userId', userId))
		.take(2);
	if (rows.length > 1) throw new Error('SUBSCRIPTION_CARDINALITY_REPAIR_REQUIRED');
	return rows[0] ?? null;
}

async function uniqueSubscriptionForStripeId(
	ctx: { db: QueryCtx['db'] },
	stripeSubscriptionId: string
): Promise<Doc<'subscriptions'> | null> {
	const rows = await ctx.db
		.query('subscriptions')
		.withIndex('by_stripeSubscriptionId', (q) => q.eq('stripeSubscriptionId', stripeSubscriptionId))
		.take(2);
	if (rows.length > 1) throw new Error('SUBSCRIPTION_CARDINALITY_REPAIR_REQUIRED');
	return rows[0] ?? null;
}

function assertSubscriptionPlanScope(
	owner: { orgId?: Id<'organizations'>; userId?: Id<'users'> },
	plan: string
): void {
	if ((owner.orgId === undefined) === (owner.userId === undefined)) {
		throw new Error('SUBSCRIPTION_OWNER_XOR_REQUIRED');
	}
	if (
		owner.orgId !== undefined ? PLANS[plan] === undefined : INDIVIDUAL_PLANS[plan] === undefined
	) {
		throw new Error('SUBSCRIPTION_PLAN_SCOPE_INVALID');
	}
}

/** Query-safe entitlement state. A scheduled mutation transitions expired
 * past-due grace to canceled, which invalidates cached/reactive queries. */
export function durablyActive(sub: Doc<'subscriptions'> | null): boolean {
	if (sub?.status === 'active' || sub?.status === 'trialing') return true;
	return (
		sub?.status === 'past_due' &&
		Number.isSafeInteger(sub.pastDueSince) &&
		(sub.pastDueSince ?? -1) >= 0
	);
}

export function durablePlanUsagePeriodStart(
	org: Doc<'organizations'>,
	sub: Doc<'subscriptions'> | null,
	paid: boolean
): number {
	if (paid) {
		if (!Number.isSafeInteger(sub?.currentPeriodStart) || (sub?.currentPeriodStart ?? -1) < 0) {
			throw new Error('PLAN_USAGE_INVALID:periodStart');
		}
		return sub!.currentPeriodStart;
	}
	// Inactive organizations cannot deliver (all metered limits are zero). Use
	// the last durably published repair coordinate; the hourly rollover mutation
	// advances it and invalidates this query without a Date.now cache hazard.
	const periodStart =
		org.sentEmailPeriodBaselineAt ??
		org.verifiedActionsPeriodBaselineAt ??
		org.smsSentPeriodBaselineAt ??
		org.emailReservationPeriodStart ??
		0;
	if (!Number.isSafeInteger(periodStart) || periodStart < 0) {
		throw new Error('PLAN_USAGE_INVALID:periodStart');
	}
	return periodStart;
}

type UsageProjectionResult = {
	ready: boolean;
	failureCode: string | null;
	repairRequired: boolean;
	repairStatus: 'not_requested' | 'pending' | 'running' | 'ready' | 'blocked';
	usage: ProjectedPlanUsage;
};

export async function readProjectedPlanUsage(
	ctx: { db: QueryCtx['db'] },
	org: Doc<'organizations'>,
	periodStart: number,
	limits: { maxVerifiedActions: number; maxEmails: number; maxSms: number }
): Promise<UsageProjectionResult> {
	const [migration, repair] = await Promise.all([
		ctx.db
			.query('planUsageMigrations')
			.withIndex('by_key', (q) => q.eq('key', PLAN_USAGE_MIGRATION_KEY))
			.unique(),
		ctx.db
			.query('planUsageRepairs')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.unique()
	]);
	if (!isPlanUsageMigrationReady(migration)) {
		return {
			ready: false,
			failureCode: migration?.failureCode ?? 'PLAN_USAGE_MIGRATION_NOT_READY',
			repairRequired: false,
			repairStatus: repair?.status ?? 'not_requested',
			usage: {
				verifiedActions: limits.maxVerifiedActions,
				emailsSent: limits.maxEmails,
				emailsReserved: 0,
				smsSent: limits.maxSms
			}
		};
	}
	try {
		return {
			ready: true,
			failureCode: null,
			repairRequired: false,
			repairStatus: repair?.status ?? 'not_requested',
			usage: projectedPlanUsageForPeriod(org, periodStart)
		};
	} catch (error) {
		const repairForPeriod = repair?.periodStart === periodStart ? repair : null;
		const repairStatus = repairForPeriod?.status ?? 'not_requested';
		return {
			ready: false,
			failureCode:
				repairForPeriod?.status === 'blocked'
					? (repairForPeriod.failureCode ?? 'PLAN_USAGE_REPAIR_BLOCKED')
					: error instanceof Error
						? error.message.slice(0, 256)
						: 'PLAN_USAGE_NOT_READY',
			repairRequired: repairForPeriod === null || repairStatus === 'ready',
			repairStatus,
			usage: {
				verifiedActions: limits.maxVerifiedActions,
				emailsSent: limits.maxEmails,
				emailsReserved: 0,
				smsSent: limits.maxSms
			}
		};
	}
}

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Get subscription for an org.
 */
export const getByOrg = query({
	args: {
		orgSlug: v.string()
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');

		const sub = await uniqueSubscriptionForOrg(ctx, org._id);

		if (!sub) return null;

		return {
			_id: sub._id,
			_creationTime: sub._creationTime,
			plan: sub.plan,
			planDescription: sub.planDescription ?? null,
			priceCents: sub.priceCents,
			status: sub.status,
			currentPeriodStart: sub.currentPeriodStart,
			currentPeriodEnd: sub.currentPeriodEnd,
			paymentMethod: sub.paymentMethod,
			stripeSubscriptionId: sub.stripeSubscriptionId ?? null,
			updatedAt: sub.updatedAt
		};
	}
});

/**
 * Get subscription for a user (personal plan).
 *
 * @deprecated Strategy: individuals are free. See docs/strategy/monetization-policy.md.
 * Retained for potential future org-sponsored individual benefits.
 * No production callers exist.
 */
export const getByUser = query({
	args: {},
	handler: async (ctx) => {
		const { userId } = await requireAuth(ctx);

		const sub = await uniqueSubscriptionForUser(ctx, userId);

		if (!sub) return null;

		return {
			_id: sub._id,
			_creationTime: sub._creationTime,
			plan: sub.plan,
			priceCents: sub.priceCents,
			status: sub.status,
			currentPeriodStart: sub.currentPeriodStart,
			currentPeriodEnd: sub.currentPeriodEnd,
			paymentMethod: sub.paymentMethod,
			updatedAt: sub.updatedAt
		};
	}
});

/**
 * Billing context for an individual (person-layer) paid authoring sub.
 *
 * Returns the caller's userId, their Stripe customer id (if any), and their
 * current individual subscription summary. Used by the individual checkout
 * route to find-or-create the Stripe customer and to guard against duplicate /
 * downgrade checkout. User-scoped only — never touches org state.
 */
export const getMyBillingContext = query({
	args: {},
	handler: async (ctx) => {
		const { userId } = await requireAuth(ctx);
		const user = await ctx.db.get(userId);

		const sub = await uniqueSubscriptionForUser(ctx, userId);

		return {
			userId,
			email: user?.email ?? null,
			stripeCustomerId: user?.stripeCustomerId ?? null,
			subscription: sub
				? {
						plan: sub.plan,
						status: sub.status,
						stripeSubscriptionId: sub.stripeSubscriptionId ?? null
					}
				: null
		};
	}
});

/**
 * Whether the authed user holds an effectively-active PAID individual
 * (person-layer) subscription — Voice or Advocate, status active/trialing, or
 * past_due within the 7-day grace. Used to raise the daily-global LLM
 * circuit-breaker ceiling for paying authors (see llm-cost-protection.ts).
 * Returns false for org plans / no sub.
 */
export const hasActivePaidIndividual = query({
	args: {},
	handler: async (ctx) => {
		const { userId } = await requireAuth(ctx);
		const sub = await uniqueSubscriptionForUser(ctx, userId);
		if (!sub) return false;
		if (!INDIVIDUAL_PLANS[sub.plan]) return false; // org plan / unknown → not paid individual

		// Paid access incl. the 7-day past_due grace and trialing — single predicate.
		return durablyActive(sub);
	}
});

/**
 * Persist the Stripe customer id on the user after the individual checkout
 * route creates it. Auth-gated to the caller's own row.
 */
export const updateMyStripeCustomerId = mutation({
	args: { stripeCustomerId: v.string() },
	handler: async (ctx, args) => {
		const { userId } = await requireAuth(ctx);
		await ctx.db.patch(userId, { stripeCustomerId: args.stripeCustomerId });
		return { success: true };
	}
});

/**
 * Check org's plan limits and current usage within the billing period.
 *
 * All metered usage is read from exact lifetime-minus-period-baseline scalars.
 * A missing/stale projection fails closed with a repair code; source history is
 * rebuilt only by bounded background workers, never in this request query.
 * Period: subscription's currentPeriodStart, or calendar month for inactive orgs.
 */
export const checkPlanLimits = query({
	args: {
		orgSlug: v.string()
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');

		const sub = await uniqueSubscriptionForOrg(ctx, org._id);

		// Grace period: past_due orgs retain paid access for 7 days
		// Grace period: past_due orgs retain paid access for 7 days from initial delinquency
		// Uses dedicated pastDueSince field (not updatedAt, which resets on every mutation)
		// Paid access incl. the 7-day past_due grace and trialing — single predicate.
		// Branding deliberately uses the no-grace effectivePlan instead.
		const isPaidWithGrace = durablyActive(sub);
		const plan = isPaidWithGrace ? (sub?.plan ?? 'inactive') : 'inactive';
		const limits = PLANS[plan] ?? PLANS.inactive;

		// Determine billing period start
		// For paid/grace orgs: subscription's currentPeriodStart
		// For inactive (unsubscribed) orgs: start of current calendar month (UTC)
		const periodStart = durablePlanUsagePeriodStart(org, sub, isPaidWithGrace);

		const usageProjection = await readProjectedPlanUsage(ctx, org, periodStart, limits);

		return {
			plan,
			status: sub?.status ?? 'none',
			periodStart,
			usageReady: usageProjection.ready,
			usageFailureCode: usageProjection.failureCode,
			usageRepairRequired: usageProjection.repairRequired,
			usageRepairStatus: usageProjection.repairStatus,
			limits: {
				maxSeats: limits.maxSeats,
				maxTemplatesMonth: limits.maxTemplatesMonth,
				maxVerifiedActions: limits.maxVerifiedActions,
				maxEmails: limits.maxEmails,
				maxSms: limits.maxSms
			},
			current: {
				seats: org.memberCount ?? 0,
				supporterCount: org.supporterCount ?? 0,
				verifiedActions: usageProjection.usage.verifiedActions,
				emailsSent: usageProjection.usage.emailsSent,
				emailsReserved: usageProjection.usage.emailsReserved,
				smsSent: usageProjection.usage.smsSent
			}
		};
	}
});

/**
 * Internal variant of checkPlanLimits that takes orgId directly.
 * Used by API v1 usage endpoint where orgId comes from API key auth.
 */
export const checkPlanLimitsByOrgId = internalQuery({
	args: {
		orgId: v.id('organizations')
	},
	handler: async (ctx, args) => {
		const org = await ctx.db.get(args.orgId);
		if (!org) return null;

		const sub = await uniqueSubscriptionForOrg(ctx, org._id);

		// Grace period: past_due orgs retain paid access for 7 days from initial delinquency
		// Uses dedicated pastDueSince field (not updatedAt, which resets on every mutation)
		// Paid access incl. the 7-day past_due grace and trialing — single predicate.
		const isPaidWithGrace = durablyActive(sub);
		const plan = isPaidWithGrace ? (sub?.plan ?? 'inactive') : 'inactive';
		const limits = PLANS[plan] ?? PLANS.inactive;

		const periodStart = durablePlanUsagePeriodStart(org, sub, isPaidWithGrace);

		const usageProjection = await readProjectedPlanUsage(ctx, org, periodStart, limits);

		return {
			plan,
			status: sub?.status ?? 'none',
			periodStart,
			usageReady: usageProjection.ready,
			usageFailureCode: usageProjection.failureCode,
			usageRepairRequired: usageProjection.repairRequired,
			usageRepairStatus: usageProjection.repairStatus,
			limits: {
				maxSeats: limits.maxSeats,
				maxTemplatesMonth: limits.maxTemplatesMonth,
				maxVerifiedActions: limits.maxVerifiedActions,
				maxEmails: limits.maxEmails,
				maxSms: limits.maxSms
			},
			current: {
				seats: org.memberCount ?? 0,
				supporterCount: org.supporterCount ?? 0,
				verifiedActions: usageProjection.usage.verifiedActions,
				emailsSent: usageProjection.usage.emailsSent,
				emailsReserved: usageProjection.usage.emailsReserved,
				smsSent: usageProjection.usage.smsSent
			}
		};
	}
});

/**
 * Public-API wrapper for `checkPlanLimitsByOrgId`. SvelteKit `/api/v1/usage`
 * calls this via the HTTP API; the internal version stays in place for
 * in-Convex callers (`email.ts:481`, `submissions.ts:262`) which already hold
 * full trust and pre-validate the orgId before calling.
 */
type PlanLimitsResult = {
	plan: string;
	status: string;
	periodStart: number;
	usageReady: boolean;
	usageFailureCode: string | null;
	usageRepairRequired: boolean;
	usageRepairStatus: 'not_requested' | 'pending' | 'running' | 'ready' | 'blocked';
	limits: {
		maxSeats: number;
		maxTemplatesMonth: number;
		maxVerifiedActions: number;
		maxEmails: number;
		maxSms: number;
	};
	current: {
		seats: number;
		supporterCount: number;
		verifiedActions: number;
		emailsSent: number;
		emailsReserved: number;
		smsSent: number;
	};
} | null;

export const checkPlanLimitsByOrgIdForCaller = query({
	args: { _secret: v.string(), orgId: v.id('organizations') },
	handler: async (ctx, { _secret, orgId }): Promise<PlanLimitsResult> => {
		requireInternalSecret(_secret);
		return await ctx.runQuery(internal.subscriptions.checkPlanLimitsByOrgId, { orgId });
	}
});

/**
 * Authenticated enqueue boundary for a coded not-ready plan check. The worker
 * is idempotent and source-paged; this mutation never scans usage history.
 */
export const requestPlanUsageRepair = mutation({
	args: { orgSlug: v.string() },
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');
		return await enqueuePlanUsageRepair(ctx, org._id);
	}
});

/** Secret-gated equivalent used by the API-v1 usage adapter. */
export const requestPlanUsageRepairByOrgIdForCaller = mutation({
	args: { _secret: v.string(), orgId: v.id('organizations') },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		return await enqueuePlanUsageRepair(ctx, args.orgId);
	}
});

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Create a subscription record (typically called from Stripe webhook).
 */
export const create = internalMutation({
	args: {
		orgId: v.optional(v.id('organizations')),
		userId: v.optional(v.id('users')),
		plan: subscriptionPlan,
		priceCents: v.number(),
		status: subscriptionStatus,
		paymentMethod: subscriptionPaymentMethod,
		stripeSubscriptionId: v.optional(v.string()),
		currentPeriodStart: v.number(),
		currentPeriodEnd: v.number()
	},
	handler: async (ctx, args) => {
		if ((args.orgId === undefined) === (args.userId === undefined)) {
			throw new Error('SUBSCRIPTION_OWNER_XOR_REQUIRED');
		}
		if (args.orgId) {
			if (!(await ctx.db.get(args.orgId))) throw new Error('SUBSCRIPTION_ORGANIZATION_MISSING');
			if (INDIVIDUAL_PLANS[args.plan]) throw new Error('SUBSCRIPTION_PLAN_SCOPE_INVALID');
			if (await uniqueSubscriptionForOrg(ctx, args.orgId)) {
				throw new Error('SUBSCRIPTION_OWNER_ALREADY_BOUND');
			}
		} else if (args.userId) {
			if (!(await ctx.db.get(args.userId))) throw new Error('SUBSCRIPTION_USER_MISSING');
			if (!INDIVIDUAL_PLANS[args.plan]) throw new Error('SUBSCRIPTION_PLAN_SCOPE_INVALID');
			if (await uniqueSubscriptionForUser(ctx, args.userId)) {
				throw new Error('SUBSCRIPTION_OWNER_ALREADY_BOUND');
			}
		}
		if (
			args.stripeSubscriptionId &&
			(await uniqueSubscriptionForStripeId(ctx, args.stripeSubscriptionId))
		) {
			throw new Error('SUBSCRIPTION_STRIPE_ID_ALREADY_BOUND');
		}

		return await ctx.db.insert('subscriptions', {
			orgId: args.orgId,
			userId: args.userId,
			plan: args.plan,
			priceCents: args.priceCents,
			status: args.status,
			paymentMethod: args.paymentMethod,
			stripeSubscriptionId: args.stripeSubscriptionId,
			currentPeriodStart: args.currentPeriodStart,
			currentPeriodEnd: args.currentPeriodEnd,
			updatedAt: Date.now()
		});
	}
});

/**
 * Update a subscription (status, period, plan changes).
 */
export const update = internalMutation({
	args: {
		subscriptionId: v.id('subscriptions'),
		plan: v.optional(subscriptionPlan),
		priceCents: v.optional(v.number()),
		status: v.optional(subscriptionStatus),
		currentPeriodStart: v.optional(v.number()),
		currentPeriodEnd: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const sub = await ctx.db.get(args.subscriptionId);
		if (!sub) throw new Error('Subscription not found');
		if (args.plan !== undefined) assertSubscriptionPlanScope(sub, args.plan);

		const patch: Record<string, unknown> = { updatedAt: Date.now() };
		if (args.plan !== undefined) patch.plan = args.plan;
		if (args.priceCents !== undefined) patch.priceCents = args.priceCents;
		if (args.status !== undefined) patch.status = args.status;
		if (args.currentPeriodStart !== undefined) patch.currentPeriodStart = args.currentPeriodStart;
		if (args.currentPeriodEnd !== undefined) patch.currentPeriodEnd = args.currentPeriodEnd;

		await ctx.db.patch(args.subscriptionId, patch);
		return { success: true };
	}
});

/**
 * Cancel a subscription.
 */
export const cancel = mutation({
	args: {
		subscriptionId: v.id('subscriptions')
	},
	handler: async () => {
		// Billing cancellation is exclusively Stripe portal -> signed webhook.
		// The historical direct mutation had no caller and had to read an
		// attacker-selected subscription before it could determine authority.
		throw new Error('SUBSCRIPTION_DIRECT_CANCEL_RETIRED');
	}
});

// =============================================================================
// ACTIONS (Stripe webhook processing)
// =============================================================================

/**
 * Process a Stripe webhook event. Called from the HTTP router.
 * Signature verification happens in the httpAction before calling this.
 */
export const processStripeWebhook = internalAction({
	args: {
		eventType: v.string(),
		data: v.any()
	},
	handler: async (ctx, args) => {
		const { eventType, data } = args;

		switch (eventType) {
			case 'checkout.session.completed': {
				const session = data;
				if (session.mode !== 'subscription' || !session.subscription) break;

				const plan = session.metadata?.plan;
				const orgId = session.metadata?.orgId;
				const userId = session.metadata?.userId;

				// Use session.created (Stripe timestamp in seconds) for period start.
				// The subsequent subscription.updated event will correct to exact Stripe periods.
				const periodStartMs = (session.created ?? Math.floor(Date.now() / 1000)) * 1000;

				// INDIVIDUAL (person-layer) checkout: metadata.userId + an individual
				// plan. User-scoped upsert, NO org-limit sync.
				if (userId && plan && INDIVIDUAL_PLANS[plan]) {
					await ctx.runMutation(internal.subscriptions.upsertIndividualFromStripe, {
						userId,
						plan,
						priceCents: INDIVIDUAL_PLANS[plan].priceCents,
						status: 'active',
						stripeSubscriptionId: session.subscription,
						currentPeriodStart: periodStartMs,
						currentPeriodEnd: periodStartMs + 30 * 24 * 60 * 60 * 1000
					});
					break;
				}

				// ORG checkout: metadata.orgId + a marketed org plan. Syncs org limits.
				if (orgId && plan && PLANS[plan]) {
					await ctx.runMutation(internal.subscriptions.upsertFromStripe, {
						orgId,
						plan,
						priceCents: PLANS[plan].priceCents,
						status: 'active',
						stripeSubscriptionId: session.subscription,
						currentPeriodStart: periodStartMs,
						currentPeriodEnd: periodStartMs + 30 * 24 * 60 * 60 * 1000
					});
				}
				break;
			}

			case 'customer.subscription.updated': {
				const sub = data;
				// cancel_at_period_end means "still active until period end, then cancel"
				// — the org retains paid access until current_period_end
				const effectiveStatus = mapStripeStatus(sub.status);

				// Extract plan from price lookup_key or metadata
				const priceItem = Array.isArray(sub.items?.data) ? sub.items.data[0] : null;
				const plan = priceItem?.price?.lookup_key ?? sub.metadata?.plan ?? undefined;
				const priceCents = priceItem?.price?.unit_amount ?? undefined;

				// Use Stripe's actual period timestamps (seconds → ms)
				const periodStart = sub.current_period_start ? sub.current_period_start * 1000 : undefined;
				const periodEnd = sub.current_period_end ? sub.current_period_end * 1000 : undefined;

				// Accept BOTH org and individual plan slugs as valid plan changes (e.g.
				// a Stripe-portal voice→advocate switch). Only request org-limit sync
				// for ORG plans; individual plans never sync org limits — and
				// updateByStripeId additionally gates the sync on `sub.orgId`, so even
				// if requested it cannot touch a user-scoped sub.
				const isOrgPlan = !!(plan && PLANS[plan]);
				const isIndividualPlan = !!(plan && INDIVIDUAL_PLANS[plan]);
				const validPlan = isOrgPlan || isIndividualPlan;

				await ctx.runMutation(internal.subscriptions.updateByStripeId, {
					stripeSubscriptionId: sub.id,
					status: effectiveStatus,
					plan: validPlan ? plan : undefined,
					priceCents,
					currentPeriodStart: periodStart,
					currentPeriodEnd: periodEnd,
					syncOrgLimits: isOrgPlan ? true : undefined
				});
				break;
			}

			case 'customer.subscription.deleted': {
				const sub = data;
				await ctx.runMutation(internal.subscriptions.updateByStripeId, {
					stripeSubscriptionId: sub.id,
					status: 'canceled',
					resetOrgLimits: true
				});
				break;
			}

			case 'invoice.payment_failed': {
				const invoice = data;
				const subId = invoice.parent?.subscription_details?.subscription;
				if (!subId) break;
				const stripeSubId = typeof subId === 'string' ? subId : subId.id;

				await ctx.runMutation(internal.subscriptions.updateByStripeId, {
					stripeSubscriptionId: stripeSubId,
					status: 'past_due',
					setPastDueSince: true // Only sets if not already past_due
				});
				break;
			}

			case 'invoice.payment_succeeded': {
				// Clear past_due status when payment retry succeeds.
				// Guard: only transition past_due → active, not canceled → active.
				const invoice = data;
				const subId = invoice.parent?.subscription_details?.subscription;
				if (!subId) break;
				const stripeSubId = typeof subId === 'string' ? subId : subId.id;

				// Read current status to guard the transition
				const currentSub = await ctx.runQuery(internal.subscriptions.getByStripeId, {
					stripeSubscriptionId: stripeSubId
				});
				if (currentSub?.status === 'past_due') {
					await ctx.runMutation(internal.subscriptions.updateByStripeId, {
						stripeSubscriptionId: stripeSubId,
						status: 'active'
					});
				}
				break;
			}

			// Subscription schedules: handle portal-initiated plan changes
			// When a user downgrades via the Stripe portal, Stripe creates a schedule
			// that takes effect at the end of the current billing period.
			case 'subscription_schedule.completed': {
				// Schedule completed — the plan change has taken effect.
				// Stripe will also fire subscription.updated, which handles the actual
				// plan/limit sync. This handler just logs for observability.
				console.log('[subscriptions] Subscription schedule completed:', data.id);
				break;
			}

			case 'subscription_schedule.canceled': {
				// User canceled the scheduled change (e.g., changed their mind about downgrading)
				console.log('[subscriptions] Subscription schedule canceled:', data.id);
				break;
			}

			case 'subscription_schedule.released': {
				// Schedule released — subscription returns to normal management
				console.log('[subscriptions] Subscription schedule released:', data.id);
				break;
			}
		}

		return { ok: true };
	}
});

function mapStripeStatus(status: string): 'active' | 'past_due' | 'canceled' | 'trialing' {
	switch (status) {
		case 'active':
			return 'active';
		case 'past_due':
			return 'past_due';
		case 'canceled':
			return 'canceled';
		case 'trialing':
			return 'trialing';
		case 'incomplete':
		case 'incomplete_expired':
		case 'unpaid':
		case 'paused':
			return 'past_due'; // Non-active statuses should not grant full access
		default:
			console.warn(`[subscriptions] Unknown Stripe status: ${status}, treating as past_due`);
			return 'past_due';
	}
}

// =============================================================================
// INTERNAL MUTATIONS (called from webhook action)
// =============================================================================

/**
 * Upsert a subscription from Stripe checkout completion.
 */
export const upsertFromStripe = internalMutation({
	args: {
		orgId: v.string(),
		plan: subscriptionPlan,
		priceCents: v.number(),
		status: subscriptionStatus,
		stripeSubscriptionId: v.string(),
		currentPeriodStart: v.number(),
		currentPeriodEnd: v.number()
	},
	handler: async (ctx, args) => {
		// orgId from Stripe metadata is the Convex document ID
		const orgId = args.orgId as Id<'organizations'>;
		const org = await ctx.db.get(orgId);

		if (!org) {
			console.warn(`[subscriptions] Org not found for Stripe webhook: ${args.orgId}`);
			return;
		}
		assertSubscriptionPlanScope({ orgId: org._id }, args.plan);

		// Check for existing subscription
		const existing = await uniqueSubscriptionForOrg(ctx, org._id);
		const stripeBinding = await uniqueSubscriptionForStripeId(ctx, args.stripeSubscriptionId);
		if (
			stripeBinding &&
			(stripeBinding._id !== existing?._id ||
				stripeBinding.orgId !== org._id ||
				stripeBinding.userId !== undefined)
		) {
			throw new Error('SUBSCRIPTION_STRIPE_OWNER_MISMATCH');
		}

		const now = Date.now();

		// checkout.session.completed can arrive after a newer
		// customer.subscription.updated event. Never let its approximate
		// session-created period rewind authoritative Stripe subscription state.
		if (
			existing?.currentPeriodStart !== undefined &&
			args.currentPeriodStart < existing.currentPeriodStart
		) {
			return { ignored: true as const, reason: 'STALE_STRIPE_PERIOD' as const };
		}

		if (existing) {
			await ctx.db.patch(existing._id, {
				plan: args.plan,
				priceCents: args.priceCents,
				status: args.status,
				stripeSubscriptionId: args.stripeSubscriptionId,
				currentPeriodStart: args.currentPeriodStart,
				currentPeriodEnd: args.currentPeriodEnd,
				updatedAt: now
			});
		} else {
			await ctx.db.insert('subscriptions', {
				orgId: org._id,
				plan: args.plan,
				priceCents: args.priceCents,
				status: args.status,
				paymentMethod: 'stripe',
				stripeSubscriptionId: args.stripeSubscriptionId,
				currentPeriodStart: args.currentPeriodStart,
				currentPeriodEnd: args.currentPeriodEnd,
				updatedAt: now
			});
		}

		// Sync org limits to match new plan
		const planDef = PLANS[args.plan];
		if (planDef) {
			await ctx.db.patch(org._id, {
				maxSeats: planDef.maxSeats,
				maxTemplatesMonth: planDef.maxTemplatesMonth,
				updatedAt: now
			});
		}

		// Enqueue an exact period projection. The worker reconstructs from the
		// authoritative period start, so a delayed webhook cannot erase sends that
		// already happened in this period.
		await snapshotPlanUsageBaselines(ctx, org._id, args.currentPeriodStart);
	}
});

/**
 * Upsert an INDIVIDUAL (person-layer) subscription from Stripe checkout
 * completion. User-scoped: keyed on userId, writes the individual plan
 * (voice/advocate) onto a by_userId subscription row, and does NOT run any
 * org-limit sync or verified-action baseline snapshot (those are org-only). The
 * individual authoring cap reads this sub's plan to size the authored-per-month
 * allowance; nothing else is unlocked.
 */
export const upsertIndividualFromStripe = internalMutation({
	args: {
		userId: v.string(),
		plan: subscriptionPlan,
		priceCents: v.number(),
		status: subscriptionStatus,
		stripeSubscriptionId: v.string(),
		currentPeriodStart: v.number(),
		currentPeriodEnd: v.number()
	},
	handler: async (ctx, args) => {
		const userId = args.userId as Id<'users'>;
		const user = await ctx.db.get(userId);
		if (!user) {
			console.warn(`[subscriptions] User not found for Stripe webhook: ${args.userId}`);
			return;
		}
		// Guard: only individual plans may be written to a user-scoped sub. An org
		// plan slug arriving on a userId checkout is a metadata mismatch — refuse it
		// rather than silently granting org-shaped state to an individual row.
		if (!INDIVIDUAL_PLANS[args.plan]) {
			console.warn(
				`[subscriptions] Non-individual plan "${args.plan}" on user checkout — ignoring`
			);
			return;
		}

		const existing = await uniqueSubscriptionForUser(ctx, userId);
		const stripeBinding = await uniqueSubscriptionForStripeId(ctx, args.stripeSubscriptionId);
		if (
			stripeBinding &&
			(stripeBinding._id !== existing?._id ||
				stripeBinding.userId !== userId ||
				stripeBinding.orgId !== undefined)
		) {
			throw new Error('SUBSCRIPTION_STRIPE_OWNER_MISMATCH');
		}

		const now = Date.now();

		if (existing) {
			await ctx.db.patch(existing._id, {
				plan: args.plan,
				priceCents: args.priceCents,
				status: args.status,
				stripeSubscriptionId: args.stripeSubscriptionId,
				currentPeriodStart: args.currentPeriodStart,
				currentPeriodEnd: args.currentPeriodEnd,
				updatedAt: now
			});
		} else {
			await ctx.db.insert('subscriptions', {
				userId,
				plan: args.plan,
				priceCents: args.priceCents,
				status: args.status,
				paymentMethod: 'stripe',
				stripeSubscriptionId: args.stripeSubscriptionId,
				currentPeriodStart: args.currentPeriodStart,
				currentPeriodEnd: args.currentPeriodEnd,
				updatedAt: now
			});
		}
		// NOTE: no org-limit sync, no verified-action baseline. Individual subs buy
		// ONLY authoring volume (read off this row by the templates.ts cap).
	}
});

/**
 * One-time backfill: re-sync all org limits from their current subscription plan.
 * Fixes orgs created with the pre-plan org defaults, or provisioned before the
 * plan table was shared.
 * Safe to run multiple times (idempotent).
 */
export const backfillOrgLimits = internalMutation({
	args: {
		cursor: v.optional(v.string()),
		scanned: v.optional(v.number()),
		updated: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query('organizations')
			.order('asc')
			.paginate({
				cursor: args.cursor ?? null,
				numItems: 25,
				maximumRowsRead: 26,
				maximumBytesRead: 512 * 1024
			});
		if (page.pageStatus === 'SplitRequired') throw new Error('ORG_LIMIT_BACKFILL_PAGE_TOO_LARGE');
		let updated = args.updated ?? 0;

		for (const org of page.page) {
			// Find active subscription for this org
			const sub = await uniqueSubscriptionForOrg(ctx, org._id);

			const plan = sub?.status === 'active' ? sub.plan : 'inactive';
			const planDef = PLANS[plan] ?? PLANS.inactive;

			// Only patch if limits differ from canonical values
			if (
				org.maxSeats !== planDef.maxSeats ||
				org.maxTemplatesMonth !== planDef.maxTemplatesMonth
			) {
				await ctx.db.patch(org._id, {
					maxSeats: planDef.maxSeats,
					maxTemplatesMonth: planDef.maxTemplatesMonth,
					updatedAt: Date.now()
				});
				updated++;
			}
		}

		const scanned = (args.scanned ?? 0) + page.page.length;
		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, continueOrgLimitsBackfillRef, {
				cursor: page.continueCursor,
				scanned,
				updated
			});
		} else {
			console.log(`[backfillOrgLimits] Updated ${updated}/${scanned} orgs`);
		}
		return {
			status: page.isDone ? ('complete' as const) : ('running' as const),
			updated,
			total: scanned
		};
	}
});

/**
 * One-time backfill: set orgId on campaignActions rows that predate the denormalization.
 * Looks up campaign → orgId for each action missing orgId.
 * Safe to run multiple times (skips actions that already have orgId).
 */
export const backfillCampaignActionOrgIds = internalMutation({
	args: {
		cursor: v.optional(v.string()),
		scanned: v.optional(v.number()),
		updated: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query('campaignActions')
			.order('asc')
			.paginate({
				cursor: args.cursor ?? null,
				numItems: 100,
				maximumRowsRead: 101,
				maximumBytesRead: 1024 * 1024
			});
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('CAMPAIGN_ACTION_ORG_BACKFILL_PAGE_TOO_LARGE');
		}
		let updated = args.updated ?? 0;
		const campaignCache = new Map<string, Id<'organizations'> | undefined>();

		for (const action of page.page) {
			if (action.orgId) continue; // Already has orgId

			let orgId = campaignCache.get(action.campaignId);
			if (orgId === undefined) {
				const campaign = await ctx.db.get(action.campaignId);
				orgId = campaign?.orgId ?? undefined;
				campaignCache.set(action.campaignId, orgId);
			}

			if (orgId) {
				await ctx.db.patch(action._id, { orgId });
				updated++;
			}
		}

		const scanned = (args.scanned ?? 0) + page.page.length;
		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, continueCampaignActionOrgBackfillRef, {
				cursor: page.continueCursor,
				scanned,
				updated
			});
		} else {
			console.log(`[backfillCampaignActionOrgIds] Updated ${updated}/${scanned} actions`);
		}
		return {
			status: page.isDone ? ('complete' as const) : ('running' as const),
			updated,
			total: scanned
		};
	}
});

/**
 * Look up subscription by Stripe subscription ID.
 * Used for guarded status transitions (e.g., payment_succeeded only clears past_due).
 */
export const getByStripeId = internalQuery({
	args: { stripeSubscriptionId: v.string() },
	handler: async (ctx, args) => {
		return await uniqueSubscriptionForStripeId(ctx, args.stripeSubscriptionId);
	}
});

/**
 * Update subscription by Stripe subscription ID.
 */
export const updateByStripeId = internalMutation({
	args: {
		stripeSubscriptionId: v.string(),
		status: subscriptionStatus,
		plan: v.optional(subscriptionPlan),
		priceCents: v.optional(v.number()),
		currentPeriodStart: v.optional(v.number()),
		currentPeriodEnd: v.optional(v.number()),
		resetOrgLimits: v.optional(v.boolean()),
		syncOrgLimits: v.optional(v.boolean()),
		setPastDueSince: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const sub = await uniqueSubscriptionForStripeId(ctx, args.stripeSubscriptionId);

		if (!sub) {
			throw new Error(
				`[subscriptions] No subscription found for Stripe ID: ${args.stripeSubscriptionId}. ` +
					`Stripe will retry this event.`
			);
		}
		if (args.plan !== undefined) assertSubscriptionPlanScope(sub, args.plan);

		const now = Date.now();
		const patch: Record<string, unknown> = {
			status: args.status,
			updatedAt: now
		};
		if (args.plan !== undefined) patch.plan = args.plan;
		if (args.priceCents !== undefined) patch.priceCents = args.priceCents;
		const stalePeriod =
			args.currentPeriodStart !== undefined &&
			sub.currentPeriodStart !== undefined &&
			args.currentPeriodStart < sub.currentPeriodStart;
		if (args.currentPeriodStart !== undefined && !stalePeriod) {
			patch.currentPeriodStart = args.currentPeriodStart;
		}
		if (args.currentPeriodEnd !== undefined && !stalePeriod) {
			patch.currentPeriodEnd = args.currentPeriodEnd;
		}

		// pastDueSince: set only on first transition to past_due (or repair a
		// malformed legacy row missing the durable grace coordinate).
		if (args.setPastDueSince && (sub.status !== 'past_due' || sub.pastDueSince === undefined)) {
			patch.pastDueSince = now;
			patch.pastDueExpiryScheduledAt = now + PAST_DUE_GRACE_MS;
			await ctx.scheduler.runAt(now + PAST_DUE_GRACE_MS, expirePastDueGraceRef, {
				subscriptionId: sub._id,
				expectedPastDueSince: now
			});
		}
		// Clear pastDueSince when transitioning back to active
		if (args.status === 'active' && sub.pastDueSince !== undefined) {
			patch.pastDueSince = undefined;
			patch.pastDueExpiryScheduledAt = undefined;
		}

		await ctx.db.patch(sub._id, patch);

		// Sync org limits to match plan on upgrade/change
		if (args.syncOrgLimits && args.plan && sub.orgId) {
			const planDef = PLANS[args.plan];
			if (planDef) {
				await ctx.db.patch(sub.orgId, {
					maxSeats: planDef.maxSeats,
					maxTemplatesMonth: planDef.maxTemplatesMonth,
					updatedAt: now
				});
			}
		}

		// Reset org limits to the gated inactive floor on cancellation
		if (args.resetOrgLimits && sub.orgId) {
			const floorLimits = PLANS.inactive;
			await ctx.db.patch(sub.orgId, {
				maxSeats: floorLimits.maxSeats,
				maxTemplatesMonth: floorLimits.maxTemplatesMonth,
				updatedAt: now
			});
		}

		// Any org status transition can change the authoritative metering period
		// (paid Stripe period vs inactive UTC month). Coalesce an exact repair in
		// the same transaction. A stale out-of-order period is ignored above and
		// the current period remains the repair authority.
		if (sub.orgId) {
			await snapshotPlanUsageBaselines(
				ctx,
				sub.orgId,
				stalePeriod
					? (sub.currentPeriodStart ?? now)
					: (args.currentPeriodStart ?? sub.currentPeriodStart ?? now)
			);
		}
	}
});

/** Durable grace expiry. Query entitlement reads only row state; this scheduled
 * mutation changes that state at the deadline and invalidates cached/reactive
 * results without relying on Date.now inside a public query. */
export const expirePastDueGrace = internalMutation({
	args: {
		subscriptionId: v.id('subscriptions'),
		expectedPastDueSince: v.number()
	},
	handler: async (ctx, args) => {
		const sub = await ctx.db.get(args.subscriptionId);
		if (!sub || sub.status !== 'past_due' || sub.pastDueSince !== args.expectedPastDueSince) {
			return { status: 'superseded' as const };
		}
		const expiresAt = args.expectedPastDueSince + PAST_DUE_GRACE_MS;
		if (Date.now() < expiresAt) {
			await ctx.scheduler.runAt(expiresAt, expirePastDueGraceRef, args);
			return { status: 'rescheduled' as const };
		}
		const now = Date.now();
		await ctx.db.patch(sub._id, {
			status: 'canceled',
			pastDueSince: undefined,
			pastDueExpiryScheduledAt: undefined,
			updatedAt: now
		});
		if (sub.orgId) {
			await ctx.db.patch(sub.orgId, {
				maxSeats: PLANS.inactive.maxSeats,
				maxTemplatesMonth: PLANS.inactive.maxTemplatesMonth,
				updatedAt: now
			});
			await snapshotPlanUsageBaselines(ctx, sub.orgId, now);
		}
		return { status: 'expired' as const };
	}
});

/** Bounded durable backstop/adoption for legacy past_due rows. */
export const sweepPastDueGrace = internalMutation({
	args: { cursor: v.optional(v.string()) },
	handler: async (ctx, args) => {
		if (args.cursor && args.cursor.length > 2_048) {
			throw new Error('SUBSCRIPTION_GRACE_CURSOR_INVALID');
		}
		const page = await ctx.db
			.query('subscriptions')
			.withIndex('by_status_pastDueSince', (q) => q.eq('status', 'past_due'))
			.paginate({
				cursor: args.cursor ?? null,
				numItems: 25,
				maximumRowsRead: 26,
				maximumBytesRead: 512 * 1024
			});
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('SUBSCRIPTION_GRACE_PAGE_TOO_LARGE');
		}
		const now = Date.now();
		let adopted = 0;
		let expired = 0;
		for (const sub of page.page) {
			const pastDueSince =
				Number.isSafeInteger(sub.pastDueSince) && (sub.pastDueSince ?? -1) >= 0
					? sub.pastDueSince!
					: now;
			const expiresAt = pastDueSince + PAST_DUE_GRACE_MS;
			if (expiresAt <= now) {
				await ctx.db.patch(sub._id, {
					status: 'canceled',
					pastDueSince: undefined,
					pastDueExpiryScheduledAt: undefined,
					updatedAt: now
				});
				if (sub.orgId) {
					await ctx.db.patch(sub.orgId, {
						maxSeats: PLANS.inactive.maxSeats,
						maxTemplatesMonth: PLANS.inactive.maxTemplatesMonth,
						updatedAt: now
					});
					await snapshotPlanUsageBaselines(ctx, sub.orgId, now);
				}
				expired += 1;
				continue;
			}
			if (sub.pastDueSince !== pastDueSince || sub.pastDueExpiryScheduledAt !== expiresAt) {
				await ctx.db.patch(sub._id, {
					pastDueSince,
					pastDueExpiryScheduledAt: expiresAt,
					updatedAt: now
				});
				await ctx.scheduler.runAt(expiresAt, expirePastDueGraceRef, {
					subscriptionId: sub._id,
					expectedPastDueSince: pastDueSince
				});
				adopted += 1;
			}
		}
		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, continuePastDueGraceSweepRef, {
				cursor: page.continueCursor
			});
		}
		return {
			status: page.isDone ? ('complete' as const) : ('running' as const),
			scanned: page.page.length,
			adopted,
			expired
		};
	}
});

/** Bounded pre-activation proof of exact subscription ownership/cardinality. */
export const auditSubscriptionAuthority = internalMutation({
	args: { cursor: v.optional(v.string()), retryBlocked: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		let audit = await ctx.db
			.query('subscriptionAuthorityMigrations')
			.withIndex('by_key', (q) => q.eq('key', SUBSCRIPTION_AUTHORITY_KEY))
			.unique();
		const now = Date.now();
		if (!audit) {
			const id = await ctx.db.insert('subscriptionAuthorityMigrations', {
				key: SUBSCRIPTION_AUTHORITY_KEY,
				status: 'running',
				scanned: 0,
				startedAt: now,
				updatedAt: now
			});
			audit = (await ctx.db.get(id))!;
		}
		if (audit.status === 'ready') return { status: 'ready' as const, scanned: audit.scanned };
		if (audit.status === 'blocked' && !args.retryBlocked) {
			return {
				status: 'blocked' as const,
				scanned: audit.scanned,
				failureCode: audit.failureCode ?? null
			};
		}
		if (args.cursor !== undefined && args.cursor !== audit.cursor) {
			return { status: 'superseded' as const, scanned: audit.scanned };
		}
		try {
			const page = await ctx.db
				.query('subscriptions')
				.order('asc')
				.paginate({
					cursor: audit.status === 'blocked' ? null : (audit.cursor ?? null),
					numItems: SUBSCRIPTION_AUTHORITY_PAGE,
					maximumRowsRead: SUBSCRIPTION_AUTHORITY_PAGE + 1,
					maximumBytesRead: 1024 * 1024
				});
			if (page.pageStatus === 'SplitRequired') {
				throw new Error('SUBSCRIPTION_AUTHORITY_PAGE_TOO_LARGE');
			}
			for (const sub of page.page) {
				if ((sub.orgId === undefined) === (sub.userId === undefined)) {
					throw new Error(`SUBSCRIPTION_OWNER_XOR_INVALID:${String(sub._id)}`);
				}
				if (
					(sub.orgId !== undefined && INDIVIDUAL_PLANS[sub.plan] !== undefined) ||
					(sub.userId !== undefined && INDIVIDUAL_PLANS[sub.plan] === undefined)
				) {
					throw new Error(`SUBSCRIPTION_PLAN_SCOPE_INVALID:${String(sub._id)}`);
				}
				const ownerRows = sub.orgId
					? await ctx.db
							.query('subscriptions')
							.withIndex('by_orgId', (q) => q.eq('orgId', sub.orgId))
							.take(2)
					: await ctx.db
							.query('subscriptions')
							.withIndex('by_userId', (q) => q.eq('userId', sub.userId))
							.take(2);
				if (ownerRows.length !== 1 || ownerRows[0]!._id !== sub._id) {
					throw new Error(`SUBSCRIPTION_OWNER_CARDINALITY_INVALID:${String(sub._id)}`);
				}
				if (sub.stripeSubscriptionId) {
					const stripeRows = await ctx.db
						.query('subscriptions')
						.withIndex('by_stripeSubscriptionId', (q) =>
							q.eq('stripeSubscriptionId', sub.stripeSubscriptionId)
						)
						.take(2);
					if (stripeRows.length !== 1 || stripeRows[0]!._id !== sub._id) {
						throw new Error(`SUBSCRIPTION_STRIPE_CARDINALITY_INVALID:${String(sub._id)}`);
					}
				}
				if (
					sub.status === 'past_due' &&
					(!Number.isSafeInteger(sub.pastDueSince) ||
						(sub.pastDueSince ?? -1) < 0 ||
						!Number.isSafeInteger(sub.pastDueExpiryScheduledAt) ||
						sub.pastDueExpiryScheduledAt !== sub.pastDueSince! + PAST_DUE_GRACE_MS)
				) {
					throw new Error(`SUBSCRIPTION_PAST_DUE_COORDINATE_MISSING:${String(sub._id)}`);
				}
			}
			const scanned = (audit.status === 'blocked' ? 0 : audit.scanned) + page.page.length;
			if (page.isDone) {
				await ctx.db.patch(audit._id, {
					status: 'ready',
					cursor: undefined,
					scanned,
					failureCode: undefined,
					failureSourceId: undefined,
					completedAt: now,
					updatedAt: now
				});
				return { status: 'ready' as const, scanned };
			}
			await ctx.db.patch(audit._id, {
				status: 'running',
				cursor: page.continueCursor,
				scanned,
				failureCode: undefined,
				failureSourceId: undefined,
				updatedAt: now
			});
			await ctx.scheduler.runAfter(0, continueSubscriptionAuthorityAuditRef, {
				cursor: page.continueCursor
			});
			return { status: 'running' as const, scanned };
		} catch (error) {
			const code = error instanceof Error ? error.message.slice(0, 256) : 'UNKNOWN';
			await ctx.db.patch(audit._id, {
				status: 'blocked',
				failureCode: code,
				failureSourceId: code.includes(':') ? code.split(':').at(-1)?.slice(0, 256) : undefined,
				updatedAt: Date.now()
			});
			return { status: 'blocked' as const, scanned: audit.scanned, failureCode: code };
		}
	}
});

export const subscriptionAuthorityStatus = internalQuery({
	args: {},
	handler: async (ctx) =>
		await ctx.db
			.query('subscriptionAuthorityMigrations')
			.withIndex('by_key', (q) => q.eq('key', SUBSCRIPTION_AUTHORITY_KEY))
			.unique()
});
