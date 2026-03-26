import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

const IssueDomainSchema = z.object({
	label: z.string().trim().min(1, 'Label is required').max(100, 'Label must be 100 characters or fewer'),
	description: z.string().trim().max(500, 'Description must be 500 characters or fewer').optional().nullable(),
	weight: z.number().min(0.5).max(2.0).optional()
});

/** List all issue domains for this org. */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const result = await serverQuery(api.organizations.listIssueDomains, { slug: params.slug });
	return json(result);
};

/** Create a new issue domain. Requires editor role. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	let parsed: z.infer<typeof IssueDomainSchema>;
	try {
		const body = await request.json();
		parsed = IssueDomainSchema.parse(body);
	} catch (err) {
		if (err instanceof z.ZodError) {
			throw error(400, err.errors[0]?.message ?? 'Invalid input');
		}
		throw error(400, 'Invalid JSON body');
	}

	const { label, description, weight } = parsed;
	const parsedWeight = weight ?? 1.0;

	const result = await serverMutation(api.organizations.createIssueDomain, {
		slug: params.slug,
		label,
		description: description ?? undefined,
		weight: parsedWeight
	});
	return json(result, { status: 201 });
};

/** Update an issue domain. Requires editor role. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const PatchSchema = z.object({ id: z.string().min(1) }).merge(IssueDomainSchema.partial());

	let id: string;
	let fields: Partial<z.infer<typeof IssueDomainSchema>>;
	try {
		const body = await request.json();
		const parsed = PatchSchema.parse(body);
		id = parsed.id;
		const { id: _, ...rest } = parsed;
		fields = rest;
	} catch (err) {
		if (err instanceof z.ZodError) {
			throw error(400, err.errors[0]?.message ?? 'Invalid input');
		}
		throw error(400, 'Invalid JSON body');
	}

	const result = await serverMutation(api.organizations.updateIssueDomain, {
		slug: params.slug,
		domainId: id as any,
		label: fields.label,
		description: fields.description ?? undefined,
		weight: fields.weight
	});
	return json(result);
};

/** Delete an issue domain. Requires editor role. */
export const DELETE: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { id } = body as { id?: string };

	if (!id) throw error(400, 'id is required');

	await serverMutation(api.organizations.deleteIssueDomain, {
		slug: params.slug,
		domainId: id as any
	});
	return json({ ok: true });
};
