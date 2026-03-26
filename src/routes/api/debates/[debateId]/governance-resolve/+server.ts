import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { env } from '$env/dynamic/private';
import { verifyCronSecret } from '$lib/server/cron-auth';
import { FEATURES } from '$lib/config/features';

/**
 * POST /api/debates/[debateId]/governance-resolve
 *
 * Submit a governance resolution for a debate in AWAITING_GOVERNANCE status.
 * Auth: CRON_SECRET (operator-level).
 */
export const POST: RequestHandler = async ({ params, request }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Not found');
	}

	const { debateId } = params;

	const authHeader = request.headers.get('authorization');
	const cronSecret = env.CRON_SECRET;
	if (!cronSecret || !verifyCronSecret(authHeader, cronSecret)) {
		throw error(401, 'Unauthorized — governance credential required');
	}

	const body = (await request.json()) as {
		winningArgumentIndex: number;
		justification: string;
	};

	if (body.winningArgumentIndex == null || !body.justification?.trim()) {
		throw error(400, 'winningArgumentIndex and justification are required');
	}

	const debate = await serverQuery(api.debates.get, { debateId: debateId as any });
	if (!debate) throw error(404, 'Debate not found');
	if (debate.status !== 'awaiting_governance') {
		throw error(400, `Debate status is '${debate.status}', expected 'awaiting_governance'`);
	}

	const winnerArg = (debate as any).arguments?.find(
		(a: any) => a.argumentIndex === body.winningArgumentIndex
	);
	if (!winnerArg) {
		throw error(400, `Argument index ${body.winningArgumentIndex} not found`);
	}

	const appealDeadlineMs = Date.now() + 7 * 24 * 60 * 60 * 1000;

	await serverMutation(api.debates.updateStatus, {
		debateId: debateId as any,
		status: 'resolved',
		winningStance: winnerArg.stance,
		winningArgumentIndex: body.winningArgumentIndex,
		resolutionMethod: 'governance_override',
		governanceJustification: body.justification.trim(),
		appealDeadline: appealDeadlineMs,
	});

	return json({
		success: true,
		debateId,
		winningArgumentIndex: body.winningArgumentIndex,
		winningStance: winnerArg.stance,
		resolutionMethod: 'governance_override',
		appealDeadline: new Date(appealDeadlineMs).toISOString(),
	});
};
