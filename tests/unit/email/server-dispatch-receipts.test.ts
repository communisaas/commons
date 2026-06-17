/**
 * Server-dispatch per-recipient receipts (B3).
 *
 * The server-dispatch SES path was the only blast path that wrote no
 * per-recipient receipt — only two aggregate counters that conflated transport,
 * credential, and true-bounce failures. It now feeds the SAME shared internal
 * writer (upsert on (blastId, recipientEmailHash), never-downgrade-sent,
 * messageId-only-on-sent, cohort cap) the client-direct/Lambda paths use.
 *
 * Pure source-contract pins — no Convex runtime in unit tests.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const email = readFileSync(resolve(process.cwd(), 'convex/email.ts'), 'utf8');
const blasts = readFileSync(resolve(process.cwd(), 'convex/blasts.ts'), 'utf8');

function sendBlastBatchBody(): string {
	const start = email.indexOf('export const sendBlastBatch = internalAction({');
	expect(start, 'sendBlastBatch not found').toBeGreaterThanOrEqual(0);
	const end = email.indexOf('export const ', start + 20);
	return email.slice(start, end > 0 ? end : undefined);
}

describe('server-dispatch receipts (B3)', () => {
	const body = sendBlastBatchBody();

	it('uses sendViaSesWithResult, not the bare boolean sendViaSes, in the loop', () => {
		expect(body).toContain('sendViaSesWithResult');
		expect(body).not.toMatch(/await sendViaSes\(/);
	});

	it('accumulates per-recipient receipts and writes them via the shared internal mutation', () => {
		expect(body).toContain('recipientEmailHash');
		expect(body).toContain('internal.blasts.recordBlastReceiptsInternal');
	});

	it('the throw-before-SES catch records a failed receipt with an error (not a silent counter)', () => {
		const catchIdx = body.indexOf('} catch (err) {');
		expect(catchIdx, 'outer catch(err) not found').toBeGreaterThanOrEqual(0);
		const catchBlock = body.slice(catchIdx, catchIdx + 500);
		expect(catchBlock).toContain("status: 'failed'");
		expect(catchBlock).toMatch(/error:/);
	});

	it('sesMessageId is set only on success — never on a failed row', () => {
		expect(body).toMatch(/sesMessageId: result\.ok \? result\.messageId : undefined/);
	});

	it('writes receipts BEFORE incrementing aggregate counters (forensic rows survive a counter failure)', () => {
		expect(body.indexOf('recordBlastReceiptsInternal')).toBeLessThan(
			body.indexOf('incrementBlastCountersRef')
		);
	});
});

describe('receipt-writer sendMode guard (B3)', () => {
	it('is one shared positive allowlist incl. server, not two divergent literal denylists', () => {
		expect(blasts).toContain(
			"const RECEIPT_SENDMODES = new Set(['client-direct', 'tee-sealed', 'server'])"
		);
		const guards = blasts.match(/RECEIPT_SENDMODES\.has\(blast\.sendMode/g) ?? [];
		expect(guards.length).toBe(2); // both the internal + public writer
		expect(blasts).not.toContain(
			"blast.sendMode !== 'client-direct' && blast.sendMode !== 'tee-sealed'"
		);
	});
});
