/**
 * Class-of-vulnerability cures, fifth sweep (source-text pins).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function source(rel: string): string {
	return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

describe('class-of-vulnerability cures, fifth sweep (source-text pins)', () => {
	it('events.publicCheckIn derives verifiedTrust server-side from checkinCode', () => {
		const svelte = source('convex/events.ts');
		// Mutation now accepts the optional code.
		expect(svelte).toMatch(/checkinCode:\s*v\.optional\(v\.string\(\)\)/);
		// Constant-time XOR-accumulator comparison.
		expect(svelte).toContain('mismatch |= args.checkinCode.charCodeAt(i) ^ event.checkinCode.charCodeAt(i)');
		// Server-derived verifiedTrust is what gates the counter, not args.verified.
		expect(svelte).toContain('if (verifiedTrust)');
		// requireVerification path refuses without a matching code.
		expect(svelte).toContain('EVENT_CHECKIN_CODE_REQUIRED');
	});

	it('checkin endpoint forwards checkinCode to the mutation', () => {
		const svelte = source('src/routes/api/e/[id]/checkin/+server.ts');
		// The SvelteKit caller passes the body checkinCode through.
		expect(svelte).toContain("checkinCode: typeof checkinCode === 'string' ? checkinCode : undefined");
	});

	it('supporters schema carries globalPhoneHash and by_globalPhoneHash index', () => {
		const svelte = source('convex/schema.ts');
		expect(svelte).toContain('globalPhoneHash: v.optional(v.string())');
		expect(svelte).toMatch(/\.index\('by_globalPhoneHash',\s*\['globalPhoneHash'\]\)/);
	});

	it('webhook STOP/START uses by_globalPhoneHash withIndex, not .filter()', () => {
		const svelte = source('convex/webhooks.ts');
		// .filter(q.eq(q.field("phoneHash"), …)) → gone (either quote style).
		expect(svelte).not.toMatch(/\.filter\(\s*\(q\)\s*=>\s*q\.eq\(q\.field\(['"]phoneHash['"]\)/);
		// withIndex on by_globalPhoneHash present at both keyword sites.
		const matches = svelte.match(/withIndex\(['"]by_globalPhoneHash['"]/g);
		expect(matches).not.toBeNull();
		expect(matches!.length).toBeGreaterThanOrEqual(2);
	});

	it('shared computeGlobalEmailHash / computeGlobalPhoneHash exported from _orgHash', () => {
		const svelte = source('convex/_orgHash.ts');
		expect(svelte).toContain('export async function computeGlobalEmailHash');
		expect(svelte).toContain('export async function computeGlobalPhoneHash');
		// Domain prefix separates the two schemes.
		expect(svelte).toContain('encoder.encode("email:" + normalized)');
		expect(svelte).toContain('encoder.encode("phone:" + normalized)');
	});

	it('webhook imports global hash helpers from shared module (no local copies)', () => {
		const svelte = source('convex/webhooks.ts');
		// Local function defs are gone.
		expect(svelte).not.toMatch(/^async function computeGlobalEmailHash/m);
		expect(svelte).not.toMatch(/^async function computeGlobalPhoneHash/m);
		// Import from _orgHash.
		expect(svelte).toMatch(/from\s+['"]\.\/_orgHash['"]/);
	});

	it('orphan recordEmailEvent removed from convex/email.ts', () => {
		const svelte = source('convex/email.ts');
		expect(svelte).not.toContain('export const recordEmailEvent');
	});

	it('campaignDeliveries has by_sesMessageId index for webhook correlation', () => {
		const svelte = source('convex/schema.ts');
		expect(svelte).toMatch(/\.index\('by_sesMessageId',\s*\['sesMessageId'\]\)/);
	});

	it('campaigns.updateDeliveryStatus accepts + persists sesMessageId', () => {
		const svelte = source('convex/campaigns.ts');
		const start = svelte.indexOf('export const updateDeliveryStatus = internalMutation');
		const next = svelte.indexOf('export const ', start + 30);
		const mutation = svelte.slice(start, next > 0 ? next : start + 3000);
		expect(mutation).toMatch(/sesMessageId:\s*v\.optional\(v\.string\(\)\)/);
		expect(mutation).toContain('patch.sesMessageId = args.sesMessageId');
	});

	it('updateDeliveryStatus logs warn on sesMessageId collision', () => {
		const svelte = source('convex/campaigns.ts');
		const start = svelte.indexOf('export const updateDeliveryStatus = internalMutation');
		const next = svelte.indexOf('export const ', start + 30);
		const mutation = svelte.slice(start, next > 0 ? next : start + 3000);
		// Collision detection reads by_sesMessageId before patching.
		expect(mutation).toMatch(/withIndex\(['"]by_sesMessageId['"]/);
		expect(mutation).toContain('sesMessageId collision');
	});

	it('backfill recomputes both org-scoped and global hashes on incomplete rows', () => {
		const svelte = source('convex/backfill.ts');
		// Query exposes hasEmailHash flag so action can detect org-scoped gaps too.
		expect(svelte).toContain('hasEmailHash: !!s.emailHash');
		// Action recomputes emailHash from plaintext when missing.
		expect(svelte).toContain('patch.emailHash = await computeOrgScopedEmailHash');
		expect(svelte).toContain('patch.phoneHash = await computeOrgScopedPhoneHash');
		// Force mode for wrong-family repair.
		expect(svelte).toMatch(/force:\s*v\.optional\(v\.boolean\(\)\)/);
	});

	it('webhook handleDeliveryEvent uses withIndex(by_sesMessageId), not .filter()', () => {
		const svelte = source('convex/webhooks.ts');
		// .filter on sesMessageId is gone (either quote style).
		expect(svelte).not.toMatch(/\.filter\(\s*\(q\)\s*=>\s*q\.eq\(q\.field\(['"]sesMessageId['"]\)/);
		// The new lookup is a single-doc withIndex + first().
		expect(svelte).toMatch(/withIndex\(['"]by_sesMessageId['"]/);
	});

	it('sendReportViaSes returns the SES MessageId so dispatch can persist it', () => {
		const svelte = source('convex/campaigns.ts');
		// Return type now carries messageId on success.
		expect(svelte).toContain('{ ok: false } | { ok: true; messageId: string | null }');
		// Caller plumbs the MessageId to updateDeliveryStatus.
		expect(svelte).toContain('sesMessageId: sesResult.ok ? (sesResult.messageId ?? undefined) : undefined');
	});

	it('supporters.importWithEncryption uses single-phase V2 encrypt-then-insert', () => {
		const svelte = source('convex/supporters.ts');
		// The action grew an action-boundary length-cap block, so a fixed
		// 6000-char window no longer reaches the encryption code — bound
		// the extraction by the next export instead.
		const start = svelte.indexOf('export const importWithEncryption = action');
		expect(start).toBeGreaterThanOrEqual(0);
		const next = svelte.indexOf('export const ', start + 30);
		expect(next).toBeGreaterThan(start);
		const fn = svelte.slice(start, next);
		// V2 encrypt happens BEFORE the row build (no placeholder).
		expect(fn).toContain('encryptForSupporterV2(normalizedEmail, orgKey, emailHash');
		// Rows passed to importBatch carry real ciphertext.
		expect(fn).toContain('encryptedEmail: JSON.stringify(encEmail)');
		// Two-phase patterns gone (strip comments before checking; match
		// either quote style for the placeholder literal).
		const stripped = fn.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
		expect(stripped).not.toMatch(/encryptedEmail:\s*(""|'')/);
		expect(stripped).not.toContain('findByEmailHashRef');
		expect(stripped).not.toContain('patchEncryptedPiiRef');
	});

	it('campaigns.submitAction encrypts with V2 before findOrCreateSupporter (single-phase)', () => {
		const svelte = source('convex/campaigns.ts');
		const fn = svelte.slice(
			svelte.indexOf('export const submitAction = action'),
			svelte.indexOf('export const submitAction = action') + 8000,
		);
		// V2 encrypt before mutation call.
		expect(fn).toContain('encryptForSupporterV2(normalizedEmail, orgKey, emailHash');
		// Real ciphertext passed to findOrCreateSupporter (not placeholder).
		expect(fn).toContain('encryptedEmail: JSON.stringify(encEmail)');
		// patchEncryptedPii follow-up removed (strip comments first).
		const stripped = fn.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
		expect(stripped).not.toContain('patchEncryptedPii');
	});

	it('consumer paths route through decryptOrgPii dispatcher (v=org-1 + v=org-2)', () => {
		// Consumer sites that decrypt supporter blobs all use the
		// version-aware dispatcher; the dispatcher routes by `blob.v`.
		const email = source('convex/email.ts');
		// Whitespace-flexible: the call site survived the refactor but the
		// file's indentation changed (spaces → tabs).
		expect(email).toMatch(/decryptOrgPii\(\s*parsed,\s*orgKey,\s*recipient\.emailHash/);
		const segments = source('convex/segments.ts');
		expect(segments).toContain('decryptOrgPii(parsed, orgKey, s.emailHash');
		const backfill = source('convex/backfill.ts');
		expect(backfill).toContain('decryptOrgPii(parsed, orgKey, s.emailHash');
		const client = source('src/lib/services/client-blast-sender.ts');
		expect(client).toContain('decryptOrgPii(');
	});

	it('client + Convex org-pii-encryption modules both expose V2 helpers', () => {
		const clientSrc = source('src/lib/core/crypto/org-pii-encryption.ts');
		expect(clientSrc).toContain('export async function encryptForSupporterV2');
		expect(clientSrc).toContain('export async function decryptOrgPii');
		expect(clientSrc).toMatch(/v:\s*'org-1'\s*\|\s*'org-2'/);
		const convexSrc = source('convex/_orgKey.ts');
		expect(convexSrc).toContain('export async function encryptForSupporterV2');
		expect(convexSrc).toContain('export async function decryptOrgPii');
	});

	it('v=org-2 encryption scheme + encryptForSupporterV2 + decryptOrgPii dispatcher', () => {
		const svelte = source('convex/_orgKey.ts');
		// Versioned blob format extended for the new AAD scheme.
		expect(svelte).toMatch(/v:\s*"org-1"\s*\|\s*"org-2"/);
		expect(svelte).toContain('export async function encryptForSupporterV2');
		expect(svelte).toContain('export async function decryptOrgPii');
		// V2 AAD uses emailHash, not row _id.
		expect(svelte).toContain('encoder.encode(`eh:${emailHash}:${fieldName}`)');
		// Dispatcher routes by v field.
		expect(svelte).toContain('encrypted.v === "org-2"');
	});

	it('donations.processCheckout uses single-phase v=org-2 insert (no placeholder)', () => {
		const svelte = source('convex/donations.ts');
		const fn = svelte.slice(
			svelte.indexOf('export const processCheckout = action'),
			svelte.indexOf('export const processCheckout = action') + 6000,
		);
		// Encryption happens BEFORE insertDonation (single-phase).
		expect(fn).toContain('encryptForSupporterV2(normalizedEmail, orgKey, emailHash');
		expect(fn).toContain('encryptForSupporterV2(args.name.trim(), orgKey, emailHash');
		// Insert carries real ciphertext, not "".
		expect(fn).toContain('encryptedEmail,');
		expect(fn).toContain('encryptedName,');
		// Two-phase placeholder pattern is gone (strip comments).
		const stripped = fn.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
		expect(stripped).not.toMatch(/encryptedEmail:\s*""/);
		expect(stripped).not.toContain('patchDonationEncryptedPiiRef');
	});

	it('orphan donations.patchEncryptedPii deleted', () => {
		const svelte = source('convex/donations.ts');
		expect(svelte).not.toContain('export const patchEncryptedPii');
	});

	it('donations sweep cron parallels supporters sweep + reuses sweepCheckpoints', () => {
		const svelte = source('convex/donations.ts');
		expect(svelte).toContain('export const sweepStrandedDonations');
		expect(svelte).toContain('export const getStrandedDonationPlaceholders');
		expect(svelte).toContain('export const deleteStrandedDonationPlaceholder');
		// 30-min threshold (Stripe sessions expire after 24h, so 30-min-old is genuinely stranded).
		expect(svelte).toMatch(/STRANDED_THRESHOLD_MS = 30 \* 60 \* 1000/);
		// Preserves completed/refunded rows (financial audit trail must survive).
		expect(svelte).toContain('PRESERVE_STATUSES');
		expect(svelte).toContain('completed');
		expect(svelte).toContain('refunded');
		// Reuses sweepCheckpoints primitive via supporters module.
		expect(svelte).toContain('internal.supporters.loadSweepCheckpoint');
		expect(svelte).toContain('internal.supporters.saveSweepCheckpoint');
		// Cron entry registered.
		const cronsSrc = source('convex/crons.ts');
		expect(cronsSrc).toContain('sweep-stranded-donations');
		expect(cronsSrc).toContain('internal.donations.sweepStrandedDonations');
		expect(cronsSrc).toContain('"23,53 * * * *"');
	});

	it('orgTwilioNumbers registry + STOP-stays-cross-org + START-scopes-to-owner-org', () => {
		const schema = source('convex/schema.ts');
		expect(schema).toContain('orgTwilioNumbers: defineTable');
		expect(schema).toMatch(/\.index\('by_phoneNumber',\s*\['phoneNumber'\]\)/);
		const webhooks = source('convex/webhooks.ts');
		// `to` arg passed into handleInboundSms.
		expect(webhooks).toMatch(/to:\s*v\.optional\(v\.string\(\)\)/);
		// START branch resolves scopedOrgId via orgTwilioNumbers registry.
		expect(webhooks).toContain('scopedOrgId');
		expect(webhooks).toContain('orgTwilioNumbers');
		// STOP branch DOES NOT scope (cross-org by TCPA design).
		const stopBranch = webhooks.slice(
			webhooks.indexOf('if (STOP_KEYWORDS.has(body))'),
			webhooks.indexOf('} else if (START_KEYWORDS'),
		);
		expect(stopBranch).not.toContain('scopedOrgId');
		// HTTP route captures the `To` field.
		const httpSrc = source('convex/http.ts');
		expect(httpSrc).toContain('const to = params.To;');
		expect(httpSrc).toMatch(/to:\s*typeof to === "string"/);
	});

	it('owner-only Twilio number registration in organizations.ts', () => {
		const svelte = source('convex/organizations.ts');
		expect(svelte).toContain('export const registerTwilioNumber');
		expect(svelte).toContain('export const unregisterTwilioNumber');
		expect(svelte).toContain('export const listTwilioNumbers');
		// E.164 normalization gate.
		expect(svelte).toContain('PHONE_NUMBER_MUST_START_WITH_PLUS');
		expect(svelte).toContain('PHONE_NUMBER_NOT_E164');
		// Cross-org uniqueness — prevents shared-pool numbers from being
		// registered (would defeat the per-org START scoping).
		expect(svelte).toContain('PHONE_NUMBER_OWNED_BY_OTHER_ORG');
	});

	it('segments use paginated dispatch via action+internal-query', () => {
		const svelte = source('convex/segments.ts');
		expect(svelte).toContain('SEGMENT_PAGE_SIZE');
		expect(svelte).toContain('SEGMENT_MAX_PAGES_PER_INVOCATION');
		expect(svelte).toContain('export const getMatchingSupportersPage = internalQuery');
		expect(svelte).toContain('export const bulkInsertTagLinks = internalMutation');
		expect(svelte).toContain('export const bulkDeleteTagLinks = internalMutation');
		// Bulk surfaces are now actions (paginated dispatch), not queries/mutations.
		expect(svelte).toMatch(/export const countMatching = action/);
		expect(svelte).toMatch(/export const bulkApplyTag = action/);
		expect(svelte).toMatch(/export const bulkRemoveTag = action/);
		expect(svelte).toMatch(/export const exportMatching = action/);
		// The legacy hard-cap patterns are gone — strip comments first
		// because the cure references the old constants in prose.
		const stripped = svelte.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
		expect(stripped).not.toContain('SEGMENT_BULK_MAX');
		expect(stripped).not.toContain('SEGMENT_BULK_TOO_LARGE');
		expect(stripped).not.toContain('__truncated_at_segment_bulk_max__');
	});

	it('findOrCreateSupporter backfills global hashes on EXISTING rows', () => {
		const svelte = source('convex/campaigns.ts');
		const mutation = svelte.slice(
			svelte.indexOf('export const findOrCreateSupporter'),
			svelte.indexOf('export const findOrCreateSupporter') + 3500,
		);
		// Args accept the global pair.
		expect(mutation).toMatch(/globalEmailHash:\s*v\.optional\(v\.string\(\)\)/);
		expect(mutation).toMatch(/globalPhoneHash:\s*v\.optional\(v\.string\(\)\)/);
		// Existing branch backfills both when caller supplies them and the row is missing them.
		expect(mutation).toContain('if (args.globalEmailHash && !existing.globalEmailHash)');
		expect(mutation).toContain('if (args.globalPhoneHash && !existing.globalPhoneHash)');
		// New-row insert carries the global pair too.
		expect(mutation).toContain('globalEmailHash: args.globalEmailHash');
		expect(mutation).toContain('globalPhoneHash: args.globalPhoneHash');
	});

	it('workflow execute flips stranded "running" to "failed" when data missing', () => {
		const svelte = source('convex/workflows.ts');
		expect(svelte).toContain('EXECUTION_OR_WORKFLOW_MISSING_AFTER_CLAIM');
		// After a successful claim, if getExecutionInternal returns null we
		// MUST move the row out of "running" via updateExecution(status:"failed").
		expect(svelte).toMatch(
			/if \(!data\) \{[\s\S]{0,800}status:\s*['"]failed['"][\s\S]{0,400}EXECUTION_OR_WORKFLOW_MISSING_AFTER_CLAIM/,
		);
	});

	it('supporters.update enforces full PII triple invariant', () => {
		const svelte = source('convex/supporters.ts');
		// The hash-pair invariant (EMAIL_HASH_PAIR_REQUIRED) was insufficient:
		// `encryptedEmail` / `encryptedPhone` were still patchable in
		// isolation — ciphertext rotation without hash update created
		// split-brain. The invariant now requires all three legs
		// (ciphertext + org-scoped + global).
		expect(svelte).toContain('EMAIL_PII_TRIPLE_REQUIRED');
		expect(svelte).toContain('PHONE_PII_TRIPLE_REQUIRED');
		expect(svelte).toContain('hasEncEmail !== hasEmailHashUpdate');
		expect(svelte).toContain('hasEncPhone !== hasPhoneHashUpdate');
	});

	it('sesMessageId binding-steal preserves bounded forensic history', () => {
		const schema = source('convex/schema.ts');
		expect(schema).toContain('previousSesMessageIds: v.optional(v.array(v.string()))');
		const svelte = source('convex/campaigns.ts');
		const start = svelte.indexOf('export const updateDeliveryStatus = internalMutation');
		const next = svelte.indexOf('export const ', start + 30);
		const mutation = svelte.slice(start, next > 0 ? next : start + 4500);
		// Steal path reads the prior history and appends the stolen id.
		expect(mutation).toContain('colliding.previousSesMessageIds');
		expect(mutation).toContain('args.sesMessageId');
		// Bounded to PREVIOUS_IDS_CAP=16 via slice(-N) so a pathological
		// collision sequence can't blow the Convex 1 MiB doc cap.
		expect(mutation).toContain('PREVIOUS_IDS_CAP = 16');
		expect(mutation).toMatch(/\.slice\(\s*-PREVIOUS_IDS_CAP/);
	});

	it('campaign counters have reconcile escape-hatch action', () => {
		const svelte = source('convex/campaigns.ts');
		expect(svelte).toContain('export const reconcileCampaignCounters');
		expect(svelte).toContain('export const recomputeCampaignCounters');
		// Reconciler reports drift but does NOT auto-repair (silent
		// repair would mask the upstream cause).
		const reconciler = svelte.slice(
			svelte.indexOf('export const reconcileCampaignCounters'),
			svelte.indexOf('export const reconcileCampaignCounters') + 2000,
		);
		expect(reconciler).toContain('DRIFT detected');
		// Recompute query sources canonical counts from campaignActions table.
		expect(svelte).toContain('actualTier3VerifiedActionCount');
	});

	it('sesMessageId collision steals binding from failed/expired rows', () => {
		const svelte = source('convex/campaigns.ts');
		const start = svelte.indexOf('export const updateDeliveryStatus = internalMutation');
		const next = svelte.indexOf('export const ', start + 30);
		const mutation = svelte.slice(start, next > 0 ? next : start + 4500);
		expect(mutation).toContain('SES_RECEIPT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000');
		expect(mutation).toContain('collidingIsStaleFailed');
		expect(mutation).toContain('collidingIsExpired');
		// Theft path clears the colliding row's binding (the forensic
		// history path also appends the cleared id to previousSesMessageIds,
		// so the patch object carries both fields — just check the
		// sesMessageId clear is present).
		expect(mutation).toMatch(/ctx\.db\.patch\(colliding\._id,\s*\{[\s\S]{0,400}sesMessageId:\s*undefined/);
	});

	it('campaigns schema carries tier3VerifiedActionCount + maintained by createCampaignAction', () => {
		const schema = source('convex/schema.ts');
		expect(schema).toContain('tier3VerifiedActionCount: v.optional(v.number())');
		const svelte = source('convex/campaigns.ts');
		// Counter incremented when verified AND trustTier>=3.
		expect(svelte).toContain('isTier3Plus');
		expect(svelte).toContain('tier3VerifiedActionCount: newTier3Count');
		// getCampaignForReport reads denormalized counter (no .collect()).
		const reportFn = svelte.slice(
			svelte.indexOf('export const getCampaignForReport'),
			svelte.indexOf('export const getCampaignForReport') + 2500,
		);
		expect(reportFn).not.toContain('campaignActions');
		expect(reportFn).toContain('campaign.tier3VerifiedActionCount ?? 0');
	});

	it('sweepStrandedPlaceholders deletes stuck placeholder supporters', () => {
		const svelte = source('convex/supporters.ts');
		expect(svelte).toContain('export const sweepStrandedPlaceholders');
		expect(svelte).toContain('export const getStrandedPlaceholderSupporters');
		expect(svelte).toContain('export const deleteStrandedPlaceholder');
		// Threshold exceeds Convex action budget (10 min).
		expect(svelte).toMatch(/STRANDED_THRESHOLD_MS = 15 \* 60 \* 1000/);
		// Mutation re-checks placeholder state inside its transaction.
		expect(svelte).toMatch(/current\.encryptedEmail !== (""|'')/);
	});

	it('cron schedule registers sweep-stranded-placeholders', () => {
		const cronsSrc = source('convex/crons.ts');
		expect(cronsSrc).toContain('sweep-stranded-placeholders');
		expect(cronsSrc).toContain('internal.supporters.sweepStrandedPlaceholders');
		// Staggered to :17/:47 to avoid the :00 storm.
		expect(cronsSrc).toContain('"17,47 * * * *"');
	});

	it('PII triple invariant has 3-state machine + scoped placeholder admission', () => {
		const svelte = source('convex/_orgHash.ts');
		expect(svelte).toContain('export function assertPiiTripleCreate');
		expect(svelte).toContain('EMAIL_PII_TRIPLE_REQUIRED');
		expect(svelte).toContain('PHONE_PII_TRIPLE_REQUIRED');
		// 3-state machine: ABSENT (undefined), PLACEHOLDER (""), ACTIVE (non-empty).
		expect(svelte).toContain('PLACEHOLDER');
		expect(svelte).toContain('ciphertextEmail === undefined');
		expect(svelte).toContain('ciphertextEmail === ""');
		// Placeholder admission is GATED by allowPlaceholder arg so public
		// mutations stay strict and only two-phase callers admit "".
		expect(svelte).toContain('allowPlaceholder');
		expect(svelte).toContain('const allowPlaceholder = args.allowPlaceholder === true');
	});

	it('donations.status is closed union literal at both schema + mutation', () => {
		const schema = source('convex/schema.ts');
		const donationsBlock = schema.slice(
			schema.indexOf('donations: defineTable'),
			schema.indexOf('donations: defineTable') + 1500,
		);
		expect(donationsBlock).toContain("v.literal('pending')");
		expect(donationsBlock).toContain("v.literal('completed')");
		expect(donationsBlock).toContain("v.literal('refunded')");
		const svelte = source('convex/donations.ts');
		expect(svelte).toContain('DONATION_STATUS_VALIDATOR');
		expect(svelte).toContain('status: DONATION_STATUS_VALIDATOR');
	});

	it('donations.updateStatus uses completedAt one-shot guard against refund→complete double-bump', () => {
		const svelte = source('convex/donations.ts');
		const fn = svelte.slice(
			svelte.indexOf('export const updateStatus = internalMutation'),
			svelte.indexOf('export const updateStatus = internalMutation') + 3500,
		);
		// New guard is completedAt-based (one-shot field), not status-based.
		expect(fn).toContain('donation.completedAt === undefined');
		// Old status-based guard is gone (or only in comment, not code).
		const stripped = fn.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
		expect(stripped).not.toMatch(/donation\.status\s*!==\s*"completed"/);
	});

	it('segments.matchCondition fails CLOSED on unknown fields/operators', () => {
		// matchCondition moved from convex/segments.ts into the shared
		// convex/_segmentMatch.ts module; segments.ts now imports it.
		const segmentsSrc = source('convex/segments.ts');
		expect(segmentsSrc).toMatch(/from\s+['"]\.\/_segmentMatch['"]/);
		const svelte = source('convex/_segmentMatch.ts');
		const start = svelte.indexOf('export function matchCondition');
		expect(start).toBeGreaterThanOrEqual(0);
		const end = svelte.indexOf('export const MAX_SEGMENT_CONDITIONS', start);
		expect(end).toBeGreaterThan(start);
		const fn = svelte.slice(start, end);
		// Default unknown-field branch returns false (not true).
		expect(fn).toMatch(/default:\s*\n[\s\S]{0,200}console\.warn\([\s\S]{0,200}unknown field[\s\S]{0,100}return false;/);
		// Unknown tag operator returns false with warn.
		expect(fn).toMatch(/unknown tag operator[\s\S]{0,80}return false;/);
		// engagementTier is now action-context based, not a fail-open legacy pass-through.
		const engagementCase = fn.slice(fn.indexOf("case 'engagementTier':"));
		expect(engagementCase.slice(0, 2000)).toContain('actionContext?.maxEngagementTier');
		expect(engagementCase.slice(0, 2000)).not.toContain('return true;');
	});

	it('importBatch passes allowPlaceholder=true; supporters.create + v1api stay strict', () => {
		const supportersSrc = source('convex/supporters.ts');
		// importBatch (two-phase via importWithEncryption) opts in.
		expect(supportersSrc).toMatch(/assertPiiTripleCreate\(\{\s*\.\.\.s,\s*allowPlaceholder:\s*true\s*\}\)/);
		// supporters.create calls without allowPlaceholder (strict default).
		const createFn = supportersSrc.slice(
			supportersSrc.indexOf('export const create = mutation'),
			supportersSrc.indexOf('export const create = mutation') + 1500,
		);
		expect(createFn).toContain('assertPiiTripleCreate(args)');
		expect(createFn).not.toContain('allowPlaceholder');
		// v1api stays strict (no allowPlaceholder passed).
		const v1apiSrc = source('convex/v1api.ts');
		const v1create = v1apiSrc.slice(
			v1apiSrc.indexOf('createSupporter'),
			v1apiSrc.indexOf('createSupporter') + 2000,
		);
		expect(v1create).toContain('assertPiiTripleCreate(args)');
		expect(v1create).not.toContain('allowPlaceholder');
	});

	it('sweepStrandedPlaceholders paginates the supporters table (not just oldest 500)', () => {
		const svelte = source('convex/supporters.ts');
		const fn = svelte.slice(
			svelte.indexOf('export const getStrandedPlaceholderSupporters'),
			svelte.indexOf('export const getStrandedPlaceholderSupporters') + 2500,
		);
		// Switched from .order("asc").take(N) to .paginate cursor-based.
		expect(fn).toContain('paginate({ numItems');
		expect(fn).toContain('paginationCursor');
		expect(fn).not.toContain('.order("asc")');
		expect(fn).toContain('continueCursor');
		// Sweep action iterates pages until isDone (with a page cap).
		const sweep = svelte.slice(
			svelte.indexOf('export const sweepStrandedPlaceholders'),
			svelte.indexOf('export const sweepStrandedPlaceholders') + 3500,
		);
		expect(sweep).toContain('while (!isDone');
		expect(sweep).toContain('pagesScanned');
	});

	it('sweep PRESERVES placeholder rows with bounced/complained emailStatus', () => {
		const svelte = source('convex/supporters.ts');
		const sweep = svelte.slice(
			svelte.indexOf('export const sweepStrandedPlaceholders'),
			svelte.indexOf('export const sweepStrandedPlaceholders') + 3500,
		);
		expect(sweep).toContain('PRESERVE_STATUSES');
		expect(sweep).toContain('bounced');
		expect(sweep).toContain('complained');
		expect(sweep).toContain('PRESERVING stranded supporter');
	});

	it('supporters.create + importBatch + v1api.createSupporter call assertPiiTripleCreate', () => {
		const supportersSrc = source('convex/supporters.ts');
		const v1apiSrc = source('convex/v1api.ts');
		// All three direct-caller paths import + invoke the helper.
		const createMatches = supportersSrc.match(/assertPiiTripleCreate/g);
		expect(createMatches).not.toBeNull();
		expect(createMatches!.length).toBeGreaterThanOrEqual(2); // create + importBatch
		expect(v1apiSrc).toContain('assertPiiTripleCreate');
	});

	it('publicCheckIn walk-in insert has post-insert OCC sanity check', () => {
		const svelte = source('convex/events.ts');
		expect(svelte).toContain('OCC INVARIANT VIOLATED');
		expect(svelte).toContain('attendeeCount may double-count');
	});

	it('workflowExecutions.status is a closed union literal (includes partial_no_op)', () => {
		const schema = source('convex/schema.ts');
		const wfBlock = schema.slice(
			schema.indexOf('workflowExecutions: defineTable'),
			schema.indexOf('workflowExecutions: defineTable') + 1500,
		);
		expect(wfBlock).toContain("v.literal('pending')");
		expect(wfBlock).toContain("v.literal('running')");
		expect(wfBlock).toContain("v.literal('paused')");
		expect(wfBlock).toContain("v.literal('completed')");
		expect(wfBlock).toContain("v.literal('partial_no_op')");
		expect(wfBlock).toContain("v.literal('failed')");
		// updateExecution arg matches the schema enum.
		const workflows = source('convex/workflows.ts');
		const update = workflows.slice(
			workflows.indexOf('export const updateExecution = internalMutation'),
			workflows.indexOf('export const updateExecution = internalMutation') + 1800,
		);
		expect(update).toMatch(/v\.literal\(['"]partial_no_op['"]\)/);
	});

	it('backfill force-mode uses OCC-guarded patch (updatedAt snapshot)', () => {
		const svelte = source('convex/backfill.ts');
		// New OCC-guarded mutation declared.
		expect(svelte).toContain('export const patchSupporterIfNotMoved');
		expect(svelte).toContain('expectedUpdatedAt');
		expect(svelte).toContain("reason: \"moved\"");
		// Query exposes updatedAt for snapshot.
		expect(svelte).toContain('updatedAt: s.updatedAt');
		// Action uses the guarded patch.
		expect(svelte).toContain('internal.backfill.patchSupporterIfNotMoved');
	});

	it('updateDeliveryStatus drops sesMessageId write on collision (no double-binding)', () => {
		const svelte = source('convex/campaigns.ts');
		const start = svelte.indexOf('export const updateDeliveryStatus = internalMutation');
		const next = svelte.indexOf('export const ', start + 30);
		const mutation = svelte.slice(start, next > 0 ? next : start + 3500);
		// Collision branch logs and EXPLICITLY does not patch
		// sesMessageId. The else branch is the only write site.
		expect(mutation).toContain('webhook correlation lost for this row');
		expect(mutation).toMatch(/} else \{[\s\S]{0,200}patch\.sesMessageId = args\.sesMessageId;[\s\S]{0,50}\}/);
	});

	it('publicCheckIn walk-in sentinel is flagged walkIn=true + roster filters by default', () => {
		const eventsSrc = source('convex/events.ts');
		// Walk-in insert carries walkIn: true.
		expect(eventsSrc).toContain('walkIn: true');
		// getRsvps filters out walkIn rows unless includeWalkIns passed.
		expect(eventsSrc).toContain('includeWalkIns');
		expect(eventsSrc).toContain('!args.includeWalkIns');
		expect(eventsSrc).toContain('.filter((r) => !r.walkIn)');
		// Schema declares the field.
		const schemaSrc = source('convex/schema.ts');
		expect(schemaSrc).toMatch(/walkIn:\s*v\.optional\(v\.boolean\(\)\)/);
	});

	it('publicCheckIn requires emailHash + inserts walk-in dedup row', () => {
		const svelte = source('convex/events.ts');
		const start = svelte.indexOf('export const publicCheckIn');
		const next = svelte.indexOf('export const ', start + 30);
		const mutation = svelte.slice(start, next > 0 ? next : start + 8000);
		// emailHash is required, not optional (was optional in an earlier
		// contract revision).
		expect(mutation).toMatch(/emailHash:\s*v\.string\(\)/);
		// Walk-in branch inserts an RSVP sentinel for dedup.
		expect(mutation).toMatch(/await ctx\.db\.insert\(['"]eventRsvps['"]/);
		// EMAIL_HASH_INVALID guard at entry — bounded length check.
		expect(mutation).toContain('EMAIL_HASH_INVALID');
	});

	it('createCampaignAction dedups via by_campaignId_supporterId, not .collect()', () => {
		const svelte = source('convex/campaigns.ts');
		// Bound the extraction by the next export rather than a fixed char window —
		// the args validator grew (metersOrgQuota/deliveryStatus) and a fixed
		// window would clip the dedup logic. Matches the sibling tests below.
		const start = svelte.indexOf('export const createCampaignAction');
		const next = svelte.indexOf('export const ', start + 30);
		const mutation = svelte.slice(start, next > 0 ? next : start + 10000);
		// Composite index lookup replaces the scan-then-find.
		expect(mutation).toMatch(/withIndex\(['"]by_campaignId_supporterId['"]/);
		// Stripped of comments — legacy .collect() on by_campaignId is gone from this mutation.
		const strippedMutation = mutation
			.replace(/\/\/[^\n]*/g, '')
			.replace(/\/\*[\s\S]*?\*\//g, '');
		expect(strippedMutation).not.toMatch(
			/withIndex\(['"]by_campaignId['"],\s*\(q\)\s*=>\s*q\.eq\(['"]campaignId['"][\s\S]{0,80}?\.collect\(\)/,
		);
	});

	it('schema carries by_campaignId_supporterId composite index', () => {
		const svelte = source('convex/schema.ts');
		expect(svelte).toMatch(/\.index\('by_campaignId_supporterId',\s*\['campaignId',\s*'supporterId'\]\)/);
	});

	it('backfill query pages at numItems:limit (no slice silent-drop)', () => {
		const svelte = source('convex/backfill.ts');
		// Strip comments before checking — comments may reference the
		// historical bad pattern for traceability.
		const stripped = svelte.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
		const query = stripped.slice(
			stripped.indexOf('getSupportersNeedingGlobalHash'),
			stripped.indexOf('getSupportersNeedingGlobalHash') + 1500,
		);
		expect(query).toContain('numItems: limit,');
		expect(query).not.toContain('numItems: limit * 5');
		expect(query).not.toContain('.slice(0, limit)');
	});

	it('v1 API createSupporter dedups via by_orgId_emailHash index', () => {
		const svelte = source('convex/v1api.ts');
		const stripped = svelte.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
		// Bound the extraction by the next export so the fixed window can't
		// drift onto a neighboring function (other v1 list endpoints
		// legitimately use .take(10_000)).
		const start = stripped.indexOf('createSupporter');
		expect(start).toBeGreaterThanOrEqual(0);
		const next = stripped.indexOf('export const ', start + 30);
		expect(next).toBeGreaterThan(start);
		const mutation = stripped.slice(start, next);
		expect(mutation).toMatch(/withIndex\(['"]by_orgId_emailHash['"]/);
		expect(mutation).not.toMatch(/\.take\(10_000\)/);
		expect(mutation).toContain('globalEmailHash: args.globalEmailHash');
		expect(mutation).toContain('globalPhoneHash: args.globalPhoneHash');
	});

	it("workflow execute terminates as partial_no_op when any step no-op'd", () => {
		const svelte = source('convex/workflows.ts');
		expect(svelte).toContain('anyStepNoOp');
		expect(svelte).toMatch(/anyStepNoOp \? ['"]partial_no_op['"] : ['"]completed['"]/);
	});

	it('backfill action recomputes globalEmailHash / globalPhoneHash from encrypted blobs', () => {
		const svelte = source('convex/backfill.ts');
		// Paginated reader returns the encrypted blobs + which legs are missing.
		expect(svelte).toContain('export const getSupportersNeedingGlobalHash');
		// Action declared.
		expect(svelte).toContain('export const backfillSupporterGlobalHashes');
		// Both legs handled — decrypt via the existing org-key path, hash
		// via the shared global-hash helpers in convex/_orgHash.
		expect(svelte).toContain('computeGlobalEmailHash(email)');
		expect(svelte).toContain('computeGlobalPhoneHash(phone)');
		// Idempotent: skips rows whose hashes are already set.
		expect(svelte).toContain('hasGlobalEmailHash');
		expect(svelte).toContain('hasGlobalPhoneHash');
	});

	it('exportMatching still loads org tag dictionary once + surfaces partial via flag', () => {
		const svelte = source('convex/segments.ts');
		// Tag-name resolution uses a Map cache (avoids N×M tag lookup) built
		// from the org-bounded tag table.
		expect(svelte).toContain('tagNameByIdMap');
		expect(svelte).toContain('getOrgTagsInternal');
		// Truncation surfaced via `partial: true` rather than in-band sentinel.
		expect(svelte).toContain('result.partial = true');
	});

	it('workflows.execute marks unimplemented step types as loud no-ops', () => {
		const svelte = source('convex/workflows.ts');
		// The silent `result: { success: true }` for the action verbs
		// branch is gone — replaced with structured success: false + error.
		expect(svelte).toContain('STEP_TYPE_NOT_IMPLEMENTED');
		expect(svelte).toContain('STEP_TYPE_UNKNOWN');
		expect(svelte).toContain('KNOWN_NOOP_STEPS');
	});

	it('insertRsvp re-checks capacity inside the mutation (overbook race fix)', () => {
		const svelte = source('convex/events.ts');
		// The insertRsvp body should contain a fresh get + capacity throw.
		const insertRsvp = svelte.slice(
			svelte.indexOf('export const insertRsvp = internalMutation'),
			svelte.indexOf('export const insertRsvp = internalMutation') + 3500,
		);
		// In-mutation event re-read present.
		expect(insertRsvp).toMatch(/const event = await ctx\.db\.get\(args\.eventId\)/);
		// Capacity gate present with the action-matching error string so
		// the SvelteKit translator keeps routing to the same 400.
		expect(insertRsvp).toMatch(/event\.capacity[\s\S]*event\.rsvpCount\s*>=\s*event\.capacity[\s\S]*!event\.waitlistEnabled/);
		expect(insertRsvp).toContain('Event is at capacity');
	});
});
