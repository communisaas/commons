import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUserContext } from '$lib/server/llm-cost-protection';
import { readPaidProviderBudgetStatus } from '$lib/server/paid-provider-budget-client';

const NO_STORE_HEADERS = {
	'cache-control': 'private, no-store, max-age=0',
	'cdn-cache-control': 'no-store',
	'cloudflare-cdn-cache-control': 'no-store'
} as const;

export const GET: RequestHandler = async (event) => {
	const context = getUserContext(event);
	if (!context.isAuthenticated || !context.userId) {
		return json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE_HEADERS });
	}
	if (context.providerTier !== 'operator') {
		return json({ error: 'Operator access required' }, { status: 403, headers: NO_STORE_HEADERS });
	}

	const status = await readPaidProviderBudgetStatus({
		event,
		identifier: context.userId
	});
	if (!status) {
		return json(
			{ error: 'Paid-provider budget status unavailable' },
			{ status: 503, headers: NO_STORE_HEADERS }
		);
	}

	return json(status, { headers: NO_STORE_HEADERS });
};
