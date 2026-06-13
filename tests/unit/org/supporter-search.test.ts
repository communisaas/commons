/**
 * Free-text People search — pure matching over client-decrypted rows.
 *
 * Contract under test: the matcher works entirely in memory on decrypted
 * fields, complete email addresses classify into the exact server-hash path,
 * structural filters compose with the text query, and the coverage helper
 * states honestly how much of the list a search has reached.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
	SUPPORTER_SEARCH_SCAN_CAP,
	isFullEmail,
	normalizeSearchText,
	parseSearchQuery,
	matchesSupporterQuery,
	filterSupporters,
	passesStructuralFilters,
	searchCoverage,
	type SupporterSearchFields
} from '$lib/core/org/supporter-search';

const maria: SupporterSearchFields = {
	name: 'María Hernández',
	email: 'maria.h@example.org',
	postalCode: '94110',
	phone: '+1 (555) 123-4567'
};

const ada: SupporterSearchFields = {
	name: 'Ada Lovelace',
	email: 'ada@example.org',
	postalCode: 'SW1A 1AA',
	phone: '+442079460000'
};

describe('parseSearchQuery', () => {
	it('treats blank and too-short input as no query', () => {
		expect(parseSearchQuery('').kind).toBe('empty');
		expect(parseSearchQuery('   ').kind).toBe('empty');
		expect(parseSearchQuery('m').kind).toBe('empty');
	});

	it('classifies a complete email address into the exact-lookup path', () => {
		expect(parseSearchQuery('Maria.H@Example.ORG')).toEqual({
			kind: 'email',
			email: 'maria.h@example.org'
		});
		expect(parseSearchQuery('  ada@example.org  ').kind).toBe('email');
	});

	it('keeps partial or malformed emails on the text path', () => {
		expect(parseSearchQuery('maria@').kind).toBe('text');
		expect(parseSearchQuery('a@b').kind).toBe('text');
		expect(parseSearchQuery('maria @ example.org').kind).toBe('text');
	});

	it('normalizes text queries and extracts digits for phone matching', () => {
		expect(parseSearchQuery('  María   Hernández ')).toEqual({
			kind: 'text',
			text: 'maria hernandez',
			digits: ''
		});
		expect(parseSearchQuery('(555) 123-4567')).toMatchObject({
			kind: 'text',
			digits: '5551234567'
		});
	});
});

describe('normalizeSearchText', () => {
	it('folds case, diacritics, and runs of whitespace', () => {
		expect(normalizeSearchText('  María\t Hernández ')).toBe('maria hernandez');
		expect(normalizeSearchText('ADA')).toBe('ada');
	});
});

describe('isFullEmail', () => {
	it('accepts complete addresses and rejects fragments', () => {
		expect(isFullEmail('ada@example.org')).toBe(true);
		expect(isFullEmail('ada@')).toBe(false);
		expect(isFullEmail('@example.org')).toBe(false);
		expect(isFullEmail('ada example.org')).toBe(false);
	});
});

describe('matchesSupporterQuery', () => {
	it('matches partial names with diacritics folded both ways', () => {
		expect(matchesSupporterQuery(maria, parseSearchQuery('maria'))).toBe(true);
		expect(matchesSupporterQuery(maria, parseSearchQuery('hernandez'))).toBe(true);
		expect(matchesSupporterQuery(maria, parseSearchQuery('Hernández'))).toBe(true);
		expect(matchesSupporterQuery(ada, parseSearchQuery('maria'))).toBe(false);
	});

	it('matches partial emails as substrings', () => {
		expect(matchesSupporterQuery(maria, parseSearchQuery('maria.h@'))).toBe(true);
		expect(matchesSupporterQuery(maria, parseSearchQuery('@example'))).toBe(true);
		expect(matchesSupporterQuery(maria, parseSearchQuery('nobody@'))).toBe(false);
	});

	it('matches postal codes by prefix, ignoring spaces and case', () => {
		expect(matchesSupporterQuery(maria, parseSearchQuery('9411'))).toBe(true);
		expect(matchesSupporterQuery(maria, parseSearchQuery('4110'))).toBe(false);
		expect(matchesSupporterQuery(ada, parseSearchQuery('sw1a 1'))).toBe(true);
		expect(matchesSupporterQuery(ada, parseSearchQuery('sw1a1aa'))).toBe(true);
	});

	it('matches phone suffixes of four or more digits, however the row formats them', () => {
		expect(matchesSupporterQuery(maria, parseSearchQuery('4567'))).toBe(true);
		expect(matchesSupporterQuery(maria, parseSearchQuery('123-4567'))).toBe(true);
		expect(matchesSupporterQuery(maria, parseSearchQuery('567'))).toBe(false);
		expect(matchesSupporterQuery(ada, parseSearchQuery('4567'))).toBe(false);
	});

	it('requires exact normalized equality for the email-kind query', () => {
		const exact = parseSearchQuery('MARIA.H@EXAMPLE.ORG');
		expect(exact.kind).toBe('email');
		expect(matchesSupporterQuery(maria, exact)).toBe(true);
		expect(matchesSupporterQuery(ada, exact)).toBe(false);
	});

	it('matches nothing for empty queries and rows with missing fields', () => {
		expect(matchesSupporterQuery(maria, parseSearchQuery(''))).toBe(false);
		expect(matchesSupporterQuery({}, parseSearchQuery('maria'))).toBe(false);
	});
});

describe('filterSupporters', () => {
	it('narrows to matching rows, preserving order', () => {
		const rows = [ada, maria];
		expect(filterSupporters(rows, parseSearchQuery('example.org'))).toEqual([ada, maria]);
		expect(filterSupporters(rows, parseSearchQuery('lovelace'))).toEqual([ada]);
		expect(filterSupporters(rows, parseSearchQuery('zzz'))).toEqual([]);
		expect(filterSupporters(rows, parseSearchQuery(''))).toEqual([]);
	});
});

describe('passesStructuralFilters', () => {
	const row = {
		emailStatus: 'subscribed',
		verified: true,
		source: 'csv',
		tags: ['volunteer', 'donor']
	};

	it('passes everything when no filters are active', () => {
		expect(passesStructuralFilters(row, {})).toBe(true);
	});

	it('applies email status, verification, source, and tag the way the table filters do', () => {
		expect(passesStructuralFilters(row, { emailStatus: 'subscribed' })).toBe(true);
		expect(passesStructuralFilters(row, { emailStatus: 'bounced' })).toBe(false);
		expect(passesStructuralFilters(row, { verified: true })).toBe(true);
		expect(passesStructuralFilters(row, { verified: false })).toBe(false);
		expect(passesStructuralFilters(row, { source: 'csv' })).toBe(true);
		expect(passesStructuralFilters(row, { source: 'actionnetwork' })).toBe(false);
		expect(passesStructuralFilters(row, { tagName: 'donor' })).toBe(true);
		expect(passesStructuralFilters(row, { tagName: 'press' })).toBe(false);
	});

	it('treats blank sources as unknown, matching the server-side filter', () => {
		expect(passesStructuralFilters({ source: '  ' }, { source: 'unknown' })).toBe(true);
		expect(passesStructuralFilters({ source: null }, { source: 'unknown' })).toBe(true);
	});

	it('composes with the text matcher', () => {
		const rows = [
			{ ...maria, emailStatus: 'subscribed', verified: true, source: 'csv', tags: ['volunteer'] },
			{ ...ada, emailStatus: 'bounced', verified: false, source: 'csv', tags: [] }
		];
		const matched = filterSupporters(rows, parseSearchQuery('example.org')).filter((r) =>
			passesStructuralFilters(r, { emailStatus: 'subscribed' })
		);
		expect(matched).toHaveLength(1);
		expect(matched[0]?.email).toBe('maria.h@example.org');
	});
});

describe('searchCoverage', () => {
	it('reports progress while rows are still decrypting', () => {
		const during = searchCoverage({ scannedCount: 250, totalCount: 1024, scanning: true });
		expect(during.complete).toBe(false);
		expect(during.message).toContain('250');
		expect(during.message).toContain('1,024');
	});

	it('has a plain starting state before any rows arrive', () => {
		const starting = searchCoverage({ scannedCount: 0, totalCount: 500, scanning: true });
		expect(starting.complete).toBe(false);
		expect(starting.message.length).toBeGreaterThan(0);
	});

	it('states the scan cap honestly when rows are beyond reach', () => {
		const capped = searchCoverage({
			scannedCount: SUPPORTER_SEARCH_SCAN_CAP,
			totalCount: 12400,
			scanning: false
		});
		expect(capped.complete).toBe(false);
		expect(capped.message).toContain('first 10,000 of 12,400');
	});

	it('reports partial coverage below the cap without claiming completeness', () => {
		const partial = searchCoverage({ scannedCount: 900, totalCount: 1000, scanning: false });
		expect(partial.complete).toBe(false);
		expect(partial.message).toContain('900 of 1,000');
	});

	it('goes quiet once every row is searched', () => {
		expect(searchCoverage({ scannedCount: 1000, totalCount: 1000, scanning: false })).toEqual({
			complete: true,
			message: ''
		});
	});

	it('mirrors the server-side per-query scan bound', () => {
		const convexSource = readFileSync(
			path.resolve(process.cwd(), 'convex/supporters.ts'),
			'utf8'
		);
		expect(SUPPORTER_SEARCH_SCAN_CAP).toBe(10_000);
		expect(convexSource).toContain('MAX_SCAN = 10_000');
		expect(convexSource).toContain('.take(MAX_SCAN)');
	});
});

describe('search surface wiring', () => {
	const moduleSource = readFileSync(
		path.resolve(process.cwd(), 'src/lib/core/org/supporter-search.ts'),
		'utf8'
	);
	const pageSource = readFileSync(
		path.resolve(process.cwd(), 'src/routes/org/[slug]/supporters/+page.svelte'),
		'utf8'
	);

	it('keeps the matcher pure — no network, no server imports', () => {
		expect(moduleSource).not.toMatch(/fetch\(/);
		expect(moduleSource).not.toMatch(/from '(convex|\$lib\/server|\$lib\/convex)/);
		expect(moduleSource).not.toMatch(/import\(/);
	});

	it('routes complete emails through the org-scoped hash lookup on the page', () => {
		expect(pageSource).toContain('computeOrgScopedEmailHash');
		expect(pageSource).toContain('supporters.searchByEmail');
	});

	it('imports no capability machinery', () => {
		for (const source of [moduleSource, pageSource]) {
			expect(source).not.toMatch(/capability-hypergraph|capability-state-labels/);
		}
	});

	it('documents the blind-index upgrade path instead of building it early', () => {
		expect(moduleSource).toContain('blind-index');
	});
});
