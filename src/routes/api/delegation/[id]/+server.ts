import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/core/db';
import { encryptPii, decryptPii } from '$lib/core/crypto/user-pii-encryption';
import type { EncryptedPii } from '$lib/core/crypto/user-pii-encryption';
import { FEATURES } from '$lib/config/features';

/**
 * GET /api/delegation/[id]
 *
 * Get a single delegation grant with recent actions.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.DELEGATION) throw error(404, 'Not found');
	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const grant = await prisma.delegationGrant.findUnique({
		where: { id: params.id },
		include: {
			actions: {
				take: 20,
				orderBy: { createdAt: 'desc' },
				select: {
					id: true,
					actionType: true,
					targetId: true,
					targetTitle: true,
					reasoning: true,
					relevanceScore: true,
					stanceAlignment: true,
					resultId: true,
					status: true,
					createdAt: true
				}
			},
			reviewQueue: {
				where: { decision: null },
				select: {
					id: true,
					targetId: true,
					targetTitle: true,
					reasoning: true,
					proofWeight: true,
					createdAt: true
				}
			}
		}
	});

	if (!grant) {
		throw error(404, 'Delegation grant not found');
	}

	if (grant.userId !== session.userId) {
		throw error(403, 'Not authorized to view this grant');
	}

	// Decrypt policy text
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

	return json({ grant: { ...grant, policyText } });
};

/**
 * PATCH /api/delegation/[id]
 *
 * Update a delegation grant: pause/resume, edit constraints.
 *
 * Body: { status?, maxActionsPerDay?, requireReviewAbove?, issueFilter?, orgFilter?, policyText? }
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.DELEGATION) throw error(404, 'Not found');
	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const user = locals.user;
	if (!user || (user.trust_tier ?? 0) < 3) {
		throw error(403, 'Trust Tier 3+ required for delegation');
	}

	const grant = await prisma.delegationGrant.findUnique({
		where: { id: params.id },
		select: { id: true, userId: true, status: true }
	});

	if (!grant) {
		throw error(404, 'Delegation grant not found');
	}

	if (grant.userId !== session.userId) {
		throw error(403, 'Not authorized to modify this grant');
	}

	if (grant.status === 'revoked') {
		throw error(400, 'Cannot modify a revoked grant');
	}

	const body = await request.json();
	const updates: Record<string, unknown> = {};

	// Status toggle (active <-> paused only)
	if (body.status !== undefined) {
		if (body.status === 'paused' && grant.status === 'active') {
			updates.status = 'paused';
		} else if (body.status === 'active' && grant.status === 'paused') {
			updates.status = 'active';
		} else if (body.status !== grant.status) {
			throw error(400, `Cannot transition from '${grant.status}' to '${body.status}'`);
		}
	}

	// Editable constraints
	if (body.maxActionsPerDay !== undefined) {
		updates.maxActionsPerDay = Math.max(1, Math.min(20, Math.round(body.maxActionsPerDay)));
	}
	if (body.requireReviewAbove !== undefined) {
		updates.requireReviewAbove = Math.max(0, body.requireReviewAbove);
	}
	if (body.issueFilter !== undefined) {
		updates.issueFilter = (body.issueFilter as string[])
			.map((s: string) => s.toLowerCase().trim())
			.filter(Boolean);
	}
	if (body.orgFilter !== undefined) {
		updates.orgFilter = (body.orgFilter as string[])
			.map((s: string) => s.toLowerCase().trim())
			.filter(Boolean);
	}
	if (body.policyText !== undefined && typeof body.policyText === 'string') {
		let storedPolicyText = body.policyText.trim();
		const encrypted = await encryptPii(storedPolicyText, session.userId, 'policy');
		if (encrypted) {
			storedPolicyText = JSON.stringify(encrypted);
		}
		updates.policyText = storedPolicyText;
	}

	if (Object.keys(updates).length === 0) {
		throw error(400, 'No valid fields to update');
	}

	const updated = await prisma.delegationGrant.update({
		where: { id: params.id },
		data: updates
	});

	return json({ grant: updated });
};

/**
 * DELETE /api/delegation/[id]
 *
 * Revoke a delegation grant. Sets revokedAt and status='revoked'.
 * Completed actions remain in the audit trail.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.DELEGATION) throw error(404, 'Not found');
	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const grant = await prisma.delegationGrant.findUnique({
		where: { id: params.id },
		select: { id: true, userId: true, status: true }
	});

	if (!grant) {
		throw error(404, 'Delegation grant not found');
	}

	if (grant.userId !== session.userId) {
		throw error(403, 'Not authorized to revoke this grant');
	}

	if (grant.status === 'revoked') {
		return json({ message: 'Grant already revoked' });
	}

	await prisma.delegationGrant.update({
		where: { id: params.id },
		data: {
			status: 'revoked',
			revokedAt: new Date()
		}
	});

	return json({ message: 'Delegation grant revoked' });
};
