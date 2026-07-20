/**
 * Sub-K suppression floors on every public/cross-org aggregate surface.
 *
 * The privacy policy floors counts at 5 (districts at 3): a count of 1-4
 * identifies a small group, so it suppresses to null before leaving the
 * Convex layer. Three surfaces carry the floors — the public receipt
 * verifier, public campaign stats, and coalition aggregates — and none of
 * the floor closures is exported, so these pins are the only regression
 * guard. Source-level pins on short stable expressions, not prose.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCoalitionPressure, readCoalitionStats } from '../../../convex/lib/coalitionMetrics';

function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const verify = source('convex/verify.ts');
const campaigns = source('convex/campaigns.ts');
const networks = source('convex/networks.ts');
const coalitionMetrics = source('convex/lib/coalitionMetrics.ts');

function coalitionCtx(aggregate: Record<string, unknown>, pressureRows: unknown[] = []) {
	const migration = {
		status: 'ready',
		phase: 'complete',
		scannedSupporters: 0,
		projectedSupporters: 0,
		scannedActions: 0,
		projectedActions: 0,
		scannedReceipts: 0,
		projectedReceipts: 0,
		networksScheduled: 0,
		networksReady: 0
	};
	return {
		db: {
			query(table: string) {
				if (table === 'coalitionMetricsMigrations') {
					return { withIndex: () => ({ unique: async () => migration }) };
				}
				if (table === 'coalitionNetworkAggregates') {
					return { withIndex: () => ({ unique: async () => aggregate }) };
				}
				if (table === 'coalitionNetworkPressureRows') {
					return {
						withIndex: () => ({ order: () => ({ take: async () => pressureRows }) })
					};
				}
				throw new Error(`Unexpected table: ${table}`);
			}
		}
	} as never;
}

describe('public receipt verifier (convex/verify.ts)', () => {
	it('defines the 5/3 floors and applies them to receipt counts', () => {
		expect(verify).toContain('kFloor5 = (n: number): number | null => (n < 5 ? null : n)');
		expect(verify).toContain('kFloor3 = (n: number): number | null => (n < 3 ? null : n)');
		expect(verify).toContain('verifiedCount: kFloor5(');
		expect(verify).toContain('districtCount: kFloor3(');
	});
});

describe('public campaign stats (convex/campaigns.ts)', () => {
	it('defines the 5/3 floors and applies them to action and district counts', () => {
		expect(campaigns).toContain('kFloor5 = (n: number): number | null => (n < 5 ? null : n)');
		expect(campaigns).toContain('kFloor3 = (n: number): number | null => (n < 3 ? null : n)');
		expect(campaigns).toContain('verifiedActions: kFloor5(');
		expect(campaigns).toContain('uniqueDistricts: kFloor3(');
	});
});

describe('coalition aggregates (convex/networks.ts)', () => {
	it('floors suppress 1-4 (districts 1-2) while honest zero passes through', () => {
		expect(networks).toContain('readCoalitionStats(ctx, networkId)');
		expect(networks).toContain('readCoalitionPressure(ctx, networkId, limit ?? 12)');
		expect(coalitionMetrics).toContain('return value > 0 && value < 5 ? null : value;');
		expect(coalitionMetrics).toContain('return value > 0 && value < 3 ? null : value;');
	});

	it('applies the floors to every person-derived stat', () => {
		for (const field of [
			'totalSupporters: floor5(',
			'uniqueSupporters: floor5(',
			'verifiedSupporters: floor5(',
			'totalCampaignActions: floor5(',
			'verifiedCampaignActions: floor5(',
			'districtCount: floor3(',
			'verifiedActionEvidence: floor5(',
			'districtSignalCount: floor3('
		]) {
			expect(coalitionMetrics).toContain(field);
		}
	});

	it('suppresses sub-5 entries from the state distribution', () => {
		expect(coalitionMetrics).toContain(
			'if (bucket.count >= 5) stateDistribution[bucket.code] = bucket.count;'
		);
	});

	it('enforces the floors at the coalition stats read boundary', async () => {
		const stats = await readCoalitionStats(
			coalitionCtx({
				activeGeneration: 1,
				status: 'ready',
				memberCount: 2,
				totalSupporters: 4,
				uniqueSupporters: 0,
				verifiedSupporters: 1,
				totalCampaignActions: 5,
				verifiedCampaignActions: 6,
				stateDistribution: [
					{ code: 'CA', count: 4 },
					{ code: 'NY', count: 5 }
				],
				stateDistributionOtherCount: 0,
				districtCount: 2,
				revision: 1,
				updatedAt: 100
			}),
			'network-1' as never
		);

		expect(stats).toMatchObject({
			totalSupporters: null,
			uniqueSupporters: 0,
			verifiedSupporters: null,
			totalCampaignActions: 5,
			verifiedCampaignActions: 6,
			districtCount: null,
			stateDistribution: { NY: 5 }
		});
	});

	it('enforces the 5/3 floors on pressure evidence while preserving zero', async () => {
		const aggregate = { activeGeneration: 1, status: 'ready' };
		const base = {
			decisionMakerId: 'dm-1',
			dmName: 'Representative',
			orgCount: 2,
			combinedProofWeight: 7,
			receiptCount: 1,
			bills: [],
			latestReceiptAt: 100
		};
		const rows = await readCoalitionPressure(
			coalitionCtx(aggregate, [
				{ ...base, verifiedActionEvidence: 4, districtSignalCount: 2 },
				{
					...base,
					decisionMakerId: 'dm-2',
					verifiedActionEvidence: 0,
					districtSignalCount: 0
				}
			]),
			'network-1' as never,
			12
		);

		expect(rows[0]).toMatchObject({ verifiedActionEvidence: null, districtSignalCount: null });
		expect(rows[1]).toMatchObject({ verifiedActionEvidence: 0, districtSignalCount: 0 });
	});
});
