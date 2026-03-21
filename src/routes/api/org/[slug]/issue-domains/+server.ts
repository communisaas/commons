import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { db, getRequestClient } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { generateEmbedding } from '$lib/core/search/gemini-embeddings';
import type { RequestHandler } from './$types';

const MAX_DOMAINS_PER_ORG = 20;
const RESERVED_LABELS = ['__alert_preferences__'];

const IssueDomainSchema = z.object({
	label: z.string().trim().min(1, 'Label is required').max(100, 'Label must be 100 characters or fewer'),
	description: z.string().trim().max(500, 'Description must be 500 characters or fewer').optional().nullable(),
	weight: z.number().min(0.5).max(2.0).optional()
});

/** List all issue domains for this org. */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Authentication required');
	const { org } = await loadOrgContext(params.slug, locals.user.id);

	const domains = await db.orgIssueDomain.findMany({
		where: { orgId: org.id },
		select: { id: true, label: true, description: true, weight: true, createdAt: true, updatedAt: true },
		orderBy: { createdAt: 'asc' }
	});

	return json({
		domains: domains.map((d) => ({
			...d,
			createdAt: d.createdAt.toISOString(),
			updatedAt: d.updatedAt.toISOString()
		}))
	});
};

/** Create a new issue domain. Requires editor role. */
export const POST: RequestHandler = async ({ locals, params, request, platform }) => {
	if (!locals.user) throw error(401, 'Authentication required');
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

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

	if (RESERVED_LABELS.some(r => label.startsWith(r))) {
		throw error(400, 'This label is reserved');
	}

	// Check domain count limit
	const count = await db.orgIssueDomain.count({ where: { orgId: org.id } });
	if (count >= MAX_DOMAINS_PER_ORG) {
		throw error(400, `Maximum of ${MAX_DOMAINS_PER_ORG} issue domains per organization`);
	}

	// Check for duplicate label
	const existing = await db.orgIssueDomain.findUnique({
		where: { orgId_label: { orgId: org.id, label } }
	});
	if (existing) {
		throw error(409, 'An issue domain with this label already exists');
	}

	const domain = await db.orgIssueDomain.create({
		data: {
			orgId: org.id,
			label,
			description: description || null,
			weight: parsedWeight
		}
	});

	// Fire-and-forget embedding generation
	const domainId = domain.id;
	const embeddingInput = description
		? `${label} — ${description}`
		: label;
	const client = getRequestClient();

	const embeddingWork = async () => {
		try {
			const embedding = await generateEmbedding(embeddingInput, {
				taskType: 'RETRIEVAL_DOCUMENT'
			});
			const vectorStr = `[${embedding.join(',')}]`;
			await client.$queryRaw`
				UPDATE org_issue_domain
				SET embedding = ${vectorStr}::vector(768)
				WHERE id = ${domainId}
			`;
		} catch (err) {
			console.warn(`[IssueDomain] Failed to generate embedding for domain ${domainId}:`, err);
		}
	};

	if (platform?.context?.waitUntil) {
		platform.context.waitUntil(embeddingWork());
	} else {
		// Dev: fire-and-forget IIFE
		embeddingWork();
	}

	return json(
		{
			id: domain.id,
			label: domain.label,
			description: domain.description,
			weight: domain.weight,
			createdAt: domain.createdAt.toISOString(),
			updatedAt: domain.updatedAt.toISOString()
		},
		{ status: 201 }
	);
};

/** Update an issue domain. Requires editor role. */
export const PATCH: RequestHandler = async ({ locals, params, request, platform }) => {
	if (!locals.user) throw error(401, 'Authentication required');
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

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

	const existing = await db.orgIssueDomain.findFirst({
		where: { id, orgId: org.id }
	});
	if (!existing) throw error(404, 'Issue domain not found');

	const data: Record<string, unknown> = {};
	if (fields.label !== undefined) {
		if (RESERVED_LABELS.some(r => fields.label!.startsWith(r))) {
			throw error(400, 'This label is reserved');
		}
		// Check duplicate on label change
		if (fields.label !== existing.label) {
			const dup = await db.orgIssueDomain.findUnique({
				where: { orgId_label: { orgId: org.id, label: fields.label } }
			});
			if (dup) throw error(409, 'An issue domain with this label already exists');
		}
		data.label = fields.label;
	}
	if (fields.description !== undefined) {
		data.description = fields.description || null;
	}
	if (fields.weight !== undefined) {
		data.weight = fields.weight;
	}

	if (Object.keys(data).length === 0) throw error(400, 'No fields to update');

	const updated = await db.orgIssueDomain.update({
		where: { id },
		data
	});

	// Re-compute embedding if label or description changed
	if ('label' in data || 'description' in data) {
		const newLabel = (data.label as string) ?? existing.label;
		const newDesc = (data.description as string | null) ?? existing.description;
		const embeddingInput = newDesc ? `${newLabel} — ${newDesc}` : newLabel;
		const domainId = id;
		const client = getRequestClient();

		const embeddingWork = async () => {
			try {
				const embedding = await generateEmbedding(embeddingInput, {
					taskType: 'RETRIEVAL_DOCUMENT'
				});
				const vectorStr = `[${embedding.join(',')}]`;
				await client.$queryRaw`
					UPDATE org_issue_domain
					SET embedding = ${vectorStr}::vector(768)
					WHERE id = ${domainId}
				`;
			} catch (err) {
				console.warn(`[IssueDomain] Failed to update embedding for domain ${domainId}:`, err);
			}
		};

		if (platform?.context?.waitUntil) {
			platform.context.waitUntil(embeddingWork());
		} else {
			embeddingWork();
		}
	}

	return json({
		id: updated.id,
		label: updated.label,
		description: updated.description,
		weight: updated.weight,
		createdAt: updated.createdAt.toISOString(),
		updatedAt: updated.updatedAt.toISOString()
	});
};

/** Delete an issue domain. Requires editor role. */
export const DELETE: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Authentication required');
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const body = await request.json();
	const { id } = body as { id?: string };

	if (!id) throw error(400, 'id is required');

	const existing = await db.orgIssueDomain.findFirst({
		where: { id, orgId: org.id }
	});
	if (!existing) throw error(404, 'Issue domain not found');
	if (RESERVED_LABELS.some(r => existing.label.startsWith(r))) {
		throw error(400, 'Cannot delete reserved domain');
	}

	await db.orgIssueDomain.delete({ where: { id } });

	return json({ ok: true });
};
