import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const organizations = readFileSync('convex/organizations.ts', 'utf8');
const schema = readFileSync('convex/schema.ts', 'utf8');

describe('organization owner cardinality', () => {
	it('proves another owner through an exact bounded index read', () => {
		expect(schema).toContain(".index('by_orgId_role', ['orgId', 'role'])");

		const ownerReads = organizations.match(
			/withIndex\('by_orgId_role',[\s\S]*?\.take\(2\)/g
		);
		expect(ownerReads).toHaveLength(2);
		expect(organizations).not.toMatch(
			/query\('orgMemberships'\)[\s\S]{0,180}withIndex\('by_orgId',[\s\S]{0,100}\.collect\(\)/
		);
	});
});
