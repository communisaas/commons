import { describe, it, expect } from 'vitest';
import { mergeLandscape, type DistrictOfficialInput } from '$lib/utils/landscapeMerge';
import type { ProcessedDecisionMaker } from '$lib/types/template';

const officials: DistrictOfficialInput[] = [
	{
		name: 'Jane Senator',
		title: 'Senator',
		organization: 'US Senate',
		bioguideId: 'S000001',
		cwcCode: 'CWC-S1',
		chamber: 'senate',
		phone: null,
		contactFormUrl: null,
		websiteUrl: null
	}
];

// No template DMs needed for the district-group label assertions.
const noTemplateDMs: ProcessedDecisionMaker[] = [];

describe('mergeLandscape — district group label gating (honesty)', () => {
	it('uses the possessive "YOUR REPRESENTATIVES" only for a constituent', () => {
		const result = mergeLandscape(noTemplateDMs, officials, true);
		expect(result.districtGroup).not.toBeNull();
		expect(result.districtGroup?.label).toBe('YOUR REPRESENTATIVES');
	});

	it('uses a non-possessive label for a non-constituent viewer', () => {
		const result = mergeLandscape(noTemplateDMs, officials, false);
		expect(result.districtGroup).not.toBeNull();
		expect(result.districtGroup?.label).toBe('DISTRICT OFFICIALS');
		expect(result.districtGroup?.label).not.toMatch(/your/i);
	});

	it('defaults to the non-possessive label when the flag is omitted', () => {
		const result = mergeLandscape(noTemplateDMs, officials);
		expect(result.districtGroup?.label).toBe('DISTRICT OFFICIALS');
		expect(result.districtGroup?.label).not.toMatch(/your/i);
	});

	it('still returns no district group when there are no district officials', () => {
		expect(mergeLandscape(noTemplateDMs, [], true).districtGroup).toBeNull();
		expect(mergeLandscape(noTemplateDMs, [], false).districtGroup).toBeNull();
	});
});
