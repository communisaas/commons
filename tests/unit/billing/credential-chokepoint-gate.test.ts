/**
 * Credential-chokepoint quota gating (B4).
 *
 * ses-token (STS creds) and dispatch-claim (signed Lambda claim) mint SEND
 * AUTHORITY. The form path gates billing; these endpoints did not — a direct
 * authenticated-editor call bypassed gate-at-delivery. The gate now runs BEFORE
 * the mint, fail-closed, on both. Pure source-contract pins (no SvelteKit/Convex
 * runtime in unit tests) — the load-bearing assertion is gate-before-mint ordering.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const sesToken = src('src/routes/api/org/[slug]/ses-token/+server.ts');
const dispatchClaim = src('src/routes/api/blast/[blastId]/dispatch-claim/+server.ts');
const blasts = src('convex/blasts.ts');
const sms = src('convex/sms.ts');

describe('ses-token quota gate', () => {
	it('checks the plan limit BEFORE issuing STS credentials', () => {
		const gate = sesToken.indexOf('api.subscriptions.checkPlanLimits');
		const mint = sesToken.indexOf('AssumeRoleCommand(');
		expect(gate).toBeGreaterThanOrEqual(0);
		expect(mint).toBeGreaterThan(gate); // gate strictly before the mint
	});
	it('refuses on exhaustion (>=) and fails closed on a null result', () => {
		expect(sesToken).toMatch(/current\.emailsSent >= limits\.limits\.maxEmails/);
		expect(sesToken).toContain('!limits?.current'); // null ⇒ refuse, not allow
	});
	it('distinguishes subscribe-gate from upgrade in the 403 body', () => {
		expect(sesToken).toContain('DELIVERY_QUOTA_SUBSCRIBE_GATE');
		expect(sesToken).toContain('EMAIL_QUOTA_EXCEEDED');
	});
});

describe('dispatch-claim quota gate', () => {
	it('checks the plan limit BEFORE signing the claim AND before the cohort scan', () => {
		const gate = dispatchClaim.indexOf('api.subscriptions.checkPlanLimits');
		const sign = dispatchClaim.indexOf('= signDispatchClaim(');
		const cohort = dispatchClaim.indexOf('api.blasts.getEncryptedSupportersForBlast');
		expect(gate).toBeGreaterThanOrEqual(0);
		expect(sign).toBeGreaterThan(gate);
		expect(cohort).toBeGreaterThan(gate); // slug-first short-circuit
	});
	it('fails closed and distinguishes the two cases', () => {
		expect(dispatchClaim).toMatch(/current\.emailsSent >= limits\.limits\.maxEmails/);
		expect(dispatchClaim).toContain('!limits?.current');
		expect(dispatchClaim).toContain('DELIVERY_QUOTA_SUBSCRIBE_GATE');
	});
});

describe('counter-mutation recheck', () => {
	it('updateClientBlastProgress rechecks maxEmails===0 BEFORE incrementing sentEmailCount', () => {
		const start = blasts.indexOf('export const updateClientBlastProgress');
		const end = blasts.indexOf('export const', start + 20);
		const body = blasts.slice(start, end > 0 ? end : undefined);
		const recheck = body.indexOf('planLimits?.limits.maxEmails === 0');
		const increment = body.indexOf('sentEmailCount: currentCount + args.totalSent');
		expect(recheck).toBeGreaterThanOrEqual(0);
		expect(increment).toBeGreaterThan(recheck); // recheck before the increment
		// gates on ===0 (inactive floor), NOT >= (which would false-reject a final batch)
		expect(body).toContain('checkPlanLimitsByOrgId');
		expect(body).not.toMatch(/emailsSent >= .*maxEmails/);
	});
});

describe('SMS path untouched (E3 deferred)', () => {
	it('recordDispatchBatch did not gain a checkPlanLimits gate', () => {
		const start = sms.indexOf('export const recordDispatchBatch');
		const end = sms.indexOf('export const', start + 20);
		const body = sms.slice(start, end > 0 ? end : undefined);
		expect(body).not.toContain('checkPlanLimits');
	});
});
