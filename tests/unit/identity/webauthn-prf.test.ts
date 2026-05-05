import { describe, expect, it, vi } from 'vitest';
import {
	buildPRFAuthenticationExtension,
	buildPRFRegistrationExtension,
	detectWebAuthnPRFClientSupport,
	extractPRFAssertionResults,
	stripPRFResultsFromAuthenticationResponse
} from '$lib/core/identity/webauthn-prf';

describe('detectWebAuthnPRFClientSupport', () => {
	it('reports unsupported when WebAuthn is unavailable', async () => {
		const result = await detectWebAuthnPRFClientSupport({});

		expect(result).toMatchObject({
			webAuthnAvailable: false,
			getClientCapabilitiesAvailable: false,
			clientPRF: 'unsupported',
			userVerifyingPlatformAuthenticator: 'unknown'
		});
	});

	it('reports PRF client support from getClientCapabilities', async () => {
		const result = await detectWebAuthnPRFClientSupport({
			PublicKeyCredential: {
				getClientCapabilities: vi.fn().mockResolvedValue({
					'extension:prf': true,
					conditionalGet: true
				}),
				isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true)
			}
		});

		expect(result.webAuthnAvailable).toBe(true);
		expect(result.getClientCapabilitiesAvailable).toBe(true);
		expect(result.clientPRF).toBe('supported');
		expect(result.userVerifyingPlatformAuthenticator).toBe('supported');
		expect(result.rawCapabilities?.conditionalGet).toBe(true);
	});

	it('keeps PRF support unknown when capability reporting is absent', async () => {
		const result = await detectWebAuthnPRFClientSupport({
			PublicKeyCredential: {
				isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(false)
			}
		});

		expect(result).toMatchObject({
			webAuthnAvailable: true,
			getClientCapabilitiesAvailable: false,
			clientPRF: 'unknown',
			userVerifyingPlatformAuthenticator: 'unsupported'
		});
	});

	it('does not treat a client capability error as proof of unsupported PRF', async () => {
		const result = await detectWebAuthnPRFClientSupport({
			PublicKeyCredential: {
				getClientCapabilities: vi.fn().mockRejectedValue(new Error('blocked')),
				isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockRejectedValue(new Error('blocked'))
			}
		});

		expect(result.clientPRF).toBe('unknown');
		expect(result.userVerifyingPlatformAuthenticator).toBe('unknown');
		expect(result.reason).toBe('blocked');
	});
});

describe('PRF extension builders', () => {
	it('builds registration extension input with cloned salts', () => {
		const first = new Uint8Array([1, 2, 3, 4]);
		const second = new Uint8Array([5, 6, 7, 8]);

		const extension = buildPRFRegistrationExtension(first, second);

		expect(extension.prf.eval.first).toBeInstanceOf(ArrayBuffer);
		expect(extension.prf.eval.second).toBeInstanceOf(ArrayBuffer);
		expect([...new Uint8Array(extension.prf.eval.first)]).toEqual([1, 2, 3, 4]);
		expect([...new Uint8Array(extension.prf.eval.second!)]).toEqual([5, 6, 7, 8]);
	});

	it('builds authentication extension input for a specific credential', () => {
		const extension = buildPRFAuthenticationExtension(
			'cred_base64url',
			new Uint8Array([9]),
			new Uint8Array([10])
		);

		expect(extension.prf.evalByCredential.cred_base64url.first).toBeInstanceOf(ArrayBuffer);
		expect([...new Uint8Array(extension.prf.evalByCredential.cred_base64url.first)]).toEqual([9]);
		expect([...new Uint8Array(extension.prf.evalByCredential.cred_base64url.second!)]).toEqual([
			10
		]);
	});

	it('rejects empty credential ids for authentication input', () => {
		expect(() => buildPRFAuthenticationExtension(' ', new Uint8Array([1]))).toThrow(
			'credentialIdBase64URL is required'
		);
	});
});

describe('extractPRFAssertionResults', () => {
	it('extracts 32-byte PRF outputs from client extension results', () => {
		const first = new ArrayBuffer(32);
		const second = new ArrayBuffer(32);

		const result = extractPRFAssertionResults({
			getClientExtensionResults: () => ({
				prf: { results: { first, second } }
			})
		});

		expect(result.status).toBe('available');
		expect(result.first).toBe(first);
		expect(result.second).toBe(second);
	});

	it('reports unsupported when PRF extension output is absent', () => {
		const result = extractPRFAssertionResults({
			getClientExtensionResults: () => ({})
		});

		expect(result.status).toBe('unsupported');
	});

	it('reports missing output when PRF is present without first result', () => {
		const result = extractPRFAssertionResults({
			getClientExtensionResults: () => ({ prf: { results: {} } })
		});

		expect(result.status).toBe('missing-output');
	});

	it('rejects non-32-byte output', () => {
		const result = extractPRFAssertionResults({
			getClientExtensionResults: () => ({
				prf: { results: { first: new ArrayBuffer(31) } }
			})
		});

		expect(result.status).toBe('invalid-output');
	});
});

describe('stripPRFResultsFromAuthenticationResponse', () => {
	it('removes PRF results before server verification payloads', () => {
		const response = {
			id: 'credential-id',
			clientExtensionResults: {
				prf: { results: { first: new ArrayBuffer(32) } },
				largeBlob: { supported: true }
			}
		};

		const stripped = stripPRFResultsFromAuthenticationResponse(response);

		expect(stripped).not.toBe(response);
		expect(stripped.clientExtensionResults).toEqual({
			largeBlob: { supported: true }
		});
	});

	it('returns the original response when PRF results are absent', () => {
		const response = {
			id: 'credential-id',
			clientExtensionResults: {
				largeBlob: { supported: true }
			}
		};

		expect(stripPRFResultsFromAuthenticationResponse(response)).toBe(response);
	});
});
