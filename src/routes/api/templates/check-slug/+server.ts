import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/core/db';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
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

// Validate available slugs from suggestions
async function getAvailableSuggestions(suggestions: string[]): Promise<string[]> {
	const available: string[] = [];

	for (const slug of suggestions) {
		const existing = await db.template.findUnique({
			where: { slug },
			select: { id: true }
		});

		if (!existing) {
			available.push(slug);
		}

		// Stop once we have 3 available suggestions
		if (available.length >= 3) {
			break;
		}
	}

	return available;
}

export const GET: RequestHandler = async ({ url }) => {
	try {
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

		// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
		if (PUBLIC_CONVEX_URL) {
			try {
				const template = await serverQuery(api.templates.getBySlug, { slug });
				const available = !template;
				let suggestions: string[] = [];
				if (!available) {
					const candidateSuggestions = generateSuggestions(slug, title);
					// For Convex path, still check suggestions against Prisma (Convex has no slug-uniqueness check batch query)
					suggestions = await getAvailableSuggestions(candidateSuggestions);
				}
				return json({ success: true, data: { available, suggestions } });
			} catch (err) {
				console.error('[CheckSlug.GET] Convex failed, falling back to Prisma:', err);
			}
		}

		// ─── PRISMA FALLBACK ───
		// Check if slug exists in database
		const existingTemplate = await db.template.findUnique({
			where: { slug },
			select: { id: true }
		});

		const available = !existingTemplate;

		// If slug is taken, generate available suggestions
		let suggestions: string[] = [];
		if (!available) {
			const candidateSuggestions = generateSuggestions(slug, title);
			suggestions = await getAvailableSuggestions(candidateSuggestions);
		}

		return json({
			success: true,
			data: {
				available,
				suggestions
			}
		});
	} catch (error) {
		console.error('Error checking slug availability:', error);
		return json(
			{
				success: false,
				error: 'Failed to check slug availability'
			},
			{ status: 500 }
		);
	}
};
