import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import ts from 'typescript';

function source(path: string): { file: ts.SourceFile; text: string } {
	const text = readFileSync(resolve(process.cwd(), path), 'utf8');
	return {
		text,
		file: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
	};
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

describe('recipient metrics request-path contract', () => {
	it('keeps all browser-callable reads secret-first', () => {
		const templatePage = source('convex/templatePage.ts').file;
		const positions = source('convex/positions.ts').file;
		for (const [file, names] of [
			[
				templatePage,
				['getMessageDistrictCounts', 'getTotalStates', 'recipientMetricsStatus']
			],
			[
				positions,
				['getCounts', 'getMetrics', 'getEngagementByDistrict', 'getFullEngagementByDistrict']
			]
		] as const) {
			for (const name of names) {
				const body = namedBody(file, name);
				const guard = body.indexOf('requireInternalSecret');
				expect(guard, `${name} must guard`).toBeGreaterThanOrEqual(0);
				const firstRead = Math.min(
					...['ctx.db', 'readMessageDistrictMetrics', 'readPositionMetrics']
						.map((needle) => body.indexOf(needle))
						.filter((index) => index >= 0)
				);
				if (Number.isFinite(firstRead)) expect(guard, `${name} guard order`).toBeLessThan(firstRead);
			}
		}
	});

	it('never reads growing event tables from aggregate readers', () => {
		const helper = source('convex/lib/recipientMetrics.ts').file;
		for (const name of ['readMessageDistrictMetrics', 'readPositionMetrics']) {
			const body = namedBody(helper, name);
			expect(body).not.toContain('.collect(');
			expect(body).not.toContain('.paginate(');
			expect(body).not.toContain('positionRegistrations');
			expect(body).not.toContain('.query(\'messages\')');
			expect(body).toContain('metricSummary');
			expect(body).toContain('.unique()');
		}
		const totalStates = namedBody(source('convex/templatePage.ts').file, 'getTotalStates');
		expect(totalStates).not.toContain('ctx.db');
		expect(totalStates).toContain('count: 50');
	});

	it('dual-writes raw position rows and bounds both migration phases', () => {
		const positions = source('convex/positions.ts').file;
		for (const name of ['register', 'confirmMailtoSend']) {
			const body = namedBody(positions, name);
			expect(body).toContain('requireRecipientMetricsWritable');
			expect(body).toContain('recipientMetricsVersion: RECIPIENT_METRICS_VERSION');
			expect(body).toContain('applyPositionRegistrationMetric');
			expect(body.indexOf('requireRecipientMetricsWritable')).toBeLessThan(
				body.indexOf('ctx.db.insert')
			);
		}

		const migration = namedBody(source('convex/templatePage.ts').file, 'migrateRecipientMetrics');
		expect(migration).toContain('MESSAGE_METRICS_MIGRATION_PAGE_SIZE');
		expect(migration).toContain('MESSAGE_METRICS_MIGRATION_MAX_BYTES');
		expect(migration).toContain('POSITION_METRICS_MIGRATION_PAGE_SIZE');
		expect(migration).toContain('POSITION_METRICS_MIGRATION_MAX_BYTES');
		expect(migration).toContain('recipientMetricsVersion: RECIPIENT_METRICS_VERSION');
		expect(migration).toMatch(/page\.pageStatus === ['"]SplitRequired['"]/);
	});

	it('coordinates destructive seed flows with the recipient cutover', () => {
		const seed = source('convex/seed.ts').file;
		const orderedTables = [
			'recipientMetricsMigrations',
			'positionRegistrations',
			'messages',
			'templateMessageDistrictMetrics',
			'templatePositionDistrictMetrics',
			'templateRecipientMetrics',
			'templates'
		];
		for (const name of ['SEED_TABLES', 'reseedTemplates']) {
			const body = namedBody(seed, name);
			const offsets = orderedTables.map((table) => body.indexOf(table));
			expect(offsets.every((offset) => offset >= 0), `${name} must cover every plane row`).toBe(
				true
			);
			expect(offsets, `${name} must close, drain raw rows, then compact rows`).toEqual(
				[...offsets].sort((left, right) => left - right)
			);
		}

		for (const name of ['seedAll', 'seedPublic', 'clearSeed', 'reseedTemplates']) {
			expect(namedBody(seed, name)).toContain('ensureRecipientMetricsReadyAfterSeed');
		}
	});

	it('uses producer-published public metrics plus one viewer-only overlay and passes secrets at every route caller', () => {
		const page = source('src/routes/s/[slug]/+page.server.ts').text;
		expect(page).toContain('publicAggregate.positionMetrics');
		expect(page.match(/api\.positions\.getViewerDistrictMetric/g)).toHaveLength(1);
		expect(page.match(/api\.templatePage\.getViewerMessageDistrictCount/g)).toHaveLength(1);
		expect(page).not.toContain('api.positions.getMetrics');
		expect(page).not.toContain('api.positions.getCounts');
		expect(page).not.toContain('api.positions.getEngagementByDistrict');
		expect(page).not.toContain('api.templatePage.getTotalStates');
		expect(page).not.toContain('api.templatePage.getMessageDistrictCounts');
		expect(page).toMatch(
			/api\.templatePage\.getViewerMessageDistrictCount[\s\S]*?_secret: getInternalSecret\(\)/
		);
		expect(page).toMatch(
			/api\.positions\.getViewerDistrictMetric[\s\S]*?_secret: getInternalSecret\(\)/
		);

		for (const path of [
			'src/routes/api/positions/count/[templateId]/+server.ts',
			'src/routes/api/positions/engagement-by-district/[templateId]/+server.ts',
			'src/routes/api/positions/register/+server.ts'
		]) {
			const route = source(path).text;
			expect(route).toContain('_secret: getInternalSecret()');
		}
	});
});
