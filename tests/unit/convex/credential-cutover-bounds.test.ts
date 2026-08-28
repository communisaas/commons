import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const cutover = readFileSync('convex/cutover.ts', 'utf8');
const schema = readFileSync('convex/schema.ts', 'utf8');
const script = readFileSync('scripts/cutover-v1-credentials.ts', 'utf8');

describe('credential cutover bounds', () => {
	it('pages an exact active-credential index under row and byte budgets', () => {
		expect(schema).toContain(".index('by_revokedAt_expiresAt', ['revokedAt', 'expiresAt'])");
		expect(cutover).toContain(".withIndex('by_revokedAt_expiresAt'");
		expect(cutover).toContain(".eq('revokedAt', undefined).gt('expiresAt', now)");
		expect(cutover).toContain('maximumRowsRead: 101');
		expect(cutover).toContain('maximumBytesRead: 512 * 1024');
		expect(cutover).not.toContain('.collect()');
	});

	it('does not accumulate the candidate roster and restarts changing-range reads', () => {
		expect(script).toContain('while (true)');
		expect(script).toContain('const { page: batch } = await listPage(null)');
		expect(script).not.toContain('const candidates = await client.query');
	});
});
