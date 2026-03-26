// CONVEX: Keep SvelteKit — deep auth check (debate→campaign→org→membership), blockchain state verification
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';

/**
 * POST /api/debates/[debateId]/settle
 *
 * Org-admin settlement of a debate linked to a campaign.
 * This is distinct from the existing /resolve endpoint (which is community/AI resolution)
 * and /governance-resolve (which is operator-level governance override).
 *
 * Settlement allows the org admin who owns the campaign to declare the debate outcome
 * with a reasoning statement. This is the "org declares position" path.
 *
 * Auth: authenticated user with editor+ role in the campaign's org.
 * Body: { outcome: 'support' | 'oppose', reasoning: string }
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Debate feature is not enabled');
	}

	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const { debateId } = params;

	// Load debate with campaign relation to verify org membership
	const debate = await prisma.debate.findUnique({
		where: { id: debateId },
		select: {
			id: true,
			status: true,
			arguments: {
				where: { verification_status: 'verified' },
				orderBy: { weighted_score: 'desc' },
				select: {
					argument_index: true,
					stance: true,
					weighted_score: true
				}
			},
			campaign: {
				select: {
					id: true,
					orgId: true,
					org: {
						select: {
							slug: true,
							memberships: {
								where: { userId: locals.user.id },
								select: { role: true }
							}
						}
					}
				}
			}
		}
	});

	if (!debate) {
		throw error(404, 'Debate not found');
	}

	// Verify this debate is linked to a campaign
	if (!debate.campaign) {
		throw error(400, 'This debate is not linked to a campaign');
	}

	// Verify user is editor+ in the campaign's org
	const membership = debate.campaign.org.memberships[0];
	if (!membership) {
		throw error(403, 'You are not a member of this organization');
	}
	if (membership.role === 'member') {
		throw error(403, 'Editor or owner role required to settle debates');
	}

	// Validate debate status — only active or resolving debates can be settled
	if (debate.status === 'resolved') {
		throw error(400, 'Debate has already been resolved');
	}
	if (debate.status === 'under_appeal') {
		throw error(400, 'Cannot settle a debate that is under appeal');
	}

	// Parse and validate body
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		throw error(400, 'Request body is required');
	}

	const { outcome, reasoning } = body as { outcome?: string; reasoning?: string };

	if (!outcome || !['support', 'oppose'].includes(outcome)) {
		throw error(400, 'outcome must be "support" or "oppose"');
	}

	if (!reasoning || typeof reasoning !== 'string' || reasoning.trim().length < 10) {
		throw error(400, 'reasoning is required and must be at least 10 characters');
	}

	if (reasoning.trim().length > 2000) {
		throw error(400, 'reasoning must be 2000 characters or fewer');
	}

	// Map outcome to stance
	const winningStance = outcome.toUpperCase();

	// Find the best argument matching the winning stance (if any)
	const matchingArg = debate.arguments.find(
		(a) => a.stance === winningStance
	);
	const winningArgumentIndex = matchingArg?.argument_index ?? null;

			await serverMutation(api.debates.updateStatus, {
				debateId: debateId as any,
				status: 'resolved',
				winningStance,
				winningArgumentIndex: winningArgumentIndex ?? undefined,
				resolutionMethod: 'org_settlement',
				governanceJustification: reasoning.trim()
			});
			return json({
				debateId,
				status: 'resolved',
				outcome,
				winningStance,
				winningArgumentIndex,
				reasoning: reasoning.trim(),
				resolvedAt: new Date().toISOString()
			});
	}

	const now = new Date();

		const resolved = await prisma.debate.update({
			where: { id: debateId, status: { not: 'resolved' } },
			data: {
				status: 'resolved',
				winning_stance: winningStance,
				winning_argument_index: winningArgumentIndex,
				resolved_at: now,
				resolution_method: 'org_settlement',
				governance_justification: reasoning.trim()
			}
		});

		return json({
			debateId: resolved.id,
			status: 'resolved',
			outcome,
			winningStance,
			winningArgumentIndex,
			reasoning: reasoning.trim(),
			resolvedAt: now.toISOString()
		});
	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2025') {
			throw error(409, 'Debate has already been resolved or status changed');
		}
		throw err;
	}
};
