/**
 * W3C Digital Credentials API -- Client-Side Interface
 *
 * Feature detection, protocol support checking, and credential request wrapper
 * for mDL verification via browser-native wallet interaction.
 *
 * Browser support: Chrome 141+ (org-iso-mdoc + openid4vp), Safari 26+ (org-iso-mdoc only)
 *
 * @see https://w3c-fedid.github.io/digital-credentials/
 */

/**
 * Check if the browser supports the Digital Credentials API.
 * Feature detection: `typeof DigitalCredential !== 'undefined'`
 */
export function isDigitalCredentialsSupported(): boolean {
	return typeof window !== 'undefined' && typeof DigitalCredential !== 'undefined';
}

/**
 * Check which protocols the browser/device supports.
 * Chrome: org-iso-mdoc + openid4vp
 * Safari: org-iso-mdoc only
 */
export async function getSupportedProtocols(): Promise<{
	mdoc: boolean;
	openid4vp: boolean;
}> {
	if (!isDigitalCredentialsSupported()) {
		return { mdoc: false, openid4vp: false };
	}

	// userAgentAllowsProtocol may not be available in all implementations
	const checkProtocol = DigitalCredential.userAgentAllowsProtocol;
	if (!checkProtocol) {
		// Assume mdoc is available if DC API is supported (conservative fallback)
		return { mdoc: true, openid4vp: false };
	}

	return {
		mdoc: checkProtocol('org-iso-mdoc'),
		openid4vp: checkProtocol('openid4vp')
	};
}

export interface CredentialRequestConfig {
	requests: Array<{
		protocol: string;
		data: unknown;
	}>;
}

export type CredentialRequestResult =
	| {
			success: true;
			protocol: string;
			data: unknown;
	  }
	| {
			success: false;
			error: 'unsupported' | 'user_cancelled' | 'timeout' | 'no_credential' | 'unknown';
			message: string;
	  };

/**
 * Request a digital credential from the user's wallet.
 *
 * Wraps navigator.credentials.get({ digital }) with:
 * - AbortController timeout (60s for wallet interaction)
 * - Graceful AbortError handling for user dismissal
 * - Typed error responses
 */
export async function requestCredential(
	config: CredentialRequestConfig
): Promise<CredentialRequestResult> {
	if (!isDigitalCredentialsSupported()) {
		return {
			success: false,
			error: 'unsupported',
			message: 'Digital Credentials API is not supported in this browser'
		};
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 60_000); // 60s for wallet interaction

	try {
		// For org-iso-mdoc, the server sends CBOR as base64 over JSON.
		// The DC API expects binary (ArrayBuffer), so decode before passing to the wallet.
		const processedRequests = config.requests.map((req) => {
			if (req.protocol === 'org-iso-mdoc' && typeof req.data === 'string') {
				const binaryStr = atob(req.data);
				const bytes = new Uint8Array(binaryStr.length);
				for (let i = 0; i < binaryStr.length; i++) {
					bytes[i] = binaryStr.charCodeAt(i);
				}
				return { ...req, data: bytes.buffer };
			}
			return req;
		});

		const credential = await navigator.credentials.get({
			digital: { requests: processedRequests },
			signal: controller.signal
		} as CredentialRequestOptions);

		clearTimeout(timeoutId);

		if (!credential || !(credential instanceof DigitalCredential)) {
			return {
				success: false,
				error: 'no_credential',
				message: 'No credential returned from wallet'
			};
		}

		// Normalize response data to a JSON-safe string.
		// org-iso-mdoc returns ArrayBuffer (CBOR); must encode to base64.
		// openid4vp returns a string or object; stringify if needed.
		let responseData: unknown = credential.data;
		if (responseData instanceof ArrayBuffer) {
			const bytes = new Uint8Array(responseData);
			// Binary → base64 for JSON transport
			let binary = '';
			for (let i = 0; i < bytes.length; i++) {
				binary += String.fromCharCode(bytes[i]);
			}
			responseData = btoa(binary);
		} else if (typeof responseData === 'object' && responseData !== null) {
			responseData = JSON.stringify(responseData);
		}

		return {
			success: true,
			protocol: credential.protocol,
			data: responseData
		};
	} catch (err) {
		clearTimeout(timeoutId);

		if (err instanceof DOMException) {
			if (err.name === 'AbortError') {
				// Could be user dismissal OR timeout
				if (controller.signal.aborted) {
					return {
						success: false,
						error: 'timeout',
						message: 'Wallet interaction timed out after 60 seconds'
					};
				}
				return {
					success: false,
					error: 'user_cancelled',
					message: 'Credential request was cancelled'
				};
			}
			if (err.name === 'NotAllowedError') {
				return {
					success: false,
					error: 'user_cancelled',
					message: 'User denied the credential request'
				};
			}
		}

		return {
			success: false,
			error: 'unknown',
			message: err instanceof Error ? err.message : 'Unknown error requesting credential'
		};
	}
}
