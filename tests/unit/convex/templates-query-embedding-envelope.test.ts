import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function searchActionSource(): string {
	const source = readFileSync('convex/templates.ts', 'utf8');
	const start = source.indexOf('export const search = action');
	expect(start).toBeGreaterThan(-1);
	const end = source.indexOf('\nexport const ', start + 1);
	return source.slice(start, end === -1 ? undefined : end);
}

describe('Convex template-search provider retirement', () => {
	it('is a secret-gated, bounded keyword-only action', () => {
		const action = searchActionSource();
		const secret = action.indexOf('requireInternalSecret(args._secret)');
		const readiness = action.indexOf('ctx.runQuery(publicDiscoverySearchReadinessRef');
		const burst = action.indexOf('ctx.runMutation(rateLimitCheckRef');
		const textSearch = action.indexOf('ctx.runQuery(textSearchRef');

		expect(secret).toBeGreaterThan(0);
		expect(readiness).toBeGreaterThan(secret);
		expect(burst).toBeGreaterThan(readiness);
		expect(textSearch).toBeGreaterThan(burst);
		expect(action).toContain('Math.min(Math.max(args.limit ?? 10, 1), 20)');
		expect(action).toContain("method: 'keyword' as const");
	});

	it('contains no provider, credential, fetch, or vector execution path', () => {
		const convex = readFileSync('convex/templates.ts', 'utf8');
		const action = searchActionSource();

		expect(convex).not.toContain('generateQueryEmbedding');
		expect(convex).not.toContain('GEMINI_API_KEY');
		expect(convex).not.toContain('generativelanguage.googleapis.com');
		expect(action).not.toContain('fetch(');
		expect(action).not.toContain('vectorSearch');
		expect(action).not.toContain('templates.search:semantic');
		expect(action).not.toContain("method: 'semantic'");
	});

	it('keeps the compact text-index query bounded', () => {
		const source = readFileSync('convex/templates.ts', 'utf8');
		const start = source.indexOf('export const textSearch = internalQuery');
		expect(start).toBeGreaterThan(-1);
		const end = source.indexOf('\nexport const ', start + 1);
		const query = source.slice(start, end === -1 ? undefined : end);

		expect(query).toContain(".query('publicTemplateDiscoverySources')");
		expect(query).toContain(".withSearchIndex('search_title'");
		expect(query).toContain('q.take(Math.min(args.limit + 20, 50))');
		expect(query).toContain('results.slice(0, args.limit)');
	});
});
