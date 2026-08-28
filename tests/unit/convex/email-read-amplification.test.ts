import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function source(rel: string): string {
	return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

function namedBody(contents: string, declaration: string): string {
	const start = contents.indexOf(declaration);
	expect(start).toBeGreaterThanOrEqual(0);
	const next = contents.indexOf('\nexport const ', start + declaration.length);
	return contents.slice(start, next === -1 ? contents.length : next);
}

describe('email launch read-amplification boundaries', () => {
	it('serves the A/B winner cron only from its compact scalar projection', () => {
		const email = source('convex/email.ts');
		const query = namedBody(email, 'export const _findAbCandidates');
		expect(query).toContain("query('emailAbWinnerCandidates')");
		expect(query).toContain("withIndex('by_sentAt')");
		expect(query).toContain('.take(AB_WINNER_CANDIDATE_READ_MAX)');
		expect(query).not.toContain("query('emailBlasts')");
		expect(query).not.toContain('bodyHtml');
		expect(source('convex/lib/emailAbWinnerCandidate.ts')).toContain(
			'AB_WINNER_CANDIDATE_READ_MAX = 500'
		);
	});

	it('never derives a receipt count read from mutable blast counters', () => {
		const blasts = source('convex/blasts.ts');
		for (const declaration of [
			'export const recordBlastReceiptsInternal',
			'export const recordBlastReceipts ='
		]) {
			const writer = namedBody(blasts, declaration);
			expect(writer).toContain('readReceiptCountAuthority(blast)');
			expect(writer).not.toContain("withIndex('by_blastId'");
			expect(writer).not.toMatch(/\.take\s*\(/);
			expect(writer).not.toMatch(/\.collect\s*\(/);
		}
		expect(blasts).toContain('BLAST_RECEIPT_HARD_CAP = RECIPIENT_COHORT_CAP * 2');
		expect(blasts).toContain("throw new Error('EMAIL_BLAST_RECIPIENT_COUNT_REPAIR_REQUIRED')");
		expect(blasts).toContain("throw new Error('EMAIL_RECEIPT_COUNT_PROJECTION_NOT_READY')");
	});
});
