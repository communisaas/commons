import {
	action,
	query,
	mutation,
	internalMutation,
	internalAction,
	internalQuery
} from './_generated/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { requireOrgRole } from './_authHelpers';
import { requireInternalSecret } from './_internalAuth';
import { getOrgKeyForAction } from './_orgKeyUnseal';
import { decryptOrgPii } from './_orgKey';
import { sendViaSes } from './email';

const MAX_ITERATIONS = 200;
const CONDITION_FIELD_MAX_LENGTH = 128;
const CONDITION_VALUE_MAX_JSON_LENGTH = 2_000;
declare const process: { env: Record<string, string | undefined> };

const CONDITION_OPERATORS = [
	'equals',
	'not_equals',
	'contains',
	'not_contains',
	'includes',
	'gt',
	'lt',
	'gte',
	'lte',
	'exists',
	'not_exists'
] as const;

type ConditionOperator = (typeof CONDITION_OPERATORS)[number];
type ConditionEvaluation = {
	conditionResult: boolean;
	actualValue: unknown;
};
type WorkflowTriggerType =
	| 'supporter_created'
	| 'campaign_action'
	| 'event_rsvp'
	| 'event_checkin'
	| 'donation_completed'
	| 'tag_added';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isConditionOperator(value: unknown): value is ConditionOperator {
	return typeof value === 'string' && CONDITION_OPERATORS.includes(value as ConditionOperator);
}

function readDotPath(source: unknown, path: string): unknown {
	const segments = path
		.split('.')
		.map((s) => s.trim())
		.filter(Boolean);
	let current = source;

	for (const segment of segments) {
		if (Array.isArray(current)) {
			const index = Number(segment);
			if (!Number.isInteger(index) || index < 0 || index >= current.length) {
				return undefined;
			}
			current = current[index];
			continue;
		}
		if (!isRecord(current)) return undefined;
		current = current[segment];
	}

	return current;
}

function conditionFieldValue(
	field: string,
	execution: {
		supporterId?: Id<'supporters'>;
		triggerEvent?: unknown;
		status?: string;
		currentStep?: number;
	},
	workflow: { trigger?: unknown }
): unknown {
	const normalized = field.trim();
	if (!normalized) return undefined;

	if (normalized === 'supporterId') return execution.supporterId;
	if (normalized === 'trigger.type') return readDotPath(workflow.trigger, 'type');
	if (normalized.startsWith('triggerEvent.')) {
		return readDotPath(execution.triggerEvent, normalized.slice('triggerEvent.'.length));
	}
	if (normalized.startsWith('trigger.')) {
		return readDotPath(workflow.trigger, normalized.slice('trigger.'.length));
	}
	if (normalized.startsWith('execution.')) {
		return readDotPath(execution, normalized.slice('execution.'.length));
	}

	const eventValue = readDotPath(execution.triggerEvent, normalized);
	if (eventValue !== undefined) return eventValue;

	const triggerValue = readDotPath(workflow.trigger, normalized);
	if (triggerValue !== undefined) return triggerValue;

	return readDotPath(execution, normalized);
}

function asBoolean(value: unknown): boolean | null {
	if (typeof value === 'boolean') return value;
	if (typeof value !== 'string') return null;
	const normalized = value.trim().toLowerCase();
	if (normalized === 'true') return true;
	if (normalized === 'false') return false;
	return null;
}

function asFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value !== 'string' || value.trim() === '') return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function scalarText(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return '';
	}
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
	const actualBoolean = asBoolean(actual);
	const expectedBoolean = asBoolean(expected);
	if (actualBoolean !== null && expectedBoolean !== null) {
		return actualBoolean === expectedBoolean;
	}

	const actualNumber = asFiniteNumber(actual);
	const expectedNumber = asFiniteNumber(expected);
	if (actualNumber !== null && expectedNumber !== null) {
		return actualNumber === expectedNumber;
	}

	return scalarText(actual).trim().toLowerCase() === scalarText(expected).trim().toLowerCase();
}

function valueContains(actual: unknown, expected: unknown): boolean {
	if (Array.isArray(actual)) {
		return actual.some((entry) => valuesEqual(entry, expected));
	}
	return scalarText(actual).toLowerCase().includes(scalarText(expected).toLowerCase());
}

function compareNumbers(
	actual: unknown,
	expected: unknown,
	comparator: (a: number, b: number) => boolean
): boolean {
	const actualNumber = asFiniteNumber(actual);
	const expectedNumber = asFiniteNumber(expected);
	if (actualNumber === null || expectedNumber === null) return false;
	return comparator(actualNumber, expectedNumber);
}

function summarizeConditionValue(value: unknown): Record<string, unknown> {
	if (value === undefined) return { kind: 'missing', present: false };
	if (value === null) return { kind: 'null', present: false };
	if (Array.isArray(value)) return { kind: 'array', present: true, length: value.length };
	if (isRecord(value)) return { kind: 'object', present: true };
	const text = scalarText(value);
	return {
		kind: typeof value,
		present: true,
		preview: text.length > 120 ? `${text.slice(0, 117)}...` : text
	};
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function renderWorkflowEmailBody(body: string): string {
	if (/<[a-z][\s\S]*>/i.test(body)) return body;
	return `<div style="font-family:sans-serif;line-height:1.5;">${escapeHtml(body).replace(/\n/g, '<br />')}</div>`;
}

function applyWorkflowMergeFields(
	value: string,
	context: {
		firstName: string;
		lastName: string;
		postalCode: string | null;
		verificationStatus: 'verified' | 'postal-resolved' | 'imported';
	}
): string {
	const tierContext =
		context.verificationStatus === 'verified'
			? 'Your identity is verified. You appear as a verified contact in this campaign.'
			: context.verificationStatus === 'postal-resolved'
				? 'Your postal code is on file. Verification is pending.'
				: 'You were added by an organization. Verification is pending.';

	return value
		.replace(/\{\{firstName\}\}/g, escapeHtml(context.firstName))
		.replace(/\{\{lastName\}\}/g, escapeHtml(context.lastName))
		.replace(/\{\{postalCode\}\}/g, escapeHtml(context.postalCode ?? ''))
		.replace(/\{\{verificationStatus\}\}/g, escapeHtml(context.verificationStatus))
		.replace(/\{\{tierLabel\}\}/g, '')
		.replace(/\{\{tierContext\}\}/g, escapeHtml(tierContext));
}

function evaluateCondition(
	step: { field?: string; operator?: string; value?: unknown },
	execution: {
		supporterId?: Id<'supporters'>;
		triggerEvent?: unknown;
		status?: string;
		currentStep?: number;
	},
	workflow: { trigger?: unknown }
): ConditionEvaluation {
	const field = step.field ?? '';
	const operator = isConditionOperator(step.operator) ? step.operator : 'equals';
	const actualValue = conditionFieldValue(field, execution, workflow);
	const expectedValue = step.value ?? '';

	switch (operator) {
		case 'equals':
			return { conditionResult: valuesEqual(actualValue, expectedValue), actualValue };
		case 'not_equals':
			return { conditionResult: !valuesEqual(actualValue, expectedValue), actualValue };
		case 'contains':
		case 'includes':
			return { conditionResult: valueContains(actualValue, expectedValue), actualValue };
		case 'not_contains':
			return { conditionResult: !valueContains(actualValue, expectedValue), actualValue };
		case 'gt':
			return {
				conditionResult: compareNumbers(actualValue, expectedValue, (a, b) => a > b),
				actualValue
			};
		case 'lt':
			return {
				conditionResult: compareNumbers(actualValue, expectedValue, (a, b) => a < b),
				actualValue
			};
		case 'gte':
			return {
				conditionResult: compareNumbers(actualValue, expectedValue, (a, b) => a >= b),
				actualValue
			};
		case 'lte':
			return {
				conditionResult: compareNumbers(actualValue, expectedValue, (a, b) => a <= b),
				actualValue
			};
		case 'exists':
			return { conditionResult: actualValue !== undefined && actualValue !== null, actualValue };
		case 'not_exists':
			return { conditionResult: actualValue === undefined || actualValue === null, actualValue };
	}

	return { conditionResult: false, actualValue };
}

function workflowTriggerMatches(
	workflowTrigger: unknown,
	triggerType: WorkflowTriggerType,
	triggerEvent: unknown
): boolean {
	if (!isRecord(workflowTrigger)) return false;
	if (workflowTrigger.type !== triggerType) return false;

	if (triggerType === 'tag_added' && workflowTrigger.tagId) {
		return String(workflowTrigger.tagId) === String(readDotPath(triggerEvent, 'tagId'));
	}

	if (triggerType === 'campaign_action' && workflowTrigger.campaignId) {
		return String(workflowTrigger.campaignId) === String(readDotPath(triggerEvent, 'campaignId'));
	}

	if (
		(triggerType === 'event_rsvp' || triggerType === 'event_checkin') &&
		workflowTrigger.eventId
	) {
		return String(workflowTrigger.eventId) === String(readDotPath(triggerEvent, 'eventId'));
	}

	if (triggerType === 'donation_completed' && workflowTrigger.campaignId) {
		return String(workflowTrigger.campaignId) === String(readDotPath(triggerEvent, 'campaignId'));
	}

	return true;
}

// =============================================================================
// QUERIES
// =============================================================================

/**
 * List workflows for an org.
 */
export const list = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org } = await requireOrgRole(ctx, slug, 'member');

		const workflows = await ctx.db
			.query('workflows')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.collect();

		const rows = [];
		for (const w of workflows) {
			const executions = await ctx.db
				.query('workflowExecutions')
				.withIndex('by_workflowId', (q) => q.eq('workflowId', w._id))
				.collect();

			rows.push({
				_id: w._id,
				name: w.name,
				description: w.description ?? null,
				trigger: w.trigger,
				steps: w.steps,
				enabled: w.enabled,
				executionCount: executions.length,
				updatedAt: w.updatedAt,
				_creationTime: w._creationTime
			});
		}

		return rows;
	}
});

/**
 * Get a single workflow by ID. Requires org membership.
 */
export const get = query({
	args: {
		slug: v.string(),
		workflowId: v.id('workflows')
	},
	handler: async (ctx, { slug, workflowId }) => {
		const { org } = await requireOrgRole(ctx, slug, 'member');

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
			_creationTime: workflow._creationTime
		};
	}
});

/**
 * Get executions for a workflow, most recent first. Requires org membership.
 */
export const getExecutions = query({
	args: {
		slug: v.string(),
		workflowId: v.id('workflows'),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'member');

		// Verify workflow belongs to this org
		const workflow = await ctx.db.get(args.workflowId);
		if (!workflow || workflow.orgId !== org._id) {
			throw new Error('Workflow not found in this organization');
		}

		const executions = await ctx.db
			.query('workflowExecutions')
			.withIndex('by_workflowId', (q) => q.eq('workflowId', args.workflowId))
			.order('desc')
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
			_creationTime: e._creationTime
		}));
	}
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
const ALLOWED_STEP_TYPES = ['send_email', 'add_tag', 'remove_tag', 'delay', 'condition'] as const;
const MAX_DELAY_MINUTES = 60 * 24 * 30; // 30 days — well above any realistic workflow delay

function validateWorkflowSteps(steps: unknown[]): void {
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		if (!step || typeof step !== 'object' || Array.isArray(step)) {
			throw new Error(`STEP_${i}_NOT_OBJECT`);
		}
		const s = step as Record<string, unknown>;
		if (typeof s.type !== 'string') throw new Error(`STEP_${i}_TYPE_MISSING`);
		if (!ALLOWED_STEP_TYPES.includes(s.type as (typeof ALLOWED_STEP_TYPES)[number])) {
			throw new Error(`STEP_${i}_TYPE_INVALID:${s.type}`);
		}
		if (s.type === 'delay') {
			if (typeof s.delayMinutes !== 'number') throw new Error(`STEP_${i}_DELAY_NOT_NUMBER`);
			if (!Number.isFinite(s.delayMinutes)) throw new Error(`STEP_${i}_DELAY_NOT_FINITE`);
			if (!Number.isInteger(s.delayMinutes)) throw new Error(`STEP_${i}_DELAY_NOT_INTEGER`);
			if (s.delayMinutes < 1 || s.delayMinutes > MAX_DELAY_MINUTES) {
				throw new Error(`STEP_${i}_DELAY_OUT_OF_RANGE`);
			}
		}
		if (s.type === 'send_email') {
			if (
				typeof s.emailSubject !== 'string' ||
				s.emailSubject.length === 0 ||
				s.emailSubject.length > 256
			) {
				throw new Error(`STEP_${i}_EMAIL_SUBJECT_INVALID`);
			}
			if (
				typeof s.emailBody !== 'string' ||
				s.emailBody.length === 0 ||
				s.emailBody.length > 50_000
			) {
				throw new Error(`STEP_${i}_EMAIL_BODY_INVALID`);
			}
		}
		if (s.type === 'add_tag' || s.type === 'remove_tag') {
			if (typeof s.tagId !== 'string' || s.tagId.length === 0 || s.tagId.length > 64) {
				throw new Error(`STEP_${i}_TAG_ID_INVALID`);
			}
		}
		if (s.type === 'condition') {
			if (
				typeof s.field !== 'string' ||
				s.field.trim().length === 0 ||
				s.field.length > CONDITION_FIELD_MAX_LENGTH
			) {
				throw new Error(`STEP_${i}_CONDITION_FIELD_INVALID`);
			}
			if (!isConditionOperator(s.operator)) {
				throw new Error(`STEP_${i}_CONDITION_OPERATOR_INVALID`);
			}
			if (s.value !== undefined) {
				const valueStr = JSON.stringify(s.value);
				if (typeof valueStr !== 'string' || valueStr.length > CONDITION_VALUE_MAX_JSON_LENGTH) {
					throw new Error(`STEP_${i}_CONDITION_VALUE_INVALID`);
				}
			}
			if (typeof s.thenStepIndex !== 'number' || !Number.isInteger(s.thenStepIndex)) {
				throw new Error(`STEP_${i}_THEN_INDEX_INVALID`);
			}
			if (s.thenStepIndex < 0 || s.thenStepIndex >= steps.length) {
				throw new Error(`STEP_${i}_THEN_INDEX_OUT_OF_BOUNDS`);
			}
			if (typeof s.elseStepIndex !== 'number' || !Number.isInteger(s.elseStepIndex)) {
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
		steps: v.any()
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		if (!args.name.trim()) {
			throw new Error('Workflow name is required');
		}

		const triggerStr = JSON.stringify(args.trigger);
		const stepsStr = JSON.stringify(args.steps);
		if (triggerStr.length > 10_000) throw new Error('Trigger definition too large');
		if (stepsStr.length > 100_000) throw new Error('Steps definition too large');
		if (!Array.isArray(args.steps)) throw new Error('Steps must be an array');
		if (args.steps.length > 50) throw new Error('Maximum 50 steps per workflow');
		// Validate each step's shape — type allowlist, delay bounds,
		// send_email subject/body bounds, tag-write tagId shape, condition
		// elseStepIndex bounds.
		validateWorkflowSteps(args.steps);

		return await ctx.db.insert('workflows', {
			orgId: org._id,
			name: args.name.trim(),
			description: args.description?.trim(),
			trigger: args.trigger,
			steps: args.steps,
			enabled: false,
			updatedAt: Date.now()
		});
	}
});

/**
 * Update a workflow. Requires editor+ role.
 */
export const update = mutation({
	args: {
		slug: v.string(),
		workflowId: v.id('workflows'),
		name: v.optional(v.string()),
		description: v.optional(v.string()),
		trigger: v.optional(v.any()),
		steps: v.optional(v.any())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		const workflow = await ctx.db.get(args.workflowId);
		if (!workflow || workflow.orgId !== org._id) {
			throw new Error('Workflow not found');
		}

		if (args.trigger !== undefined) {
			const triggerStr = JSON.stringify(args.trigger);
			if (triggerStr.length > 10_000) throw new Error('Trigger definition too large');
		}
		if (args.steps !== undefined) {
			const stepsStr = JSON.stringify(args.steps);
			if (stepsStr.length > 100_000) throw new Error('Steps definition too large');
			if (!Array.isArray(args.steps)) throw new Error('Steps must be an array');
			if (args.steps.length > 50) throw new Error('Maximum 50 steps per workflow');
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
	}
});

/**
 * Enable or disable a workflow. Requires editor+ role.
 */
export const setEnabled = mutation({
	args: {
		slug: v.string(),
		workflowId: v.id('workflows'),
		enabled: v.boolean()
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		const workflow = await ctx.db.get(args.workflowId);
		if (!workflow || workflow.orgId !== org._id) {
			throw new Error('Workflow not found');
		}

		await ctx.db.patch(args.workflowId, {
			enabled: args.enabled,
			updatedAt: Date.now()
		});
		return args.workflowId;
	}
});

/**
 * Delete a workflow and its executions. Requires editor+ role.
 */
export const remove = mutation({
	args: {
		slug: v.string(),
		workflowId: v.id('workflows')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		const workflow = await ctx.db.get(args.workflowId);
		if (!workflow || workflow.orgId !== org._id) {
			throw new Error('Workflow not found');
		}

		// Delete executions first (cascade)
		const executions = await ctx.db
			.query('workflowExecutions')
			.withIndex('by_workflowId', (q) => q.eq('workflowId', args.workflowId))
			.collect();
		for (const exec of executions) {
			await ctx.db.delete(exec._id);
		}

		await ctx.db.delete(args.workflowId);
	}
});

/**
 * Create a workflow execution. Internal — called by trigger dispatch.
 */
export const createExecution = internalMutation({
	args: {
		workflowId: v.id('workflows'),
		supporterId: v.optional(v.id('supporters')),
		triggerEvent: v.any()
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert('workflowExecutions', {
			workflowId: args.workflowId,
			supporterId: args.supporterId,
			triggerEvent: args.triggerEvent,
			status: 'pending',
			currentStep: 0
		});
	}
});

/**
 * Create execution rows for enabled workflows whose trigger matches a real
 * org event, then schedule the existing runner. This is the causal bridge
 * from "something happened" to "coordination logic started".
 */
export const dispatchTrigger = internalMutation({
	args: {
		orgId: v.id('organizations'),
		triggerType: v.union(
			v.literal('supporter_created'),
			v.literal('campaign_action'),
			v.literal('event_rsvp'),
			v.literal('event_checkin'),
			v.literal('donation_completed'),
			v.literal('tag_added')
		),
		supporterId: v.optional(v.id('supporters')),
		triggerEvent: v.any()
	},
	handler: async (ctx, args) => {
		const workflows = await ctx.db
			.query('workflows')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.collect();

		let matched = 0;
		const executionIds: Id<'workflowExecutions'>[] = [];
		for (const workflow of workflows) {
			if (!workflow.enabled) continue;
			if (!workflowTriggerMatches(workflow.trigger, args.triggerType, args.triggerEvent)) continue;

			matched++;
			const executionId = await ctx.db.insert('workflowExecutions', {
				workflowId: workflow._id,
				supporterId: args.supporterId,
				triggerEvent: args.triggerEvent,
				status: 'pending',
				currentStep: 0
			});
			executionIds.push(executionId);
			await ctx.scheduler.runAfter(0, internal.workflows.execute, { executionId });
		}

		return { matched, started: executionIds.length, executionIds };
	}
});

/**
 * Update execution status. Internal — called by execute action.
 */
export const updateExecution = internalMutation({
	args: {
		executionId: v.id('workflowExecutions'),
		// Constrained to the workflowExecutions status enum (see
		// `convex/schema.ts:workflowExecutions.status`). A plain
		// `v.optional(v.string())` would let any caller write a freeform
		// string that downstream consumers couldn't enumerate.
		status: v.optional(
			v.union(
				v.literal('pending'),
				v.literal('running'),
				v.literal('paused'),
				v.literal('completed'),
				v.literal('partial_no_op'),
				v.literal('failed')
			)
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
		completedAt: v.optional(v.number())
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
	}
});

/**
 * Atomic claim for `execute` action. Without this, `execute` would
 * unconditionally write `status: "running"` regardless of prior state —
 * concurrent invocations (from same-tick cron retry, deploy boundary
 * double-tick, manual + scheduled overlap) would both proceed into the
 * step loop, firing duplicate side effects (send_email, add_tag, remove_tag). The
 * claim is CAS-style: transitions paused/pending → running only if
 * currently paused/pending; concurrent callers see `{ok: false}` and skip.
 * Mirrors `submissions.claimForDelivery` + `blasts.claimForBlastDispatch`.
 */
export const claimExecution = internalMutation({
	args: { executionId: v.id('workflowExecutions') },
	handler: async (ctx, { executionId }): Promise<{ ok: boolean; reason?: string }> => {
		const exec = await ctx.db.get(executionId);
		if (!exec) return { ok: false, reason: 'not_found' };
		if (exec.status !== 'paused' && exec.status !== 'pending') {
			return { ok: false, reason: `wrong_status:${exec.status}` };
		}
		// Pause-epoch guard against a STALE wake-up. The event-driven resume
		// (`runAfter(delayMs, execute)`) and the 15-min safety-net sweep can both
		// have a wake-up in flight for the same execution. If one left over from
		// an EARLIER pause fires after the execution already advanced and re-paused
		// on a LATER delay step, resuming now would run that step before its delay
		// elapses. A paused execution whose `nextRunAt` is still in the future has
		// not reached its due time, so this wake-up is stale — refuse it; the
		// legitimate wake-up scheduled for `nextRunAt` resumes it on time. (1s skew
		// tolerance so an on-time native wake-up isn't mis-rejected; the sweep
		// clears `nextRunAt` before re-firing, so its recovery path is unaffected.)
		if (
			exec.status === 'paused' &&
			exec.nextRunAt !== undefined &&
			exec.nextRunAt > Date.now() + 1000
		) {
			return { ok: false, reason: 'premature_wakeup' };
		}
		await ctx.db.patch(executionId, { status: 'running' });
		return { ok: true };
	}
});

/**
 * Log a workflow action result. Internal.
 */
export const logAction = internalMutation({
	args: {
		executionId: v.id('workflowExecutions'),
		stepIndex: v.number(),
		actionType: v.string(),
		result: v.any()
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert('workflowActionLogs', {
			executionId: args.executionId,
			stepIndex: args.stepIndex,
			actionType: args.actionType,
			result: args.result,
			createdAt: Date.now()
		});
	}
});

/**
 * Apply a supporter tag write from the workflow runner.
 *
 * Internal actions cannot touch the database directly, so tag side
 * effects go through this mutation. The mutation re-derives org scope
 * from execution → workflow and verifies the supporter + tag both
 * belong to that org before mutating the supporterTags join table.
 */
export const applySupporterTagStep = internalMutation({
	args: {
		executionId: v.id('workflowExecutions'),
		tagId: v.id('tags'),
		mode: v.union(v.literal('add_tag'), v.literal('remove_tag'))
	},
	handler: async (ctx, args) => {
		const execution = await ctx.db.get(args.executionId);
		if (!execution) throw new Error('WORKFLOW_EXECUTION_NOT_FOUND');
		if (!execution.supporterId) throw new Error('WORKFLOW_SUPPORTER_CURSOR_REQUIRED');

		const workflow = await ctx.db.get(execution.workflowId);
		if (!workflow) throw new Error('WORKFLOW_NOT_FOUND_FOR_TAG_STEP');

		const supporter = await ctx.db.get(execution.supporterId);
		if (!supporter || supporter.orgId !== workflow.orgId) {
			throw new Error('WORKFLOW_SUPPORTER_NOT_FOUND_FOR_ORG');
		}

		const tag = await ctx.db.get(args.tagId);
		if (!tag || tag.orgId !== workflow.orgId) {
			throw new Error('WORKFLOW_TAG_NOT_FOUND_FOR_ORG');
		}

		const existing = await ctx.db
			.query('supporterTags')
			.withIndex('by_supporterId_tagId', (idx) =>
				idx.eq('supporterId', execution.supporterId!).eq('tagId', args.tagId)
			)
			.first();

		if (args.mode === 'add_tag') {
			if (existing) {
				return {
					success: true,
					mode: args.mode,
					applied: false,
					alreadyPresent: true,
					supporterId: execution.supporterId,
					tagId: args.tagId
				};
			}

			const supporterTagId = await ctx.db.insert('supporterTags', {
				supporterId: execution.supporterId,
				tagId: args.tagId
			});

			return {
				success: true,
				mode: args.mode,
				applied: true,
				supporterTagId,
				supporterId: execution.supporterId,
				tagId: args.tagId
			};
		}

		if (existing) {
			await ctx.db.delete(existing._id);
			return {
				success: true,
				mode: args.mode,
				applied: true,
				supporterTagId: existing._id,
				supporterId: execution.supporterId,
				tagId: args.tagId
			};
		}

		return {
			success: true,
			mode: args.mode,
			applied: false,
			alreadyAbsent: true,
			supporterId: execution.supporterId,
			tagId: args.tagId
		};
	}
});

// =============================================================================
// INTERNAL QUERIES
// =============================================================================

/** Get execution with workflow data for the execute action. */
export const getExecutionInternal = internalQuery({
	args: { executionId: v.id('workflowExecutions') },
	handler: async (ctx, { executionId }) => {
		const execution = await ctx.db.get(executionId);
		if (!execution) return null;

		const workflow = await ctx.db.get(execution.workflowId);
		if (!workflow) return null;

		return { execution, workflow };
	}
});

export const getWorkflowEmailContext = internalQuery({
	args: { executionId: v.id('workflowExecutions') },
	handler: async (ctx, { executionId }) => {
		const execution = await ctx.db.get(executionId);
		if (!execution) return null;

		const workflow = await ctx.db.get(execution.workflowId);
		if (!workflow) return null;

		const org = await ctx.db.get(workflow.orgId);
		if (!org) return null;

		const supporter = execution.supporterId ? await ctx.db.get(execution.supporterId) : null;
		if (!supporter || supporter.orgId !== workflow.orgId) {
			return {
				execution,
				workflow,
				org: { _id: org._id, name: org.name, slug: org.slug },
				supporter: null
			};
		}

		return {
			execution,
			workflow,
			org: { _id: org._id, name: org.name, slug: org.slug },
			supporter: {
				_id: supporter._id,
				encryptedEmail: supporter.encryptedEmail,
				encryptedName: supporter.encryptedName ?? null,
				emailHash: supporter.emailHash,
				emailStatus: supporter.emailStatus,
				verified: supporter.verified,
				postalCode: supporter.postalCode ?? null
			}
		};
	}
});

// =============================================================================
// ACTIONS
// =============================================================================

async function sendWorkflowEmailStep(
	ctx: any,
	executionId: Id<'workflowExecutions'>,
	step: { emailSubject?: string; emailBody?: string }
): Promise<Record<string, unknown>> {
	const context = await ctx.runQuery(internal.workflows.getWorkflowEmailContext, { executionId });
	if (!context) throw new Error('WORKFLOW_EMAIL_CONTEXT_NOT_FOUND');
	if (!context.supporter) throw new Error('WORKFLOW_EMAIL_SUPPORTER_CURSOR_REQUIRED');

	if (context.supporter.emailStatus !== 'subscribed') {
		return {
			success: true,
			delivered: false,
			skipped: true,
			reason: 'supporter_not_subscribed',
			emailStatus: context.supporter.emailStatus,
			supporterId: context.supporter._id
		};
	}

	const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
	const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
	const awsRegion = process.env.AWS_REGION || 'us-east-1';
	const fromEmail =
		process.env.WORKFLOW_FROM_EMAIL || process.env.SES_FROM_EMAIL || process.env.RECEIPT_FROM_EMAIL;
	if (!awsAccessKeyId || !awsSecretAccessKey || !fromEmail) {
		throw new Error('WORKFLOW_EMAIL_NOT_CONFIGURED');
	}

	const orgKey = await getOrgKeyForAction(ctx, context.org._id);
	if (!orgKey) throw new Error('WORKFLOW_EMAIL_ORG_KEY_UNAVAILABLE');

	let recipientEmail = '';
	try {
		const parsedEmail = JSON.parse(context.supporter.encryptedEmail);
		recipientEmail = await decryptOrgPii(
			parsedEmail,
			orgKey,
			context.supporter.emailHash,
			`supporter:${context.supporter._id}`,
			'email'
		);
	} catch {
		throw new Error('WORKFLOW_EMAIL_DECRYPT_FAILED');
	}

	let firstName = '';
	let lastName = '';
	if (context.supporter.encryptedName) {
		try {
			const parsedName = JSON.parse(context.supporter.encryptedName);
			const fullName = await decryptOrgPii(
				parsedName,
				orgKey,
				context.supporter.emailHash,
				`supporter:${context.supporter._id}`,
				'name'
			);
			const trimmed = fullName.trim();
			const splitAt = trimmed.indexOf(' ');
			if (splitAt === -1) {
				firstName = trimmed;
			} else {
				firstName = trimmed.slice(0, splitAt);
				lastName = trimmed.slice(splitAt + 1).trim();
			}
		} catch {
			// Name personalization is optional; email delivery can proceed.
		}
	}

	const verificationStatus = context.supporter.verified
		? 'verified'
		: context.supporter.postalCode
			? 'postal-resolved'
			: 'imported';
	const mergeContext = {
		firstName,
		lastName,
		postalCode: context.supporter.postalCode,
		verificationStatus
	} as const;
	const subject = applyWorkflowMergeFields(step.emailSubject ?? '', mergeContext);
	const htmlBody = renderWorkflowEmailBody(
		applyWorkflowMergeFields(step.emailBody ?? '', mergeContext)
	);

	const delivered = await sendViaSes(
		recipientEmail,
		fromEmail,
		context.org.name,
		subject,
		htmlBody,
		awsAccessKeyId,
		awsSecretAccessKey,
		awsRegion
	);
	if (!delivered) throw new Error('WORKFLOW_EMAIL_SES_FAILED');

	return {
		success: true,
		delivered: true,
		supporterId: context.supporter._id,
		provider: 'ses',
		fromConfigured: true
	};
}

/**
 * Execute a workflow from its current step.
 * For delay steps, schedules a resume via ctx.scheduler.runAfter().
 */
export const execute = internalAction({
	args: { executionId: v.id('workflowExecutions') },
	handler: async (ctx, { executionId }) => {
		// Atomic claim — refuse to enter the step loop if another invocation
		// already transitioned us to "running" (or any non-paused state).
		// Without this, an unconditional `updateExecution` with
		// `status: "running"` would let concurrent callers both proceed
		// into duplicate side effects (send_email, add_tag, remove_tag).
		const claim: { ok: boolean; reason?: string } = await ctx.runMutation(
			internal.workflows.claimExecution,
			{ executionId }
		);
		if (!claim.ok) {
			console.warn(`[workflows.execute] Claim refused for ${executionId}: ${claim.reason}`);
			return;
		}

		const data = await ctx.runQuery(internal.workflows.getExecutionInternal, { executionId });
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
				status: 'failed',
				error: 'EXECUTION_OR_WORKFLOW_MISSING_AFTER_CLAIM'
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
		// Track legacy poisoned rows whose step type predates the write-time
		// allowlist. Supported steps either apply their side effect, skip with
		// an explicit success result, pause, branch, or fail the execution.
		// Unknown legacy steps advance as audited no-ops so operators do not
		// mistake the terminal row for clean completion.
		let anyStepNoOp = false;

		while (currentStep < steps.length) {
			iterations++;
			if (iterations > MAX_ITERATIONS) {
				await ctx.runMutation(internal.workflows.updateExecution, {
					executionId,
					status: 'failed',
					error: 'Max iterations exceeded (possible infinite loop)'
				});
				return;
			}

			const step = steps[currentStep];
			if (!step) break;

			try {
				if (step.type === 'delay') {
					// Schedule resume after delay
					// Clamp the delay defensively: finite, non-negative, capped at 30
					// days so a malformed delayMinutes can't hot-loop the scheduler
					// or park a resume job indefinitely.
					const rawDelayMinutes = step.delayMinutes ?? 1;
					const delayMinutes = Number.isFinite(rawDelayMinutes)
						? Math.min(Math.max(rawDelayMinutes, 0), 43_200)
						: 1;
					const delayMs = delayMinutes * 60 * 1000;
					const nextRunAt = Date.now() + delayMs;

					await ctx.runMutation(internal.workflows.logAction, {
						executionId,
						stepIndex: currentStep,
						actionType: 'delay',
						result: { success: true, delayMinutes: step.delayMinutes }
					});

					await ctx.runMutation(internal.workflows.updateExecution, {
						executionId,
						status: 'paused',
						currentStep: currentStep + 1,
						nextRunAt
					});

					// Schedule resume natively at the exact due time. This is the
					// PRIMARY resume path — the `workflow-scheduler` cron is now a
					// wide-cadence (15-min) safety net that only recovers rows
					// whose `runAfter` job was lost to a Convex-scheduler restart
					// (see `processScheduled`). The enqueue is awaited so a failure
					// is observed, but it must NOT propagate to the outer catch
					// (which sets status:'failed') — the row is already 'paused'
					// with nextRunAt, so a failed enqueue is recovered by the
					// safety-net sweep. Letting it go fail-terminal here would
					// defeat the orphan-recovery this design adds.
					try {
						await ctx.scheduler.runAfter(delayMs, internal.workflows.execute, {
							executionId
						});
					} catch (enqueueErr) {
						console.error(
							`[workflow] delay-resume enqueue failed for execution ${executionId}; ` +
								`row remains paused (nextRunAt set), safety-net sweep will recover it.`,
							enqueueErr
						);
					}
					return;
				}

				if (step.type === 'condition') {
					const { conditionResult, actualValue } = evaluateCondition(step, execution, workflow);
					const nextStep = conditionResult
						? (step.thenStepIndex ?? currentStep + 1)
						: (step.elseStepIndex ?? currentStep + 1);

					// Bounds check
					if (nextStep < 0 || nextStep >= steps.length) {
						await ctx.runMutation(internal.workflows.updateExecution, {
							executionId,
							status: 'failed',
							error: `Condition step index ${nextStep} out of bounds (0-${steps.length - 1})`
						});
						return;
					}

					await ctx.runMutation(internal.workflows.logAction, {
						executionId,
						stepIndex: currentStep,
						actionType: 'condition',
						result: {
							success: true,
							conditionResult,
							field: step.field ?? '',
							operator: step.operator ?? 'equals',
							actual: summarizeConditionValue(actualValue),
							expected: summarizeConditionValue(step.value ?? ''),
							nextStep
						}
					});

					currentStep = nextStep;
				} else if (step.type === 'send_email') {
					const result = await sendWorkflowEmailStep(ctx, executionId, step);

					await ctx.runMutation(internal.workflows.logAction, {
						executionId,
						stepIndex: currentStep,
						actionType: step.type,
						result
					});

					currentStep++;
				} else if (step.type === 'add_tag' || step.type === 'remove_tag') {
					const result = await ctx.runMutation(internal.workflows.applySupporterTagStep, {
						executionId,
						tagId: step.tagId as Id<'tags'>,
						mode: step.type
					});

					await ctx.runMutation(internal.workflows.logAction, {
						executionId,
						stepIndex: currentStep,
						actionType: step.type,
						result
					});

					currentStep++;
				} else {
					// Legacy poisoned rows can still contain an unknown step type
					// predating the write-time allowlist. Loud-fail the
					// unimplemented verb while still advancing so downstream
					// delay/condition steps can be audited.
					const KNOWN_NOOP_STEPS = new Set<string>();
					const isKnownNoop = KNOWN_NOOP_STEPS.has(step.type);
					console.warn(
						`[workflow] step type '${step.type}' is not implemented — ` +
							`recording no-op. executionId=${executionId} stepIndex=${currentStep}`
					);
					await ctx.runMutation(internal.workflows.logAction, {
						executionId,
						stepIndex: currentStep,
						actionType: step.type,
						result: {
							success: false,
							error: isKnownNoop
								? `STEP_TYPE_NOT_IMPLEMENTED:${step.type}`
								: `STEP_TYPE_UNKNOWN:${step.type}`
						}
					});

					anyStepNoOp = true;
					currentStep++;
				}

				// Update current step
				await ctx.runMutation(internal.workflows.updateExecution, {
					executionId,
					currentStep
				});
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : 'Unknown error';

				await ctx.runMutation(internal.workflows.logAction, {
					executionId,
					stepIndex: currentStep,
					actionType: step.type,
					result: { success: false, error: errorMsg }
				});

				await ctx.runMutation(internal.workflows.updateExecution, {
					executionId,
					status: 'failed',
					error: errorMsg
				});
				return;
			}
		}

		// All steps completed. Distinguish "clean completed" from
		// "completed with legacy-step no-ops" so operators see which
		// executions advanced over unsupported historical step rows.
		await ctx.runMutation(internal.workflows.updateExecution, {
			executionId,
			status: anyStepNoOp ? 'partial_no_op' : 'completed',
			completedAt: Date.now()
		});
	}
});

/**
 * Wide-cadence orphan-recovery sweep for paused workflow executions.
 *
 * The PRIMARY resume path is the native `ctx.scheduler.runAfter(delayMs, …)`
 * fired at the `delay`-step write-site in `execute`, which resumes each
 * paused execution exactly when its delay elapses. This handler is the
 * SAFETY NET (registered on a 15-min cron, not 1-min): it range-scans for
 * `paused` rows whose `nextRunAt` has passed but whose scheduled `execute`
 * job was lost to a Convex-scheduler restart, and re-fires them. Resuming a
 * row the native path already resumed is harmless — `claimExecution` is an
 * atomic CAS, so the second `execute` invocation no-ops.
 */
export const processScheduled = internalAction({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();

		// Find paused executions with nextRunAt <= now
		const paused = await ctx.runQuery(internal.workflows.getPausedExecutions, { now });

		let processed = 0;
		for (const exec of paused) {
			try {
				// Use the explicit `clearNextRunAt: true` flag. Passing
				// `nextRunAt: undefined` would be silently dropped by the
				// updateExecution handler — the clear would be a no-op and
				// the row would stay pickable on subsequent cron ticks.
				await ctx.runMutation(internal.workflows.updateExecution, {
					executionId: exec._id,
					clearNextRunAt: true
				});

				// Resume execution
				await ctx.scheduler.runAfter(0, internal.workflows.execute, {
					executionId: exec._id
				});
				processed++;
			} catch (err) {
				console.error(`[Automation] Failed to resume execution ${exec._id}:`, err);
				await ctx.runMutation(internal.workflows.updateExecution, {
					executionId: exec._id,
					status: 'failed',
					error: err instanceof Error ? err.message : 'Scheduler resume failed'
				});
			}
		}

		return { processed };
	}
});

/**
 * Public wrapper for the SvelteKit automation endpoint.
 *
 * `internalAction`s are not reachable through the Convex HTTP client used by
 * SvelteKit, so `/api/automation/process` calls this shared-secret-gated
 * wrapper after validating the external cron's `AUTOMATION_SECRET`.
 */
export const processScheduledNow = action({
	args: {
		_secret: v.string()
	},
	handler: async (ctx, args): Promise<{ processed: number }> => {
		requireInternalSecret(args._secret);
		return await ctx.runAction(internal.workflows.processScheduled, {});
	}
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
			.query('workflowExecutions')
			.withIndex('by_status_nextRunAt', (q) => q.eq('status', 'paused').lte('nextRunAt', now))
			.take(50);
	}
});
