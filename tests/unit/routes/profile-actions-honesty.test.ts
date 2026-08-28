import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const profile = readFileSync('src/routes/profile/+page.svelte', 'utf8');

describe('profile action honesty', () => {
	it('does not advertise unsupported export or account-erasure operations', () => {
		expect(profile).not.toContain('Export data');
		expect(profile).not.toContain('Delete account');
	});
});
