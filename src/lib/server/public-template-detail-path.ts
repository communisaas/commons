/**
 * Canonical public-template routes that can execute a Convex detail lookup or
 * an OG image render. Keep this grammar shared by the early request shield,
 * route loaders, cache keys, tests, and the Cloudflare WAF runbook.
 */

export const PUBLIC_TEMPLATE_SLUG_MAX_CHARS = 100;
export const PUBLIC_TEMPLATE_DETAIL_RATE_LIMIT = {
	pattern: 'public-template-detail:get',
	maxRequests: 6,
	windowMs: 10_000,
	keyStrategy: 'ip' as const,
	includeGet: true
};

const PUBLIC_TEMPLATE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type PublicTemplateCostRoute = 'detail' | 'modal' | 'og-image';

export type PublicTemplateCostPath = {
	kind: PublicTemplateCostRoute;
	slug: string;
	validSlug: boolean;
};

export function isValidPublicTemplateSlug(slug: unknown): slug is string {
	return (
		typeof slug === 'string' &&
		slug.length > 0 &&
		slug.length <= PUBLIC_TEMPLATE_SLUG_MAX_CHARS &&
		PUBLIC_TEMPLATE_SLUG.test(slug)
	);
}

/**
 * Match exact route shapes, including malformed single-segment slugs. That
 * lets the hook reject encoded, uppercase, oversized, or punctuation-bearing
 * variants before SvelteKit loaders, Convex, or Sharp can run. Unrelated
 * descendants such as `/s/:slug/debate/:id` are deliberately excluded.
 */
export function classifyPublicTemplateCostPath(pathname: string): PublicTemplateCostPath | null {
	const detail = /^\/s\/([^/]+)\/?$/.exec(pathname);
	if (detail) {
		return { kind: 'detail', slug: detail[1], validSlug: isValidPublicTemplateSlug(detail[1]) };
	}

	const ogImage = /^\/s\/([^/]+)\/og-image\/?$/.exec(pathname);
	if (ogImage) {
		return {
			kind: 'og-image',
			slug: ogImage[1],
			validSlug: isValidPublicTemplateSlug(ogImage[1])
		};
	}

	const modal = /^\/template-modal\/([^/]+)\/?$/.exec(pathname);
	if (modal) {
		return { kind: 'modal', slug: modal[1], validSlug: isValidPublicTemplateSlug(modal[1]) };
	}

	return null;
}
