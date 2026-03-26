// CONVEX: skip — security-critical unsubscribe mutation flow (HMAC token verification + emailStatus update)
import { db } from '$lib/core/db';
import { verifyUnsubscribeToken } from '$lib/server/email/unsubscribe';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { supporterId, orgId, token } = params;

	// Verify HMAC token FIRST — no DB query needed, prevents DoS
	if (!verifyUnsubscribeToken(supporterId, orgId, token)) {
		return { status: 'invalid' as const, verified: false };
	}

	// Token valid — check supporter status
	const supporter = await db.supporter.findUnique({
		where: { id: supporterId },
		select: { id: true, orgId: true, emailStatus: true }
	});

	if (!supporter || supporter.orgId !== orgId) {
		return { status: 'invalid' as const, verified: false };
	}

	if (supporter.emailStatus === 'unsubscribed') {
		return { status: 'already' as const, verified: true };
	}

	return { status: 'confirm' as const, verified: true };
};

export const actions: Actions = {
	default: async ({ params }) => {
		const { supporterId, orgId, token } = params;

		// Verify token first
		if (!verifyUnsubscribeToken(supporterId, orgId, token)) {
			return { done: false, error: 'Invalid unsubscribe link.' };
		}

		const supporter = await db.supporter.findUnique({
			where: { id: supporterId },
			select: { id: true, orgId: true, emailStatus: true }
		});

		if (!supporter || supporter.orgId !== orgId) {
			return { done: false, error: 'Invalid unsubscribe link.' };
		}

		if (supporter.emailStatus === 'unsubscribed') {
			return { done: true };
		}

		await db.supporter.update({
			where: { id: supporterId },
			data: { emailStatus: 'unsubscribed' }
		});

		return { done: true };
	}
};
