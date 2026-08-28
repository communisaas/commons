/**
 * Authenticated Tree-3 engagement proof endpoint.
 *
 * One durable Convex state machine owns refresh admission. A fresh snapshot is
 * returned without upstream work; concurrent replays coalesce behind one lease.
 * On a cold identity, metrics are checked before a permanent one-write
 * reservation permits the sole registration POST. Registration is persisted
 * before the Merkle path is fetched, so a later read outage cannot replay the
 * write.
 */

import { json } from '@sveltejs/kit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import {
	getEngagementMetrics,
	getEngagementPath,
	registerEngagement
} from '$lib/core/shadow-atlas/client';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '$lib/server/bounded-json-request';
import { serverMutation } from '$lib/server/convex-work-budget';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import type { RequestHandler } from './$types';

const DEFAULT_ENGAGEMENT_DEPTH = 20;
const ENGAGEMENT_REQUEST_MAX_BYTES = 1_024;
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';
const LEGACY_IDENTITY_COMMITMENT = /^(?:0x)?[0-9a-fA-F]{64}$/u;
const PRIVATE_RESPONSE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' };

type EngagementSnapshot = {
	engagementRoot: string;
	engagementPath: string[];
	engagementIndex: number;
	engagementTier: number;
	actionCount: string;
	diversityScore: string;
};

type FailureStage = 'metrics' | 'registration' | 'path';

function tier0Defaults(depth: number = DEFAULT_ENGAGEMENT_DEPTH): EngagementSnapshot {
	return {
		engagementRoot: ZERO_HASH,
		engagementPath: Array(depth).fill(ZERO_HASH),
		engagementIndex: 0,
		engagementTier: 0,
		actionCount: '0',
		diversityScore: '0'
	};
}

function safeSnapshot(snapshot: EngagementSnapshot | null | undefined): EngagementSnapshot {
	return snapshot ?? tier0Defaults();
}

function privateJson(body: unknown, init?: { status?: number }): Response {
	return json(body, { ...init, headers: PRIVATE_RESPONSE_HEADERS });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readLegacyCompatibleInput(request: Request): Promise<void> {
	if (request.body === null) return;
	const value = await readBoundedJsonRequest(request, ENGAGEMENT_REQUEST_MAX_BYTES, {
		maxArrayItems: 0,
		maxDepth: 1,
		maxNodes: 2,
		maxObjectKeys: 1,
		maxStringBytes: 80
	});
	if (!isRecord(value) || Object.keys(value).some((key) => key !== 'identityCommitment')) {
		throw new BoundedJsonRequestError('Request must be an empty object');
	}
	if (
		value.identityCommitment !== undefined &&
		(typeof value.identityCommitment !== 'string' ||
			!LEGACY_IDENTITY_COMMITMENT.test(value.identityCommitment))
	) {
		throw new BoundedJsonRequestError('identityCommitment must be a 32-byte hex field');
	}
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const session = locals.session;
	if (!session) return privateJson({ error: 'Unauthorized' }, { status: 401 });

	try {
		await readLegacyCompatibleInput(request);
	} catch (error) {
		if (error instanceof BoundedJsonRequestError) {
			return privateJson({ error: error.message }, { status: error.status });
		}
		return privateJson({ error: 'Invalid request body' }, { status: 400 });
	}

	const userId = session.userId as Id<'users'>;
	const leaseToken = crypto.randomUUID();
	const secret = getInternalSecret();
	let claim;
	try {
		claim = await serverMutation(api.users.claimShadowAtlasEngagement, {
			_secret: secret,
			userId,
			leaseToken
		});
	} catch {
		return privateJson({ error: 'Engagement service unavailable' }, { status: 502 });
	}

	if (claim.kind === 'identity_required') {
		return privateJson(
			{ error: 'Identity verification required before engagement registration' },
			{ status: 403 }
		);
	}
	if (claim.kind === 'signer_required') return privateJson(tier0Defaults());
	if (claim.kind === 'cached') return privateJson(claim.snapshot);
	if (claim.kind === 'in_flight' || claim.kind === 'cooldown') {
		return privateJson(safeSnapshot(claim.snapshot));
	}

	const { identityCommitment, signerAddress } = claim;
	const recordFailure = async (stage: FailureStage): Promise<void> => {
		try {
			await serverMutation(api.users.recordShadowAtlasEngagementFailure, {
				_secret: secret,
				userId,
				identityCommitment,
				leaseToken,
				stage
			});
		} catch {
			// The caller still receives the fail-safe snapshot. A stuck lease has a
			// fixed expiry, so failure-record persistence is not required for safety.
		}
	};

	let metrics;
	try {
		// This read is intentionally first. An existing identity is adopted
		// without consuming the external registration write endpoint.
		metrics = await getEngagementMetrics(identityCommitment);
	} catch {
		await recordFailure('metrics');
		return privateJson(safeSnapshot(claim.snapshot));
	}

	let leafIndex: number;
	if (metrics) {
		leafIndex = metrics.leafIndex;
	} else if (claim.registrationStatus === 'registered' && claim.leafIndex !== null) {
		// A formerly registered identity disappearing upstream is not authority
		// to register again. Keep the durable state and fail safely.
		await recordFailure('metrics');
		return privateJson(safeSnapshot(claim.snapshot));
	} else if (claim.registrationStatus === 'write_reserved') {
		// The sole write may have failed after leaving this process. Without an
		// upstream idempotency key, retrying would violate the hard one-write
		// invariant; future reads can still adopt it if metrics eventually appear.
		await recordFailure('registration');
		return privateJson(safeSnapshot(claim.snapshot));
	} else {
		let reservation;
		try {
			reservation = await serverMutation(api.users.reserveShadowAtlasEngagementRegistration, {
				_secret: secret,
				userId,
				identityCommitment,
				leaseToken
			});
		} catch {
			return privateJson(safeSnapshot(claim.snapshot));
		}
		if (!reservation.reserved) {
			await recordFailure('registration');
			return privateJson(safeSnapshot(claim.snapshot));
		}

		try {
			const registration = await registerEngagement(signerAddress, identityCommitment);
			if ('alreadyRegistered' in registration) {
				// A 400 is intentionally oracle-resistant and carries no index. One
				// bounded metrics read may reconcile a concurrently-existing identity.
				metrics = await getEngagementMetrics(identityCommitment);
				if (!metrics) throw new Error('Shadow Atlas registration was not observable');
				leafIndex = metrics.leafIndex;
			} else {
				leafIndex = registration.leafIndex;
			}
		} catch {
			await recordFailure('registration');
			return privateJson(safeSnapshot(claim.snapshot));
		}
	}

	try {
		// Registration durability precedes proof retrieval. A path outage below
		// can cause another read later, but never another registration write.
		await serverMutation(api.users.markShadowAtlasEngagementRegistered, {
			_secret: secret,
			userId,
			identityCommitment,
			leaseToken,
			leafIndex
		});
	} catch {
		return privateJson(safeSnapshot(claim.snapshot));
	}

	let snapshot: EngagementSnapshot;
	try {
		const proof = await getEngagementPath(leafIndex);
		snapshot = {
			engagementRoot: proof.engagementRoot,
			engagementPath: proof.engagementPath,
			engagementIndex: leafIndex,
			// These values must come from the same path response as the root and
			// siblings. Metrics is only registration discovery: the engagement leaf
			// may advance between the two GETs.
			engagementTier: proof.tier,
			actionCount: String(proof.actionCount),
			diversityScore: String(proof.diversityScore)
		};
	} catch {
		await recordFailure('path');
		return privateJson(safeSnapshot(claim.snapshot));
	}

	try {
		await serverMutation(api.users.completeShadowAtlasEngagement, {
			_secret: secret,
			userId,
			identityCommitment,
			leaseToken,
			snapshot
		});
	} catch {
		// The proof is fully validated and user-bound even if another request won
		// the cache race. Return it; the next request can refresh after lease expiry.
	}

	return privateJson(snapshot);
};
