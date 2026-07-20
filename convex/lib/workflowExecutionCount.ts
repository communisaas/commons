import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export const WORKFLOW_EXECUTION_COUNT_VERSION = 1;
export const WORKFLOW_EXECUTION_COUNT_MIGRATION_KEY = 'workflow-execution-count-v1' as const;

export async function getWorkflowExecutionCountMigration(ctx: QueryCtx | MutationCtx) {
	return await ctx.db
		.query('workflowExecutionCountMigrations')
		.withIndex('by_key', (q) => q.eq('key', WORKFLOW_EXECUTION_COUNT_MIGRATION_KEY))
		.unique();
}

/**
 * Fold one newly created or previously-unprojected execution into its parent.
 * The execution marker is written by the caller in the same transaction.
 */
export async function incrementWorkflowExecutionCount(
	ctx: MutationCtx,
	workflowId: Id<'workflows'>
): Promise<boolean> {
	const workflow = await ctx.db.get(workflowId);
	if (!workflow) return false;
	const current =
		workflow.executionCountVersion === WORKFLOW_EXECUTION_COUNT_VERSION
			? (workflow.executionCount ?? 0)
			: 0;
	if (!Number.isSafeInteger(current) || current < 0 || current === Number.MAX_SAFE_INTEGER) {
		throw new Error('WORKFLOW_EXECUTION_COUNT_INVARIANT');
	}
	await ctx.db.patch(workflowId, {
		executionCount: current + 1,
		executionCountVersion: WORKFLOW_EXECUTION_COUNT_VERSION
	});
	return true;
}
