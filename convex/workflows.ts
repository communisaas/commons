import {
  query,
  mutation,
  internalMutation,
  internalAction,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOrgRole } from "./_authHelpers";

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
 * Per-step shape validation for workflow steps. Array bounds + total JSON
 * size are not enough — each step's interior is `v.any()` and the
 * cron-driven `execute` action trusts the shape via cast
 * (`workflow.steps as Array<{...}>`). Without per-step validation, an
 * editor could write:
 *   - delayMinutes: -1            → `runAfter(delayMs, ...)` resumes
 *                                    immediately → hot-loop
 *   - delayMinutes: NaN           → scheduler arg is NaN (UB)
 *   - delayMinutes: "5"           → string * number = NaN
 *   - delayMinutes: 2**40         → nextRunAt overflow, getPausedExecutions
 *                                    range-scan never returns the row →
 *                                    execution leaks
 *   - step.type: "<unknown>"       → execute's switch falls through to
 *                                    no-op log; step is silently skipped
 * Validate at write so a poisoned step can't reach the cron-driven action.
 */
const ALLOWED_STEP_TYPES = ["send_email", "add_tag", "delay", "condition"] as const;
const MAX_DELAY_MINUTES = 60 * 24 * 30; // 30 days — well above any realistic workflow delay

function validateWorkflowSteps(steps: unknown[]): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new Error(`STEP_${i}_NOT_OBJECT`);
    }
    const s = step as Record<string, unknown>;
    if (typeof s.type !== "string") throw new Error(`STEP_${i}_TYPE_MISSING`);
    if (!ALLOWED_STEP_TYPES.includes(s.type as typeof ALLOWED_STEP_TYPES[number])) {
      throw new Error(`STEP_${i}_TYPE_INVALID:${s.type}`);
    }
    if (s.type === "delay") {
      if (typeof s.delayMinutes !== "number") throw new Error(`STEP_${i}_DELAY_NOT_NUMBER`);
      if (!Number.isFinite(s.delayMinutes)) throw new Error(`STEP_${i}_DELAY_NOT_FINITE`);
      if (!Number.isInteger(s.delayMinutes)) throw new Error(`STEP_${i}_DELAY_NOT_INTEGER`);
      if (s.delayMinutes < 1 || s.delayMinutes > MAX_DELAY_MINUTES) {
        throw new Error(`STEP_${i}_DELAY_OUT_OF_RANGE`);
      }
    }
    if (s.type === "send_email") {
      if (typeof s.emailSubject !== "string" || s.emailSubject.length === 0 || s.emailSubject.length > 256) {
        throw new Error(`STEP_${i}_EMAIL_SUBJECT_INVALID`);
      }
      if (typeof s.emailBody !== "string" || s.emailBody.length === 0 || s.emailBody.length > 50_000) {
        throw new Error(`STEP_${i}_EMAIL_BODY_INVALID`);
      }
    }
    if (s.type === "add_tag") {
      if (typeof s.tagId !== "string" || s.tagId.length === 0 || s.tagId.length > 64) {
        throw new Error(`STEP_${i}_TAG_ID_INVALID`);
      }
    }
    if (s.type === "condition") {
      if (typeof s.elseStepIndex !== "number" || !Number.isInteger(s.elseStepIndex)) {
        throw new Error(`STEP_${i}_ELSE_INDEX_INVALID`);
      }
      if (s.elseStepIndex < 0 || s.elseStepIndex >= steps.length) {
        throw new Error(`STEP_${i}_ELSE_INDEX_OUT_OF_BOUNDS`);
      }
    }
  }
}

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

    const triggerStr = JSON.stringify(args.trigger);
    const stepsStr = JSON.stringify(args.steps);
    if (triggerStr.length > 10_000) throw new Error("Trigger definition too large");
    if (stepsStr.length > 100_000) throw new Error("Steps definition too large");
    if (!Array.isArray(args.steps)) throw new Error("Steps must be an array");
    if (args.steps.length > 50) throw new Error("Maximum 50 steps per workflow");
    // Validate each step's shape — type allowlist, delay bounds,
    // send_email subject/body bounds, add_tag tagId shape, condition
    // elseStepIndex bounds.
    validateWorkflowSteps(args.steps);

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

    if (args.trigger !== undefined) {
      const triggerStr = JSON.stringify(args.trigger);
      if (triggerStr.length > 10_000) throw new Error("Trigger definition too large");
    }
    if (args.steps !== undefined) {
      const stepsStr = JSON.stringify(args.steps);
      if (stepsStr.length > 100_000) throw new Error("Steps definition too large");
      if (!Array.isArray(args.steps)) throw new Error("Steps must be an array");
      if (args.steps.length > 50) throw new Error("Maximum 50 steps per workflow");
      // Same per-step validation as create.
      validateWorkflowSteps(args.steps);
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
 * Delete a workflow and its executions. Requires editor+ role.
 */
export const remove = mutation({
  args: {
    slug: v.string(),
    workflowId: v.id("workflows"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.slug, "editor");

    const workflow = await ctx.db.get(args.workflowId);
    if (!workflow || workflow.orgId !== org._id) {
      throw new Error("Workflow not found");
    }

    // Delete executions first (cascade)
    const executions = await ctx.db
      .query("workflowExecutions")
      .withIndex("by_workflowId", (q) => q.eq("workflowId", args.workflowId))
      .collect();
    for (const exec of executions) {
      await ctx.db.delete(exec._id);
    }

    await ctx.db.delete(args.workflowId);
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
    // Constrained to the workflowExecutions status enum (see
    // `convex/schema.ts:workflowExecutions.status`). A plain
    // `v.optional(v.string())` would let any caller write a freeform
    // string that downstream consumers couldn't enumerate.
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("paused"),
        v.literal("completed"),
        v.literal("partial_no_op"),
        v.literal("failed"),
      ),
    ),
    currentStep: v.optional(v.number()),
    nextRunAt: v.optional(v.number()),
    /**
     * Explicit clear-nextRunAt flag. Convex `ctx.db.patch` semantics
     * drop undefined keys, so callers that pass `nextRunAt: undefined`
     * to clear the field would silently no-op. This flag distinguishes
     * "field absent" (undefined) from "explicit clear"
     * (clearNextRunAt: true).
     */
    clearNextRunAt: v.optional(v.boolean()),
    error: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, unknown> = {};
    if (args.status !== undefined) updates.status = args.status;
    if (args.currentStep !== undefined) updates.currentStep = args.currentStep;
    if (args.nextRunAt !== undefined) updates.nextRunAt = args.nextRunAt;
    else if (args.clearNextRunAt) updates.nextRunAt = undefined;
    if (args.error !== undefined) updates.error = args.error;
    if (args.completedAt !== undefined) updates.completedAt = args.completedAt;

    await ctx.db.patch(args.executionId, updates);
    return args.executionId;
  },
});

/**
 * Atomic claim for `execute` action. Without this, `execute` would
 * unconditionally write `status: "running"` regardless of prior state —
 * concurrent invocations (from same-tick cron retry, deploy boundary
 * double-tick, manual + scheduled overlap) would both proceed into the
 * step loop, firing duplicate side effects (send_email, add_tag). The
 * claim is CAS-style: transitions paused/pending → running only if
 * currently paused/pending; concurrent callers see `{ok: false}` and skip.
 * Mirrors `submissions.claimForDelivery` + `blasts.claimForBlastDispatch`.
 */
export const claimExecution = internalMutation({
  args: { executionId: v.id("workflowExecutions") },
  handler: async (ctx, { executionId }): Promise<{ ok: boolean; reason?: string }> => {
    const exec = await ctx.db.get(executionId);
    if (!exec) return { ok: false, reason: "not_found" };
    if (exec.status !== "paused" && exec.status !== "pending") {
      return { ok: false, reason: `wrong_status:${exec.status}` };
    }
    await ctx.db.patch(executionId, { status: "running" });
    return { ok: true };
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
    // Atomic claim — refuse to enter the step loop if another invocation
    // already transitioned us to "running" (or any non-paused state).
    // Without this, an unconditional `updateExecution` with
    // `status: "running"` would let concurrent callers both proceed
    // into duplicate side effects (send_email, add_tag).
    const claim: { ok: boolean; reason?: string } = await ctx.runMutation(
      internal.workflows.claimExecution,
      { executionId },
    );
    if (!claim.ok) {
      console.warn(
        `[workflows.execute] Claim refused for ${executionId}: ${claim.reason}`,
      );
      return;
    }

    const data = await ctx.runQuery(
      internal.workflows.getExecutionInternal,
      { executionId },
    );
    if (!data) {
      // The claim above transitioned the row to `running`. If the
      // execution row or its parent workflow was deleted between
      // claim and read, the row would stay `running` forever — never
      // picked up by `processScheduled` (which queries paused rows),
      // never moved to a terminal state. Recover by marking the
      // execution `failed` with a clear reason so operators see
      // stranded rows in the executions list.
      await ctx.runMutation(internal.workflows.updateExecution, {
        executionId,
        status: "failed",
        error: "EXECUTION_OR_WORKFLOW_MISSING_AFTER_CLAIM",
      });
      return;
    }

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
    // Track whether any step recorded a no-op so the final status
    // can reflect "completed but with unimplemented steps" rather
    // than a clean `completed`. Without this, the per-step log would
    // show `success: false`, but the execution-level terminal state
    // would still read `status: completed` regardless — operators
    // would see "completed" in the executions list while the
    // underlying send/tag operations never happened. The final patch
    // surfaces `partial_no_op` when any step was unimplemented.
    let anyStepNoOp = false;

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
          // TODO: condition evaluation is not yet implemented. The
          // hardcoded false ALWAYS routes to the else branch — any
          // workflow using `if supporter.tier === 'vip' ...` silently
          // sends every user the else-branch action. Implementation
          // requires deciding the field-path syntax (dot-notation? JSONPath?),
          // operator set (eq/neq/gt/lt/in/contains?), and how to surface
          // missing-field cases. Until that lands, log every condition
          // evaluation so operators can audit which workflows depend on
          // conditional branching being broken vs which have always
          // intentionally taken the else path.
          console.warn(
            `[workflow] condition step evaluated as default-false (eval not implemented). ` +
              `executionId=${executionId} stepIndex=${currentStep} ` +
              `field=${step.field ?? '<unset>'} operator=${step.operator ?? '<unset>'}`,
          );
          const conditionResult = false; // Default to else path until impl lands
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
          // The action verbs (send_email, add_tag, remove_tag, condition)
          // are enumerated in the workflow-step allowlist but the executor
          // has no implementation for the side-effecting ones — the
          // workflow has no supporter cursor, no email recipient
          // resolution, no tag-write helper wired here. Loud-fail the
          // unimplemented verbs: log `success: false` with a structured
          // reason so operators can see which workflows depend on
          // verbs that don't yet do anything. Don't halt the workflow —
          // a still-pending delay step downstream should still fire,
          // and creators will see the failure in the execution log.
          // The execution's terminal state surfaces `partial_no_op` so
          // operators can distinguish "really completed" from "ran but
          // every action verb was a no-op".
          const KNOWN_NOOP_STEPS = new Set(["send_email", "add_tag", "remove_tag"]);
          const isKnownNoop = KNOWN_NOOP_STEPS.has(step.type);
          console.warn(
            `[workflow] step type '${step.type}' is not implemented — ` +
              `recording no-op. executionId=${executionId} stepIndex=${currentStep}`,
          );
          await ctx.runMutation(internal.workflows.logAction, {
            executionId,
            stepIndex: currentStep,
            actionType: step.type,
            result: {
              success: false,
              error: isKnownNoop
                ? `STEP_TYPE_NOT_IMPLEMENTED:${step.type}`
                : `STEP_TYPE_UNKNOWN:${step.type}`,
            },
          });

          anyStepNoOp = true;
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

    // All steps completed. Distinguish "clean completed" from
    // "completed with unimplemented-step no-ops" so operators see
    // which executions ran without their intended side effects.
    await ctx.runMutation(internal.workflows.updateExecution, {
      executionId,
      status: anyStepNoOp ? "partial_no_op" : "completed",
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
        // Use the explicit `clearNextRunAt: true` flag. Passing
        // `nextRunAt: undefined` would be silently dropped by the
        // updateExecution handler — the clear would be a no-op and
        // the row would stay pickable on subsequent cron ticks.
        await ctx.runMutation(internal.workflows.updateExecution, {
          executionId: exec._id,
          clearNextRunAt: true,
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

/** Internal query: find paused executions ready to resume.
 *
 * Uses the composite `by_status_nextRunAt` index to range-scan in
 * `nextRunAt` ascending order, taking only executions whose `nextRunAt`
 * has passed. The previous version `take(50)` on `by_status` returned
 * arbitrary order — if 50+ paused executions had `nextRunAt` in the
 * future, the post-take filter dropped all of them and the queue never
 * drained (head-of-queue starvation).
 */
export const getPausedExecutions = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    return await ctx.db
      .query("workflowExecutions")
      .withIndex("by_status_nextRunAt", (q) =>
        q.eq("status", "paused").lte("nextRunAt", now),
      )
      .take(50);
  },
});
