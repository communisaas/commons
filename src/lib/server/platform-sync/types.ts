import type { PlatformApiSource } from '$lib/server/platform-api-token-custody';

/**
 * Normalized record shape handed to `supporters.importWithEncryption`.
 * Matches the action's `supporters` arg item exactly so adapter output can be
 * chunked straight into the existing import pipeline (editor gate, HMAC, V2
 * encryption, cross-org tag validation all apply unchanged).
 */
export type NormalizedPlatformSupporter = {
	email: string;
	name?: string;
	phone?: string;
	postalCode?: string;
	stateCode?: string;
	country?: string;
	emailStatus: string;
	smsStatus: string;
	emailConsentSource?: string;
	emailConsentedAt?: number;
	emailConsentText?: string;
	smsConsentSource?: string;
	smsConsentedAt?: number;
	smsConsentText?: string;
	tagIds: string[];
	customFields?: Record<string, string>;
	source?: string;
};

export type PlatformSyncPage = {
	records: NormalizedPlatformSupporter[];
	/** Opaque continuation cursor; null when the platform reports no further pages. */
	nextCursor: string | null;
	/** Platform-reported total when available; null when the vendor omits it. */
	totalRecords: number | null;
	/** Records the adapter dropped because the vendor row had no usable email. */
	droppedNoEmail: number;
};

export type PlatformSyncFetchOptions = {
	cursor: string | null;
	/** ISO timestamp; adapters that support modified-since filters fetch only newer records. */
	modifiedSince?: string;
	fetchImpl?: typeof fetch;
};

export type PlatformSyncAdapter = {
	source: PlatformApiSource;
	fetchPage(apiKey: string, options: PlatformSyncFetchOptions): Promise<PlatformSyncPage>;
};

export type PlatformSyncErrorCode =
	| 'auth_failed'
	| 'rate_limited'
	| 'http_error'
	| 'malformed_response';

export class PlatformSyncError extends Error {
	constructor(
		message: string,
		readonly code: PlatformSyncErrorCode
	) {
		super(message);
		this.name = 'PlatformSyncError';
	}
}
