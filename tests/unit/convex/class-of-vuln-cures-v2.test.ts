/**
 * Class-of-vulnerability cures, second sweep (source-text pins).
 *
 * Each test pins the specific cure shape so a regression fires the test.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function source(rel: string): string {
	return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

describe('class-of-vulnerability cures, second sweep (source-text pins)', () => {
	it('emitOnChainRevocation has claim CAS', () => {
		const svelte = source('convex/users.ts');
		expect(svelte).toContain('export const claimEmitRevocation = internalMutation');
		expect(svelte).toContain("wrong_status:${credential.revocationStatus");
		// Action calls claim before relayer POST.
		const action = svelte.slice(
			svelte.indexOf('export const emitOnChainRevocation = internalAction'),
			svelte.indexOf('export const emitOnChainRevocation = internalAction') + 3000
		);
		expect(action).toContain('internal.users.claimEmitRevocation');
		const claimPos = action.indexOf('claimEmitRevocation');
		const fetchPos = action.indexOf('fetch(');
		expect(claimPos).toBeGreaterThan(0);
		expect(fetchPos).toBeGreaterThan(claimPos);
	});

	it('email.getBlastRecipients has runtime filter validation (no unchecked cast)', () => {
		const svelte = source('convex/email.ts');
		// The unchecked `as typeof filter` cast must be gone.
		const getRecip = svelte.slice(
			svelte.indexOf('let filter: {'),
			svelte.indexOf('let filter: {') + 2000
		);
		expect(getRecip).not.toMatch(/blast\.recipientFilter as typeof filter/);
		// Required: candidate object check + per-field validation.
		expect(getRecip).toContain('raw && typeof raw === "object"');
		expect(getRecip).toMatch(/Array\.isArray\(candidate\.tagIds\)/);
		expect(getRecip).toMatch(/candidate\.tagIds\.every\(/);
		expect(getRecip).toMatch(/candidate\.verified === "any"/);
	});

	it('sms.createBlast/updateBlast has body cap + status enum', () => {
		const svelte = source('convex/sms.ts');
		expect(svelte).toMatch(/MAX_SMS_BODY_LENGTH\s*=\s*2048/);
		expect(svelte).toMatch(/ALLOWED_SMS_BLAST_STATUSES.*=\s*\["draft",\s*"sending",\s*"sent",\s*"failed"\]/);
		expect(svelte).toContain('SMS_BODY_TOO_LARGE');
		expect(svelte).toContain('FROM_NUMBER_TOO_LARGE');
		expect(svelte).toContain('TOTAL_RECIPIENTS_TOO_LARGE');
		// updateBlast.status is constrained to the shared smsBlastStatus enum
		// validator (not a free v.string()); the union literal lives in _validators.
		const update = svelte.slice(
			svelte.indexOf('export const updateBlast = mutation'),
			svelte.indexOf('export const updateBlast = mutation') + 1500
		);
		expect(update).toMatch(/status:\s*v\.optional\(smsBlastStatus\)/);
		const validators = source('convex/_validators.ts');
		expect(validators).toMatch(/smsBlastStatus\s*=\s*v\.union\(\s*v\.literal\('draft'\)/);
	});

	it('submissions idempotency key is user-scoped', () => {
		const svelte = source('convex/submissions.ts');
		// Idempotency block must check pseudonymousId match.
		const anchor = svelte.indexOf('by_idempotencyKey');
		const idem = svelte.slice(anchor, anchor + 2500);
		expect(idem).toContain('existingByKey.pseudonymousId === args.pseudonymousId');
		expect(idem).toContain('IDEMPOTENCY_KEY_COLLISION');
	});

	it('workflow step shape validation (allow-list types + bounds)', () => {
		const svelte = source('convex/workflows.ts');
		expect(svelte).toContain('function validateWorkflowSteps');
		expect(svelte).toMatch(/ALLOWED_STEP_TYPES.*=\s*\["send_email",\s*"add_tag",\s*"delay",\s*"condition"\]/);
		// delayMinutes bounded.
		expect(svelte).toContain('MAX_DELAY_MINUTES');
		expect(svelte).toContain('STEP_${i}_DELAY_OUT_OF_RANGE');
		expect(svelte).toContain('Number.isInteger(s.delayMinutes)');
		// Both create + update call the validator.
		const create = svelte.slice(
			svelte.indexOf('export const create = mutation'),
			svelte.indexOf('export const create = mutation') + 1500
		);
		expect(create).toContain('validateWorkflowSteps(args.steps)');
		const update = svelte.slice(
			svelte.indexOf('export const update = mutation'),
			svelte.indexOf('export const update = mutation') + 1500
		);
		expect(update).toContain('validateWorkflowSteps(args.steps)');
	});

	it('importBatch pre-validates cross-org tagIds + logs row errors', () => {
		const svelte = source('convex/supporters.ts');
		const start = svelte.indexOf('export const importBatch = mutation');
		const next = svelte.indexOf('export const ', start + 30);
		const importB = svelte.slice(start, next > 0 ? next : start + 9000);
		// Pre-validation loop over allTagIds.
		expect(importB).toContain('allTagIds');
		expect(importB).toContain('TAG_CROSS_ORG');
		expect(importB).toContain('TAG_NOT_FOUND');
		expect(importB).toContain('TAG_ID_INVALID');
		expect(importB).toContain('String(tag.orgId) !== String(org._id)');
		// `as any` cast on tagId must be gone; normalizeId used instead.
		expect(importB).toContain('ctx.db.normalizeId("tags"');
		expect(importB).not.toMatch(/tagId:\s*tagId as any/);
		// Silent catch retired — must log per-row errors.
		expect(importB).toContain('errors: string[]');
		expect(importB).toContain('console.warn');
		expect(importB).toMatch(/row\[\$\{i\}\]:/);
	});
});
