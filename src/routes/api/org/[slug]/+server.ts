import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import type { RequestHandler } from './$types';

// F-R8-02: Zod schema replaces unsafe `body as { ... }` cast
const OrgUpdateSchema = z.object({
	description: z.string().max(1000).optional(),
	billing_email: z.string().email().optional(),
	avatar: z.string().max(2048).optional()
});

/** Update organization details. Requires owner role. */
export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) throw error(401, 'Authentication required');
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'owner');

	let parsed: z.infer<typeof OrgUpdateSchema>;
	try {
		const body = await request.json();
		parsed = OrgUpdateSchema.parse(body);
	} catch (e) {
		if (e instanceof z.ZodError) {
			throw error(400, e.errors.map((err) => err.message).join(', '));
		}
		throw error(400, 'Invalid request body');
	}

	const data: Record<string, string> = {};
	if (typeof parsed.description === 'string') data.description = parsed.description;
	if (typeof parsed.billing_email === 'string') data.billing_email = parsed.billing_email;
	if (typeof parsed.avatar === 'string') data.avatar = parsed.avatar;

	if (Object.keys(data).length === 0) {
		throw error(400, 'No fields to update');
	}

	await db.organization.update({ where: { id: org.id }, data });
	return json({ ok: true });
};
