import {
	action,
	mutation,
	query,
	internalAction,
	internalMutation,
	internalQuery
} from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { requireAuth } from './_authHelpers';
import { requireInternalSecret } from './_internalAuth';
import { CWCXmlGenerator } from './_cwcXml';
import { selectActiveCredentialForUser } from './_credentialSelect';

// =============================================================================
// SUBMISSIONS — ZK proof creation + congressional delivery
// =============================================================================


declare const process: { env: Record<string, string | undefined> };
const WITNESS_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CONGRESSIONAL_NOT_LAUNCHED = 'CONGRESSIONAL_NOT_LAUNCHED';
const CONGRESSIONAL_TRANSPORT_NOT_CONFIGURED = 'CONGRESSIONAL_TRANSPORT_NOT_CONFIGURED';
const WITNESS_EXPIRED = 'WITNESS_EXPIRED';

type CreateSubmissionResult = {
	success: true;
	submissionId: Id<'submissions'>;
	status: 'existing' | 'pending';
};

type ActiveCredentialStatus =
	| {
			active: true;
			credentialId: Id<'districtCredentials'>;
			userId: Id<'users'>;
			credentialHash: string;
			trustTier: number;
	  }
	| {
			active: false;
			reason: string;
	  };

type InsertSubmissionResult = {
	submissionId: Id<'submissions'>;
	existing: boolean;
};

type CongressionalDeliveryTemplate = {
	title: string;
	description?: string;
	messageBody: string;
	deliveryMethod: string;
	status: string;
	isPublic: boolean;
	orgId: Id<'organizations'> | null;
	deliveryConfig: Record<string, unknown>;
	recipientConfig: Record<string, unknown>;
};

type CongressionalTransportConfig = {
	houseProxyUrl?: string;
	houseProxyToken?: string;
	senateBaseUrl?: string;
	senateKey?: string;
	senatePathPrefix: string;
	hasHouseConfig: boolean;
	hasSenateConfig: boolean;
};

function isCongressionalDeliveryLaunched(): boolean {
	const value =
		process.env.CONGRESSIONAL_DELIVERY_LAUNCHED ??
		process.env.CWC_DELIVERY_LAUNCHED ??
		process.env.FEATURE_CONGRESSIONAL;
	return value === 'true' || value === '1';
}

function assertCongressionalDeliveryLaunched() {
	if (!isCongressionalDeliveryLaunched()) {
		throw new Error(CONGRESSIONAL_NOT_LAUNCHED);
	}
}

// Safety: 'messages' is the LIVE Senate inbox; 'testing-messages' is the no-op
// sandbox. Refuse the live prefix unless an operator explicitly opts into prod
// (CWC_PRODUCTION=true), so a TEST arm can never reach real staffers by leaving a
// stale 'messages' prefix. (CWC_PRODUCTION was documented in .env.example but read
// nowhere — this is the only place that consults it.) Fails safe to the sandbox.
function resolveSenatePathPrefix(): string {
	// Normalize before the guard so '/messages', 'messages/', ' messages ' all
	// collapse to the canonical 'messages' and can't slip a live-routing variant
	// past the live-inbox check.
	const prefix = (process.env.CWC_SENATE_PATH_PREFIX || 'testing-messages')
		.trim()
		.replace(/^\/+|\/+$/g, '');
	if (prefix === 'messages' && process.env.CWC_PRODUCTION !== 'true') {
		console.error(
			'[submissions] CWC_SENATE_PATH_PREFIX=messages (live Senate) requires CWC_PRODUCTION=true; falling back to testing-messages sandbox'
		);
		return 'testing-messages';
	}
	return prefix;
}

function getCongressionalTransportConfig(): CongressionalTransportConfig {
	const houseProxyUrl = process.env.GCP_PROXY_URL;
	const houseProxyToken = process.env.GCP_PROXY_AUTH_TOKEN;
	const senateBaseUrl = process.env.CWC_API_BASE_URL;
	const senateKey = process.env.CWC_API_KEY;

	return {
		houseProxyUrl,
		houseProxyToken,
		senateBaseUrl,
		senateKey,
		senatePathPrefix: resolveSenatePathPrefix(),
		hasHouseConfig: Boolean(houseProxyUrl && houseProxyToken),
		hasSenateConfig: Boolean(senateBaseUrl && senateKey)
	};
}

export const getCongressionalDeliveryReadiness = query({
	args: {},
	handler: async (ctx) => {
		await requireAuth(ctx);

		const launched = isCongressionalDeliveryLaunched();
		const transport = getCongressionalTransportConfig();
		const missing: string[] = [];

		if (!launched) {
			missing.push('CONGRESSIONAL_DELIVERY_LAUNCHED/CWC_DELIVERY_LAUNCHED/FEATURE_CONGRESSIONAL');
		}
		if (!transport.houseProxyUrl) missing.push('GCP_PROXY_URL');
		if (!transport.houseProxyToken) missing.push('GCP_PROXY_AUTH_TOKEN');
		if (!transport.senateBaseUrl) missing.push('CWC_API_BASE_URL');
		if (!transport.senateKey) missing.push('CWC_API_KEY');

		const ready = launched && transport.hasHouseConfig && transport.hasSenateConfig;
		const dependency =
			'congressional launch flag + House CWC proxy env + Senate CWC API env + per-submission proof/template checks';

		return {
			ready,
			launched,
			houseTransportConfigured: transport.hasHouseConfig,
			senateTransportConfigured: transport.hasSenateConfig,
			missing,
			dependency,
			message: ready
				? 'Congressional delivery transport is configured; submission-local proof, template, witness, chamber, and representative checks still gate each CWC side effect.'
				: `Congressional delivery transport is not armed; missing ${missing.join(', ')}.`
		};
	}
});

function getTemplateDeliveryError(template: CongressionalDeliveryTemplate | null): string | null {
	if (!template) return 'CWC_TEMPLATE_NOT_FOUND';
	if (template.deliveryMethod !== 'cwc') return 'CWC_TEMPLATE_NOT_CWC';
	if (template.status !== 'published' || !template.isPublic) return 'CWC_TEMPLATE_NOT_PUBLISHED';
	if (!template.messageBody.trim()) return 'CWC_TEMPLATE_EMPTY_MESSAGE';
	return null;
}

function assertDeliverableCongressionalTemplate(
	template: CongressionalDeliveryTemplate | null
): asserts template is CongressionalDeliveryTemplate {
	const error = getTemplateDeliveryError(template);
	if (error) throw new Error(error);
}

type CongressionalChamber = 'house' | 'senate';

function normalizeCongressionalChamber(value: unknown): CongressionalChamber | null {
	if (typeof value !== 'string') return null;
	const normalized = value.trim().toLowerCase();
	if (normalized === 'house' || normalized === 'representative' || normalized === 'representatives') {
		return 'house';
	}
	if (normalized === 'senate' || normalized === 'senator' || normalized === 'senators') {
		return 'senate';
	}
	return null;
}

function getTemplateCongressionalChambers(
	template: CongressionalDeliveryTemplate
): Set<CongressionalChamber> {
	const chambers = new Set<CongressionalChamber>();
	const config = template.recipientConfig ?? {};
	const explicitChambers = Array.isArray(config.chambers) ? config.chambers : [];
	for (const chamber of explicitChambers) {
		const normalized = normalizeCongressionalChamber(chamber);
		if (normalized) chambers.add(normalized);
	}

	if (Array.isArray(config.recipients)) {
		for (const recipient of config.recipients) {
			if (!recipient || typeof recipient !== 'object') continue;
			const record = recipient as Record<string, unknown>;
			if (record.type !== 'congressional') continue;
			const normalized = normalizeCongressionalChamber(record.chamber);
			if (normalized) {
				chambers.add(normalized);
			} else {
				chambers.add('house');
				chambers.add('senate');
			}
		}
	}

	// Existing UI defaults to both chambers when no explicit recipient scope exists.
	if (chambers.size === 0) {
		chambers.add('house');
		chambers.add('senate');
	}
	return chambers;
}

function missingTransportForChambers(
	chambers: Set<CongressionalChamber>,
	transport: CongressionalTransportConfig
): CongressionalChamber[] {
	const missing: CongressionalChamber[] = [];
	if (chambers.has('house') && !transport.hasHouseConfig) missing.push('house');
	if (chambers.has('senate') && !transport.hasSenateConfig) missing.push('senate');
	return missing;
}

/**
 * Create a ZK proof submission.
 *
 * Pipeline:
 *   1. Validate required fields
 *   2. Atomic insert via internalMutation (idempotency + nullifier check)
 *   3. Schedule background tasks: deliverToCongress, registerEngagement
 */
export const create = action({
	args: {
		templateId: v.string(),
		proof: v.string(),
		publicInputs: v.any(),
		nullifier: v.string(),
		encryptedWitness: v.string(),
		witnessNonce: v.string(),
		ephemeralPublicKey: v.string(),
		teeKeyId: v.string(),
		idempotencyKey: v.optional(v.string())
	},
	handler: async (ctx, args): Promise<CreateSubmissionResult> => {
		// Auth check
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error('Authentication required');
		}

		// bound caller-supplied string sizes at the action
		// boundary. v.string() doesn't enforce length and Convex caps doc
		// size at 1 MiB — a verified user with quota could otherwise submit
		// megabyte payloads that store before downstream resolver-gates
		// (which cap proof at 131,072 hex) reject. Cap matches the resolver
		// boundary; encryptedWitness is typically ~few KB; nonces/keys are short.
		if (args.proof.length > 131_072) throw new Error('PROOF_TOO_LARGE');
		if (args.encryptedWitness.length > 65_536) throw new Error('ENCRYPTED_WITNESS_TOO_LARGE');
		if (args.witnessNonce.length > 128) throw new Error('WITNESS_NONCE_TOO_LARGE');
		if (args.ephemeralPublicKey.length > 128) throw new Error('EPHEMERAL_PUBLIC_KEY_TOO_LARGE');
		if (args.teeKeyId.length > 128) throw new Error('TEE_KEY_ID_TOO_LARGE');
		if (args.nullifier.length > 80) throw new Error('NULLIFIER_TOO_LARGE');
		if (args.templateId.length > 64) throw new Error('TEMPLATE_ID_TOO_LARGE');
		if (args.idempotencyKey !== undefined && args.idempotencyKey.length > 128) {
			throw new Error('IDEMPOTENCY_KEY_TOO_LARGE');
		}

		assertCongressionalDeliveryLaunched();

		const template: CongressionalDeliveryTemplate | null = await ctx.runQuery(internal.submissions.getTemplateForDelivery, {
			templateId: args.templateId
		});
		assertDeliverableCongressionalTemplate(template);

		// Compute pseudonymous ID (HMAC-SHA256 of userId)
		const pseudonymousId = await computePseudonymousId(identity.subject);

		// (1a) Active-credential gate: reject if the submitter has no non-revoked,
		// unexpired district credential. Closes F1 stale-proof replay.
		// identity.tokenIdentifier → users.by_tokenIdentifier → districtCredentials lookup.
		const credentialStatus: ActiveCredentialStatus = await ctx.runQuery(
			internal.submissions.hasActiveDistrictCredential,
			{
				tokenIdentifier: identity.tokenIdentifier
			}
		);
		if (!credentialStatus.active) {
			throw new Error('NO_ACTIVE_DISTRICT_CREDENTIAL');
		}
		// Defense-in-depth congressional-floor gate at the Convex action, mirroring
		// the SvelteKit endpoint (`/api/submissions/create/+server.ts`). This public
		// Convex action is reachable directly via the Convex client by any
		// authenticated user, so it re-enforces the floor independently of the
		// SvelteKit path. Tiered floor: tier 2 (address-verified — district confirmed)
		// DELIVERS; gov-ID (tier 4) raises the assurance BADGE, it is not the bar. The
		// active-credential / revocation / nullifier checks above are independent of
		// this threshold and are unchanged. MUST stay in sync with
		// REQUIRED_CONGRESSIONAL_PROOF_TIER in the SvelteKit handler.
		//
		// NOTE: the canonical action-domain REBIND (recompute the domain from
		// server-held inputs and reject mismatch) is performed by the SvelteKit
		// resolver (`+server.ts`), NOT here — on the direct Convex path the domain
		// in publicInputs is still self-referential. See follow-up note in the
		// security review; closing it means moving the rebind into this action.
		const REQUIRED_CONGRESSIONAL_PROOF_TIER = 2;
		if (credentialStatus.trustTier < REQUIRED_CONGRESSIONAL_PROOF_TIER) {
			throw new Error('INSUFFICIENT_AUTHORITY');
		}
		// Use credentialId (always set) not credentialHash (empty for commitment-only
		// shadow_atlas credentials — would bypass delivery recheck on falsy guard).
		const issuingCredentialId: Id<'districtCredentials'> = credentialStatus.credentialId;

		// NOTE: congressional (CWC) deliveries are PERSON-LAYER civic actions — a
		// constituent contacting their own representative — NOT the org's metered
		// paid usage (which meters org-INITIATED sends like email/SMS blasts). This
		// action is reachable only for deliverable CWC templates
		// (assertDeliverableCongressionalTemplate above), so a per-org
		// verified-action quota CHECK here would let an external attacker exhaust a
		// victim org's quota via its public template (billing-quota DoS). The crypto
		// gates (active credential, revocation, nullifier uniqueness) plus the
		// recipientSubdivision bound limit abuse. Attribution still happens at
		// delivery time (emitCongressionalAction → createCampaignAction), but with
		// metersOrgQuota:false so it never consumes the org's paid quota. The org
		// verified-action quota therefore is neither counted by nor enforced on this
		// congressional path; org-initiated sends remain gated in their own paths.

		// Extract action_id from public inputs
		const publicInputsTyped = args.publicInputs as Record<string, unknown> | undefined;
		const actionId = (publicInputsTyped?.actionDomain as string) ?? args.templateId;

		// Atomic insert: checks idempotency key + nullifier uniqueness
		const result: InsertSubmissionResult = await ctx.runMutation(internal.submissions.insertSubmission, {
			pseudonymousId,
			templateId: args.templateId,
			actionId,
			proofHex: args.proof,
			publicInputs: args.publicInputs,
			nullifier: args.nullifier,
			encryptedWitness: args.encryptedWitness,
			witnessNonce: args.witnessNonce,
			ephemeralPublicKey: args.ephemeralPublicKey,
			teeKeyId: args.teeKeyId,
			idempotencyKey: args.idempotencyKey,
			witnessExpiresAt: Date.now() + WITNESS_TTL_MS,
			issuingCredentialId,
			trustTier: credentialStatus.trustTier
		});

		if (result.existing) {
			// Idempotent retry — return existing submission
			return {
				success: true,
				submissionId: result.submissionId,
				status: 'existing'
			};
		}

		// Schedule background tasks (fire-and-forget via Convex scheduler)
		await ctx.scheduler.runAfter(0, internal.submissions.deliverToCongress, {
			submissionId: result.submissionId
		});

		await ctx.scheduler.runAfter(0, internal.submissions.registerEngagement, {
			userSubject: identity.subject
		});

		// promoteTier removed: trust tier escalation must wait until
		// verificationStatus === 'verified'. Re-enable once the verification
		// status lifecycle is wired.

		return {
			success: true,
			submissionId: result.submissionId,
			status: 'pending'
		};
	}
});

/**
 * Internal: Atomic submission insert with idempotency + nullifier uniqueness.
 */
export const insertSubmission = internalMutation({
	args: {
		pseudonymousId: v.string(),
		templateId: v.string(),
		actionId: v.string(),
		proofHex: v.string(),
		publicInputs: v.any(),
		nullifier: v.string(),
		encryptedWitness: v.string(),
		witnessNonce: v.optional(v.string()),
		ephemeralPublicKey: v.optional(v.string()),
		teeKeyId: v.optional(v.string()),
		idempotencyKey: v.optional(v.string()),
		witnessExpiresAt: v.number(),
		issuingCredentialId: v.optional(v.id('districtCredentials')),
		trustTier: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		// Idempotency key must be user-scoped. A bare key match
		// (returning `{submissionId, existing: true}` for ANY matching
		// key regardless of `pseudonymousId`) produces two failure modes:
		//   (1) Silent drop — user B picks the same UUID as user A
		//       (low-entropy client RNG, predictable timestamps);
		//       B's valid proof is discarded, B sees success:true with
		//       status:'existing'; no submission is recorded for B.
		//   (2) Cross-user disclosure — the returned submissionId
		//       belongs to user A. Caller can then query that
		//       submission and observe templateId / anchor status /
		//       trustTier of another user's action.
		// Require BOTH idempotencyKey AND pseudonymousId match for the
		// existing-row return. A bare key match without pseudonymousId
		// match falls through to the nullifier check (which is already
		// user-scoped at line 362) and on to insert. The unique-index
		// constraint on idempotencyKey itself is preserved (so a re-
		// insert with conflicting key + different user would fail at
		// insert time, which is the desired behavior — alert ops to
		// the collision rather than silently drop or leak).
		if (args.idempotencyKey) {
			const existingByKey = await ctx.db
				.query('submissions')
				.withIndex('by_idempotencyKey', (q) => q.eq('idempotencyKey', args.idempotencyKey!))
				.first();

			if (existingByKey && existingByKey.pseudonymousId === args.pseudonymousId) {
				return { submissionId: existingByKey._id, existing: true };
			}
			if (existingByKey) {
				// Key exists but belongs to a different user — refuse to
				// disclose or overwrite. The caller should generate a fresh
				// key. This is the canonical "key collision across users"
				// case; rare with high-entropy UUIDs but possible with
				// low-entropy client RNGs.
				throw new Error('IDEMPOTENCY_KEY_COLLISION');
			}
		}

		// Check nullifier uniqueness (prevent double-actions)
		const existingByNullifier = await ctx.db
			.query('submissions')
			.withIndex('by_nullifier', (q) => q.eq('nullifier', args.nullifier))
			.first();

		if (existingByNullifier) {
			if (existingByNullifier.pseudonymousId === args.pseudonymousId) {
				// Same user retrying — idempotent return
				return { submissionId: existingByNullifier._id, existing: true };
			}
			throw new Error('This action has already been submitted (duplicate nullifier)');
		}

		// Insert submission
		const id = await ctx.db.insert('submissions', {
			pseudonymousId: args.pseudonymousId,
			templateId: args.templateId,
			actionId: args.actionId,
			proofHex: args.proofHex,
			publicInputs: args.publicInputs,
			nullifier: args.nullifier,
			encryptedWitness: args.encryptedWitness,
			encryptedMessage: undefined,
			witnessNonce: args.witnessNonce,
			ephemeralPublicKey: args.ephemeralPublicKey,
			teeKeyId: args.teeKeyId,
			idempotencyKey: args.idempotencyKey,
			deliveryStatus: 'pending',
			verificationStatus: 'pending',
			witnessExpiresAt: args.witnessExpiresAt,
			issuingCredentialId: args.issuingCredentialId,
			trustTier: args.trustTier,
			updatedAt: Date.now()
		});

		return { submissionId: id, existing: false };
	}
});

/**
 * Internal: Check whether a user has a currently-active (non-revoked, unexpired)
 * district credential. Used as the F1 revocation gate at submission entry AND
 * at delivery enqueue (closes the TOCTOU window between action and dispatch).
 *
 * Resolves tokenIdentifier → userId via the by_tokenIdentifier index so the
 * submissions.create action can pass through identity.tokenIdentifier directly.
 */
export const hasActiveDistrictCredential = internalQuery({
	args: { tokenIdentifier: v.string() },
	handler: async (ctx, { tokenIdentifier }) => {
		const user = await ctx.db
			.query('users')
			.withIndex('by_tokenIdentifier', (q) => q.eq('tokenIdentifier', tokenIdentifier))
			.unique();
		if (!user) return { active: false as const, reason: 'user_not_found' };

		const active = await selectActiveCredentialForUser(ctx, user._id);
		if (!active) return { active: false as const, reason: 'revoked_or_expired' };

		return {
			active: true as const,
			credentialId: active._id,
			userId: user._id,
			credentialHash: active.credentialHash,
			trustTier: user.trustTier
		};
	}
});

/**
 * Internal: Check a credential Id for current validity. Used at delivery
 * enqueue to recheck revocation after submission was accepted — closes the
 * TOCTOU window where a user revokes (re-verifies) between submit and send.
 *
 * Keyed on Convex Id (not credentialHash) because commitment-only credentials
 * store credentialHash="" which would defeat a hash-based lookup.
 */
export const isCredentialActive = internalQuery({
	args: { credentialId: v.id('districtCredentials') },
	handler: async (ctx, { credentialId }) => {
		const credential = await ctx.db.get(credentialId);
		if (!credential) return { active: false as const, reason: 'not_found' };
		if (credential.revokedAt) return { active: false as const, reason: 'revoked' };
		if (credential.expiresAt < Date.now()) return { active: false as const, reason: 'expired' };
		return { active: true as const };
	}
});

/**
 * Internal: Return the `districtCommitment` stored on a specific credential row.
 *
 * Used by `deliverToCongress` to supply the server-canonical districtCommitment
 * to the delivery resolver as part of the Stage 2.7 witness-to-commitment binding
 * check. The resolver hashes the decrypted witness's 24 district slots with
 * poseidon2Sponge24 and compares to this value — without it, a prover with a
 * leaked credentialHash could submit a proof whose witness names districts
 * different from the ones the server committed to.
 *
 * Returns `null` when the row is missing or lacks a commitment (legacy
 * credential pre-sponge-24). Caller fails delivery closed in that case.
 */
export const getIssuingCredentialCommitment = internalQuery({
	args: { credentialId: v.id('districtCredentials') },
	handler: async (ctx, { credentialId }) => {
		const credential = await ctx.db.get(credentialId);
		if (!credential) return null;
		if (!credential.districtCommitment) return null;
		return { districtCommitment: credential.districtCommitment };
	}
});

/**
 * Internal: Update submission delivery status.
 */
export const updateDeliveryStatus = internalMutation({
	args: {
		submissionId: v.id('submissions'),
		deliveryStatus: v.string(),
		cwcSubmissionId: v.optional(v.string()),
		deliveredAt: v.optional(v.number()),
		deliveryError: v.optional(v.string()),
		/**
		 * Attempt-count CAS guard. When a worker claimed for attempt N, it passes
		 * expectedAttempts=N on terminal writes. If claim has advanced (sweep
		 * reverted + retry claimed for N+1), this worker's write is refused —
		 * prevents resurrected old workers from overwriting newer retries.
		 *
		 * Sweeper writes omit the guard (they transition stuck-processing → failed
		 * based on age filter; Convex per-row serialization is sufficient).
		 */
		expectedAttempts: v.optional(v.number())
	},
	handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
		const row = await ctx.db.get(args.submissionId);
		if (!row) return { ok: false, reason: 'not_found' };

		if (args.expectedAttempts !== undefined) {
			const current = row.deliveryAttempts ?? 0;
			if (current !== args.expectedAttempts) {
				return { ok: false, reason: 'stale_attempt' };
			}
			// Tighter CAS: worker must still own the row, i.e. status is still
			// 'processing' (the claim's transient state). If the sweeper has already
			// flipped to 'failed', the worker is resurrected and must not overwrite.
			if (row.deliveryStatus !== 'processing') {
				return { ok: false, reason: 'claim_released' };
			}
		}

		// Convex patch gotcha: `field: undefined` removes the field. Omit optional
		// fields we don't intend to modify so prior values are preserved.
		const patch: Record<string, string | number | undefined> = {
			deliveryStatus: args.deliveryStatus,
			updatedAt: Date.now()
		};
		if (args.cwcSubmissionId !== undefined) patch.cwcSubmissionId = args.cwcSubmissionId;
		if (args.deliveredAt !== undefined) patch.deliveredAt = args.deliveredAt;
		if (args.deliveryError !== undefined) patch.deliveryError = args.deliveryError;
		await ctx.db.patch(args.submissionId, patch);
		return { ok: true };
	}
});

export const recordDeliveryReceipt = internalMutation({
	args: {
		submissionId: v.id('submissions'),
		templateId: v.string(),
		userId: v.optional(v.id('users')),
		pseudonymousId: v.optional(v.string()),
		recipientKey: v.string(),
		recipientName: v.optional(v.string()),
		recipientDistrict: v.optional(v.string()),
		chamber: v.optional(v.string()),
		provider: v.string(),
		providerReceiptId: v.optional(v.string()),
		status: v.string(),
		attempt: v.number(),
		errorCode: v.optional(v.string()),
		errorClass: v.optional(v.string()),
		deliveredAt: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		const existing = await ctx.db
			.query('submissionDeliveryReceipts')
			.withIndex('by_submissionId', (q) => q.eq('submissionId', args.submissionId))
			.filter((q) => q.eq(q.field('recipientKey'), args.recipientKey))
			.first();

		const optional: Record<string, string | number | Id<'users'> | undefined> = {};
		if (args.userId !== undefined) optional.userId = args.userId;
		if (args.pseudonymousId !== undefined) optional.pseudonymousId = args.pseudonymousId;
		if (args.recipientName !== undefined) optional.recipientName = args.recipientName;
		if (args.recipientDistrict !== undefined) optional.recipientDistrict = args.recipientDistrict;
		if (args.chamber !== undefined) optional.chamber = args.chamber;
		if (args.providerReceiptId !== undefined) optional.providerReceiptId = args.providerReceiptId;
		if (args.errorCode !== undefined) optional.errorCode = args.errorCode;
		if (args.errorClass !== undefined) optional.errorClass = args.errorClass;
		if (args.deliveredAt !== undefined) optional.deliveredAt = args.deliveredAt;

		if (!existing) {
			await ctx.db.insert('submissionDeliveryReceipts', {
				submissionId: args.submissionId,
				templateId: args.templateId,
				recipientKey: args.recipientKey,
				provider: args.provider,
				status: args.status,
				attempt: args.attempt,
				updatedAt: now,
				...optional
			});
			return;
		}

		const patch: Record<string, string | number | Id<'users'> | undefined> = {
			templateId: args.templateId,
			provider: args.provider,
			status: args.status,
			attempt: args.attempt,
			updatedAt: now,
			...optional
		};

		if (args.status === 'processing') {
			patch.providerReceiptId = undefined;
			patch.errorCode = undefined;
			patch.errorClass = undefined;
			patch.deliveredAt = undefined;
		}
		if (args.status === 'failed') {
			patch.providerReceiptId = undefined;
			patch.deliveredAt = undefined;
		}

		await ctx.db.patch(existing._id, patch);
	}
});

/**
 * Internal: Update submission verification status.
 *
 * Set to 'verified' when the delivery resolver passes all three gates (decrypt, verify,
 * reconcile). Set to 'rejected' when the resolver signals PROOF_INVALID,
 * CELL_MISMATCH, or DOMAIN_MISMATCH — any outcome where the proof itself was not
 * legitimate. Stays 'pending' for transient resolver failures so the worker can retry.
 */
/**
 * Compare-and-set claim on deliveryStatus. Transitions pending|failed →
 * processing AND increments deliveryAttempts atomically. Returns the new
 * attempt counter if the caller claimed, or null if another worker owns the
 * submission.
 *
 * Terminal writes downstream pass expectedAttempts to block stale workers
 * that resurrect after the sweep-stuck cron has already reverted them.
 *
 * Convex mutations are serializable, so this CAS is race-free.
 */
export const claimForDelivery = internalMutation({
	args: { submissionId: v.id('submissions') },
	handler: async (ctx, args): Promise<{ ok: boolean; attempts?: number }> => {
		const sub = await ctx.db.get(args.submissionId);
		if (!sub) return { ok: false };
		if (sub.deliveryStatus !== 'pending' && sub.deliveryStatus !== 'failed') {
			return { ok: false };
		}
		const attempts = (sub.deliveryAttempts ?? 0) + 1;
		await ctx.db.patch(args.submissionId, {
			deliveryStatus: 'processing',
			deliveryAttempts: attempts,
			updatedAt: Date.now()
		});
		return { ok: true, attempts };
	}
});

export const updateVerificationStatus = internalMutation({
	args: {
		submissionId: v.id('submissions'),
		verificationStatus: v.string(),
		verifiedAt: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		// Convex patch gotcha: `field: undefined` removes the field. Omit verifiedAt
		// when not passed so a 'rejected' transition doesn't wipe a prior 'verified'
		// timestamp (defensive; the current callers don't rely on this).
		const patch: Record<string, string | number> = {
			verificationStatus: args.verificationStatus,
			updatedAt: Date.now()
		};
		if (args.verifiedAt !== undefined) patch.verifiedAt = args.verifiedAt;
		await ctx.db.patch(args.submissionId, patch);
	}
});

/**
 * Internal: Update submission on-chain anchor status.
 *
 * 'pending'   — anchor in flight
 * 'anchored'  — DistrictGate contract verified the proof, txHash recorded
 * 'failed'    — transient RPC/gas failure, eligible for retry
 * 'divergent' — chain rejected a proof the TEE accepted (P0 alert, terminal)
 * 'poisoned'  — exceeded retry budget, terminal, requires operator
 */
export const updateAnchorStatus = internalMutation({
	args: {
		submissionId: v.id('submissions'),
		anchorStatus: v.string(),
		anchorTxHash: v.optional(v.string()),
		anchorAt: v.optional(v.number()),
		anchorError: v.optional(v.string()),
		anchorAttempts: v.optional(v.number()),
		anchorResultKind: v.optional(v.string()),
		/**
		 * Attempt-count CAS guard. When a worker claimed the anchor for attempt
		 * N, it passes expectedAttempts=N on every terminal write. If the stored
		 * counter has since advanced (sweep flipped to failed → retry claimed for
		 * attempt N+1), this worker's write is refused. Prevents a resurrected
		 * worker from overwriting a newer retry's terminal status.
		 *
		 * Sweeper writes omit this guard (they operate on stuck-pending rows
		 * selected by filter; Convex per-row mutation serialization is sufficient).
		 */
		expectedAttempts: v.optional(v.number())
	},
	handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
		const row = await ctx.db.get(args.submissionId);
		if (!row) return { ok: false, reason: 'not_found' };

		if (args.expectedAttempts !== undefined) {
			const current = row.anchorAttempts ?? 0;
			if (current !== args.expectedAttempts) {
				return { ok: false, reason: 'stale_attempt' };
			}
			// Tighter CAS: worker must still own the row, i.e. status is still
			// 'pending' (the claim's transient state). If the sweeper has already
			// flipped to 'failed', the worker is resurrected and must not overwrite.
			if (row.anchorStatus !== 'pending') {
				return { ok: false, reason: 'claim_released' };
			}
		}

		// Convex patch gotcha: `field: undefined` removes the field. Build patch
		// conditionally so fields we don't set are OMITTED, preserving their value.
		// Without this, anchorAttempts would be silently wiped on every update,
		// defeating MAX_ANCHOR_ATTEMPTS.
		const patch: Record<string, string | number | undefined> = {
			anchorStatus: args.anchorStatus,
			updatedAt: Date.now()
		};
		if (args.anchorTxHash !== undefined) patch.anchorTxHash = args.anchorTxHash;
		if (args.anchorAt !== undefined) patch.anchorAt = args.anchorAt;
		if (args.anchorError !== undefined) patch.anchorError = args.anchorError;
		if (args.anchorAttempts !== undefined) patch.anchorAttempts = args.anchorAttempts;
		if (args.anchorResultKind !== undefined) patch.anchorResultKind = args.anchorResultKind;
		await ctx.db.patch(args.submissionId, patch);
		return { ok: true };
	}
});

/**
 * Compare-and-set claim on anchorStatus. Returns {ok, attempts} if this
 * invocation claimed the row (undefined|failed → pending) incrementing the
 * attempt counter; returns {ok: false} if another worker already owns it
 * (pending/anchored/divergent/poisoned).
 *
 * Convex mutations are serializable so this CAS is race-free.
 */
export const claimForAnchor = internalMutation({
	args: { submissionId: v.id('submissions') },
	handler: async (ctx, args): Promise<{ ok: boolean; attempts?: number }> => {
		const sub = await ctx.db.get(args.submissionId);
		if (!sub) return { ok: false };
		const status = sub.anchorStatus;
		// Only undefined (never tried) or failed (retry-eligible) are claimable.
		if (status !== undefined && status !== 'failed') {
			return { ok: false };
		}
		const attempts = (sub.anchorAttempts ?? 0) + 1;
		await ctx.db.patch(args.submissionId, {
			anchorStatus: 'pending',
			anchorAttempts: attempts,
			updatedAt: Date.now()
		});
		return { ok: true, attempts };
	}
});

/**
 * Internal action: on-chain anchor of a verified proof.
 *
 * Runs AFTER CWC delivery succeeds. Posts the proof to DistrictGate via the
 * internal anchor-proof endpoint, which wraps the server-side relayer wallet.
 * A failure here does NOT reverse delivery — the message already reached
 * Congress. But a `divergent` response (chain says invalid when TEE said
 * valid) signals either a TEE bug, a contract bug, or a key mismatch and
 * must fire a high-severity alert.
 */
/**
 * Internal action: sweep submissions stuck in deliveryStatus='processing'.
 *
 * Runs every 2 minutes via cron. Threshold is 15 minutes — safely past the
 * Convex action timeout (~10 min) so we don't misclassify a legitimately slow
 * worker as stuck. The delivery path contains multiple external calls (TEE
 * resolve, Shadow Atlas, per-rep CWC), and a tight threshold would create
 * duplicate CWC sends under normal slow conditions.
 *
 * Revert to 'failed' so claimForDelivery can pick it up on the next retry.
 * We do NOT re-invoke deliverToCongress automatically — an operator may want
 * to investigate why it got stuck before firing a retry.
 */
export const sweepStuckProcessing = internalAction({
	args: {},
	handler: async (ctx) => {
		const STUCK_THRESHOLD_MS = 15 * 60 * 1000;
		// Sweep-cycle escalation threshold. A submission that has been swept
		// 3+ times means the underlying delivery path is broken (not just the
		// worker), so cycling `processing → failed → processing → failed`
		// indefinitely is just hiding the real failure mode. Emit a Sentry
		// alert so an operator can investigate the persistent stuck-state.
		const SWEEP_ALERT_THRESHOLD = 3;
		const cutoff = Date.now() - STUCK_THRESHOLD_MS;

		const stuck = await ctx.runQuery(internal.submissions.listStuckProcessing, {
			olderThan: cutoff
		});

		const baseUrl = process.env.CONVEX_SITE_URL ?? '';
		const internalSecret = process.env.INTERNAL_API_SECRET ?? '';
		for (const row of stuck) {
			await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
				submissionId: row._id,
				deliveryStatus: 'failed',
				deliveryError: 'worker_stuck_timeout'
			});
			// Escalate per-submission when sweep cycles repeat. `deliveryAttempts`
			// is incremented by claimForDelivery on every transition pending/failed
			// → processing, so a row at attempts >= 3 has cycled multiple times.
			// Sentry dedupes by code so a stuck-pool storm collapses to one issue.
			if (
				typeof row.deliveryAttempts === 'number' &&
				row.deliveryAttempts >= SWEEP_ALERT_THRESHOLD &&
				baseUrl &&
				internalSecret
			) {
				try {
					await fetch(`${baseUrl}/api/internal/alert`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'x-internal-secret': internalSecret,
						},
						body: JSON.stringify({
							code: 'SUBMISSION_SWEEP_REPEAT',
							message: `Submission swept ${row.deliveryAttempts}+ times — delivery path likely broken, not just the worker`,
							severity: 'warning',
							context: {
								submissionId: String(row._id),
								deliveryAttempts: row.deliveryAttempts,
								threshold: SWEEP_ALERT_THRESHOLD,
							},
						}),
						signal: AbortSignal.timeout(10_000),
					});
				} catch (err) {
					console.error(
						'[sweepStuckProcessing] sweep-repeat alert failed:',
						err instanceof Error ? err.message : String(err),
					);
				}
			}
		}

		// Same semantic for anchors that got stuck in 'pending'. Threshold safely
		// exceeds the anchor request deadline (10 min default inside /anchor-proof)
		// so a slow-but-live contract call is never racially classified as stuck
		// while the original worker is still inside verifyOnChain.
		//
		// Note: anchorAttempts was already incremented by claimForAnchor when the
		// pending transition happened, and updateAnchorStatus now preserves fields
		// it doesn't explicitly set — so the stuck attempt correctly counts toward
		// MAX_ANCHOR_ATTEMPTS without needing to re-pass the counter here.
		const ANCHOR_STUCK_MS = 15 * 60 * 1000;
		const anchorCutoff = Date.now() - ANCHOR_STUCK_MS;
		const stuckAnchors = await ctx.runQuery(internal.submissions.listStuckAnchorPending, {
			olderThan: anchorCutoff
		});
		for (const row of stuckAnchors) {
			await ctx.runMutation(internal.submissions.updateAnchorStatus, {
				submissionId: row._id,
				anchorStatus: 'failed',
				anchorError: 'anchor_worker_stuck'
			});
		}
	}
});

export const listStuckProcessing = internalQuery({
	args: { olderThan: v.number() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('submissions')
			.withIndex('by_deliveryStatus', (q) => q.eq('deliveryStatus', 'processing'))
			.filter((q) => q.lt(q.field('updatedAt'), args.olderThan))
			.take(100);
	}
});

/**
 * Internal action: retry anchors that failed with transient errors.
 *
 * Runs every 5 minutes via cron. Picks submissions with anchorStatus='failed'
 * (NOT 'divergent' — that's a forensic state requiring manual investigation)
 * and reschedules anchorProofOnChain. Includes a simple backoff by requiring
 * that the last attempt was at least 5 minutes ago.
 */
export const retryFailedAnchors = internalAction({
	args: {},
	handler: async (ctx) => {
		const RETRY_BACKOFF_MS = 5 * 60 * 1000;
		const cutoff = Date.now() - RETRY_BACKOFF_MS;

		const failed = await ctx.runQuery(internal.submissions.listFailedAnchors, {
			olderThan: cutoff
		});

		for (const row of failed) {
			await ctx.scheduler.runAfter(0, internal.submissions.anchorProofOnChain, {
				submissionId: row._id
			});
		}
	}
});

export const listFailedAnchors = internalQuery({
	args: { olderThan: v.number() },
	handler: async (ctx, args) => {
		// Only retry kinds where another attempt could change the outcome.
		//   rpc_transient       — RPC flake, retry worthwhile
		//   contract_other_revert — nullifier reuse / domain not whitelisted; might
		//                           also be a contract-state race worth one retry
		//   undefined           — legacy row from before anchorResultKind, best-effort
		//
		// Skipped:
		//   relayer_config        — env/wallet fix needed, retry burns gas on a dead path
		//   contract_invalid_proof — would have transitioned to 'divergent', not 'failed';
		//                            included defensively in case of classifier drift
		return await ctx.db
			.query('submissions')
			.withIndex('by_anchorStatus', (q) => q.eq('anchorStatus', 'failed'))
			.filter((q) =>
				q.and(
					q.lt(q.field('updatedAt'), args.olderThan),
					q.or(
						q.eq(q.field('anchorResultKind'), undefined),
						q.eq(q.field('anchorResultKind'), 'rpc_transient'),
						q.eq(q.field('anchorResultKind'), 'contract_other_revert')
					)
				)
			)
			.take(50);
	}
});

/**
 * Find submissions whose anchor is stuck in 'pending' for too long — sibling
 * of the delivery-stuck sweep but for the anchor layer. A worker that claimed
 * the anchor but died before writing a terminal status leaves the row stuck
 * in 'pending' forever; this reverts it to 'failed' so the retry cron picks
 * it up.
 */
/**
 * Operational query: list anchors in terminal P0/P1 states (divergent + poisoned).
 *
 * Divergent = chain rejected a proof the TEE accepted (crypto integrity incident).
 * Poisoned = retry budget exhausted, operator must investigate (could indicate
 * RPC degradation, misconfigured verifier, or a real divergence missed by the
 * classifier). Both states are terminal and need human review.
 *
 * Uses the by_anchorStatus index so it scales with incident cardinality, not
 * total submission count.
 */
/**
 * Paginated variant. The two incident classes are queried independently so an
 * outage of one class (e.g. 10K divergent rows from a key mismatch) doesn't
 * crowd out visibility into the other. Cursor is a JSON-encoded `{d, p}` pair
 * — one cursor per class — so a caller can page through both in lock-step.
 *
 * kind=paginate_partial semantics: when one class runs out but the other has
 * more, we keep returning pages with isDone=false until BOTH classes are done.
 * This is intentional — operators want a single "last cursor" to anchor on.
 */
export const listAnchorIncidents = query({
	args: {
		_secret: v.string(),
		limit: v.optional(v.number()),
		cursor: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const pageSize = Math.min(Math.max(args.limit ?? 50, 1), 500);

		let divCursor: string | null = null;
		let poisCursor: string | null = null;
		if (args.cursor) {
			try {
				const parsed = JSON.parse(args.cursor) as { d?: string | null; p?: string | null };
				divCursor = parsed.d ?? null;
				poisCursor = parsed.p ?? null;
			} catch {
				// Malformed cursor → treat as first page; operator can recover by
				// re-querying without cursor. Silent fallback avoids breaking dashboards
				// when the cursor format is bumped.
			}
		}

		const divergentPage = await ctx.db
			.query('submissions')
			.withIndex('by_anchorStatus', (q) => q.eq('anchorStatus', 'divergent'))
			.order('desc')
			.paginate({ numItems: pageSize, cursor: divCursor });
		const poisonedPage = await ctx.db
			.query('submissions')
			.withIndex('by_anchorStatus', (q) => q.eq('anchorStatus', 'poisoned'))
			.order('desc')
			.paginate({ numItems: pageSize, cursor: poisCursor });

		const shape = (s: {
			_id: Id<'submissions'>;
			templateId?: string;
			anchorAt?: number;
			anchorError?: string;
			anchorAttempts?: number;
			anchorResultKind?: string;
			updatedAt: number;
		}) => ({
			submissionId: s._id,
			templateId: s.templateId,
			anchorAt: s.anchorAt,
			anchorError: s.anchorError,
			anchorAttempts: s.anchorAttempts,
			anchorResultKind: s.anchorResultKind,
			updatedAt: s.updatedAt
		});

		const isDone = divergentPage.isDone && poisonedPage.isDone;
		// Always pass continueCursor through, even for an already-done class.
		// Convex returns a valid continueCursor on the final page; re-querying with
		// it yields an empty isDone=true page. If we instead nulled the cursor, the
		// next paginate() call would restart that class from the top and we'd
		// re-emit every row until the slower class also finished.
		const nextCursor = isDone
			? null
			: JSON.stringify({
					d: divergentPage.continueCursor,
					p: poisonedPage.continueCursor
				});

		return {
			divergent: divergentPage.page.map(shape),
			poisoned: poisonedPage.page.map(shape),
			isDone,
			continueCursor: nextCursor
		};
	}
});

export const listStuckAnchorPending = internalQuery({
	args: { olderThan: v.number() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('submissions')
			.withIndex('by_anchorStatus', (q) => q.eq('anchorStatus', 'pending'))
			.filter((q) => q.lt(q.field('updatedAt'), args.olderThan))
			.take(50);
	}
});

export const anchorProofOnChain = internalAction({
	args: { submissionId: v.id('submissions') },
	handler: async (ctx, args) => {
		const submission = await ctx.runQuery(internal.submissions.getById, {
			id: args.submissionId
		});
		if (!submission) return;

		// Only anchor submissions that actually reached verified+delivered state.
		// If delivery failed, there's nothing to anchor.
		if (submission.verificationStatus !== 'verified') return;

		const anchorUrl = process.env.COMMONS_INTERNAL_URL;
		const anchorSecret = process.env.INTERNAL_API_SECRET;
		if (!anchorUrl || !anchorSecret) {
			// No anchor infra configured. In prior versions we silently returned,
			// leaving anchorStatus unset — which made it impossible to distinguish
			// "not yet processed" from "env missing, will never anchor" in the DB.
			// Now we write an explicit terminal state so ops dashboards can count
			// skipped-anchor volume and alert when the rate becomes non-trivial.
			//
			// We can't fire the internal alert here (same env is missing), so fall
			// back to console.error — Convex forwards these to the runtime logs.
			const missing = [
				!anchorUrl ? 'COMMONS_INTERNAL_URL' : null,
				!anchorSecret ? 'INTERNAL_API_SECRET' : null
			]
				.filter(Boolean)
				.join(',');
			console.error(
				`[ANCHOR_SKIPPED] submissionId=${args.submissionId} — anchor infra not configured (missing: ${missing}). On-chain audit will not run for this submission.`
			);
			await ctx.runMutation(internal.submissions.updateAnchorStatus, {
				submissionId: args.submissionId,
				anchorStatus: 'skipped_missing_env',
				anchorError: `anchor_infra_not_configured:${missing}`
			});
			return;
		}

		// CAS claim the anchor slot. Increments attempts atomically. Refuses to
		// re-run if already pending/anchored/divergent/poisoned.
		const claim = await ctx.runMutation(internal.submissions.claimForAnchor, {
			submissionId: args.submissionId
		});
		if (!claim.ok) return;

		const MAX_ANCHOR_ATTEMPTS = 6;
		if ((claim.attempts ?? 0) > MAX_ANCHOR_ATTEMPTS) {
			// Terminal state: exhausted retries. Fire a Sentry alert — poisoned is
			// distinct from divergent (we don't KNOW the proof is invalid, just that
			// we can't reach a verdict) but still requires operator attention.
			const alertUrl = process.env.COMMONS_INTERNAL_URL;
			const alertSecret = process.env.INTERNAL_API_SECRET;
			if (alertUrl && alertSecret) {
				try {
					const alertResp = await fetch(`${alertUrl}/api/internal/alert`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-Internal-Secret': alertSecret
						},
						body: JSON.stringify({
							code: 'ANCHOR_POISONED',
							severity: 'error',
							message: `Anchor retries exhausted (submissionId=${args.submissionId})`,
							context: {
								submissionId: String(args.submissionId),
								attempts: claim.attempts ?? 0
							}
						})
					});
					if (!alertResp.ok) {
						const body = await alertResp.text().catch(() => '');
						console.error(
							`[submissions] Alert endpoint returned HTTP ${alertResp.status}: ${body.slice(0, 200)}`
						);
					}
				} catch (alertErr) {
					console.error('[submissions] Failed to fire alert:', alertErr);
				}
			}
			await ctx.runMutation(internal.submissions.updateAnchorStatus, {
				submissionId: args.submissionId,
				anchorStatus: 'poisoned',
				anchorError: 'max_retries_exceeded'
			});
			return;
		}

		try {
			const pi = submission.publicInputs as { publicInputsArray?: string[] } | null;
			const publicInputsArray = Array.isArray(pi?.publicInputsArray) ? pi.publicInputsArray : null;
			if (!publicInputsArray) {
				await ctx.runMutation(internal.submissions.updateAnchorStatus, {
					submissionId: args.submissionId,
					anchorStatus: 'failed',
					anchorError: 'public_inputs_array_missing',
					expectedAttempts: claim.attempts
				});
				return;
			}

			const response = await fetch(`${anchorUrl}/api/internal/anchor-proof`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Internal-Secret': anchorSecret
				},
				body: JSON.stringify({
					proof: submission.proofHex,
					publicInputs: publicInputsArray
				})
			});

			const result = await response.json().catch(() => ({}));

			const resultKind = typeof result.kind === 'string' ? result.kind : undefined;

			if (response.ok && result.success) {
				await ctx.runMutation(internal.submissions.updateAnchorStatus, {
					submissionId: args.submissionId,
					anchorStatus: 'anchored',
					anchorTxHash: typeof result.txHash === 'string' ? result.txHash : undefined,
					anchorAt: Date.now(),
					anchorResultKind: resultKind,
					expectedAttempts: claim.attempts
				});
				return;
			}

			// Divergent: chain says invalid proof, but TEE accepted it. This must
			// never happen in a correct implementation. Fire a Sentry alert via the
			// internal alert endpoint — console.error alone is too easy to miss.
			if (result.divergent === true) {
				console.error(
					`[ANCHOR_DIVERGENT] submission=${args.submissionId} — TEE accepted proof that chain rejected. Investigate TEE/contract/key mismatch.`
				);
				// Non-blocking fire-and-forget — if Sentry is down, the console log
				// above is the fallback breadcrumb, and anchorStatus='divergent' in
				// the DB is durable.
				try {
					const alertResp = await fetch(`${anchorUrl}/api/internal/alert`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-Internal-Secret': anchorSecret
						},
						body: JSON.stringify({
							code: 'ANCHOR_DIVERGENT',
							severity: 'fatal',
							message: `TEE accepted proof that DistrictGate rejected (submissionId=${args.submissionId})`,
							context: {
								submissionId: String(args.submissionId),
								chainError:
									typeof result.error === 'string' ? result.error.slice(0, 200) : undefined
							}
						})
					});
					if (!alertResp.ok) {
						const body = await alertResp.text().catch(() => '');
						console.error(
							`[submissions] Divergence alert endpoint returned HTTP ${alertResp.status}: ${body.slice(0, 200)}`
						);
					}
				} catch (alertErr) {
					console.error('[submissions] Failed to fire divergence alert:', alertErr);
				}
				await ctx.runMutation(internal.submissions.updateAnchorStatus, {
					submissionId: args.submissionId,
					anchorStatus: 'divergent',
					anchorError: typeof result.error === 'string' ? result.error.slice(0, 200) : 'divergent',
					anchorResultKind: resultKind,
					expectedAttempts: claim.attempts
				});
				return;
			}

			// Transient failure — mark failed, may be retried by a future scheduler.
			// anchorResultKind is persisted so retryFailedAnchors can filter: only
			// rpc_transient / contract_other_revert are worth retrying. relayer_config
			// needs operator fix; no kind means malformed response (don't loop).
			await ctx.runMutation(internal.submissions.updateAnchorStatus, {
				submissionId: args.submissionId,
				anchorStatus: 'failed',
				anchorError:
					typeof result.error === 'string' ? result.error.slice(0, 200) : `http_${response.status}`,
				anchorResultKind: resultKind,
				expectedAttempts: claim.attempts
			});
		} catch (err) {
			// Network / fetch-level throw — treat as rpc_transient so the cron retries.
			await ctx.runMutation(internal.submissions.updateAnchorStatus, {
				submissionId: args.submissionId,
				anchorStatus: 'failed',
				anchorError: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
				anchorResultKind: 'rpc_transient',
				expectedAttempts: claim.attempts
			});
		}
	}
});

/**
 * Internal action: Decrypt witness → Shadow Atlas lookup → CWC submit → update status.
 *
 * Flow:
 *   1. Mark as 'processing'
 *   2. Read submission
 *   3. Resolve encrypted witness via the configured delivery resolver
 *   4. Look up reps via Shadow Atlas
 *   5. Submit to CWC
 *   6. Update status
 */
export const deliverToCongress = internalAction({
	args: { submissionId: v.id('submissions') },
	handler: async (ctx, args) => {
		// Compare-and-set lock: only claim this submission if it's currently pending
		// or failed (retry). A concurrent scheduler that already moved it to
		// processing/delivered/partial wins and this invocation exits. Prevents
		// duplicate CWC sends when the scheduler fires the same action twice.
		// claim.attempts is the attempt counter for this invocation — threaded
		// through every terminal write as expectedAttempts so a resurrected old
		// worker can't overwrite a newer retry's state.
		const claim = await ctx.runMutation(internal.submissions.claimForDelivery, {
			submissionId: args.submissionId
		});
		if (!claim.ok) {
			return;
		}
		const deliveryAttempt = claim.attempts ?? 1;

		try {
			// Read submission
			const submission = await ctx.runQuery(internal.submissions.getById, {
				id: args.submissionId
			});
			if (!submission) {
				throw new Error(`Submission not found: ${args.submissionId}`);
			}

			const template: CongressionalDeliveryTemplate | null = await ctx.runQuery(
				internal.submissions.getTemplateForDelivery,
				{
					templateId: submission.templateId
				}
			);
			if (!isCongressionalDeliveryLaunched()) {
				await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
					submissionId: args.submissionId,
					deliveryStatus: 'failed',
					deliveryError: CONGRESSIONAL_NOT_LAUNCHED,
					expectedAttempts: claim.attempts
				});
				return;
			}

			const templateError = getTemplateDeliveryError(template);
			if (templateError) {
				await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
					submissionId: args.submissionId,
					deliveryStatus: 'failed',
					deliveryError: templateError,
					expectedAttempts: claim.attempts
				});
				return;
			}

			if (submission.witnessExpiresAt && submission.witnessExpiresAt < Date.now()) {
				await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
					submissionId: args.submissionId,
					deliveryStatus: 'failed',
					deliveryError: WITNESS_EXPIRED,
					expectedAttempts: claim.attempts
				});
				return;
			}

			assertDeliverableCongressionalTemplate(template);
			const scopedChambers = getTemplateCongressionalChambers(template);
			const transport = getCongressionalTransportConfig();
			const missingTransport = missingTransportForChambers(scopedChambers, transport);
			if (missingTransport.length > 0) {
				await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
					submissionId: args.submissionId,
					deliveryStatus: 'failed',
					deliveryError: `${CONGRESSIONAL_TRANSPORT_NOT_CONFIGURED}:${missingTransport.join(',')}`,
					expectedAttempts: claim.attempts
				});
				return;
			}
			const {
				houseProxyUrl,
				houseProxyToken,
				senateBaseUrl,
				senateKey,
				senatePathPrefix,
				hasHouseConfig,
				hasSenateConfig
			} = transport;

			// Fail-closed gate: a submission already rejected (proof invalid, cell mismatch,
			// or domain mismatch on a prior attempt) must never reach CWC, even if the
			// scheduler retries. Only `pending` may proceed — pending runs the resolver.
			if (submission.verificationStatus === 'rejected') {
				await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
					submissionId: args.submissionId,
					deliveryStatus: 'failed',
					deliveryError: 'verification_rejected',
					expectedAttempts: claim.attempts
				});
				return;
			}

			// (1f) Revocation recheck at delivery enqueue. Closes the TOCTOU window
			// where a user re-verifies (rotating their credential) between the accepted
			// submission and the scheduler-dispatched delivery. If the credential that
			// issued this submission is now revoked or expired, fail the delivery.
			// Note: submissions from before the 1a rollout may have issuingCredentialId
			// undefined — those are grandfathered through until backfill/expiry.
			//
			// Stage 2.7 — we also use the issuing credential to source the canonical
			// `districtCommitment` passed to the delivery resolver for witness-to-commitment
			// binding. The lookup is folded into the same branch: both checks require
			// the same credential row, so keeping the gates adjacent lets a single
			// missing/invalid credential take one code path.
			let issuingDistrictCommitment: string | null = null;
			if (submission.issuingCredentialId) {
				const credStatus = await ctx.runQuery(internal.submissions.isCredentialActive, {
					credentialId: submission.issuingCredentialId
				});
				if (!credStatus.active) {
					await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
						submissionId: args.submissionId,
						deliveryStatus: 'failed',
						deliveryError: `credential_${credStatus.reason}`,
						expectedAttempts: claim.attempts
					});
					return;
				}
				const commitmentRow = await ctx.runQuery(
					internal.submissions.getIssuingCredentialCommitment,
					{
						credentialId: submission.issuingCredentialId
					}
				);
				if (!commitmentRow) {
					// Legacy credential pre-sponge-24, or stored without districtCommitment.
					// Stage 2.7 requires the commitment for the binding gate — fail closed
					// rather than pass the resolver an empty value that would fail-open to
					// the old behavior. User must re-verify to refresh their credential.
					await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
						submissionId: args.submissionId,
						deliveryStatus: 'failed',
						deliveryError: 'credential_commitment_missing',
						expectedAttempts: claim.attempts
					});
					return;
				}
				issuingDistrictCommitment = commitmentRow.districtCommitment;
			} else {
				// Submission predates Stage 1a issuingCredentialId wiring. Stage 2.7
				// binding requires a districtCommitment, so these can no longer deliver.
				// In practice these rows have long-since expired by credential TTL; fail
				// closed rather than silently skip the binding check.
				await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
					submissionId: args.submissionId,
					deliveryStatus: 'failed',
					deliveryError: 'credential_commitment_missing',
					expectedAttempts: claim.attempts
				});
				return;
			}

			// Resolve the encrypted delivery witness through the configured resolver.
			// Today this is LocalConstituentResolver; Nitro/TEE is the future boundary.
			const teeUrl = process.env.TEE_RESOLVER_URL;
			if (!teeUrl) {
				console.error('[submissions] TEE_RESOLVER_URL not configured');
				throw new Error('Service configuration error');
			}

			// /resolve v2 wire contract: see src/lib/server/tee/constituent-resolver.ts ResolveRequest.
			// The resolver runs three atomic gates (decrypt, verify, reconcile). Only all-pass returns
			// ConstituentData. Typed errorCode lets us surface precise failures without PII leakage.
			//
			// Stage 2.7: `expected.districtCommitment` is REQUIRED. Sourced from the
			// issuing credential above — the resolver re-hashes the decrypted witness's
			// 24 district slots and compares. A mismatch means the proof's public
			// action_domain was bound to commitment X but the witness names commitment
			// Y, which is the exact forgery shape the binding gate blocks.
			//
			// H3 — bound the fetch with AbortSignal.timeout. Without this the only
			// timeout was the 15-min worker sweep, but the witness TTL is 30 min,
			// so a hung resolver could already corrupt the retry path before any
			// orphan-cleanup ran. 30 seconds is generous: TEE crypto work runs in
			// 2–5 s normally; 30 s flags real hangs without false-positiving slow
			// networks. AbortSignal.timeout throws a DOMException with name
			// 'TimeoutError', which the catch below maps to a retryable status.
			const RESOLVER_FETCH_TIMEOUT_MS = 30_000;
			let resolveResponse: Response;
			try {
				resolveResponse = await fetch(`${teeUrl}/resolve`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						// The /resolve service is INTERNAL_API_SECRET-gated (it decrypts
						// witness data into PII). Send the shared secret so the resolver
						// is not a public oracle; an unset value yields a 503/403 from the
						// resolver and the delivery fails closed.
						...(process.env.INTERNAL_API_SECRET
							? { 'x-internal-secret': process.env.INTERNAL_API_SECRET }
							: {})
					},
					body: JSON.stringify({
						ciphertext: submission.encryptedWitness,
						nonce: submission.witnessNonce,
						ephemeralPublicKey: submission.ephemeralPublicKey,
						proof: submission.proofHex,
						publicInputs: submission.publicInputs,
						expected: {
							actionDomain: submission.actionId,
							templateId: submission.templateId,
							districtCommitment: issuingDistrictCommitment
						}
					}),
					signal: AbortSignal.timeout(RESOLVER_FETCH_TIMEOUT_MS)
				});
			} catch (err) {
				const isTimeout =
					err instanceof DOMException && err.name === 'TimeoutError';
				const reason = isTimeout
					? `resolver_timeout_${RESOLVER_FETCH_TIMEOUT_MS}ms`
					: 'resolver_network_error';
				console.error(
					`[submissions] Delivery resolver fetch failed (${reason}):`,
					err instanceof Error ? err.message : String(err)
				);
				await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
					submissionId: args.submissionId,
					deliveryStatus: 'failed',
					deliveryError: reason,
					expectedAttempts: claim.attempts
				});
				throw new Error('Delivery service unreachable — please retry');
			}

			if (!resolveResponse.ok) {
				console.error(`[submissions] Delivery resolver failed: ${resolveResponse.status}`);
				await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
					submissionId: args.submissionId,
					deliveryStatus: 'failed',
					deliveryError: `resolver_http_${resolveResponse.status}`,
					expectedAttempts: claim.attempts
				});
				throw new Error('Delivery service error — please retry');
			}

			const resolved = await resolveResponse.json();
			if (!resolved.success || !resolved.constituent) {
				// Typed errorCode (DECRYPT_FAIL | PROOF_INVALID | CELL_MISMATCH | ADDRESS_UNRESOLVABLE
				// | MISSING_FIELDS | DOMAIN_MISMATCH) is safe to persist — contains no PII.
				const errorCode =
					typeof resolved.errorCode === 'string' ? resolved.errorCode : 'RESOLVER_FAILED';
				await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
					submissionId: args.submissionId,
					deliveryStatus: 'failed',
					deliveryError: errorCode,
					expectedAttempts: claim.attempts
				});
				// Mark verification rejected for proof-invalid / cell-mismatch / domain-mismatch —
				// those indicate the proof itself was not legitimate.
				if (
					errorCode === 'PROOF_INVALID' ||
					errorCode === 'CELL_MISMATCH' ||
					errorCode === 'DOMAIN_MISMATCH'
				) {
					await ctx.runMutation(internal.submissions.updateVerificationStatus, {
						submissionId: args.submissionId,
						verificationStatus: 'rejected'
					});
				}
				throw new Error(`Resolver rejected submission: ${errorCode}`);
			}

			// All three resolver gates passed (decrypt + verify + reconcile). We do NOT set
			// verificationStatus='verified' yet — that flip happens only after at least
			// one CWC delivery succeeds, so the flag means "proof was checked AND the
			// message reached Congress." A mid-flight crash between here and delivery
			// leaves verificationStatus='pending' and a future retry re-runs the resolver
			// (idempotent — nullifier deduplication prevents double-send).

			const districtCode = resolved.constituent.congressionalDistrict;
			if (!districtCode) {
				throw new Error('No congressional_district in delivery address');
			}

			// Shadow Atlas lookup.
			// Default is the reference commons.email atlas; peer implementations
			// override via SHADOW_ATLAS_URL set in the Convex dashboard.
			// NOTE: distinct from PUBLIC_ATLAS_HOST (browser-side) — this var is
			// read at Convex action runtime; both should point at the same atlas
			// host for a coherent deployment. See docs/design/FEDERATION-DEPLOY.md.
			const saUrl = process.env.SHADOW_ATLAS_URL || 'https://atlas.commons.email';
			const saResponse = await fetch(`${saUrl}/api/officials/${districtCode}`);
			if (!saResponse.ok) {
				console.error(`[submissions] Shadow Atlas lookup failed: ${saResponse.status}`);
				throw new Error('Delivery service error — please retry');
			}
			const { officials } = await saResponse.json();
			const scopedOfficials = Array.isArray(officials)
				? officials.filter((official) => {
						const chamber = normalizeCongressionalChamber(official?.chamber);
						return chamber ? scopedChambers.has(chamber) : false;
					})
				: [];

			if (scopedOfficials.length === 0) {
				throw new Error(`No representatives found for district ${districtCode}`);
			}

			// CWC submission — chamber-split transport.
			// House: POST JSON envelope {xml, jobId, officeCode} to GCP proxy, which forwards
			// raw XML to https://cwc.house.gov/ from a whitelisted IP.
			// Senate: direct POST XML to soapbox.senate.gov. The path segment is configurable
			// via CWC_SENATE_PATH_PREFIX so prod can flip from the `testing-messages` sandbox
			// to the `messages` production inbox without a code change.

			const messageIds: string[] = [];
			const errors: string[] = [];

			// Derive ProOrCon from template delivery config. Templates may set
			// deliveryConfig.stance or .proOrCon as a string. Map common variants to CWC's
			// Pro/Con/Undecided vocabulary; if the template doesn't declare a position, omit
			// the element rather than fabricate one (the old hardcoded "Pro" was a lie).
			const dc = (template?.deliveryConfig ?? {}) as Record<string, unknown>;
			const rawStance = (typeof dc.proOrCon === 'string' ? dc.proOrCon : dc.stance) as
				| string
				| undefined;
			const proOrCon: 'Pro' | 'Con' | 'Undecided' | undefined =
				rawStance === 'Pro' || rawStance === 'SUPPORT' || rawStance === 'support'
					? 'Pro'
					: rawStance === 'Con' || rawStance === 'OPPOSE' || rawStance === 'oppose'
						? 'Con'
						: rawStance === 'Undecided' || rawStance === 'AMEND' || rawStance === 'amend'
							? 'Undecided'
							: undefined;

			for (const official of scopedOfficials) {
				const receiptBase = deliveryReceiptBase(official, submission, deliveryAttempt);
				try {
					await ctx.runMutation(internal.submissions.recordDeliveryReceipt, {
						...receiptBase,
						status: 'processing'
					});

					const cwcXml = CWCXmlGenerator.generateUserAdvocacyXML({
						template: {
							id: String(submission.templateId),
							title: template?.title || 'Constituent Message',
							description: template?.description || '',
							message_body: template?.messageBody || template?.description || '',
							delivery_config: template?.deliveryConfig ?? {}
						},
						user: {
							id: String(args.submissionId),
							name: resolved.constituent.name,
							email: resolved.constituent.email,
							phone: resolved.constituent.phone,
							address: resolved.constituent.address,
							representatives: { house: official, senate: [] }
						},
						_targetRep: official,
						proOrCon
					});

					const validation = CWCXmlGenerator.validateXML(cwcXml);
					if (!validation.valid) {
						errors.push(`${official.name}: XML invalid — ${validation.errors.join('; ')}`);
						await ctx.runMutation(internal.submissions.recordDeliveryReceipt, {
							...receiptBase,
							status: 'failed',
							errorCode: 'XML_INVALID',
							errorClass: 'validation'
						});
						continue;
					}

					const jobId = `${String(args.submissionId).slice(0, 16)}-${official.bioguideId || official.officeCode}`;
					const officeCode = CWCXmlGenerator.generateOfficeCode(official);

					let cwcResponse: Response;
					if (official.chamber === 'house') {
						if (!hasHouseConfig) {
							errors.push(`${official.name}: House proxy not configured`);
							await ctx.runMutation(internal.submissions.recordDeliveryReceipt, {
								...receiptBase,
								status: 'failed',
								errorCode: 'HOUSE_PROXY_NOT_CONFIGURED',
								errorClass: 'configuration'
							});
							continue;
						}
						cwcResponse = await fetch(`${houseProxyUrl}/api/house/submit`, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								Authorization: `Bearer ${houseProxyToken}`,
								'X-Request-Id': jobId
							},
							body: JSON.stringify({ xml: cwcXml, jobId, officeCode })
						});
					} else {
						if (!hasSenateConfig) {
							errors.push(`${official.name}: Senate API not configured`);
							await ctx.runMutation(internal.submissions.recordDeliveryReceipt, {
								...receiptBase,
								status: 'failed',
								errorCode: 'SENATE_API_NOT_CONFIGURED',
								errorClass: 'configuration'
							});
							continue;
						}
						cwcResponse = await fetch(`${senateBaseUrl}/${senatePathPrefix}/${officeCode}`, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/xml',
								'X-API-Key': senateKey as string
							},
							body: cwcXml
						});
					}

					if (cwcResponse.ok) {
						const result = await cwcResponse.json().catch(() => ({}));
						const msgId = String(result.messageId || result.submissionId || jobId);
						messageIds.push(msgId);
						await ctx.runMutation(internal.submissions.recordDeliveryReceipt, {
							...receiptBase,
							providerReceiptId: msgId,
							status: 'delivered',
							deliveredAt: Date.now()
						});
					} else {
						// Intentionally do NOT echo upstream response body into `deliveryError`.
						// House/Senate failure responses can embed the submitted XML (including the
						// constituent's street, name, email) and `deliveryError` persists durably
						// to Convex. Only the status code is safe to keep.
						errors.push(`${official.name}: HTTP ${cwcResponse.status}`);
						await ctx.runMutation(internal.submissions.recordDeliveryReceipt, {
							...receiptBase,
							status: 'failed',
							errorCode: `HTTP_${cwcResponse.status}`,
							errorClass: 'provider_http'
						});
					}
				} catch (err) {
					errors.push(`${official.name}: delivery exception`);
					await ctx.runMutation(internal.submissions.recordDeliveryReceipt, {
						...receiptBase,
						status: 'failed',
						errorCode: 'DELIVERY_EXCEPTION',
						errorClass: err instanceof Error ? err.name.slice(0, 80) : 'unknown'
					});
				}
			}

			const anySuccess = messageIds.length > 0;
			const hasErrors = errors.length > 0;
			// "partial" means at least one rep got the message AND at least one failed.
			// "delivered" means every attempted rep succeeded. "failed" means none did.
			const deliveryStatus: 'delivered' | 'partial' | 'failed' = !anySuccess
				? 'failed'
				: hasErrors
					? 'partial'
					: 'delivered';

			await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
				submissionId: args.submissionId,
				deliveryStatus,
				cwcSubmissionId: messageIds.length > 0 ? messageIds.join(',') : undefined,
				deliveredAt: anySuccess ? Date.now() : undefined,
				deliveryError: hasErrors ? errors.join('; ') : undefined,
				expectedAttempts: claim.attempts
			});

			// Flip verificationStatus to 'verified' only now, once at least one rep has
			// actually received the message. This keeps the flag honest: a submission
			// with verificationStatus='verified' means proof AND delivery both landed.
			// A mid-flight failure leaves it 'pending' for idempotent retry.
			if (anySuccess) {
				await ctx.runMutation(internal.submissions.updateVerificationStatus, {
					submissionId: args.submissionId,
					verificationStatus: 'verified',
					verifiedAt: Date.now()
				});

				// Async on-chain anchor (AR.3). Non-blocking — delivery is already done.
				// Divergence between TEE and chain fires a P0 alert via [ANCHOR_DIVERGENT]
				// log pattern.
				await ctx.scheduler.runAfter(0, internal.submissions.anchorProofOnChain, {
					submissionId: args.submissionId
				});
			}

			// On any successful delivery, persist district + increment template reach +
			// emit the attributed campaignAction (cross-channel ledger).
			// Wrapped in own try/catch: counter/attribution failures must never revert
			// delivery status. anySuccess means at least one chamber actually received
			// the message — so partial deliveries (e.g. House ok / Senate fail) still
			// attribute, and a fully-failed delivery emits nothing.
			if (anySuccess) {
				try {
					await ctx.runMutation(internal.submissions.updateResolvedDistrict, {
						submissionId: args.submissionId,
						districtCode
					});
					await ctx.runMutation(internal.submissions.incrementTemplateReach, {
						templateId: submission.templateId,
						districtCode,
						verifiedAt: Date.now(),
						trustTier: submission.trustTier
					});
					// Cross-channel attribution: write a campaignActions row through the
					// shared counter-maintaining create path so congressional actions
					// land in the same ledger as org email/form actions. No-op when the
					// template isn't owned by a campaign (person-layer unaffiliated send).
					await ctx.runMutation(internal.submissions.emitCongressionalAction, {
						submissionId: args.submissionId,
						templateId: submission.templateId,
						districtCode,
						trustTier: submission.trustTier,
						// Carry the chamber-rollup so the attributed action records
						// partial-vs-full delivery. anySuccess guards this block, so
						// deliveryStatus is 'delivered' or 'partial' here, never 'failed'.
						deliveryStatus: deliveryStatus === 'partial' ? 'partial' : 'delivered'
					});
				} catch (counterErr) {
					console.error(
						'[deliverToCongress] Counter/attribution update failed (delivery unaffected):',
						counterErr
					);
				}
			}
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : 'Unknown error';
			console.error('[deliverToCongress] Fatal error:', errorMsg);

			await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
				submissionId: args.submissionId,
				deliveryStatus: 'failed',
				deliveryError: errorMsg,
				expectedAttempts: claim.attempts
			});
		}
	}
});

/**
 * Internal action: Register engagement in Shadow Atlas (Tree 3).
 */
export const registerEngagement = internalAction({
	args: { userSubject: v.string() },
	handler: async (ctx, args) => {
		try {
			// Look up user's wallet + identity commitment
			// userSubject is the auth token subject — need to find user by email
			// Default is the reference commons.email atlas; peer implementations
			// override via SHADOW_ATLAS_URL set in the Convex dashboard.
			// NOTE: distinct from PUBLIC_ATLAS_HOST (browser-side) — this var is
			// read at Convex action runtime; both should point at the same atlas
			// host for a coherent deployment. See docs/design/FEDERATION-DEPLOY.md.
			const saUrl = process.env.SHADOW_ATLAS_URL || 'https://atlas.commons.email';

			// This is fire-and-forget — failures are logged but don't block
			const response = await fetch(`${saUrl}/api/engagement/register`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userSubject: args.userSubject })
			});

			if (!response.ok) {
				console.warn('[registerEngagement] Shadow Atlas returned:', response.status);
			}
		} catch (err) {
			console.error('[registerEngagement] Failed:', err);
		}
	}
});

// promoteTier removed: it escalated trust tier unconditionally. Any
// re-implementation must gate on verificationStatus === 'verified'.

/**
 * Internal mutation: Persist the resolved congressional district on a submission.
 * Called from deliverToCongress after TEE resolve returns districtCode.
 */
export const updateResolvedDistrict = internalMutation({
	args: {
		submissionId: v.id('submissions'),
		districtCode: v.string()
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.submissionId, {
			resolvedDistrict: args.districtCode
		});
	}
});

/**
 * Internal mutation: Increment template civic reach counters after delivery.
 *
 * - verifiedSends: always +1
 * - uniqueDistricts: +1 only if districtCode is new for this template
 * - deliveredDistricts: bounded array (max 435 congressional districts)
 *
 * Non-throwing: counter failures must never break the delivery path.
 */
export const incrementTemplateReach = internalMutation({
	args: {
		templateId: v.string(),
		districtCode: v.string(),
		verifiedAt: v.optional(v.number()),
		trustTier: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const DAILY_WINDOW = 30;
		const DISTRICT_CAP = 500;
		const dayMs = 86400000;

		// Resolve template by slug (same pattern as getTemplateForDelivery)
		const template = await ctx.db
			.query('templates')
			.withIndex('by_slug', (q) => q.eq('slug', args.templateId))
			.first();

		if (!template) {
			console.warn(`[incrementTemplateReach] Template not found: ${args.templateId}`);
			return;
		}

		// Reach counter: union of districts that have ever delivered, plus a count.
		const districts = template.deliveredDistricts ?? [];
		const isNewDistrict = !districts.includes(args.districtCode);
		const shouldTrackDistrict = isNewDistrict && districts.length < DISTRICT_CAP;
		const newDistricts = shouldTrackDistrict ? [...districts, args.districtCode] : districts;

		// Daily arrival rhythm: rolling 30-day window, oldest first. The last
		// bucket is always the current day; older buckets shift left as days roll.
		const verifiedAt = args.verifiedAt ?? Date.now();
		const day = Math.floor(verifiedAt / dayMs) * dayMs;
		let dailyArrivals = template.dailyArrivals ?? new Array(DAILY_WINDOW).fill(0);
		if (dailyArrivals.length !== DAILY_WINDOW) {
			dailyArrivals = new Array(DAILY_WINDOW).fill(0);
		}
		const lastDay = template.dailyArrivalsLastDay ?? day;
		let newLastDay = lastDay;
		if (day === lastDay) {
			dailyArrivals[DAILY_WINDOW - 1]++;
		} else if (day > lastDay) {
			const daysToShift = Math.min(DAILY_WINDOW, Math.floor((day - lastDay) / dayMs));
			dailyArrivals = [
				...dailyArrivals.slice(daysToShift),
				...new Array(daysToShift).fill(0)
			];
			dailyArrivals[DAILY_WINDOW - 1]++;
			newLastDay = day;
		}
		// else day < lastDay: out-of-order verifiedAt; drop the temporal update.

		// Per-district counts: capped at DISTRICT_CAP. Read-time consumers
		// (TemplateList per-row Ratio, hero Ratio) sort and truncate.
		let districtCounts = template.districtCounts ?? [];
		const dcIdx = districtCounts.findIndex((d) => d.code === args.districtCode);
		if (dcIdx >= 0) {
			const updated = { code: args.districtCode, count: districtCounts[dcIdx].count + 1 };
			districtCounts = [
				...districtCounts.slice(0, dcIdx),
				updated,
				...districtCounts.slice(dcIdx + 1)
			];
		} else if (districtCounts.length < DISTRICT_CAP) {
			districtCounts = [...districtCounts, { code: args.districtCode, count: 1 }];
		}

		// Trust-tier breakdown: 6 buckets, index = tier 0-5.
		let tierCounts = template.tierCounts ?? [0, 0, 0, 0, 0, 0];
		if (tierCounts.length !== 6) {
			tierCounts = [0, 0, 0, 0, 0, 0];
		}
		if (args.trustTier !== undefined && args.trustTier >= 0 && args.trustTier <= 5) {
			tierCounts = [...tierCounts];
			tierCounts[args.trustTier]++;
		}

		await ctx.db.patch(template._id, {
			verifiedSends: (template.verifiedSends || 0) + 1,
			dailyArrivals,
			dailyArrivalsLastDay: newLastDay,
			districtCounts,
			tierCounts,
			...(shouldTrackDistrict
				? {
						deliveredDistricts: newDistricts,
						uniqueDistricts: newDistricts.length
					}
				: {})
		});
	}
});

/**
 * Internal mutation: emit an attributed campaignAction for a successful
 * congressional (CWC) delivery.
 *
 * Closes the disjoint-ledger split: before this, a successful congressional
 * delivery wrote ONLY templates.verifiedSends, so congressional actions and
 * org email/form actions lived in two separate tallies. Here we ALSO write a
 * campaignActions row with channel='congressional' carrying the action's
 * trustTier (the assurance level — a tier-4 gov-ID action is distinguishable
 * for higher-assurance badging from a tier-2 address-verified action) and
 * verified=true (delivery landed). The write reuses campaigns.createCampaignAction
 * so the SAME path that maintains campaign counters, verifiedActionsLifetime,
 * actionTierCounts, and tier3VerifiedActionCount runs — no separate counter
 * site to drift.
 *
 * Attribution requires a campaign that owns the delivered template. Person-layer
 * congressional sends against an unaffiliated public template have no campaign
 * to attribute to; those still bump templates.verifiedSends (unchanged) but emit
 * no campaignAction. Only org-authored congressional campaigns (campaigns.templateId)
 * land in the org ledger.
 *
 * Dedup is on (campaignId, congressionalSubmissionId) inside createCampaignAction,
 * so an idempotent delivery retry never double-counts. Non-throwing: like the
 * verifiedSends counter, attribution failures must never affect delivery status —
 * the caller wraps this in the same counter try/catch.
 */
export const emitCongressionalAction = internalMutation({
	args: {
		submissionId: v.id('submissions'),
		templateId: v.string(),
		districtCode: v.optional(v.string()),
		trustTier: v.optional(v.number()),
		// Delivery rollup for this submission: 'delivered' = every targeted
		// chamber received the message; 'partial' = at least one chamber delivered
		// AND at least one failed. The emit only fires on any-success, so 'failed'
		// never reaches here. Carried onto the attributed action so the org ledger
		// distinguishes full from partial delivery instead of overclaiming.
		deliveryStatus: v.optional(v.union(v.literal('delivered'), v.literal('partial')))
	},
	handler: async (
		ctx,
		args
	): Promise<
		| { attributed: false; reason: 'template_not_found' | 'no_campaign' | 'cross_org' }
		| { attributed: true; alreadySubmitted: boolean }
	> => {
		// Resolve the delivered template to a templates._id. Submissions carry
		// either the Convex id or a slug (mirrors getTemplateForDelivery).
		const normalizedTemplateId = (ctx.db as any).normalizeId?.(
			'templates',
			args.templateId
		) as Id<'templates'> | null | undefined;
		const template =
			(normalizedTemplateId ? await ctx.db.get(normalizedTemplateId) : null) ??
			(await ctx.db
				.query('templates')
				.withIndex('by_slug', (q) => q.eq('slug', args.templateId))
				.first());
		if (!template) {
			return { attributed: false, reason: 'template_not_found' as const };
		}

		// Find the campaign that owns this template. Org-authored congressional
		// campaigns set campaigns.templateId; person-layer sends against an
		// unaffiliated public template have none.
		//
		// Defense-in-depth org-scope: only attribute to a campaign whose orgId
		// matches the TEMPLATE's orgId. campaigns.create/update enforce template
		// ownership at link time, but a stale cross-org link (or a future bypass)
		// must not let Org B's congressional campaign siphon Org A's constituent
		// actions — which would also leak A's districtHash/districtCode/trustTier
		// via the campaign_action.created webhook. We verify the match rather than
		// blindly taking .first() across orgs; if none matches, no-op the
		// attribution (delivery + verifiedSends are unaffected upstream).
		const linkedCampaigns = await ctx.db
			.query('campaigns')
			.withIndex('by_templateId', (q) => q.eq('templateId', template._id))
			.collect();
		const campaign = linkedCampaigns.find((c) => c.orgId === template.orgId) ?? null;
		if (!campaign) {
			// Distinguish "no campaign at all" from "only cross-org link(s) exist"
			// so the reason is diagnosable, but both no-op the attribution.
			return {
				attributed: false,
				reason: linkedCampaigns.length > 0 ? ('cross_org' as const) : ('no_campaign' as const)
			};
		}

		// Reuse the shared counter-maintaining create path. channel='congressional'
		// + verified=true; trustTier carries the assurance level for badging. No
		// supporterId (constituent PII is never custodied for congressional sends);
		// dedup keys on congressionalSubmissionId instead. engagementTier defaults
		// to 0 — congressional submissions don't carry an engagement tier, and the
		// org actionTierCounts histogram only buckets 0-4 engagement tiers.
		const result = await ctx.runMutation(internal.campaigns.createCampaignAction, {
			campaignId: campaign._id,
			verified: true,
			engagementTier: 0,
			districtCode: args.districtCode,
			trustTier: args.trustTier,
			channel: 'congressional',
			congressionalSubmissionId: args.submissionId,
			// Person-layer civic action — a constituent contacting their own rep.
			// Attribute it (campaign + org tier histogram) but do NOT consume the
			// org's metered billing quota; metering congressional sends would let an
			// external attacker exhaust a victim org's verified-action quota via its
			// public template. The crypto gates + recipientSubdivision bound limit abuse.
			metersOrgQuota: false,
			// Carry whether every targeted chamber actually delivered. A House-ok /
			// Senate-fail rollup must not be ledgered as a full delivery.
			deliveryStatus: args.deliveryStatus
		});

		return { attributed: true, alreadySubmitted: result.alreadySubmitted === true };
	}
});

/**
 * Internal query: Get submission by ID (for delivery worker).
 */
export const getById = internalQuery({
	args: { id: v.id('submissions') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.id);
	}
});

/**
 * Internal query: Get template fields needed for CWC delivery.
 */
export const getTemplateForDelivery = internalQuery({
	args: { templateId: v.string() },
	handler: async (ctx, args) => {
		// Submissions may carry the Convex template id from UI DTOs or a slug
		// from older clients. Support both, then apply delivery policy at caller.
		const normalizedTemplateId = (ctx.db as any).normalizeId?.(
			'templates',
			args.templateId
		) as Id<'templates'> | null | undefined;
		const byId = normalizedTemplateId ? await ctx.db.get(normalizedTemplateId) : null;
		const results =
			byId ??
			(await ctx.db
				.query('templates')
				.withIndex('by_slug', (q) => q.eq('slug', args.templateId))
				.first());

		if (results) {
			return {
				title: results.title,
				description: results.description,
				messageBody: results.messageBody ?? '',
				deliveryMethod: results.deliveryMethod,
				status: results.status,
				isPublic: results.isPublic,
				orgId: results.orgId ?? null,
				deliveryConfig: results.deliveryConfig ?? {},
				recipientConfig: results.recipientConfig ?? {}
			};
		}

		return null;
	}
});

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Compute pseudonymous ID via HMAC-SHA256 to break link between
 * authenticated identity and on-chain proof submission.
 */
async function computePseudonymousId(userId: string): Promise<string> {
	const salt = process.env.PSEUDONYMOUS_ID_SALT;
	if (!salt) {
		console.error('[submissions] PSEUDONYMOUS_ID_SALT not configured');
		throw new Error('Service configuration error');
	}
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(salt),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(userId));
	return Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

type DeliveryOfficial = Record<string, unknown>;

function officialString(official: DeliveryOfficial, key: string): string | undefined {
	const value = official[key];
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function deliveryRecipientKey(official: DeliveryOfficial): string {
	const chamber = officialString(official, 'chamber') ?? 'unknown';
	const stableId =
		officialString(official, 'bioguideId') ??
		officialString(official, 'officeCode') ??
		officialString(official, 'id') ??
		officialString(official, 'name') ??
		'unknown';
	return `${chamber}:${stableId}`.slice(0, 160);
}

function deliveryProvider(official: DeliveryOfficial): 'house_cwc' | 'senate_cwc' {
	return officialString(official, 'chamber') === 'house' ? 'house_cwc' : 'senate_cwc';
}

function deliveryReceiptBase(
	official: DeliveryOfficial,
	submission: {
		_id: Id<'submissions'>;
		templateId: string;
		pseudonymousId: string;
	},
	attempt: number
) {
	return {
		submissionId: submission._id,
		templateId: submission.templateId,
		pseudonymousId: submission.pseudonymousId,
		recipientKey: deliveryRecipientKey(official),
		recipientName: officialString(official, 'name'),
		recipientDistrict: officialString(official, 'district'),
		chamber: officialString(official, 'chamber'),
		provider: deliveryProvider(official),
		attempt
	};
}

function deliveryProviderReceiptId(submissionId: Id<'submissions'>, recipientKey: string): string {
	const safeRecipient = recipientKey.replace(/[^a-zA-Z0-9_-]/g, '-').slice(-40);
	return `demo-${String(submissionId).slice(0, 8)}-${safeRecipient}`;
}

// =============================================================================
// CRON STUBS — internal mutations called by convex/crons.ts
// =============================================================================

/**
 * Cleanup expired witnesses: NULL out encrypted_witness, witness_nonce,
 * ephemeral_public_key for submissions where witness has expired.
 * Called daily at 01:00 UTC by cron.
 */
export const cleanupExpiredWitnesses = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();

		// Find submissions with expired witnesses
		const expired = await ctx.db
			.query('submissions')
			.withIndex('by_witnessExpiresAt')
			.order('asc')
			.take(500);

		let cleaned = 0;
		for (const sub of expired) {
			if (sub.witnessExpiresAt && sub.witnessExpiresAt < now && sub.encryptedWitness) {
				await ctx.db.patch(sub._id, {
					encryptedWitness: '',
					witnessNonce: undefined,
					ephemeralPublicKey: undefined
				});
				cleaned++;
			} else if (!sub.witnessExpiresAt || sub.witnessExpiresAt >= now) {
				break; // sorted ascending, done
			}
		}

		console.log(`[cleanup-witness] Cleaned ${cleaned} expired witness records`);
		return { cleaned };
	}
});

/**
 * Get submission by ID (public query — used for retry ownership check).
 * Returns minimal fields only.
 */
export const getPublicById = query({
	args: { submissionId: v.id('submissions') },
	handler: async (ctx, { submissionId }) => {
		const sub = await ctx.db.get(submissionId);
		if (!sub) return null;
		return {
			_id: sub._id,
			pseudonymousId: sub.pseudonymousId,
			deliveryStatus: sub.deliveryStatus
		};
	}
});

/**
 * Aggregate verified-submission stats for the homepage hero region.
 *
 * One scan over the `by_verificationStatus` index returns three derived
 * shapes — total count, daily-bucketed arrival rhythm, and top-district
 * composition — so SSR makes one round trip instead of three. Each
 * submission counted here is anchored on-chain individually
 * (`anchorTxHash` + `blockNumber`); the aggregate is publicly verifiable
 * by re-running the same scan.
 *
 * District composition uses k-anonymity: districts with fewer than
 * `K_ANON_THRESHOLD` verified sends in the window are folded into
 * `otherCount` rather than disclosed individually. Districts above the
 * threshold but outside the top N also fold into `otherCount`.
 */
export const aggregateForHero = query({
	args: {
		windowDays: v.optional(v.number()),
		topDistrictCount: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const windowDays = args.windowDays ?? 30;
		const topN = args.topDistrictCount ?? 6;
		const dayMs = 86400000;
		const now = Date.now();
		const windowStart = now - windowDays * dayMs;
		const K_ANON_THRESHOLD = 5;

		// Range scan on verifiedAt within the verified status — bounded to
		// the rolling window. Avoids the full-table scan that the prior
		// `by_verificationStatus.collect()` triggered on every homepage SSR.
		const verifiedSubs = await ctx.db
			.query('submissions')
			.withIndex('by_verificationStatus_verifiedAt', (q) =>
				q.eq('verificationStatus', 'verified').gte('verifiedAt', windowStart)
			)
			.collect();

		let count = 0;
		const buckets: number[] = new Array(windowDays).fill(0);
		const districtCounts = new Map<string, number>();
		const tierCounts: number[] = [0, 0, 0, 0, 0, 0];

		for (const s of verifiedSubs) {
			if (s.verifiedAt === undefined) continue;
			count++;
			const dayIndex = Math.floor((s.verifiedAt - windowStart) / dayMs);
			if (dayIndex >= 0 && dayIndex < windowDays) {
				buckets[dayIndex]++;
			}
			if (s.resolvedDistrict) {
				districtCounts.set(
					s.resolvedDistrict,
					(districtCounts.get(s.resolvedDistrict) ?? 0) + 1
				);
			}
			if (s.trustTier !== undefined && s.trustTier >= 0 && s.trustTier <= 5) {
				tierCounts[s.trustTier]++;
			}
		}

		// Districts: split the leftover bucket into k-anon-suppressed (privacy
		// floor) vs display-truncated (top-N cap). Same merged shape downstream
		// for compactness, but caller can render the two semantics distinctly.
		const sorted = [...districtCounts.entries()].sort((a, b) => b[1] - a[1]);
		const topDistricts: Array<{ code: string; count: number }> = [];
		let belowThresholdCount = 0;
		let displayTruncationCount = 0;
		for (const [code, c] of sorted) {
			if (c < K_ANON_THRESHOLD) {
				belowThresholdCount += c;
			} else if (topDistricts.length < topN) {
				topDistricts.push({ code, count: c });
			} else {
				displayTruncationCount += c;
			}
		}

		// Tiers: apply the same k-anon floor. A single tier-5 user under a
		// thin cohort would otherwise reveal a tier-5 presence to anyone
		// viewing the homepage. Counts below threshold collapse to 0 in the
		// returned shape; the suppressed mass is reflected via `count` minus
		// the sum of revealed tiers (caller can compute the gap if needed).
		const tierBreakdown = tierCounts.map((c, tier) => ({
			tier,
			count: c < K_ANON_THRESHOLD ? 0 : c
		}));

		return {
			count,
			windowDays,
			windowStart,
			windowEnd: now,
			buckets,
			topDistricts,
			belowThresholdCount,
			displayTruncationCount,
			otherCount: belowThresholdCount + displayTruncationCount,
			totalDistricts: districtCounts.size,
			tierBreakdown,
			kAnonymityThreshold: K_ANON_THRESHOLD
		};
	}
});

/**
 * Retry a failed submission — reset delivery status to pending
 * and re-trigger the delivery pipeline.
 */
export const retryDelivery = action({
	args: { submissionId: v.id('submissions') },
	handler: async (ctx, { submissionId }) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error('Authentication required');
		assertCongressionalDeliveryLaunched();

		const sub = await ctx.runQuery(internal.submissions.getById, { id: submissionId });
		if (!sub) throw new Error('Submission not found');

		// Verify ownership via pseudonymous ID
		const callerPseudoId = await computePseudonymousId(identity.subject);
		if (sub.pseudonymousId !== callerPseudoId) {
			throw new Error('Access denied');
		}

		if (sub.deliveryStatus !== 'failed') {
			throw new Error('Submission is not in a retryable state');
		}

		// Cap retries to prevent the public retry endpoint from
		// amplifying one submit into repeated provider deliveries. If an upstream
		// CWC request throws after acceptance but before a receipt is recorded,
		// the catch path records `failed` and a caller could retry indefinitely.
		// `claimForDelivery` increments `deliveryAttempts` atomically (see :621);
		// at 5 the submission is permanently failed and requires operator
		// intervention. Cap matches the sweep-stuck escalation threshold curve
		// (SWEEP_ALERT_THRESHOLD = 3 alerts; MAX = 5 hard-stops) so on-call has
		// 2 sweep cycles of warning before the hard cap fires.
		const MAX_RETRY_ATTEMPTS = 5;
		const attempts = sub.deliveryAttempts ?? 0;
		if (attempts >= MAX_RETRY_ATTEMPTS) {
			throw new Error('MAX_RETRIES_EXCEEDED');
		}

		// Reset status
		await ctx.runMutation(internal.submissions.updateDeliveryStatus, {
			submissionId,
			deliveryStatus: 'pending'
		});

		// Re-trigger delivery
		await ctx.scheduler.runAfter(0, internal.submissions.deliverToCongress, {
			submissionId
		});

		return { status: 'retrying' };
	}
});

// =============================================================================
// BACKFILL — denormalize trustTier onto submissions; derive per-template
// dimensional aggregates (dailyArrivals / districtCounts / tierCounts) from
// historical submissions. One-shot operations invoked at deployment time.
// =============================================================================

/**
 * Internal: paginated user list for trustTier backfill driver.
 *
 * Returns only users with a tokenIdentifier (the input to computePseudonymousId).
 * Users without one have no submissions to backfill.
 */
export const _listUsersForTrustTierBackfill = internalQuery({
	args: { paginationCursor: v.optional(v.string()), limit: v.number() },
	handler: async (ctx, { paginationCursor, limit }) => {
		const result = await ctx.db
			.query('users')
			.paginate({ numItems: limit, cursor: (paginationCursor ?? null) as any });
		return {
			items: result.page
				.filter((u) => u.tokenIdentifier !== undefined)
				.map((u) => ({
					_id: u._id,
					tokenIdentifier: u.tokenIdentifier as string,
					trustTier: u.trustTier
				})),
			continueCursor: result.continueCursor,
			isDone: result.isDone
		};
	}
});

/**
 * Internal: patch every submission for one pseudonymousId with the user's
 * trustTier. Called once per user during backfill. Idempotent — only writes
 * to rows where trustTier is currently undefined.
 */
export const _patchTrustTierForPseudonymousId = internalMutation({
	args: {
		pseudonymousId: v.string(),
		trustTier: v.number()
	},
	handler: async (ctx, { pseudonymousId, trustTier }) => {
		const subs = await ctx.db
			.query('submissions')
			.withIndex('by_pseudonymousId', (q) => q.eq('pseudonymousId', pseudonymousId))
			.collect();
		let patched = 0;
		for (const s of subs) {
			if (s.trustTier === undefined) {
				await ctx.db.patch(s._id, { trustTier });
				patched++;
			}
		}
		return { patched };
	}
});

/**
 * Backfill trustTier on existing submissions.
 *
 * Walks the users table page-by-page, computes each user's pseudonymousId,
 * and patches their submissions. Pseudonymous IDs are HMAC of tokenIdentifier;
 * the HMAC is irreversible, so the only path to backfill is forward from the
 * user side.
 *
 * Run once at deployment time after the schema field lands. Subsequent
 * submissions populate trustTier at insert time via insertSubmission.
 */
export const backfillSubmissionTrustTier = internalAction({
	args: { batchSize: v.optional(v.number()) },
	handler: async (ctx, { batchSize }): Promise<{ usersProcessed: number; submissionsPatched: number; failed: number }> => {
		const limit = batchSize ?? 100;
		let usersProcessed = 0;
		let submissionsPatched = 0;
		let failed = 0;
		let isDone = false;
		let paginationCursor: string | undefined;

		while (!isDone) {
			const batch: { items: Array<{ _id: Id<'users'>; tokenIdentifier: string; trustTier: number }>; continueCursor: string; isDone: boolean } = await ctx.runQuery(
				internal.submissions._listUsersForTrustTierBackfill,
				{ paginationCursor, limit }
			);
			isDone = batch.isDone;
			paginationCursor = batch.continueCursor;

			for (const u of batch.items) {
				try {
					const pid = await computePseudonymousId(u.tokenIdentifier);
					const result: { patched: number } = await ctx.runMutation(
						internal.submissions._patchTrustTierForPseudonymousId,
						{ pseudonymousId: pid, trustTier: u.trustTier }
					);
					submissionsPatched += result.patched;
					usersProcessed++;
				} catch (err) {
					console.error(`[backfillSubmissionTrustTier] Failed user ${u._id}:`, err);
					failed++;
				}
			}
		}

		return { usersProcessed, submissionsPatched, failed };
	}
});

/**
 * Internal: paginated template list for aggregate backfill driver.
 *
 * Filters to templates with at least one verified send AND missing at least
 * one of the new dimensional fields. Empty templates and already-backfilled
 * templates are skipped.
 */
export const _listTemplatesForAggregateBackfill = internalQuery({
	args: { paginationCursor: v.optional(v.string()), limit: v.number() },
	handler: async (ctx, { paginationCursor, limit }) => {
		const result = await ctx.db
			.query('templates')
			.paginate({ numItems: limit, cursor: (paginationCursor ?? null) as any });
		return {
			items: result.page
				.filter((t) => (t.verifiedSends ?? 0) > 0)
				.filter(
					(t) =>
						t.dailyArrivals === undefined ||
						t.districtCounts === undefined ||
						t.tierCounts === undefined
				)
				.map((t) => ({ _id: t._id, slug: t.slug })),
			continueCursor: result.continueCursor,
			isDone: result.isDone
		};
	}
});

/**
 * Internal: derive dailyArrivals / districtCounts / tierCounts for one template
 * from its verified submissions, and patch the template with the result.
 *
 * dailyArrivals is bucketed against a 30-day window ending at "today" (UTC).
 * districtCounts is the full per-district histogram, capped at 500 (matches
 * deliveredDistricts cap; read-time consumers truncate to top-N). tierCounts
 * is a length-6 array indexed by trustTier 0-5.
 */
export const _backfillOneTemplate = internalMutation({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const DAILY_WINDOW = 30;
		const DISTRICT_CAP = 500;
		const dayMs = 86400000;
		const now = Date.now();
		const today = Math.floor(now / dayMs) * dayMs;
		const oldestDay = today - (DAILY_WINDOW - 1) * dayMs;

		const template = await ctx.db
			.query('templates')
			.withIndex('by_slug', (q) => q.eq('slug', slug))
			.first();
		if (!template) return { patched: false };

		const subs = await ctx.db
			.query('submissions')
			.withIndex('by_templateId', (q) => q.eq('templateId', template._id))
			.collect();

		const dailyArrivals: number[] = new Array(DAILY_WINDOW).fill(0);
		const districtMap = new Map<string, number>();
		const tierCounts: number[] = [0, 0, 0, 0, 0, 0];

		for (const s of subs) {
			if (s.verificationStatus !== 'verified') continue;
			if (s.verifiedAt !== undefined) {
				const day = Math.floor(s.verifiedAt / dayMs) * dayMs;
				if (day >= oldestDay && day <= today) {
					const dayIndex = Math.round((day - oldestDay) / dayMs);
					if (dayIndex >= 0 && dayIndex < DAILY_WINDOW) {
						dailyArrivals[dayIndex]++;
					}
				}
			}
			if (s.resolvedDistrict) {
				districtMap.set(
					s.resolvedDistrict,
					(districtMap.get(s.resolvedDistrict) ?? 0) + 1
				);
			}
			if (s.trustTier !== undefined && s.trustTier >= 0 && s.trustTier <= 5) {
				tierCounts[s.trustTier]++;
			}
		}

		const districtCounts = [...districtMap.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, DISTRICT_CAP)
			.map(([code, count]) => ({ code, count }));

		await ctx.db.patch(template._id, {
			dailyArrivals,
			dailyArrivalsLastDay: today,
			districtCounts,
			tierCounts
		});

		return { patched: true };
	}
});

/**
 * Backfill per-template dimensional aggregates on existing templates.
 *
 * Walks templates page-by-page, derives dailyArrivals / districtCounts /
 * tierCounts from the template's verified submissions, and patches the
 * template. tierCounts is meaningful only after `backfillSubmissionTrustTier`
 * has run (otherwise all submissions have trustTier === undefined and
 * tierCounts will all be zero).
 */
export const backfillTemplateAggregates = internalAction({
	args: { batchSize: v.optional(v.number()) },
	handler: async (ctx, { batchSize }): Promise<{ processed: number; failed: number }> => {
		const limit = batchSize ?? 50;
		let processed = 0;
		let failed = 0;
		let isDone = false;
		let paginationCursor: string | undefined;

		while (!isDone) {
			const batch: { items: Array<{ _id: Id<'templates'>; slug: string }>; continueCursor: string; isDone: boolean } = await ctx.runQuery(
				internal.submissions._listTemplatesForAggregateBackfill,
				{ paginationCursor, limit }
			);
			isDone = batch.isDone;
			paginationCursor = batch.continueCursor;

			for (const t of batch.items) {
				try {
					await ctx.runMutation(internal.submissions._backfillOneTemplate, { slug: t.slug });
					processed++;
				} catch (err) {
					console.error(`[backfillTemplateAggregates] Failed template ${t._id}:`, err);
					failed++;
				}
			}
		}

		return { processed, failed };
	}
});
