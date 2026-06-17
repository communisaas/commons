import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const emailSource = readFileSync('convex/email.ts', 'utf8');
const detailServerSource = readFileSync(
	'src/routes/org/[slug]/emails/[blastId]/+page.server.ts',
	'utf8'
);
const detailPageSource = readFileSync(
	'src/routes/org/[slug]/emails/[blastId]/+page.svelte',
	'utf8'
);
const composeServerSource = readFileSync(
	'src/routes/org/[slug]/emails/compose/+page.server.ts',
	'utf8'
);
const composePageSource = readFileSync('src/routes/org/[slug]/emails/compose/+page.svelte', 'utf8');

describe('A/B test evidence surface', () => {
	it('exposes an org-scoped sibling query for linked A/B variants', () => {
		expect(emailSource).toContain('export const getAbTestGroup = query');
		expect(emailSource).toMatch(/requireOrgRole\(ctx, args\.orgSlug, ['"]member['"]\)/);
		expect(emailSource).toContain('!blast.isAbTest');
		expect(emailSource).toMatch(/\.withIndex\(['"]by_abParentId['"]/);
		expect(emailSource).toContain('sibling.orgId === org._id && sibling.isAbTest');
	});

	it('loads A/B groups on the email detail route instead of hardcoding the generic view', () => {
		expect(detailServerSource).toContain('api.email.getAbTestGroup');
		expect(detailServerSource).toContain('convexBlast.isAbTest === true');
		expect(detailServerSource).toContain('variants.length > 1');
		expect(detailServerSource).not.toContain('isAbTest: false,\n\t\tblast: {');
	});

	it('describes winner marking separately from gated production dispatch', () => {
		expect(detailPageSource).toContain('A/B Test Group');
		expect(detailPageSource).toContain('A/B continuation');
		expect(detailPageSource).toContain('won. A follow-up email for the held-back group');
		expect(detailPageSource).toContain('Create remainder draft');
		expect(detailPageSource).toContain('Queue remainder send');
		expect(detailPageSource).toContain('Send to test groups');
		expect(detailPageSource).toContain('serverDispatchRuntimeArmed');
		expect(detailPageSource).not.toContain('Winning variant sent to');
	});

	it('persists exact A/B cohort filters and a remainder draft contract', () => {
		expect(emailSource).toContain('export const resolveRecipientHashesForFilter = query');
		expect(emailSource).toContain('export const createAbTestDrafts = mutation');
		expect(emailSource).toContain('emailAbTestCohorts');
		expect(emailSource).toContain('variantAEmailHashes');
		expect(emailSource).toContain('remainderEmailHashes');
		expect(emailSource).toContain('export const createAbRemainderDraft = mutation');
		expect(emailSource).toContain('export const enqueueAbTestDispatch = mutation');
		expect(emailSource).toContain('export const enqueueAbRemainderDispatch = mutation');
		expect(emailSource).toContain('function assertExactHashSnapshot');
		expect(emailSource).toContain('function readSupportedAbWinnerMetric');
		expect(emailSource).toContain('A/B winner metric is not supported by the current picker');
		expect(emailSource).toContain('queueExactServerDispatch');
		expect(emailSource).not.toContain("schema doesn't capture explicitly");
		expect(detailServerSource).toContain('api.email.createAbRemainderDraft');
		expect(detailServerSource).toContain('api.email.enqueueAbTestDispatch');
		expect(detailServerSource).toContain('api.email.enqueueAbRemainderDispatch');
		expect(detailServerSource).toContain('if (!FEATURES.EMAIL_SERVER_DISPATCH)');
		expect(detailServerSource).toContain('serverDispatchBoundary(params.slug)');
		expect(detailServerSource).toContain("errorCode: 'email_server_dispatch_dependency_missing'");
		expect(detailServerSource).toContain('winnerMetricSupported:');
		expect(detailServerSource).toContain('winnerBlastId:');
		expect(detailPageSource).toContain('data.abCohort');
		expect(detailPageSource).toContain('Open remainder draft');
	});

	it('uses supported winner metrics and duration instead of a hardcoded picker window', () => {
		expect(emailSource).toContain('totalClicked: b.totalClicked');
		expect(emailSource).toContain('readSupportedAbWinnerMetric(rawWinnerMetric)');
		expect(emailSource).toContain('rawConfig?.testDurationMs');
		expect(emailSource).toContain('winnerBlastId: String(args.winnerId)');
		expect(emailSource).toContain('Selected variant is not the recorded winner');
		expect(emailSource).not.toContain('const TIMEOUT_MS = 48 * 60 * 60 * 1000');
		expect(composeServerSource).toContain("['open', 'click'].includes(rawWinnerMetric)");
		expect(composeServerSource).not.toContain("['open', 'click', 'verified_action']");
		expect(composePageSource).not.toContain('<option value="verified_action">');
		expect(composePageSource).toContain('get the winning');
		expect(composePageSource).toContain('The test groups are saved exactly as selected');
		expect(composePageSource).not.toContain('requires manual follow-up');
		expect(detailPageSource).toContain('recordedWinnerBlastId');
		expect(detailPageSource).toContain('canMaterializeAbRemainder');
	});
});
