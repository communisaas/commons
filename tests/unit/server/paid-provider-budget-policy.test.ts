import { describe, expect, it } from 'vitest';

import {
	EXA_PAID_ORG_MONTHLY_SPEND_CEILING_MICROUSD,
	EXA_CONTENTS_PAGE_MICROUSD,
	EXA_FREE_MONTHLY_CREDIT_MICROUSD,
	EXA_SEARCH_MICROUSD,
	FIRECRAWL_PAID_ORG_MONTHLY_SPEND_CEILING_CREDITS,
	FIRECRAWL_FREE_MONTHLY_CREDITS,
	PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS,
	PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS,
	PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS,
	PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS,
	PAID_PROVIDER_PAYG_BILLING_AUTHORITY,
	marketedCapacityShortfall,
	paidOrgProviderMonthlyCeilings,
	paidProviderBudgetOperationNames,
	paidProviderBudgetPolicyFor
} from '../../../src/lib/server/paid-provider-budget-policy';
import {
	CONVEX_WORK_BUDGET_CLASS_UNITS,
	CONVEX_WORK_BUDGET_DAILY_CAP_UNITS
} from '../../../src/lib/server/convex-work-budget-policy';
import policy from '../../../config/paid-provider-budget-policy.json';

describe('paid provider budget policy', () => {
	it('has an exact reviewed operation inventory with no permissive default', () => {
		expect(paidProviderBudgetOperationNames()).toEqual([
			'decision-makers',
			'delegation-policy',
			'embedding-backfill',
			'embeddings',
			'message-generation',
			'moderation-check',
			'moderation-personalization',
			'subject-line',
			'template-authoring'
		]);
		expect(paidProviderBudgetPolicyFor('unreviewed-provider-work', 'authenticated')).toBeNull();
	});

	it('keeps actor ceilings independent of payment and weights expensive fanout conservatively', () => {
		expect(paidProviderBudgetPolicyFor('decision-makers', 'authenticated')).toMatchObject({
			actorDailyReservations: 10,
			hourlyReservations: 2,
			weightUnits: 166
		});
		expect(paidProviderBudgetPolicyFor('decision-makers', 'verified')).toMatchObject({
			actorDailyReservations: 15,
			hourlyReservations: 3,
			weightUnits: 166
		});
		expect(paidProviderBudgetPolicyFor('decision-makers', 'operator')).toMatchObject({
			actorDailyReservations: 15,
			hourlyReservations: 3,
			publicDailyUnits: 600,
			publicMonthlyUnits: 1_800,
			providerCallBundle: {
				dnsMx: 12,
				exaContents: 32,
				exaSearch: 72,
				firecrawl: 32,
				gemini: 13,
				groq: 1
			},
			weightUnits: 166
		});
		expect(paidProviderBudgetPolicyFor('embedding-backfill', 'verified')?.weightUnits).toBe(100);
	});

	it('sets a hard shared launch ceiling across every authenticated actor and realm', () => {
		expect(PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS).toBe(1_000);
		expect(PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS).toBe(2_400);
		expect(PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS).toBe(750);
		expect(PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS).toBe(1_800);
		// The two numbers bound to provider spend. Dividing the free lane into
		// per-actor shares must never move either of them.
		expect(policy.caps.globalDailyUnits).toBe(1_000);
		expect(policy.caps.globalMonthlyUnits).toBe(2_400);
		expect(PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS).toBeLessThan(
			PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS
		);
		expect(
			PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS - PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS
		).toBeGreaterThanOrEqual(224);
		expect(
			PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS - PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS
		).toBeGreaterThanOrEqual(2 * 224);
	});

	it('gives every public-pool tier a monthly share worth at least one complete journey', () => {
		// These are production consumers, not operation-inventory guesses:
		// UnifiedObjectiveEntry.svelte:320 -> stream-subject/+server.ts:54
		// DecisionMakerResolver.svelte:130 -> stream-decision-makers/+server.ts:138
		// MessageGenerationResolver.svelte:422 -> stream-message/+server.ts:189
		// personal-connection.ts:33 -> moderation/personalization/+server.ts:72
		// templates.svelte.ts:14 -> templates/+server.ts:841
		const journeyUnits = [
			'subject-line',
			'decision-makers',
			'message-generation',
			'moderation-personalization',
			'template-authoring'
		].reduce(
			(total, operation) =>
				total + paidProviderBudgetPolicyFor(operation, 'authenticated')!.weightUnits,
			0
		);

		// 20 + 166 + 50 + 2 + 5 = 243. The verified tier carries two
		// complete journeys, so neither tier is stranded after spending units.
		expect(journeyUnits).toBe(243);
		expect(policy.caps.actorMonthlyPublicUnits).toEqual({ authenticated: 243, verified: 486 });
		expect(Object.keys(policy.caps.actorMonthlyPublicUnits).sort()).toEqual([
			'authenticated',
			'verified'
		]);

		for (const tier of ['authenticated', 'verified'] as const) {
			const share = paidProviderBudgetPolicyFor('decision-makers', tier)!.actorMonthlyPublicUnits;
			expect(share, tier).toBeGreaterThanOrEqual(journeyUnits);
			expect(share, tier).toBeLessThanOrEqual(PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS);
		}
		expect(
			paidProviderBudgetPolicyFor('decision-makers', 'authenticated')!.actorMonthlyPublicUnits
		).toBeLessThanOrEqual(
			paidProviderBudgetPolicyFor('decision-makers', 'verified')!.actorMonthlyPublicUnits!
		);
		// Operators do not draw the public pool at all, so there is no share to
		// report — `null`, never a sentinel count that reads like a budget.
		expect(
			paidProviderBudgetPolicyFor('decision-makers', 'operator')!.actorMonthlyPublicUnits
		).toBeNull();
	});

	it('declares the Cloudflare rows the admitting object actually reads and writes', () => {
		const envelope = policy.cloudflareEnvelope;
		expect(envelope.sqliteRowsReadPerAttempt).toBe(9);
		expect(envelope.sqliteRowsWrittenPerAdmission).toBe(9);

		const maximumConvexAdmissions =
			CONVEX_WORK_BUDGET_DAILY_CAP_UNITS / CONVEX_WORK_BUDGET_CLASS_UNITS.control;
		expect(maximumConvexAdmissions).toBe(40_960);
		expect(
			maximumConvexAdmissions * 2 +
				PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS * envelope.sqliteRowsWrittenPerAdmission
		).toBeLessThanOrEqual(envelope.sqliteDailyRowsWrittenFreeLimit);
		expect(
			envelope.workerDailyRequestFreeLimit * envelope.sqliteRowsReadPerAttempt
		).toBeLessThanOrEqual(envelope.sqliteDailyRowsReadFreeLimit);
	});

	it('keeps every monthly operation mix below Exa and Firecrawl free allowances', () => {
		const operations = paidProviderBudgetOperationNames().map((operation) => {
			const entry = paidProviderBudgetPolicyFor(operation, 'operator');
			expect(entry, operation).not.toBeNull();
			return entry!;
		});
		const maxExaMicrousdPerUnit = Math.max(
			...operations.map(
				(entry) =>
					(entry.providerCallBundle.exaSearch * EXA_SEARCH_MICROUSD +
						entry.providerCallBundle.exaContents * EXA_CONTENTS_PAGE_MICROUSD) /
					entry.weightUnits
			)
		);
		const maxFirecrawlCreditsPerUnit = Math.max(
			...operations.map((entry) => entry.providerCallBundle.firecrawl / entry.weightUnits)
		);

		expect(
			paidProviderBudgetPolicyFor('decision-makers', 'operator')!.providerCallBundle
		).toMatchObject({ exaSearch: 72, exaContents: 32, firecrawl: 32 });
		expect(
			paidProviderBudgetPolicyFor('message-generation', 'operator')!.providerCallBundle
		).toMatchObject({ exaSearch: 9, exaContents: 12, firecrawl: 12 });
		expect(PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS * maxExaMicrousdPerUnit).toBeCloseTo(
			7_749_397.590361446
		);
		expect(PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS * maxExaMicrousdPerUnit).toBeLessThanOrEqual(
			EXA_FREE_MONTHLY_CREDIT_MICROUSD * 0.85
		);
		expect(PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS * maxFirecrawlCreditsPerUnit).toBe(576);
		expect(
			PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS * maxFirecrawlCreditsPerUnit
		).toBeLessThanOrEqual(FIRECRAWL_FREE_MONTHLY_CREDITS * 0.8);
	});

	it('funds marketed capacity only after explicit PAYG authority and below finite monthly ceilings', () => {
		expect(policy.providerEconomics.exa).toMatchObject({
			launchBillingAuthority: PAID_PROVIDER_PAYG_BILLING_AUTHORITY,
			monthlyPaidOrgSpendCeilingMicrousd: EXA_PAID_ORG_MONTHLY_SPEND_CEILING_MICROUSD,
			operatorActivationDependency: expect.stringContaining('Exa dashboard')
		});
		expect(policy.providerEconomics.firecrawl).toMatchObject({
			launchBillingAuthority: PAID_PROVIDER_PAYG_BILLING_AUTHORITY,
			monthlyPaidOrgSpendCeilingCredits: FIRECRAWL_PAID_ORG_MONTHLY_SPEND_CEILING_CREDITS,
			operatorActivationDependency: expect.stringContaining('Firecrawl dashboard')
		});
		expect(policy.providerEconomics.gemini.launchBillingAuthority).toBe(
			'free-plan-billing-disabled-no-payg'
		);
		expect(policy.providerEconomics.groq.launchBillingAuthority).toBe(
			'free-plan-billing-disabled-no-payg'
		);

		const ceilings = paidOrgProviderMonthlyCeilings();
		expect(ceilings).toEqual({
			exa: {
				incrementMicrousd: 536_000,
				limitMicrousd: EXA_PAID_ORG_MONTHLY_SPEND_CEILING_MICROUSD
			},
			firecrawl: {
				incrementCredits: 32,
				limitCredits: FIRECRAWL_PAID_ORG_MONTHLY_SPEND_CEILING_CREDITS
			}
		});
		const marketedResolves = 146;
		expect(marketedResolves * ceilings.exa.incrementMicrousd).toBe(78_256_000);
		expect(marketedResolves * ceilings.firecrawl.incrementCredits).toBe(4_672);
		expect(marketedResolves * ceilings.exa.incrementMicrousd).toBeLessThan(
			ceilings.exa.limitMicrousd
		);
		expect(marketedResolves * ceilings.firecrawl.incrementCredits).toBeLessThan(
			ceilings.firecrawl.limitCredits
		);

		const shortfall = marketedCapacityShortfall();
		expect(
			shortfall,
			`MARKETED_PAID_CAPACITY_UNFUNDED: one fully-used subscription at each marketed tier ` +
				`has Exa shortfall ${shortfall.exaMicrousd} microusd and Firecrawl shortfall ` +
				`${shortfall.firecrawlCredits} credits; this is a floor, not a cap`
		).toEqual({ exaMicrousd: 0, firecrawlCredits: 0 });
	});

	it('caps paid-provider monthly draw at the reviewed runaway-spend bounds', () => {
		expect(EXA_PAID_ORG_MONTHLY_SPEND_CEILING_MICROUSD).toBeLessThanOrEqual(100_000_000);
		expect(FIRECRAWL_PAID_ORG_MONTHLY_SPEND_CEILING_CREDITS).toBeLessThanOrEqual(6_000);
	});
});
