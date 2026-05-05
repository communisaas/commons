/**
 * E2E Test Utilities for Voter Protocol Integration
 *
 * Provides shared setup/teardown, mock server configuration, and helper functions
 * for the Commons ↔ voter-protocol integration tests.
 *
 * Architecture:
 * - Uses MSW (Mock Service Worker) for API mocking
 * - Supports both browser (Playwright) and unit test (Vitest) contexts
 * - Provides factories for common test scenarios
 */

import { setupServer, type SetupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import type { Page } from '@playwright/test';
import {
	createMockShadowAtlasResponse,
	createMockDiditWebhook,
	VALID_PROOF_INPUTS,
	TEST_COORDINATES,
	generateWebhookSignature,
	type MockShadowAtlasResponse
} from './fixtures';

// ============================================================================
// Environment Configuration
// ============================================================================

export const TEST_CONFIG = {
	// Shadow Atlas API (mocked)
	SHADOW_ATLAS_URL: process.env.SHADOW_ATLAS_API_URL || 'http://localhost:3000',

	// Didit webhook secret for signature validation
	DIDIT_WEBHOOK_SECRET: process.env.DIDIT_WEBHOOK_SECRET || 'test-webhook-secret',

	// Prover configuration
	PROVER_DEPTH: 20,
	PROVER_TIMEOUT_MS: 60000, // 1 minute for proof generation

	// Test database (if using real DB)
	DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/test',

	// Congressional API endpoints
	CWC_SENATE_URL: 'https://soapbox.senate.gov/api/testing-messages',
	CWC_HOUSE_PROXY_URL: 'http://34.171.151.252:8080/api/house/submit'
};

// ============================================================================
// MSW Handler Factories
// ============================================================================

/**
 * Create Shadow Atlas API handlers
 */
export function createShadowAtlasHandlers(options?: {
	lookupResponse?: MockShadowAtlasResponse;
	healthStatus?: boolean;
	errorMode?: 'network' | 'not_found' | 'invalid';
}) {
	const baseUrl = TEST_CONFIG.SHADOW_ATLAS_URL;

	return [
		// District lookup endpoint
		http.get(`${baseUrl}/v1/lookup`, ({ request }) => {
			const url = new URL(request.url);
			const lat = parseFloat(url.searchParams.get('lat') || '0');
			const lng = parseFloat(url.searchParams.get('lng') || '0');

			// Handle error modes
			if (options?.errorMode === 'network') {
				return HttpResponse.error();
			}

			if (options?.errorMode === 'not_found') {
				return HttpResponse.json(
					{
						success: false,
						error: {
							code: 'DISTRICT_NOT_FOUND',
							message: 'No district found for the given coordinates'
						}
					},
					{ status: 404 }
				);
			}

			if (options?.errorMode === 'invalid') {
				return HttpResponse.json(
					{
						success: false,
						error: {
							code: 'INVALID_COORDINATES',
							message: 'Invalid latitude or longitude'
						}
					},
					{ status: 400 }
				);
			}

			// Return custom response or generate based on coordinates
			if (options?.lookupResponse) {
				return HttpResponse.json(options.lookupResponse);
			}

			// Generate response based on coordinates
			const response = generateDistrictResponse(lat, lng);
			return HttpResponse.json(response);
		}),

		// Health check endpoint
		http.get(`${baseUrl}/health`, () => {
			if (options?.healthStatus === false) {
				return HttpResponse.json({ status: 'unhealthy' }, { status: 503 });
			}
			return HttpResponse.json({ status: 'healthy' });
		})
	];
}

/**
 * Generate district response based on coordinates
 */
function generateDistrictResponse(lat: number, lng: number): MockShadowAtlasResponse {
	// San Francisco area
	if (lat >= 37.7 && lat <= 37.8 && lng >= -122.5 && lng <= -122.3) {
		return createMockShadowAtlasResponse({
			districtId: 'usa-ca-sf-d5',
			districtName: 'San Francisco District 5',
			jurisdiction: 'city-council'
		});
	}

	// Seattle area
	if (lat >= 47.5 && lat <= 47.7 && lng >= -122.4 && lng <= -122.2) {
		return createMockShadowAtlasResponse({
			districtId: 'usa-wa-seattle-d1',
			districtName: 'Seattle District 1',
			jurisdiction: 'city-council'
		});
	}

	// Austin area
	if (lat >= 30.2 && lat <= 30.4 && lng >= -97.8 && lng <= -97.6) {
		return createMockShadowAtlasResponse({
			districtId: 'usa-tx-austin-d5',
			districtName: 'Austin District 5',
			jurisdiction: 'city-council'
		});
	}

	// DC area (federal district, special handling)
	if (lat >= 38.85 && lat <= 38.95 && lng >= -77.1 && lng <= -76.9) {
		return createMockShadowAtlasResponse({
			districtId: 'usa-dc-at-large',
			districtName: 'District of Columbia',
			jurisdiction: 'federal-territory'
		});
	}

	// Default fallback - return a generic district for any coordinates within valid bounds
	// This handles edge cases and coordinates not in specific known areas
	return createMockShadowAtlasResponse({
		districtId: 'usa-generic-district',
		districtName: 'Generic District',
		jurisdiction: 'generic'
	});
}

/**
 * Create identity verification handlers (mDL / Digital Credentials API)
 * NOTE: Didit.me handlers removed — mDL is now the sole identity provider.
 */
export function createDiditHandlers(options?: {
	sessionCreationResponse?: object;
	sessionStatusResponse?: object;
}) {
	// Returns empty handlers — Didit.me endpoints are no longer active.
	// Kept for backward compatibility with setupTestServer() signature.
	return [];
}

/**
 * Create Congressional API handlers (CWC)
 */
export function createCongressionalHandlers(options?: {
	houseEnabled?: boolean;
	senateEnabled?: boolean;
	errorMode?: 'rate_limit' | 'server_error' | 'validation_error';
}) {
	const handlers = [];

	// Senate endpoint
	if (options?.senateEnabled !== false) {
		handlers.push(
			http.post(/https:\/\/soapbox\.senate\.gov\/api\/testing-messages\/.*/, async () => {
				if (options?.errorMode === 'rate_limit') {
					return HttpResponse.json(
						{ error: 'Rate limit exceeded', retry_after: 60 },
						{ status: 429 }
					);
				}
				if (options?.errorMode === 'server_error') {
					return HttpResponse.json({ error: 'Internal server error' }, { status: 500 });
				}
				if (options?.errorMode === 'validation_error') {
					return HttpResponse.json({ error: 'Invalid submission format' }, { status: 400 });
				}

				return HttpResponse.json({
					messageId: `SEN-${Date.now()}`,
					status: 'submitted',
					timestamp: new Date().toISOString()
				});
			})
		);
	}

	// House endpoint (via proxy)
	if (options?.houseEnabled !== false) {
		handlers.push(
			http.post(/http:\/\/34\.171\.151\.252:8080\/api\/house\/submit.*/, async () => {
				if (options?.errorMode === 'rate_limit') {
					return HttpResponse.json(
						{ error: 'Rate limit exceeded', retry_after: 60 },
						{ status: 429 }
					);
				}
				if (options?.errorMode === 'server_error') {
					return HttpResponse.json({ error: 'Internal server error' }, { status: 500 });
				}

				return HttpResponse.json({
					messageId: `HOUSE-${Date.now()}`,
					status: 'submitted',
					timestamp: new Date().toISOString()
				});
			})
		);
	}

	return handlers;
}

/**
 * Create nullifier registry handlers
 */
export function createNullifierRegistryHandlers(options?: {
	existingNullifiers?: string[];
}) {
	const usedNullifiers = new Set(options?.existingNullifiers || []);

	return [
		// Check if nullifier exists
		http.get('/api/nullifier/:nullifier', ({ params }) => {
			const nullifier = params.nullifier as string;
			if (usedNullifiers.has(nullifier)) {
				return HttpResponse.json({
					exists: true,
					usedAt: new Date().toISOString()
				});
			}
			return HttpResponse.json({ exists: false });
		}),

		// Register a new nullifier
		http.post('/api/nullifier', async ({ request }) => {
			const body = (await request.json()) as { nullifier: string };
			if (usedNullifiers.has(body.nullifier)) {
				return HttpResponse.json(
					{ error: 'NULLIFIER_ALREADY_USED', message: 'This nullifier has already been used' },
					{ status: 409 }
				);
			}
			usedNullifiers.add(body.nullifier);
			return HttpResponse.json({
				success: true,
				nullifier: body.nullifier,
				registeredAt: new Date().toISOString()
			});
		})
	];
}

// ============================================================================
// MSW Server Setup
// ============================================================================

let server: SetupServer | null = null;

/**
 * Initialize the MSW server with all handlers
 */
export function setupTestServer(options?: {
	shadowAtlasOptions?: Parameters<typeof createShadowAtlasHandlers>[0];
	diditOptions?: Parameters<typeof createDiditHandlers>[0];
	congressionalOptions?: Parameters<typeof createCongressionalHandlers>[0];
	nullifierOptions?: Parameters<typeof createNullifierRegistryHandlers>[0];
}): SetupServer {
	const handlers = [
		...createShadowAtlasHandlers(options?.shadowAtlasOptions),
		...createDiditHandlers(options?.diditOptions),
		...createCongressionalHandlers(options?.congressionalOptions),
		...createNullifierRegistryHandlers(options?.nullifierOptions)
	];

	server = setupServer(...handlers);
	return server;
}

/**
 * Get the current MSW server instance
 */
export function getTestServer(): SetupServer | null {
	return server;
}

/**
 * Add handlers dynamically to the server
 */
export function useHandlers(handlers: ReturnType<typeof http.get>[]): void {
	if (!server) {
		throw new Error('Test server not initialized. Call setupTestServer() first.');
	}
	server.use(...handlers);
}

// ============================================================================
// Playwright Helpers
// ============================================================================

/**
 * Wait for proof generation to complete (Playwright)
 * ZK proof generation can take 10-30 seconds
 */
export async function waitForProofGeneration(
	page: Page,
	options?: { timeout?: number }
): Promise<void> {
	const timeout = options?.timeout ?? TEST_CONFIG.PROVER_TIMEOUT_MS;

	await page.waitForSelector('[data-testid="proof-generation-complete"]', {
		state: 'visible',
		timeout
	});
}

/**
 * Intercept and mock ZK prover in Playwright tests
 * Useful for UI tests that don't need real proof generation
 */
export async function mockProverInBrowser(page: Page): Promise<void> {
	await page.addInitScript(() => {
		// @ts-expect-error - Injecting mock into window
		window.__MOCK_ZK_PROVER__ = true;

		// Mock the prover module
		// @ts-expect-error - Module augmentation
		window.__voterProtocolMocks__ = {
			generateProof: async () => ({
				proof: '0x' + 'ab'.repeat(256),
				publicInputs: {
					merkleRoot: '0x' + '00'.repeat(32),
					nullifier: '0x' + 'cd'.repeat(32),
					authorityLevel: 3,
					actionDomain: '0x' + '01'.repeat(32),
					districtId: '0x' + '42'.repeat(32)
				}
			})
		};
	});
}

/**
 * Setup route interception for API mocking in Playwright
 */
export async function setupPlaywrightMocks(
	page: Page,
	options?: {
		shadowAtlas?: boolean;
		didit?: boolean;
		congressional?: boolean;
	}
): Promise<void> {
	// Mock Shadow Atlas API
	if (options?.shadowAtlas !== false) {
		await page.route(`${TEST_CONFIG.SHADOW_ATLAS_URL}/**`, async (route) => {
			const url = new URL(route.request().url());

			if (url.pathname === '/health') {
				return route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ status: 'healthy' })
				});
			}

			if (url.pathname === '/v1/lookup') {
				const lat = parseFloat(url.searchParams.get('lat') || '0');
				const lng = parseFloat(url.searchParams.get('lng') || '0');
				const response = generateDistrictResponse(lat, lng);
				return route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(response)
				});
			}

			return route.continue();
		});
	}

	// NOTE: Didit.me API mock removed — mDL (Digital Credentials API) is the sole provider.
}

// ============================================================================
// Test Data Generators
// ============================================================================

/**
 * Generate a complete test scenario with all required data
 */
export function generateTestScenario(
	scenario: 'happy_path' | 'unverified_user' | 'double_vote' | 'invalid_proof'
) {
	switch (scenario) {
		case 'happy_path':
			return {
				user: {
					userId: 'test-user-happy',
					email: 'happy@test.com',
					isVerified: true,
					authorityLevel: 3
				},
				coordinates: TEST_COORDINATES.sfCityHall,
				proofInputs: VALID_PROOF_INPUTS.realistic,
				diditWebhook: createMockDiditWebhook({ userId: 'test-user-happy', status: 'Approved' }),
				expectedOutcome: 'success'
			};

		case 'unverified_user':
			return {
				user: {
					userId: 'test-user-unverified',
					email: 'unverified@test.com',
					isVerified: false
				},
				coordinates: TEST_COORDINATES.sfCityHall,
				proofInputs: null, // Cannot generate proof without verification
				diditWebhook: null,
				expectedOutcome: 'verification_required'
			};

		case 'double_vote':
			return {
				user: {
					userId: 'test-user-double',
					email: 'double@test.com',
					isVerified: true,
					authorityLevel: 3
				},
				coordinates: TEST_COORDINATES.sfCityHall,
				proofInputs: VALID_PROOF_INPUTS.realistic,
				existingNullifier: '0x' + 'abcd'.repeat(16),
				expectedOutcome: 'nullifier_already_used'
			};

		case 'invalid_proof':
			return {
				user: {
					userId: 'test-user-invalid',
					email: 'invalid@test.com',
					isVerified: true,
					authorityLevel: 3
				},
				coordinates: TEST_COORDINATES.sfCityHall,
				proofInputs: {
					...VALID_PROOF_INPUTS.minimal,
					merklePath: Array(12).fill('0x00') // Wrong length
				},
				expectedOutcome: 'invalid_proof'
			};

		default:
			throw new Error(`Unknown scenario: ${scenario}`);
	}
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Validate a nullifier is properly formatted
 */
export function isValidNullifier(nullifier: string): boolean {
	if (!nullifier.startsWith('0x')) return false;
	if (nullifier.length !== 66) return false; // 0x + 64 hex chars
	return /^0x[0-9a-fA-F]{64}$/.test(nullifier);
}

/**
 * Validate a proof result structure
 */
export function isValidProofResult(result: unknown): result is {
	proof: string;
	publicInputs: {
		merkleRoot: string;
		nullifier: string;
		authorityLevel: number;
		actionDomain: string;
		districtId: string;
	};
} {
	if (!result || typeof result !== 'object') return false;

	const r = result as Record<string, unknown>;
	if (typeof r.proof !== 'string') return false;
	if (!r.publicInputs || typeof r.publicInputs !== 'object') return false;

	const pi = r.publicInputs as Record<string, unknown>;
	return (
		typeof pi.merkleRoot === 'string' &&
		typeof pi.nullifier === 'string' &&
		typeof pi.authorityLevel === 'number' &&
		typeof pi.actionDomain === 'string' &&
		typeof pi.districtId === 'string'
	);
}

// ============================================================================
// Cleanup Utilities
// ============================================================================

/**
 * Clean up test resources
 */
export async function cleanupTestResources(): Promise<void> {
	if (server) {
		server.close();
		server = null;
	}
}

export { http, HttpResponse };
