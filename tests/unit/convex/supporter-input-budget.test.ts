import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	assertSupporterInputBatchBudget,
	assertSupporterInputBudget,
	MAX_SUPPORTER_INPUT_BATCH_BYTES,
	MAX_SUPPORTER_INPUT_ROW_BYTES
} from '../../../convex/lib/supporterInputBudget';

describe('supporter write input budgets', () => {
	it('accepts a normal encrypted supporter row', () => {
		expect(() =>
			assertSupporterInputBudget({
				encryptedEmail: 'ciphertext',
				emailHash: 'a'.repeat(64),
				globalEmailHash: 'b'.repeat(64),
				encryptedName: 'name-ciphertext',
				tagIds: ['tag-id']
			})
		).not.toThrow();
	});

	it('measures each field in UTF-8 bytes', () => {
		expect(() =>
			assertSupporterInputBudget({ encryptedEmail: '界'.repeat(3_000) }, 'UTF8_SUPPORTER')
		).toThrow('UTF8_SUPPORTER_ENCRYPTED_EMAIL_TOO_LARGE');
	});

	it('rejects an aggregate row over 32 KiB even when no named field carries the excess', () => {
		const row = { futureProjection: 'x'.repeat(MAX_SUPPORTER_INPUT_ROW_BYTES) };
		expect(new TextEncoder().encode(JSON.stringify(row)).byteLength).toBeGreaterThan(
			MAX_SUPPORTER_INPUT_ROW_BYTES
		);
		expect(() => assertSupporterInputBudget(row)).toThrow('SUPPORTER_INPUT_ROW_TOO_LARGE');
	});

	it('rejects an import payload over 512 KiB while every individual row remains valid', () => {
		const rows = Array.from({ length: 24 }, (_, index) => ({
			row: index,
			futureProjection: 'x'.repeat(23 * 1024)
		}));
		expect(new TextEncoder().encode(JSON.stringify(rows)).byteLength).toBeGreaterThan(
			MAX_SUPPORTER_INPUT_BATCH_BYTES
		);
		for (const row of rows) expect(() => assertSupporterInputBudget(row)).not.toThrow();
		expect(() => assertSupporterInputBatchBudget(rows)).toThrow(
			'SUPPORTER_IMPORT_BATCH_TOO_LARGE'
		);
	});

	it('bounds tag count and tag identifier bytes', () => {
		expect(() =>
			assertSupporterInputBudget({ tagIds: Array.from({ length: 101 }, () => 'tag') })
		).toThrow('SUPPORTER_INPUT_TAG_IDS_TOO_MANY');
		expect(() => assertSupporterInputBudget({ tagIds: ['界'.repeat(64)] })).toThrow(
			'SUPPORTER_INPUT_TAG_ID_TOO_LARGE'
		);
	});
});

describe('canonical supporter writer coverage', () => {
	const files = {
		supporters: readFileSync(resolve(process.cwd(), 'convex/supporters.ts'), 'utf8'),
		campaigns: readFileSync(resolve(process.cwd(), 'convex/campaigns.ts'), 'utf8'),
		v1api: readFileSync(resolve(process.cwd(), 'convex/v1api.ts'), 'utf8')
	};

	function section(source: string, marker: string, nextMarker = '\nexport const '): string {
		const start = source.indexOf(marker);
		expect(start, marker).toBeGreaterThanOrEqual(0);
		const end = source.indexOf(nextMarker, start + marker.length);
		return source.slice(start, end === -1 ? undefined : end);
	}

	it('routes create, update, repair, and encrypted import through the shared budget', () => {
		for (const name of ['create', 'update', 'patchEncryptedPii', 'importBatch', 'importWithEncryption']) {
			expect(section(files.supporters, `export const ${name} =`)).toMatch(
				/assertSupporterInput(?:Batch)?Budget\(/
			);
		}
	});

	it('routes campaign and v1 create/update boundaries through the same implementation', () => {
		expect(section(files.campaigns, 'export const findOrCreateSupporter')).toContain(
			'assertSupporterInputBudget('
		);
		for (const name of ['updateSupporter', 'createSupporter']) {
			expect(section(files.v1api, `export const ${name} =`)).toContain(
				'assertSupporterInputBudget('
			);
		}
	});
});

describe('supporter deletion projection coverage', () => {
	for (const [file, marker] of [
		['convex/supporters.ts', 'export const remove ='],
		['convex/supporters.ts', 'export const deleteStrandedPlaceholder ='],
		['convex/v1api.ts', 'export const deleteSupporter =']
	] as const) {
		it(`${marker} detaches the exact audience marker before deleting`, () => {
			const source = readFileSync(resolve(process.cwd(), file), 'utf8');
			const start = source.indexOf(marker);
			const end = source.indexOf('\nexport const ', start + marker.length);
			const section = source.slice(start, end === -1 ? undefined : end);
			expect(section.indexOf('detachSupporterAudienceProjection(')).toBeGreaterThanOrEqual(0);
			expect(section.indexOf('detachSupporterAudienceProjection(')).toBeLessThan(
				section.indexOf('ctx.db.delete(')
			);
		});
	}
});
