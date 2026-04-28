/**
 * W3C Digital Credentials API Type Declarations
 *
 * Browser API for requesting identity credentials (mDL, EUDIW) from device wallets.
 * Protocol availability is browser- and wallet-specific; callers must use
 * DigitalCredential.userAgentAllowsProtocol(...) before making a request.
 *
 * @see https://w3c-fedid.github.io/digital-credentials/
 */

interface DigitalCredentialRequestOptions {
	requests: Array<{
		protocol: string;
		data: unknown;
	}>;
}

interface DigitalCredentialResponse {
	protocol: string;
	data: unknown;
}

interface CredentialRequestOptions {
	digital?: DigitalCredentialRequestOptions;
}

/**
 * DigitalCredential class — available when browser supports Digital Credentials API.
 * Feature detection: `typeof DigitalCredential !== 'undefined'`
 */
declare class DigitalCredential extends Credential {
	readonly protocol: string;
	readonly data: unknown;

	/**
	 * Check if the user agent supports a specific protocol.
	 * @param protocol - e.g., 'org-iso-mdoc' or 'openid4vp'
	 */
	static userAgentAllowsProtocol?(protocol: string): boolean;
}
