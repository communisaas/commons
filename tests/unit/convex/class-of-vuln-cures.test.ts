/**
 * Class-of-vulnerability cures (source-text pins).
 *
 * Pinned cures for a class of repeated findings across files: free-form
 * `v.string()` status enums, unauthenticated public mutations trusting
 * caller args, universal write primitives with no allow-list, silent
 * `.catch(() => {})`, and missing atomic claim CAS for cron-driven
 * actions.
 *
 * Each test pins the specific cure shape so a regression that
 * re-introduces the class-of-vuln fires the test.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function source(rel: string): string {
	return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

describe('class-of-vulnerability cures (source-text pins)', () => {
	it('templates.createTemplate has explicit auth + identity match + status enum', () => {
		const svelte = source('convex/templates.ts');
		const create = svelte.slice(
			svelte.indexOf('export const createTemplate = mutation'),
			svelte.indexOf('export const createTemplate = mutation') + 4000
		);
		expect(create).toContain('await requireAuth(ctx)');
		expect(create).toContain('String(authUserId) !== String(args.userId)');
		expect(create).toMatch(/ALLOWED_TEMPLATE_STATUSES.*=\s*\["draft",\s*"published",\s*"archived",\s*"pending"\]/);
		expect(create).toContain('INVALID_TEMPLATE_STATUS');
	});

	it('sealAndScheduleBlast claims before scheduling triggerEnclaveSend (no double-dispatch)', () => {
		const svelte = source('convex/blasts.ts');
		const seal = svelte.slice(
			svelte.indexOf('// If no scheduledAt'),
			svelte.indexOf('// If no scheduledAt') + 1500
		);
		// Direct path claims BEFORE scheduling triggerEnclaveSend.
		expect(seal).toContain('internal.blasts.claimForBlastDispatch');
		expect(seal).toContain('claim.ok');
		const claimPos = seal.indexOf('claimForBlastDispatch');
		const schedPos = seal.indexOf('triggerEnclaveSend');
		expect(claimPos).toBeGreaterThan(0);
		expect(schedPos).toBeGreaterThan(claimPos);
		// triggerEnclaveSend gate requires "sending" only (was scheduled|sending).
		const trigger = svelte.slice(
			svelte.indexOf('export const triggerEnclaveSend'),
			svelte.indexOf('export const triggerEnclaveSend') + 2500
		);
		expect(trigger).toMatch(/blast\.status !== ['"]sending['"]/);
		expect(trigger).not.toMatch(
			/blast\.status !== ['"]scheduled['"] && blast\.status !== ['"]sending['"]/
		);
	});

	it('webhooks.handleInboundSms logs TCPA drop instead of silent swallow', () => {
		const svelte = source('convex/webhooks.ts');
		expect(svelte).toContain('DROPPED TCPA STOP');
		expect(svelte).toContain('DROPPED TCPA START');
		expect(svelte).toMatch(/user remains opted-in/i);
		expect(svelte).toMatch(/User remains opted-out/i);
		// Hash-failure path also logs.
		expect(svelte).toContain('computeGlobalPhoneHash failed');
	});

	it('events.createRsvp pins status enum', () => {
		const svelte = source('convex/events.ts');
		const action = svelte.slice(
			svelte.indexOf('export const createRsvp = action'),
			svelte.indexOf('export const createRsvp = action') + 2000
		);
		expect(action).toMatch(
			/ALLOWED_RSVP_STATUSES.*=\s*\[['"]GOING['"],\s*['"]MAYBE['"],\s*['"]NOT_GOING['"],\s*['"]WAITLISTED['"]\]/
		);
		expect(action).toContain('INVALID_RSVP_STATUS');
	});

	it('backfill.patchRow + seed.patchSeedRecord have table allow-list', () => {
		const backfill = source('convex/backfill.ts');
		const seed = source('convex/seed.ts');

		// backfill: supporters only.
		expect(backfill).toMatch(/ALLOWED_BACKFILL_TABLES.*=\s*\["supporters"\]/);
		expect(backfill).toContain('PATCH_TABLE_NOT_ALLOWED');
		expect(backfill).toContain('PATCH_ID_INVALID_FOR_TABLE');
		expect(backfill).toContain('ctx.db.normalizeId(table');

		// seed: supporters + donations + orgInvites (audited callers).
		expect(seed).toMatch(/ALLOWED_SEED_TABLES.*=\s*\["supporters",\s*"donations",\s*"orgInvites"\]/);
		expect(seed).toContain('PATCH_TABLE_NOT_ALLOWED');
		expect(seed).toContain('ctx.db.normalizeId(table');
	});

	it('workflows has claimExecution mutation + clearNextRunAt flag', () => {
		const svelte = source('convex/workflows.ts');
		// New CAS-style atomic claim.
		expect(svelte).toContain('export const claimExecution = internalMutation');
		expect(svelte).toContain('wrong_status:${exec.status}');
		// execute calls claim first.
		const execute = svelte.slice(
			svelte.indexOf('export const execute = internalAction'),
			svelte.indexOf('export const execute = internalAction') + 1500
		);
		expect(execute).toContain('internal.workflows.claimExecution');
		expect(execute).toContain('claim.ok');
		// updateExecution has explicit clearNextRunAt flag (was silent
		// no-op when caller passed nextRunAt: undefined).
		expect(svelte).toContain('clearNextRunAt: v.optional(v.boolean())');
		expect(svelte).toContain('else if (args.clearNextRunAt) updates.nextRunAt = undefined');
		// processScheduled uses the flag, not the undefined-drop.
		const process = svelte.slice(
			svelte.indexOf('for (const exec of paused)'),
			svelte.indexOf('for (const exec of paused)') + 800
		);
		expect(process).toContain('clearNextRunAt: true');
		// Strip comments before checking — comments may reference the
		// historical `nextRunAt: undefined` shape for prose context.
		const processNoComments = process.replace(/\/\/[^\n]*/g, '');
		expect(processNoComments).not.toMatch(/nextRunAt:\s*undefined/);
	});
});
