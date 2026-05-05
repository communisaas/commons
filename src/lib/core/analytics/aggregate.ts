import { applyLaplace } from './noise';
import {
	PRIVACY,
	type AggregateQuery,
	type AggregateResult,
	type Increment,
	type IncrementBatch,
	type Metric
} from '$lib/types/analytics';

type AggregateKey = string;

const aggregateCounts = new Map<AggregateKey, number>();
const contributionCounts = new Map<string, number>();

function dimensionKey(dimensions: Increment['dimensions'] = {}): string {
	return JSON.stringify({
		template_id: dimensions.template_id ?? null,
		jurisdiction: dimensions.jurisdiction ?? null,
		delivery_method: dimensions.delivery_method ?? null,
		utm_source: dimensions.utm_source ?? null,
		error_type: dimensions.error_type ?? null
	});
}

function aggregateKey(metric: Metric, dimensions: Increment['dimensions'] = {}): AggregateKey {
	return `${getTodayUTC().toISOString()}:${metric}:${dimensionKey(dimensions)}`;
}

export function toMidnightUTC(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function getTodayUTC(): Date {
	return toMidnightUTC(new Date());
}

export function getDaysAgoUTC(days: number): Date {
	const date = getTodayUTC();
	date.setUTCDate(date.getUTCDate() - days);
	return date;
}

export function checkContributionLimit(identifier: string, metric: Metric): boolean {
	const key = `${getTodayUTC().toISOString()}:${identifier}:${metric}`;
	const count = contributionCounts.get(key) ?? 0;
	if (count >= PRIVACY.MAX_DAILY_CONTRIBUTIONS) return false;
	contributionCounts.set(key, count + 1);
	return true;
}

export function clearRateLimitsForTesting(): void {
	contributionCounts.clear();
}

export async function incrementAggregate(increment: Increment): Promise<void> {
	const key = aggregateKey(increment.metric, increment.dimensions);
	aggregateCounts.set(key, (aggregateCounts.get(key) ?? 0) + 1);
}

export async function processBatch(
	batch: IncrementBatch
): Promise<{ success: boolean; processed: number; dropped: number }> {
	for (const increment of batch.increments) {
		await incrementAggregate(increment);
	}
	return { success: true, processed: batch.increments.length, dropped: 0 };
}

export async function queryAggregates(query: AggregateQuery): Promise<AggregateResult[]> {
	const results: AggregateResult[] = [];
	const prefix = `${getTodayUTC().toISOString()}:${query.metric}:`;

	for (const [key, count] of aggregateCounts) {
		if (!key.startsWith(prefix)) continue;
		results.push({
			dimensions: {},
			count: applyLaplace(count),
			coarsened: false
		});
	}

	return results;
}

export async function getHealthMetrics(): Promise<Record<string, never>> {
	return {};
}
