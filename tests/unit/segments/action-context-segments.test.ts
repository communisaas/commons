import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const segmentTypesSource = readFileSync('src/lib/types/segment.ts', 'utf8');
const segmentBuilderSource = readFileSync('src/lib/components/segments/SegmentBuilder.svelte', 'utf8');
const segmentsSource = readFileSync('convex/segments.ts', 'utf8');
const segmentMatchSource = readFileSync('convex/_segmentMatch.ts', 'utf8');
const schemaSource = readFileSync('convex/schema.ts', 'utf8');

describe('action-context segment filters', () => {
	it('adds action-derived fields to the shared segment type contract', () => {
		expect(segmentTypesSource).toContain("| 'actionDistrict'");
		expect(segmentTypesSource).toContain("| 'actionDistrictLabel'");
		expect(segmentTypesSource).toContain("'actionDistrict',");
		expect(segmentTypesSource).toContain("'actionDistrictLabel',");
		expect(segmentTypesSource).toContain("| 'stateCode'");
		expect(segmentTypesSource).toContain("| 'congressionalDistrict'");
		expect(segmentTypesSource).toContain("label: 'Action District'");
		expect(segmentTypesSource).toContain("label: 'Action-Time District'");
		expect(segmentTypesSource).toContain("label: 'State / Province Code'");
		expect(segmentTypesSource).toContain("label: 'Congressional District'");
		expect(segmentTypesSource).toContain("label: 'Engagement Tier'");
		expect(segmentTypesSource).not.toContain('Engagement Tier (legacy)');
	});

	it('uses an indexed action-context join instead of fail-open/fail-closed stubs', () => {
		expect(schemaSource).toContain(".index('by_orgId_supporterId', ['orgId', 'supporterId'])");
		expect(segmentMatchSource).toContain('interface SegmentActionContext');
		expect(segmentMatchSource).toContain('filterNeedsActionContext');
		expect(segmentMatchSource).toContain("case 'campaignParticipation'");
		expect(segmentMatchSource).toContain("case 'actionDistrict'");
		expect(segmentMatchSource).toContain("case 'actionDistrictLabel'");
		expect(segmentMatchSource).toContain('districtCodes: Set<string>');
		expect(segmentMatchSource).toContain('function supporterSourceValue');
		expect(segmentMatchSource).toContain("supporterSourceValue(supporter) === String(cond.value)");
		expect(segmentMatchSource).toContain("supporterSourceValue(supporter) !== String(cond.value)");
		expect(segmentMatchSource).toContain("case 'stateCode'");
		expect(segmentMatchSource).toContain("case 'congressionalDistrict'");
		expect(segmentMatchSource).toContain('actionContext?.campaignIds.has(campaignId)');
		expect(segmentMatchSource).toContain('actionContext?.districtHashes.has(districtHash)');
		expect(segmentMatchSource).toContain('actionContext?.districtCodes.has(districtCode)');
		expect(segmentMatchSource).toContain('actionContext?.maxEngagementTier');
		expect(segmentsSource).toContain('normalizeSegmentFilter(filters)');
		expect(segmentsSource).toContain('matchFilter(');
		expect(segmentsSource).toContain('action.districtCode?.trim().toUpperCase()');
		expect(schemaSource).toContain('districtCode: v.optional(v.string())');
		expect(segmentsSource).not.toContain('campaignParticipation needs enriched context');
	});

	it('renders controls for the real geography and action-context filters', () => {
		expect(segmentBuilderSource).toContain("condition.field === 'actionDistrict'");
		expect(segmentBuilderSource).toContain('placeholder="district hash"');
		expect(segmentBuilderSource).toContain("condition.field === 'actionDistrictLabel'");
		expect(segmentBuilderSource).toContain("condition.field === 'postalCode'");
		expect(segmentBuilderSource).toContain("condition.field === 'stateCode'");
		expect(segmentBuilderSource).toContain('placeholder="CA"');
		expect(segmentBuilderSource).toContain("condition.field === 'congressionalDistrict'");
		expect(segmentBuilderSource).toContain('placeholder="CA-11"');
		expect(segmentBuilderSource).toContain("condition.field === 'country'");
	});

	it('keeps capped action-context segment counts visibly bounded', () => {
		expect(segmentBuilderSource).toContain('let matchCountPartial = $state(false);');
		expect(segmentBuilderSource).toContain('matchCountPartial = Boolean(data.partial);');
		expect(segmentBuilderSource).toContain(
			'onApply?: (filter: SegmentFilter, count: number, partial?: boolean) => void;'
		);
		expect(segmentBuilderSource).toContain(
			'onApply?.(currentFilter, matchCount ?? 0, matchCountPartial);'
		);
		expect(segmentBuilderSource).toContain("data.partial ? 'at least ' : ''");
		expect(segmentBuilderSource).toContain(
			'Count hit the page cap; this is a lower bound, not a full cohort total.'
		);
		expect(segmentBuilderSource).toContain(
			'action hit the page cap and can be rerun for the remaining matching rows'
		);
		expect(segmentBuilderSource).toContain('rerun it to continue through the remaining');
	});
});
