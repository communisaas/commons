import type { Doc } from './_generated/dataModel';

export interface SegmentCondition {
	id: string;
	field: string;
	operator: string;
	value: unknown;
}

export interface SegmentFilter {
	logic: 'AND' | 'OR';
	conditions: SegmentCondition[];
}

export interface SegmentActionContext {
	campaignIds: Set<string>;
	districtHashes: Set<string>;
	districtCodes: Set<string>;
	maxEngagementTier: number;
}

function supporterSourceValue(supporter: Pick<Doc<'supporters'>, 'source'>): string {
	return typeof supporter.source === 'string' && supporter.source.trim()
		? supporter.source.trim()
		: 'unknown';
}

/**
 * Normalize persisted segment filters before evaluation. Saved segment rows use
 * `v.any()` for historical compatibility, so every consumer needs the same
 * closed, bounded read-side shape.
 */
export function normalizeSegmentFilter(raw: unknown): SegmentFilter {
	if (!raw || typeof raw !== 'object') return { logic: 'AND', conditions: [] };
	const candidate = raw as Record<string, unknown>;
	const logic = candidate.logic === 'OR' ? 'OR' : 'AND';
	const rawConditions = Array.isArray(candidate.conditions) ? candidate.conditions : [];
	const conditions = rawConditions
		.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
		.map((cond, index) => ({
			id: typeof cond.id === 'string' ? cond.id : `condition-${index}`,
			field: typeof cond.field === 'string' ? cond.field : '',
			operator: typeof cond.operator === 'string' ? cond.operator : '',
			value: cond.value
		}));
	return { logic, conditions };
}

export function filterNeedsActionContext(filter: SegmentFilter): boolean {
	return filter.conditions.some(
		(cond) =>
			cond.field === 'campaignParticipation' ||
			cond.field === 'actionDistrict' ||
			cond.field === 'actionDistrictLabel' ||
			cond.field === 'engagementTier'
	);
}

export function matchCondition(
	supporter: Doc<'supporters'>,
	supporterTagIds: Set<string>,
	cond: SegmentCondition,
	actionContext?: SegmentActionContext
): boolean {
	// Unknown fields and unknown operators FAIL CLOSED (return false →
	// "matches nothing") instead of fail-open (return true → "matches
	// everything"). Without this, a typo'd or malicious filter like
	// {field: "tag", operator: "typo"} would match every supporter.
	switch (cond.field) {
		case 'tag':
			if (cond.operator === 'includes') return supporterTagIds.has(String(cond.value));
			if (cond.operator === 'excludes') return !supporterTagIds.has(String(cond.value));
			console.warn(
				`[segments.matchCondition] unknown tag operator='${cond.operator}' — matching nothing`
			);
			return false;
		case 'emailStatus':
			if (cond.operator === 'equals') return supporter.emailStatus === String(cond.value);
			console.warn(
				`[segments.matchCondition] unknown emailStatus operator='${cond.operator}' — matching nothing`
			);
			return false;
		case 'source':
			if (cond.operator === 'equals') return supporterSourceValue(supporter) === String(cond.value);
			if (cond.operator === 'excludes') return supporterSourceValue(supporter) !== String(cond.value);
			console.warn(
				`[segments.matchCondition] unknown source operator='${cond.operator}' — matching nothing`
			);
			return false;
		case 'verification':
			if (cond.operator === 'equals' && cond.value === 'verified')
				return supporter.verified === true;
			if (cond.operator === 'equals' && cond.value === 'unverified')
				return supporter.verified !== true;
			console.warn(
				`[segments.matchCondition] unknown verification op='${cond.operator}' value='${String(cond.value)}' — matching nothing`
			);
			return false;
		case 'engagementTier': {
			const target = Number(cond.value);
			if (!Number.isFinite(target)) return false;
			const tier = actionContext?.maxEngagementTier ?? 0;
			if (cond.operator === 'equals') return tier === target;
			if (cond.operator === 'gte') return tier >= target;
			if (cond.operator === 'lte') return tier <= target;
			console.warn(
				`[segments.matchCondition] unknown engagementTier operator='${cond.operator}' — matching nothing`
			);
			return false;
		}
		case 'dateRange': {
			const created = supporter._creationTime;
			if (cond.operator === 'after') return created >= new Date(String(cond.value)).getTime();
			if (cond.operator === 'before') return created <= new Date(String(cond.value)).getTime();
			console.warn(
				`[segments.matchCondition] unknown dateRange operator='${cond.operator}' — matching nothing`
			);
			return false;
		}
		case 'postalCode': {
			const target = String(cond.value ?? '')
				.trim()
				.toUpperCase();
			const actual = (supporter.postalCode ?? '').trim().toUpperCase();
			if (!target || !actual) return false;
			if (cond.operator === 'equals') return actual === target;
			if (cond.operator === 'startsWith') return actual.startsWith(target);
			console.warn(
				`[segments.matchCondition] unknown postalCode operator='${cond.operator}' — matching nothing`
			);
			return false;
		}
		case 'stateCode': {
			const target = String(cond.value ?? '')
				.trim()
				.toUpperCase();
			const actual = (supporter.stateCode ?? '').trim().toUpperCase();
			if (!target || !actual) return false;
			if (cond.operator === 'equals') return actual === target;
			console.warn(
				`[segments.matchCondition] unknown stateCode operator='${cond.operator}' — matching nothing`
			);
			return false;
		}
		case 'congressionalDistrict': {
			const target = String(cond.value ?? '')
				.trim()
				.toUpperCase();
			const actual = (supporter.congressionalDistrict ?? '').trim().toUpperCase();
			if (!target || !actual) return false;
			if (cond.operator === 'equals') return actual === target;
			console.warn(
				`[segments.matchCondition] unknown congressionalDistrict operator='${cond.operator}' — matching nothing`
			);
			return false;
		}
		case 'country': {
			const target = String(cond.value ?? '')
				.trim()
				.toUpperCase();
			const actual = (supporter.country ?? '').trim().toUpperCase();
			if (!target || !actual) return false;
			if (cond.operator === 'equals') return actual === target;
			console.warn(
				`[segments.matchCondition] unknown country operator='${cond.operator}' — matching nothing`
			);
			return false;
		}
		case 'campaignParticipation': {
			const campaignId = String(cond.value ?? '');
			if (!campaignId) return false;
			if (cond.operator === 'participated') {
				return actionContext?.campaignIds.has(campaignId) ?? false;
			}
			if (cond.operator === 'notParticipated') {
				return !(actionContext?.campaignIds.has(campaignId) ?? false);
			}
			console.warn(
				`[segments.matchCondition] unknown campaignParticipation operator='${cond.operator}' — matching nothing`
			);
			return false;
		}
		case 'actionDistrict': {
			const districtHash = String(cond.value ?? '')
				.trim()
				.toLowerCase();
			if (!districtHash) return false;
			if (cond.operator === 'equals') {
				return actionContext?.districtHashes.has(districtHash) ?? false;
			}
			console.warn(
				`[segments.matchCondition] unknown actionDistrict operator='${cond.operator}' — matching nothing`
			);
			return false;
		}
		case 'actionDistrictLabel': {
			const districtCode = String(cond.value ?? '')
				.trim()
				.toUpperCase();
			if (!districtCode) return false;
			if (cond.operator === 'equals') {
				return actionContext?.districtCodes.has(districtCode) ?? false;
			}
			console.warn(
				`[segments.matchCondition] unknown actionDistrictLabel operator='${cond.operator}' — matching nothing`
			);
			return false;
		}
		default:
			console.warn(`[segments.matchCondition] unknown field='${cond.field}' — matching nothing`);
			return false;
	}
}

export const MAX_SEGMENT_CONDITIONS = 32;

export function matchFilter(
	supporter: Doc<'supporters'>,
	tagIds: Set<string>,
	filter: SegmentFilter,
	actionContext?: SegmentActionContext
): boolean {
	if (!filter.conditions || filter.conditions.length === 0) return true;
	if (filter.conditions.length > MAX_SEGMENT_CONDITIONS) {
		throw new Error(`SEGMENT_FILTER_TOO_MANY_CONDITIONS (max ${MAX_SEGMENT_CONDITIONS})`);
	}
	if (filter.logic === 'AND') {
		return filter.conditions.every((c) => matchCondition(supporter, tagIds, c, actionContext));
	}
	return filter.conditions.some((c) => matchCondition(supporter, tagIds, c, actionContext));
}
