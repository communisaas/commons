/**
 * Delegation CRUD — agentic delegation grants, actions, and review queue.
 *
 * Delegation allows Tier 3+ users to grant an AI agent permission to act
 * on their behalf within constrained scopes (campaign signing, debate
 * positioning, message generation).
 *
 * Policy text is encrypted at rest (PII — reveals user intent).
 * Encryption uses random IV → create/updateGrant use actions.
 * Decryption is deterministic → reads use queries.
 */

import { query, mutation, action, internalMutation } from './_generated/server';
import { v } from 'convex/values';
// Policy text stored plaintext — server sees it in action args anyway.
// Feature gated behind FEATURES.DELEGATION = false.

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Retired while the delegation product is launch-disabled.
 *
 * The SvelteKit feature flag is presentation-only; direct Convex callers do not
 * pass through it. Keep the exported symbol for stale clients, but fail before
 * authentication or database work until delegation has its own bounded read
 * models and a deliberate launch migration.
 */
export const listGrants = query({
	args: {},
	handler: async () => {
		throw new Error('DELEGATION_NOT_LAUNCHED');
	}
});

/** @deprecated Delegation is not launched; retained as a pre-I/O tombstone. */
export const getGrant = query({
	args: {
		grantId: v.id('delegationGrants')
	},
	handler: async () => {
		throw new Error('DELEGATION_NOT_LAUNCHED');
	}
});

/** @deprecated Delegation is not launched; retained as a pre-I/O tombstone. */
export const listActions = query({
	args: {
		grantId: v.id('delegationGrants'),
		limit: v.optional(v.number())
	},
	handler: async () => {
		throw new Error('DELEGATION_NOT_LAUNCHED');
	}
});

// =============================================================================
// ACTIONS (PII encryption for policy text — random IV)
// =============================================================================

/**
 * Create a new delegation grant. Encrypts policy text at rest.
 */
export const createGrant = action({
	args: {
		scope: v.string(),
		policyText: v.string(),
		issueFilter: v.optional(v.array(v.string())),
		orgFilter: v.optional(v.array(v.string())),
		stanceProfileId: v.optional(v.string()),
		maxActionsPerDay: v.optional(v.number()),
		requireReviewAbove: v.optional(v.float64()),
		expiresAt: v.optional(v.number())
	},
	handler: async () => {
		throw new Error('DELEGATION_NOT_LAUNCHED');
	}
});

/**
 * Update a delegation grant. Re-encrypts policy text if changed.
 */
export const updateGrant = action({
	args: {
		grantId: v.id('delegationGrants'),
		status: v.optional(v.string()),
		maxActionsPerDay: v.optional(v.number()),
		requireReviewAbove: v.optional(v.float64()),
		issueFilter: v.optional(v.array(v.string())),
		orgFilter: v.optional(v.array(v.string())),
		policyText: v.optional(v.string())
	},
	handler: async () => {
		throw new Error('DELEGATION_NOT_LAUNCHED');
	}
});

// =============================================================================
// MUTATIONS (no PII encryption needed)
// =============================================================================

/**
 * Revoke a delegation grant.
 */
export const revokeGrant = mutation({
	args: {
		grantId: v.id('delegationGrants')
	},
	handler: async () => {
		throw new Error('DELEGATION_NOT_LAUNCHED');
	}
});

/**
 * Record a delegated action (called by the automation engine).
 */
export const recordAction = internalMutation({
	args: {
		grantId: v.id('delegationGrants'),
		actionType: v.string(),
		targetId: v.string(),
		targetTitle: v.string(),
		reasoning: v.string(),
		relevanceScore: v.float64(),
		stanceAlignment: v.optional(v.float64()),
		resultId: v.optional(v.string()),
		status: v.string()
	},
	handler: async () => {
		throw new Error('DELEGATION_NOT_LAUNCHED');
	}
});

/**
 * Submit a review decision (approve/reject a pending delegation action).
 */
export const submitReview = mutation({
	args: {
		reviewId: v.id('delegationReviews'),
		decision: v.string()
	},
	handler: async () => {
		throw new Error('DELEGATION_NOT_LAUNCHED');
	}
});

// =============================================================================
// INTERNAL MUTATIONS (called from actions)
// =============================================================================

/**
 * Insert a delegation grant with pre-encrypted policy text.
 */
export const insertGrant = internalMutation({
	args: {
		scope: v.string(),
		policyText: v.string(),
		issueFilter: v.array(v.string()),
		orgFilter: v.array(v.string()),
		stanceProfileId: v.optional(v.string()),
		maxActionsPerDay: v.number(),
		requireReviewAbove: v.float64(),
		expiresAt: v.optional(v.number())
	},
	handler: async () => {
		throw new Error('DELEGATION_NOT_LAUNCHED');
	}
});

/**
 * Patch a delegation grant with pre-encrypted values.
 */
export const patchGrant = internalMutation({
	args: {
		grantId: v.id('delegationGrants'),
		status: v.optional(v.string()),
		maxActionsPerDay: v.optional(v.number()),
		requireReviewAbove: v.optional(v.float64()),
		issueFilter: v.optional(v.array(v.string())),
		orgFilter: v.optional(v.array(v.string())),
		policyText: v.optional(v.string())
	},
	handler: async () => {
		throw new Error('DELEGATION_NOT_LAUNCHED');
	}
});
