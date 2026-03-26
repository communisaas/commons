/**
 * Shadow Atlas Engagement Endpoint (Tree 3)
 *
 * Registers a user's identity in the engagement tree, fetches their Merkle
 * proof and engagement metrics, and returns the combined result.
 *
 * FLOW:
 * 1. Validate OAuth session
 * 2. Look up User.identity_commitment and wallet/signer address
 * 3. POST /v1/engagement/register with { signerAddress, identityCommitment }
 *    - If already registered (400), treat as idempotent success
 * 4. GET /v1/engagement-metrics/{identityCommitment} for tier/counts
 * 5. GET /v1/engagement-path/{leafIndex} for Merkle proof
 * 6. Return combined engagement data to client
 *
 * GRACEFUL DEGRADATION: If the engagement tree has no entries yet or the
 * upstream is unavailable, returns tier-0 defaults so proof generation
 * still works (user just gets engagement_tier: 0).
 *
 * SPEC REFERENCE: specs/REPUTATION-ARCHITECTURE-SPEC.md
 */

import { json } from '@sveltejs/kit';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';
import {
	registerEngagement,
	getEngagementPath,
	getEngagementMetrics,
} from '$lib/core/shadow-atlas/client';

/** Default engagement depth (must match CIRCUIT_DEPTH / engagement tree depth) */
const DEFAULT_ENGAGEMENT_DEPTH = 20;

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';

function tier0Defaults(depth: number = DEFAULT_ENGAGEMENT_DEPTH) {
	return {
		engagementRoot: ZERO_HASH,
		engagementPath: Array(depth).fill(ZERO_HASH),
		engagementIndex: 0,
		engagementTier: 0 as const,
		actionCount: '0',
		diversityScore: '0',
	};
}

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const session = locals.session;

		if (!session) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		// Look up canonical identity commitment and signer address
		const user = await serverQuery(api.users.getIdentityForEngagement, {
			userId: session.userId as any,
		});

		if (!user?.identityCommitment) {
			return json(
				{ error: 'Identity verification required before engagement registration' },
				{ status: 403 }
			);
		}

		const identityCommitment = user.identityCommitment;

		// Determine signer address from wallet_address
		const signerAddress = user.walletAddress;
		if (!signerAddress) {
			// No signer address available -- return tier-0 defaults.
			// Engagement registration requires an Ethereum address for Sybil mapping.
			console.warn('[Shadow Atlas] No signer address for engagement registration, returning tier-0 defaults');
			return json(tier0Defaults());
		}

		const body = await request.json().catch(() => ({}));
		// Client may pass identityCommitment but we always use server-canonical value

		// Step 1: Register in engagement tree (idempotent)
		let leafIndex: number;
		try {
			const regResult = await registerEngagement(signerAddress, identityCommitment);
			if ('alreadyRegistered' in regResult) {
				// Already registered -- need to get leafIndex from metrics
				leafIndex = -1; // Will be resolved from metrics below
			} else {
				leafIndex = regResult.leafIndex;
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.error('[Shadow Atlas] Engagement registration failed:', msg);
			// Graceful degradation: return tier-0 defaults
			return json(tier0Defaults());
		}

		// Step 2: Fetch engagement metrics (tier, action count, diversity score, leafIndex)
		let tier = 0;
		let actionCount = 0;
		let diversityScore = 0;
		try {
			const metrics = await getEngagementMetrics(identityCommitment);
			if (metrics) {
				tier = metrics.tier;
				actionCount = metrics.actionCount;
				diversityScore = metrics.diversityScore;
				// Resolve leafIndex if we didn't get it from registration (already-registered case)
				if (leafIndex === -1) {
					leafIndex = metrics.leafIndex;
				}
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.warn('[Shadow Atlas] Engagement metrics fetch failed:', msg);
			// If we still don't have leafIndex, return tier-0 defaults
			if (leafIndex === -1) {
				return json(tier0Defaults());
			}
		}

		// Step 3: Fetch engagement Merkle proof
		try {
			const proof = await getEngagementPath(leafIndex);
			return json({
				engagementRoot: proof.engagementRoot,
				engagementPath: proof.engagementPath,
				engagementIndex: leafIndex,
				engagementTier: tier,
				actionCount: String(actionCount),
				diversityScore: String(diversityScore),
			});
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.warn('[Shadow Atlas] Engagement path fetch failed:', msg);
			// Graceful degradation
			return json(tier0Defaults());
		}
	} catch (error) {
		console.error('[Shadow Atlas] Engagement endpoint error:', error);
		return json(
			{ error: 'Engagement service unavailable' },
			{ status: 502 }
		);
	}
};
