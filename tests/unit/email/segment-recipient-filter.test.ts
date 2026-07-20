import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const validatorsSource = readFileSync('convex/_validators.ts', 'utf8');
const audienceFilterSource = readFileSync('convex/_audienceFilters.ts', 'utf8');
const segmentMatchSource = readFileSync('convex/_segmentMatch.ts', 'utf8');
const recipientFilterSource = readFileSync('convex/_emailRecipientFilter.ts', 'utf8');
const emailSource = readFileSync('convex/email.ts', 'utf8');
const blastsSource = readFileSync('convex/blasts.ts', 'utf8');
const composeServerSource = readFileSync(
	'src/routes/org/[slug]/emails/compose/+page.server.ts',
	'utf8'
);
const composePageSource = readFileSync('src/routes/org/[slug]/emails/compose/+page.svelte', 'utf8');
const audienceServerSource = readFileSync('src/lib/server/email/audience.ts', 'utf8');

describe('saved segment email recipient filters', () => {
	it('persists saved segment ids in the closed email recipient filter shape', () => {
		expect(validatorsSource).toMatch(
			/segmentIds:\s*v\.optional\(v\.array\(v\.id\(['"]segments['"]\)\)\)/
		);
		expect(validatorsSource).toContain('email uses `{tagIds, segmentIds, verified}`');
		// Both email implementations delegate persisted/caller input to the one
		// bounded normalizer instead of duplicating shape casts at each read site.
		expect(audienceFilterSource).toContain('candidate.segmentIds');
		expect(emailSource).toContain('normalizeEmailAudienceFilter(raw)');
		expect(blastsSource).toContain('normalizeEmailAudienceFilter(raw)');
	});

	it('uses the shared segment matcher inside email recipient resolution', () => {
		expect(segmentMatchSource).toContain('export function normalizeSegmentFilter');
		expect(segmentMatchSource).toContain('export function matchFilter');
		expect(segmentMatchSource).toContain("case 'campaignParticipation'");
		expect(segmentMatchSource).toContain("case 'actionDistrict'");
		expect(segmentMatchSource).toContain("case 'actionDistrictLabel'");

		expect(recipientFilterSource).toMatch(/ctx\.db\.normalizeId\(['"]segments['"]/);
		expect(recipientFilterSource).toContain('segment.orgId !== orgId');
		expect(recipientFilterSource).toContain('normalizeSegmentFilter(segment.filters)');
		// Action-derived segment dimensions now come from the same-transaction
		// supporter projection, avoiding an N×campaignActions join per send page.
		expect(recipientFilterSource).toContain('SUPPORTER_AUDIENCE_ACTION_VERSION');
		expect(recipientFilterSource).toContain('supporter.audienceDistrictCodes ?? []');
		expect(recipientFilterSource).toContain(
			'segmentFilters.some((segment) => matchFilter(supporter, tags, segment, actionContext))'
		);
		expect(recipientFilterSource).toContain('applyEmailRecipientFilter');
		expect(emailSource).toContain('export const countRecipientsForFilter = query');
		// Recipient resolution routes through one bounded cursor page per Convex
		// transaction; the server orchestrator advances until terminal.
		expect(emailSource).toContain('await pageFilteredRecipients');
		expect(blastsSource).toContain('await pageFilteredRecipients');
		expect(recipientFilterSource).toMatch(
			/applyEmailRecipientFilter\(ctx, orgId, page as T\[\], normalized\)/
		);
	});

	it('wires saved People segments through the composer instead of a local facade', () => {
		expect(composeServerSource).toContain('serverQuery(api.segments.list');
		expect(composeServerSource).toContain("formData.getAll('segmentIds')");
		expect(composeServerSource).toContain("segmentIds: segmentIds.length > 0 ? (segmentIds as Id<'segments'>[])");
		expect(composeServerSource).toContain('countEmailAudience(orgSlug, filter)');
		expect(audienceServerSource).toContain('serverQuery(api.email.countRecipientsForFilter');
		expect(audienceServerSource).toContain('cursor = next');
		expect(audienceServerSource).toContain('EMAIL_AUDIENCE_CURSOR_DID_NOT_ADVANCE');

		expect(composePageSource).toContain('let selectedSegmentIds = $state<string[]>([])');
		expect(composePageSource).toContain('People segments');
		expect(composePageSource).toContain('toggleSegment(segment.id)');
		expect(composePageSource).toContain('name="segmentIds"');
		expect(composePageSource).not.toContain("import SegmentBuilder");
		expect(composePageSource).not.toContain('useSegmentBuilder');
		expect(composePageSource).not.toContain('segmentFilterJson');
	});
});
