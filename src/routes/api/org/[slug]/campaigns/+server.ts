import { json, error } from '@sveltejs/kit';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json();
	const { title, type, body: campaignBody, templateId, debateEnabled, debateThreshold } = body;

	if (!title || typeof title !== 'string' || !title.trim() || title.length > 200) {
		throw error(400, 'Title is required (≤200 characters)');
	}

	if (!type || !['LETTER', 'EVENT', 'FORM'].includes(type)) {
		throw error(400, 'Invalid campaign type');
	}

	// bound caller-supplied strings + numeric ranges.
	if (campaignBody !== undefined && campaignBody !== null && (typeof campaignBody !== 'string' || campaignBody.length > 10_000)) {
		throw error(400, 'body must be ≤10,000 characters');
	}
	if (templateId !== undefined && templateId !== null && (typeof templateId !== 'string' || templateId.length > 64)) {
		throw error(400, 'templateId must be a Convex doc id (≤64 chars)');
	}
	if (
		debateThreshold !== undefined &&
		debateThreshold !== null &&
		(typeof debateThreshold !== 'number' ||
			!Number.isFinite(debateThreshold) ||
			debateThreshold < 0 ||
			debateThreshold > 100_000)
	) {
		throw error(400, 'debateThreshold must be a number 0-100,000');
	}

	const campaignId = await serverMutation(api.campaigns.create, {
		slug: params.slug,
		title,
		type,
		body: campaignBody?.trim() || undefined,
		// Caller-supplied string validated above (≤64 chars); cast to
		// Id<'templates'> at the API boundary so the Convex args
		// validator (now v.id('templates')) can reject malformed Ids
		// before the write hits the schema validator. Without this cast
		// the JSON-body `any` types let TS through, but the runtime
		// validator throws and turns a recoverable 400 into a 500.
		templateId: templateId ? (templateId as Id<'templates'>) : undefined,
		debateEnabled: Boolean(debateEnabled),
		debateThreshold: typeof debateThreshold === 'number' ? debateThreshold : 50
	});
	return json({ id: campaignId }, { status: 201 });
};
