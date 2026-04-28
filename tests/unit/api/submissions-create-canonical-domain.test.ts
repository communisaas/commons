/**
 * /api/submissions/create — canonical action-domain recompute tests
 *
 * Stage 2.5: the server looks up the user's active districtCommitment from
 * `districtCredentials` (via `api.users.getActiveCredentialDistrictCommitment`)
 * and binds it into the v2 action-domain preimage. This test file covers:
 *
 *   1. 403 CREDENTIAL_MIGRATION_REQUIRED when no active commitment is found
 *   2. Canonical recompute uses the server-held commitment (not client-supplied)
 *   3. Mismatch between recomputed domain and client-submitted domain → 400
 *   4. Happy path: matching domain passes to downstream serverAction
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockServerQuery, mockServerAction } = vi.hoisted(() => ({
	mockServerQuery: vi.fn(),
	mockServerAction: vi.fn()
}));

vi.mock('convex-sveltekit', () => ({
	serverQuery: mockServerQuery,
	serverAction: mockServerAction
}));

vi.mock('$lib/convex', () => ({
	api: {
		users: {
			getActiveCredentialDistrictCommitment: 'users.getActiveCredentialDistrictCommitment'
		},
		submissions: {
			create: 'submissions.create'
		}
	}
}));

vi.mock('$lib/core/identity/credential-policy', () => ({
	isCredentialValidForAction: () => ({ valid: true }),
	formatValidationError: (v: unknown) => v
}));

import { POST } from '../../../src/routes/api/submissions/create/+server';
import { buildActionDomain } from '$lib/core/zkp/action-domain-builder';

// Reference commitment used across the suite. Real commitments are sponge-24
// outputs; for this test we just need a valid BN254 field element.
const ACTIVE_COMMITMENT = '0x' + '1f'.repeat(32);
const CURRENT_SESSION_ID = '119th-congress';
const TEMPLATE_ID = 'tmpl-abc-123';
const RECIPIENT = 'US-CA';

// Compute the correct canonical domain so the happy path test can send it.
const CANONICAL_DOMAIN = buildActionDomain({
	country: 'US',
	jurisdictionType: 'federal',
	recipientSubdivision: RECIPIENT,
	templateId: TEMPLATE_ID,
	sessionId: CURRENT_SESSION_ID,
	districtCommitment: ACTIVE_COMMITMENT
});

const VALID_NULLIFIER = '0x' + '0a'.repeat(32);

/** Build a realistic body that passes the structural validator up to the canonical-domain check. */
function buildBody(overrides: Record<string, unknown> = {}) {
	// 31 BN254 field elements, indices [26] = nullifier, [27] = actionDomain
	const publicInputsArray: string[] = new Array(31).fill('0x' + '01'.repeat(32));
	publicInputsArray[26] = VALID_NULLIFIER;
	publicInputsArray[27] = CANONICAL_DOMAIN;
	publicInputsArray[28] = '5';

	// Proof: 2049 hex chars of '11' — well above min 2048, below max 131072
	const proofHex = '0x' + '11'.repeat(1025);

	return {
		templateId: TEMPLATE_ID,
		proof: proofHex,
		publicInputs: {
			publicInputsArray,
			actionDomain: CANONICAL_DOMAIN,
			authorityLevel: 5,
			nullifier: VALID_NULLIFIER
		},
		nullifier: VALID_NULLIFIER,
		encryptedWitness: 'dead',
		witnessNonce: 'beef',
		ephemeralPublicKey: 'f00d',
		teeKeyId: 'k1',
		sessionId: CURRENT_SESSION_ID,
		recipientSubdivision: RECIPIENT,
		...overrides
	};
}

function buildEvent(body: unknown, overrides: Record<string, unknown> = {}) {
	const event = {
		request: {
			json: async () => body
		},
		locals: {
			session: { userId: 'user_abc' },
			user: {
				id: 'user_abc',
				verified_at: Date.now() - 1000,
				district_hash: 'dh',
				trust_tier: 5
			}
		}
	};
	return {
		...event,
		...overrides,
		locals: {
			...event.locals,
			...((overrides.locals as Record<string, unknown> | undefined) ?? {})
		}
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	globalThis.fetch = vi.fn();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('POST /api/submissions/create — Stage 2.5 canonical domain binding', () => {
	it('returns 403 CREDENTIAL_MIGRATION_REQUIRED when user has no active commitment', async () => {
		mockServerQuery.mockResolvedValueOnce(null);

		const response = await POST(buildEvent(buildBody()));

		expect(response.status).toBe(403);
		const json = await response.json();
		expect(json.code).toBe('CREDENTIAL_MIGRATION_REQUIRED');
		expect(json.requiresReverification).toBe(true);
		// Must NOT have invoked the downstream action — credential is stale
		expect(mockServerAction).not.toHaveBeenCalled();
	});

	it('returns 403 when commitment query returns empty object', async () => {
		mockServerQuery.mockResolvedValueOnce({}); // row without districtCommitment

		const response = await POST(buildEvent(buildBody()));

		expect(response.status).toBe(403);
		const json = await response.json();
		expect(json.code).toBe('CREDENTIAL_MIGRATION_REQUIRED');
	});

	it('rejects submission when client domain does not match server-recomputed canonical', async () => {
		// Server holds ACTIVE_COMMITMENT (0x1f..); client pretends a domain
		// computed from a different valid BN254-range commitment (0x0e..).
		// Using 0x0e prevents the validator from rejecting on range, forcing the
		// test to hit the domain-mismatch branch we actually care about.
		const forgedCommitment = '0x' + '0e'.repeat(32);
		const forgedDomain = buildActionDomain({
			country: 'US',
			jurisdictionType: 'federal',
			recipientSubdivision: RECIPIENT,
			templateId: TEMPLATE_ID,
			sessionId: CURRENT_SESSION_ID,
			districtCommitment: forgedCommitment
		});

		mockServerQuery.mockResolvedValueOnce({ districtCommitment: ACTIVE_COMMITMENT });

		const publicInputsArray = new Array(31).fill('0x' + '01'.repeat(32));
		publicInputsArray[26] = VALID_NULLIFIER;
		publicInputsArray[27] = forgedDomain;
		publicInputsArray[28] = '5';

		const body = buildBody({
			publicInputs: {
				publicInputsArray,
				actionDomain: forgedDomain,
				authorityLevel: 5,
				nullifier: VALID_NULLIFIER
			}
		});

		// SvelteKit's error() throws a typed object; the catch at the bottom of
		// POST re-throws it. In the test harness this surfaces as a thrown object
		// with status/body properties.
		let caught: unknown;
		try {
			await POST(buildEvent(body));
		} catch (e) {
			caught = e;
		}

		expect(caught).toBeDefined();
		expect((caught as { status?: number }).status).toBe(400);
		expect(mockServerAction).not.toHaveBeenCalled();
	});

	it('happy path: matching domain passes to downstream action', async () => {
		mockServerQuery.mockResolvedValueOnce({ districtCommitment: ACTIVE_COMMITMENT });
		mockServerAction.mockResolvedValueOnce({
			submissionId: 'sub-1',
			status: 'accepted'
		});

		const response = await POST(buildEvent(buildBody()));

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.success).toBe(true);
		expect(json.submissionId).toBe('sub-1');
		expect(mockServerAction).toHaveBeenCalledTimes(1);
	});

	it('returns 403 when the proof authority public input is below the CWC tier', async () => {
		mockServerQuery.mockResolvedValueOnce({ districtCommitment: ACTIVE_COMMITMENT });

		const publicInputsArray: string[] = new Array(31).fill('0x' + '01'.repeat(32));
		publicInputsArray[26] = VALID_NULLIFIER;
		publicInputsArray[27] = CANONICAL_DOMAIN;
		publicInputsArray[28] = '3';

		const response = await POST(
			buildEvent(
				buildBody({
					publicInputs: {
						publicInputsArray,
						actionDomain: CANONICAL_DOMAIN,
						authorityLevel: 3,
						nullifier: VALID_NULLIFIER
					}
				})
			)
		);

		expect(response.status).toBe(403);
		const json = await response.json();
		expect(json.code).toBe('INSUFFICIENT_AUTHORITY');
		expect(json.requiresReverification).toBe(true);
		expect(mockServerAction).not.toHaveBeenCalled();
	});

	it('returns 403 when the server-side user tier is below the CWC tier', async () => {
		mockServerQuery.mockResolvedValueOnce({ districtCommitment: ACTIVE_COMMITMENT });

		const response = await POST(
			buildEvent(buildBody(), {
				locals: {
					user: {
						id: 'user_abc',
						verified_at: Date.now() - 1000,
						district_hash: 'dh',
						trust_tier: 2
					}
				}
			})
		);

		expect(response.status).toBe(403);
		const json = await response.json();
		expect(json.code).toBe('INSUFFICIENT_AUTHORITY');
		expect(mockServerAction).not.toHaveBeenCalled();
	});

	it('queries the canonical districtCommitment endpoint with the authenticated userId', async () => {
		mockServerQuery.mockResolvedValueOnce({ districtCommitment: ACTIVE_COMMITMENT });
		mockServerAction.mockResolvedValueOnce({
			submissionId: 'sub-2',
			status: 'accepted'
		});

		await POST(buildEvent(buildBody()));

		expect(mockServerQuery).toHaveBeenCalledWith(
			'users.getActiveCredentialDistrictCommitment',
			expect.objectContaining({ userId: 'user_abc' })
		);
	});
});
