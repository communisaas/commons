/**
 * Bound and scrub provider-controlled error text before it reaches a client or trace.
 *
 * Provider SDK errors can contain response bodies, request URLs, credentials, and
 * terminal control characters. Keep this deliberately small and deterministic so
 * every outward-facing provider error has the same ceiling and redaction posture.
 */

export const PROVIDER_ERROR_MAX_BYTES = 512;

const PROVIDER_ERROR_SCAN_MAX_CHARS = 4_096;
const REDACTED_CREDENTIAL = '[redacted-credential]';

const CREDENTIAL_PATTERNS: readonly RegExp[] = Object.freeze([
	/Bearer\s+[A-Za-z0-9._~+/-]{20,}/giu,
	/Basic\s+[A-Za-z0-9+/=]{20,}/giu,
	/AIza[0-9A-Za-z_-]{35}/gu,
	/gsk_[A-Za-z0-9]{40,}/giu,
	/fc-[A-Za-z0-9_-]{20,}/giu,
	/exa[_-][A-Za-z0-9_-]{20,}/giu,
	/\b(?:authorization|proxy-authorization|gemini[_-]?api[_-]?key|google[_-]?api[_-]?key|api[ _-]?key|x-goog-api-key|x-api-key)["']?\s*[:=]\s*["']?[^\s"',;}\]]{8,}/giu
]);

function errorText(error: unknown, fallback: string): string {
	try {
		if (error instanceof Error) return error.message || fallback;
		if (typeof error === 'string') return error || fallback;
		return String(error);
	} catch {
		return fallback;
	}
}

function truncateUtf8(value: string, maxBytes: number): string {
	const encoder = new TextEncoder();
	if (maxBytes <= 0) return '';
	if (encoder.encode(value).byteLength <= maxBytes) return value;

	const suffix = '…';
	const suffixBytes = encoder.encode(suffix).byteLength;
	const appendSuffix = maxBytes >= suffixBytes;
	const contentBudget = maxBytes - (appendSuffix ? suffixBytes : 0);
	let used = 0;
	let truncated = '';
	for (const character of value) {
		const bytes = encoder.encode(character).byteLength;
		if (used + bytes > contentBudget) break;
		truncated += character;
		used += bytes;
	}
	return appendSuffix ? `${truncated.trimEnd()}${suffix}` : truncated;
}

function scrubProviderText(value: string): string {
	let scrubbed = value
		.slice(0, PROVIDER_ERROR_SCAN_MAX_CHARS)
		.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim();

	for (const pattern of CREDENTIAL_PATTERNS) {
		scrubbed = scrubbed.replace(pattern, REDACTED_CREDENTIAL);
	}
	return scrubbed;
}

/**
 * Normalize a provider-controlled text field for prompts, traces, or client
 * metadata. The byte ceiling may only tighten the shared 512-byte envelope.
 */
export function sanitizeProviderControlledText(
	value: unknown,
	maxBytes = PROVIDER_ERROR_MAX_BYTES,
	fallback = ''
): string {
	const ceiling = Number.isSafeInteger(maxBytes)
		? Math.max(0, Math.min(maxBytes, PROVIDER_ERROR_MAX_BYTES))
		: PROVIDER_ERROR_MAX_BYTES;
	const safeFallback = scrubProviderText(fallback);
	const raw = typeof value === 'string' ? value : safeFallback;
	return truncateUtf8(scrubProviderText(raw) || safeFallback, ceiling);
}

/** Return credential-free, single-line provider error text within a UTF-8 byte ceiling. */
export function sanitizeProviderErrorMessage(
	error: unknown,
	fallback = 'Provider request failed'
): string {
	const safeFallback =
		sanitizeProviderControlledText(fallback, PROVIDER_ERROR_MAX_BYTES) || 'Provider request failed';
	return sanitizeProviderControlledText(
		errorText(error, safeFallback),
		PROVIDER_ERROR_MAX_BYTES,
		safeFallback
	);
}
