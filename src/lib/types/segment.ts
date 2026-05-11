/**
 * Segment filter types shared between client and server.
 */

export type ConditionField =
	| 'tag'
	| 'verification'
	| 'engagementTier'
	| 'source'
	| 'emailStatus'
	| 'dateRange'
	| 'campaignParticipation';

export type ConditionOperator =
	| 'includes'
	| 'excludes'
	| 'equals'
	| 'gte'
	| 'lte'
	| 'before'
	| 'after'
	| 'between'
	| 'participated'
	| 'notParticipated';

export interface SegmentCondition {
	id: string;
	field: ConditionField;
	operator: ConditionOperator;
	value: string | string[] | number | { from?: string; to?: string };
}

export interface SegmentFilter {
	logic: 'AND' | 'OR';
	conditions: SegmentCondition[];
}

const VALID_FIELDS = new Set<string>([
	'tag', 'verification', 'engagementTier', 'source',
	'emailStatus', 'dateRange', 'campaignParticipation'
]);
const VALID_OPERATORS = new Set<string>([
	'includes', 'excludes', 'equals', 'gte', 'lte',
	'before', 'after', 'between', 'participated', 'notParticipated'
]);

/**
 * Runtime validation for SegmentFilter (guards against malformed JSON from DB or API).
 * Returns null if valid, or an error message string.
 */
export function validateSegmentFilter(input: unknown): string | null {
	if (!input || typeof input !== 'object') return 'Filter must be an object';
	const filter = input as Record<string, unknown>;
	if (filter.logic !== 'AND' && filter.logic !== 'OR') return 'logic must be AND or OR';
	if (!Array.isArray(filter.conditions)) return 'conditions must be an array';
	for (const c of filter.conditions) {
		if (!c || typeof c !== 'object') return 'Each condition must be an object';
		const cond = c as Record<string, unknown>;
		if (typeof cond.id !== 'string') return 'Condition id must be a string';
		if (!VALID_FIELDS.has(String(cond.field))) return `Invalid field: ${cond.field}`;
		if (!VALID_OPERATORS.has(String(cond.operator))) return `Invalid operator: ${cond.operator}`;
		if (cond.value === undefined) return 'Condition value is required';
	}
	return null;
}

export interface SavedSegment {
	id: string;
	name: string;
	filters: SegmentFilter;
	createdAt: string;
	updatedAt: string;
}

// Field metadata for the UI
export const FIELD_OPTIONS: Array<{
	value: ConditionField;
	label: string;
	operators: Array<{ value: ConditionOperator; label: string }>;
}> = [
	{
		value: 'tag',
		label: 'Tag',
		operators: [
			{ value: 'includes', label: 'includes' },
			{ value: 'excludes', label: 'excludes' }
		]
	},
	{
		value: 'verification',
		label: 'Verification Status',
		operators: [{ value: 'equals', label: 'is' }]
	},
	// engagementTier is kept here labeled "(legacy)" so saved segments still
	// render in the SegmentBuilder dropdown, but the suffix discourages new
	// use. Server-side handler in convex/segments.ts is a no-op pass-through
	// (always matches) — supporters have no engagementTier field; the metric
	// lives on action tables (campaignActions, debateArguments, eventRsvps).
	// A real aggregate-from-actions implementation should replace this when
	// engagement-tier becomes a surfaced product metric.
	{
		value: 'engagementTier',
		label: 'Engagement Tier (legacy)',
		operators: [
			{ value: 'equals', label: 'is' },
			{ value: 'gte', label: 'at least' },
			{ value: 'lte', label: 'at most' }
		]
	},
	{
		value: 'source',
		label: 'Source',
		operators: [
			{ value: 'equals', label: 'is' },
			{ value: 'excludes', label: 'is not' }
		]
	},
	{
		value: 'emailStatus',
		label: 'Email Status',
		operators: [
			{ value: 'equals', label: 'is' },
			{ value: 'excludes', label: 'is not' }
		]
	},
	{
		value: 'dateRange',
		label: 'Date Joined',
		operators: [
			{ value: 'before', label: 'before' },
			{ value: 'after', label: 'after' },
			{ value: 'between', label: 'between' }
		]
	},
	{
		value: 'campaignParticipation',
		label: 'Campaign Participation',
		operators: [
			{ value: 'participated', label: 'participated in' },
			{ value: 'notParticipated', label: 'did not participate in' }
		]
	}
];

export const VERIFICATION_OPTIONS = [
	{ value: 'unverified', label: 'Unverified (Imported)' },
	{ value: 'postal', label: 'Postal-Resolved' },
	{ value: 'verified', label: 'Identity Verified' }
] as const;

export const TIER_OPTIONS = [
	{ value: 0, label: 'New (0)' },
	{ value: 1, label: 'Active (1)' },
	{ value: 2, label: 'Established (2)' },
	{ value: 3, label: 'Veteran (3)' },
	{ value: 4, label: 'Pillar (4)' }
] as const;

export const SOURCE_OPTIONS = [
	{ value: 'csv', label: 'CSV Import' },
	{ value: 'action_network', label: 'Action Network' },
	{ value: 'organic', label: 'Organic' },
	{ value: 'widget', label: 'Widget' }
] as const;

export const EMAIL_STATUS_OPTIONS = [
	{ value: 'subscribed', label: 'Subscribed' },
	{ value: 'unsubscribed', label: 'Unsubscribed' },
	{ value: 'bounced', label: 'Bounced' },
	{ value: 'complained', label: 'Complained' }
] as const;
