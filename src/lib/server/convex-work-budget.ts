import { getRequestEvent } from '$app/server';
import {
	getFunctionName,
	type FunctionArgs,
	type FunctionReference,
	type FunctionReturnType
} from 'convex/server';
import {
	initConvex,
	serverAction as unbudgetedServerAction,
	serverMutation as unbudgetedServerMutation,
	serverQuery as unbudgetedServerQuery
} from 'convex-sveltekit';
import {
	executeBudgetedConvexOperationForEvent,
	type ConvexWorkBudgetEvent
} from '$lib/server/convex-work-budget-client';
import type { ConvexServerOperationKind } from '$lib/server/convex-work-budget-policy';

export { initConvex };

const LOCAL_BYPASS = import.meta.env.DEV || import.meta.env.MODE === 'test';

async function executeBudgeted<Result>(
	kind: ConvexServerOperationKind,
	ref: FunctionReference<ConvexServerOperationKind>,
	execute: () => Promise<Result>
): Promise<Result> {
	let event: ConvexWorkBudgetEvent;
	try {
		event = getRequestEvent() as ConvexWorkBudgetEvent;
	} catch (cause) {
		if (LOCAL_BYPASS) return execute();
		throw new Error('CONVEX_WORK_BUDGET_REQUEST_CONTEXT_UNAVAILABLE', { cause });
	}
	return executeBudgetedConvexOperationForEvent({
		event,
		execute,
		kind,
		localBypass: LOCAL_BYPASS,
		operation: getFunctionName(ref)
	});
}

export function serverQuery<Query extends FunctionReference<'query'>>(
	ref: Query,
	args: FunctionArgs<Query>
): Promise<FunctionReturnType<Query>> {
	return executeBudgeted('query', ref, () => unbudgetedServerQuery(ref, args));
}

export function serverMutation<Mutation extends FunctionReference<'mutation'>>(
	ref: Mutation,
	args: FunctionArgs<Mutation>
): Promise<FunctionReturnType<Mutation>> {
	return executeBudgeted('mutation', ref, () => unbudgetedServerMutation(ref, args));
}

export function serverAction<Action extends FunctionReference<'action'>>(
	ref: Action,
	args: FunctionArgs<Action>
): Promise<FunctionReturnType<Action>> {
	return executeBudgeted('action', ref, () => unbudgetedServerAction(ref, args));
}

/** Budget an exceptional request-local ConvexHttpClient call (the timed health probe). */
export function budgetedServerQuery<Query extends FunctionReference<'query'>>(
	ref: Query,
	execute: () => Promise<FunctionReturnType<Query>>
): Promise<FunctionReturnType<Query>> {
	return executeBudgeted('query', ref, execute);
}
