/**
 * WebAuthn PRF capability and extension helpers.
 *
 * This module is browser-safe: callers can import it during SSR, but should
 * only run probes in a browser. PRF output is client key material and must not
 * be sent to the server.
 */

export type PRFSupport = 'supported' | 'unsupported' | 'unknown';

export interface WebAuthnPRFClientProbe {
	webAuthnAvailable: boolean;
	getClientCapabilitiesAvailable: boolean;
	clientPRF: PRFSupport;
	userVerifyingPlatformAuthenticator: PRFSupport;
	rawCapabilities?: Record<string, boolean>;
	reason?: string;
}

export type PRFAssertionStatus = 'available' | 'unsupported' | 'missing-output' | 'invalid-output';

export interface PRFAssertionResults {
	status: PRFAssertionStatus;
	first?: ArrayBuffer;
	second?: ArrayBuffer;
	reason?: string;
}

type PublicKeyCredentialConstructorWithCapabilities = {
	getClientCapabilities?: () => Promise<Record<string, boolean>>;
	isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
};

type WebAuthnScope = {
	PublicKeyCredential?: PublicKeyCredentialConstructorWithCapabilities;
};

type PRFValuesInput = {
	first: ArrayBuffer;
	second?: ArrayBuffer;
};

type PRFExtensionResults = {
	prf?: {
		enabled?: boolean;
		results?: {
			first?: unknown;
			second?: unknown;
		};
	};
};

type PublicKeyCredentialWithExtensions = {
	getClientExtensionResults?: () => PRFExtensionResults & Record<string, unknown>;
};

const PRF_CLIENT_CAPABILITY_KEY = 'extension:prf';
const PRF_OUTPUT_BYTES = 32;

export async function detectWebAuthnPRFClientSupport(
	scope: WebAuthnScope = globalThis as WebAuthnScope
): Promise<WebAuthnPRFClientProbe> {
	const publicKeyCredential = scope.PublicKeyCredential;

	if (!publicKeyCredential) {
		return {
			webAuthnAvailable: false,
			getClientCapabilitiesAvailable: false,
			clientPRF: 'unsupported',
			userVerifyingPlatformAuthenticator: 'unknown',
			reason: 'PublicKeyCredential is not available'
		};
	}

	const userVerifyingPlatformAuthenticator =
		await detectUserVerifyingPlatformAuthenticator(publicKeyCredential);

	if (!publicKeyCredential.getClientCapabilities) {
		return {
			webAuthnAvailable: true,
			getClientCapabilitiesAvailable: false,
			clientPRF: 'unknown',
			userVerifyingPlatformAuthenticator,
			reason: 'getClientCapabilities is not available'
		};
	}

	try {
		const rawCapabilities = await publicKeyCredential.getClientCapabilities();
		const prfCapability = rawCapabilities[PRF_CLIENT_CAPABILITY_KEY];

		return {
			webAuthnAvailable: true,
			getClientCapabilitiesAvailable: true,
			clientPRF:
				prfCapability === true ? 'supported' : prfCapability === false ? 'unsupported' : 'unknown',
			userVerifyingPlatformAuthenticator,
			rawCapabilities
		};
	} catch (err) {
		return {
			webAuthnAvailable: true,
			getClientCapabilitiesAvailable: true,
			clientPRF: 'unknown',
			userVerifyingPlatformAuthenticator,
			reason: err instanceof Error ? err.message : 'Could not read WebAuthn client capabilities'
		};
	}
}

export function buildPRFRegistrationExtension(first: BufferSource, second?: BufferSource) {
	return {
		prf: {
			eval: buildPRFValues(first, second)
		}
	};
}

export function buildPRFAuthenticationExtension(
	credentialIdBase64URL: string,
	first: BufferSource,
	second?: BufferSource
) {
	const credentialId = credentialIdBase64URL.trim();
	if (!credentialId) {
		throw new Error('credentialIdBase64URL is required for PRF authentication');
	}

	return {
		prf: {
			evalByCredential: {
				[credentialId]: buildPRFValues(first, second)
			}
		}
	};
}

export function extractPRFAssertionResults(
	credential: PublicKeyCredentialWithExtensions
): PRFAssertionResults {
	const extensionResults = credential.getClientExtensionResults?.();
	if (!extensionResults?.prf) {
		return {
			status: 'unsupported',
			reason: 'PRF extension output was not returned'
		};
	}

	const first = extensionResults.prf.results?.first;
	const second = extensionResults.prf.results?.second;

	if (!first) {
		return {
			status: 'missing-output',
			reason: 'PRF extension was present but did not return first output'
		};
	}

	if (!isArrayBuffer(first) || first.byteLength !== PRF_OUTPUT_BYTES) {
		return {
			status: 'invalid-output',
			reason: 'PRF first output was not a 32-byte ArrayBuffer'
		};
	}

	if (second !== undefined && (!isArrayBuffer(second) || second.byteLength !== PRF_OUTPUT_BYTES)) {
		return {
			status: 'invalid-output',
			reason: 'PRF second output was not a 32-byte ArrayBuffer'
		};
	}

	return {
		status: 'available',
		first,
		second: isArrayBuffer(second) ? second : undefined
	};
}

export function stripPRFResultsFromAuthenticationResponse<
	T extends { clientExtensionResults?: Record<string, unknown> }
>(response: T): T {
	const clientExtensionResults = response.clientExtensionResults;
	if (!clientExtensionResults || !('prf' in clientExtensionResults)) {
		return response;
	}

	const { prf: _prf, ...safeClientExtensionResults } = clientExtensionResults;
	return {
		...response,
		clientExtensionResults: safeClientExtensionResults
	};
}

function buildPRFValues(first: BufferSource, second?: BufferSource): PRFValuesInput {
	const values: PRFValuesInput = {
		first: toArrayBuffer(first)
	};

	if (second !== undefined) {
		values.second = toArrayBuffer(second);
	}

	return values;
}

function toArrayBuffer(source: BufferSource): ArrayBuffer {
	if (source instanceof ArrayBuffer) {
		return source.slice(0);
	}

	if (ArrayBuffer.isView(source)) {
		const view = source as ArrayBufferView;
		return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
	}

	throw new Error('PRF salt must be an ArrayBuffer or ArrayBuffer view');
}

async function detectUserVerifyingPlatformAuthenticator(
	publicKeyCredential: PublicKeyCredentialConstructorWithCapabilities
): Promise<PRFSupport> {
	if (!publicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
		return 'unknown';
	}

	try {
		return (await publicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
			? 'supported'
			: 'unsupported';
	} catch {
		return 'unknown';
	}
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
	return (
		value instanceof ArrayBuffer || Object.prototype.toString.call(value) === '[object ArrayBuffer]'
	);
}
