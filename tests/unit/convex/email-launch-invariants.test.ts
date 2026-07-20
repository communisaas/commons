import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const emailSource = readFileSync('convex/email.ts', 'utf8');
const schemaSource = readFileSync('convex/schema.ts', 'utf8');

describe('email launch invariants', () => {
	it('tombstones every legacy Convex server-dispatch authority at handler entry', () => {
		expect(emailSource).toContain('export const EMAIL_SERVER_DISPATCH_LAUNCH_ENABLED = false');
		for (const name of [
			'enqueueServerDispatch',
			'enqueueAbTestDispatch',
			'enqueueAbRemainderDispatch',
			'updateBlastStatus',
			'incrementBlastCounters',
			'getBlastRecipients',
			'sendBlast',
			'sendBlastBatch'
		]) {
			const start = emailSource.indexOf(`export const ${name}`);
			expect(start, name).toBeGreaterThanOrEqual(0);
			const next = emailSource.indexOf('\nexport const ', start + 20);
			const section = emailSource.slice(start, next === -1 ? undefined : next);
			const guard = section.indexOf('requireEmailServerDispatchLaunchEnabled()');
			expect(guard, `${name} guard`).toBeGreaterThanOrEqual(0);
			for (const sideEffect of ['ctx.db.get', 'ctx.runQuery', 'ctx.scheduler.runAfter']) {
				const index = section.indexOf(sideEffect);
				if (index >= 0) expect(index, `${name} ${sideEffect}`).toBeGreaterThan(guard);
			}
		}
	});

	it('validates bounded draft inputs before authorization or database reads', () => {
		const createBlast = emailSource.slice(
			emailSource.indexOf('export const createBlast = mutation'),
			emailSource.indexOf('export const createAbTestDrafts = mutation')
		);
		expect(createBlast.indexOf('assertEmailDraftInput(args)')).toBeGreaterThanOrEqual(0);
		expect(createBlast.indexOf('assertEmailDraftInput(args)')).toBeLessThan(
			createBlast.indexOf('requireOrgRole(ctx')
		);
		expect(createBlast).toContain('EMAIL_AB_DRAFTS_REQUIRE_ATOMIC_CREATOR');
		expect(createBlast).toContain('EMAIL_SEND_MODE_INVALID');
		expect(createBlast).toContain('normalizeEmailAudienceFilter(args.recipientFilter)');
		expect(createBlast).toContain('EMAIL_CAMPAIGN_NOT_IN_ORGANIZATION');
	});

	it('keeps A/B cohorts tenant-scoped and cardinality bounded', () => {
		expect(schemaSource).toContain(".index('by_orgId_abParentId', ['orgId', 'abParentId'])");
		expect(schemaSource).not.toContain(".index('by_abParentId', ['abParentId'])");
		expect(emailSource).toContain(".withIndex('by_orgId_abParentId'");
		expect(emailSource).toContain('.take(MAX_AB_GROUP_BLASTS + 1)');
		expect(emailSource).toContain('EMAIL_AB_GROUP_CARDINALITY_REPAIR_REQUIRED');
	});

	it('deduplicates and caps active bounce reports in the mutation transaction', () => {
		const createBounceReport = emailSource.slice(
			emailSource.indexOf('export const createBounceReport = mutation'),
			emailSource.indexOf('export const getBounceReportsByEmailHash = query')
		);
		expect(schemaSource).toContain(
			".index('by_reportedBy_emailHash_resolved', ['reportedBy', 'emailHash', 'resolved'])"
		);
		expect(schemaSource).toContain(
			".index('by_reportedBy_resolved', ['reportedBy', 'resolved'])"
		);
		expect(createBounceReport).toContain(".withIndex('by_reportedBy_emailHash_resolved'");
		expect(createBounceReport).toContain(".withIndex('by_reportedBy_resolved'");
		expect(createBounceReport).toContain('.take(MAX_ACTIVE_BOUNCE_REPORTS_PER_USER)');
		expect(createBounceReport).toContain('BOUNCE_REPORT_USER_CAP_REACHED');
	});
});
