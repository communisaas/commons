import { makeFunctionReference, type FunctionReference } from 'convex/server';
import { v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import {
	internalMutation,
	internalQuery,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';
import { applyCampaignDeliveryTransitionReadModel } from './lib/campaignReadModelDb';
import {
	enqueuePlanUsageRepair,
	isPlanUsageMigrationReady,
	PLAN_USAGE_MIGRATION_KEY,
	PLAN_USAGE_MIGRATION_MAX_RESTARTS,
	PLAN_USAGE_MIGRATION_PAGE_BYTES,
	PLAN_USAGE_MIGRATION_PAGE_ROWS,
	PLAN_USAGE_REPAIR_MAX_RESTARTS,
	planUsageCounterSnapshots,
	planUsagePeriodStart,
	projectedPlanUsageForPeriod
} from './lib/planUsage';
import {
	assertEmailReservationPartition,
	blockEmailReservation,
	reconcileEmailReservation
} from './lib/planUsageReservations';

const continuePlanUsageMigrationRef = makeFunctionReference<'mutation'>(
	'planUsage:migrate'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ runToken?: string; retryBlocked?: boolean; scheduleContinuation?: boolean },
	unknown
>;

const continuePlanUsageRepairRef = makeFunctionReference<'mutation'>(
	'planUsage:repairOrg'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ orgId: Id<'organizations'>; runToken: string },
	unknown
>;

const continuePlanUsageSweepRef = makeFunctionReference<'mutation'>(
	'planUsage:sweepStale'
) as unknown as FunctionReference<'mutation', 'internal', { cursor?: string }, unknown>;

const continueReservationSweepRef = makeFunctionReference<'mutation'>(
	'planUsage:sweepStaleReservations'
) as unknown as FunctionReference<'mutation', 'internal', { cursor?: string }, unknown>;

type Migration = Doc<'planUsageMigrations'>;
type Repair = Doc<'planUsageRepairs'>;
type SourcePhase =
	| 'verifiedActions'
	| 'emailBlasts'
	| 'campaignDeliveries'
	| 'workflowEmails'
	| 'emailReservations'
	| 'smsBlasts';

const PLAN_USAGE_SWEEP_PAGE_ROWS = 10;
const PLAN_USAGE_SWEEP_PAGE_BYTES = 2 * 1024 * 1024;
const RESERVATION_SWEEP_PAGE_ROWS = 10;

function counter(value: number | undefined, code: string): number {
	const resolved = value ?? 0;
	if (!Number.isSafeInteger(resolved) || resolved < 0) throw new Error(code);
	return resolved;
}

function failureCode(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return (message || 'PLAN_USAGE_MIGRATION_FAILED').slice(0, 256);
}

async function sha256Hex(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

function exactNonnegativeInteger(value: number, code: string): number {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
	return value;
}

async function scheduleContinuation(
	ctx: MutationCtx,
	runToken: string,
	enabled: boolean
): Promise<void> {
	if (!enabled) return;
	await ctx.scheduler.runAfter(0, continuePlanUsageMigrationRef, {
		runToken,
		scheduleContinuation: true
	});
}

async function initializeMigration(ctx: MutationCtx): Promise<Migration> {
	const now = Date.now();
	const id = await ctx.db.insert('planUsageMigrations', {
		key: PLAN_USAGE_MIGRATION_KEY,
		status: 'running',
		runToken: crypto.randomUUID(),
		// campaignDeliveries historically derived ownership through campaignId.
		// Adopt those rows once, page by page, before organization repair relies
		// on the new exact [orgId,sentAt] source index.
		phase: 'campaignDeliveriesAdoption',
		verifiedActions: 0,
		emailsSent: 0,
		emailReserved: 0,
		smsSent: 0,
		restarts: 0,
		scannedOrganizations: 0,
		projectedOrganizations: 0,
		scannedSourceRows: 0,
		startedAt: now,
		updatedAt: now
	});
	const row = await ctx.db.get(id);
	if (!row) throw new Error('PLAN_USAGE_MIGRATION_INSERT_FAILED');
	return row;
}

async function adoptCampaignDeliveriesPage(ctx: MutationCtx, migration: Migration): Promise<void> {
	const page = await ctx.db
		.query('campaignDeliveries')
		.order('asc')
		.paginate({
			cursor: migration.sourceCursor ?? null,
			numItems: PLAN_USAGE_MIGRATION_PAGE_ROWS,
			maximumRowsRead: PLAN_USAGE_MIGRATION_PAGE_ROWS + 1,
			maximumBytesRead: PLAN_USAGE_MIGRATION_PAGE_BYTES
		});
	if (page.pageStatus === 'SplitRequired') {
		throw new Error('PLAN_USAGE_CAMPAIGN_DELIVERY_ADOPTION_PAGE_TOO_LARGE');
	}
	for (const delivery of page.page) {
		if (
			delivery.sentAt === undefined &&
			(delivery.status === 'queued' || delivery.status === 'sending') &&
			delivery.planUsageReservationId === undefined
		) {
			throw new Error(
				`PLAN_USAGE_LEGACY_INFLIGHT_CAMPAIGN_DELIVERY:${String(delivery._id).slice(0, 64)}`
			);
		}
		if (delivery.orgId !== undefined) continue;
		const campaign = await ctx.db.get(delivery.campaignId);
		if (!campaign) {
			throw new Error(
				`PLAN_USAGE_CAMPAIGN_DELIVERY_CAMPAIGN_MISSING:${String(delivery._id).slice(0, 64)}`
			);
		}
		await ctx.db.patch(delivery._id, { orgId: campaign.orgId });
	}
	await ctx.db.patch(migration._id, {
		phase: page.isDone ? 'emailBlastsAdoption' : 'campaignDeliveriesAdoption',
		sourceCursor: page.isDone ? undefined : page.continueCursor,
		scannedSourceRows: migration.scannedSourceRows + page.page.length,
		updatedAt: Date.now()
	});
}

async function auditLegacyEmailBlastsPage(ctx: MutationCtx, migration: Migration): Promise<void> {
	const page = await ctx.db
		.query('emailBlasts')
		.order('asc')
		.paginate({
			cursor: migration.sourceCursor ?? null,
			numItems: PLAN_USAGE_MIGRATION_PAGE_ROWS,
			maximumRowsRead: PLAN_USAGE_MIGRATION_PAGE_ROWS + 1,
			maximumBytesRead: PLAN_USAGE_MIGRATION_PAGE_BYTES
		});
	if (page.pageStatus === 'SplitRequired') {
		throw new Error('PLAN_USAGE_EMAIL_BLAST_ADOPTION_PAGE_TOO_LARGE');
	}
	for (const blast of page.page) {
		if (
			(blast.status === 'scheduled' || blast.status === 'sending') &&
			blast.planUsageReservationId === undefined
		) {
			throw new Error(`PLAN_USAGE_LEGACY_INFLIGHT_EMAIL_BLAST:${String(blast._id).slice(0, 64)}`);
		}
		if (
			blast.planUsageReservationId === undefined &&
			blast.totalSent > 0 &&
			blast.sentAt === undefined
		) {
			throw new Error(
				`PLAN_USAGE_LEGACY_EMAIL_BLAST_PERIOD_AMBIGUOUS:${String(blast._id).slice(0, 64)}`
			);
		}
	}
	await ctx.db.patch(migration._id, {
		phase: page.isDone ? 'workflowEmailsAdoption' : 'emailBlastsAdoption',
		sourceCursor: page.isDone ? undefined : page.continueCursor,
		scannedSourceRows: migration.scannedSourceRows + page.page.length,
		updatedAt: Date.now()
	});
}

async function adoptWorkflowEmailsPage(ctx: MutationCtx, migration: Migration): Promise<void> {
	const page = await ctx.db
		.query('workflowActionLogs')
		.order('asc')
		.paginate({
			cursor: migration.sourceCursor ?? null,
			numItems: PLAN_USAGE_MIGRATION_PAGE_ROWS,
			maximumRowsRead: PLAN_USAGE_MIGRATION_PAGE_ROWS + 1,
			maximumBytesRead: PLAN_USAGE_MIGRATION_PAGE_BYTES
		});
	if (page.pageStatus === 'SplitRequired') {
		throw new Error('PLAN_USAGE_WORKFLOW_EMAIL_ADOPTION_PAGE_TOO_LARGE');
	}
	for (const log of page.page) {
		if (log.actionType !== 'send_email') continue;
		const result =
			log.result && typeof log.result === 'object'
				? (log.result as { success?: unknown; delivered?: unknown; messageId?: unknown })
				: null;
		if (!result || result.success !== true) {
			// Historical failures did not record whether SES had been reached. Do
			// not infer zero from an undifferentiated action error.
			throw new Error(
				`PLAN_USAGE_LEGACY_WORKFLOW_EMAIL_OUTCOME_AMBIGUOUS:${String(log._id).slice(0, 64)}`
			);
		}
		if (result.delivered !== true) continue;
		const matches = await ctx.db
			.query('workflowEmailDispatches')
			.withIndex('by_executionId_stepIndex', (q) =>
				q.eq('executionId', log.executionId).eq('stepIndex', log.stepIndex)
			)
			.take(2);
		if (matches.length > 1) {
			throw new Error('WORKFLOW_EMAIL_DISPATCH_CARDINALITY_REPAIR_REQUIRED');
		}
		if (matches[0]) continue;
		const execution = await ctx.db.get(log.executionId);
		if (!execution) {
			throw new Error(
				`PLAN_USAGE_LEGACY_WORKFLOW_EXECUTION_MISSING:${String(log._id).slice(0, 64)}`
			);
		}
		const workflow = await ctx.db.get(execution.workflowId);
		if (!workflow) {
			throw new Error(`PLAN_USAGE_LEGACY_WORKFLOW_MISSING:${String(log._id).slice(0, 64)}`);
		}
		await ctx.db.insert('workflowEmailDispatches', {
			executionId: log.executionId,
			stepIndex: log.stepIndex,
			orgId: workflow.orgId,
			status: 'sent',
			sesMessageId:
				typeof result.messageId === 'string' && result.messageId.length <= 256
					? result.messageId
					: undefined,
			sentAt: log.createdAt,
			createdAt: log.createdAt,
			updatedAt: Date.now()
		});
	}
	await ctx.db.patch(migration._id, {
		phase: page.isDone ? 'organizations' : 'workflowEmailsAdoption',
		sourceCursor: page.isDone ? undefined : page.continueCursor,
		scannedSourceRows: migration.scannedSourceRows + page.page.length,
		updatedAt: Date.now()
	});
}

async function selectOrganization(ctx: MutationCtx, migration: Migration): Promise<Migration> {
	const page = await ctx.db
		.query('organizations')
		.order('asc')
		.paginate({
			cursor: migration.organizationCursor ?? null,
			numItems: 1,
			maximumRowsRead: 2,
			maximumBytesRead: PLAN_USAGE_MIGRATION_PAGE_BYTES
		});
	if (page.pageStatus === 'SplitRequired') {
		throw new Error('PLAN_USAGE_ORGANIZATION_TOO_LARGE');
	}
	const org = page.page[0];
	if (!org) {
		const now = Date.now();
		await ctx.db.patch(migration._id, {
			status: 'migrated',
			phase: 'complete',
			organizationCursor: undefined,
			currentOrgId: undefined,
			sourceCursor: undefined,
			periodStart: undefined,
			completedAt: now,
			updatedAt: now
		});
		return { ...migration, status: 'migrated', phase: 'complete', completedAt: now };
	}
	const subscriptions = await ctx.db
		.query('subscriptions')
		.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
		.take(2);
	if (subscriptions.length > 1) throw new Error('SUBSCRIPTION_CARDINALITY_REPAIR_REQUIRED');
	const subscription = subscriptions[0] ?? null;
	const snapshots = planUsageCounterSnapshots(org);
	const patch = {
		phase: 'verifiedActions' as const,
		organizationCursor: page.continueCursor,
		currentOrgId: org._id,
		sourceCursor: undefined,
		periodStart: planUsagePeriodStart(subscription, Date.now()),
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
		scannedOrganizations: migration.scannedOrganizations + 1,
		updatedAt: Date.now()
	};
	await ctx.db.patch(migration._id, patch);
	return { ...migration, ...patch };
}

async function restartOrFinalizeOrganization(
	ctx: MutationCtx,
	migration: Migration,
	nextSmsSent: number,
	nextScannedRows: number
): Promise<void> {
	if (!migration.currentOrgId || migration.periodStart === undefined) {
		throw new Error('PLAN_USAGE_MIGRATION_STATE_INVALID');
	}
	const org = await ctx.db.get(migration.currentOrgId);
	if (!org) throw new Error('PLAN_USAGE_ORGANIZATION_MISSING');
	const currentPeriodStart = planUsagePeriodStart(
		await subscriptionForOrg(ctx, org._id),
		Date.now()
	);
	const rawSnapshots = planUsageCounterSnapshots(org);
	if (currentPeriodStart !== migration.periodStart) {
		const restarts = migration.restarts + 1;
		if (restarts > PLAN_USAGE_MIGRATION_MAX_RESTARTS) {
			throw new Error('PLAN_USAGE_MIGRATION_PERIOD_CHANGED');
		}
		await ctx.db.patch(migration._id, {
			phase: 'verifiedActions',
			sourceCursor: undefined,
			periodStart: currentPeriodStart,
			verifiedActions: 0,
			emailsSent: 0,
			emailReserved: 0,
			smsSent: 0,
			verifiedLifetimeSnapshot: rawSnapshots.verified,
			emailLifetimeSnapshot: rawSnapshots.email,
			emailReservedSnapshot: rawSnapshots.emailReserved,
			emailReservationPeriodSnapshot: rawSnapshots.emailReservationPeriod,
			smsLifetimeSnapshot: rawSnapshots.sms,
			restarts,
			scannedSourceRows: nextScannedRows,
			updatedAt: Date.now()
		});
		return;
	}
	const currentVerified = counter(
		org.verifiedActionsLifetime,
		'PLAN_USAGE_INVALID:verifiedLifetime'
	);
	const currentEmail = counter(org.sentEmailCount, 'PLAN_USAGE_INVALID:emailLifetime');
	const currentEmailReserved = counter(org.emailReservedCount, 'PLAN_USAGE_INVALID:emailReserved');
	const currentSms = counter(org.smsSentCount, 'PLAN_USAGE_INVALID:smsLifetime');
	if (
		currentVerified !== migration.verifiedLifetimeSnapshot ||
		currentEmail !== migration.emailLifetimeSnapshot ||
		currentEmailReserved !== migration.emailReservedSnapshot ||
		org.emailReservationPeriodStart !== migration.emailReservationPeriodSnapshot ||
		currentSms !== migration.smsLifetimeSnapshot
	) {
		const restarts = migration.restarts + 1;
		if (restarts > PLAN_USAGE_MIGRATION_MAX_RESTARTS) {
			throw new Error('PLAN_USAGE_MIGRATION_CONCURRENT_WRITES');
		}
		await ctx.db.patch(migration._id, {
			phase: 'verifiedActions',
			sourceCursor: undefined,
			verifiedActions: 0,
			emailsSent: 0,
			emailReserved: 0,
			smsSent: 0,
			verifiedLifetimeSnapshot: currentVerified,
			emailLifetimeSnapshot: currentEmail,
			emailReservedSnapshot: currentEmailReserved,
			emailReservationPeriodSnapshot: org.emailReservationPeriodStart,
			smsLifetimeSnapshot: currentSms,
			restarts,
			scannedSourceRows: nextScannedRows,
			updatedAt: Date.now()
		});
		return;
	}
	const verified = publishCounter(
		currentVerified,
		migration.verifiedActions,
		'verifiedActionsLifetime'
	);
	const email = publishCounter(currentEmail, migration.emailsSent, 'sentEmailCount');
	const sms = publishCounter(currentSms, nextSmsSent, 'smsSentCount');
	const repairedCounterFields = [
		verified.repairedField,
		email.repairedField,
		sms.repairedField
	].filter((field): field is string => field !== undefined);
	const now = Date.now();
	await ctx.db.patch(org._id, {
		verifiedActionsLifetime: verified.lifetime,
		verifiedActionsPeriodBaseline: verified.baseline,
		verifiedActionsPeriodBaselineAt: migration.periodStart,
		sentEmailCount: email.lifetime,
		sentEmailPeriodBaseline: email.baseline,
		sentEmailPeriodBaselineAt: migration.periodStart,
		emailReservedCount: migration.emailReserved,
		emailReservationPeriodStart: migration.periodStart,
		emailReservationState: 'ready',
		emailReservationFailureCode: undefined,
		smsSentCount: sms.lifetime,
		smsSentPeriodBaseline: sms.baseline,
		smsSentPeriodBaselineAt: migration.periodStart,
		updatedAt: now
	});
	const existingRepair = await ctx.db
		.query('planUsageRepairs')
		.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
		.unique();
	const repairEvidence = {
		orgId: org._id,
		status: 'ready' as const,
		runToken: existingRepair?.runToken ?? crypto.randomUUID(),
		periodStart: migration.periodStart,
		phase: 'complete' as const,
		sourceCursor: undefined,
		verifiedActions: migration.verifiedActions,
		emailsSent: migration.emailsSent,
		emailReserved: migration.emailReserved,
		smsSent: nextSmsSent,
		verifiedLifetimeSnapshot: verified.lifetime,
		emailLifetimeSnapshot: email.lifetime,
		emailReservedSnapshot: migration.emailReserved,
		emailReservationPeriodSnapshot: migration.periodStart,
		smsLifetimeSnapshot: sms.lifetime,
		restarts: migration.restarts,
		scannedSourceRows: nextScannedRows,
		repairedCounterFields: repairedCounterFields.length > 0 ? repairedCounterFields : undefined,
		failureCode: undefined,
		failureSourceId: undefined,
		requestedAt: existingRepair?.requestedAt ?? migration.startedAt,
		scheduledAt: undefined,
		startedAt: existingRepair?.startedAt ?? migration.startedAt,
		completedAt: now,
		updatedAt: now
	};
	if (existingRepair) await ctx.db.patch(existingRepair._id, repairEvidence);
	else await ctx.db.insert('planUsageRepairs', repairEvidence);
	await ctx.db.patch(migration._id, {
		phase: 'organizations',
		currentOrgId: undefined,
		sourceCursor: undefined,
		periodStart: undefined,
		verifiedActions: 0,
		emailsSent: 0,
		emailReserved: 0,
		smsSent: 0,
		verifiedLifetimeSnapshot: undefined,
		emailLifetimeSnapshot: undefined,
		emailReservedSnapshot: undefined,
		emailReservationPeriodSnapshot: undefined,
		smsLifetimeSnapshot: undefined,
		restarts: 0,
		projectedOrganizations: migration.projectedOrganizations + 1,
		scannedSourceRows: nextScannedRows,
		updatedAt: now
	});
}

async function scanSourcePage(
	ctx: MutationCtx,
	migration: Migration,
	phase: SourcePhase
): Promise<void> {
	if (!migration.currentOrgId || migration.periodStart === undefined) {
		throw new Error('PLAN_USAGE_MIGRATION_STATE_INVALID');
	}
	const currentOrgId = migration.currentOrgId;
	const periodStart = migration.periodStart;
	const options = {
		cursor: migration.sourceCursor ?? null,
		numItems: PLAN_USAGE_MIGRATION_PAGE_ROWS,
		maximumRowsRead: PLAN_USAGE_MIGRATION_PAGE_ROWS + 1,
		maximumBytesRead: PLAN_USAGE_MIGRATION_PAGE_BYTES
	};
	if (phase === 'verifiedActions') {
		const page = await ctx.db
			.query('campaignActions')
			.withIndex('by_orgId_verified_sentAt', (q) =>
				q.eq('orgId', currentOrgId).eq('verified', true).gte('sentAt', periodStart)
			)
			.paginate(options);
		if (page.pageStatus === 'SplitRequired') throw new Error('PLAN_USAGE_ACTION_PAGE_TOO_LARGE');
		const verifiedActions = checkedAdd(
			migration.verifiedActions,
			page.page.filter((row) => row.channel !== 'congressional').length,
			'PLAN_USAGE_INVALID:verifiedActions'
		);
		await ctx.db.patch(migration._id, {
			phase: page.isDone ? 'emailBlasts' : 'verifiedActions',
			sourceCursor: page.isDone ? undefined : page.continueCursor,
			verifiedActions,
			scannedSourceRows: migration.scannedSourceRows + page.page.length,
			updatedAt: Date.now()
		});
		return;
	}
	if (phase === 'emailBlasts') {
		const page = await ctx.db
			.query('emailBlasts')
			.withIndex('by_orgId_sentAt', (q) => q.eq('orgId', currentOrgId).gte('sentAt', periodStart))
			.paginate(options);
		if (page.pageStatus === 'SplitRequired') throw new Error('PLAN_USAGE_EMAIL_PAGE_TOO_LARGE');
		let emailsSent = migration.emailsSent;
		for (const row of page.page) {
			// Linked rows are represented exactly once by reservation.sentCount,
			// including partial/blocked outcomes. Unreserved legacy rows use their
			// durable carrier-success aggregate regardless of final blast status.
			if (row.planUsageReservationId !== undefined) continue;
			emailsSent = checkedAdd(emailsSent, row.totalSent, 'PLAN_USAGE_INVALID:emailBlast');
		}
		await ctx.db.patch(migration._id, {
			phase: page.isDone ? 'campaignDeliveries' : 'emailBlasts',
			sourceCursor: page.isDone ? undefined : page.continueCursor,
			emailsSent,
			scannedSourceRows: migration.scannedSourceRows + page.page.length,
			updatedAt: Date.now()
		});
		return;
	}
	if (phase === 'campaignDeliveries') {
		const page = await ctx.db
			.query('campaignDeliveries')
			.withIndex('by_orgId_sentAt', (q) => q.eq('orgId', currentOrgId).gte('sentAt', periodStart))
			.paginate(options);
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('PLAN_USAGE_CAMPAIGN_DELIVERY_PAGE_TOO_LARGE');
		}
		const unreservedCount = page.page.filter(
			(row) => row.planUsageReservationId === undefined
		).length;
		const emailsSent = checkedAdd(
			migration.emailsSent,
			unreservedCount,
			'PLAN_USAGE_INVALID:campaignDelivery'
		);
		await ctx.db.patch(migration._id, {
			phase: page.isDone ? 'workflowEmails' : 'campaignDeliveries',
			sourceCursor: page.isDone ? undefined : page.continueCursor,
			emailsSent,
			scannedSourceRows: migration.scannedSourceRows + page.page.length,
			updatedAt: Date.now()
		});
		return;
	}
	if (phase === 'workflowEmails') {
		const page = await ctx.db
			.query('workflowEmailDispatches')
			.withIndex('by_orgId_sentAt', (q) => q.eq('orgId', currentOrgId).gte('sentAt', periodStart))
			.paginate(options);
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('PLAN_USAGE_WORKFLOW_EMAIL_PAGE_TOO_LARGE');
		}
		const unreservedCount = page.page.filter(
			(row) => row.status === 'sent' && row.reservationId === undefined
		).length;
		const emailsSent = checkedAdd(
			migration.emailsSent,
			unreservedCount,
			'PLAN_USAGE_INVALID:workflowEmail'
		);
		await ctx.db.patch(migration._id, {
			phase: page.isDone ? 'emailReservations' : 'workflowEmails',
			sourceCursor: page.isDone ? undefined : page.continueCursor,
			emailsSent,
			scannedSourceRows: migration.scannedSourceRows + page.page.length,
			updatedAt: Date.now()
		});
		return;
	}
	if (phase === 'emailReservations') {
		const page = await ctx.db
			.query('planUsageReservations')
			.withIndex('by_orgId_status_periodStart', (q) => q.eq('orgId', currentOrgId))
			.paginate(options);
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('PLAN_USAGE_RESERVATION_PAGE_TOO_LARGE');
		}
		let emailReserved = migration.emailReserved;
		let emailsSent = migration.emailsSent;
		for (const reservation of page.page) {
			assertEmailReservationPartition(reservation);
			if (reservation.status === 'blocked') {
				throw new Error(`PLAN_USAGE_RESERVATION_BLOCKED:${String(reservation._id).slice(0, 64)}`);
			}
			if (reservation.status === 'active' && reservation.periodStart !== periodStart) {
				throw new Error(
					`PLAN_USAGE_STALE_ACTIVE_RESERVATION:${String(reservation._id).slice(0, 64)}`
				);
			}
			if (reservation.periodStart !== periodStart) continue;
			emailsSent = checkedAdd(
				emailsSent,
				reservation.sentCount,
				'PLAN_USAGE_INVALID:reservationSent'
			);
			if (reservation.status !== 'active') continue;
			emailReserved = checkedAdd(
				emailReserved,
				reservation.remainingCount,
				'PLAN_USAGE_INVALID:emailReserved'
			);
		}
		await ctx.db.patch(migration._id, {
			phase: page.isDone ? 'smsBlasts' : 'emailReservations',
			sourceCursor: page.isDone ? undefined : page.continueCursor,
			emailReserved,
			emailsSent,
			scannedSourceRows: migration.scannedSourceRows + page.page.length,
			updatedAt: Date.now()
		});
		return;
	}
	const page = await ctx.db
		.query('smsBlasts')
		.withIndex('by_orgId_sentAt', (q) => q.eq('orgId', currentOrgId).gte('sentAt', periodStart))
		.paginate(options);
	if (page.pageStatus === 'SplitRequired') throw new Error('PLAN_USAGE_SMS_PAGE_TOO_LARGE');
	let smsSent = migration.smsSent;
	for (const row of page.page) {
		// Successful carrier results are billable immediately. A browser may have
		// committed several batches while the blast is still `sending`; status is
		// deliberately not part of this metering predicate.
		smsSent = checkedAdd(smsSent, row.sentCount, 'PLAN_USAGE_INVALID:smsBlast');
	}
	const scannedSourceRows = migration.scannedSourceRows + page.page.length;
	if (page.isDone) {
		await restartOrFinalizeOrganization(ctx, migration, smsSent, scannedSourceRows);
		return;
	}
	await ctx.db.patch(migration._id, {
		sourceCursor: page.continueCursor,
		smsSent,
		scannedSourceRows,
		updatedAt: Date.now()
	});
}

function checkedAdd(left: number, right: number, code: string): number {
	if (!Number.isSafeInteger(right) || right < 0) throw new Error(code);
	const sum = left + right;
	if (!Number.isSafeInteger(sum) || sum < 0) throw new Error(code);
	return sum;
}

function publishCounter(
	snapshot: number,
	periodUsage: number,
	field: 'verifiedActionsLifetime' | 'sentEmailCount' | 'smsSentCount'
): { lifetime: number; baseline: number; repairedField?: string } {
	if (!Number.isSafeInteger(periodUsage) || periodUsage < 0) {
		throw new Error(`PLAN_USAGE_REPAIR_INVALID_USAGE:${field}`);
	}
	if (Number.isSafeInteger(snapshot) && snapshot >= periodUsage) {
		return { lifetime: snapshot, baseline: snapshot - periodUsage };
	}
	// Legacy SMS did not have a lifetime writer. A malformed/behind counter is
	// rebuilt to the exact current-period floor and the durable repair row records
	// that normalization; it is never silently trusted or allowed to undercount.
	return { lifetime: periodUsage, baseline: 0, repairedField: field };
}

async function subscriptionForOrg(ctx: MutationCtx, orgId: Id<'organizations'>) {
	const rows = await ctx.db
		.query('subscriptions')
		.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
		.take(2);
	if (rows.length > 1) throw new Error('SUBSCRIPTION_CARDINALITY_REPAIR_REQUIRED');
	return rows[0] ?? null;
}

async function scheduleRepair(ctx: MutationCtx, repair: Repair): Promise<void> {
	const scheduledAt = Date.now();
	await ctx.db.patch(repair._id, { scheduledAt, updatedAt: scheduledAt });
	await ctx.scheduler.runAfter(0, continuePlanUsageRepairRef, {
		orgId: repair.orgId,
		runToken: repair.runToken
	});
}

async function restartRepair(
	ctx: MutationCtx,
	repair: Repair,
	org: Doc<'organizations'>,
	periodStart: number,
	code: string
): Promise<void> {
	const restarts = repair.restarts + 1;
	if (restarts > PLAN_USAGE_REPAIR_MAX_RESTARTS) {
		throw new Error(`${code}:restart_limit`);
	}
	const snapshots = planUsageCounterSnapshots(org);
	const now = Date.now();
	await ctx.db.patch(repair._id, {
		status: 'running',
		periodStart,
		phase: 'verifiedActions',
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
		restarts,
		failureCode: undefined,
		failureSourceId: undefined,
		updatedAt: now
	});
	await scheduleRepair(ctx, { ...repair, periodStart, restarts });
}

async function finalizeRepair(
	ctx: MutationCtx,
	repair: Repair,
	nextSmsSent: number,
	nextScannedRows: number
): Promise<void> {
	const org = await ctx.db.get(repair.orgId);
	if (!org) throw new Error('PLAN_USAGE_REPAIR_ORGANIZATION_MISSING');
	const subscription = await subscriptionForOrg(ctx, repair.orgId);
	const currentPeriodStart = planUsagePeriodStart(subscription, Date.now());
	if (currentPeriodStart !== repair.periodStart) {
		await restartRepair(ctx, repair, org, currentPeriodStart, 'PLAN_USAGE_REPAIR_PERIOD_CHANGED');
		return;
	}
	const snapshots = planUsageCounterSnapshots(org);
	if (
		snapshots.verified !== repair.verifiedLifetimeSnapshot ||
		snapshots.email !== repair.emailLifetimeSnapshot ||
		snapshots.emailReserved !== repair.emailReservedSnapshot ||
		snapshots.emailReservationPeriod !== repair.emailReservationPeriodSnapshot ||
		snapshots.sms !== repair.smsLifetimeSnapshot
	) {
		await restartRepair(ctx, repair, org, repair.periodStart, 'PLAN_USAGE_REPAIR_COUNTER_CHANGED');
		return;
	}

	const verified = publishCounter(
		repair.verifiedLifetimeSnapshot,
		repair.verifiedActions,
		'verifiedActionsLifetime'
	);
	const email = publishCounter(repair.emailLifetimeSnapshot, repair.emailsSent, 'sentEmailCount');
	const sms = publishCounter(repair.smsLifetimeSnapshot, nextSmsSent, 'smsSentCount');
	const repairedCounterFields = [
		verified.repairedField,
		email.repairedField,
		sms.repairedField
	].filter((field): field is string => field !== undefined);
	const now = Date.now();
	await ctx.db.patch(org._id, {
		verifiedActionsLifetime: verified.lifetime,
		verifiedActionsPeriodBaseline: verified.baseline,
		verifiedActionsPeriodBaselineAt: repair.periodStart,
		sentEmailCount: email.lifetime,
		sentEmailPeriodBaseline: email.baseline,
		sentEmailPeriodBaselineAt: repair.periodStart,
		emailReservedCount: repair.emailReserved,
		emailReservationPeriodStart: repair.periodStart,
		emailReservationState: 'ready',
		emailReservationFailureCode: undefined,
		smsSentCount: sms.lifetime,
		smsSentPeriodBaseline: sms.baseline,
		smsSentPeriodBaselineAt: repair.periodStart,
		updatedAt: now
	});
	await ctx.db.patch(repair._id, {
		status: 'ready',
		phase: 'complete',
		sourceCursor: undefined,
		emailReserved: repair.emailReserved,
		smsSent: nextSmsSent,
		emailReservedSnapshot: repair.emailReserved,
		emailReservationPeriodSnapshot: repair.periodStart,
		scannedSourceRows: nextScannedRows,
		repairedCounterFields: repairedCounterFields.length > 0 ? repairedCounterFields : undefined,
		failureCode: undefined,
		failureSourceId: undefined,
		scheduledAt: undefined,
		completedAt: now,
		updatedAt: now
	});
}

async function scanRepairPage(ctx: MutationCtx, repair: Repair): Promise<void> {
	const options = {
		cursor: repair.sourceCursor ?? null,
		numItems: PLAN_USAGE_MIGRATION_PAGE_ROWS,
		maximumRowsRead: PLAN_USAGE_MIGRATION_PAGE_ROWS + 1,
		maximumBytesRead: PLAN_USAGE_MIGRATION_PAGE_BYTES
	};
	if (repair.phase === 'verifiedActions') {
		const page = await ctx.db
			.query('campaignActions')
			.withIndex('by_orgId_verified_sentAt', (q) =>
				q.eq('orgId', repair.orgId).eq('verified', true).gte('sentAt', repair.periodStart)
			)
			.paginate(options);
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('PLAN_USAGE_REPAIR_ACTION_PAGE_TOO_LARGE');
		}
		const count = page.page.filter((row) => row.channel !== 'congressional').length;
		const verifiedActions = checkedAdd(
			repair.verifiedActions,
			count,
			'PLAN_USAGE_REPAIR_ACTION_COUNT_INVALID'
		);
		await ctx.db.patch(repair._id, {
			status: 'running',
			phase: page.isDone ? 'emailBlasts' : 'verifiedActions',
			sourceCursor: page.isDone ? undefined : page.continueCursor,
			verifiedActions,
			scannedSourceRows: repair.scannedSourceRows + page.page.length,
			updatedAt: Date.now()
		});
		await scheduleRepair(ctx, repair);
		return;
	}
	if (repair.phase === 'emailBlasts') {
		const page = await ctx.db
			.query('emailBlasts')
			.withIndex('by_orgId_sentAt', (q) =>
				q.eq('orgId', repair.orgId).gte('sentAt', repair.periodStart)
			)
			.paginate(options);
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('PLAN_USAGE_REPAIR_EMAIL_PAGE_TOO_LARGE');
		}
		let emailsSent = repair.emailsSent;
		for (const row of page.page) {
			if (row.planUsageReservationId !== undefined) continue;
			emailsSent = checkedAdd(emailsSent, row.totalSent, 'PLAN_USAGE_REPAIR_EMAIL_COUNT_INVALID');
		}
		await ctx.db.patch(repair._id, {
			status: 'running',
			phase: page.isDone ? 'campaignDeliveries' : 'emailBlasts',
			sourceCursor: page.isDone ? undefined : page.continueCursor,
			emailsSent,
			scannedSourceRows: repair.scannedSourceRows + page.page.length,
			updatedAt: Date.now()
		});
		await scheduleRepair(ctx, repair);
		return;
	}
	if (repair.phase === 'campaignDeliveries') {
		const page = await ctx.db
			.query('campaignDeliveries')
			.withIndex('by_orgId_sentAt', (q) =>
				q.eq('orgId', repair.orgId).gte('sentAt', repair.periodStart)
			)
			.paginate(options);
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('PLAN_USAGE_REPAIR_CAMPAIGN_DELIVERY_PAGE_TOO_LARGE');
		}
		const unreservedCount = page.page.filter(
			(row) => row.planUsageReservationId === undefined
		).length;
		const emailsSent = checkedAdd(
			repair.emailsSent,
			unreservedCount,
			'PLAN_USAGE_REPAIR_CAMPAIGN_DELIVERY_COUNT_INVALID'
		);
		await ctx.db.patch(repair._id, {
			status: 'running',
			phase: page.isDone ? 'workflowEmails' : 'campaignDeliveries',
			sourceCursor: page.isDone ? undefined : page.continueCursor,
			emailsSent,
			scannedSourceRows: repair.scannedSourceRows + page.page.length,
			updatedAt: Date.now()
		});
		await scheduleRepair(ctx, repair);
		return;
	}
	if (repair.phase === 'workflowEmails') {
		const page = await ctx.db
			.query('workflowEmailDispatches')
			.withIndex('by_orgId_sentAt', (q) =>
				q.eq('orgId', repair.orgId).gte('sentAt', repair.periodStart)
			)
			.paginate(options);
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('PLAN_USAGE_REPAIR_WORKFLOW_EMAIL_PAGE_TOO_LARGE');
		}
		const unreservedCount = page.page.filter(
			(row) => row.status === 'sent' && row.reservationId === undefined
		).length;
		const emailsSent = checkedAdd(
			repair.emailsSent,
			unreservedCount,
			'PLAN_USAGE_REPAIR_WORKFLOW_EMAIL_COUNT_INVALID'
		);
		await ctx.db.patch(repair._id, {
			status: 'running',
			phase: page.isDone ? 'emailReservations' : 'workflowEmails',
			sourceCursor: page.isDone ? undefined : page.continueCursor,
			emailsSent,
			scannedSourceRows: repair.scannedSourceRows + page.page.length,
			updatedAt: Date.now()
		});
		await scheduleRepair(ctx, repair);
		return;
	}
	if (repair.phase === 'emailReservations') {
		const page = await ctx.db
			.query('planUsageReservations')
			.withIndex('by_orgId_status_periodStart', (q) => q.eq('orgId', repair.orgId))
			.paginate(options);
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('PLAN_USAGE_REPAIR_RESERVATION_PAGE_TOO_LARGE');
		}
		let emailReserved = repair.emailReserved;
		let emailsSent = repair.emailsSent;
		for (const reservation of page.page) {
			assertEmailReservationPartition(reservation);
			if (reservation.status === 'blocked') {
				throw new Error(`PLAN_USAGE_RESERVATION_BLOCKED:${String(reservation._id).slice(0, 64)}`);
			}
			if (reservation.status === 'active' && reservation.periodStart !== repair.periodStart) {
				throw new Error(
					`PLAN_USAGE_STALE_ACTIVE_RESERVATION:${String(reservation._id).slice(0, 64)}`
				);
			}
			if (reservation.periodStart !== repair.periodStart) continue;
			emailsSent = checkedAdd(
				emailsSent,
				reservation.sentCount,
				'PLAN_USAGE_REPAIR_RESERVATION_SENT_INVALID'
			);
			if (reservation.status !== 'active') continue;
			emailReserved = checkedAdd(
				emailReserved,
				reservation.remainingCount,
				'PLAN_USAGE_REPAIR_EMAIL_RESERVED_INVALID'
			);
		}
		await ctx.db.patch(repair._id, {
			status: 'running',
			phase: page.isDone ? 'smsBlasts' : 'emailReservations',
			sourceCursor: page.isDone ? undefined : page.continueCursor,
			emailReserved,
			emailsSent,
			scannedSourceRows: repair.scannedSourceRows + page.page.length,
			updatedAt: Date.now()
		});
		await scheduleRepair(ctx, repair);
		return;
	}
	if (repair.phase !== 'smsBlasts') throw new Error('PLAN_USAGE_REPAIR_PHASE_INVALID');
	const page = await ctx.db
		.query('smsBlasts')
		.withIndex('by_orgId_sentAt', (q) =>
			q.eq('orgId', repair.orgId).gte('sentAt', repair.periodStart)
		)
		.paginate(options);
	if (page.pageStatus === 'SplitRequired') throw new Error('PLAN_USAGE_REPAIR_SMS_PAGE_TOO_LARGE');
	let smsSent = repair.smsSent;
	for (const row of page.page) {
		// SMS is metered per successful carrier result as each browser batch
		// commits. A partially completed `sending` blast is already billable.
		smsSent = checkedAdd(smsSent, row.sentCount, 'PLAN_USAGE_REPAIR_SMS_COUNT_INVALID');
	}
	const scannedSourceRows = repair.scannedSourceRows + page.page.length;
	if (page.isDone) {
		await finalizeRepair(ctx, repair, smsSent, scannedSourceRows);
		return;
	}
	await ctx.db.patch(repair._id, {
		status: 'running',
		sourceCursor: page.continueCursor,
		smsSent,
		scannedSourceRows,
		updatedAt: Date.now()
	});
	await scheduleRepair(ctx, repair);
}

export const enqueueForOrg = internalMutation({
	args: { orgId: v.id('organizations'), retryBlocked: v.optional(v.boolean()) },
	handler: async (ctx, args) =>
		await enqueuePlanUsageRepair(ctx, args.orgId, { retryBlocked: args.retryBlocked })
});

export const repairOrg = internalMutation({
	args: { orgId: v.id('organizations'), runToken: v.string() },
	handler: async (ctx, args) => {
		const repair = await ctx.db
			.query('planUsageRepairs')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.unique();
		if (!repair) return { status: 'missing' as const };
		if (repair.runToken !== args.runToken) return { status: 'superseded' as const };
		if (repair.status === 'ready' || repair.status === 'blocked') {
			return { status: repair.status, failureCode: repair.failureCode ?? null };
		}
		try {
			const org = await ctx.db.get(repair.orgId);
			if (!org) throw new Error('PLAN_USAGE_REPAIR_ORGANIZATION_MISSING');
			const currentPeriodStart = planUsagePeriodStart(
				await subscriptionForOrg(ctx, repair.orgId),
				Date.now()
			);
			if (currentPeriodStart !== repair.periodStart) {
				await restartRepair(
					ctx,
					repair,
					org,
					currentPeriodStart,
					'PLAN_USAGE_REPAIR_PERIOD_CHANGED'
				);
				return { status: 'running' as const, restarted: true };
			}
			if (repair.status === 'pending') {
				await ctx.db.patch(repair._id, {
					status: 'running',
					startedAt: repair.startedAt ?? Date.now(),
					updatedAt: Date.now()
				});
			}
			await scanRepairPage(ctx, repair);
			const next = await ctx.db.get(repair._id);
			return {
				status: next?.status ?? 'missing',
				phase: next?.phase ?? null,
				periodStart: next?.periodStart ?? null
			};
		} catch (error) {
			const code = failureCode(error);
			if (code.startsWith('PLAN_USAGE_RESERVATION') || code.startsWith('PLAN_USAGE_STALE_ACTIVE')) {
				await ctx.db.patch(repair.orgId, {
					emailReservationState: 'blocked',
					emailReservationFailureCode: code,
					updatedAt: Date.now()
				});
			}
			await ctx.db.patch(repair._id, {
				status: 'blocked',
				failureCode: code,
				failureSourceId: String(repair.orgId).slice(0, 256),
				scheduledAt: undefined,
				updatedAt: Date.now()
			});
			return { status: 'blocked' as const, failureCode: code };
		}
	}
});

/** Hourly bounded backstop for missed Stripe events and UTC month rollover. */
export const sweepStale = internalMutation({
	args: { cursor: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const migration = await ctx.db
			.query('planUsageMigrations')
			.withIndex('by_key', (q) => q.eq('key', PLAN_USAGE_MIGRATION_KEY))
			.unique();
		if (!isPlanUsageMigrationReady(migration)) {
			return { status: 'migration_not_ready' as const, scanned: 0 };
		}
		const page = await ctx.db
			.query('organizations')
			.order('asc')
			.paginate({
				cursor: args.cursor ?? null,
				numItems: PLAN_USAGE_SWEEP_PAGE_ROWS,
				maximumRowsRead: PLAN_USAGE_SWEEP_PAGE_ROWS + 1,
				maximumBytesRead: PLAN_USAGE_SWEEP_PAGE_BYTES
			});
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('PLAN_USAGE_SWEEP_PAGE_TOO_LARGE');
		}
		let enqueued = 0;
		for (const org of page.page) {
			const subscription = await subscriptionForOrg(ctx, org._id);
			const periodStart = planUsagePeriodStart(subscription, Date.now());
			try {
				projectedPlanUsageForPeriod(org, periodStart);
			} catch {
				const result = await enqueuePlanUsageRepair(ctx, org._id);
				if (result.status === 'pending') enqueued += 1;
			}
		}
		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, continuePlanUsageSweepRef, {
				cursor: page.continueCursor
			});
		}
		return {
			status: page.isDone ? ('complete' as const) : ('running' as const),
			scanned: page.page.length,
			enqueued,
			nextCursor: page.isDone ? null : page.continueCursor
		};
	}
});

type ReservationRecoveryResult = 'released' | 'settled' | 'blocked';

async function recoverReservationFromDurableSource(
	ctx: MutationCtx,
	reservation: Doc<'planUsageReservations'>
): Promise<ReservationRecoveryResult> {
	assertEmailReservationPartition(reservation);
	if (reservation.status !== 'active' && reservation.status !== 'blocked') {
		return reservation.status === 'settled' ? 'settled' : 'released';
	}
	if (reservation.sourceType === 'campaignDelivery') {
		let delivery: Doc<'campaignDeliveries'> | null = null;
		try {
			delivery = await ctx.db.get(reservation.sourceId as Id<'campaignDeliveries'>);
		} catch {
			// A malformed/missing source is ambiguous: never infer that no carrier
			// request occurred merely because the source cannot be loaded.
		}
		if (
			!delivery ||
			delivery.planUsageReservationId !== reservation._id ||
			delivery.orgId !== reservation.orgId
		) {
			await blockEmailReservation(
				ctx,
				reservation._id,
				'PLAN_USAGE_RESERVATION_SOURCE_MISSING_OR_DIVERGED'
			);
			return 'blocked';
		}
		if (delivery.status === 'queued') {
			// queued is pre-authority by construction: claimReportDeliveryForDispatch
			// transitions it to sending before the first SES request.
			await applyCampaignDeliveryTransitionReadModel(ctx, delivery._id, 'queued', 'failed');
			await reconcileEmailReservation(ctx, {
				reservationId: reservation._id,
				absoluteSentCount: 0,
				terminal: true,
				terminalReason: 'STALE_PRE_AUTHORITY_QUEUE',
				allowBlocked: reservation.status === 'blocked'
			});
			await ctx.db.patch(delivery._id, { status: 'failed' });
			return 'released';
		}
		if (delivery.status === 'sending') {
			await blockEmailReservation(ctx, reservation._id, 'SES_OUTCOME_AMBIGUOUS_STALE_LEASE');
			return 'blocked';
		}
		if (
			delivery.sentAt !== undefined &&
			['sent', 'delivered', 'bounced', 'opened'].includes(delivery.status)
		) {
			await reconcileEmailReservation(ctx, {
				reservationId: reservation._id,
				absoluteSentCount: 1,
				terminal: true,
				terminalReason: 'CAMPAIGN_DELIVERY_TERMINAL_SOURCE_EVIDENCE',
				allowBlocked: reservation.status === 'blocked'
			});
			return 'settled';
		}
		if (delivery.status === 'failed' && delivery.sentAt === undefined) {
			await reconcileEmailReservation(ctx, {
				reservationId: reservation._id,
				absoluteSentCount: 0,
				terminal: true,
				terminalReason: 'CAMPAIGN_DELIVERY_FAILURE_SOURCE_EVIDENCE',
				allowBlocked: reservation.status === 'blocked'
			});
			return 'released';
		}
		await blockEmailReservation(ctx, reservation._id, 'CAMPAIGN_DELIVERY_SOURCE_INCONSISTENT');
		return 'blocked';
	}
	if (reservation.sourceType === 'workflowEmail') {
		if (reservation.sourceStepIndex === undefined) {
			await blockEmailReservation(ctx, reservation._id, 'WORKFLOW_EMAIL_SOURCE_STEP_MISSING');
			return 'blocked';
		}
		let rows: Doc<'workflowEmailDispatches'>[] = [];
		try {
			rows = await ctx.db
				.query('workflowEmailDispatches')
				.withIndex('by_executionId_stepIndex', (q) =>
					q
						.eq('executionId', reservation.sourceId as Id<'workflowExecutions'>)
						.eq('stepIndex', reservation.sourceStepIndex!)
				)
				.take(2);
		} catch {
			// A malformed identity is handled as ambiguous below.
		}
		const dispatch = rows.length === 1 ? rows[0] : null;
		if (
			!dispatch ||
			dispatch.reservationId !== reservation._id ||
			dispatch.orgId !== reservation.orgId
		) {
			await blockEmailReservation(
				ctx,
				reservation._id,
				'PLAN_USAGE_RESERVATION_SOURCE_MISSING_OR_DIVERGED'
			);
			return 'blocked';
		}
		if (dispatch.status === 'prepared') {
			await reconcileEmailReservation(ctx, {
				reservationId: reservation._id,
				absoluteSentCount: 0,
				terminal: true,
				terminalReason: 'STALE_WORKFLOW_PRE_AUTHORITY',
				allowBlocked: reservation.status === 'blocked'
			});
			await ctx.db.patch(dispatch._id, {
				status: 'failed',
				failureCode: 'STALE_WORKFLOW_PRE_AUTHORITY',
				updatedAt: Date.now()
			});
			return 'released';
		}
		if (dispatch.status === 'sending' || dispatch.status === 'blocked') {
			await blockEmailReservation(ctx, reservation._id, 'WORKFLOW_SES_OUTCOME_AMBIGUOUS');
			if (dispatch.status !== 'blocked') {
				await ctx.db.patch(dispatch._id, {
					status: 'blocked',
					failureCode: 'WORKFLOW_SES_OUTCOME_AMBIGUOUS',
					updatedAt: Date.now()
				});
			}
			return 'blocked';
		}
		if (dispatch.status === 'sent' && dispatch.sentAt !== undefined && dispatch.sesMessageId) {
			await reconcileEmailReservation(ctx, {
				reservationId: reservation._id,
				absoluteSentCount: 1,
				terminal: true,
				terminalReason: 'WORKFLOW_EMAIL_TERMINAL_SOURCE_EVIDENCE',
				allowBlocked: reservation.status === 'blocked'
			});
			return 'settled';
		}
		if (dispatch.status === 'failed' && dispatch.sentAt === undefined) {
			await reconcileEmailReservation(ctx, {
				reservationId: reservation._id,
				absoluteSentCount: 0,
				terminal: true,
				terminalReason: 'WORKFLOW_EMAIL_FAILURE_SOURCE_EVIDENCE',
				allowBlocked: reservation.status === 'blocked'
			});
			return 'released';
		}
		await blockEmailReservation(ctx, reservation._id, 'WORKFLOW_EMAIL_SOURCE_INCONSISTENT');
		return 'blocked';
	}

	let blast: Doc<'emailBlasts'> | null = null;
	try {
		blast = await ctx.db.get(reservation.sourceId as Id<'emailBlasts'>);
	} catch {
		// Handled as ambiguous below.
	}
	if (
		!blast ||
		blast.planUsageReservationId !== reservation._id ||
		blast.orgId !== reservation.orgId
	) {
		await blockEmailReservation(
			ctx,
			reservation._id,
			'PLAN_USAGE_RESERVATION_SOURCE_MISSING_OR_DIVERGED'
		);
		return 'blocked';
	}
	if (blast.status === 'sending') {
		await blockEmailReservation(ctx, reservation._id, 'TEE_OUTCOME_AMBIGUOUS_STALE_LEASE');
		return 'blocked';
	}
	if (
		blast.status === 'sent' &&
		blast.sentAt !== undefined &&
		Number.isSafeInteger(blast.totalSent) &&
		blast.totalSent >= 0 &&
		Number.isSafeInteger(blast.totalBounced) &&
		blast.totalBounced >= 0 &&
		blast.totalSent + blast.totalBounced === reservation.requestedCount
	) {
		await reconcileEmailReservation(ctx, {
			reservationId: reservation._id,
			absoluteSentCount: blast.totalSent,
			terminal: true,
			terminalReason: 'EMAIL_BLAST_TERMINAL_SOURCE_EVIDENCE',
			allowBlocked: reservation.status === 'blocked'
		});
		return blast.totalSent > 0 ? 'settled' : 'released';
	}
	if (blast.status === 'failed' && blast.totalSent === 0) {
		await reconcileEmailReservation(ctx, {
			reservationId: reservation._id,
			absoluteSentCount: 0,
			terminal: true,
			terminalReason: 'EMAIL_BLAST_FAILURE_SOURCE_EVIDENCE',
			allowBlocked: reservation.status === 'blocked'
		});
		return 'released';
	}
	await blockEmailReservation(ctx, reservation._id, 'EMAIL_BLAST_SOURCE_INCONSISTENT');
	return 'blocked';
}

/** Bounded lease supervisor. Elapsed time is never treated as carrier failure:
 * only queued/pre-authority work may release automatically; any source that
 * could have crossed the carrier boundary becomes blocked and keeps capacity. */
export const sweepStaleReservations = internalMutation({
	args: { cursor: v.optional(v.string()) },
	handler: async (ctx, args) => {
		if (args.cursor && args.cursor.length > 2_048) {
			throw new Error('PLAN_USAGE_RESERVATION_CURSOR_INVALID');
		}
		const page = await ctx.db
			.query('planUsageReservations')
			.withIndex('by_status_leaseExpiresAt', (q) =>
				q.eq('status', 'active').lte('leaseExpiresAt', Date.now())
			)
			.paginate({
				cursor: args.cursor ?? null,
				numItems: RESERVATION_SWEEP_PAGE_ROWS,
				maximumRowsRead: RESERVATION_SWEEP_PAGE_ROWS + 1,
				maximumBytesRead: PLAN_USAGE_MIGRATION_PAGE_BYTES
			});
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('PLAN_USAGE_RESERVATION_SWEEP_PAGE_TOO_LARGE');
		}
		const results = { released: 0, settled: 0, blocked: 0 };
		for (const reservation of page.page) {
			let result: ReservationRecoveryResult;
			try {
				result = await recoverReservationFromDurableSource(ctx, reservation);
			} catch (error) {
				await blockEmailReservation(
					ctx,
					reservation._id,
					`PLAN_USAGE_RESERVATION_RECOVERY_FAILED:${failureCode(error)}`.slice(0, 256)
				);
				result = 'blocked';
			}
			results[result] += 1;
		}
		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, continueReservationSweepRef, {
				cursor: page.continueCursor
			});
		}
		return {
			status: page.isDone ? ('complete' as const) : ('running' as const),
			scanned: page.page.length,
			...results,
			nextCursor: page.isDone ? null : page.continueCursor
		};
	}
});

async function readReservationSourceSummary(
	ctx: { db: QueryCtx['db'] },
	reservation: Doc<'planUsageReservations'>
): Promise<{ source: Record<string, unknown> | null; parity: 'linked' | 'missing' }> {
	if (reservation.sourceType === 'campaignDelivery') {
		let row: Doc<'campaignDeliveries'> | null = null;
		try {
			row = await ctx.db.get(reservation.sourceId as Id<'campaignDeliveries'>);
		} catch {
			// Missing/malformed is represented explicitly for operator evidence.
		}
		if (!row) return { source: null, parity: 'missing' };
		if (row.planUsageReservationId !== reservation._id || row.orgId !== reservation.orgId) {
			throw new Error('PLAN_USAGE_RESERVATION_SOURCE_DIVERGED');
		}
		return {
			source: {
				id: row._id,
				status: row.status,
				sentAt: row.sentAt ?? null,
				messageId: row.sesMessageId ?? null,
				linked: true
			},
			parity: 'linked'
		};
	}
	if (reservation.sourceType === 'emailBlast') {
		let row: Doc<'emailBlasts'> | null = null;
		try {
			row = await ctx.db.get(reservation.sourceId as Id<'emailBlasts'>);
		} catch {
			// Missing/malformed is represented explicitly for operator evidence.
		}
		if (!row) return { source: null, parity: 'missing' };
		if (row.planUsageReservationId !== reservation._id || row.orgId !== reservation.orgId) {
			throw new Error('PLAN_USAGE_RESERVATION_SOURCE_DIVERGED');
		}
		return {
			source: {
				id: row._id,
				status: row.status,
				sentAt: row.sentAt ?? null,
				totalSent: row.totalSent,
				totalFailed: row.totalBounced,
				linked: true
			},
			parity: 'linked'
		};
	}
	if (reservation.sourceStepIndex === undefined) {
		throw new Error('WORKFLOW_EMAIL_SOURCE_STEP_MISSING');
	}
	let rows: Doc<'workflowEmailDispatches'>[] = [];
	try {
		rows = await ctx.db
			.query('workflowEmailDispatches')
			.withIndex('by_executionId_stepIndex', (q) =>
				q
					.eq('executionId', reservation.sourceId as Id<'workflowExecutions'>)
					.eq('stepIndex', reservation.sourceStepIndex!)
			)
			.take(2);
	} catch {
		// Missing/malformed is represented explicitly for operator evidence.
	}
	if (rows.length === 0) return { source: null, parity: 'missing' };
	if (rows.length > 1) throw new Error('WORKFLOW_EMAIL_DISPATCH_CARDINALITY_REPAIR_REQUIRED');
	const row = rows[0]!;
	if (row.reservationId !== reservation._id || row.orgId !== reservation.orgId) {
		throw new Error('PLAN_USAGE_RESERVATION_SOURCE_DIVERGED');
	}
	return {
		source: {
			id: row._id,
			status: row.status,
			sentAt: row.sentAt ?? null,
			messageId: row.sesMessageId ?? null,
			stepIndex: row.stepIndex,
			linked: true
		},
		parity: 'linked'
	};
}

async function reservationSourceDigest(
	reservation: Doc<'planUsageReservations'>,
	parity: 'linked' | 'missing'
): Promise<string> {
	return await sha256Hex(
		JSON.stringify({
			reservationId: String(reservation._id),
			orgId: String(reservation.orgId),
			sourceType: reservation.sourceType,
			sourceId: reservation.sourceId,
			sourceStepIndex: reservation.sourceStepIndex ?? null,
			periodStart: reservation.periodStart,
			requestedCount: reservation.requestedCount,
			parity
		})
	);
}

/** Operator evidence view. It exposes no PII and performs bounded source reads. */
export const reservationStatus = internalQuery({
	args: { reservationId: v.id('planUsageReservations') },
	handler: async (ctx, args) => {
		const reservation = await ctx.db.get(args.reservationId);
		if (!reservation) return null;
		const org = await ctx.db.get(reservation.orgId);
		let source: Record<string, unknown> | null = null;
		let sourceParity: 'linked' | 'missing' | 'diverged' = 'missing';
		try {
			const summary = await readReservationSourceSummary(ctx, reservation);
			source = summary.source;
			sourceParity = summary.parity;
		} catch {
			source = null;
			sourceParity = 'diverged';
		}
		const carrierEvidence = await ctx.db
			.query('planUsageCarrierEvidence')
			.withIndex('by_reservationId', (q) => q.eq('reservationId', reservation._id))
			.take(2);
		return {
			reservation,
			partitionValid:
				reservation.remainingCount + reservation.sentCount + reservation.releasedCount ===
				reservation.requestedCount,
			orgReservationState: org?.emailReservationState ?? null,
			orgFailureCode: org?.emailReservationFailureCode ?? null,
			orgReservedCount: org?.emailReservedCount ?? null,
			sourceParity,
			source,
			carrierEvidence,
			carrierEvidenceCardinalityValid: carrierEvidence.length <= 1
		};
	}
});

/**
 * Append one audited terminal SES observation. Counts are accepted only as a
 * complete partition of the reservation and every accepted message has a
 * unique carrier id. Source identity/digest are derived server-side.
 */
export const ingestCarrierEvidence = internalMutation({
	args: {
		reservationId: v.id('planUsageReservations'),
		evidenceIdentity: v.string(),
		operatorRef: v.string(),
		carrierMessageIds: v.array(v.string()),
		absoluteSentCount: v.number(),
		absoluteFailedCount: v.number(),
		observedAt: v.number()
	},
	handler: async (ctx, args) => {
		if (!/^[A-Za-z0-9._:-]{1,128}$/.test(args.evidenceIdentity)) {
			throw new Error('PLAN_USAGE_EVIDENCE_IDENTITY_INVALID');
		}
		if (args.operatorRef.length < 1 || args.operatorRef.length > 128) {
			throw new Error('PLAN_USAGE_EVIDENCE_OPERATOR_INVALID');
		}
		const sent = exactNonnegativeInteger(
			args.absoluteSentCount,
			'PLAN_USAGE_EVIDENCE_SENT_INVALID'
		);
		const failed = exactNonnegativeInteger(
			args.absoluteFailedCount,
			'PLAN_USAGE_EVIDENCE_FAILED_INVALID'
		);
		if (!Number.isSafeInteger(args.observedAt) || args.observedAt < 0) {
			throw new Error('PLAN_USAGE_EVIDENCE_OBSERVED_AT_INVALID');
		}
		const messageIds = args.carrierMessageIds.map((id) => id.trim());
		if (
			messageIds.some((id) => id.length < 1 || id.length > 128) ||
			new Set(messageIds).size !== messageIds.length ||
			messageIds.length !== sent ||
			new TextEncoder().encode(JSON.stringify(messageIds)).byteLength > 512 * 1024
		) {
			throw new Error('PLAN_USAGE_EVIDENCE_MESSAGE_IDS_INVALID');
		}
		const reservation = await ctx.db.get(args.reservationId);
		if (!reservation) throw new Error('PLAN_USAGE_RESERVATION_MISSING');
		assertEmailReservationPartition(reservation);
		if (reservation.status !== 'blocked') {
			throw new Error('PLAN_USAGE_RESERVATION_NOT_BLOCKED');
		}
		if (sent + failed !== reservation.requestedCount) {
			throw new Error('PLAN_USAGE_EVIDENCE_PARTITION_INCOMPLETE');
		}
		const priorForReservation = await ctx.db
			.query('planUsageCarrierEvidence')
			.withIndex('by_reservationId', (q) => q.eq('reservationId', reservation._id))
			.take(2);
		if (priorForReservation.length > 0) {
			if (
				priorForReservation.length === 1 &&
				priorForReservation[0]!.evidenceIdentity === args.evidenceIdentity &&
				priorForReservation[0]!.absoluteSentCount === sent &&
				priorForReservation[0]!.absoluteFailedCount === failed &&
				JSON.stringify(priorForReservation[0]!.carrierMessageIds) === JSON.stringify(messageIds)
			) {
				return priorForReservation[0]!._id;
			}
			throw new Error('PLAN_USAGE_EVIDENCE_ALREADY_EXISTS');
		}
		const identityRows = await ctx.db
			.query('planUsageCarrierEvidence')
			.withIndex('by_identity', (q) => q.eq('evidenceIdentity', args.evidenceIdentity))
			.take(2);
		if (identityRows.length > 0) throw new Error('PLAN_USAGE_EVIDENCE_IDENTITY_COLLISION');
		const summary = await readReservationSourceSummary(ctx, reservation);
		const sourceDigest = await reservationSourceDigest(reservation, summary.parity);
		return await ctx.db.insert('planUsageCarrierEvidence', {
			evidenceIdentity: args.evidenceIdentity,
			reservationId: reservation._id,
			orgId: reservation.orgId,
			carrier: 'ses',
			carrierMessageIds: messageIds,
			absoluteSentCount: sent,
			absoluteFailedCount: failed,
			sourceType: reservation.sourceType,
			sourceId: reservation.sourceId,
			sourceStepIndex: reservation.sourceStepIndex,
			sourceDigest,
			operatorRef: args.operatorRef,
			observedAt: args.observedAt,
			ingestedAt: Date.now()
		});
	}
});

async function applyCarrierEvidenceToSource(
	ctx: MutationCtx,
	reservation: Doc<'planUsageReservations'>,
	evidence: Doc<'planUsageCarrierEvidence'>
): Promise<void> {
	const sent = evidence.absoluteSentCount;
	const targetStatus = sent > 0 ? 'sent' : 'failed';
	if (reservation.sourceType === 'campaignDelivery') {
		let row: Doc<'campaignDeliveries'> | null = null;
		try {
			row = await ctx.db.get(reservation.sourceId as Id<'campaignDeliveries'>);
		} catch {
			return;
		}
		if (!row) return;
		if (row.planUsageReservationId !== reservation._id || row.orgId !== reservation.orgId) {
			throw new Error('PLAN_USAGE_RESERVATION_SOURCE_DIVERGED');
		}
		if (row.status !== targetStatus) {
			await applyCampaignDeliveryTransitionReadModel(ctx, row._id, row.status, targetStatus);
		}
		await ctx.db.patch(row._id, {
			status: targetStatus,
			sentAt: sent > 0 ? evidence.observedAt : undefined,
			sesMessageId: sent > 0 ? evidence.carrierMessageIds[0] : undefined
		});
		return;
	}
	if (reservation.sourceType === 'emailBlast') {
		let row: Doc<'emailBlasts'> | null = null;
		try {
			row = await ctx.db.get(reservation.sourceId as Id<'emailBlasts'>);
		} catch {
			return;
		}
		if (!row) return;
		if (row.planUsageReservationId !== reservation._id || row.orgId !== reservation.orgId) {
			throw new Error('PLAN_USAGE_RESERVATION_SOURCE_DIVERGED');
		}
		await ctx.db.patch(row._id, {
			status: targetStatus,
			totalSent: sent,
			totalBounced: evidence.absoluteFailedCount,
			sentAt: sent > 0 ? evidence.observedAt : undefined,
			sealedOrgKey: undefined,
			updatedAt: Date.now()
		});
		return;
	}
	if (reservation.sourceStepIndex === undefined) {
		throw new Error('WORKFLOW_EMAIL_SOURCE_STEP_MISSING');
	}
	let rows: Doc<'workflowEmailDispatches'>[] = [];
	try {
		rows = await ctx.db
			.query('workflowEmailDispatches')
			.withIndex('by_executionId_stepIndex', (q) =>
				q
					.eq('executionId', reservation.sourceId as Id<'workflowExecutions'>)
					.eq('stepIndex', reservation.sourceStepIndex!)
			)
			.take(2);
	} catch {
		return;
	}
	if (rows.length === 0) return;
	if (rows.length > 1) throw new Error('WORKFLOW_EMAIL_DISPATCH_CARDINALITY_REPAIR_REQUIRED');
	const row = rows[0]!;
	if (row.reservationId !== reservation._id || row.orgId !== reservation.orgId) {
		throw new Error('PLAN_USAGE_RESERVATION_SOURCE_DIVERGED');
	}
	await ctx.db.patch(row._id, {
		status: targetStatus,
		sesMessageId: sent > 0 ? evidence.carrierMessageIds[0] : undefined,
		sentAt: sent > 0 ? evidence.observedAt : undefined,
		failureCode: sent > 0 ? undefined : 'OPERATOR_CARRIER_EVIDENCE_TERMINAL_FAILURE',
		updatedAt: Date.now()
	});
}

/** Evidence-backed operator reconciliation. The mutation accepts no caller
 * count: it derives the only admissible outcome from the durable source row.
 * Ambiguous `sending` state remains blocked. A bounded repair, not this command,
 * is the sole authority allowed to clear the organization block. */
export const reconcileBlockedReservation = internalMutation({
	args: { reservationId: v.id('planUsageReservations') },
	handler: async (ctx, args) => {
		const reservation = await ctx.db.get(args.reservationId);
		if (!reservation) throw new Error('PLAN_USAGE_RESERVATION_MISSING');
		if (reservation.status !== 'blocked') {
			throw new Error('PLAN_USAGE_RESERVATION_NOT_BLOCKED');
		}
		const evidenceRows = await ctx.db
			.query('planUsageCarrierEvidence')
			.withIndex('by_reservationId', (q) => q.eq('reservationId', reservation._id))
			.take(2);
		if (evidenceRows.length !== 1) {
			throw new Error('PLAN_USAGE_RESERVATION_EVIDENCE_INCOMPLETE');
		}
		const evidence = evidenceRows[0]!;
		if (
			evidence.orgId !== reservation.orgId ||
			evidence.sourceType !== reservation.sourceType ||
			evidence.sourceId !== reservation.sourceId ||
			evidence.sourceStepIndex !== reservation.sourceStepIndex ||
			evidence.absoluteSentCount + evidence.absoluteFailedCount !== reservation.requestedCount ||
			evidence.carrierMessageIds.length !== evidence.absoluteSentCount
		) {
			throw new Error('PLAN_USAGE_RESERVATION_EVIDENCE_DIVERGED');
		}
		const reconciled = await reconcileEmailReservation(ctx, {
			reservationId: reservation._id,
			absoluteSentCount: evidence.absoluteSentCount,
			terminal: true,
			terminalReason: `OPERATOR_CARRIER_EVIDENCE:${evidence.evidenceIdentity}`.slice(0, 256),
			allowBlocked: true
		});
		await applyCarrierEvidenceToSource(ctx, reservation, evidence);
		const result: ReservationRecoveryResult = reconciled.sentCount > 0 ? 'settled' : 'released';
		const repair = await enqueuePlanUsageRepair(ctx, reservation.orgId, { retryBlocked: true });
		return { status: result, repairStatus: repair.status, runToken: repair.runToken ?? null };
	}
});

async function recordBlockedMigrationOrg(
	ctx: MutationCtx,
	migration: Migration,
	code: string
): Promise<void> {
	if (!migration.currentOrgId || migration.periodStart === undefined) return;
	const org = await ctx.db.get(migration.currentOrgId);
	if (!org) return;
	const existing = await ctx.db
		.query('planUsageRepairs')
		.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
		.unique();
	const snapshots = planUsageCounterSnapshots(org);
	const now = Date.now();
	if (code.startsWith('PLAN_USAGE_RESERVATION') || code.startsWith('PLAN_USAGE_STALE_ACTIVE')) {
		await ctx.db.patch(org._id, {
			emailReservationState: 'blocked',
			emailReservationFailureCode: code,
			updatedAt: now
		});
	}
	const evidence = {
		orgId: org._id,
		status: 'blocked' as const,
		runToken: existing?.runToken ?? migration.runToken,
		periodStart: migration.periodStart,
		phase:
			migration.phase === 'emailBlasts' ||
			migration.phase === 'campaignDeliveries' ||
			migration.phase === 'workflowEmails' ||
			migration.phase === 'emailReservations' ||
			migration.phase === 'smsBlasts'
				? migration.phase
				: ('verifiedActions' as const),
		sourceCursor: migration.sourceCursor,
		verifiedActions: migration.verifiedActions,
		emailsSent: migration.emailsSent,
		emailReserved: migration.emailReserved,
		smsSent: migration.smsSent,
		verifiedLifetimeSnapshot: migration.verifiedLifetimeSnapshot ?? snapshots.verified,
		emailLifetimeSnapshot: migration.emailLifetimeSnapshot ?? snapshots.email,
		emailReservedSnapshot: migration.emailReservedSnapshot ?? snapshots.emailReserved,
		emailReservationPeriodSnapshot:
			migration.emailReservationPeriodSnapshot ?? snapshots.emailReservationPeriod,
		smsLifetimeSnapshot: migration.smsLifetimeSnapshot ?? snapshots.sms,
		restarts: migration.restarts,
		scannedSourceRows: migration.scannedSourceRows,
		repairedCounterFields: existing?.repairedCounterFields,
		failureCode: code,
		failureSourceId: String(org._id).slice(0, 256),
		requestedAt: existing?.requestedAt ?? migration.startedAt,
		scheduledAt: undefined,
		startedAt: existing?.startedAt ?? migration.startedAt,
		completedAt: undefined,
		updatedAt: now
	};
	if (existing) await ctx.db.patch(existing._id, evidence);
	else await ctx.db.insert('planUsageRepairs', evidence);
}

export const migrate = internalMutation({
	args: {
		runToken: v.optional(v.string()),
		retryBlocked: v.optional(v.boolean()),
		scheduleContinuation: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		let migration = await ctx.db
			.query('planUsageMigrations')
			.withIndex('by_key', (q) => q.eq('key', PLAN_USAGE_MIGRATION_KEY))
			.unique();
		if (!migration) migration = await initializeMigration(ctx);
		if (args.runToken && args.runToken !== migration.runToken) {
			return { status: 'superseded' as const, runToken: migration.runToken };
		}
		if (migration.status === 'ready' || migration.status === 'migrated') {
			return { status: migration.status, runToken: migration.runToken };
		}
		if (migration.status === 'blocked') {
			if (!args.retryBlocked) {
				return {
					status: 'blocked' as const,
					runToken: migration.runToken,
					failureCode: migration.failureCode ?? null
				};
			}
			const org = migration.currentOrgId ? await ctx.db.get(migration.currentOrgId) : null;
			if (migration.currentOrgId && !org) {
				return {
					status: 'blocked' as const,
					runToken: migration.runToken,
					failureCode: 'PLAN_USAGE_ORGANIZATION_MISSING'
				};
			}
			const snapshots = org ? planUsageCounterSnapshots(org) : null;
			const periodStart = org
				? planUsagePeriodStart(await subscriptionForOrg(ctx, org._id), Date.now())
				: undefined;
			await ctx.db.patch(migration._id, {
				status: 'running',
				failureCode: undefined,
				failureSourceId: undefined,
				sourceCursor: undefined,
				phase: migration.currentOrgId
					? 'verifiedActions'
					: migration.phase === 'campaignDeliveriesAdoption' ||
						  migration.phase === 'emailBlastsAdoption' ||
						  migration.phase === 'workflowEmailsAdoption'
						? migration.phase
						: 'organizations',
				periodStart,
				verifiedActions: 0,
				emailsSent: 0,
				emailReserved: 0,
				smsSent: 0,
				verifiedLifetimeSnapshot: snapshots?.verified,
				emailLifetimeSnapshot: snapshots?.email,
				emailReservedSnapshot: snapshots?.emailReserved,
				emailReservationPeriodSnapshot: snapshots?.emailReservationPeriod,
				smsLifetimeSnapshot: snapshots?.sms,
				restarts: 0,
				completedAt: undefined,
				updatedAt: Date.now()
			});
			migration = (await ctx.db.get(migration._id))!;
		}

		try {
			if (migration.phase === 'campaignDeliveriesAdoption') {
				await adoptCampaignDeliveriesPage(ctx, migration);
			} else if (migration.phase === 'emailBlastsAdoption') {
				await auditLegacyEmailBlastsPage(ctx, migration);
			} else if (migration.phase === 'workflowEmailsAdoption') {
				await adoptWorkflowEmailsPage(ctx, migration);
			} else if (migration.phase === 'organizations') {
				migration = await selectOrganization(ctx, migration);
			} else if (migration.phase !== 'complete') {
				await scanSourcePage(ctx, migration, migration.phase);
			}
			const next = await ctx.db.get(migration._id);
			if (!next) throw new Error('PLAN_USAGE_MIGRATION_MISSING');
			if (next.status === 'running') {
				await scheduleContinuation(ctx, next.runToken, args.scheduleContinuation ?? true);
			}
			return {
				status: next.status,
				runToken: next.runToken,
				phase: next.phase,
				scannedOrganizations: next.scannedOrganizations,
				projectedOrganizations: next.projectedOrganizations
			};
		} catch (error) {
			const code = failureCode(error);
			await recordBlockedMigrationOrg(ctx, migration, code);
			await ctx.db.patch(migration._id, {
				status: 'blocked',
				failureCode: code,
				failureSourceId: migration.currentOrgId
					? String(migration.currentOrgId).slice(0, 256)
					: undefined,
				updatedAt: Date.now()
			});
			return { status: 'blocked' as const, runToken: migration.runToken, failureCode: code };
		}
	}
});

export const activate = internalMutation({
	args: {},
	handler: async (ctx) => {
		const migration = await ctx.db
			.query('planUsageMigrations')
			.withIndex('by_key', (q) => q.eq('key', PLAN_USAGE_MIGRATION_KEY))
			.unique();
		const [subscriptionAuthority, pendingRepair, runningRepair, blockedRepair, blockedReservation] =
			await Promise.all([
				ctx.db
					.query('subscriptionAuthorityMigrations')
					.withIndex('by_key', (q) => q.eq('key', 'subscription-authority-v1'))
					.unique(),
				ctx.db
					.query('planUsageRepairs')
					.withIndex('by_status_updatedAt', (q) => q.eq('status', 'pending'))
					.first(),
				ctx.db
					.query('planUsageRepairs')
					.withIndex('by_status_updatedAt', (q) => q.eq('status', 'running'))
					.first(),
				ctx.db
					.query('planUsageRepairs')
					.withIndex('by_status_updatedAt', (q) => q.eq('status', 'blocked'))
					.first(),
				ctx.db
					.query('planUsageReservations')
					.withIndex('by_status_leaseExpiresAt', (q) => q.eq('status', 'blocked'))
					.first()
			]);
		if (
			subscriptionAuthority?.status !== 'ready' ||
			subscriptionAuthority.cursor !== undefined ||
			subscriptionAuthority.completedAt === undefined ||
			subscriptionAuthority.failureCode !== undefined ||
			migration?.status !== 'migrated' ||
			migration.phase !== 'complete' ||
			migration.currentOrgId !== undefined ||
			migration.sourceCursor !== undefined ||
			migration.failureCode !== undefined ||
			migration.failureSourceId !== undefined ||
			migration.scannedOrganizations !== migration.projectedOrganizations ||
			pendingRepair !== null ||
			runningRepair !== null ||
			blockedRepair !== null ||
			blockedReservation !== null
		) {
			throw new Error('PLAN_USAGE_MIGRATION_INEXACT');
		}
		await ctx.db.patch(migration._id, { status: 'ready', updatedAt: Date.now() });
		return { status: 'ready' as const, projectedOrganizations: migration.projectedOrganizations };
	}
});

export const status = internalQuery({
	args: {},
	handler: async (ctx) => {
		const migration = await ctx.db
			.query('planUsageMigrations')
			.withIndex('by_key', (q) => q.eq('key', PLAN_USAGE_MIGRATION_KEY))
			.unique();
		return migration
			? {
					status: migration.status,
					phase: migration.phase,
					ready: isPlanUsageMigrationReady(migration),
					runToken: migration.runToken,
					scannedOrganizations: migration.scannedOrganizations,
					projectedOrganizations: migration.projectedOrganizations,
					scannedSourceRows: migration.scannedSourceRows,
					failureCode: migration.failureCode ?? null,
					failureSourceId: migration.failureSourceId ?? null
				}
			: { status: 'not-started' as const, ready: false };
	}
});

/** Exact operator view for one organization repair; never scans source history. */
export const repairStatus = internalQuery({
	args: { orgId: v.id('organizations') },
	handler: async (ctx, args) => {
		const repair = await ctx.db
			.query('planUsageRepairs')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.unique();
		return repair
			? {
					orgId: repair.orgId,
					status: repair.status,
					periodStart: repair.periodStart,
					phase: repair.phase,
					runToken: repair.runToken,
					restarts: repair.restarts,
					scannedSourceRows: repair.scannedSourceRows,
					repairedCounterFields: repair.repairedCounterFields ?? [],
					failureCode: repair.failureCode ?? null,
					failureSourceId: repair.failureSourceId ?? null,
					requestedAt: repair.requestedAt,
					scheduledAt: repair.scheduledAt ?? null,
					completedAt: repair.completedAt ?? null,
					updatedAt: repair.updatedAt
				}
			: null;
	}
});

/** Constant-cardinality operator summary of unresolved repair states. */
export const repairPlaneStatus = internalQuery({
	args: {},
	handler: async (ctx) => {
		const [pending, running, blocked] = await Promise.all([
			ctx.db
				.query('planUsageRepairs')
				.withIndex('by_status_updatedAt', (q) => q.eq('status', 'pending'))
				.first(),
			ctx.db
				.query('planUsageRepairs')
				.withIndex('by_status_updatedAt', (q) => q.eq('status', 'running'))
				.first(),
			ctx.db
				.query('planUsageRepairs')
				.withIndex('by_status_updatedAt', (q) => q.eq('status', 'blocked'))
				.first()
		]);
		const compact = (row: Repair | null) =>
			row
				? {
						orgId: row.orgId,
						periodStart: row.periodStart,
						phase: row.phase,
						failureCode: row.failureCode ?? null,
						updatedAt: row.updatedAt
					}
				: null;
		return { pending: compact(pending), running: compact(running), blocked: compact(blocked) };
	}
});
