import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { FEATURES } from '$lib/config/features';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * POST /api/org/[slug]/bills/[billId]/watch — Watch a bill.
 * DELETE /api/org/[slug]/bills/[billId]/watch — Unwatch a bill.
 * PATCH /api/org/[slug]/bills/[billId]/watch — Update position on a watched bill.
 */

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json().catch(() => ({}));

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverMutation(api.legislation.watchBill, {
				slug: params.slug,
				billId: params.billId as any,
				reason: typeof body.reason === 'string' ? body.reason : 'manual',
				position: typeof body.position === 'string' && ['support', 'oppose'].includes(body.position)
					? body.position
					: undefined
			});
			return json(result, { status: 201 });
		} catch (err) {
			console.error('[BillWatch.POST] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const bill = await db.bill.findUnique({
		where: { id: params.billId },
		select: { id: true }
	});

	if (!bill) {
		throw error(404, 'Bill not found');
	}

	const reason = typeof body.reason === 'string' ? body.reason : 'manual';
	const position = typeof body.position === 'string' && ['support', 'oppose'].includes(body.position)
		? body.position
		: null;

	const watch = await db.orgBillWatch.upsert({
		where: {
			orgId_billId: {
				orgId: org.id,
				billId: params.billId
			}
		},
		create: {
			orgId: org.id,
			billId: params.billId,
			reason,
			position,
			addedBy: locals.user.id
		},
		update: {}
	});

	return json({
		id: watch.id,
		orgId: watch.orgId,
		billId: watch.billId,
		reason: watch.reason,
		position: watch.position,
		createdAt: watch.createdAt.toISOString()
	}, { status: 201 });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json();
	const position = typeof body.position === 'string' && ['support', 'oppose', 'neutral'].includes(body.position)
		? (body.position === 'neutral' ? null : body.position)
		: undefined;

	if (position === undefined) {
		throw error(400, 'position must be "support", "oppose", or "neutral"');
	}

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverMutation(api.legislation.updateBillWatch, {
				slug: params.slug,
				billId: params.billId as any,
				position: body.position
			});
			return json(result);
		} catch (err) {
			console.error('[BillWatch.PATCH] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const existing = await db.orgBillWatch.findUnique({
		where: {
			orgId_billId: {
				orgId: org.id,
				billId: params.billId
			}
		}
	});

	if (!existing) {
		throw error(404, 'Bill is not being watched');
	}

	const updated = await db.orgBillWatch.update({
		where: { id: existing.id },
		data: { position }
	});

	return json({
		id: updated.id,
		position: updated.position
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.LEGISLATION) {
		throw error(404, 'Legislation features not enabled');
	}

	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverMutation(api.legislation.unwatchBill, {
				slug: params.slug,
				billId: params.billId as any
			});
			return json(result);
		} catch (err) {
			console.error('[BillWatch.DELETE] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	await db.orgBillWatch.deleteMany({
		where: {
			orgId: org.id,
			billId: params.billId
		}
	});

	return json({ success: true });
};
