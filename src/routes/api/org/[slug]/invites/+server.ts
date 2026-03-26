import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { encryptPii, computeEmailHash, tryDecryptPii, type EncryptedPii } from '$lib/core/crypto/user-pii-encryption';
import { serverQuery, serverAction, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/** Decrypt an invite's email from encrypted_email (authoritative post-Cycle 6). */
async function decryptInviteEmail(invite: {
	id: string;
	encrypted_email: string;
}): Promise<string> {
	const enc: EncryptedPii = JSON.parse(invite.encrypted_email);
	const decrypted = await tryDecryptPii(enc, 'org-invite:' + invite.id);
	if (!decrypted) throw new Error(`[PII] Invite ${invite.id} decryption failed`);
	return decrypted;
}

/** Send invites to join an organization. */
export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json();
	const { invites } = body as {
		invites?: Array<{ email: string; role?: string }>;
	};

			const result = await serverAction(api.invites.create, {
				slug: params.slug,
				invites: (invites ?? []).map((inv) => ({
					email: inv.email,
					role: inv.role
				}))
			});
			return json(result, { status: 201 });
	}

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

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

	// Compute email hashes for hash-based lookups
	const emailHashes = await Promise.all(emails.map((e) => computeEmailHash(e)));
	const validHashes = emailHashes.filter((h): h is string => h !== null);

	// Build email-to-hash map for skip-set resolution
	const emailToHash = new Map<string, string>();
	for (let i = 0; i < emails.length; i++) {
		const h = emailHashes[i];
		if (h) emailToHash.set(emails[i], h);
	}

	// Batch lookups: hash-based for both users and invites
	const [existingUsers, existingInvitesByHash] = await Promise.all([
		validHashes.length > 0
			? db.user.findMany({
					where: { email_hash: { in: validHashes } },
					select: {
						id: true,
						email_hash: true,
						memberships: {
							where: { orgId: org.id },
							select: { id: true }
						}
					}
				})
			: Promise.resolve([]),
		validHashes.length > 0
			? db.orgInvite.findMany({
					where: {
						orgId: org.id,
						email_hash: { in: validHashes },
						accepted: false,
						expiresAt: { gt: new Date() }
					},
					select: { email_hash: true }
				})
			: Promise.resolve([])
	]);

	// Build skip sets using hashes
	const memberHashes = new Set(
		existingUsers.filter((u) => u.memberships.length > 0).map((u) => u.email_hash)
	);
	const alreadyMemberEmails = new Set(
		emails.filter((e) => {
			const h = emailToHash.get(e);
			return h && memberHashes.has(h);
		})
	);
	const invitedHashes = new Set(existingInvitesByHash.map((i) => i.email_hash));
	const alreadyInvitedEmails = new Set(
		emails.filter((e) => {
			const h = emailToHash.get(e);
			return h && invitedHashes.has(h);
		})
	);

	const results: Array<{ email: string; status: 'sent' | 'skipped' }> = [];
	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + 7); // 7-day expiry

	for (const inv of cleaned) {
		if (alreadyMemberEmails.has(inv.email) || alreadyInvitedEmails.has(inv.email)) {
			results.push({ email: inv.email, status: 'skipped' });
			continue;
		}

		const token = generateToken();
		const inviteId = crypto.randomUUID();

		// Encrypt email for at-rest protection (fail-closed — no empty-string poison pills)
		const [encEmailRaw, invEmailHash] = await Promise.all([
			encryptPii(inv.email, 'org-invite:' + inviteId),
			computeEmailHash(inv.email)
		]);
		if (!encEmailRaw || !invEmailHash) throw error(500, 'Invite email encryption failed');
		const encEmail = JSON.stringify(encEmailRaw);

		await db.orgInvite.create({
			data: {
				id: inviteId,
				orgId: org.id,
				encrypted_email: encEmail,
				email_hash: invEmailHash,
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

			const result = await serverQuery(api.invites.list, { slug: params.slug });
			return json(result);
	}

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	const rawInvites = await db.orgInvite.findMany({
		where: {
			orgId: org.id,
			accepted: false,
			expiresAt: { gt: new Date() }
		},
		select: {
			id: true,
			encrypted_email: true,
			role: true,
			expiresAt: true
		},
		orderBy: { expiresAt: 'desc' }
	});

	const inviteResults = await Promise.all(
		rawInvites.map(async (inv) => {
			const email = await decryptInviteEmail(inv).catch(() => null);
			if (!email) return null; // skip corrupted invite rows
			return {
				id: inv.id,
				email,
				role: inv.role,
				expiresAt: inv.expiresAt
			};
		})
	);
	const invites = inviteResults.filter((i): i is NonNullable<typeof i> => i !== null);

	return json({ invites });
};

/** Revoke a pending invite. */
export const DELETE: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json();
	const { inviteId } = body as { inviteId?: string };

	if (!inviteId) {
		throw error(400, 'inviteId is required');
	}

			await serverMutation(api.invites.remove, {
				slug: params.slug,
				inviteId
			});
			return json({ ok: true });
	}

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

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

	const body = await request.json();
	const { inviteId } = body as { inviteId?: string };

	if (!inviteId) {
		throw error(400, 'inviteId is required');
	}

			const result = await serverAction(api.invites.resend, {
				slug: params.slug,
				inviteId
			});
			return json(result);
	}

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

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
		select: { id: true, encrypted_email: true, role: true, expiresAt: true }
	});

	const resendEmail = await decryptInviteEmail(updated).catch(() => null);
	if (!resendEmail) {
		throw error(500, 'Invite PII decryption failed — cannot confirm resend');
	}

	return json({
		invite: {
			id: updated.id,
			email: resendEmail,
			role: updated.role,
			expiresAt: updated.expiresAt
		}
	});
};

function generateToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
