import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('mDL live-smoke readiness', () => {
	it('keeps credential hash and identity binding on the browser-mediated mDL path', () => {
		const verifyRoute = read('src/routes/api/identity/verify-mdl/verify/+server.ts');
		const verifier = read('src/lib/components/auth/GovernmentCredentialVerification.svelte');

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
		expect(templateModal).toContain('showVerificationGate = true');
		expect(templateModal).not.toContain('requestCredential');
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

	it('keeps wallet request fields aligned on the signed browser-mediated protocol', () => {
		const dcApiStart = read('src/routes/api/identity/verify-mdl/start/+server.ts');
		const dcApiRequestObject = read('src/lib/server/dc-api-openid4vp-request.ts');
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
		expect(dcApiRequestObject).toContain("DC_API_OPENID4VP_RESPONSE_MODE = 'dc_api.jwt'");
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
	});

	it('has no direct QR route, helper, deploy flag, env sample, or readiness surface', () => {
		const deployWorkflow = read('.github/workflows/deploy.yml');
		const features = read('src/lib/config/features.ts');
			const readiness = read('src/routes/api/internal/identity/mdl-readiness/+server.ts');
			const envExample = read('.env.example');
			const wrangler = read('wrangler.toml');
			const identityPatternDoc = read('docs/design/patterns/identity-verification.md');
			const removedPaths = [
			'src/routes/api/identity/direct-mdl/start/+server.ts',
			'src/routes/api/identity/direct-mdl/request/[sessionId]/+server.ts',
			'src/routes/api/identity/direct-mdl/complete/+server.ts',
			'src/routes/api/identity/direct-mdl/stream/[sessionId]/+server.ts',
			'src/routes/api/identity/direct-mdl/cancel/+server.ts',
			'src/lib/server/direct-mdl-session.ts',
			'src/lib/server/direct-mdl-request-object.ts',
			'src/lib/core/identity/oid4vp-direct-handover.ts',
			'docs/design/DIRECT-OPENID4VP-QR.md'
		];
			const surfaces = [
				deployWorkflow,
				features,
				readiness,
				envExample,
				wrangler,
				identityPatternDoc
			].join('\n');

		expect(deployWorkflow).toContain('VITE_ENVIRONMENT=staging');
		expect(deployWorkflow).toContain('VITE_ENVIRONMENT=production');
		expect(deployWorkflow).toContain('VITE_ENVIRONMENT=development');
		for (const path of removedPaths) {
			expect(existsSync(path)).toBe(false);
		}
		expect(surfaces).not.toContain('VITE_MDL_DIRECT_QR');
		expect(surfaces).not.toContain('DIRECT_MDL_SESSION_KV');
			expect(surfaces).not.toContain('MDL_DIRECT_QR');
			expect(surfaces).not.toContain('/api/identity/direct-mdl');
			expect(surfaces).not.toContain('direct-mdl');
			expect(surfaces).not.toContain('scheduled for deletion after');
			expect(surfaces).not.toContain('temporary direct OpenID4VP QR stack');
		});

	it('fails browser-mediated mDL start closed when production session KV is missing', () => {
		const dcApiStart = read('src/routes/api/identity/verify-mdl/start/+server.ts');

		expect(dcApiStart).toContain('if (!kv && !dev)');
		expect(dcApiStart).toContain('DC_SESSION_KV not configured in production');
		expect(dcApiStart).toContain("throw error(500, 'mDL verifier misconfigured')");
	});
});
