import {
	query,
	mutation,
	internalMutation,
	internalQuery,
	internalAction
} from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import { requireOrgRole } from './_authHelpers';
import type { Id } from './_generated/dataModel';
import {
	applyEmailRecipientFilter,
	type EmailRecipientFilter as SharedEmailRecipientFilter
} from './_emailRecipientFilter';

declare const process: { env: Record<string, string | undefined> };
type EncryptedSupporterForBlast = {
	_id: Id<'supporters'>;
	encryptedEmail: string;
	emailHash: string;
	encryptedName?: string;
	postalCode?: string;
	verified?: boolean;
};

const EMAIL_HASH_RE = /^[a-f0-9]{64}$/;
const MAX_HASH_FILTER_ITEMS = 10_000;

type EmailRecipientFilter = SharedEmailRecipientFilter;

function cleanStringArray(
	value: unknown,
	predicate: (value: string) => boolean,
	limit = MAX_HASH_FILTER_ITEMS
): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const cleaned = Array.from(
		new Set(value.filter((item): item is string => typeof item === 'string' && predicate(item)))
	).slice(0, limit);
	return cleaned.length > 0 ? cleaned : undefined;
}

function readSafeEmailRecipientFilter(raw: unknown): EmailRecipientFilter {
	if (!raw || typeof raw !== 'object') return {};
	const candidate = raw as Record<string, unknown>;
	const safeFilter: EmailRecipientFilter = {};
	const tagIds = cleanStringArray(
		candidate.tagIds,
		(tagId) => tagId.length > 0 && tagId.length <= 64
	);
	if (tagIds) safeFilter.tagIds = tagIds;
	const segmentIds = cleanStringArray(
		candidate.segmentIds,
		(segmentId) => segmentId.length > 0 && segmentId.length <= 64
	);
	if (segmentIds) safeFilter.segmentIds = segmentIds;
	if (
		candidate.verified === 'any' ||
		candidate.verified === 'verified' ||
		candidate.verified === 'unverified'
	) {
		safeFilter.verified = candidate.verified;
	}
	const includeEmailHashes = cleanStringArray(candidate.includeEmailHashes, (hash) =>
		EMAIL_HASH_RE.test(hash)
	);
	if (includeEmailHashes) safeFilter.includeEmailHashes = includeEmailHashes;
	const excludeEmailHashes = cleanStringArray(candidate.excludeEmailHashes, (hash) =>
		EMAIL_HASH_RE.test(hash)
	);
	if (excludeEmailHashes) safeFilter.excludeEmailHashes = excludeEmailHashes;
	return safeFilter;
}

// =============================================================================
// TEE-SEALED BLAST ORCHESTRATION
//
// For large (500+) or scheduled email blasts where the admin won't be online
// at send time. The admin seals the org decryption key to the TEE's KMS
// public key; the Nitro Enclave unseals it, decrypts supporter emails,
// sends via SES, and purges the key.
// =============================================================================

/**
 * Seal and schedule a blast for TEE-mediated send.
 * Called by the admin's browser after encrypting the org key to the TEE's KMS public key.
 */
export const sealAndScheduleBlast = mutation({
	args: {
		blastId: v.id('emailBlasts'),
		orgSlug: v.string(),
		sealedOrgKey: v.string(),
		scheduledAt: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.orgId !== org._id) {
			throw new Error('Blast not found');
		}

		if (blast.status !== 'draft') {
			throw new Error('Can only schedule draft blasts');
		}

		await ctx.db.patch(args.blastId, {
			sealedOrgKey: args.sealedOrgKey,
			scheduledAt: args.scheduledAt ?? Date.now(),
			sendMode: 'tee-sealed',
			status: 'scheduled',
			updatedAt: Date.now()
		});

		// If no scheduledAt (immediate send), trigger the enclave now.
		//
		// Claim BEFORE scheduling so the cron path can't race us. Without
		// this, cron's `getReadyBlasts` would also see this row
		// (status=scheduled, scheduledAt<=now), win its own
		// `claimForBlastDispatch`, fire its own triggerEnclaveSend, and
		// both POSTs would reach the enclave → double SES blast. Atomic
		// claim here transitions status=scheduled→sending so the cron's
		// filter (only "scheduled" rows) excludes this row. The
		// `triggerEnclaveSend` gate also requires status === "sending" —
		// belt-and-suspenders.
		if (!args.scheduledAt) {
			const claim: { ok: boolean; reason?: string } = await ctx.runMutation(
				internal.blasts.claimForBlastDispatch,
				{ blastId: args.blastId }
			);
			if (!claim.ok) {
				// Defensive: another cron tick won the race (extremely unlikely
				// within the same mutation transaction, but covers the edge
				// where claim was already taken before this branch ran).
				return;
			}
			await ctx.scheduler.runAfter(0, internal.blasts.triggerEnclaveSend, {
				blastId: args.blastId
			});
		}
	}
});

/**
 * Internal query: find blasts ready to send.
 * Called by the cron job every minute.
 */
export const getReadyBlasts = internalQuery({
	handler: async (ctx) => {
		const now = Date.now();

		// Use by_status index to find scheduled blasts
		const scheduled = await ctx.db
			.query('emailBlasts')
			.withIndex('by_status', (q) => q.eq('status', 'scheduled'))
			.collect();

		// Filter for tee-sealed blasts whose scheduledAt has passed
		return scheduled.filter(
			(b) => b.sendMode === 'tee-sealed' && b.sealedOrgKey && b.scheduledAt && b.scheduledAt <= now
		);
	}
});

/**
 * Action: trigger the enclave for a specific blast.
 * Called by the cron or by sealAndScheduleBlast for immediate sends.
 */
export const triggerEnclaveSend = internalAction({
	args: {
		blastId: v.id('emailBlasts')
	},
	handler: async (ctx, args) => {
		// 1. Fetch blast record
		const blast = await ctx.runQuery(internal.blasts.getBlastForEnclave, {
			blastId: args.blastId
		});
		if (!blast) {
			console.error(`[triggerEnclaveSend] Blast not found: ${args.blastId}`);
			return;
		}
		// Require `status === "sending"`. Both entry paths (direct from
		// `sealAndScheduleBlast` for immediate sends, and the cron path)
		// call `claimForBlastDispatch` (atomic CAS scheduled→sending)
		// BEFORE scheduling triggerEnclaveSend, so by the time we reach
		// this gate the status is always "sending". Accepting "scheduled"
		// here would leave a race window where both the direct and cron
		// paths could enter the enclave POST concurrently. Anything other
		// than "sending" means the blast was already completed/failed/
		// cancelled.
		if (blast.status !== 'sending') {
			console.warn(
				`[triggerEnclaveSend] Blast ${args.blastId} status is ${blast.status}, skipping`
			);
			return;
		}
		if (!blast.sealedOrgKey) {
			console.error(`[triggerEnclaveSend] Blast ${args.blastId} missing sealedOrgKey`);
			await ctx.runMutation(internal.blasts.updateBlastStatus, {
				blastId: args.blastId,
				status: 'failed',
				totalSent: 0,
				totalFailed: 0,
				clearSealedKey: true
			});
			return;
		}

		// Status is always "sending" by the time we reach here — both the
		// direct path and the cron path claim via `claimForBlastDispatch`
		// before scheduling triggerEnclaveSend. The transition happens in
		// the claim, not in this action.

		// 2. Fetch encrypted supporter records for the org
		const supporters = await ctx.runQuery(internal.blasts.getEncryptedSupporters, {
			orgId: blast.orgId
		});

		// 3. Call the enclave endpoint via the parent instance API
		const enclaveHost = process.env.ENCLAVE_PARENT_HOST;
		if (!enclaveHost) {
			console.error('[triggerEnclaveSend] ENCLAVE_PARENT_HOST not set');
			// Emit a Sentry alert. Without this, the only signal is a Convex
			// function-log line that nobody monitors — every queued blast gets
			// marked permanently `failed` while operators are blind. Sentry
			// dedupes alerts with the same code so blast-storm misconfig
			// collapses into one issue, not N. Best-effort: a missing alert
			// env on top of the missing enclave env still falls back to logs.
			const baseUrl = process.env.CONVEX_SITE_URL ?? '';
			const internalSecret = process.env.INTERNAL_API_SECRET ?? '';
			if (baseUrl && internalSecret) {
				try {
					await fetch(`${baseUrl}/api/internal/alert`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'x-internal-secret': internalSecret
						},
						body: JSON.stringify({
							code: 'ENCLAVE_PARENT_HOST_MISSING',
							message:
								'ENCLAVE_PARENT_HOST not configured — every queued blast will be marked failed until operator sets it',
							severity: 'error',
							context: { blastId: String(args.blastId) }
						}),
						signal: AbortSignal.timeout(10_000)
					});
				} catch (err) {
					console.error(
						'[triggerEnclaveSend] alert-emit failed:',
						err instanceof Error ? err.message : String(err)
					);
				}
			}
			await ctx.runMutation(internal.blasts.updateBlastStatus, {
				blastId: args.blastId,
				status: 'failed',
				totalSent: 0,
				totalFailed: 0,
				clearSealedKey: false
			});
			return;
		}

		try {
			// Bound the enclave call so a stuck instance (NAT GW, network ACL drift,
			// Nitro vsock starvation) doesn't burn the full 10-min Convex action
			// budget and queue every other cron behind it. 60s is generous for a
			// batch SES send; longer hangs indicate hard failure, not slow work.
			const response = await fetch(`https://${enclaveHost}/enclave/blast`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: AbortSignal.timeout(60_000),
				body: JSON.stringify({
					sealedOrgKey: blast.sealedOrgKey,
					supporters: supporters.map((s: EncryptedSupporterForBlast) => ({
						_id: String(s._id),
						encryptedEmail: s.encryptedEmail,
						emailHash: s.emailHash
					})),
					blast: {
						subject: blast.subject,
						bodyHtml: blast.bodyHtml,
						fromEmail: blast.fromEmail,
						fromName: blast.fromName,
						blastId: String(args.blastId)
					}
				})
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error(`[triggerEnclaveSend] Enclave returned ${response.status}: ${errorText}`);
				await ctx.runMutation(internal.blasts.updateBlastStatus, {
					blastId: args.blastId,
					status: 'failed',
					totalSent: 0,
					totalFailed: 0,
					clearSealedKey: true
				});
				return;
			}

			const result: { totalSent: number; totalFailed: number } = await response.json();

			// 4. Update blast status and clear the sealed key
			await ctx.runMutation(internal.blasts.updateBlastStatus, {
				blastId: args.blastId,
				status: 'sent',
				totalSent: result.totalSent,
				totalFailed: result.totalFailed,
				clearSealedKey: true
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			console.error(`[triggerEnclaveSend] Failed for blast ${args.blastId}:`, message);
			await ctx.runMutation(internal.blasts.updateBlastStatus, {
				blastId: args.blastId,
				status: 'failed',
				totalSent: 0,
				totalFailed: 0,
				clearSealedKey: true
			});
		}
	}
});

/**
 * Atomic CAS: claim a `scheduled` blast for dispatch, transitioning it to
 * `sending` in a single Convex mutation. Returns `{ ok: false }` if the
 * blast is missing or already in any non-scheduled state — handles the
 * race where two cron firings (Convex retry, double-tick at deploy
 * boundary, manual + scheduled cron overlap) both observe status=scheduled.
 * Only one mutation wins; the other gets `{ ok: false }` and skips.
 *
 * Convex mutations are serializable, so this CAS is race-free. Mirrors
 * `submissions.claimForDelivery`.
 */
export const claimForBlastDispatch = internalMutation({
	args: { blastId: v.id('emailBlasts') },
	handler: async (ctx, args): Promise<{ ok: boolean }> => {
		const blast = await ctx.db.get(args.blastId);
		if (!blast) return { ok: false };
		if (blast.status !== 'scheduled') return { ok: false };
		await ctx.db.patch(args.blastId, {
			status: 'sending',
			updatedAt: Date.now()
		});
		return { ok: true };
	}
});

/**
 * Process scheduled blasts — called by cron every minute. Uses
 * `claimForBlastDispatch` to atomically transition `scheduled → sending`
 * before invoking the enclave, so concurrent cron firings cannot both
 * dispatch the same blast (and double-send the email).
 */
export const processScheduledBlasts = internalAction({
	handler: async (ctx) => {
		const ready = await ctx.runQuery(internal.blasts.getReadyBlasts);
		for (const blast of ready) {
			const claim = await ctx.runMutation(internal.blasts.claimForBlastDispatch, {
				blastId: blast._id
			});
			if (!claim.ok) {
				// Another cron firing already claimed this blast; skip.
				continue;
			}
			await ctx.runAction(internal.blasts.triggerEnclaveSend, {
				blastId: blast._id
			});
		}
	}
});

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Internal query: get blast by ID for enclave processing.
 */
export const getBlastForEnclave = internalQuery({
	args: { blastId: v.id('emailBlasts') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.blastId);
	}
});

/**
 * Internal query: get encrypted supporters for an org (subscribed only).
 */
export const getEncryptedSupporters = internalQuery({
	args: { orgId: v.id('organizations') },
	handler: async (ctx, args) => {
		const supporters = await ctx.db
			.query('supporters')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.collect();

		return supporters
			.filter((s) => s.emailStatus === 'subscribed')
			.map((s) => ({
				_id: s._id,
				encryptedEmail: s.encryptedEmail,
				emailHash: s.emailHash
			}));
	}
});

/**
 * Internal mutation: update blast status after enclave send.
 */
export const updateBlastStatus = internalMutation({
	args: {
		blastId: v.id('emailBlasts'),
		status: v.string(),
		totalSent: v.number(),
		totalFailed: v.number(),
		clearSealedKey: v.boolean()
	},
	handler: async (ctx, args) => {
		const blast = await ctx.db.get(args.blastId);
		if (!blast) return;

		const patch: Record<string, unknown> = {
			status: args.status,
			totalSent: args.totalSent,
			totalBounced: args.totalFailed,
			updatedAt: Date.now()
		};
		if (args.status === 'sent') {
			patch.sentAt = Date.now();
		}
		if (args.clearSealedKey) {
			patch.sealedOrgKey = undefined;
		}

		await ctx.db.patch(args.blastId, patch);

		// Increment org-level email counter on status transition to "sent"
		// (mirrors the pattern in email.ts updateBlastStatus)
		if (args.status === 'sent' && blast.status !== 'sent' && blast.orgId) {
			const org = await ctx.db.get(blast.orgId);
			if (org) {
				const currentCount = org.sentEmailCount ?? 0;
				await ctx.db.patch(blast.orgId, {
					sentEmailCount: currentCount + args.totalSent,
					updatedAt: Date.now()
				});
			}
		}
	}
});

// =============================================================================
// CLIENT-DIRECT BLAST SUPPORT
//
// Public query + mutation for browser-side blast sends (<500 recipients).
// The admin's browser decrypts supporter emails with the org key,
// sends via Lambda proxy, and reports progress back here.
// =============================================================================

/**
 * Public query: get encrypted supporters for a client-direct blast.
 * Returns only subscribed supporters' encrypted email blobs + email hashes.
 * Requires editor+ role on the org.
 */
export const getEncryptedSupportersForBlast = query({
	args: {
		orgSlug: v.string(),
		blastId: v.optional(v.id('emailBlasts'))
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		// Resolve the persisted recipientFilter from the blast row. Without
		// blastId (legacy callers) the entire subscribed cohort returns — which
		// is the previous behavior. Per cure: when a blastId is supplied
		// the filter that was saved at compose time IS enforced here, not just
		// at the count step.
		//
		// `recipientFilter` is schema-validated on new writes, but older rows
		// may still carry stale shapes. An unchecked `as typeof filter` cast at
		// read time would let a single malformed write (e.g., saved
		// `{tagIds: ['not-a-real-id'], verified: 'maybe'}`) poison every
		// future dispatch — `ctx.db.get(tagId)` would throw on the bad id,
		// breaking `getEncryptedSupportersForBlast` which is exactly the
		// dispatch-claim issuer's dependency. Validate shape at read:
		// tagIds/segmentIds must be arrays of strings; verified must be one
		// of the three literals; anything else is silently ignored (treat as
		// no-filter rather than throw, so a stale-shape blast is
		// recoverable by a re-save instead of a hard error).
		let filter: EmailRecipientFilter = {};
		if (args.blastId) {
			const blast = await ctx.db.get(args.blastId);
			if (!blast || blast.orgId !== org._id) {
				throw new Error('Blast not found in this organization');
			}
			filter = readSafeEmailRecipientFilter(blast.recipientFilter);
		}
		const supporters = await ctx.db
			.query('supporters')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.collect();

		const filtered = await applyEmailRecipientFilter(ctx, org._id, supporters, filter);

		return filtered.map((s) => ({
			_id: s._id,
			encryptedEmail: s.encryptedEmail,
			emailHash: s.emailHash,
			encryptedName: s.encryptedName,
			postalCode: s.postalCode,
			verified: s.verified
		}));
	}
});

/**
 * Public mutation: update blast progress from a client-direct send.
 * Called by the browser as batches complete. Only allows updating
 * blasts owned by the caller's org and in 'sending' or 'draft' status.
 */
export const updateClientBlastProgress = mutation({
	args: {
		orgSlug: v.string(),
		blastId: v.id('emailBlasts'),
		// Pin status to documented enum. Free-form `v.string()` would
		// let a caller write 'pwned' and break downstream invariants
		// (the status guard below would then refuse future legit updates).
		status: v.union(
			v.literal('draft'),
			v.literal('sending'),
			v.literal('sent'),
			v.literal('failed')
		),
		totalSent: v.number(),
		totalBounced: v.number(),
		totalRecipients: v.optional(v.number()),
		batches: v.optional(v.any())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.orgId !== org._id) {
			throw new Error('Blast not found');
		}
		const previousStatus = blast.status;

		// Only allow updates from client-direct sends in valid states
		if (blast.sendMode !== 'client-direct' && args.status !== 'sending') {
			throw new Error('Blast is not a client-direct send');
		}
		if (blast.status !== 'draft' && blast.status !== 'sending') {
			throw new Error('Blast already finalized');
		}

		// Bound `totalSent` / `totalBounced` to the cohort size declared
		// at blast-creation. Without this, unbounded `totalSent: v.number()`
		// would let an editor call with `totalSent: 1_000_000_000` and
		// permanently inflate the org's `sentEmailCount` (irreversible
		// without manual DB surgery — there's no decrement path). The
		// cohort size is the natural upper bound: you can't send more
		// emails than recipients. `totalRecipients` is set at blast
		// creation from the recipientFilter snapshot and the cohort is
		// locked.
		if (args.totalSent < 0) throw new Error('TOTAL_SENT_NEGATIVE');
		if (args.totalBounced < 0) throw new Error('TOTAL_BOUNCED_NEGATIVE');
		if (args.totalSent > blast.totalRecipients) {
			throw new Error('TOTAL_SENT_EXCEEDS_COHORT');
		}
		if (args.totalBounced > blast.totalRecipients) {
			throw new Error('TOTAL_BOUNCED_EXCEEDS_COHORT');
		}

		const patch: Record<string, unknown> = {
			status: args.status,
			totalSent: args.totalSent,
			totalBounced: args.totalBounced,
			updatedAt: Date.now()
		};

		if (args.totalRecipients !== undefined) {
			patch.totalRecipients = args.totalRecipients;
		}
		if (args.batches !== undefined) {
			patch.batches = args.batches;
		}
		if (args.status === 'sent') {
			patch.sentAt = Date.now();
		}

		await ctx.db.patch(args.blastId, patch);

		// Increment org-level email counter on transition to "sent". The
		// delta is bounded by the cohort-size check above, so no inflation
		// attack is possible. If `totalSent` is somehow > blast.totalRecipients
		// we'd have thrown; the counter can grow by at most that bound.
		if (args.status === 'sent' && previousStatus !== 'sent') {
			const orgDoc = await ctx.db.get(org._id);
			if (orgDoc) {
				const currentCount = orgDoc.sentEmailCount ?? 0;
				await ctx.db.patch(org._id, {
					sentEmailCount: currentCount + args.totalSent,
					updatedAt: Date.now()
				});
			}
		}
	}
});

/**
 * Internal-only mutation: persist per-recipient send receipts when the
 * caller has already been authenticated by the surrounding harness (Convex
 * http action verifying a shared secret from the Lambda forwarder). Same
 * upsert logic as `recordBlastReceipts` but skips the orgSlug membership
 * check — the caller is the platform Lambda, not a browser editor.
 * Deeper cure: closes the browser-disconnect-mid-blast gap by giving
 * the Lambda a durable receipt write path independent of the browser.
 */
export const recordBlastReceiptsInternal = internalMutation({
	args: {
		blastId: v.id('emailBlasts'),
		receipts: v.array(
			v.object({
				recipientEmailHash: v.string(),
				sesMessageId: v.optional(v.string()),
				status: v.union(v.literal('sent'), v.literal('failed')),
				sentAt: v.number(),
				error: v.optional(v.string())
			})
		)
	},
	handler: async (ctx, args) => {
		const blast = await ctx.db.get(args.blastId);
		if (!blast) {
			throw new Error('Blast not found');
		}
		if (blast.sendMode !== 'client-direct' && blast.sendMode !== 'tee-sealed') {
			throw new Error(`Receipts not supported for sendMode '${blast.sendMode ?? '(unset)'}'`);
		}
		if (blast.status !== 'sending' && blast.status !== 'sent') {
			throw new Error(`Cannot record receipts for blast in status '${blast.status}'`);
		}
		if (args.receipts.length === 0) return { written: 0, updated: 0 };
		if (args.receipts.length > 200) {
			throw new Error('Too many receipts in a single batch (max 200)');
		}

		// Cohort cap — storage-bloat / cohort-poisoning bound. New inserts
		// (after subtracting upsert hits) must not push the per-blast receipt
		// count past 2× totalRecipients. The 2× slack covers retries +
		// browser-and-Lambda double-write race; anything above that is a
		// misbehaving caller and rejected.
		const ceiling = Math.max(2000, blast.totalRecipients * 2);
		// Take at most `ceiling + 1` to count existing receipts. A
		// `.collect()` here would be an unbounded read that crashes
		// mid-stream from Convex's per-mutation 16K-doc cap for any blast
		// with >16K receipts (or many smaller blasts whose receipt rows
		// persist). The cap-check itself would become the read bomb —
		// mutation aborts before reaching the rejection branch, leaving
		// the cohort cap unenforced for that blast. The count is bounded
		// by the very ceiling it enforces; "more than the cap" is the
		// only signal needed.
		const existingCount = (
			await ctx.db
				.query('emailDeliveryReceipts')
				.withIndex('by_blastId', (q) => q.eq('blastId', args.blastId))
				.take(ceiling + 1)
		).length;

		let written = 0;
		let updated = 0;
		let skippedDowngrade = 0;
		for (const r of args.receipts) {
			const sesMessageId = r.status === 'sent' ? r.sesMessageId : undefined;
			const existing = await ctx.db
				.query('emailDeliveryReceipts')
				.withIndex('by_blastId_recipientEmailHash', (q) =>
					q.eq('blastId', args.blastId).eq('recipientEmailHash', r.recipientEmailHash)
				)
				.first();
			if (existing) {
				// never downgrade a 'sent' to 'failed'. Browser's
				// network-error catch writes 'failed' when fetch() throws before
				// Lambda's response is received; Lambda's direct receipt-forward
				// (durable receipt forward) writes 'sent' from the same dispatch. Both
				// target the same (blastId, emailHash) row, and Convex `patch`
				// overwrites unconditionally — so an out-of-order arrival could
				// replace an authoritative 'sent' with a stale 'failed'. 'Sent'
				// is final-good (the Lambda confirmed SES delivery); 'failed' is
				// browser-side optimism that the Lambda might or might not have
				// also produced. Skip the patch in that case.
				if (existing.status === 'sent' && r.status === 'failed') {
					skippedDowngrade++;
					continue;
				}
				await ctx.db.patch(existing._id, {
					sesMessageId,
					status: r.status,
					sentAt: r.sentAt,
					error: r.error
				});
				updated++;
			} else {
				if (existingCount + written >= ceiling) {
					throw new Error(
						`Receipt cohort cap exceeded for blast (${ceiling}); refusing further inserts`
					);
				}
				await ctx.db.insert('emailDeliveryReceipts', {
					blastId: args.blastId,
					recipientEmailHash: r.recipientEmailHash,
					sesMessageId,
					status: r.status,
					sentAt: r.sentAt,
					error: r.error
				});
				written++;
			}
		}
		return { written, updated, skippedDowngrade };
	}
});

/**
 * Persist per-recipient send receipts emitted by `sendBlastFromClient` after
 * each Lambda batch. Upserts on (blastId, recipientEmailHash) via the
 * `by_blastId_recipientEmailHash` index — retries on the same recipient
 * patch the existing row instead of double-writing. Closes (cure shipped).
 *
 * Batch cap is 200: each receipt is one indexed read + one write = up to 400
 * ops. Convex transactions cap around 4096 ops; 200 keeps an order of
 * magnitude of headroom for index-fanout / read amplification. Don't raise
 * without re-measuring under OCC retry pressure.
 *
 * `sendMode` accepts both `client-direct` (today's bulk path) and
 * `tee-sealed` (the J-phase Nitro Enclave path; see
 * `convex/blasts.ts:sealAndScheduleBlast` and the NitroEnclaveResolver
 * stub). When TEE-sealed lands the enclave will write receipts the same way.
 */
export const recordBlastReceipts = mutation({
	args: {
		orgSlug: v.string(),
		blastId: v.id('emailBlasts'),
		receipts: v.array(
			v.object({
				recipientEmailHash: v.string(),
				sesMessageId: v.optional(v.string()),
				status: v.union(v.literal('sent'), v.literal('failed')),
				sentAt: v.number(),
				error: v.optional(v.string())
			})
		)
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'editor');

		const blast = await ctx.db.get(args.blastId);
		if (!blast || blast.orgId !== org._id) {
			throw new Error('Blast not found in this organization');
		}
		if (blast.sendMode !== 'client-direct' && blast.sendMode !== 'tee-sealed') {
			throw new Error(`Receipts not supported for sendMode '${blast.sendMode ?? '(unset)'}'`);
		}
		if (blast.status !== 'sending' && blast.status !== 'sent') {
			throw new Error(`Cannot record receipts for blast in status '${blast.status}'`);
		}
		if (args.receipts.length === 0) return { written: 0, updated: 0 };
		if (args.receipts.length > 200) {
			throw new Error('Too many receipts in a single batch (max 200)');
		}

		// Cohort cap — see `recordBlastReceiptsInternal` for rationale.
		const ceiling = Math.max(2000, blast.totalRecipients * 2);
		// Take at most `ceiling + 1` to count existing receipts. A
		// `.collect()` here would be an unbounded read that crashes
		// mid-stream from Convex's per-mutation 16K-doc cap for any blast
		// with >16K receipts (or many smaller blasts whose receipt rows
		// persist). The cap-check itself would become the read bomb —
		// mutation aborts before reaching the rejection branch, leaving
		// the cohort cap unenforced for that blast. The count is bounded
		// by the very ceiling it enforces; "more than the cap" is the
		// only signal needed.
		const existingCount = (
			await ctx.db
				.query('emailDeliveryReceipts')
				.withIndex('by_blastId', (q) => q.eq('blastId', args.blastId))
				.take(ceiling + 1)
		).length;

		let written = 0;
		let updated = 0;
		let skippedDowngrade = 0;
		for (const r of args.receipts) {
			// Defensive: failed receipts must not carry a sesMessageId (which would
			// pollute the by_sesMessageId index). The convex validator above
			// already enforces status ∈ {sent, failed}; this guard catches a
			// failed-with-messageId mismatch from a misbehaving caller.
			const sesMessageId = r.status === 'sent' ? r.sesMessageId : undefined;
			const existing = await ctx.db
				.query('emailDeliveryReceipts')
				.withIndex('by_blastId_recipientEmailHash', (q) =>
					q.eq('blastId', args.blastId).eq('recipientEmailHash', r.recipientEmailHash)
				)
				.first();
			if (existing) {
				// never downgrade 'sent' → 'failed'. See
				// `recordBlastReceiptsInternal` for full rationale; both writers
				// share the same upsert semantics, so both apply the rule.
				if (existing.status === 'sent' && r.status === 'failed') {
					skippedDowngrade++;
					continue;
				}
				await ctx.db.patch(existing._id, {
					sesMessageId,
					status: r.status,
					sentAt: r.sentAt,
					error: r.error
				});
				updated++;
			} else {
				if (existingCount + written >= ceiling) {
					throw new Error(
						`Receipt cohort cap exceeded for blast (${ceiling}); refusing further inserts`
					);
				}
				await ctx.db.insert('emailDeliveryReceipts', {
					blastId: args.blastId,
					recipientEmailHash: r.recipientEmailHash,
					sesMessageId,
					status: r.status,
					sentAt: r.sentAt,
					error: r.error
				});
				written++;
			}
		}
		return { written, updated, skippedDowngrade };
	}
});
