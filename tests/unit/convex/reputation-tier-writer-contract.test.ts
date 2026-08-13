import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type ActionCountPatch = {
	file: string;
	target: string;
	properties: string[];
};

function runtimeTypeScriptFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			return entry.name === '_generated' ? [] : runtimeTypeScriptFiles(absolute);
		}
		return entry.name.endsWith('.ts') &&
			!entry.name.endsWith('.test.ts') &&
			!entry.name.endsWith('.d.ts')
			? [absolute]
			: [];
	});
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
	if (!('name' in property) || !property.name) return null;
	if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
		return property.name.text;
	}
	return null;
}

function actionCountPatchInventory(): {
	patches: ActionCountPatch[];
	invalidUserInserts: string[];
} {
	const patches: ActionCountPatch[] = [];
	const invalidUserInserts: string[] = [];
	for (const file of runtimeTypeScriptFiles('convex')) {
		const source = readFileSync(file, 'utf8');
		const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
		function visit(node: ts.Node): void {
			if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
				const method = node.expression.name.text;
				if (
					(method === 'patch' || method === 'replace') &&
					ts.isObjectLiteralExpression(node.arguments[1])
				) {
					const properties = node.arguments[1].properties
						.map(propertyName)
						.filter((name): name is string => name !== null);
					if (properties.includes('actionCount')) {
						patches.push({
							file: file.split(path.sep).join('/'),
							target: node.arguments[0]?.getText(sourceFile) ?? '<missing>',
							properties
						});
					}
				}
				if (
					method === 'insert' &&
					ts.isStringLiteral(node.arguments[0]) &&
					node.arguments[0].text === 'users' &&
					ts.isObjectLiteralExpression(node.arguments[1])
				) {
					const properties = node.arguments[1].properties
						.map(propertyName)
						.filter((name): name is string => name !== null);
					if (properties.includes('actionCount') && !properties.includes('reputationTier')) {
						invalidUserInserts.push(`${file}:${sourceFile.getLineAndCharacterOfPosition(node.pos).line + 1}`);
					}
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
	}
	return { patches, invalidUserInserts };
}

function exportedFunction(source: string, name: string): string {
	const start = source.indexOf(`export const ${name} =`);
	if (start < 0) throw new Error(`missing exported function ${name}`);
	const end = source.indexOf('export const ', start + 30);
	return source.slice(start, end < 0 ? source.length : end);
}

describe('transactional reputation-tier writer contract', () => {
	it('keeps the post-increment tier ahead of every immutable attribution consumer', () => {
		const campaigns = exportedFunction(readFileSync('convex/campaigns.ts', 'utf8'), 'createCampaignAction');
		const submissionRoute = readFileSync('src/routes/api/submissions/create/+server.ts', 'utf8');
		const userPatch = campaigns.indexOf('await ctx.db.patch(args.userId, {');
		const actionInsert = campaigns.indexOf("await ctx.db.insert('campaignActions', {");
		expect(userPatch).toBeGreaterThan(0);
		expect(userPatch).toBeLessThan(actionInsert);
		expect(campaigns).toContain('actionCount: nextUserActionCount');
		expect(campaigns).toContain('reputationTier: nextUserReputation.reputationTier');
		expect(campaigns.match(/args\.engagementTier/g)).toHaveLength(1);
		expect(campaigns.match(/engagementTier: effectiveEngagementTier/g)).toHaveLength(3);
		expect(campaigns).toContain('const tier = effectiveEngagementTier');
		expect(submissionRoute).toContain("from '$convex/lib/reputationTier'");
		expect(submissionRoute).toContain(
			'reputationStateForActionCount(userActionCount).engagementTier'
		);
		expect(submissionRoute).not.toContain('userActionCount >=');
	});

	it('pins every literal actionCount patch and requires paired user-tier writes', () => {
		const inventory = actionCountPatchInventory();
		expect(inventory.invalidUserInserts).toEqual([]);
		expect(inventory.patches).toEqual([
			{
				file: 'convex/campaigns.ts',
				target: 'args.userId',
				properties: ['actionCount', 'reputationTier', 'updatedAt']
			},
			{
				file: 'convex/campaigns.ts',
				target: 'args.campaignId',
				properties: [
					'actionCount',
					'verifiedActionCount',
					'tier3VerifiedActionCount',
					'updatedAt'
				]
			},
			{
				file: 'convex/seed.ts',
				target: 'campaignIds[lc.campaignIdx]',
				properties: ['actionCount', 'verifiedActionCount']
			}
		]);
	});

	it('keeps legacy repair explicit and absent from native recurring work', () => {
		const users = readFileSync('convex/users.ts', 'utf8');
		const crons = readFileSync('convex/crons.ts', 'utf8');
		const recurringManifest = readFileSync('config/convex-native-recurring-work.json', 'utf8');
		expect(users).toContain('Explicit one-time repair for legacy rows');
		expect(crons).not.toContain('recomputeAllReputationTiers');
		expect(crons).not.toContain('reputation-recompute');
		expect(recurringManifest).not.toContain('recomputeAllReputationTiers');
		expect(recurringManifest).not.toContain('reputation-recompute');
	});
});
