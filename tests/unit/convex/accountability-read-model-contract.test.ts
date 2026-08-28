import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import ts from 'typescript';

function source(path: string): ts.SourceFile {
	const text = readFileSync(resolve(process.cwd(), path), 'utf8');
	return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function namedBody(file: ts.SourceFile, name: string): string {
	let match: ts.Node | undefined;
	const visit = (node: ts.Node): void => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
			match = node.initializer;
		}
		if (ts.isFunctionDeclaration(node) && node.name?.text === name) match = node;
		if (!match) ts.forEachChild(node, visit);
	};
	visit(file);
	if (!match) throw new Error(`Missing ${name} in ${file.fileName}`);
	return match.getText(file);
}

describe('accountability read-model source contract', () => {
	it('keeps profile receipt reads on one compact identity index page', () => {
		const body = namedBody(source('convex/legislation.ts'), 'listMyReceipts');
		expect(body).toContain('normalizeAccountabilityIdentityCommitment');
		expect(body).toContain("query('accountabilityUserReceiptProjections')");
		expect(body).toContain("withIndex('by_identityCommitment_proofDeliveredAt'");
		expect(body).toContain('.paginate({');
		expect(body).toContain('maximumRowsRead: limit + 1');
		for (const forbidden of [
			"query('supporters')",
			"query('campaignActions')",
			"query('campaignDeliveries')",
			"query('accountabilityReceipts')",
			'.collect('
		]) {
			expect(body).not.toContain(forbidden);
		}
	});

	it.each([
		['listReceiptsByCampaign', 'by_orgId_campaignId_proofDeliveredAt', 'browse'],
		['listReceiptsByOrg', 'by_orgId_proofDeliveredAt', 'browse'],
		['exportReceiptsByOrg', 'by_orgId_proofDeliveredAt', 'export']
	])('%s serves one explicit compact cursor page', (name, indexName, mode) => {
		const body = namedBody(source('convex/legislation.ts'), name);
		expect(body).toContain("query('accountabilityReceiptProjections')");
		expect(body).toContain(`withIndex('${indexName}'`);
		expect(body).toContain(`normalizeAccountabilityPageSize(args.limit, '${mode}')`);
		expect(body).toContain('.paginate({');
		expect(body).toContain('maximumRowsRead: limit + 1');
		expect(body).not.toContain("query('accountabilityReceipts')");
		expect(body).not.toContain('.collect(');
	});

	it('keeps public DM proof rows K-floored and organization scorecards page-scoped', () => {
		const legislation = source('convex/legislation.ts');
		const publicProfile = namedBody(legislation, 'getDmPublicProfile');
		expect(publicProfile).toContain("query('accountabilityDecisionMakerAggregates')");
		expect(publicProfile).toContain("query('accountabilityReceiptProjections')");
		expect(publicProfile).toContain("eq('publicEligible', true)");
		expect(publicProfile).toContain('.paginate({');
		expect(publicProfile).not.toContain("query('accountabilityReceipts')");

		for (const name of ['listOrgScorecards', 'exportScorecards']) {
			const body = namedBody(legislation, name);
			expect(body).toContain("query('accountabilityOrgDmProjections')");
			expect(body).toContain('.paginate({');
			expect(body).toContain('maximumRowsRead: limit + 1');
			expect(body).not.toContain("query('orgDmFollows')");
			expect(body).not.toContain("query('accountabilityReceipts')");
			expect(body).not.toContain('.collect(');
		}
	});

	it('builds weekly scorecards from cursor-paged compact projections only', () => {
		const legislation = source('convex/legislation.ts');
		const decisionMakers = namedBody(legislation, 'listDmsWithReceiptsSince');
		expect(decisionMakers).toContain("query('accountabilityDecisionMakerAggregates')");
		expect(decisionMakers).toContain("withIndex('by_latestProofDeliveredAt'");
		expect(decisionMakers).toContain('.paginate({');
		expect(decisionMakers).toContain('maximumRowsRead: SCORECARD_READ_PAGE_SIZE + 1');
		expect(decisionMakers).not.toContain("query('accountabilityReceipts')");
		expect(decisionMakers).not.toContain('.collect(');

		const receipts = namedBody(legislation, 'aggregateReceiptsForDm');
		expect(receipts).toContain("query('accountabilityReceiptProjections')");
		expect(receipts).toContain("withIndex('by_decisionMakerId_proofDeliveredAt'");
		expect(receipts).toContain('.paginate({');
		expect(receipts).toContain('maximumRowsRead: SCORECARD_READ_PAGE_SIZE + 1');
		expect(receipts).not.toContain("query('accountabilityReceipts')");
		expect(receipts).not.toContain('.collect(');

		const compute = namedBody(legislation, 'computeScorecards');
		expect(compute).toContain('listDmsWithReceiptsSinceRef');
		expect(compute).toContain('aggregateReceiptsForDmRef');
		expect(compute).toContain('dmPage.continueCursor');
		expect(compute).toContain('receiptPage.continueCursor');
		expect(compute).not.toContain("query('accountabilityReceipts')");
		expect(compute).not.toContain('.collect(');

		const voteBackfill = namedBody(legislation, 'backfillVoteReceiptResponses');
		expect(voteBackfill).toContain('isAccountabilityReadModelReady(migration)');
		expect(voteBackfill).toContain("query('accountabilityReceiptProjections')");
		expect(voteBackfill).toContain('.paginate({');
		expect(voteBackfill).not.toContain("query('accountabilityReceipts')");
	});

	it('keeps every receipt, response, action, identity, follow, and scorecard writer hooked', () => {
		const campaigns = source('convex/campaigns.ts');
		expect(namedBody(campaigns, 'maybeCreateAccountabilityReceiptForDelivery')).toContain(
			'syncAccountabilityReceiptProjection'
		);
		expect(namedBody(campaigns, 'recordResponse')).toContain(
			'syncAccountabilityReceiptProjection'
		);
		expect(namedBody(campaigns, 'findOrCreateSupporter')).toContain(
			'syncSupporterIdentityReceiptProjections'
		);
		expect(namedBody(campaigns, 'updateDeliveryStatus')).toContain(
			'maybeCreateAccountabilityReceiptForDelivery'
		);

		expect(namedBody(source('convex/webhooks.ts'), 'handleDeliveryEvent')).toContain(
			'syncAccountabilityReceiptProjection'
		);

		const legislation = source('convex/legislation.ts');
		for (const writer of ['followDm', 'updateDmFollow', 'unfollowDm']) {
			expect(namedBody(legislation, writer)).toContain(
				'syncAccountabilityOrgDmFollowProjection'
			);
		}
		expect(namedBody(legislation, 'createAction')).toContain(
			'backfillVoteReceiptResponsesRef'
		);
		expect(namedBody(legislation, 'backfillVoteReceiptResponses')).toContain(
			'syncAccountabilityReceiptProjection'
		);
		expect(namedBody(legislation, 'saveScorecard')).toContain(
			'syncAccountabilityScorecardProjection'
		);

		const supporters = source('convex/supporters.ts');
		for (const writer of ['remove', 'deleteStrandedPlaceholder']) {
			expect(namedBody(supporters, writer)).toContain(
				'syncSupporterIdentityReceiptProjections'
			);
		}
		expect(namedBody(source('convex/v1api.ts'), 'deleteSupporter')).toContain(
			'syncSupporterIdentityReceiptProjections'
		);
	});

	it('requires the same exact cutover state at every serving boundary', () => {
		const pure = namedBody(
			source('convex/lib/accountabilityReadModel.ts'),
			'isAccountabilityReadModelReady'
		);
		for (const invariant of [
			"row?.status === 'ready'",
			"row.phase === 'complete'",
			'row.scanComplete === true',
			'row.cursor === undefined',
			'row.failureCode === undefined',
			'row.failureSourceId === undefined',
			'row.failurePhase === undefined',
			'row.scanned === row.projected'
		]) {
			expect(pure).toContain(invariant);
		}

		const db = source('convex/lib/accountabilityReadModelDb.ts');
		expect(namedBody(db, 'requireAccountabilityReadModelReady')).toContain(
			'isAccountabilityReadModelReady(migration)'
		);
		const module = source('convex/accountabilityReadModel.ts');
		expect(namedBody(module, 'readiness')).toContain('isAccountabilityReadModelReady(row)');
		expect(namedBody(module, 'activate')).toContain('isAccountabilityReadModelReady(migration)');
	});

	it('keeps legacy migration and identity repair self-paged without collection scans', () => {
		const module = source('convex/accountabilityReadModel.ts');
		const migrate = namedBody(module, 'migrate');
		expect(migrate).toContain('MIGRATION_PAGE_SIZE');
		expect(migrate).toContain('MIGRATION_MAX_BYTES');
		expect(migrate).toContain("page.pageStatus === 'SplitRequired'");
		expect(migrate).toContain('ctx.scheduler.runAfter');
		expect(migrate).not.toContain('.collect(');

		const repair = namedBody(module, 'reprojectSupporterIdentityReceipts');
		expect(repair).toContain('IDENTITY_REPROJECT_PAGE_SIZE');
		expect(repair).toContain("query('accountabilityUserReceiptProjections')");
		expect(repair).toContain("withIndex('by_supporterId_proofDeliveredAt'");
		expect(repair).toContain('ctx.scheduler.runAfter');
		for (const growingSource of [
			"query('campaignActions')",
			"query('campaignDeliveries')",
			"query('accountabilityReceipts')"
		]) {
			expect(repair).not.toContain(growingSource);
		}
		expect(repair).not.toContain('.collect(');
	});
});
