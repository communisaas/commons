/**
 * upsertExternalId behavior pinned with a small mock ctx.
 *
 * The helper takes a Convex MutationCtx; vitest can't import the real
 * `_generated` modules, so this test mirrors the relevant `ctx.db` surface
 * (query → withIndex → first / insert / patch) with an in-memory map and
 * exercises the helper's three branches: not-exists, exists-same-value,
 * exists-different-value.
 *
 * Asserts the (decisionMakerId, system) uniqueness invariant the helper
 * exists to enforce.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { upsertExternalId } from '../../../convex/_externalIds';

interface ExternalIdRow {
	_id: string;
	decisionMakerId: string;
	system: string;
	value: string;
}

class MockDb {
	rows = new Map<string, ExternalIdRow>();
	private nextId = 1;
	patches: Array<{ id: string; fields: Partial<ExternalIdRow> }> = [];
	inserts: ExternalIdRow[] = [];

	query(table: string) {
		expect(table).toBe('externalIds');
		const captured = { decisionMakerId: '', system: '' };
		const indexQuery = {
			eq(field: string, value: string) {
				if (field === 'decisionMakerId') captured.decisionMakerId = value;
				if (field === 'system') captured.system = value;
				return indexQuery;
			}
		};
		return {
			withIndex: (indexName: string, builder: (q: typeof indexQuery) => typeof indexQuery) => {
				expect(indexName).toBe('by_decisionMakerId_system');
				builder(indexQuery);
				return {
					first: async (): Promise<ExternalIdRow | null> => {
						for (const row of this.rows.values()) {
							if (
								row.decisionMakerId === captured.decisionMakerId &&
								row.system === captured.system
							) {
								return row;
							}
						}
						return null;
					}
				};
			}
		};
	}

	async insert(table: string, doc: Omit<ExternalIdRow, '_id'>): Promise<string> {
		expect(table).toBe('externalIds');
		const id = `ext_${this.nextId++}`;
		const row: ExternalIdRow = { _id: id, ...doc };
		this.rows.set(id, row);
		this.inserts.push(row);
		return id;
	}

	async patch(id: string, fields: Partial<ExternalIdRow>): Promise<void> {
		const row = this.rows.get(id);
		expect(row).toBeDefined();
		this.patches.push({ id, fields });
		Object.assign(row!, fields);
	}
}

describe('upsertExternalId — (decisionMakerId, system) uniqueness', () => {
	let mock: MockDb;
	const ctx = {
		get db() {
			return mock;
		}
	};

	beforeEach(() => {
		mock = new MockDb();
	});

	it('inserts when no row exists for (decisionMakerId, system)', async () => {
		const id = await upsertExternalId(
			ctx as never,
			'dm_alpha' as never,
			'bioguide',
			'A000001'
		);
		expect(typeof id).toBe('string');
		expect(mock.inserts).toHaveLength(1);
		expect(mock.inserts[0].decisionMakerId).toBe('dm_alpha');
		expect(mock.inserts[0].system).toBe('bioguide');
		expect(mock.inserts[0].value).toBe('A000001');
		expect(mock.patches).toHaveLength(0);
	});

	it('no-ops when a row exists with the same value', async () => {
		// Prime: existing row
		mock.rows.set('ext_pre', {
			_id: 'ext_pre',
			decisionMakerId: 'dm_alpha',
			system: 'bioguide',
			value: 'A000001'
		});

		const id = await upsertExternalId(
			ctx as never,
			'dm_alpha' as never,
			'bioguide',
			'A000001'
		);
		expect(id).toBe('ext_pre');
		expect(mock.inserts).toHaveLength(0);
		expect(mock.patches).toHaveLength(0);
	});

	it('patches in place when a row exists with a different value (upstream rename)', async () => {
		mock.rows.set('ext_pre', {
			_id: 'ext_pre',
			decisionMakerId: 'dm_alpha',
			system: 'bioguide',
			value: 'A000001'
		});

		const id = await upsertExternalId(
			ctx as never,
			'dm_alpha' as never,
			'bioguide',
			'A000002'
		);
		expect(id).toBe('ext_pre');
		expect(mock.inserts).toHaveLength(0);
		expect(mock.patches).toHaveLength(1);
		expect(mock.patches[0].fields).toEqual({ value: 'A000002' });
		expect(mock.rows.get('ext_pre')!.value).toBe('A000002');
	});

	it('treats different (decisionMakerId, system) tuples as independent rows', async () => {
		await upsertExternalId(ctx as never, 'dm_alpha' as never, 'bioguide', 'A000001');
		await upsertExternalId(ctx as never, 'dm_alpha' as never, 'constituency', 'CA001');
		await upsertExternalId(ctx as never, 'dm_beta' as never, 'bioguide', 'B000001');

		expect(mock.inserts).toHaveLength(3);
		expect(mock.rows.size).toBe(3);
	});

	it('never creates duplicate (decisionMakerId, system) rows under repeat calls', async () => {
		// Fire upsert 5 times for the same tuple — should produce one row
		for (let i = 0; i < 5; i++) {
			await upsertExternalId(ctx as never, 'dm_alpha' as never, 'bioguide', 'A000001');
		}
		expect(mock.inserts).toHaveLength(1);
		expect(mock.patches).toHaveLength(0);
		expect(mock.rows.size).toBe(1);
	});
});
