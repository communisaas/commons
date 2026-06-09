import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const platformProfiles = readFileSync('src/lib/data/platform-export-profiles.ts', 'utf8');
const importPage = readFileSync(
	'src/routes/org/[slug]/supporters/import/+page.svelte',
	'utf8'
);
const importServer = readFileSync(
	'src/routes/org/[slug]/supporters/import/+page.server.ts',
	'utf8'
);
const schema = readFileSync('convex/schema.ts', 'utf8');
const supporters = readFileSync('convex/supporters.ts', 'utf8');
const v1api = readFileSync('convex/v1api.ts', 'utf8');
const segmentTypes = readFileSync('src/lib/types/segment.ts', 'utf8');
const segmentMatcher = readFileSync('convex/_segmentMatch.ts', 'utf8');
const segmentBuilder = readFileSync('src/lib/components/segments/SegmentBuilder.svelte', 'utf8');
const layoutServer = readFileSync('src/routes/org/[slug]/+layout.server.ts', 'utf8');
const supportersServer = readFileSync('src/routes/org/[slug]/supporters/+page.server.ts', 'utf8');
const spaces = readFileSync('src/lib/components/org/os/spaces.ts', 'utf8');
const hypergraph = readFileSync('src/lib/data/capability-hypergraph.ts', 'utf8');
const capabilityScope = readFileSync('docs/design/ORG-CAPABILITY-SCOPE.md', 'utf8');
const canonicalDoc = readFileSync('docs/design/ORG-OS-AUTHORING-FIRST.md', 'utf8');

describe('readable civic geography segment labels', () => {
	it('recognizes congressional district labels as platform-neutral import fields', () => {
		expect(platformProfiles).toContain("| 'congressionalDistrict'");
		expect(platformProfiles).toContain("'congressional district': 'congressionalDistrict'");
		expect(platformProfiles).toContain("'us congressional district': 'congressionalDistrict'");
		expect(platformProfiles).toContain("'cd code': 'congressionalDistrict'");
		expect(importPage).toContain("{ value: 'congressionalDistrict', label: 'Congressional District' }");
		expect(importServer).toContain("'congressionalDistrict'");
		expect(importServer).toContain(
			"cleanBounded(fields['congressionalDistrict'], 32)?.toUpperCase()"
		);
		expect(importServer).toContain('congressionalDistrict: mapped.congressionalDistrict || undefined');
	});

	it('persists bounded imported district labels on supporter rows', () => {
		expect(schema).toContain('congressionalDistrict: v.optional(v.string())');
		expect(supporters).toContain('congressionalDistrict: v.optional(v.string())');
		expect(supporters).toContain('congressionalDistrict: args.congressionalDistrict');
		expect(supporters).toContain('patch.congressionalDistrict = args.congressionalDistrict');
		expect(supporters).toContain('!existing.congressionalDistrict');
		expect(supporters).toContain("throw new Error('CONGRESSIONAL_DISTRICT_TOO_LARGE')");
		expect(supporters).toContain(
			"congressionalDistrict: s.congressionalDistrict?.trim().replace(/\\s+/g, ' ').toUpperCase()"
		);
		expect(v1api).toContain('congressionalDistrict: v.optional(v.string())');
		expect(v1api).toContain('updates.congressionalDistrict = data.congressionalDistrict');
		expect(v1api).toContain('congressionalDistrict: args.congressionalDistrict');
	});

	it('makes imported congressional district labels segmentable without action context', () => {
		expect(segmentTypes).toContain("| 'congressionalDistrict'");
		expect(segmentTypes).toContain("value: 'congressionalDistrict'");
		expect(segmentTypes).toContain("label: 'Congressional District'");
		expect(segmentMatcher).toContain("case 'congressionalDistrict'");
		expect(segmentMatcher).toContain('supporter.congressionalDistrict');
		expect(segmentMatcher).not.toContain("cond.field === 'congressionalDistrict'");
		expect(segmentBuilder).toContain("condition.field === 'congressionalDistrict'");
		expect(segmentBuilder).toContain('placeholder="CA-11"');
	});

	it('makes action-time district labels segmentable through action context', () => {
		expect(schema).toContain('districtCode: v.optional(v.string())');
		expect(segmentTypes).toContain("| 'actionDistrictLabel'");
		expect(segmentTypes).toContain("value: 'actionDistrictLabel'");
		expect(segmentTypes).toContain("label: 'Action-Time District'");
		expect(segmentMatcher).toContain("case 'actionDistrictLabel'");
		expect(segmentMatcher).toContain('districtCodes: Set<string>');
		expect(segmentMatcher).toContain('actionContext?.districtCodes.has(districtCode)');
		expect(segmentBuilder).toContain("condition.field === 'actionDistrictLabel'");
		expect(segmentBuilder).toContain('placeholder="CA-11"');
	});

	it('renders the civic geography boundary inside the local segment builder', () => {
		expect(segmentBuilder).toContain("import { Datum } from '$lib/design';");
		expect(segmentBuilder).toContain('civicGeographyBoundary?: string;');
		expect(segmentBuilder).toContain('const importedReadableGeographyConditionCount = $derived');
		expect(segmentBuilder).toContain('const actionReadableGeographyConditionCount = $derived');
		expect(segmentBuilder).toContain('const actionDistrictHashConditionCount = $derived');
		expect(segmentBuilder).toContain('aria-label="Segment civic geography boundary"');
		expect(segmentBuilder).toContain('Civic geography boundary');
		expect(segmentBuilder).toContain('imported labels');
		expect(segmentBuilder).toContain('action labels');
		expect(segmentBuilder).toContain('hash evidence');
		expect(segmentBuilder).toContain(
			'Action-district hashes remain evidence filters; imported and action-time labels do not prove'
		);
	});

	it('threads imported district filters into aggregate-only readiness', () => {
		expect(spaces).toContain('congressionalDistrictConditionCount');
		expect(spaces).toContain('actionDistrictLabelConditionCount');
		expect(layoutServer).toContain("segmentConditionCount(conditions, [\n\t\t\t'congressionalDistrict'");
		expect(layoutServer).toContain("segmentConditionCount(conditions, ['actionDistrictLabel'])");
		expect(supportersServer).toContain(
			"segmentConditionCount(conditions, [\n\t\t\t'congressionalDistrict'"
		);
		expect(supportersServer).toContain("segmentConditionCount(conditions, ['actionDistrictLabel'])");
		expect(hypergraph).toContain('congressionalDistrictFilterCount');
		expect(hypergraph).toContain('actionDistrictLabelFilterCount');
		expect(hypergraph).toContain('imported congressional-district filters');
		expect(hypergraph).toContain('action-time district-label filters');
		expect(hypergraph).toContain(
			'Imported state/province, imported congressional district, and action-time congressional district labels can shape cohorts'
		);
		expect(capabilityScope).toContain(
			'`congressionalDistrict` (equals from imported readable label)'
		);
		expect(capabilityScope).toContain(
			'`actionDistrictLabel` (equals action-time readable congressional district label)'
		);
		expect(canonicalDoc).toContain(
			'Imported state/province, imported congressional district, and action-time congressional district labels are usable cohort fields'
		);
		expect(canonicalDoc).toContain(
			'The `/supporters` builder renders a local civic-geography boundary'
		);
		expect(canonicalDoc).toContain('passes capped backend counts or bulk tag results through as lower bounds');
		expect(capabilityScope).toContain('The route-local `SegmentBuilder` also carries that civic-geography boundary');
		expect(capabilityScope).toContain(
			'count or bulk tag result returned with `partial: true` renders as a lower bound'
		);
		expect(capabilityScope).toContain('not verified/materialized local/special geography');
		expect(capabilityScope).toContain('no local/special district membership filter exists yet');
	});
});
