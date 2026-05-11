import { json, error } from '@sveltejs/kit';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

/** Endorse a template on behalf of this org. Requires editor role. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { templateId } = body as { templateId?: string };

	// Convex doc ids are typically 32 chars; cap at 64.
	if (!templateId || typeof templateId !== 'string' || templateId.length > 64) {
		throw error(400, 'templateId is required (≤64 characters)');
	}

	const result = await serverMutation(api.templates.endorse, {
		orgSlug: params.slug,
		templateId: templateId as Id<'templates'>
	});
	return json({ id: result.id }, { status: 201 });
};

/** Remove an endorsement. Requires editor role. */
export const DELETE: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { templateId } = body as { templateId?: string };

	// Convex doc ids are typically 32 chars; cap at 64.
	if (!templateId || typeof templateId !== 'string' || templateId.length > 64) {
		throw error(400, 'templateId is required (≤64 characters)');
	}

	await serverMutation(api.templates.removeEndorsement, {
		orgSlug: params.slug,
		templateId: templateId as Id<'templates'>
	});
	return json({ ok: true });
};
