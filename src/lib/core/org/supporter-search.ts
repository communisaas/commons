/**
 * Free-text People search — pure matching over rows the org key already
 * opened in this browser.
 *
 * Custody invariant: supporter PII is org-key encrypted and the server cannot
 * decrypt it, so there is no server-side substring search to call. Matching
 * happens here, in memory, over client-decrypted rows. The only thing a
 * search ever sends over the network is an org-scoped email hash, and only
 * when the query is a complete address — that exact lookup rides the
 * `by_orgId_emailHash` index instead of a client scan.
 *
 * Upgrade path, deliberately not built yet: when lists outgrow full
 * client-side decryption, store org-key HMAC blind-index tokens per supporter
 * (normalized name/email fragments hashed under a key only the org holds) so
 * the server can narrow candidate rows without ever learning plaintext.
 * Current list sizes make the full client-side scan the simpler honest
 * answer.
 */

/**
 * Mirrors the per-query scan bound in `convex/supporters.ts` (`MAX_SCAN`):
 * the list endpoint reads at most this many rows per org, so a full client
 * scan can never search past it.
 */
export const SUPPORTER_SEARCH_SCAN_CAP = 10_000;

const MIN_TEXT_QUERY_LENGTH = 2;
const MIN_PHONE_SUFFIX_DIGITS = 4;

/** A complete address — something@domain.tld — with no whitespace. */
const FULL_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type ParsedSupporterQuery =
	| { kind: 'empty' }
	| { kind: 'email'; email: string }
	| { kind: 'text'; text: string; digits: string };

/** Lowercase, fold diacritics, collapse whitespace — "María " matches "maria". */
export function normalizeSearchText(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

function normalizePostal(value: string): string {
	return value.toLowerCase().replace(/\s+/g, '');
}

function digitsOf(value: string): string {
	return value.replace(/\D/g, '');
}

export function isFullEmail(value: string): boolean {
	return FULL_EMAIL_PATTERN.test(value.trim());
}

/**
 * Classify a raw search box value. Complete email addresses take the exact
 * server-lookup path; everything else with enough signal becomes an
 * in-memory text query; queries too short to mean anything are empty.
 */
export function parseSearchQuery(raw: string): ParsedSupporterQuery {
	const trimmed = raw.trim();
	if (!trimmed) return { kind: 'empty' };
	if (FULL_EMAIL_PATTERN.test(trimmed)) {
		return { kind: 'email', email: trimmed.toLowerCase() };
	}
	const text = normalizeSearchText(trimmed);
	const digits = digitsOf(trimmed);
	if (text.length < MIN_TEXT_QUERY_LENGTH && digits.length < MIN_PHONE_SUFFIX_DIGITS) {
		return { kind: 'empty' };
	}
	return { kind: 'text', text, digits };
}

/** The decrypted fields a row needs to be searchable. */
export interface SupporterSearchFields {
	name?: string | null;
	email?: string | null;
	postalCode?: string | null;
	phone?: string | null;
}

/**
 * Match one decrypted row against a parsed query: normalized name or email
 * substring, postal-code prefix, or phone suffix (last 4+ digits).
 */
export function matchesSupporterQuery(
	row: SupporterSearchFields,
	query: ParsedSupporterQuery
): boolean {
	if (query.kind === 'empty') return false;
	if (query.kind === 'email') {
		return (row.email ?? '').trim().toLowerCase() === query.email;
	}

	const { text, digits } = query;
	if (text.length >= MIN_TEXT_QUERY_LENGTH) {
		if (normalizeSearchText(row.name ?? '').includes(text)) return true;
		if (normalizeSearchText(row.email ?? '').includes(text)) return true;
		const postalQuery = normalizePostal(text);
		if (postalQuery && normalizePostal(row.postalCode ?? '').startsWith(postalQuery)) return true;
	}
	if (digits.length >= MIN_PHONE_SUFFIX_DIGITS) {
		const phoneDigits = digitsOf(row.phone ?? '');
		if (phoneDigits && phoneDigits.endsWith(digits)) return true;
	}
	return false;
}

export function filterSupporters<T extends SupporterSearchFields>(
	rows: T[],
	query: ParsedSupporterQuery
): T[] {
	if (query.kind === 'empty') return [];
	return rows.filter((row) => matchesSupporterQuery(row, query));
}

// ─── Structural filter composition ──────────────────────────────────────────

/**
 * The structural filters the People table already offers. Search results pass
 * through the same predicates so the text query narrows within the active
 * filters instead of escaping them.
 */
export interface StructuralFilterCriteria {
	emailStatus?: string;
	verified?: boolean;
	source?: string;
	/** Tag name the row must carry (resolved from the tag filter by the caller). */
	tagName?: string;
}

export interface StructurallyFilterableRow {
	emailStatus?: string | null;
	verified?: boolean;
	source?: string | null;
	tags?: readonly string[];
}

export function passesStructuralFilters(
	row: StructurallyFilterableRow,
	criteria: StructuralFilterCriteria
): boolean {
	if (criteria.emailStatus && (row.emailStatus ?? '') !== criteria.emailStatus) return false;
	if (criteria.verified !== undefined && (row.verified ?? false) !== criteria.verified) {
		return false;
	}
	if (criteria.source) {
		const rowSource =
			typeof row.source === 'string' && row.source.trim() ? row.source.trim() : 'unknown';
		if (rowSource !== criteria.source) return false;
	}
	if (criteria.tagName && !(row.tags ?? []).includes(criteria.tagName)) return false;
	return true;
}

// ─── Coverage honesty ───────────────────────────────────────────────────────

export interface SearchCoverage {
	/** True only when every row on the list has been decrypted and searched. */
	complete: boolean;
	message: string;
}

/**
 * States plainly how much of the list a search has actually reached — while
 * rows are still decrypting, and when the per-query scan cap leaves rows
 * beyond reach.
 */
export function searchCoverage(input: {
	scannedCount: number;
	totalCount: number;
	scanning: boolean;
	scanCap?: number;
}): SearchCoverage {
	const cap = input.scanCap ?? SUPPORTER_SEARCH_SCAN_CAP;
	const fmt = (n: number) => n.toLocaleString('en-US');
	const total = Math.max(input.totalCount, input.scannedCount);

	if (input.scanning) {
		return {
			complete: false,
			message:
				input.scannedCount === 0
					? 'Preparing search — decrypting your list in this browser…'
					: `Searching ${fmt(input.scannedCount)} of ${fmt(total)} people while the rest decrypt…`
		};
	}
	if (total > input.scannedCount) {
		return {
			complete: false,
			message:
				input.scannedCount >= cap
					? `Search covers the first ${fmt(input.scannedCount)} of ${fmt(total)} people; rows beyond the scan limit are not searched.`
					: `Search covers ${fmt(input.scannedCount)} of ${fmt(total)} people.`
		};
	}
	return { complete: true, message: '' };
}
