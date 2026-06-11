/**
 * Org-OS space-path routing contract.
 *
 * The layout suppresses a deep route's page when the pathname is a canonical
 * space path owned by a mounted OrgShell space. `?view=full` is the explicit
 * opt-out: it renders the full deep page (the supporter table, the
 * decision-maker directory) at the same path. The spaces' "open the deep
 * tool" links travel through `fullViewHref`, so these helpers must agree —
 * otherwise those links circle back to the page the operator is already on.
 */
import { describe, expect, it } from 'vitest';
import {
	fullViewHref,
	isSpacePath,
	rendersSpaceForUrl,
	spaceForPath
} from '$lib/components/org/os/orgOS.svelte';

const BASE = '/org/climate-action-now';

function urlFor(path: string): URL {
	return new URL(`https://commons.test${path}`);
}

describe('isSpacePath', () => {
	it('claims exactly the four canonical space paths', () => {
		expect(isSpacePath(`${BASE}`, BASE)).toBe(true);
		expect(isSpacePath(`${BASE}/studio`, BASE)).toBe(true);
		expect(isSpacePath(`${BASE}/supporters`, BASE)).toBe(true);
		expect(isSpacePath(`${BASE}/representatives`, BASE)).toBe(true);
	});

	it('leaves deep routes to their own pages', () => {
		expect(isSpacePath(`${BASE}/supporters/import`, BASE)).toBe(false);
		expect(isSpacePath(`${BASE}/representatives/dm123`, BASE)).toBe(false);
		expect(isSpacePath(`${BASE}/campaigns`, BASE)).toBe(false);
		expect(isSpacePath(`${BASE}/legislation`, BASE)).toBe(false);
		expect(isSpacePath(`${BASE}/settings`, BASE)).toBe(false);
	});
});

describe('rendersSpaceForUrl', () => {
	it('renders the mounted space on a plain canonical space path', () => {
		expect(rendersSpaceForUrl(urlFor(`${BASE}/supporters`), BASE)).toBe(true);
		expect(rendersSpaceForUrl(urlFor(`${BASE}/representatives`), BASE)).toBe(true);
		expect(rendersSpaceForUrl(urlFor(`${BASE}/studio`), BASE)).toBe(true);
		expect(rendersSpaceForUrl(urlFor(BASE), BASE)).toBe(true);
	});

	it('honors the ?view=full opt-out so the deep page renders at the same path', () => {
		expect(rendersSpaceForUrl(urlFor(`${BASE}/supporters?view=full`), BASE)).toBe(false);
		expect(rendersSpaceForUrl(urlFor(`${BASE}/representatives?view=full`), BASE)).toBe(false);
	});

	it('ignores unrelated query params', () => {
		expect(rendersSpaceForUrl(urlFor(`${BASE}/supporters?page=2`), BASE)).toBe(true);
		expect(rendersSpaceForUrl(urlFor(`${BASE}/supporters?view=summary`), BASE)).toBe(true);
	});

	it('never claims deep routes, with or without the param', () => {
		expect(rendersSpaceForUrl(urlFor(`${BASE}/supporters/import`), BASE)).toBe(false);
		expect(rendersSpaceForUrl(urlFor(`${BASE}/campaigns?view=full`), BASE)).toBe(false);
	});
});

describe('fullViewHref', () => {
	it('builds the param the layout check honors', () => {
		const href = fullViewHref(`${BASE}/supporters`);
		expect(href).toBe(`${BASE}/supporters?view=full`);
		expect(rendersSpaceForUrl(urlFor(href), BASE)).toBe(false);
	});

	it('leaves the space ownership of the plain path untouched', () => {
		// The opt-out changes which surface renders, not which space owns the
		// path — the OS still focuses People for /supporters?view=full.
		expect(spaceForPath(`${BASE}/supporters`, BASE)).toBe('base');
		expect(spaceForPath(`${BASE}/representatives`, BASE)).toBe('landscape');
	});
});
