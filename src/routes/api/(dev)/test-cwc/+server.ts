import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { CWCXmlGenerator } from '$lib/core/legislative/cwc-xml';
import type { Template } from '$lib/types/template';

interface CWCTestResults {
	testType: string;
	timestamp: string;
	cwcConfigured: boolean;
	xmlGeneration?: {
		success: boolean;
		errors: unknown[];
		xmlLength: number;
		preview: string;
	};
	apiConnection?: {
		connected: boolean;
		[key: string]: unknown;
	};
	senateSubmission?: {
		success: boolean;
		[key: string]: unknown;
	};
}

/**
 * Test CWC integration
 *
 * This endpoint tests the CWC API client and XML generation
 * for congressional message delivery.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!dev) {
		return json({ error: 'Development endpoint not available' }, { status: 404 });
	}

	try {
		const { testType = 'preview' } = await request.json();

		// Test template
		const testTemplate: Template = {
			id: 'test-template-1',
			slug: 'test-climate-action',
			title: 'Test Congressional Message',
			description: 'Test template for climate action advocacy',
			category: 'climate',
			type: 'advocacy',
			deliveryMethod: 'cwc',
			subject: 'Urgent: Support Climate Action',
			message_body:
				'Dear [Representative Name],\n\nAs your constituent from [Address ], I urge you to support climate action legislation. [Personal Connection]\n\nThank you for your service.\n\nSincerely,\n[Name]',
			delivery_config: {},
			cwc_config: {},
			recipient_config: {},
			coordinationScale: 0,
			isNew: true,
			send_count: 0,
			metrics: {},
			status: 'active',
			is_public: true,
			applicable_countries: ['US'],
			specific_locations: [],
			preview:
				'Dear Representative, As your constituent, I urge you to support climate action legislation...',
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		// Test user
		const testUser = {
			id: 'test-user-123',
			name: 'Jane Smith',
			email: 'jane.smith@example.com',
			phone: '+1-555-123-4567',
			street: '123 Main Street',
			city: 'San Francisco',
			state: 'CA',
			zip: '94102'
		};

		// Test senator (California)
		const testSenator = {
			bioguideId: 'P000145',
			name: 'Alex Padilla',
			chamber: 'senate' as const,
			officeCode: 'P000145',
			state: 'CA',
			district: '00',
			party: 'Democratic'
		};

		const results: CWCTestResults = {
			testType,
			timestamp: new Date().toISOString(),
			cwcConfigured: !!process.env.CWC_API_KEY
		};

		if (testType === 'preview' || testType === 'all') {
			// Test 1: XML Generation
			const previewXML = CWCXmlGenerator.generatePreviewXML(testTemplate);
			const validation = CWCXmlGenerator.validateXML(previewXML);

			results.xmlGeneration = {
				success: validation.valid,
				errors: validation.errors,
				xmlLength: previewXML.length,
				preview: previewXML.substring(0, 500) + '...'
			};
		}

		if (testType === 'connection' || testType === 'all') {
			// Test 2: API Connection
			const connectionTest = await cwcClient.testConnection();
			results.apiConnection = connectionTest;
		}

		if (testType === 'senate' || testType === 'all') {
			// Test 3: Senate Submission (simulated if no API key)
			const senateResult = await cwcClient.submitToSenate(
				testTemplate,
				testUser,
				testSenator,
				'This is a test message for congressional delivery.'
			);

			results.senateSubmission = {
				success: senateResult.success,
				status: senateResult.status,
				office: senateResult.office,
				messageId: senateResult.messageId,
				error: senateResult.error,
				isSimulated: senateResult.error?.includes('Simulated') || false
			};
		}

		console.log('CWC test results:', {
			testType,
			cwcConfigured: results.cwcConfigured,
			xmlValid: results.xmlGeneration?.success,
			apiConnected: results.apiConnection?.connected,
			senateSubmitted: results.senateSubmission?.success
		});

		return json({
			success: true,
			results,
			message: 'CWC integration test completed'
		});
	} catch (error) {
		console.error('[TestCWC] Integration test failed:', error instanceof Error ? error.message : String(error));
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Test failed',
				message: 'CWC integration test failed'
			},
			{ status: 500 }
		);
	}
};

export const GET: RequestHandler = async () => {
	if (!dev) {
		return json({ error: 'Development endpoint not available' }, { status: 404 });
	}

	// Simple status check
	return json({
		cwcConfigured: !!process.env.CWC_API_KEY,
		endpoint: process.env.CWC_API_BASE_URL,
		message: 'CWC integration status'
	});
};
