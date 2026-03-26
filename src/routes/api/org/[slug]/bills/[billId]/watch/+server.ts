import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * POST /api/org/[slug]/bills/[billId]/watch — Watch a bill.
 * DELETE /api/org/[slug]/bills/[billId]/watch — Unwatch a bill.
 * PATCH /api/org/[slug]/bills/[billId]/watch — Update position on a watched bill.
 */

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.LEGISLATION) throw error(404, 'Legislation features not enabled');
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json().catch(() => ({}));

	const result = await serverMutation(api.legislation.watchBill, {
		slug: params.slug,
		billId: params.billId as any,
		reason: typeof body.reason === 'string' ? body.reason : 'manual',
		position: typeof body.position === 'string' && ['support', 'oppose'].includes(body.position)
			? body.position
			: undefined
	});
	return json(result, { status: 201 });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.LEGISLATION) throw error(404, 'Legislation features not enabled');
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const position = typeof body.position === 'string' && ['support', 'oppose', 'neutral'].includes(body.position)
		? (body.position === 'neutral' ? null : body.position)
		: undefined;

	if (position === undefined) {
		throw error(400, 'position must be "support", "oppose", or "neutral"');
	}

	const result = await serverMutation(api.legislation.updateBillWatch, {
		slug: params.slug,
		billId: params.billId as any,
		position: body.position
	});
	return json(result);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.LEGISLATION) throw error(404, 'Legislation features not enabled');
	if (!locals.user) throw error(401, 'Authentication required');

	const result = await serverMutation(api.legislation.unwatchBill, {
		slug: params.slug,
		billId: params.billId as any
	});
	return json(result);
};
