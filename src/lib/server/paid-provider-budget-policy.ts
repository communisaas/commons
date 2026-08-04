import policyDocument from '../../../config/paid-provider-budget-policy.json';
import {
	CONVEX_WORK_BUDGET_CLASS_UNITS,
	CONVEX_WORK_BUDGET_DAILY_CAP_UNITS
} from './convex-work-budget-policy';
import {
	PROVIDER_OPERATION_CALL_BUNDLES,
	PROVIDER_OPERATION_CALL_ENVELOPES,
	providerCallBundleTotal,
	type ProviderCallBundle
} from '$lib/core/agents/provider-call-envelope';

export const PAID_PROVIDER_BUDGET_PROTOCOL = '1' as const;
export const PAID_PROVIDER_BUDGET_AUTHORITY_ID = 'shared-paid-provider-01' as const;
export const PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS = 1_000 as const;
export const PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS = 2_400 as const;
export const PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS = 750 as const;
export const PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS = 1_800 as const;
export const EXA_FREE_MONTHLY_CREDIT_MICROUSD = 10_000_000 as const;
export const EXA_SEARCH_MICROUSD = 7_000 as const;
export const EXA_CONTENTS_PAGE_MICROUSD = 1_000 as const;
export const FIRECRAWL_FREE_MONTHLY_CREDITS = 1_000 as const;

export type PaidProviderTrustTier = 'authenticated' | 'verified' | 'operator';

const PAID_PROVIDER_TRUST_TIERS = ['authenticated', 'verified', 'operator'] as const;

type OperationDocument = {
	weightUnits: number;
	maxProviderCallsPerReservation: number;
	providerCallBundle: Partial<ProviderCallBundle>;
	publicDailyUnits: number;
	publicMonthlyUnits: number;
	hourlyReservations: Record<PaidProviderTrustTier, number>;
};

type PolicyDocument = {
	version: number;
	protocol: string;
	authorityId: string;
	caps: {
		globalDailyUnits: number;
		globalMonthlyUnits: number;
		publicDailyUnits: number;
		publicMonthlyUnits: number;
		actorDailyReservations: Record<PaidProviderTrustTier, number>;
	};
	operations: Record<string, OperationDocument>;
	providerEconomics: {
		exa: {
			freeMonthlyCreditMicrousd: number;
			searchMicrousd: number;
			contentsPageMicrousd: number;
			launchBillingAuthority: string;
		};
		firecrawl: {
			freeMonthlyCredits: number;
			scrapeCreditsPerAttempt: number;
			launchBillingAuthority: string;
		};
		gemini: { launchBillingAuthority: string };
		groq: { launchBillingAuthority: string };
	};
	cloudflareEnvelope: {
		workerDailyRequestFreeLimit: number;
		durableObjectDailyRequestFreeLimit: number;
		sqliteDailyRowsReadFreeLimit: number;
		sqliteDailyRowsWrittenFreeLimit: number;
		sqliteRowsReadPerAttempt: number;
		sqliteRowsWrittenPerAdmission: number;
	};
};

const policy = policyDocument as PolicyDocument;
const PROVIDER_KEYS = [
	'dnsMx',
	'exaContents',
	'exaSearch',
	'firecrawl',
	'gemini',
	'groq'
] as const satisfies readonly (keyof ProviderCallBundle)[];

function normalizedProviderBundle(bundle: Partial<ProviderCallBundle>): ProviderCallBundle {
	return Object.freeze({
		dnsMx: bundle.dnsMx ?? 0,
		exaContents: bundle.exaContents ?? 0,
		exaSearch: bundle.exaSearch ?? 0,
		firecrawl: bundle.firecrawl ?? 0,
		gemini: bundle.gemini ?? 0,
		groq: bundle.groq ?? 0
	});
}

function invariant(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`PAID_PROVIDER_BUDGET_POLICY_INVALID:${message}`);
}

function positiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

function validatePolicy(): void {
	invariant(policy.version === 1, 'version');
	invariant(policy.protocol === PAID_PROVIDER_BUDGET_PROTOCOL, 'protocol');
	invariant(policy.authorityId === PAID_PROVIDER_BUDGET_AUTHORITY_ID, 'authority_id');
	invariant(
		policy.caps.globalDailyUnits === PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS,
		'global_daily_units'
	);
	invariant(
		policy.caps.globalMonthlyUnits === PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS,
		'global_monthly_units'
	);
	invariant(
		policy.caps.publicDailyUnits === PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS,
		'public_daily_units'
	);
	invariant(
		policy.caps.publicMonthlyUnits === PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS,
		'public_monthly_units'
	);
	invariant(
		PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS <= PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS,
		'cap_order'
	);
	invariant(
		PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS < PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS &&
			PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS < PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS,
		'operator_reserve'
	);
	// One protected launch demonstration can complete subject selection, target
	// resolution, message authoring, and both moderation passes without raising
	// either hard platform ceiling.
	invariant(
		PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS - PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS >= 224,
		'operator_demo_daily_reserve'
	);
	invariant(
		PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS - PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS >=
			2 * 224,
		'operator_demo_monthly_reserve'
	);
	for (const tier of PAID_PROVIDER_TRUST_TIERS) {
		invariant(positiveInteger(policy.caps.actorDailyReservations[tier]), `daily_${tier}`);
	}
	invariant(
		Object.keys(policy.operations).length > 0 && Object.keys(policy.operations).length <= 16,
		'operation_count'
	);
	for (const [operation, entry] of Object.entries(policy.operations)) {
		invariant(/^[a-z][a-z0-9-]{0,63}$/.test(operation), `operation_${operation}`);
		invariant(positiveInteger(entry.weightUnits), `weight_${operation}`);
		invariant(
			positiveInteger(entry.maxProviderCallsPerReservation) &&
				entry.maxProviderCallsPerReservation <= entry.weightUnits,
			`provider_call_envelope_${operation}`
		);
		invariant(
			Object.keys(entry.providerCallBundle).every((key) =>
				(PROVIDER_KEYS as readonly string[]).includes(key)
			),
			`provider_bundle_keys_${operation}`
		);
		const callBundle = normalizedProviderBundle(entry.providerCallBundle);
		for (const provider of PROVIDER_KEYS) {
			invariant(
				Number.isSafeInteger(callBundle[provider]) && callBundle[provider] >= 0,
				`provider_bundle_${operation}_${provider}`
			);
		}
		invariant(
			providerCallBundleTotal(callBundle) >= entry.maxProviderCallsPerReservation,
			`provider_bundle_total_${operation}`
		);
		const implementationBundle =
			PROVIDER_OPERATION_CALL_BUNDLES[operation as keyof typeof PROVIDER_OPERATION_CALL_BUNDLES];
		invariant(implementationBundle !== undefined, `provider_bundle_implementation_${operation}`);
		invariant(
			PROVIDER_OPERATION_CALL_ENVELOPES[
				operation as keyof typeof PROVIDER_OPERATION_CALL_ENVELOPES
			] === entry.maxProviderCallsPerReservation,
			`provider_call_envelope_drift_${operation}`
		);
		for (const provider of PROVIDER_KEYS) {
			invariant(
				callBundle[provider] === implementationBundle[provider],
				`provider_bundle_drift_${operation}_${provider}`
			);
		}
		invariant(
			entry.weightUnits <= PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS,
			`weight_exceeds_daily_${operation}`
		);
		invariant(
			positiveInteger(entry.publicDailyUnits) &&
				entry.publicDailyUnits >= entry.weightUnits &&
				entry.publicDailyUnits <= PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS,
			`public_daily_${operation}`
		);
		invariant(
			positiveInteger(entry.publicMonthlyUnits) &&
				entry.publicMonthlyUnits >= entry.publicDailyUnits &&
				entry.publicMonthlyUnits <= PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS,
			`public_monthly_${operation}`
		);
		for (const tier of PAID_PROVIDER_TRUST_TIERS) {
			invariant(positiveInteger(entry.hourlyReservations[tier]), `hourly_${operation}_${tier}`);
		}
	}

	const economics = policy.providerEconomics;
	invariant(
		economics.exa.freeMonthlyCreditMicrousd === EXA_FREE_MONTHLY_CREDIT_MICROUSD &&
			economics.exa.searchMicrousd === EXA_SEARCH_MICROUSD &&
			economics.exa.contentsPageMicrousd === EXA_CONTENTS_PAGE_MICROUSD &&
			economics.exa.launchBillingAuthority === 'free-plan-billing-disabled-no-payg',
		'exa_economics'
	);
	invariant(
		economics.firecrawl.freeMonthlyCredits === FIRECRAWL_FREE_MONTHLY_CREDITS &&
			economics.firecrawl.scrapeCreditsPerAttempt === 1 &&
			economics.firecrawl.launchBillingAuthority === 'free-plan-billing-disabled-no-payg',
		'firecrawl_economics'
	);
	for (const provider of ['gemini', 'groq'] as const) {
		invariant(
			economics[provider].launchBillingAuthority === 'free-plan-billing-disabled-no-payg',
			`${provider}_billing_authority`
		);
	}

	// A weighted mixture cannot exceed the highest provider-cost/unit ratio.
	// Cross multiplication avoids rounding away a fraction of a paid call.
	for (const entry of Object.values(policy.operations)) {
		const calls = normalizedProviderBundle(entry.providerCallBundle);
		const exaCostMicrousd =
			calls.exaSearch * economics.exa.searchMicrousd +
			calls.exaContents * economics.exa.contentsPageMicrousd;
		invariant(
			PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS * exaCostMicrousd * 100 <=
				economics.exa.freeMonthlyCreditMicrousd * entry.weightUnits * 85,
			'exa_monthly_headroom'
		);
		const firecrawlCredits = calls.firecrawl * economics.firecrawl.scrapeCreditsPerAttempt;
		invariant(
			PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS * firecrawlCredits * 100 <=
				economics.firecrawl.freeMonthlyCredits * entry.weightUnits * 80,
			'firecrawl_monthly_headroom'
		);
	}

	const envelope = policy.cloudflareEnvelope;
	const maximumConvexAdmissions =
		CONVEX_WORK_BUDGET_DAILY_CAP_UNITS / CONVEX_WORK_BUDGET_CLASS_UNITS.control;
	const maximumProviderAdmissions = PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS;
	invariant(
		envelope.workerDailyRequestFreeLimit === 100_000 &&
			envelope.durableObjectDailyRequestFreeLimit === 100_000 &&
			envelope.sqliteDailyRowsReadFreeLimit === 5_000_000 &&
			envelope.sqliteDailyRowsWrittenFreeLimit === 100_000 &&
			envelope.sqliteRowsReadPerAttempt === 8 &&
			envelope.sqliteRowsWrittenPerAdmission === 8 &&
			maximumConvexAdmissions * 2 +
				maximumProviderAdmissions * envelope.sqliteRowsWrittenPerAdmission <=
				envelope.sqliteDailyRowsWrittenFreeLimit &&
			envelope.workerDailyRequestFreeLimit * envelope.sqliteRowsReadPerAttempt <=
				envelope.sqliteDailyRowsReadFreeLimit,
		'cloudflare_free_envelope'
	);
}

validatePolicy();

export type PaidProviderBudgetPolicy = Readonly<{
	actorDailyReservations: number;
	hourlyReservations: number;
	maxProviderCallsPerReservation: number;
	providerCallBundle: ProviderCallBundle;
	operation: string;
	publicDailyUnits: number;
	publicMonthlyUnits: number;
	weightUnits: number;
}>;

export function paidProviderBudgetPolicyFor(
	operation: string,
	tier: PaidProviderTrustTier
): PaidProviderBudgetPolicy | null {
	const entry = policy.operations[operation];
	if (!entry) return null;
	const hourlyReservations = entry.hourlyReservations[tier];
	const actorDailyReservations = policy.caps.actorDailyReservations[tier];
	if (!positiveInteger(hourlyReservations) || !positiveInteger(actorDailyReservations)) return null;
	return Object.freeze({
		actorDailyReservations,
		hourlyReservations,
		maxProviderCallsPerReservation: entry.maxProviderCallsPerReservation,
		providerCallBundle: normalizedProviderBundle(entry.providerCallBundle),
		operation,
		publicDailyUnits: entry.publicDailyUnits,
		publicMonthlyUnits: entry.publicMonthlyUnits,
		weightUnits: entry.weightUnits
	});
}

export function paidProviderBudgetOperationNames(): readonly string[] {
	return Object.freeze(Object.keys(policy.operations).sort());
}
