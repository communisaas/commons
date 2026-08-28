import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	resolve(process.cwd(), 'src/routes/settings/delegation/+page.server.ts'),
	'utf8'
);

describe('delegation settings launch boundary', () => {
	it('fails pre-I/O while the Convex delegation readers are tombstones', () => {
		expect(source).toContain("throw error(404, 'Not found')");
		expect(source).toContain('delegationNotLaunched()');
		expect(source).not.toContain('serverQuery');
		expect(source).not.toContain('api.delegation');
	});

	it('keeps a concrete page model instead of casting a never-returning query', () => {
		expect(source).toContain('type DelegationPagePayload =');
		expect(source).toContain('satisfies PageServerLoad');
		expect(source).not.toContain('as unknown as');
	});
});
