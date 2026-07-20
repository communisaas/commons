import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const convexSource = readFileSync('convex/resolvedContacts.ts', 'utf8');
const callerSource = readFileSync('src/lib/core/agents/utils/contact-cache.ts', 'utf8');

describe('resolved contact cache query budget', () => {
	it('uses a trusted minute bucket and enforces the fanout cap before reads', () => {
		const start = convexSource.indexOf('export const getCached = query');
		const end = convexSource.indexOf('// Mutations', start);
		expect(start).toBeGreaterThanOrEqual(0);
		expect(end).toBeGreaterThan(start);
		const block = convexSource.slice(start, end);
		expect(block).toContain('nowBucket: v.number()');
		expect(block).toContain('pairs.length > RESOLVED_CONTACT_LOOKUP_CAP');
		expect(block.indexOf('pairs.length > RESOLVED_CONTACT_LOOKUP_CAP')).toBeLessThan(
			block.indexOf("ctx.db\n\t\t\t\t.query('resolvedContacts')")
		);
		expect(block).toContain('entry.expiresAt > nowBucket');
		expect(block).not.toContain('Date.now');
		expect(callerSource).toContain('const RESOLVED_CONTACT_LOOKUP_CAP = 12');
		expect(callerSource).toContain('Math.floor(Date.now() / 60_000) * 60_000');
	});
});
