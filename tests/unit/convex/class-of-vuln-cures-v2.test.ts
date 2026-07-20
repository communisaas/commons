/**
 * Class-of-vulnerability cures, second sweep (source-text pins).
 *
 * Each test pins the specific cure shape so a regression fires the test.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeEmailAudienceFilter } from '../../../convex/_audienceFilters';

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
		const normalizer = source('convex/_audienceFilters.ts');
		// The unchecked `as typeof filter` cast must be gone (file-wide).
		expect(svelte).not.toMatch(/blast\.recipientFilter as typeof filter/);
		// Shape validation is centralized in the shared email/SMS audience
		// normalizer. readSafeRecipientFilter must delegate to that fail-closed
		// boundary rather than maintaining a second hand-rolled shape check.
		const readSafeStart = svelte.indexOf('function readSafeRecipientFilter');
		expect(readSafeStart).toBeGreaterThan(-1);
		const readSafe = svelte.slice(readSafeStart, readSafeStart + 300);
		expect(readSafe).toContain('return normalizeEmailAudienceFilter(raw)');
		expect(normalizer).toContain("throw new Error('EMAIL_AUDIENCE_FILTER_INVALID')");
		expect(normalizer).toContain("candidate.segmentIds");
		expect(normalizer).toContain("candidate.verified !== 'any'");
		expect(normalizer).toContain('MAX_AUDIENCE_FILTER_BYTES');

		// Behavioral proof: malformed legacy/caller shapes fail closed instead of
		// widening to every subscribed supporter, while a valid closed shape is
		// normalized without changing its audience axes.
		expect(() => normalizeEmailAudienceFilter([])).toThrow('EMAIL_AUDIENCE_FILTER_INVALID');
		expect(() => normalizeEmailAudienceFilter({ tagIds: 'not-an-array' })).toThrow(
			'EMAIL_AUDIENCE_TAG_FILTERS_INVALID'
		);
		expect(() => normalizeEmailAudienceFilter({ verified: 'maybe' })).toThrow(
			'EMAIL_AUDIENCE_VERIFICATION_FILTER_INVALID'
		);
		expect(
			normalizeEmailAudienceFilter({
				tagIds: ['tag-id'],
				segmentIds: ['segment-id'],
				verified: 'verified'
			})
		).toEqual({
			tagIds: ['tag-id'],
			segmentIds: ['segment-id'],
			verified: 'verified'
		});
		// getBlastRecipients validates the persisted filter at recipient-load
		// (org-scoped lookup, fail-closed) and applies it via the shared
		// _emailRecipientFilter module. The recipient scan is now PAGINATED
		// (pageFilteredRecipients) rather than a single .collect() — but the
		// same filter validation runs first, so the security invariant holds.
		const blastStart = svelte.indexOf('export const getBlastRecipients = internalQuery');
		expect(blastStart).toBeGreaterThan(-1);
		const getRecip = svelte.slice(blastStart, blastStart + 3000);
		expect(getRecip).toMatch(/if \(!blast \|\| blast\.orgId !== args\.orgId\)/);
		expect(getRecip).toContain('readSafeRecipientFilter(blast.recipientFilter)');
		// Filter is applied via the shared paginated resolver, which calls
		// applyEmailRecipientFilter per page internally.
		expect(getRecip).toContain('pageFilteredRecipients(');
		expect(svelte).toMatch(/import \{[\s\S]*?from '\.\/_emailRecipientFilter';/);
	});

	it('email recipient resolution paginates the supporter roster (no unbounded .collect())', () => {
		const svelte = source('convex/email.ts');
		const blasts = source('convex/blasts.ts');
		// The whole-roster `.query('supporters')....collect()` send-path scans are
		// replaced by the shared bounded/paginated resolvers. None of the four
		// send-path resolution helpers may `.collect()` supporters directly.
		const helper = source('convex/_emailRecipientFilter.ts');
		expect(helper).toContain('export async function pageFilteredRecipients');
		// The page primitive paginates rather than collects.
		expect(helper).toContain('const pagination = {');
		expect(helper).toContain('cursor,');
		expect(helper).toContain('numItems: Math.trunc(scanPageSize)');
		expect(helper).toContain('.paginate(pagination)');
		expect(helper).toContain('maximumRowsRead: Math.trunc(scanPageSize) + 1');
		expect(helper).toContain('maximumBytesRead: RECIPIENT_MAX_BYTES_PER_PAGE');
		// Count, exact-hash, internal-send, and client-direct send paths all
		// consume the same cursor-bearing page primitive. No helper may hide a
		// whole-cohort collection inside a single Convex transaction.
		expect(svelte).toContain('export const countRecipientsForFilter = query');
		expect(svelte).toContain('export const resolveRecipientHashesForFilter = query');
		expect(svelte).toContain('export const getBlastRecipients = internalQuery');
		expect(blasts).toContain('export const getEncryptedSupportersForBlast = query');
		expect(svelte).toContain('continueCursor: page.continueCursor');
		expect(blasts).toContain('continueCursor: page.continueCursor');
		// The recipient-resolution send paths no longer scan the whole org roster
		// via `by_orgId` + `.collect()` (the >16K scan-cliff). The remaining
		// supporter reads in email.ts are bounded single-key lookups
		// (by_orgId_emailHash .first()) and a bounded cross-org bounce
		// correlation (by_globalEmailHash), not the per-org roster.
		expect(svelte).not.toMatch(
			/\.withIndex\('by_orgId',[\s\S]{0,80}?\.collect\(\)/
		);
		expect(blasts).not.toMatch(
			/\.withIndex\('by_orgId',[\s\S]{0,80}?\.collect\(\)/
		);
	});

	it('sms.createBlast/updateBlast has body cap + status enum', () => {
		const svelte = source('convex/sms.ts');
		expect(svelte).toMatch(/MAX_SMS_BODY_LENGTH\s*=\s*2048/);
		expect(svelte).toMatch(
			/ALLOWED_SMS_BLAST_STATUSES.*=\s*\[['"]draft['"],\s*['"]sending['"],\s*['"]sent['"],\s*['"]failed['"]\]/
		);
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
		// Allow-list grew remove_tag when the workflow runner was armed
		// (FEATURES.WORKFLOW_EXECUTION); pin the exact current list.
		expect(svelte).toMatch(
			/ALLOWED_STEP_TYPES\s*=\s*\[\s*['"]send_email['"],\s*['"]add_tag['"],\s*['"]remove_tag['"],\s*['"]delay['"],\s*['"]condition['"]\s*\]/
		);
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
		expect(start).toBeGreaterThan(-1);
		const next = svelte.indexOf('export const ', start + 30);
		const importB = svelte.slice(start, next > 0 ? next : start + 9000);
		// Pre-validation loop over allTagIds.
		expect(importB).toContain('allTagIds');
		expect(importB).toContain('TAG_CROSS_ORG');
		expect(importB).toContain('TAG_NOT_FOUND');
		expect(importB).toContain('TAG_ID_INVALID');
		expect(importB).toContain('String(tag.orgId) !== String(org._id)');
		// `as any` cast on tagId must be gone; normalizeId used instead.
		expect(importB).toMatch(/ctx\.db\.normalizeId\(['"]tags['"]/);
		expect(importB).not.toMatch(/tagId:\s*tagId as any/);
		// Silent catch retired — must log per-row errors.
		expect(importB).toContain('errors: string[]');
		expect(importB).toContain('console.warn');
		expect(importB).toMatch(/row\[\$\{i\}\]:/);
	});
});
