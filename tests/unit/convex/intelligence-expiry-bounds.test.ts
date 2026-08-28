import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const intelligence = readFileSync('convex/intelligence.ts', 'utf8');

describe('intelligence expiry bounds', () => {
	it('clamps authenticated browse pages before reading embedding-bearing rows', () => {
		expect(intelligence).toContain('Math.min(Math.max(requestedLimit, 1), 50)');
		expect(intelligence).toContain("throw new Error('INTELLIGENCE_CURSOR_TOO_LARGE')");
	});

	it('excludes unset expiries and drains every bounded due page', () => {
		const cleanup = intelligence.slice(
			intelligence.indexOf('const INTELLIGENCE_EXPIRY_PAGE_SIZE'),
			intelligence.length
		);
		expect(cleanup).toContain('INTELLIGENCE_EXPIRY_PAGE_SIZE = 100');
		expect(cleanup).toContain("q.gte('expiresAt', 0).lt('expiresAt', now)");
		expect(cleanup).toContain('.take(INTELLIGENCE_EXPIRY_PAGE_SIZE + 1)');
		expect(cleanup).toContain('internal.intelligence.markExpired');
		expect(cleanup).not.toContain('.take(200)');
	});

	it('retires provider-native ingestion and bounds prepared vector storage', () => {
		expect(intelligence).not.toContain('export const ingest');
		expect(intelligence).not.toContain('GEMINI_API_KEY');
		expect(intelligence).not.toContain('generativelanguage.googleapis.com');
		expect(intelligence).toContain('INTELLIGENCE_EMBEDDING_DIMENSIONS = 768');
		expect(intelligence).toContain("throw new Error('INTELLIGENCE_EMBEDDING_INVALID')");
	});
});
