import { makeFunctionReference, type FunctionReference } from 'convex/server';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { effectivelyActive } from '../_brandingGate';

export const PLAN_USAGE_MIGRATION_KEY = 'v1' as const;
export const PLAN_USAGE_MIGRATION_PAGE_ROWS = 100;
export const PLAN_USAGE_MIGRATION_PAGE_BYTES = 2 * 1024 * 1024;
export const PLAN_USAGE_MIGRATION_MAX_RESTARTS = 8;
export const PLAN_USAGE_REPAIR_MAX_RESTARTS = 8;
export const PLAN_USAGE_REPAIR_LEASE_MS = 5 * 60 * 1000;
export const PLAN_USAGE_PERIOD_CLOCK_SKEW_MS = 5 * 60 * 1000;

const continuePlanUsageRepairRef = makeFunctionReference<'mutation'>(
	'planUsage:repairOrg'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ orgId: Id<'organizations'>; runToken: string },
	unknown
>;

type MigrationState = Pick<
	Doc<'planUsageMigrations'>,
	| 'status'
	| 'phase'
	| 'organizationCursor'
	| 'currentOrgId'
	| 'sourceCursor'
	| 'failureCode'
	| 'failureSourceId'
	| 'scannedOrganizations'
	| 'projectedOrganizations'
>;

export function isPlanUsageMigrationReady(row: MigrationState | null | undefined): boolean {
	return (
		row?.status === 'ready' &&
		row.phase === 'complete' &&
		row.currentOrgId === undefined &&
		row.sourceCursor === undefined &&
		row.failureCode === undefined &&
		row.failureSourceId === undefined &&
		row.scannedOrganizations === row.projectedOrganizations
	);
}

function safeCounter(name: string, value: number | undefined): number {
	const resolved = value ?? 0;
	if (!Number.isSafeInteger(resolved) || resolved < 0) {
		throw new Error(`PLAN_USAGE_INVALID:${name}`);
	}
	return resolved;
}

export type ProjectedPlanUsage = {
	verifiedActions: number;
	emailsSent: number;
	emailsReserved: number;
	smsSent: number;
};

export function planUsagePeriodStart(
	subscription: Doc<'subscriptions'> | null,
	asOf: number
): number {
	let periodStart: number;
	if (effectivelyActive(subscription, asOf) && subscription?.currentPeriodStart !== undefined) {
		periodStart = subscription.currentPeriodStart;
	} else {
		const date = new Date(asOf);
		periodStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
	}
	// Stripe's active current period has already begun. Admit a small clock-skew
	// envelope, but never let a malformed/future webhook reset usage days early.
	if (
		!Number.isSafeInteger(periodStart) ||
		periodStart < 0 ||
		periodStart > asOf + PLAN_USAGE_PERIOD_CLOCK_SKEW_MS
	) {
		throw new Error('PLAN_USAGE_INVALID:periodStart');
	}
	return periodStart;
}

export function planUsageCounterSnapshots(org: Doc<'organizations'>): {
	verified: number;
	email: number;
	emailReserved: number;
	emailReservationPeriod: number | undefined;
	sms: number;
} {
	return {
		verified: org.verifiedActionsLifetime ?? 0,
		email: org.sentEmailCount ?? 0,
		emailReserved: org.emailReservedCount ?? 0,
		emailReservationPeriod: org.emailReservationPeriodStart,
		sms: org.smsSentCount ?? 0
	};
}

/**
 * Read exact usage from six scalars. A stale/missing baseline is not repaired
 * in a request transaction; callers fail closed and the bounded migration owns
 * repair.
 */
export function projectedPlanUsageForPeriod(
	org: Doc<'organizations'>,
	periodStart: number
): ProjectedPlanUsage {
	if (!Number.isSafeInteger(periodStart) || periodStart < 0) {
		throw new Error('PLAN_USAGE_INVALID:periodStart');
	}
	if (
		org.verifiedActionsPeriodBaselineAt !== periodStart ||
		org.sentEmailPeriodBaselineAt !== periodStart ||
		org.emailReservationPeriodStart !== periodStart ||
		org.smsSentPeriodBaselineAt !== periodStart
	) {
		throw new Error('PLAN_USAGE_NOT_READY:period');
	}
	const verifiedLifetime = safeCounter('verifiedLifetime', org.verifiedActionsLifetime);
	const verifiedBaseline = safeCounter('verifiedBaseline', org.verifiedActionsPeriodBaseline);
	const emailLifetime = safeCounter('emailLifetime', org.sentEmailCount);
	const emailBaseline = safeCounter('emailBaseline', org.sentEmailPeriodBaseline);
	const emailsReserved = safeCounter('emailsReserved', org.emailReservedCount);
	if (org.emailReservationState === 'blocked') {
		throw new Error(
			`PLAN_USAGE_RESERVATION_BLOCKED:${org.emailReservationFailureCode ?? 'unknown'}`
		);
	}
	if (org.emailReservationState !== 'ready') {
		throw new Error('PLAN_USAGE_RESERVATION_NOT_READY');
	}
	const smsLifetime = safeCounter('smsLifetime', org.smsSentCount);
	const smsBaseline = safeCounter('smsBaseline', org.smsSentPeriodBaseline);
	if (
		verifiedBaseline > verifiedLifetime ||
		emailBaseline > emailLifetime ||
		smsBaseline > smsLifetime
	) {
		throw new Error('PLAN_USAGE_INVALID:baseline_ahead');
	}
	return {
		verifiedActions: verifiedLifetime - verifiedBaseline,
		emailsSent: emailLifetime - emailBaseline,
		emailsReserved,
		smsSent: smsLifetime - smsBaseline
	};
}

/**
 * Start an exact projection repair in the same Stripe mutation that advances
 * subscription state.
 *
 * A raw `baseline = lifetime` snapshot is only exact when the webhook arrives
 * before the first send in the new period. Stripe delivery can be late, so that
 * shortcut would erase already-billable usage. The source-paged worker instead
 * reconstructs usage since the authoritative period start, then publishes all
 * three baselines atomically after revalidating period and writer snapshots.
 */
export async function snapshotPlanUsageBaselines(
	ctx: MutationCtx,
	orgId: Id<'organizations'>,
	periodStart: number
): Promise<void> {
	if (!Number.isSafeInteger(periodStart) || periodStart < 0) {
		throw new Error('PLAN_USAGE_INVALID:periodStart');
	}
	await enqueuePlanUsageRepair(ctx, orgId);
}

/**
 * Coalesce a bounded per-organization repair. This helper is mutation-only so
 * the durable row and its first scheduled page commit atomically. Request-path
 * queries only return a coded not-ready result; product mutation/action gates
 * call this helper, and the hourly sweeper is the eventual-recovery backstop.
 */
export async function enqueuePlanUsageRepair(
	ctx: MutationCtx,
	orgId: Id<'organizations'>,
	options: { retryBlocked?: boolean } = {}
): Promise<{
	status: 'missing' | 'already_ready' | 'pending' | 'running' | 'blocked';
	periodStart?: number;
	runToken?: string;
}> {
	const org = await ctx.db.get(orgId);
	if (!org) return { status: 'missing' };
	const subscriptions = await ctx.db
		.query('subscriptions')
		.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
		.take(2);
	if (subscriptions.length > 1) {
		throw new Error('SUBSCRIPTION_CARDINALITY_REPAIR_REQUIRED');
	}
	const subscription = subscriptions[0] ?? null;
	const periodStart = planUsagePeriodStart(subscription, Date.now());
	const existing = await ctx.db
		.query('planUsageRepairs')
		.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
		.unique();

	try {
		const usage = projectedPlanUsageForPeriod(org, periodStart);
		if (existing && (existing.status !== 'ready' || existing.periodStart !== periodStart)) {
			const snapshots = planUsageCounterSnapshots(org);
			const now = Date.now();
			await ctx.db.patch(existing._id, {
				status: 'ready',
				periodStart,
				phase: 'complete',
				sourceCursor: undefined,
				verifiedActions: usage.verifiedActions,
				emailsSent: usage.emailsSent,
				emailReserved: usage.emailsReserved,
				smsSent: usage.smsSent,
				verifiedLifetimeSnapshot: snapshots.verified,
				emailLifetimeSnapshot: snapshots.email,
				emailReservedSnapshot: snapshots.emailReserved,
				emailReservationPeriodSnapshot: snapshots.emailReservationPeriod,
				smsLifetimeSnapshot: snapshots.sms,
				repairedCounterFields: undefined,
				failureCode: undefined,
				failureSourceId: undefined,
				scheduledAt: undefined,
				completedAt: now,
				updatedAt: now
			});
		}
		return { status: 'already_ready', periodStart, runToken: existing?.runToken };
	} catch {
		// The worker, never this enqueue transaction, owns bounded source repair.
	}

	if (existing?.periodStart === periodStart) {
		if (existing.status === 'pending' || existing.status === 'running') {
			if ((existing.scheduledAt ?? 0) < Date.now() - PLAN_USAGE_REPAIR_LEASE_MS) {
				const scheduledAt = Date.now();
				await ctx.db.patch(existing._id, { scheduledAt, updatedAt: scheduledAt });
				await ctx.scheduler.runAfter(0, continuePlanUsageRepairRef, {
					orgId,
					runToken: existing.runToken
				});
			}
			return { status: existing.status, periodStart, runToken: existing.runToken };
		}
		if (existing.status === 'blocked' && !options.retryBlocked) {
			return { status: 'blocked', periodStart, runToken: existing.runToken };
		}
	}

	const snapshots = planUsageCounterSnapshots(org);
	const now = Date.now();
	const runToken = crypto.randomUUID();
	const next = {
		orgId,
		status: 'pending' as const,
		runToken,
		periodStart,
		phase: 'verifiedActions' as const,
		sourceCursor: undefined,
		verifiedActions: 0,
		emailsSent: 0,
		emailReserved: 0,
		smsSent: 0,
		verifiedLifetimeSnapshot: snapshots.verified,
		emailLifetimeSnapshot: snapshots.email,
		emailReservedSnapshot: snapshots.emailReserved,
		emailReservationPeriodSnapshot: snapshots.emailReservationPeriod,
		smsLifetimeSnapshot: snapshots.sms,
		restarts: 0,
		scannedSourceRows: 0,
		repairedCounterFields: undefined,
		failureCode: undefined,
		failureSourceId: undefined,
		requestedAt: now,
		scheduledAt: now,
		startedAt: undefined,
		completedAt: undefined,
		updatedAt: now
	};
	if (existing) await ctx.db.patch(existing._id, next);
	else await ctx.db.insert('planUsageRepairs', next);
	await ctx.scheduler.runAfter(0, continuePlanUsageRepairRef, { orgId, runToken });
	return { status: 'pending', periodStart, runToken };
}
