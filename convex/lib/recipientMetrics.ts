import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { bumpPublicTemplatePageArtifactAggregateRevision } from './publicTemplateDiscoverySource';

export const RECIPIENT_METRICS_VERSION = 1;
export const RECIPIENT_METRICS_MIGRATION_KEY = 'v1' as const;
export const RECIPIENT_METRICS_TOP_DISTRICT_LIMIT = 20;
export const RECIPIENT_METRICS_PRIVACY_FLOOR = 5;
export const PUBLIC_RECIPIENT_PAGE_METRICS_BATCH_MAX = 4;

const MAX_DISTRICT_KEY_BYTES = 200;
const encoder = new TextEncoder();

export type MessageDistrictMetric = {
	districtHash: string;
	count: number;
};

export type PositionDistrictMetric = {
	districtCode: string;
	support: number;
	oppose: number;
};

export type RecipientTemplateMetricSummary = {
	messageDeliveredCount: number;
	messageVisibleDistrictCount: number;
	messageTopDistricts: MessageDistrictMetric[];
	positionCount: number;
	positionSupport: number;
	positionOppose: number;
	positionDistrictCount: number;
	positionTopDistricts: PositionDistrictMetric[];
};

const EMPTY_SUMMARY: RecipientTemplateMetricSummary = {
	messageDeliveredCount: 0,
	messageVisibleDistrictCount: 0,
	messageTopDistricts: [],
	positionCount: 0,
	positionSupport: 0,
	positionOppose: 0,
	positionDistrictCount: 0,
	positionTopDistricts: []
};

function normalizeDistrictKey(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const normalized = value.trim();
	if (normalized.length === 0 || encoder.encode(normalized).byteLength > MAX_DISTRICT_KEY_BYTES) {
		return undefined;
	}
	return normalized;
}

export function assertPositionDistrictCode(value: string | undefined): string | undefined {
	const normalized = normalizeDistrictKey(value);
	if (value !== undefined && normalized === undefined) {
		throw new Error('POSITION_DISTRICT_CODE_INVALID');
	}
	return normalized;
}

function messageTopDistricts(
	existing: MessageDistrictMetric[],
	candidate: MessageDistrictMetric
): MessageDistrictMetric[] {
	const byDistrict = new Map(existing.map((entry) => [entry.districtHash, entry]));
	byDistrict.set(candidate.districtHash, candidate);
	return [...byDistrict.values()]
		.sort((a, b) => b.count - a.count || a.districtHash.localeCompare(b.districtHash))
		.slice(0, RECIPIENT_METRICS_TOP_DISTRICT_LIMIT);
}

function positionMetricTotal(metric: PositionDistrictMetric): number {
	return metric.support + metric.oppose;
}

function positionTopDistricts(
	existing: PositionDistrictMetric[],
	candidate: PositionDistrictMetric
): PositionDistrictMetric[] {
	const byDistrict = new Map(existing.map((entry) => [entry.districtCode, entry]));
	byDistrict.set(candidate.districtCode, candidate);
	return [...byDistrict.values()]
		.sort(
			(a, b) =>
				positionMetricTotal(b) - positionMetricTotal(a) ||
				a.districtCode.localeCompare(b.districtCode)
		)
		.slice(0, RECIPIENT_METRICS_TOP_DISTRICT_LIMIT);
}

async function metricSummary(ctx: QueryCtx | MutationCtx, templateId: Id<'templates'>) {
	return await ctx.db
		.query('templateRecipientMetrics')
		.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
		.unique();
}

function summaryValue(
	row: Awaited<ReturnType<typeof metricSummary>>
): RecipientTemplateMetricSummary {
	if (!row) return EMPTY_SUMMARY;
	return {
		messageDeliveredCount: row.messageDeliveredCount,
		messageVisibleDistrictCount: row.messageVisibleDistrictCount,
		messageTopDistricts: row.messageTopDistricts,
		positionCount: row.positionCount,
		positionSupport: row.positionSupport,
		positionOppose: row.positionOppose,
		positionDistrictCount: row.positionDistrictCount,
		positionTopDistricts: row.positionTopDistricts
	};
}

async function persistSummary(
	ctx: MutationCtx,
	templateId: Id<'templates'>,
	existing: Awaited<ReturnType<typeof metricSummary>>,
	summary: RecipientTemplateMetricSummary
): Promise<void> {
	const value = {
		templateId,
		version: RECIPIENT_METRICS_VERSION,
		...summary,
		updatedAt: Date.now()
	};
	if (existing) await ctx.db.patch(existing._id, value);
	else await ctx.db.insert('templateRecipientMetrics', value);
}

/**
 * Apply one immutable position registration to the compact metrics plane.
 * The raw registration marker and this update must be written in the same
 * Convex transaction so the legacy migration can skip new rows idempotently.
 */
export async function applyPositionRegistrationMetric(
	ctx: MutationCtx,
	args: {
		templateId: Id<'templates'>;
		stance: string;
		districtCode?: string;
	}
): Promise<void> {
	const districtCode = normalizeDistrictKey(args.districtCode);
	const existingSummary = await metricSummary(ctx, args.templateId);
	const current = summaryValue(existingSummary);
	let positionDistrictCount = current.positionDistrictCount;
	let retainedDistricts = current.positionTopDistricts;

	if (districtCode !== undefined) {
		const existingDistrict = await ctx.db
			.query('templatePositionDistrictMetrics')
			.withIndex('by_templateId_districtCode', (q) =>
				q.eq('templateId', args.templateId).eq('districtCode', districtCode)
			)
			.unique();
		const candidate = {
			districtCode,
			support: (existingDistrict?.support ?? 0) + (args.stance === 'support' ? 1 : 0),
			oppose: (existingDistrict?.oppose ?? 0) + (args.stance === 'oppose' ? 1 : 0)
		};
		const districtValue = {
			templateId: args.templateId,
			...candidate,
			updatedAt: Date.now()
		};
		if (existingDistrict) await ctx.db.patch(existingDistrict._id, districtValue);
		else {
			await ctx.db.insert('templatePositionDistrictMetrics', districtValue);
			positionDistrictCount += 1;
		}
		retainedDistricts = positionTopDistricts(retainedDistricts, candidate);
	}

	await persistSummary(ctx, args.templateId, existingSummary, {
		...current,
		positionCount: current.positionCount + 1,
		positionSupport: current.positionSupport + (args.stance === 'support' ? 1 : 0),
		positionOppose: current.positionOppose + (args.stance === 'oppose' ? 1 : 0),
		positionDistrictCount,
		positionTopDistricts: retainedDistricts
	});
	await bumpPublicTemplatePageArtifactAggregateRevision(ctx, args.templateId);
}

/** Apply one delivered legacy message to the compact metrics plane. */
export async function applyDeliveredMessageMetric(
	ctx: MutationCtx,
	args: { templateId: Id<'templates'>; districtHash: string }
): Promise<void> {
	const districtHash = normalizeDistrictKey(args.districtHash);
	if (districtHash === undefined) return;

	const existingSummary = await metricSummary(ctx, args.templateId);
	const current = summaryValue(existingSummary);
	const existingDistrict = await ctx.db
		.query('templateMessageDistrictMetrics')
		.withIndex('by_templateId_districtHash', (q) =>
			q.eq('templateId', args.templateId).eq('districtHash', districtHash)
		)
		.unique();
	const previousCount = existingDistrict?.deliveredCount ?? 0;
	const deliveredCount = previousCount + 1;
	const districtValue = {
		templateId: args.templateId,
		districtHash,
		deliveredCount,
		updatedAt: Date.now()
	};
	if (existingDistrict) await ctx.db.patch(existingDistrict._id, districtValue);
	else await ctx.db.insert('templateMessageDistrictMetrics', districtValue);

	await persistSummary(ctx, args.templateId, existingSummary, {
		...current,
		messageDeliveredCount: current.messageDeliveredCount + 1,
		messageVisibleDistrictCount:
			current.messageVisibleDistrictCount +
			(previousCount === RECIPIENT_METRICS_PRIVACY_FLOOR - 1 ? 1 : 0),
		messageTopDistricts: messageTopDistricts(current.messageTopDistricts, {
			districtHash,
			count: deliveredCount
		})
	});
	await bumpPublicTemplatePageArtifactAggregateRevision(ctx, args.templateId);
}

export type PublicRecipientPageMetrics = {
	messageMetrics: {
		districtCounts: Record<string, number>;
		totalDistricts: number;
	};
	positionMetrics: {
		counts: { support: number | null; oppose: number | null; districts: number | null };
		engagement: {
			template_id: string;
			districts: Array<{
				district_code: string;
				support: number;
				oppose: number;
				total: number;
				support_percent: number;
			}>;
			aggregate: {
				total_districts: number | null;
				total_positions: number | null;
				total_support: number | null;
				total_oppose: number | null;
			};
		} | null;
	};
};

function publicRecipientPageMetrics(
	templateId: Id<'templates'>,
	row: Awaited<ReturnType<typeof metricSummary>>
): PublicRecipientPageMetrics {
	const summary = summaryValue(row);
	const messageDistricts = summary.messageTopDistricts.filter(
		(entry) => entry.count >= RECIPIENT_METRICS_PRIVACY_FLOOR
	);
	const positionDistricts = summary.positionTopDistricts
		.filter((entry) => positionMetricTotal(entry) >= RECIPIENT_METRICS_PRIVACY_FLOOR)
		.sort(
			(a, b) =>
				positionMetricTotal(b) - positionMetricTotal(a) ||
				a.districtCode.localeCompare(b.districtCode)
		)
		.map((entry) => {
			const total = positionMetricTotal(entry);
			return {
				district_code: entry.districtCode,
				support: entry.support,
				oppose: entry.oppose,
				total,
				support_percent: total > 0 ? Math.round((entry.support / total) * 100) : 0
			};
		});
	const counts = {
		support:
			summary.positionSupport < RECIPIENT_METRICS_PRIVACY_FLOOR ? null : summary.positionSupport,
		oppose:
			summary.positionOppose < RECIPIENT_METRICS_PRIVACY_FLOOR ? null : summary.positionOppose,
		districts: summary.positionDistrictCount < 3 ? null : summary.positionDistrictCount
	};
	return {
		messageMetrics: {
			districtCounts: Object.fromEntries(
				messageDistricts.map((entry) => [entry.districtHash, entry.count])
			),
			totalDistricts: summary.messageVisibleDistrictCount
		},
		positionMetrics: {
			counts,
			engagement:
				summary.positionCount === 0
					? null
					: {
							template_id: String(templateId),
							districts: positionDistricts,
							aggregate: {
								total_districts: counts.districts,
								total_positions:
									summary.positionCount < RECIPIENT_METRICS_PRIVACY_FLOOR
										? null
										: summary.positionCount,
								total_support: counts.support,
								total_oppose: counts.oppose
							}
						}
		}
	};
}

/**
 * Producer-only batch input for immutable anonymous page artifacts. One
 * readiness singleton plus one exact compact summary per template replaces
 * six independent page-origin queries. The hard batch cap is shared with the
 * inventory protocol so a caller cannot turn this helper into a broad scan.
 */
export async function readPublicRecipientPageMetricsBatch(
	ctx: QueryCtx,
	templateIds: readonly Id<'templates'>[]
): Promise<PublicRecipientPageMetrics[]> {
	if (templateIds.length > PUBLIC_RECIPIENT_PAGE_METRICS_BATCH_MAX) {
		throw new Error('PUBLIC_RECIPIENT_PAGE_METRICS_BATCH_TOO_LARGE');
	}
	await requireRecipientMetricsReady(ctx);
	const rows = await Promise.all(templateIds.map((templateId) => metricSummary(ctx, templateId)));
	return rows.map((row, index) => publicRecipientPageMetrics(templateIds[index]!, row));
}

export async function requireRecipientMetricsReady(ctx: QueryCtx): Promise<void> {
	const migration = await ctx.db
		.query('recipientMetricsMigrations')
		.withIndex('by_key', (q) => q.eq('key', RECIPIENT_METRICS_MIGRATION_KEY))
		.unique();
	if (migration?.status !== 'ready') {
		throw new Error('RECIPIENT_METRICS_NOT_READY');
	}
}

/**
 * New raw writes are allowed during a live migration because they dual-write
 * and carry their marker. Missing/blocked state means a destructive clear or
 * failed cutover owns the plane, so fail before inserting another raw row.
 */
export async function requireRecipientMetricsWritable(ctx: MutationCtx): Promise<void> {
	const migration = await ctx.db
		.query('recipientMetricsMigrations')
		.withIndex('by_key', (q) => q.eq('key', RECIPIENT_METRICS_MIGRATION_KEY))
		.unique();
	if (!migration || migration.status === 'blocked') {
		throw new Error('RECIPIENT_METRICS_WRITES_NOT_READY');
	}
}

export async function readMessageDistrictMetrics(
	ctx: QueryCtx,
	args: { templateId: Id<'templates'>; viewerDistrictHash?: string }
) {
	await requireRecipientMetricsReady(ctx);
	const viewerDistrictHash = normalizeDistrictKey(args.viewerDistrictHash);
	const [row, viewerDistrict] = await Promise.all([
		metricSummary(ctx, args.templateId),
		viewerDistrictHash === undefined
			? null
			: ctx.db
					.query('templateMessageDistrictMetrics')
					.withIndex('by_templateId_districtHash', (q) =>
						q.eq('templateId', args.templateId).eq('districtHash', viewerDistrictHash)
					)
					.unique()
	]);
	const summary = summaryValue(row);
	const districts = new Map(
		summary.messageTopDistricts
			.filter((entry) => entry.count >= RECIPIENT_METRICS_PRIVACY_FLOOR)
			.map((entry) => [entry.districtHash, entry.count])
	);
	if (viewerDistrict && viewerDistrict.deliveredCount >= RECIPIENT_METRICS_PRIVACY_FLOOR) {
		districts.set(viewerDistrict.districtHash, viewerDistrict.deliveredCount);
	}
	return {
		districtCounts: Object.fromEntries(districts),
		totalDistricts: summary.messageVisibleDistrictCount,
		viewerDistrictCount:
			viewerDistrict && viewerDistrict.deliveredCount >= RECIPIENT_METRICS_PRIVACY_FLOOR
				? viewerDistrict.deliveredCount
				: 0
	};
}

export async function readPositionMetrics(
	ctx: QueryCtx,
	args: { templateId: Id<'templates'>; viewerDistrictCode?: string }
) {
	await requireRecipientMetricsReady(ctx);
	const viewerDistrictCode = normalizeDistrictKey(args.viewerDistrictCode);
	const [row, viewerDistrict] = await Promise.all([
		metricSummary(ctx, args.templateId),
		viewerDistrictCode === undefined
			? null
			: ctx.db
					.query('templatePositionDistrictMetrics')
					.withIndex('by_templateId_districtCode', (q) =>
						q.eq('templateId', args.templateId).eq('districtCode', viewerDistrictCode)
					)
					.unique()
	]);
	const summary = summaryValue(row);
	const districtsByCode = new Map(
		summary.positionTopDistricts.map((entry) => [entry.districtCode, entry])
	);
	if (viewerDistrict) {
		districtsByCode.set(viewerDistrict.districtCode, {
			districtCode: viewerDistrict.districtCode,
			support: viewerDistrict.support,
			oppose: viewerDistrict.oppose
		});
	}
	const districts = [...districtsByCode.values()]
		.filter((entry) => positionMetricTotal(entry) >= RECIPIENT_METRICS_PRIVACY_FLOOR)
		.sort(
			(a, b) =>
				positionMetricTotal(b) - positionMetricTotal(a) ||
				a.districtCode.localeCompare(b.districtCode)
		)
		.map((entry) => {
			const total = positionMetricTotal(entry);
			return {
				district_code: entry.districtCode,
				support: entry.support,
				oppose: entry.oppose,
				total,
				support_percent: total > 0 ? Math.round((entry.support / total) * 100) : 0,
				is_user_district: entry.districtCode === viewerDistrictCode
			};
		});

	return {
		hasPositions: summary.positionCount > 0,
		counts: {
			support:
				summary.positionSupport < RECIPIENT_METRICS_PRIVACY_FLOOR ? null : summary.positionSupport,
			oppose:
				summary.positionOppose < RECIPIENT_METRICS_PRIVACY_FLOOR ? null : summary.positionOppose,
			districts: summary.positionDistrictCount < 3 ? null : summary.positionDistrictCount
		},
		engagement: {
			template_id: args.templateId,
			districts,
			aggregate: {
				total_districts: summary.positionDistrictCount < 3 ? null : summary.positionDistrictCount,
				total_positions:
					summary.positionCount < RECIPIENT_METRICS_PRIVACY_FLOOR ? null : summary.positionCount,
				total_support:
					summary.positionSupport < RECIPIENT_METRICS_PRIVACY_FLOOR
						? null
						: summary.positionSupport,
				total_oppose:
					summary.positionOppose < RECIPIENT_METRICS_PRIVACY_FLOOR ? null : summary.positionOppose
			}
		}
	};
}
