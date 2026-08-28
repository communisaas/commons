import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export const EMAIL_RESERVATION_LEASE_MS = 15 * 60 * 1000;

export type EmailReservationSourceType = 'campaignDelivery' | 'emailBlast' | 'workflowEmail';

type EmailReservationAdmission = {
	periodStart: number;
	currentEmailsSent: number;
	maxEmails: number;
};

function nonnegativeSafeInteger(value: number, code: string): number {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
	return value;
}

function checkedAdd(left: number, right: number, code: string): number {
	const sum = left + right;
	if (!Number.isSafeInteger(sum) || sum < 0) throw new Error(code);
	return sum;
}

export function assertEmailReservationPartition(
	reservation: Pick<
		Doc<'planUsageReservations'>,
		'requestedCount' | 'remainingCount' | 'sentCount' | 'releasedCount'
	>
): void {
	const requested = nonnegativeSafeInteger(
		reservation.requestedCount,
		'PLAN_USAGE_RESERVATION_REQUESTED_INVALID'
	);
	const remaining = nonnegativeSafeInteger(
		reservation.remainingCount,
		'PLAN_USAGE_RESERVATION_REMAINING_INVALID'
	);
	const sent = nonnegativeSafeInteger(reservation.sentCount, 'PLAN_USAGE_RESERVATION_SENT_INVALID');
	const released = nonnegativeSafeInteger(
		reservation.releasedCount,
		'PLAN_USAGE_RESERVATION_RELEASED_INVALID'
	);
	if (remaining + sent + released !== requested) {
		throw new Error('PLAN_USAGE_RESERVATION_PARTITION_INVALID');
	}
}

export function emailReservationIdentity(
	sourceType: EmailReservationSourceType,
	sourceId: string,
	sourceStepIndex?: number
): string {
	if (sourceId.length < 1 || sourceId.length > 128) {
		throw new Error('PLAN_USAGE_RESERVATION_SOURCE_ID_INVALID');
	}
	if (sourceType === 'workflowEmail') {
		if (!Number.isSafeInteger(sourceStepIndex) || (sourceStepIndex ?? -1) < 0) {
			throw new Error('PLAN_USAGE_RESERVATION_SOURCE_STEP_INVALID');
		}
		return `${sourceType}:${sourceId}:${sourceStepIndex}`;
	}
	if (sourceStepIndex !== undefined) {
		throw new Error('PLAN_USAGE_RESERVATION_SOURCE_STEP_UNEXPECTED');
	}
	return `${sourceType}:${sourceId}`;
}

/**
 * Atomically claim current-period capacity. Every caller must have obtained the
 * admission object from the authoritative projection in this same mutation.
 * The organization scalar is deliberately written on every new claim so
 * concurrent claims serialize and re-evaluate `sent + reserved + requested`.
 */
export async function reserveEmailUsage(
	ctx: MutationCtx,
	args: {
		orgId: Id<'organizations'>;
		sourceType: EmailReservationSourceType;
		sourceId: string;
		sourceStepIndex?: number;
		requestedCount: number;
		admission: EmailReservationAdmission;
		leaseExpiresAt?: number;
	}
): Promise<Doc<'planUsageReservations'>> {
	const requestedCount = nonnegativeSafeInteger(
		args.requestedCount,
		'PLAN_USAGE_RESERVATION_REQUESTED_INVALID'
	);
	if (requestedCount < 1) throw new Error('PLAN_USAGE_RESERVATION_EMPTY');
	nonnegativeSafeInteger(args.admission.periodStart, 'PLAN_USAGE_RESERVATION_PERIOD_INVALID');
	const claimedCurrentEmailsSent = nonnegativeSafeInteger(
		args.admission.currentEmailsSent,
		'PLAN_USAGE_RESERVATION_SENT_USAGE_INVALID'
	);
	const maxEmails = nonnegativeSafeInteger(
		args.admission.maxEmails,
		'PLAN_USAGE_RESERVATION_LIMIT_INVALID'
	);
	const reservationIdentity = emailReservationIdentity(
		args.sourceType,
		args.sourceId,
		args.sourceStepIndex
	);
	const existing = await ctx.db
		.query('planUsageReservations')
		.withIndex('by_identity', (q) => q.eq('reservationIdentity', reservationIdentity))
		.unique();
	if (existing) {
		assertEmailReservationPartition(existing);
		if (
			existing.orgId !== args.orgId ||
			existing.resource !== 'email' ||
			existing.sourceType !== args.sourceType ||
			existing.sourceId !== args.sourceId ||
			existing.sourceStepIndex !== args.sourceStepIndex ||
			existing.requestedCount !== requestedCount
		) {
			throw new Error('PLAN_USAGE_RESERVATION_IDENTITY_COLLISION');
		}
		if (existing.status === 'active' && existing.periodStart === args.admission.periodStart) {
			return existing;
		}
		throw new Error(`PLAN_USAGE_RESERVATION_NOT_CLAIMABLE:${existing.status}`);
	}

	const org = await ctx.db.get(args.orgId);
	if (!org) throw new Error('PLAN_USAGE_RESERVATION_ORGANIZATION_MISSING');
	if (
		org.emailReservationPeriodStart !== args.admission.periodStart ||
		org.sentEmailPeriodBaselineAt !== args.admission.periodStart ||
		org.emailReservationState !== 'ready'
	) {
		throw new Error('PLAN_USAGE_RESERVATION_PROJECTION_NOT_READY');
	}
	const reserved = nonnegativeSafeInteger(
		org.emailReservedCount ?? 0,
		'PLAN_USAGE_RESERVATION_SCALAR_INVALID'
	);
	const lifetime = nonnegativeSafeInteger(
		org.sentEmailCount ?? 0,
		'PLAN_USAGE_RESERVATION_EMAIL_LIFETIME_INVALID'
	);
	const baseline = nonnegativeSafeInteger(
		org.sentEmailPeriodBaseline ?? 0,
		'PLAN_USAGE_RESERVATION_EMAIL_BASELINE_INVALID'
	);
	if (baseline > lifetime)
		throw new Error('PLAN_USAGE_RESERVATION_EMAIL_BASELINE_EXCEEDS_LIFETIME');
	const currentEmailsSent = lifetime - baseline;
	if (claimedCurrentEmailsSent !== currentEmailsSent) {
		throw new Error('PLAN_USAGE_RESERVATION_ADMISSION_DIVERGED');
	}
	const committed = checkedAdd(
		currentEmailsSent,
		reserved,
		'PLAN_USAGE_RESERVATION_COMMITTED_INVALID'
	);
	if (
		checkedAdd(committed, requestedCount, 'PLAN_USAGE_RESERVATION_CAPACITY_INVALID') > maxEmails
	) {
		throw new Error('EMAIL_QUOTA_EXCEEDED');
	}

	const now = Date.now();
	const id = await ctx.db.insert('planUsageReservations', {
		reservationIdentity,
		orgId: args.orgId,
		resource: 'email',
		sourceType: args.sourceType,
		sourceId: args.sourceId,
		sourceStepIndex: args.sourceStepIndex,
		periodStart: args.admission.periodStart,
		requestedCount,
		remainingCount: requestedCount,
		sentCount: 0,
		releasedCount: 0,
		status: 'active',
		leaseExpiresAt: args.leaseExpiresAt ?? now + EMAIL_RESERVATION_LEASE_MS,
		createdAt: now,
		updatedAt: now
	});
	await ctx.db.patch(args.orgId, {
		emailReservedCount: reserved + requestedCount,
		updatedAt: now
	});
	const reservation = await ctx.db.get(id);
	if (!reservation) throw new Error('PLAN_USAGE_RESERVATION_INSERT_FAILED');
	return reservation;
}

/**
 * Reconcile an absolute carrier result. Absolute counts make retries
 * idempotent. A terminal result partitions every requested slot into either
 * sent or released; non-terminal progress converts only the newly confirmed
 * successes and keeps the remainder reserved.
 */
export async function reconcileEmailReservation(
	ctx: MutationCtx,
	args: {
		reservationId: Id<'planUsageReservations'>;
		absoluteSentCount: number;
		terminal: boolean;
		terminalReason?: string;
		allowBlocked?: boolean;
	}
): Promise<Doc<'planUsageReservations'>> {
	const reservation = await ctx.db.get(args.reservationId);
	if (!reservation) throw new Error('PLAN_USAGE_RESERVATION_MISSING');
	assertEmailReservationPartition(reservation);
	const absoluteSentCount = nonnegativeSafeInteger(
		args.absoluteSentCount,
		'PLAN_USAGE_RESERVATION_SENT_INVALID'
	);
	if (absoluteSentCount > reservation.requestedCount) {
		throw new Error('PLAN_USAGE_RESERVATION_SENT_EXCEEDS_REQUESTED');
	}
	if (reservation.status !== 'active' && !(reservation.status === 'blocked' && args.allowBlocked)) {
		if (reservation.sentCount === absoluteSentCount && args.terminal) return reservation;
		throw new Error(`PLAN_USAGE_RESERVATION_ALREADY_TERMINAL:${reservation.status}`);
	}
	if (absoluteSentCount < reservation.sentCount) {
		throw new Error('PLAN_USAGE_RESERVATION_SENT_REGRESSION');
	}

	const sentDelta = absoluteSentCount - reservation.sentCount;
	const releasedCount = args.terminal
		? reservation.requestedCount - absoluteSentCount
		: reservation.releasedCount;
	const remainingCount = reservation.requestedCount - absoluteSentCount - releasedCount;
	const consumedReservation = reservation.remainingCount - remainingCount;
	if (consumedReservation < 0) throw new Error('PLAN_USAGE_RESERVATION_REMAINING_REGRESSION');

	const org = await ctx.db.get(reservation.orgId);
	if (!org) throw new Error('PLAN_USAGE_RESERVATION_ORGANIZATION_MISSING');
	const emailLifetime = nonnegativeSafeInteger(
		org.sentEmailCount ?? 0,
		'PLAN_USAGE_INVALID:emailLifetime'
	);
	const orgPatch: Record<string, unknown> = {
		sentEmailCount: checkedAdd(
			emailLifetime,
			sentDelta,
			'PLAN_USAGE_RESERVATION_EMAIL_COUNTER_OVERFLOW'
		),
		updatedAt: Date.now()
	};
	if (org.emailReservationPeriodStart === reservation.periodStart) {
		const reserved = nonnegativeSafeInteger(
			org.emailReservedCount ?? 0,
			'PLAN_USAGE_RESERVATION_SCALAR_INVALID'
		);
		if (consumedReservation > reserved) {
			throw new Error('PLAN_USAGE_RESERVATION_SCALAR_UNDERFLOW');
		}
		orgPatch.emailReservedCount = reserved - consumedReservation;
	}
	await ctx.db.patch(reservation.orgId, orgPatch);

	const now = Date.now();
	const status = args.terminal
		? absoluteSentCount > 0
			? ('settled' as const)
			: ('released' as const)
		: ('active' as const);
	await ctx.db.patch(reservation._id, {
		remainingCount,
		sentCount: absoluteSentCount,
		releasedCount,
		status,
		terminalReason: args.terminal ? args.terminalReason : undefined,
		settledAt: args.terminal ? now : undefined,
		updatedAt: now
	});
	const next = await ctx.db.get(reservation._id);
	if (!next) throw new Error('PLAN_USAGE_RESERVATION_MISSING_AFTER_RECONCILE');
	assertEmailReservationPartition(next);
	return next;
}

/** Hold capacity and fail every subsequent admission closed when carrier
 * outcome is ambiguous. Only the evidence-backed operator reconciliation may
 * leave this state; elapsed time alone is never proof of failure. */
export async function blockEmailReservation(
	ctx: MutationCtx,
	reservationId: Id<'planUsageReservations'>,
	failureCode: string
): Promise<void> {
	if (failureCode.length < 1 || failureCode.length > 256) {
		throw new Error('PLAN_USAGE_RESERVATION_FAILURE_CODE_INVALID');
	}
	const reservation = await ctx.db.get(reservationId);
	if (!reservation) throw new Error('PLAN_USAGE_RESERVATION_MISSING');
	assertEmailReservationPartition(reservation);
	if (reservation.status === 'settled' || reservation.status === 'released') return;
	const now = Date.now();
	await ctx.db.patch(reservationId, {
		status: 'blocked',
		terminalReason: failureCode,
		updatedAt: now
	});
	await ctx.db.patch(reservation.orgId, {
		emailReservationState: 'blocked',
		emailReservationFailureCode: failureCode,
		updatedAt: now
	});
}

export async function renewEmailReservationLease(
	ctx: MutationCtx,
	reservationId: Id<'planUsageReservations'>,
	leaseExpiresAt = Date.now() + EMAIL_RESERVATION_LEASE_MS
): Promise<void> {
	const reservation = await ctx.db.get(reservationId);
	if (!reservation) throw new Error('PLAN_USAGE_RESERVATION_MISSING');
	assertEmailReservationPartition(reservation);
	if (reservation.status !== 'active') {
		throw new Error(`PLAN_USAGE_RESERVATION_ALREADY_TERMINAL:${reservation.status}`);
	}
	if (!Number.isSafeInteger(leaseExpiresAt) || leaseExpiresAt <= Date.now()) {
		throw new Error('PLAN_USAGE_RESERVATION_LEASE_INVALID');
	}
	await ctx.db.patch(reservationId, { leaseExpiresAt, updatedAt: Date.now() });
}
