import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { env } from '$env/dynamic/private';
import { verifyCronSecret } from '$lib/server/cron-auth';
import { FEATURES } from '$lib/config/features';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { readBoundedJson } from '$lib/server/bounded-json';
import { isRecord, isSafeUint } from '$lib/server/debate-input-validation';

const GOVERNANCE_RESOLUTION_REQUEST_MAX_BYTES = 8 * 1024;
const GOVERNANCE_JUSTIFICATION_MAX_CHARS = 2_000;

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

	const parsed = await readBoundedJson(request, GOVERNANCE_RESOLUTION_REQUEST_MAX_BYTES);
	if (!isRecord(parsed)) throw error(400, 'Invalid governance resolution request');
	const { winningArgumentIndex, justification } = parsed;

	if (
		!isSafeUint(winningArgumentIndex) ||
		typeof justification !== 'string' ||
		!justification.trim()
	) {
		throw error(400, 'winningArgumentIndex and justification are required');
	}
	const normalizedJustification = justification.trim();
	if (normalizedJustification.length > GOVERNANCE_JUSTIFICATION_MAX_CHARS) {
		throw error(
			400,
			`justification must be ${GOVERNANCE_JUSTIFICATION_MAX_CHARS} characters or fewer`
		);
	}

	const debate = await serverQuery(api.debates.getPublicDetail, {
		_secret: getInternalSecret(),
		identifier: debateId
	});
	if (!debate) throw error(404, 'Debate not found');
	if (debate.status !== 'awaiting_governance') {
		throw error(400, `Debate status is '${debate.status}', expected 'awaiting_governance'`);
	}

	const winnerArg = await serverQuery(api.debates.getArgumentByIndexForSsr, {
		_secret: getInternalSecret(),
		debateId: debate._id,
		argumentIndex: winningArgumentIndex
	});
	if (!winnerArg) {
		throw error(400, `Argument index ${winningArgumentIndex} not found`);
	}

	const appealDeadlineMs = Date.now() + 7 * 24 * 60 * 60 * 1000;

	await serverMutation(api.debates.updateStatus, {
		_secret: getInternalSecret(),
		debateId: debateId as Id<'debates'>,
		expectedStatus: 'awaiting_governance',
		status: 'resolved',
		winningStance: winnerArg.stance,
		winningArgumentIndex,
		resolutionMethod: 'governance_override',
		governanceJustification: normalizedJustification,
		appealDeadline: appealDeadlineMs
	});

	return json({
		success: true,
		debateId,
		winningArgumentIndex,
		winningStance: winnerArg.stance,
		resolutionMethod: 'governance_override',
		appealDeadline: new Date(appealDeadlineMs).toISOString()
	});
};
