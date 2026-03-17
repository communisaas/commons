import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import type { RequestHandler } from './$types';

/** Send invites to join an organization. */
export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const body = await request.json();
	const { invites } = body as {
		invites?: Array<{ email: string; role?: string }>;
	};

	if (!invites || !Array.isArray(invites) || invites.length === 0) {
		throw error(400, 'invites array is required');
	}

	if (invites.length > 20) {
		throw error(400, 'Maximum 20 invites at once');
	}

	// Check seat limit
	const [memberCount, pendingCount] = await Promise.all([
		db.orgMembership.count({ where: { orgId: org.id } }),
		db.orgInvite.count({
			where: { orgId: org.id, accepted: false, expiresAt: { gt: new Date() } }
		})
	]);
	if (memberCount + pendingCount + invites.length > org.max_seats) {
		throw error(403, `Seat limit reached (${org.max_seats}). Upgrade your plan for more seats.`);
	}

	const validRoles = ['editor', 'member'];

	// Normalize and validate emails upfront
	const cleaned = invites
		.map((inv) => ({
			email: inv.email?.trim().toLowerCase() ?? '',
			role: validRoles.includes(inv.role ?? '') ? inv.role! : 'member'
		}))
		.filter((inv) => inv.email && inv.email.includes('@'));

	if (cleaned.length === 0) {
		throw error(400, 'No valid email addresses provided');
	}

	const emails = cleaned.map((c) => c.email);

	// Batch lookups: 3 queries instead of up to 60
	const [existingUsers, existingInvites] = await Promise.all([
		db.user.findMany({
			where: { email: { in: emails } },
			select: {
				id: true,
				email: true,
				orgMemberships: {
					where: { orgId: org.id },
					select: { id: true }
				}
			}
		}),
		db.orgInvite.findMany({
			where: {
				orgId: org.id,
				email: { in: emails },
				accepted: false,
				expiresAt: { gt: new Date() }
			},
			select: { email: true }
		})
	]);

	// Build skip sets
	const alreadyMemberEmails = new Set(
		existingUsers.filter((u) => u.orgMemberships.length > 0).map((u) => u.email)
	);
	const alreadyInvitedEmails = new Set(existingInvites.map((i) => i.email));

	const results: Array<{ email: string; status: 'sent' | 'skipped' }> = [];
	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + 7); // 7-day expiry

	for (const inv of cleaned) {
		if (alreadyMemberEmails.has(inv.email) || alreadyInvitedEmails.has(inv.email)) {
			results.push({ email: inv.email, status: 'skipped' });
			continue;
		}

		const token = generateToken();

		await db.orgInvite.create({
			data: {
				orgId: org.id,
				email: inv.email,
				role: inv.role,
				token,
				expiresAt,
				invitedBy: locals.user.id
			}
		});

		// TODO: Send invite email via transactional email service
		// For now, invites are stored and can be accepted via /org/invite/[token]

		results.push({ email: inv.email, status: 'sent' });
	}

	const sent = results.filter((r) => r.status === 'sent').length;

	return json({ sent, results }, { status: 201 });
};

/** List pending invites for an org. */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const invites = await db.orgInvite.findMany({
		where: {
			orgId: org.id,
			accepted: false,
			expiresAt: { gt: new Date() }
		},
		select: {
			id: true,
			email: true,
			role: true,
			expiresAt: true
		},
		orderBy: { expiresAt: 'desc' }
	});

	return json({ invites });
};

/** Revoke a pending invite. */
export const DELETE: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const body = await request.json();
	const { inviteId } = body as { inviteId?: string };

	if (!inviteId) {
		throw error(400, 'inviteId is required');
	}

	const invite = await db.orgInvite.findFirst({
		where: { id: inviteId, orgId: org.id }
	});

	if (!invite) {
		throw error(404, 'Invite not found');
	}

	await db.orgInvite.delete({ where: { id: inviteId } });

	return json({ ok: true });
};

/** Resend a pending invite (regenerate token + reset expiry). */
export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const body = await request.json();
	const { inviteId } = body as { inviteId?: string };

	if (!inviteId) {
		throw error(400, 'inviteId is required');
	}

	const invite = await db.orgInvite.findFirst({
		where: { id: inviteId, orgId: org.id, accepted: false }
	});

	if (!invite) {
		throw error(404, 'Invite not found');
	}

	const token = generateToken();
	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + 7);

	const updated = await db.orgInvite.update({
		where: { id: inviteId },
		data: { token, expiresAt },
		select: { id: true, email: true, role: true, expiresAt: true }
	});

	return json({ invite: updated });
};

function generateToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
