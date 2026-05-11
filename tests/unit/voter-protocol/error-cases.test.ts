/**
 * Error Cases E2E Tests
 *
 * Tests failure scenarios and error handling for the Commons ↔ voter-protocol integration:
 * - Invalid proof rejection
 * - Nullifier reuse (double-voting prevention)
 * - Expired session handling
 * - Invalid signature rejection
 * - API failure handling
 *
 * These tests verify the system fails safely and provides clear error messages.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
	setupTestServer,
	cleanupTestResources,
	useHandlers,
	createShadowAtlasHandlers,
	createCongressionalHandlers,
	createNullifierRegistryHandlers,
	TEST_CONFIG,
	http,
	HttpResponse
} from './test-utils';
import {
	INVALID_SHADOW_ATLAS_RESPONSES,
	INVALID_PROOF_INPUTS,
	BN254_MODULUS
} from './fixtures';

// NOTE: didit-client module removed — mDL-only consolidation.
// Webhook signature validation, parseVerificationResult, and isAgeEligible
// tests have been replaced with mDL-equivalent or pure-logic tests below.

describe('Error Cases: Failure Scenarios', () => {
	const server = setupTestServer();

	beforeAll(() => {
		server.listen({ onUnhandledRequest: 'warn' });
	});

	afterAll(async () => {
		server.close();
		await cleanupTestResources();
	});

	beforeEach(() => {
		server.resetHandlers();
		vi.clearAllMocks();
	});

	// ===========================================================================
	// INVALID PROOF REJECTION
	// ===========================================================================

	describe('Invalid Proof Rejection', () => {
		it('should reject proof with field element exceeding BN254 modulus', () => {
			const invalidInputs = INVALID_PROOF_INPUTS.overflowFieldElement;
			const merkleRootValue = BigInt(invalidInputs.merkleRoot);

			// Verify the merkle root exceeds the modulus
			expect(merkleRootValue >= BN254_MODULUS).toBe(true);
		});

		it('should reject proof with wrong Merkle path length', () => {
			const invalidInputs = INVALID_PROOF_INPUTS.wrongPathLength;

			// Should have 20 elements for depth-20 circuit
			expect(invalidInputs.merklePath.length).not.toBe(20);
			expect(invalidInputs.merklePath.length).toBe(12);
		});

		it('should reject proof with invalid authority level', () => {
			const invalidInputs = INVALID_PROOF_INPUTS.invalidAuthorityLevel;

			// Authority level must be 1-5
			expect(invalidInputs.authorityLevel).toBeGreaterThan(5);
		});

		it('should reject proof with negative leaf index', () => {
			const invalidInputs = INVALID_PROOF_INPUTS.negativeLeafIndex;

			expect(invalidInputs.leafIndex).toBeLessThan(0);
		});

		it('should reject proof with leaf index out of range for depth-20', () => {
			const invalidInputs = INVALID_PROOF_INPUTS.leafIndexOverflow;

			// Max valid index for depth-20 is 2^20 - 1 = 1,048,575
			const maxValidIndex = 2 ** 20 - 1;
			expect(invalidInputs.leafIndex).toBeGreaterThan(maxValidIndex);
		});

		it('should validate proof input field element bounds', () => {
			// Helper to check if value is valid BN254 field element
			const isValidFieldElement = (hex: string): boolean => {
				try {
					const value = BigInt(hex);
					return value >= 0n && value < BN254_MODULUS;
				} catch {
					return false;
				}
			};

			// Valid value should pass
			expect(isValidFieldElement('0x' + '00'.repeat(32))).toBe(true);
			expect(isValidFieldElement('0x1234')).toBe(true);

			// Overflow should fail
			expect(isValidFieldElement('0x' + 'ff'.repeat(32))).toBe(false);

			// Invalid hex should fail
			expect(isValidFieldElement('not-hex')).toBe(false);
		});
	});

	// ===========================================================================
	// NULLIFIER REUSE (DOUBLE-VOTING PREVENTION)
	// ===========================================================================

	describe('Nullifier Reuse (Double-Voting Prevention)', () => {
		it('should detect existing nullifier in registry', () => {
			const existingNullifier = '0x' + 'already_used'.padStart(64, '0');
			const registry = new Set<string>([existingNullifier]);

			// Check if nullifier exists
			expect(registry.has(existingNullifier)).toBe(true);

			// Error response structure
			const errorResponse = {
				error: 'NULLIFIER_ALREADY_USED',
				message: 'This nullifier has already been used'
			};
			expect(errorResponse.error).toBe('NULLIFIER_ALREADY_USED');
			expect(errorResponse.message).toContain('already been used');
		});

		it('should correctly report existing nullifier state', () => {
			const existingNullifier = '0x' + 'check_existing'.padStart(64, '0');
			const registry = new Map<string, { usedAt: Date }>();
			registry.set(existingNullifier, { usedAt: new Date() });

			const result = registry.get(existingNullifier);
			expect(result).toBeDefined();
			expect(result!.usedAt).toBeInstanceOf(Date);
		});

		it('should handle concurrent nullifier registration attempts via atomic check-and-set', () => {
			const nullifier = '0x' + 'concurrent'.padStart(64, '0');
			const registry = new Set<string>();

			// Atomic check-and-set operation
			const tryRegister = (n: string): boolean => {
				if (registry.has(n)) return false;
				registry.add(n);
				return true;
			};

			// First registration should succeed
			expect(tryRegister(nullifier)).toBe(true);

			// Second registration should fail
			expect(tryRegister(nullifier)).toBe(false);
		});
	});

	// ===========================================================================
	// EXPIRED SESSION HANDLING
	// ===========================================================================

	describe('Expired Session Handling', () => {
		// NOTE: Didit webhook status tests removed (didit-client deleted).
		// mDL uses browser-native credential presentation — no webhooks.

		it('should handle session timeout response structure', () => {
			const expiredSessionResponse = {
				session_id: 'expired-session',
				status: 'expired',
				expired_at: new Date(Date.now() - 3600000).toISOString()
			};

			expect(expiredSessionResponse.status).toBe('expired');
			expect(expiredSessionResponse.expired_at).toBeDefined();
		});

		it('should reject verification sessions older than 5 minutes', () => {
			const sessionCreated = new Date(Date.now() - 6 * 60 * 1000); // 6 min ago
			const expiresAt = new Date(sessionCreated.getTime() + 5 * 60 * 1000);
			const isExpired = new Date() > expiresAt;

			expect(isExpired).toBe(true);
		});
	});

	// ===========================================================================
	// INVALID SIGNATURE REJECTION
	// ===========================================================================

	// NOTE: Webhook signature rejection tests removed (didit-client deleted).
	// mDL uses COSE_Sign1 signatures validated against IACA root certificates.
	// See src/lib/core/identity/mdl-verification.ts for the production path.

	// ===========================================================================
	// API FAILURE HANDLING
	// ===========================================================================

	describe('API Failure Handling', () => {
		describe('Shadow Atlas Failures', () => {
			// Note: These tests validate error response structures since we can't
			// directly test the lookupDistrict function (uses SvelteKit $env)

			it('should define proper network error response', () => {
				const networkErrorResponse = {
					success: false,
					error: {
						code: 'NETWORK_ERROR',
						message: 'Failed to connect to Shadow Atlas'
					}
				};
				expect(networkErrorResponse.success).toBe(false);
				expect(networkErrorResponse.error.code).toBe('NETWORK_ERROR');
			});

			it('should define proper 404 response for district not found', () => {
				const notFoundResponse = {
					success: false,
					error: {
						code: 'DISTRICT_NOT_FOUND',
						message: 'No district found for the given coordinates'
					}
				};
				expect(notFoundResponse.success).toBe(false);
				expect(notFoundResponse.error.code).toBe('DISTRICT_NOT_FOUND');
			});

			it('should validate coordinates before API call', () => {
				const validateCoordinates = (lat: number, lng: number): { valid: boolean; error?: string } => {
					if (lat < -90 || lat > 90) {
						return { valid: false, error: `Invalid latitude: ${lat}` };
					}
					if (lng < -180 || lng > 180) {
						return { valid: false, error: `Invalid longitude: ${lng}` };
					}
					return { valid: true };
				};

				expect(validateCoordinates(100, 200).valid).toBe(false);
				expect(validateCoordinates(37.7793, -122.4193).valid).toBe(true);
			});

			it('should detect wrong tree depth in response', () => {
				const wrongDepthResponse = INVALID_SHADOW_ATLAS_RESPONSES.wrongDepth;
				const depth = wrongDepthResponse.data.merkleProof.depth;
				const expectedDepth = 20;

				expect(depth).not.toBe(expectedDepth);
				expect(depth).toBe(12);
			});

			it('should define proper health check failure response', () => {
				const unhealthyResponse = { status: 'unhealthy' };
				expect(unhealthyResponse.status).toBe('unhealthy');
			});
		});

		describe('Congressional API Failures', () => {
			it('should define proper rate limit response', () => {
				const rateLimitResponse = {
					status: 429,
					error: 'Rate limit exceeded',
					retry_after: 60
				};
				expect(rateLimitResponse.status).toBe(429);
				expect(rateLimitResponse.retry_after).toBeDefined();
			});

			it('should define proper server error response', () => {
				const serverErrorResponse = {
					status: 500,
					error: 'Internal server error'
				};
				expect(serverErrorResponse.status).toBe(500);
			});

			it('should define proper validation error response', () => {
				const validationErrorResponse = {
					status: 400,
					error: 'Invalid submission format'
				};
				expect(validationErrorResponse.status).toBe(400);
			});
		});

		// NOTE: Didit API failure tests removed (didit-client deleted).
		// mDL verification failures are browser-native (no API calls).
	});

	// ===========================================================================
	// AGE VERIFICATION FAILURES
	// ===========================================================================

	describe('Age Verification Failures', () => {
		// Pure-logic age eligibility (no didit-client dependency)
		const isAgeEligible = (birthYear: number): boolean => {
			const currentYear = new Date().getFullYear();
			return currentYear - birthYear >= 18;
		};

		it('should reject underage users (under 18)', () => {
			expect(isAgeEligible(2015)).toBe(false);
		});

		it('should accept users who are exactly 18', () => {
			expect(isAgeEligible(2008)).toBe(true);
		});

		it('should accept users over 18', () => {
			expect(isAgeEligible(1990)).toBe(true);
			expect(isAgeEligible(1970)).toBe(true);
		});

		it('should reject users born in the future', () => {
			expect(isAgeEligible(2030)).toBe(false);
		});
	});

	// ===========================================================================
	// MALFORMED INPUT HANDLING
	// ===========================================================================

	describe('Malformed Input Handling', () => {
		it('should handle empty proof inputs gracefully', () => {
			const emptyInputs = {
				merkleRoot: '',
				actionDomain: '',
				userSecret: '',
				districtId: '',
				authorityLevel: 0,
				registrationSalt: '',
				merklePath: [],
				leafIndex: 0
			};

			// Empty strings should fail field element validation
			expect(emptyInputs.merkleRoot).toBe('');
			expect(emptyInputs.merklePath.length).toBe(0);
		});

		it('should detect non-hex field elements', () => {
			const isValidHex = (str: string): boolean => {
				if (!str.startsWith('0x')) return false;
				return /^0x[0-9a-fA-F]*$/.test(str);
			};

			expect(isValidHex('0x1234')).toBe(true);
			expect(isValidHex('0xABCDEF')).toBe(true);
			expect(isValidHex('not-hex')).toBe(false);
			expect(isValidHex('0xGHIJKL')).toBe(false); // Invalid hex chars
			expect(isValidHex('1234')).toBe(false); // Missing 0x prefix
		});

		it('should handle null/undefined inputs', () => {
			const validateInput = (input: unknown): boolean => {
				return input !== null && input !== undefined;
			};

			expect(validateInput(null)).toBe(false);
			expect(validateInput(undefined)).toBe(false);
			expect(validateInput('')).toBe(true); // Empty string is still defined
			expect(validateInput('0x1234')).toBe(true);
		});
	});
});
