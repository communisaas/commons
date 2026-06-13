import { redirect, fail } from '@sveltejs/kit';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { parseCSV } from '$lib/server/csv';
import { serverAction } from 'convex-sveltekit';
import {
	PEOPLE_IMPORT_FIELD_ALIASES,
	detectPlatformExportProfile,
	normalizePlatformExportHeader,
	type PlatformSource
} from '$lib/data/platform-export-profiles';
import type { PageServerLoad, Actions } from './$types';

function requireRole(role: string, required: string): void {
	const hierarchy = ['viewer', 'member', 'editor', 'owner'];
	if (hierarchy.indexOf(role) < hierarchy.indexOf(required)) {
		throw new Error(`Role '${required}' required, got '${role}'`);
	}
}

export const load: PageServerLoad = async ({ parent }) => {
	const { membership } = await parent();
	requireRole(membership.role, 'editor');
	return {};
};

// Email status strictness ordering — higher index = stricter
const EMAIL_STATUS_RANK: Record<string, number> = {
	subscribed: 0,
	unsubscribed: 1,
	bounced: 2,
	complained: 3
};

const VALID_IMPORT_FIELD_NAMES = new Set([
	'skip',
	'email',
	'name',
	'first_name',
	'last_name',
	'postalCode',
	'stateCode',
	'congressionalDistrict',
	'phone',
	'country',
	'tags',
	'can_message',
	'sms_consent',
	'email_consent_source',
	'email_consented_at',
	'email_consent_text',
	'sms_consent_source',
	'sms_consented_at',
	'sms_consent_text',
	'custom'
]);

function stricterStatus(a: string, b: string): string {
	const rankA = EMAIL_STATUS_RANK[a] ?? 0;
	const rankB = EMAIL_STATUS_RANK[b] ?? 0;
	return rankA >= rankB ? a : b;
}

interface MappedRow {
	email: string;
	name: string | null;
	postalCode: string | null;
	stateCode: string | null;
	congressionalDistrict: string | null;
	phone: string | null;
	country: string | null;
	customFields: Record<string, string>;
	source: PlatformSource;
	emailStatus: string;
	smsStatus: string;
	emailConsentSource: string | null;
	emailConsentedAt: number | null;
	emailConsentText: string | null;
	smsConsentSource: string | null;
	smsConsentedAt: number | null;
	smsConsentText: string | null;
	tags: string[];
}

function customFieldLabel(header: string, index: number): string {
	const cleaned = header.trim().replace(/\s+/g, ' ');
	return cleaned || `Column ${index + 1}`;
}

function buildCustomFieldLabels(headers: string[]): string[] {
	const seen = new Map<string, number>();
	return headers.map((header, index) => {
		const base = customFieldLabel(header, index).slice(0, 80);
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		return count === 0 ? base : `${base} ${count + 1}`;
	});
}

function cleanBounded(value: string | undefined, limit: number): string | null {
	const cleaned = value?.trim().replace(/\s+/g, ' ') ?? '';
	return cleaned ? cleaned.slice(0, limit) : null;
}

function parseConsentTimestamp(value: string | undefined): number | null {
	const cleaned = value?.trim();
	if (!cleaned) return null;
	if (/^\d+$/.test(cleaned)) {
		const n = Number(cleaned);
		if (!Number.isFinite(n) || n <= 0) return null;
		return n < 10_000_000_000 ? n * 1000 : n;
	}
	const parsed = Date.parse(cleaned);
	return Number.isFinite(parsed) ? parsed : null;
}

function importedConsentSource(source: PlatformSource, fieldName: 'email' | 'sms'): string {
	return `import:${source}:${fieldName}`;
}

function resolveMapping(headers: string[]): Record<number, string> {
	const mapping: Record<number, string> = {};
	for (let i = 0; i < headers.length; i++) {
		const normalized = normalizePlatformExportHeader(headers[i]);
		if (PEOPLE_IMPORT_FIELD_ALIASES[normalized]) {
			mapping[i] = PEOPLE_IMPORT_FIELD_ALIASES[normalized];
		}
	}
	return mapping;
}

function applyMapping(
	row: string[],
	mapping: Record<number, string>,
	clientMapping: Record<string, string> | null,
	customFieldLabels: string[],
	source: PlatformSource
): MappedRow | null {
	const fields: Record<string, string> = {};
	const customFields: Record<string, string> = {};

	for (let i = 0; i < row.length; i++) {
		const value = row[i]?.trim() ?? '';
		if (!value) continue;

		let fieldName: string | undefined;
		const clientField = clientMapping?.[String(i)];
		if (clientField && VALID_IMPORT_FIELD_NAMES.has(clientField)) {
			fieldName = clientField;
		} else {
			fieldName = mapping[i];
		}
		if (fieldName === 'custom') {
			const key = customFieldLabels[i] ?? `Column ${i + 1}`;
			customFields[key] = value;
		} else if (fieldName && fieldName !== 'skip') {
			fields[fieldName] = value;
		}
	}

	const email = fields['email']?.toLowerCase();
	if (!email || !email.includes('@')) return null;

	let name = fields['name'] || null;
	if (!name && (fields['first_name'] || fields['last_name'])) {
		name = [fields['first_name'], fields['last_name']].filter(Boolean).join(' ');
	}

	let emailStatus = 'subscribed';
	let emailConsentSource: string | null = null;
	let emailConsentedAt: number | null = null;
	let emailConsentText: string | null = null;
	if (fields['can_message'] !== undefined) {
		const val = fields['can_message'].toLowerCase();
		if (
			val === 'false' ||
			val === '0' ||
			val === 'no' ||
			val === 'unsubscribed' ||
			val === 'opted out'
		) {
			emailStatus = 'unsubscribed';
		} else if (val === 'bounced' || val === 'bouncing' || val === 'previous bounce') {
			emailStatus = 'bounced';
		} else if (
			val === 'spam complaint' ||
			val === 'previous spam complaint' ||
			val === 'complained'
		) {
			emailStatus = 'complained';
		}
		emailConsentSource =
			cleanBounded(fields['email_consent_source'], 120) ?? importedConsentSource(source, 'email');
		emailConsentedAt = parseConsentTimestamp(fields['email_consented_at']);
		emailConsentText = cleanBounded(fields['email_consent_text'], 1000);
	}
	if (!emailConsentSource) {
		emailConsentSource = cleanBounded(fields['email_consent_source'], 120);
		emailConsentedAt = parseConsentTimestamp(fields['email_consented_at']);
		emailConsentText = cleanBounded(fields['email_consent_text'], 1000);
		if ((emailConsentedAt || emailConsentText) && !emailConsentSource) {
			emailConsentSource = importedConsentSource(source, 'email');
		}
	}

	let smsStatus = 'none';
	let smsConsentSource: string | null = null;
	let smsConsentedAt: number | null = null;
	let smsConsentText: string | null = null;
	if (fields['sms_consent'] !== undefined) {
		const val = fields['sms_consent'].toLowerCase();
		if (val === 'true' || val === '1' || val === 'yes' || val === 'subscribed') {
			smsStatus = 'subscribed';
		} else if (val === 'false' || val === '0' || val === 'no' || val === 'unsubscribed') {
			smsStatus = 'unsubscribed';
		} else if (val === 'stopped' || val === 'stop') {
			smsStatus = 'stopped';
		}
		smsConsentSource =
			cleanBounded(fields['sms_consent_source'], 120) ?? importedConsentSource(source, 'sms');
		smsConsentedAt = parseConsentTimestamp(fields['sms_consented_at']);
		smsConsentText = cleanBounded(fields['sms_consent_text'], 1000);
	}
	if (!smsConsentSource) {
		smsConsentSource = cleanBounded(fields['sms_consent_source'], 120);
		smsConsentedAt = parseConsentTimestamp(fields['sms_consented_at']);
		smsConsentText = cleanBounded(fields['sms_consent_text'], 1000);
		if ((smsConsentedAt || smsConsentText) && !smsConsentSource) {
			smsConsentSource = importedConsentSource(source, 'sms');
		}
	}

	const tags: string[] = [];
	if (fields['tags']) {
		for (const t of fields['tags'].split(/[;,|]/)) {
			const trimmed = t.trim();
			if (trimmed) tags.push(trimmed);
		}
	}

	return {
		email,
		name,
		postalCode: fields['postalCode'] || null,
		stateCode: cleanBounded(fields['stateCode'], 8)?.toUpperCase() ?? null,
		congressionalDistrict:
			cleanBounded(fields['congressionalDistrict'], 32)?.toUpperCase() ?? null,
		phone: fields['phone'] || null,
		country: fields['country'] || null,
		customFields,
		source,
		emailStatus,
		smsStatus,
		emailConsentSource,
		emailConsentedAt,
		emailConsentText,
		smsConsentSource,
		smsConsentedAt,
		smsConsentText,
		tags
	};
}

const BATCH_SIZE = 100;

export const actions: Actions = {
	import: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters/import`);
		}

		const formData = await request.formData();
		const file = formData.get('csv_file');
		const mappingJson = formData.get('column_mapping')?.toString() || null;

		if (!file || !(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'Please upload a CSV file.' });
		}

		if (file.size > 10 * 1024 * 1024) {
			return fail(400, { error: 'File too large. Maximum size is 10MB.' });
		}

		// Bound the JSON mapping payload before JSON.parse.
		// 64KB covers any reasonable per-column mapping (200 columns × per-column kv).
		if (mappingJson && mappingJson.length > 65_536) {
			return fail(400, { error: 'Column mapping is too large.' });
		}

		let text: string;
		try {
			text = await file.text();
		} catch {
			return fail(400, { error: 'Could not read file.' });
		}

		const { headers, rows } = parseCSV(text);
		if (headers.length === 0 || rows.length === 0) {
			return fail(400, { error: 'CSV file is empty or has no data rows.' });
		}

		const autoMapping = resolveMapping(headers);
		const customFieldLabels = buildCustomFieldLabels(headers);
		const detectedPlatform = detectPlatformExportProfile(headers);
		const importSource = detectedPlatform?.source ?? 'csv';
		let clientMapping: Record<string, string> | null = null;
		if (mappingJson) {
			try {
				clientMapping = JSON.parse(mappingJson);
			} catch {
				/* ignore */
			}
		}

		const effectiveMapping = { ...autoMapping };
		if (clientMapping) {
			for (const [idx, field] of Object.entries(clientMapping)) {
				if (!VALID_IMPORT_FIELD_NAMES.has(field)) continue;
				if (field === 'skip') {
					delete effectiveMapping[Number(idx)];
				} else {
					effectiveMapping[Number(idx)] = field;
				}
			}
		}
		const hasEmailCol = Object.values(effectiveMapping).includes('email');
		if (!hasEmailCol) {
			return fail(400, {
				error: 'No email column detected. Please map at least one column to "email".'
			});
		}

		let imported = 0;
		let updated = 0;
		let skipped = 0;
		let consentEvidence = 0;
		const errors: string[] = [];
		const allTagNames = new Set<string>();

		const mappedRows: { mapped: MappedRow; rowNum: number }[] = [];
		for (let i = 0; i < rows.length; i++) {
			const mapped = applyMapping(
				rows[i],
				autoMapping,
				clientMapping,
				customFieldLabels,
				importSource
			);
			if (!mapped) {
				skipped++;
				continue;
			}
			mappedRows.push({ mapped, rowNum: i + 2 });
			for (const t of mapped.tags) allTagNames.add(t);
		}

		// Pre-create all tags via Convex
		let tagIdMap: Record<string, string> = {};
		if (allTagNames.size > 0) {
			const result = await serverMutation(api.supporters.ensureTags, {
				slug: params.slug,
				tagNames: [...allTagNames]
			});
			tagIdMap = result.tagMap;
		}

		// Process supporters in batches — PII encryption in SvelteKit, write via Convex
		for (let batchStart = 0; batchStart < mappedRows.length; batchStart += BATCH_SIZE) {
			const batch = mappedRows.slice(batchStart, batchStart + BATCH_SIZE);

			try {
				// Build plaintext batch — encryption happens server-side in Convex
				const plaintextBatch = batch
					.map(({ mapped, rowNum }) => {
						try {
							return {
								email: mapped.email,
								name: mapped.name || undefined,
								phone: mapped.phone || undefined,
								postalCode: mapped.postalCode || undefined,
								stateCode: mapped.stateCode || undefined,
								congressionalDistrict: mapped.congressionalDistrict || undefined,
								country: mapped.country || undefined,
								emailStatus: mapped.emailStatus,
								smsStatus: mapped.smsStatus,
								emailConsentSource: mapped.emailConsentSource || undefined,
								emailConsentedAt: mapped.emailConsentedAt || undefined,
								emailConsentText: mapped.emailConsentText || undefined,
								smsConsentSource: mapped.smsConsentSource || undefined,
								smsConsentedAt: mapped.smsConsentedAt || undefined,
								smsConsentText: mapped.smsConsentText || undefined,
								tagIds: mapped.tags.map((t: string) => tagIdMap[t]).filter(Boolean),
								customFields:
									Object.keys(mapped.customFields).length > 0 ? mapped.customFields : undefined,
								source: mapped.source
							};
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							errors.push(`Row ${rowNum}: ${msg}`);
							return null;
						}
					})
					.filter(Boolean) as Array<{
					email: string;
					name?: string;
					phone?: string;
					postalCode?: string;
					stateCode?: string;
					congressionalDistrict?: string;
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
					source: PlatformSource;
				}>;

				if (plaintextBatch.length > 0) {
					const result = await serverAction(api.supporters.importWithEncryption, {
						slug: params.slug,
						supporters: plaintextBatch
					});
					imported += result.imported;
					updated += result.updated;
					skipped += result.skipped;
					consentEvidence += plaintextBatch.filter(
						(row) => row.emailConsentSource || row.smsConsentSource
					).length;
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				errors.push(`Batch starting at row ${batch[0]?.rowNum ?? '?'}: ${msg}`);
				skipped += batch.length;
			}
		}

		return {
			success: true,
			summary: {
				imported,
				updated,
				skipped,
				tags_created: allTagNames.size - Object.keys(tagIdMap).length,
				custom_fields: Object.values(effectiveMapping).filter((field) => field === 'custom').length,
				consent_evidence: consentEvidence,
				source: detectedPlatform?.label ?? 'CSV / unknown export',
				errors: errors.slice(0, 20)
			}
		};
	}
};
