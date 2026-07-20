import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const backfill = readFileSync('convex/backfill.ts', 'utf8');
const enumDriver = readFileSync('scripts/audit-enum-conformance.ts', 'utf8');
const normalizerDriver = readFileSync('scripts/run-schema-normalizers.ts', 'utf8');

describe('schema migration bounds', () => {
	it('pages normalizers and enum audits under explicit row and byte limits', () => {
		const migrationSection = backfill.slice(backfill.indexOf('normalizeBlastRecipientFilters'));
		expect(migrationSection).not.toContain('.collect()');
		expect(migrationSection).toContain('NORMALIZER_MAX_PAGES_PER_RUN');
		expect(migrationSection).toContain('maximumRowsRead: NORMALIZER_PAGE_SIZE + 1');
		expect(migrationSection).toContain('maximumBytesRead: NORMALIZER_MAX_BYTES_PER_PAGE');
	});

	it('drives every audit table and normalizer to a terminal page', () => {
		for (const table of [
			'campaigns',
			'events',
			'subscriptions',
			'emailBlasts',
			'smsBlasts',
			'smsMessages',
			'eventRsvps',
			'debates',
			'accountabilityReceipts'
		]) {
			expect(enumDriver).toContain(`'${table}'`);
		}
		expect(enumDriver).toContain('if (page.isDone) break');
		expect(normalizerDriver).toContain('if (result.complete) break');
		expect(normalizerDriver).toContain('SCHEMA_NORMALIZER_CURSOR_STALLED');
	});

	it('admits the schema campaign type in the canonical audit set', () => {
		expect(backfill).toContain("'CONGRESSIONAL'");
		expect(backfill).toContain("'voice', 'advocate'");
		expect(backfill).toContain("'outcome_unknown'");
	});
});
