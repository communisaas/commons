import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const importPage = readFileSync(
	'src/routes/org/[slug]/supporters/import/+page.svelte',
	'utf8'
);
const importServer = readFileSync(
	'src/routes/org/[slug]/supporters/import/+page.server.ts',
	'utf8'
);
const supporters = readFileSync('convex/supporters.ts', 'utf8');
const platformProfiles = readFileSync('src/lib/data/platform-export-profiles.ts', 'utf8');
const personPage = readFileSync('src/routes/org/[slug]/supporters/[id]/+page.svelte', 'utf8');
const peopleList = readFileSync('src/routes/org/[slug]/supporters/+page.svelte', 'utf8');

describe('People CSV custom-field custody', () => {
	it('exposes custom-field mapping as an explicit operator choice', () => {
		expect(platformProfiles).toContain("| 'custom'");
		expect(importPage).toContain("{ value: 'custom', label: 'Encrypted custom field' }");
		expect(importPage).toContain('Encrypted custom fields');
		expect(importPage).toContain('preserveUnmappedAsCustomFields');
			expect(importPage).toContain('Custom fields are stored as encrypted JSON');
	});

	it('maps selected CSV columns into plaintext customFields before Convex encryption', () => {
		expect(importServer).toContain("'custom'");
		expect(importServer).toContain('VALID_IMPORT_FIELD_NAMES');
		expect(importServer).toContain('buildCustomFieldLabels');
		expect(importServer).toContain("fieldName === 'custom'");
		expect(importServer).toContain('customFields[key] = value');
		expect(importServer).toContain('customFields?: Record<string, string>');
		expect(importServer).toContain('custom_fields: Object.values(effectiveMapping)');
	});

	it('encrypts customFields with the same V2 supporter AAD discipline', () => {
		expect(supporters).toContain('customFields: v.optional(v.record(v.string(), v.string()))');
		expect(supporters).toContain("throw new Error('CUSTOM_FIELDS_TOO_MANY')");
		expect(supporters).toContain(
			"encryptForSupporterV2(customFieldsJson, orgKey, emailHash, 'customFields')"
		);
		expect(supporters).toContain('encryptedCustomFields: encCustomFields');
		expect(supporters).toContain('!existing.encryptedCustomFields');
	});

	it('keeps imported V2 ciphertext readable in People views', () => {
		expect(peopleList).toContain('decryptOrgPii');
		expect(peopleList).toContain('const emailHash = s.emailHash');
		expect(personPage).toContain('decryptOrgPii');
		expect(personPage).toContain("'customFields'");
		expect(personPage).toContain('customFieldEntries.length');
	});
});
