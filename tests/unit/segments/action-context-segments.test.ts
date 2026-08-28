import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matchFilter } from '../../../convex/_segmentMatch';

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
		expect(segmentsSource).toContain('const typedFilter = boundedSegmentFilter(filters)');
		expect(segmentsSource).toContain('return normalizeSegmentFilter(raw)');
		expect(segmentsSource).toContain('matchFilter(');
		expect(segmentsSource).toContain('assertSupporterAudienceActionReady(ctx)');
		expect(segmentsSource).toContain('s.audienceDistrictCodes ?? []');
		expect(segmentsSource).toContain('s.audienceDistrictHashes ?? []');
		expect(segmentsSource).toContain('s.audienceCampaignIds ?? []');
		expect(schemaSource).toContain('districtCode: v.optional(v.string())');
		expect(segmentsSource).not.toContain('campaignParticipation needs enriched context');

		const actionContext = {
			campaignIds: new Set(['campaign-1']),
			districtHashes: new Set(['district-hash']),
			districtCodes: new Set(['CA-11']),
			maxEngagementTier: 3
		};
		expect(
			matchFilter(
				{} as never,
				new Set(),
				{
					logic: 'AND',
					conditions: [
						{
							id: 'campaign',
							field: 'campaignParticipation',
							operator: 'participated',
							value: 'campaign-1'
						},
						{
							id: 'district-hash',
							field: 'actionDistrict',
							operator: 'equals',
							value: 'DISTRICT-HASH'
						},
						{
							id: 'district-code',
							field: 'actionDistrictLabel',
							operator: 'equals',
							value: 'ca-11'
						}
					]
				},
				actionContext
			)
		).toBe(true);
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
			'onApply?.(snapshotFilter(currentFilter), matchCount, matchCountPartial);'
		);
		expect(segmentBuilderSource).toContain('countedFilterKey !== currentFilterKey');
		expect(segmentBuilderSource).toContain('generation === countGeneration');
		expect(segmentBuilderSource).toContain('filters: confirmation.filter');
		expect(segmentBuilderSource).toContain('This organization has more than 400 supporters.');
		expect(segmentBuilderSource).not.toContain('rerun it to continue through the remaining');
	});
});
