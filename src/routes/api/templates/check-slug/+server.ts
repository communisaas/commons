import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

// Helper to generate creative variations
function generateSuggestions(baseSlug: string, title: string): string[] {
	const variations: string[] = [];

	// Action-oriented prefixes
	const actionPrefixes = ['act', 'support', 'defend', 'protect', 'save', 'help'];
	const randomPrefix = actionPrefixes[Math.floor(Math.random() * actionPrefixes.length)];
	variations.push(`${randomPrefix}-${baseSlug}`);

	// Year suffix
	const year = new Date().getFullYear();
	variations.push(`${baseSlug}-${year}`);

	// Shortened version if multi-word
	const words = baseSlug.split('-');
	if (words.length > 3) {
		variations.push(words.slice(0, 3).join('-'));
	}

	// Acronym version if multi-word
	if (words.length > 1) {
		const acronym = words.map((w) => w[0]).join('');
		variations.push(`${acronym}-template`);
	}

	// Add random suffix if we need more suggestions
	while (variations.length < 5) {
		const randomNum = Math.floor(Math.random() * 1000);
		variations.push(`${baseSlug}-${randomNum}`);
	}

	return variations.slice(0, 5);
}

// Check slug availability via Convex
async function getAvailableSuggestions(suggestions: string[]): Promise<string[]> {
	const available: string[] = [];

	for (const slug of suggestions) {
		const existing = await serverQuery(api.templates.getBySlug, { slug });
		if (!existing) {
			available.push(slug);
		}
		if (available.length >= 3) break;
	}

	return available;
}

export const GET: RequestHandler = async ({ url }) => {
	const slug = url.searchParams.get('slug');
	const title = url.searchParams.get('title') || '';

	if (!slug) {
		return json(
			{
				success: false,
				error: 'Slug parameter is required'
			},
			{ status: 400 }
		);
	}

	const template = await serverQuery(api.templates.getBySlug, { slug });
	const available = !template;
	let suggestions: string[] = [];
	if (!available) {
		const candidateSuggestions = generateSuggestions(slug, title);
		suggestions = await getAvailableSuggestions(candidateSuggestions);
	}
	return json({ success: true, data: { available, suggestions } });
};
