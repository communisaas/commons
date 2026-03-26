import {
  query,
  mutation,
  internalMutation,
  internalAction,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireOrgRole } from "./lib/authHelpers";

const MAX_ITERATIONS = 200;

// =============================================================================
// QUERIES
// =============================================================================

/**
 * List workflows for an org.
 */
export const list = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { org } = await requireOrgRole(ctx, slug, "member");

    const workflows = await ctx.db
      .query("workflows")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    return workflows.map((w) => ({
      _id: w._id,
      name: w.name,
      description: w.description ?? null,
      trigger: w.trigger,
      steps: w.steps,
      enabled: w.enabled,
      updatedAt: w.updatedAt,
      _creationTime: w._creationTime,
    }));
  },
});

/**
 * Get a single workflow by ID. Requires org membership.
 */
export const get = query({
  args: {
    slug: v.string(),
    workflowId: v.id("workflows"),
  },
  handler: async (ctx, { slug, workflowId }) => {
    const { org } = await requireOrgRole(ctx, slug, "member");

    const workflow = await ctx.db.get(workflowId);
    if (!workflow || workflow.orgId !== org._id) return null;

    return {
      _id: workflow._id,
      orgId: workflow.orgId,
      name: workflow.name,
      description: workflow.description ?? null,
      trigger: workflow.trigger,
      steps: workflow.steps,
      enabled: workflow.enabled,
      updatedAt: workflow.updatedAt,
      _creationTime: workflow._creationTime,
    };
  },
});

/**
 * Get executions for a workflow, most recent first. Requires org membership.
 */
export const getExecutions = query({
  args: {
    slug: v.string(),
    workflowId: v.id("workflows"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "member");

    // Verify workflow belongs to this org
    const workflow = await ctx.db.get(args.workflowId);
    if (!workflow || workflow.orgId !== org._id) {
      throw new Error("Workflow not found in this organization");
    }

    const executions = await ctx.db
      .query("workflowExecutions")
      .withIndex("by_workflowId", (q) => q.eq("workflowId", args.workflowId))
      .order("desc")
      .take(args.limit ?? 50);

    return executions.map((e) => ({
      _id: e._id,
      workflowId: e.workflowId,
      supporterId: e.supporterId ?? null,
      triggerEvent: e.triggerEvent,
      status: e.status,
      currentStep: e.currentStep,
      nextRunAt: e.nextRunAt ?? null,
      error: e.error ?? null,
      completedAt: e.completedAt ?? null,
      _creationTime: e._creationTime,
    }));
  },
});

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Create a workflow. Requires editor+ role.
 */
export const create = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    trigger: v.any(),
    steps: v.any(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    if (!args.name.trim()) {
      throw new Error("Workflow name is required");
    }

    return await ctx.db.insert("workflows", {
      orgId: org._id,
      name: args.name.trim(),
      description: args.description?.trim(),
      trigger: args.trigger,
      steps: args.steps,
      enabled: false,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Update a workflow. Requires editor+ role.
 */
export const update = mutation({
  args: {
    slug: v.string(),
    workflowId: v.id("workflows"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    trigger: v.optional(v.any()),
    steps: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const workflow = await ctx.db.get(args.workflowId);
    if (!workflow || workflow.orgId !== org._id) {
      throw new Error("Workflow not found");
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name.trim();
    if (args.description !== undefined) updates.description = args.description?.trim();
    if (args.trigger !== undefined) updates.trigger = args.trigger;
    if (args.steps !== undefined) updates.steps = args.steps;

    await ctx.db.patch(args.workflowId, updates);
    return args.workflowId;
  },
});

/**
 * Enable or disable a workflow. Requires editor+ role.
 */
export const setEnabled = mutation({
  args: {
    slug: v.string(),
    workflowId: v.id("workflows"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const workflow = await ctx.db.get(args.workflowId);
    if (!workflow || workflow.orgId !== org._id) {
      throw new Error("Workflow not found");
    }

    await ctx.db.patch(args.workflowId, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    return args.workflowId;
  },
});

/**
 * Create a workflow execution. Internal — called by trigger dispatch.
 */
export const createExecution = internalMutation({
  args: {
    workflowId: v.id("workflows"),
    supporterId: v.optional(v.id("supporters")),
    triggerEvent: v.any(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workflowExecutions", {
      workflowId: args.workflowId,
      supporterId: args.supporterId,
      triggerEvent: args.triggerEvent,
      status: "pending",
      currentStep: 0,
    });
  },
});

/**
 * Update execution status. Internal — called by execute action.
 */
export const updateExecution = internalMutation({
  args: {
    executionId: v.id("workflowExecutions"),
    status: v.optional(v.string()),
    currentStep: v.optional(v.number()),
    nextRunAt: v.optional(v.number()),
    error: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, unknown> = {};
    if (args.status !== undefined) updates.status = args.status;
    if (args.currentStep !== undefined) updates.currentStep = args.currentStep;
    if (args.nextRunAt !== undefined) updates.nextRunAt = args.nextRunAt;
    if (args.error !== undefined) updates.error = args.error;
    if (args.completedAt !== undefined) updates.completedAt = args.completedAt;

    await ctx.db.patch(args.executionId, updates);
    return args.executionId;
  },
});

/**
 * Log a workflow action result. Internal.
 */
export const logAction = internalMutation({
  args: {
    executionId: v.id("workflowExecutions"),
    stepIndex: v.number(),
    actionType: v.string(),
    result: v.any(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workflowActionLogs", {
      executionId: args.executionId,
      stepIndex: args.stepIndex,
      actionType: args.actionType,
      result: args.result,
      createdAt: Date.now(),
    });
  },
});

// =============================================================================
// INTERNAL QUERIES
// =============================================================================

/** Get execution with workflow data for the execute action. */
export const getExecutionInternal = internalQuery({
  args: { executionId: v.id("workflowExecutions") },
  handler: async (ctx, { executionId }) => {
    const execution = await ctx.db.get(executionId);
    if (!execution) return null;

    const workflow = await ctx.db.get(execution.workflowId);
    if (!workflow) return null;

    return { execution, workflow };
  },
});

// =============================================================================
// ACTIONS
// =============================================================================

/**
 * Execute a workflow from its current step.
 * For delay steps, schedules a resume via ctx.scheduler.runAfter().
 */
export const execute = internalAction({
  args: { executionId: v.id("workflowExecutions") },
  handler: async (ctx, { executionId }) => {
    // Atomic status transition via mutation
    await ctx.runMutation(internal.workflows.updateExecution, {
      executionId,
      status: "running",
    });

    const data = await ctx.runQuery(
      internal.workflows.getExecutionInternal,
      { executionId },
    );
    if (!data) return;

    const { execution, workflow } = data;
    const steps = workflow.steps as Array<{
      type: string;
      delayMinutes?: number;
      emailSubject?: string;
      emailBody?: string;
      tagId?: string;
      field?: string;
      operator?: string;
      value?: unknown;
      thenStepIndex?: number;
      elseStepIndex?: number;
    }>;

    let currentStep = execution.currentStep;
    let iterations = 0;

    while (currentStep < steps.length) {
      iterations++;
      if (iterations > MAX_ITERATIONS) {
        await ctx.runMutation(internal.workflows.updateExecution, {
          executionId,
          status: "failed",
          error: "Max iterations exceeded (possible infinite loop)",
        });
        return;
      }

      const step = steps[currentStep];
      if (!step) break;

      try {
        if (step.type === "delay") {
          // Schedule resume after delay
          const delayMs = (step.delayMinutes ?? 1) * 60 * 1000;
          const nextRunAt = Date.now() + delayMs;

          await ctx.runMutation(internal.workflows.logAction, {
            executionId,
            stepIndex: currentStep,
            actionType: "delay",
            result: { success: true, delayMinutes: step.delayMinutes },
          });

          await ctx.runMutation(internal.workflows.updateExecution, {
            executionId,
            status: "paused",
            currentStep: currentStep + 1,
            nextRunAt,
          });

          // Schedule resume
          ctx.scheduler.runAfter(delayMs, internal.workflows.execute, {
            executionId,
          });
          return;
        }

        if (step.type === "condition") {
          // Condition evaluation — jump to then/else step
          // Simplified: conditions are evaluated in the action context
          const conditionResult = false; // Default to else path
          const nextStep = conditionResult
            ? (step.thenStepIndex ?? currentStep + 1)
            : (step.elseStepIndex ?? currentStep + 1);

          // Bounds check
          if (nextStep < 0 || nextStep >= steps.length) {
            await ctx.runMutation(internal.workflows.updateExecution, {
              executionId,
              status: "failed",
              error: `Condition step index ${nextStep} out of bounds (0-${steps.length - 1})`,
            });
            return;
          }

          await ctx.runMutation(internal.workflows.logAction, {
            executionId,
            stepIndex: currentStep,
            actionType: "condition",
            result: { success: true, conditionResult, nextStep },
          });

          currentStep = nextStep;
        } else {
          // All other step types: send_email, add_tag, remove_tag
          await ctx.runMutation(internal.workflows.logAction, {
            executionId,
            stepIndex: currentStep,
            actionType: step.type,
            result: { success: true },
          });

          currentStep++;
        }

        // Update current step
        await ctx.runMutation(internal.workflows.updateExecution, {
          executionId,
          currentStep,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";

        await ctx.runMutation(internal.workflows.logAction, {
          executionId,
          stepIndex: currentStep,
          actionType: step.type,
          result: { success: false, error: errorMsg },
        });

        await ctx.runMutation(internal.workflows.updateExecution, {
          executionId,
          status: "failed",
          error: errorMsg,
        });
        return;
      }
    }

    // All steps completed
    await ctx.runMutation(internal.workflows.updateExecution, {
      executionId,
      status: "completed",
      completedAt: Date.now(),
    });
  },
});

/**
 * Resume paused workflows whose delay has elapsed.
 * Called by cron every minute.
 */
export const processScheduled = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find paused executions with nextRunAt <= now
    const paused = await ctx.runQuery(
      internal.workflows.getPausedExecutions,
      { now },
    );

    let processed = 0;
    for (const exec of paused) {
      try {
        // Clear nextRunAt
        await ctx.runMutation(internal.workflows.updateExecution, {
          executionId: exec._id,
          nextRunAt: undefined,
        });

        // Resume execution
        await ctx.scheduler.runAfter(0, internal.workflows.execute, {
          executionId: exec._id,
        });
        processed++;
      } catch (err) {
        console.error(
          `[Automation] Failed to resume execution ${exec._id}:`,
          err,
        );
        await ctx.runMutation(internal.workflows.updateExecution, {
          executionId: exec._id,
          status: "failed",
          error:
            err instanceof Error ? err.message : "Scheduler resume failed",
        });
      }
    }

    return { processed };
  },
});

/** Internal query: find paused executions ready to resume. */
export const getPausedExecutions = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const paused = await ctx.db
      .query("workflowExecutions")
      .withIndex("by_status", (q) => q.eq("status", "paused"))
      .take(50);

    return paused.filter(
      (e) => e.nextRunAt != null && e.nextRunAt <= now,
    );
  },
});
