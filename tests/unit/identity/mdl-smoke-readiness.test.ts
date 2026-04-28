import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('Android mDL live-smoke readiness', () => {
	it('propagates the bridge credential hash back to the desktop verifier', () => {
		const bridgeStream = read('src/routes/api/identity/bridge/stream/[sessionId]/+server.ts');
		const directStream = read('src/routes/api/identity/direct-mdl/stream/[sessionId]/+server.ts');
		const verifier = read('src/lib/components/auth/GovernmentCredentialVerification.svelte');

		expect(bridgeStream).toContain('credentialHash: current.result?.credentialHash');
		expect(directStream).toContain('credentialHash: session.result?.credentialHash');
		expect(verifier).toContain('const credentialHash =');
		expect(verifier).toContain('/^[0-9a-f]{64}$/i.test(credentialHash)');
		expect(verifier).toContain('data.identityCommitmentBound !== true');
		expect(verifier).toContain('verification.requireReauth === true');
		expect(verifier).toContain('data.requireReauth === true');
		expect(verifier).toContain('credentialHash,');
		expect(verifier).not.toContain("credentialHash: ''");
		expect(verifier).not.toContain('credentialHash: data.credentialHash');
	});

	it('discloses the mDL fields requested by the wallet prompt', () => {
		const verifier = read('src/lib/components/auth/GovernmentCredentialVerification.svelte');
		const mobileBridge = read('src/routes/verify-bridge/[sessionId]/+page.svelte');
		const helpPage = read('src/routes/help/verification/+page.svelte');
		const privacyBoundary = read('src/lib/core/identity/mdl-verification.ts');
		const requestedFields = 'postal code, city, state, birth date, and document number';

		expect(verifier).toContain(requestedFields);
		expect(mobileBridge).toContain(requestedFields);
		expect(helpPage).toContain(requestedFields);
		expect(privacyBoundary).toContain('birth_date/document_number');
		expect(verifier).not.toContain('Approve sharing your postal code and state');
		expect(mobileBridge).not.toContain('Approve sharing your postal code and state');
		expect(mobileBridge).not.toContain('share your postal code with your wallet');
		expect(verifier).not.toContain('license number stay on your device');
		expect(helpPage).not.toContain('wallet shares only postal code, city, and state');
		expect(helpPage).not.toContain('No name, no photo, no license number');
		expect(helpPage).not.toContain('Those three fields');
		expect(privacyBoundary).not.toContain('only postal_code, city, state requested');
	});

	it('keeps wallet request fields aligned across OpenID4VP protocols', () => {
		const dcApiStarts = [
			read('src/routes/api/identity/bridge/start/+server.ts'),
			read('src/routes/api/identity/verify-mdl/start/+server.ts')
		];
		const directRequestObject = read('src/lib/server/direct-mdl-request-object.ts');
		const protocolFields = [
			'resident_postal_code',
			'resident_city',
			'resident_state',
			'birth_date',
			'document_number'
		];

		for (const source of dcApiStarts) {
			expect(source).toContain("protocol: OPENID4VP_DC_API_PROTOCOL");
			expect(source).toContain("response_type: 'vp_token'");
			expect(source).toContain("response_mode: 'dc_api'");
			expect(source).toContain("id: 'mdl'");
			expect(source).toContain("meta: { doctype_value: 'org.iso.18013.5.1.mDL' }");
			expect(source).not.toContain("protocol: 'openid4vp'");
			expect(source).not.toContain("doctype: 'org.iso.18013.5.1.mDL'");
			expect(source).not.toContain('client_id:');
			for (const field of protocolFields) {
				expect(source).toContain(field);
				expect(source).toContain(`path: ['org.iso.18013.5.1', '${field}']`);
			}
			expect(source.match(/intent_to_retain: false/g)?.length).toBe(protocolFields.length);
		}

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

	it('enables direct QR only for staging and production deploy builds', () => {
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
		expect(deployWorkflow).toContain('VITE_MDL_DIRECT_QR=1');
		expect(deployWorkflow).toContain(
			'VITE_MDL_DIRECT_QR_ORIGIN=https://staging.commons.email'
		);
		expect(deployWorkflow).toContain('VITE_ENVIRONMENT=production');
		expect(deployWorkflow).toContain('VITE_MDL_DIRECT_QR_ORIGIN=https://commons.email');
		expect(deployWorkflow).toContain('VITE_ENVIRONMENT=development');
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
});
