import { describe, it, expect } from 'vitest';

import {
	registrableDomain,
	sameInstitutionLinks,
	LINK_GRAPH_SCAN_LIMIT,
	LINK_GRAPH_RETAIN_LIMIT
} from '$lib/core/agents/link-graph';

describe('registrableDomain', () => {
	it('treats subdomains of one institution as the same registrable domain', () => {
		expect(registrableDomain('www.city.gov')).toBe(registrableDomain('clerk.city.gov'));
		expect(registrableDomain('mit.edu')).toBe(registrableDomain('web.mit.edu'));
		expect(registrableDomain('sfusd.k12.ca.us')).toBe(registrableDomain('www.sfusd.k12.ca.us'));
		expect(registrableDomain('dept.gov.uk')).toBe(registrableDomain('www.dept.gov.uk'));
	});

	it('keeps distinct institutions distinct under multi-label public suffixes', () => {
		// The case a naive last-two-labels rule gets wrong: both would fuse to `ca.us`.
		expect(registrableDomain('sfusd.k12.ca.us')).toBe('sfusd.k12.ca.us');
		expect(registrableDomain('lausd.k12.ca.us')).toBe('lausd.k12.ca.us');
		expect(registrableDomain('sfusd.k12.ca.us')).not.toBe(registrableDomain('lausd.k12.ca.us'));

		expect(registrableDomain('city.gov')).not.toBe(registrableDomain('notcity.gov'));
		expect(registrableDomain('a.gov.uk')).not.toBe(registrableDomain('b.gov.uk'));
		expect(registrableDomain('parliament.uk')).not.toBe(registrableDomain('gov.uk'));
	});

	it('returns null for bare public suffixes, single labels, IP literals, and empty input', () => {
		expect(registrableDomain('gov.uk')).toBeNull();
		expect(registrableDomain('localhost')).toBeNull();
		expect(registrableDomain('city.ca.us')).toBeNull();
		expect(registrableDomain('k12.ca.us')).toBeNull();
		expect(registrableDomain('co.us')).toBeNull();
		expect(registrableDomain('192.168.1.1')).toBeNull();
		expect(registrableDomain('[::1]')).toBeNull();
		expect(registrableDomain('')).toBeNull();
	});
});

describe('sameInstitutionLinks', () => {
	const page = 'https://city.gov/contact';

	it('returns undefined when the link payload is not an array', () => {
		expect(sameInstitutionLinks(page, undefined)).toBeUndefined();
		expect(sameInstitutionLinks(page, null)).toBeUndefined();
		expect(sameInstitutionLinks(page, 'https://city.gov/departments')).toBeUndefined();
		expect(sameInstitutionLinks(page, { href: 'https://city.gov/departments' })).toBeUndefined();
	});

	it('returns undefined when the page URL is not a usable external URL', () => {
		expect(sameInstitutionLinks('not a url', ['https://city.gov/a'])).toBeUndefined();
		expect(sameInstitutionLinks('mailto:mayor@city.gov', ['https://city.gov/a'])).toBeUndefined();
	});

	it('distinguishes "no link graph evaluated" (undefined) from "evaluated, zero survivors" ([])', () => {
		// No link graph could be evaluated — nothing was ever scanned.
		expect(sameInstitutionLinks(page, undefined)).toBeUndefined();

		// A link graph WAS carried and scanned; it just happened to be empty.
		expect(sameInstitutionLinks(page, [])).toEqual([]);
		expect(sameInstitutionLinks(page, [])).not.toBeUndefined();

		// A link graph WAS carried and scanned; every entry was filtered out.
		const noSurvivors = sameInstitutionLinks(page, [
			'https://vendor.example.com/tracking',
			'https://lausd.k12.ca.us/other-district',
			'mailto:mayor@city.gov'
		]);
		expect(noSurvivors).toEqual([]);
		expect(noSurvivors).not.toBeUndefined();
	});

	it('drops non-http(s) schemes and non-string entries', () => {
		const result = sameInstitutionLinks(page, [
			'mailto:mayor@city.gov',
			'tel:+15555550100',
			'javascript:alert(1)',
			42,
			null,
			{ href: 'https://city.gov/object' },
			'https://city.gov/departments'
		]);

		expect(result).toEqual(['https://city.gov/departments']);
	});

	it('drops links on other registrable domains', () => {
		const result = sameInstitutionLinks(page, [
			'https://vendor.example.com/tracking',
			'https://notcity.gov/impostor',
			'https://lausd.k12.ca.us/other-district',
			'https://clerk.city.gov/records'
		]);

		expect(result).toEqual(['https://clerk.city.gov/records']);
	});

	it('resolves relative hrefs against the page URL and keeps them', () => {
		const result = sameInstitutionLinks(page, ['/departments', 'staff', '../offices']);

		expect(result).toEqual([
			'https://city.gov/departments',
			'https://city.gov/staff',
			'https://city.gov/offices'
		]);
	});

	it('collapses duplicates case-insensitively and excludes the page itself', () => {
		const result = sameInstitutionLinks(page, [
			'https://city.gov/contact',
			'/contact',
			'https://city.gov/Departments',
			'https://city.gov/departments',
			'https://CITY.gov/departments'
		]);

		expect(result).toEqual(['https://city.gov/Departments']);
	});

	it('retains at most the first N same-domain links in document order', () => {
		const links = Array.from({ length: 200 }, (_, index) => `https://city.gov/page-${index}`);

		const result = sameInstitutionLinks(page, links);

		expect(result).toHaveLength(LINK_GRAPH_RETAIN_LIMIT);
		expect(result).toHaveLength(32);
		expect(result).toEqual(links.slice(0, LINK_GRAPH_RETAIN_LIMIT));
	});

	it('preserves document order rather than ranking links', () => {
		const result = sameInstitutionLinks(page, [
			'https://city.gov/zoning',
			'https://vendor.example.com/skip',
			'https://city.gov/about',
			'https://city.gov/contact-us'
		]);

		expect(result).toEqual([
			'https://city.gov/zoning',
			'https://city.gov/about',
			'https://city.gov/contact-us'
		]);
	});

	it('terminates on pathological link arrays and honors the scan cap', () => {
		const links = [
			...Array.from(
				{ length: LINK_GRAPH_SCAN_LIMIT },
				(_, index) => `https://vendor.example.com/ad-${index}`
			),
			...Array.from({ length: 5_000 - LINK_GRAPH_SCAN_LIMIT }, (_, index) => `/late-${index}`)
		];
		expect(links).toHaveLength(5_000);

		// Every same-domain link sits beyond the scan window, so nothing is retained.
		expect(sameInstitutionLinks(page, links)).toEqual([]);

		// Raising the scan cap reaches them, proving the cap (not the filter) excluded them.
		expect(sameInstitutionLinks(page, links, { scanLimit: 5_000, limit: 2 })).toEqual([
			'https://city.gov/late-0',
			'https://city.gov/late-1'
		]);
	});

	it('falls back to exact hostname identity when neither host has a registrable domain', () => {
		const result = sameInstitutionLinks('https://8.8.8.8/index', [
			'https://8.8.8.8/next',
			'https://8.8.4.4/other'
		]);

		expect(result).toEqual(['https://8.8.8.8/next']);
	});
});
