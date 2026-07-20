import {
	CONVEX_WORK_BUDGET_DAILY_CAP_UNITS,
	CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS,
	CONVEX_WORK_BUDGET_COORDINATOR_GENERATION,
	CONVEX_WORK_BUDGET_PROTOCOL,
	CONVEX_WORK_BUDGET_REALMS,
	CONVEX_WORK_BUDGET_TEAM_AUTHORITY_ID,
	convexWorkBudgetPolicyFor,
	type ConvexServerOperationKind,
	type ConvexWorkBudgetRealm
} from '$lib/server/convex-work-budget-policy';

export const CONVEX_WORK_BUDGET_BINDING = 'CONVEX_WORK_BUDGET' as const;
export const CONVEX_WORK_BUDGET_PROTOCOL_HEADER = 'x-convex-work-budget-protocol' as const;
export const CONVEX_WORK_BUDGET_TIMEOUT_MS = 750 as const;
const RESERVATION_URL = 'https://convex-work-budget.internal/reserve';

type BudgetLocals = {
	convexWorkBudgetObservation?: ConvexWorkBudgetObservation;
	convexWorkBudgetRejection?: ConvexWorkBudgetRejection;
	convexWorkBudgetReservations?: Set<Promise<void>>;
};

type BudgetPlatform = {
	env?: {
		CONVEX_WORK_BUDGET?: DurableObjectNamespace;
		PUBLIC_CONVEX_URL?: string;
	};
};

export type ConvexWorkBudgetEvent = {
	locals: BudgetLocals;
	platform?: BudgetPlatform;
};

export type ConvexWorkBudgetObservation = Readonly<{
	dailyRemainingUnits: number;
	dailyResetAtSeconds: number;
	monthlyRemainingUnits: number;
	monthlyResetAtSeconds: number;
}>;

export type ConvexWorkBudgetRejection = Readonly<{
	code: 'CONVEX_WORK_BUDGET_EXHAUSTED' | 'CONVEX_WORK_BUDGET_UNAVAILABLE';
	observation?: ConvexWorkBudgetObservation;
	retryAfterSeconds: number;
	status: 429 | 503;
}>;

export class ConvexWorkBudgetError extends Error {
	readonly rejection: ConvexWorkBudgetRejection;

	constructor(rejection: ConvexWorkBudgetRejection) {
		super(rejection.code);
		this.name = 'ConvexWorkBudgetError';
		this.rejection = rejection;
	}
}

function unavailable(retryAfterSeconds = 60): ConvexWorkBudgetError {
	return new ConvexWorkBudgetError(
		Object.freeze({
			code: 'CONVEX_WORK_BUDGET_UNAVAILABLE',
			retryAfterSeconds,
			status: 503
		})
	);
}

function nonnegativeSafeInteger(value: string | null): number | null {
	if (value === null || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function positiveSafeInteger(value: string | null): number | null {
	const parsed = nonnegativeSafeInteger(value);
	return parsed !== null && parsed > 0 ? parsed : null;
}

function parseObservation(headers: Headers): ConvexWorkBudgetObservation | null {
	const dailyRemainingUnits = nonnegativeSafeInteger(headers.get('x-budget-daily-remaining'));
	const dailyResetAtSeconds = positiveSafeInteger(headers.get('x-budget-daily-reset-at'));
	const monthlyRemainingUnits = nonnegativeSafeInteger(headers.get('x-budget-monthly-remaining'));
	const monthlyResetAtSeconds = positiveSafeInteger(headers.get('x-budget-monthly-reset-at'));
	if (
		dailyRemainingUnits === null ||
		dailyRemainingUnits > CONVEX_WORK_BUDGET_DAILY_CAP_UNITS ||
		dailyResetAtSeconds === null ||
		monthlyRemainingUnits === null ||
		monthlyRemainingUnits > CONVEX_WORK_BUDGET_MONTHLY_CAP_UNITS ||
		monthlyResetAtSeconds === null
	) {
		return null;
	}
	return Object.freeze({
		dailyRemainingUnits,
		dailyResetAtSeconds,
		monthlyRemainingUnits,
		monthlyResetAtSeconds
	});
}

function recordObservation(locals: BudgetLocals, observation: ConvexWorkBudgetObservation): void {
	const current = locals.convexWorkBudgetObservation;
	locals.convexWorkBudgetObservation = current
		? Object.freeze({
				dailyRemainingUnits: Math.min(current.dailyRemainingUnits, observation.dailyRemainingUnits),
				dailyResetAtSeconds: observation.dailyResetAtSeconds,
				monthlyRemainingUnits: Math.min(
					current.monthlyRemainingUnits,
					observation.monthlyRemainingUnits
				),
				monthlyResetAtSeconds: observation.monthlyResetAtSeconds
			})
		: observation;
}

export function convexWorkBudgetRealmForConvexUrl(value: unknown): ConvexWorkBudgetRealm | null {
	if (typeof value !== 'string') return null;
	try {
		const url = new URL(value);
		if (
			url.protocol !== 'https:' ||
			url.username ||
			url.password ||
			url.port ||
			url.pathname !== '/' ||
			url.search ||
			url.hash ||
			!url.hostname.endsWith('.convex.cloud')
		) {
			return null;
		}
		for (const [realm, hostname] of Object.entries(CONVEX_WORK_BUDGET_REALMS)) {
			if (url.hostname === hostname) return realm as ConvexWorkBudgetRealm;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Both Convex deployments spend one shared Free-plan team quota. Every Pages
 * realm therefore addresses the same named object in the same external
 * Durable Object namespace. A generation bump is a reviewed coordinator
 * migration, never a per-backend reset.
 */
export function convexWorkBudgetCoordinatorNameForGeneration(generation: string): string | null {
	if (!/^v[1-9][0-9]*$/.test(generation)) return null;
	// The generation is validated but deliberately excluded from object identity.
	// Schema generations migrate the one existing ledger in place; selecting a
	// fresh object would mint another monthly allowance.
	return `convex-work-budget:team-authority:${CONVEX_WORK_BUDGET_TEAM_AUTHORITY_ID}`;
}

function rememberRejection(event: ConvexWorkBudgetEvent, error: ConvexWorkBudgetError): never {
	event.locals.convexWorkBudgetRejection ??= error.rejection;
	throw error;
}

export function trackConvexWorkBudgetReservation(
	event: ConvexWorkBudgetEvent,
	reservation: Promise<void>
): void {
	const reservations = (event.locals.convexWorkBudgetReservations ??= new Set());
	reservations.add(reservation);
	void reservation.finally(() => reservations.delete(reservation)).catch(() => undefined);
}

/** Reserve once, immediately before the corresponding Convex operation. */
export async function reserveConvexWorkForEvent(input: {
	event: ConvexWorkBudgetEvent;
	kind: ConvexServerOperationKind;
	localBypass: boolean;
	operation: string;
	timeoutMs?: number;
}): Promise<void> {
	const { event, kind, localBypass, operation } = input;
	const reviewed = convexWorkBudgetPolicyFor(operation, kind);
	if (!reviewed) rememberRejection(event, unavailable());
	if (localBypass && event.platform?.env === undefined) return;

	const realm = convexWorkBudgetRealmForConvexUrl(event.platform?.env?.PUBLIC_CONVEX_URL);
	const coordinatorName = convexWorkBudgetCoordinatorNameForGeneration(
		CONVEX_WORK_BUDGET_COORDINATOR_GENERATION
	);
	const namespace = event.platform?.env?.CONVEX_WORK_BUDGET;
	if (!realm || !coordinatorName || !namespace) rememberRejection(event, unavailable());

	let response: Response;
	try {
		const id = namespace.idFromName(coordinatorName);
		const stub = namespace.get(id);
		response = await stub.fetch(
			new Request(RESERVATION_URL, {
				body: JSON.stringify({ kind, operation, realm }),
				headers: {
					'content-type': 'application/json',
					[CONVEX_WORK_BUDGET_PROTOCOL_HEADER]: CONVEX_WORK_BUDGET_PROTOCOL
				},
				method: 'POST',
				signal: AbortSignal.timeout(input.timeoutMs ?? CONVEX_WORK_BUDGET_TIMEOUT_MS)
			})
		);
	} catch {
		rememberRejection(event, unavailable());
	}

	if (response.headers.get(CONVEX_WORK_BUDGET_PROTOCOL_HEADER) !== CONVEX_WORK_BUDGET_PROTOCOL) {
		rememberRejection(event, unavailable());
	}
	const observation = parseObservation(response.headers);
	if (!observation) rememberRejection(event, unavailable());
	recordObservation(event.locals, observation);

	if (response.status === 200) return;
	if (response.status === 429) {
		const retryAfterSeconds = positiveSafeInteger(response.headers.get('retry-after'));
		if (retryAfterSeconds === null) rememberRejection(event, unavailable());
		rememberRejection(
			event,
			new ConvexWorkBudgetError(
				Object.freeze({
					code: 'CONVEX_WORK_BUDGET_EXHAUSTED',
					observation,
					retryAfterSeconds,
					status: 429
				})
			)
		);
	}
	rememberRejection(event, unavailable());
}

export async function executeBudgetedConvexOperationForEvent<Result>(input: {
	event: ConvexWorkBudgetEvent;
	execute: () => Promise<Result>;
	kind: ConvexServerOperationKind;
	localBypass: boolean;
	operation: string;
	timeoutMs?: number;
}): Promise<Result> {
	const reservation = reserveConvexWorkForEvent(input);
	trackConvexWorkBudgetReservation(input.event, reservation);
	await reservation;
	return input.execute();
}

export async function waitForConvexWorkBudgetReservations(
	event: ConvexWorkBudgetEvent
): Promise<void> {
	const reservations = event.locals.convexWorkBudgetReservations;
	if (!reservations?.size) return;
	await Promise.allSettled([...reservations]);
}
