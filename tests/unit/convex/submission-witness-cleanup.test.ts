import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const submissions = readFileSync('convex/submissions.ts', 'utf8');

describe('submission witness cleanup', () => {
	it('uses a self-draining bounded due queue instead of rereading scrubbed wide rows', () => {
		const cleanup = submissions.slice(
			submissions.indexOf('const SUBMISSION_WITNESS_CLEANUP_PAGE_SIZE'),
			submissions.indexOf('export const getPublicById')
		);
		expect(cleanup).toContain('SUBMISSION_WITNESS_CLEANUP_PAGE_SIZE = 32');
		expect(cleanup).toContain("q.gte('witnessExpiresAt', 0).lt('witnessExpiresAt', now)");
		expect(cleanup).toContain('.take(SUBMISSION_WITNESS_CLEANUP_PAGE_SIZE + 1)');
		expect(cleanup).toContain('witnessExpiresAt: undefined');
		expect(cleanup).toContain('witnessCleanedAt: now');
		expect(cleanup).toContain('internal.submissions.cleanupExpiredWitnesses');
		expect(cleanup).not.toContain('.take(500)');
	});
});
