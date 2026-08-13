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
import {
	AGENTIC_PROVIDER_REVENUE_ALLOCATION_BASIS_POINTS,
	AGENTIC_RESOLVE_PROVIDER_COST_MICROUSD,
	AGENTIC_RESOLVE_PROVIDER_UNITS,
	ORG_PLAN_LIMITS,
	ORG_PLAN_ORDER
} from '../../../convex/lib/planLimits';

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
export const PAID_PROVIDER_PAYG_BILLING_AUTHORITY = 'operator-authorized-pay-as-you-go' as const;
export const EXA_PAID_ORG_MONTHLY_SPEND_CEILING_MICROUSD = 100_000_000 as const;
export const FIRECRAWL_PAID_ORG_MONTHLY_SPEND_CEILING_CREDITS = 6_000 as const;
export const EXA_PAID_ORG_MONTHLY_CEILING_REASON = 'paid-provider-exa-monthly-ceiling' as const;
export const FIRECRAWL_PAID_ORG_MONTHLY_CEILING_REASON =
	'paid-provider-firecrawl-monthly-ceiling' as const;

const EXA_OPERATOR_ACTIVATION_DEPENDENCY =
	'Paid billing must be enabled in the Exa dashboard before authorized requests can spend.' as const;
const FIRECRAWL_OPERATOR_ACTIVATION_DEPENDENCY =
	'Paid billing must be enabled in the Firecrawl dashboard before authorized requests can spend.' as const;

export type PaidProviderTrustTier = 'authenticated' | 'verified' | 'operator';

const PAID_PROVIDER_TRUST_TIERS = ['authenticated', 'verified', 'operator'] as const;

/** Tiers that draw the shared public pool; `operator` spends the reserve instead. */
const PAID_PROVIDER_PUBLIC_POOL_TIERS = ['authenticated', 'verified'] as const;

/**
 * Every reason the admitting Durable Object can refuse a reservation with. The
 * worker builds its rows from this union and the budget client reads the header
 * against it, so the strings exist once in the tree.
 */
export type PaidProviderBudgetReason =
	| 'actor-daily'
	| 'actor-monthly'
	| 'operation'
	| 'operation-daily'
	| 'operation-monthly'
	| 'public-daily'
	| 'public-monthly'
	| 'paid-org-balance'
	| typeof EXA_PAID_ORG_MONTHLY_CEILING_REASON
	| typeof FIRECRAWL_PAID_ORG_MONTHLY_CEILING_REASON
	| 'platform-daily'
	| 'platform-monthly';

/** Whose capacity ran out: the caller's own share, the shared pool, or unknown. */
export type PaidProviderBudgetScope = 'actor' | 'platform' | 'blocked';

/**
 * The one mapping from denial reason to whose capacity was spent. Declared as a
 * total `Record` over the reason union: adding a reason without deciding its
 * scope is a compile error rather than a silent misattribution.
 */
const PAID_PROVIDER_BUDGET_REASON_SCOPES: Readonly<
	Record<PaidProviderBudgetReason, Exclude<PaidProviderBudgetScope, 'blocked'>>
> = Object.freeze({
	// Keyed on the caller's own actor hash or their own organization.
	operation: 'actor',
	'actor-daily': 'actor',
	'actor-monthly': 'actor',
	'paid-org-balance': 'actor',
	// Keyed on a pool anyone can spend, so the caller may have spent none of it.
	'operation-daily': 'platform',
	'operation-monthly': 'platform',
	'public-daily': 'platform',
	'public-monthly': 'platform',
	'platform-daily': 'platform',
	'platform-monthly': 'platform',
	[EXA_PAID_ORG_MONTHLY_CEILING_REASON]: 'platform',
	[FIRECRAWL_PAID_ORG_MONTHLY_CEILING_REASON]: 'platform'
});

/**
 * An absent or unrecognised reason resolves to `blocked` — evidence of nothing.
 * Defaulting an unknown reason to `actor` is exactly how a shared-pool
 * exhaustion gets told to a person as their own spending, so there is no
 * `actor`-returning fallback here.
 */
export function budgetScopeForReason(reason: string | null): PaidProviderBudgetScope {
	if (reason === null) return 'blocked';
	return Object.hasOwn(PAID_PROVIDER_BUDGET_REASON_SCOPES, reason)
		? PAID_PROVIDER_BUDGET_REASON_SCOPES[reason as PaidProviderBudgetReason]
		: 'blocked';
}

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
		actorMonthlyPublicUnits: Record<'authenticated' | 'verified', number>;
	};
	operations: Record<string, OperationDocument>;
	paidOrgCapacity: {
		operation: string;
		providerUnitsPerResolve: number;
		providerCostMicrousdPerResolve: number;
		revenueAllocationBasisPoints: number;
		billingAuthority: string;
	};
	providerEconomics: {
		exa: {
			freeMonthlyCreditMicrousd: number;
			searchMicrousd: number;
			contentsPageMicrousd: number;
			launchBillingAuthority: string;
			monthlyPaidOrgSpendCeilingMicrousd: number;
			operatorActivationDependency: string;
		};
		firecrawl: {
			freeMonthlyCredits: number;
			scrapeCreditsPerAttempt: number;
			launchBillingAuthority: string;
			monthlyPaidOrgSpendCeilingCredits: number;
			operatorActivationDependency: string;
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

/**
 * The provider-backed operations a person can actually consume in one complete
 * free authoring journey. Each entry is grounded in its production request
 * caller and the server admission that reserves it; diagnostic-only operations
 * do not belong in this floor.
 */
const FREE_JOURNEY_OPERATIONS = [
	// UnifiedObjectiveEntry.svelte:320 -> stream-subject/+server.ts:54
	'subject-line',
	// DecisionMakerResolver.svelte:130 -> stream-decision-makers/+server.ts:138
	'decision-makers',
	// MessageGenerationResolver.svelte:422 -> stream-message/+server.ts:189
	'message-generation',
	// personal-connection.ts:33 -> moderation/personalization/+server.ts:72
	'moderation-personalization',
	// templates.svelte.ts:14 -> templates/+server.ts:841
	'template-authoring'
] as const;

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
	// The per-actor monthly share of the public pool is sized in journeys, not in
	// resolves, so a share can never strand someone between a resolved audience
	// and an unwritten message.
	let journeyUnits = 0;
	for (const operation of FREE_JOURNEY_OPERATIONS) {
		const journeyOperation = policy.operations[operation];
		invariant(journeyOperation !== undefined, `journey_operation_${operation}`);
		invariant(positiveInteger(journeyOperation.weightUnits), `journey_weight_${operation}`);
		journeyUnits += journeyOperation.weightUnits;
	}
	for (const tier of PAID_PROVIDER_PUBLIC_POOL_TIERS) {
		const share = policy.caps.actorMonthlyPublicUnits[tier];
		invariant(positiveInteger(share), `actor_monthly_${tier}`);
		invariant(share >= journeyUnits, `actor_monthly_journey_floor_${tier}`);
		invariant(
			share <= PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS,
			`actor_monthly_pool_ceiling_${tier}`
		);
	}
	invariant(
		policy.caps.actorMonthlyPublicUnits.authenticated <=
			policy.caps.actorMonthlyPublicUnits.verified,
		'actor_monthly_tier_order'
	);
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

	const paidOrgCapacity = policy.paidOrgCapacity;
	invariant(paidOrgCapacity.operation === 'decision-makers', 'paid_org_operation');
	invariant(
		paidOrgCapacity.providerUnitsPerResolve === AGENTIC_RESOLVE_PROVIDER_UNITS &&
			paidOrgCapacity.providerUnitsPerResolve === policy.operations['decision-makers']?.weightUnits,
		'paid_org_units'
	);
	invariant(
		paidOrgCapacity.providerCostMicrousdPerResolve === AGENTIC_RESOLVE_PROVIDER_COST_MICROUSD,
		'paid_org_cost'
	);
	invariant(
		paidOrgCapacity.revenueAllocationBasisPoints ===
			AGENTIC_PROVIDER_REVENUE_ALLOCATION_BASIS_POINTS &&
			paidOrgCapacity.revenueAllocationBasisPoints > 0 &&
			paidOrgCapacity.revenueAllocationBasisPoints < 10_000,
		'paid_org_revenue_allocation'
	);
	invariant(
		paidOrgCapacity.billingAuthority === 'settled-subscription-payment-only',
		'paid_org_billing_authority'
	);

	const economics = policy.providerEconomics;
	invariant(
		economics.exa.freeMonthlyCreditMicrousd === EXA_FREE_MONTHLY_CREDIT_MICROUSD &&
			economics.exa.searchMicrousd === EXA_SEARCH_MICROUSD &&
			economics.exa.contentsPageMicrousd === EXA_CONTENTS_PAGE_MICROUSD &&
			economics.exa.launchBillingAuthority === PAID_PROVIDER_PAYG_BILLING_AUTHORITY &&
			economics.exa.monthlyPaidOrgSpendCeilingMicrousd ===
				EXA_PAID_ORG_MONTHLY_SPEND_CEILING_MICROUSD &&
			economics.exa.operatorActivationDependency === EXA_OPERATOR_ACTIVATION_DEPENDENCY,
		'exa_economics'
	);
	invariant(
		economics.firecrawl.freeMonthlyCredits === FIRECRAWL_FREE_MONTHLY_CREDITS &&
			economics.firecrawl.scrapeCreditsPerAttempt === 1 &&
			economics.firecrawl.launchBillingAuthority === PAID_PROVIDER_PAYG_BILLING_AUTHORITY &&
			economics.firecrawl.monthlyPaidOrgSpendCeilingCredits ===
				FIRECRAWL_PAID_ORG_MONTHLY_SPEND_CEILING_CREDITS &&
			economics.firecrawl.operatorActivationDependency === FIRECRAWL_OPERATOR_ACTIVATION_DEPENDENCY,
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
			envelope.sqliteRowsReadPerAttempt === 9 &&
			envelope.sqliteRowsWrittenPerAdmission === 9 &&
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
	/** `null` where the tier draws no public pool at all, never a sentinel count. */
	actorMonthlyPublicUnits: number | null;
	hourlyReservations: number;
	maxProviderCallsPerReservation: number;
	providerCallBundle: ProviderCallBundle;
	operation: string;
	publicDailyUnits: number;
	publicMonthlyUnits: number;
	weightUnits: number;
}>;

export type MarketedCapacityShortfall = Readonly<{
	exaMicrousd: number;
	firecrawlCredits: number;
}>;

export type PaidOrgProviderMonthlyCeilings = Readonly<{
	exa: Readonly<{ incrementMicrousd: number; limitMicrousd: number }>;
	firecrawl: Readonly<{ incrementCredits: number; limitCredits: number }>;
}>;

/** Gross, pre-credit provider draw admitted for one paid-org resolve. */
export function paidOrgProviderMonthlyCeilings(): PaidOrgProviderMonthlyCeilings {
	const paidOrgCapacity = policy.paidOrgCapacity;
	const calls = normalizedProviderBundle(
		policy.operations[paidOrgCapacity.operation]!.providerCallBundle
	);
	const economics = policy.providerEconomics;
	return Object.freeze({
		exa: Object.freeze({
			incrementMicrousd:
				calls.exaSearch * economics.exa.searchMicrousd +
				calls.exaContents * economics.exa.contentsPageMicrousd,
			limitMicrousd: economics.exa.monthlyPaidOrgSpendCeilingMicrousd
		}),
		firecrawl: Object.freeze({
			incrementCredits: calls.firecrawl * economics.firecrawl.scrapeCreditsPerAttempt,
			limitCredits: economics.firecrawl.monthlyPaidOrgSpendCeilingCredits
		})
	});
}

/**
 * Provider deficit for one fully-used subscription at each marketed org tier.
 * This three-plan sample is a floor, not a cap: every additional fully-used
 * Coalition subscription adds 55,208,000 Exa microusd and 3,296 Firecrawl
 * credits. PAYG authority makes the operator-set monthly ceilings fundable;
 * removing that authority returns this function to the free-credit shortfall.
 * `agenticResolvesMonth` is not currently rendered on any user-facing surface,
 * so this capacity is declared internally but has not yet been promised to a buyer.
 */
export function marketedCapacityShortfall(): MarketedCapacityShortfall {
	const marketedMonthlyResolves = ORG_PLAN_ORDER.reduce(
		(total, slug) => total + ORG_PLAN_LIMITS[slug].agenticResolvesMonth,
		0
	);
	const paidOrgCapacity = policy.paidOrgCapacity;
	const paidOperation = normalizedProviderBundle(
		policy.operations[paidOrgCapacity.operation]!.providerCallBundle
	);
	const economics = policy.providerEconomics;
	const marketedExaMicrousd =
		marketedMonthlyResolves *
		(paidOperation.exaSearch * economics.exa.searchMicrousd +
			paidOperation.exaContents * economics.exa.contentsPageMicrousd);
	const marketedFirecrawlCredits =
		marketedMonthlyResolves * paidOperation.firecrawl * economics.firecrawl.scrapeCreditsPerAttempt;
	const exaFundableMicrousd =
		economics.exa.launchBillingAuthority === PAID_PROVIDER_PAYG_BILLING_AUTHORITY
			? economics.exa.monthlyPaidOrgSpendCeilingMicrousd
			: economics.exa.freeMonthlyCreditMicrousd;
	const firecrawlFundableCredits =
		economics.firecrawl.launchBillingAuthority === PAID_PROVIDER_PAYG_BILLING_AUTHORITY
			? economics.firecrawl.monthlyPaidOrgSpendCeilingCredits
			: economics.firecrawl.freeMonthlyCredits;

	return Object.freeze({
		exaMicrousd: Math.max(0, marketedExaMicrousd - exaFundableMicrousd),
		firecrawlCredits: Math.max(0, marketedFirecrawlCredits - firecrawlFundableCredits)
	});
}

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
		actorMonthlyPublicUnits:
			tier === 'operator' ? null : policy.caps.actorMonthlyPublicUnits[tier],
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
