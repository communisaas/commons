/**
 * Canonical label + option maps for the workflow/automation UI.
 *
 * Single source of truth for trigger types, step types, and delay units.
 * Previously duplicated across 3 Svelte files; drift between copies caused
 * UI↔schema mismatches. Update this file only.
 *
 * Field-name policy: values in these maps MUST match the string literals the
 * Convex workflow executor reads (`convex/workflows.ts:~357`). Changing the
 * key on one side without the other silently breaks production.
 */

export const TRIGGER_LABELS: Record<string, string> = {
	supporter_created: 'New Supporter',
	campaign_action: 'Campaign Action',
	event_rsvp: 'Event RSVP',
	event_checkin: 'Event Check-in',
	donation_completed: 'Donation Completed',
	tag_added: 'Tag Added'
};

export const STEP_LABELS: Record<string, string> = {
	send_email: 'Send Email',
	add_tag: 'Add Tag',
	remove_tag: 'Remove Tag',
	delay: 'Wait',
	condition: 'Condition'
};

export const DELAY_UNITS = [
	{ value: 'minutes', label: 'Minutes', multiplier: 1 },
	{ value: 'hours', label: 'Hours', multiplier: 60 },
	{ value: 'days', label: 'Days', multiplier: 60 * 24 }
] as const;

export type DelayUnit = (typeof DELAY_UNITS)[number]['value'];

/** Convert (duration, unit) → delayMinutes, the integer the executor expects. */
export function toDelayMinutes(duration: number, unit: DelayUnit): number {
	const entry = DELAY_UNITS.find((u) => u.value === unit);
	if (!entry) return Math.max(1, Math.round(duration));
	return Math.max(1, Math.round(duration * entry.multiplier));
}

/** Condition operators the Convex executor can honor once condition evaluation
 * is wired. The UI exposes these; the runtime is currently a no-op (always
 * takes the else branch) — see convex/workflows.ts `conditionResult = false`. */
export const CONDITION_OPERATORS = [
	{ value: 'equals', label: 'equals' },
	{ value: 'not_equals', label: 'does not equal' },
	{ value: 'contains', label: 'contains' },
	{ value: 'not_contains', label: 'does not contain' },
	{ value: 'includes', label: 'includes' },
	{ value: 'gt', label: 'greater than' },
	{ value: 'lt', label: 'less than' }
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number]['value'];
