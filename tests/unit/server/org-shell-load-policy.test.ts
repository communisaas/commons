import { describe, expect, it } from 'vitest';
import { orgShellLoadPolicy } from '$lib/server/org-shell-load-policy';

const slug = 'people-power';

function policy(pathname: string, search = '') {
	return orgShellLoadPolicy(
		{
			pathname,
			searchParams: new URLSearchParams(search)
		},
		slug
	);
}

describe('orgShellLoadPolicy', () => {
	it.each([
		[`/org/${slug}`, 'operating'],
		[`/org/${slug}/studio`, 'operating'],
		[`/org/${slug}/supporters`, 'base'],
		[`/org/${slug}/representatives`, 'landscape'],
		[`/org/${slug}/results`, 'return']
	] as const)('hydrates exactly the %s canonical slice', (pathname, expected) => {
		const result = policy(pathname);
		expect(Object.values(result).filter(Boolean)).toHaveLength(1);
		expect(result[expected]).toBe(true);
	});

	it.each([
		`/org/${slug}/campaigns`,
		`/org/${slug}/campaigns/campaign-1`,
		`/org/${slug}/supporters/import`,
		`/org/${slug}/legislation`,
		`/org/${slug}/settings`
	])('does not hydrate a shell slice for deep route %s', (pathname) => {
		expect(policy(pathname)).toEqual({
			return: false,
			base: false,
			landscape: false,
			operating: false
		});
	});

	it.each([
		`/org/${slug}`,
		`/org/${slug}/supporters`,
		`/org/${slug}/representatives`,
		`/org/${slug}/results`
	])('lets the full-view route own its data at %s', (pathname) => {
		expect(policy(pathname, 'view=full')).toEqual({
			return: false,
			base: false,
			landscape: false,
			operating: false
		});
	});
});
