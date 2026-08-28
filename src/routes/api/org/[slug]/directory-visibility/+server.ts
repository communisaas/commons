import { error, json } from '@sveltejs/kit';
import { serverMutation } from '$lib/server/convex-work-budget';

import { api } from '$lib/convex';
import { readBoundedJson } from '$lib/server/bounded-json';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');
	const parsed = await readBoundedJson(request, 1_024);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw error(400, 'Invalid visibility request');
	}
	const isPublic = (parsed as { isPublic?: unknown }).isPublic;
	if (typeof isPublic !== 'boolean') throw error(400, 'isPublic must be boolean');

	try {
		const result = await serverMutation(api.organizations.setPublicDirectoryVisibility, {
			slug: params.slug,
			isPublic
		});
		return json(result);
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		if (message.includes('role') || message.includes('member')) {
			throw error(403, 'Editor or owner role required');
		}
		throw cause;
	}
};
