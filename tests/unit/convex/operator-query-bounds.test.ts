import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const users = readFileSync('convex/users.ts', 'utf8');
const revocations = readFileSync('convex/revocations.ts', 'utf8');
const legislation = readFileSync('convex/legislation.ts', 'utf8');

describe('operator query bounds', () => {
	it('bounds Shadow Atlas reconciliation pages and cursors', () => {
		expect(users).toContain('SHADOW_ATLAS_CURSOR_TOO_LARGE');
		expect(users).toContain('paginate({ numItems: 256');
		expect(users).toContain('Math.min(Math.max(requestedLimit, 1), 100)');
	});

	it('bounds revocation audit reads even for internal callers', () => {
		expect(revocations).toContain('REVOCATION_AUDIT_LIMIT_INVALID');
		expect(revocations).toContain('Math.min(requestedLimit, 100)');
	});

	it('bounds destructive legislation maintenance inputs before database work', () => {
		expect(legislation).toContain('PRUNE_BATCH_SIZE_MAX = 200');
		expect(legislation).toContain('PRUNE_BATCH_SIZE_INVALID');
		expect(legislation).toContain('PRUNE_CURSOR_TOO_LARGE');
		expect(legislation).toContain('paginate({ numItems: batchSize');
		expect(legislation).not.toContain('paginate({ numItems: args.batchSize ?? 200');
	});
});
