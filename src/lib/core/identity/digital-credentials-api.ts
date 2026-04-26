/**
 * W3C Digital Credentials API -- Client-Side Interface
 *
 * Feature detection, protocol support checking, and credential request wrapper
 * for mDL verification via browser-native wallet interaction.
 *
 * Browser support: Chrome 141+ (org-iso-mdoc + OpenID4VP v1), Safari 26+ (org-iso-mdoc only)
 *
 * @see https://w3c-fedid.github.io/digital-credentials/
 */
import {
	LEGACY_OPENID4VP_PROTOCOL,
	OPENID4VP_DC_API_PROTOCOL,
	isMdlProtocolEnabled
} from '$lib/config/features';

/**
 * Detect whether this is a mobile device (has a local wallet).
 * Desktop browsers should use the cross-device bridge instead of the DC API's
 * CTAP2 hybrid transport, which crashes Chrome's renderer on macOS.
 *
 * iPadOS 13+ reports a macOS UA string — detect via maxTouchPoints.
 */
export function isMobileDevice(): boolean {
	if (typeof navigator === 'undefined') return false;
	const ua = navigator.userAgent;
	const uadPlatform =
		(
			navigator as Navigator & { userAgentData?: { platform?: string } }
		).userAgentData?.platform?.toLowerCase() ?? '';
	if (uadPlatform === 'android' || ua.includes('Android')) return true;
	if (/iPhone|iPad/.test(ua)) return true;
	// iPadOS 13+ lies: reports Macintosh UA. Detect via touch capability.
	if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 0) return true;
	return false;
}

/**
 * Check if the browser supports the Digital Credentials API.
 * Feature detection: `typeof DigitalCredential !== 'undefined'`
 */
export function isDigitalCredentialsSupported(): boolean {
	return typeof window !== 'undefined' && typeof DigitalCredential !== 'undefined';
}

/**
 * Check if the same-device DC API flow should be used.
 * Returns true only on mobile devices with DC API support.
 * Desktop browsers should always use the cross-device bridge.
 */
export function shouldUseSameDeviceFlow(): boolean {
	return isMobileDevice() && isDigitalCredentialsSupported();
}

/**
 * Check which protocols the browser/device supports.
 * Chrome: org-iso-mdoc + OpenID4VP v1
 * Safari: org-iso-mdoc only
 */
export function getSupportedProtocols(): {
	mdoc: boolean;
	openid4vp: boolean;
} {
	if (!isDigitalCredentialsSupported()) {
		return { mdoc: false, openid4vp: false };
	}

	// userAgentAllowsProtocol may not be available in all implementations
	if (!DigitalCredential.userAgentAllowsProtocol) {
		// Assume mdoc is available if DC API is supported (conservative fallback)
		return { mdoc: true, openid4vp: false };
	}

	return {
		mdoc: DigitalCredential.userAgentAllowsProtocol('org-iso-mdoc'),
		openid4vp: DigitalCredential.userAgentAllowsProtocol(OPENID4VP_DC_API_PROTOCOL)
	};
}

// --- DEBUG: Crash breadcrumbs (survives renderer crash via localStorage) ---
function debugBreadcrumb(step: string, data: Record<string, unknown>) {
	try {
		const crumbs = JSON.parse(localStorage.getItem('dc-debug') || '[]');
		crumbs.push({ step, ...data, ts: Date.now() });
		localStorage.setItem('dc-debug', JSON.stringify(crumbs));
	} catch {
		/* storage full or unavailable */
	}
}
// --- END DEBUG ---

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
 * - Protocol filtering (only pass protocols the browser supports)
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
		debugBreadcrumb('pre-process', {
			protocols: config.requests.map((r) => r.protocol),
			dataTypes: config.requests.map((r) => typeof r.data)
		});

		// For org-iso-mdoc, the server sends CBOR as base64 over JSON.
		// The DC API expects binary (ArrayBuffer), so decode before passing to the wallet.
		let processedRequests = config.requests.map((req) => {
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

		// Filter to only protocols supported by this browser.
		// Safari only supports org-iso-mdoc; passing unsupported protocols
		// may crash the Credential Request Coordinator.
		const supported = getSupportedProtocols();
		const userAgentAllowsProtocol =
			DigitalCredential.userAgentAllowsProtocol?.bind(DigitalCredential);
		const protocolAllowed: Record<string, boolean> = {
			'org-iso-mdoc':
				(userAgentAllowsProtocol?.('org-iso-mdoc') ?? supported.mdoc) &&
				isMdlProtocolEnabled('org-iso-mdoc'),
			[OPENID4VP_DC_API_PROTOCOL]:
				(userAgentAllowsProtocol?.(OPENID4VP_DC_API_PROTOCOL) ?? supported.openid4vp) &&
				isMdlProtocolEnabled(OPENID4VP_DC_API_PROTOCOL),
			[LEGACY_OPENID4VP_PROTOCOL]:
				(userAgentAllowsProtocol?.(LEGACY_OPENID4VP_PROTOCOL) ?? false) &&
				isMdlProtocolEnabled(LEGACY_OPENID4VP_PROTOCOL)
		};
		processedRequests = processedRequests.filter((req) => protocolAllowed[req.protocol] ?? false);

		debugBreadcrumb('post-filter', {
			supported,
			survivingProtocols: processedRequests.map((r) => r.protocol)
		});

		if (processedRequests.length === 0) {
			return {
				success: false,
				error: 'unsupported',
				message: `No requested protocols are supported by this browser (checked: ${JSON.stringify(supported)})`
			};
		}

		debugBreadcrumb('pre-get', {
			protocols: processedRequests.map((r) => r.protocol),
			requestCount: processedRequests.length
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

		debugBreadcrumb('post-get-success', {
			protocol: credential.protocol,
			dataType: typeof responseData
		});

		return {
			success: true,
			protocol: credential.protocol,
			data: responseData
		};
	} catch (err) {
		clearTimeout(timeoutId);

		debugBreadcrumb('catch', {
			errorName: err instanceof Error ? err.name : 'non-Error',
			errorMessage: err instanceof Error ? err.message : String(err),
			aborted: controller.signal.aborted
		});

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
