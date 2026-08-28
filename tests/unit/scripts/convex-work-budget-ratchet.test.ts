import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
	calculateConvexWorkBudgetLaunchEnvelope,
	scanConvexServerWorkBudget,
	validateConvexWorkBudgetPolicy
} from '../../../scripts/check-convex-server-work-budget.mjs';

const basePolicy = {
	protocol: '4',
	coordinatorGeneration: 'v4',
	teamAuthorityId: 'shared-convex-quota-01',
	realms: {
		production: 'quirky-chinchilla-352.convex.cloud',
		preview: 'outstanding-firefly-831.convex.cloud'
	},
	unitBytes: 1024,
	caps: { dailyUnits: 327_680, monthlyUnits: 524_288 },
	cloudflareEnvelope: {
		workerDailyRequestFreeLimit: 100_000,
		durableObjectDailyRequestFreeLimit: 100_000,
		sqliteDailyRowsReadFreeLimit: 5_000_000,
		sqliteRowsWrittenPerAdmission: 2,
		sqliteDailyRowsWrittenFreeLimit: 100_000
	},
	launchEnvelope: {
		ordinaryManifestRefreshGateWindowMinutes: 5,
		continuationGateWindowMinutes: 2,
		manifestCronPollSeconds: 60,
		manifestCronHttpTimeoutSeconds: 10,
		manifestSchedulerJitterBudgetSeconds: 30,
		manifestAuthoritySurvivalReserveSeconds: 20,
		manifestAuthorityFreshnessSeconds: 540,
		maximumCalendarMonthDays: 31,
		maximumCleanBackfillAttemptsPerRelease: 16,
		maximumMaterializationReplayAttemptsPerRelease: 3,
		maximumOrdinaryManifestRefreshCallsPerDayPerRealm: 288,
		maximumDeploymentHealthChecksPerRelease: 2,
		maximumReleaseEnvelopesPerTeamMonth: 1,
		recurringHealthChecksPerDayPerRealm: 0,
		softLaunchDailyUnitsPerRealm: 512
	},
	classes: { control: 8, point: 64 },
	operations: { 'example:get': { class: 'point', kind: 'query' } }
};

describe('Convex server work-budget AST ratchet', () => {
	it('pins the reviewed launch caps and highest-risk operation envelopes', () => {
		const policy = JSON.parse(readFileSync('config/convex-work-budget-policy.json', 'utf8'));
		expect(policy).toMatchObject({
			protocol: '4',
			coordinatorGeneration: 'v4',
			teamAuthorityId: 'shared-convex-quota-01',
			realms: {
				production: 'quirky-chinchilla-352.convex.cloud',
				preview: 'outstanding-firefly-831.convex.cloud'
			},
			unitBytes: 1024,
			caps: { dailyUnits: 327_680, monthlyUnits: 524_288 },
			cloudflareEnvelope: {
				workerDailyRequestFreeLimit: 100_000,
				durableObjectDailyRequestFreeLimit: 100_000,
				sqliteDailyRowsReadFreeLimit: 5_000_000,
				sqliteRowsWrittenPerAdmission: 2,
				sqliteDailyRowsWrittenFreeLimit: 100_000
			},
			classes: { auth: 16, collection: 1024, control: 8, maximum: 4096 },
			launchEnvelope: {
				ordinaryManifestRefreshGateWindowMinutes: 5,
				continuationGateWindowMinutes: 2,
				manifestCronPollSeconds: 60,
				manifestCronHttpTimeoutSeconds: 10,
				manifestSchedulerJitterBudgetSeconds: 30,
				manifestAuthoritySurvivalReserveSeconds: 20,
				manifestAuthorityFreshnessSeconds: 540,
				maximumCalendarMonthDays: 31,
				maximumCleanBackfillAttemptsPerRelease: 16,
				maximumMaterializationReplayAttemptsPerRelease: 3,
				maximumOrdinaryManifestRefreshCallsPerDayPerRealm: 288,
				maximumDeploymentHealthChecksPerRelease: 2,
				maximumReleaseEnvelopesPerTeamMonth: 1,
				recurringHealthChecksPerDayPerRealm: 0,
				softLaunchDailyUnitsPerRealm: 512
			}
		});
		expect(policy.operations['templates:publicDiscoveryManifest']).toEqual({
			kind: 'query',
			class: 'control'
		});
		expect(policy.operations['sessionAuthority:get']).toEqual({ kind: 'query', class: 'auth' });
		expect(policy.operations['templates:publicTemplatePageArtifactsByCoordinates']).toEqual({
			kind: 'query',
			class: 'maximum'
		});
		expect(policy.operations['donations:processCheckout']).toEqual({
			kind: 'action',
			class: 'maximum'
		});
		expect(policy.caps.dailyUnits / policy.classes.maximum).toBe(80);
		expect(policy.caps.monthlyUnits / policy.classes.auth).toBe(32_768);
		expect(policy.caps.monthlyUnits * policy.unitBytes).toBe(512 * 1024 * 1024);
	});

	it('admits one release, two five-minute realm heartbeats, minute polling, two health probes, and soft launch', () => {
		const policy = JSON.parse(readFileSync('config/convex-work-budget-policy.json', 'utf8'));
		const envelope = calculateConvexWorkBudgetLaunchEnvelope(policy);

		expect(policy.operations['templates:publicDiscoveryList'].class).toBe('collection');
		expect(policy.operations['templates:publicDiscoveryRelations'].class).toBe('collection');
		expect(envelope).toMatchObject({
			cleanBackfillUnits: 270_464,
			deploymentHealthUnits: 2_048,
			dailyManifestUnits: 4_608,
			dailyManifestUnitsPerRealm: 2_304,
			dailyRemainingUnits: 360,
			dailySoftLaunchUnits: 1_024,
			dailyWorstCaseUnits: 327_320,
			manifestUnits: 8,
			maximumContinuationAdmissionsPerRealmDay: 18,
			maximumDailyAdmissions: 40_960,
			maximumDailySqliteRowsWritten: 81_920,
			maximumEndpointAttemptsPerRelease: 19,
			monthlyManifestUnits: 142_848,
			monthlyRemainingUnits: 28_008,
			monthlySoftLaunchUnits: 31_744,
			monthlyWorstCaseUnits: 496_280,
			releaseEnvelopeUnits: 319_640,
			replayUnits: 49_176,
			scheduledManifestAcceptedRefreshesPerDay: 576,
			scheduledManifestCoalescedPollsPerDay: 2_304,
			scheduledManifestCronInvocationsPerDay: 1_440,
			scheduledManifestDurableObjectRequestsPerDay: 3_456,
			scheduledManifestEndpointPollsPerDay: 2_880,
			scheduledManifestSqliteRowsReadPerDay: 9_792,
			scheduledManifestSqliteRowsWrittenPerDay: 2_880,
			scheduledManifestWorkerRequestsPerDay: 4_320
		});
		expect(envelope.dailyWorstCaseUnits).toBeLessThanOrEqual(policy.caps.dailyUnits);
		expect(envelope.monthlyWorstCaseUnits).toBeLessThanOrEqual(policy.caps.monthlyUnits);
		expect(envelope.maximumDailySqliteRowsWritten).toBeLessThanOrEqual(
			policy.cloudflareEnvelope.sqliteDailyRowsWrittenFreeLimit
		);
	});

	it('rejects raw and mixed server-helper imports', () => {
		const scan = scanConvexServerWorkBudget({
			files: []
		});
		scan.errors.push('src/example.ts imports raw serverQuery; use wrapper.');
		expect(validateConvexWorkBudgetPolicy({ ...basePolicy, operations: {} }, scan)).toContain(
			'src/example.ts imports raw serverQuery; use wrapper.'
		);
	});

	it('rejects missing, stale, kind-drifted, and cap-drifted policy entries', () => {
		const scan = { errors: [], operations: new Map([['example:get', 'query']]) };
		expect(validateConvexWorkBudgetPolicy(basePolicy, scan as never)).toEqual([]);
		expect(
			validateConvexWorkBudgetPolicy(
				{ ...basePolicy, operations: { 'example:get': { class: 'point', kind: 'mutation' } } },
				scan as never
			)
		).toContain('Policy kind drift for example:get.');
		expect(
			validateConvexWorkBudgetPolicy(
				{
					...basePolicy,
					caps: { dailyUnits: 327_680, monthlyUnits: 600_000 },
					operations: { ...basePolicy.operations, 'stale:get': { class: 'point', kind: 'query' } }
				},
				scan as never
			)
		).toEqual(
			expect.arrayContaining([
				'Monthly cap must be the reviewed 512 MiB.',
				'Stale work-budget policy operation: stale:get.'
			])
		);
	});
});
