import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const server = readFileSync('src/routes/directory/+page.server.ts', 'utf8');
const page = readFileSync('src/routes/directory/+page.svelte', 'utf8');

describe('public organization directory route contract', () => {
	it('uses secret-gated compact cursor pagination with no offset fallback', () => {
		expect(server).toContain('_secret: getInternalSecret()');
		expect(server).toContain('paginationOpts');
		expect(server).toContain('getCachedPublicOrganizationDirectoryFirstPage');
		expect(server).not.toMatch(/searchParams\.get\(['"]offset/);
		expect(page).not.toContain('?offset=');
		expect(page).toContain('?cursor=');
	});

	it('does not manufacture a previous opaque cursor', () => {
		expect(page).not.toContain('Previous');
		expect(page).toContain('First page');
	});
});
