/**
 * Class-of-vulnerability cures, third sweep (source-text pins).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function source(rel: string): string {
	return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

describe('class-of-vulnerability cures, third sweep (source-text pins)', () => {
	it('recordBlastReceiptsInternal cohort-cap uses .take(ceiling + 1)', () => {
		const svelte = source('convex/blasts.ts');
		// .take(ceiling + 1) replaces .collect() at both cap-check sites.
		expect(svelte).toContain('.take(ceiling + 1)');
		// .collect() on emailDeliveryReceipts by_blastId must be gone
		// from the cap-check pattern (still allowed elsewhere if any).
		const capChecks = svelte.match(
			/by_blastId.*\n.*\.collect\(\)/g,
		);
		expect(capChecks).toBeNull();
	});

	it('seed.insertSupporterBatch uses validated orgId arg, not s.orgId', () => {
		const svelte = source('convex/seed.ts');
		const insert = svelte.slice(
			svelte.indexOf('export const insertSupporterBatch = internalMutation'),
			svelte.indexOf('export const insertSupporterBatch = internalMutation') + 2000,
		);
		// Validated arg used.
		expect(insert).toContain('orgId,');
		// Unsafe cast removed. Strip comments before checking — comments
		// may reference the historical bad pattern for prose context.
		const noComments = insert.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
		expect(noComments).not.toMatch(/orgId:\s*s\.orgId as any/);
	});

	it('Stripe webhook collects ALL v1 candidates and tries each', () => {
		const svelte = source('convex/http.ts');
		// Object.fromEntries parse on the signature header is gone.
		expect(svelte).not.toMatch(/Object\.fromEntries\(\s*signature\.split/);
		// New v1 candidate array.
		expect(svelte).toContain('v1Candidates');
		expect(svelte).toContain('v1Candidates.push(v)');
		// Constant-time loop over candidates without short-circuit.
		expect(svelte).toContain('anyMatch');
		// Non-short-circuit: no `break` inside the loop.
		const loopBlock = svelte.slice(
			svelte.indexOf('for (const sig of v1Candidates)'),
			svelte.indexOf('for (const sig of v1Candidates)') + 600,
		);
		expect(loopBlock).not.toMatch(/\bbreak\b/);
	});

	it('SES SNS handler enforces 10-minute replay window', () => {
		const svelte = source('convex/http.ts');
		expect(svelte).toMatch(/SNS_REPLAY_WINDOW_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
		expect(svelte).toContain('Date.parse(body.Timestamp as string)');
		expect(svelte).toContain('Number.isFinite(snsTimestampMs)');
		expect(svelte).toContain('Math.abs(Date.now() - snsTimestampMs) > SNS_REPLAY_WINDOW_MS');
		expect(svelte).toContain('Timestamp outside replay window');
	});
});
