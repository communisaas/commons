import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

// F-R8-02: Zod schema replaces unsafe `body as { ... }` cast
const OrgUpdateSchema = z.object({
	description: z.string().max(1000).optional(),
	billing_email: z.string().email().optional(),
	encryptedBillingEmail: z.string().optional(),
	billingEmailHash: z.string().optional(),
	avatar: z.string().max(2048).optional()
});

/** Update organization details. Requires owner role. */
export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) throw error(401, 'Authentication required');

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

	if (Object.keys(data).length === 0 && !parsed.encryptedBillingEmail) {
		throw error(400, 'No fields to update');
	}

	// Client sends pre-encrypted billing email blob + org-scoped hash
	const encryptedBillingEmail = parsed.encryptedBillingEmail;
	const billingEmailHash = parsed.billingEmailHash;

	await serverMutation(api.organizations.update, {
		slug: params.slug,
		description: parsed.description,
		encryptedBillingEmail,
		billingEmailHash,
		avatar: parsed.avatar
	});
	return json({ ok: true });
};
