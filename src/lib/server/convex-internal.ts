import { serverAction, serverMutation, serverQuery } from 'convex-sveltekit';
import type {
	DefaultFunctionArgs,
	FunctionArgs,
	FunctionReference,
	FunctionReturnType
} from 'convex/server';

type InternalQuery<Args extends DefaultFunctionArgs = any, Return = any> = FunctionReference<
	'query',
	'internal',
	Args,
	Return
>;
type InternalMutation<Args extends DefaultFunctionArgs = any, Return = any> = FunctionReference<
	'mutation',
	'internal',
	Args,
	Return
>;
type InternalAction<Args extends DefaultFunctionArgs = any, Return = any> = FunctionReference<
	'action',
	'internal',
	Args,
	Return
>;

type PublicQuery<Query extends InternalQuery> = FunctionReference<
	'query',
	'public',
	FunctionArgs<Query>,
	FunctionReturnType<Query>
>;
type PublicMutation<Mutation extends InternalMutation> = FunctionReference<
	'mutation',
	'public',
	FunctionArgs<Mutation>,
	FunctionReturnType<Mutation>
>;
type PublicAction<Action extends InternalAction> = FunctionReference<
	'action',
	'public',
	FunctionArgs<Action>,
	FunctionReturnType<Action>
>;

export function serverInternalQuery<Query extends InternalQuery>(
	ref: Query,
	args: FunctionArgs<Query>
): Promise<FunctionReturnType<Query>> {
	return serverQuery(ref as unknown as PublicQuery<Query>, args);
}

export function serverInternalMutation<Mutation extends InternalMutation>(
	ref: Mutation,
	args: FunctionArgs<Mutation>
): Promise<FunctionReturnType<Mutation>> {
	return serverMutation(ref as unknown as PublicMutation<Mutation>, args);
}

export function serverInternalAction<Action extends InternalAction>(
	ref: Action,
	args: FunctionArgs<Action>
): Promise<FunctionReturnType<Action>> {
	return serverAction(ref as unknown as PublicAction<Action>, args);
}
