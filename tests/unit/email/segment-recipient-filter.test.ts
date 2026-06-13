import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const validatorsSource = readFileSync('convex/_validators.ts', 'utf8');
const segmentMatchSource = readFileSync('convex/_segmentMatch.ts', 'utf8');
const recipientFilterSource = readFileSync('convex/_emailRecipientFilter.ts', 'utf8');
const emailSource = readFileSync('convex/email.ts', 'utf8');
const blastsSource = readFileSync('convex/blasts.ts', 'utf8');
const composeServerSource = readFileSync(
	'src/routes/org/[slug]/emails/compose/+page.server.ts',
	'utf8'
);
const composePageSource = readFileSync('src/routes/org/[slug]/emails/compose/+page.svelte', 'utf8');

describe('saved segment email recipient filters', () => {
	it('persists saved segment ids in the closed email recipient filter shape', () => {
		expect(validatorsSource).toContain('segmentIds: v.optional(v.array(v.id("segments")))');
		expect(validatorsSource).toContain('email uses `{tagIds, segmentIds, verified}`');
		expect(emailSource).toContain('candidate.segmentIds');
		expect(blastsSource).toContain('candidate.segmentIds');
	});

	it('uses the shared segment matcher inside email recipient resolution', () => {
		expect(segmentMatchSource).toContain('export function normalizeSegmentFilter');
		expect(segmentMatchSource).toContain('export function matchFilter');
		expect(segmentMatchSource).toContain("case 'campaignParticipation'");
		expect(segmentMatchSource).toContain("case 'actionDistrict'");
		expect(segmentMatchSource).toContain("case 'actionDistrictLabel'");

		expect(recipientFilterSource).toContain('ctx.db.normalizeId("segments"');
		expect(recipientFilterSource).toContain('segment.orgId !== orgId');
		expect(recipientFilterSource).toContain('normalizeSegmentFilter(segment.filters)');
		expect(recipientFilterSource).toContain('action.districtCode?.trim().toUpperCase()');
		expect(recipientFilterSource).toContain('matchesAnySegment');
		expect(recipientFilterSource).toContain('applyEmailRecipientFilter');
		expect(emailSource).toContain('export const countRecipientsForFilter = query');
		expect(emailSource).toContain('const filtered = await applyEmailRecipientFilter');
		expect(blastsSource).toContain('const filtered = await applyEmailRecipientFilter');
	});

	it('wires saved People segments through the composer instead of a local facade', () => {
		expect(composeServerSource).toContain('serverQuery(api.segments.list');
		expect(composeServerSource).toContain("formData.getAll('segmentIds')");
		expect(composeServerSource).toContain("segmentIds: segmentIds.length > 0 ? (segmentIds as Id<'segments'>[])");
		expect(composeServerSource).toContain('api.email.countRecipientsForFilter');

		expect(composePageSource).toContain('let selectedSegmentIds = $state<string[]>([])');
		expect(composePageSource).toContain('People segments');
		expect(composePageSource).toContain('toggleSegment(segment.id)');
		expect(composePageSource).toContain('name="segmentIds"');
		expect(composePageSource).not.toContain("import SegmentBuilder");
		expect(composePageSource).not.toContain('useSegmentBuilder');
		expect(composePageSource).not.toContain('segmentFilterJson');
	});
});
