import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	NO_SAVED_SEGMENTS_SENTENCE,
	SEGMENTS_UNAVAILABLE_SENTENCE,
	describeSavedSegments,
	dominantSegmentFamilies
} from '$lib/components/org/os/people-reach';
import type { PeopleSegmentationGroundData } from '$lib/components/org/os/spaces';

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

	it('threads imported district filters into segment condition counts', () => {
		expect(spaces).toContain('congressionalDistrictConditionCount');
		expect(spaces).toContain('actionDistrictLabelConditionCount');
		expect(layoutServer).toContain("segmentConditionCount(conditions, [\n\t\t\t'congressionalDistrict'");
		expect(layoutServer).toContain("segmentConditionCount(conditions, ['actionDistrictLabel'])");
		expect(supportersServer).toContain(
			"segmentConditionCount(conditions, [\n\t\t\t'congressionalDistrict'"
		);
		expect(supportersServer).toContain("segmentConditionCount(conditions, ['actionDistrictLabel'])");
	});
});

describe('People space saved-segment sentences', () => {
	function makeSegmentation(
		overrides: Partial<PeopleSegmentationGroundData> = {}
	): PeopleSegmentationGroundData {
		return {
			segmentCount: 0,
			conditionCount: 0,
			tagConditionCount: 0,
			verificationConditionCount: 0,
			sourceConditionCount: 0,
			emailStatusConditionCount: 0,
			dateConditionCount: 0,
			postalCountryConditionCount: 0,
			stateCodeConditionCount: 0,
			congressionalDistrictConditionCount: 0,
			campaignParticipationConditionCount: 0,
			actionDistrictHashConditionCount: 0,
			actionDistrictLabelConditionCount: 0,
			engagementTierConditionCount: 0,
			humanReadableGeographyConditionCount: 0,
			...overrides
		};
	}

	it('names the dominant condition families in plain words', () => {
		const segmentation = makeSegmentation({
			segmentCount: 4,
			conditionCount: 5,
			congressionalDistrictConditionCount: 2,
			actionDistrictLabelConditionCount: 1,
			tagConditionCount: 2
		});
		expect(dominantSegmentFamilies(segmentation)).toEqual(['by district', 'by tag']);
		expect(describeSavedSegments(segmentation)).toBe('4 saved segments — by district, by tag');
	});

	it('does not double-count the human-readable geography rollup', () => {
		const segmentation = makeSegmentation({
			segmentCount: 2,
			conditionCount: 2,
			congressionalDistrictConditionCount: 1,
			tagConditionCount: 1
		});
		const withRollup = makeSegmentation({
			...segmentation,
			humanReadableGeographyConditionCount: 9
		});
		expect(dominantSegmentFamilies(withRollup)).toEqual(dominantSegmentFamilies(segmentation));
	});

	it('reads a count without families when conditions are empty', () => {
		expect(describeSavedSegments(makeSegmentation({ segmentCount: 1 }))).toBe('1 saved segment');
	});

	it('phrases zero and unavailable states as quiet sentences, not zeros', () => {
		expect(describeSavedSegments(makeSegmentation())).toBe(NO_SAVED_SEGMENTS_SENTENCE);
		expect(NO_SAVED_SEGMENTS_SENTENCE).toMatch(/^No saved segments yet/);
		expect(SEGMENTS_UNAVAILABLE_SENTENCE).toMatch(/unavailable right now, not gone/);
	});

	it('links the People surface into the saved-segment anchor on the people list', () => {
		const peopleSurface = readFileSync('src/lib/components/org/os/BaseSpace.svelte', 'utf8');
		expect(peopleSurface).toContain('{base}/supporters#people-segments');
	});
});
