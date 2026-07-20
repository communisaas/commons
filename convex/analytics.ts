/**
 * Analytics persistence and bounded differential-privacy snapshot plane.
 *
 * The raw aggregate writer is O(batch size) with one exact logical identity per
 * row. Daily materialization is a durable, per-date mutation coordinator: each
 * transaction reads a fixed page, writes deterministic snapshots idempotently,
 * charges the privacy budget once, and only then drains the raw aggregates in
 * bounded cleanup pages. Snapshot readers require the run to be complete.
 */

import { makeFunctionReference, type FunctionReference } from 'convex/server';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, internalQuery, mutation, type MutationCtx } from './_generated/server';
import { requireInternalSecret } from './_internalAuth';
import { ANALYTICS_CONTRIBUTION_AUTHORITY_READY } from './lib/analyticsPrivacyGate';

// =============================================================================
// FIXED ENVELOPES AND VERSION COORDINATES
// =============================================================================

const DAY_MS = 86_400_000;
const ANALYTICS_PLANE_VERSION = 1;
const ANALYTICS_SNAPSHOT_MIGRATION_KEY = 'analytics-snapshot-plane-v1';
const SERVER_EPSILON = 1;
const MAX_DAILY_EPSILON = 10;
const MAX_DIMENSION_LENGTH = 200;
const MAX_DIMENSION_KEY_BYTES = 1_024;
const MAX_IDENTITY_BYTES = 1_536;
const MAX_BATCH_SIZE = 100;
const RUN_LEASE_MS = 30 * 60 * 1_000;
const MAX_RUN_RESTARTS = 3;

/** Every materialization/migration transaction stays below these hard bounds. */
export const ANALYTICS_SNAPSHOT_PAGE_ROWS = 8;
export const ANALYTICS_SNAPSHOT_PAGE_BYTES = 512 * 1_024;
export const ANALYTICS_SNAPSHOT_MAX_WRITES = 20;

const ALLOWED_METRICS = new Set([
	'template_view',
	'template_use',
	'template_share',
	'delivery_attempt',
	'delivery_success',
	'delivery_fail',
	'auth_start',
	'auth_complete',
	'address_changed',
	'base_rate_relation',
	'front_door_intent',
	'error_network',
	'error_validation',
	'error_auth',
	'error_timeout',
	'error_unknown',
	'funnel_1',
	'funnel_2',
	'funnel_3',
	'funnel_4',
	'funnel_5',
	'cohort_first_seen',
	'cohort_return'
]);

type AnalyticsDimensions = {
	templateId?: string;
	jurisdiction?: string;
	deliveryMethod?: string;
	utmSource?: string;
	errorType?: string;
};

type CanonicalAnalyticsRow = AnalyticsDimensions & {
	date: number;
	metric: string;
	dimensionKey: string;
	aggregateIdentity: string;
	snapshotIdentity: string;
};

type SnapshotMigration = Doc<'analyticsSnapshotMigrations'>;
type SnapshotRun = Doc<'analyticsSnapshotRuns'>;

const continueSnapshotMigrationRef = makeFunctionReference<'mutation'>(
	'analytics:migrateSnapshotPlane'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{
		runToken?: string;
		retryBlocked?: boolean;
		scheduleContinuation?: boolean;
	},
	unknown
>;

const continueSnapshotRunRef = makeFunctionReference<'mutation'>(
	'analytics:continueSnapshotRun'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ runId: Id<'analyticsSnapshotRuns'>; runToken: string },
	unknown
>;

const continueSnapshotSupervisorRef = makeFunctionReference<'mutation'>(
	'analytics:superviseSnapshotRuns'
) as unknown as FunctionReference<'mutation', 'internal', { cursor?: string }, unknown>;

const textEncoder = new TextEncoder();

// =============================================================================
// CANONICAL IDENTITIES
// =============================================================================

function byteLength(value: string): number {
	return textEncoder.encode(value).byteLength;
}

function checkedIdentity(value: string, code: string): string {
	if (value.length === 0 || byteLength(value) > MAX_IDENTITY_BYTES) throw new Error(code);
	return value;
}

function canonicalDay(value: number, code: string): number {
	if (!Number.isSafeInteger(value) || value < 0 || value % DAY_MS !== 0) {
		throw new Error(code);
	}
	return value;
}

function canonicalMetric(value: unknown): string {
	if (typeof value !== 'string' || !ALLOWED_METRICS.has(value)) {
		throw new Error('ANALYTICS_METRIC_INVALID');
	}
	return value;
}

function sanitizeDimension(value: unknown): string | undefined {
	if (typeof value !== 'string' || value.length === 0) return undefined;
	const sanitized = value
		.slice(0, MAX_DIMENSION_LENGTH)
		.replace(/[^\w\-.:/ ]/g, '')
		.trim();
	return sanitized || undefined;
}

function canonicalDimensions(
	row: AnalyticsDimensions
): AnalyticsDimensions & { dimensionKey: string } {
	const templateId = sanitizeDimension(row.templateId);
	const jurisdiction = sanitizeDimension(row.jurisdiction);
	const deliveryMethod = sanitizeDimension(row.deliveryMethod);
	const utmSource = sanitizeDimension(row.utmSource);
	const errorType = sanitizeDimension(row.errorType);
	const dimensionKey = [
		templateId ?? '',
		jurisdiction ?? '',
		deliveryMethod ?? '',
		utmSource ?? '',
		errorType ?? ''
	].join('|');
	if (byteLength(dimensionKey) > MAX_DIMENSION_KEY_BYTES) {
		throw new Error('ANALYTICS_DIMENSION_KEY_TOO_LARGE');
	}
	return { templateId, jurisdiction, deliveryMethod, utmSource, errorType, dimensionKey };
}

function aggregateIdentity(date: number, metric: string, dimensionKey: string): string {
	return checkedIdentity(
		`analytics-aggregate-v${ANALYTICS_PLANE_VERSION}:${date}:${metric}:${dimensionKey}`,
		'ANALYTICS_AGGREGATE_IDENTITY_TOO_LARGE'
	);
}

function snapshotIdentity(date: number, metric: string, dimensionKey: string): string {
	return checkedIdentity(
		`analytics-snapshot-v${ANALYTICS_PLANE_VERSION}:${date}:${metric}:${dimensionKey}`,
		'ANALYTICS_SNAPSHOT_IDENTITY_TOO_LARGE'
	);
}

function snapshotRunIdentity(date: number): string {
	return checkedIdentity(
		`analytics-snapshot-run-v${ANALYTICS_PLANE_VERSION}:${date}`,
		'ANALYTICS_RUN_IDENTITY_TOO_LARGE'
	);
}

function privacyBudgetIdentity(
	userId: Id<'users'> | undefined,
	windowStart: number,
	metric: string
): string {
	return checkedIdentity(
		`analytics-budget-v${ANALYTICS_PLANE_VERSION}:${userId ? String(userId) : 'system'}:${windowStart}:${metric}`,
		'ANALYTICS_BUDGET_IDENTITY_TOO_LARGE'
	);
}

function canonicalAnalyticsRow(
	row: Pick<
		Doc<'analytics'>,
		| 'date'
		| 'snapshotDate'
		| 'metric'
		| 'templateId'
		| 'jurisdiction'
		| 'deliveryMethod'
		| 'utmSource'
		| 'errorType'
	>
): CanonicalAnalyticsRow {
	const date = canonicalDay(row.date ?? row.snapshotDate ?? -1, 'ANALYTICS_SNAPSHOT_DATE_INVALID');
	const metric = canonicalMetric(row.metric);
	const dimensions = canonicalDimensions(row);
	return {
		date,
		metric,
		...dimensions,
		aggregateIdentity: aggregateIdentity(date, metric, dimensions.dimensionKey),
		snapshotIdentity: snapshotIdentity(date, metric, dimensions.dimensionKey)
	};
}

function nonnegativeSafeInteger(value: unknown, code: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(code);
	return value as number;
}

function checkedAdd(left: number, right: number, code: string): number {
	const sum = left + right;
	if (!Number.isSafeInteger(sum) || sum < 0) throw new Error(code);
	return sum;
}

function safeFailureCode(error: unknown): string {
	const value = error instanceof Error ? error.message : 'ANALYTICS_SNAPSHOT_UNKNOWN_FAILURE';
	return value.replace(/[^A-Z0-9_:.-]/gi, '_').slice(0, 256) || 'ANALYTICS_SNAPSHOT_FAILURE';
}

function newRunToken(): string {
	return crypto.randomUUID();
}

function newNoiseSeed(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((value) => value.toString(16).padStart(2, '0'))
		.join('');
}

function legacyRunSeed(date: number, seed: string): string {
	if (seed.length < 1 || byteLength(seed) > 256) throw new Error('ANALYTICS_LEGACY_SEED_INVALID');
	return checkedIdentity(`legacy:${date}:${seed}`, 'ANALYTICS_LEGACY_RUN_SEED_TOO_LARGE');
}

async function importNoiseKey(noiseSeed: string): Promise<CryptoKey> {
	if (noiseSeed.length === 0 || byteLength(noiseSeed) > 512) {
		throw new Error('ANALYTICS_NOISE_SEED_INVALID');
	}
	return crypto.subtle.importKey(
		'raw',
		textEncoder.encode(noiseSeed),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
}

async function deterministicNoisyCount(
	count: number,
	noiseKey: CryptoKey,
	runIdentity: string,
	rowIdentity: string,
	epsilon: number
): Promise<number> {
	const exactCount = nonnegativeSafeInteger(count, 'ANALYTICS_AGGREGATE_COUNT_INVALID');
	if (!Number.isFinite(epsilon) || epsilon <= 0) throw new Error('ANALYTICS_EPSILON_INVALID');
	// A secret-seeded HMAC is a deterministic PRF. The version, run, and row are
	// separate domain coordinates, so retry/page order cannot change noise and an
	// accidental seed collision across dates cannot reuse a row's stream.
	const message = `analytics-laplace-v${ANALYTICS_PLANE_VERSION}\u0000${runIdentity}\u0000${rowIdentity}`;
	const mac = new Uint8Array(
		await crypto.subtle.sign('HMAC', noiseKey, textEncoder.encode(message))
	);
	// Six bytes form an exact 48-bit integer in JavaScript. Midpoint mapping keeps
	// the uniform coordinate strictly inside (0, 1), avoiding log(0) endpoints.
	let coordinate = 0;
	for (let index = 0; index < 6; index++) coordinate = coordinate * 256 + mac[index];
	const u = (coordinate + 0.5) / 2 ** 48 - 0.5;
	const magnitude = Math.min(Math.abs(u), 0.4999999999);
	const noise = -(1 / epsilon) * Math.sign(u) * Math.log(1 - 2 * magnitude);
	return Math.max(0, Math.round(exactCount + noise));
}

async function oneMigration(ctx: { db: MutationCtx['db'] }): Promise<SnapshotMigration | null> {
	const rows = await ctx.db
		.query('analyticsSnapshotMigrations')
		.withIndex('by_key', (q) => q.eq('key', ANALYTICS_SNAPSHOT_MIGRATION_KEY))
		.take(2);
	if (rows.length > 1) throw new Error('ANALYTICS_SNAPSHOT_MIGRATION_CARDINALITY_DIVERGED');
	return rows[0] ?? null;
}

async function runForDate(
	ctx: { db: MutationCtx['db'] },
	date: number
): Promise<SnapshotRun | null> {
	const identity = snapshotRunIdentity(date);
	const [identityRows, dateRows] = await Promise.all([
		ctx.db
			.query('analyticsSnapshotRuns')
			.withIndex('by_runIdentity', (q) => q.eq('runIdentity', identity))
			.take(2),
		ctx.db
			.query('analyticsSnapshotRuns')
			.withIndex('by_snapshotDate', (q) => q.eq('snapshotDate', date))
			.take(2)
	]);
	if (identityRows.length > 1 || dateRows.length > 1) {
		throw new Error('ANALYTICS_SNAPSHOT_RUN_CARDINALITY_DIVERGED');
	}
	const byIdentity = identityRows[0] ?? null;
	const byDate = dateRows[0] ?? null;
	if (byIdentity?._id !== byDate?._id) {
		throw new Error('ANALYTICS_SNAPSHOT_RUN_IDENTITY_DIVERGED');
	}
	return byIdentity;
}

async function requireMigrationReady(ctx: { db: MutationCtx['db'] }): Promise<SnapshotMigration> {
	const migration = await oneMigration(ctx);
	if (migration?.status !== 'ready' || migration.phase !== 'complete') {
		throw new Error('ANALYTICS_SNAPSHOT_PLANE_NOT_READY');
	}
	if (!ANALYTICS_CONTRIBUTION_AUTHORITY_READY) {
		throw new Error('ANALYTICS_CONTRIBUTION_AUTHORITY_NOT_READY');
	}
	return migration;
}

// =============================================================================
// RAW AGGREGATE WRITER
// =============================================================================

export const incrementBatch = mutation({
	args: {
		_secret: v.string(),
		increments: v.array(
			v.object({
				metric: v.string(),
				templateId: v.optional(v.string()),
				jurisdiction: v.optional(v.string()),
				deliveryMethod: v.optional(v.string()),
				utmSource: v.optional(v.string()),
				errorType: v.optional(v.string())
			})
		)
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		if (!ANALYTICS_CONTRIBUTION_AUTHORITY_READY) {
			throw new Error('ANALYTICS_CONTRIBUTION_AUTHORITY_NOT_READY');
		}
		if (args.increments.length > MAX_BATCH_SIZE) throw new Error('ANALYTICS_BATCH_TOO_LARGE');
		const now = Date.now();
		const today = Math.floor(now / DAY_MS) * DAY_MS;
		let written = 0;

		for (const raw of args.increments) {
			if (!ALLOWED_METRICS.has(raw.metric)) continue;
			const metric = canonicalMetric(raw.metric);
			const dimensions = canonicalDimensions(raw);
			const identity = aggregateIdentity(today, metric, dimensions.dimensionKey);
			// Exact recordType/date/logical-dimension lookup adopts a pre-migration
			// aggregate in place and never lets `.first()` hide multiplicity.
			const exactRows = await ctx.db
				.query('analytics')
				.withIndex('by_recordType_date_metric_dimension', (q) =>
					q
						.eq('recordType', 'aggregate')
						.eq('date', today)
						.eq('metric', metric)
						.eq('dimensionKey', dimensions.dimensionKey)
				)
				.take(2);
			if (exactRows.length > 1) throw new Error('ANALYTICS_AGGREGATE_IDENTITY_DIVERGED');
			const existing = exactRows[0];
			if (existing) {
				if (existing.aggregateIdentity && existing.aggregateIdentity !== identity) {
					throw new Error('ANALYTICS_AGGREGATE_IDENTITY_COLLISION');
				}
				const count = nonnegativeSafeInteger(
					existing.count ?? 0,
					'ANALYTICS_AGGREGATE_COUNT_INVALID'
				);
				await ctx.db.patch(existing._id, {
					aggregateIdentity: identity,
					planeVersion: ANALYTICS_PLANE_VERSION,
					count: checkedAdd(count, 1, 'ANALYTICS_AGGREGATE_COUNT_OVERFLOW'),
					updatedAt: now
				});
			} else {
				const identityRows = await ctx.db
					.query('analytics')
					.withIndex('by_aggregateIdentity', (q) => q.eq('aggregateIdentity', identity))
					.take(2);
				if (identityRows.length > 0) throw new Error('ANALYTICS_AGGREGATE_IDENTITY_COLLISION');
				await ctx.db.insert('analytics', {
					recordType: 'aggregate',
					aggregateIdentity: identity,
					planeVersion: ANALYTICS_PLANE_VERSION,
					date: today,
					metric,
					dimensionKey: dimensions.dimensionKey,
					templateId: dimensions.templateId,
					jurisdiction: dimensions.jurisdiction,
					deliveryMethod: dimensions.deliveryMethod,
					utmSource: dimensions.utmSource,
					errorType: dimensions.errorType,
					count: 1,
					updatedAt: now
				});
			}
			written++;
		}

		return { written };
	}
});

/** Bounded replacement for the retired collect-and-filter utility. */
export const queryByMetricAndDate = internalQuery({
	args: {
		metric: v.string(),
		startDate: v.number(),
		endDate: v.number(),
		cursor: v.optional(v.string()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const metric = canonicalMetric(args.metric);
		const startDate = canonicalDay(args.startDate, 'ANALYTICS_START_DATE_INVALID');
		const endDate = canonicalDay(args.endDate, 'ANALYTICS_END_DATE_INVALID');
		if (endDate < startDate) throw new Error('ANALYTICS_DATE_RANGE_INVALID');
		if (args.cursor && args.cursor.length > 2_048) throw new Error('ANALYTICS_CURSOR_INVALID');
		const limit = Math.min(Math.max(Math.trunc(args.limit ?? 25), 1), 50);
		const page = await ctx.db
			.query('analytics')
			.withIndex('by_metric_date', (q) =>
				q.eq('metric', metric).gte('date', startDate).lte('date', endDate)
			)
			.paginate({
				cursor: args.cursor ?? null,
				numItems: limit,
				maximumRowsRead: limit + 1,
				maximumBytesRead: ANALYTICS_SNAPSHOT_PAGE_BYTES
			});
		if (page.pageStatus === 'SplitRequired') throw new Error('ANALYTICS_QUERY_PAGE_TOO_LARGE');
		return {
			page: page.page,
			isDone: page.isDone,
			continueCursor: page.isDone ? null : page.continueCursor
		};
	}
});

// =============================================================================
// BOUNDED LAUNCH MIGRATION
// =============================================================================

async function initializeMigration(ctx: MutationCtx): Promise<SnapshotMigration> {
	const now = Date.now();
	const id = await ctx.db.insert('analyticsSnapshotMigrations', {
		key: ANALYTICS_SNAPSHOT_MIGRATION_KEY,
		status: 'running',
		phase: 'snapshots',
		runToken: newRunToken(),
		scannedRows: 0,
		adoptedRows: 0,
		legacyRunsAdopted: 0,
		startedAt: now,
		updatedAt: now
	});
	const migration = await ctx.db.get(id);
	if (!migration) throw new Error('ANALYTICS_SNAPSHOT_MIGRATION_INSERT_FAILED');
	return migration;
}

async function ensureLegacyReadyRun(
	ctx: MutationCtx,
	date: number,
	seed: string
): Promise<{ run: SnapshotRun; created: boolean }> {
	const existing = await runForDate(ctx, date);
	const noiseSeed = legacyRunSeed(date, seed);
	if (existing) {
		if (
			existing.status !== 'ready' ||
			existing.phase !== 'complete' ||
			existing.legacyAdopted !== true ||
			existing.noiseSeed !== noiseSeed
		) {
			throw new Error('ANALYTICS_LEGACY_RUN_DIVERGED');
		}
		return { run: existing, created: false };
	}
	const seedRows = await ctx.db
		.query('analyticsSnapshotRuns')
		.withIndex('by_noiseSeed', (q) => q.eq('noiseSeed', noiseSeed))
		.take(1);
	if (seedRows.length > 0) throw new Error('ANALYTICS_RUN_SEED_REUSE');
	const now = Date.now();
	const id = await ctx.db.insert('analyticsSnapshotRuns', {
		runIdentity: snapshotRunIdentity(date),
		snapshotDate: date,
		status: 'ready',
		phase: 'complete',
		runToken: `legacy:${date}`,
		noiseSeed,
		budgetClaimed: false,
		snapshotsCreated: 0,
		aggregatesDeleted: 0,
		scannedRows: 0,
		restarts: 0,
		leaseExpiresAt: now,
		legacyAdopted: true,
		startedAt: now,
		completedAt: now,
		updatedAt: now
	});
	const run = await ctx.db.get(id);
	if (!run) throw new Error('ANALYTICS_LEGACY_RUN_INSERT_FAILED');
	return { run, created: true };
}

async function migrateSnapshotRowsPage(
	ctx: MutationCtx,
	migration: SnapshotMigration
): Promise<void> {
	const page = await ctx.db
		.query('analytics')
		.withIndex('by_recordType', (q) => q.eq('recordType', 'snapshot'))
		.order('asc')
		.paginate({
			cursor: migration.cursor ?? null,
			numItems: ANALYTICS_SNAPSHOT_PAGE_ROWS,
			maximumRowsRead: ANALYTICS_SNAPSHOT_PAGE_ROWS + 1,
			maximumBytesRead: ANALYTICS_SNAPSHOT_PAGE_BYTES
		});
	if (page.pageStatus === 'SplitRequired') {
		throw new Error('ANALYTICS_SNAPSHOT_MIGRATION_PAGE_TOO_LARGE');
	}
	let adoptedRows = migration.adoptedRows;
	let legacyRunsAdopted = migration.legacyRunsAdopted;
	for (const row of page.page) {
		const canonical = canonicalAnalyticsRow(row);
		nonnegativeSafeInteger(row.noisyCount, 'ANALYTICS_LEGACY_NOISY_COUNT_INVALID');
		if (!Number.isFinite(row.epsilon) || (row.epsilon ?? 0) <= 0) {
			throw new Error('ANALYTICS_LEGACY_EPSILON_INVALID');
		}
		let legacyRun: { run: SnapshotRun; created: boolean };
		if (row.noiseSeed) {
			legacyRun = await ensureLegacyReadyRun(ctx, canonical.date, row.noiseSeed);
		} else {
			// The outer coordinator deliberately catches and persists a coded block.
			// Earlier rows in that transaction therefore may already be adopted. A
			// retry recognizes only that exact current-version row and exact legacy
			// run; an arbitrary seedless legacy row still fails closed.
			const adoptedRun = await runForDate(ctx, canonical.date);
			if (
				row.snapshotIdentity !== canonical.snapshotIdentity ||
				row.planeVersion !== ANALYTICS_PLANE_VERSION ||
				!adoptedRun ||
				adoptedRun.status !== 'ready' ||
				adoptedRun.phase !== 'complete' ||
				adoptedRun.legacyAdopted !== true ||
				!adoptedRun.noiseSeed.startsWith(`legacy:${canonical.date}:`)
			) {
				throw new Error('ANALYTICS_LEGACY_SEED_INVALID');
			}
			legacyRun = { run: adoptedRun, created: false };
		}
		const identityRows = await ctx.db
			.query('analytics')
			.withIndex('by_snapshotIdentity', (q) => q.eq('snapshotIdentity', canonical.snapshotIdentity))
			.take(2);
		if (
			identityRows.length > 1 ||
			(identityRows[0] !== undefined && identityRows[0]._id !== row._id)
		) {
			throw new Error('ANALYTICS_SNAPSHOT_IDENTITY_DIVERGED');
		}
		if (legacyRun.created) legacyRunsAdopted++;
		await ctx.db.patch(row._id, {
			date: canonical.date,
			snapshotDate: canonical.date,
			metric: canonical.metric,
			dimensionKey: canonical.dimensionKey,
			templateId: canonical.templateId,
			jurisdiction: canonical.jurisdiction,
			deliveryMethod: canonical.deliveryMethod,
			utmSource: canonical.utmSource,
			errorType: canonical.errorType,
			snapshotIdentity: canonical.snapshotIdentity,
			planeVersion: ANALYTICS_PLANE_VERSION,
			// The durable run is the only server-side seed authority. Snapshot rows
			// must not retain a secret that a future reader could accidentally expose.
			noiseSeed: undefined,
			updatedAt: Date.now()
		});
		adoptedRows++;
	}
	await ctx.db.patch(migration._id, {
		phase: page.isDone ? 'aggregates' : 'snapshots',
		cursor: page.isDone ? undefined : page.continueCursor,
		scannedRows: checkedAdd(
			migration.scannedRows,
			page.page.length,
			'ANALYTICS_MIGRATION_SCAN_OVERFLOW'
		),
		adoptedRows,
		legacyRunsAdopted,
		updatedAt: Date.now()
	});
}

async function migrateAggregateRowsPage(
	ctx: MutationCtx,
	migration: SnapshotMigration
): Promise<void> {
	const page = await ctx.db
		.query('analytics')
		.withIndex('by_recordType', (q) => q.eq('recordType', 'aggregate'))
		.order('asc')
		.paginate({
			cursor: migration.cursor ?? null,
			numItems: ANALYTICS_SNAPSHOT_PAGE_ROWS,
			maximumRowsRead: ANALYTICS_SNAPSHOT_PAGE_ROWS + 1,
			maximumBytesRead: ANALYTICS_SNAPSHOT_PAGE_BYTES
		});
	if (page.pageStatus === 'SplitRequired') {
		throw new Error('ANALYTICS_AGGREGATE_MIGRATION_PAGE_TOO_LARGE');
	}
	let adoptedRows = migration.adoptedRows;
	for (const row of page.page) {
		const canonical = canonicalAnalyticsRow(row);
		nonnegativeSafeInteger(row.count, 'ANALYTICS_AGGREGATE_COUNT_INVALID');
		const aggregateRows = await ctx.db
			.query('analytics')
			.withIndex('by_aggregateIdentity', (q) =>
				q.eq('aggregateIdentity', canonical.aggregateIdentity)
			)
			.take(2);
		if (
			aggregateRows.length > 1 ||
			(aggregateRows[0] !== undefined && aggregateRows[0]._id !== row._id)
		) {
			throw new Error('ANALYTICS_AGGREGATE_IDENTITY_DIVERGED');
		}
		const snapshots = await ctx.db
			.query('analytics')
			.withIndex('by_snapshotIdentity', (q) => q.eq('snapshotIdentity', canonical.snapshotIdentity))
			.take(1);
		if (snapshots.length > 0) {
			// The old action wrote snapshots before budget/cleanup. A surviving raw
			// row is therefore an ambiguous partial run, never proof that cleanup is safe.
			throw new Error('ANALYTICS_LEGACY_PARTIAL_SNAPSHOT_REQUIRES_RECONCILIATION');
		}
		await ctx.db.patch(row._id, {
			date: canonical.date,
			metric: canonical.metric,
			dimensionKey: canonical.dimensionKey,
			templateId: canonical.templateId,
			jurisdiction: canonical.jurisdiction,
			deliveryMethod: canonical.deliveryMethod,
			utmSource: canonical.utmSource,
			errorType: canonical.errorType,
			aggregateIdentity: canonical.aggregateIdentity,
			planeVersion: ANALYTICS_PLANE_VERSION,
			updatedAt: Date.now()
		});
		adoptedRows++;
	}
	await ctx.db.patch(migration._id, {
		phase: page.isDone ? 'budgets' : 'aggregates',
		cursor: page.isDone ? undefined : page.continueCursor,
		scannedRows: checkedAdd(
			migration.scannedRows,
			page.page.length,
			'ANALYTICS_MIGRATION_SCAN_OVERFLOW'
		),
		adoptedRows,
		updatedAt: Date.now()
	});
}

async function migrateBudgetRowsPage(
	ctx: MutationCtx,
	migration: SnapshotMigration
): Promise<void> {
	const page = await ctx.db
		.query('privacyBudgets')
		.order('asc')
		.paginate({
			cursor: migration.cursor ?? null,
			numItems: ANALYTICS_SNAPSHOT_PAGE_ROWS,
			maximumRowsRead: ANALYTICS_SNAPSHOT_PAGE_ROWS + 1,
			maximumBytesRead: ANALYTICS_SNAPSHOT_PAGE_BYTES
		});
	if (page.pageStatus === 'SplitRequired') {
		throw new Error('ANALYTICS_BUDGET_MIGRATION_PAGE_TOO_LARGE');
	}
	let adoptedRows = migration.adoptedRows;
	for (const budget of page.page) {
		if (
			!Number.isSafeInteger(budget.windowStart) ||
			budget.windowStart < 0 ||
			!Number.isSafeInteger(budget.windowEnd) ||
			budget.windowEnd <= budget.windowStart ||
			!Number.isFinite(budget.epsilon) ||
			budget.epsilon <= 0 ||
			!Number.isFinite(budget.consumed) ||
			budget.consumed < 0 ||
			budget.consumed > budget.epsilon
		) {
			throw new Error('ANALYTICS_BUDGET_ROW_INVALID');
		}
		const identity = privacyBudgetIdentity(budget.userId, budget.windowStart, budget.metric);
		const identityRows = await ctx.db
			.query('privacyBudgets')
			.withIndex('by_budgetIdentity', (q) => q.eq('budgetIdentity', identity))
			.take(2);
		if (
			identityRows.length > 1 ||
			(identityRows[0] !== undefined && identityRows[0]._id !== budget._id)
		) {
			throw new Error('ANALYTICS_BUDGET_IDENTITY_DIVERGED');
		}
		const patch: Record<string, unknown> = { budgetIdentity: identity, updatedAt: Date.now() };
		if (!budget.userId && budget.metric === 'system' && budget.consumed > 0) {
			const date = canonicalDay(budget.windowStart, 'ANALYTICS_SYSTEM_BUDGET_DATE_INVALID');
			const run = await runForDate(ctx, date);
			if (!run || run.legacyAdopted !== true || run.status !== 'ready') {
				throw new Error('ANALYTICS_LEGACY_BUDGET_WITHOUT_SNAPSHOT_RUN');
			}
			if (budget.consumed !== SERVER_EPSILON) {
				throw new Error('ANALYTICS_LEGACY_BUDGET_SPEND_AMBIGUOUS');
			}
			if (budget.spendIdentity && budget.spendIdentity !== run.runIdentity) {
				throw new Error('ANALYTICS_BUDGET_SPEND_IDENTITY_DIVERGED');
			}
			patch.spendIdentity = run.runIdentity;
			patch.snapshotRunId = run._id;
			await ctx.db.patch(run._id, { budgetClaimed: true, updatedAt: Date.now() });
		}
		await ctx.db.patch(budget._id, patch);
		adoptedRows++;
	}

	if (page.isDone) {
		const missingBudget = await ctx.db
			.query('analyticsSnapshotRuns')
			.withIndex('by_legacyAdopted_budgetClaimed', (q) =>
				q.eq('legacyAdopted', true).eq('budgetClaimed', false)
			)
			.first();
		if (missingBudget) throw new Error('ANALYTICS_LEGACY_SNAPSHOT_BUDGET_MISSING');
	}

	const now = Date.now();
	await ctx.db.patch(migration._id, {
		status: page.isDone ? 'migrated' : 'running',
		phase: page.isDone ? 'complete' : 'budgets',
		cursor: page.isDone ? undefined : page.continueCursor,
		scannedRows: checkedAdd(
			migration.scannedRows,
			page.page.length,
			'ANALYTICS_MIGRATION_SCAN_OVERFLOW'
		),
		adoptedRows,
		completedAt: page.isDone ? now : undefined,
		updatedAt: now
	});
}

export const migrateSnapshotPlane = internalMutation({
	args: {
		runToken: v.optional(v.string()),
		retryBlocked: v.optional(v.boolean()),
		scheduleContinuation: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		let migration = await oneMigration(ctx);
		if (!migration) migration = await initializeMigration(ctx);
		if (args.runToken && args.runToken !== migration.runToken) {
			return { status: 'superseded' as const, runToken: migration.runToken };
		}
		if (migration.status === 'ready' || migration.status === 'migrated') {
			return { status: migration.status, runToken: migration.runToken, phase: migration.phase };
		}
		if (migration.status === 'blocked') {
			if (!args.retryBlocked) {
				return {
					status: 'blocked' as const,
					runToken: migration.runToken,
					failureCode: migration.failureCode ?? null
				};
			}
			await ctx.db.patch(migration._id, {
				status: 'running',
				failureCode: undefined,
				updatedAt: Date.now()
			});
			migration = (await ctx.db.get(migration._id))!;
		}

		try {
			if (migration.phase === 'snapshots') {
				await migrateSnapshotRowsPage(ctx, migration);
			} else if (migration.phase === 'aggregates') {
				await migrateAggregateRowsPage(ctx, migration);
			} else if (migration.phase === 'budgets') {
				await migrateBudgetRowsPage(ctx, migration);
			}
		} catch (error) {
			const failureCode = safeFailureCode(error);
			await ctx.db.patch(migration._id, {
				status: 'blocked',
				failureCode,
				updatedAt: Date.now()
			});
			return { status: 'blocked' as const, runToken: migration.runToken, failureCode };
		}

		const next = await ctx.db.get(migration._id);
		if (!next) throw new Error('ANALYTICS_SNAPSHOT_MIGRATION_MISSING');
		if (next.status === 'running' && args.scheduleContinuation !== false) {
			await ctx.scheduler.runAfter(0, continueSnapshotMigrationRef, {
				runToken: next.runToken,
				scheduleContinuation: true
			});
		}
		return {
			status: next.status,
			runToken: next.runToken,
			phase: next.phase,
			scannedRows: next.scannedRows,
			adoptedRows: next.adoptedRows
		};
	}
});

export const activateSnapshotPlane = internalMutation({
	args: {},
	handler: async (ctx) => {
		if (!ANALYTICS_CONTRIBUTION_AUTHORITY_READY) {
			throw new Error('ANALYTICS_CONTRIBUTION_AUTHORITY_NOT_READY');
		}
		const migration = await oneMigration(ctx);
		const [runningRun, blockedRun] = await Promise.all([
			ctx.db
				.query('analyticsSnapshotRuns')
				.withIndex('by_status_leaseExpiresAt', (q) => q.eq('status', 'running'))
				.first(),
			ctx.db
				.query('analyticsSnapshotRuns')
				.withIndex('by_status_leaseExpiresAt', (q) => q.eq('status', 'blocked'))
				.first()
		]);
		if (
			migration?.status !== 'migrated' ||
			migration.phase !== 'complete' ||
			migration.cursor !== undefined ||
			migration.failureCode !== undefined ||
			runningRun !== null ||
			blockedRun !== null
		) {
			throw new Error('ANALYTICS_SNAPSHOT_MIGRATION_INEXACT');
		}
		await ctx.db.patch(migration._id, { status: 'ready', updatedAt: Date.now() });
		return {
			status: 'ready' as const,
			scannedRows: migration.scannedRows,
			adoptedRows: migration.adoptedRows
		};
	}
});

export const snapshotPlaneStatus = internalQuery({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db
			.query('analyticsSnapshotMigrations')
			.withIndex('by_key', (q) => q.eq('key', ANALYTICS_SNAPSHOT_MIGRATION_KEY))
			.take(2);
		if (rows.length > 1) throw new Error('ANALYTICS_SNAPSHOT_MIGRATION_CARDINALITY_DIVERGED');
		const migration = rows[0];
		return migration
			? {
					status: migration.status,
					ready:
						ANALYTICS_CONTRIBUTION_AUTHORITY_READY &&
						migration.status === 'ready' &&
						migration.phase === 'complete',
					contributionAuthorityReady: ANALYTICS_CONTRIBUTION_AUTHORITY_READY,
					phase: migration.phase,
					runToken: migration.runToken,
					cursor: migration.cursor ?? null,
					scannedRows: migration.scannedRows,
					adoptedRows: migration.adoptedRows,
					legacyRunsAdopted: migration.legacyRunsAdopted,
					failureCode: migration.failureCode ?? null
				}
			: {
					status: 'not_started' as const,
					ready: false,
					contributionAuthorityReady: ANALYTICS_CONTRIBUTION_AUTHORITY_READY
				};
	}
});

// =============================================================================
// DAILY PER-DATE SNAPSHOT COORDINATOR
// =============================================================================

async function claimPrivacyBudgetForRun(
	ctx: MutationCtx,
	run: SnapshotRun
): Promise<{ claimedNow: boolean }> {
	const identity = privacyBudgetIdentity(undefined, run.snapshotDate, 'system');
	const rows = await ctx.db
		.query('privacyBudgets')
		.withIndex('by_budgetIdentity', (q) => q.eq('budgetIdentity', identity))
		.take(2);
	if (rows.length > 1) throw new Error('ANALYTICS_BUDGET_IDENTITY_DIVERGED');
	const existing = rows[0];
	const now = Date.now();
	if (existing) {
		if (existing.spendIdentity === run.runIdentity && existing.snapshotRunId === run._id) {
			if (existing.consumed !== SERVER_EPSILON) {
				throw new Error('ANALYTICS_BUDGET_REPLAY_VALUE_DIVERGED');
			}
			return { claimedNow: false };
		}
		if (existing.spendIdentity || existing.snapshotRunId || existing.consumed !== 0) {
			throw new Error('ANALYTICS_BUDGET_ALREADY_CLAIMED');
		}
		await ctx.db.patch(existing._id, {
			consumed: SERVER_EPSILON,
			spendIdentity: run.runIdentity,
			snapshotRunId: run._id,
			updatedAt: now
		});
		return { claimedNow: true };
	}
	await ctx.db.insert('privacyBudgets', {
		budgetIdentity: identity,
		spendIdentity: run.runIdentity,
		snapshotRunId: run._id,
		metric: 'system',
		epsilon: MAX_DAILY_EPSILON,
		consumed: SERVER_EPSILON,
		windowStart: run.snapshotDate,
		windowEnd: run.snapshotDate + DAY_MS,
		updatedAt: now
	});
	return { claimedNow: true };
}

async function scheduleRunContinuation(ctx: MutationCtx, run: SnapshotRun): Promise<void> {
	await ctx.scheduler.runAfter(0, continueSnapshotRunRef, {
		runId: run._id,
		runToken: run.runToken
	});
}

async function blockSnapshotRun(
	ctx: MutationCtx,
	run: SnapshotRun,
	error: unknown
): Promise<string> {
	const failureCode = safeFailureCode(error);
	await ctx.db.patch(run._id, {
		status: 'blocked',
		failureCode,
		leaseExpiresAt: Date.now(),
		updatedAt: Date.now()
	});
	return failureCode;
}

export const materializeSnapshot = internalMutation({
	args: { snapshotDate: v.optional(v.number()) },
	handler: async (ctx, args) => {
		try {
			await requireMigrationReady(ctx);
		} catch (error) {
			return {
				success: false,
				snapshotsCreated: 0,
				message: safeFailureCode(error)
			};
		}
		const now = Date.now();
		const today = Math.floor(now / DAY_MS) * DAY_MS;
		const date = canonicalDay(
			args.snapshotDate ?? today - DAY_MS,
			'ANALYTICS_SNAPSHOT_DATE_INVALID'
		);
		if (date >= today) {
			return {
				success: false,
				snapshotsCreated: 0,
				message: 'ANALYTICS_SNAPSHOT_DATE_NOT_CLOSED',
				snapshotDate: date
			};
		}
		const existing = await runForDate(ctx, date);
		if (existing) {
			if (existing.status === 'ready') {
				return {
					success: true,
					snapshotsCreated: existing.snapshotsCreated,
					aggregatesDeleted: existing.aggregatesDeleted,
					budgetSpent: existing.budgetClaimed ? SERVER_EPSILON : 0,
					snapshotDate: date,
					message: 'ANALYTICS_SNAPSHOT_ALREADY_READY'
				};
			}
			if (existing.status === 'blocked') {
				return {
					success: false,
					snapshotsCreated: existing.snapshotsCreated,
					snapshotDate: date,
					message: existing.failureCode ?? 'ANALYTICS_SNAPSHOT_RUN_BLOCKED'
				};
			}
			await scheduleRunContinuation(ctx, existing);
			return {
				success: true,
				snapshotsCreated: existing.snapshotsCreated,
				snapshotDate: date,
				message: 'ANALYTICS_SNAPSHOT_ALREADY_RUNNING'
			};
		}

		const noiseSeed = newNoiseSeed();
		const seedRows = await ctx.db
			.query('analyticsSnapshotRuns')
			.withIndex('by_noiseSeed', (q) => q.eq('noiseSeed', noiseSeed))
			.take(1);
		if (seedRows.length > 0) throw new Error('ANALYTICS_RUN_SEED_REUSE');
		const runToken = newRunToken();
		const runId = await ctx.db.insert('analyticsSnapshotRuns', {
			runIdentity: snapshotRunIdentity(date),
			snapshotDate: date,
			status: 'running',
			phase: 'materialize',
			runToken,
			noiseSeed,
			budgetClaimed: false,
			snapshotsCreated: 0,
			aggregatesDeleted: 0,
			scannedRows: 0,
			restarts: 0,
			leaseExpiresAt: now + RUN_LEASE_MS,
			startedAt: now,
			updatedAt: now
		});
		const run = await ctx.db.get(runId);
		if (!run) throw new Error('ANALYTICS_SNAPSHOT_RUN_INSERT_FAILED');
		await scheduleRunContinuation(ctx, run);
		return {
			success: true,
			snapshotsCreated: 0,
			snapshotDate: date,
			message: 'ANALYTICS_SNAPSHOT_SCHEDULED'
		};
	}
});

export const continueSnapshotRun = internalMutation({
	args: {
		runId: v.id('analyticsSnapshotRuns'),
		runToken: v.string()
	},
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (!run) return { status: 'missing' as const };
		if (run.runToken !== args.runToken) return { status: 'superseded' as const };
		if (run.status === 'ready') return { status: 'ready' as const, phase: run.phase };
		if (run.status === 'blocked') {
			return { status: 'blocked' as const, phase: run.phase, failureCode: run.failureCode ?? null };
		}

		try {
			await requireMigrationReady(ctx);
			if (run.phase === 'materialize') {
				const page = await ctx.db
					.query('analytics')
					.withIndex('by_recordType_date', (q) =>
						q.eq('recordType', 'aggregate').eq('date', run.snapshotDate)
					)
					.order('asc')
					.paginate({
						cursor: run.cursor ?? null,
						numItems: ANALYTICS_SNAPSHOT_PAGE_ROWS,
						maximumRowsRead: ANALYTICS_SNAPSHOT_PAGE_ROWS + 1,
						maximumBytesRead: ANALYTICS_SNAPSHOT_PAGE_BYTES
					});
				if (page.pageStatus === 'SplitRequired') {
					throw new Error('ANALYTICS_SNAPSHOT_SOURCE_PAGE_TOO_LARGE');
				}

				const noiseKey = await importNoiseKey(run.noiseSeed);
				const prepared: Array<{
					row: Doc<'analytics'>;
					canonical: CanonicalAnalyticsRow;
					noisyCount: number;
					existing: Doc<'analytics'> | null;
				}> = [];
				for (const row of page.page) {
					const canonical = canonicalAnalyticsRow(row);
					if (
						row.aggregateIdentity !== canonical.aggregateIdentity ||
						row.planeVersion !== ANALYTICS_PLANE_VERSION
					) {
						throw new Error('ANALYTICS_AGGREGATE_NOT_MIGRATED');
					}
					const snapshots = await ctx.db
						.query('analytics')
						.withIndex('by_snapshotIdentity', (q) =>
							q.eq('snapshotIdentity', canonical.snapshotIdentity)
						)
						.take(2);
					if (snapshots.length > 1) throw new Error('ANALYTICS_SNAPSHOT_IDENTITY_DIVERGED');
					const existing = snapshots[0] ?? null;
					if (
						existing &&
						(existing.recordType !== 'snapshot' ||
							existing.sourceAggregateId !== row._id ||
							existing.date !== run.snapshotDate)
					) {
						throw new Error('ANALYTICS_SNAPSHOT_SOURCE_DIVERGED');
					}
					prepared.push({
						row,
						canonical,
						noisyCount: await deterministicNoisyCount(
							row.count ?? -1,
							noiseKey,
							run.runIdentity,
							canonical.snapshotIdentity,
							SERVER_EPSILON
						),
						existing
					});
				}

				let budgetClaimed = run.budgetClaimed;
				if (prepared.length > 0 && !budgetClaimed) {
					await claimPrivacyBudgetForRun(ctx, run);
					budgetClaimed = true;
				}
				let inserted = 0;
				for (const item of prepared) {
					if (item.existing) {
						if (
							item.existing.noisyCount !== item.noisyCount ||
							(item.existing.noiseSeed !== undefined && item.existing.noiseSeed !== run.noiseSeed)
						) {
							throw new Error('ANALYTICS_SNAPSHOT_REPLAY_DIVERGED');
						}
						continue;
					}
					await ctx.db.insert('analytics', {
						recordType: 'snapshot',
						snapshotIdentity: item.canonical.snapshotIdentity,
						sourceAggregateId: item.row._id,
						planeVersion: ANALYTICS_PLANE_VERSION,
						date: run.snapshotDate,
						snapshotDate: run.snapshotDate,
						metric: item.canonical.metric,
						dimensionKey: item.canonical.dimensionKey,
						templateId: item.canonical.templateId,
						jurisdiction: item.canonical.jurisdiction,
						deliveryMethod: item.canonical.deliveryMethod,
						utmSource: item.canonical.utmSource,
						errorType: item.canonical.errorType,
						noisyCount: item.noisyCount,
						epsilon: SERVER_EPSILON,
						epsilonSpent: SERVER_EPSILON,
						updatedAt: Date.now()
					});
					inserted++;
				}

				await ctx.db.patch(run._id, {
					phase: page.isDone ? 'cleanup' : 'materialize',
					cursor: page.isDone ? undefined : page.continueCursor,
					budgetClaimed,
					snapshotsCreated: checkedAdd(
						run.snapshotsCreated,
						inserted,
						'ANALYTICS_SNAPSHOT_COUNT_OVERFLOW'
					),
					scannedRows: checkedAdd(
						run.scannedRows,
						page.page.length,
						'ANALYTICS_SNAPSHOT_SCAN_OVERFLOW'
					),
					leaseExpiresAt: Date.now() + RUN_LEASE_MS,
					updatedAt: Date.now()
				});
			} else if (run.phase === 'cleanup') {
				const page = await ctx.db
					.query('analytics')
					.withIndex('by_recordType_date', (q) =>
						q.eq('recordType', 'aggregate').eq('date', run.snapshotDate)
					)
					.order('asc')
					.paginate({
						cursor: run.cursor ?? null,
						numItems: ANALYTICS_SNAPSHOT_PAGE_ROWS,
						maximumRowsRead: ANALYTICS_SNAPSHOT_PAGE_ROWS + 1,
						maximumBytesRead: ANALYTICS_SNAPSHOT_PAGE_BYTES
					});
				if (page.pageStatus === 'SplitRequired') {
					throw new Error('ANALYTICS_CLEANUP_SOURCE_PAGE_TOO_LARGE');
				}
				for (const row of page.page) {
					const canonical = canonicalAnalyticsRow(row);
					const snapshots = await ctx.db
						.query('analytics')
						.withIndex('by_snapshotIdentity', (q) =>
							q.eq('snapshotIdentity', canonical.snapshotIdentity)
						)
						.take(2);
					if (
						snapshots.length !== 1 ||
						snapshots[0].sourceAggregateId !== row._id ||
						snapshots[0].recordType !== 'snapshot'
					) {
						throw new Error('ANALYTICS_CLEANUP_SNAPSHOT_EVIDENCE_MISSING');
					}
				}
				for (const row of page.page) await ctx.db.delete(row._id);
				const now = Date.now();
				await ctx.db.patch(run._id, {
					status: page.isDone ? 'ready' : 'running',
					phase: page.isDone ? 'complete' : 'cleanup',
					cursor: page.isDone ? undefined : page.continueCursor,
					aggregatesDeleted: checkedAdd(
						run.aggregatesDeleted,
						page.page.length,
						'ANALYTICS_CLEANUP_COUNT_OVERFLOW'
					),
					leaseExpiresAt: page.isDone ? now : now + RUN_LEASE_MS,
					completedAt: page.isDone ? now : undefined,
					updatedAt: now
				});
			} else {
				throw new Error('ANALYTICS_SNAPSHOT_RUN_PHASE_INVALID');
			}
		} catch (error) {
			const failureCode = await blockSnapshotRun(ctx, run, error);
			return { status: 'blocked' as const, phase: run.phase, failureCode };
		}

		const next = await ctx.db.get(run._id);
		if (!next) throw new Error('ANALYTICS_SNAPSHOT_RUN_MISSING');
		if (next.status === 'running') await scheduleRunContinuation(ctx, next);
		return {
			status: next.status,
			phase: next.phase,
			snapshotsCreated: next.snapshotsCreated,
			aggregatesDeleted: next.aggregatesDeleted
		};
	}
});

// =============================================================================
// SUPERVISION, OPERATOR RESUME, AND COMPLETE-ONLY READS
// =============================================================================

export const superviseSnapshotRuns = internalMutation({
	args: { cursor: v.optional(v.string()) },
	handler: async (ctx, args) => {
		if (args.cursor && args.cursor.length > 2_048) throw new Error('ANALYTICS_CURSOR_INVALID');
		try {
			await requireMigrationReady(ctx);
		} catch {
			return { status: 'plane_not_ready' as const, scanned: 0, restarted: 0, blocked: 0 };
		}
		const now = Date.now();
		const page = await ctx.db
			.query('analyticsSnapshotRuns')
			.withIndex('by_status_leaseExpiresAt', (q) =>
				q.eq('status', 'running').lte('leaseExpiresAt', now)
			)
			.paginate({
				cursor: args.cursor ?? null,
				numItems: ANALYTICS_SNAPSHOT_PAGE_ROWS,
				maximumRowsRead: ANALYTICS_SNAPSHOT_PAGE_ROWS + 1,
				maximumBytesRead: ANALYTICS_SNAPSHOT_PAGE_BYTES
			});
		if (page.pageStatus === 'SplitRequired') {
			throw new Error('ANALYTICS_SUPERVISOR_PAGE_TOO_LARGE');
		}
		let restarted = 0;
		let blocked = 0;
		for (const run of page.page) {
			if (run.restarts >= MAX_RUN_RESTARTS) {
				await ctx.db.patch(run._id, {
					status: 'blocked',
					failureCode: 'ANALYTICS_SNAPSHOT_RESTART_LIMIT_EXCEEDED',
					updatedAt: now
				});
				blocked++;
				continue;
			}
			await ctx.db.patch(run._id, {
				restarts: run.restarts + 1,
				leaseExpiresAt: now + RUN_LEASE_MS,
				updatedAt: now
			});
			await ctx.scheduler.runAfter(0, continueSnapshotRunRef, {
				runId: run._id,
				runToken: run.runToken
			});
			restarted++;
		}
		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, continueSnapshotSupervisorRef, {
				cursor: page.continueCursor
			});
		}
		return {
			status: page.isDone ? ('complete' as const) : ('running' as const),
			scanned: page.page.length,
			restarted,
			blocked
		};
	}
});

export const resumeBlockedSnapshotRun = internalMutation({
	args: { runId: v.id('analyticsSnapshotRuns') },
	handler: async (ctx, args) => {
		await requireMigrationReady(ctx);
		const run = await ctx.db.get(args.runId);
		if (!run) throw new Error('ANALYTICS_SNAPSHOT_RUN_MISSING');
		if (run.status !== 'blocked') throw new Error('ANALYTICS_SNAPSHOT_RUN_NOT_BLOCKED');
		const now = Date.now();
		await ctx.db.patch(run._id, {
			status: 'running',
			failureCode: undefined,
			restarts: 0,
			leaseExpiresAt: now + RUN_LEASE_MS,
			updatedAt: now
		});
		const next = await ctx.db.get(run._id);
		if (!next) throw new Error('ANALYTICS_SNAPSHOT_RUN_MISSING');
		await scheduleRunContinuation(ctx, next);
		return { status: 'running' as const, runToken: next.runToken, phase: next.phase };
	}
});

export const snapshotRunStatus = internalQuery({
	args: { snapshotDate: v.number() },
	handler: async (ctx, args) => {
		const date = canonicalDay(args.snapshotDate, 'ANALYTICS_SNAPSHOT_DATE_INVALID');
		const rows = await ctx.db
			.query('analyticsSnapshotRuns')
			.withIndex('by_snapshotDate', (q) => q.eq('snapshotDate', date))
			.take(2);
		if (rows.length > 1) throw new Error('ANALYTICS_SNAPSHOT_RUN_CARDINALITY_DIVERGED');
		const run = rows[0];
		return run
			? {
					status: run.status,
					phase: run.phase,
					runIdentity: run.runIdentity,
					budgetClaimed: run.budgetClaimed,
					snapshotsCreated: run.snapshotsCreated,
					aggregatesDeleted: run.aggregatesDeleted,
					scannedRows: run.scannedRows,
					restarts: run.restarts,
					failureCode: run.failureCode ?? null,
					updatedAt: run.updatedAt
				}
			: null;
	}
});

/** Snapshot rows are invisible until both the global plane and date run are ready. */
export const readSnapshotPage = internalQuery({
	args: {
		snapshotDate: v.number(),
		cursor: v.optional(v.string()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const migrationRows = await ctx.db
			.query('analyticsSnapshotMigrations')
			.withIndex('by_key', (q) => q.eq('key', ANALYTICS_SNAPSHOT_MIGRATION_KEY))
			.take(2);
		if (
			!ANALYTICS_CONTRIBUTION_AUTHORITY_READY ||
			migrationRows.length !== 1 ||
			migrationRows[0].status !== 'ready' ||
			migrationRows[0].phase !== 'complete'
		) {
			throw new Error('ANALYTICS_SNAPSHOT_PLANE_NOT_READY');
		}
		const date = canonicalDay(args.snapshotDate, 'ANALYTICS_SNAPSHOT_DATE_INVALID');
		const runs = await ctx.db
			.query('analyticsSnapshotRuns')
			.withIndex('by_snapshotDate', (q) => q.eq('snapshotDate', date))
			.take(2);
		if (runs.length !== 1 || runs[0].status !== 'ready' || runs[0].phase !== 'complete') {
			throw new Error('ANALYTICS_SNAPSHOT_DATE_NOT_READY');
		}
		if (args.cursor && args.cursor.length > 2_048) throw new Error('ANALYTICS_CURSOR_INVALID');
		const limit = Math.min(Math.max(Math.trunc(args.limit ?? 25), 1), 50);
		const page = await ctx.db
			.query('analytics')
			.withIndex('by_recordType_date', (q) => q.eq('recordType', 'snapshot').eq('date', date))
			.order('asc')
			.paginate({
				cursor: args.cursor ?? null,
				numItems: limit,
				maximumRowsRead: limit + 1,
				maximumBytesRead: ANALYTICS_SNAPSHOT_PAGE_BYTES
			});
		if (page.pageStatus === 'SplitRequired') throw new Error('ANALYTICS_SNAPSHOT_PAGE_TOO_LARGE');
		const publishedPage = page.page.map((row) => {
			const canonical = canonicalAnalyticsRow(row);
			if (
				row.recordType !== 'snapshot' ||
				row.snapshotIdentity !== canonical.snapshotIdentity ||
				row.planeVersion !== ANALYTICS_PLANE_VERSION
			) {
				throw new Error('ANALYTICS_SNAPSHOT_ROW_NOT_MIGRATED');
			}
			const noisyCount = nonnegativeSafeInteger(
				row.noisyCount,
				'ANALYTICS_SNAPSHOT_NOISY_COUNT_INVALID'
			);
			const epsilonSpent = row.epsilonSpent ?? row.epsilon;
			if (!Number.isFinite(epsilonSpent) || (epsilonSpent ?? 0) <= 0) {
				throw new Error('ANALYTICS_SNAPSHOT_EPSILON_INVALID');
			}
			// This is an intentionally narrow publication DTO. In particular it
			// excludes the secret noise seed (which would reveal the exact count),
			// source IDs, logical identities, plane metadata, and Convex row metadata.
			return {
				snapshotDate: date,
				metric: canonical.metric,
				noisyCount,
				epsilonSpent: epsilonSpent as number,
				...(canonical.templateId ? { templateId: canonical.templateId } : {}),
				...(canonical.jurisdiction ? { jurisdiction: canonical.jurisdiction } : {}),
				...(canonical.deliveryMethod ? { deliveryMethod: canonical.deliveryMethod } : {}),
				...(canonical.utmSource ? { utmSource: canonical.utmSource } : {}),
				...(canonical.errorType ? { errorType: canonical.errorType } : {})
			};
		});
		return {
			page: publishedPage,
			isDone: page.isDone,
			continueCursor: page.isDone ? null : page.continueCursor
		};
	}
});
