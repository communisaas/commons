// CONVEX: Keep SvelteKit — mutation-heavy CSV import with $transaction, PII encryption, tag upserts
import { redirect, fail } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { parseCSV } from '$lib/server/csv';
import { dispatchTrigger } from '$lib/server/automation/trigger';
import { computeEmailHash, encryptPii } from '$lib/core/crypto/user-pii-encryption';
import { findSupporterByEmail } from '$lib/server/supporters/find-by-email';
import type { PageServerLoad, Actions } from './$types';

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
	// email
	email: 'email',
	email_address: 'email',
	'email address': 'email',
	e_mail: 'email',
	// name
	name: 'name',
	full_name: 'name',
	'full name': 'name',
	// first + last handled as special case
	first_name: 'first_name',
	'first name': 'first_name',
	last_name: 'last_name',
	'last name': 'last_name',
	// postal
	postal_code: 'postalCode',
	postalcode: 'postalCode',
	zip: 'postalCode',
	zip_code: 'postalCode',
	'zip code': 'postalCode',
	zipcode: 'postalCode',
	// phone
	phone: 'phone',
	phone_number: 'phone',
	'phone number': 'phone',
	// country
	country: 'country',
	// tags
	tags: 'tags',
	tag: 'tags',
	// Action Network specific
	can_message: 'can_message',
	// SMS consent
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

		// Client mapping overrides auto-detection
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

	// Require email
	const email = fields['email']?.toLowerCase();
	if (!email || !email.includes('@')) return null;

	// Merge first_name + last_name if no full name
	let name = fields['name'] || null;
	if (!name && (fields['first_name'] || fields['last_name'])) {
		name = [fields['first_name'], fields['last_name']].filter(Boolean).join(' ');
	}

	// Email status: default subscribed, derive from can_message if present
	let emailStatus = 'subscribed';
	if (fields['can_message'] !== undefined) {
		const val = fields['can_message'].toLowerCase();
		if (val === 'false' || val === '0' || val === 'no') {
			emailStatus = 'unsubscribed';
		}
	}

	// SMS consent: default 'none' (TCPA safe), only 'subscribed' with explicit consent
	let smsStatus = 'none';
	if (fields['sms_consent'] !== undefined) {
		const val = fields['sms_consent'].toLowerCase();
		if (val === 'true' || val === '1' || val === 'yes' || val === 'subscribed') {
			smsStatus = 'subscribed';
		}
	}

	// Tags: comma-separated within cell
	const tags: string[] = [];
	if (fields['tags']) {
		for (const t of fields['tags'].split(',')) {
			const trimmed = t.trim();
			if (trimmed) tags.push(trimmed);
		}
	}

	return {
		email,
		name,
		postalCode: fields['postalCode'] || null,
		phone: fields['phone'] || null,
		country: fields['country'] || null,
		emailStatus,
		smsStatus,
		tags
	};
}

const BATCH_SIZE = 100;

export const actions: Actions = {
	import: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters/import`);
		}
		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'editor');

		const formData = await request.formData();
		const file = formData.get('csv_file');
		const mappingJson = formData.get('column_mapping')?.toString() || null;

		if (!file || !(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'Please upload a CSV file.' });
		}

		// 10MB limit
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

		// Auto-detect column mapping, then overlay client-submitted overrides
		const autoMapping = resolveMapping(headers);
		let clientMapping: Record<string, string> | null = null;
		if (mappingJson) {
			try {
				clientMapping = JSON.parse(mappingJson);
			} catch {
				// Ignore bad JSON, fall back to auto-detect
			}
		}

		// Check that email column exists in the effective mapping
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

		// Process in batches
		let imported = 0;
		let updated = 0;
		let skipped = 0;
		const errors: string[] = [];
		const allTagNames = new Set<string>();
		let tagsCreated = 0;

		// Pre-collect all unique tag names for batch creation
		const mappedRows: { mapped: MappedRow; rowNum: number }[] = [];
		for (let i = 0; i < rows.length; i++) {
			const mapped = applyMapping(rows[i], autoMapping, clientMapping);
			if (!mapped) {
				skipped++;
				continue;
			}
			mappedRows.push({ mapped, rowNum: i + 2 }); // +2: 1-indexed, header is row 1
			for (const t of mapped.tags) allTagNames.add(t);
		}

		// Pre-create all tags in one batch to avoid repeated upserts
		const tagIdMap = new Map<string, string>();
		if (allTagNames.size > 0) {
			// Find existing tags
			const existingTags = await db.tag.findMany({
				where: { orgId: org.id, name: { in: [...allTagNames] } },
				select: { id: true, name: true }
			});
			for (const t of existingTags) tagIdMap.set(t.name, t.id);

			// Create missing tags
			const missingNames = [...allTagNames].filter((n) => !tagIdMap.has(n));
			for (const name of missingNames) {
				const tag = await db.tag.create({
					data: { orgId: org.id, name }
				});
				tagIdMap.set(name, tag.id);
				tagsCreated++;
			}
		}

		// Process supporters in batches
		for (let batchStart = 0; batchStart < mappedRows.length; batchStart += BATCH_SIZE) {
			const batch = mappedRows.slice(batchStart, batchStart + BATCH_SIZE);
			const newSupporterIds: string[] = [];

			try {
				await db.$transaction(async (tx) => {
					for (const { mapped, rowNum } of batch) {
						try {
							// Check if supporter exists (email_hash first, plaintext fallback)
							const existing = await findSupporterByEmail(
								org.id,
								mapped.email,
								{
									id: true,
									name: true,
									postalCode: true,
									phone: true,
									country: true,
									emailStatus: true,
									smsStatus: true,
									source: true
								},
								tx.supporter
							);

							if (existing) {
								// Update: only fill in null fields, apply strictest email status
								const updateData: Record<string, unknown> = {};

								if (mapped.name && !existing.name) updateData.name = mapped.name;
								if (mapped.postalCode && !existing.postalCode)
									updateData.postalCode = mapped.postalCode;
								if (mapped.phone && !existing.phone) updateData.phone = mapped.phone;
								if (mapped.country && !existing.country) updateData.country = mapped.country;

								// Strictest-wins email status
								const newStatus = stricterStatus(existing.emailStatus, mapped.emailStatus);
								if (newStatus !== existing.emailStatus) {
									updateData.emailStatus = newStatus;
								}

								// SMS: only upgrade none→subscribed, never downgrade stopped/unsubscribed
								if (mapped.smsStatus === 'subscribed' && existing.smsStatus === 'none') {
									updateData.smsStatus = 'subscribed';
								}

								if (Object.keys(updateData).length > 0) {
									await tx.supporter.update({
										where: { id: existing.id },
										data: updateData
									});
								}

								// Add tags (join table, skip duplicates)
								for (const tagName of mapped.tags) {
									const tagId = tagIdMap.get(tagName);
									if (tagId) {
										await tx.supporterTag
											.create({
												data: { supporterId: existing.id, tagId }
											})
											.catch(() => {
												// Ignore unique constraint violation (already tagged)
											});
									}
								}

								updated++;
							} else {
								// Create new supporter
								// C-5: Encrypt email at rest
								const supId = crypto.randomUUID();
								const [eHash, eEncRaw] = await Promise.all([
									computeEmailHash(mapped.email),
									encryptPii(mapped.email, `supporter:${supId}`)
								]);
								if (!eHash || !eEncRaw) throw new Error('Supporter email encryption failed');
								const eEnc = JSON.stringify(eEncRaw);
								const supporter = await tx.supporter.create({
									data: {
										id: supId,
										orgId: org.id,
										name: mapped.name,
										postalCode: mapped.postalCode,
										phone: mapped.phone,
										country: mapped.country,
										emailStatus: mapped.emailStatus,
										smsStatus: mapped.smsStatus,
										source: 'csv',
										importedAt: new Date(),
										encrypted_email: eEnc,
										email_hash: eHash
									}
								});

								// Add tags
								for (const tagName of mapped.tags) {
									const tagId = tagIdMap.get(tagName);
									if (tagId) {
										await tx.supporterTag.create({
											data: { supporterId: supporter.id, tagId }
										});
									}
								}

								newSupporterIds.push(supporter.id);
								imported++;
							}
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							errors.push(`Row ${rowNum}: ${msg}`);
							skipped++;
						}
					}
				});

				// Fire-and-forget: dispatch supporter_created triggers after transaction commits
				for (const supporterId of newSupporterIds) {
					void dispatchTrigger(org.id, 'supporter_created', { entityId: supporterId, supporterId });
				}
			} catch (err) {
				// Entire batch failed — count all as skipped
				const msg = err instanceof Error ? err.message : String(err);
				errors.push(`Batch starting at row ${batch[0]?.rowNum ?? '?'}: ${msg}`);
				skipped += batch.length;
				// Undo the individual counts that were incremented inside the failed transaction
				imported = Math.max(0, imported - batch.filter(() => true).length);
			}
		}

		return {
			success: true,
			summary: {
				imported,
				updated,
				skipped,
				tags_created: tagsCreated,
				errors: errors.slice(0, 20) // Cap at 20 errors for display
			}
		};
	}
};
