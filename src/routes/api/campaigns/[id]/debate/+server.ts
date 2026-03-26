import { json, error } from '@sveltejs/kit';
// CONVEX: Keep SvelteKit
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import type { RequestHandler } from './$types';

/**
 * POST /api/campaigns/[id]/debate
 *
 * Creates a debate linked to a campaign.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Debate feature is not enabled');
	}

	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	// Rate limit: 5 debate creations per minute per user
	const rlKey = `ratelimit:debate-create:${locals.user.id}`;
	const rl = await getRateLimiter().check(rlKey, { maxRequests: 5, windowMs: 60_000 });
	if (!rl.allowed) {
		throw error(429, 'Too many debate creation attempts. Please try again later.');
	}

	// Look up the campaign for auth checks via Convex
	const campaign = await serverQuery(api.debates.getCampaignForDebate, {
		campaignId: params.id as any
	});

	if (!campaign) {
		throw error(404, 'Campaign not found');
	}

	if (!campaign.memberRole) {
		throw error(403, 'You are not a member of this organization');
	}
	if (campaign.memberRole === 'member') {
		throw error(403, 'Editor role required');
	}

	// Validate campaign has a template
	if (!campaign.templateId) {
		throw error(400, 'Campaign must be linked to a template to create a debate');
	}

	// Check for existing debate on this campaign
	if (campaign.debateId) {
		throw error(409, 'This campaign already has a linked debate');
	}

	// Parse request body for optional overrides
	const body = await request.json().catch(() => ({}));
	const propositionText = (body.propositionText as string)?.trim();
	const rawDuration = body.duration as number | undefined;
	const rawJurisdiction = body.jurisdictionSizeHint as number | undefined;

	// Validate duration (seconds) — converted to days must be integer 1–30
	let durationSeconds = 7 * 24 * 60 * 60; // default: 7 days
	if (rawDuration !== undefined && rawDuration !== null) {
		const durationDays = rawDuration / (24 * 60 * 60);
		if (!Number.isFinite(rawDuration) || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 30) {
			throw error(400, 'duration must represent a whole number of days between 1 and 30 (in seconds)');
		}
		durationSeconds = rawDuration;
	}

	// Validate jurisdictionSizeHint — finite integer 1–10000
	let jurisdictionHint = 100; // default
	if (rawJurisdiction !== undefined && rawJurisdiction !== null) {
		if (!Number.isFinite(rawJurisdiction) || !Number.isInteger(rawJurisdiction) || rawJurisdiction < 1 || rawJurisdiction > 10000) {
			throw error(400, 'jurisdictionSizeHint must be an integer between 1 and 10000');
		}
		jurisdictionHint = rawJurisdiction;
	}

	if (propositionText && propositionText.length < 10) {
		throw error(400, 'Proposition text must be at least 10 characters');
	}

	const result = await spawnDebateForCampaign(campaign._id, {
		proposition: propositionText || undefined,
		durationDays: durationSeconds / (24 * 60 * 60),
		jurisdictionSizeHint: jurisdictionHint
	});

	if (!result) {
		throw error(502, 'Failed to create debate');
	}

	// Fetch the debate to return full details
	const debate = await serverQuery(api.debates.get, {
		debateId: result.debateId as any
	});

	return json({
		debateId: result.debateId,
		debateIdOnchain: debate?.debateIdOnchain,
		propositionText: debate?.propositionText,
		deadline: debate?.deadline ? new Date(debate.deadline).toISOString() : null
	}, { status: 201 });
};
