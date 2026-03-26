// CONVEX: Keep SvelteKit — CRON_SECRET auth, debate status validation + argument index verification
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/core/db';
import { env } from '$env/dynamic/private';
import { verifyCronSecret } from '$lib/server/cron-auth';
import { FEATURES } from '$lib/config/features';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';

/**
 * POST /api/debates/[debateId]/governance-resolve
 *
 * Submit a governance resolution for a debate in AWAITING_GOVERNANCE status.
 * Sets the winning argument, stores justification, and transitions to resolved.
 *
 * Auth: CRON_SECRET (operator-level). In production this would require
 * governance multisig verification or on-chain tx confirmation.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Not found');
	}

	const { debateId } = params;

	// Auth check — operator-level for now
	const authHeader = request.headers.get('authorization');
	const cronSecret = env.CRON_SECRET;
	if (!cronSecret || !verifyCronSecret(authHeader, cronSecret)) {
		throw error(401, 'Unauthorized — governance credential required');
	}

	const body = await request.json() as {
		winningArgumentIndex: number;
		justification: string;
	};

	if (body.winningArgumentIndex == null || !body.justification?.trim()) {
		throw error(400, 'winningArgumentIndex and justification are required');
	}

	// Load debate
	const debate = await prisma.debate.findUnique({
		where: { id: debateId },
		include: { arguments: true }
	});

	if (!debate) throw error(404, 'Debate not found');
	if (debate.status !== 'awaiting_governance') {
		throw error(400, `Debate status is '${debate.status}', expected 'awaiting_governance'`);
	}

	// Verify the argument index exists
	const winnerArg = debate.arguments.find(
		(a) => a.argument_index === body.winningArgumentIndex
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
				appealDeadline: appealDeadlineMs
			});
			return json({
				success: true,
				debateId,
				winningArgumentIndex: body.winningArgumentIndex,
				winningStance: winnerArg.stance,
				resolutionMethod: 'governance_override',
				appealDeadline: new Date(appealDeadlineMs).toISOString()
			});
	}

	const now = new Date();
	const appealDeadline = new Date(appealDeadlineMs);

	await prisma.debate.update({
		where: { id: debateId },
		data: {
			status: 'resolved',
			winning_argument_index: body.winningArgumentIndex,
			winning_stance: winnerArg.stance,
			resolved_at: now,
			resolution_method: 'governance_override',
			governance_justification: body.justification.trim(),
			appeal_deadline: appealDeadline
		}
	});

	return json({
		success: true,
		debateId,
		winningArgumentIndex: body.winningArgumentIndex,
		winningStance: winnerArg.stance,
		resolutionMethod: 'governance_override',
		appealDeadline: appealDeadline.toISOString()
	});
};
