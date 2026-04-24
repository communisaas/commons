import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { appealResolution } from '$lib/core/blockchain/debate-market-client';
import { FEATURES } from '$lib/config/features';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Not found');
	}

	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}
	const user = locals.user;
	if (!user || (user.trust_tier ?? 0) < 3) {
		throw error(403, 'Tier 3+ verification required for market operations');
	}

	const { debateId } = params;
	if (!debateId) throw error(400, 'Missing debateId');

	const debate = await serverQuery(api.debates.get, { debateId: debateId as any });
	if (!debate) throw error(404, 'Debate not found');
	if (debate.status !== 'resolved' && debate.status !== 'resolving') {
		throw error(400, 'Can only appeal resolved or resolving debates');
	}

	const result = await appealResolution(debateId);

	if (!result.success) {
		throw error(502, result.error ?? 'Appeal transaction failed');
	}

	return json({ success: true, txHash: result.txHash });
};
