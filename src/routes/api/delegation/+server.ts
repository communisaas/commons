import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/core/db';
import { encryptPii, decryptPii } from '$lib/core/crypto/user-pii-encryption';
import type { EncryptedPii } from '$lib/core/crypto/user-pii-encryption';
import { FEATURES } from '$lib/config/features';

const MAX_ACTIVE_GRANTS = 3;
const VALID_SCOPES = ['campaign_sign', 'debate_position', 'message_generate', 'full'] as const;

/**
 * GET /api/delegation
 *
 * List user's delegation grants. Requires auth + Trust Tier 3+.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!FEATURES.DELEGATION) throw error(404, 'Not found');
	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const user = locals.user;
	if (!user || (user.trust_tier ?? 0) < 3) {
		throw error(403, 'Trust Tier 3+ required for delegation');
	}

	const grants = await prisma.delegationGrant.findMany({
		where: { userId: session.userId },
		include: {
			actions: {
				take: 5,
				orderBy: { createdAt: 'desc' },
				select: {
					id: true,
					actionType: true,
					targetTitle: true,
					relevanceScore: true,
					status: true,
					createdAt: true
				}
			},
			reviewQueue: {
				where: { decision: null },
				select: {
					id: true,
					targetTitle: true,
					reasoning: true,
					proofWeight: true,
					createdAt: true
				}
			}
		},
		orderBy: { createdAt: 'desc' }
	});

	// Decrypt policy text for display
	const decryptedGrants = await Promise.all(
		grants.map(async (grant) => {
			let policyText = grant.policyText;
			try {
				const parsed = JSON.parse(grant.policyText) as EncryptedPii;
				if (parsed.ciphertext && parsed.iv) {
					policyText = await decryptPii(parsed, grant.userId, 'policy');
				}
			} catch {
				// Not encrypted or decryption failed — redact ciphertext
				policyText = '[encrypted]';
			}

			return {
				...grant,
				policyText
			};
		})
	);

	return json({ grants: decryptedGrants });
};

/**
 * POST /api/delegation
 *
 * Create a new delegation grant. Requires auth + Trust Tier 3+.
 *
 * Body: { scope, policyText, issueFilter?, orgFilter?, stanceProfileId?,
 *         maxActionsPerDay?, requireReviewAbove?, expiresAt? }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!FEATURES.DELEGATION) throw error(404, 'Not found');
	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const user = locals.user;
	if (!user || (user.trust_tier ?? 0) < 3) {
		throw error(403, 'Trust Tier 3+ required for delegation');
	}

	const body = await request.json();
	const {
		scope,
		policyText,
		issueFilter,
		orgFilter,
		stanceProfileId,
		maxActionsPerDay,
		requireReviewAbove,
		expiresAt
	} = body;

	// Validate scope
	if (!scope || !VALID_SCOPES.includes(scope)) {
		throw error(400, `Invalid scope. Must be one of: ${VALID_SCOPES.join(', ')}`);
	}

	// Validate policy text
	if (!policyText || typeof policyText !== 'string' || policyText.trim().length < 5) {
		throw error(400, 'Policy text must be at least 5 characters');
	}
	if (policyText.length > 5000) {
		throw error(400, 'Policy text must not exceed 5000 characters');
	}

	// Check active grants limit
	const activeCount = await prisma.delegationGrant.count({
		where: {
			userId: session.userId,
			status: { in: ['active', 'paused'] }
		}
	});

	if (activeCount >= MAX_ACTIVE_GRANTS) {
		throw error(
			429,
			`Maximum ${MAX_ACTIVE_GRANTS} active delegation grants allowed. Revoke an existing grant first.`
		);
	}

	// Validate limits
	const clampedMaxActions = Math.max(1, Math.min(20, Math.round(maxActionsPerDay ?? 5)));
	const clampedReviewAbove = Math.max(0, requireReviewAbove ?? 10);

	// Encrypt policy text at rest (PII — reveals user intent)
	let storedPolicyText = policyText.trim();
	const encrypted = await encryptPii(storedPolicyText, session.userId, 'policy');
	if (encrypted) {
		storedPolicyText = JSON.stringify(encrypted);
	}

	const grant = await prisma.delegationGrant.create({
		data: {
			userId: session.userId,
			scope,
			policyText: storedPolicyText,
			issueFilter: (issueFilter || []).map((s: string) => s.toLowerCase().trim()).filter(Boolean),
			orgFilter: (orgFilter || []).map((s: string) => s.toLowerCase().trim()).filter(Boolean),
			stanceProfileId: stanceProfileId || null,
			maxActionsPerDay: clampedMaxActions,
			requireReviewAbove: clampedReviewAbove,
			expiresAt: expiresAt ? (() => {
				const d = new Date(expiresAt);
				if (isNaN(d.getTime())) throw error(400, 'Invalid expiresAt date');
				if (d.getTime() <= Date.now()) throw error(400, 'expiresAt must be in the future');
				return d;
			})() : null,
			status: 'active'
		}
	});

	return json({ grant }, { status: 201 });
};
