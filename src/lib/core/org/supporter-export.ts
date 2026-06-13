/**
 * Supporter takeout — fetch-all paging, client-side decryption, CSV + JSON builders.
 *
 * Custody invariant: supporter PII is encrypted with the org key and the server
 * cannot decrypt it. Everything here runs in the browser — pages of ciphertext
 * come down, the org key opens them locally, and the assembled files leave
 * through a Blob download. Plaintext never goes back over the network.
 *
 * The fetch-all + decrypt helpers are intentionally generic so other
 * client-side list features (search, dedup) can reuse them.
 */

import { decryptOrgPii, type OrgEncryptedPii } from '$lib/core/crypto/org-pii-encryption';

// ─── Fetch-all paging ───────────────────────────────────────────────────────

export interface SupporterPageResult<T> {
	supporters: T[];
	nextCursor: string | null;
	hasMore: boolean;
}

/**
 * Page a cursor-based supporter list to exhaustion.
 *
 * The server scans at most 10,000 rows per org list query, so exhaustion here
 * means "everything the list endpoint can reach" — callers compare the result
 * count against the org total to detect truncation (see `exportSummary`).
 * Guards against repeated cursors so a misbehaving endpoint cannot loop.
 */
export async function fetchAllSupporters<T>(
	fetchPage: (cursor: string | null) => Promise<SupporterPageResult<T>>,
	onProgress?: (fetched: number) => void
): Promise<T[]> {
	const all: T[] = [];
	const seenCursors = new Set<string>();
	let cursor: string | null = null;

	for (;;) {
		const page = await fetchPage(cursor);
		all.push(...page.supporters);
		onProgress?.(all.length);
		if (!page.hasMore || !page.nextCursor) break;
		if (seenCursors.has(page.nextCursor)) break;
		seenCursors.add(page.nextCursor);
		cursor = page.nextCursor;
	}

	return all;
}

// ─── Client-side decryption ─────────────────────────────────────────────────

/** Encrypted supporter row as returned by the list query (ciphertext blobs). */
export interface EncryptedSupporterRecord {
	id: string;
	encryptedEmail?: string | null;
	emailHash?: string | null;
	encryptedName?: string | null;
	encryptedPhone?: string | null;
	encryptedCustomFields?: string | null;
	postalCode?: string | null;
	stateCode?: string | null;
	country?: string | null;
	verified?: boolean;
	identityVerified?: boolean;
	emailStatus?: string | null;
	smsStatus?: string | null;
	source?: string | null;
	emailConsentSource?: string | null;
	emailConsentedAt?: number | null;
	emailConsentText?: string | null;
	smsConsentSource?: string | null;
	smsConsentedAt?: number | null;
	smsConsentText?: string | null;
	importedAt?: number | null;
	tags?: Array<{ name: string }>;
}

/** Supporter row after the org key opened it in the browser. */
export interface DecryptedSupporterRow {
	id: string;
	email: string;
	name: string;
	phone: string;
	postalCode: string;
	stateCode: string;
	country: string;
	verified: boolean;
	identityVerified: boolean;
	emailStatus: string;
	smsStatus: string;
	source: string;
	emailConsentSource: string;
	emailConsentedAt: string;
	emailConsentText: string;
	smsConsentSource: string;
	smsConsentedAt: string;
	smsConsentText: string;
	tags: string[];
	importedAt: string;
	customFields: Record<string, unknown> | null;
}

const DECRYPT_BATCH_SIZE = 25;

function toIso(timestamp: number | null | undefined): string {
	return typeof timestamp === 'number' && Number.isFinite(timestamp)
		? new Date(timestamp).toISOString()
		: '';
}

async function decryptField(
	blob: string | null | undefined,
	orgKey: CryptoKey,
	emailHash: string,
	entityId: string,
	fieldName: string
): Promise<string> {
	if (!blob) return '';
	try {
		return await decryptOrgPii(
			JSON.parse(blob) as OrgEncryptedPii,
			orgKey,
			emailHash,
			entityId,
			fieldName
		);
	} catch {
		// Wrong key, corrupt blob, or AAD mismatch — leave the field empty
		// rather than failing the whole export.
		return '';
	}
}

async function decryptRecord(
	record: EncryptedSupporterRecord,
	orgKey: CryptoKey
): Promise<DecryptedSupporterRow> {
	const emailHash = record.emailHash ?? '';
	const entityId = `supporter:${record.id}`;

	const [email, name, phone, customFieldsJson] = await Promise.all([
		decryptField(record.encryptedEmail, orgKey, emailHash, entityId, 'email'),
		decryptField(record.encryptedName, orgKey, emailHash, entityId, 'name'),
		decryptField(record.encryptedPhone, orgKey, emailHash, entityId, 'phone'),
		decryptField(record.encryptedCustomFields, orgKey, emailHash, entityId, 'customFields')
	]);

	let customFields: Record<string, unknown> | null = null;
	if (customFieldsJson) {
		try {
			const parsed: unknown = JSON.parse(customFieldsJson);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				customFields = parsed as Record<string, unknown>;
			}
		} catch {
			customFields = null;
		}
	}

	return {
		id: record.id,
		email,
		name,
		phone,
		postalCode: record.postalCode ?? '',
		stateCode: record.stateCode ?? '',
		country: record.country ?? '',
		verified: record.verified ?? false,
		identityVerified: record.identityVerified ?? false,
		emailStatus: record.emailStatus ?? '',
		smsStatus: record.smsStatus ?? '',
		source: record.source ?? '',
		emailConsentSource: record.emailConsentSource ?? '',
		emailConsentedAt: toIso(record.emailConsentedAt),
		emailConsentText: record.emailConsentText ?? '',
		smsConsentSource: record.smsConsentSource ?? '',
		smsConsentedAt: toIso(record.smsConsentedAt),
		smsConsentText: record.smsConsentText ?? '',
		tags: (record.tags ?? []).map((tag) => tag.name),
		importedAt: toIso(record.importedAt),
		customFields
	};
}

/**
 * Decrypt supporter rows with the org key, in batches so large lists keep the
 * UI responsive and the caller can show a running count.
 */
export async function decryptSupporterRows(
	records: EncryptedSupporterRecord[],
	orgKey: CryptoKey,
	onProgress?: (done: number, total: number) => void
): Promise<DecryptedSupporterRow[]> {
	const rows: DecryptedSupporterRow[] = [];
	for (let i = 0; i < records.length; i += DECRYPT_BATCH_SIZE) {
		const batch = records.slice(i, i + DECRYPT_BATCH_SIZE);
		const decrypted = await Promise.all(batch.map((record) => decryptRecord(record, orgKey)));
		rows.push(...decrypted);
		onProgress?.(rows.length, records.length);
	}
	return rows;
}

// ─── CSV builder ────────────────────────────────────────────────────────────

export const SUPPORTER_CSV_COLUMNS = [
	'email',
	'name',
	'phone',
	'postalCode',
	'stateCode',
	'country',
	'verified',
	'identityVerified',
	'emailStatus',
	'smsStatus',
	'source',
	'emailConsentSource',
	'emailConsentedAt',
	'emailConsentText',
	'smsConsentSource',
	'smsConsentedAt',
	'smsConsentText',
	'tags',
	'importedAt',
	'customFields'
] as const;

/**
 * Neutralize spreadsheet formula injection: a leading `=`, `@`, or a leading
 * `+`/`-` that is not part of a number (so `+15551234567` phone values pass
 * through untouched) gets an apostrophe prefix. A leading tab (0x09) or CR
 * (0x0D) is also a formula trigger per OWASP — Excel/LibreOffice strip the
 * control character and evaluate the rest — so those prefixes are guarded too.
 */
function guardFormula(value: string): string {
	if (/^[=@\t\r]/.test(value) || /^[+-](?![0-9])/.test(value)) {
		return `'${value}`;
	}
	return value;
}

function csvCell(value: string): string {
	const guarded = guardFormula(value);
	if (/[",\r\n]/.test(guarded)) {
		return `"${guarded.replace(/"/g, '""')}"`;
	}
	return guarded;
}

/**
 * Build the takeout CSV. Always emits the header row, so a zero-supporter org
 * downloads a header-only file. RFC 4180 line endings.
 */
export function buildSupporterCsv(rows: DecryptedSupporterRow[]): string {
	const lines: string[] = [SUPPORTER_CSV_COLUMNS.join(',')];

	for (const row of rows) {
		const cells = [
			row.email,
			row.name,
			row.phone,
			row.postalCode,
			row.stateCode,
			row.country,
			row.verified ? 'true' : 'false',
			row.identityVerified ? 'true' : 'false',
			row.emailStatus,
			row.smsStatus,
			row.source,
			row.emailConsentSource,
			row.emailConsentedAt,
			row.emailConsentText,
			row.smsConsentSource,
			row.smsConsentedAt,
			row.smsConsentText,
			row.tags.join('; '),
			row.importedAt,
			row.customFields ? JSON.stringify(row.customFields) : ''
		];
		lines.push(cells.map(csvCell).join(','));
	}

	return lines.join('\r\n') + '\r\n';
}

// ─── JSON sidecar (tags + segment definitions) ──────────────────────────────

export interface TakeoutSidecarInput {
	org: { slug: string; name?: string };
	tags: Array<{ name: string; supporterCount?: number }>;
	segments: Array<{ name: string; filters: unknown; createdAt?: number; updatedAt?: number }>;
	exportedAt?: Date;
}

/**
 * Org-shaped sidecar: the tag list and saved segment definitions that give the
 * CSV its structure, exported as JSON next to it.
 */
export function buildTakeoutSidecar(input: TakeoutSidecarInput): string {
	const exportedAt = input.exportedAt ?? new Date();
	return JSON.stringify(
		{
			organization: {
				slug: input.org.slug,
				...(input.org.name ? { name: input.org.name } : {})
			},
			exportedAt: exportedAt.toISOString(),
			tags: input.tags.map((tag) => ({
				name: tag.name,
				...(typeof tag.supporterCount === 'number' ? { supporterCount: tag.supporterCount } : {})
			})),
			segments: input.segments.map((segment) => ({
				name: segment.name,
				filters: segment.filters ?? null,
				...(typeof segment.createdAt === 'number'
					? { createdAt: new Date(segment.createdAt).toISOString() }
					: {}),
				...(typeof segment.updatedAt === 'number'
					? { updatedAt: new Date(segment.updatedAt).toISOString() }
					: {})
			}))
		},
		null,
		2
	);
}

// ─── Export summary ─────────────────────────────────────────────────────────

export interface ExportSummary {
	truncated: boolean;
	message: string;
}

/**
 * States exactly how many of how many rows the export reached. The list query
 * scans at most 10,000 rows per org, so very large lists truncate honestly.
 */
export function exportSummary(exportedCount: number, totalCount: number): ExportSummary {
	const fmt = (n: number) => n.toLocaleString('en-US');
	const truncated = totalCount > exportedCount;
	return {
		truncated,
		message: truncated
			? `Exported ${fmt(exportedCount)} of ${fmt(totalCount)} people. The remaining ${fmt(totalCount - exportedCount)} rows are beyond the per-export scan limit.`
			: `Exported ${fmt(exportedCount)} of ${fmt(totalCount)} people.`
	};
}

// ─── Browser download ───────────────────────────────────────────────────────

export function takeoutFilenames(orgSlug: string, date: Date = new Date()) {
	const stamp = date.toISOString().slice(0, 10);
	return {
		csv: `${orgSlug}-people-${stamp}.csv`,
		sidecar: `${orgSlug}-people-${stamp}.json`
	};
}

/**
 * Hand a locally assembled file to the browser. The Blob lives entirely on
 * this device — no upload, no request.
 */
export function downloadTextFile(content: string, filename: string, mimeType: string): void {
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
