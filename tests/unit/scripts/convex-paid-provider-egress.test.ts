import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
	scanConvexPaidProviderEgress,
	validateConvexPaidProviderEgress
} from '../../../scripts/verify-convex-paid-provider-egress.mjs';

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function policy() {
	return JSON.parse(readFileSync('config/convex-paid-provider-egress.json', 'utf8'));
}

describe('Convex paid-provider egress ratchet', () => {
	it('inventories the entire executable tree and permits no Convex provider capability', () => {
		const scan = scanConvexPaidProviderEgress();

		expect(validateConvexPaidProviderEgress(policy(), scan)).toEqual([]);
		expect(scan.files.length).toBeGreaterThan(100);
		expect(scan.findings).toEqual([]);
		expect(policy().approvedCapabilities).toEqual([]);
		expect(scan.executableTokens.has('convex/templates.ts:generateQueryEmbedding')).toBe(false);
		expect(scan.executableTokens.has('convex/templates.ts:GEMINI_API_KEY')).toBe(false);
		expect(scan.executableTokens.has('convex/templates.ts:backfillTagEmbeddings')).toBe(false);
		expect(scan.executableTokens.has('convex/intelligence.ts:ingest')).toBe(false);
		expect(
			scan.executableTokens.has('convex/crons.ts:tag-concept-embedding-backfill')
		).toBe(false);
	});

	it('finds nested SDKs, domains, and computed credential keys but ignores comments and tests', () => {
		const root = mkdtempSync(path.join(tmpdir(), 'convex-provider-egress-'));
		temporaryRoots.push(root);
		const convexDir = path.join(root, 'convex');
		mkdirSync(path.join(convexDir, 'nested'), { recursive: true });
		writeFileSync(
			path.join(convexDir, 'safe.ts'),
			'// https://api.openai.com OPENAI_API_KEY\nexport const safe = "local";\n'
		);
		writeFileSync(
			path.join(convexDir, 'nested', 'provider.ts'),
			[
				"import OpenAI from 'openai';",
				"export function hidden() { return process.env['ANTHROPIC_API_KEY']; }",
				"export const url = 'https://api.groq.com/openai/v1/chat/completions';",
				'void OpenAI;'
			].join('\n')
		);
		writeFileSync(
			path.join(convexDir, 'ignored.test.ts'),
			"export const ignored = 'https://api.anthropic.com';\n"
		);

		const scan = scanConvexPaidProviderEgress({ convexDir, repositoryRoot: root });
		expect(scan.files.map((file) => path.basename(file))).toEqual(['provider.ts', 'safe.ts']);
		expect(scan.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: 'provider-sdk', indicator: 'openai' }),
				expect.objectContaining({
					kind: 'provider-environment-key',
					indicator: 'ANTHROPIC_API_KEY'
				}),
				expect.objectContaining({ kind: 'provider-domain', indicator: 'api.groq.com' })
			])
		);
		expect(scan.findings).toHaveLength(3);
	});

	it('fails closed on an unapproved capability, stale approval, or resurrected tombstone', () => {
		const reviewed = policy();
		const actual = scanConvexPaidProviderEgress();
		const withUnapproved = {
			...actual,
			findings: [
				...actual.findings,
				{
					file: 'convex/nested/new-provider.ts',
					symbol: 'callProvider',
					kind: 'provider-domain',
					indicator: 'api.anthropic.com',
					line: 10
				}
			]
		};
		expect(validateConvexPaidProviderEgress(reviewed, withUnapproved)).toContain(
			'Unapproved Convex paid-provider egress: convex/nested/new-provider.ts:10 callProvider provider-domain api.anthropic.com.'
		);

		const stale = structuredClone(reviewed);
		stale.approvedCapabilities.push({
			file: 'convex/ghost.ts',
			symbol: 'ghost',
			kind: 'provider-sdk',
			indicator: 'openai',
			authority: 'This intentionally long test authority has no matching executable finding.'
		});
		expect(validateConvexPaidProviderEgress(stale, actual)).toContain(
			'Stale approved Convex paid-provider capability: convex/ghost.ts|ghost|provider-sdk|openai.'
		);
		expect(validateConvexPaidProviderEgress(stale, actual)).toContain(
			'Convex paid-provider egress approvals must remain empty.'
		);

		const resurrected = {
			...actual,
			executableTokens: new Set([
				...actual.executableTokens,
				'convex/intelligence.ts:ingest'
			])
		};
		expect(validateConvexPaidProviderEgress(reviewed, resurrected)).toContain(
			'Retired provider capability remains executable: convex/intelligence.ts:ingest.'
		);

		const missingGeminiTombstone = structuredClone(reviewed);
		missingGeminiTombstone.retiredCapabilities = missingGeminiTombstone.retiredCapabilities.filter(
			(capability: string) => capability !== 'convex/templates.ts:GEMINI_API_KEY'
		);
		expect(validateConvexPaidProviderEgress(missingGeminiTombstone, actual)).toContain(
			'Missing retired provider capability: convex/templates.ts:GEMINI_API_KEY.'
		);
	});
});
