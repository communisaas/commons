import { json, error } from '@sveltejs/kit';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json();
	const { title, type, body: campaignBody, templateId, debateEnabled, debateThreshold } = body;

	if (!title || typeof title !== 'string' || !title.trim()) {
		throw error(400, 'Title is required');
	}

	if (!type || !['LETTER', 'EVENT', 'FORM'].includes(type)) {
		throw error(400, 'Invalid campaign type');
	}

	const campaignId = await serverMutation(api.campaigns.create, {
		slug: params.slug,
		title,
		type,
		body: campaignBody?.trim() || undefined,
		templateId: templateId || undefined,
		debateEnabled: Boolean(debateEnabled),
		debateThreshold: typeof debateThreshold === 'number' ? debateThreshold : 50
	});
	return json({ id: campaignId }, { status: 201 });
};
