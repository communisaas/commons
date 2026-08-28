import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	MAX_TEMPLATE_SLUG_BYTES,
	MAX_TEMPLATE_SLUG_CODE_POINTS,
	TEMPLATE_SLUG_PATTERN,
	canonicalizeTemplateSlug,
	isCanonicalTemplateSlug
} from '../../../convex/lib/templateInputBudget';

const { mockServerQuery, mockGetInternalSecret, api } = vi.hoisted(() => ({
	mockServerQuery: vi.fn(),
	mockGetInternalSecret: vi.fn(() => 'template-slug-check-secret-32-bytes'),
	api: { templates: { templateSlugsExist: 'templates.templateSlugsExist' } }
}));

vi.mock('convex-sveltekit', () => ({ serverQuery: mockServerQuery }));
vi.mock('$lib/convex', () => ({ api }));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: mockGetInternalSecret
}));

import { GET } from '../../../src/routes/api/templates/check-slug/+server';

// Vitest runs from the repo root (vitest.config.ts lives there).
const REPO_ROOT = process.cwd();

/** input → the exact canonical slug every authoring surface must produce. */
const CORPUS: Array<[string, string]> = [
	// Underscores separate; they never survive.
	['Fix_The Parking Mess', 'fix-the-parking-mess'],
	// Author-typed hyphens beside spaces collapse to a single separator.
	['Fix - Parking Now', 'fix-parking-now'],
	// Non-ASCII separates, it never vanishes (U+2013 EN DASH).
	['Save–Our–Park', 'save-our-park'],
	// Edge non-ASCII trims cleanly (U+2014 EM DASH).
	['—Stop the Pipeline—', 'stop-the-pipeline'],
	// Intra-word punctuation SEPARATES rather than vanishing: an apostrophe
	// yields a hyphen ('don-t'), a deliberate divergence from the retired
	// generators that deleted it ('dont'). Ratified with the canonicalizer.
	["Don't Frack CA", 'don-t-frack-ca'],
	// Nothing usable returns '' — never a fabricated slug.
	['!!!???...', ''],
	['   ', ''],
	// A cut landing on a separator never leaves a trailing hyphen.
	['a'.repeat(99) + ' bcd', 'a'.repeat(99)],
	// No cap below MAX_TEMPLATE_SLUG_CODE_POINTS exists on any surface.
	['a'.repeat(71) + ' bcd', 'a'.repeat(71) + '-bcd']
];

describe('canonicalizeTemplateSlug', () => {
	it.each(CORPUS)('canonicalizes %j', (input, expected) => {
		expect(canonicalizeTemplateSlug(input)).toBe(expected);
	});

	it('never emits a trailing hyphen when the length cut lands on a separator', () => {
		const out = canonicalizeTemplateSlug('a'.repeat(99) + ' bcd');
		expect(out).toBe('a'.repeat(99));
		expect(out.endsWith('-')).toBe(false);
		expect(out.length).toBeLessThanOrEqual(MAX_TEMPLATE_SLUG_CODE_POINTS);
	});

	it('is idempotent on every corpus input', () => {
		for (const [input] of CORPUS) {
			const once = canonicalizeTemplateSlug(input);
			expect(canonicalizeTemplateSlug(once)).toBe(once);
		}
	});

	it('keeps every non-empty output inside the pattern, code-point, and byte bounds', () => {
		const encoder = new TextEncoder();
		for (const [input] of CORPUS) {
			const out = canonicalizeTemplateSlug(input);
			if (out === '') continue;
			expect(out).toMatch(TEMPLATE_SLUG_PATTERN);
			expect(out.length).toBeGreaterThanOrEqual(1);
			expect(out.length).toBeLessThanOrEqual(MAX_TEMPLATE_SLUG_CODE_POINTS);
			expect(encoder.encode(out).byteLength).toBeLessThanOrEqual(MAX_TEMPLATE_SLUG_BYTES);
			expect(isCanonicalTemplateSlug(out)).toBe(true);
		}
	});

	it('resolves titles sharing their first 100 slug characters to the same canonical slug', () => {
		expect(canonicalizeTemplateSlug('a'.repeat(120))).toBe(canonicalizeTemplateSlug('a'.repeat(150)));
	});
});

describe('isCanonicalTemplateSlug', () => {
	it('accepts only strings already in canonical form and inside every bound', () => {
		expect(isCanonicalTemplateSlug('fix-the-parking-mess')).toBe(true);
		expect(isCanonicalTemplateSlug('a')).toBe(true);
		expect(isCanonicalTemplateSlug('a'.repeat(MAX_TEMPLATE_SLUG_CODE_POINTS))).toBe(true);
		expect(isCanonicalTemplateSlug('')).toBe(false);
		expect(isCanonicalTemplateSlug('UPPER')).toBe(false);
		expect(isCanonicalTemplateSlug('two--hyphens')).toBe(false);
		expect(isCanonicalTemplateSlug('-edge')).toBe(false);
		expect(isCanonicalTemplateSlug('edge-')).toBe(false);
		expect(isCanonicalTemplateSlug('under_score')).toBe(false);
		expect(isCanonicalTemplateSlug('a'.repeat(MAX_TEMPLATE_SLUG_CODE_POINTS + 1))).toBe(false);
	});
});

describe('check-slug suggester', () => {
	beforeEach(() => {
		mockServerQuery.mockReset();
		mockGetInternalSecret.mockClear();
	});

	function event(search: string) {
		return { url: new URL(`https://commons.email/api/templates/check-slug${search}`) } as never;
	}

	it('is deterministic, deduped, bounded, and every candidate is canonical', async () => {
		mockServerQuery.mockImplementation(async (_reference, args: { slugs: string[] }) =>
			args.slugs.map(() => false)
		);

		const first = await GET(event('?slug=protect-clean-water'));
		const second = await GET(event('?slug=protect-clean-water'));
		const firstBody = await first.json();
		const secondBody = await second.json();
		const firstBatch = (mockServerQuery.mock.calls[0]?.[1] as { slugs: string[] }).slugs;
		const secondBatch = (mockServerQuery.mock.calls[1]?.[1] as { slugs: string[] }).slugs;

		expect(secondBatch).toEqual(firstBatch);
		expect(secondBody).toEqual(firstBody);
		expect(firstBatch.length).toBeLessThanOrEqual(6);
		expect(new Set(firstBatch).size).toBe(firstBatch.length);
		for (const candidate of firstBatch) {
			expect(isCanonicalTemplateSlug(candidate)).toBe(true);
		}
		expect(firstBody.data.suggestions.length).toBeLessThanOrEqual(3);
	});
});

describe('single-normalizer source guard', () => {
	const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8');

	const CONSUMERS = [
		'src/lib/components/template/creator/SlugCustomizer.svelte',
		'src/lib/components/template/creator/UnifiedObjectiveEntry.svelte',
		'src/lib/components/org/studio/studio-draft-bridge.ts',
		'src/routes/api/templates/+server.ts',
		'src/routes/api/templates/check-slug/+server.ts',
		'convex/templates.ts',
		'scripts/lib/seed-pipeline.ts'
	];

	const PRIVATE_NORMALIZER_MARKERS = [
		'function slugify',
		'function sanitizeSlug',
		'function slugFromTitle',
		// Any local copy of the strict pattern or of a loose mapping class is a
		// reintroduced private normalizer.
		'(?:-[a-z0-9]+)*',
		'/^[a-z0-9-]+$/',
		'[^a-z0-9-]',
		'[^\\w-]+',
		'[^a-z0-9\\s-]',
		'Math.random'
	];

	it.each(CONSUMERS)('%s holds no private slug normalizer', (path) => {
		const source = read(path);
		for (const marker of PRIVATE_NORMALIZER_MARKERS) {
			expect(source.includes(marker), `${path} must not contain ${JSON.stringify(marker)}`).toBe(
				false
			);
		}
	});

	it('every consumer derives its slug from the shared module', () => {
		for (const path of CONSUMERS.filter((entry) => entry.startsWith('src/'))) {
			expect(read(path)).toContain('$convex/lib/templateInputBudget');
		}
		const convexTemplates = read('convex/templates.ts');
		expect(convexTemplates).toContain("from './lib/templateInputBudget'");
		expect(convexTemplates).toContain('isCanonicalTemplateSlug(slug)');
	});

	it('the seed pipeline defines no private slug generator and mints through the shared module', () => {
		const seedPipeline = read('scripts/lib/seed-pipeline.ts');
		// The seventh producer: a strip-then-hyphenate generator with its own cap.
		expect(seedPipeline).not.toContain('function generateSlug');
		// A second cap is a second normalizer; MAX_TEMPLATE_SLUG_CODE_POINTS is the only bound.
		expect(seedPipeline).not.toContain('maxLen');
		expect(seedPipeline).toContain("from '../../convex/lib/templateInputBudget'");
		expect(seedPipeline).toContain('canonicalizeTemplateSlug(');
	});

	it('deleted locals and fabricated fallbacks stay deleted', () => {
		const checkSlugRoute = read('src/routes/api/templates/check-slug/+server.ts');
		expect(checkSlugRoute).not.toContain('const MAX_TEMPLATE_SLUG_BYTES');
		expect(checkSlugRoute).not.toContain('const SLUG_PATTERN');
		expect(checkSlugRoute).not.toContain('function validSlug');
		expect(read('src/lib/components/org/studio/studio-draft-bridge.ts')).not.toContain(
			'studio-action-'
		);
	});
});
