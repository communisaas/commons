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
	pathForSpace,
	rendersSpaceForUrl,
	spaceForPath
} from '$lib/components/org/os/orgOS.svelte';

const BASE = '/org/climate-action-now';

function urlFor(path: string): URL {
	return new URL(`https://commons.test${path}`);
}

describe('isSpacePath', () => {
	it('claims exactly the canonical space paths', () => {
		expect(isSpacePath(`${BASE}`, BASE)).toBe(true);
		expect(isSpacePath(`${BASE}/studio`, BASE)).toBe(true);
		expect(isSpacePath(`${BASE}/supporters`, BASE)).toBe(true);
		expect(isSpacePath(`${BASE}/representatives`, BASE)).toBe(true);
		expect(isSpacePath(`${BASE}/results`, BASE)).toBe(true);
	});

	it('leaves deep routes to their own pages', () => {
		expect(isSpacePath(`${BASE}/supporters/import`, BASE)).toBe(false);
		expect(isSpacePath(`${BASE}/representatives/dm123`, BASE)).toBe(false);
		expect(isSpacePath(`${BASE}/campaigns`, BASE)).toBe(false);
		expect(isSpacePath(`${BASE}/legislation`, BASE)).toBe(false);
		expect(isSpacePath(`${BASE}/settings`, BASE)).toBe(false);
	});
});

describe('spaceForPath — the authoring front door', () => {
	it('lands the bare org URL on Studio, not the proof packet', () => {
		expect(spaceForPath(BASE, BASE)).toBe('studio');
		expect(spaceForPath(`${BASE}/`, BASE)).toBe('studio');
	});

	it('keeps /studio resolving to Studio', () => {
		expect(spaceForPath(`${BASE}/studio`, BASE)).toBe('studio');
	});

	it('routes /results to the Results (return) space', () => {
		expect(spaceForPath(`${BASE}/results`, BASE)).toBe('return');
		expect(spaceForPath(`${BASE}/results#results-packet`, BASE)).toBe('return');
	});

	it('keeps People and Power on their own paths', () => {
		expect(spaceForPath(`${BASE}/supporters`, BASE)).toBe('base');
		expect(spaceForPath(`${BASE}/representatives`, BASE)).toBe('landscape');
		expect(spaceForPath(`${BASE}/legislation`, BASE)).toBe('landscape');
	});

	it('falls authoring deep routes through to Studio', () => {
		expect(spaceForPath(`${BASE}/campaigns`, BASE)).toBe('studio');
		expect(spaceForPath(`${BASE}/emails`, BASE)).toBe('studio');
		expect(spaceForPath(`${BASE}/settings`, BASE)).toBe('studio');
	});
});

describe('pathForSpace — Studio owns the bare URL, Results lives at /results', () => {
	it('maps Studio to the bare base (the front door)', () => {
		expect(pathForSpace('studio', BASE)).toBe(BASE);
	});

	it('maps Results to /results', () => {
		expect(pathForSpace('return', BASE)).toBe(`${BASE}/results`);
	});

	it('keeps People and Power on their canonical paths', () => {
		expect(pathForSpace('base', BASE)).toBe(`${BASE}/supporters`);
		expect(pathForSpace('landscape', BASE)).toBe(`${BASE}/representatives`);
	});

	it('round-trips every space through spaceForPath', () => {
		for (const space of ['studio', 'base', 'landscape', 'return'] as const) {
			expect(spaceForPath(pathForSpace(space, BASE), BASE)).toBe(space);
		}
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
