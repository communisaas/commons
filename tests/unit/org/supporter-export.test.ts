/**
 * Supporter takeout — fetch-all paging, client-side decryption, CSV/JSON builders.
 *
 * Custody contract under test: rows arrive as org-key ciphertext, every byte of
 * plaintext is produced locally by the org key, and the CSV/sidecar builders are
 * pure functions over the decrypted rows.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
	fetchAllSupporters,
	decryptSupporterRows,
	buildSupporterCsv,
	buildTakeoutSidecar,
	exportSummary,
	takeoutFilenames,
	SUPPORTER_CSV_COLUMNS,
	type DecryptedSupporterRow,
	type EncryptedSupporterRecord,
	type SupporterPageResult
} from '$lib/core/org/supporter-export';
import {
	encryptForSupporterV2,
	encryptWithOrgKey
} from '$lib/core/crypto/org-pii-encryption';

function row(overrides: Partial<DecryptedSupporterRow> = {}): DecryptedSupporterRow {
	return {
		id: 'sup_1',
		email: 'ada@example.org',
		name: 'Ada Lovelace',
		phone: '+15551230000',
		postalCode: '94110',
		stateCode: 'CA',
		country: 'US',
		verified: true,
		identityVerified: false,
		emailStatus: 'subscribed',
		smsStatus: 'none',
		source: 'csv',
		emailConsentSource: 'import',
		emailConsentedAt: '2026-01-02T00:00:00.000Z',
		emailConsentText: 'Signed up at the rally',
		smsConsentSource: '',
		smsConsentedAt: '',
		smsConsentText: '',
		tags: ['volunteer', 'donor'],
		importedAt: '2026-01-03T00:00:00.000Z',
		customFields: { district: 'CA-11' },
		...overrides
	};
}

function csvLines(csv: string): string[] {
	return csv.split('\r\n').filter((line) => line.length > 0);
}

describe('fetchAllSupporters', () => {
	it('pages to exhaustion and concatenates every row in order', async () => {
		const pages: Record<string, SupporterPageResult<{ id: string }>> = {
			start: { supporters: [{ id: 'a' }, { id: 'b' }], nextCursor: 'b', hasMore: true },
			b: { supporters: [{ id: 'c' }], nextCursor: 'c', hasMore: true },
			c: { supporters: [{ id: 'd' }], nextCursor: null, hasMore: false }
		};
		const fetchPage = vi.fn(async (cursor: string | null) => pages[cursor ?? 'start']);

		const all = await fetchAllSupporters(fetchPage);

		expect(all.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
		expect(fetchPage).toHaveBeenCalledTimes(3);
		expect(fetchPage).toHaveBeenNthCalledWith(1, null);
		expect(fetchPage).toHaveBeenNthCalledWith(2, 'b');
		expect(fetchPage).toHaveBeenNthCalledWith(3, 'c');
	});

	it('reports running progress after each page', async () => {
		const fetched: number[] = [];
		await fetchAllSupporters(
			async (cursor) =>
				cursor === null
					? { supporters: [{ id: 'a' }, { id: 'b' }], nextCursor: 'b', hasMore: true }
					: { supporters: [{ id: 'c' }], nextCursor: null, hasMore: false },
			(n) => fetched.push(n)
		);
		expect(fetched).toEqual([2, 3]);
	});

	it('stops when the endpoint repeats a cursor instead of looping forever', async () => {
		const fetchPage = vi.fn(async () => ({
			supporters: [{ id: 'x' }],
			nextCursor: 'same',
			hasMore: true
		}));
		const all = await fetchAllSupporters(fetchPage);
		expect(all).toHaveLength(2);
		expect(fetchPage).toHaveBeenCalledTimes(2);
	});

	it('returns an empty array for a zero-supporter org', async () => {
		const all = await fetchAllSupporters(async () => ({
			supporters: [],
			nextCursor: null,
			hasMore: false
		}));
		expect(all).toEqual([]);
	});
});

describe('decryptSupporterRows', () => {
	async function makeOrgKey(): Promise<CryptoKey> {
		return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
			'encrypt',
			'decrypt'
		]);
	}

	it('opens v2 blobs (email, name, phone, customFields) with the org key', async () => {
		const orgKey = await makeOrgKey();
		const emailHash = 'f'.repeat(64);
		const [encEmail, encName, encPhone, encCustom] = await Promise.all([
			encryptForSupporterV2('ada@example.org', orgKey, emailHash, 'email'),
			encryptForSupporterV2('Ada Lovelace', orgKey, emailHash, 'name'),
			encryptForSupporterV2('+15551230000', orgKey, emailHash, 'phone'),
			encryptForSupporterV2('{"district":"CA-11"}', orgKey, emailHash, 'customFields')
		]);

		const record: EncryptedSupporterRecord = {
			id: 'sup_1',
			emailHash,
			encryptedEmail: JSON.stringify(encEmail),
			encryptedName: JSON.stringify(encName),
			encryptedPhone: JSON.stringify(encPhone),
			encryptedCustomFields: JSON.stringify(encCustom),
			postalCode: '94110',
			verified: true,
			emailStatus: 'subscribed',
			smsStatus: 'none',
			source: 'csv',
			importedAt: Date.UTC(2026, 0, 3),
			tags: [{ name: 'volunteer' }]
		};

		const [decrypted] = await decryptSupporterRows([record], orgKey);

		expect(decrypted.email).toBe('ada@example.org');
		expect(decrypted.name).toBe('Ada Lovelace');
		expect(decrypted.phone).toBe('+15551230000');
		expect(decrypted.customFields).toEqual({ district: 'CA-11' });
		expect(decrypted.tags).toEqual(['volunteer']);
		expect(decrypted.importedAt).toBe('2026-01-03T00:00:00.000Z');
	});

	it('opens legacy v1 blobs via the row entity id', async () => {
		const orgKey = await makeOrgKey();
		const blob = await encryptWithOrgKey('legacy@example.org', orgKey, 'supporter:sup_9', 'email');

		const [decrypted] = await decryptSupporterRows(
			[{ id: 'sup_9', emailHash: 'a'.repeat(64), encryptedEmail: JSON.stringify(blob) }],
			orgKey
		);

		expect(decrypted.email).toBe('legacy@example.org');
	});

	it('leaves fields empty instead of throwing when the key does not open a blob', async () => {
		const rightKey = await makeOrgKey();
		const wrongKey = await makeOrgKey();
		const emailHash = 'b'.repeat(64);
		const blob = await encryptForSupporterV2('secret@example.org', rightKey, emailHash, 'email');

		const [decrypted] = await decryptSupporterRows(
			[{ id: 'sup_2', emailHash, encryptedEmail: JSON.stringify(blob), emailStatus: 'subscribed' }],
			wrongKey
		);

		expect(decrypted.email).toBe('');
		expect(decrypted.emailStatus).toBe('subscribed');
	});

	it('reports decrypt progress in batches', async () => {
		const orgKey = await makeOrgKey();
		const records: EncryptedSupporterRecord[] = Array.from({ length: 30 }, (_, i) => ({
			id: `sup_${i}`
		}));
		const progress: Array<[number, number]> = [];

		const rows = await decryptSupporterRows(records, orgKey, (done, total) =>
			progress.push([done, total])
		);

		expect(rows).toHaveLength(30);
		expect(progress).toEqual([
			[25, 30],
			[30, 30]
		]);
	});
});

describe('buildSupporterCsv', () => {
	it('emits a header-only file for a zero-supporter org', () => {
		const csv = buildSupporterCsv([]);
		const lines = csvLines(csv);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toBe(SUPPORTER_CSV_COLUMNS.join(','));
	});

	it('covers contact, status, consent, tag, and custom-field columns', () => {
		const header = SUPPORTER_CSV_COLUMNS.join(',');
		for (const column of [
			'email',
			'name',
			'phone',
			'postalCode',
			'stateCode',
			'country',
			'verified',
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
		]) {
			expect(header.split(',')).toContain(column);
		}
	});

	it('writes one row per supporter with values in column order', () => {
		const csv = buildSupporterCsv([row()]);
		const lines = csvLines(csv);
		expect(lines).toHaveLength(2);
		expect(lines[1]).toBe(
			'ada@example.org,Ada Lovelace,+15551230000,94110,CA,US,true,false,subscribed,none,csv,' +
				'import,2026-01-02T00:00:00.000Z,Signed up at the rally,,,,volunteer; donor,' +
				'2026-01-03T00:00:00.000Z,"{""district"":""CA-11""}"'
		);
	});

	it('escapes commas, quotes, and newlines per RFC 4180', () => {
		const csv = buildSupporterCsv([
			row({
				name: 'Lovelace, Ada',
				emailConsentText: 'She said "yes"\nat the door',
				customFields: null,
				tags: []
			})
		]);
		const dataLine = csv.split('\r\n')[1];
		expect(dataLine).toContain('"Lovelace, Ada"');
		expect(dataLine).toContain('"She said ""yes""\nat the door"');
	});

	it('neutralizes spreadsheet formulas without mangling E.164 phones', () => {
		const csv = buildSupporterCsv([
			row({
				name: '=HYPERLINK("http://evil.example","x")',
				emailConsentText: '@SUM(1)',
				phone: '+15551230000'
			})
		]);
		const dataLine = csv.split('\r\n')[1];
		expect(dataLine).toContain(`'=HYPERLINK`);
		expect(dataLine).toContain(`'@SUM(1)`);
		expect(dataLine).toContain(',+15551230000,');
		expect(dataLine).not.toContain(`'+15551230000`);
	});

	it('neutralizes tab- and CR-prefixed formulas (OWASP control-char triggers)', () => {
		const tabCsv = buildSupporterCsv([row({ name: '\t=1+1', tags: [], customFields: null })]);
		const tabCell = tabCsv.split('\r\n')[1].split(',')[1];
		expect(tabCell.startsWith("'\t=")).toBe(true);

		const crCsv = buildSupporterCsv([row({ name: '\r=1+1', tags: [], customFields: null })]);
		// A CR triggers RFC 4180 quoting; the guard prefix lands inside the quotes.
		const crLine = crCsv.split('\r\n')[1];
		expect(crLine).toContain("\"'\r=1+1\"");
	});

	it('leaves empty fields empty rather than inventing placeholders', () => {
		const csv = buildSupporterCsv([
			row({
				phone: '',
				importedAt: '',
				customFields: null,
				tags: [],
				smsConsentSource: '',
				source: ''
			})
		]);
		const cells = csv.split('\r\n')[1].split(',');
		expect(cells[2]).toBe(''); // phone
		expect(cells[cells.length - 1]).toBe(''); // customFields
	});
});

describe('exportSummary', () => {
	it('states exactly how many of how many rows exported when the scan cap truncates', () => {
		const summary = exportSummary(10_000, 12_345);
		expect(summary.truncated).toBe(true);
		expect(summary.message).toContain('10,000 of 12,345');
		expect(summary.message).toContain('2,345');
	});

	it('reports a complete export without a truncation clause', () => {
		const summary = exportSummary(42, 42);
		expect(summary.truncated).toBe(false);
		expect(summary.message).toContain('42 of 42');
		expect(summary.message).not.toContain('limit');
	});

	it('handles the zero-supporter org', () => {
		const summary = exportSummary(0, 0);
		expect(summary.truncated).toBe(false);
		expect(summary.message).toContain('0 of 0');
	});
});

describe('buildTakeoutSidecar', () => {
	it('exports the org shape: tags and saved segment definitions', () => {
		const json = buildTakeoutSidecar({
			org: { slug: 'climate-action-now', name: 'Climate Action Now' },
			tags: [{ name: 'volunteer', supporterCount: 12 }, { name: 'donor' }],
			segments: [
				{
					name: 'Verified in CA',
					filters: { conditions: [{ field: 'stateCode', value: 'CA' }] },
					createdAt: Date.UTC(2026, 0, 1),
					updatedAt: Date.UTC(2026, 0, 2)
				}
			],
			exportedAt: new Date(Date.UTC(2026, 0, 5))
		});

		const parsed = JSON.parse(json);
		expect(parsed.organization).toEqual({ slug: 'climate-action-now', name: 'Climate Action Now' });
		expect(parsed.exportedAt).toBe('2026-01-05T00:00:00.000Z');
		expect(parsed.tags).toEqual([{ name: 'volunteer', supporterCount: 12 }, { name: 'donor' }]);
		expect(parsed.segments).toEqual([
			{
				name: 'Verified in CA',
				filters: { conditions: [{ field: 'stateCode', value: 'CA' }] },
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-02T00:00:00.000Z'
			}
		]);
	});

	it('produces a valid sidecar for an org with no tags or segments', () => {
		const parsed = JSON.parse(
			buildTakeoutSidecar({ org: { slug: 'new-org' }, tags: [], segments: [] })
		);
		expect(parsed.tags).toEqual([]);
		expect(parsed.segments).toEqual([]);
		expect(parsed.organization.slug).toBe('new-org');
	});
});

describe('takeoutFilenames', () => {
	it('stamps both files with the org slug and date', () => {
		const names = takeoutFilenames('local-first-sf', new Date(Date.UTC(2026, 5, 1)));
		expect(names.csv).toBe('local-first-sf-people-2026-06-01.csv');
		expect(names.sidecar).toBe('local-first-sf-people-2026-06-01.json');
	});
});

describe('export surface vocabulary', () => {
	it('imports no capability machinery', () => {
		const files = [
			'src/lib/core/org/supporter-export.ts',
			'src/routes/org/[slug]/supporters/+page.svelte'
		];
		for (const file of files) {
			const source = readFileSync(path.resolve(process.cwd(), file), 'utf8');
			expect(source).not.toMatch(/capability-hypergraph|capability-state-labels/);
		}
	});
});
