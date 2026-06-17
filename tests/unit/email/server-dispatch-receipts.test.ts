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

	it('the throw-before-SES catch records a failed receipt with a NON-PII code (not raw err)', () => {
		// CodeRabbit F2: the receipt error is member-readable via listReceiptsForBlast,
		// so it must be a coded reason, never err.message (which can carry PII).
		expect(body).toContain("'predispatch_failed'");
		expect(body).not.toMatch(/err\.message\.slice/); // raw exception no longer persisted
		// the SES-fail branch likewise persists a code, not the raw SES body
		expect(body).toMatch(/ses_http_/);
		expect(body).not.toMatch(/error: result\.ok \? undefined : result\.error/);
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

describe('receipt-writer sendMode guard (B3 + CodeRabbit F1)', () => {
	it('splits the allowlist: INTERNAL admits server, PUBLIC is browser-only', () => {
		// F1: a SHARED set including 'server' let an editor forge server-dispatch
		// receipts via the public mutation. Split by trust surface.
		expect(blasts).toContain(
			"const INTERNAL_RECEIPT_SENDMODES = new Set(['client-direct', 'tee-sealed', 'server'])"
		);
		expect(blasts).toContain(
			"const PUBLIC_RECEIPT_SENDMODES = new Set(['client-direct', 'tee-sealed'])"
		);
		// internal writer uses the server-inclusive set; public writer the browser-only set
		expect(blasts).toContain('INTERNAL_RECEIPT_SENDMODES.has(blast.sendMode');
		expect(blasts).toContain('PUBLIC_RECEIPT_SENDMODES.has(blast.sendMode');
		// no surviving shared set (would re-admit 'server' publicly) and no denylist
		expect(blasts).not.toMatch(/const RECEIPT_SENDMODES =/);
		expect(blasts).not.toContain(
			"blast.sendMode !== 'client-direct' && blast.sendMode !== 'tee-sealed'"
		);
	});
});
