import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('root identity-shell read budget', () => {
	it('reuses the hooks principal instead of reading the profile twice', () => {
		const source = read('src/routes/+layout.server.ts');
		expect(source).not.toContain('api.users.getProfile');
		expect(source).toContain('locals.user.passkey_credential_id');
		expect(source).toContain('locals.user.wallet_address');
	});

	it('loads a bounded membership page with explicit overflow', () => {
		const layout = read('src/routes/+layout.server.ts');
		const organizations = read('convex/organizations.ts');

		expect(layout).toMatch(/getMyMemberships,[\s\S]*limit:\s*12/);
		expect(layout).toContain('orgMembershipsOverflow');
		expect(organizations).toMatch(
			/const limit = Math\.min\(Math\.max\(Math\.floor\(args\.limit \?\? 12\), 1\), 24\)/
		);
		expect(organizations).toContain('.paginate({ numItems: limit, cursor: args.cursor ?? null })');
	});

	it('never scans campaigns while building membership navigation', () => {
		const source = read('convex/organizations.ts');
		const start = source.indexOf('export const getMyMemberships');
		expect(start).toBeGreaterThan(-1);
		// Pin only the hot query. Bounded maintenance functions legitimately scan
		// campaign pages and may live before the next section comment.
		const end = source.indexOf('\nexport const ', start + 1);
		expect(end).toBeGreaterThan(start);
		const querySource = source.slice(start, end);

		expect(querySource).not.toContain("query('campaigns')");
		expect(querySource).not.toContain('.collect()');
		expect(querySource).toContain('activeCampaignCount');
	});
});
