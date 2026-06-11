/**
 * Server-dispatch enqueue boundary contract.
 *
 * `enqueueServerDispatch` is the public product boundary for org-composed
 * server email sends. It must prove editor authority first, verify the blast
 * belongs to the caller's org, accept only drafts (atomically claiming them
 * as scheduled so a double-enqueue cannot double-send), refuse empty recipient
 * sets, and hand off to the internal batch sender via the scheduler — the
 * sender itself is never directly callable from the public API.
 *
 * Pure source-contract pins — no Convex runtime.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf8');
}

/** Slice between two unique markers; asserts both exist. */
function section(src: string, start: string, end: string): string {
	const startIdx = src.indexOf(start);
	expect(startIdx, `marker not found: ${start}`).toBeGreaterThanOrEqual(0);
	const endIdx = src.indexOf(end, startIdx + start.length);
	expect(endIdx, `marker not found: ${end}`).toBeGreaterThan(startIdx);
	return src.slice(startIdx, endIdx);
}

const email = source('convex/email.ts');
const enqueue = () =>
	section(email, 'export const enqueueServerDispatch = mutation', 'export const enqueueAbTestDispatch');

describe('enqueueServerDispatch authority gate', () => {
	it('is a public mutation gated by org editor role', () => {
		const body = enqueue();
		expect(body).toContain("requireOrgRole(ctx, args.orgSlug, 'editor')");
	});

	it('checks authority before touching the blast or scheduling work', () => {
		const body = enqueue();
		const roleIdx = body.indexOf('requireOrgRole');
		expect(roleIdx).toBeGreaterThanOrEqual(0);
		expect(roleIdx).toBeLessThan(body.indexOf('ctx.db.get(args.blastId)'));
		expect(roleIdx).toBeLessThan(body.indexOf('ctx.scheduler.runAfter'));
	});

	it('refuses blasts that belong to another org', () => {
		const body = enqueue();
		expect(body).toContain('blast.orgId !== org._id');
		expect(body).toContain('Blast not found in this organization');
	});
});

describe('draft-only dispatch claim', () => {
	it('accepts only draft blasts', () => {
		const body = enqueue();
		expect(body).toContain("if (blast.status !== 'draft')");
		expect(body).toContain('Only draft blasts can be queued for server dispatch');
	});

	it('atomically claims the draft as scheduled in server mode', () => {
		const body = enqueue();
		expect(body).toContain("status: 'scheduled'");
		expect(body).toContain("sendMode: 'server'");
	});

	it('refuses an empty recipient set', () => {
		const body = enqueue();
		expect(body).toContain('recipients.length === 0');
		expect(body).toContain('No subscribed recipients match this blast filter');
	});
});

describe('handoff to the internal sender', () => {
	it('schedules the batch sender instead of sending inline', () => {
		const body = enqueue();
		expect(body).toContain('ctx.scheduler.runAfter(0, sendBlastRef');
	});

	it('the sender reference points at the internal email:sendBlast action', () => {
		const refDecl = section(email, 'const sendBlastRef = makeFunctionReference', ');');
		expect(refDecl).toContain("'email:sendBlast'");
	});
});
