import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import {
	MAX_TEMPLATE_SLUG_CODE_POINTS,
	isCanonicalTemplateSlug
} from '$convex/lib/templateInputBudget';

const MAX_SLUG_LOOKUPS = 6;

/** Generate at most five bounded advisory alternatives; create remains the uniqueness authority. */
function generateSuggestions(baseSlug: string): string[] {
	const candidates = [
		`act-${baseSlug}`,
		`support-${baseSlug}`,
		`${baseSlug}-${new Date().getFullYear()}`
	];
	const words = baseSlug.split('-');
	if (words.length > 3) candidates.push(words.slice(0, 3).join('-'));
	if (words.length > 1) candidates.push(`${words.map((word) => word[0]).join('')}-template`);

	// Deterministic suffixes keep the batch bounded and make request behavior
	// testable; availability remains only a hint until the atomic create mutation.
	for (let suffix = 2; candidates.length < 8; suffix += 1) {
		candidates.push(`${baseSlug}-${suffix}`);
	}

	return [...new Set(candidates)].filter(isCanonicalTemplateSlug).slice(0, MAX_SLUG_LOOKUPS - 1);
}

export const GET: RequestHandler = async ({ url }) => {
	const slug = url.searchParams.get('slug') ?? '';
	if (!isCanonicalTemplateSlug(slug)) {
		return json(
			{
				success: false,
				error: `Slug must be lowercase letters, numbers, and hyphens (${MAX_TEMPLATE_SLUG_CODE_POINTS} characters max)`
			},
			{ status: 400, headers: { 'Cache-Control': 'no-store' } }
		);
	}

	const candidates = generateSuggestions(slug);
	const slugs = [slug, ...candidates];
	const exists = await serverQuery(api.templates.templateSlugsExist, {
		_secret: getInternalSecret(),
		slugs
	});
	if (!Array.isArray(exists) || exists.length !== slugs.length) {
		throw new Error('TEMPLATE_SLUG_EXISTENCE_CONTRACT_INVALID');
	}

	return json(
		{
			success: true,
			data: {
				available: exists[0] === false,
				suggestions: candidates.filter((_, index) => exists[index + 1] === false).slice(0, 3)
			}
		},
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};
