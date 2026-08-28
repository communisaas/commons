import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { appealResolution } from '$lib/core/blockchain/debate-market-client';
import { FEATURES } from '$lib/config/features';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { isBytes32 } from '$lib/server/debate-input-validation';

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

	const debate = await serverQuery(api.debates.get, {
		_secret: getInternalSecret(),
		debateId: debateId as Id<'debates'>
	});
	if (!debate) throw error(404, 'Debate not found');
	if (debate.status !== 'resolved' && debate.status !== 'resolving') {
		throw error(400, 'Can only appeal resolved or resolving debates');
	}
	if (!isBytes32(debate.debateIdOnchain)) {
		throw error(409, 'Debate is not registered with a valid on-chain identifier');
	}

	const result = await appealResolution(debate.debateIdOnchain);

	if (!result.success) {
		throw error(502, result.error ?? 'Appeal transaction failed');
	}

	// The chain transition and the Convex mirror are one product operation.
	// Persist only from the exact state observed before the transaction so a
	// stale request cannot overwrite a concurrent governance/settlement result.
	await serverMutation(api.debates.updateStatus, {
		_secret: getInternalSecret(),
		debateId: debate._id,
		expectedStatus: debate.status,
		status: 'under_appeal'
	});

	return json({ success: true, status: 'under_appeal', txHash: result.txHash });
};
