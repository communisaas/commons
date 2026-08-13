import type { RequestEvent } from '@sveltejs/kit';
import { blocked, present, type Fact } from '$lib/core/fact';
import { convexWorkBudgetRealmForConvexUrl } from '$lib/server/convex-work-budget-client';
import type { ConvexWorkBudgetRealm } from '$lib/server/convex-work-budget-policy';
import {
	PAID_PROVIDER_BUDGET_AUTHORITY_ID,
	PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS,
	PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS,
	PAID_PROVIDER_BUDGET_PROTOCOL,
	PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS,
	PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS,
	EXA_PAID_ORG_MONTHLY_CEILING_REASON,
	FIRECRAWL_PAID_ORG_MONTHLY_CEILING_REASON,
	budgetScopeForReason,
	paidProviderBudgetOperationNames,
	paidProviderBudgetPolicyFor,
	type PaidProviderBudgetScope,
	type PaidProviderTrustTier
} from '$lib/server/paid-provider-budget-policy';

export const PAID_PROVIDER_BUDGET_PROTOCOL_HEADER = 'x-paid-provider-budget-protocol' as const;
export const PAID_PROVIDER_BUDGET_TIMEOUT_MS = 750 as const;
const RESERVATION_URL = 'https://convex-work-budget.internal/reserve-provider';
const STATUS_URL = 'https://convex-work-budget.internal/status-provider';
const STATUS_MAXIMUM_BYTES = 16 * 1024;

type ProviderBudgetEvent = Pick<RequestEvent, 'platform'>;

export type PaidOrgProviderGrant = Readonly<{
	orgId: string;
	balanceUnits: number;
	periodStart: number;
	periodEnd: number;
}>;

export type PaidProviderBudgetResult = Readonly<{
	allowed: boolean;
	remaining: number;
	limit: number;
	resetAt: Date;
	status: 200 | 429 | 503;
	providerCeiling: Fact<Readonly<{ withinMonthlyCeilings: true }>>;
	reason?: string;
	/** Whose capacity ran out. Omitted where nothing ran out at all. */
	budgetScope?: PaidProviderBudgetScope;
}>;

export type PaidProviderBudgetBalance = Readonly<{
	limit: number;
	remaining: number;
	resetAt: number;
	used: number;
}>;

type PaidProviderBudgetOperatorReserve = Readonly<{
	available: number;
	protectedLimit: number;
	protectedRemaining: number;
	resetAt: number;
	used: number;
}>;

export type PaidProviderBudgetStatus = Readonly<{
	schema: 1;
	realm: ConvexWorkBudgetRealm;
	observedAt: number;
	global: Readonly<{ daily: PaidProviderBudgetBalance; monthly: PaidProviderBudgetBalance }>;
	public: Readonly<{ daily: PaidProviderBudgetBalance; monthly: PaidProviderBudgetBalance }>;
	operatorReserve: Readonly<{
		daily: PaidProviderBudgetOperatorReserve;
		monthly: PaidProviderBudgetOperatorReserve;
	}>;
	actor: Readonly<{ daily: PaidProviderBudgetBalance }>;
	operations: Readonly<
		Record<
			string,
			Readonly<{
				actorHourly: PaidProviderBudgetBalance;
				publicDaily: PaidProviderBudgetBalance;
				publicMonthly: PaidProviderBudgetBalance;
			}>
		>
	>;
}>;

function unavailable(): PaidProviderBudgetResult {
	return Object.freeze({
		allowed: false,
		remaining: 0,
		limit: 0,
		resetAt: new Date(Date.now() + 60_000),
		status: 503,
		providerCeiling: blocked('paid-provider-monthly-ceiling-admission-unavailable'),
		reason: 'AI capacity is temporarily unavailable. Please try again shortly.',
		budgetScope: 'blocked'
	});
}

export function paidProviderMonthlyCeilingWasReached(
	fact: Fact<Readonly<{ withinMonthlyCeilings: true }>>
): boolean {
	return (
		fact.state === 'blocked' &&
		(fact.why === EXA_PAID_ORG_MONTHLY_CEILING_REASON ||
			fact.why === FIRECRAWL_PAID_ORG_MONTHLY_CEILING_REASON)
	);
}

function nonNegativeInteger(value: string | null): number | null {
	if (value === null || !/^(?:0|[1-9][0-9]*)$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function positiveInteger(value: string | null): number | null {
	const parsed = nonNegativeInteger(value);
	return parsed !== null && parsed > 0 ? parsed : null;
}

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function parseBalance(value: unknown, expectedLimit: number): PaidProviderBudgetBalance | null {
	const balance = record(value);
	if (!balance || !exactKeys(balance, ['limit', 'remaining', 'resetAt', 'used'])) return null;
	const { limit, remaining, resetAt, used } = balance;
	if (
		limit !== expectedLimit ||
		!Number.isSafeInteger(used) ||
		Number(used) < 0 ||
		Number(used) > expectedLimit ||
		remaining !== expectedLimit - Number(used) ||
		!Number.isSafeInteger(resetAt) ||
		Number(resetAt) <= 0
	) {
		return null;
	}
	return {
		limit: expectedLimit,
		remaining: Number(remaining),
		resetAt: Number(resetAt),
		used: Number(used)
	};
}

function parseOperatorReserve(
	value: unknown,
	expected: {
		available: number;
		protectedLimit: number;
		resetAt: number;
		used: number;
	}
): PaidProviderBudgetOperatorReserve | null {
	const reserve = record(value);
	if (
		!reserve ||
		!exactKeys(reserve, ['available', 'protectedLimit', 'protectedRemaining', 'resetAt', 'used']) ||
		reserve.available !== expected.available ||
		reserve.protectedLimit !== expected.protectedLimit ||
		reserve.protectedRemaining !== Math.max(0, expected.protectedLimit - expected.used) ||
		reserve.resetAt !== expected.resetAt ||
		reserve.used !== expected.used
	) {
		return null;
	}
	return reserve as PaidProviderBudgetOperatorReserve;
}

function parsePaidProviderBudgetStatus(
	value: unknown,
	expectedRealm: ConvexWorkBudgetRealm
): PaidProviderBudgetStatus | null {
	const status = record(value);
	if (
		!status ||
		!exactKeys(status, [
			'actor',
			'global',
			'observedAt',
			'operations',
			'operatorReserve',
			'public',
			'realm',
			'schema'
		]) ||
		status.schema !== 1 ||
		status.realm !== expectedRealm ||
		!Number.isSafeInteger(status.observedAt) ||
		Number(status.observedAt) < 0
	) {
		return null;
	}
	const global = record(status.global);
	const publicBudget = record(status.public);
	const actor = record(status.actor);
	const reserve = record(status.operatorReserve);
	if (
		!global ||
		!publicBudget ||
		!actor ||
		!reserve ||
		!exactKeys(global, ['daily', 'monthly']) ||
		!exactKeys(publicBudget, ['daily', 'monthly']) ||
		!exactKeys(actor, ['daily']) ||
		!exactKeys(reserve, ['daily', 'monthly'])
	) {
		return null;
	}
	const globalDaily = parseBalance(global.daily, PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS);
	const globalMonthly = parseBalance(global.monthly, PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS);
	const publicDaily = parseBalance(publicBudget.daily, PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS);
	const publicMonthly = parseBalance(
		publicBudget.monthly,
		PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS
	);
	if (!globalDaily || !globalMonthly || !publicDaily || !publicMonthly) return null;
	if (
		publicDaily.used > globalDaily.used ||
		publicMonthly.used > globalMonthly.used ||
		publicDaily.resetAt !== globalDaily.resetAt ||
		publicMonthly.resetAt !== globalMonthly.resetAt
	) {
		return null;
	}

	const operationNames = paidProviderBudgetOperationNames();
	const operations = record(status.operations);
	if (!operations || !exactKeys(operations, operationNames)) return null;
	const parsedOperations: Record<
		string,
		{
			actorHourly: PaidProviderBudgetBalance;
			publicDaily: PaidProviderBudgetBalance;
			publicMonthly: PaidProviderBudgetBalance;
		}
	> = {};
	let actorDailyLimit: number | null = null;
	for (const operation of operationNames) {
		const policy = paidProviderBudgetPolicyFor(operation, 'operator');
		const operationStatus = record(operations[operation]);
		if (
			!policy ||
			!operationStatus ||
			!exactKeys(operationStatus, ['actorHourly', 'publicDaily', 'publicMonthly'])
		) {
			return null;
		}
		actorDailyLimit ??= policy.actorDailyReservations;
		if (actorDailyLimit !== policy.actorDailyReservations) return null;
		const actorHourly = parseBalance(operationStatus.actorHourly, policy.hourlyReservations);
		const operationPublicDaily = parseBalance(operationStatus.publicDaily, policy.publicDailyUnits);
		const operationPublicMonthly = parseBalance(
			operationStatus.publicMonthly,
			policy.publicMonthlyUnits
		);
		if (
			!actorHourly ||
			!operationPublicDaily ||
			!operationPublicMonthly ||
			actorHourly.resetAt > globalDaily.resetAt ||
			operationPublicDaily.resetAt !== globalDaily.resetAt ||
			operationPublicMonthly.resetAt !== globalMonthly.resetAt
		) {
			return null;
		}
		parsedOperations[operation] = {
			actorHourly,
			publicDaily: operationPublicDaily,
			publicMonthly: operationPublicMonthly
		};
	}
	if (actorDailyLimit === null) return null;
	const actorDaily = parseBalance(actor.daily, actorDailyLimit);
	if (!actorDaily || actorDaily.resetAt !== globalDaily.resetAt) return null;
	const operatorDailyUsed = globalDaily.used - publicDaily.used;
	const operatorMonthlyUsed = globalMonthly.used - publicMonthly.used;
	const operatorDaily = parseOperatorReserve(reserve.daily, {
		available: globalDaily.remaining,
		protectedLimit:
			PAID_PROVIDER_BUDGET_GLOBAL_DAILY_UNITS - PAID_PROVIDER_BUDGET_PUBLIC_DAILY_UNITS,
		resetAt: globalDaily.resetAt,
		used: operatorDailyUsed
	});
	const operatorMonthly = parseOperatorReserve(reserve.monthly, {
		available: globalMonthly.remaining,
		protectedLimit:
			PAID_PROVIDER_BUDGET_GLOBAL_MONTHLY_UNITS - PAID_PROVIDER_BUDGET_PUBLIC_MONTHLY_UNITS,
		resetAt: globalMonthly.resetAt,
		used: operatorMonthlyUsed
	});
	if (!operatorDaily || !operatorMonthly) return null;

	return {
		schema: 1,
		realm: expectedRealm,
		observedAt: Number(status.observedAt),
		global: { daily: globalDaily, monthly: globalMonthly },
		public: { daily: publicDaily, monthly: publicMonthly },
		operatorReserve: { daily: operatorDaily, monthly: operatorMonthly },
		actor: { daily: actorDaily },
		operations: parsedOperations
	};
}

async function boundedResponseJson(response: Response): Promise<unknown> {
	const declared = response.headers.get('content-length');
	if (
		declared !== null &&
		(!/^(?:0|[1-9][0-9]*)$/.test(declared) || Number(declared) > STATUS_MAXIMUM_BYTES)
	) {
		await response.body?.cancel().catch(() => undefined);
		throw new Error('PAID_PROVIDER_STATUS_RESPONSE_INVALID');
	}
	if (!response.body) throw new Error('PAID_PROVIDER_STATUS_RESPONSE_INVALID');
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > STATUS_MAXIMUM_BYTES) {
				await reader.cancel().catch(() => undefined);
				throw new Error('PAID_PROVIDER_STATUS_RESPONSE_INVALID');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch {
		throw new Error('PAID_PROVIDER_STATUS_RESPONSE_INVALID');
	}
}

export function paidProviderBudgetCoordinatorName(): string {
	return `paid-provider-budget:authority:${PAID_PROVIDER_BUDGET_AUTHORITY_ID}`;
}

export async function paidProviderActorHash(identifier: string): Promise<string | null> {
	if (identifier.length < 1 || identifier.length > 512) return null;
	const bytes = new TextEncoder().encode(`commons:paid-provider-budget:v1:${identifier}`);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function paidProviderOrgHash(orgId: string): Promise<string | null> {
	if (orgId.length < 1 || orgId.length > 512) return null;
	const bytes = new TextEncoder().encode(`commons:paid-provider-org:v1:${orgId}`);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function realmFor(event: ProviderBudgetEvent): ConvexWorkBudgetRealm | null {
	return convexWorkBudgetRealmForConvexUrl(event.platform?.env?.PUBLIC_CONVEX_URL);
}

export async function reservePaidProviderBudget(input: {
	event: ProviderBudgetEvent;
	identifier: string;
	operation: string;
	tier: PaidProviderTrustTier;
	paidOrg?: PaidOrgProviderGrant;
	timeoutMs?: number;
}): Promise<PaidProviderBudgetResult> {
	const reviewed = paidProviderBudgetPolicyFor(input.operation, input.tier);
	if (!reviewed) return unavailable();
	const namespace = input.event.platform?.env?.CONVEX_WORK_BUDGET;
	const realm = realmFor(input.event);
	const actorHash = await paidProviderActorHash(input.identifier);
	const paidOrg = input.paidOrg;
	const orgHash = paidOrg ? await paidProviderOrgHash(paidOrg.orgId) : null;
	if (
		!namespace ||
		!realm ||
		!actorHash ||
		(paidOrg !== undefined &&
			(!orgHash ||
				input.operation !== 'decision-makers' ||
				!Number.isSafeInteger(paidOrg.balanceUnits) ||
				paidOrg.balanceUnits <= 0 ||
				!Number.isSafeInteger(paidOrg.periodStart) ||
				!Number.isSafeInteger(paidOrg.periodEnd) ||
				paidOrg.periodStart < 0 ||
				paidOrg.periodEnd <= paidOrg.periodStart))
	) {
		return unavailable();
	}

	let response: Response;
	try {
		const id = namespace.idFromName(paidProviderBudgetCoordinatorName());
		response = await namespace.get(id).fetch(
			new Request(RESERVATION_URL, {
				body: JSON.stringify({
					actorHash,
					operation: input.operation,
					realm,
					tier: input.tier,
					...(paidOrg && orgHash
						? {
								paidOrg: {
									orgHash,
									balanceUnits: paidOrg.balanceUnits,
									periodStart: paidOrg.periodStart,
									periodEnd: paidOrg.periodEnd
								}
							}
						: {})
				}),
				headers: {
					'content-type': 'application/json',
					[PAID_PROVIDER_BUDGET_PROTOCOL_HEADER]: PAID_PROVIDER_BUDGET_PROTOCOL
				},
				method: 'POST',
				signal: AbortSignal.timeout(input.timeoutMs ?? PAID_PROVIDER_BUDGET_TIMEOUT_MS)
			})
		);
	} catch {
		return unavailable();
	}

	if (
		response.headers.get(PAID_PROVIDER_BUDGET_PROTOCOL_HEADER) !== PAID_PROVIDER_BUDGET_PROTOCOL
	) {
		return unavailable();
	}
	const operationRemaining = nonNegativeInteger(
		response.headers.get('x-paid-provider-operation-remaining')
	);
	const actorDailyRemaining = nonNegativeInteger(
		response.headers.get('x-paid-provider-actor-daily-remaining')
	);
	const resetAtSeconds = positiveInteger(response.headers.get('x-paid-provider-reset-at'));
	if (
		operationRemaining === null ||
		actorDailyRemaining === null ||
		resetAtSeconds === null ||
		operationRemaining > reviewed.hourlyReservations ||
		actorDailyRemaining > reviewed.actorDailyReservations
	) {
		return unavailable();
	}

	const remaining = Math.min(operationRemaining, actorDailyRemaining);
	const resetAt = new Date(resetAtSeconds * 1_000);
	if (response.status === 200) {
		return Object.freeze({
			allowed: true,
			remaining,
			limit: reviewed.hourlyReservations,
			resetAt,
			status: 200,
			providerCeiling: present({ withinMonthlyCeilings: true as const })
		});
	}
	if (response.status !== 429) return unavailable();
	const retryAfter = positiveInteger(response.headers.get('retry-after'));
	if (retryAfter === null) return unavailable();
	const budgetReason = response.headers.get('x-paid-provider-budget-reason');
	const providerCeiling =
		budgetReason === EXA_PAID_ORG_MONTHLY_CEILING_REASON ||
		budgetReason === FIRECRAWL_PAID_ORG_MONTHLY_CEILING_REASON
			? blocked(budgetReason)
			: present({ withinMonthlyCeilings: true as const });
	return Object.freeze({
		allowed: false,
		remaining,
		limit: reviewed.hourlyReservations,
		resetAt,
		status: 429,
		providerCeiling,
		reason: 'AI capacity limit reached. Please try again after the reset time.',
		budgetScope: budgetScopeForReason(budgetReason)
	});
}

export async function readPaidProviderBudgetStatus(input: {
	event: ProviderBudgetEvent;
	identifier: string;
	timeoutMs?: number;
}): Promise<PaidProviderBudgetStatus | null> {
	const namespace = input.event.platform?.env?.CONVEX_WORK_BUDGET;
	const realm = realmFor(input.event);
	const actorHash = await paidProviderActorHash(input.identifier);
	if (!namespace || !realm || !actorHash) return null;
	try {
		const id = namespace.idFromName(paidProviderBudgetCoordinatorName());
		const response = await namespace.get(id).fetch(
			new Request(STATUS_URL, {
				body: JSON.stringify({ actorHash, realm }),
				headers: {
					'content-type': 'application/json',
					[PAID_PROVIDER_BUDGET_PROTOCOL_HEADER]: PAID_PROVIDER_BUDGET_PROTOCOL
				},
				method: 'POST',
				signal: AbortSignal.timeout(input.timeoutMs ?? PAID_PROVIDER_BUDGET_TIMEOUT_MS)
			})
		);
		if (
			response.status !== 200 ||
			response.headers.get(PAID_PROVIDER_BUDGET_PROTOCOL_HEADER) !==
				PAID_PROVIDER_BUDGET_PROTOCOL ||
			!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')
		) {
			await response.body?.cancel().catch(() => undefined);
			return null;
		}
		return parsePaidProviderBudgetStatus(await boundedResponseJson(response), realm);
	} catch {
		return null;
	}
}
