import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('mDL live-smoke readiness', () => {
	it('keeps credential hash and identity binding on active mDL paths', () => {
		const directStream = read('src/routes/api/identity/direct-mdl/stream/[sessionId]/+server.ts');
		const directComplete = read('src/routes/api/identity/direct-mdl/complete/+server.ts');
		const verifyRoute = read('src/routes/api/identity/verify-mdl/verify/+server.ts');
		const verifier = read('src/lib/components/auth/GovernmentCredentialVerification.svelte');

		expect(directComplete).toContain('identityCommitment: result.identityCommitment');
		expect(directComplete).toContain('credentialHash: result.credentialHash');
		expect(directComplete).toContain("sessionChannel: 'direct'");
		expect(directComplete).toContain('identityCommitmentBound: true');
		expect(directStream).toContain('credentialHash: session.result?.credentialHash');
		expect(directStream).toContain('identityCommitmentBound: session.result?.identityCommitmentBound');
		expect(verifyRoute).toContain('identityCommitment,');
		expect(verifyRoute).toContain('credentialHash: result.credentialHash');
		expect(verifyRoute).toContain("sessionChannel: 'digital-credentials'");
		expect(verifyRoute).toContain('identityCommitmentBound: true');
		expect(verifier).toContain('verification.requireReauth === true');
		expect(verifier).toContain('credentialHash: verification.credentialHash');
		expect(verifier).not.toContain("credentialHash: ''");
		expect(verifier).not.toContain('credentialHash: data.credentialHash');
	});

	it('discloses the mDL fields requested by the wallet prompt', () => {
		const verifier = read('src/lib/components/auth/GovernmentCredentialVerification.svelte');
		const templateModal = read('src/lib/components/template/TemplateModal.svelte');
		const helpPage = read('src/routes/help/verification/+page.svelte');
		const privacyBoundary = read('src/lib/core/identity/mdl-verification.ts');
		const requestedFields = 'postal code, city, state, birth date, and document number';

		expect(verifier).toContain(requestedFields);
		expect(templateModal).toContain('postal code, city, state, birth date');
		expect(templateModal).toContain('document number');
		expect(helpPage).toContain(requestedFields);
		expect(privacyBoundary).toContain('birth_date/document_number');
		expect(verifier).not.toContain('Approve sharing your postal code and state');
		expect(templateModal).not.toContain('postal code and state');
		expect(templateModal).not.toContain('Your device will prompt');
		expect(templateModal).not.toContain('<strong>only</strong>');
		expect(verifier).not.toContain('license number stay on your device');
		expect(helpPage).not.toContain('wallet shares only postal code, city, and state');
		expect(helpPage).not.toContain('No name, no photo, no license number');
		expect(helpPage).not.toContain('Those three fields');
		expect(privacyBoundary).not.toContain('only postal_code, city, state requested');
	});

	it('keeps wallet request fields aligned across OpenID4VP protocols', () => {
		const dcApiStart = read('src/routes/api/identity/verify-mdl/start/+server.ts');
		const dcApiRequestObject = read('src/lib/server/dc-api-openid4vp-request.ts');
		const directRequestObject = read('src/lib/server/direct-mdl-request-object.ts');
		const protocolFields = [
			'resident_postal_code',
			'resident_city',
			'resident_state',
			'birth_date',
			'document_number'
		];

		expect(dcApiStart).toContain('buildDcApiOpenId4VpRequestPayload');
		expect(dcApiStart).toContain('signDcApiOpenId4VpRequest');
		expect(dcApiStart).toContain('protocol: OPENID4VP_DC_API_PROTOCOL');
		expect(dcApiStart).toContain('data: { request }');
		expect(dcApiStart).not.toContain("response_mode: 'dc_api'");

		expect(dcApiRequestObject).toContain("response_type: 'vp_token'");
		expect(dcApiRequestObject).toContain('response_mode: DC_API_OPENID4VP_RESPONSE_MODE');
		expect(dcApiRequestObject).toContain('DC_API_OPENID4VP_RESPONSE_MODE = \'dc_api.jwt\'');
		expect(dcApiRequestObject).toContain('expected_origins: [input.origin]');
		expect(dcApiRequestObject).toContain('client_metadata');
		expect(dcApiRequestObject).toContain('jwks: { keys: [encryptionJwk] }');
		expect(dcApiRequestObject).toContain("id: 'mdl'");
		expect(dcApiRequestObject).toContain("meta: { doctype_value: 'org.iso.18013.5.1.mDL' }");
		expect(dcApiRequestObject).not.toContain("protocol: 'openid4vp'");
		expect(dcApiRequestObject).not.toContain("doctype: 'org.iso.18013.5.1.mDL'");
		for (const field of protocolFields) {
			expect(dcApiRequestObject).toContain(field);
			expect(dcApiRequestObject).toContain(`path: ['org.iso.18013.5.1', '${field}']`);
		}
		expect(dcApiRequestObject.match(/intent_to_retain: false(?!;)/g)?.length).toBe(
			protocolFields.length
		);

		expect(directRequestObject).toContain("response_type: 'vp_token'");
		expect(directRequestObject).toContain('response_mode: DIRECT_MDL_TRANSPORT');
		expect(directRequestObject).toContain("id: 'mdl'");
		expect(directRequestObject).toContain("meta: { doctype_value: 'org.iso.18013.5.1.mDL' }");
		for (const field of protocolFields) {
			expect(directRequestObject).toContain(field);
			expect(directRequestObject).toContain(`path: ['org.iso.18013.5.1', '${field}']`);
		}
		expect(directRequestObject.match(/intent_to_retain: false(?!;)/g)?.length).toBe(
			protocolFields.length
		);
	});

	it('keeps direct QR disabled for every deploy build while deletion is queued', () => {
		const deployWorkflow = read('.github/workflows/deploy.yml');
		const features = read('src/lib/config/features.ts');
		const directRoutes = [
			read('src/routes/api/identity/direct-mdl/start/+server.ts'),
			read('src/routes/api/identity/direct-mdl/request/[sessionId]/+server.ts'),
			read('src/routes/api/identity/direct-mdl/complete/+server.ts'),
			read('src/routes/api/identity/direct-mdl/stream/[sessionId]/+server.ts'),
			read('src/routes/api/identity/direct-mdl/cancel/+server.ts')
		];

		expect(deployWorkflow).toContain('VITE_ENVIRONMENT=staging');
		expect(deployWorkflow).toContain('VITE_ENVIRONMENT=production');
		expect(deployWorkflow).toContain('VITE_ENVIRONMENT=development');
		expect(deployWorkflow).not.toContain('VITE_MDL_DIRECT_QR=1');
		expect(deployWorkflow).not.toContain('VITE_MDL_DIRECT_QR_ORIGIN=https://');
		expect(features).toContain('VITE_MDL_DIRECT_QR');
		expect(features).toContain('VITE_MDL_DIRECT_QR_ORIGIN');
		expect(features).toContain('may only be enabled for staging or production builds');
		expect(features).toContain('must match the deployment environment origin');
		expect(features).not.toContain('MDL_DIRECT_QR: true');
		for (const source of directRoutes) {
			expect(source).toContain(
				'requireMdlDirectQrEnabled(platform?.env?.PUBLIC_APP_URL, url.origin)'
			);
		}
	});

	it('fails browser-mediated mDL start closed when production session KV is missing', () => {
		const dcApiStart = read('src/routes/api/identity/verify-mdl/start/+server.ts');

		expect(dcApiStart).toContain('if (!kv && !dev)');
		expect(dcApiStart).toContain('DC_SESSION_KV not configured in production');
		expect(dcApiStart).toContain("throw error(500, 'mDL verifier misconfigured')");
	});
});
