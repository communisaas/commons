/**
 * Shared input budget for every supporter create/update/import boundary.
 *
 * Supporter rows are returned through byte-bounded browse/audience pages. A
 * single unbounded encrypted blob would make those pages SplitRequired forever,
 * so writers must prevent an individual row from approaching the 512 KiB read
 * ceiling. All limits are UTF-8 bytes (never JavaScript code units).
 */
export const MAX_SUPPORTER_INPUT_ROW_BYTES = 32 * 1024;
export const MAX_SUPPORTER_INPUT_BATCH_BYTES = 512 * 1024;
export const MAX_SUPPORTER_TAG_INPUTS = 100;
export const MAX_SUPPORTER_TAG_ID_BYTES = 64;

export const SUPPORTER_STRING_FIELD_MAX_BYTES = Object.freeze({
	email: 320,
	name: 512,
	phone: 64,
	encryptedEmail: 8 * 1024,
	encryptedName: 8 * 1024,
	encryptedPhone: 8 * 1024,
	encryptedCustomFields: 16 * 1024,
	emailHash: 128,
	globalEmailHash: 128,
	phoneHash: 128,
	globalPhoneHash: 128,
	postalCode: 64,
	stateCode: 32,
	congressionalDistrict: 64,
	country: 32,
	source: 128,
	browseSource: 128,
	emailStatus: 32,
	smsStatus: 32,
	emailConsentSource: 512,
	emailConsentText: 4 * 1024,
	smsConsentSource: 512,
	smsConsentText: 4 * 1024,
	identityCommitment: 512
} as const);

const MAX_CUSTOM_FIELDS_BYTES = 16 * 1024;
const MAX_CUSTOM_FIELD_KEY_BYTES = 128;
const MAX_CUSTOM_FIELD_VALUE_BYTES = 4 * 1024;
const MAX_CUSTOM_FIELD_COUNT = 100;
const encoder = new TextEncoder();

function utf8Bytes(value: string): number {
	return encoder.encode(value).byteLength;
}

function serializedBytes(value: unknown, label: string): number {
	let serialized: string | undefined;
	try {
		serialized = JSON.stringify(value);
	} catch {
		throw new Error(`${label}_INVALID`);
	}
	if (serialized === undefined) throw new Error(`${label}_INVALID`);
	return utf8Bytes(serialized);
}

function code(field: string): string {
	return field
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/[^a-zA-Z0-9]+/g, '_')
		.toUpperCase();
}

function assertTagIds(raw: unknown, label: string): void {
	if (raw === undefined) return;
	if (!Array.isArray(raw)) throw new Error(`${label}_TAG_IDS_INVALID`);
	if (raw.length > MAX_SUPPORTER_TAG_INPUTS) throw new Error(`${label}_TAG_IDS_TOO_MANY`);
	for (const tagId of raw) {
		if (typeof tagId !== 'string' || utf8Bytes(tagId) > MAX_SUPPORTER_TAG_ID_BYTES) {
			throw new Error(`${label}_TAG_ID_TOO_LARGE`);
		}
	}
}

function assertCustomFields(raw: unknown, label: string): void {
	if (raw === undefined) return;
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new Error(`${label}_CUSTOM_FIELDS_INVALID`);
	}
	const entries = Object.entries(raw as Record<string, unknown>);
	if (entries.length > MAX_CUSTOM_FIELD_COUNT) {
		throw new Error(`${label}_CUSTOM_FIELDS_TOO_MANY`);
	}
	for (const [key, value] of entries) {
		if (utf8Bytes(key) > MAX_CUSTOM_FIELD_KEY_BYTES) {
			throw new Error(`${label}_CUSTOM_FIELD_KEY_TOO_LARGE`);
		}
		if (typeof value !== 'string') throw new Error(`${label}_CUSTOM_FIELD_VALUE_INVALID`);
		if (utf8Bytes(value) > MAX_CUSTOM_FIELD_VALUE_BYTES) {
			throw new Error(`${label}_CUSTOM_FIELD_VALUE_TOO_LARGE`);
		}
	}
	if (serializedBytes(raw, `${label}_CUSTOM_FIELDS`) > MAX_CUSTOM_FIELDS_BYTES) {
		throw new Error(`${label}_CUSTOM_FIELDS_TOO_LARGE`);
	}
}

export function assertSupporterInputBudget(
	row: Record<string, unknown>,
	label = 'SUPPORTER_INPUT'
): void {
	for (const [field, maxBytes] of Object.entries(SUPPORTER_STRING_FIELD_MAX_BYTES)) {
		const value = row[field];
		if (value === undefined || value === null) continue;
		if (typeof value !== 'string') throw new Error(`${label}_${code(field)}_INVALID`);
		if (utf8Bytes(value) > maxBytes) {
			throw new Error(`${label}_${code(field)}_TOO_LARGE`);
		}
	}
	assertTagIds(row.tagIds, label);
	assertTagIds(row.browseTagIds, label);
	assertCustomFields(row.customFields, label);
	if (serializedBytes(row, label) > MAX_SUPPORTER_INPUT_ROW_BYTES) {
		throw new Error(`${label}_ROW_TOO_LARGE`);
	}
}

export function assertSupporterInputBatchBudget(
	rows: Array<Record<string, unknown>>,
	label = 'SUPPORTER_IMPORT'
): void {
	if (serializedBytes(rows, `${label}_BATCH`) > MAX_SUPPORTER_INPUT_BATCH_BYTES) {
		throw new Error(`${label}_BATCH_TOO_LARGE`);
	}
	for (const row of rows) assertSupporterInputBudget(row, label);
}
