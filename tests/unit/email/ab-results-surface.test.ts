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
const capabilityScopeSource = readFileSync('docs/design/ORG-CAPABILITY-SCOPE.md', 'utf8');
const capabilityHypergraphSource = readFileSync('src/lib/data/capability-hypergraph.ts', 'utf8');

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
		expect(detailPageSource).toContain('Winner marker recorded');
		expect(detailPageSource).toContain('Create remainder draft');
		expect(detailPageSource).toContain('Queue remainder send');
		expect(detailPageSource).toContain('Queue test cohorts');
		expect(detailPageSource).toContain('serverDispatchRuntimeArmed');
		expect(detailPageSource).toContain('aria-label="A/B continuation pressure"');
		expect(detailPageSource).toContain(
			'const abContinuationPressureReadouts = $derived<AbContinuationPressureReadout[]>(['
		);
		expect(detailPageSource).toContain("label: 'Snapshot ground'");
		expect(detailPageSource).toContain("label: 'Held remainder'");
		expect(detailPageSource).toContain("label: 'Dispatch gate'");
		expect(detailPageSource).toContain('emailAbTestCohorts.totalCount');
		expect(detailPageSource).toContain('EMAIL_SERVER_DISPATCH + getEmailServerDispatchReadiness');
		expect(detailPageSource).toContain('runtime-gated server dispatch path');
		expect(detailPageSource).toContain('this runtime keeps the variants draft-only');
		expect(detailPageSource).not.toContain('Winning variant sent to');
		expect(capabilityScopeSource).toContain('exact `includeEmailHashes` recipient filters');
		expect(capabilityScopeSource).toContain('enqueueAbTestDispatch');
		expect(capabilityScopeSource).toContain(
			'production A/B side effects remain dependency-bound until the same server email runtime checks pass'
		);
		expect(capabilityScopeSource).not.toContain('A/B winner picker is a stub');
		expect(capabilityHypergraphSource).toContain(
			'exact test and remainder queue hooks exist'
		);
		expect(capabilityHypergraphSource).toContain(
			'runtime dependencies keep side effects behind server dispatch'
		);
		expect(capabilityHypergraphSource).toContain(
			'automated A/B side effects remain preserved drafts until server-dispatch runtime evidence clears'
		);
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
		expect(composePageSource).toContain('stays held as an exact continuation');
		expect(composePageSource).toContain('cohort.');
		expect(composePageSource).not.toContain('requires manual follow-up');
		expect(detailPageSource).toContain('Verified-action A/B winner selection is not armed');
		expect(detailPageSource).toContain('recordedWinnerBlastId');
		expect(detailPageSource).toContain('canMaterializeAbRemainder');
		expect(capabilityScopeSource).toContain(
			'Winner metrics are open/click only until verified-action attribution is joined'
		);
	});
});
