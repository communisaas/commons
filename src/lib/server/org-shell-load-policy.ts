import { rendersSpaceForUrl, spaceForPath } from '$lib/components/org/os/orgOS.svelte';

export type OrgShellLoadPolicy = {
	return: boolean;
	base: boolean;
	landscape: boolean;
	operating: boolean;
};

/**
 * Exactly one expensive workspace slice may load on a canonical shell URL.
 * Deep tools and `?view=full` own their data and therefore load none.
 */
export function orgShellLoadPolicy(
	url: { pathname: string; searchParams: URLSearchParams },
	slug: string
): OrgShellLoadPolicy {
	const base = `/org/${slug}`;
	if (!rendersSpaceForUrl(url, base)) {
		return { return: false, base: false, landscape: false, operating: false };
	}
	const active = spaceForPath(url.pathname, base);
	return {
		return: active === 'return',
		base: active === 'base',
		landscape: active === 'landscape',
		operating: active === 'studio'
	};
}
