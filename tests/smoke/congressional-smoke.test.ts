/**
 * CWC Delivery Smoke Tests
 *
 * Tests CWC client connectivity and XML generation against real APIs.
 * Run manually before releases or when debugging production issues.
 *
 * IMPORTANT:
 * - CWC submission is DRY RUN by default (no actual messages sent)
 * - Set SMOKE_CWC_LIVE=true to send real messages (USE WITH CAUTION)
 *
 * Prerequisites:
 * - CWC_API_KEY and CWC_API_BASE_URL must be set
 * - For House: GCP_PROXY_URL must be set
 *
 * Usage:
 *   npx vitest run tests/smoke/congressional-smoke.test.ts
 *   SMOKE_CWC_LIVE=true npx vitest run tests/smoke/congressional-smoke.test.ts
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// Save native fetch before it gets mocked
const nativeFetch = globalThis.fetch;

import { cwcClient } from '$lib/core/legislative/cwc-client';
import { CWCXmlGenerator } from '$lib/core/legislative/cwc-xml';
import type { Template } from '$lib/types/template';

const IS_LIVE_MODE = process.env.SMOKE_CWC_LIVE === 'true';

describe('CWC Smoke Tests', () => {
	beforeAll(() => {
		console.log('='.repeat(60));
		console.log('CWC DELIVERY SMOKE TESTS');
		console.log('='.repeat(60));
		console.log(`Mode: ${IS_LIVE_MODE ? 'LIVE (real CWC submissions!)' : 'DRY RUN (safe)'}`);
		console.log(`CWC API Key: ${process.env.CWC_API_KEY ? 'Set' : 'Not set'}`);
		console.log(`CWC Base URL: ${process.env.CWC_API_BASE_URL || '(default: soapbox.senate.gov)'}`);
		console.log('='.repeat(60));
	});

	beforeEach(() => {
		globalThis.fetch = nativeFetch;
		vi.restoreAllMocks();
	});

	// =========================================================================
	// Configuration Checks
	// =========================================================================

	describe('Configuration', () => {
		it('should have CWC_API_KEY configured', () => {
			const apiKey = process.env.CWC_API_KEY;
			expect(apiKey).toBeDefined();
			expect(apiKey!.length).toBeGreaterThan(10);
			console.log(`[Smoke] CWC API Key: ${apiKey?.slice(0, 8)}...`);
		});

		it('should have valid CWC_API_BASE_URL', () => {
			const baseUrl = process.env.CWC_API_BASE_URL || 'https://soapbox.senate.gov/api';
			expect(baseUrl).toContain('soapbox.senate.gov');
			console.log(`[Smoke] CWC API URL: ${baseUrl}`);
		});

		it('should have CWC client properly initialized', () => {
			expect(cwcClient).toBeDefined();
			expect(typeof cwcClient.submitToSenate).toBe('function');
			expect(typeof cwcClient.submitToHouse).toBe('function');
			expect(typeof cwcClient.deliverToOffice).toBe('function');
			expect(typeof cwcClient.testConnection).toBe('function');
		});
	});

	// =========================================================================
	// XML Generation
	// =========================================================================

	describe('XML Generation', () => {
		const testTemplate: Template = {
			id: 'smoke-test-template',
			slug: 'smoke-test',
			title: 'Smoke Test - Climate Action',
			description: 'Smoke test template',
			category: 'climate',
			type: 'advocacy',
			deliveryMethod: 'cwc',
			subject: 'Support Climate Action',
			message_body: 'Dear Representative, please support climate action legislation.',
			delivery_config: {},
			cwc_config: {},
			recipient_config: {},
			coordinationScale: 0,
			isNew: true,
			send_count: 0,
			status: 'active',
			is_public: true,
			applicable_countries: ['US'],
			specific_locations: [],
			preview: 'Dear Representative...',
			createdAt: new Date(),
			updatedAt: new Date()
		};

		it('should generate valid House CWC 2.0 XML', () => {
			const xml = CWCXmlGenerator.generatePreviewXML(testTemplate);
			const validation = CWCXmlGenerator.validateXML(xml);

			console.log(`[Smoke] House XML length: ${xml.length} chars`);
			console.log(`[Smoke] Validation: ${validation.valid ? 'PASS' : 'FAIL'}`);
			if (!validation.valid) {
				console.log(`[Smoke] Errors: ${validation.errors.join(', ')}`);
			}

			expect(validation.valid).toBe(true);
			expect(xml).toContain('<CWC version="2.0">');
			expect(xml).toContain('<ConstituentData>');
			expect(xml).toContain('<MessageData>');
		});
	});

	// =========================================================================
	// API Connection
	// =========================================================================

	describe('API Connection', () => {
		it('should connect to Senate CWC API', async () => {
			console.log('[Smoke] Testing connection to Senate CWC API...');

			const result = await cwcClient.testConnection();

			console.log(`[Smoke] Connection: ${result.connected ? 'SUCCESS' : 'FAILED'}`);
			if (result.error) {
				console.log(`[Smoke] Error: ${result.error}`);
			}

			// Don't fail the test if API key isn't configured — just report
			if (!process.env.CWC_API_KEY) {
				console.log('[Smoke] Skipping — CWC_API_KEY not set');
				return;
			}

			expect(result.connected).toBe(true);
		}, 30000);
	});

	// =========================================================================
	// Live Submission (opt-in only)
	// =========================================================================

	describe('Live Senate Submission', () => {
		const testSenator = {
			bioguideId: 'P000145',
			name: 'Alex Padilla',
			chamber: 'senate' as const,
			officeCode: 'P000145',
			state: 'CA',
			district: '00',
			party: 'Democratic'
		};

		const testUser = {
			id: 'smoke-test-user',
			name: 'Smoke Test',
			email: 'smoke@commons.email',
			street: '1 Dr Carlton B Goodlett Pl',
			city: 'San Francisco',
			state: 'CA',
			zip: '94102',
			phone: null,
			congressional_district: 'CA-11'
		};

		it.skipIf(!IS_LIVE_MODE)('should submit test message to Senate', async () => {
			console.log('\n[Smoke] LIVE CWC SUBMISSION TO SENATE');

			const result = await cwcClient.submitToSenate(
				{
					id: 'smoke-test',
					title: 'Smoke Test - Please Ignore',
					message_body: 'Automated smoke test. Please disregard.',
					description: '',
					delivery_config: {}
				} as Template,
				testUser,
				testSenator,
				'[SMOKE TEST] Automated test — please disregard.'
			);

			console.log('[Smoke] Result:', JSON.stringify(result, null, 2));

			if (result.success) {
				console.log('[Smoke] Senate submission SUCCEEDED');
			} else {
				console.log('[Smoke] Senate submission error:', result.error);
			}
		}, 60000);
	});
});
