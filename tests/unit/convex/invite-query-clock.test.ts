import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const convexSource = readFileSync('convex/invites.ts', 'utf8');
const routeSource = readFileSync('src/routes/api/org/[slug]/invites/+server.ts', 'utf8');

describe('invite query clock boundary', () => {
	it('uses a trusted minute bucket instead of a Convex wall-clock dependency', () => {
		const start = convexSource.indexOf('export const list = query');
		const end = convexSource.indexOf('export const getByToken = query', start);
		expect(start).toBeGreaterThanOrEqual(0);
		expect(end).toBeGreaterThan(start);
		const block = convexSource.slice(start, end);
		expect(block).toContain('_secret: v.string()');
		expect(block).toContain('nowBucket: v.number()');
		expect(block.indexOf('requireInternalSecret(_secret)')).toBeLessThan(
			block.indexOf('requireOrgRole(ctx')
		);
		expect(block).toContain('nowBucket % 60_000 !== 0');
		expect(block).toContain('i.expiresAt > nowBucket');
		expect(block).not.toContain('Date.now');
		expect(routeSource).toContain('_secret: getInternalSecret()');
		expect(routeSource).toContain('Math.floor(Date.now() / 60_000) * 60_000');
	});
});
