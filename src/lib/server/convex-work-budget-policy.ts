import policyDocument from '../../../config/convex-work-budget-policy.json';

export const CONVEX_WORK_BUDGET_PROTOCOL = '4' as const;
export const CONVEX_WORK_BUDGET_COORDINATOR_GENERATION = 'v4' as const;
// Immutable quota-authority identity. A display-name change must never alter
// the team coordinator object; a real quota-isolated team move is a separate,
// explicitly proved migration.
export const CONVEX_WORK_BUDGET_TEAM_AUTHORITY_ID = 'shared-convex-quota-01' as const;
export const CONVEX_WORK_BUDGET_UNIT_BYTES = 1024 as const;
export const CONVEX_WORK_BUDGET_DAILY_CAP_UNITS = 327_680 as const;
export const CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS = 524_288 as const;

export type ConvexServerOperationKind = 'action' | 'mutation' | 'query';

export type ConvexWorkBudgetClass =
	| 'auth'
	| 'bulk'
	| 'collection'
	| 'control'
	| 'maximum'
	| 'mutation'
	| 'point';

export const CONVEX_WORK_BUDGET_CLASS_UNITS = Object.freeze({
	auth: 16,
	bulk: 1024,
	collection: 1024,
	control: 8,
	maximum: 4096,
	mutation: 128,
	point: 64
}) satisfies Readonly<Record<ConvexWorkBudgetClass, number>>;

type PolicyEntry = {
	class: ConvexWorkBudgetClass;
	kind: ConvexServerOperationKind;
};

type PolicyDocument = {
	caps: { dailyUnits: number; monthlyUnits: number };
	classes: Record<ConvexWorkBudgetClass, number>;
	cloudflareEnvelope: {
		durableObjectDailyRequestFreeLimit: number;
		sqliteDailyRowsReadFreeLimit: number;
		sqliteDailyRowsWrittenFreeLimit: number;
		sqliteRowsWrittenPerAdmission: number;
		workerDailyRequestFreeLimit: number;
	};
	coordinatorGeneration: string;
	launchEnvelope: {
		continuationGateWindowMinutes: number;
		manifestAuthorityFreshnessSeconds: number;
		manifestAuthoritySurvivalReserveSeconds: number;
		manifestCronHttpTimeoutSeconds: number;
		manifestCronPollSeconds: number;
		manifestSchedulerJitterBudgetSeconds: number;
		maximumCalendarMonthDays: number;
		maximumCleanBackfillAttemptsPerRelease: number;
		maximumDeploymentHealthChecksPerRelease: number;
		maximumMaterializationReplayAttemptsPerRelease: number;
		maximumOrdinaryManifestRefreshCallsPerDayPerRealm: number;
		maximumReleaseEnvelopesPerTeamMonth: number;
		ordinaryManifestRefreshGateWindowMinutes: number;
		recurringHealthChecksPerDayPerRealm: number;
		softLaunchDailyUnitsPerRealm: number;
	};
	operations: Record<string, PolicyEntry>;
	protocol: string;
	realms: Record<ConvexWorkBudgetRealm, string>;
	teamAuthorityId: string;
	unitBytes: number;
};

export const CONVEX_WORK_BUDGET_REALMS = Object.freeze({
	production: 'quirky-chinchilla-352.convex.cloud',
	preview: 'outstanding-firefly-831.convex.cloud'
} as const);

export type ConvexWorkBudgetRealm = keyof typeof CONVEX_WORK_BUDGET_REALMS;

const policy = policyDocument as PolicyDocument;

function policyInvariant(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`CONVEX_WORK_BUDGET_POLICY_INVALID:${message}`);
}

function validatePolicy(): void {
	policyInvariant(policy.protocol === CONVEX_WORK_BUDGET_PROTOCOL, 'protocol');
	policyInvariant(
		policy.coordinatorGeneration === CONVEX_WORK_BUDGET_COORDINATOR_GENERATION,
		'coordinator_generation'
	);
	policyInvariant(
		policy.teamAuthorityId === CONVEX_WORK_BUDGET_TEAM_AUTHORITY_ID,
		'team_authority_id'
	);
	policyInvariant(
		JSON.stringify(policy.realms) === JSON.stringify(CONVEX_WORK_BUDGET_REALMS),
		'realms'
	);
	policyInvariant(policy.unitBytes === CONVEX_WORK_BUDGET_UNIT_BYTES, 'unit_bytes');
	policyInvariant(policy.caps.dailyUnits === CONVEX_WORK_BUDGET_DAILY_CAP_UNITS, 'daily_cap');
	policyInvariant(policy.caps.monthlyUnits === CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS, 'monthly_cap');
	policyInvariant(
		CONVEX_WORK_BUDGET_DAILY_CAP_UNITS <= CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS,
		'cap_order'
	);
	policyInvariant(
		policy.cloudflareEnvelope.workerDailyRequestFreeLimit === 100_000 &&
			policy.cloudflareEnvelope.durableObjectDailyRequestFreeLimit === 100_000 &&
			policy.cloudflareEnvelope.sqliteDailyRowsReadFreeLimit === 5_000_000 &&
			policy.cloudflareEnvelope.sqliteRowsWrittenPerAdmission === 2 &&
			policy.cloudflareEnvelope.sqliteDailyRowsWrittenFreeLimit === 100_000 &&
			(CONVEX_WORK_BUDGET_DAILY_CAP_UNITS / CONVEX_WORK_BUDGET_CLASS_UNITS.control) * 2 <= 100_000,
		'cloudflare_sqlite_write_envelope'
	);
	policyInvariant(
		policy.launchEnvelope.ordinaryManifestRefreshGateWindowMinutes === 5 &&
			policy.launchEnvelope.continuationGateWindowMinutes === 2 &&
			policy.launchEnvelope.manifestCronPollSeconds === 60 &&
			policy.launchEnvelope.manifestCronHttpTimeoutSeconds === 10 &&
			policy.launchEnvelope.manifestSchedulerJitterBudgetSeconds === 30 &&
			policy.launchEnvelope.manifestAuthoritySurvivalReserveSeconds === 20 &&
			policy.launchEnvelope.manifestAuthorityFreshnessSeconds === 540 &&
			policy.launchEnvelope.manifestAuthorityFreshnessSeconds ===
				policy.launchEnvelope.ordinaryManifestRefreshGateWindowMinutes * 60 +
					policy.launchEnvelope.continuationGateWindowMinutes * 60 +
					policy.launchEnvelope.manifestCronPollSeconds +
					policy.launchEnvelope.manifestCronHttpTimeoutSeconds +
					policy.launchEnvelope.manifestSchedulerJitterBudgetSeconds +
					policy.launchEnvelope.manifestAuthoritySurvivalReserveSeconds &&
			policy.launchEnvelope.maximumCalendarMonthDays === 31 &&
			policy.launchEnvelope.maximumCleanBackfillAttemptsPerRelease === 16 &&
			policy.launchEnvelope.maximumMaterializationReplayAttemptsPerRelease === 3 &&
			policy.launchEnvelope.maximumOrdinaryManifestRefreshCallsPerDayPerRealm === 288 &&
			policy.launchEnvelope.maximumDeploymentHealthChecksPerRelease === 2 &&
			policy.launchEnvelope.maximumReleaseEnvelopesPerTeamMonth === 1 &&
			policy.launchEnvelope.recurringHealthChecksPerDayPerRealm === 0 &&
			policy.launchEnvelope.softLaunchDailyUnitsPerRealm === 512,
		'launch_envelope'
	);
	policyInvariant(
		policy.launchEnvelope.maximumCleanBackfillAttemptsPerRelease +
			policy.launchEnvelope.maximumMaterializationReplayAttemptsPerRelease ===
			19,
		'maximum_backfill_attempts'
	);
	for (const [className, units] of Object.entries(CONVEX_WORK_BUDGET_CLASS_UNITS)) {
		policyInvariant(
			policy.classes[className as ConvexWorkBudgetClass] === units,
			`class_${className}`
		);
	}
	policyInvariant(Object.keys(policy.operations).length > 0, 'empty_operations');
	for (const [operation, entry] of Object.entries(policy.operations)) {
		policyInvariant(/^[A-Za-z0-9_/-]+:[A-Za-z0-9_]+$/.test(operation), 'operation_name');
		policyInvariant(
			entry.kind === 'query' || entry.kind === 'mutation' || entry.kind === 'action',
			'operation_kind'
		);
		policyInvariant(
			Number.isSafeInteger(CONVEX_WORK_BUDGET_CLASS_UNITS[entry.class]) &&
				CONVEX_WORK_BUDGET_CLASS_UNITS[entry.class] > 0,
			'operation_class'
		);
	}
}

validatePolicy();

export const CONVEX_WORK_BUDGET_MAXIMUM_BACKFILL_ATTEMPTS_PER_RELEASE =
	policy.launchEnvelope.maximumCleanBackfillAttemptsPerRelease +
	policy.launchEnvelope.maximumMaterializationReplayAttemptsPerRelease;
export const CONVEX_WORK_BUDGET_MAXIMUM_CONTINUATION_ADMISSIONS_PER_REALM_DAY =
	CONVEX_WORK_BUDGET_MAXIMUM_BACKFILL_ATTEMPTS_PER_RELEASE - 1;
export const CONVEX_WORK_BUDGET_ORDINARY_MANIFEST_GATE_WINDOW_MINUTES =
	policy.launchEnvelope.ordinaryManifestRefreshGateWindowMinutes;
export const CONVEX_WORK_BUDGET_CONTINUATION_GATE_WINDOW_MINUTES =
	policy.launchEnvelope.continuationGateWindowMinutes;
export const CONVEX_WORK_BUDGET_MANIFEST_CRON_POLL_SECONDS =
	policy.launchEnvelope.manifestCronPollSeconds;
export const CONVEX_WORK_BUDGET_MANIFEST_CRON_HTTP_TIMEOUT_SECONDS =
	policy.launchEnvelope.manifestCronHttpTimeoutSeconds;
export const CONVEX_WORK_BUDGET_MANIFEST_SCHEDULER_JITTER_BUDGET_SECONDS =
	policy.launchEnvelope.manifestSchedulerJitterBudgetSeconds;
export const CONVEX_WORK_BUDGET_MANIFEST_AUTHORITY_SURVIVAL_RESERVE_SECONDS =
	policy.launchEnvelope.manifestAuthoritySurvivalReserveSeconds;
export const CONVEX_WORK_BUDGET_MANIFEST_AUTHORITY_FRESHNESS_SECONDS =
	policy.launchEnvelope.manifestAuthorityFreshnessSeconds;

export type ConvexWorkBudgetPolicy = Readonly<{
	class: ConvexWorkBudgetClass;
	kind: ConvexServerOperationKind;
	units: number;
}>;

/**
 * Return the reviewed admission weight for one exact SvelteKit-to-Convex call.
 *
 * Units are deliberately conservative cost envelopes, not observed or exact
 * Convex database-I/O bytes. Unknown names and kind drift fail closed so a new
 * call cannot silently inherit a cheap default.
 */
export function convexWorkBudgetPolicyFor(
	operation: string,
	kind: ConvexServerOperationKind
): ConvexWorkBudgetPolicy | null {
	const entry = policy.operations[operation];
	if (!entry || entry.kind !== kind) return null;
	return Object.freeze({
		class: entry.class,
		kind: entry.kind,
		units: CONVEX_WORK_BUDGET_CLASS_UNITS[entry.class]
	});
}

export function convexWorkBudgetOperationNames(): readonly string[] {
	return Object.freeze(Object.keys(policy.operations).sort());
}
