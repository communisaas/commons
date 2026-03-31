import { redirect, fail } from '@sveltejs/kit';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { parseCSV } from '$lib/server/csv';
import { computeEmailHash, encryptPii } from '$lib/core/crypto/user-pii-encryption';
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

function stricterStatus(a: string, b: string): string {
	const rankA = EMAIL_STATUS_RANK[a] ?? 0;
	const rankB = EMAIL_STATUS_RANK[b] ?? 0;
	return rankA >= rankB ? a : b;
}

// Column header aliases → canonical field name
const COLUMN_MAP: Record<string, string> = {
	email: 'email',
	email_address: 'email',
	'email address': 'email',
	e_mail: 'email',
	name: 'name',
	full_name: 'name',
	'full name': 'name',
	first_name: 'first_name',
	'first name': 'first_name',
	last_name: 'last_name',
	'last name': 'last_name',
	postal_code: 'postalCode',
	postalcode: 'postalCode',
	zip: 'postalCode',
	zip_code: 'postalCode',
	'zip code': 'postalCode',
	zipcode: 'postalCode',
	phone: 'phone',
	phone_number: 'phone',
	'phone number': 'phone',
	country: 'country',
	tags: 'tags',
	tag: 'tags',
	can_message: 'can_message',
	sms_consent: 'sms_consent',
	can_text: 'sms_consent',
	sms_status: 'sms_consent',
	sms_opt_in: 'sms_consent'
};

interface MappedRow {
	email: string;
	name: string | null;
	postalCode: string | null;
	phone: string | null;
	country: string | null;
	emailStatus: string;
	smsStatus: string;
	tags: string[];
}

function resolveMapping(headers: string[]): Record<number, string> {
	const mapping: Record<number, string> = {};
	for (let i = 0; i < headers.length; i++) {
		const normalized = headers[i].toLowerCase().trim();
		if (COLUMN_MAP[normalized]) {
			mapping[i] = COLUMN_MAP[normalized];
		}
	}
	return mapping;
}

function applyMapping(
	row: string[],
	mapping: Record<number, string>,
	clientMapping: Record<string, string> | null
): MappedRow | null {
	const fields: Record<string, string> = {};

	for (let i = 0; i < row.length; i++) {
		const value = row[i]?.trim() ?? '';
		if (!value) continue;

		let fieldName: string | undefined;
		if (clientMapping && clientMapping[String(i)]) {
			fieldName = clientMapping[String(i)];
		} else {
			fieldName = mapping[i];
		}
		if (fieldName && fieldName !== 'skip') {
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
	if (fields['can_message'] !== undefined) {
		const val = fields['can_message'].toLowerCase();
		if (val === 'false' || val === '0' || val === 'no') {
			emailStatus = 'unsubscribed';
		}
	}

	let smsStatus = 'none';
	if (fields['sms_consent'] !== undefined) {
		const val = fields['sms_consent'].toLowerCase();
		if (val === 'true' || val === '1' || val === 'yes' || val === 'subscribed') {
			smsStatus = 'subscribed';
		}
	}

	const tags: string[] = [];
	if (fields['tags']) {
		for (const t of fields['tags'].split(',')) {
			const trimmed = t.trim();
			if (trimmed) tags.push(trimmed);
		}
	}

	return { email, name, postalCode: fields['postalCode'] || null, phone: fields['phone'] || null, country: fields['country'] || null, emailStatus, smsStatus, tags };
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
		let clientMapping: Record<string, string> | null = null;
		if (mappingJson) {
			try {
				clientMapping = JSON.parse(mappingJson);
			} catch { /* ignore */ }
		}

		const effectiveMapping = { ...autoMapping };
		if (clientMapping) {
			for (const [idx, field] of Object.entries(clientMapping)) {
				if (field === 'skip') {
					delete effectiveMapping[Number(idx)];
				} else {
					effectiveMapping[Number(idx)] = field;
				}
			}
		}
		const hasEmailCol = Object.values(effectiveMapping).includes('email');
		if (!hasEmailCol) {
			return fail(400, { error: 'No email column detected. Please map at least one column to "email".' });
		}

		let imported = 0;
		let updated = 0;
		let skipped = 0;
		const errors: string[] = [];
		const allTagNames = new Set<string>();

		const mappedRows: { mapped: MappedRow; rowNum: number }[] = [];
		for (let i = 0; i < rows.length; i++) {
			const mapped = applyMapping(rows[i], autoMapping, clientMapping);
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
				// Encrypt emails in SvelteKit
				const encryptedBatch = await Promise.all(
					batch.map(async ({ mapped, rowNum }) => {
						try {
							// NOTE: Batch import encrypts email with a synthetic UUID as entity ID.
							// This is a known pre-existing pattern — the Convex _id is only assigned
							// at insert time. Name/phone are stored as plaintext during transition;
							// a backfill action will re-encrypt with real _ids later.
							const supId = crypto.randomUUID();
							const encryptionWork: Promise<unknown>[] = [];
							let eHash: string | null = null;
							let eEncRaw: unknown = null;
							let pHash: string | undefined;

							encryptionWork.push(
								computeEmailHash(mapped.email).then((h) => { eHash = h; }),
								encryptPii(mapped.email, `supporter:${supId}`).then((e) => { eEncRaw = e; })
							);
							// Compute phone hash (deterministic — correct regardless of entity ID)
							if (mapped.phone) {
								const { computePhoneHash } = await import('$lib/core/crypto/user-pii-encryption');
								encryptionWork.push(
									computePhoneHash(mapped.phone).then((h) => { pHash = h ?? undefined; })
								);
							}

							await Promise.all(encryptionWork);
							if (!eHash || !eEncRaw) throw new Error('Email encryption failed');

							return {
								encryptedEmail: JSON.stringify(eEncRaw),
								emailHash: eHash,
								postalCode: mapped.postalCode || undefined,
								phoneHash: pHash,
								country: mapped.country || undefined,
								emailStatus: mapped.emailStatus,
								smsStatus: mapped.smsStatus,
								tagIds: mapped.tags.map((t) => tagIdMap[t]).filter(Boolean)
							};
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							errors.push(`Row ${rowNum}: ${msg}`);
							return null;
						}
					})
				);

				const validBatch = encryptedBatch.filter(Boolean) as NonNullable<typeof encryptedBatch[0]>[];

				if (validBatch.length > 0) {
					const result = await serverMutation(api.supporters.importBatch, {
						slug: params.slug,
						supporters: validBatch
					});
					imported += result.imported;
					updated += result.updated;
					skipped += result.skipped;
				}

				skipped += encryptedBatch.filter((b) => b === null).length;
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
				errors: errors.slice(0, 20)
			}
		};
	}
};
