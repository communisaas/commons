import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
	scanConvexNativeRecurringWork,
	scanRecurringDeclarationClosure,
	ticksPerDay,
	validateConvexNativeRecurringWork
} from '../../../scripts/verify-convex-native-recurring-work.mjs';

const manifest = () =>
	JSON.parse(readFileSync('config/convex-native-recurring-work.json', 'utf8'));

describe('Convex-native recurring-work launch ratchet', () => {
	it('pins all 37 definitions, zero-job containment, and the 25-job activation envelope', () => {
		const reviewed = manifest();
		const scan = scanConvexNativeRecurringWork();

		expect(validateConvexNativeRecurringWork(reviewed, scan)).toEqual([]);
		expect(scan.jobs).toHaveLength(37);
		expect(scan.jobs.filter((job) => job.tier === 'essential')).toHaveLength(25);
		expect(scan.jobs.filter((job) => job.tier === 'operational')).toHaveLength(9);
		expect(scan.jobs.filter((job) => job.tier === 'speculative')).toHaveLength(3);
		expect(reviewed.profile).toMatchObject({
			prelaunch: 'contained',
			expectedContainedRegisteredJobs: 0,
			maximumEssentialRootTicksPerBackendDay: 1278,
			maximumEssentialIdleFunctionCallsPerBackendDay: 2335,
			maximumEssentialIdleFunctionCallsPerTwoBackend31DayMonth: 144770,
			maximumContainedRootTicksPerBackendDay: 0,
			maximumContainedDatabaseIoBytesPerTwoBackend31DayMonth: 0
		});
		expect(reviewed.containedDisposition.registeredCronJobs).toEqual([]);
		expect(
			reviewed.containedDisposition.writeSiteScheduledContracts[
				'public-discovery-coordinated-rebuild-watchdog'
			]
		).toEqual({
			handler: 'internal.observability.superviseCoordinatedPublicDiscoveryRebuildWatchdog',
			trigger: 'coordinated-rebuild-acquisition-only',
			ownerCoordinates: [
				'coordinatedRebuildToken',
				'coordinatedRebuildAttempt',
				'coordinatedRebuildWatchdogScheduledAt'
			],
			idleCalls: 0,
			maxImmediateCalls: 2,
			maxRowsRead: 1,
			maxSuccessorsPerInvocation: 1,
			minimumOwnerLeaseMs: 1_800_000,
			canUnlockPublishOrRetry: false,
			proof: [
				'convex/lib/publicDiscovery.ts:invalidatePublicDiscoveryForCoordinatedRebuild',
				'convex/lib/publicDiscovery.ts:supervisePublicDiscoveryCoordinatedRebuildWatchdog',
				'convex/observability.ts:superviseCoordinatedPublicDiscoveryRebuildWatchdog'
			]
		});
		expect(reviewed.essentialActivationAuthority).toEqual({
			acceptedAuthorities: ['quota-isolation', 'paid-no-shared-hard-disable'],
			sharedFreeHeadroomAttestationIsSufficient: false
		});
		expect(
			scan.jobs
				.filter((job) => job.tier === 'essential')
				.reduce((total, job) => total + ticksPerDay(job), 0)
		).toBe(1278);
	});

	it('rejects missing inventory, cadence drift, and an understated idle path', () => {
		const reviewed = manifest();
		const scan = scanConvexNativeRecurringWork();
		const missing = structuredClone(reviewed);
		missing.jobs = missing.jobs.filter(
			(job: { name: string }) => job.name !== 'monitor-boundary-cell-rate'
		);
		expect(validateConvexNativeRecurringWork(missing, scan)).toContain(
			'Missing recurring-work inventory row: monitor-boundary-cell-rate.'
		);

		const cadence = structuredClone(reviewed);
		cadence.jobs.find(
			(job: { name: string }) => job.name === 'sweep-stuck-processing'
		).schedule = '{ minutes: 2 }';
		expect(validateConvexNativeRecurringWork(cadence, scan)).toContain(
			'sweep-stuck-processing schedule drifted.'
		);

		const understated = structuredClone(reviewed);
		understated.essentialContracts['drain-contact-authority-fanout'].idleCalls = 4;
		understated.essentialContracts['drain-contact-authority-fanout'].maxImmediateCalls = 3;
		expect(validateConvexNativeRecurringWork(understated, scan)).toEqual(
			expect.arrayContaining([
				'drain-contact-authority-fanout immediate-call envelope is below its idle path.',
				'Essential idle function-call daily envelope drifted.'
			])
		);

		const multipliedWatchdog = structuredClone(reviewed);
		multipliedWatchdog.containedDisposition.writeSiteScheduledContracts[
			'public-discovery-coordinated-rebuild-watchdog'
		].maxSuccessorsPerInvocation = 2;
		expect(validateConvexNativeRecurringWork(multipliedWatchdog, scan)).toContain(
			'Contained write-site watchdog contract drifted.'
		);
	});

	it('follows helper indirection instead of trusting a hand-written proof list', () => {
		const closure = scanRecurringDeclarationClosure({
			entryFile: 'tests/fixtures/convex-native-recurring-helper-indirection.ts',
			entrySymbol: 'recurringEntry'
		});
		expect(closure.errors).toEqual([]);
		expect(closure.visited).toEqual(
			expect.arrayContaining([
				expect.stringContaining(':recurringEntry'),
				expect.stringContaining(':hiddenFullTableRead')
			])
		);
		expect(closure.hazards).toContainEqual(
			expect.objectContaining({ symbol: 'hiddenFullTableRead', collectCalls: 1 })
		);
	});

	it('keeps shared-team headroom operator-local, exhaustive, fresh, and sibling-bounded', () => {
		const reviewed = manifest();
		expect(reviewed.sharedTeamQuotaGate).toMatchObject({
			teamDatabaseIoEntitlementBytes: 1_073_741_824,
			deploymentApiDatabaseIoGbBytes: 1_073_741_824,
			acceptedAuthorities: ['signed-operator-attestation', 'quota-isolation'],
			attestationCredentialLocation: 'operator-local-only',
			maximumDashboardObservationLagMs: 600_000,
			requiredTeamUsageState: 'Default',
			ciMayHoldDashboardUserToken: false,
			containedCronRemainingAllowanceBytes: 0
		});
		expect(reviewed.sharedTeamQuotaGate.attestationRequiredFields).toContain(
			'projectInventoryWithDispositionAndMaximumRemainingDatabaseIoBytes'
		);
		expect(reviewed.sharedTeamQuotaGate.headroomEquation).toContain(
			'sum(siblingMaximumRemainingDatabaseIoBytes)'
		);

		const unsafe = structuredClone(reviewed);
		unsafe.sharedTeamQuotaGate.maximumDashboardObservationLagMs = 21_600_000;
		expect(
			validateConvexNativeRecurringWork(unsafe, scanConvexNativeRecurringWork())
		).toContain('Shared-team attestation contract is not exact or TOCTOU-safe.');
	});

	it('proves bounded boundary monitoring, one-shot migrations, and temporal clean no-op', () => {
		const reviewed = manifest();
		expect(validateConvexNativeRecurringWork(reviewed, scanConvexNativeRecurringWork())).toEqual(
			[]
		);

		const supporters = readFileSync('convex/supporters.ts', 'utf8');
		const donations = readFileSync('convex/donations.ts', 'utf8');
		const observability = readFileSync('convex/observability.ts', 'utf8');
		const templates = readFileSync('convex/templates.ts', 'utf8');
		expect(observability).toContain('BOUNDARY_CELL_MONITOR_CAPACITY_EXCEEDED');
		expect(supporters).toContain('completedVersion: STRANDED_PLACEHOLDER_SWEEP_VERSION');
		expect(donations).toContain('pagesScanned: 1');
		expect(templates).toContain("status: 'clean' as const");
		expect(templates).toContain('nextTemporalRebuildAt');
	});
});
