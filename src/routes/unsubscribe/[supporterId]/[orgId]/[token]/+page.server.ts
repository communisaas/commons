// CONVEX: Keep SvelteKit — security-critical HMAC token verification + emailStatus update
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { verifyUnsubscribeToken } from '$lib/server/email/unsubscribe';
import type { PageServerLoad, Actions } from './$types';

// param-length caps prevent the HMAC update from burning CPU on
// adversarial megabyte URLs. Realistic bounds: Convex doc ids
// are 32 chars, HMAC tokens are 64 hex. 128 is generous slack.
function paramsInBounds(supporterId: string, orgId: string, token: string): boolean {
	return supporterId.length <= 128 && orgId.length <= 128 && token.length <= 128;
}

export const load: PageServerLoad = async ({ params }) => {
	const { supporterId, orgId, token } = params;

	// Boundary length-cap before HMAC computation
	if (!paramsInBounds(supporterId, orgId, token)) {
		return { status: 'invalid' as const, verified: false };
	}

	// Verify HMAC token FIRST — no DB query needed, prevents DoS
	if (!verifyUnsubscribeToken(supporterId, orgId, token)) {
		return { status: 'invalid' as const, verified: false };
	}

	// Token valid — check supporter status
	const supporter = await serverQuery(api.supporters.getEmailStatus, {
		supporterId: supporterId as Id<'supporters'>
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

		// Boundary length-cap mirroring load().
		if (!paramsInBounds(supporterId, orgId, token)) {
			return { done: false, error: 'Invalid unsubscribe link.' };
		}

		// Verify token first
		if (!verifyUnsubscribeToken(supporterId, orgId, token)) {
			return { done: false, error: 'Invalid unsubscribe link.' };
		}

		const supporter = await serverQuery(api.supporters.getEmailStatus, {
			supporterId: supporterId as Id<'supporters'>
		});

		if (!supporter || supporter.orgId !== orgId) {
			return { done: false, error: 'Invalid unsubscribe link.' };
		}

		if (supporter.emailStatus === 'unsubscribed') {
			return { done: true };
		}

		await serverMutation(api.supporters.unsubscribe, {
			supporterId: supporterId as Id<'supporters'>
		});

		return { done: true };
	}
};
