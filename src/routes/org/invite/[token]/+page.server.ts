// CONVEX: Keep SvelteKit — security-critical invite acceptance ($transaction, PII decryption, email hash comparison)
import { redirect, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { computeEmailHash, tryDecryptPii, type EncryptedPii } from '$lib/core/crypto/user-pii-encryption';
import type { PageServerLoad, Actions } from './$types';

/** Decrypt an invite's email (authoritative post-Cycle 6). */
async function decryptInviteEmail(invite: {
	id: string;
	encrypted_email: string;
}): Promise<string> {
	const enc: EncryptedPii = JSON.parse(invite.encrypted_email);
	const decrypted = await tryDecryptPii(enc, 'org-invite:' + invite.id);
	if (!decrypted) throw new Error(`[PII] Invite ${invite.id} decryption failed`);
	return decrypted;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const invite = await db.orgInvite.findUnique({
		where: { token: params.token },
		include: {
			org: {
				select: { name: true, slug: true, avatar: true }
			}
		}
	});

	if (!invite) {
		throw error(404, 'Invite not found');
	}

	if (invite.accepted) {
		throw redirect(302, `/org/${invite.org.slug}`);
	}

	if (invite.expiresAt < new Date()) {
		return {
			expired: true,
			orgName: invite.org.name,
			orgSlug: invite.org.slug
		};
	}

	const inviteEmail = await decryptInviteEmail(invite);

	return {
		expired: false,
		orgName: invite.org.name,
		orgSlug: invite.org.slug,
		orgAvatar: invite.org.avatar,
		inviteEmail,
		inviteRole: invite.role,
		isAuthenticated: !!locals.user,
		userEmail: locals.user?.email ?? null
	};
};

export const actions: Actions = {
	accept: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/invite/${params.token}`);
		}

		const invite = await db.orgInvite.findUnique({
			where: { token: params.token },
			include: {
				org: { select: { id: true, slug: true } }
			}
		});

		if (!invite || invite.accepted || invite.expiresAt < new Date()) {
			throw error(400, 'This invite is no longer valid');
		}

		// Hash-based email comparison (post-Cycle 6: no plaintext fallback)
		const emailHash = await computeEmailHash(locals.user.email);
		const emailMatches = !!(invite.email_hash && emailHash && invite.email_hash === emailHash);
		if (!emailMatches) {
			throw error(403, 'This invite was sent to a different email address');
		}

		// Check if already a member
		const existing = await db.orgMembership.findUnique({
			where: {
				userId_orgId: { userId: locals.user.id, orgId: invite.org.id }
			}
		});

		if (existing) {
			// Already a member, mark invite as accepted and redirect
			await db.orgInvite.update({
				where: { id: invite.id },
				data: { accepted: true }
			});
			throw redirect(302, `/org/${invite.org.slug}`);
		}

		// Create membership and mark invite as accepted
		await db.$transaction([
			db.orgMembership.create({
				data: {
					userId: locals.user.id,
					orgId: invite.org.id,
					role: invite.role,
					invitedBy: invite.invitedBy
				}
			}),
			db.orgInvite.update({
				where: { id: invite.id },
				data: { accepted: true }
			})
		]);

		throw redirect(302, `/org/${invite.org.slug}`);
	}
};
