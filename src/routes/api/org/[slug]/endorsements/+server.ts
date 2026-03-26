import { json, error } from '@sveltejs/kit';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/** Endorse a template on behalf of this org. Requires editor role. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { templateId } = body as { templateId?: string };

	if (!templateId) throw error(400, 'templateId is required');

	const result = await serverMutation(api.templates.endorse, {
		orgSlug: params.slug,
		templateId: templateId as any
	});
	return json({ id: result.id }, { status: 201 });
};

/** Remove an endorsement. Requires editor role. */
export const DELETE: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { templateId } = body as { templateId?: string };

	if (!templateId) throw error(400, 'templateId is required');

	await serverMutation(api.templates.removeEndorsement, {
		orgSlug: params.slug,
		templateId: templateId as any
	});
	return json({ ok: true });
};
